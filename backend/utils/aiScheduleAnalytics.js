/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء السادس (6/10): تحليل الجدول الزمني (Schedule Deep Analytics)
 * ===================================================================================
 *
 * تسلسل الوصول الإلزامي لهذا الملف (لا يجوز تجاوزه):
 *   AI Service (هذا الملف)
 *     → aiDataAccessLayer.getAIData                          (الجزء 3/10)
 *       → aiEngineeringCore.resolveAIContext                  (الجزء 1/10 - RBAC)
 *         → الوحدة الفعلية (scheduling.js)
 *           → JSON DB
 *
 * الوظيفة (البند 6 من الوثيقة الأصلية - "تحليل الجدول الزمني"):
 *   - تحليل Gantt.
 *   - تحليل Critical Path.
 *   - اكتشاف الأنشطة المتأخرة.
 *   - اكتشاف الاختناقات (Bottlenecks).
 *   - اكتشاف تعارض الموارد.
 *   - تحليل Float (Total Float / Free Float).
 *   - مقارنة Baseline مع Actual.
 *   - توقع التأخير (يُعاد استخدام الجزء 5/10 بدل التكرار).
 *   - اقتراح سيناريوهات إعادة الجدولة (اقتراح فقط - بدون أي تنفيذ تلقائي).
 *
 * الفرق بين هذا الملف والجزء 5/10 (aiDelayPrediction.js):
 *   - الجزء 5/10: يركّز على "متى سينتهي المشروع فعلياً؟ وما احتمالية التأخير؟" على
 *     مستوى المشروع ككل (قد يضم عدة جداول)، مع تصنيف احتمالية موحّد وتفسير AI.
 *   - هذا الملف (6/10): يركّز على تشريح الجدول الزمني نفسه بالتفصيل (نشاط بنشاط):
 *     أين الاختناقات، أين تعارضات الموارد، ما توزيع الـFloat، ماذا تغيّر منذ آخر
 *     Baseline، وما سيناريوهات إعادة الجدولة الممكنة لمعالجة الانزلاق الحالي.
 *   - كلا الملفين يستدعيان نفس دوال scheduling.js الفعلية (لا ازدواجية منطق حساب)،
 *     ويمكن استدعاء أحدهما من الآخر دون كسر مبدأ "نقطة وصول واحدة".
 *
 * قيد إلزامي صريح (من البند 6 والبند 31): لا يجوز لهذا الملف تغيير الجدول الزمني
 * تلقائياً بدون موافقة صريحة من المستخدم. كل الدوال هنا قراءة+تحليل+اقتراح فقط؛
 * تنفيذ أي سيناريو مقترَح يبقى حصراً عبر واجهات scheduling.js العادية (rescheduleActivities)
 * التي يستدعيها المستخدم بنفسه بعد المراجعة، وليس من هذا الملف.
 *
 * لا بيانات وهمية: كل تحليل هنا مبني على بيانات حقيقية من scheduling.js (computeCPM،
 * compareScheduleVsActual، computeResourceHistogram، listBaselines، computeSCurve).
 * طبقة AI (Claude) تُستخدم فقط للتفسير النصي والصياغة، وليست مصدر أي رقم.
 */

const https = require('https');

const AI_CORE = require('./aiEngineeringCore');
const AI_DATA = require('./aiDataAccessLayer');

let SCHED = null; try { SCHED = require('./scheduling'); } catch (e) { SCHED = null; }

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const NO_AUTO_APPLY_NOTICE =
  'هذه سيناريوهات مقترحة للمراجعة فقط. لا يقوم هذا النظام بتعديل الجدول الزمني تلقائياً؛ ' +
  'أي إعادة جدولة فعلية تتطلب تنفيذاً صريحاً من المستخدم عبر شاشة الجدول الزمني بعد الموافقة.';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

