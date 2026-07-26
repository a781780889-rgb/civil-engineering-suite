/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء التاسع (9/10): الربط الكامل بكل الأقسام + سجل التقارير + مشاركة التقارير.
 *
 * يبني هذا الجزء فوق طبقة التخزين المُهيَّأة مسبقاً في reportsCenter.js (part 1/10)
 * ويُفعّل فعلياً مفتاحي shares و auditLog المحجوزين هناك، إضافة إلى:
 *
 *  1) طبقة ربط شاملة (Cross-Module Registry) تسجّل مصدر كل تقرير فعلياً (اسم القسم/
 *     الوحدة التي وُلِّد منها) بحيث يمكن لأي قسم في المنصة (المشاريع، الخرسانة،
 *     الحديد، BOQ، الأعمال، المعدات، السلامة، الجودة، المساحة، الجدول الزمني،
 *     المستندات، المخططات، الميزانية) أن يستدعي registerCrossModuleReport() عند
 *     توليد تقرير من بياناته الفعلية، فيظهر تلقائياً موحّداً داخل مركز التقارير
 *     (سجل واحد لكل التقارير عبر كل الأقسام) دون الحاجة لأي بيانات وهمية.
 *
 *  2) سجل تقارير تفصيلي وحقيقي (Report History Log) لكل تقرير: من أنشأه، متى، أي
 *     مشروع، أي فترة، أي إصدار، عدد مرات العرض/التنزيل - مبني فوق reportRecords
 *     نفسها في reportsCenter.js (بدون تكرار تخزين) + طبقة قراءة تفصيلية إضافية
 *     (getReportHistory / getReportTimeline) تجمع كل أحداث سجل التدقيق الخاصة
 *     بتقرير معيّن في timeline واحد قابل للعرض.
 *
 *  3) مشاركة التقارير (Report Sharing) بنفس نمط documentSharing.js (القسم 11):
 *     - مشاركة داخلية: منح صلاحية وصول لمستخدم/دور محدد على تقرير معيّن.
 *     - مشاركة خارجية: رابط آمن (crypto.randomBytes 256-bit) قابل للفتح من خارج
 *       النظام بدون تسجيل دخول، مع حماية اختيارية بكلمة مرور (scrypt hash)،
 *       صلاحية زمنية، حد أقصى لعدد الفتحات، صلاحية عرض فقط أو عرض+تنزيل، وإلغاء
 *       يدوي في أي وقت. كل محاولة فتح (ناجحة أو فاشلة) تُسجَّل فعلياً.
 *
 * التخزين: يستخدم نفس ملف reportsCenter.json (لا ملف جديد) عبر دوال loadStore/
 * saveStore المستوردة من reportsCenter.js، لضمان مصدر بيانات واحد متّسق للتقارير،
 * ويضيف ملف بيانات صغير مستقل خاص بجدول الربط عبر الأقسام (لأنه سجل ميتاداتا مصدر
 * وليس جزءاً من دورة حياة سجل التقرير نفسه).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RC = require('./reportsCenter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LINKS_FILE = path.join(DATA_DIR, 'reportsModuleLinks.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== الأقسام المدعومة رسمياً للربط (module keys) =====================
// تُستخدم للتحقق من صحة القيم المُرسَلة من الأقسام الأخرى وللعرض في الواجهات.
const SUPPORTED_SOURCE_MODULES = {
  project: { label: 'إدارة المشاريع', utils: 'projectManagement' },
  concrete: { label: 'حاسبة الخرسانة', utils: 'concreteCalculators' },
  rebar: { label: 'حاسبة حديد التسليح', utils: 'rebarCalculators' },
  boq: { label: 'حصر الكميات', utils: 'boqReports' },
  workers: { label: 'إدارة العمال', utils: 'workersManagement' },
  equipment: { label: 'إدارة المعدات', utils: 'equipmentReports' },
  safety: { label: 'السلامة المهنية', utils: 'hseReports' },
  quality: { label: 'إدارة الجودة', utils: 'qmsReports' },
  survey: { label: 'تطبيق المساحة', utils: 'surveyReports' },
  schedule: { label: 'الجدول الزمني', utils: 'scheduling' },
  documents: { label: 'إدارة المستندات', utils: 'documentReports' },
  drawings: { label: 'إدارة المخططات', utils: 'drawingReports' },
  budget: { label: 'إدارة الميزانية', utils: 'budgetReports' },
  procurement: { label: 'إدارة المشتريات', utils: 'procurementManagement' },
};

// ===================== طبقة تخزين جدول الربط عبر الأقسام =====================

function ensureLinksStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LINKS_FILE)) {
    fs.writeFileSync(LINKS_FILE, JSON.stringify({ links: {} }, null, 2), 'utf-8');
  }
}

