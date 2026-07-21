/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * وحدة المساعد الذكي (Survey AI Assistant) - جزء من الفصل الأول (Setting-Out + Reports + AI)
 * ================================================================================
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات القسم المساحي:
 *  - تحليل بيانات الرفع المساحي واكتشاف الأنماط
 *  - اكتشاف الأخطاء والانحرافات في نقاط التحكم وعمليات التوقيع
 *  - اقتراح تصحيحات للإحداثيات ذات الانحراف الكبير
 *  - التنبؤ بالمناطق ذات المخاطر المساحية (تعارضات، تراكم أخطاء إغلاق، الخ)
 *  - مقارنة الرفع مع التصميم واكتشاف الفروقات
 *  - تحسين توزيع نقاط الرفع
 *  - إنشاء تقارير تحليلية تلقائية
 *  - تلخيص نتائج الأعمال الميدانية
 *  - اقتراح أفضل مسارات الرفع والتوقيع
 *  - الإجابة عن الأسئلة الهندسية المساحية (محادثة حرة)
 *
 * ملاحظة مهمة: هذه الوحدة لا تحتوي على مفتاح API مباشرة؛ يجب تمرير المفتاح
 * عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون المفتاح تعمل
 * جميع وظائف قسم المساحة (المشاريع، الإحداثيات، نقاط التحكم، الرفع، التوقيع،
 * الحسابات، التقارير...) بشكل طبيعي وكامل دون أي اعتماد على الذكاء الاصطناعي؛
 * فقط ميزات التحليل الذكي الإضافية في هذا الملف تتطلبه.
 */

const https = require('https');

const SURVEY = require('./surveyManagement');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** كل دوال وحدة المساحة تُرجع {success, data, ...} — هذه الدالة تستخرج data بأمان */
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
 * تحليل بيانات الرفع المساحي لمشروع واكتشاف الأنماط والاتجاهات العامة
 */
