/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الخامس (5/10): التنبؤ بتأخر المشاريع (Delay Prediction Intelligence)
 * ===================================================================================
 *
 * تسلسل الوصول الإلزامي لهذا الملف (لا يجوز تجاوزه):
 *   AI Service (هذا الملف)
 *     → aiDataAccessLayer.getAIData / getProjectSnapshot   (الجزء 3/10)
 *       → aiEngineeringCore.resolveAIContext                (الجزء 1/10 - RBAC)
 *         → الوحدات الفعلية (projectManagement / scheduling)
 *           → JSON DB
 *
 * الوظيفة (البند 5 من الوثيقة الأصلية):
 *   تحليل الأداء السابق + نسبة الإنجاز + الأنشطة المتأخرة + المسار الحرج + الموارد
 *   + الإنتاجية + المشاكل + المخاطر، ثم إعطاء:
 *     - احتمالية التأخير.
 *     - التاريخ المتوقع للانتهاء.
 *     - الأنشطة الأكثر تأثيراً.
 *     - أسباب التوقع.
 *     - الإجراءات المقترحة.
 *
 * لا بيانات وهمية: كل مؤشر رقمي هنا (SPI، متوسط التأخير، تباين المدة، تحميل الموارد،
 * إلخ) محسوب حتمياً من بيانات الجدول الزمني الحقيقية (عبر scheduling.js: computeCPM،
 * compareScheduleVsActual، computeSCurve، listBaselines، computeResourceHistogram)
 * قبل أي استدعاء لـ AI. طبقة AI تُستخدم فقط للتفسير والصياغة والتوصيات، وليست مصدر
 * الأرقام. إن لم توجد بيانات جدول زمني كافية (أنشطة/بيانات فعلية) للمشروع، يُعاد
 * صراحة "لا توجد بيانات كافية لإعطاء نتيجة موثوقة" بدلاً من نتيجة ملفَّقة.
 *
 * تنويه إلزامي (يظهر في كل استجابة من هذا الملف): النتيجة توقع تحليلي إحصائي مبني على
 * البيانات المتاحة حالياً، وليست حقيقة مؤكدة؛ القرار النهائي بيد مدير المشروع/المهندس
 * المسؤول. هذا الملف قراءة+تحليل فقط؛ لا توجد فيه أي دالة تُعدّل الجدول الزمني.
 */

const https = require('https');

const AI_CORE = require('./aiEngineeringCore');
const AI_DATA = require('./aiDataAccessLayer');

let SCHED = null; try { SCHED = require('./scheduling'); } catch (e) { SCHED = null; }
const { computeDeterministicIndicators } = require('./aiProjectIntelligence');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const MANDATORY_DISCLAIMER =
  'تنويه إلزامي: هذه النتيجة توقع تحليلي إحصائي مبني على البيانات المتاحة وقت التحليل، وليست حقيقة مؤكدة. ' +
  'القرار النهائي بشأن الجدول الزمني والموارد يبقى بيد مدير المشروع/المهندس المسؤول المخوَّل.';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

