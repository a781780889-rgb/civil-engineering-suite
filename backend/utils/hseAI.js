/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * وحدة المساعد الذكي (HSE AI Assistant)
 * ================================================
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات السلامة المهنية:
 *  - تحليل بيانات السلامة واكتشاف الأنماط
 *  - التنبؤ بالمخاطر المحتملة قبل وقوعها
 *  - اقتراح إجراءات وقائية للحد من الحوادث
 *  - تحليل أسباب الحوادث المتكررة (السبب الجذري)
 *  - تقييم أداء فرق السلامة
 *  - إنشاء خطط تحسين السلامة
 *  - تلخيص تقارير الحوادث والتفتيشات
 *  - إصدار تنبيهات استباقية عند ارتفاع مستوى المخاطر
 *  - إنشاء تقارير تحليلية تلقائية للإدارة
 *
 * ملاحظة مهمة: هذه الوحدة لا تحتوي على مفتاح API مباشرة؛ يجب تمرير المفتاح
 * عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون المفتاح تعمل
 * جميع أقسام السلامة المهنية (الخطط، المخاطر، الحوادث، التفتيش، التصاريح...)
 * بشكل طبيعي وكامل دون أي اعتماد على الذكاء الاصطناعي؛ فقط ميزات التحليل
 * الذكي الإضافية في هذا الملف تتطلبه.
 */

const https = require('https');

const HSE = require('./hseManagement');
const HSE_VIOL = require('./hseViolations');
const HSE_FIRE = require('./hseFireSafety');
const HSE_HZM = require('./hseHazmat');
const HSE_TRN = require('./hseTraining');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** كل دوال وحدات HSE تُرجع {success, data, ...} — هذه الدالة تستخرج data بأمان */
function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

