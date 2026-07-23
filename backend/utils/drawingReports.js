/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء 10أ/10 (تقسيم الجزء 10/10 الأصلي إلى قسمين): التنبيهات + التقارير
 *   - drawingNotifications.js: التنبيهات
 *   - هذا الملف: التقارير + التصدير
 * الجزء 10ب/10 (لاحقاً): الذكاء الاصطناعي + التكامل الشامل مع بقية الأقسام
 * =====================================================================================
 *
 * يغطي هذا الملف بالكامل بند "التقارير" الوارد في مواصفة القسم الثاني عشر:
 *  - تقرير المخططات.
 *  - تقرير المراجعات.
 *  - تقرير الإصدارات.
 *  - تقرير التعليقات.
 *  - تقرير الاعتمادات.
 *  - تقرير المشاريع (تجميع المخططات حسب كل مشروع).
 *  - التقرير التنفيذي (يجمع كل الأقسام أعلاه في تقرير واحد شامل).
 * مع دعم التصدير إلى: PDF احترافي / Excel / CSV / Word (RTF) / طباعة مباشرة (HTML)
 * — بنفس أسلوب equipmentReports.js وhseReports.js تماماً (القسمان السابع والثامن)
 * فوق نفس أدوات التصدير المشتركة (tablePdfGenerator.js / xlsxWriter.js / csvWriter.js)
 * بدون أي تبعيات خارجية.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل تقرير مبنيّ فعلياً من طبقة التخزين الموحّدة الحقيقية drawings.json (نفس ملف
 *    كل الأجزاء 1/10 حتى 9/10) عبر drawingManagement._internal.loadDB مباشرة - نفس
 *    نمط الوصول المُستخدَم فعلياً داخل drawingManagement.getDashboardStats نفسه -
 *    وليس بيانات وهمية أو تقديرية.
 *  - التقارير التي تحتاج تجميعاً عبر كل المخططات (المراجعات/التعليقات/الاعتمادات/
 *    المشاريع/التنفيذي) تعتمد على نفس المجموعات الحقيقية (db.reviews/db.comments/
 *    db.approvals/db.comparisons/db.versions) التي تُحدِّثها فعلياً الأجزاء 2/10
 *    و5/10 و6/10 و7/10 و8/10 عند كل عملية - وليست إعادة حساب منفصلة.
 *  - التصدير الفعلي: PDF بجداول حقيقية (tablePdfGenerator)، Excel حقيقي (ملف ZIP+XML
 *    صالح فعلياً يُفتح في Excel)، CSV متوافق RFC 4180 مع BOM عربي، Word عبر RTF فعلي
 *    يُفتح مباشرة في Microsoft Word دون أي مكتبات خارجية، وHTML جاهز للطباعة الفورية.
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const DRAW = require('./drawingManagement');
const { loadDB } = DRAW._internal;

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function dOnly(d) { return d ? String(d).slice(0, 10) : '—'; }

// ===================== أدوات مساعدة لجلب أسماء/أرقام المخططات =====================
function buildDrawingLookup(db) {
  const map = {};
  for (const d of db.drawings) {
    map[d.id] = {
      drawing_number: d.drawing_number,
      name: d.name,
      discipline: d.discipline,
      project_id: d.project_id,
      is_deleted: d.is_deleted,
    };
  }
  return map;
}

// ===================== 1) تقرير المخططات (Drawings Report) =====================
/**
 * سجل شامل لكل المخططات (أو ضمن نطاق مشروع/تخصص/حالة اعتماد معيّنة)، بما يعادل
 * فعلياً "سجل المخططات" (Drawing Register) المطلوب في أي نظام إدارة مخططات هندسي.
 */
