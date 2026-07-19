/**
 * القسم السابع - نظام إدارة المعدات (Equipment & Assets Management System)
 * =========================================================================
 * الجزء الأول: البنية الأساسية + سجل المعدات + إدارة التشغيل +
 * إدارة الحجز + تتبع المعدات.                                        [منجز]
 * الجزء الثاني: إدارة الوقود + الصيانة (الدورية والطارئة) + قطع الغيار
 *               + إدارة المشغلين.                                     [منجز]
 * الجزء الثالث: إدارة التكاليف (تشغيل/وقود/صيانة/قطع غيار/عمالة/نقل/
 *               إيجار/تأمين/إهلاك) + إدارة الإنتاجية (استغلال/كفاءة/
 *               MTTR/MTBF) + مركز التنبيهات الموحّد (9 أنواع تنبيهات).[منجز]
 * التخزين: ملف JSON على القرص (backend/data/equipment.json) بنفس نمط
 * scheduling.js / projectManagement.js - بدون تبعيات خارجية.
 *
 * الأجزاء اللاحقة (ستُبنى في تحديثات لاحقة على نفس هذا الملف):
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
      fuelLogs: {},              // { id: fuelLog }              (الجزء الثاني)
      maintenanceSchedules: {},  // { id: maintenanceSchedule }  (الجزء الثاني)
      maintenanceRecords: {},    // { id: maintenanceRecord }    (الجزء الثاني)
      spareParts: {},            // { id: sparePart }            (الجزء الثاني)
      operators: {},             // { id: operator }             (الجزء الثاني)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة المعدات: ' + e.message);
  }
  // ترحيل تلقائي: إضافة الكيانات الجديدة (الجزء الثاني) لأي قاعدة بيانات
  // أُنشئت قبل إضافتها، دون فقدان أي بيانات موجودة.
  let migrated = false;
  for (const key of ['fuelLogs', 'maintenanceSchedules', 'maintenanceRecords', 'spareParts', 'operators']) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
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

// ----- ثوابت الجزء الثاني: الوقود / الصيانة / قطع الغيار / المشغلون -----

const MAINTENANCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly', 'by_operating_hours'];
const MAINTENANCE_FREQUENCY_LABELS = {
  daily: 'يومية', weekly: 'أسبوعية', monthly: 'شهرية', yearly: 'سنوية',
  by_operating_hours: 'حسب ساعات التشغيل',
};

const MAINTENANCE_TYPES = ['preventive', 'emergency'];
const MAINTENANCE_TYPE_LABELS = { preventive: 'صيانة دورية', emergency: 'صيانة طارئة' };

const MAINTENANCE_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const MAINTENANCE_SEVERITY_LABELS = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' };

const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const MAINTENANCE_STATUS_LABELS = {
  scheduled: 'مجدولة', in_progress: 'قيد التنفيذ', completed: 'مكتملة', cancelled: 'ملغاة',
};

const LICENSE_TYPES = ['light_vehicle', 'heavy_vehicle', 'heavy_equipment', 'crane_operator', 'special'];
const LICENSE_TYPE_LABELS = {
  light_vehicle: 'مركبات خفيفة', heavy_vehicle: 'مركبات ثقيلة', heavy_equipment: 'معدات ثقيلة',
  crane_operator: 'مشغل رافعة', special: 'رخصة خاصة',
};

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
    insurance_annual_cost: body.insurance_annual_cost != null ? r2(body.insurance_annual_cost) : 0,
    operator_labor_cost_per_hour: body.operator_labor_cost_per_hour != null ? r2(body.operator_labor_cost_per_hour) : 0,
    transport_cost_total: body.transport_cost_total != null ? r2(body.transport_cost_total) : 0,

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

// =====================================================================
// ===== الجزء الثاني: إدارة الوقود + الصيانة + قطع الغيار + المشغلون =====
// =====================================================================

// ----------------------- إدارة الوقود -----------------------

function logFuelEntry(body) {
  const store = loadStore();
  const {
    equipment_id, quantity, fuel_type = null, unit_price = 0,
    odometer_or_hours = null, filled_at = null, station = null, note = null,
  } = body || {};

  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');
  if (!quantity || Number(quantity) <= 0) throw new Error('كمية الوقود يجب أن تكون أكبر من صفر');

  const qty = r2(quantity);
  const price = r2(unit_price);
  const cost = r2(qty * price);

  const id = newId('FUEL');
  const record = {
    id,
    equipment_id,
    project_id: equipment.current_project_id || null,
    fuel_type: fuel_type || equipment.fuel_type || 'diesel',
    quantity: qty,
    unit_price: price,
    cost,
    odometer_or_hours: odometer_or_hours != null ? r2(odometer_or_hours) : null,
    filled_at: filled_at || nowISO(),
    station,
    note,
    created_at: nowISO(),
  };

  store.fuelLogs[id] = record;
  audit(store, { action: 'create', entity: 'fuel_log', entityId: id, projectId: record.project_id, details: { equipment_id, quantity: qty } });
  saveStore(store);
  return { success: true, data: record };
}

function listFuelLogs(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.fuelLogs);
  if (filters.equipmentId) items = items.filter(f => f.equipment_id === filters.equipmentId);
  if (filters.projectId) items = items.filter(f => f.project_id === filters.projectId);
  if (filters.dateFrom) items = items.filter(f => (f.filled_at || '') >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(f => (f.filled_at || '') <= filters.dateTo);
  items = items.sort((a, b) => (b.filled_at || '').localeCompare(a.filled_at || ''));
  return { success: true, data: items, count: items.length };
}

function getFuelStats(equipmentId, { period = 'all' } = {}) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  let from = null;
  const now = new Date();
  if (period === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString(); }
  else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString(); }
  else if (period === 'year') { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); from = d.toISOString(); }

  let logs = Object.values(store.fuelLogs).filter(f => f.equipment_id === equipmentId);
  if (from) logs = logs.filter(f => (f.filled_at || '') >= from);
  logs = logs.sort((a, b) => (a.filled_at || '').localeCompare(b.filled_at || ''));

  const totalQuantity = r2(logs.reduce((s, f) => s + (f.quantity || 0), 0));
  const totalCost = r2(logs.reduce((s, f) => s + (f.cost || 0), 0));
  const avgPrice = logs.length ? r2(totalCost / totalQuantity) : 0;

  // متوسط الاستهلاك: نقارن بين القراءات المتتالية لـ odometer_or_hours عند توفرها
  const readingsPairs = logs.filter(f => f.odometer_or_hours != null);
  let avgConsumptionPerUnit = null;
  if (readingsPairs.length >= 2) {
    const first = readingsPairs[0];
    const last = readingsPairs[readingsPairs.length - 1];
    const usageSpan = r2(last.odometer_or_hours - first.odometer_or_hours);
    const quantityExcludingFirst = r2(readingsPairs.slice(1).reduce((s, f) => s + (f.quantity || 0), 0));
    if (usageSpan > 0) avgConsumptionPerUnit = r2(quantityExcludingFirst / usageSpan);
  }

  // اكتشاف استهلاك غير طبيعي: أي عملية تعبئة تتجاوز 40% من متوسط الكمية بالعمليات السابقة
  const anomalies = [];
  if (logs.length >= 3) {
    const avgQty = r2(totalQuantity / logs.length);
    for (const f of logs) {
      if (avgQty > 0 && f.quantity > avgQty * 1.4) {
        anomalies.push({ fuel_log_id: f.id, filled_at: f.filled_at, quantity: f.quantity, average_quantity: avgQty });
      }
    }
  }

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      period,
      entries_count: logs.length,
      total_quantity: totalQuantity,
      total_cost: totalCost,
      average_unit_price: avgPrice,
      average_consumption_per_hour_or_km: avgConsumptionPerUnit,
      abnormal_consumption_entries: anomalies,
    },
  };
}

// ----------------------- إدارة الصيانة: الجدولة الدورية -----------------------

function createMaintenanceSchedule(body) {
  const store = loadStore();
  const {
    equipment_id, frequency, interval_hours = null, description = null,
    next_due_date = null, next_due_hours = null, assigned_to = null,
  } = body || {};

  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');
  if (!frequency || !MAINTENANCE_FREQUENCIES.includes(frequency)) {
    throw new Error(`دورية الصيانة غير صحيحة. القيم المسموحة: ${MAINTENANCE_FREQUENCIES.join(', ')}`);
  }
  if (frequency === 'by_operating_hours' && !interval_hours) {
    throw new Error('عدد ساعات التشغيل بين كل صيانة (interval_hours) مطلوب لهذه الدورية');
  }

  const id = newId('MSCH');
  const record = {
    id,
    equipment_id,
    frequency,
    interval_hours: interval_hours != null ? r2(interval_hours) : null,
    description,
    next_due_date,
    next_due_hours: next_due_hours != null ? r2(next_due_hours) : null,
    assigned_to,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.maintenanceSchedules[id] = record;
  audit(store, { action: 'create', entity: 'maintenance_schedule', entityId: id, details: { equipment_id, frequency } });
  saveStore(store);
  return { success: true, data: record };
}

function listMaintenanceSchedules(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.maintenanceSchedules).filter(s => s.is_active !== false);
  if (filters.equipmentId) items = items.filter(s => s.equipment_id === filters.equipmentId);
  items = items.sort((a, b) => (a.next_due_date || '').localeCompare(b.next_due_date || ''));
  return { success: true, data: items, count: items.length };
}

function updateMaintenanceSchedule(id, updates) {
  const store = loadStore();
  const record = store.maintenanceSchedules[id];
  if (!record) throw new Error('جدول الصيانة غير موجود');
  if (updates.frequency && !MAINTENANCE_FREQUENCIES.includes(updates.frequency)) {
    throw new Error(`دورية الصيانة غير صحيحة: ${updates.frequency}`);
  }
  const blocked = ['id', 'equipment_id', 'created_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();
  saveStore(store);
  return { success: true, data: record };
}

function deleteMaintenanceSchedule(id) {
  const store = loadStore();
  const record = store.maintenanceSchedules[id];
  if (!record) throw new Error('جدول الصيانة غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'maintenance_schedule', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

// تنبيهات الصيانة الدورية القادمة: خلال آفاق الأيام المحددة، أو عند اقتراب
// ساعات التشغيل الفعلية من next_due_hours
function getUpcomingMaintenanceAlerts({ withinDays = 14 } = {}) {
  const store = loadStore();
  const today = new Date();
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + Number(withinDays || 14));
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const schedules = Object.values(store.maintenanceSchedules).filter(s => s.is_active !== false);
  const alerts = [];

  for (const s of schedules) {
    const equipment = store.equipment[s.equipment_id];
    if (!equipment) continue;

    if (s.next_due_date && s.next_due_date >= todayStr && s.next_due_date <= horizonStr) {
      alerts.push({
        type: 'date_due', schedule_id: s.id, equipment_id: s.equipment_id,
        equipment_name: equipment.name, equipment_code: equipment.code,
        due_date: s.next_due_date, description: s.description,
      });
    }
    if (s.next_due_date && s.next_due_date < todayStr) {
      alerts.push({
        type: 'date_overdue', schedule_id: s.id, equipment_id: s.equipment_id,
        equipment_name: equipment.name, equipment_code: equipment.code,
        due_date: s.next_due_date, description: s.description,
      });
    }
    if (s.next_due_hours != null) {
      const remaining = r2(s.next_due_hours - (equipment.total_operating_hours || 0));
      if (remaining <= 20) {
        alerts.push({
          type: remaining <= 0 ? 'hours_overdue' : 'hours_due',
          schedule_id: s.id, equipment_id: s.equipment_id,
          equipment_name: equipment.name, equipment_code: equipment.code,
          remaining_hours: remaining, description: s.description,
        });
      }
    }
  }

  return { success: true, data: alerts, count: alerts.length };
}

// ----------------------- إدارة الصيانة: السجلات (دورية منفذة / طارئة) -----------------------

function createMaintenanceRecord(body) {
  const store = loadStore();
  const {
    equipment_id, maintenance_type, schedule_id = null,
    fault_description = null, fault_cause = null, severity = null,
    repair_cost = 0, spare_parts_used = [], technician = null,
    started_at = null, completed_at = null, status = 'scheduled', notes = null,
  } = body || {};

  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');
  if (!maintenance_type || !MAINTENANCE_TYPES.includes(maintenance_type)) {
    throw new Error(`نوع الصيانة غير صحيح. القيم المسموحة: ${MAINTENANCE_TYPES.join(', ')}`);
  }
  if (maintenance_type === 'emergency' && !fault_description) {
    throw new Error('وصف العطل (fault_description) مطلوب للصيانة الطارئة');
  }
  if (severity && !MAINTENANCE_SEVERITIES.includes(severity)) {
    throw new Error(`درجة الخطورة غير صحيحة: ${severity}`);
  }
  if (!MAINTENANCE_STATUSES.includes(status)) {
    throw new Error(`حالة الصيانة غير صحيحة: ${status}`);
  }

  // خصم قطع الغيار المستخدمة من المخزون والتحقق من توفرها
  let partsCost = 0;
  const resolvedParts = [];
  for (const use of spare_parts_used) {
    const part = store.spareParts[use.part_id];
    if (!part) throw new Error(`قطعة الغيار غير موجودة: ${use.part_id}`);
    const qty = Number(use.quantity) || 0;
    if (qty <= 0) throw new Error('كمية قطعة الغيار المستخدمة يجب أن تكون أكبر من صفر');
    if (part.stock_quantity < qty) {
      throw new Error(`المخزون غير كافٍ من قطعة الغيار (${part.name}): المتاح ${part.stock_quantity}`);
    }
    part.stock_quantity = r2(part.stock_quantity - qty);
    part.updated_at = nowISO();
    partsCost += (part.unit_price || 0) * qty;
    resolvedParts.push({ part_id: part.id, part_name: part.name, quantity: qty, unit_price: part.unit_price, subtotal: r2((part.unit_price || 0) * qty) });
  }
  partsCost = r2(partsCost);

  const id = newId('MREC');
  const startTs = started_at || nowISO();
  const isCompleted = status === 'completed';
  const endTs = isCompleted ? (completed_at || nowISO()) : (completed_at || null);
  const downtimeHours = endTs ? r2((new Date(endTs) - new Date(startTs)) / 3600000) : null;

  const record = {
    id,
    equipment_id,
    project_id: equipment.current_project_id || null,
    maintenance_type,
    schedule_id,
    fault_description,
    fault_cause,
    severity,
    repair_cost: r2(repair_cost || 0),
    spare_parts_used: resolvedParts,
    spare_parts_cost: partsCost,
    total_cost: r2((Number(repair_cost) || 0) + partsCost),
    technician,
    started_at: startTs,
    completed_at: endTs,
    downtime_hours: downtimeHours,
    status,
    notes,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.maintenanceRecords[id] = record;

  // تحديث حالة المعدة تبعاً لحالة الصيانة
  if (status === 'scheduled' || status === 'in_progress') {
    equipment.status = 'under_maintenance';
    equipment.updated_at = nowISO();
  } else if (status === 'completed') {
    equipment.status = 'available';
    equipment.updated_at = nowISO();
    // تحديث موعد الصيانة الدورية القادمة إذا كان السجل مرتبطاً بجدول
    if (schedule_id && store.maintenanceSchedules[schedule_id]) {
      const sch = store.maintenanceSchedules[schedule_id];
      if (sch.frequency === 'by_operating_hours' && sch.interval_hours) {
        sch.next_due_hours = r2((equipment.total_operating_hours || 0) + sch.interval_hours);
      } else if (sch.next_due_date) {
        const daysMap = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };
        const addDays = daysMap[sch.frequency] || 30;
        const d = new Date(sch.next_due_date);
        d.setDate(d.getDate() + addDays);
        sch.next_due_date = d.toISOString().slice(0, 10);
      }
      sch.updated_at = nowISO();
    }
  }

  audit(store, {
    action: 'create', entity: 'maintenance_record', entityId: id, projectId: record.project_id,
    details: { equipment_id, maintenance_type, status },
  });
  saveStore(store);
  return { success: true, data: record };
}

function updateMaintenanceRecord(id, updates) {
  const store = loadStore();
  const record = store.maintenanceRecords[id];
  if (!record) throw new Error('سجل الصيانة غير موجود');
  if (updates.status && !MAINTENANCE_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الصيانة غير صحيحة: ${updates.status}`);
  }

  const wasCompleted = record.status === 'completed';
  const blocked = ['id', 'equipment_id', 'created_at', 'spare_parts_used', 'spare_parts_cost'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.total_cost = r2((Number(record.repair_cost) || 0) + (record.spare_parts_cost || 0));
  record.updated_at = nowISO();

  if (record.started_at && record.completed_at) {
    record.downtime_hours = r2((new Date(record.completed_at) - new Date(record.started_at)) / 3600000);
  }

  const equipment = store.equipment[record.equipment_id];
  if (equipment) {
    if (!wasCompleted && record.status === 'completed') {
      equipment.status = 'available';
      equipment.updated_at = nowISO();
    } else if (record.status === 'scheduled' || record.status === 'in_progress') {
      equipment.status = 'under_maintenance';
      equipment.updated_at = nowISO();
    }
  }

  audit(store, { action: 'update', entity: 'maintenance_record', entityId: id, details: { status: record.status } });
  saveStore(store);
  return { success: true, data: record };
}

function listMaintenanceRecords(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.maintenanceRecords);
  if (filters.equipmentId) items = items.filter(m => m.equipment_id === filters.equipmentId);
  if (filters.projectId) items = items.filter(m => m.project_id === filters.projectId);
  if (filters.maintenanceType) items = items.filter(m => m.maintenance_type === filters.maintenanceType);
  if (filters.status) items = items.filter(m => m.status === filters.status);
  items = items.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  return { success: true, data: items, count: items.length };
}

function getMaintenanceStats(equipmentId) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const records = Object.values(store.maintenanceRecords).filter(m => m.equipment_id === equipmentId);
  const completed = records.filter(m => m.status === 'completed');
  const emergency = records.filter(m => m.maintenance_type === 'emergency');

  const totalCost = r2(records.reduce((s, m) => s + (m.total_cost || 0), 0));
  const totalDowntime = r2(completed.reduce((s, m) => s + (m.downtime_hours || 0), 0));
  const avgRepairTime = completed.length ? r2(totalDowntime / completed.length) : 0;
  const faultsCount = emergency.length;
  const avgTimeBetweenFaults = faultsCount > 1
    ? (() => {
        const sorted = emergency.slice().sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''));
        const first = new Date(sorted[0].started_at);
        const last = new Date(sorted[sorted.length - 1].started_at);
        const days = (last - first) / 86400000;
        return r2(days / (faultsCount - 1));
      })()
    : null;

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      total_records: records.length,
      completed_count: completed.length,
      emergency_faults_count: faultsCount,
      preventive_count: records.length - faultsCount,
      total_maintenance_cost: totalCost,
      total_downtime_hours: totalDowntime,
      average_repair_time_hours: avgRepairTime,
      average_days_between_faults: avgTimeBetweenFaults,
    },
  };
}

// ----------------------- إدارة قطع الغيار -----------------------

function createSparePart(body) {
  const store = loadStore();
  const {
    name, part_number = null, manufacturer = null, supplier = null,
    stock_quantity = 0, unit_price = 0, min_stock_level = 0,
    expected_lifespan = null, compatible_equipment_types = [],
  } = body || {};

  if (!name || !String(name).trim()) throw new Error('اسم قطعة الغيار مطلوب');
  if (part_number) {
    const dup = Object.values(store.spareParts).find(p => p.part_number === part_number);
    if (dup) throw new Error(`رقم القطعة (${part_number}) مستخدم مسبقاً`);
  }

  const id = newId('PART');
  const record = {
    id,
    name,
    part_number,
    manufacturer,
    supplier,
    stock_quantity: r2(stock_quantity),
    unit_price: r2(unit_price),
    min_stock_level: r2(min_stock_level),
    expected_lifespan,
    compatible_equipment_types,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.spareParts[id] = record;
  audit(store, { action: 'create', entity: 'spare_part', entityId: id, details: { name } });
  saveStore(store);
  return { success: true, data: record };
}

function listSpareParts(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.spareParts).filter(p => p.is_active !== false);
  if (filters.equipmentType) items = items.filter(p => (p.compatible_equipment_types || []).includes(filters.equipmentType));
  if (filters.lowStockOnly === true || filters.lowStockOnly === 'true') {
    items = items.filter(p => p.stock_quantity <= p.min_stock_level);
  }
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(p => (p.name || '').toLowerCase().includes(q) || (p.part_number || '').toLowerCase().includes(q));
  }
  items = items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  return { success: true, data: items, count: items.length };
}

function updateSparePart(id, updates) {
  const store = loadStore();
  const record = store.spareParts[id];
  if (!record) throw new Error('قطعة الغيار غير موجودة');
  const blocked = ['id', 'created_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();
  saveStore(store);
  return { success: true, data: record };
}

function deleteSparePart(id) {
  const store = loadStore();
  const record = store.spareParts[id];
  if (!record) throw new Error('قطعة الغيار غير موجودة');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'spare_part', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

function restockSparePart(id, quantity) {
  const store = loadStore();
  const record = store.spareParts[id];
  if (!record) throw new Error('قطعة الغيار غير موجودة');
  const qty = Number(quantity) || 0;
  if (qty <= 0) throw new Error('كمية التزويد يجب أن تكون أكبر من صفر');
  record.stock_quantity = r2(record.stock_quantity + qty);
  record.updated_at = nowISO();
  audit(store, { action: 'restock', entity: 'spare_part', entityId: id, details: { quantity: qty } });
  saveStore(store);
  return { success: true, data: record };
}

function getLowStockParts() {
  const store = loadStore();
  const items = Object.values(store.spareParts)
    .filter(p => p.is_active !== false && p.stock_quantity <= p.min_stock_level)
    .sort((a, b) => (a.stock_quantity - a.min_stock_level) - (b.stock_quantity - b.min_stock_level));
  return { success: true, data: items, count: items.length };
}

// ----------------------- إدارة المشغلين -----------------------

function createOperator(body) {
  const store = loadStore();
  const {
    name, national_id = null, license_number = null, license_type = null,
    license_expiry = null, training_courses = [], experience_years = 0,
    authorized_equipment_types = [],
  } = body || {};

  if (!name || !String(name).trim()) throw new Error('اسم المشغل مطلوب');
  if (license_type && !LICENSE_TYPES.includes(license_type)) {
    throw new Error(`نوع الرخصة غير صحيح. القيم المسموحة: ${LICENSE_TYPES.join(', ')}`);
  }
  if (national_id) {
    const dup = Object.values(store.operators).find(o => o.national_id === national_id);
    if (dup) throw new Error('رقم الهوية مستخدم مسبقاً لمشغل آخر');
  }

  const id = newId('OPR');
  const record = {
    id,
    name,
    national_id,
    license_number,
    license_type,
    license_expiry,
    training_courses,
    experience_years: r2(experience_years),
    authorized_equipment_types,
    performance_rating: null,
    violations: [],
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.operators[id] = record;
  audit(store, { action: 'create', entity: 'operator', entityId: id, details: { name } });
  saveStore(store);
  return { success: true, data: record };
}

function listOperators(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.operators).filter(o => o.is_active !== false);
  if (filters.equipmentType) items = items.filter(o => (o.authorized_equipment_types || []).includes(filters.equipmentType));
  if (filters.licenseExpiringWithinDays) {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + Number(filters.licenseExpiringWithinDays));
    const horizonStr = horizon.toISOString().slice(0, 10);
    const todayStr = nowISO().slice(0, 10);
    items = items.filter(o => o.license_expiry && o.license_expiry >= todayStr && o.license_expiry <= horizonStr);
  }
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(o => (o.name || '').toLowerCase().includes(q) || (o.license_number || '').toLowerCase().includes(q));
  }
  items = items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  return { success: true, data: items, count: items.length };
}

function getOperator(id) {
  const store = loadStore();
  const record = store.operators[id];
  if (!record) throw new Error('المشغل غير موجود');
  const operations = Object.values(store.operationLogs)
    .filter(o => o.operator_id === id)
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .slice(0, 30);
  return { success: true, data: { ...record, operation_history: operations } };
}

function updateOperator(id, updates) {
  const store = loadStore();
  const record = store.operators[id];
  if (!record) throw new Error('المشغل غير موجود');
  if (updates.license_type && !LICENSE_TYPES.includes(updates.license_type)) {
    throw new Error(`نوع الرخصة غير صحيح: ${updates.license_type}`);
  }
  const blocked = ['id', 'created_at', 'violations'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();
  saveStore(store);
  return { success: true, data: record };
}

function deleteOperator(id) {
  const store = loadStore();
  const record = store.operators[id];
  if (!record) throw new Error('المشغل غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'operator', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

function addOperatorViolation(id, body) {
  const store = loadStore();
  const record = store.operators[id];
  if (!record) throw new Error('المشغل غير موجود');
  const { description, date = null, severity = null } = body || {};
  if (!description) throw new Error('وصف المخالفة مطلوب');
  if (!record.violations) record.violations = [];
  record.violations.push({ id: newId('VIO'), description, date: date || nowISO().slice(0, 10), severity });
  record.updated_at = nowISO();
  audit(store, { action: 'add_violation', entity: 'operator', entityId: id, details: { description } });
  saveStore(store);
  return { success: true, data: record };
}

function rateOperatorPerformance(id, rating) {
  const store = loadStore();
  const record = store.operators[id];
  if (!record) throw new Error('المشغل غير موجود');
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) throw new Error('التقييم يجب أن يكون رقماً بين 1 و 5');
  record.performance_rating = r;
  record.updated_at = nowISO();
  saveStore(store);
  return { success: true, data: record };
}

function getOperatorLicenseAlerts({ withinDays = 30 } = {}) {
  const store = loadStore();
  const horizon = new Date(); horizon.setDate(horizon.getDate() + Number(withinDays || 30));
  const horizonStr = horizon.toISOString().slice(0, 10);
  const todayStr = nowISO().slice(0, 10);

  const items = Object.values(store.operators)
    .filter(o => o.is_active !== false && o.license_expiry)
    .filter(o => o.license_expiry <= horizonStr)
    .map(o => ({
      operator_id: o.id,
      name: o.name,
      license_number: o.license_number,
      license_expiry: o.license_expiry,
      status: o.license_expiry < todayStr ? 'expired' : 'expiring_soon',
    }))
    .sort((a, b) => (a.license_expiry || '').localeCompare(b.license_expiry || ''));

  return { success: true, data: items, count: items.length };
}

// ===================== لوحة معلومات موجزة (أساسية - سيتم توسيعها بالجزء الثالث) =====================

// =====================================================================
// الجزء الثالث (3/4) من القسم السابع: إدارة التكاليف + إدارة الإنتاجية
// + مركز التنبيهات الموحّد
// =====================================================================

// ----------------------- إدارة التكاليف -----------------------

// يحسب التكلفة الإجمالية والتفصيلية لمعدة واحدة خلال فترة زمنية اختيارية
// (منذ الشراء إن لم تُحدَّد الفترة)، بالاعتماد فعلياً على البيانات
// المسجّلة في: سجلات التشغيل (عمالة)، الوقود، الصيانة، قطع الغيار،
// إضافة إلى الإيجار والتأمين والإهلاك المخزّنة على سجل المعدة.
function getEquipmentCostBreakdown(equipmentId, { dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

  const opsInRange = Object.values(store.operationLogs).filter(
    o => o.equipment_id === equipmentId && o.ended_at && inRange(String(o.started_at).slice(0, 10))
  );
  const operatingHours = r2(opsInRange.reduce((s, o) => s + (o.duration_hours || 0), 0));

  const laborCost = r2(operatingHours * (equipment.operator_labor_cost_per_hour || 0));

  const fuelLogs = Object.values(store.fuelLogs).filter(
    f => f.equipment_id === equipmentId && inRange(String(f.filled_at).slice(0, 10))
  );
  const fuelCost = r2(fuelLogs.reduce((s, f) => s + (f.cost || 0), 0));

  const maintRecords = Object.values(store.maintenanceRecords).filter(
    m => m.equipment_id === equipmentId && inRange(String(m.started_at).slice(0, 10))
  );
  const maintenanceLaborCost = r2(maintRecords.reduce((s, m) => s + (m.repair_cost || 0), 0));
  const sparePartsCost = r2(maintRecords.reduce((s, m) => s + (m.spare_parts_cost || 0), 0));
  const maintenanceTotalCost = r2(maintenanceLaborCost + sparePartsCost);

  const rentalCost = equipment.ownership === 'rented'
    ? r2(operatingHours * (equipment.rental_cost_per_hour || 0))
    : 0;

  let insuranceCost = equipment.insurance_annual_cost || 0;
  if (dateFrom && dateTo) {
    const days = Math.max(1, r2((new Date(dateTo) - new Date(dateFrom)) / 86400000));
    insuranceCost = r2((equipment.insurance_annual_cost || 0) * (days / 365));
  }

  const transportCost = equipment.transport_cost_total || 0;
  const depreciationCost = equipment.depreciation_value || 0;

  const operatingCost = r2(fuelCost + laborCost);
  const totalCost = r2(
    operatingCost + maintenanceTotalCost + rentalCost + insuranceCost + transportCost + depreciationCost
  );
  const costPerOperatingHour = operatingHours > 0 ? r2(totalCost / operatingHours) : 0;

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      equipment_name: equipment.name,
      equipment_code: equipment.code,
      period: { from: dateFrom, to: dateTo },
      operating_hours: operatingHours,
      breakdown: {
        operating_cost: operatingCost,
        fuel_cost: fuelCost,
        labor_cost: laborCost,
        maintenance_cost: maintenanceTotalCost,
        maintenance_labor_cost: maintenanceLaborCost,
        spare_parts_cost: sparePartsCost,
        transport_cost: transportCost,
        rental_cost: rentalCost,
        insurance_cost: insuranceCost,
        depreciation_cost: depreciationCost,
      },
      total_cost: totalCost,
      cost_per_operating_hour: costPerOperatingHour,
    },
  };
}

function getFleetCostSummary({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let items = Object.values(store.equipment).filter(e => e.is_active !== false);
  if (projectId) items = items.filter(e => e.current_project_id === projectId);

  const rows = items.map(e => getEquipmentCostBreakdown(e.id, { dateFrom, dateTo }).data);

  const totals = rows.reduce((acc, r) => {
    acc.operating_cost += r.breakdown.operating_cost;
    acc.fuel_cost += r.breakdown.fuel_cost;
    acc.labor_cost += r.breakdown.labor_cost;
    acc.maintenance_cost += r.breakdown.maintenance_cost;
    acc.spare_parts_cost += r.breakdown.spare_parts_cost;
    acc.transport_cost += r.breakdown.transport_cost;
    acc.rental_cost += r.breakdown.rental_cost;
    acc.insurance_cost += r.breakdown.insurance_cost;
    acc.depreciation_cost += r.breakdown.depreciation_cost;
    acc.total_cost += r.total_cost;
    return acc;
  }, {
    operating_cost: 0, fuel_cost: 0, labor_cost: 0, maintenance_cost: 0,
    spare_parts_cost: 0, transport_cost: 0, rental_cost: 0, insurance_cost: 0,
    depreciation_cost: 0, total_cost: 0,
  });
  for (const k of Object.keys(totals)) totals[k] = r2(totals[k]);

  const byEquipment = rows
    .map(r => ({ equipment_id: r.equipment_id, equipment_name: r.equipment_name, equipment_code: r.equipment_code, total_cost: r.total_cost }))
    .sort((a, b) => b.total_cost - a.total_cost);

  return {
    success: true,
    data: {
      period: { from: dateFrom, to: dateTo },
      equipment_count: rows.length,
      totals,
      most_costly_equipment: byEquipment.slice(0, 10),
      by_equipment: byEquipment,
    },
  };
}

function logTransportCost(body) {
  const store = loadStore();
  const { equipment_id, amount, note = null } = body || {};
  if (!equipment_id) throw new Error('معرّف المعدة مطلوب');
  const equipment = store.equipment[equipment_id];
  if (!equipment) throw new Error('المعدة غير موجودة');
  if (amount == null || Number(amount) <= 0) throw new Error('قيمة تكلفة النقل يجب أن تكون أكبر من صفر');

  equipment.transport_cost_total = r2((equipment.transport_cost_total || 0) + Number(amount));
  equipment.updated_at = nowISO();

  audit(store, { action: 'log_transport_cost', entity: 'equipment', entityId: equipment_id, details: { amount: r2(amount), note } });
  saveStore(store);
  return { success: true, data: { equipment_id, transport_cost_total: equipment.transport_cost_total } };
}

// ----------------------- إدارة الإنتاجية -----------------------

function getEquipmentProductivity(equipmentId, { dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  const equipment = store.equipment[equipmentId];
  if (!equipment) throw new Error('المعدة غير موجودة');

  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));

  const opsInRange = Object.values(store.operationLogs).filter(
    o => o.equipment_id === equipmentId && o.ended_at && inRange(String(o.started_at).slice(0, 10))
  );
  const operatingHours = r2(opsInRange.reduce((s, o) => s + (o.duration_hours || 0), 0));

  let calendarHours = null;
  if (dateFrom && dateTo) {
    calendarHours = r2(((new Date(dateTo) - new Date(dateFrom)) / 3600000) + 24);
  } else if (opsInRange.length) {
    const dates = opsInRange.map(o => o.started_at).sort();
    calendarHours = r2(((new Date() - new Date(dates[0])) / 3600000));
  }
  const utilizationRate = calendarHours && calendarHours > 0 ? r2(Math.min(100, (operatingHours / calendarHours) * 100)) : 0;

  const maintRecords = Object.values(store.maintenanceRecords).filter(
    m => m.equipment_id === equipmentId && inRange(String(m.started_at).slice(0, 10))
  );
  const completedMaint = maintRecords.filter(m => m.status === 'completed' && m.downtime_hours != null);
  const downtimeHours = r2(completedMaint.reduce((s, m) => s + (m.downtime_hours || 0), 0));
  const mttr = completedMaint.length ? r2(downtimeHours / completedMaint.length) : 0;

  const faults = maintRecords.filter(m => m.maintenance_type === 'emergency');
  const faultRate = operatingHours > 0 ? r2(faults.length / (operatingHours / 100)) : 0;
  let mtbf = null;
  if (faults.length > 1) {
    const sorted = faults.slice().sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''));
    const spanDays = (new Date(sorted[sorted.length - 1].started_at) - new Date(sorted[0].started_at)) / 86400000;
    mtbf = r2(spanDays / (faults.length - 1));
  }

  const fuelLogs = Object.values(store.fuelLogs).filter(
    f => f.equipment_id === equipmentId && inRange(String(f.filled_at).slice(0, 10))
  );
  const totalFuel = r2(fuelLogs.reduce((s, f) => s + (f.quantity || 0), 0));
  const fuelEfficiency = totalFuel > 0 ? r2(operatingHours / totalFuel) : null;

  const workDays = new Set(opsInRange.map(o => String(o.started_at).slice(0, 10))).size;
  const avgHoursPerWorkDay = workDays > 0 ? r2(operatingHours / workDays) : 0;

  const operatingEfficiency = r2(Math.max(0, utilizationRate - Math.min(30, faultRate * 5)));

  return {
    success: true,
    data: {
      equipment_id: equipmentId,
      equipment_name: equipment.name,
      equipment_code: equipment.code,
      period: { from: dateFrom, to: dateTo },
      operating_hours: operatingHours,
      downtime_hours: downtimeHours,
      work_days: workDays,
      average_hours_per_work_day: avgHoursPerWorkDay,
      utilization_rate_percent: utilizationRate,
      operating_efficiency_percent: operatingEfficiency,
      fuel_efficiency_hours_per_unit: fuelEfficiency,
      fault_rate_per_100h: faultRate,
      faults_count: faults.length,
      average_time_between_faults_days: mtbf,
      average_repair_time_hours_mttr: mttr,
    },
  };
}

function compareEquipmentProductivity({ type = null, category = null, dateFrom = null, dateTo = null } = {}) {
  const store = loadStore();
  let items = Object.values(store.equipment).filter(e => e.is_active !== false);
  if (type) items = items.filter(e => e.type === type);
  if (category) items = items.filter(e => e.category === category);
  if (!items.length) return { success: true, data: { count: 0, items: [] } };

  const rows = items.map(e => {
    const p = getEquipmentProductivity(e.id, { dateFrom, dateTo }).data;
    return {
      equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, type: e.type,
      utilization_rate_percent: p.utilization_rate_percent,
      operating_efficiency_percent: p.operating_efficiency_percent,
      fault_rate_per_100h: p.fault_rate_per_100h,
      operating_hours: p.operating_hours,
    };
  }).sort((a, b) => b.operating_efficiency_percent - a.operating_efficiency_percent);

  const avgEfficiency = r2(rows.reduce((s, r) => s + r.operating_efficiency_percent, 0) / rows.length);

  return {
    success: true,
    data: {
      count: rows.length,
      average_efficiency_percent: avgEfficiency,
      best_performing: rows[0] || null,
      worst_performing: rows[rows.length - 1] || null,
      items: rows,
    },
  };
}

// ----------------------- مركز التنبيهات الموحّد -----------------------

function eqDateOnly(d) { return d ? String(d).slice(0, 10) : '—'; }

function getAlertsCenter({ withinDays = 14, fuelLowThresholdPercent = 15 } = {}) {
  const store = loadStore();
  const alerts = [];
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + Number(withinDays || 14));
  const horizonStr = horizon.toISOString().slice(0, 10);

  const equipmentList = Object.values(store.equipment).filter(e => e.is_active !== false);

  const maintAlerts = getUpcomingMaintenanceAlerts({ withinDays }).data;
  for (const a of maintAlerts) {
    alerts.push({
      category: a.type.startsWith('hours') ? 'maintenance_hours' : 'maintenance_date',
      severity: a.type.includes('overdue') ? 'critical' : 'warning',
      equipment_id: a.equipment_id, equipment_name: a.equipment_name, equipment_code: a.equipment_code,
      message: a.type.includes('overdue')
        ? `صيانة متأخرة عن موعدها: ${a.description || ''}`
        : `صيانة قادمة خلال ${withinDays} يوم: ${a.description || ''}`,
      details: a,
    });
  }

  for (const e of equipmentList) {
    if (e.warranty_expiry) {
      if (e.warranty_expiry < todayStr) {
        alerts.push({ category: 'warranty_expired', severity: 'warning', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `انتهى ضمان المعدة بتاريخ ${e.warranty_expiry}` });
      } else if (e.warranty_expiry <= horizonStr) {
        alerts.push({ category: 'warranty_expiring', severity: 'info', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `ينتهي ضمان المعدة بتاريخ ${e.warranty_expiry}` });
      }
    }
    if (e.insurance_expiry) {
      if (e.insurance_expiry < todayStr) {
        alerts.push({ category: 'insurance_expired', severity: 'critical', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `انتهى تأمين المعدة بتاريخ ${e.insurance_expiry}` });
      } else if (e.insurance_expiry <= horizonStr) {
        alerts.push({ category: 'insurance_expiring', severity: 'warning', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `ينتهي تأمين المعدة بتاريخ ${e.insurance_expiry}` });
      }
    }
    if (e.total_operating_hours > 3000 && e.purchase_date) {
      const years = Math.max(1, (today - new Date(e.purchase_date)) / (365 * 86400000));
      if (e.total_operating_hours / years > 2500) {
        alerts.push({ category: 'operating_hours_exceeded', severity: 'info', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `معدل استخدام مرتفع: ${r2(e.total_operating_hours / years)} ساعة/سنة تقريباً` });
      }
    }
  }

  for (const e of equipmentList) {
    if (!e.tank_capacity_l) continue;
    const lastFuel = Object.values(store.fuelLogs)
      .filter(f => f.equipment_id === e.id)
      .sort((a, b) => (b.filled_at || '').localeCompare(a.filled_at || ''))[0];
    if (lastFuel && lastFuel.quantity && e.tank_capacity_l) {
      const pctFilled = r2((lastFuel.quantity / e.tank_capacity_l) * 100);
      if (pctFilled < fuelLowThresholdPercent) {
        alerts.push({ category: 'low_fuel', severity: 'warning', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `آخر تعبئة وقود كانت منخفضة (${pctFilled}% من سعة الخزان)` });
      }
    }
  }

  for (const e of equipmentList) {
    const hasLogs = Object.values(store.fuelLogs).some(f => f.equipment_id === e.id);
    if (!hasLogs) continue;
    try {
      const stats = getFuelStats(e.id, { period: 'month' }).data;
      for (const anomaly of stats.abnormal_consumption_entries) {
        alerts.push({ category: 'high_fuel_consumption', severity: 'warning', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `استهلاك وقود غير طبيعي بتاريخ ${eqDateOnly(anomaly.filled_at)} (${anomaly.quantity} مقابل متوسط ${anomaly.average_quantity})` });
      }
    } catch (_) { /* تجاهل معدة بدون بيانات كافية */ }
  }

  const recentCutoff = new Date(today); recentCutoff.setDate(recentCutoff.getDate() - 3);
  const recentFaults = Object.values(store.maintenanceRecords).filter(
    m => m.maintenance_type === 'emergency' && new Date(m.started_at) >= recentCutoff
  );
  for (const f of recentFaults) {
    const e = store.equipment[f.equipment_id];
    if (!e) continue;
    alerts.push({ category: 'new_fault', severity: f.severity === 'critical' ? 'critical' : 'warning', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `عطل جديد مسجّل: ${f.fault_description || ''}`, details: { maintenance_record_id: f.id } });
  }

  const openMaint = Object.values(store.maintenanceRecords).filter(
    m => ['scheduled', 'in_progress'].includes(m.status) && new Date(m.started_at) <= recentCutoff
  );
  for (const m of openMaint) {
    const e = store.equipment[m.equipment_id];
    if (!e) continue;
    alerts.push({ category: 'repair_delayed', severity: 'critical', equipment_id: e.id, equipment_name: e.name, equipment_code: e.code, message: `إصلاح متأخر منذ ${eqDateOnly(m.started_at)} ولم يكتمل بعد`, details: { maintenance_record_id: m.id } });
  }

  const licenseAlerts = getOperatorLicenseAlerts({ withinDays }).data;
  for (const a of licenseAlerts) {
    alerts.push({
      category: a.status === 'expired' ? 'operator_license_expired' : 'operator_license_expiring',
      severity: a.status === 'expired' ? 'critical' : 'warning',
      operator_id: a.operator_id, operator_name: a.operator_name,
      message: a.status === 'expired' ? `انتهت رخصة المشغّل ${a.operator_name}` : `تنتهي رخصة المشغّل ${a.operator_name} خلال ${withinDays} يوم`,
      details: a,
    });
  }

  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;

  return {
    success: true,
    data: {
      count: alerts.length,
      by_severity: bySeverity,
      alerts: alerts.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      }),
    },
  };
}

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
  MAINTENANCE_FREQUENCIES,
  MAINTENANCE_FREQUENCY_LABELS,
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_SEVERITY_LABELS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  LICENSE_TYPES,
  LICENSE_TYPE_LABELS,

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

  // ----- الجزء الثاني -----
  // إدارة الوقود
  logFuelEntry,
  listFuelLogs,
  getFuelStats,

  // إدارة الصيانة - الجدولة الدورية
  createMaintenanceSchedule,
  listMaintenanceSchedules,
  updateMaintenanceSchedule,
  deleteMaintenanceSchedule,
  getUpcomingMaintenanceAlerts,

  // إدارة الصيانة - السجلات (دورية/طارئة)
  createMaintenanceRecord,
  updateMaintenanceRecord,
  listMaintenanceRecords,
  getMaintenanceStats,

  // إدارة قطع الغيار
  createSparePart,
  listSpareParts,
  updateSparePart,
  deleteSparePart,
  restockSparePart,
  getLowStockParts,

  // إدارة المشغلين
  createOperator,
  listOperators,
  getOperator,
  updateOperator,
  deleteOperator,
  addOperatorViolation,
  rateOperatorPerformance,
  getOperatorLicenseAlerts,

  // لوحة معلومات أساسية
  getBasicDashboard,

  // ----- الجزء الثالث -----
  // إدارة التكاليف
  getEquipmentCostBreakdown,
  getFleetCostSummary,
  logTransportCost,

  // إدارة الإنتاجية
  getEquipmentProductivity,
  compareEquipmentProductivity,

  // مركز التنبيهات الموحّد
  getAlertsCenter,
};
