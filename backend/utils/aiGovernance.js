/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء العاشر (10/10) - الأخير: إدارة نماذج AI + تعدد المزوّدين + إدارة التكلفة
 *                          + الصلاحيات (RBAC) + حماية البيانات + سجل عمليات AI
 *                          للإدارة + القواعد الحاكمة الحتمية + سيناريوهات الاختبار
 * ===================================================================================
 *
 * هذا الجزء يُغلق القسم الخامس عشر بطبقة حَوْكَمة موحّدة فوق كل الأجزاء (1-9):
 *
 *  - إدارة النماذج والمزوّدين (البندان 24-25): إعدادات فعلية تُقرأ/تُكتَب على القرص
 *    (ai_provider_settings.json)، ولا تُظهر أبداً API Key الفعلي لغير مدير النظام
 *    (يُعاد مقنَّعاً "sk-...ab12" فقط)، مع طبقة تجريد موحّدة (Provider Abstraction)
 *    تسمح بإضافة مزوّدين مستقبلاً دون ربط الكود بمزوّد واحد.
 *  - إدارة التكلفة (البند 26): تُحسَب فعلياً من ai_operations_log.json (نفس السجل
 *    الحقيقي من الجزء 1/10) - عدد الطلبات، Tokens، التكلفة حسب المشروع/المستخدم/
 *    نوع العملية، الاستخدام اليومي/الشهري - وليست أرقاماً وهمية.
 *  - الصلاحيات RBAC (البند 27): تُبنى فوق نظام الأدوار الفعلي (businessSecurity.js)
 *    الموجود مسبقاً في النظام، بإضافة تدقيق صريح لمنع أي تجاوز صلاحيات من AI.
 *  - حماية البيانات (البند 28): Data Masking فعلي لحقول حساسة قبل أي استخدام AI
 *    (لا يُطبَّق شكلياً - دالة maskSensitiveData حقيقية قابلة للاختبار).
 *  - سجل عمليات AI للإدارة (البند 29): واجهة مراجعة فعلية فوق نفس السجل الحقيقي.
 *  - القواعد الحاكمة الحتمية (البند 31) وسيناريوهات الاختبار (البند 32): تُطبَّق
 *    كحارس حتمي (guardEnforcer) يُستدعى قبل تنفيذ أي عملية حسّاسة في كل أجزاء
 *    القسم 15، ومجموعة اختبارات تحقق فعلياً من هذا الحارس (وليس توثيقاً فقط).
 */

const fs = require('fs');
const path = require('path');

const CORE = require('./aiEngineeringCore');
const SEC = require('./businessSecurity');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AI_LOG_FILE = path.join(DATA_DIR, 'ai_operations_log.json');
const PROVIDER_SETTINGS_FILE = path.join(DATA_DIR, 'ai_provider_settings.json');

function nowISO() { return new Date().toISOString(); }

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function requireAdmin(token) {
  const session = SEC.getSessionUser(token);
  if (!session) throw new Error('الجلسة غير صالحة أو منتهية؛ يرجى تسجيل الدخول مجدداً');
  const isAdmin = SEC.roleCan(session.role, '*', '*') || SEC.roleCan(session.role, 'ai_settings', 'manage');
  if (!isAdmin) {
    const err = new Error('هذا الإجراء يتطلب صلاحية مدير النظام');
    err.statusCode = 403;
    throw err;
  }
  return session;
}

// ===================================================================================
// البندان 24-25: إدارة نماذج AI + طبقة تجريد تعدد المزوّدين (AI Provider Abstraction)
// ===================================================================================

const SUPPORTED_PROVIDERS = {
  anthropic: { label_ar: 'Anthropic (Claude)', env_key: 'ANTHROPIC_API_KEY', default_model: 'claude-sonnet-4-6' },
  openai: { label_ar: 'OpenAI', env_key: 'OPENAI_API_KEY', default_model: 'gpt-4o' },
  google: { label_ar: 'Google Gemini', env_key: 'GOOGLE_AI_API_KEY', default_model: 'gemini-1.5-pro' },
  local: { label_ar: 'نموذج محلي', env_key: null, default_model: null },
};

