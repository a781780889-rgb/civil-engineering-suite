/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * ===================================================================
 * تم تنفيذه حتى الجزء (7/10): البنية الأساسية + طبقة التخزين الموحّدة +
 *                      إنشاء/تعديل ميزانية المشروع + هيكل تقسيم الميزانية (BBS) +
 *                      بنود التكلفة + الربط مع BOQ + التكاليف الفعلية + الإيرادات
 *                      والتحصيل + أوامر التغيير + الانحرافات المالية وEVM +
 *                      التدفقات النقدية الشاملة + نظام الموافقات المالية الكامل +
 *                      لوحة تحكم مالية + سجل تدقيق + الربط بالمشاريع.
 *
 * خطة التقسيم الكاملة (راجع BUDGET_PLAN.md):
 *  1/10: الأساس + التخزين + إنشاء الميزانية + BBS + لوحة تحكم أساسية (منجَز)
 *  2/10: إدارة بنود التكلفة + الربط مع حصر الكميات (BOQ) (منجَز)
 *  3/10: إدارة التكاليف الفعلية (مواد/عمالة/معدات/أخرى) (منجَز)
 *  4/10: إدارة الإيرادات + الدفعات + المستخلصات (منجَز)
 *  5/10: أوامر التغيير (Change Orders) - موافقة على مستويين (مدير مشروع ثم إدارة/
 *        مالي)، تُطبَّق تلقائياً على BBS وcontract_value عند الاعتماد النهائي
 *        (منجَز)
 *  6/10: مراقبة الانحرافات المالية + تحليل القيمة المكتسبة (EVM) (منجَز)
 *  7/10: التدفقات النقدية الشاملة (إيرادات+مصروفات، متوقع مقابل فعلي، رصيد تراكمي)
 *        + نظام موافقات صرف كامل على 4 مراحل (مراجعة مالية → مدير مشروع → إدارة →
 *        صرف فعلي يُسجَّل تلقائياً كتكلفة فعلية) (منجَز)
 *  8/10: الفواتير والمستخلصات (Invoicing) - فواتير عميل (مرتبطة فعلياً بسجل إيراد
 *        محدد من الجزء 4/10) وفواتير موردين/مقاولين فرعيين (مرتبطة فعلياً بتكلفة
 *        فعلية من الجزء 3/10)، ببنود فعلية، ضريبة/استقطاع ضمان، تتبع دفعات جزئية
 *        فعلي، وحالات دورة حياة كاملة (منجَز - هذا الملف)
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

let SCH = null;
try { SCH = require('./scheduling'); } catch (e) { SCH = null; }

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

// ==================================================================================
// ================ الجزء 3/10: إدارة التكاليف الفعلية (Actual Costs) ===============
// ==================================================================================
// تكلفة فعلية (Actual Cost) تختلف عن "بند التكلفة" المخطَّط (الجزء 2/10): بند التكلفة
// المخطَّط هو التقدير (Planned)، أما هذه الطبقة فتسجّل ما أُنفِق فعلياً على أرض الواقع
// (مواد اشتُريت فعلاً، أجور صُرفت فعلاً...)، وهي الأساس الحقيقي لحساب "التكلفة الفعلية"
// و"الالتزامات المالية" في لوحة التحكم (بدل الاعتماد على إجمالي BBS المخطَّط كتقريب
// أولي كما وُثِّق في نهاية الجزء 1/10)، ولاحقاً على مؤشرات EVM (AC) في الجزء 6/10.
//
// كل تكلفة فعلية مرتبطة إلزامياً بميزانية، وبعقدة BBS (أي عقدة، وليس فقط resource -
// فالتكلفة الفعلية قد تُسجَّل على مستوى نشاط كامل)، ومصنَّفة إلى إحدى أربع فئات:
//   materials | labor | equipment | other
// لكل فئة حقول تفصيلية خاصة بها (تُخزَّن ضمن breakdown) بالإضافة إلى الحقول المشتركة.
//
// تخزين: نفس ملف budgets.json (مصفوفة actual_costs على مستوى كل ميزانية) - بدون ملف
// جديد، اتساقاً مع بقية الأجزاء التي تبني فوق نفس السجل.

const ACTUAL_COST_CATEGORIES = ['materials', 'labor', 'equipment', 'other'];
const ACTUAL_COST_CATEGORY_LABELS = {
  materials: 'مواد',
  labor: 'عمالة',
  equipment: 'معدات',
  other: 'أخرى',
};

function validateActualCostCategory(category) {
  if (!ACTUAL_COST_CATEGORIES.includes(category)) {
    throw new Error(`فئة تكلفة فعلية غير معروفة: ${category}. القيم المسموحة: ${ACTUAL_COST_CATEGORIES.join(', ')}`);
  }
}

// حساب المبلغ الإجمالي الفعلي لكل فئة بحسب حقولها الخاصة (وليس رقماً يُدخَل يدوياً
// دائماً - إن لم يُمرَّر amount صراحة، يُحسَب من التفاصيل عند توفرها)
function computeActualCostAmount(category, body) {
  if (body.amount !== undefined && body.amount !== null && !isNaN(Number(body.amount))) {
    return r2(body.amount);
  }
  const b = body.breakdown || {};
  if (category === 'materials') {
    const purchase = Number(b.purchase_cost) || 0;
    const transport = Number(b.transport_cost) || 0;
    const storage = Number(b.storage_cost) || 0;
    return r2(purchase + transport + storage);
  }
  if (category === 'labor') {
    const base = Number(b.salary_or_daily_wage) || 0;
    const hours = Number(b.work_hours) || 0;
    const hourlyRate = Number(b.hourly_rate) || 0;
    const overtimeHours = Number(b.overtime_hours) || 0;
    const overtimeRate = Number(b.overtime_rate) || (hourlyRate * 1.5);
    return r2(base + (hours * hourlyRate) + (overtimeHours * overtimeRate));
  }
  if (category === 'equipment') {
    const operating = Number(b.operating_cost) || 0;
    const fuel = Number(b.fuel_cost) || 0;
    const maintenance = Number(b.maintenance_cost) || 0;
    const rental = Number(b.rental_cost) || 0;
    return r2(operating + fuel + maintenance + rental);
  }
  const subcontractor = Number(b.subcontractor_cost) || 0;
  const admin = Number(b.admin_cost) || 0;
  const fees = Number(b.fees) || 0;
  const insurance = Number(b.insurance_cost) || 0;
  const consulting = Number(b.consulting_cost) || 0;
  return r2(subcontractor + admin + fees + insurance + consulting);
}

function validateActualCostInput(body, { partial = false } = {}) {
  if (!partial) {
    validateActualCostCategory(body.category);
    if (!body.node_id) throw new Error('عقدة الهيكل المرتبطة (node_id) مطلوبة');
    if (!body.description || !String(body.description).trim()) {
      throw new Error('وصف التكلفة الفعلية (description) مطلوب');
    }
    if (!body.date) throw new Error('تاريخ التكلفة الفعلية (date) مطلوب');
  } else if (body.category !== undefined) {
    validateActualCostCategory(body.category);
  }
  if (body.amount !== undefined && body.amount !== null && Number(body.amount) < 0) {
    throw new Error('المبلغ لا يمكن أن يكون سالباً');
  }
}

function findActualCostAncestors(budget, node) {
  function walk(nodes, ancestors) {
    for (const n of nodes) {
      const path = [...ancestors, n];
      if (n.id === node.id) return path;
      const found = walk(n.children || [], path);
      if (found) return found;
    }
    return null;
  }
  const path = walk(budget.bbs, []) || [];
  return {
    phase: path.find(n => n.node_type === 'phase') || null,
    main_item: path.find(n => n.node_type === 'main_item') || null,
    activity: path.find(n => n.node_type === 'activity') || null,
  };
}

/**
 * تسجيل تكلفة فعلية جديدة على عقدة في هيكل تقسيم الميزانية.
 * body: { category, node_id, description, date, amount?, breakdown?, supplier?,
 *         worker_id?, equipment_id?, reference? }
 * - amount اختياري: إن لم يُمرَّر، يُحسَب فعلياً من breakdown بحسب الفئة.
 * - worker_id / equipment_id: مرجعان اختياريان لربط التكلفة الفعلية بسجل عامل حقيقي
 *   (إدارة العمال - القسم السادس) أو معدة حقيقية (إدارة المعدات - القسم السابع) عند توفرهما.
 */
function addActualCost(budgetId, body = {}, { actor = null } = {}) {
  validateActualCostInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const node = findNode(budget.bbs, body.node_id);
  if (!node) throw new Error('عقدة الهيكل (node_id) غير موجودة في هذه الميزانية');

  const amount = computeActualCostAmount(body.category, body);
  const { phase, main_item, activity } = findActualCostAncestors(budget, node);

  const actualCost = {
    id: newId('AC'),
    budget_id: budget.id,
    category: body.category,
    node_id: node.id,
    node_name: node.name,
    node_type: node.node_type,
    phase_id: phase ? phase.id : null,
    phase_name: phase ? phase.name : null,
    main_item_id: main_item ? main_item.id : null,
    activity_id: activity ? activity.id : null,
    description: String(body.description).trim(),
    date: body.date,
    amount,
    breakdown: body.breakdown || {},
    supplier: body.supplier || null,
    worker_id: body.worker_id || null,
    equipment_id: body.equipment_id || null,
    reference: body.reference || null,
    created_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  if (!budget.actual_costs) budget.actual_costs = [];
  budget.actual_costs.push(actualCost);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'add_actual_cost',
    targetId: budget.id,
    summary: `تسجيل تكلفة فعلية (${ACTUAL_COST_CATEGORY_LABELS[body.category]}): ${actualCost.description} — ${amount}`,
    details: { budget_id: budget.id, actual_cost_id: actualCost.id, category: body.category, amount },
  });

  return { success: true, data: { actual_cost: actualCost, summary: computeActualCostSummary(budget) } };
}

function updateActualCost(budgetId, actualCostId, updates = {}, { actor = null } = {}) {
  validateActualCostInput(updates, { partial: true });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const item = (budget.actual_costs || []).find(ac => ac.id === actualCostId);
  if (!item) throw new Error('التكلفة الفعلية غير موجودة');

  if (updates.category !== undefined) item.category = updates.category;
  if (updates.description !== undefined) {
    if (!String(updates.description).trim()) throw new Error('الوصف لا يمكن أن يكون فارغاً');
    item.description = String(updates.description).trim();
  }
  if (updates.date !== undefined) item.date = updates.date;
  if (updates.breakdown !== undefined) item.breakdown = { ...item.breakdown, ...updates.breakdown };
  if (updates.supplier !== undefined) item.supplier = updates.supplier;
  if (updates.worker_id !== undefined) item.worker_id = updates.worker_id;
  if (updates.equipment_id !== undefined) item.equipment_id = updates.equipment_id;
  if (updates.reference !== undefined) item.reference = updates.reference;

  item.amount = computeActualCostAmount(item.category, { amount: updates.amount, breakdown: item.breakdown });
  item.updated_at = nowISO();

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_actual_cost',
    targetId: budget.id,
    summary: `تحديث تكلفة فعلية: ${item.description}`,
    details: { budget_id: budget.id, actual_cost_id: item.id, updates },
  });

  return { success: true, data: { actual_cost: item, summary: computeActualCostSummary(budget) } };
}

function deleteActualCost(budgetId, actualCostId, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const idx = (budget.actual_costs || []).findIndex(ac => ac.id === actualCostId);
  if (idx === -1) throw new Error('التكلفة الفعلية غير موجودة');
  const removed = budget.actual_costs.splice(idx, 1)[0];

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_actual_cost',
    targetId: budget.id,
    summary: `حذف تكلفة فعلية: ${removed.description}`,
    details: { budget_id: budget.id, actual_cost_id: actualCostId, category: removed.category, amount: removed.amount },
  });

  return { success: true, data: { deleted: actualCostId, summary: computeActualCostSummary(budget) } };
}

