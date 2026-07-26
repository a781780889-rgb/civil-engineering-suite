/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة. [مكتمل]
 *   الجزء 3/10: التقارير الزمنية والمقارنة. [مكتمل]
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية. [مكتمل]
 * >> الجزء 5/10 (هذا الملف): التقارير التنفيذية + التقارير الدورية (يومي/أسبوعي/شهري).
 *   الجزء 6/10: الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * هذا الجزء يوفر:
 *  1) لوحة "Executive Dashboard" موحّدة على مستوى مشروع واحد أو على مستوى المنصة
 *     بالكامل (كل المشاريع)، تجمع أهم مؤشرات: الإنجاز، الميزانية، المصروفات،
 *     الأرباح، التأخير، المخاطر، الجودة، السلامة، وأداء الموارد/المعدات - مع
 *     تصنيف حالة كل مؤشر (طبيعي / يحتاج متابعة / تحذير / خطر) بحسب عتبات واضحة
 *     وقابلة للمراجعة (وليست تقديرات عشوائية).
 *  2) التقارير الدورية (يومي / أسبوعي / شهري) على مستوى مشروع واحد، تجمع فعلياً:
 *     الأعمال المنفذة (مهام)، العمال (فريق المشروع)، المعدات، المواد (QMS)،
 *     الإنجاز، المشاكل (مخاطر مفتوحة)، السلامة (HSE)، الجودة (QMS)، الملاحظات.
 *  3) دورة حياة سجل التقرير: كل تقرير تنفيذي أو دوري يُسجَّل تلقائياً في مركز
 *     التقارير (reportsCenter) عبر registerReportRecord، تماماً كباقي الأجزاء.
 *
 * قاعدة الدقة: هذا الملف لا يخترع أي بيانات. كل رقم يُشتق فعلياً من الوحدات
 * المصدرية الحقيقية (projectManagement، budgetManagement، scheduling، hseReports،
 * qmsReports، equipmentReports، documentReports، drawingReports، boqReports،
 * surveyReports) عبر الواجهات العامة الموجودة أصلاً في كل وحدة. عند عدم توفر
 * بيانات لمشروع معيّن (لا توجد ميزانية مرتبطة مثلاً)، تُعرض قيم صفرية حقيقية بدل
 * بيانات وهمية، مع توضيح ذلك في حقل `notes` عند الحاجة.
 */

const path = require('path');
const fs = require('fs');

const PM = require('./projectManagement');
const BUDGET = require('./budgetManagement');
const SCH = require('./scheduling');
const HSE_REPORTS = require('./hseReports');
const QMS_REPORTS = require('./qmsReports');
const EQ_REPORTS = require('./equipmentReports');
const REPORTS_CENTER = require('./reportsCenter');

const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function nowISO() { return new Date().toISOString(); }
function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

/** كثير من دوال وحدات المنصة (budgetManagement، scheduling، hseReports، qmsReports،
 * equipmentReports) تُرجع نتيجتها إما كقيمة مباشرة أو ضمن { success, data }. هذه
 * الدالة تستخرج البيانات الفعلية بأمان بغض النظر عن الشكل. */
function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result && 'success' in result) return result.data;
  return result;
}

/** استدعاء آمن: إن رمت الدالة المصدرية خطأ (مثال: لا توجد ميزانية للمشروع)
 * نُعيد fallback بدل تعطيل التقرير التنفيذي بالكامل، مع تسجيل السبب. */
function safeCall(fn, fallback, ...args) {
  try {
    return { ok: true, value: unwrap(fn(...args)) };
  } catch (e) {
    return { ok: false, value: fallback, error: e.message };
  }
}

// ============================================================================
// ===================== عتبات تصنيف حالة المؤشرات (Thresholds) =============
// ============================================================================
// عتبات ثابتة وقابلة للمراجعة (وليست أحكاماً عشوائية) تُستخدم لتلوين حالة كل
// مؤشر في التقرير التنفيذي: طبيعي (ok) / يحتاج متابعة (watch) / تحذير (warning) / خطر (critical)

