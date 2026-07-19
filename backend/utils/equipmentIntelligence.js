/**
 * القسم السابع - نظام إدارة المعدات (Equipment & Assets Management System)
 * =========================================================================
 * الجزء الرابع (4-ب من 4، الأخير): الذكاء الاصطناعي + التكامل + الصلاحيات المتقدمة
 * ------------------------------------------------------------------------
 * يبني فوق:
 *   - equipmentManagement.js  (الأجزاء 1-3: السجل/التشغيل/الحجز/التتبع/الوقود/
 *                               الصيانة/قطع الغيار/المشغلون/التكاليف/الإنتاجية/التنبيهات)
 *   - equipmentReports.js     (الجزء 4-أ: التقارير العشرة + التصدير)
 * دون تعديل أيّ منهما، بنفس نمط businessGovernance.js (القسم السادس - الجزء الرابع).
 *
 * محتوى هذا الملف:
 *   1) الذكاء الاصطناعي: تنبؤ بالأعطال، تحليل الوقود، اقتراح مواعيد الصيانة
 *      الوقائية، تحليل ومقارنة الكفاءة، اقتراح توزيع المعدات، تقدير التكلفة
 *      المستقبلية، تنبيهات استباقية، تقارير/ملخصات تحليلية تلقائية، ومساعد
 *      أسئلة حرة. جميعها تُغذّى ببيانات حقيقية مجمّعة من equipmentManagement.js
 *      (وليست نصوصاً عامة)، وتعيد استخدام نفس طبقة الاتصال بـ Claude API
 *      الموجودة أصلاً في calculators/import/aiAnalyzer.js.
 *   2) التكامل: equipmentIntegrationSnapshot() تجمع لحظياً بيانات حيّة من
 *      إدارة المشاريع (PM)، إدارة العمليات/المهام (BIZO)، والحوكمة (GOV) لضمان
 *      اتساق أرقام لوحة التحكم الرئيسية مع حالة النظام الفعلية، مع دوال ربط
 *      فعلية: مزامنة استخدام المعدة بالمشروع، وإنشاء مهمة إصلاح تلقائياً عند
 *      تسجيل عطل حرج (بدل ترك الأمر سجلاً نصياً معزولاً).
 *   3) الصلاحيات المتقدمة: توسعة أدوار القسم السابع (مدير المعدات/مهندس
 *      الموقع/مسؤول الصيانة/أمين المخزن/المشغل/المحاسب/العميل) ضمن نظام RBAC
 *      المركزي في businessSecurity.js (بدل تكراره)، مع دالة تحقق مخصصة
 *      equipmentCan() تُستخدم في مسارات server.js الجديدة.
 *
 * التخزين: لا يُنشئ هذا الملف قاعدة بيانات جديدة؛ يعتمد بالكامل على البيانات
 * المخزَّنة أصلاً في backend/data/equipment.json (عبر equipmentManagement.js).
 */

const EQ = require('./equipmentManagement');
const EQR = require('./equipmentReports');
const PM = require('./projectManagement');
const BIZO = require('./businessOperations');
const SEC = require('./businessSecurity');
const AI = require('../calculators/import/aiAnalyzer');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function safeCall(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
function isAIAvailable() { return AI.isAIAvailable(); }
function requireAI() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
}

// =====================================================================
// ===================== 1) طبقة تجميع بيانات المعدات للذكاء الاصطناعي =====================
// =====================================================================
// دوال مساعدة داخلية تجمع بيانات حقيقية من equipmentManagement.js لتغذية
// نماذج الذكاء الاصطناعي، بدل تمرير نصوص عامة أو بيانات وهمية.