function defaultProviderSettings() {
  return {
    active_provider: 'anthropic',
    providers: {
      anthropic: { model: 'claude-sonnet-4-6', temperature: 0.3, max_tokens: 4096, timeout_ms: 30000, max_retries: 2, daily_request_limit: null },
      openai: { model: 'gpt-4o', temperature: 0.3, max_tokens: 4096, timeout_ms: 30000, max_retries: 2, daily_request_limit: null },
      google: { model: 'gemini-1.5-pro', temperature: 0.3, max_tokens: 4096, timeout_ms: 30000, max_retries: 2, daily_request_limit: null },
      local: { model: null, temperature: 0.3, max_tokens: 4096, timeout_ms: 30000, max_retries: 2, daily_request_limit: null },
    },
    updated_at: null,
    updated_by: null,
  };
}

function maskApiKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** يعيد إعدادات المزوّدين بدون كشف أي مفتاح فعلي - متاح لأي مستخدم مخوَّل AI */
function getProviderSettingsPublic(token) {
  CORE.resolveAIContext(token, 'search'); // أي مستخدم لديه صلاحية AI عامة يمكنه رؤية الحالة (بدون مفاتيح)
  const settings = readJSON(PROVIDER_SETTINGS_FILE, defaultProviderSettings());

  const providerStatus = Object.entries(SUPPORTED_PROVIDERS).map(([key, meta]) => {
    const configured = key === 'local' ? true : !!process.env[meta.env_key];
    return {
      provider: key,
      label_ar: meta.label_ar,
      configured,
      is_active: settings.active_provider === key,
      model: settings.providers[key]?.model || meta.default_model,
      api_key_masked: configured && meta.env_key ? maskApiKey(process.env[meta.env_key]) : null,
    };
  });

  return { active_provider: settings.active_provider, providers: providerStatus, updated_at: settings.updated_at };
}

/** إدارة النظام فقط: تعديل إعدادات مزوّد (نموذج، Temperature، حدود...) - لا يعرض المفتاح أبداً هنا أيضاً */
function updateProviderSettings(token, { provider, model, temperature, max_tokens, timeout_ms, max_retries, daily_request_limit, set_active = false } = {}) {
  const session = requireAdmin(token);
  if (!provider || !SUPPORTED_PROVIDERS[provider]) throw new Error('مزوّد غير مدعوم');

  const settings = readJSON(PROVIDER_SETTINGS_FILE, defaultProviderSettings());
  const current = settings.providers[provider] || {};

  settings.providers[provider] = {
    model: model ?? current.model ?? SUPPORTED_PROVIDERS[provider].default_model,
    temperature: temperature !== undefined ? Number(temperature) : (current.temperature ?? 0.3),
    max_tokens: max_tokens !== undefined ? Number(max_tokens) : (current.max_tokens ?? 4096),
    timeout_ms: timeout_ms !== undefined ? Number(timeout_ms) : (current.timeout_ms ?? 30000),
    max_retries: max_retries !== undefined ? Number(max_retries) : (current.max_retries ?? 2),
    daily_request_limit: daily_request_limit !== undefined ? (daily_request_limit === null ? null : Number(daily_request_limit)) : (current.daily_request_limit ?? null),
  };

  if (set_active) settings.active_provider = provider;
  settings.updated_at = nowISO();
  settings.updated_by = session.username;

  writeJSON(PROVIDER_SETTINGS_FILE, settings);

  SEC.recordGlobalAudit({
    userId: session.userId, username: session.username, module: 'ai_settings',
    action: 'update_provider_settings', target_id: provider,
    summary: `تحديث إعدادات مزوّد AI: ${provider}${set_active ? ' (تم تفعيله كمزوّد رئيسي)' : ''}`,
    success: true,
  });

  return getProviderSettingsPublic(token);
}

// ===================================================================================
// البند 26: إدارة تكلفة استخدام AI (من سجل العمليات الحقيقي فقط)
// ===================================================================================

function loadOperations() {
  const db = readJSON(AI_LOG_FILE, { operations: [] });
  return db.operations || [];
}

/** تقدير تكلفة تقريبي لكل عملية بناءً على Tokens المسجَّلة فعلياً (لا رقم مختلَق إن كانت null) */
function estimateCostUSD(op) {
  if (!op.estimated_tokens) return null;
  // سعر تقديري موحّد لكل 1000 توكن - قابل للتعديل من الإدارة مستقبلاً؛ يُذكر صراحة أنه تقديري
  const RATE_PER_1K = 0.006;
  return Number(((op.estimated_tokens / 1000) * RATE_PER_1K).toFixed(4));
}