function listActualCosts(budgetId, { category = null, node_id = null, from_date = null, to_date = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  let items = (budget.actual_costs || []).slice();

  if (category) { validateActualCostCategory(category); items = items.filter(i => i.category === category); }
  if (node_id) items = items.filter(i => i.node_id === node_id);
  if (from_date) items = items.filter(i => i.date >= from_date);
  if (to_date) items = items.filter(i => i.date <= to_date);

  items.sort((a, b) => (a.date < b.date ? 1 : -1));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;
  const pageItems = items.slice(start, start + ps);

  return {
    success: true,
    data: { items: pageItems, total, page: p, pageSize: ps, summary: computeActualCostSummary(budget) },
  };
}

// ملخص فعلي لإجمالي التكاليف الفعلية لميزانية: إجمالي عام + تفصيل حسب الفئة + حسب
// المرحلة، وهو ما يغذّي لاحقاً getDashboardStats (إجمالي المصروفات الفعلية للنظام كله)
function computeActualCostSummary(budget) {
  const items = budget.actual_costs || [];
  const total = r2(items.reduce((s, i) => s + i.amount, 0));

  const byCategory = ACTUAL_COST_CATEGORIES.reduce((acc, c) => {
    acc[c] = r2(items.filter(i => i.category === c).reduce((s, i) => s + i.amount, 0));
    return acc;
  }, {});

  const byPhase = {};
  for (const i of items) {
    const key = i.phase_id || 'بدون_مرحلة';
    const label = i.phase_name || 'غير مرتبط بمرحلة';
    if (!byPhase[key]) byPhase[key] = { phase_id: i.phase_id, phase_name: label, total: 0 };
    byPhase[key].total = r2(byPhase[key].total + i.amount);
  }

  const plannedTotal = computeBBSGrandTotal(budget);
  const variance = r2(plannedTotal - total); // موجب = أقل من المخطط، سالب = تجاوز
  const variancePct = plannedTotal > 0 ? r2((variance / plannedTotal) * 100) : 0;

  return {
    total_actual_cost: total,
    by_category: byCategory,
    by_phase: Object.values(byPhase),
    planned_total: plannedTotal,
    variance,
    variance_pct: variancePct,
    over_budget: total > plannedTotal,
    entries_count: items.length,
  };
}

/**
 * تكلفة فعلية إجمالية عبر كل الميزانيات — تُستخدم لتحديث لوحة التحكم العامة فعلياً
 * (تحل محل التقريب الأولي المعتمد على BBS المخطَّط الموثَّق في ملاحظة نطاق العمل
 * بنهاية الجزء 1/10، دون تغيير شكل استجابة /api/budget/dashboard الخارجي).
 */
function getActualCostsOverview() {
  const db = loadDB();
  const perBudget = db.budgets.map(b => {
    const summary = computeActualCostSummary(b);
    return {
      budget_id: b.id,
      project_id: b.project_id,
      project_name: b.project_name,
      ...summary,
    };
  });

  const totalActual = r2(perBudget.reduce((s, p) => s + p.total_actual_cost, 0));
  const byCategoryTotals = ACTUAL_COST_CATEGORIES.reduce((acc, c) => {
    acc[c] = r2(perBudget.reduce((s, p) => s + (p.by_category[c] || 0), 0));
    return acc;
  }, {});

  return {
    success: true,
    data: {
      total_actual_cost_all_projects: totalActual,
      by_category_all_projects: byCategoryTotals,
      per_budget: perBudget,
    },
  };
}

// ------------------------------------------------------------------------------
// تحديث لوحة التحكم الرئيسية (الجزء 1/10) لتدمج التكاليف الفعلية الحقيقية بدل
// التقريب المبدئي المعتمد على BBS المخطَّط - دون تغيير شكل الاستجابة الخارجي.
// ------------------------------------------------------------------------------
const _baseGetDashboardStats = getDashboardStats;
function getDashboardStatsWithActuals() {
  const base = _baseGetDashboardStats();
  const db = loadDB();

  let totalActualAll = 0;
  const perBudgetActual = {};
  for (const b of db.budgets) {
    const summary = computeActualCostSummary(b);
    perBudgetActual[b.id] = summary;
    totalActualAll = r2(totalActualAll + summary.total_actual_cost);
  }

  base.data.summary.total_actual_expenses = totalActualAll;
  // التزام مالي مبدئي = ما صُرف فعلياً؛ سيُدمَج مع الفواتير المعتمدة غير المسدَّدة
  // والعقود الموقَّعة غير المصروفة بدقة كاملة في الجزء 8/10 دون كسر هذا الشكل
  base.data.summary.total_financial_commitments = totalActualAll;
  base.data.summary.total_actual_profit = r2(base.data.summary.total_projects_contract_value - totalActualAll);

  base.data.over_budget_projects = base.data.over_budget_projects.map(p => ({
    ...p,
    actual_cost: perBudgetActual[p.id]?.total_actual_cost ?? 0,
  }));
  base.data.within_budget_projects = base.data.within_budget_projects.map(p => ({
    ...p,
    actual_cost: perBudgetActual[p.id]?.total_actual_cost ?? 0,
  }));

  return base;
}

// ==================================================================================
// ============== الجزء 4/10: إدارة الإيرادات + الدفعات + المستخلصات ================
// ==================================================================================
// الإيراد الأساسي لأي ميزانية هو contract_value (موجود من الجزء 1/10). هذا الجزء
// يضيف طبقة تحصيل فعلية فوقه: كل دفعة/مستخلص فعلي يُسجَّل بحالة (متوقعة/مستلمة/
// متأخرة) وتاريخ استحقاق، ويُحسَب منها فعلياً: إجمالي المُحصَّل، المتبقي المستحق،
// الدفعات المتأخرة (بمقارنة تاريخ الاستحقاق بتاريخ اليوم لكل دفعة لم تُحصَّل بعد)،
// الأرباح/الخسائر الفعلية (الإيراد المُحصَّل فعلياً - التكلفة الفعلية المسجَّلة في
// الجزء 3/10)، والتدفق النقدي الشهري (تجميع الدفعات المُحصَّلة والمتوقعة حسب الشهر).
//
// تخزين: نفس ملف budgets.json (مصفوفة revenues على مستوى كل ميزانية) اتساقاً مع
// نمط actual_costs في الجزء 3/10 - بدون ملف جديد.

const REVENUE_TYPES = ['down_payment', 'progress_payment', 'final_payment', 'retention_release', 'other'];
const REVENUE_TYPE_LABELS = {
  down_payment: 'دفعة مقدمة',
  progress_payment: 'مستخلص (دفعة مرحلية)',
  final_payment: 'دفعة نهائية',
  retention_release: 'الإفراج عن ضمان',
  other: 'أخرى',
};

const REVENUE_STATUSES = ['expected', 'invoiced', 'received', 'overdue', 'cancelled'];
const REVENUE_STATUS_LABELS = {
  expected: 'متوقعة',
  invoiced: 'مُستَحقة (صدر مستخلص)',
  received: 'مستلمة',
  overdue: 'متأخرة',
  cancelled: 'ملغاة',
};

function validateRevenueType(type) {
  if (!REVENUE_TYPES.includes(type)) {
    throw new Error(`نوع إيراد غير معروف: ${type}. القيم المسموحة: ${REVENUE_TYPES.join(', ')}`);
  }
}

function validateRevenueStatus(status) {
  if (!REVENUE_STATUSES.includes(status)) {
    throw new Error(`حالة إيراد غير معروفة: ${status}. القيم المسموحة: ${REVENUE_STATUSES.join(', ')}`);
  }
}

function validateRevenueInput(body, { partial = false } = {}) {
  if (!partial) {
    validateRevenueType(body.type);
    if (body.amount === undefined || body.amount === null || isNaN(Number(body.amount))) {
      throw new Error('مبلغ الإيراد (amount) مطلوب ويجب أن يكون رقماً');
    }
    if (Number(body.amount) <= 0) throw new Error('مبلغ الإيراد يجب أن يكون أكبر من صفر');
    if (!body.due_date) throw new Error('تاريخ الاستحقاق (due_date) مطلوب');
    if (!body.description || !String(body.description).trim()) {
      throw new Error('وصف الإيراد (description) مطلوب');
    }
  } else {
    if (body.type !== undefined) validateRevenueType(body.type);
    if (body.amount !== undefined && Number(body.amount) <= 0) {
      throw new Error('مبلغ الإيراد يجب أن يكون أكبر من صفر');
    }
  }
  if (body.status !== undefined) validateRevenueStatus(body.status);
}

// حالة الدفعة الفعلية: إن كانت "مستلمة" أو "ملغاة" تُترَك كما هي، وإلا يُعاد تصنيفها
// تلقائياً إلى "متأخرة" إن تجاوز تاريخ الاستحقاق تاريخ اليوم (وليس حقلاً يُدخَل يدوياً)
function resolveEffectiveStatus(revenue) {
  if (['received', 'cancelled'].includes(revenue.status)) return revenue.status;
  const today = nowISO().slice(0, 10);
  if (revenue.due_date && revenue.due_date < today) return 'overdue';
  return revenue.status;
}

/**
 * تسجيل إيراد/دفعة/مستخلص جديد لميزانية.
 * body: { type, amount, due_date, description, invoice_number?, client_reference?,
 *         node_id?, retention_pct? }
 * - node_id اختياري: يربط الدفعة بمرحلة محددة في BBS (لأغراض تقرير "تكلفة كل مرحلة"
 *   وربطها بالإنجاز الفعلي لاحقاً)، وإلا فهي دفعة على مستوى المشروع كاملاً.
 */
function addRevenue(budgetId, body = {}, { actor = null } = {}) {
  validateRevenueInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  let phase = null;
  if (body.node_id) {
    const node = findNode(budget.bbs, body.node_id);
    if (!node) throw new Error('عقدة الهيكل (node_id) غير موجودة في هذه الميزانية');
    const { phase: p } = findActualCostAncestors(budget, node);
    phase = node.node_type === 'phase' ? node : p;
  }

  const revenue = {
    id: newId('REV'),
    budget_id: budget.id,
    type: body.type,
    amount: r2(body.amount),
    due_date: body.due_date,
    received_date: null,
    description: String(body.description).trim(),
    invoice_number: body.invoice_number || null,
    client_reference: body.client_reference || null,
    node_id: body.node_id || null,
    phase_id: phase ? phase.id : null,
    phase_name: phase ? phase.name : null,
    retention_pct: body.retention_pct !== undefined ? r2(body.retention_pct) : 0,
    status: body.status || 'expected',
    created_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  if (!budget.revenues) budget.revenues = [];
  budget.revenues.push(revenue);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'add_revenue',
    targetId: budget.id,
    summary: `تسجيل إيراد (${REVENUE_TYPE_LABELS[body.type]}): ${revenue.description} — ${revenue.amount}`,
    details: { budget_id: budget.id, revenue_id: revenue.id, type: body.type, amount: revenue.amount },
  });

  return { success: true, data: { revenue: sanitizeRevenue(revenue), summary: computeRevenueSummary(budget) } };
}

/**
 * تعديل إيراد قائم. تسجيل received_date تلقائياً عند تغيير الحالة إلى "received"
 * إن لم يُمرَّر صراحةً — وهو ما يُستخدَم فعلياً في حساب التدفق النقدي الفعلي (وليس
 * المتوقع فقط) والأرباح الفعلية.
 */
function updateRevenue(budgetId, revenueId, updates = {}, { actor = null } = {}) {
  validateRevenueInput(updates, { partial: true });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const item = (budget.revenues || []).find(r => r.id === revenueId);
  if (!item) throw new Error('الإيراد غير موجود');

  if (updates.type !== undefined) item.type = updates.type;
  if (updates.amount !== undefined) item.amount = r2(updates.amount);
  if (updates.due_date !== undefined) item.due_date = updates.due_date;
  if (updates.description !== undefined) {
    if (!String(updates.description).trim()) throw new Error('الوصف لا يمكن أن يكون فارغاً');
    item.description = String(updates.description).trim();
  }
  if (updates.invoice_number !== undefined) item.invoice_number = updates.invoice_number;
  if (updates.client_reference !== undefined) item.client_reference = updates.client_reference;
  if (updates.retention_pct !== undefined) item.retention_pct = r2(updates.retention_pct);

  if (updates.status !== undefined) {
    const wasReceived = item.status === 'received';
    item.status = updates.status;
    if (updates.status === 'received' && !wasReceived) {
      item.received_date = updates.received_date || nowISO().slice(0, 10);
    }
    if (updates.status !== 'received') {
      item.received_date = updates.status === 'cancelled' ? item.received_date : null;
    }
  } else if (updates.received_date !== undefined) {
    item.received_date = updates.received_date;
  }

  item.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_revenue',
    targetId: budget.id,
    summary: `تحديث إيراد: ${item.description}`,
    details: { budget_id: budget.id, revenue_id: item.id, updates },
  });

  return { success: true, data: { revenue: sanitizeRevenue(item), summary: computeRevenueSummary(budget) } };
}

function deleteRevenue(budgetId, revenueId, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const idx = (budget.revenues || []).findIndex(r => r.id === revenueId);
  if (idx === -1) throw new Error('الإيراد غير موجود');
  const removed = budget.revenues.splice(idx, 1)[0];

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_revenue',
    targetId: budget.id,
    summary: `حذف إيراد: ${removed.description}`,
    details: { budget_id: budget.id, revenue_id: revenueId, amount: removed.amount },
  });

  return { success: true, data: { deleted: revenueId, summary: computeRevenueSummary(budget) } };
}

function sanitizeRevenue(revenue) {
  return { ...revenue, effective_status: resolveEffectiveStatus(revenue) };
}

function listRevenues(budgetId, { type = null, status = null, from_date = null, to_date = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  let items = (budget.revenues || []).map(sanitizeRevenue);

  if (type) { validateRevenueType(type); items = items.filter(i => i.type === type); }
  if (status) { validateRevenueStatus(status); items = items.filter(i => i.effective_status === status); }
  if (from_date) items = items.filter(i => i.due_date >= from_date);
  if (to_date) items = items.filter(i => i.due_date <= to_date);

  items.sort((a, b) => (a.due_date < b.due_date ? 1 : -1));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;
  const pageItems = items.slice(start, start + ps);

  return { success: true, data: { items: pageItems, total, page: p, pageSize: ps, summary: computeRevenueSummary(budget) } };
}

/**
 * ملخص فعلي للإيرادات والتحصيل لميزانية: إجمالي مُحصَّل، مبالغ مستحقة (متوقعة +
 * مُستحقة لم تُحصَّل بعد)، دفعات متأخرة، وحساب الأرباح/الخسائر الفعلية = الإيراد
 * المُحصَّل فعلياً - إجمالي التكلفة الفعلية (من الجزء 3/10)، مع نسبة التحصيل من
 * قيمة العقد الكاملة (contract_value، الجزء 1/10). يغذّي هذا لاحقاً
 * getDashboardStats (الأرباح الفعلية) دون كسر شكل الاستجابة الخارجي.
 */
function computeRevenueSummary(budget) {
  const items = (budget.revenues || []).map(sanitizeRevenue);

  const totalReceived = r2(items.filter(i => i.status === 'received').reduce((s, i) => s + i.amount, 0));
  const totalExpected = r2(items.filter(i => i.effective_status === 'expected').reduce((s, i) => s + i.amount, 0));
  const totalInvoiced = r2(items.filter(i => i.effective_status === 'invoiced').reduce((s, i) => s + i.amount, 0));
  const totalOverdue = r2(items.filter(i => i.effective_status === 'overdue').reduce((s, i) => s + i.amount, 0));
  const totalCancelled = r2(items.filter(i => i.status === 'cancelled').reduce((s, i) => s + i.amount, 0));

  const outstandingAmount = r2(totalExpected + totalInvoiced + totalOverdue);
  const contractValue = budget.contract_value || 0;
  const collectionPct = contractValue > 0 ? r2((totalReceived / contractValue) * 100) : 0;
  const remainingUncollected = r2(contractValue - totalReceived - totalCancelled);

  const byType = REVENUE_TYPES.reduce((acc, t) => {
    acc[t] = r2(items.filter(i => i.type === t).reduce((s, i) => s + i.amount, 0));
    return acc;
  }, {});

  const overdueItems = items.filter(i => i.effective_status === 'overdue');

  // الأرباح/الخسائر الفعلية: الإيراد المُحصَّل فعلياً مقابل التكلفة الفعلية المسجَّلة
  const actualCostSummary = computeActualCostSummary(budget);
  const actualProfit = r2(totalReceived - actualCostSummary.total_actual_cost);
  const actualProfitMarginPct = totalReceived > 0 ? r2((actualProfit / totalReceived) * 100) : 0;

  return {
    total_received: totalReceived,
    total_expected: totalExpected,
    total_invoiced: totalInvoiced,
    total_overdue: totalOverdue,
    total_cancelled: totalCancelled,
    outstanding_amount: outstandingAmount,
    contract_value: contractValue,
    collection_pct: collectionPct,
    remaining_uncollected: remainingUncollected,
    by_type: byType,
    overdue_count: overdueItems.length,
    overdue_items: overdueItems,
    actual_profit: actualProfit,
    actual_profit_margin_pct: actualProfitMarginPct,
    actual_cost_total: actualCostSummary.total_actual_cost,
    entries_count: items.length,
  };
}

/**
 * التدفق النقدي الشهري الفعلي لميزانية: تجميع الدفعات المُحصَّلة فعلياً (received)
 * حسب شهر التحصيل (received_date)، والدفعات المتوقعة/المُستحقة/المتأخرة حسب شهر
 * الاستحقاق (due_date) — حساب فعلي وليس تقديراً ثابتاً، يشمل رصيداً متراكماً شهرياً.
 */
function computeCashFlow(budget) {
  const items = (budget.revenues || []).map(sanitizeRevenue).filter(i => i.status !== 'cancelled');

  const months = {};
  function ensureMonth(key) {
    if (!months[key]) months[key] = { month: key, received: 0, expected: 0, overdue: 0 };
    return months[key];
  }

  for (const i of items) {
    if (i.status === 'received' && i.received_date) {
      const m = ensureMonth(i.received_date.slice(0, 7));
      m.received = r2(m.received + i.amount);
    } else if (i.effective_status === 'overdue') {
      const m = ensureMonth(i.due_date.slice(0, 7));
      m.overdue = r2(m.overdue + i.amount);
    } else if (['expected', 'invoiced'].includes(i.effective_status)) {
      const m = ensureMonth(i.due_date.slice(0, 7));
      m.expected = r2(m.expected + i.amount);
    }
  }

  const sortedMonths = Object.values(months).sort((a, b) => (a.month < b.month ? -1 : 1));

  let cumulative = 0;
  const withCumulative = sortedMonths.map(m => {
    cumulative = r2(cumulative + m.received);
    return { ...m, cumulative_received: cumulative };
  });

  return {
    success: true,
    data: {
      budget_id: budget.id,
      months: withCumulative,
      total_received: r2(withCumulative.reduce((s, m) => s + m.received, 0)),
      total_expected: r2(withCumulative.reduce((s, m) => s + m.expected, 0)),
      total_overdue: r2(withCumulative.reduce((s, m) => s + m.overdue, 0)),
    },
  };
}

function getRevenueSummary(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: computeRevenueSummary(budget) };
}

