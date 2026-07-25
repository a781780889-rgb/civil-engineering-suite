/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء الأول (1/10): البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج).
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة.
 *   الجزء 3/10: التقارير الزمنية والمقارنة.
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية.
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية.
 *   الجزء 6/10: الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * التخزين: ملف JSON على القرص (backend/data/reportsCenter.json) بنفس نمط
 * hseManagement.js / equipmentManagement.js / projectManagement.js - بدون تبعيات خارجية.
 *
 * هذا الجزء (1/10) يوفر:
 *  1) طبقة تخزين مركزية لسجلات التقارير المُنشأة، القوالب (هيكل أولي)، الجدولة (هيكل أولي)،
 *     المشاركة (هيكل أولي)، وسجل التدقيق العام لقسم التقارير بالكامل.
 *  2) لوحة تحكم التقارير (getReportsDashboard) بمؤشرات حقيقية مبنية على سجل التقارير الفعلي:
 *     إجمالي، اليوم، الأسبوعي، الشهري، المجدولة، المحفوظة، المشتركة، قيد الإنشاء، آخر
 *     التقارير، الأكثر استخداماً، وتوزيعها حسب المشروع/القسم/النوع.
 *  3) مركز/كتالوج التقارير (getReportsCatalog / listCatalogByCategory): فهرس كامل لكل
 *     أنواع التقارير المتاحة في كل قسم من أقسام المنصة (24+ نوع تقرير موزعة على 10 تصنيفات)
 *     مع تحديد مصدر البيانات الفعلي (اسم وحدة utils) لكل تقرير، تمهيداً لربطها التنفيذي
 *     الكامل في الأجزاء اللاحقة (2-9).
 *  4) دورة حياة أساسية لسجل التقرير: تسجيل إنشاء تقرير، تسجيل عرض/تنزيل، تسجيل حذف.
 *
 * ملاحظة دقة: كل الأرقام في لوحة التحكم مشتقة فعلياً من سجل reportRecords المخزَّن على
 * القرص، وليست بيانات وهمية أو ثابتة. عند عدم وجود أي تقرير منشأ بعد، تُعرض أصفار حقيقية.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportsCenter.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d = new Date()) { const x = startOfDay(d); const day = x.getDay(); x.setDate(x.getDate() - day); return x; }
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      reportRecords: {},   // { id: reportRecord }   سجل كل تقرير تم إنشاؤه فعلياً
      templates: {},       // { id: templateRecord }  قوالب التقارير (تُفعَّل بالكامل في الجزء 7)
      scheduledReports: {},// { id: scheduleRecord }  الجدولة التلقائية (تُفعَّل بالكامل في الجزء 6)
      shares: {},          // { id: shareRecord }     مشاركة التقارير (تُفعَّل بالكامل في الجزء 9)
      auditLog: [],        // سجل تدقيق عام لكل عمليات قسم التقارير
      seq: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات نظام التقارير: ' + e.message);
  }
  let migrated = false;
  for (const key of ['reportRecords', 'templates', 'scheduledReports', 'shares']) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
  if (!store.auditLog) { store.auditLog = []; migrated = true; }
  if (typeof store.seq !== 'number') { store.seq = 0; migrated = true; }
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, userId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, userId, details });
  if (store.auditLog.length > 10000) store.auditLog = store.auditLog.slice(-10000);
}

// ===================== كتالوج التقارير (مركز التقارير) =====================
// فهرس ثابت البنية (وليس بيانات وهمية) يصف كل نوع تقرير متاح ومصدر بياناته الفعلي
// (اسم وحدة utils المسؤولة). يُستخدم هذا الكتالوج في الأجزاء اللاحقة كأساس لمنشئ
// التقارير (Report Builder) ولتوليد التقارير الفعلية من الوحدات المذكورة.

