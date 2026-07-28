/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الثامن (8/10): تحليل حصر الكميات (BOQ Intelligence)
 * ===================================================================================
 *
 * واجهة موحدة لتحليل الذكاء الاصطناعي (عبر Claude API) مخصّصة لبيانات حصر الكميات
 * (BOQ)، مبنية بنفس أسلوب وحدات الذكاء الاصطناعي القائمة في بقية أقسام النظام
 * (budgetAI.js / drawingAI.js / hseAI.js / qmsAI.js / surveyAI.js / documentAI.js):
 * بدون أي SDK خارجي، استدعاء https المدمجة في Node مباشرة إلى واجهة Claude، وبدون
 * تخزين مفتاح API داخل الكود.
 *
 * يغطي هذا الملف بنود "تحليل حصر الكميات" من مواصفة القسم الخامس عشر الأصلية
 * (البند 8) بالإضافة لبنود ذات صلة من البند 9 (حديد التسليح) حيث تتقاطع بياناتها
 * مع بيانات BOQ نفسها:
 *  1. مراجعة بنود BOQ (فحص شامل واكتشاف مشاكل الاتساق)      → reviewBOQItems
 *  2. اكتشاف القيم غير الطبيعية (Outliers)                  → detectAbnormalValues
 *  3. مقارنة الكميات المخططة بالمنفذة                        → compareplannedVsExecuted
 *  4. اكتشاف الاختلافات بين نسختين من BOQ (تعديل/إصدار)      → detectVersionDifferences
 *  5. تحليل تغيّر الكميات عبر الزمن                          → analyzeQuantityTrend
 *  6. ربط الكميات بالميزانية (فجوات التسعير/التكلفة)          → linkQuantitiesToBudget
 *  7. ربط الكميات بالجدول الزمني (تعارض التوريد/التنفيذ)      → linkQuantitiesToSchedule
 *  8. تحليل بيانات حديد التسليح (كشف أخطاء إدخال محتملة)      → analyzeRebarData
 *  9. إعداد ملخص هندسي شامل لحصر الكميات                     → generateBOQEngineeringSummary
 *
 * هام جداً: لا يوجد في النظام تخزين دائم لقوائم BOQ لكل مشروع (نظام الحصر في
 * القسم الثالث يعمل بمبدأ "حساب عند الطلب" عبر حاسبات backend/calculators/boq)؛
 * لذلك جميع دوال هذا الملف تستقبل بيانات البنود (line items) والسياق المطلوب
 * مباشرة من الطرف المستدعي (نفس نمط aiAnalyzer.compareBOQVersions الموجود في
 * القسم الثالث)، ولا تخترع أي بيانات، ولا تفترض وجود مصدر تخزين غير موجود فعلياً.
 * عند توفر معرّف ميزانية (budgetId) فعلي، تُستخدم بيانات budgetManagement الحقيقية
 * للربط في الدالتين المخصصتين لذلك دون أي قيمة وهمية.
 *
 * ملاحظة مهمة (نفس قيد بقية وحدات AI في النظام): هذه الوحدة لا تحتوي على مفتاح API
 * مباشرة؛ يجب تمريره عبر متغير البيئة ANTHROPIC_API_KEY عند تشغيل الخادم. بدون
 * المفتاح يعمل قسم حصر الكميات بالكامل (كل الحاسبات، التقارير، التصدير PDF/Excel/
 * CSV) بشكل طبيعي دون أي اعتماد على الذكاء الاصطناعي؛ فقط ميزات هذا الملف تحديداً
 * تتطلبه، وتُرجع خطأً واضحاً بالعربية عند غيابه.
 */

const https = require('https');

let BUDGET = null;
try { BUDGET = require('./budgetManagement'); } catch (e) { BUDGET = null; }

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

function trimForPrompt(obj, maxChars = 3500) {
  const str = JSON.stringify(obj);
  return str.length > maxChars ? str.slice(0, maxChars) + ' …(مقتطَع)' : str;
}

function unwrapData(result) {
  if (result && typeof result === 'object' && 'success' in result && 'data' in result) return result.data;
  return result;
}