/** استدعاء منخفض المستوى لواجهة Claude API عبر https المدمجة في Node (بدون SDK خارجي) */
function callClaude({ system, userMessage, maxTokens = 2000 }) {
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

/**
 * تحليل بيانات السلامة العامة لمشروع (أو كل المشاريع) واكتشاف الأنماط والاتجاهات
 */
async function analyzeSafetyData({ projectId = null } = {}) {
  const dashboard = unwrap(HSE.getDashboard(projectId));
  const kpis = unwrap(HSE.calculateSafetyKPIs({ projectId }));
  const incidents = unwrap(HSE.listIncidents({ projectId })).slice(0, 50);
  const violations = unwrap(HSE_VIOL.listViolations({ projectId })).slice(0, 50);

  const system = `أنت خبير دولي في السلامة والصحة المهنية (HSE) معتمد وفق معايير ISO 45001 وOSHA، متخصص في تحليل بيانات مواقع الإنشاءات.
مهمتك تحليل بيانات السلامة المرسلة واكتشاف الأنماط والاتجاهات الخطرة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية التالية:
{
  "patterns_detected": ["نمط أو اتجاه ملحوظ في البيانات"],
  "risk_hotspots": [{"area": "الموقع/النشاط", "reason": "سبب اعتباره نقطة خطر", "severity": "high|medium|low"}],
  "trend_summary": "ملخص عام للاتجاه العام لأداء السلامة بجملتين إلى ثلاث",
  "immediate_concerns": ["نقاط تستدعي تدخلاً فورياً إن وجدت"]
}`;

  const userMessage = `بيانات لوحة السلامة:
${JSON.stringify(dashboard).slice(0, 3000)}

مؤشرات الأداء (KPIs):
${JSON.stringify(kpis).slice(0, 1500)}

آخر الحوادث المسجلة:
${JSON.stringify(incidents).slice(0, 3000)}

آخر المخالفات المسجلة:
${JSON.stringify(violations).slice(0, 2000)}

حلل هذه البيانات واستخرج الأنماط والاتجاهات وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * التنبؤ بالمخاطر المحتملة قبل وقوعها، بناءً على المخاطر المسجلة وسجل الحوادث والمخالفات
 */
async function predictRisks({ projectId = null } = {}) {
  const risks = unwrap(HSE.listRisks({ projectId })).slice(0, 40);
  const incidents = unwrap(HSE.listIncidents({ projectId })).slice(0, 40);
  const openViolations = unwrap(HSE_VIOL.listViolations({ projectId, status: 'open' })).slice(0, 30);

  const system = `أنت مهندس سلامة مهنية خبير في التقييم الاستباقي للمخاطر (Predictive Risk Assessment) وفق ISO 45001.
حلل البيانات المرسلة وتنبأ بالمخاطر المحتمل وقوعها مستقبلاً. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "predicted_risks": [{"risk": "وصف الخطر المتوقع", "likelihood": "high|medium|low", "potential_impact": "وصف الأثر المحتمل", "based_on": "الدليل/النمط الذي بُني عليه التنبؤ"}],
  "recommended_preventive_actions": ["إجراء وقائي مقترح"],
  "priority_level": "critical|high|medium|low"
}`;

  const userMessage = `المخاطر المسجلة حالياً:
${JSON.stringify(risks).slice(0, 3000)}

سجل الحوادث السابقة:
${JSON.stringify(incidents).slice(0, 3000)}

المخالفات المفتوحة حالياً:
${JSON.stringify(openViolations).slice(0, 2000)}

بناءً على هذه البيانات، تنبأ بالمخاطر المحتملة مستقبلاً واقترح إجراءات وقائية.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, prediction: extractJson(responseText) };
  } catch (e) {
    return { success: true, prediction_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * تحليل أسباب الحوادث المتكررة (تحليل السبب الجذري Root Cause Analysis)
 */
async function analyzeRecurringIncidentCauses({ projectId = null } = {}) {
  const incidents = unwrap(HSE.listIncidents({ projectId })).slice(0, 60);

  const system = `أنت خبير في تحليل السبب الجذري (Root Cause Analysis) للحوادث المهنية وفق منهجية "5 Whys" ومعايير ISO 45001.
حلل سجل الحوادث المرسل واستخرج الأسباب المتكررة والجذرية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "recurring_causes": [{"cause": "السبب الجذري المتكرر", "frequency": رقم, "related_incident_types": ["نوع الحادث"], "root_cause_category": "بشري|إجرائي|بيئي|معدات|تنظيمي"}],
  "systemic_issues": ["مشكلة نظامية عامة في إدارة السلامة إن وُجدت"],
  "corrective_recommendations": ["توصية تصحيحية للحد من التكرار"]
}`;

  const userMessage = `سجل الحوادث (حتى 60 حادثاً):
${JSON.stringify(incidents).slice(0, 5000)}

حلل الأسباب المتكررة والجذرية لهذه الحوادث وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, root_cause_analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, root_cause_analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * إنشاء خطة تحسين سلامة (Safety Improvement Plan) بناءً على وضع المشروع الحالي
 */
async function generateSafetyImprovementPlan({ projectId = null, focusArea = null } = {}) {
  const dashboard = unwrap(HSE.getDashboard(projectId));
  const kpis = unwrap(HSE.calculateSafetyKPIs({ projectId }));
  const fireDash = unwrap(HSE_FIRE.getFireSafetyDashboard(projectId));
  const hazmatDash = unwrap(HSE_HZM.getHazmatDashboard(projectId));
  const trainingDash = unwrap(HSE_TRN.getTrainingDashboard({ projectId }));

  const system = `أنت مستشار دولي في إدارة أنظمة السلامة والصحة المهنية (HSE Management Systems) معتمد ISO 45001.
مهمتك إعداد خطة تحسين سلامة عملية وقابلة للتنفيذ بناءً على الوضع الحالي للمشروع. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "plan_title": "عنوان خطة التحسين",
  "objectives": ["هدف قابل للقياس"],
  "action_items": [{"action": "الإجراء المطلوب", "responsible_role": "الدور المسؤول", "timeline": "الإطار الزمني المقترح", "priority": "high|medium|low"}],
  "success_metrics": ["مؤشر قياس نجاح الخطة"],
  "estimated_impact": "وصف موجز للأثر المتوقع على أداء السلامة"
}`;

  const userMessage = `الوضع الحالي (لوحة المعلومات):
${JSON.stringify(dashboard).slice(0, 2500)}

مؤشرات الأداء:
${JSON.stringify(kpis).slice(0, 1200)}

حالة مكافحة الحريق:
${JSON.stringify(fireDash).slice(0, 1200)}

حالة المواد الخطرة:
${JSON.stringify(hazmatDash).slice(0, 1200)}

حالة التدريب:
${JSON.stringify(trainingDash).slice(0, 1200)}

مجال التركيز المطلوب (إن وُجد): ${focusArea || 'عام - جميع المجالات'}

أعد خطة تحسين سلامة عملية وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 3000 });
  try {
    return { success: true, improvement_plan: extractJson(responseText) };
  } catch (e) {
    return { success: true, improvement_plan_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * تلخيص تقرير حادث أو تفتيش معيّن (نص عربي مختصر مباشر وليس JSON)
 */
async function summarizeRecord({ recordType, recordId }) {
  let record = null;
  if (recordType === 'incident') record = unwrap(HSE.getIncident(recordId));
  else if (recordType === 'inspection') {
    record = unwrap(HSE.getInspection(recordId));
    if (record) record.findings = unwrap(HSE.listInspectionFindings({ inspectionId: recordId }));
  } else if (recordType === 'risk') record = unwrap(HSE.getRisk(recordId));
  else if (recordType === 'violation') record = unwrap(HSE_VIOL.getViolation(recordId));
  else throw new Error('نوع السجل غير مدعوم للتلخيص: يجب أن يكون incident أو inspection أو risk أو violation');

  if (!record) throw new Error('لم يتم العثور على السجل المطلوب تلخيصه');

  const system = `أنت مساعد سلامة مهنية. لخّص السجل المرسل في فقرة عربية واحدة موجزة (٣ إلى ٥ جمل) تبرز أهم النقاط والمخاطر والإجراءات المطلوبة. أجب بنص عادي مباشر دون تنسيق JSON.`;
  const userMessage = `نوع السجل: ${recordType}\n\nبيانات السجل:\n${JSON.stringify(record).slice(0, 4000)}`;

  const summary = await callClaude({ system, userMessage, maxTokens: 500 });
  return { success: true, record_type: recordType, record_id: recordId, summary: summary.trim() };
}

/**
 * تقييم أداء فرق السلامة بناءً على الالتزام بالتفتيش وإغلاق المخالفات وسرعة الاستجابة
 */
async function evaluateSafetyTeamPerformance({ projectId = null } = {}) {
  const inspections = unwrap(HSE.listInspections({ projectId })).slice(0, 40);
  const violationsDash = unwrap(HSE_VIOL.getViolationsDashboard(projectId));
  const incidents = unwrap(HSE.listIncidents({ projectId })).slice(0, 40);

  const system = `أنت مقيّم أداء متخصص في إدارة فرق السلامة المهنية. قيّم أداء فريق السلامة بناءً على البيانات التشغيلية المرسلة (معدل إنجاز التفتيش، سرعة إغلاق المخالفات، الاستجابة للحوادث).
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "overall_rating": "excellent|good|fair|needs_improvement",
  "strengths": ["نقطة قوة"],
  "gaps": ["نقطة ضعف أو فجوة أداء"],
  "recommendations": ["توصية لتحسين أداء الفريق"]
}`;

  const userMessage = `سجل التفتيشات:
${JSON.stringify(inspections).slice(0, 3000)}

لوحة المخالفات:
${JSON.stringify(violationsDash).slice(0, 1500)}

سجل الحوادث:
${JSON.stringify(incidents).slice(0, 2500)}

قيّم أداء فريق السلامة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, evaluation: extractJson(responseText) };
  } catch (e) {
    return { success: true, evaluation_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * الإجابة عن سؤال هندسي/تنظيمي متعلق بالسلامة المهنية (محادثة حرة)
 */
async function askSafetyQuestion({ question, projectId = null }) {
  if (!question || !String(question).trim()) throw new Error('نص السؤال مطلوب');
  const dashboard = unwrap(HSE.getDashboard(projectId));

  const system = `أنت مساعد ذكي متخصص في السلامة والصحة المهنية (HSE) في قطاع الإنشاءات، خبير بمعايير ISO 45001 وOSHA والأنظمة المحلية لدول الخليج والعالم العربي.
أجب عن سؤال المستخدم بشكل عملي ومباشر ومختصر بالعربية الفصحى، مستفيداً من بيانات المشروع المرفقة إن كانت ذات صلة بالسؤال.`;
  const userMessage = `بيانات لوحة السلامة الحالية للمشروع (للسياق فقط، استخدمها إن كانت ذات صلة):
${JSON.stringify(dashboard).slice(0, 2000)}

سؤال المستخدم:
${question}`;

  const answer = await callClaude({ system, userMessage, maxTokens: 1200 });
  return { success: true, question, answer: answer.trim() };
}

module.exports = {
  isAIAvailable,
  analyzeSafetyData,
  predictRisks,
  analyzeRecurringIncidentCauses,
  generateSafetyImprovementPlan,
  summarizeRecord,
  evaluateSafetyTeamPerformance,
  askSafetyQuestion,
};