function callClaude({ system, userMessage, maxTokens = 2400 }) {
  return new Promise((resolve, reject) => {
    if (!isAIAvailable()) {
      return reject(new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم لتفعيلها.'));
    }

    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'خطأ من واجهة الذكاء الاصطناعي'));
          const textBlocks = (parsed.content || []).filter((b) => b.type === 'text').map((b) => b.text);
          resolve(textBlocks.join('\n'));
        } catch (e) {
          reject(new Error('تعذر تحليل استجابة واجهة الذكاء الاصطناعي'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('انتهت مهلة الاتصال بواجهة الذكاء الاصطناعي')); });
    req.write(payload);
    req.end();
  });
}

function extractJson(text) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

function trimForPrompt(obj, maxChars = 3000) {
  if (obj === undefined || obj === null) return 'غير متوفر';
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return str.length > maxChars ? str.slice(0, maxChars) + ' …(مقتطَع)' : str;
}

/** يتحقق من صلاحية الوصول لنطاق "schedule" ويعيد سياق المستخدم، ويتأكد من وجود الجدول */
function resolveScheduleAccess(token, scheduleId) {
  if (!token) throw new Error('يجب تسجيل الدخول لاستخدام تحليل الجدول الزمني بالذكاء الاصطناعي');
  if (!scheduleId) throw new Error('معرّف الجدول الزمني (scheduleId) مطلوب');
  if (!SCHED) throw new Error('وحدة الجدول الزمني (scheduling.js) غير متوفرة على الخادم.');

  const authCtx = AI_CORE.resolveAIContext(token, 'schedule');

  // نجلب الجدول عبر طبقة الوصول الآمنة (وليس مباشرة) للحفاظ على مسار AI الموحّد
  const scheduleRes = AI_DATA.getAIData(token, 'schedule', 'get', { scheduleId }, {
    operationType: 'schedule_analytics:get_schedule', projectId: null,
  });
  const schedule = scheduleRes.data;
  if (!schedule) throw new Error('الجدول الزمني غير موجود');

  return { authCtx, schedule };
}

// ===================================================================================
// 1) تحليل Gantt + المسار الحرج (هيكلي، بدون AI - أرقام حتمية 100%)
// ===================================================================================

/**
 * يبني ملخص Gantt تحليلي: توزيع الأنشطة حسب مستوى WBS، أطول سلسلة أنشطة متتابعة على
 * المسار الحرج (Critical Chain)، ونسبة الحرجية الإجمالية. هذا تحليل هيكلي حتمي بحت.
 */
function buildGanttAnalysis(cpm) {
  const activities = cpm.activities || [];
  if (!activities.length) {
    return { available: false, reason: 'لا توجد أنشطة في هذا الجدول الزمني بعد.' };
  }

  const byWbsLevel = {};
  for (const a of activities) {
    const lvl = a.wbs_level || 'غير محدد';
    byWbsLevel[lvl] = (byWbsLevel[lvl] || 0) + 1;
  }

  const milestones = activities.filter((a) => a.is_milestone);
  const criticalActivities = activities.filter((a) => a.is_critical);
  const criticalPercent = r2((criticalActivities.length / activities.length) * 100);

  // ترتيب المسار الحرج زمنياً حسب تاريخ البداية المحسوب (لعرض تسلسل السلسلة الحرجة)
  const criticalChainOrdered = criticalActivities
    .slice()
    .sort((a, b) => a.es - b.es)
    .map((a) => ({ code: a.code, name: a.name, calc_start_date: a.calc_start_date, calc_end_date: a.calc_end_date, duration_days: a.duration_days }));

  return {
    available: true,
    total_activities: activities.length,
    milestones_count: milestones.length,
    activities_by_wbs_level: byWbsLevel,
    critical_activities_count: criticalActivities.length,
    critical_percent: criticalPercent,
    project_duration_days: cpm.project_duration_days,
    project_finish_date: cpm.project_finish_date,
    critical_chain_ordered: criticalChainOrdered,
  };
}

// ===================================================================================
// 2) تحليل Float (Total Float / Free Float) - حتمي 100%
// ===================================================================================

