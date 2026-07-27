/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء العاشر والأخير (10/10): الصلاحيات الدقيقة + سجل التدقيق الكامل (تجميع نهائي).
 *
 * يبني هذا الجزء فوق:
 *  - نظام الأدوار والصلاحيات العام (businessSecurity.js) - القسم السادس: يضيف صلاحيات
 *    "reports" الدقيقة (view/create/edit/delete/export/share/approve/manage_templates)
 *    لكل الأدوار المذكورة صراحة في متطلبات القسم 14 (بند 21: الصلاحيات)، بنفس نمط
 *    ensureEquipmentRolesSeeded / ensureSurveyRolesSeeded / ensureDmsRolesSeeded المستخدم
 *    في الأقسام السابقة، دون كسر أي صلاحيات موجودة مسبقاً (دمج/توسعة فقط، لا استبدال).
 *  - سجل التدقيق العام لقسم التقارير (reportsCenter.js: store.auditLog + listAuditLog)،
 *    الذي كان مكتوباً بالفعل من الأجزاء 6-9 عبر RC._internal.audit، ويضيف طبقة قراءة
 *    أغنى (تصفية حسب المستخدم/الفترة الزمنية/نوع العملية/العنصر المتأثر) تطابق بالضبط
 *    متطلبات بند 22 من الوثيقة ("سجل التدقيق Audit Log").
 *  - سجل التدقيق العام على مستوى المنصة كلها (businessSecurity.js: recordGlobalAudit /
 *    getGlobalAuditLog) عبر تسجيل مزدوج لعمليات التقارير الحساسة (حذف/اعتماد/مشاركة/
 *    تغيير قالب/تغيير صلاحيات) بحيث تظهر أيضاً في سجل التدقيق الموحّد للمنصة، تماشياً مع
 *    قاعدة "سجل كامل لجميع العمليات" في لوحة التحكم الرئيسية للنظام.
 *
 * لا يوجد ملف بيانات جديد مستقل: هذا الجزء طبقة منطق/تحقق فوق التخزين الموجود فعلياً
 * (biz_roles.json عبر businessSecurity.js، و reportsCenter.json عبر reportsCenter.js)،
 * تماماً كما هو متوقع من "تجميع نهائي" لا يعيد اختراع تخزين جديد.
 */

const SEC = require('./businessSecurity');
const RC = require('./reportsCenter');

// ===================== بند 21: الصلاحيات الدقيقة لقسم التقارير =====================
// إجراءات قسم التقارير المدعومة رسمياً (تطابق حرفياً ما ورد في متطلبات القسم 14):
const REPORTS_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'share', 'approve', 'manage_templates'];

// تعريف صلاحيات قسم التقارير لكل دور مذكور صراحة في بند 21 من المتطلبات.
// (مدير النظام معفى: يملك '*' بالفعل ضمن DEFAULT_ROLES في businessSecurity.js)
const REPORTS_ROLE_ADDITIONS = {
  // مدير المشاريع (على مستوى المنصة) - يرى/يصدر/يشارك/يعتمد كل تقارير كل المشاريع
  project_manager: ['view', 'create', 'edit', 'export', 'share', 'approve'],
  // مدير المشروع (مسؤول مشروع واحد أو أكثر) - نفس صلاحيات مدير المشاريع تقريباً
  site_project_manager: ['view', 'create', 'edit', 'export', 'share', 'approve'],
  // المهندس - ينشئ ويعدّل تقارير مشاريعه، بدون اعتماد نهائي
  engineer: ['view', 'create', 'edit', 'export'],
  // المحاسب - تقارير مالية فقط (الصلاحية العامة view/export كافية، ويُضاف create/edit
  // لأنه ينشئ تقارير الميزانية/المصروفات بنفسه ضمن بند 2 من المتطلبات)
  accountant: ['view', 'create', 'edit', 'export'],
  // مسؤول الجودة - ينشئ تقارير QA/QC وNCR الخاصة به
  qa_officer: ['view', 'create', 'edit', 'export'],
  // مسؤول السلامة - ينشئ تقارير الحوادث/المخاطر/التفتيش الخاصة به
  safety_officer: ['view', 'create', 'edit', 'export'],
  // الاستشاري - يرى ويصدّر ويعتمد (توقيع اعتماد المخططات/التقارير الفنية)
  consultant: ['view', 'export', 'approve'],
  // العميل - عرض فقط، بدون أي إنشاء أو تعديل أو حذف
  client: ['view'],
  // مدير النظام (احتياطي صريح رغم '*' الموجودة) لضمان ظهوره أيضاً في القوائم المفصّلة
  system_admin: REPORTS_ACTIONS,
};

/**
 * يدمج صلاحيات "reports" الدقيقة أعلاه داخل الأدوار الموجودة فعلياً في biz_roles.json
 * دون حذف أو استبدال أي صلاحية أخرى للدور (دمج additive فقط)، ودون إنشاء أدوار جديدة
 * غير موجودة أصلاً (إن لم يكن الدور موجوداً في النظام يُتجاهَل بصمت لأنه غير مُفعَّل
 * أصلاً في هذا التنصيب).
 */