const INDICATOR_THRESHOLDS = {
  // نسبة استهلاك الميزانية إلى الميزانية الكلية
  budget_utilization_percent: { watch: 80, warning: 95, critical: 100 },
  // عدد الأيام المتبقية حتى تاريخ نهاية المشروع المخطط (كلما قلّ زادت الخطورة إن كان التقدم منخفضاً)
  schedule_variance_percent: { watch: -5, warning: -15, critical: -30 }, // (تقدم فعلي - تقدم مخطط)
  // عدد المخاطر الحرجة/العالية المفتوحة
  open_high_critical_risks: { watch: 1, warning: 3, critical: 6 },
  // معدل تكرار الحوادث (Incident Frequency) لكل 100 عامل تقريبياً - يعتمد على عدد الحوادث المفتوحة/الإجمالي
  hse_open_incidents: { watch: 1, warning: 3, critical: 6 },
  // عدد NCR المفتوحة في الجودة
  qms_open_ncrs: { watch: 2, warning: 5, critical: 10 },
};

function classifyIndicator(value, thresholds, { higherIsWorse = true } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return { status: 'unknown', status_label: 'غير متوفر' };
  }
  const v = Number(value);
  const { watch, warning, critical } = thresholds;
  if (higherIsWorse) {
    if (v >= critical) return { status: 'critical', status_label: 'خطر' };
    if (v >= warning) return { status: 'warning', status_label: 'تحذير' };
    if (v >= watch) return { status: 'watch', status_label: 'يحتاج متابعة' };
    return { status: 'ok', status_label: 'طبيعي' };
  }
  // حالة الانحراف الزمني: القيم السالبة الأكبر (أبعد عن الصفر) أسوأ
  if (v <= critical) return { status: 'critical', status_label: 'خطر' };
  if (v <= warning) return { status: 'warning', status_label: 'تحذير' };
  if (v <= watch) return { status: 'watch', status_label: 'يحتاج متابعة' };
  return { status: 'ok', status_label: 'طبيعي' };
}

// ============================================================================
// ===================== التقرير التنفيذي على مستوى مشروع واحد ==============
// ============================================================================

/**
 * يبني تقريراً تنفيذياً شاملاً لمشروع واحد، يجمع فعلياً بيانات كل الأقسام
 * المرتبطة (المشروع، الميزانية، الجدول الزمني، السلامة، الجودة، المعدات).
 */