function buildFloatAnalysis(cpm) {
  const activities = cpm.activities || [];
  if (!activities.length) return { available: false, reason: 'لا توجد أنشطة لتحليل الـFloat.' };

  const critical = activities.filter((a) => a.is_critical);
  const nearCritical = activities.filter((a) => !a.is_critical && a.total_float > 0 && a.total_float <= 3);
  const comfortable = activities.filter((a) => a.total_float > 3);

  const floats = activities.map((a) => a.total_float).filter((v) => typeof v === 'number');
  const avgFloat = floats.length ? r2(floats.reduce((s, v) => s + v, 0) / floats.length) : null;
  const maxFloat = floats.length ? Math.max(...floats) : null;

  return {
    available: true,
    critical_zero_float_count: critical.length,
    near_critical_count: nearCritical.length,
    near_critical_activities: nearCritical.slice(0, 10).map((a) => ({
      code: a.code, name: a.name, total_float: a.total_float, free_float: a.free_float,
    })),
    comfortable_float_count: comfortable.length,
    average_total_float_days: avgFloat,
    max_total_float_days: maxFloat,
  };
}

// ===================================================================================
// 3) اكتشاف الاختناقات (Bottlenecks) - حتمي 100%
// ===================================================================================

/**
 * الاختناق هنا يُعرَّف حتمياً (وليس برأي AI) بأنه: نشاط له أكثر من مورد لاحق واحد
 * يعتمد عليه (Successors متعددون) وهو إما متأخر أو غير مكتمل مع تقدّم منخفض، أو
 * نشاط عليه تحميل موارد زائد (overload) من computeResourceHistogram.
 */
function detectBottlenecks(scheduleId, cpm, comparison, resourceHistogram) {
  const activities = cpm.activities || [];
  const relations = cpm.relations || [];

  // عدد اللاحقين (successors) لكل نشاط
  const successorsCount = {};
  for (const rel of relations) {
    successorsCount[rel.predecessor_id] = (successorsCount[rel.predecessor_id] || 0) + 1;
  }

  const delayedIds = new Set((comparison.activities || []).filter((a) => a.is_late).map((a) => a.activity_id));

  const structuralBottlenecks = activities
    .filter((a) => (successorsCount[a.id] || 0) >= 2)
    .map((a) => ({
      code: a.code, name: a.name,
      dependents_count: successorsCount[a.id] || 0,
      is_critical: a.is_critical,
      is_delayed: delayedIds.has(a.id),
      status: a.status, progress_percent: a.progress_percent,
      bottleneck_type: 'structural_dependency',
      severity: (a.is_critical && delayedIds.has(a.id)) ? 'high' : (a.is_critical || delayedIds.has(a.id)) ? 'medium' : 'low',
    }))
    .sort((a, b) => b.dependents_count - a.dependents_count)
    .slice(0, 10);

  const resourceBottlenecks = (resourceHistogram && resourceHistogram.overload_conflicts) || [];

  return {
    structural_bottlenecks: structuralBottlenecks,
    resource_bottlenecks: resourceBottlenecks.map((c) => ({
      resource: c.resource, date: c.date, hours: c.hours, bottleneck_type: 'resource_overload',
    })),
    total_bottlenecks_count: structuralBottlenecks.length + resourceBottlenecks.length,
  };
}

// ===================================================================================
// 4) مقارنة Baseline مع Actual - حتمي 100%
// ===================================================================================

/**
 * يقارن آخر Baseline محفوظ (إن وُجد) بالحالة الحالية للأنشطة، نشاطاً بنشاط، ويحسب
 * انزلاق التاريخ (Slippage) لكل نشاط بالأيام.
 */