const REPORTS_CATALOG = {
  projects: {
    label: 'تقارير المشاريع',
    reports: [
      { key: 'project_status', label: 'تقرير حالة المشروع', source: 'projectManagement' },
      { key: 'project_progress', label: 'تقرير تقدم المشروع', source: 'projectManagement' },
      { key: 'project_executive', label: 'التقرير التنفيذي', source: 'projectManagement' },
      { key: 'project_daily', label: 'تقرير الإنجاز اليومي', source: 'projectManagement' },
      { key: 'project_weekly', label: 'التقرير الأسبوعي', source: 'projectManagement' },
      { key: 'project_monthly', label: 'التقرير الشهري', source: 'projectManagement' },
      { key: 'project_closeout', label: 'تقرير نهاية المشروع', source: 'projectManagement' },
    ],
  },
  financial: {
    label: 'التقارير المالية',
    reports: [
      { key: 'budget', label: 'تقرير الميزانية', source: 'budgetManagement' },
      { key: 'expenses', label: 'تقرير المصروفات', source: 'budgetManagement' },
      { key: 'revenue', label: 'تقرير الإيرادات', source: 'budgetManagement' },
      { key: 'profit_loss', label: 'تقرير الأرباح والخسائر', source: 'budgetManagement' },
      { key: 'cash_flow', label: 'تقرير التدفقات النقدية', source: 'budgetManagement' },
      { key: 'financial_variance', label: 'تقرير الانحرافات المالية', source: 'budgetManagement' },
      { key: 'earned_value', label: 'تقرير القيمة المكتسبة', source: 'budgetManagement' },
    ],
  },
  schedule: {
    label: 'تقارير الجدول الزمني',
    reports: [
      { key: 'schedule_progress', label: 'تقرير تقدم الجدول', source: 'scheduling' },
      { key: 'schedule_delay', label: 'تقرير التأخير', source: 'scheduling' },
      { key: 'schedule_activities', label: 'تقرير الأنشطة', source: 'scheduling' },
      { key: 'schedule_critical_path', label: 'تقرير المسار الحرج', source: 'scheduling' },
      { key: 'schedule_baseline_actual', label: 'تقرير Baseline مقابل Actual', source: 'scheduling' },
      { key: 'schedule_resources', label: 'تقرير الموارد', source: 'scheduling' },
      { key: 'schedule_productivity', label: 'تقرير الإنتاجية', source: 'scheduling' },
    ],
  },
  boq: {
    label: 'تقارير حصر الكميات',
    reports: [
      { key: 'boq_full', label: 'تقرير BOQ', source: 'boqReports' },
      { key: 'boq_executed', label: 'تقرير الكميات المنفذة', source: 'boqReports' },
      { key: 'boq_remaining', label: 'تقرير الكميات المتبقية', source: 'boqReports' },
      { key: 'boq_approved', label: 'تقرير الكميات المعتمدة', source: 'boqReports' },
      { key: 'boq_by_item', label: 'تقرير الكميات حسب البند', source: 'boqReports' },
      { key: 'boq_by_project', label: 'تقرير الكميات حسب المشروع', source: 'boqReports' },
    ],
  },
  quality: {
    label: 'تقارير الجودة',
    reports: [
      { key: 'qms_qaqc', label: 'تقرير QA/QC', source: 'qmsReports' },
      { key: 'qms_inspection_requests', label: 'تقرير Inspection Requests', source: 'qmsReports' },
      { key: 'qms_ncr', label: 'تقرير NCR', source: 'qmsReports' },
      { key: 'qms_capa', label: 'تقرير CAPA', source: 'qmsReports' },
      { key: 'qms_tests', label: 'تقرير الاختبارات', source: 'qmsReports' },
      { key: 'qms_materials', label: 'تقرير المواد', source: 'qmsReports' },
      { key: 'qms_compliance', label: 'تقرير المطابقة', source: 'qmsReports' },
    ],
  },
  hse: {
    label: 'تقارير السلامة',
    reports: [
      { key: 'hse_incidents', label: 'تقرير الحوادث', source: 'hseReports' },
      { key: 'hse_injuries', label: 'تقرير الإصابات', source: 'hseReports' },
      { key: 'hse_risks', label: 'تقرير المخاطر', source: 'hseReports' },
      { key: 'hse_inspections', label: 'تقرير التفتيش', source: 'hseReports' },
      { key: 'hse_violations', label: 'تقرير المخالفات', source: 'hseReports' },
      { key: 'hse_permits', label: 'تقرير تصاريح العمل', source: 'hseReports' },
      { key: 'hse_training', label: 'تقرير التدريب', source: 'hseReports' },
    ],
  },
  survey: {
    label: 'تقارير المساحة',
    reports: [
      { key: 'survey_fieldwork', label: 'تقرير الرفع المساحي', source: 'surveyReports' },
      { key: 'survey_setting_out', label: 'تقرير التوقيع', source: 'surveyReports' },
      { key: 'survey_coordinates', label: 'تقرير الإحداثيات', source: 'surveyReports' },
      { key: 'survey_levels', label: 'تقرير المناسيب', source: 'surveyReports' },
      { key: 'survey_cut_fill', label: 'تقرير الحفر والردم', source: 'surveyReports' },
      { key: 'survey_control_points', label: 'تقرير نقاط التحكم', source: 'surveyReports' },
    ],
  },
  drawings: {
    label: 'تقارير المخططات',
    reports: [
      { key: 'drawings_status', label: 'تقرير حالة المخططات', source: 'drawingReports' },
      { key: 'drawings_reviews', label: 'تقرير المراجعات', source: 'drawingReports' },
      { key: 'drawings_approvals', label: 'تقرير الاعتمادات', source: 'drawingReports' },
      { key: 'drawings_versions', label: 'تقرير الإصدارات', source: 'drawingReports' },
      { key: 'drawings_comments', label: 'تقرير الملاحظات', source: 'drawingReports' },
      { key: 'drawings_conflicts', label: 'تقرير التعارضات', source: 'drawingReports' },
    ],
  },
  equipment: {
    label: 'تقارير المعدات',
    reports: [
      { key: 'equipment_general', label: 'تقرير المعدات', source: 'equipmentReports' },
      { key: 'equipment_operating_hours', label: 'تقرير ساعات التشغيل', source: 'equipmentReports' },
      { key: 'equipment_fuel', label: 'تقرير الوقود', source: 'equipmentReports' },
      { key: 'equipment_maintenance', label: 'تقرير الصيانة', source: 'equipmentReports' },
      { key: 'equipment_faults', label: 'تقرير الأعطال', source: 'equipmentReports' },
      { key: 'equipment_cost', label: 'تقرير تكلفة المعدات', source: 'equipmentReports' },
    ],
  },
  documents: {
    label: 'تقارير المستندات',
    reports: [
      { key: 'documents_general', label: 'تقرير المستندات', source: 'documentReports' },
      { key: 'documents_versions', label: 'تقرير الإصدارات', source: 'documentReports' },
      { key: 'documents_approvals', label: 'تقرير الاعتمادات', source: 'documentReports' },
      { key: 'documents_expired', label: 'تقرير المستندات المنتهية', source: 'documentReports' },
      { key: 'documents_activity', label: 'تقرير النشاط والأرشفة', source: 'documentReports' },
    ],
  },
};

