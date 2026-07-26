/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء الثامن (8/10): الذكاء الاصطناعي + التقارير التنبؤية
 *
 * يغطي هذا الملف البندين 16 و17 من مواصفة القسم الرابع عشر الأصلية:
 *
 *  البند 16 - مساعد ذكي داخل قسم التقارير:
 *   1. إنشاء التقرير تلقائياً من البيانات       → generateReportFromData
 *   2. تلخيص التقارير الطويلة                    → summarizeReport
 *   3. تحليل مؤشرات المشروع                      → analyzeProjectIndicators
 *   4. اكتشاف المشاكل                             → detectIssues
 *   5. اكتشاف الانحرافات                          → detectDeviations
 *   6. تحليل التأخير                              → analyzeDelays
 *   7. تحليل التكاليف                             → analyzeCosts
 *   8. تحليل الجودة والسلامة                      → analyzeQualityAndSafety
 *   9. كتابة الملخص التنفيذي                      → writeExecutiveSummary
 *  10. اقتراح الإجراءات التصحيحية                 → suggestCorrectiveActions
 *
 *  البند 17 - التقارير التنبؤية:
 *   1. احتمال تأخر المشروع                        → predictProjectDelayRisk
 *   2. التكلفة المتوقعة عند الانتهاء               → predictForecastCost (EAC حقيقي + تفسير AI)
 *   3. احتمالية تجاوز الميزانية                    → predictBudgetOverrunLikelihood
 *   4. المخاطر المحتملة                            → predictPotentialRisks
 *   5. اتجاه أداء المشروع                          → predictPerformanceTrend
 *   6. توقع الإنتاجية                              → predictProductivityOutlook
 *
 * منهجية أمانة البيانات (نفس نمط budgetAI.js / hseAI.js / qmsAI.js / drawingAI.js
 * / surveyAI.js / documentAI.js القائمة في النظام):
 *  - بدون أي SDK خارجي؛ استدعاء https المدمجة في Node مباشرة إلى واجهة Claude.
 *  - بدون تخزين مفتاح API داخل الكود؛ يُقرأ حصراً من متغير البيئة ANTHROPIC_API_KEY.
 *  - بدون المفتاح: يعمل قسم التقارير بالكامل (اللوحة، الكتالوج، المنشئ، الفلاتر،
 *    الزمنية والمقارنة، التفاعلية، الرسوم البيانية، التنفيذية والدورية، الجدولة،
 *    التصدير، القوالب، التوقيعات، المرفقات) بشكل طبيعي دون أي اعتماد على الذكاء
 *    الاصطناعي؛ فقط دوال هذا الملف تحديداً تتطلبه، وتُرجع خطأً واضحاً بالعربية
 *    عند غيابه.
 *  - كل دالة تبني سياقها من بيانات حقيقية مخزَّنة فعلياً عبر الوحدات القائمة
 *    (reportsCenter / reportExecutivePeriodic / reportBuilder / reportPeriodsComparisons
 *    / budgetManagement / projectManagement) — لا بيانات وهمية ولا نصوص ثابتة؛
 *    الذكاء الاصطناعي يحلل فعلياً ما هو محسوب من البيانات الحقيقية وقت الاستدعاء،
 *    ويُمنَع صراحةً في التعليمات (system prompt) من اختلاق أي رقم أو بيان غير مزوَّد.
 *  - التقارير التنبؤية (البند 17) ليست تخميناً حراً من النموذج اللغوي: القيم
 *    الرقمية (EAC/ETC/VAC، الانحراف الزمني، متوسط أيام التأخير) تُحسَب حسابياً
 *    بشكل حتمي من reportExecutivePeriodic / budgetManagement أولاً، ثم يقوم
 *    الذكاء الاصطناعي بتفسيرها فقط دون إعادة اختراعها. تُرفَق دائماً عبارة
 *    توضح أن التوقعات تقديرية وليست بديلاً عن القرار الهندسي أو الإداري (بند 17
 *    الأخير في المواصفة الأصلية).
 */

const https = require('https');

