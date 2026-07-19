/**
 * القسم السابع - نظام إدارة المعدات (Equipment & Assets Management System)
 * =========================================================================
 * الجزء الأول من أربعة: البنية الأساسية + سجل المعدات + إدارة التشغيل +
 * إدارة الحجز + تتبع المعدات.
 * التخزين: ملف JSON على القرص (backend/data/equipment.json) بنفس نمط
 * scheduling.js / projectManagement.js - بدون تبعيات خارجية.
 *
 * الأجزاء اللاحقة (ستُبنى في ملفات/تحديثات منفصلة على نفس هذا الملف):
 *  - الجزء الثاني: الوقود + الصيانة (الدورية والطارئة) + قطع الغيار + المشغلون
 *  - الجزء الثالث: التكاليف + الإنتاجية + التنبيهات
 *  - الجزء الرابع: التقارير + الذكاء الاصطناعي + التكامل + الصلاحيات المتقدمة
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'equipment.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      equipment: {},        // { id: equipmentRecord }
      operationLogs: {},    // { id: operationLog }  (بداية/نهاية تشغيل)
      reservations: {},     // { id: reservation }
      movementLogs: {},     // { id: movementLog }   (سجل تنقل/تتبع)
      auditLog: [],
      seq: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات إدارة المعدات: ' + e.message);
  }
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, details });
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

// ===================== ثوابت =====================

// أنواع المعدات مصنّفة حسب الفئات المذكورة في متطلبات القسم السابع
const EQUIPMENT_CATEGORIES = {
  excavation: {
    label: 'معدات الحفر',
    types: ['excavator', 'backhoe_loader', 'bulldozer', 'wheel_loader'],
  },
  lifting: {
    label: 'معدات الرفع',
    types: ['tower_crane', 'mobile_crane', 'hoist', 'temporary_elevator'],
  },
  concrete: {
    label: 'معدات الخرسانة',
    types: ['concrete_pump', 'concrete_mixer', 'transit_mixer_truck', 'concrete_vibrator'],
  },
  roadworks: {
    label: 'معدات الطرق',
    types: ['road_roller', 'asphalt_paver', 'paving_machine', 'line_marking_machine'],
  },
  transport: {
    label: 'معدات النقل',
    types: ['truck', 'dump_truck', 'transport_vehicle', 'trailer'],
  },
  power_electrical: {
    label: 'معدات الكهرباء والطاقة',
    types: ['generator', 'air_compressor', 'transformer', 'temporary_distribution_board'],
  },
  workshop: {
    label: 'معدات الورش',
    types: ['welding_machine', 'cutting_machine', 'bending_machine', 'carpentry_equipment', 'blacksmith_equipment'],
  },
  safety: {
    label: 'معدات السلامة',
    types: ['scaffolding', 'work_platform', 'protection_system', 'rescue_equipment'],
  },
};

const EQUIPMENT_TYPE_LABELS = {
  excavator: 'حفارة', backhoe_loader: 'شيول', bulldozer: 'جرافة', wheel_loader: 'لودر',
  tower_crane: 'رافعة برجية', mobile_crane: 'رافعة متحركة', hoist: 'ونش', temporary_elevator: 'مصعد مؤقت',
  concrete_pump: 'مضخة خرسانة', concrete_mixer: 'خلاطة', transit_mixer_truck: 'سيارة نقل خرسانة', concrete_vibrator: 'هزاز خرسانة',
  road_roller: 'مدحلة', asphalt_paver: 'فرادة أسفلت', paving_machine: 'ماكينة رصف', line_marking_machine: 'معدات تخطيط',
  truck: 'شاحنة', dump_truck: 'قلاب', transport_vehicle: 'سيارة نقل', trailer: 'مقطورة',
  generator: 'مولد', air_compressor: 'ضاغط', transformer: 'محول', temporary_distribution_board: 'لوحة توزيع مؤقتة',
  welding_machine: 'ماكينة لحام', cutting_machine: 'جهاز قص', bending_machine: 'جهاز ثني',
  carpentry_equipment: 'معدات نجارة', blacksmith_equipment: 'معدات حدادة',
  scaffolding: 'سقالة', work_platform: 'منصة عمل', protection_system: 'نظام حماية', rescue_equipment: 'معدات إنقاذ',
};

const EQUIPMENT_STATUSES = ['available', 'working', 'stopped', 'under_maintenance', 'reserved', 'out_of_service'];
const EQUIPMENT_STATUS_LABELS = {
  available: 'متاحة', working: 'عاملة', stopped: 'متوقفة',
  under_maintenance: 'تحت الصيانة', reserved: 'محجوزة', out_of_service: 'خارج الخدمة',
};

const OWNERSHIP_TYPES = ['owned', 'rented', 'leased'];
const FUEL_TYPES = ['diesel', 'gasoline', 'electric', 'hybrid', 'none'];

const EQUIPMENT_ROLES = [
  'system_admin', 'project_manager', 'equipment_manager', 'site_engineer',
  'maintenance_officer', 'warehouse_keeper', 'operator', 'accountant', 'client_viewer',
];

// ===================== دوال مساعدة للتحقق =====================

function validateEquipmentInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات المعدة مطلوبة');
  if (!body.name || !String(body.name).trim()) throw new Error('اسم المعدة مطلوب');
  if (!body.type) throw new Error('نوع المعدة مطلوب');
  if (!EQUIPMENT_TYPE_LABELS[body.type]) throw new Error(`نوع المعدة غير معروف: ${body.type}`);
  if (body.status && !EQUIPMENT_STATUSES.includes(body.status)) {
    throw new Error(`حالة المعدة غير صحيحة: ${body.status}`);
  }
  if (body.ownership && !OWNERSHIP_TYPES.includes(body.ownership)) {
    throw new Error(`نوع الملكية غير صحيح: ${body.ownership}`);
  }
}

function categoryOfType(type) {
  for (const [catKey, cat] of Object.entries(EQUIPMENT_CATEGORIES)) {
    if (cat.types.includes(type)) return catKey;
  }
  return null;
}

function generateEquipmentCode(store, category) {
  store.seq = (store.seq || 0) + 1;
  const prefix = (category || 'EQP').slice(0, 3).toUpperCase();
  return `${prefix}-${String(store.seq).padStart(5, '0')}`;
}

// ===================== سجل المعدات (CRUD) =====================

function createEquipment(body) {
  validateEquipmentInput(body);
  const store = loadStore();
  const id = newId('EQP');
  const category = body.category || categoryOfType(body.type);
  const code = body.code && String(body.code).trim() ? String(body.code).trim() : generateEquipmentCode(store, category);

  // منع تكرار رقم المعدة/الكود
  const duplicate = Object.values(store.equipment).find(e => e.code === code);
  if (duplicate) throw new Error(`رقم المعدة (${code}) مستخدم مسبقاً`);

  const record = {
    id,
    code,
    name: String(body.name).trim(),
    type: body.type,
    category,
    manufacturer: body.manufacturer || null,
    model: body.model || null,
    manufacture_year: body.manufacture_year || null,
    serial_number: body.serial_number || null,
    chassis_number: body.chassis_number || null,
    engine_number: body.engine_number || null,
    color: body.color || null,
    weight_kg: body.weight_kg != null ? r2(body.weight_kg) : null,
    load_capacity: body.load_capacity != null ? r2(body.load_capacity) : null,
    operating_power: body.operating_power || null,
    tank_capacity_l: body.tank_capacity_l != null ? r2(body.tank_capacity_l) : null,
    fuel_type: body.fuel_type && FUEL_TYPES.includes(body.fuel_type) ? body.fuel_type : 'diesel',
    avg_fuel_consumption: body.avg_fuel_consumption != null ? r2(body.avg_fuel_consumption) : null,

    // الموقع والحالة التشغيلية
    current_location: body.current_location || null,
    current_project_id: body.current_project_id || null,
    responsible_person: body.responsible_person || null,
    status: body.status || 'available',

    // الملكية والمالية
    ownership: body.ownership && OWNERSHIP_TYPES.includes(body.ownership) ? body.ownership : 'owned',
    purchase_date: body.purchase_date || null,
    purchase_price: body.purchase_price != null ? r2(body.purchase_price) : null,
    useful_life_years: body.useful_life_years || null,
    depreciation_value: body.depreciation_value != null ? r2(body.depreciation_value) : 0,
    warranty_expiry: body.warranty_expiry || null,
    insurance_expiry: body.insurance_expiry || null,
    rental_cost_per_hour: body.rental_cost_per_hour != null ? r2(body.rental_cost_per_hour) : null,

    // مرفقات
    documents: Array.isArray(body.documents) ? body.documents : [],
    photos: Array.isArray(body.photos) ? body.photos : [],

    // عدادات تشغيل تراكمية (تُحدَّث تلقائياً من إدارة التشغيل)
    total_operating_hours: 0,
    total_working_days: 0,
    last_operation_at: null,

    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.equipment[id] = record;
  audit(store, { action: 'create', entity: 'equipment', entityId: id, details: { code: record.code, name: record.name } });
  saveStore(store);
  return { success: true, data: record };
}

function listEquipment(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.equipment).filter(e => e.is_active !== false);

  if (filters.category) items = items.filter(e => e.category === filters.category);
  if (filters.type) items = items.filter(e => e.type === filters.type);
  if (filters.status) items = items.filter(e => e.status === filters.status);
  if (filters.projectId) items = items.filter(e => e.current_project_id === filters.projectId);
  if (filters.ownership) items = items.filter(e => e.ownership === filters.ownership);
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.code || '').toLowerCase().includes(q) ||
      (e.serial_number || '').toLowerCase().includes(q) ||
      (e.manufacturer || '').toLowerCase().includes(q)
    );
  }

  items = items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return { success: true, data: items, count: items.length };
}

function getEquipment(id) {
  const store = loadStore();
  const record = store.equipment[id];
  if (!record) throw new Error('المعدة غير موجودة');

  // إرفاق أحدث سجلات التشغيل والحجوزات والتنقل لهذه المعدة (نظرة موجزة)
  const operations = Object.values(store.operationLogs)
    .filter(o => o.equipment_id === id)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .slice(0, 20);
  const reservations = Object.values(store.reservations)
    .filter(r => r.equipment_id === id)
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
    .slice(0, 20);
  const movements = Object.values(store.movementLogs)
    .filter(m => m.equipment_id === id)
    .sort((a, b) => (b.moved_at || '').localeCompare(a.moved_at || ''))
    .slice(0, 20);

  return { success: true, data: { ...record, recent_operations: operations, recent_reservations: reservations, recent_movements: movements } };
}

function updateEquipment(id, updates) {
  const store = loadStore();
  const record = store.equipment[id];
  if (!record) throw new Error('المعدة غير موجودة');

  if (updates.type && !EQUIPMENT_TYPE_LABELS[updates.type]) {
    throw new Error(`نوع المعدة غير معروف: ${updates.type}`);
  }
  if (updates.status && !EQUIPMENT_STATUSES.includes(updates.status)) {
    throw new Error(`حالة المعدة غير صحيحة: ${updates.status}`);
  }
  if (updates.code && updates.code !== record.code) {
    const duplicate = Object.values(store.equipment).find(e => e.code === updates.code && e.id !== id);
    if (duplicate) throw new Error(`رقم المعدة (${updates.code}) مستخدم مسبقاً`);
  }

  const previousStatus = record.status;
  const previousLocation = record.current_location;
  const previousProject = record.current_project_id;

  const blocked = ['id', 'created_at', 'total_operating_hours', 'total_working_days', 'last_operation_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();
  if (updates.category === undefined && updates.type) {
    record.category = categoryOfType(updates.type) || record.category;
  }

  // تسجيل حركة تلقائياً إذا تغيّر الموقع أو المشروع
  if ((updates.current_location && updates.current_location !== previousLocation) ||
      (updates.current_project_id !== undefined && updates.current_project_id !== previousProject)) {
    const movementId = newId('MOV');
    store.movementLogs[movementId] = {
      id: movementId,
      equipment_id: id,
      from_location: previousLocation || null,
      to_location: record.current_location || null,
      from_project_id: previousProject || null,
      to_project_id: record.current_project_id || null,
      moved_at: nowISO(),
      note: updates.movement_note || null,
    };
  }

  audit(store, {
    action: 'update', entity: 'equipment', entityId: id,
    details: { changedFields: Object.keys(updates), statusChanged: previousStatus !== record.status },
  });
  saveStore(store);
  return { success: true, data: record };
}

function deleteEquipment(id) {
  const store = loadStore();
  const record = store.equipment[id];
  if (!record) throw new Error('المعدة غير موجودة');

  const activeReservation = Object.values(store.reservations).find(
    r => r.equipment_id === id && r.status === 'active'
  );
  if (activeReservation) {
    throw new Error('لا يمكن حذف المعدة لوجود حجز نشط عليها؛ يرجى إلغاء الحجز أولاً');
  }

  // حذف منطقي (soft delete) للحفاظ على السجل التاريخي والتقارير
  record.is_active = false;
  record.status = 'out_of_service';
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'equipment', entityId: id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ===================== إدارة التشغيل =====================

function startOperation(body) {
  const store = loadStore();
  const { equipment_id, project_id = null, operator_name = null, operator_id = null, odometer_start = null, note = null } = body || {};
  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const openOp = Object.values(store.operationLogs).find(
    o => o.equipment_id === equipment_id && !o.ended_at
  );
  if (openOp) throw new Error('يوجد تشغيل مفتوح بالفعل لهذه المعدة؛ يجب إنهاؤه أولاً');

  if (['under_maintenance', 'out_of_service'].includes(equipment.status)) {
    throw new Error(`لا يمكن تشغيل المعدة وهي بحالة: ${EQUIPMENT_STATUS_LABELS[equipment.status]}`);
  }

  const id = newId('OPLOG');
  const record = {
    id,
    equipment_id,
    project_id,
    operator_id,
    operator_name,
    started_at: nowISO(),
    ended_at: null,
    duration_hours: null,
    odometer_start: odometer_start != null ? r2(odometer_start) : null,
    odometer_end: null,
    distance_covered: null,
    note,
  };
  store.operationLogs[id] = record;

  equipment.status = 'working';
  if (project_id) equipment.current_project_id = project_id;
  equipment.updated_at = nowISO();

  audit(store, { action: 'start_operation', entity: 'operationLog', entityId: id, projectId: project_id, details: { equipment_id } });
  saveStore(store);
  return { success: true, data: record };
}

function endOperation(body) {
  const store = loadStore();
  const { operation_id, odometer_end = null, note = null } = body || {};
  if (!operation_id) throw new Error('معرّف سجل التشغيل مطلوب');
  const record = store.operationLogs[operation_id];
  if (!record) throw new Error('سجل التشغيل غير موجود');
  if (record.ended_at) throw new Error('تم إنهاء هذا التشغيل مسبقاً');

  const equipment = store.equipment[record.equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');

  record.ended_at = nowISO();
  const startMs = new Date(record.started_at).getTime();
  const endMs = new Date(record.ended_at).getTime();
  record.duration_hours = r2((endMs - startMs) / (1000 * 60 * 60));
  if (odometer_end != null) {
    record.odometer_end = r2(odometer_end);
    if (record.odometer_start != null) {
      record.distance_covered = r2(record.odometer_end - record.odometer_start);
    }
  }
  if (note) record.note = note;

  // تحديث العدادات التراكمية للمعدة
  equipment.total_operating_hours = r2((equipment.total_operating_hours || 0) + record.duration_hours);
  equipment.last_operation_at = record.ended_at;
  equipment.status = 'available';

  // احتساب عدد أيام العمل (يوم عمل فريد = تاريخ يحتوي سجل تشغيل منتهٍ واحد على الأقل)
  const workDates = new Set(
    Object.values(store.operationLogs)
      .filter(o => o.equipment_id === equipment.id && o.ended_at)
      .map(o => String(o.started_at).slice(0, 10))
  );
  equipment.total_working_days = workDates.size;
  equipment.updated_at = nowISO();

  audit(store, { action: 'end_operation', entity: 'operationLog', entityId: operation_id, details: { equipment_id: equipment.id, duration_hours: record.duration_hours } });
  saveStore(store);
  return { success: true, data: record };
}

function listOperations(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.operationLogs);
  if (filters.equipmentId) items = items.filter(o => o.equipment_id === filters.equipmentId);
  if (filters.projectId) items = items.filter(o => o.project_id === filters.projectId);
  if (filters.openOnly === true || filters.openOnly === 'true') items = items.filter(o => !o.ended_at);
  if (filters.dateFrom) items = items.filter(o => o.started_at >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(o => o.started_at <= filters.dateTo);
  items = items.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  return { success: true, data: items, count: items.length };
}

function getOperationStats(equipmentId, { period = 'all' } = {}) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const now = new Date();
  let fromDate = null;
  if (period === 'daily') { fromDate = new Date(now); fromDate.setHours(0, 0, 0, 0); }
  else if (period === 'monthly') { fromDate = new Date(now.getFullYear(), now.getMonth(), 1); }
  else if (period === 'yearly') { fromDate = new Date(now.getFullYear(), 0, 1); }

  let ops = Object.values(store.operationLogs).filter(o => o.equipment_id === equipmentId && o.ended_at);
  if (fromDate) ops = ops.filter(o => new Date(o.started_at) >= fromDate);

  const totalHours = r2(ops.reduce((s, o) => s + (o.duration_hours || 0), 0));
  const workDays = new Set(ops.map(o => String(o.started_at).slice(0, 10))).size;

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      period,
      total_operating_hours: totalHours,
      total_working_days: workDays,
      operations_count: ops.length,
      lifetime_operating_hours: equipment.total_operating_hours,
      lifetime_working_days: equipment.total_working_days,
    },
  };
}

// ===================== إدارة الحجز =====================

function reservationsOverlap(a, b) {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

function createReservation(body) {
  const store = loadStore();
  const { equipment_id, project_id, start_date, end_date, responsible_person = null, note = null } = body || {};
  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  if (!project_id) throw new Error('معرّف المشروع مطلوب');
  if (!start_date || !end_date) throw new Error('تاريخ البداية والنهاية مطلوبان');
  if (start_date > end_date) throw new Error('تاريخ البداية يجب أن يسبق تاريخ النهاية');

  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const candidate = { start_date, end_date };
  const conflicting = Object.values(store.reservations).find(
    r => r.equipment_id === equipment_id && r.status === 'active' && reservationsOverlap(r, candidate)
  );
  if (conflicting) {
    throw new Error(`تعارض حجز: المعدة محجوزة بالفعل من ${conflicting.start_date} إلى ${conflicting.end_date}`);
  }

  const id = newId('RSV');
  const record = {
    id,
    equipment_id,
    project_id,
    start_date,
    end_date,
    responsible_person,
    note,
    status: 'active',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.reservations[id] = record;

  // إذا كان الحجز يشمل تاريخ اليوم، حدّث حالة المعدة إلى "محجوزة"
  const today = nowISO().slice(0, 10);
  if (start_date <= today && today <= end_date && equipment.status === 'available') {
    equipment.status = 'reserved';
    equipment.updated_at = nowISO();
  }

  audit(store, { action: 'create', entity: 'reservation', entityId: id, projectId: project_id, details: { equipment_id, start_date, end_date } });
  saveStore(store);
  return { success: true, data: record };
}

function listReservations(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.reservations);
  if (filters.equipmentId) items = items.filter(r => r.equipment_id === filters.equipmentId);
  if (filters.projectId) items = items.filter(r => r.project_id === filters.projectId);
  if (filters.status) items = items.filter(r => r.status === filters.status);
  items = items.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  return { success: true, data: items, count: items.length };
}

function cancelReservation(id) {
  const store = loadStore();
  const record = store.reservations[id];
  if (!record) throw new Error('الحجز غير موجود');
  if (record.status !== 'active') throw new Error('الحجز ليس نشطاً بالفعل');

  record.status = 'cancelled';
  record.updated_at = nowISO();

  const equipment = store.equipment[record.equipment_id];
  if (equipment && equipment.status === 'reserved') {
    // تحقق من عدم وجود حجز نشط آخر يغطي اليوم قبل إعادة الحالة إلى متاحة
    const today = nowISO().slice(0, 10);
    const stillReserved = Object.values(store.reservations).some(
      r => r.equipment_id === equipment.id && r.status === 'active' && r.id !== id &&
        r.start_date <= today && today <= r.end_date
    );
    if (!stillReserved) {
      equipment.status = 'available';
      equipment.updated_at = nowISO();
    }
  }

  audit(store, { action: 'cancel', entity: 'reservation', entityId: id, details: { equipment_id: record.equipment_id } });
  saveStore(store);
  return { success: true, data: record };
}

function getReservationCalendar(equipmentId) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');
  const reservations = Object.values(store.reservations)
    .filter(r => r.equipment_id === equipmentId)
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  return { success: true, data: { equipment_id: equipmentId, reservations } };
}

// ===================== تتبع المعدات =====================

function logMovement(body) {
  const store = loadStore();
  const { equipment_id, from_location = null, to_location, from_project_id = null, to_project_id = null, note = null } = body || {};
  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  if (!to_location) throw new Error('الموقع الجديد (to_location) مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const id = newId('MOV');
  const record = {
    id,
    equipment_id,
    from_location: from_location || equipment.current_location || null,
    to_location,
    from_project_id: from_project_id || equipment.current_project_id || null,
    to_project_id,
    moved_at: nowISO(),
    note,
  };
  store.movementLogs[id] = record;

  equipment.current_location = to_location;
  if (to_project_id !== undefined) equipment.current_project_id = to_project_id;
  equipment.updated_at = nowISO();

  audit(store, { action: 'log_movement', entity: 'movementLog', entityId: id, details: { equipment_id, to_location } });
  saveStore(store);
  return { success: true, data: record };
}

function getEquipmentTrackingHistory(equipmentId) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const movements = Object.values(store.movementLogs)
    .filter(m => m.equipment_id === equipmentId)
    .sort((a, b) => (b.moved_at || '').localeCompare(a.moved_at || ''));
  const operations = Object.values(store.operationLogs)
    .filter(o => o.equipment_id === equipmentId)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      current_location: equipment.current_location,
      current_project_id: equipment.current_project_id,
      last_movement_at: movements[0]?.moved_at || null,
      movement_history: movements,
      operation_history: operations,
    },
  };
}

// ===================== لوحة معلومات موجزة (أساسية - سيتم توسيعها بالجزء الثالث) =====================

function getBasicDashboard(projectId = null) {
  const store = loadStore();
  let items = Object.values(store.equipment).filter(e => e.is_active !== false);
  if (projectId) items = items.filter(e => e.current_project_id === projectId);

  const byStatus = {};
  for (const s of EQUIPMENT_STATUSES) byStatus[s] = 0;
  for (const e of items) byStatus[e.status] = (byStatus[e.status] || 0) + 1;

  const totalOperatingHours = r2(items.reduce((s, e) => s + (e.total_operating_hours || 0), 0));

  const activeReservations = Object.values(store.reservations).filter(
    r => r.status === 'active' && (!projectId || r.project_id === projectId)
  ).length;

  const recentOperations = Object.values(store.operationLogs)
    .filter(o => !projectId || o.project_id === projectId)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .slice(0, 10);

  return {
    success: true,
    data: {
      total_equipment: items.length,
      by_status: byStatus,
      total_operating_hours: totalOperatingHours,
      active_reservations: activeReservations,
      recent_operations: recentOperations,
    },
  };
}

module.exports = {
  // ثوابت
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_TYPE_LABELS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  OWNERSHIP_TYPES,
  FUEL_TYPES,
  EQUIPMENT_ROLES,

  // سجل المعدات
  createEquipment,
  listEquipment,
  getEquipment,
  updateEquipment,
  deleteEquipment,

  // إدارة التشغيل
  startOperation,
  endOperation,
  listOperations,
  getOperationStats,

  // إدارة الحجز
  createReservation,
  listReservations,
  cancelReservation,
  getReservationCalendar,

  // تتبع المعدات
  logMovement,
  getEquipmentTrackingHistory,

  // لوحة معلومات أساسية
  getBasicDashboard,
};