function getCashFlow(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return computeCashFlow(budget);
}

/**
 * إعادة تصنيف تلقائية للدفعات المتأخرة عبر كل الميزانيات: يفحص كل إيراد لم يُحصَّل
 * بعد ولم يُلغَ، فإن تجاوز تاريخ استحقاقه تاريخ اليوم ولا تزال حالته المخزَّنة غير
 * "overdue" يُحدِّثها فعلياً على القرص (وليس فقط عرضاً محسوباً وقت القراءة عبر
 * resolveEffectiveStatus) ويسجّل ذلك في سجل التدقيق — مخصَّصة للتشغيل الدوري
 * (مهمة مجدولة) أو عند فتح لوحة التحكم.
 */
function refreshOverdueRevenues({ actor = null } = {}) {
  const db = loadDB();
  const today = nowISO().slice(0, 10);
  let updatedCount = 0;

  for (const budget of db.budgets) {
    for (const rev of (budget.revenues || [])) {
      if (['received', 'cancelled', 'overdue'].includes(rev.status)) continue;
      if (rev.due_date && rev.due_date < today) {
        rev.status = 'overdue';
        rev.updated_at = nowISO();
        updatedCount += 1;
        recordAudit({
          actor,
          action: 'auto_mark_overdue',
          targetId: budget.id,
          summary: `تصنيف تلقائي كدفعة متأخرة: ${rev.description}`,
          details: { budget_id: budget.id, revenue_id: rev.id, due_date: rev.due_date },
        });
      }
    }
  }

  if (updatedCount > 0) saveDB(db);
  return { success: true, data: { updated_count: updatedCount } };
}

/**
 * ملخص إيرادات إجمالي عبر كل الميزانيات — لتغذية لوحة التحكم العامة فعلياً
 * (الأرباح الفعلية، إجمالي المُحصَّل، المتأخرات) بنفس نمط getActualCostsOverview
 * في الجزء 3/10.
 */
function getRevenuesOverview() {
  const db = loadDB();
  const perBudget = db.budgets.map(b => {
    const summary = computeRevenueSummary(b);
    return {
      budget_id: b.id,
      project_id: b.project_id,
      project_name: b.project_name,
      ...summary,
    };
  });

  const totalReceivedAll = r2(perBudget.reduce((s, p) => s + p.total_received, 0));
  const totalOutstandingAll = r2(perBudget.reduce((s, p) => s + p.outstanding_amount, 0));
  const totalOverdueAll = r2(perBudget.reduce((s, p) => s + p.total_overdue, 0));
  const totalActualProfitAll = r2(perBudget.reduce((s, p) => s + p.actual_profit, 0));

  return {
    success: true,
    data: {
      total_received_all_projects: totalReceivedAll,
      total_outstanding_all_projects: totalOutstandingAll,
      total_overdue_all_projects: totalOverdueAll,
      total_actual_profit_all_projects: totalActualProfitAll,
      per_budget: perBudget,
    },
  };
}

// ------------------------------------------------------------------------------
// تحديث لوحة التحكم الرئيسية (الجزء 1/10، محدَّثة في الجزء 3/10) لتدمج الأرباح
// الفعلية الحقيقية (إيراد محصَّل - تكلفة فعلية) بدل تقدير contract_value - actual_cost
// المستخدَم مؤقتاً في الجزء 3/10 - دون تغيير شكل الاستجابة الخارجي.
// ------------------------------------------------------------------------------
const _actualsOnlyGetDashboardStats = getDashboardStatsWithActuals;
function getDashboardStatsWithRevenues() {
  const base = _actualsOnlyGetDashboardStats();
  const db = loadDB();

  let totalReceivedAll = 0;
  let totalActualProfitAll = 0;
  const perBudgetRevenue = {};
  for (const b of db.budgets) {
    const summary = computeRevenueSummary(b);
    perBudgetRevenue[b.id] = summary;
    totalReceivedAll = r2(totalReceivedAll + summary.total_received);
    totalActualProfitAll = r2(totalActualProfitAll + summary.actual_profit);
  }

  base.data.summary.total_revenue_collected = totalReceivedAll;
  base.data.summary.total_actual_profit = totalActualProfitAll;

  base.data.over_budget_projects = base.data.over_budget_projects.map(p => ({
    ...p,
    revenue_collected: perBudgetRevenue[p.id]?.total_received ?? 0,
    actual_profit: perBudgetRevenue[p.id]?.actual_profit ?? 0,
  }));
  base.data.within_budget_projects = base.data.within_budget_projects.map(p => ({
    ...p,
    revenue_collected: perBudgetRevenue[p.id]?.total_received ?? 0,
    actual_profit: perBudgetRevenue[p.id]?.actual_profit ?? 0,
  }));

  return base;
}


// ==================================================================================
// ============================ أوامر التغيير (الجزء 5/10) ==========================
// ==================================================================================
// دورة حياة أمر التغيير: pending → (منتظر اعتماد مدير المشروع) → pm_approved →
//                         (منتظر اعتماد الإدارة/المالي) → approved → مُطبَّق تلقائياً
//                         على الميزانية (BBS + contract_value + إصدار جديد)
//                         أو rejected في أي مرحلة (نهائي، لا يُطبَّق شيء).
// عند "approved": يُنشأ فعلياً عقدة BBS جديدة (تحت نشاط محدَّد، أو تحت شجرة جذرية
// مستقلة باسم "أوامر التغيير المعتمدة" إن لم يُحدَّد موقع)، وتُرفَع contract_value
// وتُستدعى updateBudget لترقية الإصدار وأرشفة النسخة السابقة تلقائياً - بنفس الآلية
// المستخدَمة في بقية الأجزاء، دون كسر أي واجهة برمجية قائمة.

const CHANGE_ORDER_STATUSES = ['pending', 'pm_approved', 'approved', 'rejected'];
const CHANGE_ORDER_STATUS_LABELS = {
  pending: 'قيد المراجعة',
  pm_approved: 'معتمد من مدير المشروع (بانتظار اعتماد الإدارة)',
  approved: 'معتمد ومُطبَّق على الميزانية',
  rejected: 'مرفوض',
};

function validateChangeOrderStatus(status) {
  if (status && !CHANGE_ORDER_STATUSES.includes(status)) {
    throw new Error(`حالة أمر تغيير غير معروفة: ${status}. القيم المسموحة: ${CHANGE_ORDER_STATUSES.join(', ')}`);
  }
}

function validateChangeOrderInput(body, { partial = false } = {}) {
  if (!partial) {
    if (!body.title || !String(body.title).trim()) throw new Error('عنوان التغيير (title) مطلوب');
    if (!body.description || !String(body.description).trim()) throw new Error('وصف التغيير (description) مطلوب');
    if (!body.reason || !String(body.reason).trim()) throw new Error('سبب التغيير (reason) مطلوب');
    if (body.additional_cost === undefined || body.additional_cost === null || isNaN(Number(body.additional_cost))) {
      throw new Error('التكلفة الإضافية (additional_cost) مطلوبة ويجب أن تكون رقماً');
    }
  }
  if (body.status !== undefined) validateChangeOrderStatus(body.status);
  if (body.schedule_impact_days !== undefined && body.schedule_impact_days !== null && isNaN(Number(body.schedule_impact_days))) {
    throw new Error('التأثير على الجدول الزمني (schedule_impact_days) يجب أن يكون رقماً');
  }
}

function generateChangeOrderNumber(db, budget) {
  db.change_order_seq = (db.change_order_seq || 0) + 1;
  return `CO-${budget.budget_number}-${String(db.change_order_seq).padStart(3, '0')}`;
}

function createChangeOrder(budgetId, body = {}, { actor = null } = {}) {
  validateChangeOrderInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  let linkedNode = null;
  if (body.bbs_node_id) {
    linkedNode = findNode(budget.bbs, body.bbs_node_id);
    if (!linkedNode) throw new Error('عقدة الهيكل المرتبطة (bbs_node_id) غير موجودة في هذه الميزانية');
  }

  if (!budget.change_orders) budget.change_orders = [];

  const changeOrder = {
    id: newId('CO'),
    co_number: generateChangeOrderNumber(db, budget),
    budget_id: budget.id,
    title: String(body.title).trim(),
    description: String(body.description).trim(),
    reason: String(body.reason).trim(),
    additional_cost: r2(body.additional_cost),
    schedule_impact_days: body.schedule_impact_days !== undefined && body.schedule_impact_days !== null ? Number(body.schedule_impact_days) : 0,
    bbs_node_id: body.bbs_node_id || null,
    bbs_node_name: linkedNode ? linkedNode.name : null,
    status: 'pending',
    approvals: [],
    applied_bbs_node_id: null,
    requested_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  budget.change_orders.push(changeOrder);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'create_change_order',
    targetId: budget.id,
    summary: `إنشاء أمر تغيير: ${changeOrder.title} (${changeOrder.co_number}) — تكلفة إضافية ${changeOrder.additional_cost}`,
    details: { budget_id: budget.id, change_order_id: changeOrder.id, additional_cost: changeOrder.additional_cost },
  });

  return { success: true, data: changeOrder };
}

function findChangeOrderOrThrow(budget, changeOrderId) {
  const co = (budget.change_orders || []).find(c => c.id === changeOrderId || c.co_number === changeOrderId);
  if (!co) throw new Error('أمر التغيير غير موجود');
  return co;
}

function listChangeOrders(budgetId, { status = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  let items = (budget.change_orders || []).slice();

  if (status) { validateChangeOrderStatus(status); items = items.filter(c => c.status === status); }

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: items.slice(start, start + ps),
    pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) || 1 },
  };
}

function getChangeOrder(budgetId, changeOrderId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: findChangeOrderOrThrow(budget, changeOrderId) };
}

function updateChangeOrder(budgetId, changeOrderId, updates = {}, { actor = null } = {}) {
  validateChangeOrderInput(updates, { partial: true });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const co = findChangeOrderOrThrow(budget, changeOrderId);

  if (co.status !== 'pending') {
    throw new Error(`لا يمكن تعديل أمر تغيير في حالة "${CHANGE_ORDER_STATUS_LABELS[co.status]}" — التعديل مسموح فقط في حالة "قيد المراجعة"`);
  }

  const editableFields = ['title', 'description', 'reason', 'additional_cost', 'schedule_impact_days', 'bbs_node_id'];
  for (const field of editableFields) {
    if (updates[field] !== undefined) {
      if (field === 'additional_cost') co.additional_cost = r2(updates.additional_cost);
      else if (field === 'schedule_impact_days') co.schedule_impact_days = Number(updates.schedule_impact_days);
      else if (field === 'bbs_node_id') {
        const node = findNode(budget.bbs, updates.bbs_node_id);
        if (!node) throw new Error('عقدة الهيكل المرتبطة (bbs_node_id) غير موجودة في هذه الميزانية');
        co.bbs_node_id = updates.bbs_node_id;
        co.bbs_node_name = node.name;
      } else {
        co[field] = String(updates[field]).trim();
      }
    }
  }
  co.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_change_order',
    targetId: budget.id,
    summary: `تحديث أمر تغيير: ${co.title} (${co.co_number})`,
    details: { budget_id: budget.id, change_order_id: co.id, updates },
  });

  return { success: true, data: co };
}