const REPORTS_CENTER = require('./reportsCenter');
const REPORT_EXEC_PERIODIC = require('./reportExecutivePeriodic');
let REPORT_BUILDER = null;
try { REPORT_BUILDER = require('./reportBuilder'); } catch (e) { REPORT_BUILDER = null; }
let REPORT_PERIODS = null;
try { REPORT_PERIODS = require('./reportPeriodsComparisons'); } catch (e) { REPORT_PERIODS = null; }
let BUDGET = null;
try { BUDGET = require('./budgetManagement'); } catch (e) { BUDGET = null; }
let PM = null;
try { PM = require('./projectManagement'); } catch (e) { PM = null; }

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const FORECAST_DISCLAIMER = 'هذه التوقعات تقديرية مبنية على البيانات الحالية فقط، وليست بديلاً عن القرار الهندسي أو الإداري.';

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

function r2(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }

function trimForPrompt(obj, maxChars = 3500) {
  const str = JSON.stringify(obj);
  return str.length > maxChars ? str.slice(0, maxChars) + ' …(مقتطَع)' : str;
}

/** ثابت مانع اختلاق البيانات يُدرَج في كل system prompt بهذا الملف (قاعدة الدقة رقم 24 من المواصفة الأصلية) */
const NO_FABRICATION_RULE = 'ممنوع اختلاق أي رقم أو بيان غير موجود صراحةً في البيانات المزوَّدة أدناه. إن كانت بيانات محور معيّن غير متوفرة، صرّح بذلك بدل تخمينه.';

// ============================================================================
// ===================== أدوات بناء السياق الفعلي (Context Builders) =========
// ============================================================================

function getReportOrThrow(reportId) {
  const rec = REPORTS_CENTER.getReportRecord(reportId);
  if (!rec) throw new Error('التقرير غير موجود');
  return rec;
}

/** يبني السياق الكامل حول مشروع واحد بالاعتماد على التقرير التنفيذي الحقيقي
 * (reportExecutivePeriodic) الذي يجمع أصلاً بيانات المشروع/الميزانية/الجدول/
 * السلامة/الجودة/المعدات من مصادرها الحقيقية دون ازدواجية منطق. */
function buildProjectAIContext(projectId) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const executive = REPORT_EXEC_PERIODIC.buildProjectExecutiveReport({ projectId });
  const scheduleCompare = PM ? safe(() => PM.compareScheduleVsActual(projectId)) : null;
  const risks = PM ? safe(() => PM.listRisks(projectId), []) : [];
  const recentReports = safe(() => REPORTS_CENTER.listReportRecords({ projectId, limit: 20 }), []);
  return { executive, scheduleCompare, risks: risks || [], recentReports: recentReports || [] };
}

module.exports.__buildProjectAIContext = buildProjectAIContext; // مرجع داخلي (غير مصدَّر عمومياً) لتسهيل الاختبار

// ============================================================================
// ========================= البند 16: المساعد الذكي في التقارير ============
// ============================================================================

// ---------- 1) إنشاء التقرير تلقائياً من البيانات ----------
/**
 * يُدخِل مواصفة تقرير (نفس بنية spec في reportBuilder.buildCustomReport) ويشغّل
 * المحرك الحقيقي أولاً لجلب الصفوف والـKPIs الفعلية، ثم يستخدم الذكاء الاصطناعي
 * فقط لصياغة نص وصفي (عنوان فرعي، ملاحظات قراءة) حول تلك النتائج الحقيقية —
 * دون أن يُنشئ أي رقم بنفسه.
 */
