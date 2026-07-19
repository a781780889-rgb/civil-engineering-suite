/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * الجزء (4/4) - وحدة إدارة المواد الخطرة (Hazardous Materials Management)
 * =====================================================================================
 * تشمل: تسجيل المواد الخطرة، بطاقات بيانات السلامة (SDS)، أماكن التخزين،
 * طرق النقل، تعليمات الاستخدام، معدات الوقاية المطلوبة، إجراءات الطوارئ،
 * التخلص الآمن من المواد، وسجل حركة المخزون (استلام/صرف/تخلص).
 *
 * التخزين: ملف JSON منفصل (backend/data/hseHazmat.json) بنفس نمط
 * hseManagement.js / hseEmergency.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 45001، OSHA Hazard Communication Standard (HazCom -
 * 29 CFR 1910.1200) الخاص ببطاقات بيانات السلامة (SDS) وتصنيف GHS.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل مادة خطرة (hazmatItem) لها تصنيف مخاطر GHS فعلي، وكمية مخزون تُحسب
 *    ديناميكياً من سجل الحركات (استلام - صرف - تخلص) وليست قيمة يدوية ثابتة.
 *  - لا يمكن إنشاء مادة خطرة دون بطاقة بيانات سلامة (SDS) أساسية (رقم/تاريخ
 *    إصدار/جهة إصدار) لأن هذا شرط إلزامي في OSHA HazCom.
 *  - سجل التخلص الآمن (disposal) يُنقص الكمية فعلياً من المخزون ولا يمكن
 *    التخلص من كمية أكبر من الرصيد المتاح.
 *  - تنبيهات فعلية: SDS منتهية الصلاحية (تراجع دوري)، مخزون أقل من الحد
 *    الأدنى، مواد قاربت تاريخ انتهاء صلاحيتها.
 *  - جميع العمليات تُسجَّل في سجل تدقيق (Audit Log) منفصل لهذه الوحدة.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hseHazmat.json');

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
      hazmatItems: {},        // { id: itemRecord }           (المادة الخطرة + SDS + التخزين/النقل/PPE/الطوارئ)
      hazmatMovements: {},    // { id: movementRecord }       (سجل حركة المخزون: استلام/صرف/تخلص/تعديل جرد)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة المواد الخطرة: ' + e.message);
  }
  let migrated = false;
  for (const key of ['hazmatItems', 'hazmatMovements']) {
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

const GHS_HAZARD_CLASSES = [
  'flammable', 'oxidizing', 'explosive', 'corrosive', 'toxic',
  'irritant', 'health_hazard', 'environmental_hazard', 'compressed_gas', 'other',
];
const GHS_HAZARD_CLASS_LABELS = {
  flammable: 'قابل للاشتعال',
  oxidizing: 'مؤكسد',
  explosive: 'متفجر',
  corrosive: 'أكّال (Corrosive)',
  toxic: 'سام',
  irritant: 'مهيّج',
  health_hazard: 'خطر صحي',
  environmental_hazard: 'خطر بيئي',
  compressed_gas: 'غاز مضغوط',
  other: 'أخرى',
};

const STORAGE_CONDITIONS = ['ventilated_store', 'flammable_cabinet', 'cold_storage', 'segregated_outdoor', 'gas_cylinder_rack', 'general_store'];
const STORAGE_CONDITION_LABELS = {
  ventilated_store: 'مخزن جيد التهوية',
  flammable_cabinet: 'خزانة مواد قابلة للاشتعال',
  cold_storage: 'تخزين مبرد',
  segregated_outdoor: 'تخزين خارجي معزول',
  gas_cylinder_rack: 'حامل أسطوانات غاز',
  general_store: 'مخزن عام',
};

const TRANSPORT_METHODS = ['closed_container_truck', 'hazmat_certified_vehicle', 'manual_handling', 'forklift', 'gas_cylinder_trolley', 'other'];
const TRANSPORT_METHOD_LABELS = {
  closed_container_truck: 'شاحنة حاويات مغلقة',
  hazmat_certified_vehicle: 'مركبة معتمدة لنقل المواد الخطرة',
  manual_handling: 'نقل يدوي (كميات صغيرة)',
  forklift: 'رافعة شوكية',
  gas_cylinder_trolley: 'عربة نقل أسطوانات الغاز',
  other: 'أخرى',
};

const HAZMAT_ITEM_STATUSES = ['active', 'quarantined', 'depleted', 'discontinued'];
const HAZMAT_ITEM_STATUS_LABELS = {
  active: 'نشطة (متاحة للاستخدام)',
  quarantined: 'محجوزة (بانتظار فحص/قرار)',
  depleted: 'نفدت الكمية',
  discontinued: 'موقوفة نهائياً',
};

const MOVEMENT_TYPES = ['receipt', 'issue', 'disposal', 'adjustment'];
const MOVEMENT_TYPE_LABELS = {
  receipt: 'استلام (توريد)',
  issue: 'صرف للاستخدام',
  disposal: 'تخلص آمن',
  adjustment: 'تعديل جرد',
};

const DISPOSAL_METHODS = ['licensed_contractor', 'incineration', 'neutralization', 'return_to_supplier', 'other'];
const DISPOSAL_METHOD_LABELS = {
  licensed_contractor: 'مقاول تخلص مرخّص',
  incineration: 'حرق آمن (Incineration)',
  neutralization: 'معادلة كيميائية',
  return_to_supplier: 'إعادة للمورّد',
  other: 'أخرى',
};

const QUANTITY_UNITS = ['kg', 'liter', 'drum', 'cylinder', 'bag', 'ton'];

// ===================== دوال مساعدة للحسابات =====================

/** حساب الكمية الحالية فعلياً من مجموع حركات الاستلام ناقص (الصرف + التخلص) مع مراعاة تعديلات الجرد */
function computeCurrentQuantity(store, itemId) {
  const movements = Object.values(store.hazmatMovements).filter((m) => m.item_id === itemId);
  let qty = 0;
  for (const m of movements) {
    if (m.type === 'receipt') qty += Number(m.quantity) || 0;
    else if (m.type === 'issue' || m.type === 'disposal') qty -= Number(m.quantity) || 0;
    else if (m.type === 'adjustment') qty += Number(m.quantity) || 0; // يمكن أن تكون سالبة أو موجبة
  }
  return r2(Math.max(0, qty));
}

function sdsStatus(item) {
  if (!item.sds_review_date) return 'unknown';
  const days = daysBetween(item.sds_review_date, new Date().toISOString().slice(0, 10));
  if (days < 0) return 'valid';
  if (days <= 60) return 'due_soon';
  return 'expired';
}
const SDS_STATUS_LABELS = { valid: 'سارية', due_soon: 'تقترب من موعد المراجعة', expired: 'متأخرة عن المراجعة', unknown: 'غير محددة' };

function stockStatus(item, currentQty) {
  const min = Number(item.min_stock_level) || 0;
  if (currentQty <= 0) return 'out_of_stock';
  if (currentQty <= min) return 'below_minimum';
  return 'sufficient';
}
const STOCK_STATUS_LABELS = { out_of_stock: 'نفدت الكمية', below_minimum: 'أقل من الحد الأدنى', sufficient: 'كافية' };

function enrichItem(store, item) {
  const currentQty = computeCurrentQuantity(store, item.id);
  return {
    ...item,
    current_quantity: currentQty,
    sds_status: sdsStatus(item),
    sds_status_label: SDS_STATUS_LABELS[sdsStatus(item)],
    stock_status: stockStatus(item, currentQty),
    stock_status_label: STOCK_STATUS_LABELS[stockStatus(item, currentQty)],
  };
}

// ===================== التحقق من صحة المدخلات =====================

function validateHazmatItemInput(body) {
  const errors = [];
  if (!body.name || !String(body.name).trim()) errors.push('اسم المادة الخطرة مطلوب');
  if (!body.hazard_class) errors.push('تصنيف الخطر (GHS) مطلوب');
  if (body.hazard_class && !GHS_HAZARD_CLASSES.includes(body.hazard_class)) errors.push('تصنيف الخطر غير صالح');
  if (!body.unit) errors.push('وحدة القياس مطلوبة');
  if (body.unit && !QUANTITY_UNITS.includes(body.unit)) errors.push('وحدة القياس غير صالحة');
  // شرط إلزامي: بطاقة بيانات سلامة (SDS) أساسية - وفق OSHA HazCom
  if (!body.sds_number || !String(body.sds_number).trim()) errors.push('رقم بطاقة بيانات السلامة (SDS) مطلوب');
  if (!body.sds_issue_date) errors.push('تاريخ إصدار بطاقة بيانات السلامة (SDS) مطلوب');
  if (!body.sds_issuer || !String(body.sds_issuer).trim()) errors.push('جهة إصدار بطاقة بيانات السلامة (SDS) مطلوبة');
  if (!body.storage_condition) errors.push('شرط التخزين مطلوب');
  if (body.storage_condition && !STORAGE_CONDITIONS.includes(body.storage_condition)) errors.push('شرط التخزين غير صالح');
  return errors;
}

function validateMovementInput(body) {
  const errors = [];
  if (!body.item_id) errors.push('معرّف المادة الخطرة (item_id) مطلوب');
  if (!body.type || !MOVEMENT_TYPES.includes(body.type)) errors.push('نوع الحركة غير صالح');
  if (body.quantity === undefined || body.quantity === null || Number.isNaN(Number(body.quantity))) errors.push('الكمية مطلوبة ويجب أن تكون رقمية');
  if (body.type !== 'adjustment' && Number(body.quantity) <= 0) errors.push('الكمية يجب أن تكون أكبر من صفر');
  if (body.type === 'disposal' && !body.disposal_method) errors.push('طريقة التخلص الآمن مطلوبة');
  if (body.type === 'disposal' && body.disposal_method && !DISPOSAL_METHODS.includes(body.disposal_method)) errors.push('طريقة التخلص غير صالحة');
  return errors;
}

// ===================== إدارة المواد الخطرة (CRUD) =====================

function createHazmatItem(body) {
  const errors = validateHazmatItemInput(body);
  if (errors.length) throw new Error(errors.join(' | '));
  const store = loadStore();
  const id = newId('HZM');
  const code = generateCode(store, 'HZM');
  const record = {
    id,
    code,
    project_id: body.project_id || null,
    name: String(body.name).trim(),
    cas_number: body.cas_number || null,
    hazard_class: body.hazard_class,
    hazard_class_secondary: Array.isArray(body.hazard_class_secondary)
      ? body.hazard_class_secondary.filter((h) => GHS_HAZARD_CLASSES.includes(h))
      : [],
    unit: body.unit,
    min_stock_level: Number(body.min_stock_level) || 0,
    expiry_date: body.expiry_date || null,

    // بطاقة بيانات السلامة (SDS)
    sds_number: String(body.sds_number).trim(),
    sds_issue_date: body.sds_issue_date,
    sds_issuer: String(body.sds_issuer).trim(),
    sds_review_date: body.sds_review_date || null,
    sds_file_ref: body.sds_file_ref || null,

    // أماكن التخزين
    storage_location: body.storage_location || null,
    storage_condition: body.storage_condition,
    storage_capacity_max: body.storage_capacity_max != null ? Number(body.storage_capacity_max) : null,
    incompatible_materials: body.incompatible_materials || null,

    // طرق النقل
    transport_method: TRANSPORT_METHODS.includes(body.transport_method) ? body.transport_method : null,
    transport_precautions: body.transport_precautions || null,

    // تعليمات الاستخدام
    usage_instructions: body.usage_instructions || null,

    // معدات الوقاية المطلوبة (نص حر مرتبط اختيارياً بوحدة PPE في hseManagement)
    required_ppe: Array.isArray(body.required_ppe) ? body.required_ppe : [],
    required_ppe_notes: body.required_ppe_notes || null,

    // إجراءات الطوارئ الخاصة بهذه المادة
    emergency_procedures: body.emergency_procedures || null,
    first_aid_measures: body.first_aid_measures || null,
    spill_response: body.spill_response || null,
    fire_fighting_measures: body.fire_fighting_measures || null,

    // التخلص الآمن
    disposal_instructions: body.disposal_instructions || null,

    status: 'active',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.hazmatItems[id] = record;

  // حركة افتتاحية اختيارية إن زُوّد رصيد بداية
  if (body.opening_quantity && Number(body.opening_quantity) > 0) {
    const movId = newId('HZMOV');
    store.hazmatMovements[movId] = {
      id: movId,
      item_id: id,
      type: 'receipt',
      quantity: Number(body.opening_quantity),
      reference: 'رصيد افتتاحي',
      moved_by: body.created_by || null,
      moved_at: nowISO(),
      notes: 'رصيد افتتاحي عند تسجيل المادة',
    };
  }

  audit(store, { action: 'create', entity: 'hazmatItem', entityId: id, projectId: record.project_id, details: { name: record.name, code } });
  saveStore(store);
  return { success: true, data: enrichItem(store, record) };
}

function listHazmatItems(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.hazmatItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  if (filters.hazardClass) items = items.filter((i) => i.hazard_class === filters.hazardClass || (i.hazard_class_secondary || []).includes(filters.hazardClass));
  if (filters.status) items = items.filter((i) => i.status === filters.status);
  if (filters.storageCondition) items = items.filter((i) => i.storage_condition === filters.storageCondition);
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q) || (i.cas_number || '').toLowerCase().includes(q));
  }
  let enriched = items.map((i) => enrichItem(store, i));
  if (filters.stockStatus) enriched = enriched.filter((i) => i.stock_status === filters.stockStatus);
  if (filters.sdsStatus) enriched = enriched.filter((i) => i.sds_status === filters.sdsStatus);
  enriched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: enriched, total: enriched.length };
}