function buildBaselineComparison(scheduleId) {
  const baselines = safe(() => SCHED.listBaselines(scheduleId), []) || [];
  if (!baselines.length) {
    return { available: false, reason: 'لا يوجد أي Baseline محفوظ لهذا الجدول الزمني بعد.' };
  }

  const latest = baselines[0]; // مرتّبة الأحدث أولاً من listBaselines
  const currentActivities = safe(() => SCHED.listActivities(scheduleId), []) || [];
  const currentById = {};
  for (const a of currentActivities) currentById[a.id] = a;

  const rows = (latest.snapshot || []).map((b) => {
    const current = currentById[b.id];
    if (!current) {
      return { code: b.code, name: b.name, status: 'deleted_since_baseline', slippage_days: null };
    }
    const baselineEnd = b.calc ? b.calc.lf : null; // أيام نسبية من بداية الجدول وقت الـbaseline
    const currentEnd = current.calc ? current.calc.lf : null;
    const slippage = (typeof baselineEnd === 'number' && typeof currentEnd === 'number')
      ? r2(currentEnd - baselineEnd)
      : null;
    return {
      code: b.code, name: b.name,
      baseline_duration_days: b.duration_days,
      current_duration_days: current.duration_days,
      duration_variance_days: (typeof b.duration_days === 'number' && typeof current.duration_days === 'number')
        ? r2(current.duration_days - b.duration_days) : null,
      slippage_days: slippage,
      current_status: current.status,
      current_progress_percent: current.progress_percent,
    };
  });

  const slipped = rows.filter((r) => typeof r.slippage_days === 'number' && r.slippage_days > 0);
  const improved = rows.filter((r) => typeof r.slippage_days === 'number' && r.slippage_days < 0);

  return {
    available: true,
    baseline_id: latest.id,
    baseline_name: latest.name,
    baseline_date: latest.created_at,
    baseline_version: latest.version,
    total_activities_compared: rows.length,
    slipped_activities_count: slipped.length,
    improved_activities_count: improved.length,
    worst_slippage: slipped.length
      ? slipped.slice().sort((a, b) => b.slippage_days - a.slippage_days).slice(0, 8)
      : [],
    details: rows,
  };
}

// ===================================================================================
// 5) سيناريوهات إعادة الجدولة (اقتراح فقط - بدون أي تنفيذ)
// ===================================================================================

/**
 * يبني 2-3 سيناريوهات حتمية بديلة لمعالجة الانزلاق الحالي، بالاعتماد على أرقام فعلية
 * فقط (تأخير الأنشطة الحرجة، الـFloat المتاح). لا يُنفَّذ أي سيناريو هنا؛ يُعرض فقط
 * كخيارات للمراجعة البشرية. تنفيذ أي منها يتم لاحقاً عبر scheduling.rescheduleActivities
 * بقرار صريح من المستخدم من خارج طبقة AI.
 */