function collectEquipmentAIProfile(equipmentId) {
  const equipment = EQ.getEquipment(equipmentId).data;
  const operationStats = safeCall(() => EQ.getOperationStats(equipmentId, { period: 'all' }).data, null);
  const fuelStats = safeCall(() => EQ.getFuelStats(equipmentId, { period: 'all' }).data, null);
  const maintenanceStats = safeCall(() => EQ.getMaintenanceStats(equipmentId).data, null);
  const costBreakdown = safeCall(() => EQ.getEquipmentCostBreakdown(equipmentId).data, null);
  const productivity = safeCall(() => EQ.getEquipmentProductivity(equipmentId).data, null);
  const maintenanceRecords = safeCall(
    () => EQ.listMaintenanceRecords({ equipmentId }).data
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
      .slice(0, 30),
    []
  );
  const fuelLogs = safeCall(
    () => EQ.listFuelLogs({ equipmentId }).data
      .sort((a, b) => (b.filled_at || '').localeCompare(a.filled_at || ''))
      .slice(0, 60),
    []
  );

  return {
    equipment: {
      id: equipment.id, code: equipment.code, name: equipment.name, category: equipment.category,
      type: equipment.type, manufacturer: equipment.manufacturer, model: equipment.model,
      year: equipment.year, status: equipment.status, total_operating_hours: equipment.total_operating_hours,
      purchase_date: equipment.purchase_date, tank_capacity_l: equipment.tank_capacity_l,
      fuel_avg_consumption: equipment.fuel_avg_consumption,
    },
    operation_stats: operationStats,
    fuel_stats: fuelStats,
    maintenance_stats: maintenanceStats,
    cost_breakdown: costBreakdown,
    productivity,
    recent_maintenance_records: maintenanceRecords,
    recent_fuel_logs: fuelLogs,
  };
}

function collectFleetAIProfile({ projectId = null } = {}) {
  const equipmentList = EQ.listEquipment({ projectId }).data;
  const dashboard = safeCall(() => EQ.getBasicDashboard(projectId).data, null);
  const fleetCosts = safeCall(() => EQ.getFleetCostSummary({ projectId }).data, null);
  const productivityComparison = safeCall(() => EQ.compareEquipmentProductivity({}).data, null);
  const alerts = safeCall(() => EQ.getAlertsCenter({}).data, null);

  return {
    dashboard,
    fleet_costs: fleetCosts,
    productivity_comparison: productivityComparison,
    alerts_summary: alerts ? { count: alerts.count, by_severity: alerts.by_severity } : null,
    equipment_count: equipmentList.length,
    equipment_list_brief: equipmentList.slice(0, 200).map(e => ({
      id: e.id, code: e.code, name: e.name, category: e.category, type: e.type,
      status: e.status, total_operating_hours: e.total_operating_hours,
    })),
  };
}

// =====================================================================
// ===================== 2) الذكاء الاصطناعي — دوال التحليل =====================
// =====================================================================

/**
 * التنبؤ بالأعطال قبل حدوثها بالاعتماد على بيانات التشغيل والصيانة الفعلية
 * لمعدة واحدة (سجل الأعطال السابق، ساعات التشغيل، فجوات الصيانة الدورية).
 */
async function predictEquipmentFailures(equipmentId) {
  requireAI();
  const profile = collectEquipmentAIProfile(equipmentId);
  const question = `بناءً على بيانات التشغيل والصيانة الفعلية التالية لهذه المعدة (ساعات التشغيل، سجل الأعطال
والصيانة، معدل الاستهلاك)، قيّم احتمال حدوث عطل خلال الفترة القادمة، وحدد الأعراض المبكرة التي يجب
مراقبتها والمكوّن الأكثر عرضة للعطل، مع درجة ثقة تقديرية (منخفضة/متوسطة/عالية).`;
  const result = await AI.answerEngineeringQuestion({ question, context: JSON.stringify(profile) });
  return { success: true, equipment_id: equipmentId, prediction: result.answer };
}

/**
 * تنبؤ على مستوى الأسطول بالكامل: أكثر المعدات عرضة للعطل القادم، مرتبة حسب
 * الخطورة، بناءً على معدل الأعطال (fault_rate_per_100h) وبيانات التنبيهات الفعلية.
 */