function callClaude({ system, userMessage, maxTokens = 2200 }) {
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

// ===================================================================================
// 1) جمع بيانات الجدول الزمني الحقيقية لمشروع (عبر schedule domain المصرَّح به)
// ===================================================================================

/**
 * يجلب كل الجداول الزمنية المرتبطة بمشروع، ولكل جدول: الأنشطة، المسار الحرج (CPM)،
 * مقارنة المخطط بالفعلي، S-Curve، وآخر Baseline محفوظ - كل ذلك عبر أدوات scheduling.js
 * الفعلية، وبعد المرور الإلزامي عبر resolveAIContext (نطاق schedule) للتحقق من RBAC.
 */
function gatherScheduleIntelligence(token, projectId) {
  // يفرض صلاحية النطاق "schedule" (المرتبط بوحدة tasks في RBAC) قبل أي وصول لبيانات
  const schedulesRes = AI_DATA.getAIData(token, 'schedule', 'list', { projectId }, {
    operationType: 'delay_prediction:schedules_list', projectId,
  });
  const schedules = (schedulesRes.data && schedulesRes.data.items) || [];

  if (!schedules.length) {
    return { available: false, reason: 'لا يوجد جدول زمني مرتبط بهذا المشروع بعد؛ لا يمكن إجراء تنبؤ بالتأخير بدون بيانات جدول فعلية.' };
  }

  if (!SCHED) {
    return { available: false, reason: 'وحدة الجدول الزمني (scheduling.js) غير متوفرة على الخادم.' };
  }

  const perSchedule = schedules.map((schedule) => {
    const scheduleId = schedule.id;
    const cpm = safe(() => SCHED.computeCPM(scheduleId));
    const comparison = safe(() => SCHED.compareScheduleVsActual(scheduleId));
    const sCurve = safe(() => SCHED.computeSCurve(scheduleId));
    const baselines = safe(() => SCHED.listBaselines(scheduleId), []) || [];
    const resourceHistogram = safe(() => SCHED.computeResourceHistogram(scheduleId));

    // مؤشر أداء الجدول (SPI تقريبي): التقدّم الفعلي مقابل التقدّم المخطط له بحسب الزمن المنقضي
    let spi = null;
    if (sCurve && sCurve.planned && sCurve.planned.length) {
      const today = new Date();
      const start = new Date(schedule.start_date);
      const elapsedDays = Math.max(0, Math.round((today - start) / 86400000));
      const plannedPoint = sCurve.planned.find((p) => p.day === elapsedDays)
        || sCurve.planned[Math.min(elapsedDays, sCurve.planned.length - 1)];
      const plannedPercent = plannedPoint ? plannedPoint.cumulative_percent : null;
      const actualPercent = sCurve.current_actual_progress_percent;
      if (plannedPercent && plannedPercent > 0 && typeof actualPercent === 'number') {
        spi = r2(actualPercent / plannedPercent);
      }
    }

    // أهم الأنشطة تأثيراً: أنشطة متأخرة وعلى المسار الحرج، مرتبة حسب أيام التأخير
    const mostImpactfulActivities = comparison
      ? comparison.activities
          .filter((a) => a.is_late)
          .sort((a, b) => (b.is_critical - a.is_critical) || (b.delay_days - a.delay_days))
          .slice(0, 8)
          .map((a) => ({
            code: a.code, name: a.name, delay_days: a.delay_days,
            is_critical: a.is_critical, status: a.status, progress_percent: a.progress_percent,
            delay_reason: a.delay_reason || null,
          }))
      : [];

    return {
      schedule_id: scheduleId,
      schedule_name: schedule.name,
      schedule_version: schedule.version,
      project_duration_days: cpm ? cpm.project_duration_days : null,
      planned_finish_date: cpm ? cpm.project_finish_date : null,
      forecast_finish_date: comparison ? comparison.forecast_finish_date : null,
      forecast_delay_days: comparison ? comparison.forecast_delay_days : null,
      overall_progress_percent: comparison ? comparison.overall_progress_percent : null,
      delayed_activities_count: comparison ? comparison.delayed_activities_count : null,
      total_activities: comparison ? comparison.total_activities : null,
      average_delay_days: comparison ? comparison.average_delay_days : null,
      critical_path_activities_count: cpm ? cpm.critical_path.length : null,
      schedule_performance_index_spi: spi,
      baselines_count: baselines.length,
      last_baseline_date: baselines.length ? baselines[0].created_at : null,
      resource_overload_conflicts: resourceHistogram ? resourceHistogram.overload_conflicts.length : null,
      most_impactful_activities: mostImpactfulActivities,
    };
  });

  return { available: true, schedules: perSchedule };
}

// ===================================================================================
// 2) مؤشرات حتمية إضافية (بدون AI) خاصة بالتنبؤ - تُبنى فوق الجزء 4/10
// ===================================================================================

function computeDelayDeterministicIndicators(snapshot, scheduleIntel) {
  const base = computeDeterministicIndicators(snapshot);

  const indicators = {
    ...base,
    schedule_intelligence_available: scheduleIntel.available,
  };

  if (scheduleIntel.available) {
    const worst = scheduleIntel.schedules
      .filter((s) => typeof s.forecast_delay_days === 'number')
      .sort((a, b) => b.forecast_delay_days - a.forecast_delay_days)[0] || null;

    indicators.worst_case_schedule = worst
      ? {
          schedule_id: worst.schedule_id,
          schedule_name: worst.schedule_name,
          forecast_delay_days: worst.forecast_delay_days,
          forecast_finish_date: worst.forecast_finish_date,
          spi: worst.schedule_performance_index_spi,
        }
      : null;

    const totalDelayed = scheduleIntel.schedules.reduce((s, sc) => s + (sc.delayed_activities_count || 0), 0);
    const totalActivities = scheduleIntel.schedules.reduce((s, sc) => s + (sc.total_activities || 0), 0);
    indicators.overall_delayed_activities_ratio_percent = totalActivities
      ? r2((totalDelayed / totalActivities) * 100)
      : null;
  } else {
    indicators.schedule_intelligence_reason = scheduleIntel.reason;
  }

  return indicators;
}

// ===================================================================================
// 3) قاعدة تصنيف احتمالية التأخير الحتمية (Rule-Based) - أساس ثابت قبل تفسير AI
// ===================================================================================

/**
 * تصنيف أولي حتمي (بدون AI) لاحتمالية التأخير، مبني فقط على أرقام فعلية:
 * SPI، نسبة الأنشطة المتأخرة، تأخير المسار الحرج، تعارضات الموارد.
 * هذا التصنيف هو "شبكة أمان" تضمن نتيجة أساسية حتى لو تعذّر الاتصال بـ AI،
 * وتُستخدم أيضاً كسياق أساسي يُمرَّر لـ AI لتفسيره وليس لتجاوزه.
 */
function ruleBasedDelayClassification(indicators) {
  if (!indicators.schedule_intelligence_available || !indicators.worst_case_schedule) {
    return {
      delay_probability: 'unknown',
      basis: 'لا تتوفر بيانات جدول زمني كافية لحساب احتمالية تأخير موثوقة.',
    };
  }

  const w = indicators.worst_case_schedule;
  const delayedRatio = indicators.overall_delayed_activities_ratio_percent || 0;
  let score = 0;
  const reasons = [];

  if (typeof w.spi === 'number') {
    if (w.spi < 0.85) { score += 3; reasons.push(`مؤشر أداء الجدول (SPI) منخفض: ${w.spi}`); }
    else if (w.spi < 0.95) { score += 1; reasons.push(`مؤشر أداء الجدول (SPI) دون المستهدف قليلاً: ${w.spi}`); }
  }
  if (w.forecast_delay_days > 30) { score += 3; reasons.push(`تأخير متوقع على المسار الحرج يتجاوز 30 يوماً (${w.forecast_delay_days} يوم)`); }
  else if (w.forecast_delay_days > 7) { score += 2; reasons.push(`تأخير متوقع على المسار الحرج: ${w.forecast_delay_days} يوم`); }
  else if (w.forecast_delay_days > 0) { score += 1; reasons.push(`تأخير طفيف متوقع: ${w.forecast_delay_days} يوم`); }

  if (delayedRatio > 30) { score += 2; reasons.push(`نسبة الأنشطة المتأخرة مرتفعة: ${delayedRatio}%`); }
  else if (delayedRatio > 10) { score += 1; reasons.push(`نسبة الأنشطة المتأخرة: ${delayedRatio}%`); }

  let level = 'low';
  if (score >= 6) level = 'critical';
  else if (score >= 4) level = 'high';
  else if (score >= 2) level = 'medium';

  return {
    delay_probability: level,
    score,
    basis: reasons.length ? reasons : ['لا توجد مؤشرات تأخير جوهرية في البيانات الحالية.'],
  };
}

// ===================================================================================
// 4) التنبؤ الشامل بالتأخير (مع تفسير AI)
// ===================================================================================

async function predictProjectDelay({ token, projectId }) {
  if (!token) throw new Error('يجب تسجيل الدخول لاستخدام ميزة التنبؤ بتأخر المشاريع');
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  const startedAt = new Date().toISOString();
  // يفرض صلاحية النطاق "project" (RBAC) قبل أي معالجة
  const authCtx = AI_CORE.resolveAIContext(token, 'project');

  const snapshot = AI_DATA.getProjectSnapshot(token, projectId);
  if (!snapshot.sections.project_info || !snapshot.sections.project_info.available) {
    throw new Error(`تعذر جلب بيانات المشروع الأساسية: ${snapshot.sections.project_info ? snapshot.sections.project_info.reason : 'سبب غير معروف'}`);
  }

  const scheduleIntel = gatherScheduleIntelligence(token, projectId);
  const indicators = computeDelayDeterministicIndicators(snapshot, scheduleIntel);
  const ruleBased = ruleBasedDelayClassification(indicators);

  // لا توجد بيانات جدول كافية: نتوقف هنا صراحة بدلاً من اختلاق تنبؤ من فراغ
  if (!scheduleIntel.available) {
    const finishedAt = new Date().toISOString();
    AI_CORE.recordAIOperation({
      userId: authCtx.userId, username: authCtx.username, domain: 'schedule',
      operationType: 'delay_prediction', projectId, model: null,
      startedAt, finishedAt, success: true,
      dataSources: ['aiDataAccessLayer.getProjectSnapshot'],
      resultSummary: 'لا توجد بيانات جدول زمني كافية',
    });
    return {
      success: true,
      project_id: projectId,
      generated_at: finishedAt,
      insufficient_data: true,
      message: 'لا توجد بيانات كافية لإعطاء نتيجة موثوقة: ' + scheduleIntel.reason,
      deterministic_indicators: indicators,
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  let aiAnalysis = null;
  let errorMessage = null;

  if (isAIAvailable()) {
    const system = `أنت خبير جدولة مشاريع إنشائية (Planning Engineer) متخصص في تحليل الانحرافات والتنبؤ بالتأخير.
مهمتك تفسير المؤشرات الحتمية المزوَّدة أدناه (محسوبة فعلياً من الجدول الزمني الحقيقي للمشروع عبر CPM وS-Curve ومقارنة المخطط بالفعلي) وصياغة تنبؤ تحليلي واضح.
لا تختلق أي رقم أو نشاط غير موجود في البيانات المرفقة. إن كانت بيانات قسم ما غير متوفرة، اذكر ذلك صراحة.
يجب أن يوضّح ردّك بأن هذا توقع تحليلي إحصائي وليس حقيقة مؤكدة، وأن القرار النهائي بيد مدير المشروع/المهندس المسؤول.
ممنوع اقتراح أي تعديل تلقائي للجدول الزمني؛ فقط توصيات للمراجعة البشرية.

أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي قبلها أو بعدها، وفق البنية التالية بالضبط:
{
  "delay_probability": "low|medium|high|critical",
  "delay_probability_explanation": "شرح مبني على المؤشرات لماذا هذا التصنيف",
  "expected_finish_date": "أفضل تقدير لتاريخ الانتهاء المتوقع (استخدم forecast_finish_date من البيانات كأساس)",
  "expected_delay_days": "رقم تقديري لأيام التأخير المتوقعة عن الخطة الأصلية",
  "most_impactful_activities": [{"activity": "اسم/كود النشاط", "reason": "لماذا هو الأكثر تأثيراً", "is_critical_path": true}],
  "root_causes": ["سبب جوهري للتوقع، مستند إلى بيانات فعلية"],
  "recommended_actions": [{"action": "إجراء مقترح محدد وقابل للتنفيذ", "priority": "high|medium|low", "requires_approval_from": "الدور المسؤول عن الموافقة"}],
  "data_gaps": ["أي بيانات كانت غير متوفرة أثرت على دقة هذا التوقع"],
  "confidence_level": "low|medium|high"
}`;

    const userMessage = `المؤشرات الحتمية المحسوبة مباشرة من الجدول الزمني الفعلي (وليست من AI):
${trimForPrompt(indicators, 2500)}

--- التصنيف الحتمي الأولي القائم على قواعد ثابتة (Rule-Based Baseline) ---
${trimForPrompt(ruleBased, 800)}

--- تفاصيل كل جدول زمني مرتبط بالمشروع (CPM + مقارنة فعلي/مخطط + S-Curve) ---
${trimForPrompt(scheduleIntel.schedules, 3500)}

--- ملخص بيانات المشروع العامة (نسبة الإنجاز، الحالة، الميزانية) ---
${trimForPrompt(snapshot.sections.project_info.data, 1500)}

--- مخاطر المشروع ---
${trimForPrompt(snapshot.sections.project_risks, 800)}`;

    try {
      const response = await callClaude({ system, userMessage, maxTokens: 2400 });
      aiAnalysis = extractJson(response);
    } catch (e) {
      errorMessage = e.message;
    }
  }

  const finishedAt = new Date().toISOString();
  AI_CORE.recordAIOperation({
    userId: authCtx.userId,
    username: authCtx.username,
    domain: 'schedule',
    operationType: 'delay_prediction',
    projectId,
    model: (aiAnalysis && !errorMessage) ? MODEL : null,
    startedAt,
    finishedAt,
    success: !errorMessage,
    errorMessage,
    dataSources: [
      'aiDataAccessLayer.getProjectSnapshot',
      ...scheduleIntel.schedules.map((s) => `scheduling.computeCPM/compareScheduleVsActual(${s.schedule_id})`),
    ],
    resultSummary: aiAnalysis ? `احتمالية التأخير: ${aiAnalysis.delay_probability}` : `تصنيف حتمي فقط: ${ruleBased.delay_probability}`,
  });

  return {
    success: true,
    project_id: projectId,
    generated_at: finishedAt,
    deterministic_indicators: indicators,
    rule_based_classification: ruleBased,
    ai_analysis: aiAnalysis,
    ai_error: errorMessage,
    ai_available: isAIAvailable(),
    note: errorMessage
      ? `تعذّر الحصول على تفسير AI (${errorMessage})؛ التصنيف الحتمي القائم على القواعد أعلاه لا يزال صالحاً.`
      : (!isAIAvailable()
          ? 'ميزة التفسير بالذكاء الاصطناعي غير مفعّلة حالياً (لا يوجد ANTHROPIC_API_KEY)؛ التصنيف الحتمي القائم على القواعد فقط.'
          : 'التنبؤ مبني على مؤشرات حتمية محسوبة من الجدول الزمني الفعلي، وتفسير AI مبني عليها حصراً.'),
    disclaimer: MANDATORY_DISCLAIMER,
    source: {
      sections_used: Object.keys(snapshot.sections).filter((k) => snapshot.sections[k].available),
      sections_unavailable: Object.keys(snapshot.sections).filter((k) => !snapshot.sections[k].available),
      schedules_analyzed: scheduleIntel.schedules.map((s) => s.schedule_id),
    },
  };
}

/**
 * نسخة "سريعة" بدون AI: التصنيف الحتمي فقط، لاستخدامها في لوحات التحكم أو عند
 * عدم توفر ANTHROPIC_API_KEY، بدل حجب أي معلومة عن المستخدم.
 */
function getDelayIndicatorsOnly({ token, projectId }) {
  if (!token) throw new Error('يجب تسجيل الدخول');
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  AI_CORE.resolveAIContext(token, 'project');

  const snapshot = AI_DATA.getProjectSnapshot(token, projectId);
  if (!snapshot.sections.project_info || !snapshot.sections.project_info.available) {
    throw new Error(`تعذر جلب بيانات المشروع الأساسية: ${snapshot.sections.project_info ? snapshot.sections.project_info.reason : 'سبب غير معروف'}`);
  }

  const scheduleIntel = gatherScheduleIntelligence(token, projectId);
  const indicators = computeDelayDeterministicIndicators(snapshot, scheduleIntel);
  const ruleBased = ruleBasedDelayClassification(indicators);

  return {
    success: true,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    deterministic_indicators: indicators,
    rule_based_classification: ruleBased,
    ai_available: isAIAvailable(),
    disclaimer: MANDATORY_DISCLAIMER,
  };
}

module.exports = {
  isAIAvailable,
  predictProjectDelay,
  getDelayIndicatorsOnly,
  // مُصدَّرة لإعادة استخدامها في أجزاء لاحقة (مثل مولّد التقارير الذكي، الجزء 17)
  gatherScheduleIntelligence,
  ruleBasedDelayClassification,
  MANDATORY_DISCLAIMER,
};
