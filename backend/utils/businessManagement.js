/**
 * القسم السادس - نظام إدارة الأعمال (Business Management System)
 * الجزء الأول (1/4): إدارة العملاء (CRM) + إدارة الموردين
 * ================================================================
 * التخزين: ملفات JSON على القرص (نفس نمط projectManagement.js وpriceLibrary.js)
 *   - backend/data/crm_clients.json
 *   - backend/data/crm_suppliers.json
 * بدون تبعيات خارجية، متوافق مع سياسة "صفر تبعيات" للمشروع.
 *
 * يغطي هذا الجزء:
 *  - العملاء: CRUD كامل + بيانات اتصال + عناوين + أشخاص مسؤولون
 *    + ربط بالعقود/المشاريع (بالمعرّف فقط - الربط الفعلي يتم لاحقاً مع PM)
 *    + سجل اجتماعات + سجل اتصالات + ملاحظات + مرفقات (ميتاداتا) + تقييم + حالة
 *    + سجل تعاملات كامل (Activity Log لكل عميل)
 *  - الموردين: CRUD كامل + تصنيف + منتجات/خدمات + أسعار + عقود (روابط)
 *    + أوامر شراء (روابط - التنفيذ الكامل في الجزء الثاني ضمن "إدارة المشتريات")
 *    + تقييم المورد + سجل مدفوعات + سجل توريدات + متابعة أداء
 *
 * ملاحظات معمارية:
 *  - كل وحدة (clients / suppliers) لها دوال CRUD مستقلة ومساحة تخزين مستقلة.
 *  - كل عملية تعديل/حذف تُسجَّل في audit_log مركزي لهذا القسم (data/business_audit.json)
 *    تمهيداً لسجل التدقيق العام المطلوب في متطلبات القسم السادس (الجزء الرابع).
 *  - لا صلاحيات/مصادقة في هذا الجزء (سيُنفَّذ ضمن الجزء الرابع: الصلاحيات والأمان)؛
 *    الحقل created_by / updated_by موجود في البنية لكنه اختياري حالياً.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'crm_clients.json');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'crm_suppliers.json');
const AUDIT_FILE = path.join(DATA_DIR, 'business_audit.json');

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
  // حد أعلى لحجم السجل لتفادي تضخّم الملف بلا حدود
  if (log.length > 20000) log.splice(0, log.length - 20000);
  writeJSON(AUDIT_FILE, log);
}

// ==================================================================
// ============================ العملاء (CRM) ======================
// ==================================================================

const CLIENT_STATUSES = ['active', 'lead', 'inactive', 'blacklisted'];

function defaultClientsDB() {
  return { clients: [] };
}

function validateClientPayload(body, { partial = false } = {}) {
  if (!partial) {
    if (!body || !body.name || !String(body.name).trim()) {
      throw new Error('اسم العميل (name) مطلوب');
    }
  }
  if (body.status && !CLIENT_STATUSES.includes(body.status)) {
    throw new Error(`حالة العميل غير صحيحة. القيم المسموحة: ${CLIENT_STATUSES.join(', ')}`);
  }
  if (body.rating !== undefined && body.rating !== null) {
    const r = Number(body.rating);
    if (Number.isNaN(r) || r < 0 || r > 5) {
      throw new Error('تقييم العميل (rating) يجب أن يكون رقماً بين 0 و5');
    }
  }
}

function createClient(body) {
  validateClientPayload(body);
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());

  const client = {
    id: newId('CLI'),
    name: String(body.name).trim(),
    type: body.type || 'individual', // individual | company
    status: body.status || 'lead',
    rating: body.rating !== undefined ? Number(body.rating) : null,

    contact: {
      phone: body.contact?.phone || '',
      mobile: body.contact?.mobile || '',
      email: body.contact?.email || '',
      fax: body.contact?.fax || '',
    },

    addresses: Array.isArray(body.addresses) ? body.addresses.map(a => ({
      id: newId('ADR'),
      label: a.label || 'الرئيسي',
      country: a.country || '',
      city: a.city || '',
      street: a.street || '',
      details: a.details || '',
    })) : [],

    contact_persons: Array.isArray(body.contact_persons) ? body.contact_persons.map(p => ({
      id: newId('PER'),
      name: p.name || '',
      role: p.role || '',
      phone: p.phone || '',
      email: p.email || '',
    })) : [],

    linked_contracts: [],   // يُملأ من وحدة العقود (الجزء الثاني) بربط معرّف العقد
    linked_projects: Array.isArray(body.linked_projects) ? body.linked_projects.slice() : [],

    meetings: [],           // سجل اجتماعات مرتبط بالعميل
    communications: [],     // سجل اتصالات (مكالمة/بريد/رسالة)
    notes: [],              // ملاحظات حرة بتاريخ
    attachments: [],        // ميتاداتا مرفقات (اسم/مسار/نوع/تاريخ) - رفع الملف الفعلي خارج نطاق هذا الجزء

    activity_log: [],       // سجل كامل لكل التعاملات (يُبنى تلقائياً من كل عملية أدناه)

    created_at: nowISO(),
    updated_at: nowISO(),
  };

  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'created', summary: 'تم إنشاء سجل العميل' });

  db.clients.push(client);
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'create', target_id: client.id, summary: `إنشاء عميل: ${client.name}` });
  return { success: true, data: client };
}

function listClients({ status = null, type = null, q = null, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  let items = db.clients.slice();

  if (status) items = items.filter(c => c.status === status);
  if (type) items = items.filter(c => c.type === type);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter(c =>
      c.name.toLowerCase().includes(needle) ||
      (c.contact.phone || '').includes(needle) ||
      (c.contact.mobile || '').includes(needle) ||
      (c.contact.email || '').toLowerCase().includes(needle)
    );
  }

  items.sort((a, b) => {
    const va = a[sortBy] ?? '';
    const vb = b[sortBy] ?? '';
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;
  const paged = items.slice(start, start + ps);

  return {
    success: true,
    data: paged,
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

function getClient(id) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = db.clients.find(c => c.id === id);
  if (!client) throw new Error('العميل غير موجود');
  return { success: true, data: client };
}

function updateClient(id, updates) {
  validateClientPayload(updates, { partial: true });
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const idx = db.clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('العميل غير موجود');

  const client = db.clients[idx];
  const editableFields = ['name', 'type', 'status', 'rating'];
  editableFields.forEach(f => {
    if (updates[f] !== undefined) client[f] = updates[f];
  });
  if (updates.contact) client.contact = { ...client.contact, ...updates.contact };
  if (Array.isArray(updates.addresses)) client.addresses = updates.addresses;
  if (Array.isArray(updates.contact_persons)) client.contact_persons = updates.contact_persons;
  if (Array.isArray(updates.linked_projects)) client.linked_projects = updates.linked_projects;

  client.updated_at = nowISO();
  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'updated', summary: 'تم تعديل بيانات العميل' });

  db.clients[idx] = client;
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'update', target_id: id, summary: `تعديل عميل: ${client.name}` });
  return { success: true, data: client };
}

function deleteClient(id) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const idx = db.clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('العميل غير موجود');
  const removed = db.clients.splice(idx, 1)[0];
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'delete', target_id: id, summary: `حذف عميل: ${removed.name}` });
  return { success: true, data: { id } };
}

function _touchClient(db, id) {
  const client = db.clients.find(c => c.id === id);
  if (!client) throw new Error('العميل غير موجود');
  return client;
}

// يُستخدم من وحدة العقود (الجزء الثاني) لربط عقد بعميل فعلياً وتحديث سجل تعاملاته
function linkContractToClient(clientId, contractRef) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  if (!client.linked_contracts.includes(contractRef.id)) {
    client.linked_contracts.push(contractRef.id);
  }
  client.activity_log.push({
    id: newId('ACT'), at: nowISO(), type: 'contract_linked',
    summary: `عقد مرتبط: ${contractRef.title || contractRef.id}`,
  });
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
  return client;
}

function unlinkContractFromClient(clientId, contractId) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return; // العميل قد يكون محذوفاً؛ لا نُفشل عملية حذف العقد بسبب ذلك
  client.linked_contracts = client.linked_contracts.filter(id => id !== contractId);
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
}

function addClientMeeting(clientId, meeting) {
  if (!meeting || !meeting.title) throw new Error('عنوان الاجتماع (title) مطلوب');
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  const record = {
    id: newId('MTG'),
    title: meeting.title,
    date: meeting.date || nowISO(),
    attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
    minutes: meeting.minutes || '',
    created_at: nowISO(),
  };
  client.meetings.push(record);
  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'meeting', summary: `اجتماع: ${record.title}` });
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'add_meeting', target_id: clientId, summary: record.title });
  return { success: true, data: record };
}

function addClientCommunication(clientId, comm) {
  if (!comm || !comm.channel) throw new Error('قناة الاتصال (channel) مطلوبة: مكالمة/بريد/رسالة/زيارة');
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  const record = {
    id: newId('COM'),
    channel: comm.channel,
    subject: comm.subject || '',
    summary: comm.summary || '',
    direction: comm.direction || 'outgoing', // outgoing | incoming
    date: comm.date || nowISO(),
    created_at: nowISO(),
  };
  client.communications.push(record);
  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'communication', summary: `${record.channel}: ${record.subject || 'بدون عنوان'}` });
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'add_communication', target_id: clientId, summary: record.channel });
  return { success: true, data: record };
}

function addClientNote(clientId, note) {
  if (!note || !note.text) throw new Error('نص الملاحظة (text) مطلوب');
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  const record = { id: newId('NOTE'), text: note.text, created_at: nowISO(), author: note.author || null };
  client.notes.push(record);
  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'note', summary: 'ملاحظة جديدة' });
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'add_note', target_id: clientId, summary: 'ملاحظة' });
  return { success: true, data: record };
}

function addClientAttachment(clientId, attachment) {
  if (!attachment || !attachment.name) throw new Error('اسم المرفق (name) مطلوب');
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  const record = {
    id: newId('ATT'),
    name: attachment.name,
    file_type: attachment.file_type || '',
    path: attachment.path || '', // مسار التخزين الفعلي يُدار خارج هذه الوحدة (إدارة المستندات)
    uploaded_at: nowISO(),
  };
  client.attachments.push(record);
  client.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'attachment', summary: `مرفق: ${record.name}` });
  client.updated_at = nowISO();
  writeJSON(CLIENTS_FILE, db);
  logAudit({ module: 'crm_clients', action: 'add_attachment', target_id: clientId, summary: record.name });
  return { success: true, data: record };
}

function getClientActivityLog(clientId) {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const client = _touchClient(db, clientId);
  return { success: true, data: client.activity_log.slice().sort((a, b) => new Date(b.at) - new Date(a.at)) };
}

function getClientsDashboard() {
  const db = readJSON(CLIENTS_FILE, defaultClientsDB());
  const items = db.clients;
  const byStatus = {};
  CLIENT_STATUSES.forEach(s => { byStatus[s] = 0; });
  items.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });

  const ratedClients = items.filter(c => typeof c.rating === 'number');
  const avgRating = ratedClients.length
    ? Math.round((ratedClients.reduce((s, c) => s + c.rating, 0) / ratedClients.length) * 100) / 100
    : null;

  return {
    success: true,
    data: {
      total_clients: items.length,
      by_status: byStatus,
      average_rating: avgRating,
      recent_clients: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10)
        .map(c => ({ id: c.id, name: c.name, status: c.status, created_at: c.created_at })),
    },
  };
}

// ==================================================================
// =========================== الموردون =============================
// ==================================================================

function defaultSuppliersDB() {
  return { suppliers: [] };
}

function validateSupplierPayload(body, { partial = false } = {}) {
  if (!partial) {
    if (!body || !body.name || !String(body.name).trim()) {
      throw new Error('اسم المورد (name) مطلوب');
    }
  }
  if (body.rating !== undefined && body.rating !== null) {
    const r = Number(body.rating);
    if (Number.isNaN(r) || r < 0 || r > 5) {
      throw new Error('تقييم المورد (rating) يجب أن يكون رقماً بين 0 و5');
    }
  }
}

function createSupplier(body) {
  validateSupplierPayload(body);
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());

  const supplier = {
    id: newId('SUP'),
    name: String(body.name).trim(),
    category: body.category || 'مواد بناء', // تصنيف حر: مواد بناء / معدات / خدمات ...
    rating: body.rating !== undefined ? Number(body.rating) : null,

    contact: {
      phone: body.contact?.phone || '',
      mobile: body.contact?.mobile || '',
      email: body.contact?.email || '',
    },
    address: body.address || '',

    products: Array.isArray(body.products) ? body.products.map(p => ({
      id: newId('PRD'),
      name: p.name || '',
      unit: p.unit || '',
      price: Number(p.price) || 0,
      currency: p.currency || 'SAR',
      updated_at: nowISO(),
    })) : [],

    linked_contracts: [],   // يُملأ من وحدة العقود (الجزء الثاني)
    purchase_orders: [],    // مراجع أوامر الشراء (التنفيذ الكامل في الجزء الثاني)

    payments: [],           // سجل مدفوعات للمورد
    deliveries: [],         // سجل توريدات فعلية

    performance: {
      on_time_delivery_rate: null,  // نسبة % تُحسب من سجل deliveries لاحقاً
      quality_score: null,          // 0-5 يُدخل يدوياً أو يُشتق من فحوصات الجودة مستقبلاً
      total_orders: 0,
      total_value: 0,
    },

    activity_log: [],
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'created', summary: 'تم إنشاء سجل المورد' });

  db.suppliers.push(supplier);
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'create', target_id: supplier.id, summary: `إنشاء مورد: ${supplier.name}` });
  return { success: true, data: supplier };
}

function listSuppliers({ category = null, q = null, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  let items = db.suppliers.slice();

  if (category) items = items.filter(s => s.category === category);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter(s =>
      s.name.toLowerCase().includes(needle) ||
      (s.contact.phone || '').includes(needle) ||
      (s.contact.email || '').toLowerCase().includes(needle)
    );
  }

  items.sort((a, b) => {
    const va = a[sortBy] ?? '';
    const vb = b[sortBy] ?? '';
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;
  const paged = items.slice(start, start + ps);

  return {
    success: true,
    data: paged,
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

function getSupplier(id) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = db.suppliers.find(s => s.id === id);
  if (!supplier) throw new Error('المورد غير موجود');
  return { success: true, data: supplier };
}

function updateSupplier(id, updates) {
  validateSupplierPayload(updates, { partial: true });
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const idx = db.suppliers.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('المورد غير موجود');

  const supplier = db.suppliers[idx];
  const editableFields = ['name', 'category', 'rating', 'address'];
  editableFields.forEach(f => {
    if (updates[f] !== undefined) supplier[f] = updates[f];
  });
  if (updates.contact) supplier.contact = { ...supplier.contact, ...updates.contact };

  supplier.updated_at = nowISO();
  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'updated', summary: 'تم تعديل بيانات المورد' });

  db.suppliers[idx] = supplier;
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'update', target_id: id, summary: `تعديل مورد: ${supplier.name}` });
  return { success: true, data: supplier };
}

function deleteSupplier(id) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const idx = db.suppliers.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('المورد غير موجود');
  const removed = db.suppliers.splice(idx, 1)[0];
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'delete', target_id: id, summary: `حذف مورد: ${removed.name}` });
  return { success: true, data: { id } };
}

function _touchSupplier(db, id) {
  const supplier = db.suppliers.find(s => s.id === id);
  if (!supplier) throw new Error('المورد غير موجود');
  return supplier;
}

// يُستخدم من وحدة العقود (الجزء الثاني) لربط عقد بمورد فعلياً
function linkContractToSupplier(supplierId, contractRef) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  if (!supplier.linked_contracts.includes(contractRef.id)) {
    supplier.linked_contracts.push(contractRef.id);
  }
  supplier.activity_log.push({
    id: newId('ACT'), at: nowISO(), type: 'contract_linked',
    summary: `عقد مرتبط: ${contractRef.title || contractRef.id}`,
  });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  return supplier;
}

function unlinkContractFromSupplier(supplierId, contractId) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = db.suppliers.find(s => s.id === supplierId);
  if (!supplier) return;
  supplier.linked_contracts = supplier.linked_contracts.filter(id => id !== contractId);
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
}

// يُستخدم من وحدة المشتريات (الجزء الثاني) لإضافة مرجع أمر شراء فعلي على المورد
function linkPurchaseOrderToSupplier(supplierId, poRef) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  supplier.purchase_orders.push({ id: poRef.id, status: poRef.status || 'pending', value: poRef.value || 0, created_at: nowISO() });
  supplier.activity_log.push({
    id: newId('ACT'), at: nowISO(), type: 'purchase_order',
    summary: `أمر شراء: ${poRef.id} (${poRef.value || 0})`,
  });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  return supplier;
}

// يقرأ سعر منتج مورد معيّن (تُستخدمه وحدة المشتريات لمقارنة الأسعار الفعلية)
function getSupplierProductPrice(supplierId, productId) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  const product = supplier.products.find(p => p.id === productId);
  if (!product) throw new Error('المنتج غير موجود لدى هذا المورد');
  return { supplier_id: supplier.id, supplier_name: supplier.name, ...product };
}

// يقارن سعر نفس اسم الصنف بين كل الموردين (بحث نصي على اسم المنتج)
function compareSupplierPricesByProductName(productName) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const needle = String(productName).trim().toLowerCase();
  const results = [];
  db.suppliers.forEach(s => {
    s.products.forEach(p => {
      if (p.name.toLowerCase().includes(needle)) {
        results.push({ supplier_id: s.id, supplier_name: s.name, ...p });
      }
    });
  });
  results.sort((a, b) => a.price - b.price);
  return results;
}

function addSupplierProduct(supplierId, product) {
  if (!product || !product.name) throw new Error('اسم المنتج/الخدمة (name) مطلوب');
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  const record = {
    id: newId('PRD'),
    name: product.name,
    unit: product.unit || '',
    price: Number(product.price) || 0,
    currency: product.currency || 'SAR',
    updated_at: nowISO(),
  };
  supplier.products.push(record);
  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'product_added', summary: `منتج/خدمة: ${record.name}` });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'add_product', target_id: supplierId, summary: record.name });
  return { success: true, data: record };
}

function updateSupplierProductPrice(supplierId, productId, price) {
  const p = Number(price);
  if (Number.isNaN(p) || p < 0) throw new Error('السعر (price) غير صحيح');
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  const product = supplier.products.find(pr => pr.id === productId);
  if (!product) throw new Error('المنتج غير موجود لدى هذا المورد');
  const oldPrice = product.price;
  product.price = p;
  product.updated_at = nowISO();
  supplier.activity_log.push({
    id: newId('ACT'), at: nowISO(), type: 'price_updated',
    summary: `تحديث سعر ${product.name}: ${oldPrice} → ${p}`,
  });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'update_price', target_id: supplierId, summary: `${product.name}: ${oldPrice} -> ${p}` });
  return { success: true, data: product };
}

function addSupplierPayment(supplierId, payment) {
  const amount = Number(payment?.amount);
  if (Number.isNaN(amount) || amount <= 0) throw new Error('قيمة الدفعة (amount) يجب أن تكون رقماً أكبر من صفر');
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  const record = {
    id: newId('PAY'),
    amount,
    currency: payment.currency || 'SAR',
    date: payment.date || nowISO(),
    method: payment.method || '',
    reference: payment.reference || '',
    notes: payment.notes || '',
    created_at: nowISO(),
  };
  supplier.payments.push(record);
  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'payment', summary: `دفعة: ${amount} ${record.currency}` });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'add_payment', target_id: supplierId, summary: `${amount} ${record.currency}` });
  return { success: true, data: record };
}

function addSupplierDelivery(supplierId, delivery) {
  if (!delivery || !delivery.description) throw new Error('وصف التوريد (description) مطلوب');
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  const record = {
    id: newId('DLV'),
    description: delivery.description,
    date: delivery.date || nowISO(),
    on_time: delivery.on_time !== undefined ? Boolean(delivery.on_time) : null,
    value: Number(delivery.value) || 0,
    currency: delivery.currency || 'SAR',
    created_at: nowISO(),
  };
  supplier.deliveries.push(record);

  // إعادة احتساب مؤشرات الأداء تلقائياً من سجل التوريدات الفعلي
  const withOnTimeInfo = supplier.deliveries.filter(d => d.on_time !== null);
  supplier.performance.on_time_delivery_rate = withOnTimeInfo.length
    ? Math.round((withOnTimeInfo.filter(d => d.on_time).length / withOnTimeInfo.length) * 10000) / 100
    : null;
  supplier.performance.total_orders = supplier.deliveries.length;
  supplier.performance.total_value = Math.round(supplier.deliveries.reduce((s, d) => s + d.value, 0) * 100) / 100;

  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'delivery', summary: record.description });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'add_delivery', target_id: supplierId, summary: record.description });
  return { success: true, data: record };
}

function setSupplierQualityScore(supplierId, score) {
  const s = Number(score);
  if (Number.isNaN(s) || s < 0 || s > 5) throw new Error('تقييم الجودة (score) يجب أن يكون رقماً بين 0 و5');
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  supplier.performance.quality_score = s;
  supplier.activity_log.push({ id: newId('ACT'), at: nowISO(), type: 'quality_score', summary: `تقييم جودة: ${s}/5` });
  supplier.updated_at = nowISO();
  writeJSON(SUPPLIERS_FILE, db);
  logAudit({ module: 'crm_suppliers', action: 'set_quality_score', target_id: supplierId, summary: `${s}/5` });
  return { success: true, data: supplier.performance };
}

function getSupplierActivityLog(supplierId) {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const supplier = _touchSupplier(db, supplierId);
  return { success: true, data: supplier.activity_log.slice().sort((a, b) => new Date(b.at) - new Date(a.at)) };
}

function getSuppliersDashboard() {
  const db = readJSON(SUPPLIERS_FILE, defaultSuppliersDB());
  const items = db.suppliers;
  const byCategory = {};
  items.forEach(s => { byCategory[s.category] = (byCategory[s.category] || 0) + 1; });

  const scored = items.filter(s => typeof s.performance.quality_score === 'number');
  const avgQuality = scored.length
    ? Math.round((scored.reduce((sum, s) => sum + s.performance.quality_score, 0) / scored.length) * 100) / 100
    : null;

  return {
    success: true,
    data: {
      total_suppliers: items.length,
      by_category: byCategory,
      average_quality_score: avgQuality,
      total_purchase_value: Math.round(items.reduce((s, sup) => s + sup.performance.total_value, 0) * 100) / 100,
    },
  };
}

// ==================================================================
// ============================ سجل التدقيق =========================
// ==================================================================

function getAuditLog({ module = null, page = 1, pageSize = 100 } = {}) {
  let log = readJSON(AUDIT_FILE, []);
  if (module) log = log.filter(e => e.module === module);
  log = log.slice().sort((a, b) => new Date(b.at) - new Date(a.at));

  const total = log.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 100);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: log.slice(start, start + ps),
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

module.exports = {
  CLIENT_STATUSES,
  // العملاء
  createClient,
  listClients,
  getClient,
  updateClient,
  deleteClient,
  addClientMeeting,
  addClientCommunication,
  addClientNote,
  addClientAttachment,
  getClientActivityLog,
  getClientsDashboard,
  linkContractToClient,
  unlinkContractFromClient,
  // الموردون
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  addSupplierProduct,
  updateSupplierProductPrice,
  addSupplierPayment,
  addSupplierDelivery,
  setSupplierQualityScore,
  getSupplierActivityLog,
  getSuppliersDashboard,
  linkContractToSupplier,
  unlinkContractFromSupplier,
  linkPurchaseOrderToSupplier,
  getSupplierProductPrice,
  compareSupplierPricesByProductName,
  // مشترك
  getAuditLog,
};