async function generateReportFromData({ spec = {}, projectId = null } = {}) {
  if (!REPORT_BUILDER) throw new Error('وحدة منشئ التقارير (reportBuilder) غير متاحة على الخادم');
  const built = REPORT_BUILDER.buildCustomReport(spec);

  const system = `أنت محلل تقارير هندسية. مهمتك صياغة عنوان ووصف موجز ونقاط قراءة سريعة حول نتائج تقرير مبني فعلياً من قاعدة البيانات، دون اختراع أي رقم. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "suggested_title": "عنوان مناسب للتقرير بناءً على محتواه الفعلي",
  "reading_notes": ["ملاحظة قراءة سريعة مستخلصة من الصفوف/المؤشرات المزوَّدة فعلياً"],
  "data_completeness_note": "تعليق صريح إن كانت بيانات التقرير قليلة أو غير كافية لاستنتاجات موثوقة"
}`;

  const userMessage = `مواصفة التقرير المطلوبة:
${trimForPrompt(spec)}

نتائج التقرير الفعلية المبنية من قاعدة البيانات (صفوف/KPIs/مجموعات):
${trimForPrompt({ rowsCount: (built.rows || []).length, sample_rows: (built.rows || []).slice(0, 15), kpis: built.kpis, grouped: built.grouped }, 4500)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return { report: built, ai_annotation: extractJson(response) };
}

// ---------- 2) تلخيص التقارير الطويلة ----------
/**
 * يأخذ معرّف تقرير مسجَّل فعلياً في reportsCenter، ويطلب من الذكاء الاصطناعي
 * تلخيصه؛ في حال عدم توفر جسم بيانات محفوظ مع السجل (السجل الأساسي في 1/10
 * يخزّن التعريف لا الجسم الكامل)، يُبنى الملخص من executive report الفعلي لنفس
 * المشروع كأقرب تمثيل حقيقي متاح لمحتوى ذلك التقرير.
 */
async function summarizeReport({ reportId, fullReportBody = null } = {}) {
  if (!reportId) throw new Error('معرّف التقرير (reportId) مطلوب');
  const record = getReportOrThrow(reportId);

  let bodyForSummary = fullReportBody;
  if (!bodyForSummary && record.project_id) {
    bodyForSummary = safe(() => REPORT_EXEC_PERIODIC.buildProjectExecutiveReport({ projectId: record.project_id }));
  }
  if (!bodyForSummary) throw new Error('لا يتوفر محتوى فعلي كافٍ لتلخيص هذا التقرير');

  const system = `أنت محلل تقارير هندسية متخصص في التلخيص التنفيذي. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "short_summary": "ملخص من 3-5 جمل يغطي الجوهر فقط",
  "key_points": ["نقطة رئيسية واحدة من محتوى التقرير الفعلي"],
  "numbers_to_remember": [{"label": "اسم الرقم/المؤشر", "value": "القيمة كما وردت في البيانات"}]
}`;

  const userMessage = `بيانات التقرير المطلوب تلخيصه (رقم التقرير: ${reportId}، العنوان: ${record.title}):
${trimForPrompt(bodyForSummary, 5000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1200 });
  return { report_id: reportId, title: record.title, summary: extractJson(response) };
}

// ---------- 3) تحليل مؤشرات المشروع ----------
async function analyzeProjectIndicators({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);

  const system = `أنت محلل أداء مشاريع هندسية خبير. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "overall_reading": "قراءة عامة لحالة المشروع بناءً على المؤشرات المزوَّدة فقط",
  "indicators_analysis": [{"indicator": "اسم المؤشر", "status": "قيمة الحالة كما وردت", "interpretation": "تفسير عملي مختصر"}],
  "attention_points": ["نقطة تستحق انتباه الإدارة مستخلصة فعلياً من المؤشرات"]
}`;

  const userMessage = `مؤشرات التقرير التنفيذي الفعلية للمشروع:
${trimForPrompt(context.executive.indicators)}

الحالة العامة المصنَّفة فعلياً: ${context.executive.overall_status_label}

ملخص المخاطر الفعلي:
${trimForPrompt(context.risks)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { project_id: projectId, indicators: context.executive.indicators, analysis: extractJson(response) };
}

// ---------- 4) اكتشاف المشاكل ----------
async function detectIssues({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);
  const lateTasks = context.scheduleCompare ? (context.scheduleCompare.tasks || []).filter((t) => t.is_late) : [];

  const system = `أنت مراقب جودة تنفيذ مشاريع إنشائية. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "issues": [{"issue": "وصف المشكلة الفعلية", "source": "من أي بيانات استُخلصت (مهام متأخرة/مخاطر مفتوحة/حوادث/NCR...)", "severity": "high|medium|low"}],
  "no_issues_found": false
}`;

  const userMessage = `المهام المتأخرة فعلياً (من مقارنة الجدول الزمني):
