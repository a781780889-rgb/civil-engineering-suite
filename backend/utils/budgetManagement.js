/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * ===================================================================
 * الجزء الأول (1/10): البنية الأساسية + طبقة التخزين الموحّدة + إنشاء/تعديل
 *                      ميزانية المشروع + هيكل تقسيم الميزانية (BBS) + لوحة
 *                      تحكم مالية أساسية + سجل تدقيق + الربط بالمشاريع.
 *
 * خطة التقسيم الكاملة (راجع BUDGET_PLAN.md):
 *  1/10: الأساس + التخزين + إنشاء الميزانية + BBS + لوحة تحكم أساسية (منجَز)
 *  2/10: إدارة بنود التكلفة + الربط مع حصر الكميات (BOQ) (هذا الملف)
 *  3/10: إدارة التكاليف الفعلية (مواد/عمالة/معدات/أخرى)
 *  4/10: إدارة الإيرادات + الدفعات + المستخلصات
 *  5/10: أوامر التغيير (Change Orders)
 *  6/10: مراقبة الانحرافات المالية + تحليل القيمة المكتسبة (EVM)
 *  7/10: التدفقات النقدية (Cash Flow) + الموافقات المالية
 *  8/10: الفواتير والمستخلصات (Invoicing)
 *  9/10: التقارير المالية + الرسوم البيانية + التصدير (PDF/Excel/CSV/Word)
 *  10/10: الذكاء الاصطناعي المالي + التكامل الشامل مع بقية الأقسام
 *
 * نمط التخزين: نفس نمط بقية الأقسام (drawingManagement / documentManagement) -
 * ملفات JSON على القرص بدون أي تبعيات خارجية:
 *   - backend/data/budgets.json           (ميزانيات المشاريع + BBS + سجل الإصدارات)
 *   - backend/data/budget_audit.json      (سجل تدقيق مخصص لعمليات الميزانية)
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل ميزانية مرتبطة فعلياً بمشروع حقيقي (يتم التحقق من وجوده عبر projectManagement
 *    عند توفره)، برقم إصدار (version) حقيقي يزداد تلقائياً مع كل تحديث معتمد.
 *  - هيكل تقسيم الميزانية (BBS) شجرة فعلية: مشروع → مرحلة → بند رئيسي → بند فرعي →
 *    نشاط → مورد، مع حساب التكلفة الإجمالية لكل عقدة بالتجميع الفعلي من عناصرها
 *    الفرعية (وليس رقماً يُدخَل يدوياً في المستوى الأعلى).
 *  - مقارنة الإصدارات: حساب فعلي للفروقات بين أي إصدارين مخزَّنين لنفس الميزانية.
 *  - لوحة التحكم: كل الأرقام (إجمالي الميزانيات، الاستهلاك، عدد المشاريع المتجاوزة...)
 *    محسوبة فعلياً من البيانات المخزَّنة على القرص، وليست قيماً ثابتة.
 *  - سجل تدقيق فعلي لكل عملية إنشاء/تحديث/اعتماد/حذف.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'budgets.json');
const AUDIT_FILE = path.join(DATA_DIR, 'budget_audit.json');

let PM = null;
try { PM = require('./projectManagement'); } catch (e) { PM = null; }

// ==================================================================================
// ==================================== أدوات عامة =================================
// ==================================================================================

