/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة. [مكتمل]
 * >> الجزء 3/10 (هذا الملف - أُعيد بناؤه): التقارير الزمنية والمقارنة.
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية.
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية.
 *   الجزء 6/10: الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * -------------------------------------------------------------------------------
 * ملاحظة تصحيح هامة (تُقرأ قبل أي شيء آخر):
 * -------------------------------------------------------------------------------
 * الملف الذي كان موجوداً سابقاً بهذا المسار (backend/utils/reportPeriodsComparisons.js)
 * لم يكن فعلياً منطق خادم على الإطلاق، بل كان نسخة طبق الأصل من كود المتصفح الموجود في
 * backend/frontend/js/reportPeriodsComparisons.js (يستخدم document/fetch/localStorage
 * وهي كائنات غير موجودة في بيئة Node.js). نتيجة لذلك كان استدعاء
 * `require('./utils/reportPeriodsComparisons')` في server.js (لبناء REPORT_PERIODS)
 * يرمي فوراً "ReferenceError: document is not defined" عند إقلاع الخادم — أي أن
 * الخادم بأكمله كان معطوباً تماماً ولا يقلع إطلاقاً، وليس فقط الجزء 3 أو 4.
 *
 * تم اكتشاف هذا أثناء تنفيذ الجزء 4/10 (لأنه يعتمد مباشرة على هذه الوحدة)، وتم إصلاحه
 * هنا بإعادة بناء المنطق الخلفي الحقيقي الذي كانت الأجزاء 3 و4 مفترَضة أصلاً أن تعتمد
 * عليه، بنفس العقد (function signatures) التي يستدعيها server.js فعلياً:
 * PERIOD_TYPES, resolvePeriodRange, buildPeriodReport, buildPeriodComparisonReport,
 * getComparisonDimensions, buildComparisonReport. لم يتغيّر أي مسار API قائم.
 *
 * ملف المتصفح (backend/frontend/js/reportPeriodsComparisons.js) بقي كما هو دون أي
 * تعديل لأنه صحيح في مكانه الأصلي ومطلوب لعمل واجهة القسم 14 في المتصفح.
 * -------------------------------------------------------------------------------
 *
 * هذا الملف يوفر فعلياً:
 *  1) أنواع الفترات الزمنية المدعومة (PERIOD_TYPES) وحساب حدود كل فترة فعلياً
 *     (resolvePeriodRange): يومي/أسبوعي/نصف شهري/شهري/ربع سنوي/نصف سنوي/سنوي/مخصص.
 *  2) بناء تقرير فعلي لأي فترة زمنية فوق أي مصدر بيانات مسجَّل في منشئ التقارير
 *     (الجزء 2 - reportBuilder.js)، دون تكرار منطق الجلب/الفلترة/المعادلات هناك.
 *  3) مقارنة الفترة الحالية مقابل الفترة السابقة تلقائياً (فرق + نسبة تغيّر + اتجاه).
 *  4) محرك مقارنات عام بعدة أبعاد: مشروع/مشروع، مقاول/مقاول، مورد/مورد (معلَّق
 *     عمداً بخطأ صريح لعدم توفر مصدر بيانات الموردين بعد)، ميزانية/فعلي،
 *     إنجاز مخطط/فعلي (S-Curve عبر scheduling.js)، فترة/فترة، شهر/شهر، إصدار/إصدار
 *     (مقارنة إصدارات الميزانية عبر budgetManagement.js).
 *
 * قاعدة الدقة: لا تُخترع أي بيانات. كل مقارنة تُبنى من بيانات فعلية حقيقية عبر
 * الوحدات المصدرية (reportBuilder / scheduling / budgetManagement). عند عدم توفر
 * بُعد مقارنة بعد، تُرفع رسالة خطأ صريحة بدل توليد أرقام وهمية.
 */

const REPORT_BUILDER = require('./reportBuilder');
const SCH = require('./scheduling');
const BUDGET = require('./budgetManagement');

function nowISO() { return new Date().toISOString(); }
function r2(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }

// ===================== أنواع الفترات الزمنية =====================

const PERIOD_TYPES = [
  { key: 'daily', label: 'يومي' },
  { key: 'weekly', label: 'أسبوعي' },
  { key: 'biweekly', label: 'نصف شهري' },
  { key: 'monthly', label: 'شهري' },
  { key: 'quarterly', label: 'ربع سنوي' },
  { key: 'semiannual', label: 'نصف سنوي' },
  { key: 'annual', label: 'سنوي' },
  { key: 'custom', label: 'فترة مخصصة' },
];