${trimForPrompt(lateTasks)}

المخاطر المفتوحة فعلياً:
${trimForPrompt((context.risks || []).filter((r) => r.status !== 'closed'))}

ملخص السلامة والجودة من التقرير التنفيذي:
${trimForPrompt({ hse: context.executive.hse_summary, qms: context.executive.quality_summary })}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { project_id: projectId, late_tasks_count: lateTasks.length, analysis: extractJson(response) };
}

// ---------- 5) اكتشاف الانحرافات ----------
async function detectDeviations({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);
  const scheduleVariance = context.executive.indicators.schedule_variance;
  const budgetUtil = context.executive.indicators.budget_utilization;

  const system = `أنت محلل انحرافات مشاريع إنشائية (Baseline vs Actual). ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "deviations": [{"area": "الزمن|التكلفة|الموارد", "deviation_description": "وصف الانحراف الفعلي بالأرقام المزوَّدة", "status": "الحالة كما وردت", "possible_cause": "سبب محتمل عام دون اختلاق تفاصيل غير مزوَّدة"}]
}`;

  const userMessage = `الانحراف الزمني الفعلي (فعلي - مخطط):
${trimForPrompt(scheduleVariance)}

نسبة استهلاك الميزانية الفعلية:
${trimForPrompt(budgetUtil)}

مؤشرات EVM الفعلية إن وُجدت:
${trimForPrompt(context.executive.evm)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return { project_id: projectId, deviations: extractJson(response) };
}

// ---------- 6) تحليل التأخير ----------
async function analyzeDelays({ projectId } = {}) {
  if (!PM) throw new Error('وحدة إدارة المشاريع (projectManagement) غير متاحة على الخادم');
  const scheduleCompare = safe(() => PM.compareScheduleVsActual(projectId));
  if (!scheduleCompare) throw new Error('تعذر جلب مقارنة الجدول الزمني الفعلية لهذا المشروع');

  const system = `أنت مخطط مشاريع إنشائية متخصص في تحليل أسباب التأخير الفعلي. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "delay_overview": "وصف عام لحالة التأخير بناءً على الأرقام الفعلية",
  "most_delayed_tasks": [{"title": "اسم المهمة كما ورد", "delay_days": "عدد أيام التأخير كما ورد", "note": "ملاحظة عملية"}],
  "likely_contributing_factors": ["عامل محتمل عام (موارد/طقس/موافقات/توريد) دون الجزم بسبب غير موجود في البيانات"]
}`;

  const userMessage = `بيانات مقارنة الجدول الزمني الفعلية الكاملة:
${trimForPrompt(scheduleCompare, 4500)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return {
    project_id: projectId,
    delayed_tasks_count: scheduleCompare.delayed_tasks_count,
    average_delay_days: scheduleCompare.average_delay_days,
    analysis: extractJson(response),
  };
}

// ---------- 7) تحليل التكاليف ----------
async function analyzeCosts({ projectId } = {}) {
  if (!BUDGET) throw new Error('وحدة إدارة الميزانية (budgetManagement) غير متاحة على الخادم');
  const budgetsList = safe(() => BUDGET.listBudgets({ project_id: projectId, page: 1, pageSize: 50 }), { data: [] });
  const projectBudgets = budgetsList.data || budgetsList.items || [];
  if (!projectBudgets.length) throw new Error('لا توجد ميزانية مرتبطة بهذا المشروع لتحليل التكاليف');

  const evm = safe(() => BUDGET.getBudgetEVM(projectBudgets[0].id));

  const system = `أنت محلل تكاليف مشاريع إنشائية. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "cost_status": "وصف عام لوضع التكاليف الحالي",
  "key_figures_interpretation": [{"figure": "اسم الرقم (BAC/AC/EV/EAC..)", "value": "القيمة كما وردت", "meaning": "تفسير عملي"}],
  "cost_risks": ["خطر مالي فعلي مستخلص من الأرقام المزوَّدة"]
}`;

  const userMessage = `مؤشرات EVM الفعلية للميزانية المرتبطة بالمشروع:
${trimForPrompt(evm)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return { project_id: projectId, budget_id: projectBudgets[0].id, evm, analysis: extractJson(response) };
}

// ---------- 8) تحليل الجودة والسلامة ----------
async function analyzeQualityAndSafety({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);

  const system = `أنت مسؤول جودة وسلامة مهنية (QA/QC & HSE) في مشاريع إنشائية. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "quality_reading": "قراءة عامة لوضع الجودة بناءً على البيانات المزوَّدة",
  "safety_reading": "قراءة عامة لوضع السلامة بناءً على البيانات المزوَّدة",
  "combined_risk_flags": ["نقطة خطر مشتركة أو متعلقة بالجودة/السلامة تستحق المتابعة"]
}`;

  const userMessage = `ملخص الجودة الفعلي (من QMS):
