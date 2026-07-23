/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء العاشر (10/10) - المساعد الذكي للمخططات (Drawings AI Assistant)
 * =====================================================================================
 *
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات المخططات
 * الهندسية، مبنية بنفس أسلوب وحدات الذكاء الاصطناعي القائمة في بقية أقسام النظام
 * (hseAI.js / qmsAI.js / surveyAI.js / documentAI.js): بدون أي SDK خارجي، استدعاء
 * https المدمجة في Node مباشرة إلى واجهة Claude، وبدون تخزين مفتاح API داخل الكود.
 *
 * يغطي هذا الملف بنود "الذكاء الاصطناعي" العشرة من مواصفة القسم الثاني عشر الأصلية:
 *  1. تحليل المخططات الهندسية                → analyzeDrawing
 *  2. اكتشاف التعارضات بين التخصصات           → detectCrossDisciplineConflicts (يستفيد من drawingBIM.js)
 *  3. مقارنة المخططات تلقائياً                 → autoCompareVersions (يستفيد من drawingComparison.js)
 *  4. اكتشاف العناصر المفقودة                  → detectMissingElements
 *  5. مراجعة التوافق مع الأكواد الهندسية        → reviewCodeCompliance
 *  6. اقتراح تحسينات في التصميم                → suggestDesignImprovements
 *  7. تحليل تأثير التعديلات على المشروع         → analyzeRevisionImpact
 *  8. إنشاء ملخصات للمراجعات                    → summarizeReview
 *  9. تصنيف المخططات تلقائياً                   → autoClassifyDrawing
 *  10. إنشاء تقارير تحليلية للإدارة              → generateManagementInsightReport
 *
 * ملاحظة مهمة (نفس قيد بقية وحدات AI في النظام): هذه الوحدة لا تحتوي على مفتاح API
 * مباشرة؛ يجب تمريره عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون
 * المفتاح يعمل قسم المخططات بالكامل (الرفع، الإصدارات، المراجعات، الاعتمادات،
 * الطبقات، المقارنة، BIM، التنبيهات، التقارير) بشكل طبيعي دون أي اعتماد على الذكاء
 * الاصطناعي؛ فقط ميزات هذا الملف تحديداً تتطلبه، وتُرجع خطأً واضحاً بالعربية عند غيابه.
 *
 * منهجية أمانة البيانات: كل دالة تبني سياقها من بيانات حقيقية مخزَّنة فعلياً عبر
 * الوحدات القائمة (drawingManagement / drawingVersions / drawingComparison /
 * drawingBIM / drawingReviews / drawingComments / drawingApprovals / drawingLayers /
 * drawingReports) — لا بيانات وهمية ولا نصوص ثابتة؛ الذكاء الاصطناعي يحلل فعلياً ما
 * هو مخزَّن في drawings.json وقت الاستدعاء.
 */

const https = require('https');

const DRAW = require('./drawingManagement');
let DRAW_VER = null; try { DRAW_VER = require('./drawingVersions'); } catch (e) { DRAW_VER = null; }
let DRAW_CMP = null; try { DRAW_CMP = require('./drawingComparison'); } catch (e) { DRAW_CMP = null; }
let DRAW_BIM = null; try { DRAW_BIM = require('./drawingBIM'); } catch (e) { DRAW_BIM = null; }
let DRAW_REV = null; try { DRAW_REV = require('./drawingReviews'); } catch (e) { DRAW_REV = null; }
let DRAW_CMT = null; try { DRAW_CMT = require('./drawingComments'); } catch (e) { DRAW_CMT = null; }
let DRAW_APR = null; try { DRAW_APR = require('./drawingApprovals'); } catch (e) { DRAW_APR = null; }
let DRAW_LAY = null; try { DRAW_LAY = require('./drawingLayers'); } catch (e) { DRAW_LAY = null; }
let DRAW_REP = null; try { DRAW_REP = require('./drawingReports'); } catch (e) { DRAW_REP = null; }

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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

