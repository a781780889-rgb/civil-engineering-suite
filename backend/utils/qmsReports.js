/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * الجزء الرابع (4/4) - الوحدة الثانية: التقارير (QMS Reports Module)
 * =====================================================================================
 * تُنتج جميع التقارير المطلوبة في القسم التاسع (البند 18):
 *  - التقرير اليومي / الأسبوعي / الشهري
 *  - تقرير طلبات الفحص (IR)
 *  - تقرير الاختبارات (اختبارات المواد)
 *  - تقرير NCR
 *  - تقرير CAPA
 *  - تقرير المختبر
 *  - تقرير أداء الجودة (KPIs)
 *  - التقرير التنفيذي
 * مع تصدير PDF احترافي / Excel / CSV / Word (RTF) / طباعة مباشرة (HTML)
 * بنفس نمط hseReports.js تماماً للحفاظ على اتساق المعمارية.
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const QMS = require('./qmsManagement');
const QMSX = require('./qmsDocsKpis');
const QMS_ALERTS = require('./qmsAlerts');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

/** كل دوال وحدات QMS تُرجع {success, data, ...} — هذه الدالة تستخرج data بأمان */
function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

// ===================== بناء بيانات التقارير (Report Builders) =====================

/** تقرير طلبات الفحص (IR) */
function buildInspectionRequestsReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  let irs = unwrap(QMS.listInspectionRequests({ projectId })) || [];
  if (dateFrom || dateTo) irs = irs.filter((r) => inRange(r.created_at, dateFrom, dateTo));
  const byStatus = {};
  const byResult = {};
  irs.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byResult[r.result] = (byResult[r.result] || 0) + 1;
  });
  return {
    title: 'تقرير طلبات الفحص (Inspection Requests)',
    generated_at: new Date().toISOString(),
    total_requests: irs.length,
    by_status: byStatus,
    by_result: byResult,
    rows: irs,
  };
}

/** تقرير اختبارات المواد */
function buildMaterialTestsReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  let tests = unwrap(QMS.listMaterialTests({ projectId })) || [];
  if (dateFrom || dateTo) tests = tests.filter((t) => inRange(t.created_at, dateFrom, dateTo));
  const byCategory = {};
  const byResult = {};
  tests.forEach((t) => {
    byCategory[t.material_category] = (byCategory[t.material_category] || 0) + 1;
    byResult[t.result] = (byResult[t.result] || 0) + 1;
  });
  return {
    title: 'تقرير اختبارات المواد',
    generated_at: new Date().toISOString(),
    total_tests: tests.length,
    by_category: byCategory,
    by_result: byResult,
    rows: tests,
  };
}

/** تقرير حالات عدم المطابقة (NCR) */
function buildNcrReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  let ncrs = unwrap(QMS.listNcrs({ projectId })) || [];
  if (dateFrom || dateTo) ncrs = ncrs.filter((n) => inRange(n.created_at, dateFrom, dateTo));
  const bySeverity = {};
  const byStatus = {};
  ncrs.forEach((n) => {
    bySeverity[n.severity] = (bySeverity[n.severity] || 0) + 1;
    byStatus[n.status] = (byStatus[n.status] || 0) + 1;
  });
  const closureKpis = unwrap(QMSX.getQualityKpis({ projectId }))?.ncr_closure || null;
  return {
    title: 'تقرير حالات عدم المطابقة (NCR)',
    generated_at: new Date().toISOString(),
    total_ncrs: ncrs.length,
    open_count: ncrs.filter((n) => n.status !== 'closed').length,
    closed_count: ncrs.filter((n) => n.status === 'closed').length,
    by_severity: bySeverity,
    by_status: byStatus,
    closure_kpis: closureKpis,
    rows: ncrs,
  };
}

/** تقرير الإجراءات التصحيحية والوقائية (CAPA) */
function buildCapaReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  let capas = unwrap(QMS.listCapas({ projectId })) || [];
  if (dateFrom || dateTo) capas = capas.filter((c) => inRange(c.created_at, dateFrom, dateTo));
  const byStatus = {};
  const byType = {};
  const byEffectiveness = {};
  const today = new Date();
  let overdueCount = 0;
  capas.forEach((c) => {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    byType[c.type] = (byType[c.type] || 0) + 1;
    byEffectiveness[c.effectiveness] = (byEffectiveness[c.effectiveness] || 0) + 1;
    if (c.due_date && !['closed', 'verified'].includes(c.status) && new Date(c.due_date) < today) overdueCount += 1;
  });
  return {
    title: 'تقرير الإجراءات التصحيحية والوقائية (CAPA)',
    generated_at: new Date().toISOString(),
    total_capas: capas.length,
    overdue_count: overdueCount,
    by_status: byStatus,
    by_type: byType,
    by_effectiveness: byEffectiveness,
    rows: capas,
  };
}

