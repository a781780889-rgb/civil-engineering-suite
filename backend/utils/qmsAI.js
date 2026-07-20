/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * وحدة المساعد الذكي (QMS AI Assistant)
 * =====================================================================================
 * واجهة موحّدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات الجودة:
 *  - تحليل نتائج الاختبارات واكتشاف الأنماط غير الطبيعية
 *  - التنبؤ بحالات عدم المطابقة (NCR) قبل حدوثها
 *  - اقتراح إجراءات تصحيحية ووقائية مناسبة (CAPA)
 *  - تحليل أداء الموردين والمقاولين
 *  - مراجعة خطط الجودة واكتشاف الثغرات
 *  - إنشاء تقارير تحليلية تلقائية
 *  - تلخيص نتائج الفحوصات والاجتماعات
 *  - إصدار تنبيهات استباقية عند انخفاض مؤشرات الجودة
 *  - الإجابة عن أسئلة هندسية/جودة حرة
 *
 * ملاحظة مهمة: هذه الوحدة لا تحتوي على مفتاح API مباشرة؛ يجب تمرير المفتاح
 * عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون المفتاح تعمل جميع
 * وظائف الجودة الأساسية (الخطط، IR، الاختبارات، NCR، CAPA، MAR، SDR...) بشكل
 * طبيعي وكامل دون أي اعتماد على الذكاء الاصطناعي؛ فقط ميزات هذا الملف تتطلبه.
 */

const https = require('https');

const QMS = require('./qmsManagement');
const QMSX = require('./qmsDocsKpis');
const QMS_ALERTS = require('./qmsAlerts');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

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

/** تحليل نتائج اختبارات المواد واكتشاف الأنماط والقيم الشاذة */
async function analyzeTestResults({ projectId = null, materialCategory = null } = {}) {
  const tests = unwrap(QMS.listMaterialTests({ projectId, materialCategory })).slice(0, 80);

  const system = `أنت مهندس جودة خبير في اختبارات مواد البناء (خرسانة، حديد، تربة، أسفلت، مياه) معتمد وفق ISO 9001 ومعايير الاختبار الدولية (ASTM/BS).
حلل بيانات نتائج الاختبارات المرسلة واكتشف الأنماط والقيم الشاذة (Anomalies). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "patterns_detected": ["نمط ملحوظ في النتائج"],
  "anomalies": [{"test_id": "معرّف الاختبار إن أمكن", "issue": "وصف الشذوذ", "severity": "high|medium|low"}],
  "trend_summary": "ملخص عام لاتجاه نتائج الاختبارات بجملتين إلى ثلاث",
  "recommendations": ["توصية عملية لتحسين معدل النجاح"]
}`;

  const userMessage = `بيانات اختبارات المواد (حتى 80 اختباراً):
${JSON.stringify(tests).slice(0, 6000)}

حلل هذه البيانات واستخرج الأنماط والقيم الشاذة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** التنبؤ بحالات عدم المطابقة (NCR) المحتملة قبل حدوثها، بناءً على سجل NCR وطلبات الفحص واختبارات المواد */
async function predictNonConformances({ projectId = null } = {}) {
  const ncrs = unwrap(QMS.listNcrs({ projectId })).slice(0, 50);
  const irs = unwrap(QMS.listInspectionRequests({ projectId })).slice(0, 50);
  const tests = unwrap(QMS.listMaterialTests({ projectId })).slice(0, 40);

  const system = `أنت خبير في إدارة الجودة الاستباقية (Predictive Quality Management) وفق ISO 9001.
حلل البيانات المرسلة وتنبأ بحالات عدم المطابقة (NCR) المحتمل حدوثها مستقبلاً. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "predicted_ncrs": [{"area": "العنصر/الموقع/المرحلة المعرّضة للخطر", "likelihood": "high|medium|low", "reasoning": "الدليل/النمط الذي بُني عليه التنبؤ", "potential_impact": "الأثر المحتمل"}],
  "high_risk_elements": ["عنصر إنشائي أو نشاط معرّض لمخاطر مطابقة"],
  "priority_level": "critical|high|medium|low"
}`;

  const userMessage = `سجل NCR السابق:
${JSON.stringify(ncrs).slice(0, 3500)}

طلبات الفحص:
${JSON.stringify(irs).slice(0, 3000)}

اختبارات المواد:
${JSON.stringify(tests).slice(0, 2500)}

