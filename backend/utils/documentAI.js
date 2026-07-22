/**
 * القسم الحادي عشر - نظام إدارة المستندات (DMS)
 * وحدة المساعد الذكي (Document AI Assistant)
 * =====================================================================================
 * واجهة موحّدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات إدارة المستندات:
 *  - التصنيف التلقائي للمستندات (اقتراح النوع/المجلد المناسب)
 *  - استخراج البيانات المهمة من محتوى الملفات المفهرسة (PDF/Word)
 *  - تلخيص التقارير والمستندات الطويلة
 *  - البحث الدلالي داخل المستندات (وليس فقط المطابقة الحرفية)
 *  - اكتشاف المستندات المكررة أو شبه المكررة
 *  - اقتراح كلمات مفتاحية مناسبة للمستند
 *  - اكتشاف المستندات الناقصة مقارنة بمتطلبات المشروع القياسية
 *  - إنشاء ملخصات تنفيذية لحالة المستندات في مشروع
 *  - تحليل العقود والتقارير الفنية واستخراج البنود الجوهرية
 *  - اقتراح مسار الاعتماد (Workflow) الأنسب لمستند جديد
 *
 * ملاحظة مهمة: هذه الوحدة لا تحتوي على مفتاح API مباشرة؛ يجب تمرير المفتاح
 * عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون المفتاح تعمل جميع
 * وظائف إدارة المستندات الأساسية (الرفع، الإصدارات، البحث، الاعتماد، التوقيع،
 * المشاركة، التقارير...) بشكل طبيعي وكامل دون أي اعتماد على الذكاء الاصطناعي؛
 * فقط ميزات هذا الملف تتطلبه.
 */

const https = require('https');

const DMS = require('./documentManagement');
const DMS_SEARCH = require('./documentSearch');
const DMS_CAT = require('./documentCategories');
const DMS_WF = require('./documentWorkflow');

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

function getIndexedContent(documentId) {
  try {
    return DMS_SEARCH.getIndexedContentText(documentId);
  } catch (e) {
    return null;
  }
}

// ==================================================================================
// ===================== 1) التصنيف التلقائي للمستندات ==============================
// ==================================================================================

/** يقترح نوع المستند/المجلد/الكلمات المفتاحية المناسبة بناءً على العنوان والوصف والمحتوى المتاح */
async function classifyDocument({ documentId = null, title = null, description = null, contentSnippet = null } = {}) {
  let doc = null;
  let content = contentSnippet;
  if (documentId) {
    doc = unwrap(DMS.getDocument(documentId));
    if (!content) content = getIndexedContent(documentId);
  }

  const categoriesTree = unwrap(DMS_CAT.getCategoryTree());

  const system = `أنت خبير في تصنيف وأرشفة المستندات الهندسية والإدارية لمشاريع الإنشاءات وفق أفضل ممارسات إدارة الوثائق (ISO 19650 / أنظمة DMS الهندسية).
حلل بيانات المستند المرسلة واقترح التصنيف الأنسب له. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "suggested_doc_type": "نوع المستند المقترح (مثال: contract, drawing, specification, report, correspondence, meeting_minutes, change_order, work_order, purchase_order, quality_plan, inspection_request, ncr, test_result, safety_plan, invoice...)",
  "suggested_category_path": ["اسم المجلد الرئيسي", "اسم المجلد الفرعي إن وجد"],
  "suggested_keywords": ["كلمة مفتاحية مقترحة"],
  "confidence": "high|medium|low",
  "reasoning": "تفسير موجز لسبب هذا التصنيف"
}`;

  const userMessage = `عنوان المستند: ${title || doc?.title || 'غير محدد'}
الوصف: ${description || doc?.description || 'لا يوجد'}
نوع المستند الحالي (إن وُجد): ${doc?.doc_type_label || 'غير مصنّف بعد'}
مقتطف من محتوى الملف (إن توفر): ${(content || 'لا يوجد محتوى نصي متاح').slice(0, 3000)}

شجرة المجلدات الحالية في النظام (للاختيار من بينها إن أمكن):
${JSON.stringify(categoriesTree).slice(0, 2000)}

اقترح التصنيف الأنسب وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1200 });
  try {
    return { success: true, document_id: documentId, classification: extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, classification_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 2) استخراج البيانات المهمة من الملفات ======================
// ==================================================================================

/** يستخرج البيانات والبنود الجوهرية من محتوى مستند مفهرس (تواريخ، أطراف، مبالغ، التزامات) */
async function extractKeyData({ documentId }) {
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');
  const doc = unwrap(DMS.getDocument(documentId));
  if (!doc) throw new Error('لم يتم العثور على المستند المطلوب');

  const content = getIndexedContent(documentId);
  if (!content) {
    throw new Error('لا يوجد محتوى نصي مفهرَس لهذا المستند (فهرسة المحتوى تدعم حالياً PDF وWord فقط). يمكن فهرسته أولاً عبر documentSearch.indexDocument');
  }

  const system = `أنت محلل مستندات هندسية وعقود خبير في مشاريع الإنشاءات.
استخرج البيانات والبنود الجوهرية من نص المستند المرسل. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "document_kind_guess": "تخمين نوع المستند بناءً على المحتوى",
  "key_dates": [{"label": "وصف التاريخ", "date_text": "التاريخ كما ورد في النص"}],
  "parties_mentioned": ["اسم طرف/جهة مذكورة"],
  "monetary_values": [{"label": "وصف المبلغ", "value_text": "المبلغ كما ورد"}],
  "key_obligations": ["التزام أو بند جوهري"],
  "risks_or_flags": ["نقطة تستدعي الانتباه أو المراجعة"],
  "summary": "ملخص من جملتين إلى ثلاث لأهم ما ورد في المستند"
}`;

  const userMessage = `عنوان المستند: ${doc.title}
