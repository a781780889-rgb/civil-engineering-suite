/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة. [مكتمل]
 *   الجزء 3/10: التقارير الزمنية والمقارنة. [مكتمل]
 * >> الجزء 4/10 (هذا الملف): التقارير التفاعلية + الرسوم البيانية.
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية.
 *   الجزء 6/10: الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * هذا الجزء يبني فوق مصادر البيانات والمحركات الموجودة فعلياً في الجزأين 2
 * (reportBuilder.js) و3 (reportPeriodsComparisons.js) دون تكرار أي منطق جلب أو
 * فلترة أو تجميع بيانات. يوفر طبقتين فقط:
 *
 *  1) التفاعل الحقيقي (Drill-down):
 *     - drillDownFromGroup: من صف "تجميع" (Summary) في تقرير مُنشأ مسبقاً عبر
 *       buildCustomReport، إلى قائمة السجلات التفصيلية الفعلية المكوّنة لذلك الصف
 *       فقط (بنفس مصدر البيانات ونفس الفلاتر الأصلية + فلتر إضافي لقيمة المجموعة).
 *     - drillDownRow: من "المعرّف" الظاهر في أي صف تقرير إلى السجل الكامل الأصلي
 *       (يُعيد الجلب من الوحدة المصدرية نفسها: projectManagement / budgetManagement
 *       / scheduling)، وليس فقط الحقول المعروضة في التقرير المختصر.
 *     - reRunWithFilters: إعادة تشغيل نفس مواصفة التقرير (spec) بعد تعديل الفترة
 *       الزمنية و/أو المشروع و/أو أي فلتر آخر، لتفعيل "تغيير الفترة/المشروع من نفس
 *       الواجهة" دون إعادة بناء الطلب من الصفر في كل مرة.
 *
 *  2) بيانات الرسوم البيانية (Chart Data Builders):
 *     دوال تحويل صِرفة (pure) تأخذ نتيجة تقرير حقيقي (من reportBuilder أو
 *     reportPeriodsComparisons) وتنتج JSON جاهز مباشرة لأي مكتبة رسم بياني
 *     (Chart.js/Recharts وغيرها)، لكل نوع من الأنواع الإحدى عشر المطلوبة:
 *     Bar, Line, Pie, Doughnut, Area, Scatter, KPI Cards, Progress Bars, Gantt,
 *     S-Curve, Heatmap. كل دالة صريحة في رفض بيانات غير كافية (مثال: buildScatter
 *     يرفض إن لم يُحدَّد حقلا x/y الرقميان) بدل اختلاق نقاط بيانات وهمية.
 *
 * قاعدة الدقة: لا توجد بيانات ثابتة أو عشوائية في هذا الملف على الإطلاق. كل دالة
 * إما تُعيد استخدام تقرير أُنشئ فعلياً من بيانات حقيقية (يُمرَّر لها كمعامل)، أو
 * تستدعي مباشرة دوال القراءة الأصلية (get/list) في الوحدات المصدرية.
 */

const PM = require('./projectManagement');
const BUDGET = require('./budgetManagement');
const SCH = require('./scheduling');
const REPORT_BUILDER = require('./reportBuilder');
const REPORT_PERIODS = require('./reportPeriodsComparisons');

function nowISO() { return new Date().toISOString(); }
function r2(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }

// ===================== أنواع الرسوم البيانية المدعومة =====================

const CHART_TYPES = [
  { key: 'bar', label: 'أعمدة (Bar Chart)' },
  { key: 'line', label: 'خطي (Line Chart)' },
  { key: 'pie', label: 'دائري (Pie Chart)' },
  { key: 'doughnut', label: 'حلقي (Doughnut Chart)' },
  { key: 'area', label: 'مساحي (Area Chart)' },
  { key: 'scatter', label: 'انتشاري (Scatter Chart)' },
  { key: 'kpi_cards', label: 'بطاقات مؤشرات (KPI Cards)' },
  { key: 'progress_bars', label: 'أشرطة تقدّم (Progress Bars)' },
  { key: 'gantt', label: 'مخطط جانت (Gantt)' },
  { key: 's_curve', label: 'منحنى S (S-Curve)' },
  { key: 'heatmap', label: 'خريطة حرارية (Heatmap)' },
];

function getChartTypes() {
  return CHART_TYPES;
}

// =====================================================================
// 1) التفاعل الحقيقي (Drill-down)
// =====================================================================

