/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * وحدة إدارة معدات مكافحة الحريق (Fire Fighting Equipment Management)
 * =====================================================================================
 * تشمل: طفايات الحريق، خراطيم الإطفاء، أنظمة الإنذار، أجهزة كشف الدخان،
 * مخارج الطوارئ، أنظمة الرش الآلي (Sprinklers) — مع متابعة الصيانة الدورية،
 * الفحص الدوري، تواريخ الانتهاء (الصلاحية/إعادة التعبئة)، ومواقع المعدات.
 *
 * التخزين: ملف JSON منفصل (backend/data/hseFireSafety.json) بنفس نمط
 * hseManagement.js / hseEmergency.js / hseTraining.js / hseHazmat.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 45001، NFPA (المعايير المرجعية لطفايات الحريق وأنظمة
 * الإنذار والرش الآلي)، بما يشمل دورية الفحص الشهري/السنوي وإعادة التعبئة/الفحص
 * الهيدروستاتيكي لطفايات الحريق.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل معدة (fireEquipmentItem) لها نوع فعلي (طفاية/خرطوم/نظام إنذار/كاشف
 *    دخان/مخرج طوارئ/رشاش آلي) مع حقول خاصة بكل نوع (مثال: نوع عامل الإطفاء
 *    ووزنه للطفايات، ضغط التشغيل للخراطيم والرشاشات).
 *  - سجل فحص دوري (inspection) فعلي لكل معدة يُحدّث تلقائياً تاريخ آخر فحص
 *    وتاريخ الفحص القادم بناءً على دورية الفحص المحددة (شهري/ربع سنوي/سنوي).
 *  - سجل صيانة/أعطال (maintenance) فعلي يُسجّل الأعطال المكتشفة والإجراء
 *    التصحيحي وتاريخ الإغلاق، مع تحديث حالة المعدة تلقائياً (خارج الخدمة
 *    أثناء وجود عطل مفتوح).
 *  - حساب حالة المعدة تلقائياً بناءً على: تاريخ انتهاء الصلاحية/إعادة التعبئة،
 *    تاريخ الفحص القادم، ووجود أعطال مفتوحة - وليست قيمة يدوية ثابتة.
 *  - تنبيهات فعلية: معدات قاربت انتهاء الصلاحية، فحص دوري مستحق، أعطال مفتوحة.
 *  - جميع العمليات تُسجَّل في سجل تدقيق (Audit Log) منفصل لهذه الوحدة.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hseFireSafety.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }
function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      fireEquipmentItems: {}, // { id: itemRecord } (المعدة + الموقع + دورية الفحص + الانتهاء)
      fireInspections: {},    // { id: inspectionRecord } (سجل فحص دوري لمعدة)
      fireMaintenance: {},    // { id: maintenanceRecord } (سجل صيانة/عطل)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة معدات مكافحة الحريق: ' + e.message);
  }
  let migrated = false;
  for (const key of ['fireEquipmentItems', 'fireInspections', 'fireMaintenance']) {
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

const EQUIPMENT_TYPES = [
  'fire_extinguisher', 'fire_hose', 'alarm_system', 'smoke_detector',
  'emergency_exit', 'sprinkler_system',
];
const EQUIPMENT_TYPE_LABELS = {
  fire_extinguisher: 'طفاية حريق',
  fire_hose: 'خرطوم إطفاء',
  alarm_system: 'نظام إنذار',
  smoke_detector: 'كاشف دخان',
  emergency_exit: 'مخرج طوارئ',
  sprinkler_system: 'نظام رش آلي (Sprinkler)',
};

const EXTINGUISHER_AGENT_TYPES = ['powder_abc', 'co2', 'foam', 'water', 'wet_chemical', 'clean_agent'];
const EXTINGUISHER_AGENT_TYPE_LABELS = {
  powder_abc: 'بودرة جافة (ABC)',
  co2: 'ثاني أكسيد الكربون (CO2)',
  foam: 'رغوي (Foam)',
  water: 'مائي (Water)',
  wet_chemical: 'كيميائي رطب (Wet Chemical)',
  clean_agent: 'عامل نظيف (Clean Agent)',
};

const INSPECTION_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual'];
const INSPECTION_FREQUENCY_LABELS = {
  monthly: 'شهرياً',
  quarterly: 'ربع سنوي',
  semi_annual: 'نصف سنوي',
  annual: 'سنوياً',
};
const INSPECTION_FREQUENCY_DAYS = {
  monthly: 30,
  quarterly: 90,
  semi_annual: 182,
  annual: 365,
};

const EQUIPMENT_STATUSES = ['active', 'due_for_inspection', 'expired', 'out_of_service', 'decommissioned'];
const EQUIPMENT_STATUS_LABELS = {
  active: 'نشطة (سليمة)',
  due_for_inspection: 'مستحقة الفحص الدوري',
  expired: 'منتهية الصلاحية/إعادة التعبئة',
  out_of_service: 'خارج الخدمة (عطل مفتوح)',
  decommissioned: 'موقوفة نهائياً',
};

const INSPECTION_RESULTS = ['pass', 'fail', 'pass_with_notes'];
const INSPECTION_RESULT_LABELS = {
  pass: 'سليمة',
  fail: 'غير سليمة (رسوب)',
  pass_with_notes: 'سليمة مع ملاحظات',
};

const MAINTENANCE_TYPES = ['scheduled_maintenance', 'refill', 'repair', 'replacement', 'hydrostatic_test'];
const MAINTENANCE_TYPE_LABELS = {
  scheduled_maintenance: 'صيانة دورية مجدولة',
  refill: 'إعادة تعبئة',
  repair: 'إصلاح عطل',
  replacement: 'استبدال المعدة',
  hydrostatic_test: 'فحص هيدروستاتيكي',
};

const MAINTENANCE_STATUSES = ['open', 'in_progress', 'closed'];
const MAINTENANCE_STATUS_LABELS = {
  open: 'مفتوح',
  in_progress: 'قيد التنفيذ',
  closed: 'مغلق',
};

const LOCATIONS_HINT = ['building', 'floor', 'zone']; // للتوثيق فقط - حقول نصية حرة

// ===================== دوال مساعدة للحسابات =====================

/** تاريخ الفحص القادم المحسوب فعلياً من آخر فحص + دورية الفحص المحددة للمعدة */
function computeNextInspectionDate(item) {
  const freqDays = INSPECTION_FREQUENCY_DAYS[item.inspection_frequency] || 90;
  const base = item.last_inspection_date || item.installation_date || new Date().toISOString().slice(0, 10);
  const baseDate = new Date(base);
  baseDate.setDate(baseDate.getDate() + freqDays);
  return baseDate.toISOString().slice(0, 10);
}

function hasOpenMaintenance(store, itemId) {
  return Object.values(store.fireMaintenance).some((m) => m.item_id === itemId && m.status !== 'closed');
}

function computeEquipmentStatus(store, item) {
  if (item.status === 'decommissioned') return 'decommissioned';
  if (hasOpenMaintenance(store, item.id)) return 'out_of_service';

  const today = new Date().toISOString().slice(0, 10);
  if (item.expiry_date) {
    const daysToExpiry = daysBetween(item.expiry_date, today) * -1;
    if (daysToExpiry <= 0) return 'expired';
  }

  const nextInspection = item.next_inspection_date || computeNextInspectionDate(item);
  const daysToInspection = daysBetween(nextInspection, today) * -1;
  if (daysToInspection <= 0) return 'due_for_inspection';

  return 'active';
}

function enrichItem(store, item) {
  const nextInspection = item.next_inspection_date || computeNextInspectionDate(item);
  const status = computeEquipmentStatus(store, { ...item, next_inspection_date: nextInspection });
  const today = new Date().toISOString().slice(0, 10);
  const openFaults = Object.values(store.fireMaintenance).filter((m) => m.item_id === item.id && m.status !== 'closed');
  return {
    ...item,
    next_inspection_date: nextInspection,
    days_until_inspection: item.expiry_date ? daysBetween(nextInspection, today) * -1 : daysBetween(nextInspection, today) * -1,
    days_until_expiry: item.expiry_date ? daysBetween(item.expiry_date, today) * -1 : null,
    computed_status: status,
    computed_status_label: EQUIPMENT_STATUS_LABELS[status],
    open_faults_count: openFaults.length,
  };
}

// ===================== التحقق من صحة المدخلات =====================

function validateEquipmentInput(body) {
  const errors = [];
  if (!body.equipment_type) errors.push('نوع المعدة مطلوب');
  if (body.equipment_type && !EQUIPMENT_TYPES.includes(body.equipment_type)) errors.push('نوع المعدة غير صالح');
  if (!body.location_building || !String(body.location_building).trim()) errors.push('موقع المعدة (المبنى) مطلوب');
  if (!body.inspection_frequency) errors.push('دورية الفحص الدوري مطلوبة');
  if (body.inspection_frequency && !INSPECTION_FREQUENCIES.includes(body.inspection_frequency)) errors.push('دورية الفحص غير صالحة');
  if (body.equipment_type === 'fire_extinguisher') {
    if (!body.agent_type) errors.push('نوع عامل الإطفاء مطلوب لطفايات الحريق');
    if (body.agent_type && !EXTINGUISHER_AGENT_TYPES.includes(body.agent_type)) errors.push('نوع عامل الإطفاء غير صالح');
  }
  return errors;
}

function validateInspectionInput(body) {
  const errors = [];
  if (!body.item_id) errors.push('معرّف المعدة (item_id) مطلوب');
  if (!body.inspection_date) errors.push('تاريخ الفحص مطلوب');
  if (!body.result || !INSPECTION_RESULTS.includes(body.result)) errors.push('نتيجة الفحص غير صالحة');
  return errors;
}

function validateMaintenanceInput(body) {
  const errors = [];
  if (!body.item_id) errors.push('معرّف المعدة (item_id) مطلوب');
  if (!body.type || !MAINTENANCE_TYPES.includes(body.type)) errors.push('نوع الصيانة غير صالح');
  if (!body.fault_description || !String(body.fault_description).trim()) errors.push('وصف العطل/الصيانة مطلوب');
  return errors;
}

// ===================== إدارة معدات مكافحة الحريق (CRUD) =====================

function createFireEquipment(body) {
  const errors = validateEquipmentInput(body);
  if (errors.length) throw new Error(errors.join(' | '));
  const store = loadStore();
  const id = newId('FEQ');
  const code = generateCode(store, 'FEQ');
  const record = {
    id,
    code,
    project_id: body.project_id || null,
    equipment_type: body.equipment_type,

    // خاص بطفايات الحريق
    agent_type: body.equipment_type === 'fire_extinguisher'
      ? (EXTINGUISHER_AGENT_TYPES.includes(body.agent_type) ? body.agent_type : null)
      : null,
    weight_capacity_kg: body.weight_capacity_kg != null ? Number(body.weight_capacity_kg) : null,

    // خاص بالخراطيم وأنظمة الرش الآلي
    operating_pressure_bar: body.operating_pressure_bar != null ? Number(body.operating_pressure_bar) : null,
    hose_length_m: body.hose_length_m != null ? Number(body.hose_length_m) : null,

    // خاص بأنظمة الإنذار وكاشفات الدخان
    detector_type: body.detector_type || null,
    coverage_zone: body.coverage_zone || null,

    // خاص بمخارج الطوارئ
    exit_capacity_persons: body.exit_capacity_persons != null ? Number(body.exit_capacity_persons) : null,
    exit_signage_illuminated: body.exit_signage_illuminated != null ? !!body.exit_signage_illuminated : null,

    // الموقع
    location_building: String(body.location_building).trim(),
    location_floor: body.location_floor || null,
    location_zone: body.location_zone || null,
    location_notes: body.location_notes || null,

    // الفحص الدوري والصلاحية
    installation_date: body.installation_date || null,
    inspection_frequency: body.inspection_frequency,
    last_inspection_date: body.last_inspection_date || null,
    next_inspection_date: body.next_inspection_date || null,
    expiry_date: body.expiry_date || null, // انتهاء الصلاحية أو موعد إعادة التعبئة/الفحص الهيدروستاتيكي
    manufacturer: body.manufacturer || null,
    serial_number: body.serial_number || null,

    status: 'active', // حالة يدوية (نشطة/موقوفة نهائياً)؛ الحالة الفعلية تُحسب في computed_status
    notes: body.notes || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  if (!record.next_inspection_date) {
    record.next_inspection_date = computeNextInspectionDate(record);
  }
  store.fireEquipmentItems[id] = record;
  audit(store, { action: 'create', entity: 'fireEquipmentItem', entityId: id, projectId: record.project_id, details: { equipment_type: record.equipment_type, code } });
  saveStore(store);
  return { success: true, data: enrichItem(store, record) };
}

function listFireEquipment(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.fireEquipmentItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  if (filters.equipmentType) items = items.filter((i) => i.equipment_type === filters.equipmentType);
  if (filters.locationBuilding) items = items.filter((i) => (i.location_building || '').includes(filters.locationBuilding));
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    items = items.filter((i) =>
      (i.code || '').toLowerCase().includes(q) ||
      (i.serial_number || '').toLowerCase().includes(q) ||
      (i.location_building || '').toLowerCase().includes(q) ||
      (i.manufacturer || '').toLowerCase().includes(q));
  }
  let enriched = items.map((i) => enrichItem(store, i));
  if (filters.status) enriched = enriched.filter((i) => i.computed_status === filters.status);
  enriched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: enriched, total: enriched.length };
}

