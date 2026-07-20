/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * وحدة الرسوم البيانية (Quality Charts)
 * =====================================================================================
 * هذه الوحدة لا ترسم شيئاً بنفسها؛ فهي تجهّز البيانات الرقمية الجاهزة للاستهلاك المباشر
 * من مكتبة رسم في الواجهة الأمامية (Chart.js عبر CDN)، بصيغة { labels, datasets } قياسية
 * تتوافق مباشرة مع Chart.js، بحيث لا تحتاج الواجهة لأي معالجة إضافية على البيانات.
 *
 * الرسوم المغطاة (البند 19 من متطلبات القسم):
 *  - نسبة المطابقة (Compliance Rate)               -> compliance_rate_chart
 *  - نتائج الاختبارات (Material Test Results)       -> test_results_chart
 *  - توزيع حالات NCR (NCR Distribution)             -> ncr_distribution_chart
 *  - أداء الموردين (Supplier Performance)           -> supplier_performance_chart
 *  - أداء المقاولين (Contractor Performance)        -> contractor_performance_chart
 *  - تقدّم إجراءات CAPA (CAPA Progress)              -> capa_progress_chart
 *  - مؤشرات الجودة (Quality KPIs Overview)          -> quality_kpis_chart
 *  - مقارنة الأداء بين المشاريع (Cross-Project)     -> cross_project_comparison_chart
 */

const QMS = require('./qmsManagement');
const QMSX = require('./qmsDocsKpis');