function requireItems(items, label = 'items') {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`يجب تزويد قائمة بنود حصر كميات (${label}) غير فارغة لإجراء هذا التحليل`);
  }
}

// ===================== 1) مراجعة بنود BOQ =====================
/**
 * فحص شامل لقائمة بنود حصر كميات فعلية (كما وردت من حاسبات القسم الثالث أو من
 * استيراد المستخدم) لاكتشاف مشاكل الاتساق: وحدات غير متطابقة، وصف ناقص، تصنيف
 * غير منطقي، بنود مكررة فعلياً في القائمة المُزوَّدة.
 */
async function reviewBOQItems({ items, projectName = null }) {
  requireItems(items);

  const system = `أنت مهندس كميات خبير (Quantity Surveyor) متخصص في مراجعة جداول حصر الكميات (BOQ) للمشاريع الإنشائية.
راجع قائمة البنود المزوَّدة فعلياً وحدد أي مشاكل حقيقية في الاتساق أو الاكتمال. لا تخترع بنوداً غير موجودة، ولا تفترض قيماً غير مذكورة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "overall_quality": "good|needs_review|poor",
  "issues": [{"item_description": "وصف البند من القائمة المزوَّدة", "issue_type": "unit_mismatch|missing_description|duplicate|inconsistent_category|other", "explanation": "شرح المشكلة تحديداً بناءً على البيانات المزوَّدة"}],
  "duplicate_candidates": [{"description": "الوصف المتكرر", "occurrences": رقم}],
  "completeness_notes": ["ملاحظة حول اكتمال البيانات (مثال: بنود بدون سعر، بنود بدون فئة)"],
  "recommendations": ["توصية عملية لتحسين جودة الحصر"]
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}عدد البنود المزوَّدة: ${items.length}

بنود حصر الكميات:
${trimForPrompt(items, 6000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2200 });
  return { items_count: items.length, review: extractJson(response) };
}

// ===================== 2) اكتشاف القيم غير الطبيعية =====================
/**
 * اكتشاف كميات أو أسعار شاذة إحصائياً ضمن نفس فئة البنود (Outliers) بناءً على
 * البيانات الفعلية فقط دون أي معايير مرجعية مختلَقة من خارج القائمة المزوَّدة.
 */
async function detectAbnormalValues({ items, projectName = null }) {
  requireItems(items);

  // حساب إحصائي أساسي حقيقي (وليس من AI) لكل فئة، ليُستخدم كسياق مساعد لتفسير AI
  const byCategory = {};
  for (const it of items) {
    const cat = it.category || 'عام';
    if (!byCategory[cat]) byCategory[cat] = [];
    if (typeof it.quantity === 'number') byCategory[cat].push(it.quantity);
  }
  const categoryStats = Object.entries(byCategory).map(([cat, qtys]) => {
    if (!qtys.length) return { category: cat, count: 0 };
    const sum = qtys.reduce((a, b) => a + b, 0);
    const mean = sum / qtys.length;
    const variance = qtys.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / qtys.length;
    const stdDev = Math.sqrt(variance);
    return { category: cat, count: qtys.length, mean: Math.round(mean * 100) / 100, std_dev: Math.round(stdDev * 100) / 100, min: Math.min(...qtys), max: Math.max(...qtys) };
  });

  const system = `أنت محلل بيانات هندسية متخصص في اكتشاف القيم الشاذة (Anomaly Detection) في جداول حصر الكميات. استخدم الإحصاءات الفعلية المزوَّدة (المتوسط، الانحراف المعياري لكل فئة) لتحديد البنود التي تنحرف بشكل ملحوظ عن نظيراتها في نفس الفئة. لا تُبلغ عن بند كشاذ إلا إذا كان الانحراف واضحاً فعلاً من الأرقام المزوَّدة. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "abnormal_items": [{"item_description": "وصف البند", "category": "الفئة", "quantity": رقم, "reason": "سبب اعتباره شاذاً بناءً على إحصاءات الفئة", "severity": "high|medium|low"}],
  "note": "ملاحظة عامة حول جودة البيانات إن كانت العينة صغيرة جداً لإجراء تحليل إحصائي موثوق"
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}إحصاءات كل فئة (محسوبة فعلياً من البيانات):
${trimForPrompt(categoryStats)}

