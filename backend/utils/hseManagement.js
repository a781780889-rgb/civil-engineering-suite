/**
 * القسم الثامن - نظام إدارة السلامة المهنية (Occupational Health & Safety Management)
 * =====================================================================================
 * الجزء الأول (1/4): البنية الأساسية + لوحة التحكم + إدارة خطط السلامة +
 *                     إدارة المخاطر (Risk Assessment) + إدارة الحوادث والإصابات. [منجز]
 * الجزء الثاني (2/4): إدارة التفتيشات + تصاريح العمل + معدات الوقاية الشخصية (PPE).
 * الجزء الثالث (3/4): إدارة الطوارئ + التدريب + المواد الخطرة + المخالفات +
 *                      معدات مكافحة الحريق.
 * الجزء الرابع (4/4): التنبيهات الذكية + التقارير + الرسوم البيانية + الذكاء
 *                      الاصطناعي + التكامل الكامل + الصلاحيات المتقدمة.
 *
 * التخزين: ملف JSON على القرص (backend/data/hse.json) بنفس نمط
 * equipmentManagement.js / projectManagement.js / scheduling.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 45001 (نظام إدارة الصحة والسلامة المهنية) وOSHA
 * (تصنيف شدة الإصابات، هرم التحكم بالمخاطر، مصفوفة الاحتمالية × التأثير).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - مصفوفة تقييم المخاطر 5×5 (Likelihood × Severity) تُحسب فعلياً رقمياً وتُصنَّف
 *    تلقائياً حسب حدود ISO 45001 (منخفض/متوسط/عالٍ/حرج) وتحدد أولوية المعالجة.
 *  - سجل الحوادث يحسب فعلياً معدل تكرار الحوادث (Incident Frequency Rate) ومعدل
 *    شدة الإصابات (Severity Rate) حسب أيام العمل الضائعة وساعات العمل الفعلية،
 *    وهي مؤشرات OSHA/ISO 45001 القياسية وليست أرقاماً وهمية.
 *  - كل حادثة يجب أن تُغلَق عبر تحقيق فعلي (سبب مباشر + سبب جذري + إجراءات
 *    تصحيحية) قبل السماح بتغيير حالتها إلى "مغلقة".
 *  - خطط السلامة تدعم إصدارات متعددة (Version Control) مع سجل تغييرات فعلي.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hse.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      safetyPlans: {},       // { id: safetyPlanRecord }        (خطط السلامة + السياسات + خطط الإخلاء/الطوارئ)
      safetyPlanVersions: {},// { id: versionRecord }            (سجل إصدارات كل خطة)
      risks: {},             // { id: riskRecord }               (سجل تقييم المخاطر)
      riskControlActions: {},// { id: controlActionRecord }      (متابعة تنفيذ إجراءات التحكم)
      incidents: {},         // { id: incidentRecord }           (الحوادث والإصابات)
      auditLog: [],
      seq: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات إدارة السلامة المهنية: ' + e.message);
  }
  let migrated = false;
  for (const key of ['safetyPlans', 'safetyPlanVersions', 'risks', 'riskControlActions', 'incidents']) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
  if (!store.auditLog) { store.auditLog = []; migrated = true; }
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, details });
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

function generateCode(store, prefix) {
  store.seq = (store.seq || 0) + 1;
  return `${prefix}-${String(store.seq).padStart(5, '0')}`;
}

// ===================== ثوابت =====================

// ----- خطط السلامة -----
const SAFETY_PLAN_TYPES = [
  'project_safety_plan', 'safety_policy', 'safety_procedure', 'safe_work_instruction',
  'evacuation_plan', 'emergency_plan',
];
const SAFETY_PLAN_TYPE_LABELS = {
  project_safety_plan: 'خطة السلامة للمشروع',
  safety_policy: 'سياسة السلامة',
  safety_procedure: 'إجراء سلامة',
  safe_work_instruction: 'تعليمات العمل الآمن',
  evacuation_plan: 'خطة إخلاء',
  emergency_plan: 'خطة طوارئ',
};

const SAFETY_PLAN_STATUSES = ['draft', 'under_review', 'approved', 'archived'];
const SAFETY_PLAN_STATUS_LABELS = {
  draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمدة', archived: 'مؤرشفة',
};

// ----- إدارة المخاطر (Risk Assessment) - مصفوفة 5×5 حسب ISO 45001 -----
const RISK_CATEGORIES = [
  'fall_from_height', 'electrical', 'fire_explosion', 'mechanical', 'chemical',
  'excavation_collapse', 'lifting_crane', 'confined_space', 'noise_vibration',
  'ergonomic', 'traffic_vehicle', 'environmental', 'other',
];
const RISK_CATEGORY_LABELS = {
  fall_from_height: 'السقوط من ارتفاع', electrical: 'مخاطر كهربائية', fire_explosion: 'حريق/انفجار',
  mechanical: 'مخاطر ميكانيكية', chemical: 'مخاطر كيميائية', excavation_collapse: 'انهيار حفريات',
  lifting_crane: 'أعمال رفع/رافعات', confined_space: 'أماكن مغلقة', noise_vibration: 'ضوضاء واهتزاز',
  ergonomic: 'مخاطر بيئة العمل (Ergonomic)', traffic_vehicle: 'حركة مركبات', environmental: 'مخاطر بيئية',
  other: 'أخرى',
};

// الاحتمالية 1-5 (نادر → شبه مؤكد) والتأثير 1-5 (طفيف → كارثي) - معيار ISO 31000/45001
const LIKELIHOOD_LEVELS = { 1: 'نادر جداً', 2: 'نادر', 3: 'محتمل', 4: 'مرجّح', 5: 'شبه مؤكد' };
const SEVERITY_LEVELS = { 1: 'طفيف (إسعافات أولية)', 2: 'بسيط (إصابة بسيطة)', 3: 'متوسط (إصابة تستدعي علاجاً)', 4: 'جسيم (إصابة خطيرة/عجز)', 5: 'كارثي (وفاة)' };

// تصنيف مستوى الخطورة بناءً على الدرجة (احتمالية × تأثير، من 1 إلى 25)
function classifyRiskLevel(score) {
  if (score <= 4) return { level: 'low', label: 'منخفض', color: '#22c55e', priority: 4 };
  if (score <= 9) return { level: 'medium', label: 'متوسط', color: '#eab308', priority: 3 };
  if (score <= 15) return { level: 'high', label: 'عالٍ', color: '#f97316', priority: 2 };
  return { level: 'critical', label: 'حرج', color: '#ef4444', priority: 1 };
}

const RISK_STATUSES = ['open', 'controls_in_progress', 'controlled', 'closed'];
const RISK_STATUS_LABELS = {
  open: 'مفتوح', controls_in_progress: 'إجراءات التحكم قيد التنفيذ', controlled: 'مُتحكَّم به', closed: 'مغلق',
};

// هرم التحكم بالمخاطر (Hierarchy of Controls) - ISO 45001 / OSHA
const CONTROL_HIERARCHY = [
  'elimination', 'substitution', 'engineering_controls', 'administrative_controls', 'ppe',
];
const CONTROL_HIERARCHY_LABELS = {
  elimination: 'الإزالة (Elimination)', substitution: 'الإحلال (Substitution)',
  engineering_controls: 'الضوابط الهندسية (Engineering Controls)',
  administrative_controls: 'الضوابط الإدارية (Administrative Controls)',
  ppe: 'معدات الوقاية الشخصية (PPE)',
};

const CONTROL_ACTION_STATUSES = ['pending', 'in_progress', 'completed', 'overdue', 'verified'];
const CONTROL_ACTION_STATUS_LABELS = {
  pending: 'لم يبدأ', in_progress: 'قيد التنفيذ', completed: 'مكتمل', overdue: 'متأخر', verified: 'تم التحقق منه',
};

// ----- إدارة الحوادث والإصابات -----
const INCIDENT_TYPES = [
  'near_miss', 'first_aid', 'medical_treatment', 'lost_time_injury', 'permanent_disability',
  'fatality', 'property_damage', 'environmental_incident', 'security_incident',
];
const INCIDENT_TYPE_LABELS = {
  near_miss: 'حادثة وشيكة (Near Miss)', first_aid: 'إسعافات أولية', medical_treatment: 'علاج طبي',
  lost_time_injury: 'إصابة بفقدان وقت عمل (LTI)', permanent_disability: 'عجز دائم', fatality: 'وفاة',
  property_damage: 'أضرار ممتلكات', environmental_incident: 'حادثة بيئية', security_incident: 'حادثة أمنية',
};

// درجة شدة الإصابة (OSHA Injury Severity Classification)
const INJURY_SEVERITIES = ['none', 'minor', 'moderate', 'severe', 'fatal'];
const INJURY_SEVERITY_LABELS = {
  none: 'لا يوجد', minor: 'طفيفة', moderate: 'متوسطة', severe: 'جسيمة', fatal: 'وفاة',
};
const INJURY_TYPES = [
  'cut_laceration', 'fracture', 'burn', 'sprain_strain', 'bruise_contusion', 'crush_injury',
  'eye_injury', 'electric_shock', 'inhalation_poisoning', 'heat_stress', 'other',
];
const INJURY_TYPE_LABELS = {
  cut_laceration: 'جرح/قطع', fracture: 'كسر', burn: 'حرق', sprain_strain: 'التواء/شد عضلي',
  bruise_contusion: 'كدمة/رضة', crush_injury: 'إصابة سحق', eye_injury: 'إصابة عين',
  electric_shock: 'صعقة كهربائية', inhalation_poisoning: 'استنشاق/تسمم', heat_stress: 'إجهاد حراري', other: 'أخرى',
};

const INCIDENT_STATUSES = ['reported', 'under_investigation', 'corrective_actions_pending', 'closed'];
const INCIDENT_STATUS_LABELS = {
  reported: 'تم الإبلاغ', under_investigation: 'قيد التحقيق',
  corrective_actions_pending: 'بانتظار الإجراءات التصحيحية', closed: 'مغلق',
};

const HSE_ROLES = [
  'system_admin', 'hse_manager', 'safety_officer', 'project_manager',
  'site_engineer', 'field_supervisor', 'worker', 'client_viewer',
];
const HSE_ROLE_LABELS = {
  system_admin: 'مدير النظام', hse_manager: 'مدير السلامة (HSE Manager)', safety_officer: 'مسؤول السلامة',
  project_manager: 'مدير المشروع', site_engineer: 'المهندس المشرف', field_supervisor: 'المشرف الميداني',
  worker: 'العامل', client_viewer: 'العميل (عرض فقط)',
};

// ===================== دوال مساعدة للتحقق =====================

function validateSafetyPlanInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات خطة السلامة مطلوبة');
  if (!body.title || !String(body.title).trim()) throw new Error('عنوان الخطة مطلوب');
  if (!body.type || !SAFETY_PLAN_TYPES.includes(body.type)) {
    throw new Error(`نوع الخطة غير صحيح: ${body.type}`);
  }
  if (!body.project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
}

function validateRiskInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات تقييم المخاطر مطلوبة');
  if (!body.title || !String(body.title).trim()) throw new Error('عنوان/وصف الخطر مطلوب');
  if (!body.project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  if (!body.category || !RISK_CATEGORIES.includes(body.category)) {
    throw new Error(`تصنيف الخطر غير صحيح: ${body.category}`);
  }
  const likelihood = Number(body.likelihood);
  const severity = Number(body.severity);
  if (!likelihood || likelihood < 1 || likelihood > 5) throw new Error('الاحتمالية (likelihood) يجب أن تكون رقماً من 1 إلى 5');
  if (!severity || severity < 1 || severity > 5) throw new Error('شدة التأثير (severity) يجب أن تكون رقماً من 1 إلى 5');
}

function validateIncidentInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات الحادث مطلوبة');
  if (!body.type || !INCIDENT_TYPES.includes(body.type)) throw new Error(`نوع الحادث غير صحيح: ${body.type}`);
  if (!body.project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  if (!body.occurred_at) throw new Error('تاريخ ووقت الحادث (occurred_at) مطلوب');
  if (!body.location || !String(body.location).trim()) throw new Error('موقع الحادث مطلوب');
  if (!body.description || !String(body.description).trim()) throw new Error('وصف الحادث مطلوب');
}

// ===================== إدارة خطط السلامة =====================

function createSafetyPlan(body) {
  validateSafetyPlanInput(body);
  const store = loadStore();
  const id = newId('SPLAN');
  const code = generateCode(store, 'SP');

  const record = {
    id,
    code,
    title: String(body.title).trim(),
    type: body.type,
    project_id: body.project_id,
    description: body.description || null,
    // أهداف/سياسات/إجراءات السلامة (نصوص حرة أو قوائم بنود)
    objectives: Array.isArray(body.objectives) ? body.objectives : [],
    policies: Array.isArray(body.policies) ? body.policies : [],
    procedures: Array.isArray(body.procedures) ? body.procedures : [],
    // خاص بخطط الإخلاء/الطوارئ
    assembly_points: Array.isArray(body.assembly_points) ? body.assembly_points : [],
    evacuation_routes: Array.isArray(body.evacuation_routes) ? body.evacuation_routes : [],
    safety_map_url: body.safety_map_url || null,
    // مرفقات
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    responsible_person: body.responsible_person || null,
    status: body.status && SAFETY_PLAN_STATUSES.includes(body.status) ? body.status : 'draft',
    version: 1,
    effective_date: body.effective_date || null,
    review_date: body.review_date || null,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.safetyPlans[id] = record;

  // أول إصدار في سجل التغييرات
  const versionId = newId('SPV');
  store.safetyPlanVersions[versionId] = {
    id: versionId,
    plan_id: id,
    version: 1,
    snapshot: { ...record },
    change_note: 'الإصدار الأول للخطة',
    changed_by: body.created_by || null,
    created_at: nowISO(),
  };

  audit(store, { action: 'create', entity: 'safetyPlan', entityId: id, projectId: body.project_id, details: { title: record.title, type: record.type } });
  saveStore(store);
  return { success: true, data: record };
}

function listSafetyPlans(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.safetyPlans).filter(p => p.is_active !== false);
  if (filters.projectId) items = items.filter(p => p.project_id === filters.projectId);
  if (filters.type) items = items.filter(p => p.type === filters.type);
  if (filters.status) items = items.filter(p => p.status === filters.status);
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(p => (p.title || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q));
  }
  items = items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return { success: true, data: items, count: items.length };
}

function getSafetyPlan(id) {
  const store = loadStore();
  const record = store.safetyPlans[id];
  if (!record) throw new Error('خطة السلامة غير موجودة');
  const versions = Object.values(store.safetyPlanVersions)
    .filter(v => v.plan_id === id)
    .sort((a, b) => b.version - a.version);
  return { success: true, data: { ...record, versions } };
}

function updateSafetyPlan(id, updates) {
  const store = loadStore();
  const record = store.safetyPlans[id];
  if (!record) throw new Error('خطة السلامة غير موجودة');

  if (updates.type && !SAFETY_PLAN_TYPES.includes(updates.type)) {
    throw new Error(`نوع الخطة غير صحيح: ${updates.type}`);
  }
  if (updates.status && !SAFETY_PLAN_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الخطة غير صحيحة: ${updates.status}`);
  }

  // أي تعديل جوهري على المحتوى يرفع رقم الإصدار تلقائياً ويُسجَّل في سجل الإصدارات
  const contentFields = ['objectives', 'policies', 'procedures', 'assembly_points', 'evacuation_routes', 'description', 'title'];
  const isContentChange = contentFields.some(f => updates[f] !== undefined && JSON.stringify(updates[f]) !== JSON.stringify(record[f]));

  const blocked = ['id', 'code', 'created_at', 'version'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();

  if (isContentChange) {
    record.version = (record.version || 1) + 1;
    const versionId = newId('SPV');
    store.safetyPlanVersions[versionId] = {
      id: versionId,
      plan_id: id,
      version: record.version,
      snapshot: { ...record },
      change_note: updates.change_note || 'تحديث محتوى الخطة',
      changed_by: updates.updated_by || null,
      created_at: nowISO(),
    };
  }

  audit(store, { action: 'update', entity: 'safetyPlan', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates), newVersion: isContentChange ? record.version : null } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteSafetyPlan(id) {
  const store = loadStore();
  const record = store.safetyPlans[id];
  if (!record) throw new Error('خطة السلامة غير موجودة');
  record.is_active = false;
  record.status = 'archived';
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'safetyPlan', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

function approveSafetyPlan(id, { approved_by = null } = {}) {
  const store = loadStore();
  const record = store.safetyPlans[id];
  if (!record) throw new Error('خطة السلامة غير موجودة');
  record.status = 'approved';
  record.approved_by = approved_by;
  record.approved_at = nowISO();
  record.updated_at = nowISO();
  audit(store, { action: 'approve', entity: 'safetyPlan', entityId: id, projectId: record.project_id, details: { approved_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة المخاطر (Risk Assessment) =====================

function createRisk(body) {
  validateRiskInput(body);
  const store = loadStore();
  const id = newId('RISK');
  const code = generateCode(store, 'RSK');

  const likelihood = Number(body.likelihood);
  const severity = Number(body.severity);
  const score = likelihood * severity;
  const classification = classifyRiskLevel(score);

  const record = {
    id,
    code,
    title: String(body.title).trim(),
    project_id: body.project_id,
    category: body.category,
    location: body.location || null,
    description: body.description || null,
    // تقييم الاحتمالية والتأثير
    likelihood,
    likelihood_label: LIKELIHOOD_LEVELS[likelihood],
    severity,
    severity_label: SEVERITY_LEVELS[severity],
    risk_score: score,
    risk_level: classification.level,
    risk_level_label: classification.label,
    risk_priority: classification.priority,
    // إجراءات التحكم (يمكن إضافتها لاحقاً عبر addRiskControlAction)
    control_hierarchy: body.control_hierarchy && CONTROL_HIERARCHY.includes(body.control_hierarchy) ? body.control_hierarchy : null,
    control_measures: body.control_measures || null,
    // التقييم بعد تطبيق الضوابط (Residual Risk) - اختياري عند الإنشاء، يُحدَّث لاحقاً
    residual_likelihood: null,
    residual_severity: null,
    residual_score: null,
    residual_level: null,
    responsible_person: body.responsible_person || null,
    review_date: body.review_date || null,
    status: 'open',
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.risks[id] = record;
  audit(store, { action: 'create', entity: 'risk', entityId: id, projectId: body.project_id, details: { title: record.title, risk_level: record.risk_level, score } });
  saveStore(store);
  return { success: true, data: record };
}

function listRisks(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.risks).filter(r => r.is_active !== false);
  if (filters.projectId) items = items.filter(r => r.project_id === filters.projectId);
  if (filters.category) items = items.filter(r => r.category === filters.category);
  if (filters.level) items = items.filter(r => r.risk_level === filters.level);
  if (filters.status) items = items.filter(r => r.status === filters.status);
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(r => (r.title || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q));
  }
  // ترتيب افتراضي: الأخطر أولاً (priority 1 = حرج)
  items = items.sort((a, b) => (a.risk_priority - b.risk_priority) || (b.risk_score - a.risk_score));
  return { success: true, data: items, count: items.length };
}

function getRisk(id) {
  const store = loadStore();
  const record = store.risks[id];
  if (!record) throw new Error('سجل الخطر غير موجود');
  const controlActions = Object.values(store.riskControlActions)
    .filter(a => a.risk_id === id)
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  return { success: true, data: { ...record, control_actions: controlActions } };
}

function updateRisk(id, updates) {
  const store = loadStore();
  const record = store.risks[id];
  if (!record) throw new Error('سجل الخطر غير موجود');

  if (updates.category && !RISK_CATEGORIES.includes(updates.category)) {
    throw new Error(`تصنيف الخطر غير صحيح: ${updates.category}`);
  }
  if (updates.status && !RISK_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الخطر غير صحيحة: ${updates.status}`);
  }
  if (updates.control_hierarchy && !CONTROL_HIERARCHY.includes(updates.control_hierarchy)) {
    throw new Error(`مستوى التحكم غير صحيح: ${updates.control_hierarchy}`);
  }

  const blocked = ['id', 'code', 'created_at', 'risk_score', 'risk_level', 'risk_level_label', 'risk_priority'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }

  // إعادة حساب درجة الخطورة الأصلية عند تغيير الاحتمالية/الشدة
  if (updates.likelihood !== undefined || updates.severity !== undefined) {
    const likelihood = Number(record.likelihood);
    const severity = Number(record.severity);
    if (!likelihood || likelihood < 1 || likelihood > 5) throw new Error('الاحتمالية (likelihood) يجب أن تكون رقماً من 1 إلى 5');
    if (!severity || severity < 1 || severity > 5) throw new Error('شدة التأثير (severity) يجب أن تكون رقماً من 1 إلى 5');
    const score = likelihood * severity;
    const classification = classifyRiskLevel(score);
    record.likelihood_label = LIKELIHOOD_LEVELS[likelihood];
    record.severity_label = SEVERITY_LEVELS[severity];
    record.risk_score = score;
    record.risk_level = classification.level;
    record.risk_level_label = classification.label;
    record.risk_priority = classification.priority;
  }

  // حساب الخطر المتبقي (Residual Risk) بعد تطبيق إجراءات التحكم
  if (updates.residual_likelihood !== undefined || updates.residual_severity !== undefined) {
    const rl = Number(record.residual_likelihood);
    const rs = Number(record.residual_severity);
    if (rl && rs && rl >= 1 && rl <= 5 && rs >= 1 && rs <= 5) {
      const rScore = rl * rs;
      record.residual_score = rScore;
      record.residual_level = classifyRiskLevel(rScore).level;
    }
  }

  record.updated_at = nowISO();
  audit(store, { action: 'update', entity: 'risk', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteRisk(id) {
  const store = loadStore();
  const record = store.risks[id];
  if (!record) throw new Error('سجل الخطر غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'risk', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ----- إجراءات التحكم بالمخاطر (Risk Control Actions) -----

function addRiskControlAction(body) {
  const store = loadStore();
  const { risk_id, action_description, hierarchy_level = null, responsible_person = null, due_date = null } = body || {};
  if (!risk_id) throw new Error('معرّف الخطر (risk_id) مطلوب');
  if (!action_description || !String(action_description).trim()) throw new Error('وصف الإجراء مطلوب');
  const risk = store.risks[risk_id];
  if (!risk) throw new Error('سجل الخطر غير موجود');
  if (hierarchy_level && !CONTROL_HIERARCHY.includes(hierarchy_level)) {
    throw new Error(`مستوى التحكم غير صحيح: ${hierarchy_level}`);
  }

  const id = newId('RCA');
  const record = {
    id,
    risk_id,
    project_id: risk.project_id,
    action_description: String(action_description).trim(),
    hierarchy_level,
    responsible_person,
    due_date,
    status: 'pending',
    completed_at: null,
    verified_by: null,
    verified_at: null,
    note: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.riskControlActions[id] = record;

  // إذا كان هذا أول إجراء تحكم يُضاف، حدّث حالة الخطر إلى "قيد التنفيذ"
  if (risk.status === 'open') {
    risk.status = 'controls_in_progress';
    risk.updated_at = nowISO();
  }

  audit(store, { action: 'create', entity: 'riskControlAction', entityId: id, projectId: risk.project_id, details: { risk_id } });
  saveStore(store);
  return { success: true, data: record };
}

function listRiskControlActions(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.riskControlActions);
  if (filters.riskId) items = items.filter(a => a.risk_id === filters.riskId);
  if (filters.projectId) items = items.filter(a => a.project_id === filters.projectId);
  if (filters.status) items = items.filter(a => a.status === filters.status);
  if (filters.responsiblePerson) items = items.filter(a => a.responsible_person === filters.responsiblePerson);

  // تحديد الإجراءات المتأخرة تلقائياً (تجاوزت due_date ولم تكتمل)
  const today = nowISO().slice(0, 10);
  items = items.map(a => {
    if (a.due_date && a.due_date < today && !['completed', 'verified'].includes(a.status)) {
      return { ...a, status: 'overdue', is_overdue: true };
    }
    return { ...a, is_overdue: false };
  });

  items = items.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  return { success: true, data: items, count: items.length };
}

function updateRiskControlAction(id, updates) {
  const store = loadStore();
  const record = store.riskControlActions[id];
  if (!record) throw new Error('إجراء التحكم غير موجود');

  if (updates.status && !CONTROL_ACTION_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الإجراء غير صحيحة: ${updates.status}`);
  }

  const blocked = ['id', 'risk_id', 'project_id', 'created_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  if (updates.status === 'completed' && !record.completed_at) record.completed_at = nowISO();
  if (updates.status === 'verified' && !record.verified_at) record.verified_at = nowISO();
  record.updated_at = nowISO();

  // إذا اكتملت كل إجراءات التحكم الخاصة بالخطر، حدّث حالة الخطر إلى "مُتحكَّم به"
  const risk = store.risks[record.risk_id];
  if (risk) {
    const allActions = Object.values(store.riskControlActions).filter(a => a.risk_id === record.risk_id);
    const allDone = allActions.length > 0 && allActions.every(a => ['completed', 'verified'].includes(a.id === id ? record.status : a.status));
    if (allDone && risk.status !== 'closed') {
      risk.status = 'controlled';
      risk.updated_at = nowISO();
    }
  }

  audit(store, { action: 'update', entity: 'riskControlAction', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: record };
}

function getRiskMatrix(projectId = null) {
  const store = loadStore();
  let items = Object.values(store.risks).filter(r => r.is_active !== false);
  if (projectId) items = items.filter(r => r.project_id === projectId);

  // مصفوفة 5×5: matrix[severity][likelihood] = عدد المخاطر في هذه الخانة
  const matrix = {};
  for (let s = 1; s <= 5; s++) {
    matrix[s] = {};
    for (let l = 1; l <= 5; l++) matrix[s][l] = 0;
  }
  for (const r of items) {
    if (matrix[r.severity] && matrix[r.severity][r.likelihood] !== undefined) {
      matrix[r.severity][r.likelihood] += 1;
    }
  }

  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of items) byLevel[r.risk_level] = (byLevel[r.risk_level] || 0) + 1;

  return {
    success: true,
    data: {
      matrix,
      by_level: byLevel,
      total_risks: items.length,
      likelihood_levels: LIKELIHOOD_LEVELS,
      severity_levels: SEVERITY_LEVELS,
    },
  };
}

// ===================== إدارة الحوادث والإصابات =====================

function createIncident(body) {
  validateIncidentInput(body);
  const store = loadStore();
  const id = newId('INC');
  const code = generateCode(store, 'INC');

  const record = {
    id,
    code,
    type: body.type,
    project_id: body.project_id,
    occurred_at: body.occurred_at,
    location: body.location.trim(),
    // الشخص المصاب (قد لا يوجد في حالة Near Miss أو أضرار ممتلكات)
    injured_person_name: body.injured_person_name || null,
    injured_person_id: body.injured_person_id || null,
    injured_person_role: body.injured_person_role || null,
    injury_type: body.injury_type && INJURY_TYPES.includes(body.injury_type) ? body.injury_type : null,
    injury_severity: body.injury_severity && INJURY_SEVERITIES.includes(body.injury_severity) ? body.injury_severity : 'none',
    lost_work_days: body.lost_work_days != null ? Number(body.lost_work_days) || 0 : 0,
    // الوصف والأسباب
    description: String(body.description).trim(),
    direct_cause: body.direct_cause || null,
    root_cause: body.root_cause || null,
    // الشهود والمرفقات
    witnesses: Array.isArray(body.witnesses) ? body.witnesses : [],
    photos: Array.isArray(body.photos) ? body.photos : [],
    videos: Array.isArray(body.videos) ? body.videos : [],
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    // التحقيق والإجراءات التصحيحية
    investigation_notes: body.investigation_notes || null,
    investigated_by: body.investigated_by || null,
    investigation_date: body.investigation_date || null,
    corrective_actions: Array.isArray(body.corrective_actions) ? body.corrective_actions.map(a => ({
      id: newId('CA'),
      description: a.description || a,
      responsible_person: a.responsible_person || null,
      due_date: a.due_date || null,
      status: a.status || 'pending',
    })) : [],
    reported_by: body.reported_by || null,
    status: 'reported',
    closed_at: null,
    closed_by: null,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.incidents[id] = record;
  audit(store, { action: 'create', entity: 'incident', entityId: id, projectId: body.project_id, details: { type: record.type, severity: record.injury_severity } });
  saveStore(store);
  return { success: true, data: record };
}

function listIncidents(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.incidents).filter(i => i.is_active !== false);
  if (filters.projectId) items = items.filter(i => i.project_id === filters.projectId);
  if (filters.type) items = items.filter(i => i.type === filters.type);
  if (filters.severity) items = items.filter(i => i.injury_severity === filters.severity);
  if (filters.status) items = items.filter(i => i.status === filters.status);
  if (filters.dateFrom) items = items.filter(i => i.occurred_at >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(i => i.occurred_at <= filters.dateTo);
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(i =>
      (i.description || '').toLowerCase().includes(q) ||
      (i.code || '').toLowerCase().includes(q) ||
      (i.location || '').toLowerCase().includes(q) ||
      (i.injured_person_name || '').toLowerCase().includes(q)
    );
  }
  items = items.sort((a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || ''));
  return { success: true, data: items, count: items.length };
}

function getIncident(id) {
  const store = loadStore();
  const record = store.incidents[id];
  if (!record) throw new Error('الحادث غير موجود');
  return { success: true, data: record };
}

function updateIncident(id, updates) {
  const store = loadStore();
  const record = store.incidents[id];
  if (!record) throw new Error('الحادث غير موجود');

  if (updates.type && !INCIDENT_TYPES.includes(updates.type)) throw new Error(`نوع الحادث غير صحيح: ${updates.type}`);
  if (updates.injury_severity && !INJURY_SEVERITIES.includes(updates.injury_severity)) {
    throw new Error(`درجة الإصابة غير صحيحة: ${updates.injury_severity}`);
  }
  if (updates.injury_type && !INJURY_TYPES.includes(updates.injury_type)) {
    throw new Error(`نوع الإصابة غير صحيح: ${updates.injury_type}`);
  }
  if (updates.status && !INCIDENT_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الحادث غير صحيحة: ${updates.status}`);
  }

  // منع إغلاق الحادث دون تحقيق فعلي (سبب مباشر + سبب جذري + إجراء تصحيحي واحد على الأقل)
  if (updates.status === 'closed' && record.status !== 'closed') {
    const directCause = updates.direct_cause !== undefined ? updates.direct_cause : record.direct_cause;
    const rootCause = updates.root_cause !== undefined ? updates.root_cause : record.root_cause;
    const correctiveActions = updates.corrective_actions !== undefined ? updates.corrective_actions : record.corrective_actions;
    if (!directCause || !String(directCause).trim()) {
      throw new Error('لا يمكن إغلاق الحادث دون تسجيل السبب المباشر (direct_cause)');
    }
    if (!rootCause || !String(rootCause).trim()) {
      throw new Error('لا يمكن إغلاق الحادث دون تسجيل السبب الجذري (root_cause)');
    }
    if (!Array.isArray(correctiveActions) || correctiveActions.length === 0) {
      throw new Error('لا يمكن إغلاق الحادث دون إجراء تصحيحي واحد على الأقل');
    }
    const openActions = correctiveActions.filter(a => a.status && !['completed', 'done'].includes(a.status));
    if (openActions.length > 0) {
      throw new Error('يوجد إجراءات تصحيحية لم تُستكمل بعد؛ لا يمكن إغلاق الحادث قبل إتمامها جميعاً');
    }
  }

  const blocked = ['id', 'code', 'created_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    if (k === 'corrective_actions' && Array.isArray(v)) {
      record.corrective_actions = v.map(a => ({
        id: a.id || newId('CA'),
        description: a.description || a,
        responsible_person: a.responsible_person || null,
        due_date: a.due_date || null,
        status: a.status || 'pending',
      }));
      continue;
    }
    record[k] = v;
  }
  record.updated_at = nowISO();

  if (updates.status === 'closed' && !record.closed_at) {
    record.closed_at = nowISO();
    record.closed_by = updates.closed_by || null;
  }

  audit(store, { action: 'update', entity: 'incident', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates), newStatus: record.status } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteIncident(id) {
  const store = loadStore();
  const record = store.incidents[id];
  if (!record) throw new Error('الحادث غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'incident', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// حساب مؤشرات السلامة القياسية (OSHA/ISO 45001):
// - معدل تكرار الحوادث (Incident Frequency Rate) = (عدد الحوادث المسجّلة × 200000) / إجمالي ساعات العمل
// - معدل شدة الإصابات (Severity Rate) = (إجمالي أيام العمل الضائعة × 200000) / إجمالي ساعات العمل
// (200000 = القاعدة القياسية المكافئة لـ 100 عامل بدوام كامل لمدة سنة وفق OSHA)
function calculateSafetyKPIs({ projectId = null, totalManHours = null, periodFrom = null, periodTo = null } = {}) {
  const store = loadStore();
  let incidents = Object.values(store.incidents).filter(i => i.is_active !== false);
  if (projectId) incidents = incidents.filter(i => i.project_id === projectId);
  if (periodFrom) incidents = incidents.filter(i => i.occurred_at >= periodFrom);
  if (periodTo) incidents = incidents.filter(i => i.occurred_at <= periodTo);

  const recordableIncidents = incidents.filter(i => !['near_miss'].includes(i.type));
  const lostTimeIncidents = incidents.filter(i => i.type === 'lost_time_injury' || i.type === 'fatality' || i.type === 'permanent_disability');
  const totalLostDays = incidents.reduce((s, i) => s + (Number(i.lost_work_days) || 0), 0);
  const fatalities = incidents.filter(i => i.type === 'fatality').length;
  const nearMisses = incidents.filter(i => i.type === 'near_miss').length;

  const manHours = Number(totalManHours) || null;
  const frequencyRate = manHours ? r2((recordableIncidents.length * 200000) / manHours) : null;
  const severityRate = manHours ? r2((totalLostDays * 200000) / manHours) : null;

  return {
    success: true,
    data: {
      total_incidents: incidents.length,
      recordable_incidents: recordableIncidents.length,
      lost_time_incidents: lostTimeIncidents.length,
      near_misses: nearMisses,
      fatalities,
      total_lost_work_days: totalLostDays,
      total_man_hours: manHours,
      incident_frequency_rate: frequencyRate,
      injury_severity_rate: severityRate,
      note: manHours ? null : 'أدخل إجمالي ساعات العمل (totalManHours) لحساب معدلي التكرار والشدة وفق معيار OSHA',
    },
  };
}

// ===================== لوحة التحكم الرئيسية =====================

function getDashboard(projectId = null) {
  const store = loadStore();

  let plans = Object.values(store.safetyPlans).filter(p => p.is_active !== false);
  let risks = Object.values(store.risks).filter(r => r.is_active !== false);
  let incidents = Object.values(store.incidents).filter(i => i.is_active !== false);

  if (projectId) {
    plans = plans.filter(p => p.project_id === projectId);
    risks = risks.filter(r => r.project_id === projectId);
    incidents = incidents.filter(i => i.project_id === projectId);
  }

  const projectsWithPlans = new Set(plans.filter(p => p.status === 'approved').map(p => p.project_id));
  const allProjectIds = new Set([...plans, ...risks, ...incidents].map(x => x.project_id));

  const incidentCount = incidents.length;
  const injuriesCount = incidents.filter(i => i.injury_severity && i.injury_severity !== 'none').length;
  const openRisks = risks.filter(r => r.status !== 'closed').length;
  const criticalRisks = risks.filter(r => r.risk_level === 'critical' && r.status !== 'closed').length;
  const highRisks = risks.filter(r => r.risk_level === 'high' && r.status !== 'closed').length;
  const openIncidents = incidents.filter(i => i.status !== 'closed').length;

  const totalLostDays = incidents.reduce((s, i) => s + (Number(i.lost_work_days) || 0), 0);
  const fatalities = incidents.filter(i => i.type === 'fatality').length;

  const byIncidentType = {};
  for (const t of INCIDENT_TYPES) byIncidentType[t] = 0;
  for (const i of incidents) byIncidentType[i.type] = (byIncidentType[i.type] || 0) + 1;

  const byRiskLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of risks.filter(r => r.status !== 'closed')) byRiskLevel[r.risk_level] = (byRiskLevel[r.risk_level] || 0) + 1;

  const complianceRate = allProjectIds.size > 0 ? r2((projectsWithPlans.size / allProjectIds.size) * 100) : 0;

  const recentIncidents = incidents
    .sort((a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || ''))
    .slice(0, 10);

  const topRisks = risks
    .filter(r => r.status !== 'closed')
    .sort((a, b) => (a.risk_priority - b.risk_priority) || (b.risk_score - a.risk_score))
    .slice(0, 10);

  return {
    success: true,
    data: {
      // ملخص عام
      total_projects_tracked: allProjectIds.size,
      projects_with_approved_plan: projectsWithPlans.size,
      safety_compliance_rate: complianceRate,

      // الحوادث والإصابات
      total_incidents: incidentCount,
      total_injuries: injuriesCount,
      open_incidents: openIncidents,
      fatalities,
      total_lost_work_days: totalLostDays,
      by_incident_type: byIncidentType,

      // المخاطر
      total_open_risks: openRisks,
      critical_risks: criticalRisks,
      high_risks: highRisks,
      by_risk_level: byRiskLevel,

      // خطط السلامة
      total_safety_plans: plans.length,
      approved_plans: plans.filter(p => p.status === 'approved').length,
      draft_plans: plans.filter(p => p.status === 'draft').length,

      // أحدث البيانات
      recent_incidents: recentIncidents,
      top_risks: topRisks,
    },
  };
}

module.exports = {
  // ثوابت - خطط السلامة
  SAFETY_PLAN_TYPES,
  SAFETY_PLAN_TYPE_LABELS,
  SAFETY_PLAN_STATUSES,
  SAFETY_PLAN_STATUS_LABELS,

  // ثوابت - إدارة المخاطر
  RISK_CATEGORIES,
  RISK_CATEGORY_LABELS,
  LIKELIHOOD_LEVELS,
  SEVERITY_LEVELS,
  RISK_STATUSES,
  RISK_STATUS_LABELS,
  CONTROL_HIERARCHY,
  CONTROL_HIERARCHY_LABELS,
  CONTROL_ACTION_STATUSES,
  CONTROL_ACTION_STATUS_LABELS,

  // ثوابت - الحوادث والإصابات
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  INJURY_SEVERITIES,
  INJURY_SEVERITY_LABELS,
  INJURY_TYPES,
  INJURY_TYPE_LABELS,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,

  // أدوار القسم الثامن
  HSE_ROLES,
  HSE_ROLE_LABELS,

  // خطط السلامة
  createSafetyPlan,
  listSafetyPlans,
  getSafetyPlan,
  updateSafetyPlan,
  deleteSafetyPlan,
  approveSafetyPlan,

  // إدارة المخاطر
  createRisk,
  listRisks,
  getRisk,
  updateRisk,
  deleteRisk,
  addRiskControlAction,
  listRiskControlActions,
  updateRiskControlAction,
  getRiskMatrix,

  // الحوادث والإصابات
  createIncident,
  listIncidents,
  getIncident,
  updateIncident,
  deleteIncident,
  calculateSafetyKPIs,

  // لوحة التحكم
  getDashboard,
};