نوع المستند: ${doc.doc_type_label}

محتوى المستند (قد يكون مقتطفاً من نص أطول):
${content.slice(0, 8000)}

استخرج البيانات الجوهرية وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    return { success: true, document_id: documentId, extracted: extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, extracted_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 3) تلخيص التقارير والمستندات الطويلة =======================
// ==================================================================================

/** يلخص محتوى مستند طويل (تقرير، عقد، محضر اجتماع...) إلى ملخص موجز */
async function summarizeDocument({ documentId, style = 'brief' } = {}) {
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');
  const doc = unwrap(DMS.getDocument(documentId));
  if (!doc) throw new Error('لم يتم العثور على المستند المطلوب');

  const content = getIndexedContent(documentId);
  if (!content) {
    throw new Error('لا يوجد محتوى نصي مفهرَس لهذا المستند لتلخيصه (فهرسة المحتوى تدعم حالياً PDF وWord فقط)');
  }

  const styleInstruction = style === 'executive'
    ? 'قدّم ملخصاً تنفيذياً موجّهاً للإدارة العليا (نقاط قرار، مخاطر، توصيات).'
    : 'قدّم ملخصاً موجزاً وواضحاً لمحتوى المستند.';

  const system = `أنت مساعد ذكي متخصص في تلخيص المستندات الهندسية والإدارية والتقارير الفنية لمشاريع الإنشاءات بالعربية الفصحى.
${styleInstruction} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "summary": "نص الملخص",
  "key_points": ["نقطة رئيسية"],
  "action_items": ["إجراء مطلوب إن وُجد"]
}`;

  const userMessage = `عنوان المستند: ${doc.title}
نوع المستند: ${doc.doc_type_label}

المحتوى الكامل (أو مقتطف منه):
${content.slice(0, 10000)}

لخّص هذا المستند وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1800 });
  try {
    return { success: true, document_id: documentId, summary: extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, summary_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 4) البحث الدلالي داخل المستندات ============================
// ==================================================================================

/** بحث دلالي: يفهم نية السؤال وليس فقط تطابق الكلمات الحرفي، بالاعتماد على نتائج البحث النصي كمرشّحات أولية */
async function semanticSearch({ query, projectId = null, topCandidates = 20 } = {}) {
  if (!query || !String(query).trim()) throw new Error('نص الاستعلام (query) مطلوب');

  // مرحلة أولى: نجلب مرشحين عبر البحث النصي/الفوقي التقليدي لتضييق النطاق قبل تمريره للنموذج
  const textResults = unwrap(DMS_SEARCH.search({ q: query, projectId, includeContent: true, pageSize: topCandidates }));
  const candidates = (textResults || []).map((d) => ({
    id: d.id,
    document_number: d.document_number,
    title: d.title,
    doc_type_label: d.doc_type_label,
    status: d.status,
    keywords: d.keywords,
    snippet: d._snippet || null,
  }));

  if (!candidates.length) {
    return { success: true, query, results: [], note: 'لا توجد مستندات مطابقة حتى كمرشحين أوليين للبحث النصي.' };
  }

  const system = `أنت محرك بحث دلالي ذكي لنظام إدارة مستندات هندسية. مهمتك ترتيب وتفسير مدى صلة المستندات المرشّحة بنية المستخدم من البحث، حتى لو لم تتطابق الكلمات حرفياً.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "ranked_results": [{"document_id": "المعرّف كما ورد", "relevance": "high|medium|low", "why_relevant": "تفسير موجز لسبب الصلة بنية البحث"}],
  "interpreted_intent": "تفسير موجز لما يبحث عنه المستخدم فعلياً"
}`;

  const userMessage = `استعلام المستخدم: "${query}"