/**
 * drillDownFromGroup(spec, groupKey)
 * spec: نفس مواصفة buildCustomReport الأصلية التي أنتجت التقرير المُجمَّع
 *       (يجب أن تحتوي على groupBy).
 * groupKey: قيمة المجموعة (كما ظهرت في report.groups[].key) التي يريد المستخدم
 *           التوسّع منها من Summary إلى Details.
 * يُعيد تقريراً تفصيلياً كاملاً (نفس شكل buildCustomReport) لكن مُقيَّداً بالسجلات
 * التي قيمة حقل التجميع فيها تساوي groupKey فعلياً - وليس تخميناً.
 */
function drillDownFromGroup(spec = {}, groupKey) {
  if (!spec || !spec.dataSource) throw new Error('مواصفة التقرير الأصلية (spec) يجب أن تحدد dataSource');
  if (!spec.groupBy) throw new Error('مواصفة التقرير الأصلية يجب أن تحتوي على groupBy لإمكانية التوسّع من Summary إلى Details');
  if (groupKey === undefined || groupKey === null || groupKey === '') {
    throw new Error('يجب تحديد قيمة المجموعة (groupKey) المطلوب التوسّع منها');
  }

  // نبني تقرير تفصيلي كامل بنفس الفلاتر والفترة والمصدر، لكن بدون تجميع (drill
  // مباشرة إلى الصفوف)، ثم نُصفّي محلياً حسب حقل التجميع - لأن حقل التجميع نفسه
  // قد لا يكون من الحقول المدعومة ضمن applyAdvancedFilters العامة.
  const detailSpec = {
    ...spec,
    fields: undefined, // كل الحقول في التفاصيل، بصرف النظر عمّا عُرض في الملخص
    groupBy: undefined,
    aggregateField: undefined,
    aggregateOp: undefined,
    limit: spec.limit || 5000,
  };
  const fullReport = REPORT_BUILDER.buildCustomReport(detailSpec);

  const groupField = spec.groupBy;
  const matched = fullReport.rows.filter((row) => {
    const val = row[groupField];
    const normalized = (val === undefined || val === null) ? 'غير محدد' : String(val);
    return normalized === String(groupKey);
  });

  return {
    generated_at: nowISO(),
    title: `تفاصيل المجموعة: ${groupKey} — ${fullReport.data_source_label}`,
    data_source: spec.dataSource,
    data_source_label: fullReport.data_source_label,
    drill_down_from: { group_field: groupField, group_key: String(groupKey) },
    total_matched: matched.length,
    columns: Object.keys(matched[0] || fullReport.rows[0] || {}),
    rows: matched,
  };
}

/**
 * drillDownRow(dataSource, rowId)
 * يجلب السجل الأصلي الكامل (وليس فقط الحقول المعروضة في التقرير) من الوحدة
 * المصدرية الفعلية، عبر معرّف السجل الظاهر في عمود "id" (أو "project_id" حسب
 * المصدر) في أي صف تقرير. يُتيح "الضغط على أي رقم/صف لعرض التفاصيل الكاملة".
 */
function drillDownRow(dataSource, rowId) {
  if (!dataSource) throw new Error('يجب تحديد مصدر البيانات (dataSource)');
  if (!rowId) throw new Error('يجب تحديد معرّف السجل (rowId)');

  switch (dataSource) {
    case 'projects':
      return { data_source: dataSource, record: PM.getProject(rowId) };
    case 'budgets':
      return { data_source: dataSource, record: BUDGET.getBudget(rowId) };
    case 'schedule_activities':
      return { data_source: dataSource, record: SCH.getActivity(rowId) };
    default:
      throw new Error(`لا يوجد إجراء drill-down معرّف لمصدر البيانات: ${dataSource}`);
  }
}

/**
 * reRunWithFilters(spec, overrides)
 * يعيد تشغيل نفس مواصفة التقرير مع استبدال جزئي للفلاتر/الفترة/الترتيب، لتفعيل
 * "تغيير الفترة الزمنية"، "تغيير المشروع"، "ترتيب البيانات تفاعلياً"، "إظهار/إخفاء
 * أعمدة" من نفس الواجهة دون أن يعيد المستخدم بناء الطلب بالكامل.
 * overrides يمكن أن يحتوي: filters (تُدمَج/تُدمج مع الأصلية)، dateFrom, dateTo,
 * sortBy, sortDir, fields (لإظهار/إخفاء أعمدة), groupBy.
 */
function reRunWithFilters(spec = {}, overrides = {}) {
  if (!spec || !spec.dataSource) throw new Error('مواصفة التقرير الأصلية (spec) يجب أن تحدد dataSource');
  const merged = {
    ...spec,
    ...overrides,
    filters: { ...(spec.filters || {}), ...(overrides.filters || {}) },
  };
  return REPORT_BUILDER.buildCustomReport(merged);
}

