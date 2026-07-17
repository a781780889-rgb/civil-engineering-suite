/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الثاني: طرق الاستيراد
 * ==========================================
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API)
 * تُستخدم لـ: تحليل نصوص/بيانات مستخرجة من مخططات (PDF/DXF/Excel/CSV)،
 * اكتشاف العناصر، اقتراح مطابقات لبنود الحصر القياسية، واكتشاف النواقص.
 *
 * ملاحظة مهمة: هذه الوحدة لا تحتوي على مفتاح API مباشرة؛ يجب تمرير المفتاح
 * عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون المفتاح تعمل
 * جميع أقسام الحصر والاستيراد (CSV/Excel/PDF/DXF) بشكل طبيعي وكامل دون أي
 * اعتماد على الذكاء الاصطناعي؛ فقط ميزات التحليل الذكي الإضافية تتطلبه.
 */

const https = require('https');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * استدعاء منخفض المستوى لواجهة Claude API عبر https المدمجة في Node (بدون SDK خارجي)
 */
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
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'خطأ من واجهة الذكاء الاصطناعي'));
          const textBlocks = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text);
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
 * تحليل نصوص/بيانات مستخرجة من مخطط (PDF نصي أو كيانات DXF) وربطها ببنود حصر قياسية
 * يعيد: العناصر المكتشفة، تقدير الأبعاد، عناصر مفقودة محتملة، واقتراحات
 */
async function analyzeExtractedPlanData({ sourceType, extractedText, entitiesSummary, projectType }) {
  const system = `أنت مهندس مدني خبير متخصص في حصر الكميات (Quantity Surveying) وقراءة المخططات الهندسية.
مهمتك تحليل البيانات النصية/الهندسية المستخرجة آلياً من ملف مخطط (${sourceType}) وربطها ببنود حصر كميات حقيقية.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية التالية:
{
  "detected_elements": [{"element": "اسم العنصر بالعربي", "category": "التصنيف", "quantity_estimate": رقم, "unit": "الوحدة", "confidence": "high|medium|low", "source_reference": "مرجع من النص/الكيان"}],
  "missing_or_unclear": ["وصف أي عنصر متوقع لكن غير واضح بالبيانات"],
  "conflicts_detected": ["أي تعارض بين قياسات أو تكرار محتمل"],
  "recommendations": ["اقتراحات لتحسين دقة الحصر أو تقليل الهدر"]
}`;

  const userMessage = `نوع المشروع: ${projectType || 'غير محدد'}
نوع مصدر البيانات: ${sourceType}

النص/البيانات المستخرجة من الملف:
"""
${(extractedText || '').slice(0, 6000)}
"""

ملخص الكيانات الهندسية المكتشفة (إن وجدت):
${JSON.stringify(entitiesSummary || {}, null, 2).slice(0, 3000)}

حلل هذه البيانات واستخرج عناصر الحصر المحتملة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 3000 });
  try {
    return { success: true, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * مقارنة نسختين من بيانات حصر (مثلاً حصر يدوي مقابل حصر مستخرج من مخطط)
 * لاكتشاف الفروقات والتعارضات
 */
async function compareBOQVersions({ versionA, versionB, labelA = 'النسخة الأولى', labelB = 'النسخة الثانية' }) {
  const system = `أنت مهندس مدني خبير في مراجعة جداول الكميات (BOQ). قارن بين نسختين من بيانات حصر كميات
وحدد الفروقات الجوهرية في الكميات أو البنود المفقودة/المضافة. أجب حصراً بصيغة JSON بدون أي نص إضافي:
{
  "items_only_in_a": [...],
  "items_only_in_b": [...],
  "quantity_differences": [{"item": "...", "qty_a": رقم, "qty_b": رقم, "difference_percent": رقم}],
  "summary": "ملخص عام للفروقات بجملتين"
}`;

  const userMessage = `${labelA}:
${JSON.stringify(versionA).slice(0, 4000)}

${labelB}:
${JSON.stringify(versionB).slice(0, 4000)}`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, comparison: extractJson(responseText) };
  } catch (e) {
    return { success: true, comparison_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

/**
 * الإجابة عن سؤال هندسي حر يتعلق بالحصر أو المخطط المرفوع (استخدام عام لواجهة الدردشة الهندسية)
 */
async function answerEngineeringQuestion({ question, context }) {
  const system = `أنت مساعد هندسي متخصص في الهندسة المدنية وحصر الكميات، تجيب بدقة وإيجاز بالعربية الفصحى،
وتعتمد على المعايير الهندسية المعتمدة (ACI, ASTM, الكود السعودي/المصري حسب السياق) دون افتراضات غير مبررة.`;

  const userMessage = `السياق المتاح (بيانات المشروع/الحصر إن وجدت):
${JSON.stringify(context || {}).slice(0, 3000)}

السؤال: ${question}`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1500 });
  return { success: true, answer: responseText };
}

module.exports = {
  isAIAvailable,
  callClaude,
  analyzeExtractedPlanData,
  compareBOQVersions,
  answerEngineeringQuestion,
};