function loadLinksStore() {
  ensureLinksStore();
  try {
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة جدول ربط التقارير بالأقسام: ' + e.message);
  }
}

function saveLinksStore(store) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function assertSourceModule(sourceModule) {
  if (!sourceModule || !SUPPORTED_SOURCE_MODULES[sourceModule]) {
    throw new Error(
      `القسم المصدر (sourceModule) غير معروف. الأقسام المدعومة: ${Object.keys(SUPPORTED_SOURCE_MODULES).join(', ')}`
    );
  }
}

// ===================== 1) الربط الشامل عبر الأقسام =====================

/**
 * يستدعيه أي قسم آخر في المنصة فور توليده تقريراً فعلياً من بياناته، لتسجيله
 * تلقائياً في مركز التقارير الموحّد (reportsCenter) مع الإشارة الصريحة لمصدره.
 * لا يُنشئ بيانات وهمية: reportKey/title/category تأتي من كتالوج reportsCenter
 * إن وُجد، وإلا تُستخدم القيم المُمرَّرة مباشرة من القسم المصدر.
 */
function registerCrossModuleReport({
  sourceModule, reportKey = null, title = null, category = null, projectId = null,
  userId = null, periodFrom = null, periodTo = null, format = null, filePath = null,
  sourceEntityId = null, details = {},
} = {}) {
  assertSourceModule(sourceModule);
  if (!reportKey && !title) throw new Error('يجب تحديد reportKey أو title لتسجيل التقرير');

  // 1) تسجيل سجل التقرير نفسه في reportsCenter (نفس دورة الحياة المستخدمة في الأجزاء 1-8)
  const record = RC.registerReportRecord({
    reportKey, title, category, projectId, userId, periodFrom, periodTo,
    status: 'completed', format, filePath,
  });

  // 2) تسجيل رابط المصدر في جدول الربط المستقل
  const linksStore = loadLinksStore();
  const linkId = newId('RPTLNK');
  linksStore.links[linkId] = {
    id: linkId,
    report_id: record.id,
    source_module: sourceModule,
    source_module_label: SUPPORTED_SOURCE_MODULES[sourceModule].label,
    source_utils: SUPPORTED_SOURCE_MODULES[sourceModule].utils,
    source_entity_id: sourceEntityId,
    project_id: projectId,
    details,
    created_at: nowISO(),
  };
  saveLinksStore(linksStore);

  return { success: true, data: { report: record, link_id: linkId, source_module: sourceModule } };
}

/** يعيد كل التقارير المسجَّلة من قسم مصدر محدد (مثلاً كل تقارير قسم "safety") */
function listReportsByModule(sourceModule, { projectId = null, limit = 100 } = {}) {
  assertSourceModule(sourceModule);
  const linksStore = loadLinksStore();
  let rows = Object.values(linksStore.links).filter((l) => l.source_module === sourceModule);
  if (projectId) rows = rows.filter((l) => l.project_id === projectId);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  rows = rows.slice(0, limit);

  return rows.map((link) => {
    let record = null;
    try { record = RC.getReportRecord(link.report_id); } catch { record = null; }
    return { ...link, report: record };
  });
}

/** يعيد ملخص عدد التقارير الفعلية المسجَّلة لكل قسم — أساس بطاقة "التقارير حسب القسم" */
function getModuleIntegrationSummary({ projectId = null } = {}) {
  const linksStore = loadLinksStore();
  let rows = Object.values(linksStore.links);
  if (projectId) rows = rows.filter((l) => l.project_id === projectId);

  const summary = {};
  Object.keys(SUPPORTED_SOURCE_MODULES).forEach((key) => {
    summary[key] = { label: SUPPORTED_SOURCE_MODULES[key].label, count: 0 };
  });
  rows.forEach((l) => {
    if (!summary[l.source_module]) {
      summary[l.source_module] = { label: l.source_module_label, count: 0 };
    }
    summary[l.source_module].count += 1;
  });

  return {
    generated_at: nowISO(),
    project_id: projectId,
    total_linked_reports: rows.length,
    by_module: summary,
  };
}

/** يعيد قسم المصدر الفعلي لتقرير معيّن (إن وُجد) */
function getReportSource(reportId) {
  const linksStore = loadLinksStore();
  const link = Object.values(linksStore.links).find((l) => l.report_id === reportId);
  return link || null;
}

// ===================== 2) سجل التقارير التفصيلي (History / Timeline) =====================

