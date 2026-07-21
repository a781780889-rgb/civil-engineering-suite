/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * وحدة التقارير الموحّدة (Survey Reports Module) - جزء من الفصل الأول (Setting-Out + Reports + AI)
 * ================================================================================
 * تُنتج التقارير المطلوبة في القسم العاشر:
 *  - تقرير الرفع المساحي
 *  - تقرير التوقيع (Setting-Out)
 *  - تقرير الإحداثيات (أنظمة الإحداثيات المعتمدة للمشروع)
 *  - تقرير نقاط التحكم / المناسيب
 *  - تقرير الحفر والردم (من المقاطع العرضية)
 *  - تقرير الدقة والأخطاء (إغلاق المضلعات + انحرافات التوقيع)
 *  - التقرير التنفيذي (يجمع كل ما سبق في تقرير واحد شامل للمشروع)
 * مع تصدير PDF احترافي / Excel / CSV / Word (RTF) / طباعة مباشرة (HTML)
 * — بنفس نمط وحدة hseReports.js تماماً لضمان الاتساق مع بقية أقسام النظام.
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const SURVEY = require('./surveyManagement');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

/** كل دوال وحدة المساحة تُرجع {success, data, ...} — هذه الدالة تستخرج data بأمان */
function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

// ===================== بناء بيانات التقارير (Report Builders) =====================

/** تقرير الرفع المساحي: كل عمليات الرفع (surveys) لمشروع معيّن */
function buildSurveyRecordsReport(filters = {}) {
  const records = unwrap(SURVEY.listSurveyRecords(filters));
  const byType = {};
  const byStatus = {};
  records.forEach((s) => {
    byType[s.survey_type] = (byType[s.survey_type] || 0) + 1;
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  });
  return {
    title: 'تقرير الرفع المساحي',
    generated_at: new Date().toISOString(),
    total_records: records.length,
    by_type: byType,
    by_status: byStatus,
    rows: records.map((s) => ({
      'رقم عملية الرفع': s.survey_number,
      'العنوان': s.title,
      'النوع': s.survey_type,
      'الحالة': s.status,
      'المسّاح': s.surveyor || '',
      'تاريخ الرفع': s.survey_date ? String(s.survey_date).slice(0, 10) : '',
      'الجهاز المستخدم': s.device_used || '',
      'عدد النقاط': (s.points || []).length,
    })),
  };
}

/** تقرير التوقيع المساحي (Setting-Out Report) */
function buildStakeoutReport(filters = {}) {
  const items = unwrap(SURVEY.listStakeouts(filters));
  const byType = {};
  const byStatus = {};
  let withinTolerance = 0;
  let outOfTolerance = 0;
  items.forEach((s) => {
    byType[s.stakeout_type] = (byType[s.stakeout_type] || 0) + 1;
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    if (s.deviation) {
      if (s.deviation.within_tolerance) withinTolerance += 1; else outOfTolerance += 1;
    }
  });
  return {
    title: 'تقرير التوقيع المساحي (Setting-Out)',
    generated_at: new Date().toISOString(),
    total_items: items.length,
    within_tolerance: withinTolerance,
    out_of_tolerance: outOfTolerance,
    by_type: byType,
    by_status: byStatus,
    rows: items.map((s) => ({
      'رقم التوقيع': s.stakeout_number,
      'العنوان': s.title,
      'النوع': SURVEY.STAKEOUT_TYPE_LABELS_AR[s.stakeout_type] || s.stakeout_type,
      'العنصر المرجعي': s.element_reference || '',
      'الحالة': s.status,
      'انحراف أفقي (م)': s.deviation ? s.deviation.horizontal_deviation_m : '',
      'حد التفاوت (م)': s.tolerance_m,
      'المسّاح': s.surveyor || '',
      'تاريخ التوقيع': s.stakeout_date ? String(s.stakeout_date).slice(0, 10) : '',
    })),
  };
}

/** تقرير أنظمة الإحداثيات المعتمدة للمشروع */
function buildCoordinateSystemsReport(filters = {}) {
  const items = unwrap(SURVEY.listCoordinateSystems(filters));
  return {
    title: 'تقرير أنظمة الإحداثيات',
    generated_at: new Date().toISOString(),
    total_systems: items.length,
    rows: items.map((c) => ({
      'الاسم': c.name,
      'النوع': c.system_type,
      'Datum': c.datum || '',
      'Projection': c.projection || '',
      'المنطقة (Zone)': c.zone ?? '',
      'افتراضي': c.is_default ? 'نعم' : 'لا',
    })),
  };
}

/** تقرير نقاط التحكم والمناسيب */
function buildControlPointsReport(filters = {}) {
  const items = unwrap(SURVEY.listControlPoints(filters));
  const byType = {};
  items.forEach((p) => { byType[p.point_type] = (byType[p.point_type] || 0) + 1; });
  return {
    title: 'تقرير نقاط الرفع والتحكم',
    generated_at: new Date().toISOString(),
    total_points: items.length,
    by_type: byType,
    rows: items.map((p) => ({
      'رقم النقطة': p.point_number,
      'الاسم': p.name || '',
      'النوع': p.point_type,
      'Easting': p.easting,
      'Northing': p.northing,
      'Elevation': p.elevation ?? '',
      'دقة القياس': p.accuracy ?? '',
      'الجهاز المستخدم': p.device_used || '',
      'تاريخ القياس': p.measured_at ? String(p.measured_at).slice(0, 10) : '',
    })),
  };
}

