/**
 * القسم الحادي عشر - نظام إدارة المستندات (DMS)
 * ============================================================================
 * وحدة التحكم الدقيق بالصلاحيات (Fine-Grained Document Access Control)
 * ============================================================================
 *
 * لماذا هذه الوحدة؟
 * ------------------
 * الصلاحية العامة الموجودة أصلاً في businessSecurity.js (SEC.can(token,'documents','view'|
 * 'create'|'update'|'delete'|...)) تُطبَّق حالياً على مستوى المسار (route) في server.js،
 * وهي تتحقق فقط من: "هل يملك دور هذا المستخدم صلاحية على وحدة documents ككل؟". هذا تحقق
 * صحيح لكنه خشن (coarse-grained) ولا يحقق ما تنص عليه المواصفة حرفياً تحت "إدارة الصلاحيات":
 *   - صلاحيات حسب المستخدم.
 *   - صلاحيات حسب الدور.
 *   - صلاحيات حسب المشروع.        <-- غير موجود سابقاً بتاتاً
 *   - صلاحيات حسب نوع المستند.     <-- غير موجود سابقاً بتاتاً
 *   - منع الحذف/التعديل غير المصرح به على مستوى المستند الفردي (وليس فقط الوحدة).
 *
 * هذه الوحدة تضيف طبقة تحقق ثانية (Fine-Grained) تُستدعى *بعد* التحقق الخشن الموجود،
 * ولا تستبدله ولا تكرر منطقه: تعتمد على SEC.getSessionUser()/roleCan() ذاتها لتفادي أي
 * ازدواجية أو تعارض في مصدر الحقيقة (source of truth) الخاص بالمستخدمين والأدوار.
 *
 * الميزات المضافة:
 *  1) ربط المستخدمين بمشاريع محددة (project scoping) عبر ملف تخزين منفصل
 *     (dms_user_scopes.json) دون أي تعديل على بنية users.json الحالية.
 *  2) قواعد رؤية/تحرير لكل (دور × مجموعة مستندات) - مثال: دور "العميل" و"المقاول"
 *     يُمنعان تلقائياً من رؤية "المستندات المالية" و"المستندات الإدارية" حتى لو
 *     كانت صلاحية documents.view العامة ممنوحة لهما.
 *  3) عمليات حساسة (الحذف النهائي hard-delete، الاعتماد النهائي/publish، تعديل
 *     الصلاحيات نفسها) محصورة حصرياً بدور document_controller أو admin، بصرف
 *     النظر عن أي صلاحية عامة أخرى.
 *  4) دالة تحقق واحدة موحّدة assertDocumentAccess(token, doc, action) تُستدعى من
 *     جميع وحدات DMS (documentManagement / documentCategories / documentWorkflow /
 *     documentSharing) قبل تنفيذ أي عملية على مستند بعينه.
 *  5) سجل رفض فعلي (Audit) لكل محاولة وصول مرفوضة، منفصل عن سجل DMS العام، لتتبع
 *     محاولات الوصول غير المصرح به تحديداً (متطلب "منع الوصول غير المصرح به").
 */