/** كل دوال وحدات المخططات القائمة تُرجع إما القيمة مباشرة أو {success, ...} — استخراج آمن */
function unwrap(result, key) {
  if (result && typeof result === 'object' && key && key in result) return result[key];
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function getDrawingOrThrow(drawingId) {
  const rec = DRAW.getDrawing(drawingId);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

/** يجمع كل السياق المتاح فعلياً حول مخطط معيّن من مختلف وحدات القسم دون كسر التشغيل إن غاب أحدها */
function buildDrawingFullContext(drawingId) {
  const drawing = getDrawingOrThrow(drawingId);
  const context = { drawing };

  try { context.versions = DRAW_VER ? unwrap(DRAW_VER.listVersions(drawingId), 'versions') : null; } catch (e) { context.versions = null; }
  try { context.reviews = DRAW_REV ? unwrap(DRAW_REV.listReviews(drawingId), 'reviews') : null; } catch (e) { context.reviews = null; }
  try { context.comments = DRAW_CMT ? unwrap(DRAW_CMT.listComments(drawingId), 'comments') : null; } catch (e) { context.comments = null; }
  try { context.approval_status = DRAW_APR ? DRAW_APR.getApprovalStatusInfo(drawingId) : null; } catch (e) { context.approval_status = null; }
  try { context.layers = DRAW_LAY ? unwrap(DRAW_LAY.listLayers(drawingId), 'layers') : null; } catch (e) { context.layers = null; }
  try { context.bim_summary = DRAW_BIM ? DRAW_BIM.getBIMSummary(drawingId) : null; } catch (e) { context.bim_summary = null; }
  try { context.comparison_history = DRAW_CMP ? unwrap(DRAW_CMP.listComparisonHistory(drawingId), 'comparisons') : null; } catch (e) { context.comparison_history = null; }

  return context;
}

// ===================== 1) تحليل المخططات الهندسية =====================
/**
 * تحليل شامل لمخطط هندسي واحد: حالته، اكتماله، مخاطره المحتملة بناءً على كل
 * البيانات الفعلية المرتبطة به (الإصدارات، المراجعات، التعليقات، الاعتمادات، الطبقات، BIM).
 */
async function analyzeDrawing({ drawingId }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const context = buildDrawingFullContext(drawingId);

  const system = `أنت مهندس مدني خبير في مراجعة وإدارة المخططات الهندسية (Drawings Management) للمشاريع الإنشائية، ملم بمعايير إدارة الوثائق الهندسية (ISO 19650) والممارسات الهندسية السليمة.
مهمتك تحليل بيانات مخطط هندسي واحد وتقديم تقييم شامل لحالته. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية التالية:
{
  "overall_status_assessment": "تقييم عام موجز لحالة المخطط الحالية",
  "completeness_score": رقم من 0 إلى 100,
  "key_observations": ["ملاحظة مهمة مستخلصة من البيانات"],
  "open_issues": [{"issue": "وصف المشكلة المفتوحة", "severity": "high|medium|low", "source": "من أين استُخلصت (تعليق/مراجعة/اعتماد/تعارض BIM)"}],
  "readiness_for_approval": "ready|needs_revision|blocked",
  "recommended_next_steps": ["خطوة عملية موصى بها"]
}`;

  const userMessage = `بيانات المخطط الأساسية:
${JSON.stringify(context.drawing).slice(0, 2000)}

الإصدارات المسجَّلة:
${JSON.stringify(context.versions).slice(0, 1500)}

المراجعات:
${JSON.stringify(context.reviews).slice(0, 1500)}

التعليقات والملاحظات:
${JSON.stringify(context.comments).slice(0, 1500)}

حالة الاعتماد:
${JSON.stringify(context.approval_status).slice(0, 1000)}

الطبقات:
${JSON.stringify(context.layers).slice(0, 1000)}

ملخص BIM (إن وُجد):
${JSON.stringify(context.bim_summary).slice(0, 1000)}

حلل هذا المخطط بشكل شامل وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, drawing_id: drawingId, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, drawing_id: drawingId, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ===================== 2) اكتشاف التعارضات بين التخصصات =====================
/**
 * يستفيد من اكتشاف التعارضات الهندسي الفعلي (AABB) في drawingBIM.js عند توفر بيانات
 * BIM، ثم يستخدم الذكاء الاصطناعي لتفسير هذه التعارضات وترتيب أولوياتها بلغة هندسية،
 * مع تحليل تكميلي لأي تناقضات وصفية بين المخططات (تخصصات مختلفة لنفس المشروع) حتى
 * بدون بيانات BIM ثلاثية الأبعاد.
 */
async function detectCrossDisciplineConflicts({ projectId = null, drawingId = null } = {}) {
  if (!projectId && !drawingId) throw new Error('يجب توفير projectId أو drawingId على الأقل');

  let bimClashes = [];
  if (drawingId && DRAW_BIM) {
    try { bimClashes = unwrap(DRAW_BIM.listClashes(drawingId), 'clashes') || []; } catch (e) { bimClashes = []; }
  }

  const relatedDrawings = DRAW.listDrawings(projectId ? { project_id: projectId } : {}).slice(0, 40);

  const system = `أنت مهندس تنسيق هندسي (BIM Coordinator) خبير في اكتشاف وتحليل التعارضات بين التخصصات المختلفة (إنشائي/معماري/كهربائي/ميكانيكي) في مشاريع الإنشاءات.
حلل التعارضات الهندسية المكتشَفة فعلياً (إن وُجدت) وقائمة المخططات المرتبطة، واستخرج أي تعارضات إضافية محتملة يمكن استنتاجها من البيانات الوصفية (نفس الموقع/التخصص/الطابق مثلاً). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "confirmed_geometric_clashes_summary": "ملخص للتعارضات الهندسية المؤكدة رقمياً (BIM) إن وُجدت",
  "priority_ranking": [{"clash_reference": "مرجع التعارض أو وصفه", "priority": "critical|high|medium|low", "reasoning": "سبب هذا الترتيب"}],
  "potential_undetected_conflicts": [{"description": "تعارض محتمل غير مؤكد هندسياً بعد", "disciplines_involved": ["تخصص"], "recommendation": "توصية للتحقق"}],
  "coordination_recommendations": ["توصية لتحسين التنسيق بين التخصصات"]
}`;

  const userMessage = `التعارضات الهندسية المكتشَفة فعلياً (Clash Detection - AABB) للمخطط المحدد إن وُجد:
${JSON.stringify(bimClashes).slice(0, 3000)}

قائمة المخططات المرتبطة بالمشروع (تخصص/نوع/حالة):
${JSON.stringify(relatedDrawings.map((d) => ({
    id: d.id, drawing_number: d.drawing_number, name: d.name, discipline: d.discipline, subtype: d.subtype, approval_status: d.approval_status,
  }))).slice(0, 3000)}

حلل التعارضات المؤكدة ورتّبها، واستنتج أي تعارضات محتملة أخرى بين التخصصات وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return {
      success: true, project_id: projectId, drawing_id: drawingId, geometric_clashes_count: bimClashes.length, analysis: extractJson(responseText),
    };
  } catch (e) {
    return {
      success: true, project_id: projectId, drawing_id: drawingId, geometric_clashes_count: bimClashes.length, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.',
    };
  }
}

