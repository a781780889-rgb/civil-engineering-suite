/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة. [مكتمل]
 *   الجزء 3/10: التقارير الزمنية والمقارنة. [مكتمل]
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية. [مكتمل]
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية. [مكتمل]
 * >> الجزء 6/10 (هذا الملف + reportScheduler.js): الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * هذا الملف يوفر محرّك تصدير/طباعة **موحّداً وعاماً** يعمل فوق أي نتيجة تقرير من أي
 * جزء سابق في القسم 14 (منشئ التقارير، التقارير الزمنية/المقارنة، التفاعلية،
 * التنفيذية/الدورية، أو أي تقرير مستقبلي)، بدلاً من أن يبقى التصدير مقصوراً على جزء
 * واحد فقط (كما كان الحال في الجزء 5 حيث خُصّص التصدير للتقارير التنفيذية/الدورية
 * فقط عبر reportExecutivePeriodic.js).
 *
 * يوفر:
 *  1) دالة توحيد عامة (normalizeReportForExport) تحوّل أي شكل مُخرَج من أي جزء سابق
 *     (مصفوفة صفوف مسطّحة، أو كائن مركّب بحقول متعددة كالتقرير التنفيذي، أو نتيجة
 *     Report Builder بأعمدة/KPIs) إلى بنية موحدة: { title, meta, headers, rows,
 *     totals, kpis, sections }.
 *  2) أربع صيغ تصدير حقيقية تعمل فعلياً بدون أي تبعية خارجية، بنفس الأدوات المستخدَمة
 *     أصلاً في المشروع (nativePdfGenerator / tablePdfGenerator, xlsxWriter, csvWriter,
 *     docxWriter):
 *       - PDF (عبر generateBoqTablePDF من tablePdfGenerator.js، بما يدعم رأس/تذييل
 *         وشعار نصي وبيانات المشروع وترقيم صفحات ضمنياً عبر SimplePDF).
 *       - Excel (.xlsx) عبر xlsxWriter.js - يدعم أوراق متعددة (بيانات + ملخص KPI).
 *       - CSV عبر csvWriter.js (مع BOM لدعم العربية في Excel).
 *       - Word (.docx حقيقي عبر docxWriter.js، وليس RTF كما في الجزء 5) - فقرات
 *         عنوان + جدول بيانات + دعم RTL كامل.
 *  3) معاينة قبل الطباعة (buildPrintPreviewHTML): HTML قابل للطباعة مباشرة من
 *     المتصفح (window.print) يدعم: حجم الورق (A4/A3/Letter)، الاتجاه
 *     (Portrait/Landscape)، الهوامش، رأس وتذييل الصفحة، ترقيم الصفحات (عبر CSS
 *     @page)، شعار الشركة (نص أو مسار صورة)، وبيانات المشروع.
 *  4) دالة تصدير موحّدة واحدة (exportReport) تُستخدَم من أي مسار API في القسم 14
 *     بدل تكرار منطق التصدير في كل جزء (format: pdf|xlsx|csv|word|print).
 *  5) سجل عمليات التصدير (كل تصدير يُسجَّل في reportsCenter كعرض/تنزيل فعلي على سجل
 *     التقرير المصدَّر، إن وُجد معرّف تقرير مسجَّل).
 *
 * قاعدة الدقة: هذا الملف لا يخترع أي بيانات ولا يعيد حساب أي رقم؛ فقط يُعيد تهيئة
 * (reshape) بيانات مُنتَجة فعلياً من الأجزاء السابقة إلى ملفات فعلية قابلة للتنزيل.
 */

const fs = require('fs');
const path = require('path');

const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');
const { generateDocx } = require('./docxWriter');
const REPORTS_CENTER = require('./reportsCenter');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const SUPPORTED_FORMATS = ['pdf', 'xlsx', 'csv', 'word', 'print'];
const PAPER_SIZES = {
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
};

function nowISO() { return new Date().toISOString(); }

function isArabic(str) { return /[\u0600-\u06FF]/.test(String(str ?? '')); }