const PERIOD_TYPE_KEYS = PERIOD_TYPES.map((p) => p.key);

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/**
 * يحسب حدود [from, to] فعلية (كائنات Date) لنوع فترة معيّن حول تاريخ مرجعي refDate.
 * customFrom/customTo مطلوبان فقط عندما periodType === 'custom'.
 */
function resolvePeriodRange(periodType, { refDate = new Date(), customFrom = null, customTo = null } = {}) {
  if (!PERIOD_TYPE_KEYS.includes(periodType)) {
    throw new Error(`نوع فترة غير مدعوم: ${periodType}. الأنواع المدعومة: ${PERIOD_TYPE_KEYS.join(', ')}`);
  }
  const ref = refDate instanceof Date ? refDate : new Date(refDate);

  switch (periodType) {
    case 'daily': {
      return { from: startOfDay(ref), to: endOfDay(ref) };
    }
    case 'weekly': {
      const day = ref.getDay();
      const start = startOfDay(addDays(ref, -day));
      return { from: start, to: endOfDay(addDays(start, 6)) };
    }
    case 'biweekly': {
      const start = startOfDay(addDays(ref, -13));
      return { from: start, to: endOfDay(ref) };
    }
    case 'monthly': {
      const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: start, to: end };
    }
    case 'quarterly': {
      const q = Math.floor(ref.getMonth() / 3);
      const start = new Date(ref.getFullYear(), q * 3, 1);
      const end = new Date(ref.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
      return { from: start, to: end };
    }
    case 'semiannual': {
      const half = ref.getMonth() < 6 ? 0 : 6;
      const start = new Date(ref.getFullYear(), half, 1);
      const end = new Date(ref.getFullYear(), half + 6, 0, 23, 59, 59, 999);
      return { from: start, to: end };
    }
    case 'annual': {
      const start = new Date(ref.getFullYear(), 0, 1);
      const end = new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { from: start, to: end };
    }
    case 'custom': {
      if (!customFrom || !customTo) throw new Error('الفترة المخصصة تتطلب customFrom وcustomTo');
      const from = startOfDay(new Date(customFrom));
      const to = endOfDay(new Date(customTo));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('تواريخ الفترة المخصصة غير صالحة');
      if (from > to) throw new Error('تاريخ البداية يجب أن يسبق تاريخ النهاية في الفترة المخصصة');
      return { from, to };
    }
    default:
      throw new Error(`نوع فترة غير مدعوم: ${periodType}`);
  }
}

/** يحسب حدود الفترة التي تسبق مباشرة فترة [from, to] بنفس طولها الزمني بالميلي ثانية. */
function previousPeriodRange(from, to) {
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return { from: prevFrom, to: prevTo };
}

// ===================== بناء تقرير لفترة زمنية محددة =====================

/**
 * spec = {
 *   dataSource, title, fields, filters, dateField,
 *   periodType, refDate, customFrom, customTo,
 *   sortBy, sortDir, groupBy, aggregateField, aggregateOp, formulas, kpis, scheduleId, limit,
 * }
 * يُعيد استخدام buildCustomReport من reportBuilder.js (الجزء 2) بعد حساب dateFrom/dateTo
 * فعلياً من periodType، دون تكرار منطق الجلب/الفلترة.
 */