// ===================== 3) مقارنة المخططات تلقائياً =====================
/**
 * يشغّل مقارنة الإصدارات الفعلية (drawingComparison.compareVersions) بين آخر
 * إصدارين، ثم يستخدم الذكاء الاصطناعي لتلخيص الفروقات وتقييم أثرها الهندسي بلغة
 * مفهومة للمهندس المسؤول.
 */
async function autoCompareVersions({ drawingId, versionA = null, versionB = null }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  if (!DRAW_CMP) throw new Error('وحدة مقارنة المخططات (drawingComparison) غير متاحة على الخادم');

  const versions = DRAW_VER ? unwrap(DRAW_VER.listVersions(drawingId), 'versions') || [] : [];
  let vA = versionA; let vB = versionB;
  if (!vA || !vB) {
    const sorted = [...versions].sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
    if (sorted.length < 2) throw new Error('لا يوجد إصداران على الأقل لإجراء مقارنة تلقائية');
    vB = vB || sorted[0].version_number;
    vA = vA || sorted[1].version_number;
  }

  const comparison = unwrap(DRAW_CMP.compareVersions(drawingId, vA, vB));

  const system = `أنت مهندس مراجعة مخططات خبير. مهمتك تلخيص نتيجة مقارنة تقنية بين إصدارين من نفس المخطط الهندسي (عناصر مضافة/محذوفة/معدَّلة، طبقات، أبعاد، نصوص) بلغة عربية واضحة تخدم المهندس المسؤول. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "change_summary": "ملخص عام للتغييرات بين الإصدارين بجملتين إلى ثلاث",
  "significant_changes": [{"change": "وصف التغيير المهم", "impact_level": "high|medium|low"}],
  "minor_changes_count_estimate": "تقدير لعدد التغييرات البسيطة غير المؤثرة",
  "requires_re_approval": true,
  "reasoning": "سبب الحاجة أو عدم الحاجة لإعادة الاعتماد"
}`;

  const userMessage = `نتيجة المقارنة التقنية الفعلية بين الإصدار ${vA} والإصدار ${vB}:
${JSON.stringify(comparison).slice(0, 5000)}

لخّص هذه المقارنة وقيّم أثرها وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return {
      success: true, drawing_id: drawingId, version_a: vA, version_b: vB, raw_comparison: comparison, ai_summary: extractJson(responseText),
    };
  } catch (e) {
    return {
      success: true, drawing_id: drawingId, version_a: vA, version_b: vB, raw_comparison: comparison, ai_summary_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.',
    };
  }
}

// ===================== 4) اكتشاف العناصر المفقودة =====================
/**
 * يقارن مخططاً معيّناً ببيانات مشابهة (نفس التخصص/النوع) في نفس المشروع أو مقابل
 * القائمة المرجعية القياسية لعناصر هذا النوع من المخططات (مثال: مخطط أساسات
 * يُفترض أن يحتوي على تفاصيل حديد، مناسيب، تفاصيل عزل...) لاكتشاف عناصر متوقعة
 * وغائبة فعلياً من الوصف/الطبقات/الكلمات المفتاحية المسجَّلة.
 */
async function detectMissingElements({ drawingId }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const drawing = getDrawingOrThrow(drawingId);
  const layers = DRAW_LAY ? (unwrap(DRAW_LAY.listLayers(drawingId), 'layers') || []) : [];

  const siblingDrawings = DRAW.listDrawings({
    project_id: drawing.project_id, discipline: drawing.discipline, subtype: drawing.subtype,
  }).filter((d) => d.id !== drawingId).slice(0, 15);

  const system = `أنت مهندس مراجعة فنية خبير في اكتمال المخططات الهندسية حسب تخصصها (إنشائي/معماري/كهربائي/ميكانيكي/طرق/مساحة/BIM). مهمتك اكتشاف العناصر المتوقع وجودها في هذا النوع من المخططات والتي تبدو غائبة بناءً على البيانات الوصفية المتاحة (الوصف، الكلمات المفتاحية، الطبقات المسجَّلة، ومقارنتها بمخططات مشابهة من نفس المشروع إن وُجدت). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "expected_elements_for_this_type": ["عنصر متوقع عادة في هذا النوع من المخططات"],
  "likely_missing_elements": [{"element": "العنصر الذي يبدو مفقوداً", "confidence": "high|medium|low", "reasoning": "سبب الاستنتاج"}],
  "comparison_with_similar_drawings_note": "ملاحظة حول الفرق مقارنة بالمخططات المشابهة في نفس المشروع إن وُجدت بيانات كافية",
  "recommendation": "توصية عملية للمهندس المصمم"
}`;

  const userMessage = `بيانات المخطط:
التخصص: ${drawing.discipline} | النوع الفرعي: ${drawing.subtype || 'غير محدد'}
الاسم: ${drawing.name}
الوصف: ${drawing.description || 'لا يوجد وصف'}
الكلمات المفتاحية: ${JSON.stringify(drawing.keywords || [])}

الطبقات المسجَّلة فعلياً لهذا المخطط:
${JSON.stringify(layers.map((l) => l.name || l.layer_name)).slice(0, 1500)}

مخططات مشابهة (نفس التخصص والنوع) في نفس المشروع للمقارنة:
${JSON.stringify(siblingDrawings.map((d) => ({ name: d.name, description: d.description, keywords: d.keywords }))).slice(0, 2500)}

استنتج العناصر المتوقعة لهذا النوع والعناصر التي تبدو غائبة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, drawing_id: drawingId, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, drawing_id: drawingId, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ===================== 5) مراجعة التوافق مع الأكواد الهندسية =====================
async function reviewCodeCompliance({ drawingId, codeStandard = null }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const drawing = getDrawingOrThrow(drawingId);

  const system = `أنت مهندس مراجعة أكواد بناء خبير، ملم بالأكواد الهندسية الشائعة في السعودية والخليج والعالم العربي (كود البناء السعودي SBC، ACI 318 للخرسانة، AISC للحديد، أكواد السلامة من الحريق NFPA). بناءً على البيانات الوصفية المتاحة للمخطط (وليس تحليل رسم بصري فعلي، وهو قيد يجب توضيحه)، قيّم مدى احتمالية التوافق العام مع الكود الأنسب لتخصص هذا المخطط، واذكر النقاط التي يجب على المهندس المسؤول التحقق منها يدوياً. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "applicable_codes": ["اسم الكود المرجعي الأنسب لهذا التخصص"],
  "compliance_checklist": [{"item": "بند يجب التحقق منه للتوافق مع الكود", "why_it_matters": "أهمية هذا البند"}],
  "general_notes": "ملاحظات عامة حول التوافق بناءً على البيانات المتاحة",
  "limitation_disclaimer": "توضيح أن هذا تقييم أولي بناءً على البيانات الوصفية فقط وليس بديلاً عن مراجعة هندسية معتمدة رسمياً"
}`;

  const userMessage = `بيانات المخطط:
التخصص: ${drawing.discipline} | النوع الفرعي: ${drawing.subtype || 'غير محدد'}
الاسم: ${drawing.name}
الوصف: ${drawing.description || 'لا يوجد وصف'}
الكود المطلوب التحقق منه تحديداً (إن حُدِّد من المستخدم): ${codeStandard || 'غير محدد - استخدم الكود الأنسب للتخصص'}

قيّم احتمالية التوافق مع الكود المناسب وفق البنية المطلوبة، مع الإشارة بوضوح إلى محدودية هذا التقييم.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, drawing_id: drawingId, review: extractJson(responseText) };
  } catch (e) {
    return { success: true, drawing_id: drawingId, review_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ===================== 6) اقتراح تحسينات في التصميم =====================
async function suggestDesignImprovements({ drawingId }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const context = buildDrawingFullContext(drawingId);

  const system = `أنت مستشار تصميم هندسي خبير في تحسين كفاءة التصميم الإنشائي والمعماري (القيمة الهندسية / Value Engineering) لمشاريع الإنشاءات. بناءً على بيانات المخطط وسجل التعليقات والمراجعات الفعلية عليه، اقترح تحسينات تصميمية عملية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "improvement_suggestions": [{"suggestion": "اقتراح تحسين تصميمي محدد", "expected_benefit": "الفائدة المتوقعة (تكلفة/وقت/جودة/سلامة)", "priority": "high|medium|low"}],
  "value_engineering_opportunities": ["فرصة لتوفير التكلفة أو تحسين الكفاءة دون التأثير على الأداء الهندسي"],
  "based_on_feedback_patterns": "ملاحظة حول أنماط متكررة في التعليقات/المراجعات السابقة إن وُجدت وأثرها على الاقتراحات"
}`;

  const userMessage = `بيانات المخطط:
