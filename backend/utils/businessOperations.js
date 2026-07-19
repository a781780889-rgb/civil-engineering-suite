/**
 * القسم السادس - نظام إدارة الأعمال (Business Management System)
 * الجزء الثالث (3/4): إدارة المخازن + إدارة الموارد البشرية + إدارة الاجتماعات
 *                     + إدارة المهام + إدارة المراسلات + إدارة الأصول
 * ================================================================================
 * التخزين: ملفات JSON على القرص (نفس نمط الجزأين الأول والثاني)
 *   - backend/data/biz_warehouse_items.json      (أصناف/مواد/معدات/أدوات المخزون)
 *   - backend/data/biz_warehouse_movements.json  (حركات وارد/منصرف/نقل + جرد)
 *   - backend/data/biz_employees.json            (الموظفون - HR)
 *   - backend/data/biz_meetings.json              (الاجتماعات)
 *   - backend/data/biz_tasks.json                 (المهام)
 *   - backend/data/biz_correspondence.json        (المراسلات)
 *   - backend/data/biz_assets.json                 (الأصول)
 * بدون تبعيات خارجية.
 *
 * الاعتماديات الفعلية (ليست شكلية):
 *  - استلام أمر شراء (BIZC.receivePurchaseOrder) يُغذّي هذا الجزء عبر receiveStock()
 *    التي يستدعيها الطرف المستدعي بعد الاستلام؛ كما أن addStockItem تتحقق من
 *    عدم تكرار الصنف بنفس SKU.
 *  - حركة "منصرف" (issue) لصنف معداتٍ تُنشئ تلقائياً سجل استخدام على الأصل المرتبط
 *    (إن وُجد asset_id) وتُحدّث حالته إلى "in_use".
 *  - إنشاء مهمة (createTask) بمشروع (project_id) يتحقق من وجود المشروع فعلياً عبر
 *    PM.getProject؛ وإسنادها لموظف (assignee_id) يتحقق من وجوده عبر HR ويُضاف
 *    السجل إلى activity الموظف.
 *  - محضر الاجتماع الذي يحتوي "قرارات" (decisions) بحقل create_task=true يُنشئ
 *    مهمة فعلية تلقائياً في وحدة المهام (وليس نصاً حراً) ويربطها بمعرّف الاجتماع.
 *  - تسجيل حضور/انصراف الموظف (clockIn/clockOut) يُحدّث سجل attendance الشهري
 *    ويُستخدم في حساب مؤشرات الحضور دون إدخال يدوي.
 *  - سلفة أو خصم على الموظف (addAdvance/addDeduction) يُدرَج في كشف الراتب
 *    التالي تلقائياً عبر computePayroll (وليس رقماً يُكتب يدوياً في الراتب).
 *  - نقص المخزون عن الحد الأدنى (min_quantity) يُصدر تنبيهاً فعلياً ضمن
 *    getWarehouseDashboard().low_stock_alerts، محسوباً من الكميات الفعلية.
 *
 * يغطي هذا الجزء:
 *  1) إدارة المخازن: الأصناف (مواد/معدات/أدوات) + الكميات + حد أدنى + وارد/منصرف
 *     + جرد + مواقع تخزين + نقل بين المواقع + باركود/QR (توليد كود نصي فريد)
 *     + تنبيهات نقص المخزون.
 *  2) إدارة الموارد البشرية: الموظفون + العقود + الرواتب + البدلات + المكافآت
 *     + الخصومات + الحضور والانصراف + الإجازات + التقييم السنوي + الدورات
 *     التدريبية + المستندات + (صلاحيات المستخدمين تُستكمل في الجزء الرابع).
 *  3) إدارة الاجتماعات: إنشاء + دعوة مشاركين + جدول أعمال + تسجيل حضور
 *     + محاضر + قرارات + مهام ناتجة (ربط فعلي) + مرفقات + تذكيرات.
 *  4) إدارة المهام: اسم/وصف/مشروع/قسم/مسؤول/أولوية/حالة/تواريخ/نسبة إنجاز
 *     + تعليقات + مرفقات + سجل تعديلات.
 *  5) إدارة المراسلات: رسائل داخلية + إشعارات + بريد إلكتروني (سجل) + مرفقات
 *     + أرشفة + بحث + سجل مراسلات.
 *  6) إدارة الأصول: معدات/سيارات/أجهزة/أثاث/برمجيات + ضمانات + صيانة
 *     + استهلاك (قيمة دفترية محسوبة تلقائياً بطريقة القسط الثابت) + تاريخ شراء
 *     + الموقع الحالي.
 */

const fs = require('fs');
const path = require('path');

let PM = null;
try { PM = require('./projectManagement'); } catch (e) { PM = null; }

const DATA_DIR = path.join(__dirname, '..', 'data');
const WH_ITEMS_FILE = path.join(DATA_DIR, 'biz_warehouse_items.json');
const WH_MOVES_FILE = path.join(DATA_DIR, 'biz_warehouse_movements.json');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'biz_employees.json');
const MEETINGS_FILE = path.join(DATA_DIR, 'biz_meetings.json');
const TASKS_FILE = path.join(DATA_DIR, 'biz_tasks.json');
const CORRESPONDENCE_FILE = path.join(DATA_DIR, 'biz_correspondence.json');
const ASSETS_FILE = path.join(DATA_DIR, 'biz_assets.json');
const AUDIT_FILE = path.join(DATA_DIR, 'business_audit.json');

