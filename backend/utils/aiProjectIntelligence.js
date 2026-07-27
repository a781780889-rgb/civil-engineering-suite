/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الرابع (4/10): الذكاء الاصطناعي لإدارة المشاريع (Project Intelligence)
 * ===================================================================================
 *
 * يوفر هذا الملف تحليلاً شاملاً حقيقياً لمشروع واحد، بنفس أسلوب وحدات AI القائمة
 * في النظام (budgetAI.js / hseAI.js / qmsAI.js / drawingAI.js / surveyAI.js /
 * documentAI.js): بدون أي SDK خارجي، استدعاء https المدمجة في Node مباشرة إلى
 * واجهة Claude، وبدون تخزين مفتاح API داخل الكود.
 *
 * تسلسل الوصول الإلزامي لهذا الملف (لا يجوز تجاوزه):
 *   AI Service (هذا الملف)
 *     → aiDataAccessLayer.getAIData / getProjectSnapshot   (الجزء 3/10)
 *       → aiEngineeringCore.resolveAIContext                (الجزء 1/10 - RBAC)
 *         → الوحدات الفعلية (projectManagement/scheduling/budgetManagement/...)
 *           → JSON DB
 *
 * لا بيانات وهمية: كل تحليل هنا يُبنى من لقطة مشروع حقيقية (getProjectSnapshot)
 * مأخوذة وقت الاستدعاء؛ لا نصوص ثابتة ولا نتائج مُلفَّقة. إن كان قسم من اللقطة
 * غير متاح (وحدة غير مثبَّتة أو بيانات غير موجودة بعد)، يُذكر ذلك صراحة في
 * السياق المرسل إلى AI بدل التظاهر بتوفره.
 *
 * القيود الإلزامية (من الوثيقة الأصلية - البند 31 "قواعد مهمة جداً"):
 *   - يُمنع اختلاق بيانات أو نتائج هندسية.
 *   - يُمنع اعتماد تصميم إنشائي نهائي أو إصدار قرار سلامة نهائي بشكل مستقل.
 *   - يُمنع تعديل الميزانية أو الجدول الزمني تلقائياً (هذا الملف قراءة+تحليل فقط،
 *     بدون أي دالة كتابة).
 *   - كل توصية صادرة عن AI هي اقتراح للمراجعة البشرية، وليست قراراً نافذاً.
 */

const https = require('https');

const AI_CORE = require('./aiEngineeringCore');
const AI_DATA = require('./aiDataAccessLayer');

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** استدعاء منخفض المستوى لواجهة Claude API عبر https المدمجة في Node (بدون SDK خارجي) */
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
// 1) تحليل إحصائي حقيقي (بدون AI) مبني من اللقطة - يُستخدم كأساس ثابت قبل استدعاء AI
// ===================================================================================

/**
 * يحسب مؤشرات فعلية بسيطة من اللقطة (بدون AI) لضمان أن أي رقم أساسي في التحليل
 * له مصدر حتمي قابل لإعادة الحساب، وليس فقط رأي نموذج AI.
 */
function computeDeterministicIndicators(snapshot) {
  const indicators = { generated_at: new Date().toISOString() };

  const projectInfo = snapshot.sections.project_info;
  if (projectInfo && projectInfo.available) {
    const p = projectInfo.data;
    indicators.progress_percent = typeof p.progress_percent === 'number' ? p.progress_percent : null;
    indicators.status = p.status || null;
    indicators.priority = p.priority || null;
    indicators.budget_allocated = typeof p.budget === 'number' ? p.budget : null;
    indicators.contract_value = typeof p.contract_value === 'number' ? p.contract_value : null;

    if (Array.isArray(p.tasks) && p.tasks.length) {
      const total = p.tasks.length;
      const delayed = p.tasks.filter((t) => t.status === 'delayed').length;
      const blocked = p.tasks.filter((t) => t.status === 'blocked').length;
      const completed = p.tasks.filter((t) => t.status === 'completed').length;
      indicators.tasks_summary = {
        total, delayed, blocked, completed,
        delayed_percent: total ? Math.round((delayed / total) * 1000) / 10 : 0,
        blocked_percent: total ? Math.round((blocked / total) * 1000) / 10 : 0,
      };
    }

    if (p.financial_summary) {
      indicators.financial_summary = p.financial_summary;
    }
  }

  const risks = snapshot.sections.project_risks;
  if (risks && risks.available) {
    const items = risks.data.items || [];
    indicators.open_risks_count = items.filter((r) => r.status !== 'closed' && r.status !== 'mitigated').length;
    indicators.high_risks_count = items.filter((r) => r.level === 'high' || r.level === 'critical').length;
  }

  const safetyIncidents = snapshot.sections.safety_incidents;
  if (safetyIncidents && safetyIncidents.available) {
    indicators.safety_incidents_count = (safetyIncidents.data.items || []).length;
  }

  const qualityInspections = snapshot.sections.quality_inspections;
  if (qualityInspections && qualityInspections.available) {
    const items = qualityInspections.data.items || [];
    indicators.quality_inspections_count = items.length;
    indicators.quality_failed_count = items.filter((r) => r.result === 'fail' || r.result === 'rejected').length;
  }

  const budgets = snapshot.sections.budgets;
  if (budgets && budgets.available) {
    const items = budgets.data.items || [];
    indicators.linked_budgets_count = items.length;
  }

  const equipment = snapshot.sections.equipment;
  if (equipment && equipment.available) {
    indicators.equipment_assigned_count = (equipment.data.items || []).length;
  }

  const documents = snapshot.sections.documents;
  if (documents && documents.available) {
    indicators.documents_count = (documents.data.items || []).length;
  }

  const drawings = snapshot.sections.drawings;
  if (drawings && drawings.available) {
    indicators.drawings_count = (drawings.data.items || []).length;
  }

  return indicators;
}