${trimForPrompt(context.executive.quality_summary)}

ملخص السلامة الفعلي (من HSE):
${trimForPrompt(context.executive.hse_summary)}

مؤشرا NCR وحوادث السلامة المصنَّفان فعلياً:
${trimForPrompt({ qms_open_ncrs: context.executive.indicators.qms_open_ncrs, hse_open_incidents: context.executive.indicators.hse_open_incidents })}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return { project_id: projectId, analysis: extractJson(response) };
}

// ---------- 9) كتابة الملخص التنفيذي ----------
async function writeExecutiveSummary({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);

  const system = `أنت كاتب تقارير تنفيذية لمجلس إدارة شركة مقاولات. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "executive_summary": "فقرة موجزة (3-6 جمل) تلخّص حالة المشروع العامة",
  "highlights": ["نقطة إيجابية أو مهمة يجب أن يعرفها المدير التنفيذي"],
  "concerns": ["نقطة قلق تستدعي قراراً إدارياً"],
  "recommended_next_steps": ["إجراء عملي محدد موصى به"]
}`;

  const userMessage = `التقرير التنفيذي الكامل الفعلي للمشروع:
${trimForPrompt(context.executive, 5000)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1800 });
  return { project_id: projectId, overall_status: context.executive.overall_status, summary: extractJson(response) };
}

// ---------- 10) اقتراح الإجراءات التصحيحية ----------
async function suggestCorrectiveActions({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);

  const system = `أنت مستشار إدارة مشاريع إنشائية متخصص في الإجراءات التصحيحية (Corrective Action Plans). ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "corrective_actions": [{"area": "المجال المتأثر (زمن/تكلفة/جودة/سلامة/موارد)", "action": "إجراء تصحيحي عملي محدد", "priority": "high|medium|low", "based_on": "المؤشر أو البيان الفعلي الذي بُني عليه الاقتراح"}],
  "monitoring_recommendations": ["توصية متابعة لقياس أثر الإجراء التصحيحي لاحقاً"]
}`;

  const userMessage = `مؤشرات التقرير التنفيذي الفعلية المصنَّفة (الأسوأ فالأفضل حسب الحالة):
${trimForPrompt(context.executive.indicators)}

المخاطر المفتوحة فعلياً:
${trimForPrompt((context.risks || []).filter((r) => r.status !== 'closed'))}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1600 });
  return { project_id: projectId, suggestions: extractJson(response) };
}

// ============================================================================
// ============================ البند 17: التقارير التنبؤية =================
// ============================================================================

// ---------- 1) احتمال تأخر المشروع ----------
/**
 * الاحتمال هنا مصنَّف حسابياً بشكل حتمي من بيانات فعلية (نسبة المهام المتأخرة
 * ومتوسط أيام التأخير الفعلي)، لا يُترَك للنموذج اللغوي وحده لتقدير رقم.
 */