function buildProjectExecutiveReport({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب لبناء التقرير التنفيذي');

  const project = PM.getProject(projectId, { includeRelations: true });

  // ------------------ الإنجاز والجدول الزمني ------------------
  const scheduleCompare = safeCall(PM.compareScheduleVsActual, null, projectId);
  const progressPercent = r2(project.phases && project.phases.length
    ? project.phases.reduce((s, p) => s + (Number(p.progress_percent) || 0), 0) / project.phases.length
    : 0);

  // ------------------ المالية ------------------
  const financial = project.financial_summary || {
    budget: 0, total_expenses: 0, total_revenue: 0, total_payments: 0,
    remaining_budget: 0, budget_utilization_percent: 0, net_cash_flow: 0, over_budget: false,
  };

  const budgetsList = safeCall(BUDGET.listBudgets, { data: [] }, { project_id: projectId, page: 1, pageSize: 50 });
  const projectBudgets = (budgetsList.ok ? (budgetsList.value.data || []) : []);
  const evmOverview = projectBudgets.length
    ? safeCall(BUDGET.getEVMOverview, null, { project_id: projectId })
    : { ok: false, value: null, error: 'لا توجد ميزانية مرتبطة بهذا المشروع' };

  // ------------------ المخاطر ------------------
  const risks = PM.listRisks(projectId);
  const openRisks = risks.filter((r) => r.status !== 'closed');
  const highCriticalOpenRisks = openRisks.filter((r) => r.level === 'high' || r.level === 'critical');

  // ------------------ السلامة (HSE) ------------------
  const hseExec = safeCall(HSE_REPORTS.buildExecutiveReport, null, { projectId });
  const hseOpenIncidents = hseExec.ok && hseExec.value && hseExec.value.overview
    ? Number(hseExec.value.overview.open_incidents || hseExec.value.overview.total_open_incidents || 0)
    : 0;

  // ------------------ الجودة (QMS) ------------------
  const qmsExec = safeCall(QMS_REPORTS.buildExecutiveReport, null, { projectId });
  const qmsOpenNcrs = qmsExec.ok && qmsExec.value && qmsExec.value.ncr_summary
    ? Number(qmsExec.value.ncr_summary.open || 0)
    : 0;

  // ------------------ الموارد / المعدات ------------------
  const equipmentExec = safeCall(EQ_REPORTS.buildExecutiveSummaryReport, null, { projectId });

  // ------------------ تصنيف حالة كل مؤشر ------------------
  const scheduleVariance = scheduleCompare.ok && scheduleCompare.value
    ? r2((Number(scheduleCompare.value.actual_progress_percent) || 0) - (Number(scheduleCompare.value.planned_progress_percent) || 0))
    : null;

  const indicators = {
    progress: {
      label: 'نسبة الإنجاز',
      value: project.progress_percent !== undefined ? project.progress_percent : progressPercent,
      unit: '%',
      status: null, // الإنجاز وحده لا يُصنَّف؛ التصنيف الحقيقي عبر الانحراف الزمني أدناه
    },
    schedule_variance: {
      label: 'الانحراف عن الجدول الزمني (فعلي - مخطط)',
      value: scheduleVariance,
      unit: '%',
      ...classifyIndicator(scheduleVariance, INDICATOR_THRESHOLDS.schedule_variance_percent, { higherIsWorse: false }),
      note: scheduleCompare.ok ? null : (scheduleCompare.error || 'لا تتوفر مقارنة جدول زمني لهذا المشروع'),
    },
    budget_utilization: {
      label: 'نسبة استهلاك الميزانية',
      value: financial.budget_utilization_percent,
      unit: '%',
      ...classifyIndicator(financial.budget_utilization_percent, INDICATOR_THRESHOLDS.budget_utilization_percent),
    },
    open_high_critical_risks: {
      label: 'المخاطر العالية/الحرجة المفتوحة',
      value: highCriticalOpenRisks.length,
      unit: 'عدد',
      ...classifyIndicator(highCriticalOpenRisks.length, INDICATOR_THRESHOLDS.open_high_critical_risks),
    },
    hse_open_incidents: {
      label: 'حوادث السلامة المفتوحة',
      value: hseOpenIncidents,
      unit: 'عدد',
      ...classifyIndicator(hseOpenIncidents, INDICATOR_THRESHOLDS.hse_open_incidents),
      note: hseExec.ok ? null : (hseExec.error || 'لا تتوفر بيانات سلامة لهذا المشروع'),
    },
    qms_open_ncrs: {
      label: 'حالات عدم المطابقة (NCR) المفتوحة',
      value: qmsOpenNcrs,
      unit: 'عدد',
      ...classifyIndicator(qmsOpenNcrs, INDICATOR_THRESHOLDS.qms_open_ncrs),
      note: qmsExec.ok ? null : (qmsExec.error || 'لا تتوفر بيانات جودة لهذا المشروع'),
    },
  };

  // ------------------ الحالة العامة للمشروع (أسوأ حالة بين المؤشرات المصنَّفة) ------------------
  const severityOrder = { unknown: -1, ok: 0, watch: 1, warning: 2, critical: 3 };
  let overallStatus = 'ok';
  for (const key of Object.keys(indicators)) {
    const ind = indicators[key];
    if (ind.status && severityOrder[ind.status] > severityOrder[overallStatus]) {
      overallStatus = ind.status;
    }
  }
  const overallLabels = { ok: 'طبيعي', watch: 'يحتاج متابعة', warning: 'تحذير', critical: 'خطر' };

  return {
    title: `التقرير التنفيذي - ${project.name}`,
    report_type: 'project_executive',
    generated_at: nowISO(),
    project_id: projectId,
    project_name: project.name,
    project_status: project.status,
    overall_status: overallStatus,
    overall_status_label: overallLabels[overallStatus] || overallStatus,
    indicators,
    financial_summary: financial,
    evm: evmOverview.ok ? evmOverview.value : null,
    risks_summary: {
      total: risks.length,
      open: openRisks.length,
      high_or_critical_open: highCriticalOpenRisks.length,
      by_level: risks.reduce((acc, r) => { acc[r.level] = (acc[r.level] || 0) + 1; return acc; }, {}),
    },
    hse_summary: hseExec.ok ? hseExec.value : null,
    quality_summary: qmsExec.ok ? qmsExec.value : null,
    equipment_summary: equipmentExec.ok ? equipmentExec.value : null,
    data_sources: {
      project: 'projectManagement', financial: 'projectManagement/budgetManagement',
      schedule: 'projectManagement.compareScheduleVsActual', hse: 'hseReports', quality: 'qmsReports', equipment: 'equipmentReports',
    },
    rows: [], // لا تُعرض هذه اللوحة كجدول صفوف؛ تُعرض كبطاقات KPI (rows فارغة عمداً)
  };
}

// ============================================================================
// ============= التقرير التنفيذي على مستوى المنصة بالكامل (كل المشاريع) =====
// ============================================================================

/**
 * يبني لوحة تنفيذية شاملة على مستوى كل المشاريع (Portfolio-level Executive
 * Dashboard) - يُستخدم للإدارة العليا التي تحتاج نظرة عامة سريعة دون الدخول
 * لتفاصيل كل مشروع على حدة.
 */
function buildPortfolioExecutiveReport({ statusFilter = null } = {}) {
  const listResult = PM.listProjects({ status: statusFilter || undefined, page: 1, pageSize: 1000 });
  const projects = listResult.items;

  const perProjectSummaries = projects.map((p) => {
    let exec;
    try {
      exec = buildProjectExecutiveReport({ projectId: p.id });
    } catch (e) {
      return {
        project_id: p.id, project_name: p.name, overall_status: 'unknown',
        overall_status_label: 'تعذّر التحليل', error: e.message,
      };
    }
    return {
      project_id: p.id,
      project_name: p.name,
      status: p.status,
      progress_percent: p.progress_percent,
      overall_status: exec.overall_status,
      overall_status_label: exec.overall_status_label,
      budget_utilization_percent: exec.indicators.budget_utilization.value,
      open_high_critical_risks: exec.indicators.open_high_critical_risks.value,
      hse_open_incidents: exec.indicators.hse_open_incidents.value,
      qms_open_ncrs: exec.indicators.qms_open_ncrs.value,
    };
  });

  const byOverallStatus = perProjectSummaries.reduce((acc, s) => {
    acc[s.overall_status] = (acc[s.overall_status] || 0) + 1;
    return acc;
  }, {});

  const platformDashboard = PM.getDashboard();

  return {
    title: 'التقرير التنفيذي - نظرة شاملة على كل المشاريع',
    report_type: 'portfolio_executive',
    generated_at: nowISO(),
    total_projects: projects.length,
    by_overall_status: byOverallStatus,
    platform_dashboard: platformDashboard,
    projects: perProjectSummaries,
    rows: perProjectSummaries,
  };
}

// ============================================================================
// ========================= التقارير الدورية (يومي/أسبوعي/شهري) =============
// ============================================================================

const PERIODIC_TYPES = { daily: 'التقرير اليومي', weekly: 'التقرير الأسبوعي', monthly: 'التقرير الشهري' };

function resolvePeriodicRange(periodType, refDate = new Date()) {
  const ref = new Date(refDate);
  let from; let to;
  if (periodType === 'daily') {
    from = new Date(ref); from.setHours(0, 0, 0, 0);
    to = new Date(ref); to.setHours(23, 59, 59, 999);
  } else if (periodType === 'weekly') {
    from = new Date(ref); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - from.getDay());
    to = new Date(from); to.setDate(to.getDate() + 6); to.setHours(23, 59, 59, 999);
  } else if (periodType === 'monthly') {
    from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    throw new Error(`نوع فترة غير مدعوم: ${periodType}. القيم المسموحة: daily, weekly, monthly`);
  }
  return { from, to };
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return false;
  return ts >= from.getTime() && ts <= to.getTime();
}