// =====================================================================
// 2) بيانات الرسوم البيانية (Chart Data Builders)
// =====================================================================
// كل دالة هنا "صِرفة": تأخذ تقريراً حقيقياً (أو مصفوفة صفوف حقيقية) كمعامل ولا
// تجلب بيانات بنفسها إلا عند الحاجة الصريحة (مثل Gantt وS-Curve التي تحتاج
// scheduleId لاستدعاء scheduling.js مباشرة، لأنها بيانات غير موجودة في تقارير
// reportBuilder العامة أصلاً).

function assertReport(report) {
  if (!report || !Array.isArray(report.rows)) {
    throw new Error('يجب تمرير تقرير حقيقي (نتيجة buildCustomReport أو ما يماثلها) يحتوي على rows');
  }
}

/**
 * buildBarChart(report, { labelField, valueField, valueOp })
 * إن كان التقرير مُجمَّعاً (report.groups موجودة) يُستخدم التجميع مباشرة (كل
 * مجموعة = عمود). وإلا يُستخدم labelField/valueField من الصفوف الخام مباشرة.
 */
function buildBarChart(report, { labelField = null, valueField = null, valueOp = 'sum' } = {}) {
  if (report && Array.isArray(report.groups)) {
    return {
      type: 'bar',
      labels: report.groups.map((g) => g.key),
      datasets: [{
        label: report.aggregate_field_label || valueField || 'العدد',
        data: report.groups.map((g) => (g.aggregate_value !== null ? g.aggregate_value : g.count)),
      }],
      drill_down_capable: true,
      group_field: report.grouped_by,
    };
  }
  assertReport(report);
  if (!labelField) throw new Error('يجب تحديد labelField (أو تمرير تقرير مُجمَّع بالفعل عبر groupBy)');
  if (!valueField) throw new Error('يجب تحديد valueField لحساب قيمة كل عمود');
  const agg = REPORT_BUILDER.applyGroupBy(report.rows, labelField, { aggregateField: valueField, aggregateOp: valueOp });
  return {
    type: 'bar',
    labels: agg.map((g) => g.key),
    datasets: [{ label: `${valueOp.toUpperCase()}(${valueField})`, data: agg.map((g) => g.aggregate_value) }],
    drill_down_capable: true,
    group_field: labelField,
  };
}

/** buildPieChart / buildDoughnutChart: توزيع نسبي حسب حقل تصنيفي (status, priority...) */
function buildDistributionChart(report, { labelField, chartType = 'pie' } = {}) {
  assertReport(report);
  if (!labelField) throw new Error('يجب تحديد labelField (الحقل التصنيفي) لبناء رسم التوزيع');
  const agg = REPORT_BUILDER.applyGroupBy(report.rows, labelField, { aggregateOp: 'count' });
  const total = agg.reduce((s, g) => s + g.count, 0);
  return {
    type: chartType,
    labels: agg.map((g) => g.key),
    datasets: [{ data: agg.map((g) => g.count) }],
    percentages: agg.map((g) => ({ key: g.key, percent: total ? r2((g.count / total) * 100) : 0 })),
    drill_down_capable: true,
    group_field: labelField,
  };
}

function buildPieChart(report, opts = {}) { return buildDistributionChart(report, { ...opts, chartType: 'pie' }); }
function buildDoughnutChart(report, opts = {}) { return buildDistributionChart(report, { ...opts, chartType: 'doughnut' }); }

/**
 * buildLineChart / buildAreaChart: يفترضان تقرير فترات زمنية متعددة (مصفوفة من
 * نتائج buildPeriodReport مُمرَّرة مسبقاً من المستدعي لكل نقطة زمنية)، أو تقرير
 * واحد مع dateField لتجميع السلسلة الزمنية من صفوفه الخام مباشرة.
 */
function buildTimeSeriesChart(report, { dateField = 'created_at', valueField = null, valueOp = 'count', chartType = 'line' } = {}) {
  assertReport(report);
  const buckets = {};
  report.rows.forEach((row) => {
    const raw = row[dateField];
    if (!raw) return;
    const day = String(raw).slice(0, 10);
    if (!buckets[day]) buckets[day] = [];
    buckets[day].push(row);
  });
  const days = Object.keys(buckets).sort();
  const data = days.map((day) => {
    if (!valueField || valueOp === 'count') return buckets[day].length;
    const nums = buckets[day].map((r) => Number(r[valueField]) || 0);
    switch (valueOp) {
      case 'sum': return r2(nums.reduce((a, b) => a + b, 0));
      case 'avg': return r2(nums.reduce((a, b) => a + b, 0) / nums.length);
      case 'max': return r2(Math.max(...nums));
      case 'min': return r2(Math.min(...nums));
      default: return buckets[day].length;
    }
  });
  return {
    type: chartType,
    labels: days,
    datasets: [{ label: valueField ? `${valueOp.toUpperCase()}(${valueField})` : 'العدد', data, fill: chartType === 'area' }],
    drill_down_capable: true,
    date_field: dateField,
  };
}