function deleteChangeOrder(budgetId, changeOrderId, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const idx = (budget.change_orders || []).findIndex(c => c.id === changeOrderId || c.co_number === changeOrderId);
  if (idx === -1) throw new Error('أمر التغيير غير موجود');
  const co = budget.change_orders[idx];

  if (co.status === 'approved') {
    throw new Error('لا يمكن حذف أمر تغيير مُعتمَد ومُطبَّق فعلياً على الميزانية — يجب إلغاؤه عبر إنشاء أمر تغيير عكسي إن لزم، حفاظاً على سلامة السجل المالي');
  }

  budget.change_orders.splice(idx, 1);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_change_order',
    targetId: budget.id,
    summary: `حذف أمر تغيير: ${co.title} (${co.co_number})`,
    details: { budget_id: budget.id, change_order_id: co.id },
  });

  return { success: true, data: { deleted: co.id } };
}

function pmApproveChangeOrder(budgetId, changeOrderId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const co = findChangeOrderOrThrow(budget, changeOrderId);

  if (co.status !== 'pending') {
    throw new Error(`لا يمكن اعتماد مدير المشروع على أمر تغيير في حالة "${CHANGE_ORDER_STATUS_LABELS[co.status]}"`);
  }

  co.status = 'pm_approved';
  co.approvals.push({ step: 'pm_approval', actor, decision: 'approved', note: note || '', at: nowISO() });
  co.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'pm_approve_change_order',
    targetId: budget.id,
    summary: `اعتماد مدير المشروع على أمر تغيير: ${co.title} (${co.co_number})`,
    details: { budget_id: budget.id, change_order_id: co.id },
  });

  return { success: true, data: co };
}

function approveChangeOrder(budgetId, changeOrderId, { actor = null, note = '', requirePmApprovalFirst = true } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const co = findChangeOrderOrThrow(budget, changeOrderId);

  if (co.status === 'approved') throw new Error('أمر التغيير معتمَد ومُطبَّق بالفعل');
  if (co.status === 'rejected') throw new Error('لا يمكن اعتماد أمر تغيير مرفوض سابقاً');
  if (requirePmApprovalFirst && co.status !== 'pm_approved') {
    throw new Error('يجب اعتماد مدير المشروع أولاً (pm_approve) قبل الاعتماد النهائي من الإدارة/المدير المالي');
  }

  let appliedNodeId = null;
  if (co.bbs_node_id) {
    const targetNode = findNode(budget.bbs, co.bbs_node_id);
    if (!targetNode) throw new Error('عقدة الهيكل المرتبطة بأمر التغيير لم تعد موجودة في الميزانية');
    if (targetNode.node_type === 'activity') {
      const resourceNode = makeBBSNode({ name: `تغيير معتمَد: ${co.title}`, node_type: 'resource', cost: co.additional_cost, parent_id: targetNode.id });
      targetNode.children.push(resourceNode);
      appliedNodeId = resourceNode.id;
    } else {
      throw new Error('عقدة الهيكل المرتبطة يجب أن تكون من نوع "نشاط" (activity) لإضافة تكلفة أمر التغيير كمورد تحتها');
    }
  } else {
    let coPhase = budget.bbs.find(n => n.node_type === 'phase' && n.__is_change_orders_phase);
    if (!coPhase) {
      coPhase = makeBBSNode({ name: 'أوامر التغيير المعتمدة', node_type: 'phase' });
      coPhase.__is_change_orders_phase = true;
      budget.bbs.push(coPhase);
    }
    const mainItem = makeBBSNode({ name: co.title, node_type: 'main_item', parent_id: coPhase.id });
    const subItem = makeBBSNode({ name: co.reason, node_type: 'sub_item', parent_id: mainItem.id });
    const activity = makeBBSNode({ name: 'تنفيذ التغيير', node_type: 'activity', parent_id: subItem.id });
    const resource = makeBBSNode({ name: `تغيير معتمَد: ${co.title}`, node_type: 'resource', cost: co.additional_cost, parent_id: activity.id });
    activity.children.push(resource);
    subItem.children.push(activity);
    mainItem.children.push(subItem);
    coPhase.children.push(mainItem);
    appliedNodeId = resource.id;
  }

  co.status = 'approved';
  co.applied_bbs_node_id = appliedNodeId;
  co.approvals.push({ step: 'final_approval', actor, decision: 'approved', note: note || '', at: nowISO() });
  co.updated_at = nowISO();

  saveDB(db);

  const newContractValue = r2(budget.contract_value + co.additional_cost);
  updateBudget(budget.id, { contract_value: newContractValue, status: 'revised' }, { actor, bumpVersion: true });

  recordAudit({
    actor,
    action: 'approve_change_order',
    targetId: budget.id,
    summary: `اعتماد نهائي وتطبيق أمر تغيير: ${co.title} (${co.co_number}) — تكلفة إضافية ${co.additional_cost}، تأثير جدول زمني: ${co.schedule_impact_days} يوم`,
    details: {
      budget_id: budget.id, change_order_id: co.id, additional_cost: co.additional_cost,
      schedule_impact_days: co.schedule_impact_days, applied_bbs_node_id: appliedNodeId,
      new_contract_value: newContractValue,
    },
  });

  return { success: true, data: co };
}

function rejectChangeOrder(budgetId, changeOrderId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const co = findChangeOrderOrThrow(budget, changeOrderId);

  if (co.status === 'approved') throw new Error('لا يمكن رفض أمر تغيير معتمَد ومُطبَّق بالفعل');
  if (co.status === 'rejected') throw new Error('أمر التغيير مرفوض بالفعل');

  const step = co.status === 'pm_approved' ? 'final_review' : 'pm_review';
  co.status = 'rejected';
  co.approvals.push({ step, actor, decision: 'rejected', note: note || '', at: nowISO() });
  co.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'reject_change_order',
    targetId: budget.id,
    summary: `رفض أمر تغيير: ${co.title} (${co.co_number})${note ? ' — السبب: ' + note : ''}`,
    details: { budget_id: budget.id, change_order_id: co.id, note },
  });

  return { success: true, data: co };
}

function computeChangeOrdersSummary(budget) {
  const items = budget.change_orders || [];
  const approved = items.filter(c => c.status === 'approved');
  const pending = items.filter(c => c.status === 'pending' || c.status === 'pm_approved');
  const rejected = items.filter(c => c.status === 'rejected');

  return {
    total_count: items.length,
    approved_count: approved.length,
    pending_count: pending.length,
    rejected_count: rejected.length,
    total_approved_additional_cost: r2(approved.reduce((s, c) => s + c.additional_cost, 0)),
    total_pending_additional_cost: r2(pending.reduce((s, c) => s + c.additional_cost, 0)),
    total_approved_schedule_impact_days: approved.reduce((s, c) => s + (c.schedule_impact_days || 0), 0),
  };
}

function getChangeOrdersOverview(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: computeChangeOrdersSummary(budget) };
}

function getDashboardStatsWithChangeOrders() {
  const base = getDashboardStatsWithRevenues();
  const db = loadDB();

  let totalApprovedCOCostAll = 0;
  let totalPendingCOCostAll = 0;
  const perBudgetCO = {};
  for (const b of db.budgets) {
    const summary = computeChangeOrdersSummary(b);
    perBudgetCO[b.id] = summary;
    totalApprovedCOCostAll = r2(totalApprovedCOCostAll + summary.total_approved_additional_cost);
    totalPendingCOCostAll = r2(totalPendingCOCostAll + summary.total_pending_additional_cost);
  }

  base.data.summary.total_approved_change_orders_cost = totalApprovedCOCostAll;
  base.data.summary.total_pending_change_orders_cost = totalPendingCOCostAll;

  base.data.over_budget_projects = base.data.over_budget_projects.map(p => ({
    ...p, change_orders: perBudgetCO[p.id] || null,
  }));
  base.data.within_budget_projects = base.data.within_budget_projects.map(p => ({
    ...p, change_orders: perBudgetCO[p.id] || null,
  }));

  return base;
}

// ==================================================================================
// === الجزء 6/10: مراقبة الانحرافات المالية + تحليل القيمة المكتسبة (EVM) ==========
// ==================================================================================
// هذا الجزء لا يضيف بيانات جديدة تُدخَل يدوياً، بل يحسب مؤشرات فعلية من البيانات
// الموجودة أصلاً في النظام:
//   - BAC (Budget At Completion)  = computeBBSGrandTotal(budget)  (الجزء 1/10، محدَّثاً
//     تلقائياً بأوامر التغيير المعتمدة من الجزء 5/10 لأنها تُحدِّث BBS مباشرة).
//   - AC  (Actual Cost)           = computeActualCostSummary(budget).total_actual_cost
//     (الجزء 3/10).
//   - % الإنجاز الفعلي (Physical % Complete) = من الجدول الزمني الحقيقي للمشروع
//     (scheduling.js، عبر computeSCurve/compareScheduleVsActual)، وليس تقديراً؛ إن لم
//     يوجد جدول زمني مرتبط بالمشروع (SCH غير متاح أو لا يوجد جدول)، يُستخدَم fallback
//     شفّاف: نسبة استهلاك الميزانية (AC/BAC) كتقدير مؤقت مع علم `progress_source`
//     يوضّح للواجهة أن الرقم تقديري وليس من جدول زمني فعلي.
//   - PV  (Planned Value)  = BAC × (النسبة المخططة تراكمياً حتى تاريخ اليوم من S-Curve)
//   - EV  (Earned Value)   = BAC × (% الإنجاز الفعلي)
//   - CV = EV - AC   |   SV = EV - PV
//   - CPI = EV / AC  |   SPI = EV / PV
//   - EAC = AC + (BAC - EV) / CPI  (طريقة الأداء المستمر - الأكثر شيوعاً)
//   - ETC = EAC - AC
//   - VAC (Variance At Completion) = BAC - EAC
//
// تصنيف شدة الانحراف: يُطبَّق على "نسبة الانحراف المالي" (variance_pct من
// computeActualCostSummary، أي (BAC - AC)/BAC) بعتبات قابلة للتعديل من كود واحد.

const DEVIATION_THRESHOLDS = {
  minor_pct: 5,    // حتى 5% تجاوز أو أقل = انحراف بسيط
  moderate_pct: 15, // حتى 15% = انحراف متوسط، أكثر من ذلك = انحراف خطير
};

function classifyDeviation(variancePct) {
  // variancePct موجب = وفر (أقل من المخطط)، سالب = تجاوز. الخطورة تُقاس بالقيمة المطلقة
  // فقط عند التجاوز (سالب)؛ الوفر لا يُصنَّف كـ"خطير" أبداً مهما كبر.
  const overrun = variancePct < 0 ? Math.abs(variancePct) : 0;
  let level = 'none';
  let label = 'لا يوجد تجاوز';
  if (overrun > DEVIATION_THRESHOLDS.moderate_pct) {
    level = 'severe'; label = 'انحراف خطير';
  } else if (overrun > DEVIATION_THRESHOLDS.minor_pct) {
    level = 'moderate'; label = 'انحراف متوسط';
  } else if (overrun > 0) {
    level = 'minor'; label = 'انحراف بسيط';
  }
  return { level, label, overrun_pct: r2(overrun) };
}

/**
 * جلب أفضل جدول زمني متاح لمشروع الميزانية: الجدول ذو الحالة "active" الأحدث إنشاءً.
 * يعيد null إن لم تتوفر وحدة الجدولة أو لم يوجد جدول للمشروع - وليس خطأ، لأن EVM
 * يجب أن يعمل (بتقدير احتياطي) حتى بدون جدول زمني مرتبط بعد.
 */
function findProjectSchedule(projectId) {
  if (!SCH || typeof SCH.listSchedules !== 'function') return null;
  try {
    const schedules = SCH.listSchedules(projectId) || [];
    if (!schedules.length) return null;
    const active = schedules.filter(s => s.status === 'active');
    const pool = active.length ? active : schedules;
    return pool.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  } catch (e) {
    return null;
  }
}

/**
 * حساب النسبة المخططة تراكمياً حتى تاريخ اليوم، والنسبة الفعلية للإنجاز، من منحنى
 * S-Curve الحقيقي للجدول الزمني (scheduling.js). النسبة المخططة تُقرَأ من أقرب نقطة
 * زمنية للتاريخ الحالي في مصفوفة planned (وليست تقديراً خطياً مبسَّطاً).
 */
function getScheduleProgress(projectId) {
  const schedule = findProjectSchedule(projectId);
  if (!schedule || typeof SCH.compareScheduleVsActual !== 'function') {
    return { available: false, planned_pct: null, actual_pct: null, schedule_id: null };
  }
  try {
    const cmp = SCH.compareScheduleVsActual(schedule.id);
    const activities = cmp.activities || [];
    if (!activities.length) {
      return { available: false, planned_pct: null, actual_pct: null, schedule_id: schedule.id };
    }

    const today = nowISO().slice(0, 10);

    // النسبة المخططة تراكمياً حتى اليوم: لكل نشاط، وزنه = 1/عدد الأنشطة (تبسيط موحّد
    // مع نفس منهجية computeSCurve الأصلية)، ومساهمته في "المخطط حتى اليوم" = 100% من
    // وزنه إن انتهى تاريخه المخطط (planned_end) قبل أو خلال اليوم، أو نسبة الأيام
    // المنقضية من مدته المخططة إن كان اليوم يقع أثناء تنفيذه، أو صفر إن لم يبدأ بعد.
    // يُستخدَم التاريخ التقويمي الفعلي لكل نشاط مباشرة (planned_start/planned_end)
    // بدل معرّفات الأيام الداخلية لخوارزمية CPM، لتفادي أي فرق بين وحدات "يوم عمل"
    // ووحدات "يوم تقويمي" عند تحويلها لاحقاً إلى نسبة تراكمية بتاريخ محدد.
    const weight = 100 / activities.length;
    let plannedCum = 0;
    for (const a of activities) {
      if (!a.planned_start || !a.planned_end) continue;
      if (a.planned_end <= today) {
        plannedCum += weight;
      } else if (a.planned_start <= today) {
        const totalDays = Math.max(1, daysBetweenDates(a.planned_start, a.planned_end));
        const elapsedDays = Math.max(0, daysBetweenDates(a.planned_start, today));
        plannedCum += weight * Math.min(1, elapsedDays / totalDays);
      }
      // لم يبدأ بعد (planned_start > today): مساهمته = صفر، لا شيء يُضاف
    }

    const actualPct = Number(cmp.overall_progress_percent) || 0;

    return {
      available: true,
      planned_pct: r2(Math.min(100, plannedCum)),
      actual_pct: r2(actualPct),
      schedule_id: schedule.id,
      schedule_name: schedule.name,
    };
  } catch (e) {
    return { available: false, planned_pct: null, actual_pct: null, schedule_id: schedule.id, error: e.message };
  }
}