/**
 * يبني التقرير الدوري (يومي/أسبوعي/شهري) لمشروع واحد، يجمع فعلياً:
 * الأعمال المنفذة (مهام مُحدَّثة/مكتملة خلال الفترة)، العمال (الفريق النشط)،
 * المعدات (من equipmentReports)، الجودة والسلامة (من qmsReports/hseReports)،
 * المخاطر/المشاكل المفتوحة خلال الفترة، والملاحظات النصية الحرة إن وُجدت.
 */
function buildProjectPeriodicReport({ projectId, periodType = 'daily', refDate = new Date(), notes = null } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  if (!PERIODIC_TYPES[periodType]) {
    throw new Error(`نوع الفترة غير مدعوم: ${periodType}. القيم المسموحة: daily, weekly, monthly`);
  }

  const { from, to } = resolvePeriodicRange(periodType, refDate);
  const project = PM.getProject(projectId, { includeRelations: true });

  // ------------------ الأعمال المنفذة (المهام المُحدَّثة/المُنجزة خلال الفترة) ------------------
  const allTasks = PM.listTasks(projectId);
  const tasksUpdatedInPeriod = allTasks.filter((t) => inRange(t.updated_at, from, to));
  const tasksCompletedInPeriod = tasksUpdatedInPeriod.filter((t) => t.status === 'completed');
  const tasksDelayedInPeriod = allTasks.filter((t) => t.status === 'delayed');

  // ------------------ العمال (فريق المشروع) ------------------
  const team = project.team || [];

  // ------------------ الإنجاز ------------------
  const scheduleCompare = safeCall(PM.compareScheduleVsActual, null, projectId);

  // ------------------ المشاكل (مخاطر مفتوحة، مسجّلة أو محدَّثة خلال الفترة أو ما زالت مفتوحة) ------------------
  const allRisks = PM.listRisks(projectId);
  const openRisks = allRisks.filter((r) => r.status !== 'closed');
  const risksRaisedInPeriod = allRisks.filter((r) => inRange(r.created_at, from, to));

  // ------------------ السلامة (HSE) خلال الفترة ------------------
  const hseIncidents = safeCall(HSE_REPORTS.buildIncidentsReport, null, { projectId, dateFrom: from.toISOString(), dateTo: to.toISOString() });

  // ------------------ الجودة (QMS) خلال الفترة ------------------
  const qmsPeriodic = safeCall(QMS_REPORTS.buildPeriodicReport, null, { projectId, period: periodType, dateFrom: from.toISOString(), dateTo: to.toISOString() });

  // ------------------ المعدات المخصَّصة للمشروع ------------------
  const equipmentUsage = safeCall(EQ_REPORTS.buildUsageByProjectReport, null, { projectId });

  return {
    title: `${PERIODIC_TYPES[periodType]} - ${project.name}`,
    report_type: `periodic_${periodType}`,
    generated_at: nowISO(),
    project_id: projectId,
    project_name: project.name,
    period: { type: periodType, from: from.toISOString(), to: to.toISOString() },
    progress: {
      overall_progress_percent: project.progress_percent,
      schedule_comparison: scheduleCompare.ok ? scheduleCompare.value : null,
      schedule_note: scheduleCompare.ok ? null : (scheduleCompare.error || 'لا تتوفر مقارنة جدول زمني'),
    },
    executed_works: {
      tasks_updated_count: tasksUpdatedInPeriod.length,
      tasks_completed_count: tasksCompletedInPeriod.length,
      tasks_delayed_count: tasksDelayedInPeriod.length,
      tasks_updated: tasksUpdatedInPeriod.map((t) => ({
        id: t.id, title: t.title, status: t.status, assignee: t.assignee, progress_percent: t.progress_percent,
      })),
    },
    workforce: {
      total_team_members: team.length,
      team: team.map((m) => ({ id: m.id, name: m.name || m.full_name || null, role: m.role || null })),
    },
    equipment: equipmentUsage.ok ? equipmentUsage.value : null,
    issues: {
      open_risks_total: openRisks.length,
      risks_raised_in_period: risksRaisedInPeriod.length,
      open_risks: openRisks.map((r) => ({ id: r.id, description: r.description, level: r.level, status: r.status })),
    },
    safety: hseIncidents.ok ? hseIncidents.value : null,
    quality: qmsPeriodic.ok ? qmsPeriodic.value : null,
    notes: notes || null,
    data_sources: {
      tasks: 'projectManagement', team: 'projectManagement', equipment: 'equipmentReports',
      risks: 'projectManagement', safety: 'hseReports', quality: 'qmsReports',
    },
    rows: tasksUpdatedInPeriod,
  };
}