async function predictFleetFailureRisk({ projectId = null } = {}) {
  requireAI();
  const fleetProfile = collectFleetAIProfile({ projectId });
  const question = `لديك ملخص أسطول المعدات التالي (مقارنة إنتاجية تتضمن معدل الأعطال لكل 100 ساعة تشغيل،
وتنبيهات نشطة). رتّب أعلى 5 معدات عرضة لعطل قريب مع السبب المرجَّح لكل منها، واقترح إجراء وقائي محدد لكل معدة.`;
  const result = await AI.answerEngineeringQuestion({ question, context: JSON.stringify(fleetProfile) });
  return { success: true, project_id: projectId, prediction: result.answer };
}

/**
 * تحليل استهلاك الوقود لمعدة واحدة واكتشاف الأنماط غير الطبيعية (يعتمد فعلياً
 * على سجلات الاستهلاك abnormal_consumption_entries المحتسبة في EQ.getFuelStats).
 */
async function analyzeFuelConsumptionPatterns(equipmentId) {
  requireAI();
  const fuelStats = EQ.getFuelStats(equipmentId, { period: 'all' }).data;
  const fuelLogs = EQ.listFuelLogs({ equipmentId }).data
    .sort((a, b) => (b.filled_at || '').localeCompare(a.filled_at || ''))
    .slice(0, 90);
  const question = `حلّل بيانات استهلاك الوقود التالية لهذه المعدة (إحصائيات مجمّعة + سجل آخر عمليات التعبئة).
اذكر الأنماط غير الطبيعية إن وُجدت، والأسباب المحتملة (تسريب، سرقة، سوء تشغيل، عطل ميكانيكي)، وتوصية عملية.`;
  const result = await AI.answerEngineeringQuestion({
    question, context: JSON.stringify({ fuel_stats: fuelStats, recent_fuel_logs: fuelLogs }),
  });
  return { success: true, equipment_id: equipmentId, analysis: result.answer };
}

/**
 * اقتراح أفضل مواعيد الصيانة الوقائية القادمة لمعدة واحدة، بالاعتماد على
 * جداول الصيانة الدورية الفعلية وساعات التشغيل المتراكمة والتنبيهات القائمة.
 */
async function suggestPreventiveMaintenanceSchedule(equipmentId) {
  requireAI();
  const equipment = EQ.getEquipment(equipmentId).data;
  const schedules = EQ.listMaintenanceSchedules({ equipmentId }).data;
  const maintenanceStats = safeCall(() => EQ.getMaintenanceStats(equipmentId).data, null);
  const upcomingAlerts = EQ.getUpcomingMaintenanceAlerts({ withinDays: 60 }).data
    .filter(a => a.equipment_id === equipmentId);
  const question = `بناءً على جداول الصيانة الدورية الحالية لهذه المعدة وساعات تشغيلها المتراكمة وسجل أعطالها،
اقترح جدولاً زمنياً محدداً (تواريخ أو عتبات ساعات تشغيل) لأفضل مواعيد الصيانة الوقائية القادمة، مع تبرير كل موعد.`;
  const result = await AI.answerEngineeringQuestion({
    question,
    context: JSON.stringify({
      equipment: { name: equipment.name, code: equipment.code, total_operating_hours: equipment.total_operating_hours },
      current_schedules: schedules, maintenance_stats: maintenanceStats, upcoming_alerts: upcomingAlerts,
    }),
  });
  return { success: true, equipment_id: equipmentId, suggested_schedule: result.answer };
}

/**
 * تحليل كفاءة معدة واحدة ومقارنتها بالمعدات المماثلة (نفس النوع)، بالاعتماد
 * على EQ.compareEquipmentProductivity الفعلية.
 */
