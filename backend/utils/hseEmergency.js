/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * الجزء (3/4) - وحدة إدارة الطوارئ (Emergency Management)
 * =====================================================================================
 * تشمل: خطط الطوارئ (Emergency Response Plans)، سيناريوهات الطوارئ، فرق الطوارئ،
 * نقاط التجمع، معدات الإطفاء المرتبطة بخطة الطوارئ، تدريبات/تمارين الإخلاء،
 * سجلات الطوارئ الفعلية (Activation Log)، وتقييم الاستجابة بعد كل حادث/تمرين.
 *
 * التخزين: ملف JSON منفصل (backend/data/hseEmergency.json) بنفس نمط
 * hseManagement.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 45001 (البند 8.2 - التأهب والاستجابة للطوارئ) وOSHA
 * (Emergency Action Plan - 29 CFR 1926.35).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل خطة طوارئ يجب أن تحتوي على فريق طوارئ واحد على الأقل ونقطة تجمع واحدة
 *    على الأقل قبل اعتمادها (نفس فلسفة اعتماد خطط السلامة في hseManagement.js).
 *  - تمارين الإخلاء (Drills) تُحسب فعلياً: زمن الإخلاء الفعلي مقابل الزمن
 *    المستهدف، ونسبة الحضور، وتُصنَّف النتيجة تلقائياً (ناجح/يحتاج تحسين/فاشل).
 *  - تفعيل حالة طوارئ فعلية (Activation) يُنشئ سجلاً زمنياً كاملاً من لحظة
 *    التبليغ حتى الإغلاق، ولا يمكن إغلاقه دون تقييم استجابة فعلي.
 *  - جميع العمليات تُسجَّل في سجل تدقيق (Audit Log) منفصل لهذه الوحدة.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hseEmergency.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      emergencyPlans: {},     // { id: planRecord }           (خطط الطوارئ + السيناريوهات + الفرق + نقاط التجمع)
      emergencyDrills: {},    // { id: drillRecord }          (تدريبات وتمارين الإخلاء)
      emergencyActivations: {}, // { id: activationRecord }   (سجلات الطوارئ الفعلية - تفعيل حقيقي)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة الطوارئ: ' + e.message);
  }
  let migrated = false;
  for (const key of ['emergencyPlans', 'emergencyDrills', 'emergencyActivations']) {
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

// ----- أنواع سيناريوهات الطوارئ -----
const EMERGENCY_SCENARIO_TYPES = [
  'fire', 'earthquake', 'flood', 'structural_collapse', 'chemical_spill',
  'gas_leak', 'explosion', 'medical_emergency', 'electrical_hazard',
  'crane_lifting_accident', 'confined_space_rescue', 'severe_weather', 'security_threat', 'other',
];
const EMERGENCY_SCENARIO_TYPE_LABELS = {
  fire: 'حريق',
  earthquake: 'زلزال',
  flood: 'فيضان/سيول',
  structural_collapse: 'انهيار إنشائي',
  chemical_spill: 'انسكاب مواد كيميائية',
  gas_leak: 'تسرب غاز',
  explosion: 'انفجار',
  medical_emergency: 'حالة طبية طارئة',
  electrical_hazard: 'خطر كهربائي',
  crane_lifting_accident: 'حادث رافعة/أعمال رفع',
  confined_space_rescue: 'إنقاذ من مكان مغلق',
  severe_weather: 'أحوال جوية قاسية',
  security_threat: 'تهديد أمني',
  other: 'أخرى',
};

const EMERGENCY_PLAN_STATUSES = ['draft', 'under_review', 'approved', 'archived'];
const EMERGENCY_PLAN_STATUS_LABELS = {
  draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمدة', archived: 'مؤرشفة',
};

// ----- أدوار فرق الطوارئ -----
const EMERGENCY_TEAM_ROLES = [
  'incident_commander', 'fire_warden', 'first_aider', 'evacuation_marshal',
  'rescue_team', 'security_coordinator', 'communications_officer', 'medical_liaison',
];
const EMERGENCY_TEAM_ROLE_LABELS = {
  incident_commander: 'قائد الحادث (Incident Commander)',
  fire_warden: 'مسؤول إخلاء الحريق (Fire Warden)',
  first_aider: 'مسعف أولي',
  evacuation_marshal: 'مشرف إخلاء',
  rescue_team: 'فريق إنقاذ',
  security_coordinator: 'منسق أمني',
  communications_officer: 'مسؤول اتصالات',
  medical_liaison: 'منسق طبي',
};

// ----- معدات الإطفاء المرتبطة بخطة الطوارئ -----
const FIRE_EQUIPMENT_TYPES = [
  'fire_extinguisher', 'fire_hose', 'alarm_system', 'smoke_detector',
  'sprinkler_system', 'emergency_exit_light', 'fire_blanket', 'fire_hydrant',
];
const FIRE_EQUIPMENT_TYPE_LABELS = {
  fire_extinguisher: 'طفاية حريق',
  fire_hose: 'خرطوم إطفاء',
  alarm_system: 'نظام إنذار',
  smoke_detector: 'جهاز كشف دخان',
  sprinkler_system: 'نظام رش آلي',
  emergency_exit_light: 'إنارة مخرج طوارئ',
  fire_blanket: 'بطانية إطفاء',
  fire_hydrant: 'صنبور حريق',
};
const FIRE_EQUIPMENT_STATUSES = ['operational', 'needs_maintenance', 'expired', 'out_of_service'];
const FIRE_EQUIPMENT_STATUS_LABELS = {
  operational: 'صالحة للعمل', needs_maintenance: 'تحتاج صيانة', expired: 'منتهية الصلاحية', out_of_service: 'خارج الخدمة',
};

// ----- تمارين وتدريبات الإخلاء -----
const DRILL_TYPES = ['fire_drill', 'earthquake_drill', 'full_scale_exercise', 'tabletop_exercise', 'evacuation_drill'];
const DRILL_TYPE_LABELS = {
  fire_drill: 'تمرين إخلاء حريق',
  earthquake_drill: 'تمرين زلزال',
  full_scale_exercise: 'تمرين ميداني شامل',
  tabletop_exercise: 'تمرين مكتبي (Tabletop)',
  evacuation_drill: 'تمرين إخلاء عام',
};
const DRILL_STATUSES = ['scheduled', 'completed', 'cancelled'];
const DRILL_STATUS_LABELS = { scheduled: 'مجدول', completed: 'منفَّذ', cancelled: 'ملغى' };

// تقييم نتيجة التمرين حسب الزمن الفعلي مقابل الزمن المستهدف ونسبة الحضور
function classifyDrillResult({ targetTimeSeconds, actualTimeSeconds, attendanceRate }) {
  if (!targetTimeSeconds || !actualTimeSeconds) return { result: 'not_evaluated', label: 'لم يُقيَّم بعد', color: '#94a3b8' };
  const timeRatio = actualTimeSeconds / targetTimeSeconds;
  const attendance = attendanceRate != null ? attendanceRate : 100;
  if (timeRatio <= 1.0 && attendance >= 90) return { result: 'passed', label: 'ناجح', color: '#22c55e' };
  if (timeRatio <= 1.3 && attendance >= 75) return { result: 'needs_improvement', label: 'يحتاج تحسين', color: '#eab308' };
  return { result: 'failed', label: 'فاشل', color: '#ef4444' };
}

// ----- سجلات الطوارئ الفعلية (Activation Log) -----
const ACTIVATION_STATUSES = ['reported', 'in_progress', 'contained', 'closed'];
const ACTIVATION_STATUS_LABELS = {
  reported: 'تم التبليغ', in_progress: 'قيد الاستجابة', contained: 'تم الاحتواء', closed: 'مغلقة',
};
const RESPONSE_EVALUATION_RATINGS = ['excellent', 'good', 'adequate', 'poor'];
const RESPONSE_EVALUATION_RATING_LABELS = {
  excellent: 'ممتازة', good: 'جيدة', adequate: 'مقبولة', poor: 'ضعيفة',
};

// ===================== التحقق من المدخلات =====================

function validateEmergencyPlanInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات خطة الطوارئ مطلوبة');
  if (!body.project_id) throw new Error('المشروع (project_id) مطلوب');
  if (!body.title || !String(body.title).trim()) throw new Error('عنوان خطة الطوارئ مطلوب');
  if (!Array.isArray(body.scenario_types) || body.scenario_types.length === 0) {
    throw new Error('يجب تحديد سيناريو طوارئ واحد على الأقل');
  }
  for (const s of body.scenario_types) {
    if (!EMERGENCY_SCENARIO_TYPES.includes(s)) throw new Error(`نوع سيناريو غير صحيح: ${s}`);
  }
}

function validateDrillInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات التمرين مطلوبة');
  if (!body.project_id) throw new Error('المشروع (project_id) مطلوب');
  if (!body.drill_type || !DRILL_TYPES.includes(body.drill_type)) throw new Error('نوع التمرين غير صحيح');
  if (!body.scheduled_date) throw new Error('تاريخ التمرين مطلوب');
}

function validateActivationInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات تفعيل الطوارئ مطلوبة');
  if (!body.project_id) throw new Error('المشروع (project_id) مطلوب');
  if (!body.scenario_type || !EMERGENCY_SCENARIO_TYPES.includes(body.scenario_type)) {
    throw new Error('نوع سيناريو الطوارئ غير صحيح');
  }
  if (!body.reported_at) throw new Error('وقت التبليغ (reported_at) مطلوب');
  if (!body.location || !String(body.location).trim()) throw new Error('موقع الحادث مطلوب');
}

// ===================== إدارة خطط الطوارئ =====================

function createEmergencyPlan(body) {
  validateEmergencyPlanInput(body);
  const store = loadStore();
  const id = newId('EMP');
  const code = generateCode(store, 'EMP');

  const record = {
    id,
    code,
    project_id: body.project_id,
    title: String(body.title).trim(),
    scenario_types: body.scenario_types,
    description: body.description || null,

    // فرق الطوارئ
    teams: Array.isArray(body.teams) ? body.teams.map(t => ({
      id: newId('TEAM'),
      role: t.role,
      member_name: t.member_name || null,
      contact_number: t.contact_number || null,
      responsibilities: t.responsibilities || null,
    })) : [],

    // نقاط التجمع
    assembly_points: Array.isArray(body.assembly_points) ? body.assembly_points.map(a => ({
      id: newId('AP'),
      name: a.name,
      location_description: a.location_description || null,
      capacity: a.capacity != null ? Number(a.capacity) || 0 : null,
      coordinates: a.coordinates || null,
    })) : [],

    // مخارج الطوارئ
    emergency_exits: Array.isArray(body.emergency_exits) ? body.emergency_exits.map(e => ({
      id: newId('EX'),
      name: e.name,
      location_description: e.location_description || null,
    })) : [],

    // معدات الإطفاء المرتبطة بالخطة
    fire_equipment: Array.isArray(body.fire_equipment) ? body.fire_equipment.map(f => ({
      id: newId('FE'),
      type: f.type,
      location: f.location || null,
      status: f.status && FIRE_EQUIPMENT_STATUSES.includes(f.status) ? f.status : 'operational',
      last_inspection_date: f.last_inspection_date || null,
      next_inspection_date: f.next_inspection_date || null,
      expiry_date: f.expiry_date || null,
    })) : [],

    // خطوط الاتصال الخارجية (دفاع مدني، إسعاف، شرطة...)
    external_contacts: Array.isArray(body.external_contacts) ? body.external_contacts.map(c => ({
      id: newId('EC'),
      name: c.name,
      phone: c.phone || null,
      notes: c.notes || null,
    })) : [],

    // إجراءات الاستجابة النصية لكل سيناريو
    response_procedures: body.response_procedures || null,

    version: 1,
    status: 'draft',
    approved_by: null,
    approved_at: null,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.emergencyPlans[id] = record;
  audit(store, { action: 'create', entity: 'emergency_plan', entityId: id, projectId: body.project_id, details: { title: record.title } });
  saveStore(store);
  return { success: true, data: record };
}

function listEmergencyPlans(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.emergencyPlans).filter(p => p.is_active !== false);
  if (filters.projectId) items = items.filter(p => p.project_id === filters.projectId);
  if (filters.status) items = items.filter(p => p.status === filters.status);
  if (filters.scenarioType) items = items.filter(p => (p.scenario_types || []).includes(filters.scenarioType));
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q)
    );
  }
  items = items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return { success: true, data: items, count: items.length };
}