كامل بنود حصر الكميات:
${trimForPrompt(items, 5000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { category_stats: categoryStats, analysis: extractJson(response) };
}

// ===================== 3) مقارنة الكميات المخططة بالمنفذة =====================
/**
 * يبني تقرير الإنجاز الحقيقي أولاً (نفس منطق boqReports.buildCompletionReport)
 * ثم يفسّره AI بلغة تحليلية بدل الاكتفاء بالأرقام الخام.
 */
async function compareplannedVsExecuted({ plannedItems, executedItems, projectName = null }) {
  requireItems(plannedItems, 'plannedItems');
  requireItems(executedItems, 'executedItems');

  const plannedByDesc = new Map(plannedItems.map((it) => [it.description, it]));
  const executedByDesc = new Map(executedItems.map((it) => [it.description, it]));

  const comparisonRows = [];
  for (const [desc, planned] of plannedByDesc.entries()) {
    const executed = executedByDesc.get(desc);
    const plannedQty = planned.quantity ?? 0;
    const executedQty = executed ? (executed.quantity ?? 0) : 0;
    const completionPercent = plannedQty > 0 ? Math.round((executedQty / plannedQty) * 10000) / 100 : null;
    comparisonRows.push({ description: desc, category: planned.category || null, planned_qty: plannedQty, executed_qty: executedQty, completion_percent: completionPercent, status: !executed ? 'not_started' : (executedQty >= plannedQty ? 'complete' : 'in_progress') });
  }
  const extraExecuted = [...executedByDesc.keys()].filter((d) => !plannedByDesc.has(d));

  const system = `أنت مهندس متابعة تنفيذ (Progress Engineer) متخصص في مقارنة الكميات المخططة بالمنفذة فعلياً في المشاريع الإنشائية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "overall_progress_assessment": "ملخص عام لحالة التنفيذ مقارنة بالمخطط",
  "items_behind_schedule": [{"description": "وصف البند", "completion_percent": رقم, "concern": "لماذا يستحق الانتباه"}],
  "items_over_planned": [{"description": "وصف البند", "planned_qty": رقم, "executed_qty": رقم, "possible_reason": "سبب محتمل بناءً على البيانات فقط"}],
  "unplanned_items_note": "ملاحظة حول البنود المنفذة وغير المخطط لها أصلاً إن وُجدت",
  "recommendations": ["توصية عملية"]
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}جدول المقارنة (محسوب فعلياً من الكميات المخططة والمنفذة):
${trimForPrompt(comparisonRows, 5000)}

بنود منفذة وغير موجودة في الخطة أصلاً:
${trimForPrompt(extraExecuted)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { comparison_rows: comparisonRows, extra_executed_items: extraExecuted, analysis: extractJson(response) };
}

// ===================== 4) اكتشاف الاختلافات بين نسختين من BOQ =====================
/**
 * مقارنة نسختين من نفس جدول الحصر (مثال: قبل/بعد تعديل مخطط) لاكتشاف الإضافات
 * والحذوفات وتغيّر الكميات فعلياً بين النسختين.
 */
async function detectVersionDifferences({ versionA, versionB, labelA = 'النسخة السابقة', labelB = 'النسخة الحالية' }) {
  requireItems(versionA, 'versionA');
  requireItems(versionB, 'versionB');

  const mapA = new Map(versionA.map((it) => [it.description, it]));
  const mapB = new Map(versionB.map((it) => [it.description, it]));

  const onlyInA = [...mapA.keys()].filter((d) => !mapB.has(d));
  const onlyInB = [...mapB.keys()].filter((d) => !mapA.has(d));
  const quantityChanges = [];
  for (const [desc, itemA] of mapA.entries()) {
    const itemB = mapB.get(desc);
    if (!itemB) continue;
    const qtyA = itemA.quantity ?? 0;
    const qtyB = itemB.quantity ?? 0;
    if (qtyA !== qtyB) {
      const diffPercent = qtyA !== 0 ? Math.round(((qtyB - qtyA) / qtyA) * 10000) / 100 : null;
      quantityChanges.push({ description: desc, qty_a: qtyA, qty_b: qtyB, difference_percent: diffPercent });
    }
  }

  const system = `أنت مهندس كميات متخصص في تدقيق الإصدارات المختلفة لجداول حصر الكميات (Version Control للـ BOQ). أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "summary": "ملخص عام موجز للفروقات الجوهرية بين النسختين",
  "significant_changes": [{"description": "وصف البند", "change_type": "added|removed|quantity_changed", "details": "تفاصيل التغيير", "impact_level": "high|medium|low"}],
  "possible_causes": ["سبب محتمل للتغيير بناءً على طبيعة البنود فقط دون افتراضات خارج البيانات"]
}`;

  const userMessage = `${labelA} - بنود موجودة فقط فيها (${onlyInA.length}):
${trimForPrompt(onlyInA)}

${labelB} - بنود موجودة فقط فيها (${onlyInB.length}):
${trimForPrompt(onlyInB)}

بنود تغيّرت كميتها بين النسختين (${quantityChanges.length}):
${trimForPrompt(quantityChanges, 4000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { only_in_a: onlyInA, only_in_b: onlyInB, quantity_changes: quantityChanges, analysis: extractJson(response) };
}

// ===================== 5) تحليل تغيّر الكميات عبر الزمن =====================
/**
 * يستقبل سلسلة زمنية فعلية من لقطات BOQ (snapshots بتواريخها) ويحلل الاتجاه العام.
 */
async function analyzeQuantityTrend({ snapshots, itemDescription = null }) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    throw new Error('يجب تزويد لقطتين زمنيتين (snapshots) على الأقل، كل منها بتاريخ وقائمة بنود، لتحليل الاتجاه');
  }

  const series = snapshots.map((snap) => {
    const items = snap.items || [];
    const totalQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    const targetQty = itemDescription ? (items.find((it) => it.description === itemDescription)?.quantity ?? null) : null;
    return { date: snap.date || null, total_items: items.length, total_quantity_all_items: Math.round(totalQty * 100) / 100, target_item_quantity: targetQty };
  });

  const system = `أنت محلل بيانات هندسية متخصص في تحليل اتجاه تغيّر كميات المشروع عبر الزمن. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "trend_direction": "increasing|decreasing|stable|fluctuating",
  "summary": "وصف موجز للاتجاه المُلاحَظ فعلياً من البيانات الزمنية",
  "notable_jumps": [{"period": "بين أي تاريخين", "change_description": "وصف القفزة/الانخفاض الملحوظ"}],
  "possible_implications": ["أثر محتمل على الميزانية أو الجدول الزمني بناءً على الاتجاه فقط"]
}`;

  const userMessage = `${itemDescription ? `البند المتتبع تحديداً: ${itemDescription}\n` : 'تحليل إجمالي الكميات عبر جميع البنود\n'}السلسلة الزمنية (محسوبة فعلياً من اللقطات المزوَّدة):
${trimForPrompt(series)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { series, analysis: extractJson(response) };
}

// ===================== 6) ربط الكميات بالميزانية =====================
/**
 * يربط قائمة بنود BOQ فعلية بميزانية حقيقية مخزَّنة (عبر budgetManagement) لاكتشاف
 * فجوات التسعير أو التكلفة الفعلية غير المتوافقة مع الكميات المزوَّدة.
 */
async function linkQuantitiesToBudget({ items, budgetId }) {
  requireItems(items);
  if (!budgetId) throw new Error('معرّف الميزانية (budgetId) مطلوب لربط الكميات بالميزانية');
  if (!BUDGET) throw new Error('وحدة إدارة الميزانية غير متاحة في هذا الخادم');

  const budget = BUDGET.getBudget(budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  const deviation = safe(() => unwrapData(BUDGET.getDeviationAnalysis(budgetId)));
  const actualCostsResult = safe(() => BUDGET.listActualCosts(budgetId, { pageSize: 500 }));
  const actualCosts = unwrapData(actualCostsResult);

  const totalBoqQty = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

  const system = `أنت مهندس تكاليف (Cost Engineer) متخصص في ربط بيانات حصر الكميات الهندسية ببيانات الميزانية المالية الفعلية لنفس المشروع. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "alignment_assessment": "تقييم عام لمدى اتساق الكميات مع البيانات المالية الفعلية",
  "gaps": [{"description": "فجوة أو تعارض ملاحَظ بين الكميات والتكاليف الفعلية", "evidence": "الدليل من البيانات المزوَّدة", "severity": "high|medium|low"}],
  "cost_per_unit_flags": ["ملاحظة حول بنود قد تحتاج مراجعة تسعير بناءً على مقارنة الكمية بالتكلفة الفعلية"],
  "recommendations": ["توصية عملية لتحسين التوافق بين الحصر والميزانية"]
}`;

  const userMessage = `إجمالي عدد بنود الحصر: ${items.length} — إجمالي الكمية الكلية: ${Math.round(totalBoqQty * 100) / 100}