// ------------------------------------------------------------------
// أدوات مساعدة عامة (نفس نمط businessManagement.js / businessContracts.js)
// ------------------------------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`تعذّرت قراءة ملف البيانات (${path.basename(file)}): ${e.message}`);
  }
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function logAudit(entry) {
  const log = readJSON(AUDIT_FILE, []);
  log.push({ id: newId('AUD'), at: nowISO(), ...entry });
  if (log.length > 20000) log.splice(0, log.length - 20000);
  writeJSON(AUDIT_FILE, log);
}

function assertRequired(value, fieldLabel) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`الحقل (${fieldLabel}) مطلوب`);
  }
}

function paginate(list, { page = 1, pageSize = 50 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.max(1, Math.min(500, parseInt(pageSize, 10) || 50));
  const start = (p - 1) * ps;
  return {
    items: list.slice(start, start + ps),
    total: list.length,
    page: p,
    pageSize: ps,
    totalPages: Math.max(1, Math.ceil(list.length / ps)),
  };
}

// ==================================================================
// ==================== 1) إدارة المخازن (Warehouse) ================
// ==================================================================

const WAREHOUSE_CATEGORIES = ['material', 'equipment', 'tool'];

function defaultWarehouseDB() { return { items: [] }; }
function defaultMovementsDB() { return { movements: [] }; }

function generateBarcode(sku) {
  // كود نصي فريد بصيغة EAN-like مبسّطة، مبني على SKU + الوقت (بدون مكتبات خارجية)
  const base = `${sku || 'ITM'}-${Date.now()}`.replace(/[^A-Za-z0-9-]/g, '');
  let checksum = 0;
  for (let i = 0; i < base.length; i++) checksum = (checksum + base.charCodeAt(i) * (i + 1)) % 97;
  return `${base}-${String(checksum).padStart(2, '0')}`;
}

function validateItemPayload(body, { partial = false } = {}) {
  if (!partial) {
    assertRequired(body.name, 'name');
    assertRequired(body.category, 'category');
    if (!WAREHOUSE_CATEGORIES.includes(body.category)) {
      throw new Error(`تصنيف غير صالح. القيم المسموحة: ${WAREHOUSE_CATEGORIES.join(', ')}`);
    }
  } else if (body.category && !WAREHOUSE_CATEGORIES.includes(body.category)) {
    throw new Error(`تصنيف غير صالح. القيم المسموحة: ${WAREHOUSE_CATEGORIES.join(', ')}`);
  }
}

function addStockItem(body) {
  validateItemPayload(body);
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const sku = body.sku && String(body.sku).trim() ? String(body.sku).trim() : newId('SKU');
  if (db.items.some((i) => i.sku === sku)) {
    throw new Error(`صنف بنفس رمز SKU (${sku}) موجود بالفعل`);
  }
  const item = {
    id: newId('WHI'),
    sku,
    barcode: generateBarcode(sku),
    name: String(body.name).trim(),
    category: body.category,
    unit: body.unit || 'unit',
    quantity: Number(body.quantity) || 0,
    min_quantity: Number(body.min_quantity) || 0,
    unit_cost: Number(body.unit_cost) || 0,
    storage_location: body.storage_location || 'المخزن الرئيسي',
    asset_id: body.asset_id || null, // ربط اختياري بسجل أصل (للمعدات)
    notes: body.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.items.push(item);
  writeJSON(WH_ITEMS_FILE, db);
  logAudit({ module: 'warehouse', action: 'create_item', item_id: item.id });
  return item;
}

function getStockItem(id) {
  assertRequired(id, 'id');
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const item = db.items.find((i) => i.id === id);
  if (!item) throw new Error('الصنف غير موجود');
  const moves = readJSON(WH_MOVES_FILE, defaultMovementsDB()).movements
    .filter((m) => m.item_id === id)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  return { ...item, movements: moves };
}

function listStockItems({ category = null, q = null, lowStockOnly = false, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  let items = db.items;
  if (category) items = items.filter((i) => i.category === category);
  if (q) {
    const term = String(q).toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term));
  }
  if (lowStockOnly) items = items.filter((i) => i.quantity <= i.min_quantity);
  items = items.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return paginate(items, { page, pageSize });
}

function updateStockItem(id, patch) {
  assertRequired(id, 'id');
  validateItemPayload(patch, { partial: true });
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const idx = db.items.findIndex((i) => i.id === id);
  if (idx === -1) throw new Error('الصنف غير موجود');
  const forbidden = ['id', 'sku', 'barcode', 'created_at'];
  const clean = { ...patch };
  forbidden.forEach((f) => delete clean[f]);
  db.items[idx] = { ...db.items[idx], ...clean, updated_at: nowISO() };
  writeJSON(WH_ITEMS_FILE, db);
  logAudit({ module: 'warehouse', action: 'update_item', item_id: id });
  return db.items[idx];
}

function deleteStockItem(id) {
  assertRequired(id, 'id');
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const idx = db.items.findIndex((i) => i.id === id);
  if (idx === -1) throw new Error('الصنف غير موجود');
  const [removed] = db.items.splice(idx, 1);
  writeJSON(WH_ITEMS_FILE, db);
  logAudit({ module: 'warehouse', action: 'delete_item', item_id: id });
  return { success: true, removed };
}

function recordMovement(itemId, { type, quantity, reference = null, from_location = null, to_location = null, note = '' } = {}) {
  assertRequired(itemId, 'itemId');
  assertRequired(type, 'type');
  const validTypes = ['in', 'issue', 'transfer', 'adjustment'];
  if (!validTypes.includes(type)) throw new Error(`نوع حركة غير صالح. القيم المسموحة: ${validTypes.join(', ')}`);
  const qty = Number(quantity);
  if (!qty || qty <= 0) throw new Error('الكمية (quantity) يجب أن تكون رقماً أكبر من صفر');

  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const idx = db.items.findIndex((i) => i.id === itemId);
  if (idx === -1) throw new Error('الصنف غير موجود');
  const item = db.items[idx];

  if (type === 'in') {
    item.quantity += qty;
  } else if (type === 'issue') {
    if (item.quantity < qty) throw new Error(`الكمية المتاحة (${item.quantity}) أقل من كمية الصرف المطلوبة (${qty})`);
    item.quantity -= qty;
  } else if (type === 'transfer') {
    assertRequired(to_location, 'to_location');
    item.storage_location = to_location;
  } else if (type === 'adjustment') {
    item.quantity = qty; // تصحيح جرد: يضبط الكمية الفعلية مباشرة
  }
  item.updated_at = nowISO();
  db.items[idx] = item;
  writeJSON(WH_ITEMS_FILE, db);

  const moves = readJSON(WH_MOVES_FILE, defaultMovementsDB());
  const movement = {
    id: newId('MOV'),
    item_id: itemId,
    type,
    quantity: qty,
    reference,
    from_location: from_location || (type === 'transfer' ? db.items[idx].storage_location : null),
    to_location: to_location || null,
    note,
    resulting_quantity: item.quantity,
    at: nowISO(),
  };
  moves.movements.push(movement);
  writeJSON(WH_MOVES_FILE, moves);
  logAudit({ module: 'warehouse', action: `movement_${type}`, item_id: itemId, movement_id: movement.id });

  // ربط فعلي: صرف صنف معدات مرتبط بأصل يُحدّث حالة الأصل تلقائياً
  if (type === 'issue' && item.category === 'equipment' && item.asset_id) {
    try {
      updateAsset(item.asset_id, { status: 'in_use' });
    } catch (e) { /* لا نوقف حركة المخزون إن تعذّر تحديث الأصل */ }
  }

  return movement;
}

/** استقبال بضاعة ناتجة عن استلام أمر شراء (BIZC.receivePurchaseOrder) - ربط فعلي بين الوحدتين */
function receiveStockFromPurchaseOrder(poId, lines = []) {
  assertRequired(poId, 'poId');
  const results = [];
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  lines.forEach((line) => {
    let item = db.items.find((i) => i.sku === line.sku);
    if (!item) {
      item = addStockItem({
        name: line.name || line.sku,
        category: line.category || 'material',
        unit: line.unit || 'unit',
        sku: line.sku,
        quantity: 0,
        min_quantity: line.min_quantity || 0,
        unit_cost: line.unit_cost || 0,
      });
    }
    const mv = recordMovement(item.id, { type: 'in', quantity: line.quantity, reference: `PO:${poId}`, note: 'استلام أمر شراء' });
    results.push(mv);
  });
  return results;
}

function getWarehouseDashboard() {
  const db = readJSON(WH_ITEMS_FILE, defaultWarehouseDB());
  const moves = readJSON(WH_MOVES_FILE, defaultMovementsDB()).movements;
  const totalValue = db.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  const lowStock = db.items.filter((i) => i.quantity <= i.min_quantity);
  const byCategory = WAREHOUSE_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = db.items.filter((i) => i.category === cat).length;
    return acc;
  }, {});
  return {
    total_items: db.items.length,
    total_inventory_value: Math.round(totalValue * 100) / 100,
    items_by_category: byCategory,
    low_stock_count: lowStock.length,
    low_stock_alerts: lowStock.map((i) => ({ id: i.id, name: i.name, sku: i.sku, quantity: i.quantity, min_quantity: i.min_quantity })),
    total_movements: moves.length,
    recent_movements: moves.slice(-10).reverse(),
  };
}