async function analyzeEquipmentEfficiencyVsPeers(equipmentId) {
  requireAI();
  const equipment = EQ.getEquipment(equipmentId).data;
  const productivity = EQ.getEquipmentProductivity(equipmentId).data;
  const peers = EQ.compareEquipmentProductivity({ type: equipment.type }).data;
  const question = `قارن كفاءة تشغيل هذه المعدة (نسبة الاستغلال، الكفاءة التشغيلية، معدل الأعطال) بمتوسط
أداء المعدات المماثلة لها من نفس النوع. حدد إن كانت هذه المعدة أعلى أو أقل من المتوسط، ولماذا، وما التوصية
(استمرار/صيانة إضافية/استبدال).`;
  const result = await AI.answerEngineeringQuestion({
    question, context: JSON.stringify({ this_equipment_productivity: productivity, peer_group_comparison: peers }),
  });
  return { success: true, equipment_id: equipmentId, comparison_analysis: result.answer };
}

/**
 * اقتراح توزيع المعدات المتاحة على المشاريع لتحقيق أعلى إنتاجية، بالاعتماد
 * على حالة المعدات الفعلية (متاحة/عاملة) ولوحة معلومات المشاريع الحقيقية (PM).
 */
async function suggestFleetAllocation() {
  requireAI();
  const equipmentList = EQ.listEquipment({}).data;
  const availableEquipment = equipmentList.filter(e => e.status === 'available');
  const projects = safeCall(() => PM.listProjects({ pageSize: 500 }).items, [])
    .filter(p => p.status === 'active' || p.status === 'in_progress')
    .map(p => ({ id: p.id, name: p.name, status: p.status, progress_percent: p.progress_percent }));
  const question = `لديك قائمة المعدات المتاحة حالياً (غير مخصَّصة لأي مشروع) وقائمة المشاريع النشطة التالية.
اقترح توزيعاً منطقياً لكل معدة متاحة على المشروع الأنسب لها بناءً على نوع المعدة وحالة المشروع، مع تبرير مختصر
لكل اقتراح. إن لم تكن هناك معلومات كافية لمشروع معيّن، اذكر ذلك بوضوح بدل الافتراض.`;
  const result = await AI.answerEngineeringQuestion({
    question, context: JSON.stringify({ available_equipment: availableEquipment, active_projects: projects }),
  });
  return { success: true, allocation_suggestion: result.answer };
}

/**
 * تقدير تكلفة التشغيل المستقبلية لمعدة واحدة خلال أفق زمني مستقبلي، بناءً على
 * متوسط التكلفة الفعلية للساعة والاتجاه الحالي في التكاليف المسجَّلة.
 */
async function estimateFutureOperatingCost(equipmentId, { horizonMonths = 3 } = {}) {
  requireAI();
  const costBreakdown = EQ.getEquipmentCostBreakdown(equipmentId).data;
  const operationStats = safeCall(() => EQ.getOperationStats(equipmentId, { period: 'month' }).data, null);
  const question = `بناءً على التكلفة الفعلية الحالية لهذه المعدة (تفصيل التكاليف وساعات التشغيل الشهرية)، قدّر
تكلفة التشغيل المتوقعة خلال ${horizonMonths} أشهر قادمة، مع ذكر الافتراضات (مثل استمرار نفس معدل التشغيل)
وأي عوامل قد ترفع أو تخفض هذا التقدير.`;
  const result = await AI.answerEngineeringQuestion({
    question, context: JSON.stringify({ cost_breakdown: costBreakdown, monthly_operation_stats: operationStats }),
  });
  return { success: true, equipment_id: equipmentId, horizon_months: horizonMonths, cost_estimate: result.answer };
}

/**
 * إصدار تنبيهات استباقية إضافية (تُكمِّل مركز التنبيهات القاعدي في
 * equipmentManagement.js) عند انخفاض الكفاءة عن حد معيّن أو ازدياد الأعطال،
 * بتحليل نصي يوضح السبب الجذري والإجراء المقترح لكل حالة تتجاوز الحدود.
 */