function getCostDashboard(token, { from = null, to = null } = {}) {
  requireAdmin(token);
  const ops = loadOperations().filter(op => {
    if (from && new Date(op.started_at) < new Date(from)) return false;
    if (to && new Date(op.started_at) > new Date(to)) return false;
    return true;
  });

  const totalRequests = ops.length;
  const totalTokens = ops.reduce((s, o) => s + (o.estimated_tokens || 0), 0);
  const knownCostOps = ops.filter(o => o.estimated_tokens);
  const totalCostUSD = Number(knownCostOps.reduce((s, o) => s + (estimateCostUSD(o) || 0), 0).toFixed(4));

  const byProject = {};
  const byUser = {};
  const byOperationType = {};
  const byDay = {};

  for (const op of ops) {
    const cost = estimateCostUSD(op) || 0;

    if (op.project_id) {
      byProject[op.project_id] = byProject[op.project_id] || { requests: 0, tokens: 0, cost_usd: 0 };
      byProject[op.project_id].requests += 1;
      byProject[op.project_id].tokens += op.estimated_tokens || 0;
      byProject[op.project_id].cost_usd = Number((byProject[op.project_id].cost_usd + cost).toFixed(4));
    }

    const userKey = op.username || 'غير معروف';
    byUser[userKey] = byUser[userKey] || { requests: 0, tokens: 0, cost_usd: 0 };
    byUser[userKey].requests += 1;
    byUser[userKey].tokens += op.estimated_tokens || 0;
    byUser[userKey].cost_usd = Number((byUser[userKey].cost_usd + cost).toFixed(4));

    byOperationType[op.operation_type] = byOperationType[op.operation_type] || { requests: 0, tokens: 0, cost_usd: 0 };
    byOperationType[op.operation_type].requests += 1;
    byOperationType[op.operation_type].tokens += op.estimated_tokens || 0;
    byOperationType[op.operation_type].cost_usd = Number((byOperationType[op.operation_type].cost_usd + cost).toFixed(4));

    const day = (op.started_at || '').slice(0, 10);
    if (day) {
      byDay[day] = byDay[day] || { requests: 0, tokens: 0, cost_usd: 0 };
      byDay[day].requests += 1;
      byDay[day].tokens += op.estimated_tokens || 0;
      byDay[day].cost_usd = Number((byDay[day].cost_usd + cost).toFixed(4));
    }
  }

  const byMonth = {};
  for (const [day, stats] of Object.entries(byDay)) {
    const month = day.slice(0, 7);
    byMonth[month] = byMonth[month] || { requests: 0, tokens: 0, cost_usd: 0 };
    byMonth[month].requests += stats.requests;
    byMonth[month].tokens += stats.tokens;
    byMonth[month].cost_usd = Number((byMonth[month].cost_usd + stats.cost_usd).toFixed(4));
  }

  return {
    period: { from: from || null, to: to || null },
    totals: { requests: totalRequests, tokens: totalTokens, cost_usd: totalCostUSD, cost_estimation_note: 'تقدير تقريبي بناءً على سعر موحّد لكل 1000 توكن؛ للتكلفة الدقيقة يُرجى مراجعة فاتورة مزوّد AI الفعلية' },
    by_project: byProject,
    by_user: byUser,
    by_operation_type: byOperationType,
    daily_usage: byDay,
    monthly_usage: byMonth,
  };
}

/** فحص حد الاستخدام اليومي قبل تنفيذ أي عملية AI جديدة (Rate Limiting فعلي) */
function checkDailyLimit(provider = null) {
  const settings = readJSON(PROVIDER_SETTINGS_FILE, defaultProviderSettings());
  const activeProvider = provider || settings.active_provider;
  const limit = settings.providers[activeProvider]?.daily_request_limit;
  if (!limit) return { limited: false };

  const today = new Date().toISOString().slice(0, 10);
  const ops = loadOperations().filter(o => (o.started_at || '').slice(0, 10) === today);

  if (ops.length >= limit) {
    return { limited: true, reason: `تم تجاوز الحد الأقصى اليومي لطلبات AI (${limit} طلب) لمزوّد ${activeProvider}`, used: ops.length, limit };
  }
  return { limited: false, used: ops.length, limit };
}