function getReportsCatalog() {
  const categories = Object.entries(REPORTS_CATALOG).map(([key, cat]) => ({
    key,
    label: cat.label,
    reportsCount: cat.reports.length,
    reports: cat.reports,
  }));
  const totalReportTypes = categories.reduce((sum, c) => sum + c.reportsCount, 0);
  return {
    generated_at: nowISO(),
    categories_count: categories.length,
    total_report_types: totalReportTypes,
    categories,
  };
}

function listCatalogByCategory(categoryKey) {
  const cat = REPORTS_CATALOG[categoryKey];
  if (!cat) throw new Error(`تصنيف تقارير غير معروف: ${categoryKey}`);
  return { key: categoryKey, label: cat.label, reports: cat.reports };
}

function findCatalogEntry(reportKey) {
  for (const [catKey, cat] of Object.entries(REPORTS_CATALOG)) {
    const found = cat.reports.find((r) => r.key === reportKey);
    if (found) return { ...found, category: catKey, categoryLabel: cat.label };
  }
  return null;
}

// ===================== دورة حياة سجل التقرير =====================

/**
 * تسجيل إنشاء تقرير فعلي في سجل النظام (يُستدعى من محرك التوليد في الأجزاء اللاحقة،
 * ومتاح من الآن لأي جزء يحتاج إنشاء سجل تقرير أساسي).
 */
function registerReportRecord({
  reportKey, title, category = null, projectId = null, userId = null,
  periodFrom = null, periodTo = null, status = 'completed', format = null, filePath = null,
} = {}) {
  if (!reportKey && !title) throw new Error('يجب تحديد reportKey أو title لتسجيل التقرير');
  const store = loadStore();
  const catalogEntry = reportKey ? findCatalogEntry(reportKey) : null;
  const id = newId('RPT');
  const record = {
    id,
    report_key: reportKey || null,
    title: title || (catalogEntry ? catalogEntry.label : 'تقرير غير مسمّى'),
    category: category || (catalogEntry ? catalogEntry.category : null),
    category_label: catalogEntry ? catalogEntry.categoryLabel : null,
    project_id: projectId,
    user_id: userId,
    period_from: periodFrom,
    period_to: periodTo,
    status, // draft | in_progress | completed | scheduled | shared
    format, // pdf | xlsx | csv | word | html
    file_path: filePath,
    created_at: nowISO(),
    updated_at: nowISO(),
    view_count: 0,
    download_count: 0,
    version: 1,
  };
  store.reportRecords[id] = record;
  audit(store, { action: 'create_report', entity: 'report', entityId: id, projectId, userId });
  saveStore(store);
  return record;
}

function markReportViewed(id, userId = null) {
  const store = loadStore();
  const rec = store.reportRecords[id];
  if (!rec) throw new Error('التقرير غير موجود');
  rec.view_count = (rec.view_count || 0) + 1;
  rec.updated_at = nowISO();
  audit(store, { action: 'view_report', entity: 'report', entityId: id, userId, projectId: rec.project_id });
  saveStore(store);
  return rec;
}

function markReportDownloaded(id, { format = null, userId = null } = {}) {
  const store = loadStore();
  const rec = store.reportRecords[id];
  if (!rec) throw new Error('التقرير غير موجود');
  rec.download_count = (rec.download_count || 0) + 1;
  if (format) rec.format = format;
  rec.updated_at = nowISO();
  audit(store, { action: 'download_report', entity: 'report', entityId: id, userId, projectId: rec.project_id, details: { format } });
  saveStore(store);
  return rec;
}