function buildDrawingsReport({
  projectId = null, discipline = null, approvalStatus = null,
} = {}) {
  const filters = {};
  if (projectId) filters.project_id = projectId;
  if (discipline) filters.discipline = discipline;
  if (approvalStatus) filters.approval_status = approvalStatus;

  const drawings = DRAW.listDrawings(filters);

  const byDiscipline = {};
  const byStatus = {};
  drawings.forEach((d) => {
    byDiscipline[d.discipline] = (byDiscipline[d.discipline] || 0) + 1;
    byStatus[d.approval_status] = (byStatus[d.approval_status] || 0) + 1;
  });

  const rows = drawings.map((d, i) => ({
    seq: i + 1,
    drawing_number: d.drawing_number,
    name: d.name,
    discipline: d.discipline,
    subtype: d.subtype || '-',
    project_id: d.project_id || '-',
    responsible_engineer: d.responsible_engineer || '-',
    approval_status: d.approval_status,
    current_version: d.current_version,
    created_at: dOnly(d.created_at),
    updated_at: dOnly(d.updated_at),
  }));

  return {
    report_type: 'drawings_register',
    title: 'تقرير المخططات (سجل المخططات)',
    generated_at: new Date().toISOString(),
    filters: { projectId, discipline, approvalStatus },
    total_count: rows.length,
    by_discipline: byDiscipline,
    by_status: byStatus,
    rows,
  };
}

// ===================== 2) تقرير المراجعات (Reviews Report) =====================
function buildReviewsReport({ projectId = null, decision = null, dateFrom = null, dateTo = null } = {}) {
  const db = loadDB();
  const lookup = buildDrawingLookup(db);
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

  let reviews = (db.reviews || []).filter((r) => !lookup[r.drawing_id]?.is_deleted);
  if (projectId) reviews = reviews.filter((r) => lookup[r.drawing_id]?.project_id === projectId);
  if (decision) reviews = reviews.filter((r) => r.decision === decision);
  reviews = reviews.filter((r) => inRange(dOnly(r.created_at)));

  reviews = [...reviews].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const byDecision = {};
  reviews.forEach((r) => { byDecision[r.decision] = (byDecision[r.decision] || 0) + 1; });

  const rows = reviews.map((r, i) => ({
    seq: i + 1,
    drawing_number: lookup[r.drawing_id]?.drawing_number || r.drawing_id,
    drawing_name: lookup[r.drawing_id]?.name || '-',
    decision: r.decision,
    actor: r.actor || '-',
    note: r.note || '-',
    created_at: dOnly(r.created_at),
  }));

  return {
    report_type: 'drawing_reviews',
    title: 'تقرير مراجعة المخططات',
    generated_at: new Date().toISOString(),
    filters: {
      projectId, decision, dateFrom, dateTo,
    },
    total_count: rows.length,
    by_decision: byDecision,
    rows,
  };
}

// ===================== 3) تقرير الإصدارات (Versions Report) =====================
function buildVersionsReport({ projectId = null, drawingId = null } = {}) {
  const db = loadDB();
  const lookup = buildDrawingLookup(db);

  let versions = (db.versions || []).filter((v) => !lookup[v.drawing_id]?.is_deleted);
  if (projectId) versions = versions.filter((v) => lookup[v.drawing_id]?.project_id === projectId);
  if (drawingId) versions = versions.filter((v) => v.drawing_id === drawingId);

  versions = [...versions].sort((a, b) => new Date(b.uploaded_at || b.created_at) - new Date(a.uploaded_at || a.created_at));

  const rows = versions.map((v, i) => ({
    seq: i + 1,
    drawing_number: lookup[v.drawing_id]?.drawing_number || v.drawing_id,
    drawing_name: lookup[v.drawing_id]?.name || '-',
    version_number: v.version_number,
    uploaded_by: v.uploaded_by || v.actor || '-',
    change_note: v.change_note || v.note || '-',
    file_size: v.file_size_human || v.size_human || '-',
    uploaded_at: dOnly(v.uploaded_at || v.created_at),
  }));

  return {
    report_type: 'drawing_versions',
    title: 'تقرير إصدارات المخططات',
    generated_at: new Date().toISOString(),
    filters: { projectId, drawingId },
    total_count: rows.length,
    rows,
  };
}