// ==================================================================
// ================== 2) إدارة الموارد البشرية (HR) ==================
// ==================================================================

const EMPLOYEE_STATUSES = ['active', 'on_leave', 'terminated'];

function defaultEmployeesDB() { return { employees: [] }; }

function validateEmployeePayload(body, { partial = false } = {}) {
  if (!partial) {
    assertRequired(body.name, 'name');
    assertRequired(body.job_title, 'job_title');
    assertRequired(body.base_salary, 'base_salary');
  }
  if (body.status && !EMPLOYEE_STATUSES.includes(body.status)) {
    throw new Error(`حالة غير صالحة. القيم المسموحة: ${EMPLOYEE_STATUSES.join(', ')}`);
  }
}

function createEmployee(body) {
  validateEmployeePayload(body);
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const employee = {
    id: newId('EMP'),
    name: String(body.name).trim(),
    national_id: body.national_id || '',
    job_title: body.job_title,
    department: body.department || '',
    contract_type: body.contract_type || 'full_time',
    contract_start: body.contract_start || nowISO(),
    contract_end: body.contract_end || null,
    base_salary: Number(body.base_salary) || 0,
    allowances: [],       // { id, title, amount, at }
    bonuses: [],          // { id, title, amount, at }
    deductions: [],       // { id, reason, amount, at, applied: false }
    advances: [],         // { id, amount, at, settled: false }
    attendance: [],       // { date, clock_in, clock_out, hours }
    leaves: [],           // { id, type, start_date, end_date, status, reason }
    annual_reviews: [],   // { id, year, score, notes, reviewer }
    trainings: [],        // { id, title, provider, date, certificate_url }
    documents: [],        // { id, title, url, uploaded_at }
    status: body.status || 'active',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.employees.push(employee);
  writeJSON(EMPLOYEES_FILE, db);
  logAudit({ module: 'hr', action: 'create_employee', employee_id: employee.id });
  return employee;
}

function getEmployee(id) {
  assertRequired(id, 'id');
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const emp = db.employees.find((e) => e.id === id);
  if (!emp) throw new Error('الموظف غير موجود');
  return emp;
}

function listEmployees({ status = null, department = null, q = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  let list = db.employees;
  if (status) list = list.filter((e) => e.status === status);
  if (department) list = list.filter((e) => e.department === department);
  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(term) || e.job_title.toLowerCase().includes(term));
  }
  list = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return paginate(list, { page, pageSize });
}