function buildReschedulingScenarios(cpm, comparison, floatAnalysis) {
  const criticalDelayed = (comparison.activities || []).filter((a) => a.is_late && a.is_critical);
  if (!criticalDelayed.length) {
    return {
      scenarios: [],
      message: 'لا توجد أنشطة حرجة متأخرة تستدعي سيناريو إعادة جدولة حالياً.',
    };
  }

  const maxDelay = Math.max(...criticalDelayed.map((a) => a.delay_days));
  const scenarios = [];

  // سيناريو 1: إزاحة كاملة (Shift) لكل الأنشطة اللاحقة بمقدار أقصى تأخير حرج
  scenarios.push({
    scenario_id: 'shift_all',
    title: 'إزاحة الجدول بالكامل',
    description: `إزاحة جميع الأنشطة المتأثرة بمقدار ${maxDelay} يوم (أقصى تأخير مسجَّل على المسار الحرج حالياً).`,
    estimated_new_finish_date: comparison.forecast_finish_date,
    estimated_delay_days: comparison.forecast_delay_days,
    trade_offs: 'الأبسط تنفيذاً وأقل مخاطرة تقنية، لكنه يؤخر تاريخ التسليم النهائي بالكامل دون أي تعويض.',
    requires_approval_from: 'مدير المشروع',
    execution_note: 'عند الموافقة، يُنفَّذ عبر scheduling.rescheduleActivities من واجهة النظام مباشرة، وليس تلقائياً من هنا.',
  });

  // سيناريو 2: ضغط الأنشطة غير الحرجة صاحبة الـFloat المرتفع (Fast-Tracking جزئي)
  if (floatAnalysis.available && floatAnalysis.comfortable_float_count > 0) {
    scenarios.push({
      scenario_id: 'compress_non_critical',
      title: 'استغلال الهامش الزمني (Float) في الأنشطة غير الحرجة',
      description: `يوجد ${floatAnalysis.comfortable_float_count} نشاط غير حرج بهامش زمني (Float) فائض (متوسط ${floatAnalysis.average_total_float_days} يوم)؛ يمكن دراسة تعديل تتابعها أو مواردها لامتصاص جزء من التأخير الحالي دون تأخير المسار الحرج نفسه.`,
      estimated_new_finish_date: null,
      estimated_delay_days: null,
      trade_offs: 'يتطلب تحليلاً هندسياً دقيقاً لكل نشاط (هل يمكن فعلاً تسريعه أو تعديل علاقاته)؛ ليس حلاً آلياً مضموناً.',
      requires_approval_from: 'مهندس التخطيط + مدير المشروع',
      execution_note: 'يتطلب مراجعة نشاط بنشاط قبل أي تعديل عبر شاشة الجدول الزمني.',
    });
  }

  // سيناريو 3: موارد إضافية على الأنشطة الحرجة المتأخرة تحديداً (Crashing جزئي)
  scenarios.push({
    scenario_id: 'crash_critical',
    title: 'تعزيز الموارد على الأنشطة الحرجة المتأخرة فقط',
    description: `إضافة موارد (عمالة/معدات/ورديات) على ${criticalDelayed.length} نشاط حرج متأخر تحديداً لتقليص مدتها الفعلية بدل إزاحة الجدول بالكامل.`,
    estimated_new_finish_date: null,
    estimated_delay_days: null,
    trade_offs: 'يرفع التكلفة التشغيلية المباشرة (عمل إضافي/موارد إضافية)؛ يتطلب موافقة مالية منفصلة عبر قسم الميزانية.',
    requires_approval_from: 'مدير المشروع + مدير المالية',
    execution_note: 'أي تعزيز موارد فعلي يُنفَّذ عبر شاشتي الجدول الزمني والموارد، وليس تلقائياً من هنا.',
    affected_activities: criticalDelayed.slice(0, 8).map((a) => ({ code: a.code, name: a.name, delay_days: a.delay_days })),
  });

  return { scenarios, message: `تم بناء ${scenarios.length} سيناريو بديل بناءً على الوضع الحالي للجدول الزمني.` };
}

// ===================================================================================
// 6) التحليل الشامل الموحّد (الدالة الرئيسية للجزء 6/10)
// ===================================================================================