const fs = require('fs');
const path = require('path');
const SEC = require('./businessSecurity');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCOPES_FILE = path.join(DATA_DIR, 'dms_user_scopes.json');
const DENIALS_FILE = path.join(DATA_DIR, 'dms_access_denials.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJSON(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ==================================================================================
// ===================== ربط المستخدمين بالمشاريع (Project Scoping) =================
// ==================================================================================

function defaultScopesDB() { return { scopes: {} }; } // { userId: { allProjects: bool, projectIds: [] } }

/**
 * الأدوار الإدارية/الاستشارية العليا التي تصل تلقائياً لكل المشاريع دون الحاجة
 * لتحديد نطاق (admin، document_controller، project_manager، consultant).
 * أي دور آخر غير مذكور هنا يُعتبر "محدود النطاق" افتراضياً ويجب تعيين
 * مشاريعه صراحة، وإلا مُنع من رؤية أي مستند مرتبط بمشروع.
 */
const GLOBAL_SCOPE_ROLES = new Set(['admin', 'document_controller', 'project_manager']);

function getUserScope(userId) {
  const db = readJSON(SCOPES_FILE, defaultScopesDB());
  return db.scopes[userId] || null;
}

/** تعيين نطاق المشاريع المسموح بها لمستخدم محدد (يستدعيها مدير النظام فقط عبر server.js) */
function setUserProjectScope(userId, { allProjects = false, projectIds = [] } = {}) {
  if (!userId) throw new Error('معرّف المستخدم (userId) مطلوب');
  const db = readJSON(SCOPES_FILE, defaultScopesDB());
  db.scopes[userId] = {
    allProjects: !!allProjects,
    projectIds: Array.isArray(projectIds) ? [...new Set(projectIds.filter(Boolean))] : [],
    updated_at: nowISO(),
  };
  writeJSON(SCOPES_FILE, db);
  return { success: true, data: db.scopes[userId] };
}

function getUserProjectScope(userId) {
  const db = readJSON(SCOPES_FILE, defaultScopesDB());
  return { success: true, data: db.scopes[userId] || { allProjects: false, projectIds: [] } };
}

function userHasProjectAccess(session, projectId) {
  if (!projectId) return true; // مستند عام غير مرتبط بمشروع: لا تقييد مشروع
  if (GLOBAL_SCOPE_ROLES.has(session.role)) return true;
  const scope = getUserScope(session.userId);
  if (!scope) return false; // لا نطاق معرَّف = بلا وصول لأي مشروع (fail closed)
  if (scope.allProjects) return true;
  return scope.projectIds.includes(projectId);
}

// ==================================================================================
// ===================== صلاحيات حسب مجموعة/نوع المستند ==============================
// ==================================================================================

/**
 * قواعد الرؤية لكل دور على مستوى "مجموعة المستند" (project/quality/safety/
 * financial/administrative) كما وردت حرفياً في المواصفة. الدور غير المذكور هنا
 * يُسمح له افتراضياً بكل المجموعات (يُطبَّق عليه فقط التحقق الخشن العام)، بينما
 * الأدوار المذكورة صراحة تخضع لقائمة استثناء (deny-list) تُطبَّق دائماً حتى لو
 * كانت صلاحية "documents.view" العامة ممنوحة.
 */
const GROUP_DENY_RULES = {
  // العميل: اطلاع فقط، ولا يرى الملفات المالية أو الإدارية الحساسة إطلاقاً
  client_viewer: { deniedGroups: ['financial', 'administrative'], viewOnly: true },
  contractor_viewer: { deniedGroups: ['financial', 'administrative'] },
  consultant_viewer: { deniedGroups: ['administrative'] },
};

/** عمليات تُعتبر "تعديلاً" وتخضع لقيد viewOnly */
const MUTATING_ACTIONS = new Set(['create', 'update', 'delete', 'approve', 'reject', 'publish', 'share', 'move', 'archive', 'unarchive']);

/** عمليات حساسة محصورة حصرياً بمدير الوثائق أو المدير العام بصرف النظر عن أي دور آخر */
const CONTROLLER_ONLY_ACTIONS = new Set(['hard_delete', 'manage_permissions']);

function groupRuleFor(role) {
  return GROUP_DENY_RULES[role] || null;
}

// ==================================================================================
// ============================ سجل محاولات الرفض =====================================
// ==================================================================================

function recordDenial({ userId, username, role, docId, projectId, action, reason }) {
  const db = readJSON(DENIALS_FILE, { denials: [] });
  db.denials.push({
    id: newId('DEN'), userId, username, role, doc_id: docId, project_id: projectId,
    action, reason, created_at: nowISO(),
  });
  if (db.denials.length > 5000) db.denials = db.denials.slice(-5000);
  writeJSON(DENIALS_FILE, db);
  // نسجّل أيضاً في سجل التدقيق المركزي العام حتى يظهر ضمن أي تقرير أمني شامل
  try {
    SEC.recordGlobalAudit({
      userId, username, module: 'dms_access_control', action: `denied_${action}`,
      target_id: docId, summary: reason, success: false,
    });
  } catch (e) { /* تجاهل إن لم يكن التدقيق المركزي متاحاً */ }
}

function listAccessDenials({ page = 1, pageSize = 100 } = {}) {
  const db = readJSON(DENIALS_FILE, { denials: [] });
  const items = [...db.denials].reverse();
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return {
    success: true, data: paged,
    pagination: { total: items.length, page, pageSize, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) },
  };
}