function buildLineChart(report, opts = {}) { return buildTimeSeriesChart(report, { ...opts, chartType: 'line' }); }
function buildAreaChart(report, opts = {}) { return buildTimeSeriesChart(report, { ...opts, chartType: 'area' }); }

/**
 * buildScatterChart(report, { xField, yField })
 * يرفض صراحة إن لم يكن أحد الحقلين رقمياً فعلياً في البيانات (لا نقاط وهمية).
 */
function buildScatterChart(report, { xField = null, yField = null } = {}) {
  assertReport(report);
  if (!xField || !yField) throw new Error('يجب تحديد xField وyField (حقلان رقميان) لرسم الانتشار');
  const points = report.rows
    .filter((r) => r[xField] !== undefined && r[xField] !== null && r[yField] !== undefined && r[yField] !== null)
    .map((r) => ({ x: Number(r[xField]), y: Number(r[yField]), label: r.name || r.id || null }))
    .filter((p) => !Number.isNaN(p.x) && !Number.isNaN(p.y));
  if (!points.length) {
    throw new Error(`لا توجد سجلات تحتوي على قيم رقمية صالحة في كلا الحقلين (${xField}, ${yField})`);
  }
  return { type: 'scatter', x_field: xField, y_field: yField, points, drill_down_capable: true };
}

/** buildKpiCards: يعيد استخدام مباشر لمؤشرات KPI المحسوبة فعلياً ضمن التقرير نفسه */
function buildKpiCardsChart(report) {
  assertReport(report);
  const kpis = report.kpis && report.kpis.length ? report.kpis : (report.formulas || []).map((f) => ({ label: f.expression, value: f.value }));
  if (!kpis.length) throw new Error('التقرير الممرَّر لا يحتوي على أي مؤشرات KPI أو معادلات محسوبة لعرضها كبطاقات');
  return { type: 'kpi_cards', cards: kpis.map((k) => ({ label: k.label, value: k.value })) };
}

/**
 * buildProgressBars(report, { labelField, progressField })
 * يبني شريط تقدّم فعلي لكل سجل من حقل نسبة إنجاز رقمي حقيقي موجود في البيانات
 * (progress_percent في المشاريع أو الأنشطة).
 */
function buildProgressBars(report, { labelField = 'name', progressField = 'progress_percent' } = {}) {
  assertReport(report);
  const bars = report.rows
    .filter((r) => r[progressField] !== undefined && r[progressField] !== null)
    .map((r) => ({
      label: r[labelField] || r.id,
      percent: Math.max(0, Math.min(100, Number(r[progressField]) || 0)),
      status: Number(r[progressField]) >= 100 ? 'مكتمل' : (Number(r[progressField]) > 0 ? 'قيد التنفيذ' : 'لم يبدأ'),
    }));
  if (!bars.length) throw new Error(`لا توجد سجلات تحتوي على حقل نسبة الإنجاز (${progressField})`);
  return { type: 'progress_bars', bars };
}

/**
 * buildGanttChart(scheduleId)
 * يبني بيانات Gantt فعلية مباشرة من وحدة الجدول الزمني (نفس بيانات WBS/CPM
 * الحقيقية)، لأنها غير متوفرة كصفوف عامة في reportBuilder.
 */
function buildGanttChart(scheduleId) {
  if (!scheduleId) throw new Error('معرّف الجدول الزمني (scheduleId) مطلوب لبناء مخطط Gantt');
  const cpm = SCH.computeCPM(scheduleId);
  if (!cpm.activities || !cpm.activities.length) throw new Error('لا توجد أنشطة مسجَّلة في هذا الجدول الزمني لعرضها في Gantt');
  return {
    type: 'gantt',
    schedule_id: scheduleId,
    project_duration_days: cpm.project_duration_days,
    tasks: cpm.activities.map((a) => ({
      id: a.id,
      name: a.name,
      start_day: a.es,
      end_day: a.ef,
      is_critical: !!a.is_critical,
      progress_percent: a.progress_percent || 0,
    })),
  };
}

