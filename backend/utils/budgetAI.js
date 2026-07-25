/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * ===================================================================
 * الجزء العاشر (10/10) - جزء (أ): المساعد الذكي المالي (Financial AI Assistant)
 * ===================================================================
 *
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات الميزانية،
 * مبنية بنفس أسلوب وحدات الذكاء الاصطناعي القائمة في بقية أقسام النظام
 * (drawingAI.js / hseAI.js / qmsAI.js / surveyAI.js / documentAI.js): بدون أي SDK
 * خارجي، استدعاء https المدمجة في Node مباشرة إلى واجهة Claude، وبدون تخزين مفتاح
 * API داخل الكود.
 *
 * يغطي هذا الملف البنود التسعة لـ"الذكاء الاصطناعي" من مواصفة القسم الثالث عشر
 * الأصلية:
 *  1. تحليل الأداء المالي للمشاريع        → analyzeFinancialPerformance
 *  2. التنبؤ بتجاوز الميزانية              → predictBudgetOverrun
 *  3. اكتشاف المصروفات غير الطبيعية        → detectAnomalousExpenses
 *  4. توقع التكلفة النهائية للمشروع        → forecastFinalCost (يفسّر EAC/ETC)
 *  5. اقتراح طرق تقليل التكاليف            → suggestCostReductions
 *  6. تحليل أسباب الانحرافات               → analyzeDeviationRootCauses
 *  7. مقارنة تكلفة المشاريع السابقة        → compareHistoricalProjectCosts
 *  8. اقتراح أفضل قرارات الشراء            → suggestProcurementDecisions
 *  9. إنشاء تقارير مالية تلقائية للإدارة   → generateManagementFinancialBrief
 *
 * ملاحظة مهمة (نفس قيد بقية وحدات AI في النظام): هذه الوحدة لا تحتوي على مفتاح API
 * مباشرة؛ يجب تمريره عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون
 * المفتاح يعمل قسم الميزانية بالكامل (الإنشاء، BBS، التكاليف، الإيرادات، أوامر
 * التغيير، EVM، التدفقات النقدية، الموافقات، الفواتير، التقارير، التكامل مع بقية
 * الأقسام) بشكل طبيعي دون أي اعتماد على الذكاء الاصطناعي؛ فقط ميزات هذا الملف
 * تحديداً تتطلبه، وتُرجع خطأً واضحاً بالعربية عند غيابه.
 *
 * منهجية أمانة البيانات: كل دالة تبني سياقها من بيانات حقيقية مخزَّنة فعلياً عبر
 * الوحدات القائمة (budgetManagement / budgetReports / budgetIntegrations) — لا
 * بيانات وهمية ولا نصوص ثابتة؛ الذكاء الاصطناعي يحلل فعلياً ما هو مخزَّن على القرص
 * وقت الاستدعاء.
 */

const https = require('https');

const BUDGET = require('./budgetManagement');
const REPORTS = require('./budgetReports');
let INTEG = null;
try { INTEG = require('./budgetIntegrations'); } catch (e) { INTEG = null; }

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

function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

/** بعض دوال budgetManagement تُرجع {success, data} وبعضها يُرجع البيانات مباشرة؛
 * هذه الدالة تستخرج البيانات الفعلية بأمان في الحالتين دون افتراض بنية واحدة. */
function unwrapData(result) {
  if (result && typeof result === 'object' && 'success' in result && 'data' in result) return result.data;
  return result;
}