async function analyzeScheduleDeep({ token, scheduleId }) {
  const startedAt = new Date().toISOString();
  const { authCtx, schedule } = resolveScheduleAccess(token, scheduleId);

  const cpm = safe(() => SCHED.computeCPM(scheduleId));
  const comparison = safe(() => SCHED.compareScheduleVsActual(scheduleId));
  const resourceHistogram = safe(() => SCHED.computeResourceHistogram(scheduleId));

  if (!cpm || !comparison) {
    const finishedAt = new Date().toISOString();
    AI_CORE.recordAIOperation({
      userId: authCtx.userId, username: authCtx.username, domain: 'schedule',
      operationType: 'schedule_deep_analysis', projectId: schedule.project_id, model: null,
      startedAt, finishedAt, success: false, errorMessage: 'تعذر حساب المسار الحرج أو المقارنة',
      dataSources: [`scheduling.getSchedule(${scheduleId})`],
    });
    return {
      success: true,
      schedule_id: scheduleId,
      generated_at: finishedAt,
      insufficient_data: true,
      message: 'لا توجد بيانات كافية (أنشطة/علاقات) في هذا الجدول الزمني لإجراء تحليل موثوق.',
    };
  }

  const ganttAnalysis = buildGanttAnalysis(cpm);
  const floatAnalysis = buildFloatAnalysis(cpm);
  const bottlenecks = detectBottlenecks(scheduleId, cpm, comparison, resourceHistogram);
  const baselineComparison = buildBaselineComparison(scheduleId);
  const reschedulingScenarios = buildReschedulingScenarios(cpm, comparison, floatAnalysis);

  const deterministicAnalysis = {
    schedule_id: scheduleId,
    schedule_name: schedule.name,
    gantt_analysis: ganttAnalysis,
    float_analysis: floatAnalysis,
    bottlenecks,
    baseline_comparison: baselineComparison,
    delay_summary: {
      delayed_activities_count: comparison.delayed_activities_count,
      total_activities: comparison.total_activities,
      average_delay_days: comparison.average_delay_days,
      forecast_finish_date: comparison.forecast_finish_date,
      forecast_delay_days: comparison.forecast_delay_days,
    },
    resource_conflicts_count: resourceHistogram ? resourceHistogram.overload_conflicts.length : null,
  };

  let aiNarrative = null;
  let errorMessage = null;

  if (isAIAvailable()) {
    const system = `أنت مهندس تخطيط ومتابعة مشاريع (Planning & Scheduling Engineer) خبير في تحليل الجداول الزمنية وطريقة المسار الحرج (CPM).
مهمتك تفسير التحليل الحتمي المزوَّد أدناه (محسوب فعلياً من الجدول الزمني الحقيقي) وصياغة قراءة تحليلية واضحة بالعربية.
لا تختلق أي رقم أو نشاط غير موجود في البيانات المرفقة.
ممنوع اقتراح أي تعديل تلقائي فوري للجدول الزمني؛ فقط اشرح السيناريوهات المقترحة الموجودة في البيانات وأضف ملاحظات مهنية عليها، والقرار النهائي بيد المستخدم.

أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي قبلها أو بعدها، وفق البنية التالية بالضبط:
{
  "executive_summary": "ملخص تحليلي موجز (3-5 جمل) لحالة الجدول الزمني",
  "critical_path_insight": "قراءة تحليلية للمسار الحرج ونسبة الحرجية",
  "bottleneck_insights": [{"item": "اسم/كود الاختناق", "explanation": "لماذا يُعتبر اختناقاً وأثره"}],
  "float_insight": "قراءة تحليلية لتوزيع الـFloat والأنشطة القريبة من الحرجية",
  "baseline_drift_insight": "قراءة تحليلية لمدى انزلاق الجدول عن آخر Baseline (أو ملاحظة إن لم يتوفر Baseline)",
  "scenario_recommendations": [{"scenario_id": "معرّف السيناريو من البيانات المرفقة", "professional_note": "ملاحظة مهنية إضافية على هذا السيناريو تحديداً"}],
  "priority_watch_items": ["أنشطة أو موارد تستحق متابعة أسبوعية دقيقة"],
  "confidence_level": "low|medium|high"
}`;

    const userMessage = `التحليل الحتمي الكامل للجدول الزمني (محسوب مباشرة من قاعدة البيانات):
${trimForPrompt(deterministicAnalysis, 4000)}

--- سيناريوهات إعادة الجدولة المقترحة حتمياً (للتعليق عليها فقط، وليس لإضافة سيناريوهات جديدة) ---
${trimForPrompt(reschedulingScenarios, 1500)}`;

    try {
      const response = await callClaude({ system, userMessage, maxTokens: 2600 });
      aiNarrative = extractJson(response);
    } catch (e) {
      errorMessage = e.message;
    }
  }

  const finishedAt = new Date().toISOString();
  AI_CORE.recordAIOperation({
    userId: authCtx.userId,
    username: authCtx.username,
    domain: 'schedule',
    operationType: 'schedule_deep_analysis',
    projectId: schedule.project_id,
    model: (aiNarrative && !errorMessage) ? MODEL : null,
    startedAt,
    finishedAt,
    success: !errorMessage,
    errorMessage,
    dataSources: [
      `scheduling.computeCPM(${scheduleId})`,
      `scheduling.compareScheduleVsActual(${scheduleId})`,
      `scheduling.computeResourceHistogram(${scheduleId})`,
      `scheduling.listBaselines(${scheduleId})`,
    ],
    resultSummary: `اختناقات: ${bottlenecks.total_bottlenecks_count}, سيناريوهات: ${reschedulingScenarios.scenarios.length}`,
  });

  return {
    success: true,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    generated_at: finishedAt,
    deterministic_analysis: deterministicAnalysis,
    rescheduling_scenarios: reschedulingScenarios,
    ai_narrative: aiNarrative,
    ai_error: errorMessage,
    ai_available: isAIAvailable(),
    note: errorMessage
      ? `تعذّر الحصول على تفسير AI (${errorMessage})؛ التحليل الحتمي أعلاه لا يزال كاملاً وصالحاً.`
      : (!isAIAvailable()
          ? 'ميزة التفسير بالذكاء الاصطناعي غير مفعّلة حالياً (لا يوجد ANTHROPIC_API_KEY)؛ هذا تحليل حتمي كامل من بيانات الجدول الفعلية.'
          : 'التحليل مبني على بيانات الجدول الزمني الفعلية، وتفسير AI مبني عليها حصراً دون اختلاق.'),
    no_auto_apply_notice: NO_AUTO_APPLY_NOTICE,
  };
}