// ===================== 4) تقرير التعليقات (Comments Report) =====================
function buildCommentsReport({
  projectId = null, category = null, isClosed = null, dateFrom = null, dateTo = null,
} = {}) {
  const db = loadDB();
  const lookup = buildDrawingLookup(db);
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

  let comments = (db.comments || []).filter((c) => !lookup[c.drawing_id]?.is_deleted);
  if (projectId) comments = comments.filter((c) => lookup[c.drawing_id]?.project_id === projectId);
  if (category) comments = comments.filter((c) => c.category === category);
  if (isClosed !== null && isClosed !== undefined) comments = comments.filter((c) => c.is_closed === isClosed);
  comments = comments.filter((c) => inRange(dOnly(c.created_at)));

  comments = [...comments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const byCategory = {};
  const byImplementationStatus = {};
  comments.forEach((c) => {
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    byImplementationStatus[c.implementation_status] = (byImplementationStatus[c.implementation_status] || 0) + 1;
  });

  const rows = comments.map((c, i) => ({
    seq: i + 1,
    drawing_number: lookup[c.drawing_id]?.drawing_number || c.drawing_id,
    drawing_name: lookup[c.drawing_id]?.name || '-',
    category: c.category,
    author: c.created_by || '-',
    text: (c.text || '').slice(0, 80),
    implementation_status: c.implementation_status,
    is_closed: c.is_closed ? 'مغلق' : 'مفتوح',
    created_at: dOnly(c.created_at),
  }));

  return {
    report_type: 'drawing_comments',
    title: 'تقرير التعليقات والملاحظات',
    generated_at: new Date().toISOString(),
    filters: {
      projectId, category, isClosed, dateFrom, dateTo,
    },
    total_count: rows.length,
    by_category: byCategory,
    by_implementation_status: byImplementationStatus,
    rows,
  };
}

// ===================== 5) تقرير الاعتمادات (Approvals Report) =====================
function buildApprovalsReport({
  projectId = null, level = null, decision = null, dateFrom = null, dateTo = null,
} = {}) {
  const db = loadDB();
  const lookup = buildDrawingLookup(db);
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

  let approvals = (db.approvals || []).filter((a) => !lookup[a.drawing_id]?.is_deleted);
  if (projectId) approvals = approvals.filter((a) => lookup[a.drawing_id]?.project_id === projectId);
  if (level) approvals = approvals.filter((a) => a.level === level);
  if (decision) approvals = approvals.filter((a) => a.decision === decision);
  approvals = approvals.filter((a) => inRange(dOnly(a.signed_at)));

  approvals = [...approvals].sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));

  const byLevel = {};
  const byDecision = {};
  approvals.forEach((a) => {
    byLevel[a.level] = (byLevel[a.level] || 0) + 1;
    byDecision[a.decision] = (byDecision[a.decision] || 0) + 1;
  });

  const rows = approvals.map((a, i) => ({
    seq: i + 1,
    drawing_number: lookup[a.drawing_id]?.drawing_number || a.drawing_id,
    drawing_name: lookup[a.drawing_id]?.name || '-',
    level_label: a.level_label || a.level,
    decision: a.decision,
    signer_name: a.signer_name,
    revoked: a.revoked ? 'ملغى' : 'ساري',
    signed_at: dOnly(a.signed_at),
  }));

  return {
    report_type: 'drawing_approvals',
    title: 'تقرير الاعتمادات',
    generated_at: new Date().toISOString(),
    filters: {
      projectId, level, decision, dateFrom, dateTo,
    },
    total_count: rows.length,
    by_level: byLevel,
    by_decision: byDecision,
    rows,
  };
}