// ===================================================================================
// 2) التحليل الشامل للمشروع بالذكاء الاصطناعي
// ===================================================================================

/**
 * التحليل الرئيسي للجزء 4/10: يأخذ لقطة مشروع كاملة (عبر aiDataAccessLayer، والتي
 * تفرض بدورها RBAC من الجزء 1/10)، يحسب مؤشرات حتمية أولاً، ثم يرسل كل ذلك إلى
 * Claude API لإنتاج: ملخص تنفيذي + مشاكل حالية + أهم المخاطر + أهم التأخيرات +
 * توصيات + إجراءات مقترحة - تماماً كما تنص الوثيقة الأصلية (القسم 15، البند 4).
 *
 * لا يُتخذ أي قرار نهائي هنا؛ المخرجات اقتراحات للمراجعة البشرية فقط.
 */
async function analyzeProjectComprehensive({ token, projectId }) {
  if (!token) throw new Error('يجب تسجيل الدخول لاستخدام تحليل المشاريع بالذكاء الاصطناعي');
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  // يفرض هذا الاستدعاء صلاحية "project" عبر الجزء 1/10 تلقائياً؛ إن لم تتوفر
  // الصلاحية سيُرمى AIPermissionError من هنا مباشرة قبل أي معالجة أخرى.
  const snapshot = AI_DATA.getProjectSnapshot(token, projectId);

  if (!snapshot.sections.project_info || !snapshot.sections.project_info.available) {
    throw new Error(`تعذر جلب بيانات المشروع الأساسية: ${snapshot.sections.project_info ? snapshot.sections.project_info.reason : 'سبب غير معروف'}`);
  }

  const indicators = computeDeterministicIndicators(snapshot);

  const startedAt = new Date().toISOString();
  // نحتاج سياق المستخدم لتسجيل العملية بدقة (نفس مصدر الصلاحية أعلاه)
  const authCtx = AI_CORE.resolveAIContext(token, 'project');

  const system = `أنت مدير مشاريع هندسي خبير (PMP) متخصص في المشاريع الإنشائية، تحلل بيانات مشروع واحد حقيقي من منصة إدارة مشاريع هندسية.
مهمتك تقديم تحليل شامل موضوعي بناءً حصراً على البيانات المزوَّدة أدناه، دون اختلاق أي معلومة غير موجودة فيها.
إن كان قسم من البيانات غير متوفر ("غير متوفر" أو "unavailable")، اذكر ذلك صراحة ولا تخمّن قيمته.
تذكّر: أنت أداة تحليل ومساعدة فقط؛ القرار النهائي الهندسي والمالي والسلامة المهنية يبقى بيد المسؤول المهني المخوَّل. لا تصدر اعتماداً هندسياً أو مالياً أو أمنياً نهائياً.

أجب حصراً بصيغة JSON صالحة بدون أي نص إضافي قبلها أو بعدها، وفق البنية التالية بالضبط:
{
  "executive_summary": "ملخص تنفيذي موجز (3-5 جمل) لحالة المشروع العامة",
  "overall_status_assessment": "on_track|at_risk|critical|insufficient_data",
  "current_problems": [{"problem": "وصف المشكلة الحالية", "evidence": "من أي بيانات استُخلصت", "severity": "high|medium|low"}],
  "top_risks": [{"risk": "وصف الخطر", "source_section": "من أي قسم بيانات (مثل project_risks/safety_incidents)", "severity": "high|medium|low"}],
  "top_delays": [{"item": "وصف التأخير أو النشاط/المهمة المتأخرة", "impact": "الأثر المحتمل"}],
  "recommendations": ["توصية عملية قابلة للتنفيذ"],
  "suggested_actions": [{"action": "إجراء مقترح محدد", "priority": "high|medium|low", "requires_approval_from": "الدور المسؤول عن الموافقة، مثل مدير المشروع/مدير المالية"}],
  "data_gaps": ["أي بيانات كانت غير متوفرة أثرت على دقة هذا التحليل، إن وُجدت"],
  "confidence_level": "low|medium|high (بناءً على اكتمال البيانات المتاحة)"
}`;

  const userMessage = `المؤشرات الحتمية المحسوبة مباشرة من قاعدة البيانات (وليست من AI):
${trimForPrompt(indicators, 2000)}

--- بيانات المشروع الأساسية (المراحل، المهام، الفريق، المخاطر، الملخص المالي) ---
${trimForPrompt(snapshot.sections.project_info.data, 3500)}

--- مخاطر المشروع (project_risks) ---
${trimForPrompt(snapshot.sections.project_risks, 1200)}

--- الموارد المخصَّصة (project_resources) ---
${trimForPrompt(snapshot.sections.project_resources, 800)}

--- الجداول الزمنية المرتبطة (schedules) ---
${trimForPrompt(snapshot.sections.schedules, 1500)}

--- الميزانيات المرتبطة (budgets) ---
${trimForPrompt(snapshot.sections.budgets, 1200)}

--- المعدات المخصَّصة (equipment) ---
${trimForPrompt(snapshot.sections.equipment, 800)}

--- حوادث السلامة (safety_incidents) ---
${trimForPrompt(snapshot.sections.safety_incidents, 800)}

--- فحوصات الجودة (quality_inspections) ---
${trimForPrompt(snapshot.sections.quality_inspections, 800)}

--- المستندات المرتبطة (documents) - عدد فقط للسياق ---
عدد المستندات: ${indicators.documents_count ?? 'غير متوفر'}

--- المخططات المرتبطة (drawings) - عدد فقط للسياق ---
عدد المخططات: ${indicators.drawings_count ?? 'غير متوفر'}`;

  let analysis;
  let errorMessage = null;
  try {
    const response = await callClaude({ system, userMessage, maxTokens: 2800 });
    analysis = extractJson(response);
  } catch (e) {
    errorMessage = e.message;
  }

  const finishedAt = new Date().toISOString();
  AI_CORE.recordAIOperation({
    userId: authCtx.userId,
    username: authCtx.username,
    domain: 'project',
    operationType: 'project_comprehensive_analysis',
    projectId,
    model: errorMessage ? null : MODEL,
    startedAt,
    finishedAt,
    success: !errorMessage,
    errorMessage,
    dataSources: Object.keys(snapshot.sections).filter((k) => snapshot.sections[k].available).map((k) => `snapshot.${k}`),
    resultSummary: errorMessage ? null : `تحليل شامل: ${analysis.overall_status_assessment || ''}`,
  });

  if (errorMessage) throw new Error(errorMessage);

  return {
    success: true,
    project_id: projectId,
    generated_at: finishedAt,
    deterministic_indicators: indicators,
    ai_analysis: analysis,
    source: {
      note: 'التحليل مبني على لقطة بيانات حقيقية مأخوذة وقت الاستدعاء عبر aiDataAccessLayer.getProjectSnapshot',
      sections_used: Object.keys(snapshot.sections).filter((k) => snapshot.sections[k].available),
      sections_unavailable: Object.keys(snapshot.sections).filter((k) => !snapshot.sections[k].available),
    },
  };
}