function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function countBy(list, keyFn) {
  const counts = {};
  for (const item of list) {
    const k = keyFn(item) ?? 'غير محدد';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

function colorFor(i) {
  return PALETTE[i % PALETTE.length];
}

/** رسم: نسبة المطابقة الإجمالية (Pass/Fail/Conditional) عبر طلبات الفحص واختبارات المواد */
function buildComplianceRateChart({ projectId = null } = {}) {
  const irs = unwrap(QMS.listInspectionRequests({ projectId })).filter(r => r.status === 'closed' || r.result);
  const tests = unwrap(QMS.listMaterialTests({ projectId })).filter(t => t.status === 'completed' || t.result);

  const irCounts = countBy(irs, r => r.result || 'غير محدد');
  const testCounts = countBy(tests, t => t.result || 'غير محدد');

  const allKeys = Array.from(new Set([...Object.keys(irCounts), ...Object.keys(testCounts)]));
  const labels = { pass: 'مطابق', fail: 'غير مطابق', conditional_pass: 'مقبول بشرط', 'غير محدد': 'غير محدد' };

  return {
    chart_type: 'doughnut',
    title: 'نسبة المطابقة الإجمالية (فحوصات + اختبارات)',
    labels: allKeys.map(k => labels[k] || k),
    datasets: [{
      label: 'عدد الحالات',
      data: allKeys.map(k => (irCounts[k] || 0) + (testCounts[k] || 0)),
      backgroundColor: allKeys.map((_, i) => colorFor(i)),
    }],
  };
}

/** رسم: نتائج اختبارات المواد مجمّعة حسب الفئة (خرسانة/حديد/تربة/أسفلت/مياه) والنتيجة */
function buildTestResultsChart({ projectId = null } = {}) {
  const tests = unwrap(QMS.listMaterialTests({ projectId }));
  const categories = Array.from(new Set(tests.map(t => t.material_category).filter(Boolean)));
  const results = ['pass', 'fail', 'pending'];
  const resultLabels = { pass: 'ناجح', fail: 'راسب', pending: 'قيد الانتظار' };

  const datasets = results.map((res, i) => ({
    label: resultLabels[res],
    data: categories.map(cat => tests.filter(t => t.material_category === cat && (t.result === res || (!t.result && res === 'pending'))).length),
    backgroundColor: colorFor(i),
  }));

  return {
    chart_type: 'bar',
    title: 'نتائج اختبارات المواد حسب الفئة',
    labels: categories,
    datasets,
  };
}

/** رسم: توزيع حالات عدم المطابقة (NCR) حسب درجة الخطورة وحسب الحالة */
function buildNcrDistributionChart({ projectId = null } = {}) {
  const ncrs = unwrap(QMS.listNcrs({ projectId }));
  const bySeverity = countBy(ncrs, n => n.severity);
  const byStatus = countBy(ncrs, n => n.status);

  return {
    by_severity: {
      chart_type: 'pie',
      title: 'توزيع NCR حسب درجة الخطورة',
      labels: Object.keys(bySeverity),
      datasets: [{ data: Object.values(bySeverity), backgroundColor: Object.keys(bySeverity).map((_, i) => colorFor(i)) }],
    },
    by_status: {
      chart_type: 'bar',
      title: 'توزيع NCR حسب الحالة',
      labels: Object.keys(byStatus),
      datasets: [{ label: 'عدد الحالات', data: Object.values(byStatus), backgroundColor: colorFor(2) }],
    },
  };
}

/** رسم: أداء الموردين بناءً على طلبات اعتماد المواد (MAR) - نسبة القبول والرفض */
function buildSupplierPerformanceChart({ projectId = null } = {}) {
  const perf = unwrap(QMSX.computeSupplierPerformance({ projectId }));
  const suppliers = (perf?.suppliers || []).slice(0, 15);

  return {
    chart_type: 'bar',
    title: 'أداء الموردين (نسبة اعتماد المواد)',
    labels: suppliers.map(s => s.supplier_name),
    datasets: [
      { label: 'نسبة الاعتماد %', data: suppliers.map(s => s.approval_rate ?? 0), backgroundColor: colorFor(0) },
      { label: 'نسبة الرفض %', data: suppliers.map(s => s.rejection_rate ?? 0), backgroundColor: colorFor(2) },
    ],
  };
}

/** رسم: أداء المقاولين بناءً على نتائج الفحص وحالات NCR المرتبطة بهم */
function buildContractorPerformanceChart({ projectId = null } = {}) {
  const perf = unwrap(QMSX.computeContractorPerformance({ projectId }));
  const contractors = (perf?.contractors || []).slice(0, 15);

  return {
    chart_type: 'bar',
    title: 'أداء المقاولين (نسبة قبول الفحص وعدد NCR)',
    labels: contractors.map(c => c.contractor),
    datasets: [
      { label: 'نسبة قبول الفحص %', data: contractors.map(c => c.inspection_pass_rate ?? 0), backgroundColor: colorFor(0) },
      { label: 'عدد NCR', data: contractors.map(c => c.ncr_count ?? 0), backgroundColor: colorFor(2) },
    ],
  };
}

/** رسم: تقدّم إجراءات CAPA حسب الحالة (مفتوح/قيد التنفيذ/تم التحقق/مغلق) */
function buildCapaProgressChart({ projectId = null } = {}) {
  const capas = unwrap(QMS.listCapas({ projectId }));
  const byStatus = countBy(capas, c => c.status);
  const order = ['open', 'in_progress', 'pending_verification', 'verified', 'closed'];
  const orderedLabels = order.filter(s => byStatus[s] !== undefined);
  const statusLabels = {
    open: 'مفتوح', in_progress: 'قيد التنفيذ', pending_verification: 'بانتظار التحقق',
    verified: 'تم التحقق', closed: 'مغلق',
  };

  return {
    chart_type: 'bar',
    title: 'تقدّم إجراءات CAPA حسب الحالة',
    labels: orderedLabels.map(s => statusLabels[s] || s),
    datasets: [{ label: 'عدد الإجراءات', data: orderedLabels.map(s => byStatus[s]), backgroundColor: colorFor(5) }],
  };
}

/** رسم: نظرة عامة على مؤشرات الجودة الرئيسية (رادار) */
function buildQualityKpisChart({ projectId = null } = {}) {
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  const general = kpis?.general || {};
  const ncrClosure = kpis?.ncr_closure || {};

  return {
    chart_type: 'radar',
    title: 'نظرة عامة على مؤشرات الجودة',
    labels: ['نسبة قبول الفحص', 'نسبة رفض الفحص', 'نسبة نجاح الاختبارات', 'نسبة إغلاق NCR في الوقت'],
    datasets: [{
      label: 'المؤشرات (%)',
      data: [
        general.inspection_pass_rate ?? 0,
        general.inspection_rejection_rate ?? 0,
        general.test_pass_rate ?? 0,
        ncrClosure.closure_within_30days_rate ?? 0,
      ],
      backgroundColor: 'rgba(37, 99, 235, 0.2)',
      borderColor: colorFor(0),
    }],
  };
}

/** رسم: مقارنة الأداء بين المشاريع (لكل مشروع: عدد NCR، نسبة المطابقة، عدد CAPA المتأخرة) */
function buildCrossProjectComparisonChart({ projectIds = [] } = {}) {
  const ids = Array.isArray(projectIds) && projectIds.length ? projectIds : [null];
  const rows = ids.map(pid => {
    const dashboard = unwrap(QMS.getDashboard(pid));
    return {
      projectId: pid || 'كل المشاريع',
      ncr_count: dashboard.ncr_count,
      compliance_rate: dashboard.quality_compliance_rate,
      capa_overdue_count: dashboard.capa_overdue_count,
    };
  });

  return {
    chart_type: 'bar',
    title: 'مقارنة الأداء بين المشاريع',
    labels: rows.map(r => r.projectId),
    datasets: [
      { label: 'نسبة المطابقة %', data: rows.map(r => r.compliance_rate), backgroundColor: colorFor(0) },
      { label: 'عدد NCR', data: rows.map(r => r.ncr_count), backgroundColor: colorFor(2) },
      { label: 'CAPA متأخرة', data: rows.map(r => r.capa_overdue_count), backgroundColor: colorFor(3) },
    ],
  };
}

/** تجميع كل الرسوم البيانية دفعة واحدة لعرضها في لوحة معلومات الجودة */
function getAllQualityCharts({ projectId = null } = {}) {
  const ncrDist = buildNcrDistributionChart({ projectId });
  return {
    compliance_rate_chart: buildComplianceRateChart({ projectId }),
    test_results_chart: buildTestResultsChart({ projectId }),
    ncr_distribution_by_severity_chart: ncrDist.by_severity,
    ncr_distribution_by_status_chart: ncrDist.by_status,
    supplier_performance_chart: buildSupplierPerformanceChart({ projectId }),
    contractor_performance_chart: buildContractorPerformanceChart({ projectId }),
    capa_progress_chart: buildCapaProgressChart({ projectId }),
    quality_kpis_chart: buildQualityKpisChart({ projectId }),
  };
}

module.exports = {
  buildComplianceRateChart,
  buildTestResultsChart,
  buildNcrDistributionChart,
  buildSupplierPerformanceChart,
  buildContractorPerformanceChart,
  buildCapaProgressChart,
  buildQualityKpisChart,
  buildCrossProjectComparisonChart,
  getAllQualityCharts,
};