/**
 * يبني timeline فعلياً من سجل التدقيق العام في reportsCenter.js (auditLog) مُصفَّى
 * على تقرير واحد، إضافة إلى بيانات مصدره من جدول الربط - دون أي بيانات وهمية.
 */
function getReportHistory(reportId) {
  const record = RC.getReportRecord(reportId); // يرمي خطأ إن لم يوجد
  const source = getReportSource(reportId);
  const auditRows = RC.listAuditLog({ limit: 5000 }).filter((a) => a.entityId === reportId);
  auditRows.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return {
    report: record,
    source_module: source ? source.source_module_label : null,
    source_utils: source ? source.source_utils : null,
    timeline: auditRows.map((a) => ({
      action: a.action, at: a.ts, user_id: a.userId, details: a.details || {},
    })),
    stats: {
      views: record.view_count || 0,
      downloads: record.download_count || 0,
      version: record.version || 1,
      last_updated: record.updated_at,
    },
  };
}

/** سجل التقارير الشامل مع فلاتر (اسم/مستخدم/مشروع/فترة/نوع/حالة/إصدار) */
function listReportsRegistry({
  projectId = null, userId = null, category = null, status = null,
  sourceModule = null, search = null, dateFrom = null, dateTo = null, limit = 200,
} = {}) {
  let rows = RC.listReportRecords({ projectId, category, status, userId, search, limit: 5000 });

  if (dateFrom) rows = rows.filter((r) => new Date(r.created_at) >= new Date(dateFrom));
  if (dateTo) rows = rows.filter((r) => new Date(r.created_at) <= new Date(dateTo));

  if (sourceModule) {
    const linksStore = loadLinksStore();
    const reportIdsForModule = new Set(
      Object.values(linksStore.links).filter((l) => l.source_module === sourceModule).map((l) => l.report_id)
    );
    rows = rows.filter((r) => reportIdsForModule.has(r.id));
  }

  return rows.slice(0, limit).map((r) => {
    const source = getReportSource(r.id);
    return { ...r, source_module: source ? source.source_module : null, source_module_label: source ? source.source_module_label : null };
  });
}

// ===================== 3) مشاركة التقارير =====================
// نفس نمط documentSharing.js تماماً (القسم الحادي عشر) لضمان اتساق تجربة المستخدم
// وآلية الأمان عبر المنصة بالكامل.

function hashLinkPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyLinkPassword(password, stored) {
  if (!stored) return true;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

function normalizeSharePermission(permission) {
  const allowed = ['view', 'download'];
  if (!allowed.includes(permission)) {
    throw new Error(`صلاحية المشاركة غير صحيحة. القيم المسموحة: ${allowed.join(', ')}`);
  }
  return permission;
}

/** إنشاء رابط مشاركة خارجي آمن لتقرير موجود فعلياً في reportRecords */
function createReportShareLink(payload = {}) {
  const {
    report_id, permission = 'view', password = null,
    expires_at = null, max_opens = null, note = null, created_by = null,
  } = payload;

  if (!report_id) throw new Error('معرّف التقرير (report_id) مطلوب');
  const perm = normalizeSharePermission(permission);
  const record = RC.getReportRecord(report_id); // يرمي خطأ إن لم يوجد التقرير

  if (expires_at && Number.isNaN(new Date(expires_at).getTime())) {
    throw new Error('تاريخ انتهاء الرابط (expires_at) غير صحيح');
  }
  if (max_opens !== null && max_opens !== undefined && (!Number.isInteger(max_opens) || max_opens <= 0)) {
    throw new Error('الحد الأقصى لعدد مرات الفتح (max_opens) يجب أن يكون عدداً صحيحاً موجباً');
  }

  const store = RC._internal.loadStore();
  const token = crypto.randomBytes(32).toString('base64url');
  const shareId = newId('RSH');

  const shareRecord = {
    id: shareId,
    token,
    report_id,
    project_id: record.project_id || null,
    permission: perm,
    password_hash: password ? hashLinkPassword(password) : null,
    has_password: !!password,
    expires_at: expires_at || null,
    max_opens: max_opens || null,
    open_count: 0,
    note: note || null,
    is_revoked: false,
    created_by,
    created_at: nowISO(),
    revoked_at: null,
    revoked_by: null,
    access_log: [],
    scope: 'external_link',
  };

  store.shares[shareId] = shareRecord;
  RC._internal.audit(store, {
    action: 'share_report_create', entity: 'report', entityId: report_id, projectId: record.project_id,
    userId: created_by, details: { share_id: shareId, permission: perm, has_password: !!password, expires_at, max_opens },
  });
  RC._internal.saveStore(store);

  record.status = 'shared';
  record.updated_at = nowISO();
  store.reportRecords[report_id] = record;
  RC._internal.saveStore(store);

  const { password_hash, ...safe } = shareRecord;
  return { success: true, data: { ...safe, share_url_path: `/rshare/${token}` } };
}

function evaluateShareState(record) {
  if (!record) return { valid: false, reason: 'رابط المشاركة غير موجود' };
  if (record.is_revoked) return { valid: false, reason: 'تم إلغاء هذا الرابط' };
  if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'انتهت صلاحية هذا الرابط' };
  }
  if (record.max_opens && record.open_count >= record.max_opens) {
    return { valid: false, reason: 'تم تجاوز الحد الأقصى المسموح لعدد مرات فتح هذا الرابط' };
  }
  return { valid: true, reason: null };
}

