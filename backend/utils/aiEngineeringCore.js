/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الأول (1/10): طبقة الاتصال الآمنة + سجل عمليات AI + لوحة تحكم AI المركزية
 * ===================================================================================
 *
 * هذا الملف هو "قلب" القسم الخامس عشر. لا يحتوي على شخصية دردشة، بل يوفر:
 *
 *   1) طبقة صلاحيات آمنة موحّدة (AI Permission Layer):
 *        AI → AI Service → Permission Layer → Backend APIs → Database
 *      لا يُمنح أي كود ذكاء اصطناعي وصولاً مباشراً لقاعدة البيانات؛ كل طلب بيانات
 *      يمرّ عبر resolveAIContext() التي تتحقق أولاً من صلاحيات المستخدم (نفس نظام
 *      RBAC الموجود في businessSecurity.js) قبل استدعاء أي دالة من الوحدات الفعلية.
 *
 *   2) سجل موحّد لعمليات الذكاء الاصطناعي (AI Operations Log)، منفصل عن
 *      global_audit_log.json العام، يسجّل لكل عملية AI: المستخدم، السؤال/نوع
 *      التحليل، المشروع، النموذج المستخدم، وقت التنفيذ، زمن الاستجابة، التكلفة
 *      التقديرية (Tokens)، النتيجة (نجاح/فشل)، ومصدر البيانات المستخدَمة.
 *
 *   3) لوحة تحكم AI مركزية (getAIDashboard) تجمع إحصاءات حقيقية 100% من:
 *      - سجل عمليات AI نفسه (إجمالي التحليلات، التقارير، التنبؤات...).
 *      - حالة كل خدمة AI فرعية موجودة فعلياً في النظام (budgetAI, hseAI, qmsAI,
 *        drawingAI, surveyAI, documentAI, reportsAI, equipmentIntelligence...).
 *      - استهلاك API الفعلي (من سجل العمليات، وليس أرقاماً وهمية).
 *
 * لا بيانات وهمية: كل رقم في هذا الملف إمّا محسوب من ai_operations_log.json الفعلي
 * أو مُستنتَج من فحص حقيقي لوجود/توفر كل وحدة AI فرعية على القرص وبيئة التشغيل
 * (ANTHROPIC_API_KEY). إن لم تتوفر بيانات كافية لمؤشر ما، يُعاد 0 أو null صراحة
 * مع توضيح السبب، وليس رقماً ملفقاً.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AI_LOG_FILE = path.join(DATA_DIR, 'ai_operations_log.json');

const SEC = require('./businessSecurity');

// وحدات AI الفرعية الموجودة فعلياً في النظام (يُتحقق من كل واحدة عبر try/require
// حتى لا ينهار هذا الملف إن حُذفت إحداها أو لم تُبنَ بعد أثناء التطوير التدريجي)
function tryRequire(rel) {
  try { return require(rel); } catch (e) { return null; }
}

const SUB_AI_MODULES = {
  budget: { file: './budgetAI', mod: tryRequire('./budgetAI'), label_ar: 'الذكاء المالي (الميزانية)', section: 13 },
  hse: { file: './hseAI', mod: tryRequire('./hseAI'), label_ar: 'ذكاء السلامة المهنية', section: 8 },
  qms: { file: './qmsAI', mod: tryRequire('./qmsAI'), label_ar: 'ذكاء الجودة', section: 9 },
  drawing: { file: './drawingAI', mod: tryRequire('./drawingAI'), label_ar: 'تحليل المخططات', section: 12 },
  survey: { file: './surveyAI', mod: tryRequire('./surveyAI'), label_ar: 'ذكاء المساحة', section: 10 },
  document: { file: './documentAI', mod: tryRequire('./documentAI'), label_ar: 'تحليل المستندات', section: 11 },
  reports: { file: './reportsAI', mod: tryRequire('./reportsAI'), label_ar: 'مولّد التقارير الذكي', section: 14 },
  equipment: { file: './equipmentIntelligence', mod: tryRequire('./equipmentIntelligence'), label_ar: 'ذكاء المعدات', section: 7 },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowISO() { return new Date().toISOString(); }

function defaultLogDB() { return { operations: [] }; }

// ===================================================================================
// 1) طبقة الصلاحيات الآمنة (AI Permission Layer)
// ===================================================================================

/**
 * الخريطة الرسمية بين "نوع تحليل AI" ووحدة الصلاحيات (module) في businessSecurity.
 * أي دالة AI جديدة في أي جزء لاحق من هذا القسم يجب أن تمر عبر هذه الخريطة، ولا
 * يجوز استدعاء أي دالة بيانات مباشرة دون التحقق أولاً.
 */
const AI_DOMAIN_PERMISSIONS = {
  project: 'dashboard',
  schedule: 'tasks',
  budget: 'budget',
  boq: 'reports',
  rebar: 'reports',
  drawing: 'documents',
  document: 'documents',
  contract: 'contracts',
  quality: 'quality',
  safety: 'safety',
  equipment: 'equipment',
  business: 'reports',
  reporting: 'reports',
  search: 'dashboard',
  knowledge: 'documents',
};

class AIPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIPermissionError';
    this.statusCode = 403;
  }
}