function getFireEquipment(id) {
  const store = loadStore();
  const item = store.fireEquipmentItems[id];
  if (!item) throw new Error('معدة مكافحة الحريق غير موجودة');
  const inspections = Object.values(store.fireInspections)
    .filter((ins) => ins.item_id === id)
    .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date));
  const maintenance = Object.values(store.fireMaintenance)
    .filter((m) => m.item_id === id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: { ...enrichItem(store, item), inspections, maintenance } };
}

function updateFireEquipment(id, updates) {
  const store = loadStore();
  const item = store.fireEquipmentItems[id];
  if (!item) throw new Error('معدة مكافحة الحريق غير موجودة');
  const merged = { ...item, ...updates, id: item.id, code: item.code };
  const errors = validateEquipmentInput(merged);
  if (errors.length) throw new Error(errors.join(' | '));
  merged.updated_at = nowISO();
  store.fireEquipmentItems[id] = merged;
  audit(store, { action: 'update', entity: 'fireEquipmentItem', entityId: id, projectId: merged.project_id, details: { fields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: enrichItem(store, merged) };
}

function deleteFireEquipment(id) {
  const store = loadStore();
  const item = store.fireEquipmentItems[id];
  if (!item) throw new Error('معدة مكافحة الحريق غير موجودة');
  const hasHistory = Object.values(store.fireInspections).some((ins) => ins.item_id === id) ||
    Object.values(store.fireMaintenance).some((m) => m.item_id === id);
  if (hasHistory) throw new Error('لا يمكن حذف معدة لها سجل فحص أو صيانة؛ يمكن إيقافها (decommissioned) بدلاً من الحذف');
  delete store.fireEquipmentItems[id];
  audit(store, { action: 'delete', entity: 'fireEquipmentItem', entityId: id, projectId: item.project_id, details: { equipment_type: item.equipment_type, code: item.code } });
  saveStore(store);
  return { success: true };
}

// ===================== سجل الفحص الدوري =====================

function createInspection(body) {
  const errors = validateInspectionInput(body);
  if (errors.length) throw new Error(errors.join(' | '));
  const store = loadStore();
  const item = store.fireEquipmentItems[body.item_id];
  if (!item) throw new Error('معدة مكافحة الحريق غير موجودة');

  const id = newId('FINS');
  const record = {
    id,
    item_id: body.item_id,
    project_id: body.project_id || item.project_id || null,
    inspection_date: body.inspection_date,
    inspector_name: body.inspector_name || null,
    result: body.result,
    notes: body.notes || null,
    photo_ref: body.photo_ref || null,
    created_at: nowISO(),
  };
  store.fireInspections[id] = record;

  // تحديث تاريخ آخر فحص وتاريخ الفحص القادم تلقائياً بناءً على دورية الفحص
  const updatedItem = {
    ...item,
    last_inspection_date: body.inspection_date,
    updated_at: nowISO(),
  };
  updatedItem.next_inspection_date = computeNextInspectionDate(updatedItem);
  store.fireEquipmentItems[body.item_id] = updatedItem;

  // فحص راسب (fail) ينشئ تلقائياً سجل صيانة/عطل مفتوح إن لم يُزوَّد واحد يدوياً
  let autoMaintenance = null;
  if (body.result === 'fail') {
    const maintId = newId('FMNT');
    autoMaintenance = {
      id: maintId,
      item_id: body.item_id,
      project_id: record.project_id,
      type: 'repair',
      fault_description: body.notes || 'رسوب في الفحص الدوري - يتطلب صيانة/إصلاح',
      reported_by: body.inspector_name || null,
      status: 'open',
      resolution: null,
      closed_at: null,
      related_inspection_id: id,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    store.fireMaintenance[maintId] = autoMaintenance;
  }

  audit(store, {
    action: 'create',
    entity: 'fireInspection',
    entityId: id,
    projectId: record.project_id,
    details: { itemId: body.item_id, result: body.result },
  });
  saveStore(store);
  return { success: true, data: record, auto_maintenance: autoMaintenance, next_inspection_date: updatedItem.next_inspection_date };
}

function listInspections(filters = {}) {
  const store = loadStore();
  let inspections = Object.values(store.fireInspections);
  if (filters.itemId) inspections = inspections.filter((i) => i.item_id === filters.itemId);
  if (filters.projectId) inspections = inspections.filter((i) => i.project_id === filters.projectId);
  if (filters.result) inspections = inspections.filter((i) => i.result === filters.result);
  if (filters.dateFrom) inspections = inspections.filter((i) => i.inspection_date >= filters.dateFrom);
  if (filters.dateTo) inspections = inspections.filter((i) => i.inspection_date <= filters.dateTo);
  inspections.sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date));
  return { success: true, data: inspections, total: inspections.length };
}

function deleteInspection(id) {
  const store = loadStore();
  const ins = store.fireInspections[id];
  if (!ins) throw new Error('سجل الفحص غير موجود');
  delete store.fireInspections[id];
  const item = store.fireEquipmentItems[ins.item_id];
  if (item) {
    const remaining = Object.values(store.fireInspections)
      .filter((i) => i.item_id === ins.item_id)
      .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date));
    const updatedItem = {
      ...item,
      last_inspection_date: remaining.length ? remaining[0].inspection_date : null,
      updated_at: nowISO(),
    };
    updatedItem.next_inspection_date = computeNextInspectionDate(updatedItem);
    store.fireEquipmentItems[ins.item_id] = updatedItem;
  }
  audit(store, { action: 'delete', entity: 'fireInspection', entityId: id, projectId: ins.project_id, details: { itemId: ins.item_id } });
  saveStore(store);
  return { success: true };
}