// ===================== 6) تقرير المشاريع (Projects Report) =====================
/** تجميع كل المخططات حسب كل مشروع - نظرة عامة على حالة مخططات كل مشروع على حدة */
function buildProjectsReport() {
  const db = loadDB();
  const active = db.drawings.filter((d) => !d.is_deleted);

  const byProject = {};
  active.forEach((d) => {
    const pid = d.project_id || 'بدون مشروع';
    if (!byProject[pid]) {
      byProject[pid] = {
        project_id: pid, total: 0, approved: 0, under_review: 0, rejected: 0, draft: 0,
      };
    }
    byProject[pid].total += 1;
    if (byProject[pid][d.approval_status] !== undefined) byProject[pid][d.approval_status] += 1;
  });

  const rows = Object.values(byProject).map((p, i) => ({
    seq: i + 1,
    project_id: p.project_id,
    total_drawings: p.total,
    approved: p.approved,
    under_review: p.under_review,
    rejected: p.rejected,
    draft: p.draft,
    completion_pct: p.total ? Math.round((p.approved / p.total) * 100) : 0,
  }));

  return {
    report_type: 'drawing_projects',
    title: 'تقرير المخططات حسب المشروع',
    generated_at: new Date().toISOString(),
    total_count: rows.length,
    rows,
  };
}

// ===================== 7) التقرير التنفيذي (Executive Summary) =====================
/** يجمع ملخصاً من كل التقارير أعلاه في تقرير واحد شامل لمتخذي القرار */
function buildExecutiveSummaryReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const dashboard = DRAW.getDashboardStats();
  const drawingsRep = buildDrawingsReport({ projectId });
  const reviewsRep = buildReviewsReport({ projectId, dateFrom, dateTo });
  const versionsRep = buildVersionsReport({ projectId });
  const commentsRep = buildCommentsReport({ projectId, dateFrom, dateTo });
  const approvalsRep = buildApprovalsReport({ projectId, dateFrom, dateTo });
  const projectsRep = projectId ? null : buildProjectsReport();

  let notifSummary = null;
  try {
    // eslint-disable-next-line global-require
    notifSummary = require('./drawingNotifications').getNotificationsSummary({ });
  } catch (e) {
    notifSummary = null;
  }

  const openComments = commentsRep.rows.filter((r) => r.is_closed === 'مفتوح').length;

  return {
    report_type: 'executive_summary',
    title: 'التقرير التنفيذي لإدارة المخططات الهندسية',
    generated_at: new Date().toISOString(),
    filters: { projectId, dateFrom, dateTo },
    totals: dashboard.totals,
    by_status: dashboard.by_status,
    by_discipline: dashboard.by_discipline,
    reviews_count: reviewsRep.total_count,
    reviews_by_decision: reviewsRep.by_decision,
    versions_count: versionsRep.total_count,
    comments_count: commentsRep.total_count,
    open_comments_count: openComments,
    approvals_count: approvalsRep.total_count,
    approvals_by_decision: approvalsRep.by_decision,
    notifications_summary: notifSummary,
    projects_overview: projectsRep ? projectsRep.rows : null,
    // rows: أهم 10 مخططات حديثة كعيّنة سريعة (نفس نمط التقرير التنفيذي في equipmentReports.js)
    rows: drawingsRep.rows.slice(0, 10),
  };
}

// ==================================================================================
// ==================================== التصدير ====================================
// ==================================================================================