async function predictProjectDelayRisk({ projectId } = {}) {
  if (!PM) throw new Error('وحدة إدارة المشاريع (projectManagement) غير متاحة على الخادم');
  const scheduleCompare = safe(() => PM.compareScheduleVsActual(projectId));
  if (!scheduleCompare) throw new Error('تعذر جلب بيانات الجدول الزمني الفعلية لهذا المشروع');

  const totalTasks = (scheduleCompare.tasks || []).length;
  const delayedRatio = totalTasks > 0 ? r2((scheduleCompare.delayed_tasks_count / totalTasks) * 100) : 0;

  // تصنيف حتمي (heuristic) وليس توليداً حراً: يعتمد على نسبة المهام المتأخرة الفعلية.
  let riskLevel = 'low';
  if (delayedRatio >= 40) riskLevel = 'high';
  else if (delayedRatio >= 15) riskLevel = 'medium';
  const riskLabels = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع' };

  const system = `أنت محلل مخاطر جدولة مشاريع إنشائية. لديك تصنيف احتمال تأخر محسوب حسابياً مسبقاً؛ مهمتك تفسيره فقط دون تغيير الرقم أو التصنيف. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "explanation": "تفسير عملي لسبب هذا التصنيف بناءً على الأرقام المزوَّدة",
  "watch_items": ["عنصر يستحق المتابعة لتقليل احتمال التأخر"]
}`;

  const userMessage = `نسبة المهام المتأخرة فعلياً: ${delayedRatio}% (${scheduleCompare.delayed_tasks_count} من ${totalTasks})
متوسط أيام التأخير الفعلي: ${scheduleCompare.average_delay_days}
التصنيف المحسوب حسابياً: ${riskLevel} (${riskLabels[riskLevel]})`;

  const response = await callClaude({ system, userMessage, maxTokens: 900 });
  return {
    project_id: projectId,
    delayed_tasks_ratio_percent: delayedRatio,
    average_delay_days: scheduleCompare.average_delay_days,
    risk_level: riskLevel,
    risk_level_label: riskLabels[riskLevel],
    ai_explanation: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

// ---------- 2) التكلفة المتوقعة عند الانتهاء ----------
/**
 * EAC/ETC/VAC تُحسَب حسابياً وحتمياً فعلياً في budgetManagement.getBudgetEVM
 * (صيغة EAC = AC + (BAC-EV)/CPI القياسية)، والذكاء الاصطناعي هنا يفسّر فقط.
 */
async function predictForecastCost({ projectId, budgetId = null } = {}) {
  if (!BUDGET) throw new Error('وحدة إدارة الميزانية (budgetManagement) غير متاحة على الخادم');
  let targetBudgetId = budgetId;
  if (!targetBudgetId) {
    if (!projectId) throw new Error('يجب تحديد projectId أو budgetId');
    const budgetsList = safe(() => BUDGET.listBudgets({ project_id: projectId, page: 1, pageSize: 50 }), { data: [] });
    const projectBudgets = budgetsList.data || budgetsList.items || [];
    if (!projectBudgets.length) throw new Error('لا توجد ميزانية مرتبطة بهذا المشروع لحساب التكلفة المتوقعة');
    targetBudgetId = projectBudgets[0].id;
  }
  const evm = BUDGET.getBudgetEVM(targetBudgetId);
  if (!evm) throw new Error('تعذر حساب مؤشرات EVM لهذه الميزانية');

  const system = `أنت محلل مالي هندسي متخصص في القيمة المكتسبة (EVM). لديك أرقام EAC/ETC/VAC محسوبة حسابياً مسبقاً من النظام؛ مهمتك تفسيرها فقط دون إعادة حسابها أو تغييرها. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "forecast_reading": "تفسير عملي مباشر لمعنى EAC/ETC/VAC الحالية لهذا المشروع",
  "over_or_under_budget_expected": "over|under|on_track",
  "management_note": "ملاحظة عملية موجهة للإدارة حول هذا التوقع"
}`;

  const userMessage = `مؤشرات EVM المحسوبة حسابياً فعلياً:
${trimForPrompt(evm)}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1000 });
  return {
    budget_id: targetBudgetId,
    project_id: projectId || null,
    bac: evm.bac, ac: evm.ac, ev: evm.ev,
    eac: evm.eac, etc: evm.etc, vac: evm.vac,
    ai_forecast: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

// ---------- 3) احتمالية تجاوز الميزانية ----------
async function predictBudgetOverrunLikelihood({ projectId, budgetId = null } = {}) {
  const costForecast = await predictForecastCost({ projectId, budgetId }).catch((e) => { throw e; });
  const vac = Number(costForecast.vac);

  // تصنيف حتمي مبني على VAC الفعلي (سالب = تجاوز متوقَّع)، وليس تخميناً حراً.
  const bac = Number(costForecast.bac) || 1;
  const vacRatioPercent = r2((vac / bac) * 100);
  let likelihood = 'low';
  if (vacRatioPercent <= -10) likelihood = 'high';
  else if (vacRatioPercent < 0) likelihood = 'medium';
  const likelihoodLabels = { low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة' };

  const system = `أنت محلل مخاطر مالية لمشاريع إنشائية. لديك احتمالية تجاوز ميزانية مصنَّفة حسابياً مسبقاً بناءً على VAC الفعلي؛ فسّرها فقط دون تغيير التصنيف. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "explanation": "تفسير عملي لهذه الاحتمالية بناءً على VAC والأرقام المزوَّدة",
  "mitigation_suggestions": ["إجراء عملي لتقليل احتمال تجاوز الميزانية"]
}`;

  const userMessage = `الانحراف المتوقع عند الانتهاء (VAC = BAC - EAC): ${vac}
نسبة VAC إلى الميزانية المعتمدة (BAC): ${vacRatioPercent}%
التصنيف المحسوب حسابياً: ${likelihood} (${likelihoodLabels[likelihood]})`;

  const response = await callClaude({ system, userMessage, maxTokens: 900 });
  return {
    project_id: projectId || null,
    budget_id: costForecast.budget_id,
    vac, vac_ratio_percent: vacRatioPercent,
    likelihood, likelihood_label: likelihoodLabels[likelihood],
    ai_explanation: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

// ---------- 4) المخاطر المحتملة ----------
/**
 * يُستقرأ من المخاطر المسجَّلة فعلياً في projectManagement (وليس تخميناً)، بالإضافة
 * لمؤشرات التقرير التنفيذي، ثم يُطلَب من الذكاء الاصطناعي فقط تصنيف الاتجاه
 * (تزايد/استقرار/تراجع احتمالي) بناءً على هذه المعطيات الحقيقية دون اختلاق مخاطر جديدة.
 */
async function predictPotentialRisks({ projectId } = {}) {
  const context = buildProjectAIContext(projectId);
  const openRisks = (context.risks || []).filter((r) => r.status !== 'closed');

  const system = `أنت محلل مخاطر مشاريع إنشائية. مهمتك تحليل اتجاه المخاطر المسجَّلة فعلياً فقط، دون اختلاق مخاطر غير موجودة في البيانات. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "risk_trend": "increasing|stable|decreasing",
  "top_risks_to_watch": [{"risk": "وصف الخطر كما ورد", "level": "المستوى كما ورد", "why_watch": "لماذا يستحق المتابعة الآن"}],
  "note": "ملاحظة إن كانت بيانات المخاطر قليلة جداً لاستنتاج اتجاه موثوق"
}`;

  const userMessage = `المخاطر المفتوحة المسجَّلة فعلياً للمشروع:
${trimForPrompt(openRisks)}

مؤشرات التقرير التنفيذي ذات الصلة:
${trimForPrompt({ schedule_variance: context.executive.indicators.schedule_variance, budget_utilization: context.executive.indicators.budget_utilization, open_high_critical_risks: context.executive.indicators.open_high_critical_risks })}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1400 });
  return {
    project_id: projectId,
    open_risks_count: openRisks.length,
    analysis: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

// ---------- 5) اتجاه أداء المشروع ----------
/**
 * يعتمد على مقارنة الفترة الحالية مقابل السابقة الحقيقية عبر reportPeriodsComparisons
 * (البند 5 من مواصفة "الفترة الحالية مقابل السابقة" المُنفَّذ فعلياً في 3/10)،
 * بدل اختراع اتجاه من العدم.
 */
async function predictPerformanceTrend({ projectId, periodType = 'monthly' } = {}) {
  if (!REPORT_PERIODS) throw new Error('وحدة التقارير الزمنية والمقارنة (reportPeriodsComparisons) غير متاحة على الخادم');

  const periodReport = safe(() => REPORT_PERIODS.buildPeriodComparisonReport({
    dataSource: 'projects', periodType, filters: { project_id: projectId },
  }));
  const context = buildProjectAIContext(projectId);

  if (!periodReport) {
    // لا تتوفر مقارنة فترات فعلية؛ لا نختلق اتجاهاً — نكتفي بالحالة الحالية المصنَّفة فعلياً.
    return {
      project_id: projectId,
      trend_available: false,
      current_overall_status: context.executive.overall_status_label,
      note: 'لا تتوفر بيانات فترة سابقة كافية لبناء اتجاه أداء موثوق حالياً؛ هذه قراءة اللحظة الحالية فقط.',
      disclaimer: FORECAST_DISCLAIMER,
    };
  }

  const system = `أنت محلل أداء مشاريع إنشائية عبر الزمن. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "trend": "improving|stable|declining",
  "trend_explanation": "تفسير عملي مبني على مقارنة الفترتين الفعلية",
  "focus_areas": ["مجال أداء يستحق التركيز عليه في الفترة القادمة"]
}`;

  const userMessage = `مقارنة الفترة الحالية مقابل السابقة (بيانات فعلية):
${trimForPrompt(periodReport, 4000)}

الحالة العامة الحالية المصنَّفة فعلياً: ${context.executive.overall_status_label}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1200 });
  return {
    project_id: projectId,
    trend_available: true,
    period_comparison: periodReport,
    analysis: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

// ---------- 6) توقع الإنتاجية ----------
async function predictProductivityOutlook({ projectId } = {}) {
  if (!PM) throw new Error('وحدة إدارة المشاريع (projectManagement) غير متاحة على الخادم');
  const scheduleCompare = safe(() => PM.compareScheduleVsActual(projectId));
  if (!scheduleCompare) throw new Error('تعذر جلب بيانات الجدول الزمني الفعلية لهذا المشروع لتقدير الإنتاجية');

  const tasks = scheduleCompare.tasks || [];
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const inProgress = tasks.filter((t) => t.status !== 'completed' && !t.is_late).length;
  const late = scheduleCompare.delayed_tasks_count;

  const system = `أنت محلل إنتاجية تنفيذ مشاريع إنشائية. ${NO_FABRICATION_RULE} أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي وفق البنية:
{
  "productivity_outlook": "positive|neutral|negative",
  "explanation": "تفسير عملي مبني على أعداد المهام المكتملة/الجارية/المتأخرة الفعلية",
  "suggestions_to_improve": ["اقتراح عملي لتحسين الإنتاجية القادمة"]
}`;

  const userMessage = `عدد المهام المكتملة فعلياً: ${completed}
عدد المهام الجارية دون تأخير: ${inProgress}
عدد المهام المتأخرة فعلياً: ${late}
متوسط أيام التأخير الفعلي: ${scheduleCompare.average_delay_days}`;

  const response = await callClaude({ system, userMessage, maxTokens: 1000 });
  return {
    project_id: projectId,
    completed_tasks: completed, in_progress_tasks: inProgress, late_tasks: late,
    average_delay_days: scheduleCompare.average_delay_days,
    analysis: extractJson(response),
    disclaimer: FORECAST_DISCLAIMER,
  };
}

module.exports = {
  isAIAvailable,
  // البند 16
  generateReportFromData,
  summarizeReport,
  analyzeProjectIndicators,
  detectIssues,
  detectDeviations,
  analyzeDelays,
  analyzeCosts,
  analyzeQualityAndSafety,
  writeExecutiveSummary,
  suggestCorrectiveActions,
  // البند 17
  predictProjectDelayRisk,
  predictForecastCost,
  predictBudgetOverrunLikelihood,
  predictPotentialRisks,
  predictPerformanceTrend,
  predictProductivityOutlook,
};