/**
 * buildSCurveChart(scheduleId)
 * إعادة استخدام مباشرة لـ scheduling.computeSCurve الحقيقي (لا تُبنى بيانات
 * جديدة هنا، فقط تُهيَّأ للعرض كرسم بياني قياسي).
 */
function buildSCurveChart(scheduleId) {
  if (!scheduleId) throw new Error('معرّف الجدول الزمني (scheduleId) مطلوب لبناء منحنى S-Curve');
  const curve = SCH.computeSCurve(scheduleId);
  return {
    type: 's_curve',
    schedule_id: scheduleId,
    labels: curve.planned.map((p) => p.date),
    datasets: [
      { label: 'مخطط (Planned)', data: curve.planned.map((p) => p.cumulative_percent) },
      { label: 'فعلي (Actual)', data: curve.actual.map((p) => p.cumulative_percent) },
    ],
    current_actual_progress_percent: curve.current_actual_progress_percent,
  };
}

/**
 * buildHeatmap(report, { rowField, colField })
 * يبني مصفوفة كثافة حقيقية (عدد السجلات) لكل تقاطع (rowField x colField) من
 * بيانات التقرير الفعلية. مثال: حالة المشروع (صفوف) × الأولوية (أعمدة).
 */
function buildHeatmap(report, { rowField = null, colField = null } = {}) {
  assertReport(report);
  if (!rowField || !colField) throw new Error('يجب تحديد rowField وcolField لبناء الخريطة الحرارية');
  const rowKeys = new Set();
  const colKeys = new Set();
  const cells = {};
  report.rows.forEach((r) => {
    const rk = r[rowField] === undefined || r[rowField] === null ? 'غير محدد' : String(r[rowField]);
    const ck = r[colField] === undefined || r[colField] === null ? 'غير محدد' : String(r[colField]);
    rowKeys.add(rk); colKeys.add(ck);
    const cellKey = `${rk}|||${ck}`;
    cells[cellKey] = (cells[cellKey] || 0) + 1;
  });
  const rows = [...rowKeys];
  const cols = [...colKeys];
  const matrix = rows.map((rk) => cols.map((ck) => cells[`${rk}|||${ck}`] || 0));
  return { type: 'heatmap', row_field: rowField, col_field: colField, rows, cols, matrix };
}

/**
 * buildChartData(chartType, report, options)
 * نقطة دخول موحّدة تُوجّه لأي من الدوال أعلاه حسب النوع المطلوب. options قد
 * تحتوي scheduleId للأنواع gantt/s_curve التي لا تعتمد على report مباشرة.
 */
function buildChartData(chartType, report, options = {}) {
  switch (chartType) {
    case 'bar': return buildBarChart(report, options);
    case 'line': return buildLineChart(report, options);
    case 'pie': return buildPieChart(report, options);
    case 'doughnut': return buildDoughnutChart(report, options);
    case 'area': return buildAreaChart(report, options);
    case 'scatter': return buildScatterChart(report, options);
    case 'kpi_cards': return buildKpiCardsChart(report);
    case 'progress_bars': return buildProgressBars(report, options);
    case 'gantt': return buildGanttChart(options.scheduleId);
    case 's_curve': return buildSCurveChart(options.scheduleId);
    case 'heatmap': return buildHeatmap(report, options);
    default:
      throw new Error(`نوع رسم بياني غير مدعوم: ${chartType}. الأنواع المدعومة: ${CHART_TYPES.map((c) => c.key).join(', ')}`);
  }
}

/**
 * buildChartFromSpec(chartType, reportSpec, options)
 * دالة راحة (convenience) تبني التقرير الأساسي أولاً عبر reportBuilder ثم تُنتج
 * بيانات الرسم البياني منه مباشرة، لتفادي على المستدعي (الراوت) بناء التقرير
 * يدوياً في كل مرة عند عدم وجود تقرير جاهز مسبقاً.
 */
function buildChartFromSpec(chartType, reportSpec = {}, options = {}) {
  if (chartType === 'gantt' || chartType === 's_curve') {
    return buildChartData(chartType, null, options);
  }
  const report = REPORT_BUILDER.buildCustomReport(reportSpec);
  return buildChartData(chartType, report, options);
}

module.exports = {
  getChartTypes,
  // التفاعل
  drillDownFromGroup,
  drillDownRow,
  reRunWithFilters,
  // بناء بيانات الرسوم البيانية
  buildBarChart,
  buildPieChart,
  buildDoughnutChart,
  buildLineChart,
  buildAreaChart,
  buildScatterChart,
  buildKpiCardsChart,
  buildProgressBars,
  buildGanttChart,
  buildSCurveChart,
  buildHeatmap,
  buildChartData,
  buildChartFromSpec,
};