function deleteReportRecord(id, userId = null) {
  const store = loadStore();
  const rec = store.reportRecords[id];
  if (!rec) throw new Error('التقرير غير موجود');
  delete store.reportRecords[id];
  audit(store, { action: 'delete_report', entity: 'report', entityId: id, userId, projectId: rec.project_id });
  saveStore(store);
  return { success: true, deleted_id: id };
}

function listReportRecords({ projectId = null, category = null, status = null, userId = null, search = null, limit = 100 } = {}) {
  const store = loadStore();
  let rows = Object.values(store.reportRecords);
  if (projectId) rows = rows.filter((r) => r.project_id === projectId);
  if (category) rows = rows.filter((r) => r.category === category);
  if (status) rows = rows.filter((r) => r.status === status);
  if (userId) rows = rows.filter((r) => r.user_id === userId);
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((r) => (r.title || '').toLowerCase().includes(q));
  }
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return rows.slice(0, limit);
}

function getReportRecord(id) {
  const store = loadStore();
  const rec = store.reportRecords[id];
  if (!rec) throw new Error('التقرير غير موجود');
  return rec;
}

// ===================== لوحة تحكم التقارير =====================

function getReportsDashboard(filters = {}) {
  const { projectId = null } = filters;
  const store = loadStore();
  let all = Object.values(store.reportRecords);
  if (projectId) all = all.filter((r) => r.project_id === projectId);

  const today = startOfDay();
  const weekStart = startOfWeek();
  const monthStart = startOfMonth();

  const createdToday = all.filter((r) => new Date(r.created_at) >= today);
  const createdThisWeek = all.filter((r) => new Date(r.created_at) >= weekStart);
  const createdThisMonth = all.filter((r) => new Date(r.created_at) >= monthStart);

  const scheduledCount = Object.values(store.scheduledReports).filter((s) => s.active !== false).length;
  const savedCount = all.filter((r) => r.status === 'completed' || r.status === 'draft').length;
  const sharedCount = Object.values(store.shares).filter((s) => (!projectId || s.project_id === projectId)).length;
  const inProgressCount = all.filter((r) => r.status === 'in_progress' || r.status === 'draft').length;

  const byProject = {};
  const byCategory = {};
  const byReportKey = {};
  all.forEach((r) => {
    const pKey = r.project_id || 'بدون مشروع';
    byProject[pKey] = (byProject[pKey] || 0) + 1;
    const cKey = r.category_label || r.category || 'غير مصنّف';
    byCategory[cKey] = (byCategory[cKey] || 0) + 1;
    const rKey = r.report_key || r.title;
    if (!byReportKey[rKey]) byReportKey[rKey] = { key: rKey, title: r.title, count: 0, views: 0, downloads: 0 };
    byReportKey[rKey].count += 1;
    byReportKey[rKey].views += (r.view_count || 0);
    byReportKey[rKey].downloads += (r.download_count || 0);
  });

  const mostUsed = Object.values(byReportKey)
    .sort((a, b) => (b.views + b.downloads) - (a.views + a.downloads))
    .slice(0, 10);

  const recent = [...all]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map((r) => ({
      id: r.id, title: r.title, category: r.category_label, project_id: r.project_id,
      created_at: r.created_at, status: r.status, format: r.format,
    }));

  return {
    generated_at: nowISO(),
    project_id: projectId,
    totals: {
      total_reports: all.length,
      created_today: createdToday.length,
      created_this_week: createdThisWeek.length,
      created_this_month: createdThisMonth.length,
      scheduled_reports: scheduledCount,
      saved_reports: savedCount,
      shared_reports: sharedCount,
      in_progress_reports: inProgressCount,
    },
    recent_reports: recent,
    most_used_reports: mostUsed,
    by_project: byProject,
    by_category: byCategory,
  };
}

// ===================== سجل التدقيق العام =====================

function listAuditLog({ limit = 200, action = null, projectId = null } = {}) {
  const store = loadStore();
  let rows = [...store.auditLog].reverse();
  if (action) rows = rows.filter((r) => r.action === action);
  if (projectId) rows = rows.filter((r) => r.projectId === projectId);
  return rows.slice(0, limit);
}

module.exports = {
  // كتالوج التقارير
  getReportsCatalog,
  listCatalogByCategory,
  findCatalogEntry,
  // دورة حياة سجل التقرير
  registerReportRecord,
  markReportViewed,
  markReportDownloaded,
  deleteReportRecord,
  listReportRecords,
  getReportRecord,
  // لوحة التحكم
  getReportsDashboard,
  // سجل التدقيق
  listAuditLog,
};
