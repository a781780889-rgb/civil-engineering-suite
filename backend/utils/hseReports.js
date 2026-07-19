/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * وحدة التقارير الموحّدة (HSE Reports Module)
 * ================================================
 * تُنتج جميع التقارير المطلوبة في القسم الثامن:
 *  - تقرير الحوادث
 *  - تقرير الإصابات
 *  - تقرير المخاطر
 *  - تقرير التفتيش
 *  - تقرير المخالفات
 *  - تقرير تصاريح العمل
 *  - تقرير معدات الوقاية (PPE)
 *  - تقرير الطوارئ (خطط + تدريبات + تفعيلات)
 *  - تقرير التدريب
 *  - تقرير الأداء (مؤشرات KPI)
 *  - التقرير التنفيذي (يجمع كل الأقسام في تقرير واحد)
 * مع تصدير PDF احترافي / Excel / CSV / Word (RTF) / طباعة مباشرة (HTML)
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const HSE = require('./hseManagement');
const HSE_EMG = require('./hseEmergency');
const HSE_TRN = require('./hseTraining');
const HSE_HZM = require('./hseHazmat');
const HSE_FIRE = require('./hseFireSafety');
const HSE_VIOL = require('./hseViolations');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

/** كل دوال وحدات HSE تُرجع {success, data, ...} — هذه الدالة تستخرج data بأمان */
function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

// ===================== بناء بيانات التقارير (Report Builders) =====================

/** تقرير الحوادث والإصابات */
function buildIncidentsReport(filters = {}) {
  const incidents = unwrap(HSE.listIncidents(filters));
  const bySeverity = {};
  const byType = {};
  incidents.forEach((i) => {
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    byType[i.type] = (byType[i.type] || 0) + 1;
  });
  return {
    title: 'تقرير الحوادث والإصابات',
    generated_at: new Date().toISOString(),
    total_incidents: incidents.length,
    by_severity: bySeverity,
    by_type: byType,
    open_count: incidents.filter((i) => i.status !== 'closed').length,
    closed_count: incidents.filter((i) => i.status === 'closed').length,
    rows: incidents,
  };
}

/** تقرير المخاطر */
function buildRisksReport(filters = {}) {
  const risks = unwrap(HSE.listRisks(filters));
  const matrix = unwrap(HSE.getRiskMatrix(filters.projectId || null));
  return {
    title: 'تقرير المخاطر',
    generated_at: new Date().toISOString(),
    total_risks: risks.length,
    matrix,
    rows: risks,
  };
}

/** تقرير التفتيش */
function buildInspectionsReport(filters = {}) {
  const inspections = unwrap(HSE.listInspections(filters));
  const findingsCount = inspections.reduce((sum, i) => {
    const findings = unwrap(HSE.listInspectionFindings({ inspectionId: i.id }));
    return sum + findings.length;
  }, 0);
  return {
    title: 'تقرير التفتيش',
    generated_at: new Date().toISOString(),
    total_inspections: inspections.length,
    total_findings: findingsCount,
    rows: inspections,
  };
}

/** تقرير المخالفات */
function buildViolationsReport(filters = {}) {
  const violations = unwrap(HSE_VIOL.listViolations(filters));
  const overdue = unwrap(HSE_VIOL.getOverdueViolations(filters.projectId || null));
  return {
    title: 'تقرير المخالفات',
    generated_at: new Date().toISOString(),
    total_violations: violations.length,
    overdue_count: overdue.length,
    rows: violations,
  };
}

/** تقرير تصاريح العمل */
function buildPermitsReport(filters = {}) {
  const permits = unwrap(HSE.listPermits(filters));
  const expiring = unwrap(HSE.getExpiringPermits({ projectId: filters.projectId || null, withinDays: 7 }));
  return {
    title: 'تقرير تصاريح العمل',
    generated_at: new Date().toISOString(),
    total_permits: permits.length,
    expiring_soon: expiring.length,
    rows: permits,
  };
}

/** تقرير معدات الوقاية الشخصية (PPE) */
function buildPpeReport(filters = {}) {
  const items = unwrap(HSE.listPpeItems(filters));
  const compliance = unwrap(HSE.getPpeComplianceSummary({ projectId: filters.projectId || null }));
  const dueForReplacement = unwrap(HSE.getPpeDueForReplacement({ projectId: filters.projectId || null, withinDays: 14 }));
  return {
    title: 'تقرير معدات الوقاية الشخصية (PPE)',
    generated_at: new Date().toISOString(),
    total_items: items.length,
    compliance,
    due_for_replacement: dueForReplacement.length,
    rows: items,
  };
}