المستندات المرشّحة (نتائج بحث نصي أولية):
${JSON.stringify(candidates).slice(0, 6000)}

رتّب هذه المستندات حسب الصلة الفعلية بنية البحث وفق البنية المطلوبة، ولا تُدرج مستندات غير موجودة في القائمة أعلاه.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1800 });
  try {
    const parsed = extractJson(responseText);
    return { success: true, query, semantic: parsed, candidates };
  } catch (e) {
    return { success: true, query, semantic_raw: responseText, candidates, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 5) اكتشاف المستندات المكررة ================================
// ==================================================================================

/** يفحص مجموعة مستندات (مشروع أو الكل) لاكتشاف تكرارات محتملة بناءً على العنوان/الرقم/الوصف/checksum */
async function detectDuplicateDocuments({ projectId = null } = {}) {
  const list = unwrap(DMS.listDocuments({ projectId, pageSize: 300 }));
  const items = (list || []).map((d) => ({
    id: d.id,
    document_number: d.document_number,
    title: d.title,
    doc_type: d.doc_type,
    description: d.description,
    keywords: d.keywords,
    created_at: d.created_at,
  }));

  if (items.length < 2) {
    return { success: true, project_id: projectId, duplicate_groups: [], note: 'عدد المستندات غير كافٍ لفحص التكرار.' };
  }

  // فحص أولي حتمي (بدون AI): تطابق checksum لإصدارات مختلفة يعني نفس محتوى الملف بالضبط
  const store = unwrap(DMS.listDocuments({ projectId, pageSize: 300 }));
  const exactDuplicatesByTitle = {};
  for (const d of items) {
    const key = d.title.trim().toLowerCase();
    if (!exactDuplicatesByTitle[key]) exactDuplicatesByTitle[key] = [];
    exactDuplicatesByTitle[key].push(d.id);
  }
  const deterministicGroups = Object.entries(exactDuplicatesByTitle)
    .filter(([, ids]) => ids.length > 1)
    .map(([title, ids]) => ({ reason: 'تطابق تام في العنوان', title, document_ids: ids }));

  const system = `أنت خبير في إدارة الوثائق الهندسية ومهمتك اكتشاف المستندات المكررة أو شبه المكررة (Near-duplicates) بناءً على العنوان والوصف والكلمات المفتاحية، حتى لو اختلفت الصياغة قليلاً (مثال: "تقرير السلامة - يناير" و"تقرير السلامة الشهري - يناير 2026").
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "likely_duplicate_groups": [{"document_ids": ["معرّف1", "معرّف2"], "similarity_reason": "سبب الاشتباه بالتكرار", "confidence": "high|medium|low"}]
}`;

  const userMessage = `قائمة المستندات (حتى 300):
${JSON.stringify(items).slice(0, 8000)}

اكتشف مجموعات المستندات المكررة أو شبه المكررة المحتملة وفق البنية المطلوبة، مستخدماً فقط المعرّفات (id) الواردة في القائمة أعلاه.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2000 });
  try {
    const aiGroups = extractJson(responseText);
    return {
      success: true,
      project_id: projectId,
      deterministic_duplicate_groups: deterministicGroups,
      ai_duplicate_groups: aiGroups.likely_duplicate_groups || [],
    };
  } catch (e) {
    return {
      success: true,
      project_id: projectId,
      deterministic_duplicate_groups: deterministicGroups,
      ai_duplicate_groups_raw: responseText,
      warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام مع نتائج الفحص الحتمي.',
    };
  }
}

// ==================================================================================
// ===================== 6) اقتراح الكلمات المفتاحية ================================
// ==================================================================================

/** يقترح كلمات مفتاحية مناسبة لمستند بناءً على عنوانه ووصفه ومحتواه المتاح */
async function suggestKeywords({ documentId = null, title = null, description = null } = {}) {
  let doc = null;
  let content = null;
  if (documentId) {
    doc = unwrap(DMS.getDocument(documentId));
    content = getIndexedContent(documentId);
  }

  const system = `أنت خبير أرشفة مستندات هندسية. اقترح كلمات مفتاحية (Tags) دقيقة ومفيدة للبحث لاحقاً عن هذا المستند.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "suggested_keywords": ["كلمة مفتاحية قصيرة"]
}`;

  const userMessage = `عنوان المستند: ${title || doc?.title || 'غير محدد'}
الوصف: ${description || doc?.description || 'لا يوجد'}
نوع المستند: ${doc?.doc_type_label || 'غير محدد'}
مقتطف من المحتوى (إن توفر): ${(content || 'لا يوجد').slice(0, 2000)}

اقترح من 5 إلى 10 كلمات مفتاحية مناسبة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 600 });
  try {
    return { success: true, document_id: documentId, ...extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, suggestion_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 7) اكتشاف المستندات الناقصة ================================
// ==================================================================================

/** يقارن المستندات الموجودة في مشروع بقائمة مستندات قياسية متوقعة ويحدد الناقص منها */
async function detectMissingDocuments({ projectId } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const list = unwrap(DMS.listDocuments({ projectId, pageSize: 300 }));
  const existingTypes = [...new Set((list || []).map((d) => d.doc_type_label))];
  const existingTitles = (list || []).map((d) => d.title);

  const system = `أنت مستشار إدارة وثائق مشاريع إنشائية خبير بالمستندات القياسية المطلوبة في أي مشروع (عقود، مخططات، مواصفات فنية، جداول كميات، خطط جودة وسلامة، تقارير دورية، محاضر اجتماعات...).
بناءً على المستندات الموجودة فعلياً في المشروع، حدد المستندات القياسية المهمة التي يبدو أنها ناقصة أو غير مرفوعة بعد.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "likely_missing_documents": [{"document_type": "نوع المستند المتوقع غيابه", "importance": "critical|high|medium", "reasoning": "سبب الاعتقاد بأنه مفقود"}],
  "coverage_assessment": "تقييم عام موجز لمدى اكتمال أرشيف المشروع"
}`;

  const userMessage = `أنواع المستندات الموجودة حالياً في المشروع: ${JSON.stringify(existingTypes)}
عناوين بعض المستندات الموجودة (عيّنة حتى 300): ${JSON.stringify(existingTitles).slice(0, 4000)}
إجمالي عدد المستندات المرفوعة: ${(list || []).length}

حدد المستندات القياسية التي يبدو أنها ناقصة وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1500 });
  try {
    return { success: true, project_id: projectId, gap_analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, project_id: projectId, gap_analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 8) إنشاء ملخصات تنفيذية ====================================
// ==================================================================================

/** ينشئ ملخصاً تنفيذياً لحالة أرشيف المستندات في مشروع معيّن (أو النظام كاملاً) */
async function generateExecutiveSummary({ projectId = null } = {}) {
  const dashboard = unwrap(DMS.getDashboard(projectId));

  const system = `أنت مساعد تنفيذي متخصص في إدارة الوثائق الهندسية. مهمتك تحويل بيانات لوحة تحكم نظام إدارة المستندات إلى ملخص تنفيذي واضح وموجّه للإدارة العليا بالعربية الفصحى.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "executive_summary": "فقرة ملخص تنفيذي من 3 إلى 5 جمل",
  "highlights": ["نقطة إيجابية أو لافتة"],
  "concerns": ["نقطة تستدعي انتباه الإدارة"],
  "recommended_actions": ["إجراء تنفيذي موصى به"]
}`;

  const userMessage = `بيانات لوحة تحكم إدارة المستندات:
${JSON.stringify(dashboard).slice(0, 4000)}

أنشئ ملخصاً تنفيذياً وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1200 });
  try {
    return { success: true, project_id: projectId, executive_summary: extractJson(responseText) };
  } catch (e) {
    return { success: true, project_id: projectId, executive_summary_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 9) تحليل العقود والتقارير الفنية ============================
// ==================================================================================

/** يحلل عقداً أو تقريراً فنياً محدداً ويستخرج تحليلاً معمّقاً (بنود، مخاطر، التزامات، تواريخ حرجة) */
async function analyzeContractOrReport({ documentId }) {
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');
  const doc = unwrap(DMS.getDocument(documentId));
  if (!doc) throw new Error('لم يتم العثور على المستند المطلوب');

  const content = getIndexedContent(documentId);
  if (!content) {
    throw new Error('لا يوجد محتوى نصي مفهرَس لهذا المستند لتحليله (فهرسة المحتوى تدعم حالياً PDF وWord فقط)');
  }

  const system = `أنت مستشار عقود ومهندس مراجعة فنية خبير في عقود الإنشاءات (FIDIC وما شابهها) والتقارير الفنية الهندسية.
حلل نص المستند المرسل تحليلاً معمّقاً. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "document_type_assessment": "تقييمك لنوع المستند الفعلي بناءً على المحتوى",
  "critical_clauses": [{"clause_summary": "ملخص البند", "importance": "critical|high|medium", "note": "ملاحظة أو مخاطرة مرتبطة"}],
  "critical_dates": [{"label": "وصف الموعد", "date_text": "التاريخ كما ورد"}],
  "financial_terms": [{"label": "وصف البند المالي", "value_text": "القيمة كما وردت"}],
  "risks": ["مخاطرة تعاقدية أو فنية محتملة"],
  "overall_assessment": "تقييم عام موجز للمستند"
}`;

  const userMessage = `عنوان المستند: ${doc.title}
نوع المستند: ${doc.doc_type_label}

محتوى المستند:
${content.slice(0, 10000)}

قدّم تحليلاً معمّقاً وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 2500 });
  try {
    return { success: true, document_id: documentId, analysis: extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, analysis_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

// ==================================================================================
// ===================== 10) اقتراح مسار الاعتماد المناسب ============================
// ==================================================================================

/** يقترح مسار اعتماد (Workflow) مناسباً لمستند بناءً على نوعه وأهميته، بالاستفادة من مسارات العمل المعرّفة فعلياً */
async function suggestApprovalWorkflow({ documentId }) {
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');
  const doc = unwrap(DMS.getDocument(documentId));
  if (!doc) throw new Error('لم يتم العثور على المستند المطلوب');

  const existingWorkflows = unwrap(DMS_WF.listWorkflows());
  const activeWorkflowForType = unwrap(DMS_WF.getActiveWorkflow(doc.doc_type));

  const system = `أنت خبير في تصميم مسارات اعتماد المستندات (Document Approval Workflows) في مشاريع الإنشاءات.
بناءً على نوع المستند ومسارات الاعتماد المعرّفة فعلياً في النظام، اقترح المسار الأنسب لهذا المستند، أو اقترح مساراً جديداً إن لم يوجد مسار مناسب.
أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي:
{
  "recommended_existing_workflow_id": "معرّف مسار موجود مناسب إن وُجد، أو null",
  "suggested_new_stages": [{"stage_name": "اسم المرحلة", "approver_role": "الدور المسؤول عن الاعتماد في هذه المرحلة", "reasoning": "سبب إضافة هذه المرحلة"}],
  "priority_level": "critical|high|medium|low",
  "reasoning": "تفسير عام للتوصية"
}`;

  const userMessage = `عنوان المستند: ${doc.title}
نوع المستند: ${doc.doc_type_label}
حالة المستند الحالية: ${doc.status}

مسار الاعتماد النشط حالياً لهذا النوع من المستندات (إن وُجد):
${JSON.stringify(activeWorkflowForType).slice(0, 1500)}

جميع مسارات الاعتماد المعرّفة في النظام (للاختيار من بينها إن أمكن):
${JSON.stringify(existingWorkflows).slice(0, 2500)}

اقترح مسار الاعتماد الأنسب وفق البنية المطلوبة.`;

  const responseText = await callClaude({ system, userMessage, maxTokens: 1500 });
  try {
    return { success: true, document_id: documentId, workflow_suggestion: extractJson(responseText) };
  } catch (e) {
    return { success: true, document_id: documentId, workflow_suggestion_raw: responseText, warning: 'تعذر تحويل استجابة الذكاء الاصطناعي إلى JSON منظم؛ تم إرجاع النص الخام.' };
  }
}

module.exports = {
  isAIAvailable,
  classifyDocument,
  extractKeyData,
  summarizeDocument,
  semanticSearch,
  detectDuplicateDocuments,
  suggestKeywords,
  detectMissingDocuments,
  generateExecutiveSummary,
  analyzeContractOrReport,
  suggestApprovalWorkflow,
};