async function analyzeSurveyData({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const dashboard = unwrap(SURVEY.getDashboard());
  const records = unwrap(SURVEY.listSurveyRecords({ project_id: projectId, pageSize: 200 }));
  const controlPoints = unwrap(SURVEY.listControlPoints({ project_id: projectId, pageSize: 200 }));

  const system = `أنت خبير مساحة وهندسة جيوديسية معتمد، متخصص في تحليل بيانات الرفع المساحي لمشاريع الإنشاءات.
مهمتك تحليل بيانات الرفع المرسلة واكتشاف الأنماط والاتجاهات. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية التالية:
{
  "patterns_detected": ["نمط أو اتجاه ملحوظ في بيانات الرفع"],
  "data_quality_notes": ["ملاحظة عن جودة أو اكتمال البيانات"],
  "coverage_summary": "ملخص عن تغطية الرفع المساحي للمشروع بجملتين إلى ثلاث",
  "recommendations": ["توصية عملية لتحسين عملية الرفع"]
}`;

  const userMessage = `لوحة تحكم قسم المساحة (للسياق العام):
${JSON.stringify(dashboard).slice(0, 2000)}

عمليات الرفع المسجلة لهذا المشروع:
${JSON.stringify(records).slice(0, 3500)}

نقاط التحكم المسجلة لهذا المشروع:
${JSON.stringify(controlPoints).slice(0, 2500)}

حلل هذه البيانات واستخرج الأنماط والاتجاهات وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return { success: true, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * اكتشاف الأخطاء والانحرافات: يفحص إغلاق المضلعات ونتائج التوقيع الخارجة عن التفاوت
 */
async function detectErrorsAndDeviations({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const traverseCalcs = unwrap(SURVEY.listSurveyCalculations({ project_id: projectId, calc_type: 'traverse_closure', pageSize: 100 }));
  const stakeoutComparison = unwrap(SURVEY.compareStakeoutBatchToDesign({ project_id: projectId }));

  const system = `أنت خبير في ضبط الجودة المساحية (Survey Quality Control) ومعايير الدقة الجيوديسية.
حلل بيانات إغلاق المضلعات وانحرافات التوقيع المرسلة، واكتشف الأخطاء والانحرافات ذات الدلالة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "significant_errors": [{"source": "traverse_closure|stakeout", "description": "وصف الخطأ/الانحراف", "severity": "high|medium|low"}],
  "root_cause_hypotheses": ["احتمال سبب جذري للأخطاء المكتشفة"],
  "corrective_actions": ["إجراء تصحيحي مقترح"]
}`;

  const userMessage = `نتائج حسابات إغلاق المضلعات (Traverse Closure):
${JSON.stringify(traverseCalcs).slice(0, 3000)}

ملخص مقارنة نقاط التوقيع بالتصميم:
${JSON.stringify(stakeoutComparison).slice(0, 2500)}

اكتشف الأخطاء والانحرافات ذات الدلالة الهندسية من هذه البيانات.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return { success: true, findings: extractJson(responseText) };
  } catch (e) {
    return { success: true, findings_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * اقتراح تصحيحات للإحداثيات ذات الانحراف الكبير عن نقطة التصميم في عمليات التوقيع
 */
async function suggestCoordinateCorrections({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const { data: allStakeouts } = SURVEY.listStakeouts({ project_id: projectId, pageSize: 500 });
  const outOfTolerance = allStakeouts.filter((s) => s.deviation && !s.deviation.within_tolerance);

  if (outOfTolerance.length === 0) {
    return { success: true, suggestions: { message: 'لا توجد نقاط توقيع خارج حدود التفاوت المسموح حالياً.', corrections: [] } };
  }

  const system = `أنت مساح خبير متخصص في تصحيح انحرافات التوقيع المساحي في مواقع التنفيذ.
اقترح إجراءات تصحيح عملية لكل نقطة خارج التفاوت المرسلة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "corrections": [{"stakeout_number": "رقم عملية التوقيع", "issue": "وصف الانحراف", "suggested_correction": "الإجراء العملي المقترح للتصحيح"}],
  "general_advice": "نصيحة عامة لتقليل تكرار هذا النوع من الانحرافات مستقبلاً"
}`;

  const userMessage = `نقاط التوقيع الخارجة عن حدود التفاوت المسموح:
${JSON.stringify(outOfTolerance).slice(0, 3500)}

اقترح تصحيحات عملية لكل نقطة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, suggestions: extractJson(responseText) };
  } catch (e) {
    return { success: true, suggestions_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * التنبؤ بالمناطق ذات المخاطر المساحية (تراكم أخطاء، تعارضات حدود، مناطق ضعيفة التغطية)
 */
async function predictSurveyRiskAreas({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const controlPoints = unwrap(SURVEY.listControlPoints({ project_id: projectId, pageSize: 300 }));
  const records = unwrap(SURVEY.listSurveyRecords({ project_id: projectId, pageSize: 200 }));

  const system = `أنت خبير في إدارة المخاطر المساحية والجيوديسية لمشاريع الإنشاءات الكبرى.
بناءً على توزيع نقاط التحكم وعمليات الرفع المرسلة، تنبأ بالمناطق أو الأنشطة ذات المخاطر المساحية الأعلى (كضعف التغطية، تباعد نقاط التحكم، أو نقص بيانات مرجعية). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "risk_areas": [{"area_or_activity": "وصف المنطقة أو النشاط", "risk_type": "نوع الخطر المساحي", "likelihood": "high|medium|low", "recommendation": "توصية للتخفيف"}],
  "overall_risk_level": "critical|high|medium|low"
}`;

  const userMessage = `نقاط التحكم المسجلة:
${JSON.stringify(controlPoints).slice(0, 3000)}

عمليات الرفع المسجلة:
${JSON.stringify(records).slice(0, 3000)}

تنبأ بالمناطق ذات المخاطر المساحية بناءً على هذه البيانات.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, prediction: extractJson(responseText) };
  } catch (e) {
    return { success: true, prediction_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * تلخيص نتائج الأعمال الميدانية لعملية رفع أو توقيع معينة، أو لمشروع بالكامل خلال فترة
 */
async function summarizeFieldWork({ projectId, dateFrom = null, dateTo = null } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const records = unwrap(SURVEY.listSurveyRecords({ project_id: projectId, pageSize: 200 }));
  const stakeouts = unwrap(SURVEY.listStakeouts({ project_id: projectId, pageSize: 200 }));

  const filterByDate = (arr, field) => arr.filter((x) => {
    if (!dateFrom && !dateTo) return true;
    const d = new Date(x[field] || x.created_at);
    if (dateFrom && d < new Date(dateFrom)) return false;
    if (dateTo && d > new Date(dateTo)) return false;
    return true;
  });

  const filteredRecords = filterByDate(records, 'survey_date');
  const filteredStakeouts = filterByDate(stakeouts, 'stakeout_date');

  const system = `أنت مساح ميداني خبير مسؤول عن كتابة ملخصات تنفيذية موجزة لأعمال الرفع والتوقيع الميدانية.
اكتب ملخصاً عملياً وواضحاً بالعربية الفصحى للأعمال الميدانية المنجزة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "executive_summary": "ملخص تنفيذي من 3-5 جمل لكل الأعمال الميدانية المنجزة",
  "key_achievements": ["إنجاز رئيسي تم تحقيقه"],
  "open_issues": ["مشكلة أو نقطة معلّقة تحتاج متابعة"]
}`;

  const userMessage = `عمليات الرفع المساحي المنجزة (ضمن الفترة المطلوبة إن حُددت):
${JSON.stringify(filteredRecords).slice(0, 3000)}

عمليات التوقيع المنجزة (ضمن الفترة المطلوبة إن حُددت):
${JSON.stringify(filteredStakeouts).slice(0, 3000)}

اكتب ملخصاً تنفيذياً لهذه الأعمال الميدانية.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1500 });
  try {
    return { success: true, summary: extractJson(responseText) };
  } catch (e) {
    return { success: true, summary_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * الإجابة عن سؤال هندسي/مساحي متعلق بالقسم (محادثة حرة)
 */
async function askSurveyQuestion({ question, projectId = null }) {
  if (!question || !String(question).trim()) throw new Error('نص السؤال مطلوب');
  const dashboard = unwrap(SURVEY.getDashboard());

  const system = `أنت مساعد ذكي متخصص في المساحة والهندسة الجيوديسية وأعمال الرفع والتوقيع لمشاريع الإنشاءات، خبير بمعايير المساحة الدولية وأنظمة الإحداثيات (UTM, WGS84) ومعادلات Transverse Mercator.
أجب عن سؤال المستخدم بشكل عملي ومباشر ومختصر بالعربية الفصحى، مستفيداً من بيانات المشروع المرفقة إن كانت ذات صلة بالسؤال.`;
  const userMessage = `لوحة تحكم قسم المساحة الحالية (للسياق فقط، استخدمها إن كانت ذات صلة):
${JSON.stringify(dashboard).slice(0, 2000)}

سؤال المستخدم:
${question}`;

  const answer = await callClaude({ system, userMessage, maxTokens: 1200 });
  return { success: true, question, answer: answer.trim() };
}

module.exports = {
  isAIAvailable,
  analyzeSurveyData,
  detectErrorsAndDeviations,
  suggestCoordinateCorrections,
  predictSurveyRiskAreas,
  summarizeFieldWork,
  askSurveyQuestion,
};