بنود حصر الكميات:
${trimForPrompt(items, 3500)}

بيانات الميزانية الأساسية للمشروع:
${trimForPrompt(unwrapData(budget))}

تحليل الانحرافات المالية الفعلي حسب المرحلة:
${trimForPrompt(deviation)}

التكاليف الفعلية المسجَّلة:
${trimForPrompt(actualCosts, 3000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { budget_id: budgetId, total_boq_quantity: totalBoqQty, analysis: extractJson(response) };
}

// ===================== 7) ربط الكميات بالجدول الزمني =====================
/**
 * يربط بنود BOQ ببيانات جدول زمني فعلية مزوَّدة من الطرف المستدعي (أنشطة بتواريخ
 * وكميات مرتبطة)، لاكتشاف تعارض بين معدل التوريد/التنفيذ المطلوب والمدة الزمنية
 * المتاحة فعلياً في الجدول.
 */
async function linkQuantitiesToSchedule({ items, scheduleActivities, projectName = null }) {
  requireItems(items);
  if (!Array.isArray(scheduleActivities) || scheduleActivities.length === 0) {
    throw new Error('يجب تزويد أنشطة الجدول الزمني (scheduleActivities) المرتبطة ببنود الحصر لإجراء هذا الربط');
  }

  const system = `أنت مهندس تخطيط (Planning Engineer) متخصص في ربط كميات الأعمال الهندسية بالجدول الزمني للمشروع لاكتشاف تعارضات الإنتاجية أو التوريد. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "feasibility_assessment": "تقييم عام لتوافق الكميات المطلوبة مع المدد الزمنية المتاحة فعلياً في الجدول",
  "at_risk_activities": [{"activity_or_item": "اسم النشاط أو البند", "concern": "طبيعة التعارض بين الكمية والمدة الزمنية المتاحة", "severity": "high|medium|low"}],
  "productivity_notes": ["ملاحظة حول معدل الإنتاجية المطلوب استناداً للبيانات المزوَّدة فقط"],
  "recommendations": ["توصية عملية لتخطيط أفضل"]
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}بنود حصر الكميات:
${trimForPrompt(items, 3500)}

أنشطة الجدول الزمني المرتبطة:
${trimForPrompt(scheduleActivities, 3500)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { analysis: extractJson(response) };
}

// ===================== 8) تحليل بيانات حديد التسليح =====================
/**
 * تحليل مخرجات حاسبة حديد التسليح (القسم الثاني) لاكتشاف قيم غير معتادة ومقارنة
 * النتائج بالمدخلات — دون تقديم أي اعتماد إنشائي نهائي بديل عن المهندس المختص
 * (وفق القيد الصريح في البند 9 من مواصفة القسم الخامس عشر).
 */
async function analyzeRebarData({ rebarResults, projectName = null }) {
  if (!rebarResults || (Array.isArray(rebarResults) && rebarResults.length === 0)) {
    throw new Error('يجب تزويد نتائج حاسبة حديد التسليح (rebarResults) لإجراء هذا التحليل');
  }

  const system = `أنت مهندس مدني متخصص في مراجعة حسابات حديد التسليح (Rebar Take-off). دورك مراجعة اتساق الأرقام الناتجة فعلياً من الحاسبة فقط (الأوزان، الأقطار، الأطوال، عدد القضبان) لاكتشاف أخطاء إدخال محتملة أو نتائج غير معتادة إحصائياً. لا تقدّم أي اعتماد إنشائي نهائي، ولا تقترح تصميماً بديلاً — فقط راجع الاتساق الرقمي. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "consistency_check": "good|needs_review",
  "flags": [{"field": "اسم الحقل/العنصر", "value": "القيمة كما وردت", "reason": "سبب اعتبارها تستحق المراجعة"}],
  "input_vs_output_notes": ["ملاحظة حول تطابق أو عدم تطابق المدخلات مع النتائج المحسوبة"],
  "disclaimer": "هذا التحليل مراجعة اتساق رقمية أولية ولا يغني عن اعتماد المهندس الإنشائي المختص"
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}نتائج حاسبة حديد التسليح:
${trimForPrompt(rebarResults, 5000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1800 });
  const result = extractJson(response);
  // فرض التنويه الإلزامي بغض النظر عن استجابة AI، حماية للسياسة الهندسية للنظام
  result.disclaimer = 'هذا التحليل مراجعة اتساق رقمية أولية ولا يغني عن اعتماد المهندس الإنشائي المختص';
  return { analysis: result };
}

