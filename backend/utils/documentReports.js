/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الثامن (8/10): التقارير الاحترافية (PDF/Excel/CSV/Word/طباعة) + سجل العمليات
 *
 * يغطي هذا الملف بالكامل التقارير الثمانية المطلوبة في المواصفة تحت بند "التقارير":
 *  1. تقرير المستندات (قائمة كاملة قابلة للتصفية حسب المشروع/النوع/الحالة/التاريخ)
 *  2. تقرير الإصدارات (سجل كل إصدار فعلي لكل مستند - Version History الكامل)
 *  3. تقرير الاعتمادات (سجل مراحل الاعتماد/الرفض الفعلي من الجزء 3 - Workflow)
 *  4. تقرير المستخدمين (نشاط كل مستخدم داخل قسم DMS - رفع/تعديل/اعتماد/تنزيل)
 *  5. تقرير النشاط (سجل التدقيق الموحّد الكامل - Audit Log UI حقيقي وليس شكلياً)
 *  6. تقرير الأرشيف (المستندات المؤرشفة فعلياً)
 *  7. تقرير المستندات المنتهية (بحسب expiry_date الحقيقي المضاف في الجزء 1)
 *  8. التقرير التنفيذي (ملخص شامل لكل ما سبق في تقرير واحد لمتخذ القرار)
 *
 * مع دعم التصدير الكامل إلى: PDF احترافي / Excel / CSV / Word (RTF) / طباعة مباشرة
 * (HTML) - بنفس نمط qmsReports.js/boqReports.js/equipmentReports.js تماماً
 * للحفاظ على اتساق المعمارية الكامل عبر كل أقسام النظام.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل تقرير يُبنى من بيانات حقيقية مقروءة مباشرة من dms.json (نفس ملف التخزين
 *    الموحّد لكل أجزاء DMS 1-7) وليس أرقاماً وهمية أو Mock Data.
 *  - تقرير الاعتمادات يقرأ فعلياً سجل approvals من documentWorkflow.js (الجزء 3).
 *  - تقرير النشاط يقرأ فعلياً auditLog الموحّد المُحدَّث تلقائياً من كل الأجزاء
 *    السابقة (رفع/تعديل/اعتماد/مشاركة/فتح رابط...إلخ) دون أي تكرار للمنطق.
 *  - التصدير يُنتج ملفات فعلية حقيقية على القرص (PDF/XLSX/CSV/RTF/HTML) يمكن
 *    تنزيلها وفتحها فعلياً، وليس مجرد استجابة JSON.
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms.json');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ===================== أدوات مساعدة عامة =====================
function loadStore() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      documents: {}, versions: {}, categories: {}, workflows: {}, approvals: {},
      signatures: {}, shareLinks: {}, internalShares: {}, notifications: {}, auditLog: {},
    };
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

function nowISO() { return new Date().toISOString(); }

// ==================================================================================
// ===================================== 1. تقرير المستندات =========================
// ==================================================================================