${JSON.stringify(context.drawing).slice(0, 1500)}

سجل التعليقات والملاحظات الفعلية:
${JSON.stringify(context.comments).slice(0, 2500)}

سجل المراجعات الهندسية:
${JSON.stringify(context.reviews).slice(0, 2000)}

اقترح تحسينات تصميمية عملية بناءً على هذه البيانات وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return { success: true, drawing_id: drawingId, suggestions: extractJson(responseText) };
  } catch (e) {
    return { success: true, drawing_id: drawingId, suggestions_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ===================== 7) تحليل تأثير التعديلات على المشروع =====================
async function analyzeRevisionImpact({ drawingId, versionA = null, versionB = null, changeDescription = null }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const drawing = getDrawingOrThrow(drawingId);

  let comparison = null;
  if (DRAW_CMP && (versionA || versionB)) {
    try {
      const versions = DRAW_VER ? unwrap(DRAW_VER.listVersions(drawingId), 'versions') || [] : [];
      const sorted = [...versions].sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
      const vB = versionB || (sorted[0] && sorted[0].version_number);
      const vA = versionA || (sorted[1] && sorted[1].version_number);
      if (vA && vB) comparison = unwrap(DRAW_CMP.compareVersions(drawingId, vA, vB));
    } catch (e) { comparison = null; }
  }

  const relatedDrawings = DRAW.listDrawings({ project_id: drawing.project_id }).filter((d) => d.id !== drawingId).slice(0, 25);

  const system = `أنت مدير مشاريع هندسية خبير في تقييم أثر التعديلات على المخططات (Change Impact Analysis) على التكلفة والجدول الزمني والمخططات الأخرى المرتبطة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "impact_summary": "ملخص عام لأثر هذا التعديل على المشروع",
  "affected_areas": [{"area": "cost|schedule|other_drawings|quality|safety", "description": "وصف الأثر على هذا المجال", "severity": "high|medium|low"}],
  "potentially_affected_drawings": ["اسم أو رقم مخطط آخر قد يتأثر بهذا التعديل بناءً على نفس المشروع/التخصص المرتبط"],
  "recommended_actions_before_proceeding": ["إجراء موصى به قبل اعتماد هذا التعديل"]
}`;

  const userMessage = `بيانات المخطط الأساسية:
${JSON.stringify(drawing).slice(0, 1500)}

وصف التعديل (إن قدَّمه المستخدم): ${changeDescription || 'غير مقدَّم - استنتج من بيانات المقارنة إن وُجدت'}

نتيجة مقارنة الإصدارات الفعلية (إن وُجدت):
${JSON.stringify(comparison).slice(0, 3000)}

مخططات أخرى في نفس المشروع قد تتأثر:
${JSON.stringify(relatedDrawings.map((d) => ({ name: d.name, discipline: d.discipline, subtype: d.subtype }))).slice(0, 2000)}

حلل أثر هذا التعديل على المشروع وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return {
      success: true, drawing_id: drawingId, has_comparison_data: Boolean(comparison), impact_analysis: extractJson(responseText),
    };
  } catch (e) {
    return {
      success: true, drawing_id: drawingId, has_comparison_data: Boolean(comparison), impact_analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.',
    };
  }
}

// ===================== 8) إنشاء ملخصات للمراجعات =====================
/**
 * تلخيص نص مباشر (وليس JSON) لسجل مراجعة أو مجموعة تعليقات على مخطط، مفيد
 * للعرض السريع في لوحة التحكم أو التقارير التنفيذية.
 */
async function summarizeReview({ drawingId, reviewId = null }) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  const drawing = getDrawingOrThrow(drawingId);

  let reviews = [];
  if (DRAW_REV) {
    try {
      const all = unwrap(DRAW_REV.listReviews(drawingId), 'reviews') || [];
      reviews = reviewId ? all.filter((r) => r.id === reviewId) : all;
    } catch (e) { reviews = []; }
  }
  if (reviewId && reviews.length === 0) throw new Error('لم يتم العثور على سجل المراجعة المطلوب تلخيصه');

  let comments = [];
  if (DRAW_CMT) {
    try { comments = unwrap(DRAW_CMT.listComments(drawingId), 'comments') || []; } catch (e) { comments = []; }
  }

  const system = 'أنت مساعد هندسي متخصص في تلخيص مراجعات المخططات. لخّص سجل المراجعة/التعليقات المرسل في فقرة عربية واحدة موجزة (٣ إلى ٥ جمل) تبرز أهم القرارات والملاحظات والإجراءات المطلوبة من المصمم. أجب بنص عادي مباشر دون تنسيق JSON.';
  const userMessage = `المخطط: ${drawing.name} (${drawing.drawing_number})

سجل المراجعات:
${JSON.stringify(reviews).slice(0, 4000)}

التعليقات المرتبطة:
${JSON.stringify(comments).slice(0, 3000)}`;

  const summary = await callClaude({ system, userMessage, maxTokens: 500 });
  return {
    success: true, drawing_id: drawingId, review_id: reviewId, reviews_count: reviews.length, summary: summary.trim(),
  };
}

// ===================== 9) تصنيف المخططات تلقائياً =====================
/**
 * يقترح التخصص/النوع الفرعي/الكلمات المفتاحية الأنسب لمخطط بناءً على اسمه ووصفه
 * الحاليين، مفيد عند رفع مخططات جديدة بأسماء غير منظَّمة أو للتحقق من صحة تصنيف قائم.
 */
async function autoClassifyDrawing({ drawingId = null, name = null, description = null }) {
  let effectiveName = name;
  let effectiveDescription = description;
  let existingDrawing = null;

  if (drawingId) {
    existingDrawing = getDrawingOrThrow(drawingId);
    effectiveName = effectiveName || existingDrawing.name;
    effectiveDescription = effectiveDescription || existingDrawing.description;
  }
  if (!effectiveName) throw new Error('يجب توفير drawingId قائم أو name للتصنيف');

  const taxonomy = DRAW.getTaxonomy();

  const system = `أنت مساعد تصنيف مستندات هندسية خبير في تخصصات المخططات الهندسية (إنشائي/معماري/كهربائي/ميكانيكي/طرق/مساحة/BIM) وأنواعها الفرعية. بناءً على اسم ووصف المخطط، صنِّفه ضمن القائمة المرجعية الفعلية المرسلة إليك حصراً (لا تخترع تصنيفات خارجها). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "suggested_discipline": "المفتاح البرمجي الدقيق للتخصص من القائمة المرسلة",
  "suggested_subtype": "المفتاح البرمجي الدقيق للنوع الفرعي من القائمة المرسلة (إن وُجد نوع مناسب)",
  "confidence": "high|medium|low",
  "suggested_keywords": ["كلمة مفتاحية عربية مناسبة"],
  "reasoning": "سبب هذا التصنيف بجملة واحدة"
}`;

  const userMessage = `اسم المخطط: ${effectiveName}
وصف المخطط: ${effectiveDescription || 'لا يوجد وصف'}
${existingDrawing ? `التصنيف الحالي المسجَّل: التخصص=${existingDrawing.discipline} النوع الفرعي=${existingDrawing.subtype || 'غير محدد'} (قيّم إن كان صحيحاً أو اقترح تصحيحاً)` : ''}

القائمة المرجعية الفعلية للتصنيفات المتاحة في النظام (اختر منها حصراً):
${JSON.stringify(taxonomy.disciplines).slice(0, 4000)}

صنِّف هذا المخطط وفق البنية المطلوبة، مستخدماً المفاتيح البرمجية (key) بدقة كما وردت في القائمة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 800 });
  try {
    return {
      success: true, drawing_id: drawingId, classification: extractJson(responseText),
    };
  } catch (e) {
    return {
      success: true, drawing_id: drawingId, classification_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.',
    };
  }
}