function getBudgetOrThrow(budgetId) {
  const budget = BUDGET.getBudget(budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');
  return budget;
}

/** يجمع كل السياق المالي المتاح فعلياً حول ميزانية معيّنة من مختلف وحدات القسم */
function buildBudgetFullContext(budgetId) {
  const budget = getBudgetOrThrow(budgetId);

  const context = { budget: unwrapData(BUDGET.getBudget(budgetId)) };
  context.evm = safe(() => unwrapData(BUDGET.getBudgetEVM(budgetId)));
  context.deviation = safe(() => unwrapData(BUDGET.getDeviationAnalysis(budgetId)));
  context.actual_costs_overview = safe(() => unwrapData(BUDGET.listActualCosts(budgetId, { pageSize: 500 })));
  context.revenue_summary = safe(() => unwrapData(BUDGET.getRevenueSummary(budgetId)));
  context.cash_flow = safe(() => unwrapData(BUDGET.getComprehensiveCashFlow(budgetId)));
  context.change_orders = safe(() => unwrapData(BUDGET.getChangeOrdersOverview(budgetId)));
  context.invoice_summary = safe(() => unwrapData(BUDGET.getInvoiceSummary(budgetId)));
  context.pending_approvals = safe(() => unwrapData(BUDGET.getPendingApprovalsOverview()));
  context.integrations = safe(() => (INTEG ? INTEG.getFullIntegrationOverview(budgetId) : null));

  return context;
}

function trimForPrompt(obj, maxChars = 3500) {
  const str = JSON.stringify(obj);
  return str.length > maxChars ? str.slice(0, maxChars) + ' …(مقتطَع)' : str;
}

// ===================== 1) تحليل الأداء المالي للمشاريع =====================
/**
 * تحليل شامل للأداء المالي لميزانية مشروع واحد بناءً على كل البيانات الفعلية
 * (EVM، الانحرافات، التكاليف الفعلية، الإيرادات، التدفق النقدي).
 */
async function analyzeFinancialPerformance({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const context = buildBudgetFullContext(budgetId);

  const system = `أنت مدير مالي هندسي خبير (CFO) متخصص في المشاريع الإنشائية، ملم بمعايير إدارة القيمة المكتسبة (EVM) ومبادئ PMIS/ERP المالية.
مهمتك تحليل الأداء المالي الفعلي لمشروع واحد بناءً على البيانات المزوَّدة وتقديم تقييم شامل. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية التالية:
{
  "overall_financial_health": "excellent|good|warning|critical",
  "summary": "ملخص عام موجز للأداء المالي الحالي",
  "key_metrics_interpretation": [{"metric": "اسم المؤشر (مثال CPI)", "value": "القيمة", "interpretation": "تفسير عملي"}],
  "strengths": ["نقطة قوة مالية فعلية مستخلصة من البيانات"],
  "risks": [{"risk": "وصف الخطر المالي", "severity": "high|medium|low", "evidence": "من أين استُخلص من البيانات"}],
  "recommended_actions": ["إجراء عملي موصى به"]
}`;

  const userMessage = `بيانات الميزانية الأساسية:
${trimForPrompt(context.budget)}

مؤشرات القيمة المكتسبة (EVM):
${trimForPrompt(context.evm)}

تحليل الانحرافات حسب المرحلة:
${trimForPrompt(context.deviation)}

ملخص الإيرادات والتحصيل:
${trimForPrompt(context.revenue_summary)}

التدفق النقدي الشامل:
${trimForPrompt(context.cash_flow)}

ملخص الفواتير:
${trimForPrompt(context.invoice_summary)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2200 });
  return { budget_id: budgetId, analysis: extractJson(response) };
}

// ===================== 2) التنبؤ بتجاوز الميزانية =====================
/**
 * تنبؤ فعلي بتجاوز الميزانية بناءً على CPI/SPI/EAC/VAC المحسوبة فعلياً في 6/10،
 * مع تفسير الاحتمالية ومدى الثقة بناءً على نضج البيانات (عدد التكاليف المسجَّلة).
 */
async function predictBudgetOverrun({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const context = buildBudgetFullContext(budgetId);
  if (!context.evm) throw new Error('تعذر حساب مؤشرات EVM لهذه الميزانية؛ تأكد من وجود بنود BBS وتكاليف فعلية مسجَّلة');

  const system = `أنت محلل مالي هندسي متخصص في التنبؤ بمخاطر تجاوز الميزانية للمشاريع الإنشائية بالاعتماد على مؤشرات القيمة المكتسبة (EVM) الفعلية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "overrun_likelihood": "very_low|low|medium|high|very_high",
  "confidence_level": "low|medium|high (بناءً على نضج البيانات ونسبة الإنجاز الحالية)",
  "projected_final_cost_bac_comparison": "مقارنة نصية بين EAC وBAC",
  "explanation": "شرح سبب هذا التقدير استناداً إلى CPI/SPI/VAC الفعلية",
  "early_warning_indicators": ["مؤشر إنذار مبكر فعلي من البيانات"],
  "recommended_corrective_actions": ["إجراء تصحيحي عملي"]
}`;

  const userMessage = `مؤشرات EVM الفعلية لهذه الميزانية:
${trimForPrompt(context.evm)}

تحليل الانحرافات حسب المرحلة:
${trimForPrompt(context.deviation)}

أوامر التغيير (قد تفسّر جزءاً من الانحراف):
${trimForPrompt(context.change_orders)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1800 });
  return { budget_id: budgetId, prediction: extractJson(response) };
}