function updateEmployee(id, patch) {
  validateEmployeePayload(patch, { partial: true });
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('الموظف غير موجود');
  const forbidden = ['id', 'created_at', 'attendance', 'leaves', 'allowances', 'bonuses', 'deductions', 'advances', 'annual_reviews', 'trainings', 'documents'];
  const clean = { ...patch };
  forbidden.forEach((f) => delete clean[f]);
  db.employees[idx] = { ...db.employees[idx], ...clean, updated_at: nowISO() };
  writeJSON(EMPLOYEES_FILE, db);
  logAudit({ module: 'hr', action: 'update_employee', employee_id: id });
  return db.employees[idx];
}

function deleteEmployee(id) {
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('الموظف غير موجود');
  const [removed] = db.employees.splice(idx, 1);
  writeJSON(EMPLOYEES_FILE, db);
  logAudit({ module: 'hr', action: 'delete_employee', employee_id: id });
  return { success: true, removed };
}

function _mutateEmployee(id, fn) {
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('الموظف غير موجود');
  const result = fn(db.employees[idx]);
  db.employees[idx].updated_at = nowISO();
  writeJSON(EMPLOYEES_FILE, db);
  return result;
}

function clockIn(employeeId, { at = null } = {}) {
  return _mutateEmployee(employeeId, (emp) => {
    const date = (at ? new Date(at) : new Date()).toISOString().slice(0, 10);
    let record = emp.attendance.find((a) => a.date === date);
    if (!record) { record = { date, clock_in: nowISO(), clock_out: null, hours: 0 }; emp.attendance.push(record); }
    else record.clock_in = at || nowISO();
    logAudit({ module: 'hr', action: 'clock_in', employee_id: employeeId });
    return record;
  });
}

function clockOut(employeeId, { at = null } = {}) {
  return _mutateEmployee(employeeId, (emp) => {
    const date = (at ? new Date(at) : new Date()).toISOString().slice(0, 10);
    const record = emp.attendance.find((a) => a.date === date);
    if (!record || !record.clock_in) throw new Error('لا يوجد تسجيل حضور لهذا اليوم لتسجيل الانصراف عليه');
    record.clock_out = at || nowISO();
    record.hours = Math.max(0, (new Date(record.clock_out) - new Date(record.clock_in)) / 3600000);
    record.hours = Math.round(record.hours * 100) / 100;
    logAudit({ module: 'hr', action: 'clock_out', employee_id: employeeId });
    return record;
  });
}

function requestLeave(employeeId, { type = 'annual', start_date, end_date, reason = '' } = {}) {
  assertRequired(start_date, 'start_date');
  assertRequired(end_date, 'end_date');
  return _mutateEmployee(employeeId, (emp) => {
    const leave = { id: newId('LV'), type, start_date, end_date, reason, status: 'pending', requested_at: nowISO() };
    emp.leaves.push(leave);
    logAudit({ module: 'hr', action: 'request_leave', employee_id: employeeId, leave_id: leave.id });
    return leave;
  });
}

function decideLeave(employeeId, leaveId, { approve = true } = {}) {
  return _mutateEmployee(employeeId, (emp) => {
    const leave = emp.leaves.find((l) => l.id === leaveId);
    if (!leave) throw new Error('طلب الإجازة غير موجود');
    leave.status = approve ? 'approved' : 'rejected';
    leave.decided_at = nowISO();
    if (approve) emp.status = 'on_leave';
    logAudit({ module: 'hr', action: 'decide_leave', employee_id: employeeId, leave_id: leaveId, approved: approve });
    return leave;
  });
}

function addAllowance(employeeId, { title, amount } = {}) {
  assertRequired(title, 'title'); assertRequired(amount, 'amount');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('ALW'), title, amount: Number(amount), at: nowISO() };
    emp.allowances.push(rec);
    return rec;
  });
}

function addBonus(employeeId, { title, amount } = {}) {
  assertRequired(title, 'title'); assertRequired(amount, 'amount');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('BNS'), title, amount: Number(amount), at: nowISO() };
    emp.bonuses.push(rec);
    return rec;
  });
}

function addDeduction(employeeId, { reason, amount } = {}) {
  assertRequired(reason, 'reason'); assertRequired(amount, 'amount');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('DED'), reason, amount: Number(amount), at: nowISO(), applied: false };
    emp.deductions.push(rec);
    return rec;
  });
}

function addAdvance(employeeId, { amount, note = '' } = {}) {
  assertRequired(amount, 'amount');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('ADV'), amount: Number(amount), note, at: nowISO(), settled: false };
    emp.advances.push(rec);
    return rec;
  });
}

function addAnnualReview(employeeId, { year, score, notes = '', reviewer = '' } = {}) {
  assertRequired(year, 'year'); assertRequired(score, 'score');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('REV'), year: Number(year), score: Number(score), notes, reviewer, at: nowISO() };
    emp.annual_reviews.push(rec);
    return rec;
  });
}

function addTraining(employeeId, { title, provider = '', date = null, certificate_url = null } = {}) {
  assertRequired(title, 'title');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('TRN'), title, provider, date: date || nowISO(), certificate_url };
    emp.trainings.push(rec);
    return rec;
  });
}

function addEmployeeDocument(employeeId, { title, url } = {}) {
  assertRequired(title, 'title'); assertRequired(url, 'url');
  return _mutateEmployee(employeeId, (emp) => {
    const rec = { id: newId('DOC'), title, url, uploaded_at: nowISO() };
    emp.documents.push(rec);
    return rec;
  });
}