/** يفحص إن كانت القيمة "كائن صف" (بدلاً من مصفوفة) لبناء headers منها تلقائياً */
function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * توحيد أي شكل مُخرَج من أي جزء سابق من القسم 14 إلى بنية تصدير موحّدة:
 * { title, subtitle, meta, headers, rows (Array<Array<string|number>>), totals, kpis, sections, generated_at }
 *
 * يدعم الأشكال التالية بدون أي افتراض بيانات وهمية:
 *  - { headers: [...], rows: [[...], ...] } (شكل جاهز مسبقاً - يُستخدَم كما هو)
 *  - { columns: [...], data: [{...}, ...] } (شكل Report Builder: أعمدة + سجلات كائن)
 *  - Array<object> مباشرة (نتيجة استعلام خام) → يُشتق headers من مفاتيح أول سجل
 *  - كائن مركّب به حقول متعددة غير جدولية (كالتقرير التنفيذي: مؤشرات KPI متعددة
 *    وليست صفوفاً) → يُبنى قسم KPI بدل جدول رئيسي، مع استخراج أي مصفوفات فرعية
 *    (كـ periodic breakdown) كأقسام إضافية.
 */
function normalizeReportForExport(report, meta = {}) {
  if (!report || typeof report !== 'object') {
    throw new Error('لا يمكن تصدير تقرير فارغ أو غير صالح');
  }

  const title = report.title || meta.title || 'تقرير';
  const subtitle = report.subtitle || meta.subtitle || null;
  const generatedAt = report.generated_at || report.generatedAt || nowISO();

  // الشكل الجاهز: headers + rows
  if (Array.isArray(report.headers) && Array.isArray(report.rows)) {
    return {
      title, subtitle, meta, generatedAt,
      headers: report.headers,
      rows: report.rows.map((r) => Array.isArray(r) ? r : Object.values(r)),
      totals: report.totals || null,
      kpis: report.kpis || null,
      sections: report.sections || null,
    };
  }

  // شكل Report Builder / التقارير الزمنية: columns + rows (سجلات كائن، وليس مصفوفة
  // قيم) - كما تُرجعه buildCustomReport وbuildPeriodReport فعلياً
  if (Array.isArray(report.columns) && Array.isArray(report.rows) && (report.rows.length === 0 || isPlainObject(report.rows[0]))) {
    const headers = report.columns.map((c) => (typeof c === 'string' ? c : (c.label || c.key)));
    const keys = report.columns.map((c) => (typeof c === 'string' ? c : c.key));
    const rows = report.rows.map((rec) => keys.map((k) => rec[k] ?? ''));
    return {
      title, subtitle, meta, generatedAt,
      headers, rows,
      totals: report.totals || null,
      kpis: report.kpis || null,
      sections: report.groups ? [{ label: 'التجميع', headers: ['المجموعة', 'القيمة'], rows: Object.entries(report.groups).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]) }] : (report.sections || null),
    };
  }

  // مصفوفة كائنات مباشرة
  if (Array.isArray(report)) {
    if (report.length === 0) return { title, subtitle, meta, generatedAt, headers: [], rows: [], totals: null, kpis: null, sections: null };
    const headers = Object.keys(report[0]);
    const rows = report.map((rec) => headers.map((h) => rec[h] ?? ''));
    return { title, subtitle, meta, generatedAt, headers, rows, totals: null, kpis: null, sections: null };
  }

  // كائن مركّب (تنفيذي/دوري): نستخرج KPIs من الحقول الرقمية/الحالة المباشرة،
  // ونستخرج أي مصفوفات فرعية كأقسام (sections) بدل اختراع جدول غير موجود.
  const kpis = [];
  const sections = [];
  for (const [key, value] of Object.entries(report)) {
    if (['title', 'subtitle', 'generated_at', 'generatedAt', 'meta'].includes(key)) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) { sections.push({ label: key, headers: [], rows: [] }); continue; }
      if (isPlainObject(value[0])) {
        const headers = Object.keys(value[0]);
        sections.push({ label: key, headers, rows: value.map((rec) => headers.map((h) => rec[h] ?? '')) });
      } else {
        sections.push({ label: key, headers: [key], rows: value.map((v) => [v]) });
      }
    } else if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      kpis.push({ label: key, value });
    } else if (isPlainObject(value) && ('value' in value || 'label' in value)) {
      kpis.push({ label: value.label || key, value: value.value, status: value.status || value.status_label || null });
    }
  }

  // نبني جدولاً رئيسياً من أول قسم فرعي (إن وُجد) لتوافق أدوات PDF/Excel/CSV التي
  // تتوقع جدولاً أساسياً؛ باقي الأقسام تُصدَّر كأوراق/جداول إضافية.
  const primary = sections.shift();
  return {
    title, subtitle, meta, generatedAt,
    headers: primary ? primary.headers : ['المؤشر', 'القيمة'],
    rows: primary ? primary.rows : kpis.map((k) => [k.label, k.value]),
    totals: report.totals || null,
    kpis,
    sections,
  };
}