/** تقرير الطوارئ */
function buildEmergencyReport(filters = {}) {
  const plans = unwrap(HSE_EMG.listEmergencyPlans(filters));
  const drills = unwrap(HSE_EMG.listDrills(filters));
  const activations = unwrap(HSE_EMG.listActivations(filters));
  return {
    title: 'تقرير الطوارئ',
    generated_at: new Date().toISOString(),
    total_plans: plans.length,
    total_drills: drills.length,
    total_activations: activations.length,
    rows: [...plans.map((p) => ({ __section: 'خطة', ...p })), ...drills.map((d) => ({ __section: 'تدريب', ...d })), ...activations.map((a) => ({ __section: 'تفعيل', ...a }))],
  };
}

/** تقرير التدريب */
function buildTrainingReport(filters = {}) {
  const courses = unwrap(HSE_TRN.listCourses(filters));
  const enrollments = unwrap(HSE_TRN.listEnrollments(filters));
  const expiringCerts = unwrap(HSE_TRN.getExpiringCertificates(filters));
  return {
    title: 'تقرير التدريب',
    generated_at: new Date().toISOString(),
    total_courses: courses.length,
    total_enrollments: enrollments.length,
    expiring_certificates: expiringCerts.length,
    rows: enrollments,
  };
}

/** تقرير الأداء (مؤشرات KPI) */
function buildPerformanceReport({ projectId = null, totalManHours = null, periodFrom = null, periodTo = null } = {}) {
  const kpis = unwrap(HSE.calculateSafetyKPIs({ projectId, totalManHours, periodFrom, periodTo }));
  const violationsDash = unwrap(HSE_VIOL.getViolationsDashboard(projectId));
  const fireDash = unwrap(HSE_FIRE.getFireSafetyDashboard(projectId));
  const hazmatDash = unwrap(HSE_HZM.getHazmatDashboard(projectId));
  return {
    title: 'تقرير الأداء (مؤشرات السلامة KPIs)',
    generated_at: new Date().toISOString(),
    kpis,
    violations_summary: violationsDash,
    fire_safety_summary: fireDash,
    hazmat_summary: hazmatDash,
  };
}

/** التقرير التنفيذي - يجمع كل أقسام HSE في تقرير واحد شامل للإدارة */
function buildExecutiveReport({ projectId = null } = {}) {
  const dashboard = unwrap(HSE.getDashboard(projectId));
  const kpis = unwrap(HSE.calculateSafetyKPIs({ projectId }));
  const emergencyDash = unwrap(HSE_EMG.getEmergencyDashboard(projectId));
  const trainingDash = unwrap(HSE_TRN.getTrainingDashboard({ projectId }));
  const hazmatDash = unwrap(HSE_HZM.getHazmatDashboard(projectId));
  const fireDash = unwrap(HSE_FIRE.getFireSafetyDashboard(projectId));
  const violationsDash = unwrap(HSE_VIOL.getViolationsDashboard(projectId));

  return {
    title: 'التقرير التنفيذي للسلامة المهنية',
    generated_at: new Date().toISOString(),
    project_id: projectId,
    overview: dashboard,
    kpis,
    emergency: emergencyDash,
    training: trainingDash,
    hazmat: hazmatDash,
    fire_safety: fireDash,
    violations: violationsDash,
  };
}

// ===================== تحويل التقرير لصفوف جدولية (لأغراض PDF/Excel/CSV) =====================

function flattenReportToTable(report) {
  const rows = report.rows || [];
  if (rows.length === 0) {
    return { headers: ['الحقل', 'القيمة'], dataRows: Object.entries(report).filter(([k]) => k !== 'rows').map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]) };
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

function exportHseReportToPDF(report, meta = {}) {
  const filename = `hse-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const result = generateBoqTablePDF({
    title: report.title || 'HSE Report',
    meta,
    headers,
    rows: dataRows,
    totals: null,
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportHseReportToExcel(report) {
  const filename = `hse-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const rows = [headers, ...dataRows];
  const buffer = generateXlsx([{ name: 'HSE Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportHseReportToCSV(report) {
  const filename = `hse-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateCsv(headers, dataRows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** تصدير Word مبسّط بصيغة RTF (يفتح مباشرة في Microsoft Word دون مكتبات خارجية) */
function exportHseReportToWord(report) {
  const filename = `hse-report-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${headers.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = dataRows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title || 'HSE Report')}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n\\trowd\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) */
function exportHseReportToPrintableHTML(report, meta = {}) {
  const filename = `hse-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  const theadHtml = headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title || 'تقرير السلامة المهنية'}</title>
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
<h1>${report.title || 'تقرير السلامة المهنية'}</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | تاريخ الإصدار: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  buildIncidentsReport,
  buildRisksReport,
  buildInspectionsReport,
  buildViolationsReport,
  buildPermitsReport,
  buildPpeReport,
  buildEmergencyReport,
  buildTrainingReport,
  buildPerformanceReport,
  buildExecutiveReport,
  exportHseReportToPDF,
  exportHseReportToExcel,
  exportHseReportToCSV,
  exportHseReportToWord,
  exportHseReportToPrintableHTML,
};