const REPORT_COLUMN_DEFS = {
  drawings_register: {
    titleAr: 'تقرير المخططات', titleEn: 'Drawings Register Report',
    headers: ['#', 'رقم المخطط', 'الاسم', 'التخصص', 'النوع الفرعي', 'المشروع', 'المهندس المسؤول', 'حالة الاعتماد', 'الإصدار الحالي', 'تاريخ الإنشاء', 'آخر تحديث'],
    keys: ['seq', 'drawing_number', 'name', 'discipline', 'subtype', 'project_id', 'responsible_engineer', 'approval_status', 'current_version', 'created_at', 'updated_at'],
  },
  drawing_reviews: {
    titleAr: 'تقرير مراجعة المخططات', titleEn: 'Drawing Reviews Report',
    headers: ['#', 'رقم المخطط', 'اسم المخطط', 'القرار', 'المستخدم', 'ملاحظة', 'التاريخ'],
    keys: ['seq', 'drawing_number', 'drawing_name', 'decision', 'actor', 'note', 'created_at'],
  },
  drawing_versions: {
    titleAr: 'تقرير إصدارات المخططات', titleEn: 'Drawing Versions Report',
    headers: ['#', 'رقم المخطط', 'اسم المخطط', 'رقم الإصدار', 'رفعه', 'ملاحظة التغيير', 'حجم الملف', 'تاريخ الرفع'],
    keys: ['seq', 'drawing_number', 'drawing_name', 'version_number', 'uploaded_by', 'change_note', 'file_size', 'uploaded_at'],
  },
  drawing_comments: {
    titleAr: 'تقرير التعليقات والملاحظات', titleEn: 'Drawing Comments Report',
    headers: ['#', 'رقم المخطط', 'اسم المخطط', 'التصنيف', 'الكاتب', 'النص', 'حالة التنفيذ', 'الحالة', 'التاريخ'],
    keys: ['seq', 'drawing_number', 'drawing_name', 'category', 'author', 'text', 'implementation_status', 'is_closed', 'created_at'],
  },
  drawing_approvals: {
    titleAr: 'تقرير الاعتمادات', titleEn: 'Drawing Approvals Report',
    headers: ['#', 'رقم المخطط', 'اسم المخطط', 'المستوى', 'القرار', 'الموقِّع', 'الحالة', 'تاريخ التوقيع'],
    keys: ['seq', 'drawing_number', 'drawing_name', 'level_label', 'decision', 'signer_name', 'revoked', 'signed_at'],
  },
  drawing_projects: {
    titleAr: 'تقرير المخططات حسب المشروع', titleEn: 'Drawings by Project Report',
    headers: ['#', 'المشروع', 'إجمالي المخططات', 'معتمد', 'قيد المراجعة', 'مرفوض', 'مسودة', 'نسبة الإنجاز %'],
    keys: ['seq', 'project_id', 'total_drawings', 'approved', 'under_review', 'rejected', 'draft', 'completion_pct'],
  },
};

function reportRowsToTable(report) {
  const def = REPORT_COLUMN_DEFS[report.report_type];
  if (!def) throw new Error(`لا يوجد تعريف أعمدة لهذا النوع من التقارير: ${report.report_type}`);
  const rows = (report.rows || []).map((row) => def.keys.map((k) => row[k] ?? '-'));
  return { def, rows };
}