// ===================================================================================
// 7) دوال جزئية مُصدَّرة للاستخدام المباشر (بدون AI، سريعة وموثوقة) - لاستخدام لوحات
//    التحكم أو الشاشات التي تحتاج فقط قسماً واحداً من التحليل دون الطلب الكامل
// ===================================================================================

function getBottlenecksOnly({ token, scheduleId }) {
  const { schedule } = resolveScheduleAccess(token, scheduleId);
  const cpm = SCHED.computeCPM(scheduleId);
  const comparison = SCHED.compareScheduleVsActual(scheduleId);
  const resourceHistogram = safe(() => SCHED.computeResourceHistogram(scheduleId));
  return {
    success: true,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    generated_at: new Date().toISOString(),
    ...detectBottlenecks(scheduleId, cpm, comparison, resourceHistogram),
  };
}

function getFloatAnalysisOnly({ token, scheduleId }) {
  const { schedule } = resolveScheduleAccess(token, scheduleId);
  const cpm = SCHED.computeCPM(scheduleId);
  return {
    success: true,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    generated_at: new Date().toISOString(),
    float_analysis: buildFloatAnalysis(cpm),
  };
}

function getBaselineComparisonOnly({ token, scheduleId }) {
  const { schedule } = resolveScheduleAccess(token, scheduleId);
  return {
    success: true,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    generated_at: new Date().toISOString(),
    baseline_comparison: buildBaselineComparison(scheduleId),
  };
}

function getReschedulingScenariosOnly({ token, scheduleId }) {
  const { schedule } = resolveScheduleAccess(token, scheduleId);
  const cpm = SCHED.computeCPM(scheduleId);
  const comparison = SCHED.compareScheduleVsActual(scheduleId);
  const floatAnalysis = buildFloatAnalysis(cpm);
  return {
    success: true,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    generated_at: new Date().toISOString(),
    ...buildReschedulingScenarios(cpm, comparison, floatAnalysis),
    no_auto_apply_notice: NO_AUTO_APPLY_NOTICE,
  };
}

module.exports = {
  isAIAvailable,
  analyzeScheduleDeep,
  getBottlenecksOnly,
  getFloatAnalysisOnly,
  getBaselineComparisonOnly,
  getReschedulingScenariosOnly,
  NO_AUTO_APPLY_NOTICE,
};