function getHazmatItem(id) {
  const store = loadStore();
  const item = store.hazmatItems[id];
  if (!item) throw new Error('المادة الخطرة غير موجودة');
  const movements = Object.values(store.hazmatMovements)
    .filter((m) => m.item_id === id)
    .sort((a, b) => new Date(b.moved_at) - new Date(a.moved_at));
  return { success: true, data: { ...enrichItem(store, item), movements } };
}

function updateHazmatItem(id, updates) {
  const store = loadStore();
  const item = store.hazmatItems[id];
  if (!item) throw new Error('المادة الخطرة غير موجودة');
  const merged = { ...item, ...updates, id: item.id, code: item.code };
  const errors = validateHazmatItemInput(merged);
  if (errors.length) throw new Error(errors.join(' | '));
  merged.updated_at = nowISO();
  store.hazmatItems[id] = merged;
  audit(store, { action: 'update', entity: 'hazmatItem', entityId: id, projectId: merged.project_id, details: { fields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: enrichItem(store, merged) };
}

function deleteHazmatItem(id) {
  const store = loadStore();
  const item = store.hazmatItems[id];
  if (!item) throw new Error('المادة الخطرة غير موجودة');
  const hasMovements = Object.values(store.hazmatMovements).some((m) => m.item_id === id);
  if (hasMovements) throw new Error('لا يمكن حذف مادة خطرة لها سجل حركات مخزون؛ يمكن إيقافها (discontinued) بدلاً من الحذف');
  delete store.hazmatItems[id];
  audit(store, { action: 'delete', entity: 'hazmatItem', entityId: id, projectId: item.project_id, details: { name: item.name } });
  saveStore(store);
  return { success: true };
}

// ===================== سجل حركة المخزون =====================

function createMovement(body) {
  const errors = validateMovementInput(body);
  if (errors.length) throw new Error(errors.join(' | '));
  const store = loadStore();
  const item = store.hazmatItems[body.item_id];
  if (!item) throw new Error('المادة الخطرة غير موجودة');

  if (body.type === 'issue' || body.type === 'disposal') {
    const currentQty = computeCurrentQuantity(store, body.item_id);
    if (Number(body.quantity) > currentQty) {
      throw new Error(`الكمية المطلوبة (${body.quantity}) أكبر من الرصيد المتاح حالياً (${currentQty} ${item.unit})`);
    }
  }

  const id = newId('HZMOV');
  const record = {
    id,
    item_id: body.item_id,
    project_id: body.project_id || item.project_id || null,
    type: body.type,
    quantity: Number(body.quantity),
    reference: body.reference || null,
    disposal_method: body.type === 'disposal' ? body.disposal_method : null,
    disposal_certificate_ref: body.type === 'disposal' ? (body.disposal_certificate_ref || null) : null,
    issued_to: body.type === 'issue' ? (body.issued_to || null) : null,
    moved_by: body.moved_by || null,
    moved_at: body.moved_at || nowISO(),
    notes: body.notes || null,
  };
  store.hazmatMovements[id] = record;

  // تحديث حالة المادة تلقائياً إذا نفدت الكمية
  const newQty = computeCurrentQuantity(store, body.item_id);
  if (newQty <= 0 && item.status === 'active') {
    store.hazmatItems[body.item_id] = { ...item, status: 'depleted', updated_at: nowISO() };
  } else if (newQty > 0 && item.status === 'depleted') {
    store.hazmatItems[body.item_id] = { ...item, status: 'active', updated_at: nowISO() };
  }

  audit(store, {
    action: 'create',
    entity: 'hazmatMovement',
    entityId: id,
    projectId: record.project_id,
    details: { itemId: body.item_id, type: body.type, quantity: record.quantity },
  });
  saveStore(store);
  return { success: true, data: record, current_quantity: newQty };
}

function listMovements(filters = {}) {
  const store = loadStore();
  let movements = Object.values(store.hazmatMovements);
  if (filters.itemId) movements = movements.filter((m) => m.item_id === filters.itemId);
  if (filters.projectId) movements = movements.filter((m) => m.project_id === filters.projectId);
  if (filters.type) movements = movements.filter((m) => m.type === filters.type);
  if (filters.dateFrom) movements = movements.filter((m) => m.moved_at >= filters.dateFrom);
  if (filters.dateTo) movements = movements.filter((m) => m.moved_at <= filters.dateTo);
  movements.sort((a, b) => new Date(b.moved_at) - new Date(a.moved_at));
  return { success: true, data: movements, total: movements.length };
}

function deleteMovement(id) {
  const store = loadStore();
  const mov = store.hazmatMovements[id];
  if (!mov) throw new Error('سجل الحركة غير موجود');
  delete store.hazmatMovements[id];
  const item = store.hazmatItems[mov.item_id];
  if (item) {
    const newQty = computeCurrentQuantity(store, mov.item_id);
    if (newQty > 0 && item.status === 'depleted') {
      store.hazmatItems[mov.item_id] = { ...item, status: 'active', updated_at: nowISO() };
    }
  }
  audit(store, { action: 'delete', entity: 'hazmatMovement', entityId: id, projectId: mov.project_id, details: { itemId: mov.item_id, type: mov.type } });
  saveStore(store);
  return { success: true };
}

// ===================== تنبيهات =====================

function getExpiringSds(filters = {}) {
  const store = loadStore();
  const withinDays = filters.withinDays != null ? Number(filters.withinDays) : 60;
  let items = Object.values(store.hazmatItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  const today = new Date().toISOString().slice(0, 10);
  const result = items
    .filter((i) => i.sds_review_date)
    .map((i) => ({ ...enrichItem(store, i), days_until_review: daysBetween(i.sds_review_date, today) * -1 }))
    .filter((i) => i.days_until_review <= withinDays)
    .sort((a, b) => a.days_until_review - b.days_until_review);
  return { success: true, data: result, total: result.length };
}

function getLowStockItems(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.hazmatItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  const result = items
    .map((i) => enrichItem(store, i))
    .filter((i) => i.stock_status === 'below_minimum' || i.stock_status === 'out_of_stock')
    .sort((a, b) => a.current_quantity - b.current_quantity);
  return { success: true, data: result, total: result.length };
}

function getExpiringMaterials(filters = {}) {
  const store = loadStore();
  const withinDays = filters.withinDays != null ? Number(filters.withinDays) : 60;
  let items = Object.values(store.hazmatItems);
  if (filters.projectId) items = items.filter((i) => i.project_id === filters.projectId);
  const today = new Date().toISOString().slice(0, 10);
  const result = items
    .filter((i) => i.expiry_date)
    .map((i) => ({ ...enrichItem(store, i), days_until_expiry: daysBetween(i.expiry_date, today) * -1 }))
    .filter((i) => i.days_until_expiry <= withinDays)
    .sort((a, b) => a.days_until_expiry - b.days_until_expiry);
  return { success: true, data: result, total: result.length };
}

// ===================== لوحة المعلومات =====================

function getHazmatDashboard(projectId = null) {
  const store = loadStore();
  let items = Object.values(store.hazmatItems);
  if (projectId) items = items.filter((i) => i.project_id === projectId);
  const enriched = items.map((i) => enrichItem(store, i));

  const byHazardClass = {};
  for (const cls of GHS_HAZARD_CLASSES) byHazardClass[cls] = 0;
  for (const i of enriched) {
    byHazardClass[i.hazard_class] = (byHazardClass[i.hazard_class] || 0) + 1;
    for (const sec of i.hazard_class_secondary || []) byHazardClass[sec] = (byHazardClass[sec] || 0) + 1;
  }

  const byStorageCondition = {};
  for (const cond of STORAGE_CONDITIONS) byStorageCondition[cond] = 0;
  for (const i of enriched) byStorageCondition[i.storage_condition] = (byStorageCondition[i.storage_condition] || 0) + 1;

  let movements = Object.values(store.hazmatMovements);
  if (projectId) movements = movements.filter((m) => m.project_id === projectId);
  const recentMovements = movements.sort((a, b) => new Date(b.moved_at) - new Date(a.moved_at)).slice(0, 10);

  return {
    success: true,
    data: {
      total_items: enriched.length,
      active_items: enriched.filter((i) => i.status === 'active').length,
      quarantined_items: enriched.filter((i) => i.status === 'quarantined').length,
      depleted_items: enriched.filter((i) => i.status === 'depleted').length,
      below_minimum_stock: enriched.filter((i) => i.stock_status === 'below_minimum').length,
      out_of_stock: enriched.filter((i) => i.stock_status === 'out_of_stock').length,
      sds_due_soon: enriched.filter((i) => i.sds_status === 'due_soon').length,
      sds_expired: enriched.filter((i) => i.sds_status === 'expired').length,
      total_disposals: movements.filter((m) => m.type === 'disposal').length,
      by_hazard_class: byHazardClass,
      by_storage_condition: byStorageCondition,
      recent_movements: recentMovements,
    },
  };
}

// ===================== التصدير =====================

module.exports = {
  GHS_HAZARD_CLASSES,
  GHS_HAZARD_CLASS_LABELS,
  STORAGE_CONDITIONS,
  STORAGE_CONDITION_LABELS,
  TRANSPORT_METHODS,
  TRANSPORT_METHOD_LABELS,
  HAZMAT_ITEM_STATUSES,
  HAZMAT_ITEM_STATUS_LABELS,
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  DISPOSAL_METHODS,
  DISPOSAL_METHOD_LABELS,
  QUANTITY_UNITS,
  SDS_STATUS_LABELS,
  STOCK_STATUS_LABELS,

  createHazmatItem,
  listHazmatItems,
  getHazmatItem,
  updateHazmatItem,
  deleteHazmatItem,

  createMovement,
  listMovements,
  deleteMovement,

  getExpiringSds,
  getLowStockItems,
  getExpiringMaterials,

  getHazmatDashboard,
};