function ensureReportsRolesSeeded() {
  const existing = SEC.listRoles().data;
  const seeded = [];
  const skipped = [];

  for (const [roleKey, actions] of Object.entries(REPORTS_ROLE_ADDITIONS)) {
    const role = existing.find((r) => r.key === roleKey);
    if (!role) { skipped.push(roleKey); continue; }

    const currentReports = Array.isArray(role.permissions?.reports) ? role.permissions.reports : [];
    const merged = Array.from(new Set([...currentReports, ...actions]));

    // لا حاجة لإعادة الكتابة إن كانت الصلاحيات مطابقة فعلاً (تجنّب كتابة قرص غير ضرورية)
    if (merged.length === currentReports.length && merged.every((a) => currentReports.includes(a))) {
      continue;
    }

    const newPermissions = { ...(role.permissions || {}), reports: merged };
    SEC.upsertRole(roleKey, { label: role.label, permissions: newPermissions });
    seeded.push(roleKey);
  }

  return { success: true, data: { seeded_roles: seeded, skipped_roles_not_installed: skipped, actions: REPORTS_ACTIONS } };
}

/** يتحقق من صلاحية إجراء معيّن على قسم التقارير لمستخدم الجلسة الممثَّلة بالتوكن */
function reportsCan(token, action) {
  if (!REPORTS_ACTIONS.includes(action)) throw new Error(`إجراء غير معروف لقسم التقارير: ${action}`);
  return SEC.can(token, 'reports', action);
}

/** يعيد قائمة كل الأدوار مع تفصيل صلاحيات "reports" الدقيقة الخاصة بكل دور - للعرض في واجهة الصلاحيات */
function getReportsPermissionsMatrix() {
  const roles = SEC.listRoles().data;
  return roles.map((r) => ({
    key: r.key,
    label: r.label,
    is_system_admin: r.permissions?.['*']?.includes('*') || false,
    reports_permissions: r.permissions?.['*']?.includes('*') ? [...REPORTS_ACTIONS] : (r.permissions?.reports || []),
  }));
}

// ===================== بند 22: سجل التدقيق الكامل لقسم التقارير =====================

/**
 * قراءة موسّعة لسجل تدقيق قسم التقارير (المصدر الفعلي: reportsCenter.json/auditLog، وهو
 * نفسه الذي تُسجَّل فيه كل عمليات الأجزاء 6-9 عبر RC._internal.audit) مع دعم كل حقول
 * التصفية المطلوبة في بند 22: المستخدم، نوع العملية، الفترة الزمنية، والعنصر المتأثر.
 */
function getReportsAuditLog({ userId = null, action = null, entity = null, entityId = null, projectId = null, from = null, to = null, page = 1, pageSize = 100 } = {}) {
  // نطلب أكبر نطاق ممكن من reportsCenter ثم نطبّق باقي التصفية هنا (المصدر لا يدعم
  // كل هذه الحقول مباشرة بعد)، مع الحفاظ على نفس حد الـ 10000 سجل الأقصى المخزَّن هناك.
  let rows = RC.listAuditLog({ limit: 10000, action: null, projectId });

  if (userId) rows = rows.filter((r) => r.userId === userId);
  if (action) rows = rows.filter((r) => r.action === action);
  if (entity) rows = rows.filter((r) => r.entity === entity);
  if (entityId) rows = rows.filter((r) => r.entityId === entityId);
  if (from) { const f = new Date(from).getTime(); rows = rows.filter((r) => new Date(r.ts).getTime() >= f); }
  if (to) { const t = new Date(to).getTime(); rows = rows.filter((r) => new Date(r.ts).getTime() <= t); }

  const total = rows.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    total,
    page: Math.max(1, page),
    pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    records: pageRows,
  };
}

/**
 * يسجّل عملية حساسة في قسم التقارير في سجلَّي التدقيق معاً:
 *  1) سجل تدقيق قسم التقارير المحلي (reportsCenter.json) - عبر RC._internal.audit.
 *  2) سجل التدقيق العام لكامل المنصة (businessSecurity.js/global_audit_log.json) - حتى
 *     تظهر عمليات التقارير الحساسة أيضاً ضمن "سجل كامل لجميع العمليات" في لوحة التحكم
 *     الرئيسية للنظام (وليس فقط داخل قسم التقارير نفسه).
 * تُستخدم هذه الدالة تحديداً للعمليات التي يطلبها بند 22 صراحة: إنشاء/تعديل/حذف/تصدير/
 * مشاركة/اعتماد تقرير، وتغيير قالب، وتغيير صلاحيات.
 */
function recordSensitiveReportsAudit({ action, entity, entityId = null, projectId = null, userId = null, username = null, summary = '', details = {} }) {
  const store = RC._internal.loadStore();
  RC._internal.audit(store, { action, entity, entityId, projectId, userId, details });
  RC._internal.saveStore(store);

  try {
    SEC.recordGlobalAudit({ userId, username, module: 'reports', action, target_id: entityId, summary, success: true });
  } catch (e) {
    // سجل التدقيق العام اختياري تكميلي؛ فشل تسجيله لا يجب أن يُفشل العملية الأصلية نفسها
    console.error('⚠️  تعذّر تسجيل عملية التقارير الحساسة في سجل التدقيق العام للمنصة:', e.message);
  }
}

module.exports = {
  REPORTS_ACTIONS,
  ensureReportsRolesSeeded,
  reportsCan,
  getReportsPermissionsMatrix,
  getReportsAuditLog,
  recordSensitiveReportsAudit,
};