/** تقرير الحفر والردم من المقاطع العرضية لمجموعة عمليات رفع */
function buildEarthworkReport({ survey_ids } = {}) {
  const result = unwrap(SURVEY.calcEarthworkVolumeFromCrossSections({ survey_ids }));
  return {
    title: 'تقرير كميات الحفر والردم',
    generated_at: new Date().toISOString(),
    summary: {
      'عدد المقاطع': result.sections_count,
      'إجمالي حجم الحفر (م³)': result.total_cut_volume_cum,
      'إجمالي حجم الردم (م³)': result.total_fill_volume_cum,
      'صافي الحجم (م³)': result.net_volume_cum,
      'التوجه': result.net_direction,
    },
    rows: (result.intervals || []).map((iv, idx) => ({
      'الفاصل': idx + 1,
      'من Chainage': iv.chainage_start ?? '',
      'إلى Chainage': iv.chainage_end ?? '',
      'المسافة (م)': iv.distance,
      'حجم الحفر (م³)': iv.cut_volume_cum,
      'حجم الردم (م³)': iv.fill_volume_cum,
    })),
  };
}

/** تقرير الدقة والأخطاء: إغلاق المضلعات + انحرافات التوقيع مجمّعة */
function buildAccuracyReport({ project_id } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب لتقرير الدقة');
  const stakeoutComparison = unwrap(SURVEY.compareStakeoutBatchToDesign({ project_id }));
  const calcs = unwrap(SURVEY.listSurveyCalculations({ project_id, calc_type: 'traverse_closure', pageSize: 1000 }));
  return {
    title: 'تقرير الدقة والأخطاء المساحية',
    generated_at: new Date().toISOString(),
    stakeout_accuracy: {
      'إجمالي نقاط التوقيع': stakeoutComparison.total_points,
      'نقاط مقاسة': stakeoutComparison.measured_points,
      'نقاط خارج التفاوت': stakeoutComparison.out_of_tolerance_count,
      'أقصى انحراف (م)': stakeoutComparison.max_horizontal_deviation_m,
      'متوسط الانحراف (م)': stakeoutComparison.avg_horizontal_deviation_m,
      'الحكم العام': stakeoutComparison.overall_verdict,
    },
    rows: calcs.map((c) => ({
      'رقم الحساب': c.id,
      'نوع الحساب': c.calc_type,
      'خطأ الإغلاق الخطي (م)': c.result ? c.result.linear_closure_error_m : '',
      'دقة الإغلاق (Precision)': c.result ? c.result.closure_precision : '',
      'تاريخ الحساب': c.created_at ? String(c.created_at).slice(0, 10) : '',
    })),
  };
}

/** التقرير التنفيذي الشامل للمشروع المساحي: يجمع كل التقارير أعلاه في وثيقة واحدة */
function buildExecutiveSurveyReport({ project_id } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب للتقرير التنفيذي');
  const project = unwrap(SURVEY.getProject(project_id));
  const dashboard = unwrap(SURVEY.getDashboard());
  const surveyRecords = buildSurveyRecordsReport({ project_id, pageSize: 100000 });
  const stakeouts = buildStakeoutReport({ project_id, pageSize: 100000 });
  const coordSystems = buildCoordinateSystemsReport({ project_id });
  const controlPoints = buildControlPointsReport({ project_id, pageSize: 100000 });

  return {
    title: `التقرير التنفيذي - ${project ? project.name : project_id}`,
    generated_at: new Date().toISOString(),
    project: project ? {
      'اسم المشروع': project.name,
      'رقم المشروع': project.project_number,
      'النوع': project.project_type,
      'الموقع': project.location || '',
      'الحالة': project.status,
      'المهندس المسؤول': project.responsible_engineer || '',
    } : null,
    dashboard_snapshot: dashboard,
    survey_summary: { total_records: surveyRecords.total_records, by_type: surveyRecords.by_type },
    stakeout_summary: {
      total_items: stakeouts.total_items,
      within_tolerance: stakeouts.within_tolerance,
      out_of_tolerance: stakeouts.out_of_tolerance,
    },
    coordinate_systems_count: coordSystems.total_systems,
    control_points_count: controlPoints.total_points,
    rows: surveyRecords.rows, // الجدول الرئيسي بالتقرير التنفيذي هو ملخص عمليات الرفع
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

function exportSurveyReportToPDF(report, meta = {}) {
  const filename = `survey-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const result = generateBoqTablePDF({
    title: report.title || 'Survey Report',
    meta,
    headers,
    rows: dataRows,
    totals: null,
    outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportSurveyReportToExcel(report) {
  const filename = `survey-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const rows = [headers, ...dataRows];
  const buffer = generateXlsx([{ name: 'Survey Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportSurveyReportToCSV(report) {
  const filename = `survey-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateCsv(headers, dataRows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** تصدير Word مبسّط بصيغة RTF (يفتح مباشرة في Microsoft Word دون مكتبات خارجية) */
function exportSurveyReportToWord(report) {
  const filename = `survey-report-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${headers.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = dataRows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title || 'Survey Report')}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n\\trowd\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) */
function exportSurveyReportToPrintableHTML(report, meta = {}) {
  const filename = `survey-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  const theadHtml = headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title || 'تقرير قسم المساحة'}</title>
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
<h1>${report.title || 'تقرير قسم المساحة'}</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | تاريخ الإصدار: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  buildSurveyRecordsReport,
  buildStakeoutReport,
  buildCoordinateSystemsReport,
  buildControlPointsReport,
  buildEarthworkReport,
  buildAccuracyReport,
  buildExecutiveSurveyReport,
  exportSurveyReportToPDF,
  exportSurveyReportToExcel,
  exportSurveyReportToCSV,
  exportSurveyReportToWord,
  exportSurveyReportToPrintableHTML,
};