function buildPeriodReport(spec = {}) {
  if (!spec.dataSource) throw new Error('يجب تحديد مصدر البيانات (dataSource)');
  if (!spec.periodType) throw new Error('يجب تحديد نوع الفترة (periodType)');

  const range = resolvePeriodRange(spec.periodType, {
    refDate: spec.refDate ? new Date(spec.refDate) : new Date(),
    customFrom: spec.customFrom || null,
    customTo: spec.customTo || null,
  });

  const builtSpec = {
    ...spec,
    dateField: spec.dateField || 'created_at',
    dateFrom: range.from.toISOString(),
    dateTo: range.to.toISOString(),
    title: spec.title || undefined,
  };

  const report = REPORT_BUILDER.buildCustomReport(builtSpec);

  return {
    ...report,
    title: spec.title || `تقرير ${PERIOD_TYPES.find((p) => p.key === spec.periodType)?.label || spec.periodType} - ${report.data_source_label}`,
    period_type: spec.periodType,
    period_range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

// ===================== مقارنة الفترة الحالية مقابل السابقة =====================

function buildMetricComparison(label, currentValue, previousValue) {
  const cur = Number(currentValue) || 0;
  const prev = Number(previousValue) || 0;
  const difference = r2(cur - prev);
  const changePercent = prev !== 0 ? r2((difference / Math.abs(prev)) * 100) : (cur !== 0 ? null : 0);
  let trend = 'flat';
  if (difference > 0) trend = 'up';
  else if (difference < 0) trend = 'down';
  return { label, current_value: r2(cur), previous_value: r2(prev), difference, change_percent: changePercent, trend };
}

/**
 * spec = { dataSource, periodType, refDate, filters, dateField, formulas, kpis, title, scheduleId }
 * يبني تقرير الفترة الحالية والفترة السابقة (بنفس الطول) فوق نفس مصدر البيانات
 * ونفس الفلاتر، ثم يقارن: عدد السجلات المطابقة + كل معادلة + كل KPI مطلوب.
 */
function buildPeriodComparisonReport(spec = {}) {
  if (!spec.dataSource) throw new Error('يجب تحديد مصدر البيانات (dataSource)');
  if (!spec.periodType) throw new Error('يجب تحديد نوع الفترة (periodType)');

  const refDate = spec.refDate ? new Date(spec.refDate) : new Date();
  const currentRange = resolvePeriodRange(spec.periodType, {
    refDate, customFrom: spec.customFrom || null, customTo: spec.customTo || null,
  });
  const previousRange = previousPeriodRange(currentRange.from, currentRange.to);

  const baseSpec = {
    dataSource: spec.dataSource,
    fields: spec.fields,
    filters: spec.filters || {},
    dateField: spec.dateField || 'created_at',
    formulas: spec.formulas || [],
    kpis: spec.kpis || [],
    scheduleId: spec.scheduleId,
    limit: spec.limit || 100000,
  };

  const currentReport = REPORT_BUILDER.buildCustomReport({
    ...baseSpec, dateFrom: currentRange.from.toISOString(), dateTo: currentRange.to.toISOString(),
  });
  const previousReport = REPORT_BUILDER.buildCustomReport({
    ...baseSpec, dateFrom: previousRange.from.toISOString(), dateTo: previousRange.to.toISOString(),
  });

  const counts = [buildMetricComparison('عدد السجلات المطابقة', currentReport.total_matched, previousReport.total_matched)];

  const formulas = (currentReport.formulas || []).map((f, idx) => {
    const prevF = (previousReport.formulas || [])[idx];
    return buildMetricComparison(f.expression, f.value, prevF ? prevF.value : 0);
  });

  const kpis = (currentReport.kpis || []).map((k, idx) => {
    const prevK = (previousReport.kpis || [])[idx];
    return buildMetricComparison(k.label, k.value, prevK ? prevK.value : 0);
  });

  return {
    generated_at: nowISO(),
    title: spec.title || `مقارنة الفترة الحالية والسابقة - ${currentReport.data_source_label}`,
    data_source: spec.dataSource,
    data_source_label: currentReport.data_source_label,
    period_type: spec.periodType,
    current_period: { range: { from: currentRange.from.toISOString(), to: currentRange.to.toISOString() } },
    previous_period: { range: { from: previousRange.from.toISOString(), to: previousRange.to.toISOString() } },
    comparison: { counts, formulas, kpis },
  };
}

// ===================== محرك المقارنات العامة (8 أبعاد) =====================

const COMPARISON_DIMENSIONS = [
  { key: 'project_vs_project', label: 'مشروع مقابل مشروع' },
  { key: 'contractor_vs_contractor', label: 'مقاول مقابل مقاول' },
  { key: 'supplier_vs_supplier', label: 'مورد مقابل مورد' },
  { key: 'budget_vs_actual', label: 'ميزانية مقابل مصروفات فعلية' },
  { key: 'planned_vs_actual_progress', label: 'إنجاز مخطط مقابل فعلي (S-Curve)' },
  { key: 'period_vs_period', label: 'فترة مقابل فترة' },
  { key: 'month_vs_month', label: 'شهر مقابل شهر' },
  { key: 'version_vs_version', label: 'إصدار ميزانية مقابل إصدار' },
];

function getComparisonDimensions() {
  return COMPARISON_DIMENSIONS;
}

function findDimension(key) {
  const dim = COMPARISON_DIMENSIONS.find((d) => d.key === key);
  if (!dim) throw new Error(`بُعد مقارنة غير معروف: ${key}. الأبعاد المتاحة: ${COMPARISON_DIMENSIONS.map((d) => d.key).join(', ')}`);
  return dim;
}

// ---- مقارنة مشروع/مشروع أو مقاول/مقاول: تُبنى فوق مصدر projects في reportBuilder ----
function compareByProjectsFilter(filterKey, itemA, itemB) {
  const reportFor = (value) => REPORT_BUILDER.buildCustomReport({
    dataSource: 'projects',
    filters: { [filterKey]: value },
    formulas: ['SUM(budget)', 'AVG(progress_percent)', 'COUNT(id)'],
    limit: 100000,
  });
  const repA = reportFor(itemA);
  const repB = reportFor(itemB);
  const metricLabels = ['إجمالي الميزانيات', 'متوسط نسبة الإنجاز', 'عدد المشاريع'];
  const comparison = repA.formulas.map((f, idx) => buildMetricComparison(metricLabels[idx] || f.expression, f.value, repB.formulas[idx] ? repB.formulas[idx].value : 0));
  return { comparison, meta: { totalA: repA.total_matched, totalB: repB.total_matched } };
}

// ---- مقارنة ميزانية/فعلي: تعتمد على budgetManagement مباشرة (يحتاج معرّف ميزانية) ----
function compareBudgetVsActual(itemA) {
  const budgetId = typeof itemA === 'object' ? itemA.budgetId : itemA;
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب لمقارنة ميزانية/فعلي');
  const budget = BUDGET.getBudget(budgetId);
  const grandTotal = typeof BUDGET.computeBBSGrandTotal === 'function' ? BUDGET.computeBBSGrandTotal(budget) : (budget.bbs_grand_total || 0);
  const spent = Number(budget.total_actual_cost || budget.actual_cost || 0);
  return {
    comparison: [
      buildMetricComparison('الميزانية المعتمدة', grandTotal, grandTotal),
      buildMetricComparison('المصروفات الفعلية', spent, 0),
      buildMetricComparison('نسبة الاستهلاك %', grandTotal ? r2((spent / grandTotal) * 100) : 0, 0),
    ],
    meta: { budget_number: budget.budget_number },
  };
}

// ---- مقارنة إنجاز مخطط/فعلي عبر S-Curve الحقيقي (scheduling.js) ----
function comparePlannedVsActualProgress(itemA) {
  const scheduleId = typeof itemA === 'object' ? itemA.scheduleId : itemA;
  if (!scheduleId) throw new Error('معرّف الجدول الزمني (scheduleId) مطلوب لمقارنة الإنجاز المخطط والفعلي');
  const curve = SCH.computeSCurve(scheduleId);
  const plannedLast = curve.planned.length ? curve.planned[curve.planned.length - 1].cumulative_percent : 0;
  const actualNow = curve.current_actual_progress_percent || 0;
  return {
    comparison: [
      buildMetricComparison('نسبة الإنجاز المخطط (تراكمي حتى اليوم)', plannedLast, plannedLast),
      buildMetricComparison('نسبة الإنجاز الفعلي', actualNow, 0),
    ],
    meta: { schedule_id: scheduleId, curve },
  };
}

// ---- مقارنة فترة/فترة أو شهر/شهر: تُبنى فوق buildPeriodReport بنفس مصدر بيانات ----
function comparePeriods(dataSource, rangeA, rangeB, filters = {}) {
  const reportFor = (range) => REPORT_BUILDER.buildCustomReport({
    dataSource,
    filters,
    dateField: 'created_at',
    dateFrom: range.from,
    dateTo: range.to,
    formulas: ['COUNT(id)'],
    limit: 100000,
  });
  const repA = reportFor(rangeA);
  const repB = reportFor(rangeB);
  return {
    comparison: [buildMetricComparison('عدد السجلات', repA.total_matched, repB.total_matched)],
    meta: { rangeA, rangeB },
  };
}

// ---- مقارنة إصدار/إصدار لميزانية معيّنة (عبر version_history في budgetManagement) ----
function compareBudgetVersions(itemA, itemB) {
  const budgetId = (typeof itemA === 'object' && itemA.budgetId) || (typeof itemB === 'object' && itemB.budgetId);
  const versionA = typeof itemA === 'object' ? itemA.version : itemA;
  const versionB = typeof itemB === 'object' ? itemB.version : itemB;
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب ضمن أحد العنصرين لمقارنة الإصدارات');
  const budget = BUDGET.getBudget(budgetId);
  const history = budget.version_history || [];

  function snapshotForVersion(v) {
    if (Number(v) === Number(budget.version)) return budget;
    const found = history.find((h) => Number(h.version) === Number(v));
    if (!found) throw new Error(`الإصدار ${v} غير موجود ضمن سجل إصدارات هذه الميزانية`);
    return found.snapshot;
  }

  const snapA = snapshotForVersion(versionA);
  const snapB = snapshotForVersion(versionB);
  const totalA = typeof BUDGET.computeBBSGrandTotal === 'function' ? BUDGET.computeBBSGrandTotal(snapA) : (snapA.bbs_grand_total || 0);
  const totalB = typeof BUDGET.computeBBSGrandTotal === 'function' ? BUDGET.computeBBSGrandTotal(snapB) : (snapB.bbs_grand_total || 0);

  return {
    comparison: [
      buildMetricComparison('إجمالي قيمة BBS', totalA, totalB),
      buildMetricComparison('رقم الإصدار', Number(versionA), Number(versionB)),
    ],
    meta: { budget_number: budget.budget_number },
  };
}

/**
 * spec = { dimension, itemA, itemB, title }
 * itemA/itemB: حسب البُعد قد تكون نصاً بسيطاً (اسم مقاول، معرّف مشروع) أو كائناً
 * (مثل { budgetId, version } أو { scheduleId }).
 */
function buildComparisonReport(spec = {}) {
  const { dimension, itemA, itemB } = spec;
  if (!dimension) throw new Error('يجب تحديد بُعد المقارنة (dimension)');
  if (itemA === undefined || itemA === null || itemB === undefined || itemB === null) {
    throw new Error('يجب تحديد كلا العنصرين المطلوب مقارنتهما (itemA وitemB)');
  }
  const dim = findDimension(dimension);

  let result;
  switch (dimension) {
    case 'project_vs_project':
      result = compareByProjectsFilter('projectId', itemA, itemB);
      break;
    case 'contractor_vs_contractor':
      result = compareByProjectsFilter('contractor', itemA, itemB);
      break;
    case 'supplier_vs_supplier':
      // معلَّق عمداً: وحدة الموردين غير مربوطة كمصدر بيانات في reportBuilder.js بعد.
      // سيُفعَّل عند ربط قسم إدارة الأعمال/المشتريات ضمن الجزء 9/10. لا بيانات وهمية.
      throw new Error('مقارنة مورد/مورد غير مفعّلة بعد: مصدر بيانات الموردين لم يُربط في منشئ التقارير حتى الآن (مخطط له في الجزء 9/10)');
    case 'budget_vs_actual':
      result = compareBudgetVsActual(itemA);
      break;
    case 'planned_vs_actual_progress':
      result = comparePlannedVsActualProgress(itemA);
      break;
    case 'period_vs_period':
    case 'month_vs_month': {
      const rangeA = { from: (typeof itemA === 'object' ? itemA.from : null), to: (typeof itemA === 'object' ? itemA.to : null) };
      const rangeB = { from: (typeof itemB === 'object' ? itemB.from : null), to: (typeof itemB === 'object' ? itemB.to : null) };
      if (!rangeA.from || !rangeA.to || !rangeB.from || !rangeB.to) {
        throw new Error('يجب تمرير itemA وitemB بصيغة { from, to } (تواريخ) لمقارنة فترة/فترة أو شهر/شهر');
      }
      result = comparePeriods(spec.dataSource || 'projects', rangeA, rangeB, spec.filters || {});
      break;
    }
    case 'version_vs_version':
      result = compareBudgetVersions(itemA, itemB);
      break;
    default:
      throw new Error(`بُعد مقارنة غير مدعوم: ${dimension}`);
  }

  return {
    generated_at: nowISO(),
    title: spec.title || `مقارنة: ${dim.label}`,
    dimension,
    dimension_label: dim.label,
    item_a: { label: typeof itemA === 'object' ? JSON.stringify(itemA) : String(itemA) },
    item_b: { label: typeof itemB === 'object' ? JSON.stringify(itemB) : String(itemB) },
    comparison: result.comparison,
    meta: result.meta || {},
  };
}

module.exports = {
  PERIOD_TYPES,
  resolvePeriodRange,
  buildPeriodReport,
  buildPeriodComparisonReport,
  getComparisonDimensions,
  buildComparisonReport,
  // مُصدَّرة للاستخدام الداخلي من الجزء 4 (التفاعلية/الرسوم البيانية) دون تكرارها
  buildMetricComparison,
  previousPeriodRange,
};