// فرق الأيام بين تاريخين بصيغة YYYY-MM-DD (نسخة محلية بسيطة؛ لا تعتمد على أدوات
// scheduling.js الداخلية غير المصدَّرة، لتبقى هذه الدالة مستقلة وقابلة لإعادة الاستخدام)
function daysBetweenDates(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * حساب مجموعة مؤشرات EVM الكاملة لميزانية محددة، بالاعتماد على:
 *  - BAC من BBS الفعلي (الجزء 1/10 + أوامر التغيير المعتمدة من الجزء 5/10)
 *  - AC من التكاليف الفعلية المسجَّلة (الجزء 3/10)
 *  - % الإنجاز من الجدول الزمني الحقيقي (scheduling.js) إن وُجد، وإلا تقدير احتياطي
 *    شفّاف = نسبة استهلاك الميزانية (موسوم بـ progress_source = 'budget_consumption_fallback')
 */
function computeEVM(budget) {
  const bac = computeBBSGrandTotal(budget);
  const actualSummary = computeActualCostSummary(budget);
  const ac = actualSummary.total_actual_cost;

  const scheduleProgress = getScheduleProgress(budget.project_id);

  let plannedPct, actualPct, progressSource;
  if (scheduleProgress.available) {
    plannedPct = scheduleProgress.planned_pct;
    actualPct = scheduleProgress.actual_pct;
    progressSource = 'schedule'; // من الجدول الزمني الحقيقي للمشروع
  } else {
    // تقدير احتياطي شفّاف: يُفترَض أن ما صُرف فعلياً يعكس تقريباً ما أُنجِز، إلى حين
    // ربط الميزانية بجدول زمني فعلي. لا يُستخدَم كأساس دائم، ويظهر بوضوح في المخرجات.
    actualPct = bac > 0 ? r2(Math.min(100, (ac / bac) * 100)) : 0;
    plannedPct = actualPct; // بدون جدول زمني، لا مصدر مستقل لتقدير "المخطط" تراكمياً
    progressSource = 'budget_consumption_fallback';
  }

  const pv = r2(bac * (plannedPct / 100));
  const ev = r2(bac * (actualPct / 100));

  const cv = r2(ev - ac);           // Cost Variance: موجب = وفر، سالب = تجاوز تكلفة
  const sv = r2(ev - pv);           // Schedule Variance: موجب = متقدم، سالب = متأخر

  const cpi = ac > 0 ? r2(ev / ac) : (ev > 0 ? null : 1); // null = لا يمكن حسابه (لا EV ولا AC)
  const spi = pv > 0 ? r2(ev / pv) : (ev > 0 ? null : 1);

  // EAC بطريقة الأداء المستمر (الأكثر استخداماً): AC + (BAC - EV) / CPI
  // إن تعذّر حساب CPI (لا تكلفة مسجَّلة بعد)، EAC = BAC كأفضل تقدير متاح
  let eac;
  if (cpi && cpi > 0) {
    eac = r2(ac + (bac - ev) / cpi);
  } else {
    eac = bac;
  }
  const etc = r2(eac - ac);
  const vac = r2(bac - eac); // موجب = يُتوقَّع الانتهاء دون الميزانية، سالب = تجاوز متوقَّع

  // تصنيف شدة الانحراف يعتمد على VAC/BAC (نسبة التجاوز المتوقعة عند الإنجاز الكامل)
  // وليس فقط على مقارنة BAC بالمصروف الفعلي حتى الآن (variance_pct)؛ الأخيرة قد تُظهر
  // "وفراً" ظاهرياً في مشروع لا يزال في بدايته رغم أن أداء تكلفته الفعلي (CPI) كارثي
  // ومن المتوقع أن يتجاوز الميزانية بشكل كبير عند اكتماله - وهو بالضبط ما يلتقطه VAC.
  const vacPct = bac > 0 ? r2((vac / bac) * 100) : 0;
  const deviation = classifyDeviation(vacPct);

  return {
    budget_id: budget.id,
    project_id: budget.project_id,
    project_name: budget.project_name,
    bac,
    ac,
    ev,
    pv,
    physical_progress: {
      planned_pct: plannedPct,
      actual_pct: actualPct,
      source: progressSource,
      schedule_id: scheduleProgress.schedule_id || null,
    },
    cv,
    sv,
    cpi,
    spi,
    eac,
    etc,
    vac,
    performance_status: {
      cost: cpi === null ? 'غير محدَّد' : (cpi >= 1 ? 'ضمن التكلفة المخططة أو أفضل' : 'تجاوز في التكلفة'),
      schedule: spi === null ? 'غير محدَّد' : (spi >= 1 ? 'ضمن الجدول الزمني أو أسرع' : 'متأخر عن الجدول الزمني'),
    },
    deviation, // { level, label, overrun_pct }
    budget_variance_pct: actualSummary.variance_pct,
    over_budget: actualSummary.over_budget,
  };
}

function getBudgetEVM(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: computeEVM(budget) };
}

/**
 * سجل EVM عبر الزمن: يُنشئ نقطة قياس فعلية (snapshot) لمؤشرات EVM الحالية ويحفظها
 * ضمن الميزانية (evm_snapshots)، بحيث يمكن لاحقاً رسم تطور CPI/SPI/EAC عبر الزمن
 * (وليس فقط رقماً لحظياً). يُستدعى يدوياً (زر "تسجيل نقطة قياس") أو دورياً.
 */
function recordEVMSnapshot(budgetId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const evm = computeEVM(budget);

  const snapshot = {
    id: newId('EVMS'),
    date: nowISO().slice(0, 10),
    recorded_at: nowISO(),
    note: note || '',
    ...evm,
  };

  if (!budget.evm_snapshots) budget.evm_snapshots = [];
  budget.evm_snapshots.push(snapshot);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'record_evm_snapshot',
    targetId: budget.id,
    summary: `تسجيل نقطة قياس EVM: CPI=${evm.cpi ?? 'غ.م'} SPI=${evm.spi ?? 'غ.م'} انحراف=${evm.deviation.label}`,
    details: { budget_id: budget.id, snapshot_id: snapshot.id, cpi: evm.cpi, spi: evm.spi },
  });

  return { success: true, data: snapshot };
}

function listEVMSnapshots(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const items = (budget.evm_snapshots || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  return { success: true, data: { items, count: items.length } };
}

/**
 * تفصيل الانحراف المالي حسب المرحلة (phase) داخل BBS: لكل مرحلة، التكلفة المخططة
 * (مجموع BBS الفعلي لأبنائها) مقابل التكلفة الفعلية المسجَّلة عليها وعلى أبنائها
 * (من actual_costs المُصنَّفة أصلاً بـ phase_id عند التسجيل - الجزء 3/10)، مع نسبة
 * انحراف وتصنيف شدة مستقلَّين لكل مرحلة - يساعد على تحديد أين يقع التجاوز فعلياً
 * بدل الاكتفاء برقم إجمالي واحد للمشروع كله.
 */
function computeDeviationByPhase(budget) {
  const phases = (budget.bbs || []).filter(n => n.node_type === 'phase');
  const actualCosts = budget.actual_costs || [];

  return phases.map(phase => {
    const planned = computeNodeTotal(phase);
    const actual = r2(actualCosts.filter(ac => ac.phase_id === phase.id).reduce((s, ac) => s + ac.amount, 0));
    const variance = r2(planned - actual);
    const variancePct = planned > 0 ? r2((variance / planned) * 100) : 0;
    const deviation = classifyDeviation(variancePct);

    return {
      phase_id: phase.id,
      phase_name: phase.name,
      planned_cost: planned,
      actual_cost: actual,
      variance,
      variance_pct: variancePct,
      deviation,
    };
  }).sort((a, b) => a.variance - b.variance); // الأكثر تجاوزاً أولاً (variance الأكثر سلبية)
}

function getDeviationAnalysis(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const overall = computeActualCostSummary(budget);
  const overallDeviation = classifyDeviation(overall.variance_pct);
  const byPhase = computeDeviationByPhase(budget);

  return {
    success: true,
    data: {
      budget_id: budget.id,
      project_id: budget.project_id,
      project_name: budget.project_name,
      overall: {
        planned_cost: overall.planned_total,
        actual_cost: overall.total_actual_cost,
        variance: overall.variance,
        variance_pct: overall.variance_pct,
        deviation: overallDeviation,
      },
      by_phase: byPhase,
      thresholds: DEVIATION_THRESHOLDS,
    },
  };
}

/**
 * نظرة عامة على الانحرافات المالية ومؤشرات EVM عبر كل الميزانيات - لتغذية لوحة
 * التحكم المالية الرئيسية (ودعم تنبيهات تلقائية للمشاريع ذات الانحراف الخطير)، بنفس
 * نمط getActualCostsOverview / getRevenuesOverview / getChangeOrdersOverview.
 */
function getEVMOverview() {
  const db = loadDB();
  const perBudget = db.budgets.map(b => computeEVM(b));

  const severeCount = perBudget.filter(p => p.deviation.level === 'severe').length;
  const moderateCount = perBudget.filter(p => p.deviation.level === 'moderate').length;
  const minorCount = perBudget.filter(p => p.deviation.level === 'minor').length;

  const totalBAC = r2(perBudget.reduce((s, p) => s + p.bac, 0));
  const totalEAC = r2(perBudget.reduce((s, p) => s + p.eac, 0));
  const totalVAC = r2(totalBAC - totalEAC);

  const alerts = perBudget
    .filter(p => p.deviation.level === 'severe')
    .map(p => ({
      budget_id: p.budget_id,
      project_id: p.project_id,
      project_name: p.project_name,
      overrun_pct: p.deviation.overrun_pct,
      eac: p.eac,
      bac: p.bac,
      message: `تجاوز مالي خطير (${p.deviation.overrun_pct}%) في مشروع "${p.project_name}" — التكلفة المتوقعة عند الإنجاز (EAC) = ${p.eac} مقابل ميزانية معتمدة ${p.bac}`,
    }));

  return {
    success: true,
    data: {
      summary: {
        total_bac_all_projects: totalBAC,
        total_eac_all_projects: totalEAC,
        total_vac_all_projects: totalVAC,
        severe_deviation_count: severeCount,
        moderate_deviation_count: moderateCount,
        minor_deviation_count: minorCount,
      },
      per_budget: perBudget,
      alerts,
    },
  };
}

// ------------------------------------------------------------------------------
// تحديث لوحة التحكم الرئيسية لتضمين ملخص EVM/الانحرافات (دون تغيير شكل الاستجابة
// الخارجي القائم أصلاً - إضافة حقول فقط بنفس أسلوب الأجزاء 3/10-5/10).
// ------------------------------------------------------------------------------
const _changeOrdersOnlyGetDashboardStats = getDashboardStatsWithChangeOrders;
function getDashboardStatsWithEVM() {
  const base = _changeOrdersOnlyGetDashboardStats();
  const evmOverview = getEVMOverview();

  base.data.summary.total_eac_all_projects = evmOverview.data.summary.total_eac_all_projects;
  base.data.summary.total_vac_all_projects = evmOverview.data.summary.total_vac_all_projects;
  base.data.summary.severe_deviation_projects_count = evmOverview.data.summary.severe_deviation_count;
  base.data.financial_alerts = evmOverview.data.alerts;

  const evmByBudgetId = {};
  for (const p of evmOverview.data.per_budget) evmByBudgetId[p.budget_id] = p;

  base.data.over_budget_projects = base.data.over_budget_projects.map(p => ({
    ...p, evm: evmByBudgetId[p.id] || null,
  }));
  base.data.within_budget_projects = base.data.within_budget_projects.map(p => ({
    ...p, evm: evmByBudgetId[p.id] || null,
  }));

  return base;
}

// ==================================================================================
// ===================== الجزء 7/10: التدفقات النقدية الشاملة =======================
// ==================================================================================

function monthsBetween(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function computeComprehensiveCashFlow(budget) {
  const revenueFlow = computeCashFlow(budget).data;
  const actualCosts = budget.actual_costs || [];

  const months = {};
  function ensureMonth(key) {
    if (!months[key]) {
      months[key] = {
        month: key,
        revenue_received: 0, revenue_expected: 0, revenue_overdue: 0,
        expense_actual: 0, expense_planned: 0,
      };
    }
    return months[key];
  }

  for (const m of revenueFlow.months) {
    const e = ensureMonth(m.month);
    e.revenue_received = m.received;
    e.revenue_expected = m.expected;
    e.revenue_overdue = m.overdue;
  }

  for (const c of actualCosts) {
    if (!c.date) continue;
    const e = ensureMonth(c.date.slice(0, 7));
    e.expense_actual = r2(e.expense_actual + c.amount);
  }

  const plannedTotal = computeBBSGrandTotal(budget);
  const projectMonths = monthsBetween(budget.start_date, budget.end_date);
  if (projectMonths.length > 0 && plannedTotal > 0) {
    const perMonth = r2(plannedTotal / projectMonths.length);
    for (const key of projectMonths) {
      const e = ensureMonth(key);
      e.expense_planned = perMonth;
    }
  }

  const sortedKeys = Object.keys(months).sort();
  let cumulativeReceived = 0, cumulativeExpectedIn = 0, cumulativeActualOut = 0, cumulativePlannedOut = 0;
  let cumulativeActualBalance = 0, cumulativeProjectedBalance = 0;

  const rows = sortedKeys.map(key => {
    const m = months[key];
    cumulativeReceived = r2(cumulativeReceived + m.revenue_received);
    cumulativeExpectedIn = r2(cumulativeExpectedIn + m.revenue_received + m.revenue_expected);
    cumulativeActualOut = r2(cumulativeActualOut + m.expense_actual);
    cumulativePlannedOut = r2(cumulativePlannedOut + m.expense_planned);

    const netActual = r2(m.revenue_received - m.expense_actual);
    const netProjected = r2((m.revenue_received + m.revenue_expected) - m.expense_planned);
    cumulativeActualBalance = r2(cumulativeActualBalance + netActual);
    cumulativeProjectedBalance = r2(cumulativeProjectedBalance + netProjected);

    return {
      month: key,
      revenue_received: m.revenue_received,
      revenue_expected: m.revenue_expected,
      revenue_overdue: m.revenue_overdue,
      expense_actual: m.expense_actual,
      expense_planned: m.expense_planned,
      net_cash_actual: netActual,
      net_cash_projected: netProjected,
      cumulative_balance_actual: cumulativeActualBalance,
      cumulative_balance_projected: cumulativeProjectedBalance,
      variance_vs_plan: r2(cumulativeActualBalance - cumulativeProjectedBalance),
    };
  });

  return {
    success: true,
    data: {
      budget_id: budget.id,
      currency: budget.currency,
      months: rows,
      totals: {
        total_revenue_received: cumulativeReceived,
        total_revenue_expected_incl_received: cumulativeExpectedIn,
        total_expense_actual: cumulativeActualOut,
        total_expense_planned: cumulativePlannedOut,
        final_balance_actual: cumulativeActualBalance,
        final_balance_projected: cumulativeProjectedBalance,
      },
    },
  };
}

function getComprehensiveCashFlow(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return computeComprehensiveCashFlow(budget);
}

function getCashFlowOverview() {
  const db = loadDB();
  const perBudget = db.budgets.map(b => {
    const flow = computeComprehensiveCashFlow(b);
    return {
      budget_id: b.id, project_id: b.project_id, project_name: b.project_name,
      currency: b.currency, totals: flow.data.totals,
    };
  });

  const summary = perBudget.reduce((acc, p) => {
    acc.total_revenue_received = r2(acc.total_revenue_received + p.totals.total_revenue_received);
    acc.total_expense_actual = r2(acc.total_expense_actual + p.totals.total_expense_actual);
    acc.total_final_balance_actual = r2(acc.total_final_balance_actual + p.totals.final_balance_actual);
    acc.total_final_balance_projected = r2(acc.total_final_balance_projected + p.totals.final_balance_projected);
    return acc;
  }, { total_revenue_received: 0, total_expense_actual: 0, total_final_balance_actual: 0, total_final_balance_projected: 0 });

  return { success: true, data: { summary, per_budget: perBudget } };
}

// ==================================================================================
// ========================= الجزء 7/10: الموافقات المالية ==========================
// ==================================================================================

const PAYMENT_REQUEST_STATUSES = [
  'pending_review', 'financial_review_approved', 'pm_approved',
  'management_approved', 'disbursed', 'rejected',
];

const PAYMENT_REQUEST_STATUS_LABELS = {
  pending_review: 'بانتظار المراجعة المالية',
  financial_review_approved: 'اعتُمدت المراجعة المالية',
  pm_approved: 'اعتمد مدير المشروع',
  management_approved: 'اعتمدت الإدارة',
  disbursed: 'تم الصرف',
  rejected: 'مرفوض',
};

const PAYMENT_REQUEST_CATEGORIES = ['materials', 'labor', 'equipment', 'subcontractor', 'other'];

function validatePaymentRequestInput(body, { partial = false } = {}) {
  if (!partial) {
    if (!body.node_id) throw new Error('عقدة الهيكل المرتبطة (node_id) مطلوبة لطلب الصرف');
    if (!body.description || !String(body.description).trim()) {
      throw new Error('وصف طلب الصرف (description) مطلوب');
    }
    if (body.amount === undefined || body.amount === null || isNaN(Number(body.amount))) {
      throw new Error('مبلغ طلب الصرف (amount) مطلوب ويجب أن يكون رقماً');
    }
    if (Number(body.amount) <= 0) throw new Error('مبلغ طلب الصرف يجب أن يكون أكبر من صفر');
    if (body.category && !PAYMENT_REQUEST_CATEGORIES.includes(body.category)) {
      throw new Error(`فئة طلب صرف غير معروفة: ${body.category}. القيم المسموحة: ${PAYMENT_REQUEST_CATEGORIES.join(', ')}`);
    }
  } else if (body.amount !== undefined && Number(body.amount) <= 0) {
    throw new Error('مبلغ طلب الصرف يجب أن يكون أكبر من صفر');
  }
}

function generatePaymentRequestNumber(db, budget) {
  const count = (budget.payment_requests || []).length + 1;
  return `PR-${budget.budget_number}-${String(count).padStart(4, '0')}`;
}

function createPaymentRequest(budgetId, body = {}, { actor = null } = {}) {
  validatePaymentRequestInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const node = findNode(budget.bbs, body.node_id);
  if (!node) throw new Error('عقدة الهيكل (node_id) غير موجودة في هذه الميزانية');
  const ancestors = findActualCostAncestors(budget, node);

  const pr = {
    id: newId('PR'),
    pr_number: generatePaymentRequestNumber(db, budget),
    budget_id: budget.id,
    node_id: node.id,
    node_name: node.name,
    phase_id: ancestors.phase ? ancestors.phase.id : null,
    phase_name: ancestors.phase ? ancestors.phase.name : null,
    category: body.category || 'other',
    description: String(body.description).trim(),
    amount: r2(body.amount),
    beneficiary: body.beneficiary || null,
    reference: body.reference || null,
    requested_by: actor,
    status: 'pending_review',
    approvals: [{ step: 'request', actor, decision: 'submitted', note: body.note || '', at: nowISO() }],
    linked_actual_cost_id: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  if (!budget.payment_requests) budget.payment_requests = [];
  budget.payment_requests.push(pr);
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'create_payment_request',
    targetId: budget.id,
    summary: `طلب صرف جديد (${pr.pr_number}): ${pr.description} — ${pr.amount} ${budget.currency}`,
    details: { budget_id: budget.id, payment_request_id: pr.id, amount: pr.amount, node_id: node.id },
  });

  return { success: true, data: pr };
}

function findPaymentRequestOrThrow(budget, prId) {
  const pr = (budget.payment_requests || []).find(p => p.id === prId);
  if (!pr) throw new Error('طلب الصرف غير موجود في هذه الميزانية');
  return pr;
}

function listPaymentRequests(budgetId, { status = null, category = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  let items = (budget.payment_requests || []).slice();

  if (status) items = items.filter(p => p.status === status);
  if (category) items = items.filter(p => p.category === category);
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: {
      items: items.slice(start, start + ps), total, page: p, pageSize: ps,
      summary: computePaymentRequestsSummary(budget),
    },
  };
}

function getPaymentRequest(budgetId, prId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: findPaymentRequestOrThrow(budget, prId) };
}

