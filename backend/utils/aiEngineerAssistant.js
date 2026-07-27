/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الثاني (2/10): المساعد الهندسي الذكي (Conversational Engineering Assistant)
 * ===================================================================================
 *
 * هذا الملف يوفّر مساعداً محادثياً حقيقياً (عربي/إنجليزي) يُجيب على أسئلة المستخدم
 * اعتماداً على بيانات النظام الفعلية فقط. لا يستدعي Claude بالسؤال الخام مباشرة؛
 * بل يتّبع تدفقاً من 4 خطوات:
 *
 *   1) تصنيف نية السؤال (Intent Classification) عبر قواعد كلمات مفتاحية عربية/
 *      إنجليزية بسيطة وسريعة وموثوقة (بدون استدعاء API خارجي لهذه الخطوة، تفادياً
 *      لتكلفة وزمن استجابة غير ضروريين على كل سؤال).
 *   2) التحقق من الصلاحية عبر resolveAIContext() من الجزء 1 (aiEngineeringCore.js)
 *      - يُمنع تنفيذ أي استعلام بيانات دون تحقق صلاحية مسبق.
 *   3) جمع سياق حقيقي محدود ودقيق (وليس تفريغ قاعدة البيانات كاملة) من نفس دوال
 *      البيانات الفعلية المستخدَمة في الأقسام الأصلية (scheduling، budgetManagement،
 *      equipmentManagement، hseManagement، qmsManagement، documentWorkflow...).
 *   4) صياغة الإجابة:
 *        - إن كان السؤال يقع ضمن الأسئلة "القياسية" المذكورة في المواصفة (نسبة
 *          الإنجاز، البند المتجاوز للميزانية، الأنشطة المتأخرة...)، تُصاغ الإجابة
 *          مباشرة من الأرقام الفعلية المحسوبة (بدون AI API، أسرع وأوثق).
 *        - إن كان السؤال حراً/مركّباً ولا يطابق نمطاً قياسياً، ويوجد
 *          ANTHROPIC_API_KEY، يُمرَّر السياق المجمَّع + السؤال إلى Claude مع تعليمات
 *          صارمة بعدم اختلاق أي معلومة غير موجودة في السياق المرفق.
 *        - إن لم يوجد مفتاح API ولم يطابق السؤال أي نمط قياسي، تُعاد رسالة صريحة
 *          بعدم توفر الخدمة، وليس إجابة مختلقة.
 *
 * كل استدعاء ناجح أو فاشل يُسجَّل عبر withAILogging من الجزء 1.
 */

const https = require('https');

const AI_CORE = require('./aiEngineeringCore');

const PM = require('./projectManagement');
let SCHED = null; try { SCHED = require('./scheduling'); } catch (e) { SCHED = null; }
let BUDGET = null; try { BUDGET = require('./budgetManagement'); } catch (e) { BUDGET = null; }
let EQUIP = null; try { EQUIP = require('./equipmentManagement'); } catch (e) { EQUIP = null; }
let HSE = null; try { HSE = require('./hseManagement'); } catch (e) { HSE = null; }
let QMS = null; try { QMS = require('./qmsManagement'); } catch (e) { QMS = null; }
let DOC_WORKFLOW = null; try { DOC_WORKFLOW = require('./documentWorkflow'); } catch (e) { DOC_WORKFLOW = null; }

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function isAIAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

/** بعض الدوال تُرجع {success, data} وبعضها البيانات مباشرة؛ استخراج آمن موحّد */
function unwrapData(result) {
  if (result && typeof result === 'object' && 'success' in result && 'data' in result) return result.data;
  return result;
}