function buildMetaBlock(normalized, meta) {
  return {
    'التاريخ': new Date(normalized.generatedAt).toLocaleString('ar-EG'),
    'المشروع': meta.projectName || meta.project_name || '-',
    'الفترة': meta.period || '-',
    'أُنشئ بواسطة': meta.userName || meta.user || '-',
    ...(meta.extra || {}),
  };
}

// ===================== PDF =====================

function exportToPDF(report, meta = {}) {
  const normalized = normalizeReportForExport(report, meta);
  const filename = `report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const metaBlock = buildMetaBlock(normalized, meta);

  const result = generateBoqTablePDF({
    title: normalized.title,
    meta: metaBlock,
    headers: normalized.headers,
    rows: normalized.rows,
    totals: normalized.totals,
    outputPath,
  });

  return { ...result, url: `/reports/${filename}`, format: 'pdf' };
}

// ===================== Excel =====================

function exportToExcel(report, meta = {}) {
  const normalized = normalizeReportForExport(report, meta);
  const filename = `report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const sheets = [{ name: 'البيانات', rows: [normalized.headers, ...normalized.rows] }];

  if (normalized.kpis && normalized.kpis.length) {
    sheets.push({
      name: 'المؤشرات',
      rows: [['المؤشر', 'القيمة', 'الحالة'], ...normalized.kpis.map((k) => [k.label, k.value, k.status || ''])],
    });
  }

  if (normalized.sections && normalized.sections.length) {
    for (const sec of normalized.sections.slice(0, 20)) { // حد أمان لعدد الأوراق
      const safeName = String(sec.label).slice(0, 28) || 'قسم';
      sheets.push({ name: safeName, rows: [sec.headers, ...sec.rows] });
    }
  }

  const buffer = generateXlsx(sheets);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}`, format: 'xlsx' };
}

// ===================== CSV =====================

function exportToCSV(report, meta = {}) {
  const normalized = normalizeReportForExport(report, meta);
  const filename = `report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const buffer = generateCsv(normalized.headers, normalized.rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}`, format: 'csv' };
}

// ===================== Word (.docx حقيقي) =====================

function exportToWord(report, meta = {}) {
  const normalized = normalizeReportForExport(report, meta);
  const filename = `report-${Date.now()}.docx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const metaBlock = buildMetaBlock(normalized, meta);

  const blocks = [];
  blocks.push({ type: 'heading', text: normalized.title });
  if (normalized.subtitle) blocks.push({ type: 'text', text: normalized.subtitle });

  blocks.push({
    type: 'text',
    text: Object.entries(metaBlock).map(([k, v]) => `${k}: ${v}`).join('   |   '),
  });

  if (normalized.headers.length) {
    blocks.push({ type: 'table', headers: normalized.headers, rows: normalized.rows.map((r) => r.map((c) => String(c ?? ''))) });
  }

  if (normalized.kpis && normalized.kpis.length) {
    blocks.push({ type: 'text', text: 'المؤشرات:', bold: true });
    blocks.push({
      type: 'table',
      headers: ['المؤشر', 'القيمة', 'الحالة'],
      rows: normalized.kpis.map((k) => [String(k.label), String(k.value ?? ''), String(k.status || '-')]),
    });
  }

  for (const sec of (normalized.sections || []).slice(0, 30)) {
    blocks.push({ type: 'text', text: String(sec.label), bold: true });
    if (sec.headers.length) {
      blocks.push({ type: 'table', headers: sec.headers, rows: sec.rows.map((r) => r.map((c) => String(c ?? ''))) });
    }
  }

  const buffer = generateDocx(blocks);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}`, format: 'word' };
}

// ===================== معاينة قبل الطباعة (HTML قابل للطباعة) =====================

/**
 * @param {object} report - أي نتيجة تقرير من أي جزء سابق
 * @param {object} meta - بيانات إضافية
 * @param {object} printOptions - { paperSize, orientation, marginMm, showHeader,
 *   showFooter, showPageNumbers, companyLogoText, companyLogoUrl }
 */
function buildPrintPreviewHTML(report, meta = {}, printOptions = {}) {
  const normalized = normalizeReportForExport(report, meta);
  const {
    paperSize = 'A4',
    orientation = 'portrait', // portrait | landscape
    marginMm = 15,
    showHeader = true,
    showFooter = true,
    showPageNumbers = true,
    companyLogoText = null,
    companyLogoUrl = null,
  } = printOptions;

  const size = PAPER_SIZES[paperSize] || PAPER_SIZES.A4;
  const pageSizeCss = orientation === 'landscape'
    ? `${size.heightMm}mm ${size.widthMm}mm`
    : `${size.widthMm}mm ${size.heightMm}mm`;

  const metaBlock = buildMetaBlock(normalized, meta);
  const rtl = isArabic(normalized.title) || normalized.headers.some(isArabic);
  const dir = rtl ? 'rtl' : 'ltr';

  const headerHtml = showHeader ? `
    <div class="print-header">
      ${companyLogoUrl ? `<img src="${companyLogoUrl}" class="logo-img" alt="logo"/>` : (companyLogoText ? `<div class="logo-text">${companyLogoText}</div>` : '')}
      <div class="header-titles">
        <h1>${normalized.title}</h1>
        ${normalized.subtitle ? `<div class="subtitle">${normalized.subtitle}</div>` : ''}
      </div>
    </div>` : '';

  const metaHtml = `<div class="meta-block">${Object.entries(metaBlock).map(([k, v]) => `<span><b>${k}:</b> ${v}</span>`).join('')}</div>`;

  const kpiHtml = (normalized.kpis && normalized.kpis.length) ? `
    <div class="kpi-grid">
      ${normalized.kpis.map((k) => `
        <div class="kpi-card ${k.status ? 'status-' + k.status : ''}">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
        </div>`).join('')}
    </div>` : '';

  function tableHtml(headers, rows) {
    if (!headers.length) return '<p class="no-data">لا توجد بيانات لعرضها ضمن الفترة/الفلاتر المحددة.</p>';
    return `
    <table class="report-table">
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  const mainTableHtml = tableHtml(normalized.headers, normalized.rows);

  const sectionsHtml = (normalized.sections || []).map((sec) => `
    <div class="section-block">
      <h2>${sec.label}</h2>
      ${tableHtml(sec.headers, sec.rows)}
    </div>`).join('');

  const footerHtml = showFooter ? `
    <div class="print-footer">
      <span>تم الإنشاء: ${new Date(normalized.generatedAt).toLocaleString('ar-EG')}</span>
      ${showPageNumbers ? '<span class="page-number"></span>' : ''}
    </div>` : '';

  const html = `<!DOCTYPE html>
<html dir="${dir}" lang="ar">
<head>
<meta charset="UTF-8">
<title>${normalized.title}</title>
<style>
  @page {
    size: ${pageSizeCss};
    margin: ${marginMm}mm;
    ${showPageNumbers ? `@bottom-center { content: "صفحة " counter(page) " من " counter(pages); font-size: 10px; color:#667; }` : ''}
  }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color:#1a2634; margin:0; padding:0; }
  .print-header { display:flex; align-items:center; gap:16px; border-bottom:3px solid #0d2438; padding-bottom:10px; margin-bottom:14px; }
  .logo-img { max-height:60px; }
  .logo-text { font-weight:bold; font-size:20px; color:#0d2438; border:2px solid #0d2438; padding:6px 12px; border-radius:6px; }
  .header-titles h1 { margin:0; font-size:22px; }
  .subtitle { color:#556; font-size:13px; margin-top:2px; }
  .meta-block { display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:#334; background:#f4f6f8; padding:8px 12px; border-radius:6px; margin-bottom:14px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:10px; margin-bottom:16px; }
  .kpi-card { border:1px solid #dde3ea; border-radius:8px; padding:10px; text-align:center; }
  .kpi-card.status-warning { border-color:#e8a33d; background:#fff8ec; }
  .kpi-card.status-danger { border-color:#d64545; background:#fdecec; }
  .kpi-card.status-attention { border-color:#3d7ee8; background:#eef4ff; }
  .kpi-label { font-size:11px; color:#667; }
  .kpi-value { font-size:18px; font-weight:bold; margin-top:4px; }
  .report-table { width:100%; border-collapse:collapse; margin-bottom:18px; font-size:12px; }
  .report-table th, .report-table td { border:1px solid #dde3ea; padding:6px 8px; text-align:${rtl ? 'right' : 'left'}; }
  .report-table th { background:#0d2438; color:#fff; }
  .report-table tr:nth-child(even) { background:#f8fafb; }
  .section-block { margin-top:20px; page-break-inside:avoid; }
  .section-block h2 { font-size:15px; border-${rtl ? 'right' : 'left'}:4px solid #0d2438; padding-${rtl ? 'right' : 'left'}:8px; }
  .no-data { color:#889; font-style:italic; }
  .print-footer { display:flex; justify-content:space-between; font-size:10px; color:#889; border-top:1px solid #dde3ea; padding-top:6px; margin-top:20px; }
  .print-actions { margin:16px 0; }
  .print-actions button { background:#0d2438; color:#fff; border:none; padding:8px 18px; border-radius:6px; cursor:pointer; font-size:14px; }
  @media print { .print-actions { display:none; } }
</style>
</head>
<body>
  <div class="print-actions">
    <button onclick="window.print()">طباعة / حفظ PDF</button>
  </div>
  ${headerHtml}
  ${metaHtml}
  ${kpiHtml}
  ${mainTableHtml}
  ${sectionsHtml}
  ${footerHtml}
</body>
</html>`;

  const filename = `report-preview-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}`, format: 'print', html };
}

// ===================== واجهة موحّدة =====================

/**
 * نقطة الدخول الموحّدة للتصدير من أي مسار API في القسم 14.
 * @param {string} format - pdf | xlsx | csv | word | print
 * @param {object} report - نتيجة تقرير من أي جزء سابق (أي شكل مدعوم في normalizeReportForExport)
 * @param {object} meta - { projectName, period, userName, extra, reportRecordId, printOptions }
 */
function exportReport(format, report, meta = {}) {
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw new Error(`صيغة تصدير غير مدعومة: ${format}. الصيغ المدعومة: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  let result;
  switch (format) {
    case 'pdf': result = exportToPDF(report, meta); break;
    case 'xlsx': result = exportToExcel(report, meta); break;
    case 'csv': result = exportToCSV(report, meta); break;
    case 'word': result = exportToWord(report, meta); break;
    case 'print': result = buildPrintPreviewHTML(report, meta, meta.printOptions || {}); break;
  }

  // تسجيل التنزيل فعلياً على سجل التقرير في مركز التقارير إن توفّر معرّف مسجَّل
  if (meta.reportRecordId) {
    try {
      REPORTS_CENTER.markReportDownloaded(meta.reportRecordId, { format, userId: meta.userId || meta.userName || null });
    } catch (e) { /* سجل غير موجود بعد - يُتجاهَل بأمان */ }
  }

  return result;
}

module.exports = {
  SUPPORTED_FORMATS,
  PAPER_SIZES,
  normalizeReportForExport,
  exportToPDF,
  exportToExcel,
  exportToCSV,
  exportToWord,
  buildPrintPreviewHTML,
  exportReport,
};