بناءً على هذه البيانات، تنبأ بحالات عدم المطابقة المحتملة مستقبلاً وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, prediction: extractJson(responseText) };
  } catch (e) {
    return { success: true, prediction_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** اقتراح إجراءات تصحيحية ووقائية (CAPA) مناسبة لحالة NCR محددة */
async function suggestCapaActions({ ncrId }) {
  if (!ncrId) throw new Error('معرّف حالة عدم المطابقة (ncrId) مطلوب');
  const ncr = unwrap(QMS.getNcr(ncrId));
  if (!ncr) throw new Error('لم يتم العثور على حالة عدم المطابقة المطلوبة');

  const system = `أنت خبير في منهجية "5 Whys" وتحليل السبب الجذري (Root Cause Analysis) وإعداد الإجراءات التصحيحية والوقائية (CAPA) وفق ISO 9001.
اقترح إجراءات تصحيحية ووقائية عملية وقابلة للتنفيذ لحالة عدم المطابقة المرسلة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "likely_root_cause": "السبب الجذري المرجّح",
  "corrective_actions": [{"action": "إجراء تصحيحي فوري", "responsible_role": "الدور المسؤول المقترح", "estimated_timeline_days": رقم}],
  "preventive_actions": [{"action": "إجراء وقائي لمنع التكرار", "responsible_role": "الدور المسؤول المقترح", "estimated_timeline_days": رقم}],
  "verification_method": "طريقة مقترحة للتحقق من فاعلية الإجراء"
}`;

  const userMessage = `بيانات حالة عدم المطابقة:
${JSON.stringify(ncr).slice(0, 3000)}

اقترح إجراءات تصحيحية ووقائية مناسبة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, ncr_id: ncrId, suggestion: extractJson(responseText) };
  } catch (e) {
    return { success: true, ncr_id: ncrId, suggestion_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** تحليل أداء الموردين والمقاولين مجتمعين، بناءً على MAR/SDR/NCR */
async function analyzeSupplierContractorPerformance({ projectId = null } = {}) {
  const supplierPerf = unwrap(QMSX.computeSupplierPerformance({ projectId }));
  const contractorPerf = unwrap(QMSX.computeContractorPerformance({ projectId }));
  const ncrs = unwrap(QMS.listNcrs({ projectId })).slice(0, 40);

  const system = `أنت مستشار جودة متخصص في تقييم أداء سلسلة التوريد والمقاولين في مشاريع الإنشاءات وفق ISO 9001.
حلل البيانات المرسلة وقيّم أداء الموردين والمقاولين. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "top_performers": ["اسم مورد/مقاول ذو أداء متميز"],
  "underperformers": [{"name": "اسم مورد/مقاول", "issue": "المشكلة الرئيسية", "recommendation": "توصية للتحسين"}],
  "overall_assessment": "تقييم عام موجز لأداء سلسلة التوريد والمقاولين",
  "recommendations": ["توصية عامة لتحسين إدارة الموردين/المقاولين"]
}`;

  const userMessage = `أداء الموردين:
${JSON.stringify(supplierPerf).slice(0, 2500)}

أداء المقاولين:
${JSON.stringify(contractorPerf).slice(0, 2500)}

حالات عدم المطابقة المرتبطة:
${JSON.stringify(ncrs).slice(0, 2500)}

قيّم أداء الموردين والمقاولين وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return { success: true, evaluation: extractJson(responseText) };
  } catch (e) {
    return { success: true, evaluation_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** مراجعة خطة جودة واكتشاف الثغرات مقارنة بمتطلبات ISO 9001 */
async function reviewQualityPlan({ planId }) {
  if (!planId) throw new Error('معرّف خطة الجودة (planId) مطلوب');
  const plan = unwrap(QMS.getQualityPlan(planId));
  if (!plan) throw new Error('لم يتم العثور على خطة الجودة المطلوبة');

  const system = `أنت مدقق جودة (QA Auditor) معتمد ISO 9001 متخصص في مراجعة خطط الجودة لمشاريع الإنشاءات.
راجع خطة الجودة المرسلة واكتشف أي ثغرات أو نواقص مقارنة بمتطلبات ISO 9001 والممارسات الهندسية السليمة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "completeness_score": رقم من 0 إلى 100,
  "gaps_found": ["ثغرة أو نقص محدد في الخطة"],
  "strengths": ["نقطة قوة في الخطة"],
  "recommendations": ["توصية لتحسين الخطة"],
  "iso_9001_alignment": "ملخص موجز لمدى توافق الخطة مع ISO 9001"
}`;

  const userMessage = `بيانات خطة الجودة:
${JSON.stringify(plan).slice(0, 4000)}

راجع هذه الخطة واكتشف الثغرات وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, plan_id: planId, review: extractJson(responseText) };
  } catch (e) {
    return { success: true, plan_id: planId, review_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** إنشاء تقرير تحليلي تلقائي شامل لوضع الجودة في المشروع */
async function generateAnalyticalReport({ projectId = null } = {}) {
  const dashboard = unwrap(QMS.getDashboard(projectId));
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  const alertsSummary = unwrap(QMS_ALERTS.getAlertsSummary({ projectId }));

  const system = `أنت مدير جودة تنفيذي (QA/QC Executive) تُعدّ تقارير تحليلية للإدارة العليا في شركات المقاولات، وفق ISO 9001.
أعد تقريراً تحليلياً تنفيذياً موجزاً وواضحاً بناءً على البيانات المرسلة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "executive_summary": "ملخص تنفيذي من ٣ إلى ٥ جمل",
  "key_findings": ["نتيجة رئيسية مستخلصة من البيانات"],
  "risks": ["مخاطرة جودة قائمة يجب الانتباه لها"],
  "recommendations": ["توصية للإدارة"],
  "overall_status": "excellent|good|fair|needs_attention|critical"
}`;

  const userMessage = `لوحة معلومات الجودة:
${JSON.stringify(dashboard).slice(0, 3000)}

مؤشرات الأداء (KPIs):
${JSON.stringify(kpis).slice(0, 2000)}

ملخص التنبيهات النشطة:
${JSON.stringify(alertsSummary).slice(0, 1500)}

أعد التقرير التحليلي التنفيذي وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, report: extractJson(responseText) };
  } catch (e) {
    return { success: true, report_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** تلخيص سجل جودة معيّن (طلب فحص / اختبار مادة / NCR / CAPA) في فقرة عربية موجزة */
async function summarizeRecord({ recordType, recordId }) {
  let record = null;
  if (recordType === 'inspection_request') record = unwrap(QMS.getInspectionRequest(recordId));
  else if (recordType === 'material_test') record = unwrap(QMS.getMaterialTest(recordId));
  else if (recordType === 'ncr') record = unwrap(QMS.getNcr(recordId));
  else if (recordType === 'capa') record = unwrap(QMS.getCapa(recordId));
  else if (recordType === 'quality_plan') record = unwrap(QMS.getQualityPlan(recordId));
  else throw new Error('نوع السجل غير مدعوم للتلخيص: يجب أن يكون inspection_request أو material_test أو ncr أو capa أو quality_plan');

  if (!record) throw new Error('لم يتم العثور على السجل المطلوب تلخيصه');

  const system = `أنت مساعد جودة. لخّص السجل المرسل في فقرة عربية واحدة موجزة (٣ إلى ٥ جمل) تبرز أهم النقاط والمخاطر والإجراءات المطلوبة. أجب بنص عادي مباشر دون تنسيق JSON.`;
  const userMessage = `نوع السجل: ${recordType}\n\nبيانات السجل:\n${JSON.stringify(record).slice(0, 4000)}`;

  const summary = await callClaude({ system, userMessage, maxTokens: 500 });
  return { success: true, record_type: recordType, record_id: recordId, summary: summary.trim() };
}

/** إصدار تنبيه استباقي عند انخفاض مؤشرات الجودة، مع تفسير الأسباب المحتملة وإجراءات مقترحة */
async function proactiveQualityAlert({ projectId = null } = {}) {
  const kpis = unwrap(QMSX.getQualityKpis({ projectId }));
  const alerts = unwrap(QMS_ALERTS.getActiveAlerts({ projectId }));

  const system = `أنت نظام إنذار استباقي لإدارة الجودة وفق ISO 9001. مهمتك تفسير سبب انخفاض مؤشرات الجودة الحالية (إن وُجد) واقتراح إجراءات فورية.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "alert_triggered": true أو false,
  "reason": "تفسير سبب التنبيه بناءً على المؤشرات والبيانات",
  "affected_areas": ["المجال المتأثر"],
  "immediate_actions": ["إجراء فوري مقترح"],
  "urgency": "critical|high|medium|low"
}`;

  const userMessage = `مؤشرات الأداء الحالية:
${JSON.stringify(kpis).slice(0, 2000)}

التنبيهات النشطة حالياً في النظام:
${JSON.stringify(alerts).slice(0, 2000)}

قيّم الوضع وأصدر تنبيهاً استباقياً إن كان مبرراً وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1500 });
  try {
    return { success: true, proactive_alert: extractJson(responseText) };
  } catch (e) {
    return { success: true, proactive_alert_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/** الإجابة عن سؤال هندسي/جودة حر (محادثة) بالاستفادة من سياق المشروع الحالي */
async function askQualityQuestion({ question, projectId = null }) {
  if (!question || !String(question).trim()) throw new Error('نص السؤال مطلوب');
  const dashboard = unwrap(QMS.getDashboard(projectId));

  const system = `أنت مساعد ذكي متخصص في إدارة الجودة (QA/QC) في قطاع الإنشاءات، خبير بمعايير ISO 9001 والاختبارات الهندسية (خرسانة، حديد، تربة، أسفلت، مياه) والأنظمة المحلية لدول الخليج والعالم العربي.
أجب عن سؤال المستخدم بشكل عملي ومباشر ومختصر بالعربية الفصحى، مستفيداً من بيانات المشروع المرفقة إن كانت ذات صلة بالسؤال.`;
  const userMessage = `بيانات لوحة الجودة الحالية للمشروع (للسياق فقط، استخدمها إن كانت ذات صلة):
${JSON.stringify(dashboard).slice(0, 2000)}

سؤال المستخدم:
${question}`;

  const answer = await callClaude({ system, userMessage, maxTokens: 1200 });
  return { success: true, question, answer: answer.trim() };
}

module.exports = {
  isAIAvailable,
  analyzeTestResults,
  predictNonConformances,
  suggestCapaActions,
  analyzeSupplierContractorPerformance,
  reviewQualityPlan,
  generateAnalyticalReport,
  summarizeRecord,
  proactiveQualityAlert,
  askQualityQuestion,
};