function buildDocumentsReport({
  projectId = null, docType = null, group = null, status = null, department = null,
  includeArchived = true, dateFrom = null, dateTo = null,
} = {}) {
  const store = loadStore();
  let docs = Object.values(store.documents || {});

  if (projectId) docs = docs.filter(d => d.project_id === projectId);
  if (docType) docs = docs.filter(d => d.doc_type === docType);
  if (group) docs = docs.filter(d => d.doc_group === group);
  if (status) docs = docs.filter(d => d.status === status);
  if (department) docs = docs.filter(d => d.department === department);
  if (!includeArchived) docs = docs.filter(d => !d.archived);
  if (dateFrom || dateTo) docs = docs.filter(d => inRange(d.created_at, dateFrom, dateTo));

  const rows = docs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(d => ({
      رقم_المستند: d.document_number,
      العنوان: d.title,
      النوع: d.doc_type_label,
      المجموعة: d.doc_group,
      المشروع: d.project_name || (d.project_id || '-'),
      القسم: d.department || '-',
      الحالة: d.status,
      الإصدار_الحالي: d.current_version_number,
      عدد_الإصدارات: (d.version_ids || []).length,
      المؤلف: d.author || '-',
      تاريخ_الإنشاء: (d.created_at || '').slice(0, 10),
      آخر_تعديل: (d.updated_at || '').slice(0, 10),
      مؤرشف: d.archived ? 'نعم' : 'لا',
    }));

  return {
    title: 'تقرير المستندات',
    generated_at: nowISO(),
    filters: { projectId, docType, group, status, department, includeArchived, dateFrom, dateTo },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ===================================== 2. تقرير الإصدارات =========================
// ==================================================================================

function buildVersionsReport({ documentId = null, projectId = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let versions = Object.values(store.versions || {});

  if (documentId) versions = versions.filter(v => v.document_id === documentId);
  if (dateFrom || dateTo) versions = versions.filter(v => inRange(v.uploaded_at, dateFrom, dateTo));

  const rows = versions
    .map(v => {
      const doc = store.documents[v.document_id];
      if (projectId && (!doc || doc.project_id !== projectId)) return null;
      return {
        رقم_المستند: doc ? doc.document_number : v.document_id,
        عنوان_المستند: doc ? doc.title : '-',
        رقم_الإصدار: v.version_number,
        اسم_الملف: v.file_name,
        نوع_الملف: v.file_type_label,
        الحجم: v.file_size_human,
        بصمة_التحقق: v.checksum_sha256 ? v.checksum_sha256.slice(0, 16) : '-',
        رفعه: v.uploaded_by || '-',
        تاريخ_الرفع: (v.uploaded_at || '').slice(0, 16).replace('T', ' '),
        ملاحظة_التغيير: v.change_note || '-',
        الإصدار_الحالي: v.is_current ? 'نعم' : 'لا',
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.تاريخ_الرفع) - new Date(a.تاريخ_الرفع));

  return {
    title: 'تقرير الإصدارات (Version History)',
    generated_at: nowISO(),
    filters: { documentId, projectId, dateFrom, dateTo },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ===================================== 3. تقرير الاعتمادات ========================
// ==================================================================================

function buildApprovalsReport({ documentId = null, projectId = null, decision = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  const rows = [];

  for (const [docId, approvalList] of Object.entries(store.approvals || {})) {
    if (documentId && docId !== documentId) continue;
    const doc = store.documents[docId];
    if (projectId && (!doc || doc.project_id !== projectId)) continue;

    for (const a of (approvalList || [])) {
      if (decision && a.decision !== decision) continue;
      if ((dateFrom || dateTo) && !inRange(a.decided_at, dateFrom, dateTo)) continue;
      rows.push({
        رقم_المستند: doc ? doc.document_number : docId,
        عنوان_المستند: doc ? doc.title : '-',
        المرحلة: a.stage_label,
        القرار: a.decision === 'approved' ? 'معتمد' : 'مرفوض',
        المسؤول: a.actor,
        الدور: a.actor_role || '-',
        الملاحظات: a.comments || '-',
        تاريخ_القرار: (a.decided_at || '').slice(0, 16).replace('T', ' '),
      });
    }
  }

  rows.sort((a, b) => new Date(b.تاريخ_القرار) - new Date(a.تاريخ_القرار));

  return {
    title: 'تقرير الاعتمادات',
    generated_at: nowISO(),
    filters: { documentId, projectId, decision, dateFrom, dateTo },
    total_count: rows.length,
    summary: {
      معتمد: rows.filter(r => r.القرار === 'معتمد').length,
      مرفوض: rows.filter(r => r.القرار === 'مرفوض').length,
    },
    rows,
  };
}

// ==================================================================================
// ===================================== 4. تقرير المستخدمين ========================
// ==================================================================================

/** نشاط كل مستخدم فعلي داخل قسم DMS، محسوب من سجل التدقيق الموحّد الحقيقي */
function buildUsersActivityReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let entries = Object.values(store.auditLog || {});
  if (Array.isArray(store.auditLog)) entries = store.auditLog; // auditLog مصفوفة فعلياً في التخزين الحقيقي

  if (projectId) entries = entries.filter(e => e.project_id === projectId);
  if (dateFrom || dateTo) entries = entries.filter(e => inRange(e.created_at, dateFrom, dateTo));

  const byUser = {};
  for (const e of entries) {
    const user = e.actor || 'غير معروف';
    if (!byUser[user]) {
      byUser[user] = {
        المستخدم: user, رفع: 0, تعديل: 0, اعتماد: 0, رفض: 0, تنزيل: 0, مشاركة: 0, عمليات_أخرى: 0, إجمالي_العمليات: 0,
        آخر_نشاط: e.created_at,
      };
    }
    const u = byUser[user];
    u.إجمالي_العمليات += 1;
    if (new Date(e.created_at) > new Date(u.آخر_نشاط)) u.آخر_نشاط = e.created_at;

    switch (e.action) {
      case 'upload': u.رفع += 1; break;
      case 'new_version': case 'update_metadata': u.تعديل += 1; break;
      case 'approve': u.اعتماد += 1; break;
      case 'reject': u.رفض += 1; break;
      case 'download': case 'share_link_download': u.تنزيل += 1; break;
      case 'share_link_create': case 'internal_share_create': u.مشاركة += 1; break;
      default: u.عمليات_أخرى += 1;
    }
  }

  const rows = Object.values(byUser)
    .map(u => ({ ...u, آخر_نشاط: (u.آخر_نشاط || '').slice(0, 16).replace('T', ' ') }))
    .sort((a, b) => b.إجمالي_العمليات - a.إجمالي_العمليات);

  return {
    title: 'تقرير نشاط المستخدمين',
    generated_at: nowISO(),
    filters: { projectId, dateFrom, dateTo },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ===================================== 5. تقرير النشاط (Audit Log) ================
// ==================================================================================

const ACTION_LABELS = {
  upload: 'رفع مستند', new_version: 'رفع إصدار جديد', update_metadata: 'تعديل بيانات',
  archive: 'أرشفة', hard_delete: 'حذف نهائي', download: 'تنزيل',
  approve: 'اعتماد', reject: 'رفض', publish: 'نشر', start_workflow: 'بدء مراجعة',
  resubmit_for_review: 'إعادة تقديم للمراجعة', sign: 'توقيع إلكتروني', revoke_signature: 'إلغاء توقيع',
  share_link_create: 'إنشاء رابط مشاركة', share_link_open: 'فتح رابط مشاركة',
  share_link_download: 'تنزيل عبر رابط', share_link_revoke: 'إلغاء رابط مشاركة',
  internal_share_create: 'مشاركة داخلية', internal_share_revoke: 'إلغاء مشاركة داخلية',
  category_create: 'إنشاء تصنيف', category_move: 'نقل تصنيف',
};

function buildActivityLogReport({ projectId = null, documentId = null, actor = null, action = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let entries = Array.isArray(store.auditLog) ? store.auditLog : Object.values(store.auditLog || {});

  if (projectId) entries = entries.filter(e => e.project_id === projectId);
  if (documentId) entries = entries.filter(e => e.entity_id === documentId);
  if (actor) entries = entries.filter(e => e.actor === actor);
  if (action) entries = entries.filter(e => e.action === action);
  if (dateFrom || dateTo) entries = entries.filter(e => inRange(e.created_at, dateFrom, dateTo));

  const store2 = store; // للوضوح عند القراءة داخل map
  const rows = entries
    .map(e => {
      const doc = store2.documents ? store2.documents[e.entity_id] : null;
      return {
        الإجراء: ACTION_LABELS[e.action] || e.action,
        المستند: doc ? `${doc.document_number} - ${doc.title}` : (e.entity_id || '-'),
        المستخدم: e.actor || 'غير معروف',
        التفاصيل: e.details && Object.keys(e.details).length ? JSON.stringify(e.details) : '-',
        التاريخ_والوقت: (e.created_at || '').slice(0, 19).replace('T', ' '),
      };
    })
    .sort((a, b) => new Date(b.التاريخ_والوقت) - new Date(a.التاريخ_والوقت));

  return {
    title: 'تقرير النشاط (سجل العمليات الكامل)',
    generated_at: nowISO(),
    filters: { projectId, documentId, actor, action, dateFrom, dateTo },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ===================================== 6. تقرير الأرشيف ===========================
// ==================================================================================

function buildArchiveReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let docs = Object.values(store.documents || {}).filter(d => d.archived);

  if (projectId) docs = docs.filter(d => d.project_id === projectId);
  if (dateFrom || dateTo) docs = docs.filter(d => inRange(d.updated_at, dateFrom, dateTo));

  const rows = docs
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map(d => ({
      رقم_المستند: d.document_number,
      العنوان: d.title,
      النوع: d.doc_type_label,
      المشروع: d.project_name || (d.project_id || '-'),
      تاريخ_الإنشاء: (d.created_at || '').slice(0, 10),
      تاريخ_الأرشفة: (d.updated_at || '').slice(0, 10),
      عدد_الإصدارات: (d.version_ids || []).length,
    }));

  return {
    title: 'تقرير الأرشيف',
    generated_at: nowISO(),
    filters: { projectId, dateFrom, dateTo },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ============================= 7. تقرير المستندات المنتهية ========================
// ==================================================================================

function buildExpiringDocumentsReport({ projectId = null, onlyExpired = false, withinDays = null } = {}) {
  const store = loadStore();
  let docs = Object.values(store.documents || {}).filter(d => d.expiry_date);

  if (projectId) docs = docs.filter(d => d.project_id === projectId);

  const now = Date.now();
  const rows = docs
    .map(d => {
      const expiryTime = new Date(d.expiry_date).getTime();
      if (Number.isNaN(expiryTime)) return null;
      const daysLeft = Math.ceil((expiryTime - now) / (24 * 60 * 60 * 1000));
      return {
        _daysLeft: daysLeft,
        رقم_المستند: d.document_number,
        العنوان: d.title,
        النوع: d.doc_type_label,
        المشروع: d.project_name || (d.project_id || '-'),
        تاريخ_الانتهاء: (d.expiry_date || '').slice(0, 10),
        الحالة: daysLeft < 0 ? 'منتهي' : (daysLeft <= 30 ? 'قارب على الانتهاء' : 'ساري'),
        الأيام_المتبقية: daysLeft,
      };
    })
    .filter(Boolean)
    .filter(r => (onlyExpired ? r._daysLeft < 0 : true))
    .filter(r => (withinDays !== null && withinDays !== undefined ? r._daysLeft <= withinDays : true))
    .sort((a, b) => a._daysLeft - b._daysLeft)
    .map(({ _daysLeft, ...rest }) => rest);

  return {
    title: 'تقرير المستندات المنتهية / قاربت على الانتهاء',
    generated_at: nowISO(),
    filters: { projectId, onlyExpired, withinDays },
    total_count: rows.length,
    summary: {
      منتهي: rows.filter(r => r.الحالة === 'منتهي').length,
      قارب_على_الانتهاء: rows.filter(r => r.الحالة === 'قارب على الانتهاء').length,
    },
    rows,
  };
}

// ==================================================================================
// ===================================== 8. التقرير التنفيذي ========================
// ==================================================================================

function buildExecutiveReport({ projectId = null } = {}) {
  const store = loadStore();
  let docs = Object.values(store.documents || {});
  if (projectId) docs = docs.filter(d => d.project_id === projectId);

  const byStatus = {};
  for (const d of docs) byStatus[d.status] = (byStatus[d.status] || 0) + 1;

  const byGroup = {};
  for (const d of docs) byGroup[d.doc_group] = (byGroup[d.doc_group] || 0) + 1;

  const expiring = buildExpiringDocumentsReport({ projectId, withinDays: 30 });
  const expired = buildExpiringDocumentsReport({ projectId, onlyExpired: true });
  const archived = docs.filter(d => d.archived).length;

  const totalVersions = docs.reduce((sum, d) => sum + (d.version_ids || []).length, 0);

  const approvalsFlat = [];
  for (const [docId, list] of Object.entries(store.approvals || {})) {
    const doc = store.documents[docId];
    if (projectId && (!doc || doc.project_id !== projectId)) continue;
    approvalsFlat.push(...(list || []));
  }

  const shareLinks = Object.values(store.shareLinks || {});
  const activeShareLinks = shareLinks.filter(l => !l.is_revoked && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now()));

  const rows = [
    { المؤشر: 'إجمالي المستندات', القيمة: docs.length },
    { المؤشر: 'إجمالي الإصدارات', القيمة: totalVersions },
    { المؤشر: 'مستندات مسودة', القيمة: byStatus.draft || 0 },
    { المؤشر: 'مستندات قيد المراجعة', القيمة: byStatus.under_review || 0 },
    { المؤشر: 'مستندات معتمدة', القيمة: byStatus.approved || 0 },
    { المؤشر: 'مستندات مرفوضة', القيمة: byStatus.rejected || 0 },
    { المؤشر: 'مستندات منشورة', القيمة: byStatus.published || 0 },
    { المؤشر: 'مستندات مؤرشفة', القيمة: archived },
    { المؤشر: 'مستندات مشاريع', القيمة: byGroup.project || 0 },
    { المؤشر: 'مستندات جودة', القيمة: byGroup.quality || 0 },
    { المؤشر: 'مستندات سلامة', القيمة: byGroup.safety || 0 },
    { المؤشر: 'مستندات مالية', القيمة: byGroup.financial || 0 },
    { المؤشر: 'مستندات إدارية', القيمة: byGroup.administrative || 0 },
    { المؤشر: 'إجمالي مرات الاعتماد/الرفض', القيمة: approvalsFlat.length },
    { المؤشر: 'مرات الاعتماد', القيمة: approvalsFlat.filter(a => a.decision === 'approved').length },
    { المؤشر: 'مرات الرفض', القيمة: approvalsFlat.filter(a => a.decision === 'rejected').length },
    { المؤشر: 'مستندات قاربت على انتهاء الصلاحية (خلال 30 يوم)', القيمة: expiring.total_count },
    { المؤشر: 'مستندات منتهية الصلاحية فعلياً', القيمة: expired.total_count },
    { المؤشر: 'روابط مشاركة نشطة', القيمة: activeShareLinks.length },
    { المؤشر: 'إجمالي روابط المشاركة (تاريخياً)', القيمة: shareLinks.length },
  ];

  return {
    title: 'التقرير التنفيذي - نظام إدارة المستندات',
    generated_at: nowISO(),
    filters: { projectId },
    total_count: rows.length,
    rows,
  };
}

// ==================================================================================
// ==================================== التصدير ======================================
// ==================================================================================

/** يحوّل أي تقرير (سواء له rows بسيطة أو مؤشرات) إلى جدول (headers/dataRows) موحّد للتصدير */
function flattenReportToTable(report) {
  const rows = report.rows || [];
  if (rows.length === 0) {
    return {
      headers: ['الحقل', 'القيمة'],
      dataRows: Object.entries(report).filter(([k]) => k !== 'rows').map(
        ([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)],
      ),
    };
  }
  const keys = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));
  const headers = keys;
  const dataRows = rows.map((r) => keys.map((k) => {
    const v = r[k];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));
  return { headers, dataRows };
}

function exportDmsReportToPDF(report, meta = {}) {
  const filename = `dms-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const result = generateBoqTablePDF({
    title: report.title || 'DMS Report',
    meta,
    headers,
    rows: dataRows,
    totals: null,
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportDmsReportToExcel(report) {
  const filename = `dms-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const rows = [headers, ...dataRows];
  const buffer = generateXlsx([{ name: 'DMS Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportDmsReportToCSV(report) {
  const filename = `dms-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateCsv(headers, dataRows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** تصدير Word مبسّط بصيغة RTF (يفتح مباشرة في Microsoft Word دون مكتبات خارجية) */
function exportDmsReportToWord(report) {
  const filename = `dms-report-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${headers.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = dataRows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title || 'DMS Report')}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n\\trowd\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) */
function exportDmsReportToPrintableHTML(report, meta = {}) {
  const filename = `dms-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  const theadHtml = headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title || 'تقرير إدارة المستندات'}</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#1a2634}
h1{border-bottom:3px solid #0d2438;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
th{background:#0d2438;color:#fff}
tr:nth-child(even){background:#f5f7fa}
.meta{margin:10px 0;color:#555}
@media print{button{display:none}}
</style></head><body>
<h1>${report.title || 'تقرير إدارة المستندات'}</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | تاريخ الإصدار: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  // بناء التقارير الثمانية
  buildDocumentsReport,
  buildVersionsReport,
  buildApprovalsReport,
  buildUsersActivityReport,
  buildActivityLogReport,
  buildArchiveReport,
  buildExpiringDocumentsReport,
  buildExecutiveReport,

  // التصدير
  exportDmsReportToPDF,
  exportDmsReportToExcel,
  exportDmsReportToCSV,
  exportDmsReportToWord,
  exportDmsReportToPrintableHTML,
};