async function generateProactiveEfficiencyAlerts({ efficiencyThresholdPercent = 60 } = {}) {
  requireAI();
  const comparison = EQ.compareEquipmentProductivity({}).data;
  const belowThreshold = (comparison.items || []).filter(i => i.operating_efficiency_percent < efficiencyThresholdPercent);
  if (!belowThreshold.length) {
    return { success: true, data: { count: 0, items: [], note: 'لا توجد معدات أقل من حد الكفاءة المحدد حالياً.' } };
  }
  const question = `المعدات التالية أداؤها التشغيلي أقل من ${efficiencyThresholdPercent}% كفاءة. لكل معدة، اذكر
السبب الجذري المحتمل بإيجاز (بند واحد) والإجراء الفوري المقترح (بند واحد). أجب بصيغة قائمة مختصرة منظمة لكل معدة.`;
  const result = await AI.answerEngineeringQuestion({ question, context: JSON.stringify(belowThreshold) });
  return {
    success: true,
    data: { count: belowThreshold.length, items: belowThreshold, analysis: result.answer },
  };
}

/**
 * إنشاء تقرير تحليلي وملخص تنفيذي تلقائي شامل لحالة الأسطول بالكامل، يجمع
 * بين لوحة المعلومات الفعلية (EQ.getBasicDashboard) وتحليل نصي من الذكاء
 * الاصطناعي (وليس رقماً/ملخصاً وهمياً).
 */
async function generateFleetAnalyticalSummary({ projectId = null } = {}) {
  requireAI();
  const fleetProfile = collectFleetAIProfile({ projectId });
  const question = `اكتب ملخصاً تنفيذياً موجزاً (فقرة واحدة) لحالة أسطول المعدات التالي، يبرز: الحالة العامة،
أبرز 3 مخاطر أو نقاط ضعف، وأهم توصية عملية واحدة للإدارة.`;
  const result = await AI.answerEngineeringQuestion({ question, context: JSON.stringify(fleetProfile) });
  return { success: true, project_id: projectId, dashboard: fleetProfile.dashboard, executive_summary: result.answer };
}

/**
 * مساعد أسئلة حرة عن حالة المعدات (دردشة هندسية عامة)، يُغذَّى بلقطة تكامل
 * حيّة (equipmentIntegrationSnapshot) بدل الاعتماد فقط على معرفة النموذج العامة.
 */
async function askEquipmentAssistant(question, { equipmentId = null, projectId = null } = {}) {
  requireAI();
  if (!question || !String(question).trim()) throw new Error('السؤال مطلوب');
  const context = equipmentId
    ? collectEquipmentAIProfile(equipmentId)
    : equipmentIntegrationSnapshot({ projectId });
  const result = await AI.answerEngineeringQuestion({ question: String(question).trim(), context: JSON.stringify(context) });
  return { success: true, answer: result.answer };
}

// =====================================================================
// ===================== 3) التكامل مع بقية النظام =====================
// =====================================================================

/**
 * لقطة تكامل حيّة موحّدة لقسم المعدات: تُستعلَم مباشرة (وليست بيانات مخزَّنة)
 * من equipmentManagement.js عند كل استدعاء، مع إثراء بيانات كل مشروع نشط
 * فعلياً باسمه من إدارة المشاريع (PM) بدل الاكتفاء بمعرّف المشروع الخام.
 */