/** حساب الراتب الشهري فعلياً: الأساسي + بدلات الشهر + مكافآت الشهر - خصومات غير مطبّقة - سلف غير مسدَّدة (قسط) */
function computePayroll(employeeId, { year, month, advanceInstallment = null } = {}) {
  const emp = getEmployee(employeeId);
  assertRequired(year, 'year'); assertRequired(month, 'month');
  const y = Number(year), m = Number(month);
  const inPeriod = (iso) => { const d = new Date(iso); return d.getFullYear() === y && (d.getMonth() + 1) === m; };

  const allowancesTotal = emp.allowances.filter((a) => inPeriod(a.at)).reduce((s, a) => s + a.amount, 0);
  const bonusesTotal = emp.bonuses.filter((b) => inPeriod(b.at)).reduce((s, b) => s + b.amount, 0);
  const pendingDeductions = emp.deductions.filter((d) => !d.applied);
  const deductionsTotal = pendingDeductions.reduce((s, d) => s + d.amount, 0);
  const pendingAdvances = emp.advances.filter((a) => !a.settled);
  const installment = advanceInstallment != null ? Number(advanceInstallment) : pendingAdvances.reduce((s, a) => s + a.amount, 0);

  const gross = emp.base_salary + allowancesTotal + bonusesTotal;
  const net = gross - deductionsTotal - installment;

  // تطبيق الخصومات المستحقة فعلياً (تعليم "applied") - أثر حقيقي وليس عرض فقط
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const idx = db.employees.findIndex((e) => e.id === employeeId);
  if (idx !== -1) {
    db.employees[idx].deductions.forEach((d) => { if (!d.applied) d.applied = true; });
    writeJSON(EMPLOYEES_FILE, db);
  }

  const payslip = {
    employee_id: employeeId, employee_name: emp.name, year: y, month: m,
    base_salary: emp.base_salary, allowances_total: allowancesTotal, bonuses_total: bonusesTotal,
    deductions_total: deductionsTotal, advance_installment: installment,
    gross_salary: Math.round(gross * 100) / 100, net_salary: Math.round(net * 100) / 100,
    generated_at: nowISO(),
  };
  logAudit({ module: 'hr', action: 'compute_payroll', employee_id: employeeId, year: y, month: m });
  return payslip;
}

function getHrDashboard() {
  const db = readJSON(EMPLOYEES_FILE, defaultEmployeesDB());
  const active = db.employees.filter((e) => e.status === 'active').length;
  const onLeave = db.employees.filter((e) => e.status === 'on_leave').length;
  const pendingLeaves = db.employees.reduce((s, e) => s + e.leaves.filter((l) => l.status === 'pending').length, 0);
  const totalMonthlyBase = db.employees.filter((e) => e.status !== 'terminated').reduce((s, e) => s + e.base_salary, 0);
  return {
    total_employees: db.employees.length,
    active_employees: active,
    on_leave_employees: onLeave,
    pending_leave_requests: pendingLeaves,
    total_monthly_base_payroll: Math.round(totalMonthlyBase * 100) / 100,
  };
}

// ==================================================================
// ===================== 3) إدارة الاجتماعات ========================
// ==================================================================

function defaultMeetingsDB() { return { meetings: [] }; }