/**
 * نقطة الدخول الوحيدة المسموح بها لأي كود AI للوصول إلى بيانات النظام.
 * AI → AI Service → resolveAIContext (هذه الدالة) → Backend APIs → Database
 *
 * - يتحقق من وجود جلسة صالحة (token) عبر SEC.getSessionUser.
 * - يتحقق من صلاحية الدور للنطاق (domain) المطلوب عبر SEC.can/roleCan.
 * - لا يُعيد أبداً وصولاً "غير مقيّد"؛ فقط يقرّ بأن المستخدم مخوَّل لطلب هذا النطاق،
 *   وعلى الكود المستدعي بعدها استخدام دوال البيانات الحقيقية (مثل PM.getProject)
 *   والتي تُطبَّق عليها فلترة الصلاحيات الخاصة بها أصلاً.
 */
function resolveAIContext(token, domain) {
  if (!token) throw new AIPermissionError('يجب تسجيل الدخول لاستخدام مساعد الذكاء الاصطناعي');
  const session = SEC.getSessionUser(token);
  if (!session) throw new AIPermissionError('الجلسة غير صالحة أو منتهية؛ يرجى تسجيل الدخول مجدداً');

  const requiredModule = AI_DOMAIN_PERMISSIONS[domain];
  if (!requiredModule) throw new AIPermissionError(`نطاق تحليل غير معروف: ${domain}`);

  // صلاحية استخدام الذكاء الاصطناعي عموماً (وحدة "ai") + صلاحية الاطّلاع على النطاق نفسه
  const canUseAI = SEC.roleCan(session.role, 'ai', 'use') || SEC.roleCan(session.role, '*', '*');
  const canViewDomain = SEC.roleCan(session.role, requiredModule, 'view') || SEC.roleCan(session.role, '*', '*');

  if (!canUseAI) {
    throw new AIPermissionError('دورك الوظيفي لا يملك صلاحية استخدام مساعد الذكاء الاصطناعي (ai:use)');
  }
  if (!canViewDomain) {
    throw new AIPermissionError(`دورك الوظيفي لا يملك صلاحية الاطّلاع على بيانات "${requiredModule}" اللازمة لهذا التحليل`);
  }

  return {
    userId: session.userId,
    username: session.username,
    role: session.role,
    domain,
    permittedModule: requiredModule,
  };
}

/** فحص بدون رمي استثناء - يُستخدم في الواجهات لإظهار/إخفاء أزرار AI فقط */
function canUseAIDomain(token, domain) {
  try { resolveAIContext(token, domain); return true; } catch (e) { return false; }
}

// ===================================================================================
// 2) سجل عمليات الذكاء الاصطناعي (AI Operations Log)
// ===================================================================================

/**
 * يسجّل عملية AI واحدة. يجب استدعاؤها من كل دالة AI حقيقية في هذا القسم (وباقي
 * الأقسام إن رغبت لاحقاً بالتوحيد) بعد انتهاء التنفيذ (نجاحاً أو فشلاً).
 */