function callClaude({ system, userMessage, maxTokens = 1500 }) {
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

// ===================================================================================
// 1) تصنيف نية السؤال (Intent Classification) — قواعد كلمات مفتاحية عربي/إنجليزي
// ===================================================================================

/**
 * كل نمط قياسي مرتبط بـ: نطاق صلاحية (domain من AI_DOMAIN_PERMISSIONS في الجزء 1)،
 * وكلمات مفتاحية عربية وإنجليزية، ودالة "handler" تبني السياق وتصوغ الجواب مباشرة
 * من الأرقام الفعلية دون الحاجة لاستدعاء Claude API (أسرع وأدق وأرخص).
 */
const INTENT_PATTERNS = [
  {
    key: 'project_status',
    domain: 'project',
    keywords_ar: ['حالة المشروع', 'وضع المشروع', 'ملخص المشروع'],
    keywords_en: ['project status', 'project summary', 'how is the project'],
    handler: handleProjectStatus,
  },
  {
    key: 'completion_percent',
    domain: 'project',
    keywords_ar: ['نسبة الإنجاز', 'نسبة التقدم', 'كم أنجز'],
    keywords_en: ['completion percent', 'progress percent', '% complete'],
    handler: handleCompletionPercent,
  },
  {
    key: 'budget_overrun_item',
    domain: 'budget',
    keywords_ar: ['متجاوز للميزانية', 'تجاوز الميزانية', 'أكثر بند', 'تجاوز التكلفة'],
    keywords_en: ['over budget', 'budget overrun', 'exceeded budget'],
    handler: handleBudgetOverrunItem,
  },
  {
    key: 'delayed_activities',
    domain: 'schedule',
    keywords_ar: ['الأنشطة المتأخرة', 'نشاط متأخر', 'أنشطة متأخرة'],
    keywords_en: ['delayed activities', 'late activities', 'behind schedule'],
    handler: handleDelayedActivities,
  },
  {
    key: 'stopped_equipment',
    domain: 'equipment',
    keywords_ar: ['المعدات المتوقفة', 'معدات متوقفة', 'معدة متوقفة', 'أعطال المعدات'],
    keywords_en: ['stopped equipment', 'idle equipment', 'equipment down', 'equipment stopped', 'equipment is stopped'],
    handler: handleStoppedEquipment,
  },
  {
    key: 'current_risks',
    domain: 'project',
    keywords_ar: ['المخاطر الحالية', 'مخاطر المشروع', 'أهم المخاطر'],
    keywords_en: ['current risks', 'project risks', 'top risks'],
    handler: handleCurrentRisks,
  },
  {
    key: 'latest_quality_notes',
    domain: 'quality',
    keywords_ar: ['ملاحظات الجودة', 'آخر ملاحظات', 'عدم مطابقة'],
    keywords_en: ['quality notes', 'quality remarks', 'ncr'],
    handler: handleLatestQualityNotes,
  },
  {
    key: 'documents_needing_approval',
    domain: 'document',
    keywords_ar: ['مستندات تحتاج اعتماد', 'تحتاج موافقة', 'مستندات معلقة'],
    keywords_en: ['documents needing approval', 'pending approval', 'awaiting approval'],
    handler: handleDocumentsNeedingApproval,
  },
  {
    key: 'this_week_work',
    domain: 'project',
    keywords_ar: ['هذا الأسبوع', 'الأعمال المنفذة', 'ماذا نُفِّذ'],
    keywords_en: ['this week', 'work done this week', 'completed this week'],
    handler: handleThisWeekWork,
  },
];

function classifyIntent(question) {
  const q = String(question || '').toLowerCase();
  for (const pattern of INTENT_PATTERNS) {
    const hitAr = pattern.keywords_ar.some((k) => q.includes(k));
    const hitEn = pattern.keywords_en.some((k) => q.includes(k.toLowerCase()));
    if (hitAr || hitEn) return pattern;
  }
  return null;
}

// ===================================================================================
// 2) معالجات الأسئلة القياسية (Rule-based Handlers) - كل واحدة تعتمد على بيانات فعلية
// ===================================================================================

function requireProjectId(projectId) {
  if (!projectId) throw new Error('يجب تحديد المشروع (project_id) للإجابة على هذا السؤال');
}

function handleProjectStatus({ projectId }) {
  requireProjectId(projectId);
  const project = PM.getProject(projectId, { includeRelations: true });
  const scheduleSnap = SCHED ? safe(() => SCHED.getIntegrationSnapshot(projectId)) : null;
  const openRisksCount = (project.risks || []).filter((r) => r.status !== 'closed').length;

  const parts = [
    `المشروع "${project.name}" (${project.code || '—'}) — الحالة: ${project.status || '—'}.`,
    `نسبة الإنجاز المسجَّلة: ${project.progress_percent != null ? project.progress_percent + '%' : 'غير محدَّدة'}.`,
  ];
  if (scheduleSnap && scheduleSnap.schedules && scheduleSnap.schedules.length) {
    const s = scheduleSnap.schedules[0];
    parts.push(`نسبة الإنجاز حسب الجدول الزمني الفعلي: ${s.overall_progress_percent}%، وتاريخ الانتهاء المتوقع: ${s.forecast_finish_date}${s.forecast_delay_days > 0 ? ` (تأخير متوقع ${s.forecast_delay_days} يوم)` : ''}.`);
  }
  parts.push(`عدد المخاطر المفتوحة حالياً: ${openRisksCount}.`);

  return {
    answer: parts.join(' '),
    data_sources: ['projectManagement', scheduleSnap ? 'scheduling' : null].filter(Boolean),
    project_id: projectId,
  };
}

function handleCompletionPercent({ projectId }) {
  requireProjectId(projectId);
  const project = PM.getProject(projectId, { includeRelations: false });
  const scheduleSnap = SCHED ? safe(() => SCHED.getIntegrationSnapshot(projectId)) : null;
  const scheduleProgress = scheduleSnap?.schedules?.[0]?.overall_progress_percent;

  let answer = `نسبة الإنجاز المسجَّلة في بطاقة المشروع: ${project.progress_percent != null ? project.progress_percent + '%' : 'غير محدَّدة'}.`;
  if (scheduleProgress != null) {
    answer += ` أما نسبة الإنجاز المحسوبة فعلياً من الجدول الزمني (حسب الأنشطة المنجزة): ${scheduleProgress}%.`;
  }
  return { answer, data_sources: ['projectManagement', 'scheduling'].filter((s) => s !== 'scheduling' || scheduleSnap), project_id: projectId };
}

function handleBudgetOverrunItem({ projectId }) {
  requireProjectId(projectId);
  if (!BUDGET) throw new Error('وحدة إدارة الميزانية غير متاحة حالياً');
  const budgets = unwrapData(safe(() => BUDGET.listBudgets({ project_id: projectId, pageSize: 10 }))) || [];
  if (!budgets.length) return { answer: 'لا توجد ميزانية مسجَّلة لهذا المشروع بعد.', data_sources: ['budgetManagement'], project_id: projectId };

  const budget = budgets[0];
  const deviation = safe(() => unwrapData(BUDGET.getDeviationAnalysis(budget.id)));
  if (!deviation || !Array.isArray(deviation.by_phase) || !deviation.by_phase.length) {
    return { answer: 'لا توجد بيانات كافية لتحديد بند متجاوز للميزانية حالياً؛ تحقّق من وجود مراحل BBS وتكاليف فعلية مسجَّلة.', data_sources: ['budgetManagement'], project_id: projectId };
  }
  // by_phase مرتَّبة أصلاً تصاعدياً حسب variance (الأكثر سلبية = الأكثر تجاوزاً أولاً)
  const worst = deviation.by_phase[0];
  if (worst.variance >= 0) {
    return { answer: 'لا يوجد حالياً أي بند متجاوز للميزانية؛ جميع المراحل ضمن أو دون التكلفة المخطَّطة.', data_sources: ['budgetManagement'], project_id: projectId };
  }
  return {
    answer: `أكثر بند (مرحلة) تجاوزاً للميزانية هو "${worst.phase_name}" بتكلفة فعلية ${worst.actual_cost} مقابل مخطَّط ${worst.planned_cost} (تجاوز ${Math.abs(worst.variance)}، أي ${Math.abs(worst.variance_pct)}%، تصنيف الانحراف: ${worst.deviation?.level || '—'}).`,
    data_sources: ['budgetManagement'],
    project_id: projectId,
  };
}

function handleDelayedActivities({ projectId }) {
  requireProjectId(projectId);
  if (!SCHED) throw new Error('وحدة الجدول الزمني غير متاحة حالياً');
  const snap = SCHED.getIntegrationSnapshot(projectId);
  if (!snap.schedules.length) return { answer: 'لا يوجد جدول زمني مسجَّل لهذا المشروع بعد.', data_sources: ['scheduling'], project_id: projectId };

  const s = snap.schedules[0];
  const comparison = safe(() => SCHED.compareScheduleVsActual(s.id));
  if (!comparison) return { answer: 'تعذّر حساب مقارنة الجدول الزمني بالتنفيذ الفعلي.', data_sources: ['scheduling'], project_id: projectId };

  if (comparison.delayed_activities_count === 0) {
    return { answer: 'لا توجد أنشطة متأخرة حالياً في الجدول الزمني لهذا المشروع.', data_sources: ['scheduling'], project_id: projectId };
  }
  const topDelayed = (comparison.activities || [])
    .filter((a) => a.is_late)
    .sort((a, b) => (b.delay_days || 0) - (a.delay_days || 0))
    .slice(0, 5)
    .map((a) => `${a.name} (تأخير ${a.delay_days} يوم${a.is_critical ? '، على المسار الحرج' : ''})`);

  return {
    answer: `يوجد ${comparison.delayed_activities_count} نشاط متأخر بمتوسط تأخير ${comparison.average_delay_days} يوم. أبرز الأنشطة المتأخرة: ${topDelayed.join('، ')}.`,
    data_sources: ['scheduling'],
    project_id: projectId,
  };
}

function handleStoppedEquipment({ projectId }) {
  if (!EQUIP) throw new Error('وحدة إدارة المعدات غير متاحة حالياً');
  const alerts = safe(() => unwrapData(EQUIP.getAlertsCenter ? EQUIP.getAlertsCenter({}) : null));
  const allEquipment = unwrapData(safe(() => EQUIP.listEquipment({ projectId: projectId || undefined }))) || [];
  const stopped = allEquipment.filter((e) => ['stopped', 'down', 'maintenance', 'out_of_service'].includes(e.status));

  if (!stopped.length) {
    return { answer: 'لا توجد معدات متوقفة حالياً ضمن النطاق المطلوب.', data_sources: ['equipmentManagement'], project_id: projectId };
  }
  const names = stopped.slice(0, 10).map((e) => `${e.name || e.code} (${e.status})`);
  return {
    answer: `يوجد ${stopped.length} معدة متوقفة حالياً: ${names.join('، ')}.`,
    data_sources: ['equipmentManagement'],
    project_id: projectId,
  };
}

function handleCurrentRisks({ projectId }) {
  requireProjectId(projectId);
  const project = PM.getProject(projectId, { includeRelations: true });
  const risks = (project.risks || []).filter((r) => r.status !== 'closed');
  if (!risks.length) return { answer: 'لا توجد مخاطر مفتوحة مسجَّلة لهذا المشروع حالياً.', data_sources: ['projectManagement'], project_id: projectId };

  const sorted = risks.slice().sort((a, b) => (b.severity_score || b.risk_score || 0) - (a.severity_score || a.risk_score || 0)).slice(0, 5);
  const list = sorted.map((r) => `${r.title || r.name} (${r.level || r.risk_level || 'غير مصنَّف'})`);
  return {
    answer: `يوجد ${risks.length} خطر مفتوح لهذا المشروع. أبرزها: ${list.join('، ')}.`,
    data_sources: ['projectManagement'],
    project_id: projectId,
  };
}

function handleLatestQualityNotes({ projectId }) {
  if (!QMS) throw new Error('وحدة إدارة الجودة غير متاحة حالياً');
  const ncrs = unwrapData(safe(() => QMS.listNcrs({ projectId: projectId || undefined }))) || [];
  if (!ncrs.length) return { answer: 'لا توجد حالات عدم مطابقة (NCR) مسجَّلة حالياً.', data_sources: ['qmsManagement'], project_id: projectId };

  const recent = ncrs.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 5);
  const list = recent.map((n) => `${n.title || n.ncr_number} (${n.severity || '—'}, ${n.status})`);
  return {
    answer: `آخر ${recent.length} ملاحظة جودة (NCR): ${list.join('، ')}.`,
    data_sources: ['qmsManagement'],
    project_id: projectId,
  };
}