function equipmentIntegrationSnapshot({ projectId = null } = {}) {
  const dashboard = EQ.getBasicDashboard(projectId).data;
  const fleetCosts = safeCall(() => EQ.getFleetCostSummary({ projectId }).data, null);
  const alerts = safeCall(() => EQ.getAlertsCenter({}).data, null);
  const productivityComparison = safeCall(() => EQ.compareEquipmentProductivity({}).data, null);

  const equipmentByProject = {};
  for (const e of EQ.listEquipment({}).data) {
    if (!e.current_project_id) continue;
    if (!equipmentByProject[e.current_project_id]) equipmentByProject[e.current_project_id] = [];
    equipmentByProject[e.current_project_id].push({ id: e.id, code: e.code, name: e.name, status: e.status });
  }
  const projectsWithEquipment = Object.entries(equipmentByProject).map(([pid, items]) => {
    const project = safeCall(() => PM.getProject(pid, { includeRelations: false }), null);
    return { project_id: pid, project_name: project ? project.name : null, equipment_count: items.length, equipment: items };
  });

  return {
    generated_at: new Date().toISOString(),
    dashboard,
    fleet_costs: fleetCosts,
    alerts_summary: alerts ? { count: alerts.count, by_severity: alerts.by_severity, top_alerts: alerts.alerts.slice(0, 10) } : null,
    productivity_summary: productivityComparison
      ? { average_efficiency_percent: productivityComparison.average_efficiency_percent, count: productivityComparison.count }
      : null,
    projects_with_equipment: projectsWithEquipment,
  };
}

/**
 * مزامنة فعلية بين حالة تشغيل المعدة وحالة استخدامها بالمشروع: يتحقق فعلياً
 * من وجود المشروع في إدارة المشاريع (PM) قبل ربط المعدة به، بدل قبول أي
 * معرّف نصي عشوائي (كما هو معمول به في التحقق من الكيانات في باقي أقسام النظام).
 */
function assertProjectExistsForEquipment(projectId) {
  if (!projectId) return null;
  try {
    return PM.getProject(projectId, { includeRelations: false });
  } catch (e) {
    throw new Error('المشروع المرتبط بالمعدة غير موجود في نظام إدارة المشاريع');
  }
}

/**
 * عند تسجيل عطل طارئ حرج الخطورة على معدة، يُنشئ هذا الإجراء فعلياً مهمة
 * إصلاح في وحدة المهام (BIZO.createTask) بدل ترك العطل سجلاً معزولاً، بحيث
 * تظهر مهمة الإصلاح ضمن لوحة تحكم المهام العامة للمتابعة الفعلية.
 */
function createRepairTaskForCriticalFault({ equipmentId, maintenanceRecordId, faultDescription, assigneeId = null }) {
  const equipment = EQ.getEquipment(equipmentId).data;
  const task = BIZO.createTask({
    title: `إصلاح عاجل: ${equipment.name} (${equipment.code})`,
    description: `عطل حرج مسجَّل على المعدة رقم ${equipment.code}. الوصف: ${faultDescription || '—'}. سجل الصيانة: ${maintenanceRecordId}`,
    priority: 'urgent',
    project_id: equipment.current_project_id || null,
    assignee_id: assigneeId,
  });
  return { success: true, data: { equipment_id: equipmentId, maintenance_record_id: maintenanceRecordId, task: task.data || task } };
}

/**
 * تسجيل عطل طارئ مع الربط التلقائي بالتكامل: يستدعي فعلياً
 * EQ.createMaintenanceRecord (دون تكرار منطقها)، ثم إن كانت الخطورة "حرجة"
 * (critical) يُنشئ تلقائياً مهمة إصلاح عبر createRepairTaskForCriticalFault
 * بدل تركها مجرد سجل نصي، تحقيقاً لمتطلب "التكامل" الفعلي المطلوب بالمواصفة.
 */
function logCriticalFaultWithIntegration(body) {
  const record = EQ.createMaintenanceRecord({ ...body, maintenance_type: 'emergency' });
  const created = record.data || record;
  let linkedTask = null;
  if (created.severity === 'critical') {
    linkedTask = createRepairTaskForCriticalFault({
      equipmentId: created.equipment_id,
      maintenanceRecordId: created.id,
      faultDescription: created.fault_description,
      assigneeId: body.assignee_id || null,
    }).data;
  }
  return { success: true, data: { maintenance_record: created, linked_repair_task: linkedTask } };
}