function recordAIOperation({
  userId = null,
  username = null,
  domain,
  operationType,
  projectId = null,
  model = null,
  startedAt,
  finishedAt = nowISO(),
  success = true,
  errorMessage = null,
  estimatedTokens = null,
  dataSources = [],
  resultSummary = null,
}) {
  const db = readJSON(AI_LOG_FILE, defaultLogDB());
  const durationMs = startedAt ? (new Date(finishedAt) - new Date(startedAt)) : null;

  const entry = {
    id: `aiop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    username,
    domain,
    operation_type: operationType,
    project_id: projectId,
    model,
    started_at: startedAt || finishedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    success,
    error_message: errorMessage,
    estimated_tokens: estimatedTokens,
    data_sources: dataSources,
    result_summary: resultSummary,
  };

  db.operations.push(entry);
  // الاحتفاظ بآخر 20,000 عملية كحد أقصى لمنع تضخم الملف بلا حدود
  if (db.operations.length > 20000) {
    db.operations = db.operations.slice(db.operations.length - 20000);
  }
  writeJSON(AI_LOG_FILE, db);
  return entry;
}

/** غلاف مساعد: ينفّذ دالة AI فعلية، ويقيس زمن التنفيذ، ويسجّل النتيجة تلقائياً */
async function withAILogging({ userId, username, domain, operationType, projectId = null, model = null, dataSources = [] }, fn) {
  const startedAt = nowISO();
  try {
    const result = await fn();
    recordAIOperation({
      userId, username, domain, operationType, projectId, model,
      startedAt, finishedAt: nowISO(), success: true, dataSources,
      resultSummary: summarizeResult(result),
    });
    return result;
  } catch (e) {
    recordAIOperation({
      userId, username, domain, operationType, projectId, model,
      startedAt, finishedAt: nowISO(), success: false, dataSources,
      errorMessage: e.message,
    });
    throw e;
  }
}

function summarizeResult(result) {
  try {
    const str = JSON.stringify(result);
    return str.length > 300 ? str.slice(0, 300) + '…' : str;
  } catch (e) {
    return null;
  }
}

function listAIOperations({ domain = null, userId = null, projectId = null, success = null, from = null, to = null, page = 1, pageSize = 100 } = {}) {
  const db = readJSON(AI_LOG_FILE, defaultLogDB());
  let items = db.operations.slice().reverse(); // الأحدث أولاً

  if (domain) items = items.filter(o => o.domain === domain);
  if (userId) items = items.filter(o => o.user_id === userId);
  if (projectId) items = items.filter(o => o.project_id === projectId);
  if (success !== null && success !== undefined) items = items.filter(o => o.success === Boolean(success));
  if (from) items = items.filter(o => new Date(o.finished_at) >= new Date(from));
  if (to) items = items.filter(o => new Date(o.finished_at) <= new Date(to));

  const total = items.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { success: true, data: { items: pageItems, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

// ===================================================================================
// 3) لوحة تحكم الذكاء الاصطناعي المركزية (AI Dashboard)
// ===================================================================================

function isAnthropicKeyConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** يفحص كل وحدة AI فرعية معروفة ويُعيد حالتها الفعلية (متوفرة كملف؟ مفعّلة المفتاح؟) */
function getSubServicesStatus() {
  return Object.entries(SUB_AI_MODULES).map(([key, info]) => {
    const moduleLoaded = Boolean(info.mod);
    let apiAvailable = null;
    if (moduleLoaded && typeof info.mod.isAIAvailable === 'function') {
      apiAvailable = info.mod.isAIAvailable();
    } else if (moduleLoaded) {
      apiAvailable = isAnthropicKeyConfigured();
    }
    return {
      key,
      label_ar: info.label_ar,
      related_section: info.section,
      module_file: info.file,
      module_loaded: moduleLoaded,
      api_available: apiAvailable,
      status: !moduleLoaded ? 'not_installed' : (apiAvailable ? 'operational' : 'installed_no_api_key'),
    };
  });
}

function countBy(items, keyFn) {
  const map = {};
  for (const it of items) {
    const k = keyFn(it);
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

/**
 * لوحة تحكم AI الكاملة. كل رقم هنا مُشتقّ فعلياً من ai_operations_log.json ومن فحص
 * حي لوحدات AI الفرعية - لا يوجد أي رقم ثابت أو تقديري بدون مصدر.
 */
function getAIDashboard({ fromDate = null, toDate = null } = {}) {
  const db = readJSON(AI_LOG_FILE, defaultLogDB());
  let ops = db.operations;

  if (fromDate) ops = ops.filter(o => new Date(o.finished_at) >= new Date(fromDate));
  if (toDate) ops = ops.filter(o => new Date(o.finished_at) <= new Date(toDate));

  const successfulOps = ops.filter(o => o.success);
  const failedOps = ops.filter(o => !o.success);

  const byDomain = countBy(ops, (o) => o.domain || 'unknown');
  const byOperationType = countBy(ops, (o) => o.operation_type || 'unknown');

  const distinctProjects = new Set(ops.filter(o => o.project_id).map(o => o.project_id));

  // تصنيف عمليات محدَّدة حسب أنواعها المتعارف عليها ضمن هذا القسم (تُحدَّث لاحقاً
  // مع بناء بقية الأجزاء 2-10؛ الاحتساب هنا حقيقي بناءً على operation_type الفعلي
  // الذي سُجِّل، وليس تخميناً)
  const risksDetected = ops.filter(o => /risk/i.test(o.operation_type || '')).length;
  const alertsGenerated = ops.filter(o => /alert/i.test(o.operation_type || '')).length;
  const recommendationsGiven = ops.filter(o => /recommend|suggest/i.test(o.operation_type || '')).length;
  const reportsGenerated = ops.filter(o => /report/i.test(o.operation_type || '')).length;
  const documentsAnalyzed = ops.filter(o => o.domain === 'document').length;
  const drawingsAnalyzed = ops.filter(o => o.domain === 'drawing').length;
  const forecastsGiven = ops.filter(o => /forecast|predict/i.test(o.operation_type || '')).length;

  const totalTokens = ops.reduce((sum, o) => sum + (Number(o.estimated_tokens) || 0), 0);
  const responseTimes = ops.filter(o => typeof o.duration_ms === 'number').map(o => o.duration_ms);
  const avgResponseMs = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

  const recentOps = ops.slice().reverse().slice(0, 20).map(o => ({
    id: o.id, username: o.username, domain: o.domain, operation_type: o.operation_type,
    project_id: o.project_id, success: o.success, finished_at: o.finished_at, duration_ms: o.duration_ms,
  }));

  return {
    success: true,
    data: {
      generated_at: nowISO(),
      period: { from: fromDate || null, to: toDate || null },

      summary: {
        total_analyses: ops.length,
        successful_analyses: successfulOps.length,
        failed_analyses: failedOps.length,
        projects_analyzed: distinctProjects.size,
        risks_detected: risksDetected,
        smart_alerts: alertsGenerated,
        recommendations_given: recommendationsGiven,
        ai_generated_reports: reportsGenerated,
        documents_analyzed: documentsAnalyzed,
        drawings_analyzed: drawingsAnalyzed,
        forecasts_given: forecastsGiven,
      },

      api_usage: {
        anthropic_api_key_configured: isAnthropicKeyConfigured(),
        total_requests: ops.length,
        estimated_total_tokens: totalTokens || null,
        avg_response_time_ms: avgResponseMs,
        note: totalTokens === 0
          ? 'لم تُسجَّل بعد تكلفة Tokens فعلية لأي عملية؛ ستظهر هذه القيمة تلقائياً عند تفعيل تسجيل استهلاك Tokens من استجابات Claude API الفعلية.'
          : undefined,
      },

      breakdown_by_domain: byDomain,
      breakdown_by_operation_type: byOperationType,

      sub_services_status: getSubServicesStatus(),

      recent_operations: recentOps,
    },
  };
}

/** يُعيد حالة تفصيلية لخدمة AI فرعية واحدة بالاسم (لاستخدام صفحة "حالة الخدمات") */
function getSubServiceDetail(key) {
  const info = SUB_AI_MODULES[key];
  if (!info) throw new Error(`خدمة AI غير معروفة: ${key}`);
  const status = getSubServicesStatus().find(s => s.key === key);
  const opsForDomain = readJSON(AI_LOG_FILE, defaultLogDB()).operations.filter(o => o.domain === key);
  return {
    success: true,
    data: {
      ...status,
      total_operations: opsForDomain.length,
      successful_operations: opsForDomain.filter(o => o.success).length,
      failed_operations: opsForDomain.filter(o => !o.success).length,
      last_operation_at: opsForDomain.length ? opsForDomain[opsForDomain.length - 1].finished_at : null,
    },
  };
}

module.exports = {
  // طبقة الصلاحيات الآمنة
  AI_DOMAIN_PERMISSIONS,
  AIPermissionError,
  resolveAIContext,
  canUseAIDomain,

  // سجل العمليات
  recordAIOperation,
  withAILogging,
  listAIOperations,

  // لوحة التحكم
  isAnthropicKeyConfigured,
  getSubServicesStatus,
  getAIDashboard,
  getSubServiceDetail,

  // مرجع الوحدات الفرعية (لاستخدامه من الأجزاء اللاحقة 2-10 من القسم الخامس عشر)
  SUB_AI_MODULES,
};