/** تقرير المختبر (المختبرات + الفنيون + الأجهزة والمعايرة) */
function buildLabReport({ labId = null } = {}) {
  const labs = unwrap(QMS.listLabs({})) || [];
  const technicians = unwrap(QMS.listLabTechnicians({})) || [];
  const equipment = unwrap(QMS.listLabEquipment({})) || [];
  const filteredEquipment = labId ? equipment.filter((e) => e.lab_id === labId) : equipment;
  const today = new Date();
  const dueSoonOrOverdue = filteredEquipment.filter((e) => {
    if (!e.next_calibration_date) return false;
    const days = Math.floor((new Date(e.next_calibration_date) - today) / (1000 * 60 * 60 * 24));
    return days <= 14;
  });
  return {
    title: 'تقرير المختبر',
    generated_at: new Date().toISOString(),
    total_labs: labs.length,
    total_technicians: technicians.length,
    total_equipment: filteredEquipment.length,
    equipment_needing_calibration: dueSoonOrOverdue.length,
    rows: filteredEquipment,
  };
}

/** تقرير أداء الجودة (KPIs) */
function buildQualityPerformanceReport({ projectId = null } = {}) {
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  return {
    title: 'تقرير أداء الجودة (KPIs)',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    general: kpis?.general || {},
    ncr_closure: kpis?.ncr_closure || {},
    supplier_performance: kpis?.supplier_performance || {},
    contractor_performance: kpis?.contractor_performance || {},
    rows: [],
  };
}

/** تقرير دوري (يومي/أسبوعي/شهري) حسب نطاق تاريخ يُحدَّد مسبقاً من الاستدعاء */
function buildPeriodicReport({ projectId = null, period = 'daily', dateFrom = null, dateTo = null } = {}) {
  const periodLabels = { daily: 'التقرير اليومي', weekly: 'التقرير الأسبوعي', monthly: 'التقرير الشهري' };
  const irs = buildInspectionRequestsReport({ projectId, dateFrom, dateTo });
  const tests = buildMaterialTestsReport({ projectId, dateFrom, dateTo });
  const ncrs = buildNcrReport({ projectId, dateFrom, dateTo });
  const capas = buildCapaReport({ projectId, dateFrom, dateTo });
  return {
    title: periodLabels[period] || 'تقرير دوري',
    generated_at: new Date().toISOString(),
    period,
    date_from: dateFrom,
    date_to: dateTo,
    project_id: projectId,
    inspection_requests: { total: irs.total_requests, by_status: irs.by_status, by_result: irs.by_result },
    material_tests: { total: tests.total_tests, by_category: tests.by_category, by_result: tests.by_result },
    ncrs: { total: ncrs.total_ncrs, open: ncrs.open_count, closed: ncrs.closed_count },
    capas: { total: capas.total_capas, overdue: capas.overdue_count },
    rows: [],
  };
}

/** التقرير التنفيذي (يجمع كل جوانب الجودة في تقرير واحد شامل) */
function buildExecutiveReport({ projectId = null } = {}) {
  const dashboard = unwrap(QMS.getDashboard(projectId));
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  const alertsSummary = QMS_ALERTS.getAlertsSummary({ projectId });
  const ncrReport = buildNcrReport({ projectId });
  const capaReport = buildCapaReport({ projectId });

  return {
    title: 'التقرير التنفيذي لإدارة الجودة',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    overview: dashboard,
    kpis,
    alerts_summary: {
      total: alertsSummary.total,
      by_severity: alertsSummary.by_severity,
      by_type: alertsSummary.by_type,
    },
    ncr_summary: {
      total: ncrReport.total_ncrs, open: ncrReport.open_count, closed: ncrReport.closed_count,
      by_severity: ncrReport.by_severity,
    },
    capa_summary: {
      total: capaReport.total_capas, overdue: capaReport.overdue_count,
      by_status: capaReport.by_status,
    },
  };
}

// ===================== تحويل التقرير لصفوف جدولية (لأغراض PDF/Excel/CSV) =====================

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

// ===================== التصدير =====================

function exportQmsReportToPDF(report, meta = {}) {
  const filename = `qms-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const result = generateBoqTablePDF({
    title: report.title || 'QMS Report',
    meta,
    headers,
    rows: dataRows,
    totals: null,
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportQmsReportToExcel(report) {
  const filename = `qms-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const rows = [headers, ...dataRows];
  const buffer = generateXlsx([{ name: 'QMS Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportQmsReportToCSV(report) {
  const filename = `qms-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateCsv(headers, dataRows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** تصدير Word مبسّط بصيغة RTF (يفتح مباشرة في Microsoft Word دون مكتبات خارجية) */
function exportQmsReportToWord(report) {
  const filename = `qms-report-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${headers.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = dataRows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title || 'QMS Report')}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n\\trowd\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) */
function exportQmsReportToPrintableHTML(report, meta = {}) {
  const filename = `qms-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  const theadHtml = headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title || 'تقرير إدارة الجودة'}</title>
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
<h1>${report.title || 'تقرير إدارة الجودة'}</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | تاريخ الإصدار: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  buildInspectionRequestsReport,
  buildMaterialTestsReport,
  buildNcrReport,
  buildCapaReport,
  buildLabReport,
  buildQualityPerformanceReport,
  buildPeriodicReport,
  buildExecutiveReport,
  exportQmsReportToPDF,
  exportQmsReportToExcel,
  exportQmsReportToCSV,
  exportQmsReportToWord,
  exportQmsReportToPrintableHTML,
};