function handleDocumentsNeedingApproval({ projectId }) {
  if (!DOC_WORKFLOW) throw new Error('وحدة سير عمل المستندات غير متاحة حالياً');
  const pending = unwrapData(safe(() => DOC_WORKFLOW.listPendingApprovals({ projectId: projectId || null }))) || [];
  if (!pending.length) return { answer: 'لا توجد مستندات بانتظار الاعتماد حالياً.', data_sources: ['documentWorkflow'], project_id: projectId };

  const list = pending.slice(0, 10).map((d) => d.title || d.document_number || d.document_id);
  return {
    answer: `يوجد ${pending.length} مستند بانتظار الاعتماد: ${list.join('، ')}.`,
    data_sources: ['documentWorkflow'],
    project_id: projectId,
  };
}

function handleThisWeekWork({ projectId }) {
  requireProjectId(projectId);
  const tasks = safe(() => PM.listTasks(projectId, {})) || [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const doneThisWeek = tasks.filter((t) => t.status === 'completed' && t.updated_at && new Date(t.updated_at) >= weekAgo);

  if (!doneThisWeek.length) {
    return { answer: 'لا توجد مهام مكتملة مسجَّلة خلال آخر 7 أيام لهذا المشروع.', data_sources: ['projectManagement'], project_id: projectId };
  }
  const list = doneThisWeek.slice(0, 10).map((t) => t.title || t.name);
  return {
    answer: `تم إنجاز ${doneThisWeek.length} مهمة خلال الأسبوع الماضي: ${list.join('، ')}.`,
    data_sources: ['projectManagement'],
    project_id: projectId,
  };
}

// ===================================================================================
// 3) المسار الحر عبر Claude (لأسئلة خارج الأنماط القياسية) - مع سياق حقيقي مُرفَق فقط
// ===================================================================================

/** يبني سياقاً عاماً مختصراً وحقيقياً حول المشروع لتمريره لـ Claude في الأسئلة الحرة */
function buildGeneralProjectContext(projectId) {
  if (!projectId) return null;
  const context = {};
  context.project = safe(() => PM.getProject(projectId, { includeRelations: true }));
  context.schedule = SCHED ? safe(() => SCHED.getIntegrationSnapshot(projectId)) : null;
  context.equipment_alerts = EQUIP ? safe(() => unwrapData(EQUIP.getAlertsCenter ? EQUIP.getAlertsCenter({}) : null)) : null;
  context.hse_dashboard = HSE ? safe(() => HSE.getDashboard(projectId)) : null;
  context.qms_dashboard = QMS ? safe(() => QMS.getDashboard(projectId)) : null;
  context.pending_document_approvals = DOC_WORKFLOW ? safe(() => unwrapData(DOC_WORKFLOW.listPendingApprovals({ projectId }))) : null;
  return context;
}

function trimForPrompt(obj, maxChars = 4000) {
  const str = JSON.stringify(obj);
  return str.length > maxChars ? str.slice(0, maxChars) + ' …(مقتطَع)' : str;
}

async function answerFreeformQuestion({ question, projectId, lang = 'ar' }) {
  const context = buildGeneralProjectContext(projectId);

  const system = `أنت مساعد هندسي ذكي داخل منصة إدارة مشاريع هندسة مدنية. تجيب حصراً استناداً إلى البيانات الفعلية المرفقة في السياق أدناه - لا تخترع أي رقم أو اسم أو تاريخ غير موجود فيها. إن كانت البيانات المرفقة غير كافية للإجابة، قل بوضوح: "لا توجد بيانات كافية لإعطاء نتيجة موثوقة" بدلاً من التخمين. أجب باللغة ${lang === 'en' ? 'الإنجليزية' : 'العربية'} بإيجاز ووضوح، بصيغة نص عادي (وليس JSON).`;

  const userMessage = context
    ? `سياق بيانات المشروع الفعلية:\n${trimForPrompt(context)}\n\nسؤال المستخدم: ${question}`
    : `لا يوجد مشروع محدَّد في هذا السؤال. سؤال المستخدم العام: ${question}\n\nملاحظة: إن كان السؤال يتطلب بيانات مشروع محدَّد، وضّح للمستخدم أنه يجب تحديد المشروع أولاً.`;

  const answer = await callClaude({ system, userMessage, maxTokens: 1200 });
  return { answer, data_sources: context ? Object.keys(context).filter((k) => context[k]) : [], project_id: projectId || null, via_ai_model: MODEL };
}

// ===================================================================================
// 4) نقطة الدخول الموحَّدة للمساعد (مع الصلاحيات والتسجيل)
// ===================================================================================

/**
 * نقطة الدخول الرئيسية: تتحقق من الصلاحية، تصنّف النية، وتوجّه للمعالج المناسب،
 * ثم تسجّل العملية بالكامل عبر withAILogging من الجزء 1.
 */
async function askEngineeringAssistant({ token, question, projectId = null, lang = 'ar' }) {
  if (!question || !String(question).trim()) throw new Error('يجب إرسال سؤال (question)');

  const intent = classifyIntent(question);
  const domain = intent ? intent.domain : 'project';

  // التحقق من الصلاحية عبر طبقة الجزء 1 قبل أي وصول للبيانات
  const authCtx = AI_CORE.resolveAIContext(token, domain);

  return AI_CORE.withAILogging(
    {
      userId: authCtx.userId,
      username: authCtx.username,
      domain,
      operationType: intent ? `assistant_${intent.key}` : 'assistant_freeform',
      projectId,
      model: intent ? 'rule_based' : MODEL,
      dataSources: [],
    },
    async () => {
      if (intent) {
        // مسار قياسي: إجابة مباشرة من الأرقام الفعلية بدون استدعاء AI API
        const result = intent.handler({ projectId });
        return { success: true, data: { ...result, matched_intent: intent.key, question } };
      }
      // مسار حر: يتطلب Claude API فعلياً
      const result = await answerFreeformQuestion({ question, projectId, lang });
      return { success: true, data: { ...result, matched_intent: null, question } };
    }
  );
}

/** قائمة الأسئلة المقترحة الجاهزة لعرضها في واجهة المستخدم (زر سريع لكل نمط قياسي) */
function getSuggestedQuestions({ lang = 'ar' } = {}) {
  return {
    success: true,
    data: INTENT_PATTERNS.map((p) => ({
      key: p.key,
      question: lang === 'en' ? p.keywords_en[0] : p.keywords_ar[0],
    })),
  };
}

module.exports = {
  isAIAvailable,
  classifyIntent,
  askEngineeringAssistant,
  getSuggestedQuestions,
  // مُصدَّرة للاختبار المباشر لكل معالج قياسي دون المرور بطبقة AI الكاملة
  _handlers: {
    handleProjectStatus,
    handleCompletionPercent,
    handleBudgetOverrunItem,
    handleDelayedActivities,
    handleStoppedEquipment,
    handleCurrentRisks,
    handleLatestQualityNotes,
    handleDocumentsNeedingApproval,
    handleThisWeekWork,
  },
};