// ============================================================================
// ===================== تسجيل التقرير في مركز التقارير + التصدير ===========
// ============================================================================

/** يبني التقرير التنفيذي/الدوري المطلوب ثم يُسجِّله فعلياً في مركز التقارير (reportsCenter) */
function generateAndRegister(kind, spec = {}, { userId = null } = {}) {
  let report;
  let category;
  if (kind === 'project_executive') {
    report = buildProjectExecutiveReport(spec);
    category = 'project_executive';
  } else if (kind === 'portfolio_executive') {
    report = buildPortfolioExecutiveReport(spec);
    category = 'portfolio_executive';
  } else if (kind === 'periodic') {
    report = buildProjectPeriodicReport(spec);
    category = `periodic_${spec.periodType || 'daily'}`;
  } else {
    throw new Error(`نوع تقرير غير مدعوم: ${kind}. القيم المسموحة: project_executive, portfolio_executive, periodic`);
  }

  const registered = REPORTS_CENTER.registerReportRecord({
    title: report.title,
    category,
    projectId: spec.projectId || null,
    userId,
    status: 'completed',
  });

  return { ...report, record_id: registered.id };
}

// ===================== تحويل التقرير لصفوف جدولية (لأغراض PDF/Excel/CSV) =====================
// نفس نمط flattenReportToTable المستخدم في hseReports.js/qmsReports.js/documentReports.js
// لضمان اتساق كامل بين كل وحدات التقارير في المنصة.