// ===================== 3) اكتشاف المصروفات غير الطبيعية =====================
/**
 * تحليل إحصائي + AI على قائمة التكاليف الفعلية الحقيقية (actual_costs) لاكتشاف
 * بنود شاذة (قيمة أعلى بشكل غير معتاد عن متوسط فئتها، أو تكرار غير منطقي).
 */
async function detectAnomalousExpenses({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const budget = getBudgetOrThrow(budgetId);
  const actualCostsResult = BUDGET.listActualCosts(budgetId, { pageSize: 10000 });
  const items = actualCostsResult?.items || actualCostsResult?.data?.items || [];

  if (!items.length) {
    return { budget_id: budgetId, anomalies: [], note: 'لا توجد تكاليف فعلية مسجَّلة بعد لتحليلها' };
  }

  // تحليل إحصائي أولي حقيقي (ليس بواسطة AI) لكل فئة: المتوسط والانحراف المعياري
  const byCategory = {};
  for (const it of items) {
    const cat = it.category || 'أخرى';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(Number(it.amount) || 0);
  }
  const stats = {};
  for (const [cat, amounts] of Object.entries(byCategory)) {
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    stats[cat] = { mean: Math.round(mean * 100) / 100, std_dev: Math.round(stdDev * 100) / 100, count: amounts.length };
  }
  const flaggedStatistically = items.filter((it) => {
    const cat = it.category || 'أخرى';
    const s = stats[cat];
    if (!s || s.std_dev === 0) return false;
    return Math.abs((Number(it.amount) || 0) - s.mean) > 2 * s.std_dev;
  });

  const system = `أنت محلل مراجعة مالية داخلية (Internal Audit) متخصص في اكتشاف المصروفات غير الطبيعية في المشاريع الإنشائية. سيُزوَّدك بتحليل إحصائي مبدئي فعلي (بنود تجاوزت انحرافين معياريين عن متوسط فئتها) بالإضافة لكامل قائمة التكاليف. مهمتك تدقيق هذه القائمة وتقديم تقييم نهائي. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "anomalies": [{"cost_item_id": "معرّف البند إن وُجد", "category": "الفئة", "amount": رقم, "reason": "سبب اعتباره شاذاً", "risk_level": "high|medium|low"}],
  "patterns_detected": ["نمط متكرر مثير للريبة إن وُجد (مثال: تكرار مبالغ متطابقة تماماً)"],
  "overall_assessment": "تقييم عام لمدى سلامة المصروفات المسجَّلة"
}`;

  const userMessage = `التحليل الإحصائي المبدئي (المتوسط والانحراف المعياري لكل فئة):
${trimForPrompt(stats)}

البنود التي تجاوزت انحرافين معياريين إحصائياً:
${trimForPrompt(flaggedStatistically)}

كامل قائمة التكاليف الفعلية (${items.length} بند):
${trimForPrompt(items, 4500)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2200 });
  return { budget_id: budgetId, statistical_flags: flaggedStatistically, category_stats: stats, ai_review: extractJson(response) };
}

// ===================== 4) توقع التكلفة النهائية للمشروع =====================
/**
 * يبني على EAC/ETC المحسوبة رياضياً فعلياً في computeEVM، ويضيف تفسيراً ذكياً
 * وسيناريوهات (متفائل/محايد/متشائم) دون اختراع أرقام أساسية جديدة.
 */
async function forecastFinalCost({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const context = buildBudgetFullContext(budgetId);
  if (!context.evm) throw new Error('تعذر حساب مؤشرات EVM لهذه الميزانية');

  const system = `أنت خبير تقدير تكاليف هندسية (Cost Engineer) متخصص في توقع التكلفة النهائية للمشاريع الإنشائية بناءً على EAC/ETC الفعلية المحسوبة بطريقة الأداء المستمر. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "eac_explanation": "شرح مبسّط لرقم EAC الفعلي ولماذا وصل لهذه القيمة",
  "etc_explanation": "شرح ما تبقى إنفاقه فعلياً (ETC) وأثره على التدفق النقدي القادم",
  "scenarios": {
    "optimistic": "سيناريو متفائل واقعي بناءً على تحسن محتمل في الأداء",
    "most_likely": "السيناريو الأقرب للواقع بناءً على الأداء الحالي",
    "pessimistic": "سيناريو متشائم إن استمر الأداء الحالي أو ساء"
  },
  "confidence_note": "ملاحظة حول مدى موثوقية التوقع بناءً على نسبة الإنجاز الحالية"
}`;

  const userMessage = `مؤشرات EVM الكاملة (تتضمن BAC/AC/EV/EAC/ETC/VAC الفعلية):
${trimForPrompt(context.evm)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { budget_id: budgetId, eac: context.evm.eac, etc: context.evm.etc, vac: context.evm.vac, forecast: extractJson(response) };
}

// ===================== 5) اقتراح طرق تقليل التكاليف =====================
async function suggestCostReductions({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const context = buildBudgetFullContext(budgetId);

  const system = `أنت مستشار هندسي متخصص في تحسين التكاليف (Value Engineering) للمشاريع الإنشائية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "high_impact_suggestions": [{"area": "مجال البند/المرحلة", "suggestion": "اقتراح عملي محدد", "estimated_impact": "وصف نوعي للأثر المتوقع (مرتفع/متوسط/منخفض) دون اختراع أرقام دقيقة غير موجودة في البيانات"}],
  "quick_wins": ["إجراء سريع منخفض المخاطر يمكن تطبيقه فوراً"],
  "areas_needing_caution": ["مجال يجب الحذر عند تخفيض تكلفته لتجنّب التأثير على الجودة/السلامة"]
}`;

  const userMessage = `تحليل الانحرافات حسب المرحلة (المصدر الأساسي لتحديد مجالات التوفير):
${trimForPrompt(context.deviation)}

ملخص التكاليف الفعلية:
${trimForPrompt(context.actual_costs_overview)}

بيانات التكامل مع المشتريات/المعدات (إن وُجدت فجوات أو ازدواجية):
${trimForPrompt(context.integrations)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1800 });
  return { budget_id: budgetId, suggestions: extractJson(response) };
}

// ===================== 6) تحليل أسباب الانحرافات =====================
/**
 * يربط الانحراف بمصدره الفعلي: مرحلة/بند/مورد معيّن، باستخدام computeDeviationByPhase
 * الحقيقي بالإضافة لبيانات التكاليف الفعلية التفصيلية.
 */
async function analyzeDeviationRootCauses({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const context = buildBudgetFullContext(budgetId);
  if (!context.deviation) throw new Error('تعذر تحليل الانحرافات لهذه الميزانية');

  const deviationData = context.deviation;
  const worstPhases = (deviationData.by_phase || []).filter((p) => p.deviation?.level && p.deviation.level !== 'none' && p.deviation.level !== 'بسيط').slice(0, 5);

  const actualCostsResult = BUDGET.listActualCosts(budgetId, { pageSize: 10000 });
  const items = actualCostsResult?.items || actualCostsResult?.data?.items || [];
  const relevantCosts = items.filter((it) => worstPhases.some((p) => p.phase_id === it.phase_id));

  const system = `أنت محلل انحرافات مالية هندسي متخصص في ربط الانحراف المالي بمصدره الفعلي (مرحلة/بند/مورد). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "root_causes": [{"phase_name": "اسم المرحلة", "likely_cause": "السبب المحتمل بناءً على البيانات الفعلية", "supporting_evidence": "دليل من التكاليف الفعلية المزوَّدة", "severity": "high|medium|low"}],
  "systemic_patterns": ["نمط متكرر عبر أكثر من مرحلة إن وُجد"],
  "preventive_recommendations": ["توصية وقائية لتجنّب تكرار نفس السبب في مراحل/مشاريع مستقبلية"]
}`;

  const userMessage = `المراحل الأكثر انحرافاً (الأسوأ أولاً):
${trimForPrompt(worstPhases)}

التكاليف الفعلية المرتبطة بهذه المراحل تحديداً:
${trimForPrompt(relevantCosts, 4000)}

تحليل الانحراف العام الكامل:
${trimForPrompt(deviationData.overall)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { budget_id: budgetId, worst_phases: worstPhases, analysis: extractJson(response) };
}

// ===================== 7) مقارنة تكلفة المشاريع السابقة =====================
/**
 * يعبر عدة ميزانيات/مشاريع فعلياً (وليس مشروعاً واحداً) عبر BUDGET.listBudgets،
 * ويقارن مؤشرات EVM الفعلية بين المشروع الحالي ومشاريع سابقة مكتملة أو نشطة.
 */
async function compareHistoricalProjectCosts({ budgetId, compareLimit = 5 }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const currentBudget = getBudgetOrThrow(budgetId);
  const currentEvm = safe(() => unwrapData(BUDGET.getBudgetEVM(budgetId)));

  const allBudgetsResult = BUDGET.listBudgets({ pageSize: 200 });
  const allBudgets = allBudgetsResult?.data?.items || allBudgetsResult?.data || allBudgetsResult?.items || [];
  const otherBudgets = allBudgets.filter((b) => b.id !== budgetId).slice(0, compareLimit);

  const comparisons = otherBudgets.map((b) => {
    const evm = safe(() => unwrapData(BUDGET.getBudgetEVM(b.id)));
    return {
      budget_id: b.id,
      project_name: b.project_name,
      status: b.status,
      bac: evm?.bac ?? null,
      cpi: evm?.cpi ?? null,
      spi: evm?.spi ?? null,
      vac: evm?.vac ?? null,
    };
  }).filter((c) => c.bac !== null);

  if (!comparisons.length) {
    return { budget_id: budgetId, comparisons: [], note: 'لا توجد ميزانيات أخرى كافية للمقارنة حالياً' };
  }

  const system = `أنت محلل بيانات مالية هندسية متخصص في مقارنة أداء المشاريع الإنشائية عبر مؤشرات EVM الفعلية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "current_project_ranking": "وصف نوعي لموقع المشروع الحالي نسبياً (الأفضل/متوسط/الأضعف) من حيث الكفاءة المالية",
  "comparative_insights": ["ملاحظة مقارنة فعلية بين المشروع الحالي ومشاريع أخرى"],
  "benchmarks_to_adopt": ["ممارسة من مشروع أفضل أداءً يمكن تطبيقها على المشروع الحالي"]
}`;

  const userMessage = `مؤشرات EVM للمشروع الحالي:
${trimForPrompt(currentEvm)}

مؤشرات EVM لمشاريع أخرى للمقارنة:
${trimForPrompt(comparisons)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { budget_id: budgetId, current_evm: currentEvm, comparisons, analysis: extractJson(response) };
}

// ===================== 8) اقتراح أفضل قرارات الشراء =====================
/**
 * يستخدم بيانات مقارنة أسعار البنود الفعلية (compareCostItemPrices من 2/10)
 * وبيانات التكامل مع المشتريات/المعدات الفعلية.
 */
async function suggestProcurementDecisions({ budgetId, itemName = null, itemCode = null }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  getBudgetOrThrow(budgetId);

  const priceComparison = (itemName || itemCode)
    ? safe(() => BUDGET.compareCostItemPrices(budgetId, { name: itemName, code: itemCode }))
    : null;

  const procurementReconciliation = safe(() => (INTEG ? INTEG.getProcurementReconciliation(budgetId) : null));

  const system = `أنت مستشار مشتريات هندسية (Procurement Advisor) متخصص في المشاريع الإنشائية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "procurement_recommendations": [{"recommendation": "توصية شراء عملية محددة", "rationale": "المبرر المستند إلى البيانات الفعلية"}],
  "cost_saving_opportunities": ["فرصة توفير محتملة من بيانات الأسعار/العقود الفعلية"],
  "risk_flags": ["خطر متعلق بالمشتريات يستحق انتباه الإدارة"]
}`;

  const userMessage = `مقارنة أسعار البند المطلوب (إن وُجد):
${trimForPrompt(priceComparison)}

مطابقة بيانات المشتريات/العقود مع الميزانية:
${trimForPrompt(procurementReconciliation)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { budget_id: budgetId, price_comparison: priceComparison, procurement_reconciliation: procurementReconciliation, analysis: extractJson(response) };
}

// ===================== 9) إنشاء تقارير مالية تلقائية للإدارة =====================
/**
 * ملخص نصي تنفيذي (Executive Brief) يُبنى فوق حزمة التقارير الكاملة الجاهزة
 * فعلياً من buildFullReportPack (9/10) — لا يعيد حساب الأرقام، بل يفسّرها فقط.
 */
async function generateManagementFinancialBrief({ budgetId }) {
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب');
  const fullPack = safe(() => REPORTS.buildFullReportPack(budgetId));
  if (!fullPack) throw new Error('تعذر بناء حزمة التقارير الكاملة لهذه الميزانية');

  const context = buildBudgetFullContext(budgetId);

  const system = `أنت كاتب تقارير تنفيذية مالية (Executive Financial Reporting) لمجلس إدارة شركة مقاولات. مهمتك تحويل حزمة تقارير مالية تفصيلية إلى ملخص تنفيذي واضح ومباشر لصانعي القرار. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "executive_summary": "فقرة موجزة (3-5 جمل) تلخّص الوضع المالي العام",
  "highlights": ["نقطة رئيسية يجب أن يعرفها المدير التنفيذي"],
  "concerns": ["نقطة قلق تستدعي قراراً إدارياً"],
  "decisions_needed": ["قرار محدد مطلوب من الإدارة الآن"],
  "next_review_focus": "ما الذي يجب متابعته في المراجعة القادمة"
}`;

  const userMessage = `حزمة التقارير المالية الكاملة للميزانية:
${trimForPrompt(fullPack, 5000)}

مؤشرات EVM:
${trimForPrompt(context.evm)}

الموافقات المعلَّقة حالياً على مستوى النظام:
${trimForPrompt(context.pending_approvals)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2200 });
  return { budget_id: budgetId, brief: extractJson(response), source_report_pack_included: true };
}

module.exports = {
  isAIAvailable,
  analyzeFinancialPerformance,
  predictBudgetOverrun,
  detectAnomalousExpenses,
  forecastFinalCost,
  suggestCostReductions,
  analyzeDeviationRootCauses,
  compareHistoricalProjectCosts,
  suggestProcurementDecisions,
  generateManagementFinancialBrief,
};