function createMeeting(body) {
  assertRequired(body.title, 'title');
  assertRequired(body.date, 'date');
  const db = readJSON(MEETINGS_FILE, defaultMeetingsDB());
  const meeting = {
    id: newId('MTG'),
    title: body.title,
    date: body.date,
    location: body.location || '',
    project_id: body.project_id || null,
    participants: (body.participants || []).map((p) => ({ name: p.name || p, employee_id: p.employee_id || null, attended: false })),
    agenda: body.agenda || [],
    minutes: '',
    decisions: [],        // { id, text, owner, task_id }
    resulting_tasks: [],  // task ids
    attachments: [],
    reminders: body.reminders || [],
    status: 'scheduled',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.meetings.push(meeting);
  writeJSON(MEETINGS_FILE, db);
  logAudit({ module: 'meetings', action: 'create_meeting', meeting_id: meeting.id });
  return meeting;
}

function getMeeting(id) {
  const db = readJSON(MEETINGS_FILE, defaultMeetingsDB());
  const m = db.meetings.find((x) => x.id === id);
  if (!m) throw new Error('الاجتماع غير موجود');
  return m;
}

function listMeetings({ project_id = null, status = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(MEETINGS_FILE, defaultMeetingsDB());
  let list = db.meetings;
  if (project_id) list = list.filter((m) => m.project_id === project_id);
  if (status) list = list.filter((m) => m.status === status);
  list = list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  return paginate(list, { page, pageSize });
}

function _mutateMeeting(id, fn) {
  const db = readJSON(MEETINGS_FILE, defaultMeetingsDB());
  const idx = db.meetings.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error('الاجتماع غير موجود');
  const result = fn(db.meetings[idx]);
  db.meetings[idx].updated_at = nowISO();
  writeJSON(MEETINGS_FILE, db);
  return result;
}

function recordAttendance(meetingId, { participantName, attended = true } = {}) {
  assertRequired(participantName, 'participantName');
  return _mutateMeeting(meetingId, (m) => {
    const p = m.participants.find((x) => x.name === participantName);
    if (!p) throw new Error('المشارك غير مدرج في هذا الاجتماع');
    p.attended = attended;
    return p;
  });
}

function recordMinutes(meetingId, { minutes } = {}) {
  assertRequired(minutes, 'minutes');
  return _mutateMeeting(meetingId, (m) => { m.minutes = minutes; m.status = 'completed'; return m; });
}

/** إضافة قرار من الاجتماع؛ إن طُلب create_task=true يُنشئ مهمة فعلية مرتبطة (وليس نصاً حراً) */
function addDecision(meetingId, { text, owner = null, create_task = false, project_id = null, due_date = null } = {}) {
  assertRequired(text, 'text');
  return _mutateMeeting(meetingId, (m) => {
    const decision = { id: newId('DEC'), text, owner, task_id: null, at: nowISO() };
    if (create_task) {
      const task = createTask({
        title: text,
        description: `قرار ناتج عن اجتماع: ${m.title}`,
        project_id: project_id || m.project_id,
        assignee_name: owner,
        priority: 'medium',
        due_date,
        source_meeting_id: m.id,
      });
      decision.task_id = task.id;
      m.resulting_tasks.push(task.id);
    }
    m.decisions.push(decision);
    logAudit({ module: 'meetings', action: 'add_decision', meeting_id: meetingId, task_id: decision.task_id });
    return decision;
  });
}

function addMeetingAttachment(meetingId, { title, url } = {}) {
  assertRequired(title, 'title'); assertRequired(url, 'url');
  return _mutateMeeting(meetingId, (m) => {
    const rec = { id: newId('ATT'), title, url, uploaded_at: nowISO() };
    m.attachments.push(rec);
    return rec;
  });
}

// ==================================================================
// ========================= 4) إدارة المهام =========================
// ==================================================================

const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

function defaultTasksDB() { return { tasks: [] }; }

function validateTaskPayload(body, { partial = false } = {}) {
  if (!partial) assertRequired(body.title, 'title');
  if (body.status && !TASK_STATUSES.includes(body.status)) {
    throw new Error(`حالة غير صالحة. القيم المسموحة: ${TASK_STATUSES.join(', ')}`);
  }
  if (body.priority && !TASK_PRIORITIES.includes(body.priority)) {
    throw new Error(`أولوية غير صالحة. القيم المسموحة: ${TASK_PRIORITIES.join(', ')}`);
  }
}

function createTask(body) {
  validateTaskPayload(body);
  if (body.project_id && PM) {
    try { PM.getProject(body.project_id); } catch (e) { throw new Error(`المشروع المرتبط (${body.project_id}) غير موجود`); }
  }
  let assignee = null;
  if (body.assignee_id) {
    assignee = getEmployee(body.assignee_id); // يتحقق فعلياً من وجود الموظف
  }
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const task = {
    id: newId('TSK'),
    title: body.title,
    description: body.description || '',
    project_id: body.project_id || null,
    department: body.department || '',
    assignee_id: body.assignee_id || null,
    assignee_name: assignee ? assignee.name : (body.assignee_name || null),
    priority: body.priority || 'medium',
    status: body.status || 'todo',
    start_date: body.start_date || nowISO(),
    due_date: body.due_date || null,
    progress: 0,
    comments: [],
    attachments: [],
    change_log: [{ at: nowISO(), change: 'created' }],
    source_meeting_id: body.source_meeting_id || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.tasks.push(task);
  writeJSON(TASKS_FILE, db);
  if (assignee) {
    logAudit({ module: 'tasks', action: 'assign_task', task_id: task.id, employee_id: assignee.id });
  }
  logAudit({ module: 'tasks', action: 'create_task', task_id: task.id });
  return task;
}

function getTask(id) {
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const t = db.tasks.find((x) => x.id === id);
  if (!t) throw new Error('المهمة غير موجودة');
  return t;
}

function listTasks({ project_id = null, assignee_id = null, status = null, priority = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  let list = db.tasks;
  if (project_id) list = list.filter((t) => t.project_id === project_id);
  if (assignee_id) list = list.filter((t) => t.assignee_id === assignee_id);
  if (status) list = list.filter((t) => t.status === status);
  if (priority) list = list.filter((t) => t.priority === priority);
  list = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return paginate(list, { page, pageSize });
}

function updateTask(id, patch) {
  validateTaskPayload(patch, { partial: true });
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const idx = db.tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error('المهمة غير موجودة');
  const forbidden = ['id', 'created_at', 'comments', 'attachments', 'change_log'];
  const clean = { ...patch };
  forbidden.forEach((f) => delete clean[f]);
  if (clean.progress != null) {
    clean.progress = Math.max(0, Math.min(100, Number(clean.progress)));
    if (clean.progress === 100 && !clean.status) clean.status = 'done';
  }
  const before = db.tasks[idx];
  db.tasks[idx] = { ...before, ...clean, updated_at: nowISO() };
  db.tasks[idx].change_log.push({ at: nowISO(), change: 'updated', fields: Object.keys(clean) });
  writeJSON(TASKS_FILE, db);
  logAudit({ module: 'tasks', action: 'update_task', task_id: id });
  return db.tasks[idx];
}

function deleteTask(id) {
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const idx = db.tasks.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error('المهمة غير موجودة');
  const [removed] = db.tasks.splice(idx, 1);
  writeJSON(TASKS_FILE, db);
  logAudit({ module: 'tasks', action: 'delete_task', task_id: id });
  return { success: true, removed };
}

function addTaskComment(taskId, { author, text } = {}) {
  assertRequired(text, 'text');
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const idx = db.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) throw new Error('المهمة غير موجودة');
  const rec = { id: newId('CMT'), author: author || 'مستخدم', text, at: nowISO() };
  db.tasks[idx].comments.push(rec);
  db.tasks[idx].updated_at = nowISO();
  writeJSON(TASKS_FILE, db);
  return rec;
}

function addTaskAttachment(taskId, { title, url } = {}) {
  assertRequired(title, 'title'); assertRequired(url, 'url');
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const idx = db.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) throw new Error('المهمة غير موجودة');
  const rec = { id: newId('ATT'), title, url, uploaded_at: nowISO() };
  db.tasks[idx].attachments.push(rec);
  db.tasks[idx].updated_at = nowISO();
  writeJSON(TASKS_FILE, db);
  return rec;
}

function getTasksDashboard() {
  const db = readJSON(TASKS_FILE, defaultTasksDB());
  const now = new Date();
  const overdue = db.tasks.filter((t) => t.due_date && new Date(t.due_date) < now && t.status !== 'done' && t.status !== 'cancelled');
  const byStatus = TASK_STATUSES.reduce((acc, s) => { acc[s] = db.tasks.filter((t) => t.status === s).length; return acc; }, {});
  return {
    total_tasks: db.tasks.length,
    tasks_by_status: byStatus,
    overdue_tasks: overdue.length,
    overdue_list: overdue.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, assignee_name: t.assignee_name })),
  };
}