// =====================================================================
// ===================== 4) الصلاحيات المتقدمة =====================
// =====================================================================
// توسعة أدوار قسم المعدات ضمن نظام RBAC المركزي في businessSecurity.js
// (بدل بناء نظام صلاحيات منفصل)، مطابقة تماماً لقائمة الأدوار المطلوبة في
// مواصفة القسم السابع: مدير النظام / مدير المشروع / مدير المعدات / مهندس
// الموقع / مسؤول الصيانة / أمين المخزن / المشغل / المحاسب / العميل (عرض فقط).

const EQUIPMENT_ROLE_DEFINITIONS = {
  equipment_manager: {
    label: 'مدير المعدات',
    permissions: {
      equipment: ['view', 'create', 'update', 'delete', 'manage'],
      dashboard: ['view'], reports: ['view', 'export'], ai: ['use'],
    },
  },
  site_engineer: {
    label: 'مهندس الموقع',
    permissions: {
      equipment: ['view', 'create', 'update'], dashboard: ['view'], reports: ['view'],
    },
  },
  maintenance_officer: {
    label: 'مسؤول الصيانة',
    permissions: {
      equipment: ['view', 'update', 'maintenance'], dashboard: ['view'], reports: ['view'],
    },
  },
  warehouse_keeper: {
    label: 'أمين المخزن',
    permissions: {
      equipment: ['view', 'spare_parts'], dashboard: ['view'],
    },
  },
  equipment_operator: {
    label: 'المشغل',
    permissions: {
      equipment: ['view', 'operate'],
    },
  },
};

/**
 * يزرع أدوار قسم المعدات ضمن جدول الأدوار المركزي دون حذف أو الكتابة فوق
 * أدوار موجودة مسبقاً بنفس المفتاح (upsert فقط عند عدم الوجود)، ودون التأثير
 * على أدوار الأقسام الأخرى (project_manager / accountant / client_viewer
 * المشتركة أصلاً معرَّفة في businessSecurity.js لقسم إدارة الأعمال وتُستخدَم
 * كما هي هنا أيضاً لتفادي ازدواجية الأدوار).
 */
function ensureEquipmentRolesSeeded() {
  const existingRoles = SEC.listRoles().data.map(r => r.key);
  for (const [key, def] of Object.entries(EQUIPMENT_ROLE_DEFINITIONS)) {
    if (!existingRoles.includes(key)) {
      SEC.upsertRole(key, def);
    }
  }
  return { success: true, data: { seeded_roles: Object.keys(EQUIPMENT_ROLE_DEFINITIONS) } };
}

/**
 * دالة تحقق مخصصة لصلاحيات قسم المعدات، تُستخدم في مسارات server.js الجديدة
 * دون تكرار منطق roleCan (تُنادي SEC.can مباشرة بنفس التوقيع المستخدَم في
 * requirePermission الحالية بالخادم).
 */
function equipmentCan(token, action) {
  return SEC.can(token, 'equipment', action);
}

module.exports = {
  // ذكاء اصطناعي
  isAIAvailable,
  predictEquipmentFailures,
  predictFleetFailureRisk,
  analyzeFuelConsumptionPatterns,
  suggestPreventiveMaintenanceSchedule,
  analyzeEquipmentEfficiencyVsPeers,
  suggestFleetAllocation,
  estimateFutureOperatingCost,
  generateProactiveEfficiencyAlerts,
  generateFleetAnalyticalSummary,
  askEquipmentAssistant,

  // تكامل
  equipmentIntegrationSnapshot,
  assertProjectExistsForEquipment,
  createRepairTaskForCriticalFault,
  logCriticalFaultWithIntegration,

  // صلاحيات متقدمة
  EQUIPMENT_ROLE_DEFINITIONS,
  ensureEquipmentRolesSeeded,
  equipmentCan,
};