// ===================== 10) إنشاء تقارير تحليلية للإدارة =====================
/**
 * يبني فوق لوحة التحكم الفعلية (drawingManagement.getDashboardStats) وتقرير
 * الملخص التنفيذي الفعلي (drawingReports.buildExecutiveSummaryReport) عند توفره،
 * ثم يستخدم الذكاء الاصطناعي لإنتاج تحليل نصي إداري (وليس مجرد أرقام) حول اتجاهات
 * أداء إدارة المخططات في المشروع أو النظام ككل.
 */
async function generateManagementInsightReport({ projectId = null } = {}) {
  const dashboard = DRAW.getDashboardStats();
  let executiveSummary = null;
  if (DRAW_REP) {
    try {
      executiveSummary = DRAW_REP.buildExecutiveSummaryReport({ projectId });
    } catch (e) { executiveSummary = null; }
  }

  const system = `أنت مستشار إداري خبير في تحليل أداء إدارة المستندات والمخططات الهندسية للمشاريع الإنشائية. مهمتك تحويل الأرقام والإحصائيات الفعلية المرسلة إلى تحليل إداري مفهوم يفيد متخذ القرار (مدير المشروع/الاستشاري). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "executive_headline": "جملة واحدة تلخّص أهم استنتاج إداري من البيانات",
  "performance_insights": [{"insight": "استنتاج إداري مبني على الأرقام الفعلية", "supporting_data": "الرقم أو النسبة التي تدعم هذا الاستنتاج"}],
  "bottlenecks_detected": ["عنق زجاجة أو تأخير محتمل في دورة اعتماد المخططات مستنتج من البيانات"],
  "recommendations_for_management": ["توصية عملية لمدير المشروع أو الإدارة"]
}`;

  const userMessage = `إحصائيات لوحة التحكم الفعلية لقسم المخططات:
${JSON.stringify(dashboard).slice(0, 4000)}

تقرير الملخص التنفيذي الفعلي (إن وُجد):
${JSON.stringify(executiveSummary).slice(0, 3000)}

حوّل هذه البيانات إلى تحليل إداري مفيد وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2200 });
  try {
    return {
      success: true, project_id: projectId, report: extractJson(responseText), raw_stats: dashboard.totals,
    };
  } catch (e) {
    return {
      success: true, project_id: projectId, report_raw: responseText, raw_stats: dashboard.totals, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.',
    };
  }
}

module.exports = {
  isAIAvailable,
  analyzeDrawing,
  detectCrossDisciplineConflicts,
  autoCompareVersions,
  detectMissingElements,
  reviewCodeCompliance,
  suggestDesignImprovements,
  analyzeRevisionImpact,
  summarizeReview,
  autoClassifyDrawing,
  generateManagementInsightReport,
};