function flattenReportToTable(report) {
  const rows = report.rows || [];
  if (rows.length === 0) {
    const flatIndicators = report.indicators
      ? Object.entries(report.indicators).map(([, ind]) => [ind.label, `${ind.value ?? '-'} ${ind.unit || ''}`.trim()])
      : [];
    if (flatIndicators.length) {
      return { headers: ['المؤشر', 'القيمة'], dataRows: flatIndicators };
    }
    return {
      headers: ['الحقل', 'القيمة'],
      dataRows: Object.entries(report)
        .filter(([k]) => k !== 'rows' && k !== 'indicators')
        .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
    };
  }
  const keys = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));
  const dataRows = rows.map((r) => keys.map((k) => {
    const v = r[k];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));
  return { headers: keys, dataRows };
}

function exportExecPeriodicReportToPDF(report, meta = {}) {
  const filename = `exec-periodic-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const result = generateBoqTablePDF({
    title: report.title || 'Executive / Periodic Report', meta, headers, rows: dataRows, totals: null, outputPath,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportExecPeriodicReportToExcel(report) {
  const filename = `exec-periodic-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateXlsx([{ name: 'Report', rows: [headers, ...dataRows] }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportExecPeriodicReportToCSV(report) {
  const filename = `exec-periodic-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);
  const buffer = generateCsv(headers, dataRows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportExecPeriodicReportToWord(report) {
  const filename = `exec-periodic-report-${Date.now()}.rtf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  function rtfEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
  }

  const headerRow = `\\trowd\\trgaph70 ${headers.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${headers.map((h) => `\\intbl ${rtfEscape(h)}\\cell`).join('')}\\row\n`;
  const bodyRows = dataRows.map((row) => `\\trowd\\trgaph70 ${row.map((_, idx) => `\\cellx${(idx + 1) * 2000}`).join('')}\n${row.map((c) => `\\intbl ${rtfEscape(c)}\\cell`).join('')}\\row\n`).join('');

  const rtf = `{\\rtf1\\ansi\\ansicpg1256\\deff0\\rtldoc\n{\\fonttbl{\\f0 Arial;}}\n\\f0\\fs28\\b ${rtfEscape(report.title || 'Report')}\\b0\\fs20\\par\n\\fs18 ${rtfEscape(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}\\par\\par\n\\trowd\n${headerRow}${bodyRows}\n}`;

  fs.writeFileSync(outputPath, rtf, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

function exportExecPeriodicReportToPrintableHTML(report, meta = {}) {
  const filename = `exec-periodic-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const { headers, dataRows } = flattenReportToTable(report);

  const theadHtml = headers.map((h) => `<th>${h}</th>`).join('');
  const rowsHtml = dataRows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');

  const statusBadge = report.overall_status_label
    ? `<div class="badge status-${report.overall_status}">الحالة العامة: ${report.overall_status_label}</div>` : '';

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${report.title || 'تقرير تنفيذي/دوري'}</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#1a2634}
h1{border-bottom:3px solid #0d2438;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
th{background:#0d2438;color:#fff}
tr:nth-child(even){background:#f5f7fa}
.meta{margin:10px 0;color:#555}
.badge{display:inline-block;padding:6px 14px;border-radius:6px;font-weight:bold;margin:8px 0}
.status-ok{background:#e6f6ec;color:#1e7e34}
.status-watch{background:#fff8e1;color:#8a6d00}
.status-warning{background:#fff0e1;color:#a15c00}
.status-critical{background:#fdecea;color:#b71c1c}
@media print{button{display:none}}
</style></head><body>
<h1>${report.title || 'تقرير تنفيذي/دوري'}</h1>
<div class="meta">المشروع: ${meta.projectName || report.project_name || '-'} | تاريخ الإصدار: ${new Date(report.generated_at || Date.now()).toLocaleString('ar-EG')}</div>
${statusBadge}
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  // العتبات (متاحة للواجهة لعرض شرح التصنيف)
  INDICATOR_THRESHOLDS,
  PERIODIC_TYPES,
  // البناء
  buildProjectExecutiveReport,
  buildPortfolioExecutiveReport,
  buildProjectPeriodicReport,
  resolvePeriodicRange,
  // التسجيل في مركز التقارير
  generateAndRegister,
  // التصدير
  exportExecPeriodicReportToPDF,
  exportExecPeriodicReportToExcel,
  exportExecPeriodicReportToCSV,
  exportExecPeriodicReportToWord,
  exportExecPeriodicReportToPrintableHTML,
};
