/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * ===================================================================
 * الجزء الأول (1/10): البنية الأساسية + طبقة التخزين الموحّدة + إنشاء/تعديل
 *                      ميزانية المشروع + هيكل تقسيم الميزانية (BBS) + لوحة
 *                      تحكم مالية أساسية + سجل تدقيق + الربط بالمشاريع.
 *
 * خطة التقسيم الكاملة (راجع BUDGET_PLAN.md):
 *  1/10: الأساس + التخزين + إنشاء الميزانية + BBS + لوحة تحكم أساسية (هذا الملف)
 *  2/10: إدارة بنود التكلفة + الربط مع حصر الكميات (BOQ)
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