function exportDrawingReportToPDF(report, meta = {}) {
  if (report.report_type === 'executive_summary') return exportExecutiveSummaryToPDF(report, meta);
  const { def, rows } = reportRowsToTable(report);
  const filename = `drawings-${report.report_type}-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const result = generateBoqTablePDF({
    title: def.titleEn,
    meta: { ...meta, generatedAt: report.generated_at },
    headers: def.headers,
    rows,
    totals: { label: 'Total Records', value: report.total_count ?? rows.length },
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportDrawingReportToExcel(report) {
  const { def, rows } = reportRowsToTable(report);
  const filename = `drawings-${report.report_type}-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const sheetRows = [def.headers, ...rows];
  const buffer = generateXlsx([{ name: def.titleEn.slice(0, 28), rows: sheetRows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportDrawingReportToCSV(report) {
  const { def, rows } = reportRowsToTable(report);
  const filename = `drawings-${report.report_type}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const buffer = generateCsv(def.headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** تصدير Word مبسّط بصيغة RTF (يفتح مباشرة في Microsoft Word دون مكتبات خارجية) - نفس نمط hseReports.js */
function exportDrawingReportToWord(report) {
  if (report.report_type === 'executive_summary') return exportExecutiveSummaryToWord(report);
  const { def, rows } = reportRowsToTable(report);
  const filename = `drawings-${report.report_type}-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${def.headers.map((_, idx) => `\\cellx${(idx + 1) * 1800}`).join('')}\n${def.headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = rows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 1800}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(def.titleAr)}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) - نفس نمط hseReports.js */
function exportDrawingReportToPrintableHTML(report, meta = {}) {
  if (report.report_type === 'executive_summary') return exportExecutiveSummaryToPrintableHTML(report, meta);
  const { def, rows } = reportRowsToTable(report);
  const filename = `drawings-${report.report_type}-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const theadHtml = def.headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${def.titleAr}</title>
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
<button onclick="window.print()">طباعة</button>
<h1>${def.titleAr}</h1>
<div class="meta">${meta.projectName ? `المشروع: ${meta.projectName} — ` : ''}تاريخ الإنشاء: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

// ----- تصدير خاص بالتقرير التنفيذي (بنية مختلفة عن باقي التقارير - بلا rows جدولية بسيطة) -----

function executiveSummaryToKeyValueRows(report) {
  return [
    ['إجمالي المخططات', report.totals?.total_drawings ?? 0],
    ['معتمد', report.totals?.approved ?? 0],
    ['قيد المراجعة', report.totals?.under_review ?? 0],
    ['مرفوض', report.totals?.rejected ?? 0],
    ['إجمالي الإصدارات', report.totals?.total_versions ?? 0],
    ['إجمالي المراجعات', report.reviews_count ?? 0],
    ['إجمالي التعليقات', report.comments_count ?? 0],
    ['تعليقات مفتوحة', report.open_comments_count ?? 0],
    ['إجمالي الاعتمادات', report.approvals_count ?? 0],
    ['تعارضات BIM المفتوحة', report.totals?.open_bim_clashes ?? 0],
  ];
}

function exportExecutiveSummaryToPDF(report, meta = {}) {
  const filename = `drawings-executive-summary-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const kvRows = executiveSummaryToKeyValueRows(report);
  const result = generateBoqTablePDF({
    title: 'Executive Summary - Drawings Management',
    meta: { ...meta, generatedAt: report.generated_at },
    headers: ['Metric', 'Value'],
    rows: kvRows,
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportExecutiveSummaryToWord(report) {
  const filename = `drawings-executive-summary-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const kvRows = executiveSummaryToKeyValueRows(report);

  function rtfEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}'); }
  const bodyRows = kvRows.map(([k, v]) => `\\trowd\\trgaph70 \\cellx3000\\cellx6000\n\\intbl ${rtfEscape(k)}\\cell \\intbl ${rtfEscape(v)}\\cell\\row\n`).join('');
  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title)}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at).toLocaleString('ar-EG'))}\\par\\par\n${bodyRows}\n}`;
  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

function exportExecutiveSummaryToPrintableHTML(report, meta = {}) {
  const filename = `drawings-executive-summary-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const kvRows = executiveSummaryToKeyValueRows(report);
  const rowsHtml = kvRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title}</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#1a2634}
h1{border-bottom:3px solid #0d2438;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
th,td{border:1px solid #ccc;padding:8px 10px;text-align:right}
tr:nth-child(even){background:#f5f7fa}
.meta{margin:10px 0;color:#555}
@media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">طباعة</button>
<h1>${report.title}</h1>
<div class="meta">${meta.projectName ? `المشروع: ${meta.projectName} — ` : ''}تاريخ الإنشاء: ${new Date(report.generated_at).toLocaleString('ar-EG')}</div>
<table><tbody>${rowsHtml}</tbody></table>
</body></html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  buildDrawingsReport,
  buildReviewsReport,
  buildVersionsReport,
  buildCommentsReport,
  buildApprovalsReport,
  buildProjectsReport,
  buildExecutiveSummaryReport,

  exportDrawingReportToPDF,
  exportDrawingReportToExcel,
  exportDrawingReportToCSV,
  exportDrawingReportToWord,
  exportDrawingReportToPrintableHTML,
};