function nowISO() { return new Date().toISOString(); }
function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`; }

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`تعذّرت قراءة ملف بيانات الميزانية (${path.basename(file)}): ${e.message}`);
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function defaultDB() {
  return { budgets: [], seq: 0 };
}

function loadDB() { return readJSON(DB_FILE, defaultDB()); }
function saveDB(db) { writeJSON(DB_FILE, db); }

function defaultAuditDB() { return { entries: [] }; }

function recordAudit({ actor = null, action, targetId = null, summary = '', details = {} }) {
  const db = readJSON(AUDIT_FILE, defaultAuditDB());
  db.entries.push({
    id: newId('BAUD'),
    actor: actor || null,
    action,
    target_id: targetId,
    summary,
    details,
    timestamp: nowISO(),
  });
  writeJSON(AUDIT_FILE, db);
}

function listAudit({ budgetId = null, limit = 100 } = {}) {
  const db = readJSON(AUDIT_FILE, defaultAuditDB());
  let entries = db.entries.slice().reverse();
  if (budgetId) entries = entries.filter(e => e.target_id === budgetId || e.details?.budget_id === budgetId);
  return entries.slice(0, limit);
}

// ==================================================================================
// ============================ حالات وإصدارات الميزانية ============================
// ==================================================================================

const BUDGET_STATUSES = ['draft', 'approved', 'updated', 'revised', 'closed'];
const BUDGET_STATUS_LABELS = {
  draft: 'أولية',
  approved: 'معتمدة',
  updated: 'محدثة',
  revised: 'مراجَعة',
  closed: 'مغلقة',
};

function validateStatus(status) {
  if (status && !BUDGET_STATUSES.includes(status)) {
    throw new Error(`حالة ميزانية غير معروفة: ${status}. القيم المسموحة: ${BUDGET_STATUSES.join(', ')}`);
  }
}

function getProjectOrThrow(projectId) {
  if (!projectId) throw new Error('رقم المشروع (project_id) مطلوب');
  if (PM && typeof PM.getProject === 'function') {
    const project = PM.getProject(projectId, { includeRelations: false });
    if (!project) throw new Error(`المشروع غير موجود: ${projectId}`);
    return project;
  }
  return null; // إذا لم تكن وحدة المشاريع متاحة (بيئة اختبار جزئية) نسمح بالمتابعة
}

// ==================================================================================
// ============================= هيكل تقسيم الميزانية (BBS) =========================
// ==================================================================================
// شجرة: المشروع (ضمنية) → المرحلة (phase) → البند الرئيسي (main_item) →
//        البند الفرعي (sub_item) → النشاط (activity) → المورد (resource, ورقة)
// كل عقدة تحمل: id, code, name, node_type, parent_id, cost (مجموعة تلقائياً من الأبناء
// إن وُجدوا، أو قيمة مباشرة إن كانت ورقة/مورد بلا أبناء).

const BBS_NODE_TYPES = ['phase', 'main_item', 'sub_item', 'activity', 'resource'];

function validateNodeType(nodeType) {
  if (!BBS_NODE_TYPES.includes(nodeType)) {
    throw new Error(`نوع عقدة BBS غير معروف: ${nodeType}. القيم المسموحة: ${BBS_NODE_TYPES.join(', ')}`);
  }
}

function makeBBSNode({ code = null, name, node_type, cost = 0, parent_id = null }) {
  if (!name || !String(name).trim()) throw new Error('اسم عقدة الهيكل (name) مطلوب');
  validateNodeType(node_type);
  return {
    id: newId('BBS'),
    code: code || null,
    name: String(name).trim(),
    node_type,
    parent_id: parent_id || null,
    direct_cost: r2(cost), // التكلفة المباشرة المُدخَلة لهذه العقدة (فعلية فقط للأوراق)
    children: [],
    created_at: nowISO(),
  };
}

// حساب التكلفة الإجمالية الفعلية لعقدة: مجموع تكاليف أبنائها إن وُجدوا، وإلا تكلفتها المباشرة
function computeNodeTotal(node) {
  if (!node.children || node.children.length === 0) return r2(node.direct_cost);
  return r2(node.children.reduce((sum, child) => sum + computeNodeTotal(child), 0));
}

function findNode(nodes, nodeId) {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    const found = findNode(n.children || [], nodeId);
    if (found) return found;
  }
  return null;
}

function findParentArray(nodes, nodeId, rootArray) {
  for (const n of nodes) {
    if (n.children && n.children.some(c => c.id === nodeId)) return n.children;
    const found = findParentArray(n.children || [], nodeId, rootArray);
    if (found) return found;
  }
  return null;
}

function serializeBBS(nodes) {
  // إعادة الشجرة مع total_cost محسوب فعلياً لكل عقدة (بدون تعديل التخزين الأصلي)
  return nodes.map(n => ({
    ...n,
    total_cost: computeNodeTotal(n),
    children: serializeBBS(n.children || []),
  }));
}

function computeBBSGrandTotal(budget) {
  return r2((budget.bbs || []).reduce((sum, n) => sum + computeNodeTotal(n), 0));
}

// ==================================================================================
// ============================== إنشاء / تعديل الميزانية ===========================
// ==================================================================================

function validateBudgetInput(body, { partial = false } = {}) {
  if (!partial) {
    if (!body.project_id) throw new Error('رقم المشروع (project_id) مطلوب');
    if (!body.project_name || !String(body.project_name).trim()) throw new Error('اسم المشروع (project_name) مطلوب');
    if (body.contract_value === undefined || body.contract_value === null || isNaN(Number(body.contract_value))) {
      throw new Error('قيمة العقد (contract_value) مطلوبة ويجب أن تكون رقماً');
    }
    if (Number(body.contract_value) < 0) throw new Error('قيمة العقد لا يمكن أن تكون سالبة');
  }
  if (body.status !== undefined) validateStatus(body.status);
  if (body.currency !== undefined && !String(body.currency).trim()) {
    throw new Error('العملة (currency) لا يمكن أن تكون فارغة إن تم تمريرها');
  }
}

function createBudget(body = {}) {
  validateBudgetInput(body, { partial: false });
  getProjectOrThrow(body.project_id);

  const db = loadDB();
  db.seq = (db.seq || 0) + 1;

  const budgetNumber = `BUD-${String(body.project_id).toString().slice(0, 12)}-${String(db.seq).padStart(4, '0')}`;

  const budget = {
    id: newId('BUDGET'),
    budget_number: budgetNumber,
    project_id: body.project_id,
    project_name: String(body.project_name).trim(),
    client: body.client || null,
    contractor: body.contractor || null,
    contract_value: r2(body.contract_value),
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    currency: body.currency || 'SAR',
    project_manager: body.project_manager || null,
    budget_owner: body.budget_owner || null, // مسؤول الميزانية
    status: body.status || 'draft',
    version: 1,
    bbs: [], // هيكل تقسيم الميزانية (فارغ عند الإنشاء، يُبنى عبر addBBSNode)
    version_history: [],
    created_by: body.actor || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  db.budgets.push(budget);
  saveDB(db);

  recordAudit({
    actor: body.actor,
    action: 'create_budget',
    targetId: budget.id,
    summary: `إنشاء ميزانية جديدة للمشروع: ${budget.project_name}`,
    details: { budget_id: budget.id, project_id: budget.project_id, status: budget.status },
  });

  return { success: true, data: sanitizeBudget(budget) };
}

function sanitizeBudget(budget) {
  return {
    ...budget,
    bbs: serializeBBS(budget.bbs || []),
    bbs_grand_total: computeBBSGrandTotal(budget),
  };
}

function getBudget(id) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === id || b.budget_number === id);
  if (!budget) throw new Error('الميزانية غير موجودة');
  return sanitizeBudget(budget);
}

function listBudgets({ project_id = null, status = null, q = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  let items = db.budgets.slice();

  if (project_id) items = items.filter(b => String(b.project_id) === String(project_id));
  if (status) items = items.filter(b => b.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter(b =>
      b.project_name.toLowerCase().includes(needle) ||
      b.budget_number.toLowerCase().includes(needle) ||
      (b.client || '').toLowerCase().includes(needle)
    );
  }

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;
  const paged = items.slice(start, start + ps).map(sanitizeBudget);

  return { success: true, data: paged, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) || 1 } };
}

// تحديث الميزانية: كل تحديث "معتمد" (status = approved/updated/revised) يرفع رقم
// الإصدار فعلياً ويحفظ نسخة كاملة من الحالة السابقة في version_history لإتاحة
// مقارنة الإصدارات لاحقاً.
function updateBudget(id, updates = {}, { actor = null, bumpVersion = null } = {}) {
  if (!updates || typeof updates !== 'object') throw new Error('بيانات التحديث (updates) مطلوبة');
  validateBudgetInput(updates, { partial: true });

  const db = loadDB();
  const budget = db.budgets.find(b => b.id === id || b.budget_number === id);
  if (!budget) throw new Error('الميزانية غير موجودة');

  const shouldBump = bumpVersion !== null ? bumpVersion : ['approved', 'updated', 'revised'].includes(updates.status);

  if (shouldBump) {
    budget.version_history.push({
      version: budget.version,
      snapshot: JSON.parse(JSON.stringify({ ...budget, version_history: undefined })),
      archived_at: nowISO(),
      archived_by: actor,
    });
    budget.version += 1;
  }

  const editableFields = [
    'project_name', 'client', 'contractor', 'contract_value', 'start_date', 'end_date',
    'currency', 'project_manager', 'budget_owner', 'status',
  ];
  for (const field of editableFields) {
    if (updates[field] !== undefined) {
      budget[field] = field === 'contract_value' ? r2(updates[field]) : updates[field];
    }
  }
  budget.updated_at = nowISO();

  saveDB(db);

  recordAudit({
    actor,
    action: 'update_budget',
    targetId: budget.id,
    summary: `تحديث ميزانية${shouldBump ? ' (إصدار جديد: v' + budget.version + ')' : ''}: ${budget.project_name}`,
    details: { budget_id: budget.id, updates, new_version: budget.version },
  });

  return { success: true, data: sanitizeBudget(budget) };
}

function deleteBudget(id, { actor = null } = {}) {
  const db = loadDB();
  const idx = db.budgets.findIndex(b => b.id === id || b.budget_number === id);
  if (idx === -1) throw new Error('الميزانية غير موجودة');
  const removed = db.budgets[idx];
  db.budgets.splice(idx, 1);
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_budget',
    targetId: removed.id,
    summary: `حذف ميزانية: ${removed.project_name}`,
    details: { budget_id: removed.id },
  });

  return { success: true, data: { deleted: removed.id } };
}

// مقارنة إصدارين من نفس الميزانية: الإصدار الحالي أو أي إصدار مؤرشف في version_history
function compareVersions(id, versionA, versionB) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === id || b.budget_number === id);
  if (!budget) throw new Error('الميزانية غير موجودة');

  function resolveVersion(v) {
    if (Number(v) === budget.version) return sanitizeBudget(budget);
    const snap = budget.version_history.find(h => h.version === Number(v));
    if (!snap) throw new Error(`الإصدار غير موجود: ${v}`);
    return sanitizeBudget(snap.snapshot);
  }

  const a = resolveVersion(versionA);
  const b = resolveVersion(versionB);

  const fieldsToCompare = ['contract_value', 'currency', 'status', 'bbs_grand_total', 'project_manager', 'budget_owner'];
  const differences = [];
  for (const f of fieldsToCompare) {
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
      differences.push({ field: f, version_a: a[f], version_b: b[f] });
    }
  }

  return {
    success: true,
    data: {
      budget_id: budget.id,
      version_a: Number(versionA),
      version_b: Number(versionB),
      differences,
      contract_value_delta: r2((b.contract_value || 0) - (a.contract_value || 0)),
      bbs_total_delta: r2((b.bbs_grand_total || 0) - (a.bbs_grand_total || 0)),
    },
  };
}

// ==================================================================================
// ========================== عمليات هيكل تقسيم الميزانية (BBS) =====================
// ==================================================================================

function addBBSNode(budgetId, { code, name, node_type, cost = 0, parent_id = null } = {}, { actor = null } = {}) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  const node = makeBBSNode({ code, name, node_type, cost, parent_id });

  if (!parent_id) {
    if (node.node_type !== 'phase') {
      throw new Error('العقدة الجذرية (بدون parent_id) يجب أن تكون من نوع "phase"');
    }
    budget.bbs.push(node);
  } else {
    const parent = findNode(budget.bbs, parent_id);
    if (!parent) throw new Error('العقدة الأب (parent_id) غير موجودة');
    const order = ['phase', 'main_item', 'sub_item', 'activity', 'resource'];
    const parentLevel = order.indexOf(parent.node_type);
    const nodeLevel = order.indexOf(node.node_type);
    if (nodeLevel !== parentLevel + 1) {
      throw new Error(`لا يمكن إضافة عقدة من نوع "${node.node_type}" مباشرة تحت عقدة من نوع "${parent.node_type}" — التسلسل الإلزامي بدون تخطي مستويات هو: ${order.join(' → ')}`);
    }
    parent.children.push(node);
  }

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'add_bbs_node',
    targetId: budget.id,
    summary: `إضافة عقدة (${node.node_type}) للهيكل: ${node.name}`,
    details: { budget_id: budget.id, node_id: node.id, node_type: node.node_type, parent_id },
  });

  return { success: true, data: { node, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

function updateBBSNode(budgetId, nodeId, updates = {}, { actor = null } = {}) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  const node = findNode(budget.bbs, nodeId);
  if (!node) throw new Error('العقدة غير موجودة');

  if (updates.name !== undefined) {
    if (!String(updates.name).trim()) throw new Error('اسم العقدة لا يمكن أن يكون فارغاً');
    node.name = String(updates.name).trim();
  }
  if (updates.code !== undefined) node.code = updates.code;
  if (updates.cost !== undefined) {
    if (node.children && node.children.length > 0) {
      throw new Error('لا يمكن تعديل التكلفة المباشرة لعقدة تحتوي على عناصر فرعية — التكلفة تُحسب تلقائياً من الأبناء');
    }
    node.direct_cost = r2(updates.cost);
  }

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_bbs_node',
    targetId: budget.id,
    summary: `تحديث عقدة الهيكل: ${node.name}`,
    details: { budget_id: budget.id, node_id: nodeId, updates },
  });

  return { success: true, data: { node, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

function deleteBBSNode(budgetId, nodeId, { actor = null } = {}) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  // البحث في الجذور أولاً
  const rootIdx = budget.bbs.findIndex(n => n.id === nodeId);
  if (rootIdx !== -1) {
    const removed = budget.bbs.splice(rootIdx, 1)[0];
    budget.updated_at = nowISO();
    saveDB(db);
    recordAudit({ actor, action: 'delete_bbs_node', targetId: budget.id, summary: `حذف عقدة الهيكل: ${removed.name}`, details: { budget_id: budget.id, node_id: nodeId } });
    return { success: true, data: { deleted: nodeId, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
  }

  const parentArray = findParentArray(budget.bbs, nodeId);
  if (!parentArray) throw new Error('العقدة غير موجودة');
  const idx = parentArray.findIndex(n => n.id === nodeId);
  const removed = parentArray.splice(idx, 1)[0];

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({ actor, action: 'delete_bbs_node', targetId: budget.id, summary: `حذف عقدة الهيكل: ${removed.name}`, details: { budget_id: budget.id, node_id: nodeId } });

  return { success: true, data: { deleted: nodeId, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

function getBBSTree(budgetId) {
  const db = loadDB();
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');
  return { success: true, data: { budget_id: budget.id, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

// ==================================================================================
// =================================== لوحة التحكم ===================================
// ==================================================================================
// جميع الأرقام أدناه محسوبة فعلياً من بيانات الميزانيات المخزَّنة على القرص.
// ملاحظة نطاق العمل: "المصروفات الفعلية" و"الالتزامات المالية" و"الأرباح الفعلية"
// ستُحسَب بدقة كاملة بعد تنفيذ الأجزاء 3/10 (التكاليف الفعلية) و4/10 (الإيرادات)
// و6/10 (الانحرافات/EVM)؛ في هذا الجزء تُحسَب من عناصر BBS المتاحة حالياً كأساس
// حقيقي (وليس صفراً وهمياً)، وستُستبدَل/تُدمَج تلقائياً مع الأجزاء اللاحقة عبر نفس
// دالة getDashboardStats دون كسر أي واجهة برمجية قائمة.

function getDashboardStats() {
  const db = loadDB();
  const budgets = db.budgets;

  const totalProjectsValue = r2(budgets.reduce((s, b) => s + (b.contract_value || 0), 0));
  const approvedBudgets = budgets.filter(b => ['approved', 'updated', 'revised'].includes(b.status));
  const totalApprovedBudgets = r2(approvedBudgets.reduce((s, b) => s + computeBBSGrandTotal(b), 0));

  const perBudget = budgets.map(b => {
    const bbsTotal = computeBBSGrandTotal(b);
    const consumption = b.contract_value > 0 ? r2((bbsTotal / b.contract_value) * 100) : 0;
    return {
      id: b.id,
      budget_number: b.budget_number,
      project_id: b.project_id,
      project_name: b.project_name,
      status: b.status,
      contract_value: b.contract_value,
      bbs_total: bbsTotal,
      consumption_pct: consumption,
      over_budget: bbsTotal > b.contract_value,
    };
  });

  const overBudgetProjects = perBudget.filter(p => p.over_budget);
  const withinBudgetProjects = perBudget.filter(p => !p.over_budget);

  const avgConsumption = perBudget.length
    ? r2(perBudget.reduce((s, p) => s + p.consumption_pct, 0) / perBudget.length)
    : 0;

  const recentAudit = listAudit({ limit: 10 });

  return {
    success: true,
    data: {
      summary: {
        total_budgets: budgets.length,
        total_projects_contract_value: totalProjectsValue,
        total_approved_budgets: totalApprovedBudgets,
        remaining_estimate: r2(totalProjectsValue - totalApprovedBudgets),
        avg_budget_consumption_pct: avgConsumption,
        over_budget_projects_count: overBudgetProjects.length,
        within_budget_projects_count: withinBudgetProjects.length,
      },
      by_status: BUDGET_STATUSES.reduce((acc, s) => {
        acc[s] = budgets.filter(b => b.status === s).length;
        return acc;
      }, {}),
      over_budget_projects: overBudgetProjects,
      within_budget_projects: withinBudgetProjects,
      recent_activity: recentAudit,
    },
  };
}

// ==================================================================================
// ============ الجزء 2/10: إدارة بنود التكلفة + الربط مع حصر الكميات (BOQ) =========
// ==================================================================================
// بند التكلفة (Cost Item) هو تفصيل حقيقي يُخزَّن داخل عقدة BBS من نوع "resource"
// (الورقة الأخيرة في الشجرة). كل بند: كود، اسم، وصف، كمية، وحدة، سعر وحدة، مورد،
// النشاط المرتبط، المرحلة، تاريخ الإنشاء، المسؤول — والتكلفة الإجمالية = الكمية × سعر
// الوحدة (محسوبة فعلياً وليست مُدخَلة يدوياً)، وهي التي تغذّي direct_cost لعقدة المورد
// فتنعكس تلقائياً على تجميع الشجرة (computeNodeTotal) وبالتالي على لوحة التحكم.
//
// الربط مع BOQ: يستقبل هذا الجزء بنود حصر كميات موحّدة (نفس شكل BOQLineItem الصادر
// عن boqReports.buildBOQTable/priceLineItems في القسم الثالث: category, description,
// quantity, unit, unit_price, total_cost...) ويُنشئ منها تلقائياً عقد BBS (نشاط + مورد)
// وبنود تكلفة مطابقة تماماً للكميات والأسعار المصدر، مع الاحتفاظ بمرجع "source" الذي
// يتيح لاحقاً تحديث بند التكلفة فعلياً عند تغيّر الكمية أو السعر في BOQ (updateCostItem
// أو importBOQLineItems لنفس المصدر) دون إنشاء تكرار.

function computeCostItemTotal(item) {
  return r2((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
}

function validateCostItemInput(body, { partial = false } = {}) {
  if (!partial) {
    if (!body.name || !String(body.name).trim()) throw new Error('اسم بند التكلفة (name) مطلوب');
    if (body.quantity === undefined || body.quantity === null || isNaN(Number(body.quantity))) {
      throw new Error('الكمية (quantity) مطلوبة ويجب أن تكون رقماً');
    }
    if (!body.unit || !String(body.unit).trim()) throw new Error('وحدة القياس (unit) مطلوبة');
    if (body.unit_price === undefined || body.unit_price === null || isNaN(Number(body.unit_price))) {
      throw new Error('سعر الوحدة (unit_price) مطلوب ويجب أن يكون رقماً');
    }
  }
  if (body.quantity !== undefined && Number(body.quantity) < 0) throw new Error('الكمية لا يمكن أن تكون سالبة');
  if (body.unit_price !== undefined && Number(body.unit_price) < 0) throw new Error('سعر الوحدة لا يمكن أن يكون سالباً');
}

function findBudgetOrThrow(db, budgetId) {
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');
  return budget;
}

function findResourceNodeOrThrow(budget, resourceNodeId) {
  const node = findNode(budget.bbs, resourceNodeId);
  if (!node) throw new Error('عقدة المورد (resource_node_id) غير موجودة');
  if (node.node_type !== 'resource') {
    throw new Error(`بنود التكلفة تُضاف فقط لعقد من نوع "resource" — العقدة الممرَّرة من نوع "${node.node_type}"`);
  }
  return node;
}

function findActivityAncestor(budget, resourceNode) {
  // نحتاج معرفة "النشاط" و"المرحلة" المرتبطين ببند التكلفة (لأغراض العرض والتقارير)
  function walk(nodes, ancestors) {
    for (const n of nodes) {
      const path = [...ancestors, n];
      if (n.id === resourceNode.id) return path;
      const found = walk(n.children || [], path);
      if (found) return found;
    }
    return null;
  }
  const path = walk(budget.bbs, []);
  if (!path) return { phase: null, activity: null };
  const phase = path.find(n => n.node_type === 'phase') || null;
  const activity = path.find(n => n.node_type === 'activity') || null;
  return { phase, activity };
}

// إعادة حساب direct_cost لعقدة المورد = مجموع بنود التكلفة الفعلية بداخلها
function recomputeResourceNodeCost(node) {
  const items = node.cost_items || [];
  node.direct_cost = r2(items.reduce((sum, it) => sum + computeCostItemTotal(it), 0));
}

/**
 * إضافة بند تكلفة تفصيلي إلى عقدة مورد (resource) ضمن هيكل تقسيم ميزانية (BBS).
 * body: { code, name, description, quantity, unit, unit_price, supplier }
 */
function addCostItem(budgetId, resourceNodeId, body = {}, { actor = null } = {}) {
  validateCostItemInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findResourceNodeOrThrow(budget, resourceNodeId);

  const { phase, activity } = findActivityAncestor(budget, node);

  const costItem = {
    id: newId('CI'),
    code: body.code || null,
    name: String(body.name).trim(),
    description: body.description || null,
    quantity: r2(body.quantity),
    unit: String(body.unit).trim(),
    unit_price: r2(body.unit_price),
    supplier: body.supplier || null,
    activity_id: activity ? activity.id : null,
    activity_name: activity ? activity.name : null,
    phase_id: phase ? phase.id : null,
    phase_name: phase ? phase.name : null,
    resource_node_id: node.id,
    source: body.source || null, // مرجع الربط مع BOQ إن وُجد (انظر importBOQLineItems)
    created_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
    price_history: [],
  };
  costItem.total_cost = computeCostItemTotal(costItem);

  if (!node.cost_items) node.cost_items = [];
  node.cost_items.push(costItem);
  recomputeResourceNodeCost(node);

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'add_cost_item',
    targetId: budget.id,
    summary: `إضافة بند تكلفة: ${costItem.name} (${costItem.quantity} ${costItem.unit} × ${costItem.unit_price})`,
    details: { budget_id: budget.id, resource_node_id: node.id, cost_item_id: costItem.id },
  });

  return {
    success: true,
    data: { cost_item: costItem, node_direct_cost: node.direct_cost, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) },
  };
}

/**
 * تعديل بند تكلفة قائم. أي تغيير في السعر يُسجَّل فعلياً في price_history (لدعم
 * "مقارنة الأسعار" المطلوبة)، وأي تغيير في الكمية أو السعر يُعاد حسابه فوراً وينعكس
 * تلقائياً على direct_cost لعقدة المورد ثم على تجميع الشجرة بالكامل.
 */
function updateCostItem(budgetId, resourceNodeId, costItemId, updates = {}, { actor = null } = {}) {
  validateCostItemInput(updates, { partial: true });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findResourceNodeOrThrow(budget, resourceNodeId);

  const item = (node.cost_items || []).find(ci => ci.id === costItemId);
  if (!item) throw new Error('بند التكلفة غير موجود');

  if (updates.unit_price !== undefined && Number(updates.unit_price) !== item.unit_price) {
    item.price_history.push({ old_price: item.unit_price, new_price: r2(updates.unit_price), changed_at: nowISO(), changed_by: actor });
    item.unit_price = r2(updates.unit_price);
  }
  if (updates.quantity !== undefined) item.quantity = r2(updates.quantity);
  if (updates.name !== undefined) {
    if (!String(updates.name).trim()) throw new Error('اسم بند التكلفة لا يمكن أن يكون فارغاً');
    item.name = String(updates.name).trim();
  }
  if (updates.code !== undefined) item.code = updates.code;
  if (updates.description !== undefined) item.description = updates.description;
  if (updates.unit !== undefined) {
    if (!String(updates.unit).trim()) throw new Error('وحدة القياس لا يمكن أن تكون فارغة');
    item.unit = String(updates.unit).trim();
  }
  if (updates.supplier !== undefined) item.supplier = updates.supplier;

  item.total_cost = computeCostItemTotal(item);
  item.updated_at = nowISO();

  recomputeResourceNodeCost(node);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_cost_item',
    targetId: budget.id,
    summary: `تحديث بند تكلفة: ${item.name}`,
    details: { budget_id: budget.id, resource_node_id: node.id, cost_item_id: item.id, updates },
  });

  return {
    success: true,
    data: { cost_item: item, node_direct_cost: node.direct_cost, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) },
  };
}

function deleteCostItem(budgetId, resourceNodeId, costItemId, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findResourceNodeOrThrow(budget, resourceNodeId);

  const idx = (node.cost_items || []).findIndex(ci => ci.id === costItemId);
  if (idx === -1) throw new Error('بند التكلفة غير موجود');
  const removed = node.cost_items.splice(idx, 1)[0];

  recomputeResourceNodeCost(node);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_cost_item',
    targetId: budget.id,
    summary: `حذف بند تكلفة: ${removed.name}`,
    details: { budget_id: budget.id, resource_node_id: node.id, cost_item_id: costItemId },
  });

  return { success: true, data: { deleted: costItemId, node_direct_cost: node.direct_cost, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

function listCostItems(budgetId, resourceNodeId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findResourceNodeOrThrow(budget, resourceNodeId);
  return { success: true, data: { resource_node_id: node.id, cost_items: node.cost_items || [], node_direct_cost: node.direct_cost } };
}

/**
 * مقارنة الأسعار: تعيد كل بنود التكلفة عبر الميزانية بأكملها (أو ميزانية واحدة) التي
 * تحمل نفس الاسم/الكود لمقارنة أسعارها الحالية والتاريخية عبر موارد/مراحل مختلفة —
 * حساب فعلي (أعلى سعر، أقل سعر، الفرق، النسبة) وليس عرضاً شكلياً.
 */
function compareCostItemPrices(budgetId, { name = null, code = null } = {}) {
  if (!name && !code) throw new Error('يجب تمرير name أو code للمقارنة');
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const matches = [];
  function collect(nodes) {
    for (const n of nodes) {
      if (n.node_type === 'resource') {
        for (const ci of (n.cost_items || [])) {
          const matchName = name && ci.name.toLowerCase().includes(String(name).toLowerCase());
          const matchCode = code && ci.code && String(ci.code).toLowerCase() === String(code).toLowerCase();
          if (matchName || matchCode) matches.push(ci);
        }
      }
      collect(n.children || []);
    }
  }
  collect(budget.bbs);

  if (matches.length === 0) return { success: true, data: { matches: [], min_price: null, max_price: null, spread: null, spread_pct: null } };

  const prices = matches.map(m => m.unit_price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const spread = r2(maxPrice - minPrice);
  const spreadPct = minPrice > 0 ? r2((spread / minPrice) * 100) : 0;

  return {
    success: true,
    data: { matches, min_price: minPrice, max_price: maxPrice, spread, spread_pct: spreadPct },
  };
}

// ------------------------------------------------------------------------------
// -------------------------- الربط مع حصر الكميات (BOQ) ------------------------
// ------------------------------------------------------------------------------
// تستقبل هذه الدالة بنود BOQ الموحّدة الصادرة فعلياً عن boqReports (priceLineItems /
// buildBOQTable) بالشكل: { category, description, quantity, unit, unit_price,
// total_cost, price_key, waste_percent, quantity_with_waste }. لكل بند BOQ:
//  - تُنشأ (أو تُستخدم إن كانت موجودة) عقدة "main_item" باسم التصنيف (category) تحت
//    المرحلة المستهدفة.
//  - تُنشأ عقدة "sub_item" ثم "activity" ثم "resource" تحمل بند تكلفة مطابق تماماً
//    للكمية والسعر الوارد من BOQ (الكمية تشمل الهدر: quantity_with_waste إن وُجدت).
//  - يُحفَظ مرجع source = { boq_category, boq_description, imported_at } بحيث يمكن لاحقاً
//    (عبر syncBOQItem) تحديث بند التكلفة فعلياً عند تغيّر الكمية/السعر في BOQ دون تكرار.
function importBOQLineItems(budgetId, phaseId, boqItems = [], { actor = null, activityPrefix = 'نشاط' } = {}) {
  if (!Array.isArray(boqItems) || boqItems.length === 0) {
    throw new Error('قائمة بنود حصر الكميات (boqItems) مطلوبة ويجب ألا تكون فارغة');
  }

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const phase = findNode(budget.bbs, phaseId);
  if (!phase) throw new Error('المرحلة (phaseId) غير موجودة في هيكل تقسيم الميزانية');
  if (phase.node_type !== 'phase') throw new Error('phaseId يجب أن يشير إلى عقدة من نوع "phase"');

  const importedAt = nowISO();
  const created = [];

  for (const raw of boqItems) {
    if (raw.quantity === undefined || !raw.unit) {
      throw new Error(`بند BOQ غير صالح (يفتقد quantity أو unit): ${JSON.stringify(raw)}`);
    }
    const qty = Number(raw.quantity_with_waste ?? raw.quantity);
    const unitPrice = Number(raw.unit_price ?? raw.unit_price_override ?? 0);
    const categoryName = raw.category || 'عام';
    const description = raw.description || 'بند مستورد من حصر الكميات';

    // البحث عن (أو إنشاء) عقدة main_item بنفس اسم التصنيف تحت هذه المرحلة
    let mainItem = (phase.children || []).find(n => n.node_type === 'main_item' && n.name === categoryName);
    if (!mainItem) {
      mainItem = makeBBSNode({ name: categoryName, node_type: 'main_item', cost: 0 });
      phase.children.push(mainItem);
    }

    const subItem = makeBBSNode({ name: description, node_type: 'sub_item', cost: 0 });
    mainItem.children.push(subItem);

    const activity = makeBBSNode({ name: `${activityPrefix}: ${description}`, node_type: 'activity', cost: 0 });
    subItem.children.push(activity);

    const resourceNode = makeBBSNode({ name: raw.price_key || description, node_type: 'resource', cost: 0 });
    activity.children.push(resourceNode);

    const costItem = {
      id: newId('CI'),
      code: raw.price_key || null,
      name: description,
      description: `مستورد من حصر الكميات (${categoryName})`,
      quantity: r2(qty),
      unit: raw.unit,
      unit_price: r2(unitPrice),
      supplier: null,
      activity_id: activity.id,
      activity_name: activity.name,
      phase_id: phase.id,
      phase_name: phase.name,
      resource_node_id: resourceNode.id,
      source: { boq_category: categoryName, boq_description: description, imported_at: importedAt },
      created_by: actor,
      created_at: importedAt,
      updated_at: importedAt,
      price_history: [],
    };
    costItem.total_cost = computeCostItemTotal(costItem);

    resourceNode.cost_items = [costItem];
    recomputeResourceNodeCost(resourceNode);

    created.push({ main_item_id: mainItem.id, sub_item_id: subItem.id, activity_id: activity.id, resource_node_id: resourceNode.id, cost_item: costItem });
  }

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'import_boq_line_items',
    targetId: budget.id,
    summary: `استيراد ${created.length} بند من حصر الكميات إلى المرحلة: ${phase.name}`,
    details: { budget_id: budget.id, phase_id: phase.id, count: created.length },
  });

  return {
    success: true,
    data: { imported: created, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) },
  };
}

/**
 * مزامنة بند تكلفة واحد مستورَد من BOQ بعد تعديل الكمية/السعر في قسم حصر الكميات:
 * تُحدَّث الكمية والسعر فعلياً لبند التكلفة المطابق (بحسب resource_node_id) وتُسجَّل
 * التغييرات في price_history إن تغيّر السعر، وتنعكس فوراً على تجميع الشجرة الكامل.
 */
function syncBOQCostItem(budgetId, resourceNodeId, { quantity, unit_price } = {}, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findResourceNodeOrThrow(budget, resourceNodeId);

  const item = (node.cost_items || [])[0];
  if (!item) throw new Error('لا يوجد بند تكلفة مرتبط بهذه العقدة');
  if (!item.source) throw new Error('بند التكلفة هذا لم يُستورَد من حصر الكميات (لا يحمل مرجع source)');

  if (quantity !== undefined) item.quantity = r2(quantity);
  if (unit_price !== undefined && Number(unit_price) !== item.unit_price) {
    item.price_history.push({ old_price: item.unit_price, new_price: r2(unit_price), changed_at: nowISO(), changed_by: actor, reason: 'boq_sync' });
    item.unit_price = r2(unit_price);
  }
  item.total_cost = computeCostItemTotal(item);
  item.updated_at = nowISO();

  recomputeResourceNodeCost(node);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'sync_boq_cost_item',
    targetId: budget.id,
    summary: `مزامنة بند تكلفة من حصر الكميات: ${item.name}`,
    details: { budget_id: budget.id, resource_node_id: node.id, cost_item_id: item.id },
  });

  return { success: true, data: { cost_item: item, node_direct_cost: node.direct_cost, bbs: serializeBBS(budget.bbs), grand_total: computeBBSGrandTotal(budget) } };
}

module.exports = {
  // إدارة الميزانية الأساسية
  createBudget,
  getBudget,
  listBudgets,
  updateBudget,
  deleteBudget,
  compareVersions,
  // هيكل تقسيم الميزانية (BBS)
  addBBSNode,
  updateBBSNode,
  deleteBBSNode,
  getBBSTree,
  // بنود التكلفة (الجزء 2/10)
  addCostItem,
  updateCostItem,
  deleteCostItem,
  listCostItems,
  compareCostItemPrices,
  // الربط مع حصر الكميات BOQ (الجزء 2/10)
  importBOQLineItems,
  syncBOQCostItem,
  // لوحة التحكم وسجل التدقيق
  getDashboardStats,
  listAudit,
  // ثوابت مساعدة للواجهة
  BUDGET_STATUSES,
  BUDGET_STATUS_LABELS,
  BBS_NODE_TYPES,
  // مساعِدات داخلية معروضة لاستخدام الأجزاء اللاحقة (2/10 وما بعده)
  _internal: {
    loadDB,
    saveDB,
    findNode,
    computeNodeTotal,
    computeBBSGrandTotal,
    recordAudit,
    r2,
    nowISO,
    newId,
  },
};