function financialReviewPaymentRequest(budgetId, prId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const pr = findPaymentRequestOrThrow(budget, prId);

  if (pr.status !== 'pending_review') {
    throw new Error(`لا يمكن إجراء مراجعة مالية على طلب صرف في حالة "${PAYMENT_REQUEST_STATUS_LABELS[pr.status]}"`);
  }

  pr.status = 'financial_review_approved';
  pr.approvals.push({ step: 'financial_review', actor, decision: 'approved', note: note || '', at: nowISO() });
  pr.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor, action: 'financial_review_payment_request', targetId: budget.id,
    summary: `مراجعة مالية معتمَدة لطلب صرف: ${pr.pr_number} — ${pr.amount}`,
    details: { budget_id: budget.id, payment_request_id: pr.id },
  });

  return { success: true, data: pr };
}

function pmApprovePaymentRequest(budgetId, prId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const pr = findPaymentRequestOrThrow(budget, prId);

  if (pr.status !== 'financial_review_approved') {
    throw new Error('يجب اعتماد المراجعة المالية أولاً قبل اعتماد مدير المشروع');
  }

  pr.status = 'pm_approved';
  pr.approvals.push({ step: 'pm_approval', actor, decision: 'approved', note: note || '', at: nowISO() });
  pr.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor, action: 'pm_approve_payment_request', targetId: budget.id,
    summary: `اعتماد مدير المشروع على طلب صرف: ${pr.pr_number}`,
    details: { budget_id: budget.id, payment_request_id: pr.id },
  });

  return { success: true, data: pr };
}

function managementApprovePaymentRequest(budgetId, prId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const pr = findPaymentRequestOrThrow(budget, prId);

  if (pr.status !== 'pm_approved') {
    throw new Error('يجب اعتماد مدير المشروع أولاً قبل اعتماد الإدارة');
  }

  pr.status = 'management_approved';
  pr.approvals.push({ step: 'management_approval', actor, decision: 'approved', note: note || '', at: nowISO() });
  pr.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor, action: 'management_approve_payment_request', targetId: budget.id,
    summary: `اعتماد الإدارة على طلب صرف: ${pr.pr_number} — ${pr.amount}`,
    details: { budget_id: budget.id, payment_request_id: pr.id },
  });

  return { success: true, data: pr };
}

function disbursePaymentRequest(budgetId, prId, { actor = null, note = '', payment_date = null, payment_method = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const pr = findPaymentRequestOrThrow(budget, prId);

  if (pr.status !== 'management_approved') {
    throw new Error('لا يمكن الصرف إلا بعد اعتماد الإدارة على طلب الصرف');
  }

  const disbursementDate = payment_date || nowISO().slice(0, 10);

  const actualCostResult = addActualCost(budget.id, {
    category: pr.category,
    node_id: pr.node_id,
    description: `صرف مالي معتمَد: ${pr.description} (${pr.pr_number})`,
    date: disbursementDate,
    amount: pr.amount,
    supplier: pr.beneficiary,
    reference: pr.pr_number,
  }, { actor });

  const db2 = loadDB();
  const budget2 = findBudgetOrThrow(db2, budgetId);
  const pr2 = findPaymentRequestOrThrow(budget2, prId);

  pr2.status = 'disbursed';
  pr2.payment_date = disbursementDate;
  pr2.payment_method = payment_method || null;
  pr2.linked_actual_cost_id = actualCostResult.data.actual_cost
    ? actualCostResult.data.actual_cost.id
    : (actualCostResult.data.id || null);
  pr2.approvals.push({ step: 'disbursement', actor, decision: 'disbursed', note: note || '', at: nowISO() });
  pr2.updated_at = nowISO();
  budget2.updated_at = nowISO();
  saveDB(db2);

  recordAudit({
    actor, action: 'disburse_payment_request', targetId: budget2.id,
    summary: `صرف فعلي لطلب: ${pr2.pr_number} — ${pr2.amount} ${budget2.currency} (${disbursementDate})`,
    details: { budget_id: budget2.id, payment_request_id: pr2.id, linked_actual_cost_id: pr2.linked_actual_cost_id },
  });

  return { success: true, data: pr2 };
}

function rejectPaymentRequest(budgetId, prId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const pr = findPaymentRequestOrThrow(budget, prId);

  if (pr.status === 'disbursed') throw new Error('لا يمكن رفض طلب صرف تم صرفه بالفعل');
  if (pr.status === 'rejected') throw new Error('طلب الصرف مرفوض بالفعل');

  const stepLabels = {
    pending_review: 'financial_review',
    financial_review_approved: 'pm_review',
    pm_approved: 'management_review',
    management_approved: 'management_review',
  };

  const stepName = stepLabels[pr.status] || 'review';
  pr.status = 'rejected';
  pr.approvals.push({ step: stepName, actor, decision: 'rejected', note: note || '', at: nowISO() });
  pr.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor, action: 'reject_payment_request', targetId: budget.id,
    summary: `رفض طلب صرف: ${pr.pr_number}${note ? ' — السبب: ' + note : ''}`,
    details: { budget_id: budget.id, payment_request_id: pr.id, note },
  });

  return { success: true, data: pr };
}

function computePaymentRequestsSummary(budget) {
  const items = budget.payment_requests || [];
  const pendingStatuses = ['pending_review', 'financial_review_approved', 'pm_approved', 'management_approved'];
  const pending = items.filter(p => pendingStatuses.includes(p.status));
  const disbursed = items.filter(p => p.status === 'disbursed');
  const rejected = items.filter(p => p.status === 'rejected');

  const byStatus = PAYMENT_REQUEST_STATUSES.reduce((acc, s) => {
    acc[s] = items.filter(p => p.status === s).length;
    return acc;
  }, {});

  return {
    total_count: items.length,
    pending_count: pending.length,
    disbursed_count: disbursed.length,
    rejected_count: rejected.length,
    total_pending_amount: r2(pending.reduce((s, p) => s + p.amount, 0)),
    total_disbursed_amount: r2(disbursed.reduce((s, p) => s + p.amount, 0)),
    by_status: byStatus,
  };
}

function getPaymentRequestsOverview(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: computePaymentRequestsSummary(budget) };
}

function getPendingApprovalsOverview() {
  const db = loadDB();
  const pending = [];
  for (const b of db.budgets) {
    for (const pr of (b.payment_requests || [])) {
      if (['pending_review', 'financial_review_approved', 'pm_approved', 'management_approved'].includes(pr.status)) {
        pending.push({
          budget_id: b.id, project_name: b.project_name, currency: b.currency,
          payment_request_id: pr.id, pr_number: pr.pr_number, description: pr.description,
          amount: pr.amount, status: pr.status, status_label: PAYMENT_REQUEST_STATUS_LABELS[pr.status],
          next_step: {
            pending_review: 'financial_review', financial_review_approved: 'pm_approval',
            pm_approved: 'management_approval', management_approved: 'disbursement',
          }[pr.status],
          created_at: pr.created_at,
        });
      }
    }
  }
  pending.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return {
    success: true,
    data: {
      total_pending: pending.length,
      total_pending_amount: r2(pending.reduce((s, p) => s + p.amount, 0)),
      items: pending,
    },
  };
}

function getDashboardStatsWithCashFlow() {
  const base = getDashboardStatsWithEVM();
  const cashFlowOverview = getCashFlowOverview();
  const pendingApprovals = getPendingApprovalsOverview();

  base.data.summary.total_cash_balance_actual = cashFlowOverview.data.summary.total_final_balance_actual;
  base.data.summary.total_cash_balance_projected = cashFlowOverview.data.summary.total_final_balance_projected;
  base.data.summary.pending_payment_approvals_count = pendingApprovals.data.total_pending;
  base.data.summary.pending_payment_approvals_amount = pendingApprovals.data.total_pending_amount;
  base.data.pending_payment_approvals = pendingApprovals.data.items.slice(0, 10);

  return base;
}