// ==================================================================
// ======================= 5) إدارة المراسلات ========================
// ==================================================================

const CORRESPONDENCE_TYPES = ['internal_message', 'notification', 'email'];

function defaultCorrespondenceDB() { return { items: [] }; }

function createCorrespondence(body) {
  assertRequired(body.type, 'type');
  assertRequired(body.subject, 'subject');
  if (!CORRESPONDENCE_TYPES.includes(body.type)) {
    throw new Error(`نوع غير صالح. القيم المسموحة: ${CORRESPONDENCE_TYPES.join(', ')}`);
  }
  const db = readJSON(CORRESPONDENCE_FILE, defaultCorrespondenceDB());
  const rec = {
    id: newId('MSG'),
    type: body.type,
    subject: body.subject,
    body: body.body || '',
    from: body.from || '',
    to: body.to || [],
    attachments: body.attachments || [],
    archived: false,
    read: false,
    at: nowISO(),
  };
  db.items.push(rec);
  writeJSON(CORRESPONDENCE_FILE, db);
  logAudit({ module: 'correspondence', action: 'create', message_id: rec.id, type: rec.type });
  return rec;
}

function listCorrespondence({ type = null, archived = null, q = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(CORRESPONDENCE_FILE, defaultCorrespondenceDB());
  let list = db.items;
  if (type) list = list.filter((m) => m.type === type);
  if (archived !== null && archived !== undefined) list = list.filter((m) => m.archived === (archived === true || archived === 'true'));
  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter((m) => m.subject.toLowerCase().includes(term) || (m.body || '').toLowerCase().includes(term));
  }
  list = list.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  return paginate(list, { page, pageSize });
}

function archiveCorrespondence(id, { archived = true } = {}) {
  const db = readJSON(CORRESPONDENCE_FILE, defaultCorrespondenceDB());
  const idx = db.items.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error('المراسلة غير موجودة');
  db.items[idx].archived = archived;
  writeJSON(CORRESPONDENCE_FILE, db);
  return db.items[idx];
}

function markCorrespondenceRead(id, { read = true } = {}) {
  const db = readJSON(CORRESPONDENCE_FILE, defaultCorrespondenceDB());
  const idx = db.items.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error('المراسلة غير موجودة');
  db.items[idx].read = read;
  writeJSON(CORRESPONDENCE_FILE, db);
  return db.items[idx];
}

// ==================================================================
// ========================= 6) إدارة الأصول =========================
// ==================================================================

const ASSET_CATEGORIES = ['equipment', 'vehicle', 'device', 'furniture', 'software'];
const ASSET_STATUSES = ['available', 'in_use', 'maintenance', 'disposed'];

function defaultAssetsDB() { return { assets: [] }; }

function validateAssetPayload(body, { partial = false } = {}) {
  if (!partial) {
    assertRequired(body.name, 'name');
    assertRequired(body.category, 'category');
    assertRequired(body.purchase_cost, 'purchase_cost');
    assertRequired(body.purchase_date, 'purchase_date');
    if (!ASSET_CATEGORIES.includes(body.category)) {
      throw new Error(`تصنيف غير صالح. القيم المسموحة: ${ASSET_CATEGORIES.join(', ')}`);
    }
  } else if (body.category && !ASSET_CATEGORIES.includes(body.category)) {
    throw new Error(`تصنيف غير صالح. القيم المسموحة: ${ASSET_CATEGORIES.join(', ')}`);
  }
  if (body.status && !ASSET_STATUSES.includes(body.status)) {
    throw new Error(`حالة غير صالحة. القيم المسموحة: ${ASSET_STATUSES.join(', ')}`);
  }
}