/** فتح رابط مشاركة تقرير من خارج النظام (بدون تسجيل دخول) - يسجّل كل محاولة فعلياً */
function openReportShareLink(token, { password = null, ip = null } = {}) {
  if (!token) throw new Error('رمز الرابط (token) مطلوب');
  const store = RC._internal.loadStore();
  const record = Object.values(store.shares).find((s) => s.token === token);
  if (!record) throw new Error('الرابط غير صحيح أو غير موجود');

  const state = evaluateShareState(record);
  if (!state.valid) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: state.reason });
    RC._internal.saveStore(store);
    throw new Error(state.reason);
  }

  if (record.has_password && !verifyLinkPassword(password, record.password_hash)) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'كلمة المرور غير صحيحة' });
    RC._internal.saveStore(store);
    throw new Error('كلمة المرور غير صحيحة');
  }

  const reportRec = store.reportRecords[record.report_id];
  if (!reportRec) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'التقرير المرتبط لم يعد موجوداً' });
    RC._internal.saveStore(store);
    throw new Error('التقرير المرتبط بهذا الرابط لم يعد موجوداً');
  }

  record.open_count += 1;
  record.access_log.push({ at: nowISO(), ip, success: true, reason: null });
  if (record.access_log.length > 500) record.access_log = record.access_log.slice(-500);

  reportRec.view_count = (reportRec.view_count || 0) + 1;
  reportRec.updated_at = nowISO();

  RC._internal.audit(store, {
    action: 'share_report_open', entity: 'report', entityId: record.report_id, projectId: record.project_id,
    userId: `share-link:${record.id}`, details: { share_id: record.id, ip },
  });
  RC._internal.saveStore(store);

  return {
    success: true,
    data: {
      permission: record.permission,
      report: {
        id: reportRec.id, title: reportRec.title, category: reportRec.category_label,
        project_id: reportRec.project_id, period_from: reportRec.period_from, period_to: reportRec.period_to,
        format: reportRec.format, file_path: reportRec.file_path,
        created_at: reportRec.created_at, view_count: reportRec.view_count,
      },
    },
  };
}

/** تنزيل عبر رابط مشاركة صالح (يتطلب صلاحية download) - يعيد المسار الفعلي فقط
 *  (القراءة/التدفق الفعلي للملف تتم عبر نفس آلية REPORTS_DIR الموجودة في server.js) */
function downloadViaReportShareLink(token, { password = null, ip = null } = {}) {
  const opened = openReportShareLink(token, { password, ip });
  if (opened.data.permission !== 'download') {
    throw new Error('هذا الرابط يسمح بالعرض فقط، ولا يسمح بالتنزيل');
  }
  const store = RC._internal.loadStore();
  const record = Object.values(store.shares).find((s) => s.token === token);
  const reportRec = store.reportRecords[record.report_id];
  if (!reportRec.file_path) throw new Error('لا يوجد ملف مُصدَّر مرتبط بهذا التقرير بعد');

  reportRec.download_count = (reportRec.download_count || 0) + 1;
  reportRec.updated_at = nowISO();
  RC._internal.audit(store, {
    action: 'share_report_download', entity: 'report', entityId: record.report_id, projectId: record.project_id,
    userId: `share-link:${record.id}`, details: { share_id: record.id, ip },
  });
  RC._internal.saveStore(store);

  return { success: true, data: { file_path: reportRec.file_path, format: reportRec.format, title: reportRec.title } };
}