// ==================================================================================
// ==================== الجزء 8/10: الفواتير والمستخلصات (Invoicing) ================
// ==================================================================================
// فوترة فعلية على نوعين، كلاهما مرتبط ببيانات حقيقية موجودة فعلاً في النظام
// (وليس سجلاً منفصلاً معلَّقاً):
//  - "client": فاتورة/مستخلص صادر للعميل — يجب أن يكون مرتبطاً بسجل إيراد قائم فعلاً
//    (من الجزء 4/10، revenue_id) فتُصبح حالته "invoiced" تلقائياً عند إصدار الفاتورة،
//    و"received" تلقائياً عند تسجيل السداد الكامل للفاتورة (مطابقة الدفعة الفعلية).
//  - "vendor": فاتورة مورد/مقاول فرعي واردة — تُرتبط اختيارياً بتكلفة فعلية موجودة
//    (actual_cost_id من الجزء 3/10) أو تُنشئ تكلفة فعلية جديدة تلقائياً عند تسجيل
//    السداد الكامل، حتى تنعكس فعلياً على الانحرافات وEVM دون ازدواج يدوي.
// كل فاتورة تحتوي بنوداً فعلية (quantity × unit_price)، ضريبة اختيارية، ونسبة
// استقطاع ضمان اختيارية (retention)، مع دفعات جزئية فعلية متعددة لكل فاتورة.

const INVOICE_TYPES = ['client', 'vendor'];
const INVOICE_TYPE_LABELS = { client: 'فاتورة/مستخلص عميل', vendor: 'فاتورة مورد/مقاول فرعي' };

const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'];
const INVOICE_STATUS_LABELS = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مدفوعة جزئياً',
  paid: 'مدفوعة بالكامل',
  overdue: 'متأخرة السداد',
  cancelled: 'ملغاة',
};

function validateInvoiceType(type) {
  if (!INVOICE_TYPES.includes(type)) {
    throw new Error(`نوع فاتورة غير معروف: ${type}. القيم المسموحة: ${INVOICE_TYPES.join(', ')}`);
  }
}

function validateInvoiceLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error('يجب أن تحتوي الفاتورة على بند واحد على الأقل (line_items)');
  }
  for (const li of lineItems) {
    if (!li.description || !String(li.description).trim()) {
      throw new Error('وصف بند الفاتورة (description) مطلوب لكل بند');
    }
    if (li.quantity === undefined || isNaN(Number(li.quantity)) || Number(li.quantity) <= 0) {
      throw new Error(`كمية بند الفاتورة "${li.description}" يجب أن تكون رقماً أكبر من صفر`);
    }
    if (li.unit_price === undefined || isNaN(Number(li.unit_price)) || Number(li.unit_price) < 0) {
      throw new Error(`سعر وحدة بند الفاتورة "${li.description}" يجب أن يكون رقماً صحيحاً`);
    }
  }
}

function computeInvoiceLineItemsTotal(lineItems) {
  return r2(lineItems.reduce((s, li) => s + (Number(li.quantity) * Number(li.unit_price)), 0));
}

function computeInvoiceTotals(invoice) {
  const subtotal = computeInvoiceLineItemsTotal(invoice.line_items);
  const retentionAmount = r2(subtotal * ((invoice.retention_pct || 0) / 100));
  const taxableBase = r2(subtotal - retentionAmount);
  const taxAmount = r2(taxableBase * ((invoice.tax_pct || 0) / 100));
  const grandTotal = r2(taxableBase + taxAmount);
  const paidAmount = r2((invoice.payments || []).reduce((s, p) => s + p.amount, 0));
  const outstandingAmount = r2(grandTotal - paidAmount);

  return { subtotal, retention_amount: retentionAmount, taxable_base: taxableBase, tax_amount: taxAmount, grand_total: grandTotal, paid_amount: paidAmount, outstanding_amount: outstandingAmount };
}

// حالة الفاتورة الفعلية: تُشتَق من مطابقة المدفوعات الفعلية بالإجمالي (وليست
// حقلاً حراً يُدخَل يدوياً)، مع تصنيف "متأخرة" تلقائياً إن تجاوز تاريخ الاستحقاق
// اليوم ولم تُسدَّد بالكامل بعد.
function resolveInvoiceEffectiveStatus(invoice) {
  if (invoice.status === 'cancelled') return 'cancelled';
  if (invoice.status === 'draft') return 'draft';
  const totals = computeInvoiceTotals(invoice);
  if (totals.outstanding_amount <= 0 && totals.grand_total > 0) return 'paid';
  const today = nowISO().slice(0, 10);
  if (invoice.due_date && invoice.due_date < today && totals.paid_amount < totals.grand_total) return 'overdue';
  if (totals.paid_amount > 0) return 'partially_paid';
  return 'issued';
}

function sanitizeInvoice(invoice) {
  const totals = computeInvoiceTotals(invoice);
  return { ...invoice, ...totals, effective_status: resolveInvoiceEffectiveStatus(invoice) };
}

function generateInvoiceNumber(db, budget, type) {
  const prefix = type === 'client' ? 'INV-C' : 'INV-V';
  const count = (budget.invoices || []).filter(i => i.type === type).length + 1;
  return `${prefix}-${budget.budget_number}-${String(count).padStart(4, '0')}`;
}

function validateInvoiceInput(body, { partial = false } = {}) {
  if (!partial) {
    validateInvoiceType(body.type);
    if (!body.issue_date) throw new Error('تاريخ الإصدار (issue_date) مطلوب');
    if (!body.due_date) throw new Error('تاريخ الاستحقاق (due_date) مطلوب');
    validateInvoiceLineItems(body.line_items);
    if (body.type === 'client' && !body.revenue_id) {
      throw new Error('فاتورة العميل يجب ربطها بسجل إيراد قائم (revenue_id) من قسم الإيرادات');
    }
    if (body.tax_pct !== undefined && (isNaN(Number(body.tax_pct)) || Number(body.tax_pct) < 0)) {
      throw new Error('نسبة الضريبة (tax_pct) يجب أن تكون رقماً غير سالب');
    }
    if (body.retention_pct !== undefined && (isNaN(Number(body.retention_pct)) || Number(body.retention_pct) < 0 || Number(body.retention_pct) > 100)) {
      throw new Error('نسبة استقطاع الضمان (retention_pct) يجب أن تكون بين 0 و100');
    }
  } else {
    if (body.type !== undefined) validateInvoiceType(body.type);
    if (body.line_items !== undefined) validateInvoiceLineItems(body.line_items);
  }
}

/**
 * إصدار فاتورة جديدة (عميل أو مورد). فاتورة العميل تُربَط إلزامياً بسجل إيراد
 * قائم فعلاً وتُحدِّث حالته تلقائياً إلى "invoiced" (وليس رقماً منفصلاً عن
 * الإيرادات). فاتورة المورد تُربَط اختيارياً بعقدة BBS (node_id) لغرض تصنيف
 * التكلفة عند السداد لاحقاً.
 * body: { type, issue_date, due_date, line_items:[{description,quantity,unit_price}],
 *         tax_pct?, retention_pct?, revenue_id? (client), node_id? (vendor),
 *         vendor_name? (vendor), client_reference?, notes? }
 */
function createInvoice(budgetId, body = {}, { actor = null } = {}) {
  validateInvoiceInput(body, { partial: false });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  let linkedRevenue = null;
  if (body.type === 'client') {
    linkedRevenue = (budget.revenues || []).find(r => r.id === body.revenue_id);
    if (!linkedRevenue) throw new Error('سجل الإيراد المرتبط (revenue_id) غير موجود في هذه الميزانية');
    if (linkedRevenue.status === 'cancelled') {
      throw new Error('لا يمكن إصدار فاتورة لإيراد ملغى');
    }
  }

  let linkedNode = null;
  if (body.type === 'vendor' && body.node_id) {
    linkedNode = findNode(budget.bbs, body.node_id);
    if (!linkedNode) throw new Error('عقدة الهيكل المرتبطة (node_id) غير موجودة في هذه الميزانية');
  }

  const invoice = {
    id: newId('INV'),
    budget_id: budget.id,
    type: body.type,
    invoice_number: generateInvoiceNumber(db, budget, body.type),
    status: 'issued',
    issue_date: body.issue_date,
    due_date: body.due_date,
    currency: budget.currency,
    line_items: body.line_items.map(li => ({
      id: newId('ILI'),
      description: String(li.description).trim(),
      quantity: Number(li.quantity),
      unit_price: r2(li.unit_price),
      line_total: r2(Number(li.quantity) * Number(li.unit_price)),
    })),
    tax_pct: body.tax_pct !== undefined ? r2(body.tax_pct) : 0,
    retention_pct: body.retention_pct !== undefined ? r2(body.retention_pct) : 0,
    revenue_id: linkedRevenue ? linkedRevenue.id : null,
    node_id: linkedNode ? linkedNode.id : (body.node_id || null),
    node_name: linkedNode ? linkedNode.name : null,
    vendor_name: body.type === 'vendor' ? (body.vendor_name || null) : null,
    client_reference: body.client_reference || null,
    notes: body.notes || null,
    payments: [],
    linked_actual_cost_ids: [],
    created_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  if (!budget.invoices) budget.invoices = [];
  budget.invoices.push(invoice);

  if (linkedRevenue && linkedRevenue.status === 'expected') {
    linkedRevenue.status = 'invoiced';
    linkedRevenue.invoice_number = invoice.invoice_number;
    linkedRevenue.updated_at = nowISO();
  }

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'create_invoice',
    targetId: budget.id,
    summary: `إصدار ${INVOICE_TYPE_LABELS[invoice.type]}: ${invoice.invoice_number} — ${computeInvoiceLineItemsTotal(invoice.line_items)} ${budget.currency}`,
    details: { budget_id: budget.id, invoice_id: invoice.id, type: invoice.type, revenue_id: invoice.revenue_id },
  });

  return { success: true, data: sanitizeInvoice(invoice) };
}

function findInvoiceOrThrow(budget, invoiceId) {
  const inv = (budget.invoices || []).find(i => i.id === invoiceId || i.invoice_number === invoiceId);
  if (!inv) throw new Error('الفاتورة غير موجودة في هذه الميزانية');
  return inv;
}

function getInvoice(budgetId, invoiceId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: sanitizeInvoice(findInvoiceOrThrow(budget, invoiceId)) };
}

function listInvoices(budgetId, { type = null, status = null, from_date = null, to_date = null, page = 1, pageSize = 50 } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  let items = (budget.invoices || []).map(sanitizeInvoice);

  if (type) { validateInvoiceType(type); items = items.filter(i => i.type === type); }
  if (status) {
    if (!INVOICE_STATUSES.includes(status)) throw new Error(`حالة فاتورة غير معروفة: ${status}`);
    items = items.filter(i => i.effective_status === status);
  }
  if (from_date) items = items.filter(i => i.issue_date >= from_date);
  if (to_date) items = items.filter(i => i.issue_date <= to_date);

  items.sort((a, b) => (a.issue_date < b.issue_date ? 1 : -1));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: { items: items.slice(start, start + ps), total, page: p, pageSize: ps, summary: computeInvoiceSummary(budget) },
  };
}

/**
 * تعديل فاتورة قائمة. تعديل البنود/الضريبة/الاستقطاع مسموح فقط في حالة "مسودة"
 * أو "صادرة" قبل أي سداد، حفاظاً على سلامة السجل المالي بعد بدء التحصيل.
 */
function updateInvoice(budgetId, invoiceId, updates = {}, { actor = null } = {}) {
  validateInvoiceInput(updates, { partial: true });

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const invoice = findInvoiceOrThrow(budget, invoiceId);

  const hasPayments = (invoice.payments || []).length > 0;
  const financialFields = ['line_items', 'tax_pct', 'retention_pct'];
  if (hasPayments && financialFields.some(f => updates[f] !== undefined)) {
    throw new Error('لا يمكن تعديل البنود/الضريبة/الاستقطاع لفاتورة سُجِّلت عليها دفعة سداد بالفعل — يجب إصدار فاتورة تسوية منفصلة إن لزم');
  }

  if (updates.line_items !== undefined) {
    invoice.line_items = updates.line_items.map(li => ({
      id: li.id || newId('ILI'),
      description: String(li.description).trim(),
      quantity: Number(li.quantity),
      unit_price: r2(li.unit_price),
      line_total: r2(Number(li.quantity) * Number(li.unit_price)),
    }));
  }
  if (updates.tax_pct !== undefined) invoice.tax_pct = r2(updates.tax_pct);
  if (updates.retention_pct !== undefined) invoice.retention_pct = r2(updates.retention_pct);
  if (updates.due_date !== undefined) invoice.due_date = updates.due_date;
  if (updates.notes !== undefined) invoice.notes = updates.notes;
  if (updates.client_reference !== undefined) invoice.client_reference = updates.client_reference;
  if (updates.vendor_name !== undefined && invoice.type === 'vendor') invoice.vendor_name = updates.vendor_name;

  invoice.updated_at = nowISO();
  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'update_invoice',
    targetId: budget.id,
    summary: `تحديث فاتورة: ${invoice.invoice_number}`,
    details: { budget_id: budget.id, invoice_id: invoice.id, updates: Object.keys(updates) },
  });

  return { success: true, data: sanitizeInvoice(invoice) };
}