/**
 * نسخة "سريعة" بدون AI: تُعيد فقط المؤشرات الحتمية المحسوبة من اللقطة، لاستخدامها
 * في لوحات التحكم أو عند عدم توفر ANTHROPIC_API_KEY، بدل حجب أي معلومة عن المستخدم.
 */
function getProjectIndicatorsOnly({ token, projectId }) {
  if (!token) throw new Error('يجب تسجيل الدخول');
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  const snapshot = AI_DATA.getProjectSnapshot(token, projectId);
  if (!snapshot.sections.project_info || !snapshot.sections.project_info.available) {
    throw new Error(`تعذر جلب بيانات المشروع الأساسية: ${snapshot.sections.project_info ? snapshot.sections.project_info.reason : 'سبب غير معروف'}`);
  }
  const indicators = computeDeterministicIndicators(snapshot);
  return {
    success: true,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    deterministic_indicators: indicators,
    ai_available: isAIAvailable(),
    note: isAIAvailable()
      ? 'لتحليل تفسيري كامل بالذكاء الاصطناعي استخدم analyzeProjectComprehensive'
      : 'ميزة التحليل التفسيري بالذكاء الاصطناعي غير مفعّلة حالياً (لا يوجد ANTHROPIC_API_KEY)؛ هذه المؤشرات محسوبة مباشرة من البيانات الفعلية فقط.',
  };
}

module.exports = {
  isAIAvailable,
  analyzeProjectComprehensive,
  getProjectIndicatorsOnly,
  computeDeterministicIndicators, // مُصدَّرة لإعادة استخدامها في الجزء 5/10 (التنبؤ بالتأخر)
};