function getEmergencyPlan(id) {
  const store = loadStore();
  const record = store.emergencyPlans[id];
  if (!record) throw new Error('خطة الطوارئ غير موجودة');
  return { success: true, data: record };
}

function updateEmergencyPlan(id, updates) {
  const store = loadStore();
  const record = store.emergencyPlans[id];
  if (!record) throw new Error('خطة الطوارئ غير موجودة');

  if (updates.status && !EMERGENCY_PLAN_STATUSES.includes(updates.status)) {
    throw new Error(`حالة خطة الطوارئ غير صحيحة: ${updates.status}`);
  }
  if (updates.scenario_types) {
    if (!Array.isArray(updates.scenario_types) || updates.scenario_types.length === 0) {
      throw new Error('يجب تحديد سيناريو طوارئ واحد على الأقل');
    }
    for (const s of updates.scenario_types) {
      if (!EMERGENCY_SCENARIO_TYPES.includes(s)) throw new Error(`نوع سيناريو غير صحيح: ${s}`);
    }
  }

  const blocked = ['id', 'code', 'created_at', 'project_id'];
  const arrayFieldsWithIds = {
    teams: 'TEAM', assembly_points: 'AP', emergency_exits: 'EX',
    fire_equipment: 'FE', external_contacts: 'EC',
  };
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    if (arrayFieldsWithIds[k] && Array.isArray(v)) {
      record[k] = v.map(item => ({ ...item, id: item.id || newId(arrayFieldsWithIds[k]) }));
      continue;
    }
    record[k] = v;
  }
  record.updated_at = nowISO();
  record.version = (record.version || 1) + 1;

  audit(store, { action: 'update', entity: 'emergency_plan', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteEmergencyPlan(id) {
  const store = loadStore();
  const record = store.emergencyPlans[id];
  if (!record) throw new Error('خطة الطوارئ غير موجودة');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'emergency_plan', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

function approveEmergencyPlan(id, { approved_by = null } = {}) {
  const store = loadStore();
  const record = store.emergencyPlans[id];
  if (!record) throw new Error('خطة الطوارئ غير موجودة');

  if (!record.teams || record.teams.length === 0) {
    throw new Error('لا يمكن اعتماد خطة الطوارئ دون تعيين فريق طوارئ واحد على الأقل');
  }
  if (!record.assembly_points || record.assembly_points.length === 0) {
    throw new Error('لا يمكن اعتماد خطة الطوارئ دون تحديد نقطة تجمع واحدة على الأقل');
  }

  record.status = 'approved';
  record.approved_by = approved_by;
  record.approved_at = nowISO();
  record.updated_at = nowISO();

  audit(store, { action: 'approve', entity: 'emergency_plan', entityId: id, projectId: record.project_id, details: { approved_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة تمارين وتدريبات الإخلاء (Drills) =====================

function createDrill(body) {
  validateDrillInput(body);
  const store = loadStore();
  const id = newId('DRL');
  const code = generateCode(store, 'DRL');

  const record = {
    id,
    code,
    project_id: body.project_id,
    emergency_plan_id: body.emergency_plan_id || null,
    drill_type: body.drill_type,
    scenario_type: body.scenario_type && EMERGENCY_SCENARIO_TYPES.includes(body.scenario_type) ? body.scenario_type : null,
    scheduled_date: body.scheduled_date,
    conducted_date: null,
    coordinator_name: body.coordinator_name || null,
    target_time_seconds: body.target_time_seconds != null ? Number(body.target_time_seconds) || null : null,
    actual_time_seconds: null,
    total_participants_expected: body.total_participants_expected != null ? Number(body.total_participants_expected) || 0 : 0,
    total_participants_attended: null,
    attendance_rate: null,
    observations: null,
    issues_identified: [],
    corrective_actions: [],
    result: 'not_evaluated',
    result_label: 'لم يُقيَّم بعد',
    status: 'scheduled',
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.emergencyDrills[id] = record;
  audit(store, { action: 'create', entity: 'drill', entityId: id, projectId: body.project_id, details: { drill_type: record.drill_type } });
  saveStore(store);
  return { success: true, data: record };
}

function listDrills(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.emergencyDrills);
  if (filters.projectId) items = items.filter(d => d.project_id === filters.projectId);
  if (filters.drillType) items = items.filter(d => d.drill_type === filters.drillType);
  if (filters.status) items = items.filter(d => d.status === filters.status);
  if (filters.dateFrom) items = items.filter(d => d.scheduled_date >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(d => d.scheduled_date <= filters.dateTo);
  items = items.sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''));
  return { success: true, data: items, count: items.length };
}

function getDrill(id) {
  const store = loadStore();
  const record = store.emergencyDrills[id];
  if (!record) throw new Error('التمرين غير موجود');
  return { success: true, data: record };
}

function updateDrill(id, updates) {
  const store = loadStore();
  const record = store.emergencyDrills[id];
  if (!record) throw new Error('التمرين غير موجود');

  if (updates.drill_type && !DRILL_TYPES.includes(updates.drill_type)) throw new Error('نوع التمرين غير صحيح');
  if (updates.status && !DRILL_STATUSES.includes(updates.status)) throw new Error('حالة التمرين غير صحيحة');

  const blocked = ['id', 'code', 'created_at', 'project_id'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();
  saveStore(store);
  audit(store, { action: 'update', entity: 'drill', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  return { success: true, data: record };
}

function deleteDrill(id) {
  const store = loadStore();
  const record = store.emergencyDrills[id];
  if (!record) throw new Error('التمرين غير موجود');
  delete store.emergencyDrills[id];
  audit(store, { action: 'delete', entity: 'drill', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// إتمام التمرين فعلياً وحساب النتيجة تلقائياً
function completeDrill(id, body) {
  const store = loadStore();
  const record = store.emergencyDrills[id];
  if (!record) throw new Error('التمرين غير موجود');
  if (!body || body.actual_time_seconds == null) throw new Error('الزمن الفعلي للإخلاء (actual_time_seconds) مطلوب لإتمام التمرين');
  if (body.total_participants_attended == null) throw new Error('عدد الحضور الفعلي (total_participants_attended) مطلوب');

  const actualTime = Number(body.actual_time_seconds) || 0;
  const attended = Number(body.total_participants_attended) || 0;
  const expected = record.total_participants_expected || attended || 1;
  const attendanceRate = r2((attended / expected) * 100);

  const classification = classifyDrillResult({
    targetTimeSeconds: record.target_time_seconds,
    actualTimeSeconds: actualTime,
    attendanceRate,
  });

  record.conducted_date = body.conducted_date || nowISO();
  record.actual_time_seconds = actualTime;
  record.total_participants_attended = attended;
  record.attendance_rate = attendanceRate;
  record.observations = body.observations || null;
  record.issues_identified = Array.isArray(body.issues_identified) ? body.issues_identified : [];
  record.corrective_actions = Array.isArray(body.corrective_actions) ? body.corrective_actions.map(a => ({
    id: newId('CA'),
    description: a.description || a,
    responsible_person: a.responsible_person || null,
    due_date: a.due_date || null,
    status: a.status || 'pending',
  })) : [];
  record.result = classification.result;
  record.result_label = classification.label;
  record.status = 'completed';
  record.updated_at = nowISO();

  audit(store, {
    action: 'complete', entity: 'drill', entityId: id, projectId: record.project_id,
    details: { result: record.result, actualTime, attendanceRate },
  });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== سجلات الطوارئ الفعلية (Activation Log) =====================

function createActivation(body) {
  validateActivationInput(body);
  const store = loadStore();
  const id = newId('ACT');
  const code = generateCode(store, 'ACT');

  const record = {
    id,
    code,
    project_id: body.project_id,
    emergency_plan_id: body.emergency_plan_id || null,
    scenario_type: body.scenario_type,
    location: String(body.location).trim(),
    description: body.description || null,

    reported_at: body.reported_at,
    reported_by: body.reported_by || null,
    response_started_at: body.response_started_at || null,
    contained_at: null,
    closed_at: null,

    team_activated: Array.isArray(body.team_activated) ? body.team_activated : [],
    actions_taken: Array.isArray(body.actions_taken) ? body.actions_taken.map(a => ({
      id: newId('AT'),
      time: a.time || nowISO(),
      description: a.description || a,
      by: a.by || null,
    })) : [],
    external_services_involved: Array.isArray(body.external_services_involved) ? body.external_services_involved : [],
    casualties: body.casualties != null ? Number(body.casualties) || 0 : 0,
    linked_incident_id: body.linked_incident_id || null,

    response_evaluation_rating: null,
    response_evaluation_notes: null,
    lessons_learned: null,

    status: 'reported',
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.emergencyActivations[id] = record;
  audit(store, { action: 'create', entity: 'activation', entityId: id, projectId: body.project_id, details: { scenario_type: record.scenario_type } });
  saveStore(store);
  return { success: true, data: record };
}

function listActivations(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.emergencyActivations).filter(a => a.is_active !== false);
  if (filters.projectId) items = items.filter(a => a.project_id === filters.projectId);
  if (filters.scenarioType) items = items.filter(a => a.scenario_type === filters.scenarioType);
  if (filters.status) items = items.filter(a => a.status === filters.status);
  if (filters.dateFrom) items = items.filter(a => a.reported_at >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(a => a.reported_at <= filters.dateTo);
  items = items.sort((a, b) => (b.reported_at || '').localeCompare(a.reported_at || ''));
  return { success: true, data: items, count: items.length };
}

function getActivation(id) {
  const store = loadStore();
  const record = store.emergencyActivations[id];
  if (!record) throw new Error('سجل الطوارئ غير موجود');
  return { success: true, data: record };
}

function updateActivation(id, updates) {
  const store = loadStore();
  const record = store.emergencyActivations[id];
  if (!record) throw new Error('سجل الطوارئ غير موجود');

  if (updates.status && !ACTIVATION_STATUSES.includes(updates.status)) throw new Error('حالة سجل الطوارئ غير صحيحة');

  // لا يمكن إغلاق السجل دون تقييم استجابة فعلي
  if (updates.status === 'closed' && record.status !== 'closed') {
    const rating = updates.response_evaluation_rating !== undefined ? updates.response_evaluation_rating : record.response_evaluation_rating;
    if (!rating || !RESPONSE_EVALUATION_RATINGS.includes(rating)) {
      throw new Error('لا يمكن إغلاق سجل الطوارئ دون تقييم فعلي للاستجابة (response_evaluation_rating)');
    }
  }

  const blocked = ['id', 'code', 'created_at', 'project_id'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    if (k === 'actions_taken' && Array.isArray(v)) {
      record.actions_taken = v.map(a => ({
        id: a.id || newId('AT'),
        time: a.time || nowISO(),
        description: a.description || a,
        by: a.by || null,
      }));
      continue;
    }
    record[k] = v;
  }

  if (updates.status === 'contained' && !record.contained_at) record.contained_at = nowISO();
  if (updates.status === 'closed' && !record.closed_at) record.closed_at = nowISO();
  record.updated_at = nowISO();

  audit(store, { action: 'update', entity: 'activation', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates), newStatus: record.status } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteActivation(id) {
  const store = loadStore();
  const record = store.emergencyActivations[id];
  if (!record) throw new Error('سجل الطوارئ غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'activation', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ===================== لوحة تحكم إدارة الطوارئ =====================

function getEmergencyDashboard(projectId = null) {
  const store = loadStore();
  let plans = Object.values(store.emergencyPlans).filter(p => p.is_active !== false);
  let drills = Object.values(store.emergencyDrills);
  let activations = Object.values(store.emergencyActivations).filter(a => a.is_active !== false);

  if (projectId) {
    plans = plans.filter(p => p.project_id === projectId);
    drills = drills.filter(d => d.project_id === projectId);
    activations = activations.filter(a => a.project_id === projectId);
  }

  const approvedPlans = plans.filter(p => p.status === 'approved').length;
  const completedDrills = drills.filter(d => d.status === 'completed');
  const passedDrills = completedDrills.filter(d => d.result === 'passed').length;
  const drillPassRate = completedDrills.length > 0 ? r2((passedDrills / completedDrills.length) * 100) : null;

  const avgEvacuationTime = completedDrills.length > 0
    ? r2(completedDrills.reduce((s, d) => s + (d.actual_time_seconds || 0), 0) / completedDrills.length)
    : null;

  // معدات الإطفاء المجمّعة من كل الخطط
  const allFireEquipment = plans.flatMap(p => p.fire_equipment || []);
  const fireEquipmentByStatus = {};
  for (const s of FIRE_EQUIPMENT_STATUSES) {
    fireEquipmentByStatus[s] = allFireEquipment.filter(f => f.status === s).length;
  }

  const openActivations = activations.filter(a => a.status !== 'closed').length;
  const upcomingDrills = drills
    .filter(d => d.status === 'scheduled')
    .sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''))
    .slice(0, 5);

  return {
    success: true,
    data: {
      total_emergency_plans: plans.length,
      approved_emergency_plans: approvedPlans,
      total_drills: drills.length,
      completed_drills: completedDrills.length,
      drill_pass_rate_percent: drillPassRate,
      average_evacuation_time_seconds: avgEvacuationTime,
      total_activations: activations.length,
      open_activations: openActivations,
      fire_equipment_total: allFireEquipment.length,
      fire_equipment_by_status: fireEquipmentByStatus,
      upcoming_drills: upcomingDrills,
      recent_activations: activations.slice(0, 5),
    },
  };
}

module.exports = {
  // ثوابت
  EMERGENCY_SCENARIO_TYPES,
  EMERGENCY_SCENARIO_TYPE_LABELS,
  EMERGENCY_PLAN_STATUSES,
  EMERGENCY_PLAN_STATUS_LABELS,
  EMERGENCY_TEAM_ROLES,
  EMERGENCY_TEAM_ROLE_LABELS,
  FIRE_EQUIPMENT_TYPES,
  FIRE_EQUIPMENT_TYPE_LABELS,
  FIRE_EQUIPMENT_STATUSES,
  FIRE_EQUIPMENT_STATUS_LABELS,
  DRILL_TYPES,
  DRILL_TYPE_LABELS,
  DRILL_STATUSES,
  DRILL_STATUS_LABELS,
  ACTIVATION_STATUSES,
  ACTIVATION_STATUS_LABELS,
  RESPONSE_EVALUATION_RATINGS,
  RESPONSE_EVALUATION_RATING_LABELS,

  // خطط الطوارئ
  createEmergencyPlan,
  listEmergencyPlans,
  getEmergencyPlan,
  updateEmergencyPlan,
  deleteEmergencyPlan,
  approveEmergencyPlan,

  // تمارين وتدريبات الإخلاء
  createDrill,
  listDrills,
  getDrill,
  updateDrill,
  deleteDrill,
  completeDrill,

  // سجلات الطوارئ الفعلية
  createActivation,
  listActivations,
  getActivation,
  updateActivation,
  deleteActivation,

  // لوحة التحكم
  getEmergencyDashboard,
};