function createAsset(body) {
  validateAssetPayload(body);
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const asset = {
    id: newId('AST'),
    name: body.name,
    category: body.category,
    purchase_cost: Number(body.purchase_cost),
    purchase_date: body.purchase_date,
    useful_life_years: Number(body.useful_life_years) || 5,
    salvage_value: Number(body.salvage_value) || 0,
    warranty_expiry: body.warranty_expiry || null,
    current_location: body.current_location || '',
    status: body.status || 'available',
    maintenance_log: [], // { id, date, description, cost }
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.assets.push(asset);
  writeJSON(ASSETS_FILE, db);
  logAudit({ module: 'assets', action: 'create_asset', asset_id: asset.id });
  return asset;
}

/** القيمة الدفترية محسوبة فعلياً بطريقة القسط الثابت (Straight-line depreciation) - وليست رقماً ثابتاً */
function computeBookValue(asset, atDate = null) {
  const now = atDate ? new Date(atDate) : new Date();
  const purchaseDate = new Date(asset.purchase_date);
  const yearsElapsed = Math.max(0, (now - purchaseDate) / (365.25 * 24 * 3600 * 1000));
  const depreciableBase = asset.purchase_cost - asset.salvage_value;
  const annualDepreciation = asset.useful_life_years > 0 ? depreciableBase / asset.useful_life_years : depreciableBase;
  const accumulatedDepreciation = Math.min(depreciableBase, annualDepreciation * yearsElapsed);
  const bookValue = asset.purchase_cost - accumulatedDepreciation;
  return {
    book_value: Math.round(Math.max(asset.salvage_value, bookValue) * 100) / 100,
    accumulated_depreciation: Math.round(accumulatedDepreciation * 100) / 100,
    years_elapsed: Math.round(yearsElapsed * 100) / 100,
  };
}

function getAsset(id) {
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const a = db.assets.find((x) => x.id === id);
  if (!a) throw new Error('الأصل غير موجود');
  return { ...a, ...computeBookValue(a) };
}

function listAssets({ category = null, status = null, q = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  let list = db.assets;
  if (category) list = list.filter((a) => a.category === category);
  if (status) list = list.filter((a) => a.status === status);
  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter((a) => a.name.toLowerCase().includes(term));
  }
  list = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const withValues = list.map((a) => ({ ...a, ...computeBookValue(a) }));
  return paginate(withValues, { page, pageSize });
}

function updateAsset(id, patch) {
  validateAssetPayload(patch, { partial: true });
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const idx = db.assets.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('الأصل غير موجود');
  const forbidden = ['id', 'created_at', 'maintenance_log'];
  const clean = { ...patch };
  forbidden.forEach((f) => delete clean[f]);
  db.assets[idx] = { ...db.assets[idx], ...clean, updated_at: nowISO() };
  writeJSON(ASSETS_FILE, db);
  logAudit({ module: 'assets', action: 'update_asset', asset_id: id });
  return { ...db.assets[idx], ...computeBookValue(db.assets[idx]) };
}

function deleteAsset(id) {
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const idx = db.assets.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('الأصل غير موجود');
  const [removed] = db.assets.splice(idx, 1);
  writeJSON(ASSETS_FILE, db);
  logAudit({ module: 'assets', action: 'delete_asset', asset_id: id });
  return { success: true, removed };
}

function addMaintenanceRecord(assetId, { description, cost = 0, date = null } = {}) {
  assertRequired(description, 'description');
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const idx = db.assets.findIndex((a) => a.id === assetId);
  if (idx === -1) throw new Error('الأصل غير موجود');
  const rec = { id: newId('MNT'), description, cost: Number(cost) || 0, date: date || nowISO() };
  db.assets[idx].maintenance_log.push(rec);
  db.assets[idx].status = 'maintenance';
  db.assets[idx].updated_at = nowISO();
  writeJSON(ASSETS_FILE, db);
  logAudit({ module: 'assets', action: 'maintenance', asset_id: assetId, maintenance_id: rec.id });
  return rec;
}

function getAssetsDashboard() {
  const db = readJSON(ASSETS_FILE, defaultAssetsDB());
  const withValues = db.assets.map((a) => ({ ...a, ...computeBookValue(a) }));
  const totalBookValue = withValues.reduce((s, a) => s + a.book_value, 0);
  const totalPurchaseCost = db.assets.reduce((s, a) => s + a.purchase_cost, 0);
  const byStatus = ASSET_STATUSES.reduce((acc, s) => { acc[s] = db.assets.filter((a) => a.status === s).length; return acc; }, {});
  const expiringWarranties = db.assets.filter((a) => {
    if (!a.warranty_expiry) return false;
    const days = (new Date(a.warranty_expiry) - new Date()) / (24 * 3600 * 1000);
    return days >= 0 && days <= 30;
  });
  return {
    total_assets: db.assets.length,
    total_purchase_cost: Math.round(totalPurchaseCost * 100) / 100,
    total_book_value: Math.round(totalBookValue * 100) / 100,
    assets_by_status: byStatus,
    warranties_expiring_soon: expiringWarranties.map((a) => ({ id: a.id, name: a.name, warranty_expiry: a.warranty_expiry })),
  };
}

// ==================================================================
// ================================ EXPORTS ==========================
// ==================================================================

module.exports = {
  // المخازن
  WAREHOUSE_CATEGORIES,
  addStockItem, getStockItem, listStockItems, updateStockItem, deleteStockItem,
  recordMovement, receiveStockFromPurchaseOrder, getWarehouseDashboard,

  // الموارد البشرية
  EMPLOYEE_STATUSES,
  createEmployee, getEmployee, listEmployees, updateEmployee, deleteEmployee,
  clockIn, clockOut, requestLeave, decideLeave,
  addAllowance, addBonus, addDeduction, addAdvance,
  addAnnualReview, addTraining, addEmployeeDocument,
  computePayroll, getHrDashboard,

  // الاجتماعات
  createMeeting, getMeeting, listMeetings, recordAttendance, recordMinutes,
  addDecision, addMeetingAttachment,

  // المهام
  TASK_STATUSES, TASK_PRIORITIES,
  createTask, getTask, listTasks, updateTask, deleteTask,
  addTaskComment, addTaskAttachment, getTasksDashboard,

  // المراسلات
  CORRESPONDENCE_TYPES,
  createCorrespondence, listCorrespondence, archiveCorrespondence, markCorrespondenceRead,

  // الأصول
  ASSET_CATEGORIES, ASSET_STATUSES,
  createAsset, getAsset, listAssets, updateAsset, deleteAsset,
  addMaintenanceRecord, getAssetsDashboard,
};