// ===================== سجل الصيانة/الأعطال =====================

function createMaintenance(body) {
  const errors = validateMaintenanceInput(body);
  if (errors.length) throw new Error(errors.join(' | '));
  const store = loadStore();
  const item = store.fireEquipmentItems[body.item_id];
  if (!item) throw new Error('معدة مكافحة الحريق غير موجودة');

  const id = newId('FMNT');
  const record = {
    id,
    item_id: body.item_id,
    project_id: body.project_id || item.project_id || null,
    type: body.type,
    fault_description: String(body.fault_description).trim(),
    reported_by: body.reported_by || null,
    status: 'open',
    resolution: null,
    closed_at: null,
    related_inspection_id: body.related_inspection_id || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.fireMaintenance[id] = record;

  // إذا كانت الصيانة من نوع "إعادة تعبئة" أو "استبدال" وزُوّد تاريخ انتهاء صلاحية جديد، حدّثه
  if ((body.type === 'refill' || body.type === 'replacement') && body.new_expiry_date) {
    store.fireEquipmentItems[body.item_id] = { ...item, expiry_date: body.new_expiry_date, updated_at: nowISO() };
  }

  audit(store, { action: 'create', entity: 'fireMaintenance', entityId: id, projectId: record.project_id, details: { itemId: body.item_id, type: body.type } });
  saveStore(store);
  return { success: true, data: record };
}

function updateMaintenance(id, updates) {
  const store = loadStore();
  const record = store.fireMaintenance[id];
  if (!record) throw new Error('سجل الصيانة غير موجود');
  const merged = { ...record, ...updates, id: record.id, item_id: record.item_id };
  if (updates.status && !MAINTENANCE_STATUSES.includes(updates.status)) throw new Error('حالة الصيانة غير صالحة');
  merged.updated_at = nowISO();
  if (updates.status === 'closed' && record.status !== 'closed') {
    merged.closed_at = nowISO();
    if (!merged.resolution || !String(merged.resolution).trim()) {
      throw new Error('وصف الإجراء التصحيحي (resolution) مطلوب عند إغلاق سجل الصيانة');
    }
  }
  store.fireMaintenance[id] = merged;
  audit(store, { action: 'update', entity: 'fireMaintenance', entityId: id, projectId: merged.project_id, details: { fields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: merged };
}

function closeMaintenance(id, { resolution, closed_by = null } = {}) {
  if (!resolution || !String(resolution).trim()) throw new Error('وصف الإجراء التصحيحي (resolution) مطلوب لإغلاق سجل الصيانة');
  return updateMaintenance(id, { status: 'closed', resolution: String(resolution).trim(), closed_by });
}

function listMaintenance(filters = {}) {
  const store = loadStore();
  let records = Object.values(store.fireMaintenance);
  if (filters.itemId) records = records.filter((m) => m.item_id === filters.itemId);
  if (filters.projectId) records = records.filter((m) => m.project_id === filters.projectId);
  if (filters.status) records = records.filter((m) => m.status === filters.status);
  if (filters.type) records = records.filter((m) => m.type === filters.type);
  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: records, total: records.length };
}

function deleteMaintenance(id) {
  const store = loadStore();
  const record = store.fireMaintenance[id];
  if (!record) throw new Error('سجل الصيانة غير موجود');
  delete store.fireMaintenance[id];
  audit(store, { action: 'delete', entity: 'fireMaintenance', entityId: id, projectId: record.project_id, details: { itemId: record.item_id } });
  saveStore(store);
  return { success: true };
}

// ===================== تنبيهات =====================

function getExpiringEquipment(filters = {}) {
  const store = loadStore();
  const withinDays = filters.withinDays != null ? Number(filters.withinDays) : 60;
  let items = Object.values(store.fireEquipmentItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  const today = new Date().toISOString().slice(0, 10);
  const result = items
    .filter((i) => i.expiry_date)
    .map((i) => ({ ...enrichItem(store, i), days_until_expiry: daysBetween(i.expiry_date, today) * -1 }))
    .filter((i) => i.days_until_expiry <= withinDays)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry);
  return { success: true, data: result, total: result.length };
}

function getDueForInspection(filters = {}) {
  const store = loadStore();
  const withinDays = filters.withinDays != null ? Number(filters.withinDays) : 30;
  let items = Object.values(store.fireEquipmentItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  const today = new Date().toISOString().slice(0, 10);
  const result = items
    .map((i) => enrichItem(store, i))
    .map((i) => ({ ...i, days_until_inspection: daysBetween(i.next_inspection_date, today) * -1 }))
    .filter((i) => i.days_until_inspection <= withinDays)
    .sort((a, b) => a.days_until_inspection - b.days_until_inspection);
  return { success: true, data: result, total: result.length };
}

function getOpenFaults(filters = {}) {
  const store = loadStore();
  let records = Object.values(store.fireMaintenance).filter((m) => m.status !== 'closed');
  if (filters.projectId) records = records.filter((m) => m.project_id === filters.projectId);
  records = records.map((m) => ({ ...m, item: store.fireEquipmentItems[m.item_id] || null }));
  records.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { success: true, data: records, total: records.length };
}

// ===================== لوحة المعلومات =====================

function getFireSafetyDashboard(projectId = null) {
  const store = loadStore();
  let items = Object.values(store.fireEquipmentItems);
  if (projectId) items = items.filter((i) => i.project_id === projectId);
  const enriched = items.map((i) => enrichItem(store, i));

  const byType = {};
  for (const t of EQUIPMENT_TYPES) byType[t] = 0;
  for (const i of enriched) byType[i.equipment_type] = (byType[i.equipment_type] || 0) + 1;

  const byStatus = {};
  for (const s of EQUIPMENT_STATUSES) byStatus[s] = 0;
  for (const i of enriched) byStatus[i.computed_status] = (byStatus[i.computed_status] || 0) + 1;

  let maintenance = Object.values(store.fireMaintenance);
  if (projectId) maintenance = maintenance.filter((m) => m.project_id === projectId);
  const openFaults = maintenance.filter((m) => m.status !== 'closed');

  let inspections = Object.values(store.fireInspections);
  if (projectId) inspections = inspections.filter((i) => i.project_id === projectId);
  const recentInspections = inspections.sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date)).slice(0, 10);

  return {
    success: true,
    data: {
      total_equipment: enriched.length,
      active_equipment: enriched.filter((i) => i.computed_status === 'active').length,
      due_for_inspection: enriched.filter((i) => i.computed_status === 'due_for_inspection').length,
      expired_equipment: enriched.filter((i) => i.computed_status === 'expired').length,
      out_of_service_equipment: enriched.filter((i) => i.computed_status === 'out_of_service').length,
      decommissioned_equipment: enriched.filter((i) => i.computed_status === 'decommissioned').length,
      open_faults_count: openFaults.length,
      total_inspections: inspections.length,
      inspections_failed: inspections.filter((i) => i.result === 'fail').length,
      by_type: byType,
      by_status: byStatus,
      recent_inspections: recentInspections,
    },
  };
}

// ===================== التصدير =====================

module.exports = {
  EQUIPMENT_TYPES,
  EQUIPMENT_TYPE_LABELS,
  EXTINGUISHER_AGENT_TYPES,
  EXTINGUISHER_AGENT_TYPE_LABELS,
  INSPECTION_FREQUENCIES,
  INSPECTION_FREQUENCY_LABELS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  INSPECTION_RESULTS,
  INSPECTION_RESULT_LABELS,
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,

  createFireEquipment,
  listFireEquipment,
  getFireEquipment,
  updateFireEquipment,
  deleteFireEquipment,

  createInspection,
  listInspections,
  deleteInspection,

  createMaintenance,
  updateMaintenance,
  closeMaintenance,
  listMaintenance,
  deleteMaintenance,

  getExpiringEquipment,
  getDueForInspection,
  getOpenFaults,

  getFireSafetyDashboard,
};