// ===================== 9) إعداد ملخص هندسي شامل =====================
/**
 * ملخص تنفيذي هندسي يجمع كل ما سبق (إن توفرت مخرجاته) في نظرة عامة واحدة، دون
 * إعادة حساب أي رقم بل تفسيره فقط، بنفس منهجية budgetAI.generateManagementFinancialBrief.
 */
async function generateBOQEngineeringSummary({ items, projectName = null, additionalContext = null }) {
  requireItems(items);

  const totalItems = items.length;
  const byCategory = {};
  for (const it of items) {
    const cat = it.category || 'عام';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  const system = `أنت مهندس كميات أول (Senior Quantity Surveyor) تُعِدّ ملخصاً هندسياً تنفيذياً لجدول حصر كميات مشروع لصالح الإدارة الهندسية. أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي، وفق البنية:
{
  "executive_summary": "فقرة موجزة (3-5 جمل) تلخّص حالة حصر الكميات",
  "scope_overview": "نظرة عامة على نطاق الأعمال المشمولة في هذا الحصر بناءً على الفئات الفعلية الموجودة",
  "key_observations": ["ملاحظة هندسية رئيسية مستخلصة من البيانات فعلياً"],
  "open_points": ["نقطة تحتاج توضيحاً أو مراجعة من المهندس المسؤول"]
}`;

  const userMessage = `${projectName ? `المشروع: ${projectName}\n` : ''}إجمالي عدد البنود: ${totalItems}
توزيع البنود حسب الفئة (محسوب فعلياً):
${trimForPrompt(byCategory)}

عينة/كامل بنود الحصر:
${trimForPrompt(items, 4500)}

${additionalContext ? `سياق إضافي مزوَّد من المستخدم:\n${trimForPrompt(additionalContext, 1500)}` : ''}`;

  const response = await callClaude({ system, userMessage, maxTokens: 2000 });
  return { total_items: totalItems, category_breakdown: byCategory, summary: extractJson(response) };
}

module.exports = {
  isAIAvailable,
  reviewBOQItems,
  detectAbnormalValues,
  compareplannedVsExecuted,
  detectVersionDifferences,
  analyzeQuantityTrend,
  linkQuantitiesToBudget,
  linkQuantitiesToSchedule,
  analyzeRebarData,
  generateBOQEngineeringSummary,
};