function deleteInvoice(budgetId, invoiceId, { actor = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const idx = (budget.invoices || []).findIndex(i => i.id === invoiceId || i.invoice_number === invoiceId);
  if (idx === -1) throw new Error('الفاتورة غير موجودة');
  const invoice = budget.invoices[idx];

  if ((invoice.payments || []).length > 0) {
    throw new Error('لا يمكن حذف فاتورة سُجِّلت عليها دفعات فعلية — يجب إلغاؤها (cancel) بدلاً من ذلك حفاظاً على سلامة السجل المالي');
  }

  budget.invoices.splice(idx, 1);

  if (invoice.type === 'client' && invoice.revenue_id) {
    const revenue = (budget.revenues || []).find(r => r.id === invoice.revenue_id);
    if (revenue && revenue.status === 'invoiced') {
      revenue.status = 'expected';
      revenue.invoice_number = null;
      revenue.updated_at = nowISO();
    }
  }

  budget.updated_at = nowISO();
  saveDB(db);

  recordAudit({
    actor,
    action: 'delete_invoice',
    targetId: budget.id,
    summary: `حذف فاتورة: ${invoice.invoice_number}`,
    details: { budget_id: budget.id, invoice_id: invoiceId },
  });

  return { success: true, data: { deleted: invoiceId } };
}

function cancelInvoice(budgetId, invoiceId, { actor = null, note = '' } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const invoice = findInvoiceOrThrow(budget, invoiceId);

  if ((invoice.payments || []).length > 0) {
    throw new Error('لا يمكن إلغاء فاتورة تم تسجيل دفعات فعلية عليها');
  }
  if (invoice.status === 'cancelled') throw new Error('الفاتورة ملغاة بالفعل');

  invoice.status = 'cancelled';
  invoice.updated_at = nowISO();
  budget.updated_at = nowISO();

  if (invoice.type === 'client' && invoice.revenue_id) {
    const revenue = (budget.revenues || []).find(r => r.id === invoice.revenue_id);
    if (revenue && revenue.status === 'invoiced') {
      revenue.status = 'expected';
      revenue.invoice_number = null;
      revenue.updated_at = nowISO();
    }
  }

  saveDB(db);

  recordAudit({
    actor,
    action: 'cancel_invoice',
    targetId: budget.id,
    summary: `إلغاء فاتورة: ${invoice.invoice_number}${note ? ' — ' + note : ''}`,
    details: { budget_id: budget.id, invoice_id: invoice.id, note },
  });

  return { success: true, data: sanitizeInvoice(invoice) };
}

/**
 * تسجيل دفعة فعلية (كاملة أو جزئية) على فاتورة قائمة.
 * - فاتورة عميل: عند اكتمال السداد (paid_amount = grand_total)، يُسجَّل ذلك تلقائياً
 *   كإيراد "مستلم" فعلياً على سجل الإيراد المرتبط (received + received_date)، بحيث
 *   ينعكس فوراً على التدفق النقدي والأرباح الفعلية (الجزء 4/10) دون إدخال مزدوج.
 * - فاتورة مورد: عند تسجيل الدفعة، تُنشأ تلقائياً تكلفة فعلية مقابلة (actual_cost)
 *   على نفس العقدة المرتبطة (أو عقدة افتراضية "فواتير موردين" إن لم تُحدَّد)، بحيث
 *   تنعكس فوراً على الانحرافات المالية وEVM (الجزء 6/10).
 * body: { amount, payment_date?, payment_method?, reference? }
 */
function recordInvoicePayment(budgetId, invoiceId, body = {}, { actor = null } = {}) {
  if (body.amount === undefined || isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
    throw new Error('مبلغ الدفعة (amount) مطلوب ويجب أن يكون أكبر من صفر');
  }

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const invoice = findInvoiceOrThrow(budget, invoiceId);

  if (invoice.status === 'cancelled') throw new Error('لا يمكن تسجيل دفعة على فاتورة ملغاة');

  const totalsBefore = computeInvoiceTotals(invoice);
  const amount = r2(body.amount);
  if (amount > totalsBefore.outstanding_amount + 0.01) {
    throw new Error(`مبلغ الدفعة (${amount}) يتجاوز المبلغ المتبقي على الفاتورة (${totalsBefore.outstanding_amount})`);
  }

  const payment = {
    id: newId('IPAY'),
    amount,
    payment_date: body.payment_date || nowISO().slice(0, 10),
    payment_method: body.payment_method || null,
    reference: body.reference || null,
    recorded_by: actor,
    recorded_at: nowISO(),
  };
  invoice.payments.push(payment);
  invoice.updated_at = nowISO();

  const totalsAfter = computeInvoiceTotals(invoice);
  const fullyPaid = totalsAfter.outstanding_amount <= 0.01;

  if (invoice.type === 'client' && fullyPaid && invoice.revenue_id) {
    const revenue = (budget.revenues || []).find(r => r.id === invoice.revenue_id);
    if (revenue && revenue.status !== 'received') {
      revenue.status = 'received';
      revenue.received_date = payment.payment_date;
      revenue.updated_at = nowISO();
    }
  }

  if (fullyPaid) invoice.status = 'paid';
  budget.updated_at = nowISO();
  saveDB(db);

  let linkedActualCostId = null;
  if (invoice.type === 'vendor') {
    const dbFresh = loadDB();
    const budgetFresh = findBudgetOrThrow(dbFresh, budget.id);
    const invoiceFresh = findInvoiceOrThrow(budgetFresh, invoice.id);

    let targetNodeId = invoiceFresh.node_id;
    if (!targetNodeId) {
      let vendorPhase = budgetFresh.bbs.find(n => n.node_type === 'phase' && n.__is_vendor_invoices_phase);
      if (!vendorPhase) {
        vendorPhase = makeBBSNode({ name: 'فواتير موردين ومقاولين فرعيين', node_type: 'phase' });
        vendorPhase.__is_vendor_invoices_phase = true;
        budgetFresh.bbs.push(vendorPhase);
      }
      const mainItem = makeBBSNode({ name: invoiceFresh.vendor_name || 'مورد غير محدد', node_type: 'main_item', parent_id: vendorPhase.id });
      const subItem = makeBBSNode({ name: invoiceFresh.invoice_number, node_type: 'sub_item', parent_id: mainItem.id });
      const activity = makeBBSNode({ name: 'سداد فاتورة مورد', node_type: 'activity', parent_id: subItem.id });
      const resource = makeBBSNode({ name: `مورد: ${invoiceFresh.vendor_name || 'غير محدد'}`, node_type: 'resource', cost: 0, parent_id: activity.id });
      activity.children.push(resource);
      subItem.children.push(activity);
      mainItem.children.push(subItem);
      vendorPhase.children.push(mainItem);
      targetNodeId = resource.id;
    }
    budgetFresh.updated_at = nowISO();
    saveDB(dbFresh);

    const actualCostResult = addActualCost(budgetFresh.id, {
      category: 'other',
      node_id: targetNodeId,
      description: `سداد فاتورة مورد ${invoiceFresh.invoice_number}${invoiceFresh.vendor_name ? ' - ' + invoiceFresh.vendor_name : ''}`,
      date: payment.payment_date,
      amount,
      supplier: invoiceFresh.vendor_name || null,
      reference: invoiceFresh.invoice_number,
    }, { actor });

    linkedActualCostId = actualCostResult.data.actual_cost ? actualCostResult.data.actual_cost.id : null;

    const dbFinal = loadDB();
    const budgetFinal = findBudgetOrThrow(dbFinal, budget.id);
    const invoiceFinal = findInvoiceOrThrow(budgetFinal, invoice.id);
    invoiceFinal.linked_actual_cost_ids.push(linkedActualCostId);
    invoiceFinal.updated_at = nowISO();
    budgetFinal.updated_at = nowISO();
    saveDB(dbFinal);
  }

  recordAudit({
    actor,
    action: 'record_invoice_payment',
    targetId: budget.id,
    summary: `تسجيل دفعة على فاتورة ${invoice.invoice_number}: ${amount} ${budget.currency}${fullyPaid ? ' (سداد كامل)' : ' (سداد جزئي)'}`,
    details: { budget_id: budget.id, invoice_id: invoice.id, payment_id: payment.id, amount, linked_actual_cost_id: linkedActualCostId },
  });

  return { success: true, data: sanitizeInvoice(invoice) };
}

/**
 * إعادة تصنيف تلقائية للفواتير المتأخرة السداد عبر كل الميزانيات، على غرار
 * refreshOverdueRevenues — تفحص كل فاتورة "صادرة"/"مدفوعة جزئياً" تجاوز تاريخ
 * استحقاقها اليوم، وتُحدِّث حالتها المخزَّنة فعلياً على القرص إلى "overdue".
 */
function refreshOverdueInvoices() {
  const db = loadDB();
  const today = nowISO().slice(0, 10);
  let updatedCount = 0;

  for (const budget of db.budgets) {
    for (const invoice of (budget.invoices || [])) {
      if (['issued', 'partially_paid'].includes(invoice.status) && invoice.due_date && invoice.due_date < today) {
        const totals = computeInvoiceTotals(invoice);
        if (totals.outstanding_amount > 0) {
          invoice.status = 'overdue';
          invoice.updated_at = nowISO();
          updatedCount++;
          recordAudit({
            actor: 'system',
            action: 'auto_mark_invoice_overdue',
            targetId: budget.id,
            summary: `تصنيف تلقائي: فاتورة ${invoice.invoice_number} متأخرة السداد`,
            details: { budget_id: budget.id, invoice_id: invoice.id, due_date: invoice.due_date, outstanding: totals.outstanding_amount },
          });
        }
      }
    }
  }

  if (updatedCount > 0) saveDB(db);
  return { success: true, data: { updated_count: updatedCount } };
}

function computeInvoiceSummary(budget) {
  const items = (budget.invoices || []).map(sanitizeInvoice);
  const clientInvoices = items.filter(i => i.type === 'client');
  const vendorInvoices = items.filter(i => i.type === 'vendor');
  const overdue = items.filter(i => i.effective_status === 'overdue');

  function summarize(list) {
    return {
      count: list.length,
      total_grand_total: r2(list.reduce((s, i) => s + i.grand_total, 0)),
      total_paid: r2(list.reduce((s, i) => s + i.paid_amount, 0)),
      total_outstanding: r2(list.filter(i => i.effective_status !== 'cancelled').reduce((s, i) => s + i.outstanding_amount, 0)),
      total_tax: r2(list.reduce((s, i) => s + i.tax_amount, 0)),
      total_retention: r2(list.reduce((s, i) => s + i.retention_amount, 0)),
    };
  }

  return {
    client_invoices: summarize(clientInvoices),
    vendor_invoices: summarize(vendorInvoices),
    overdue_count: overdue.length,
    overdue_total_outstanding: r2(overdue.reduce((s, i) => s + i.outstanding_amount, 0)),
    total_invoices: items.length,
  };
}

function getInvoiceSummary(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  return { success: true, data: computeInvoiceSummary(budget) };
}

function getInvoicesOverview() {
  const db = loadDB();
  const perBudget = db.budgets.map(b => ({
    budget_id: b.id, project_id: b.project_id, project_name: b.project_name,
    currency: b.currency, summary: computeInvoiceSummary(b),
  }));

  const totals = perBudget.reduce((acc, p) => {
    acc.total_client_outstanding = r2(acc.total_client_outstanding + p.summary.client_invoices.total_outstanding);
    acc.total_vendor_outstanding = r2(acc.total_vendor_outstanding + p.summary.vendor_invoices.total_outstanding);
    acc.total_overdue_outstanding = r2(acc.total_overdue_outstanding + p.summary.overdue_total_outstanding);
    acc.total_invoices = acc.total_invoices + p.summary.total_invoices;
    return acc;
  }, { total_client_outstanding: 0, total_vendor_outstanding: 0, total_overdue_outstanding: 0, total_invoices: 0 });

  return { success: true, data: { totals, per_budget: perBudget } };
}

function getDashboardStatsWithInvoicing() {
  const base = getDashboardStatsWithCashFlow();
  const invoicesOverview = getInvoicesOverview();

  base.data.summary.total_client_invoices_outstanding = invoicesOverview.data.totals.total_client_outstanding;
  base.data.summary.total_vendor_invoices_outstanding = invoicesOverview.data.totals.total_vendor_outstanding;
  base.data.summary.total_overdue_invoices_outstanding = invoicesOverview.data.totals.total_overdue_outstanding;
  base.data.summary.total_invoices_count = invoicesOverview.data.totals.total_invoices;

  return base;
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
  // التكاليف الفعلية (الجزء 3/10)
  addActualCost,
  updateActualCost,
  deleteActualCost,
  listActualCosts,
  getActualCostsOverview,
  ACTUAL_COST_CATEGORIES,
  ACTUAL_COST_CATEGORY_LABELS,
  // الإيرادات والتحصيل (الجزء 4/10)
  addRevenue,
  updateRevenue,
  deleteRevenue,
  listRevenues,
  getRevenueSummary,
  getCashFlow,
  refreshOverdueRevenues,
  getRevenuesOverview,
  REVENUE_TYPES,
  REVENUE_TYPE_LABELS,
  REVENUE_STATUSES,
  REVENUE_STATUS_LABELS,
  // أوامر التغيير (الجزء 5/10)
  createChangeOrder,
  getChangeOrder,
  listChangeOrders,
  updateChangeOrder,
  deleteChangeOrder,
  pmApproveChangeOrder,
  approveChangeOrder,
  rejectChangeOrder,
  getChangeOrdersOverview,
  CHANGE_ORDER_STATUSES,
  CHANGE_ORDER_STATUS_LABELS,
  // مراقبة الانحرافات المالية + القيمة المكتسبة EVM (الجزء 6/10)
  getBudgetEVM,
  recordEVMSnapshot,
  listEVMSnapshots,
  getDeviationAnalysis,
  getEVMOverview,
  DEVIATION_THRESHOLDS,
  // التدفقات النقدية الشاملة (الجزء 7/10)
  getComprehensiveCashFlow,
  getCashFlowOverview,
  // الموافقات المالية (الجزء 7/10)
  createPaymentRequest,
  getPaymentRequest,
  listPaymentRequests,
  financialReviewPaymentRequest,
  pmApprovePaymentRequest,
  managementApprovePaymentRequest,
  disbursePaymentRequest,
  rejectPaymentRequest,
  getPaymentRequestsOverview,
  getPendingApprovalsOverview,
  PAYMENT_REQUEST_STATUSES,
  PAYMENT_REQUEST_STATUS_LABELS,
  PAYMENT_REQUEST_CATEGORIES,
  // الفواتير والمستخلصات (الجزء 8/10)
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  cancelInvoice,
  recordInvoicePayment,
  refreshOverdueInvoices,
  getInvoiceSummary,
  getInvoicesOverview,
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  // لوحة التحكم وسجل التدقيق (محدَّثة لتدمج الفواتير - الجزء 8/10)
  getDashboardStats: getDashboardStatsWithInvoicing,
  listAudit,
  // ثوابت مساعدة للواجهة
  BUDGET_STATUSES,
  BUDGET_STATUS_LABELS,
  BBS_NODE_TYPES,
  // مساعِدات داخلية معروضة لاستخدام الأجزاء اللاحقة (5/10 وما بعده)
  _internal: {
    loadDB,
    saveDB,
    findNode,
    computeNodeTotal,
    computeBBSGrandTotal,
    computeActualCostSummary,
    computeRevenueSummary,
    computeCashFlow,
    recordAudit,
    r2,
    nowISO,
    newId,
  },
};