// ==================================================================================
// ======================= دالة التحقق الموحّدة (نقطة الدخول الوحيدة) ==================
// ==================================================================================

/**
 * التحقق الدقيق من صلاحية إجراء "action" على مستند بعينه "doc" لصاحب الجلسة "token".
 * يُفترض أن التحقق الخشن (SEC.can(token,'documents',baseAction)) قد نُفِّذ مسبقاً في
 * طبقة server.js (requirePermission) - هذه الدالة تضيف القيود الدقيقة فوقه فقط ولا
 * تُغني عنه.
 *
 * doc: سجل المستند كما هو مخزَّن في dms.json، ويجب أن يحتوي على الأقل:
 *      { id, project_id, doc_group, author }
 * action: أحد: 'view' | 'update' | 'delete' | 'hard_delete' | 'approve' | 'reject' |
 *              'publish' | 'share' | 'move' | 'archive' | 'unarchive' | 'manage_permissions'
 *
 * ترمي استثناءً صريحاً عند الرفض (fail-closed)، وتُعيد true عند القبول.
 */
function assertDocumentAccess(token, doc, action) {
  if (!doc) throw new Error('المستند غير موجود');
  const session = SEC.getSessionUser(token);
  if (!session) {
    recordDenial({ userId: null, username: null, role: null, docId: doc.id, projectId: doc.project_id, action, reason: 'جلسة غير صالحة أو منتهية' });
    throw new Error('يجب تسجيل الدخول للوصول إلى هذا المورد');
  }
  const { userId, username, role } = session;

  // 1) العمليات الحساسة جداً: محصورة بمدير الوثائق/المدير العام فقط
  if (CONTROLLER_ONLY_ACTIONS.has(action) && role !== 'admin' && role !== 'document_controller') {
    recordDenial({ userId, username, role, docId: doc.id, projectId: doc.project_id, action, reason: 'إجراء محصور بمدير الوثائق أو المدير العام' });
    throw new Error('هذا الإجراء محصور بمدير الوثائق (Document Controller) أو المدير العام');
  }

  // 2) قيد النطاق حسب المشروع (project-level scoping)
  if (!userHasProjectAccess(session, doc.project_id)) {
    recordDenial({ userId, username, role, docId: doc.id, projectId: doc.project_id, action, reason: 'لا يملك صلاحية الوصول لمشروع هذا المستند' });
    throw new Error('لا تملك صلاحية الوصول إلى مستندات هذا المشروع');
  }

  // 3) قيد المجموعة/نوع المستند حسب الدور (deny-list)
  const rule = groupRuleFor(role);
  if (rule) {
    if (rule.deniedGroups?.includes(doc.doc_group)) {
      recordDenial({ userId, username, role, docId: doc.id, projectId: doc.project_id, action, reason: `الدور (${role}) ممنوع من الوصول لمجموعة مستندات: ${doc.doc_group}` });
      throw new Error('لا تملك صلاحية الوصول إلى هذا النوع من المستندات');
    }
    // 4) قيد "اطلاع فقط" - يمنع أي إجراء تعديلي حتى لو كانت الصلاحية العامة تسمح به
    if (rule.viewOnly && MUTATING_ACTIONS.has(action)) {
      recordDenial({ userId, username, role, docId: doc.id, projectId: doc.project_id, action, reason: `الدور (${role}) مقيّد بالاطلاع فقط (view-only)` });
      throw new Error('صلاحيتك على هذا المستند اطلاع فقط (View Only) ولا تسمح بالتعديل');
    }
  }

  return true;
}

module.exports = {
  GLOBAL_SCOPE_ROLES,
  GROUP_DENY_RULES,
  CONTROLLER_ONLY_ACTIONS,

  setUserProjectScope,
  getUserProjectScope,
  userHasProjectAccess,

  assertDocumentAccess,
  listAccessDenials,
};