function revokeReportShareLink(shareId, { actor = null } = {}) {
  const store = RC._internal.loadStore();
  const record = store.shares[shareId];
  if (!record) throw new Error('رابط المشاركة غير موجود');
  if (record.is_revoked) throw new Error('هذا الرابط ملغى بالفعل');
  record.is_revoked = true;
  record.revoked_at = nowISO();
  record.revoked_by = actor;
  RC._internal.audit(store, {
    action: 'share_report_revoke', entity: 'report', entityId: record.report_id, projectId: record.project_id,
    userId: actor, details: { share_id: shareId },
  });
  RC._internal.saveStore(store);
  return { success: true, data: { revoked: true, share_id: shareId } };
}

function listReportShareLinks({ reportId = null, projectId = null, includeRevoked = true } = {}) {
  const store = RC._internal.loadStore();
  let rows = Object.values(store.shares);
  if (reportId) rows = rows.filter((s) => s.report_id === reportId);
  if (projectId) rows = rows.filter((s) => s.project_id === projectId);
  if (!includeRevoked) rows = rows.filter((s) => !s.is_revoked);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return rows.map(({ password_hash, ...safe }) => safe);
}

// ===================== مشاركة داخلية (منح صلاحية لمستخدم/دور محدد بدون رابط عام) =====================

function shareReportInternally(payload = {}) {
  const {
    report_id, grantee_user_id = null, grantee_role = null, permission = 'view',
    expires_at = null, created_by = null, note = null,
  } = payload;

  if (!report_id) throw new Error('معرّف التقرير (report_id) مطلوب');
  if (!grantee_user_id && !grantee_role) throw new Error('يجب تحديد مستخدم (grantee_user_id) أو دور (grantee_role) للمشاركة معه');
  const perm = normalizeSharePermission(permission);
  const record = RC.getReportRecord(report_id);

  const store = RC._internal.loadStore();
  const shareId = newId('RISH');
  const shareRecord = {
    id: shareId,
    report_id,
    project_id: record.project_id || null,
    grantee_user_id,
    grantee_role,
    permission: perm,
    note,
    created_by,
    created_at: nowISO(),
    expires_at: expires_at || null,
    revoked: false,
    scope: 'internal',
  };
  store.shares[shareId] = shareRecord;

  record.status = 'shared';
  record.updated_at = nowISO();

  RC._internal.audit(store, {
    action: 'share_report_internal', entity: 'report', entityId: report_id, projectId: record.project_id,
    userId: created_by, details: { share_id: shareId, grantee_user_id, grantee_role, permission: perm },
  });
  RC._internal.saveStore(store);

  return { success: true, data: shareRecord };
}

function hasInternalReportAccess({ reportId, userId = null, userRole = null, requiredPermission = 'view' }) {
  const store = RC._internal.loadStore();
  const now = Date.now();
  const permRank = { view: 1, download: 2 };
  return Object.values(store.shares).some((s) => {
    if (s.scope !== 'internal' || s.report_id !== reportId || s.revoked) return false;
    if (s.expires_at && new Date(s.expires_at).getTime() < now) return false;
    const matches = (userId && s.grantee_user_id === userId) || (userRole && s.grantee_role === userRole);
    if (!matches) return false;
    return (permRank[s.permission] || 0) >= (permRank[requiredPermission] || 0);
  });
}

// ===================== ملخص المشاركة (لبطاقة "التقارير المشتركة") =====================

function getReportSharingSummary({ projectId = null } = {}) {
  const store = RC._internal.loadStore();
  let rows = Object.values(store.shares);
  if (projectId) rows = rows.filter((s) => s.project_id === projectId);

  const external = rows.filter((s) => s.scope === 'external_link');
  const internal = rows.filter((s) => s.scope === 'internal');

  return {
    generated_at: nowISO(),
    project_id: projectId,
    total_shares: rows.length,
    external_links: {
      total: external.length,
      active: external.filter((s) => !s.is_revoked && evaluateShareState(s).valid).length,
      revoked: external.filter((s) => s.is_revoked).length,
      total_opens: external.reduce((sum, s) => sum + (s.open_count || 0), 0),
    },
    internal_shares: {
      total: internal.length,
      active: internal.filter((s) => !s.revoked).length,
    },
  };
}

module.exports = {
  SUPPORTED_SOURCE_MODULES,
  // 1) الربط الشامل عبر الأقسام
  registerCrossModuleReport,
  listReportsByModule,
  getModuleIntegrationSummary,
  getReportSource,
  // 2) سجل التقارير التفصيلي
  getReportHistory,
  listReportsRegistry,
  // 3) مشاركة خارجية عبر رابط آمن
  createReportShareLink,
  openReportShareLink,
  downloadViaReportShareLink,
  revokeReportShareLink,
  listReportShareLinks,
  // 4) مشاركة داخلية
  shareReportInternally,
  hasInternalReportAccess,
  // ملخصات
  getReportSharingSummary,
};