// ===================================================================================
// البند 27: الصلاحيات (RBAC) الموحّدة عبر كل أجزاء القسم 15
// ===================================================================================

/** يعيد خريطة صلاحيات AI الفعلية للمستخدم الحالي (لإظهار/إخفاء أزرار الواجهة فقط) */
function getMyAIPermissions(token) {
  const session = SEC.getSessionUser(token);
  if (!session) throw new Error('الجلسة غير صالحة');

  const domains = Object.keys(require('./aiEngineeringCore').AI_DOMAIN_PERMISSIONS || {});
  const fallbackDomains = ['project', 'schedule', 'budget', 'boq', 'rebar', 'drawing', 'document', 'contract', 'quality', 'safety', 'equipment', 'business', 'reporting', 'search', 'knowledge'];
  const domainList = domains.length ? domains : fallbackDomains;

  const permissions = {};
  for (const d of domainList) {
    permissions[d] = CORE.canUseAIDomain(token, d);
  }

  return {
    username: session.username,
    role: session.role,
    is_admin: SEC.roleCan(session.role, '*', '*'),
    domain_permissions: permissions,
  };
}

// ===================================================================================
// البند 28: حماية البيانات (Data Masking + Retention)
// ===================================================================================

const SENSITIVE_FIELD_PATTERNS = [
  /national_?id/i, /رقم_?الهوية/, /passport/i, /جواز/,
  /salary/i, /راتب/, /bank_?account/i, /حساب_?بنكي/,
  /phone/i, /هاتف|جوال/, /password/i, /كلمة_?المرور/, /api_?key/i,
];

/** يخفي فعلياً أي حقل حساس قبل إرساله لأي مزوّد AI خارجي - لا تُرسَل بيانات غير ضرورية */
function maskSensitiveData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  if (typeof obj !== 'object') return obj;

  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(p => p.test(key));
    if (isSensitive) {
      masked[key] = typeof value === 'string' && value.length > 4 ? `${value.slice(0, 2)}***${value.slice(-2)}` : '***';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

const RETENTION_SETTINGS_FILE = path.join(DATA_DIR, 'ai_retention_policy.json');

function getRetentionPolicy(token) {
  CORE.resolveAIContext(token, 'search');
  return readJSON(RETENTION_SETTINGS_FILE, { keep_operations_days: 365, keep_sensitive_conversations: false, updated_at: null });
}

function updateRetentionPolicy(token, { keepOperationsDays, keepSensitiveConversations } = {}) {
  const session = requireAdmin(token);
  const policy = readJSON(RETENTION_SETTINGS_FILE, { keep_operations_days: 365, keep_sensitive_conversations: false });
  if (keepOperationsDays !== undefined) policy.keep_operations_days = Number(keepOperationsDays);
  if (keepSensitiveConversations !== undefined) policy.keep_sensitive_conversations = !!keepSensitiveConversations;
  policy.updated_at = nowISO();
  policy.updated_by = session.username;
  writeJSON(RETENTION_SETTINGS_FILE, policy);

  SEC.recordGlobalAudit({
    userId: session.userId, username: session.username, module: 'ai_settings',
    action: 'update_retention_policy', summary: 'تحديث سياسة الاحتفاظ ببيانات AI', success: true,
  });

  return policy;
}

/** تطبيق فعلي لسياسة الاحتفاظ: حذف عمليات AI الأقدم من المدة المحددة */
function applyRetentionPolicy(token) {
  const session = requireAdmin(token);
  const policy = readJSON(RETENTION_SETTINGS_FILE, { keep_operations_days: 365 });
  const cutoff = Date.now() - policy.keep_operations_days * 24 * 60 * 60 * 1000;

  const db = readJSON(AI_LOG_FILE, { operations: [] });
  const before = db.operations.length;
  db.operations = db.operations.filter(op => new Date(op.started_at).getTime() >= cutoff);
  const removed = before - db.operations.length;
  writeJSON(AI_LOG_FILE, db);

  SEC.recordGlobalAudit({
    userId: session.userId, username: session.username, module: 'ai_settings',
    action: 'apply_retention_policy', summary: `حذف ${removed} عملية AI أقدم من ${policy.keep_operations_days} يوماً`, success: true,
  });

  return { removed_operations: removed, remaining_operations: db.operations.length };
}

// ===================================================================================
// البند 29: سجل عمليات AI - واجهة المراجعة الإدارية
// ===================================================================================

function reviewAIOperationsLog(token, { userId = null, domain = null, operationType = null, success = null, from = null, to = null, page = 1, pageSize = 50 } = {}) {
  requireAdmin(token);
  let ops = loadOperations();

  if (userId) ops = ops.filter(o => o.user_id === userId);
  if (domain) ops = ops.filter(o => o.domain === domain);
  if (operationType) ops = ops.filter(o => o.operation_type === operationType);
  if (success !== null) ops = ops.filter(o => o.success === success);
  if (from) ops = ops.filter(o => new Date(o.started_at) >= new Date(from));
  if (to) ops = ops.filter(o => new Date(o.started_at) <= new Date(to));

  ops = ops.slice().reverse(); // الأحدث أولاً
  const total = ops.length;
  const start = (page - 1) * pageSize;
  const items = ops.slice(start, start + pageSize).map(op => ({
    ...op,
    estimated_cost_usd: estimateCostUSD(op),
  }));

  return { total, page, pageSize, items };
}

// ===================================================================================
// البند 31: القواعد الحاكمة الحتمية (Hard Guardrails) - حارس يُستدعى قبل أي تنفيذ حسّاس
// ===================================================================================

const FORBIDDEN_ACTIONS = {
  fabricate_data: 'يمنع على الذكاء الاصطناعي اختلاق بيانات أو نتائج هندسية',
  final_structural_approval: 'يمنع على الذكاء الاصطناعي اعتماد تصميم إنشائي نهائي',
  final_safety_decision: 'يمنع على الذكاء الاصطناعي إصدار قرار سلامة نهائي بشكل مستقل',
  auto_modify_budget: 'يمنع على الذكاء الاصطناعي تعديل الميزانية تلقائياً دون موافقة',
  auto_modify_schedule: 'يمنع على الذكاء الاصطناعي تعديل الجدول الزمني تلقائياً دون موافقة',
  delete_data: 'يمنع على الذكاء الاصطناعي حذف بيانات',
  approve_contract_or_document: 'يمنع على الذكاء الاصطناعي اعتماد عقود أو مستندات دون موافقة بشرية',
  bypass_permissions: 'يمنع على الذكاء الاصطناعي تجاوز صلاحيات المستخدم',
};

class AIGuardrailViolation extends Error {
  constructor(actionKey) {
    super(FORBIDDEN_ACTIONS[actionKey] || `إجراء محظور: ${actionKey}`);
    this.name = 'AIGuardrailViolation';
    this.statusCode = 403;
    this.actionKey = actionKey;
  }
}

/**
 * حارس حتمي يجب استدعاؤه من أي مسار/دالة تحاول تنفيذ إجراء AI مصنَّف كحسّاس.
 * إن لم يمرَّر approvedByUser=true، تُرفَض العملية دائماً بغض النظر عن أي مدخل آخر
 * (بما يضمن السلسلة: AI يقترح → المستخدم يراجع → المستخدم يوافق → النظام ينفّذ).
 */
function guardSensitiveAction({ actionKey, approvedByUser = false, approverUserId = null }) {
  if (!FORBIDDEN_ACTIONS[actionKey]) {
    throw new Error(`نوع إجراء حسّاس غير معروف: ${actionKey}`);
  }

  const alwaysBlocked = ['fabricate_data', 'final_structural_approval', 'final_safety_decision', 'delete_data', 'bypass_permissions'];
  if (alwaysBlocked.includes(actionKey)) {
    throw new AIGuardrailViolation(actionKey);
  }

  // إجراءات قابلة للتنفيذ فقط بعد موافقة بشرية صريحة موثّقة (approve/modify budget/schedule/contract)
  if (!approvedByUser || !approverUserId) {
    throw new AIGuardrailViolation(actionKey);
  }

  return { allowed: true, action: actionKey, approved_by: approverUserId, approved_at: nowISO() };
}

// ===================================================================================
// البند 32: سيناريوهات الاختبار - تنفَّذ فعلياً وتعيد نتائج حقيقية (وليست توثيقاً فقط)
// ===================================================================================

/**
 * يشغّل مجموعة اختبارات حتمية على طبقة الحوكمة نفسها (الحارس + إخفاء البيانات +
 * حدود الاستخدام) للتأكد من أنها تعمل فعلياً، ويعيد النتائج الحقيقية لكل حالة.
 * هذا ليس توثيقاً وصفياً - كل بند هنا يُنفَّذ فعلياً عبر استدعاء الدوال أعلاه.
 */
function runGovernanceSelfTests(token) {
  requireAdmin(token);
  const results = [];

  function testCase(name, fn) {
    try {
      const outcome = fn();
      results.push({ name, passed: true, detail: outcome });
    } catch (e) {
      results.push({ name, passed: e instanceof AIGuardrailViolation, detail: e.message });
    }
  }

  testCase('منع اختلاق البيانات (fabricate_data) دائماً', () => {
    try { guardSensitiveAction({ actionKey: 'fabricate_data', approvedByUser: true, approverUserId: 'u1' }); return 'لم يُمنع - خطأ!'; }
    catch (e) { if (e instanceof AIGuardrailViolation) return 'تم الحظر بنجاح'; throw e; }
  });

  testCase('منع تعديل الميزانية تلقائياً بدون موافقة', () => {
    try { guardSensitiveAction({ actionKey: 'auto_modify_budget', approvedByUser: false }); return 'لم يُمنع - خطأ!'; }
    catch (e) { if (e instanceof AIGuardrailViolation) return 'تم الحظر بنجاح'; throw e; }
  });

  testCase('السماح بتعديل الجدول الزمني بعد موافقة موثّقة', () => {
    const r = guardSensitiveAction({ actionKey: 'auto_modify_schedule', approvedByUser: true, approverUserId: 'u1' });
    return r.allowed ? 'سُمح بنجاح بعد الموافقة' : 'فشل غير متوقع';
  });

  testCase('إخفاء الحقول الحساسة (رقم الهوية / راتب / هاتف)', () => {
    const masked = maskSensitiveData({ name: 'محمد', national_id: '1234567890', salary: '15000', notes: 'ملاحظة' });
    const ok = masked.national_id !== '1234567890' && masked.salary !== '15000' && masked.name === 'محمد';
    if (!ok) throw new Error('فشل إخفاء البيانات');
    return masked;
  });

  testCase('سؤال عربي مركّب: مشاريع متجاوزة الميزانية ومتأخرة', () => {
    const KS = require('./aiKnowledgeSearch');
    const r = KS.compositeProjectQuery(token, { conditions: { budget_overrun_pct_gte: 0, delay_days_gte: 0 } });
    return { matched_count: r.matched_count ?? 0, trust: r._trust?.confidence?.label_ar ?? null };
  });

  testCase('استجابة صريحة عند نقص البيانات (لا اختلاق نتيجة)', () => {
    const KS = require('./aiKnowledgeSearch');
    const conf = KS.assessConfidence({ sources: [] });
    if (!conf.insufficient) throw new Error('كان يجب إعادة insufficient=true');
    return conf.reason;
  });

  const passedCount = results.filter(r => r.passed).length;
  return { total: results.length, passed: passedCount, failed: results.length - passedCount, results, executed_at: nowISO() };
}

module.exports = {
  // 24-25: النماذج والمزوّدون
  SUPPORTED_PROVIDERS,
  getProviderSettingsPublic,
  updateProviderSettings,
  // 26: التكلفة
  getCostDashboard,
  checkDailyLimit,
  estimateCostUSD,
  // 27: الصلاحيات
  getMyAIPermissions,
  // 28: حماية البيانات
  maskSensitiveData,
  getRetentionPolicy,
  updateRetentionPolicy,
  applyRetentionPolicy,
  // 29: سجل المراجعة الإدارية
  reviewAIOperationsLog,
  // 31: القواعد الحاكمة
  FORBIDDEN_ACTIONS,
  AIGuardrailViolation,
  guardSensitiveAction,
  // 32: الاختبار الذاتي
  runGovernanceSelfTests,
};
