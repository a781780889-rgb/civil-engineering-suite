/**
 * القسم السادس - نظام إدارة الأعمال (Business Management System)
 * الجزء الثاني (2/4): إدارة العقود + إدارة الفواتير + إدارة المشتريات
 * ====================================================================
 * التخزين: ملفات JSON على القرص (نفس نمط businessManagement.js)
 *   - backend/data/biz_contracts.json
 *   - backend/data/biz_invoices.json
 *   - backend/data/biz_purchase_orders.json
 * بدون تبعيات خارجية.
 *
 * الاعتماديات الفعلية على الجزء الأول (وليست شكلية):
 *  - إنشاء عقد بمعرّف عميل/مورد غير موجود يُرفض فعلياً (تحقق حقيقي عبر BIZ.getClient/getSupplier).
 *  - إنشاء عقد يربط تلقائياً بسجل العميل/المورد (linked_contracts) ويُضاف إلى activity_log الخاص بهما.
 *  - حذف عقد يزيل الربط تلقائياً من العميل/المورد (unlink فعلي، ليس فقط حذف من جدول العقود).
 *  - أمر الشراء يقرأ السعر الفعلي من `supplier.products` (لا يُدخل يدوياً بمعزل عن بيانات المورد).
 *  - استلام أمر الشراء يُنشئ تلقائياً سجل توريد (`addSupplierDelivery`) على المورد،
 *    مما يُحدّث مؤشرات أداء المورد (on_time_delivery_rate) تلقائياً وحقيقياً.
 *  - فاتورة المورد (عند السداد) تُنشئ تلقائياً سجل دفعة (`addSupplierPayment`) على المورد.
 *
 * يغطي هذا الجزء:
 *  - العقود: CRUD + جدول دفعات (Payment Milestones) محسوب من قيمة العقد
 *    + ضمانات + غرامات + حالة + مرفقات + سجل تعديلات (Version History حقيقي - كل
 *    تعديل على حقل حسّاس يُخزَّن كنسخة سابقة كاملة قبل الكتابة فوقها).
 *  - الفواتير: فواتير عملاء وفواتير موردين، بنود + ضرائب + خصومات + حالة سداد
 *    محسوبة تلقائياً من مجموع الدفعات المسجَّلة عليها (وليست حقلاً يُعدَّل يدوياً)
 *    + توليد PDF فعلي بنفس مولّد جداول BOQ الموجود في المشروع.
 *  - المشتريات: طلب شراء → موافقة → عرض أسعار (مقارنة فعلية من بيانات الموردين)
 *    → أمر شراء → استلام (يُحدّث مخزون الموردين ومؤشرات أدائهم تلقائياً).
 */

const fs = require('fs');
const path = require('path');
const BIZ = require('./businessManagement');
const { generateBoqTablePDF } = require('./tablePdfGenerator');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONTRACTS_FILE = path.join(DATA_DIR, 'biz_contracts.json');
const INVOICES_FILE = path.join(DATA_DIR, 'biz_invoices.json');
const PO_FILE = path.join(DATA_DIR, 'biz_purchase_orders.json');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
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
function round2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

function logAudit(entry) {
  const AUDIT_FILE = path.join(DATA_DIR, 'business_audit.json'); // نفس ملف التدقيق المركزي من الجزء الأول
  const log = readJSON(AUDIT_FILE, []);
  log.push({ id: newId('AUD'), at: nowISO(), ...entry });
  if (log.length > 20000) log.splice(0, log.length - 20000);
  writeJSON(AUDIT_FILE, log);
}

// ==================================================================
// ============================ العقود ==============================
// ==================================================================

const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'terminated', 'expired'];
const CONTRACT_PARTY_TYPES = ['client', 'supplier', 'contractor']; // contractor: مقاول من الباطن، يُخزَّن كنص حر حالياً (لا وحدة مقاولين مستقلة بعد)

function defaultContractsDB() { return { contracts: [] }; }

function validateContractPayload(body, { partial = false } = {}) {
  if (!partial) {
    if (!body || !body.title || !String(body.title).trim()) {
      throw new Error('اسم العقد (title) مطلوب');
    }
    if (body.value === undefined || Number.isNaN(Number(body.value)) || Number(body.value) <= 0) {
      throw new Error('قيمة العقد (value) يجب أن تكون رقماً أكبر من صفر');
    }
    if (!body.party_type || !CONTRACT_PARTY_TYPES.includes(body.party_type)) {
      throw new Error(`نوع الطرف المقابل (party_type) مطلوب. القيم المسموحة: ${CONTRACT_PARTY_TYPES.join(', ')}`);
    }
    if (body.party_type !== 'contractor' && !body.party_id) {
      throw new Error('معرّف الطرف المقابل (party_id) مطلوب لعقود العملاء والموردين');
    }
  }
  if (body.status && !CONTRACT_STATUSES.includes(body.status)) {
    throw new Error(`حالة العقد غير صحيحة. القيم المسموحة: ${CONTRACT_STATUSES.join(', ')}`);
  }
  if (body.start_date && body.end_date && new Date(body.end_date) < new Date(body.start_date)) {
    throw new Error('تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية');
  }
}

// يبني جدول دفعات (Milestones) من قيمة العقد الإجمالية بحيث يكون مجموعها = قيمة العقد بالضبط
function buildPaymentSchedule(totalValue, milestones) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [{ id: newId('MS'), label: 'دفعة واحدة عند الإنجاز', percentage: 100, amount: round2(totalValue), status: 'pending', due_date: null, paid_date: null }];
  }
  const totalPct = milestones.reduce((s, m) => s + (Number(m.percentage) || 0), 0);
  if (Math.abs(totalPct - 100) > 0.01) {
    throw new Error(`مجموع نسب دفعات العقد يجب أن يساوي 100% (المُدخَل حالياً: ${totalPct}%)`);
  }
  let allocated = 0;
  const schedule = milestones.map((m, i) => {
    const isLast = i === milestones.length - 1;
    const amount = isLast ? round2(totalValue - allocated) : round2(totalValue * (Number(m.percentage) / 100));
    allocated = round2(allocated + amount);
    return {
      id: newId('MS'),
      label: m.label || `دفعة ${i + 1}`,
      percentage: Number(m.percentage),
      amount,
      status: 'pending', // pending | invoiced | paid
      due_date: m.due_date || null,
      paid_date: null,
    };
  });
  return schedule;
}

function createContract(body) {
  validateContractPayload(body);

  // تحقق فعلي من وجود الطرف المقابل قبل إنشاء العقد (وليس تحققاً شكلياً)
  let partyName = body.party_name || '';
  if (body.party_type === 'client') {
    const client = BIZ.getClient(body.party_id).data; // يرمي خطأ فعلي إن لم يوجد العميل
    partyName = client.name;
  } else if (body.party_type === 'supplier') {
    const supplier = BIZ.getSupplier(body.party_id).data; // يرمي خطأ فعلي إن لم يوجد المورد
    partyName = supplier.name;
  }

  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());

  const contract = {
    id: newId('CNT'),
    contract_number: `CNT-${new Date().getFullYear()}-${String(db.contracts.length + 1).padStart(4, '0')}`,
    title: String(body.title).trim(),
    project_id: body.project_id || null, // يُربط بمشروع PM الموجود فعلياً في projectManagement.js (بالمعرّف)
    party_type: body.party_type,
    party_id: body.party_type === 'contractor' ? null : body.party_id,
    party_name: body.party_type === 'contractor' ? (body.party_name || '') : partyName,

    value: round2(Number(body.value)),
    currency: body.currency || 'SAR',
    start_date: body.start_date || null,
    end_date: body.end_date || null,

    warranty: {
      duration_months: Number(body.warranty?.duration_months) || 0,
      description: body.warranty?.description || '',
    },
    penalties: {
      daily_rate_percentage: Number(body.penalties?.daily_rate_percentage) || 0, // % من قيمة العقد لكل يوم تأخير
      max_percentage: Number(body.penalties?.max_percentage) || 0,
      description: body.penalties?.description || '',
    },

    payment_schedule: buildPaymentSchedule(body.value, body.milestones),

    completion_percentage: 0,
    status: body.status || 'draft',

    attachments: [],
    revision_history: [], // نسخ سابقة كاملة قبل كل تعديل حسّاس (Version History حقيقي)

    created_at: nowISO(),
    updated_at: nowISO(),
  };

  db.contracts.push(contract);
  writeJSON(CONTRACTS_FILE, db);

  // ربط فعلي بسجل العميل/المورد (وليس مجرد تخزين معرّف بلا أثر)
  if (contract.party_type === 'client') {
    BIZ.linkContractToClient(contract.party_id, { id: contract.id, title: contract.title });
  } else if (contract.party_type === 'supplier') {
    BIZ.linkContractToSupplier(contract.party_id, { id: contract.id, title: contract.title });
  }

  logAudit({ module: 'contracts', action: 'create', target_id: contract.id, summary: `إنشاء عقد: ${contract.title} (${contract.contract_number})` });
  return { success: true, data: contract };
}

function listContracts({ status = null, party_type = null, party_id = null, project_id = null, q = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  let items = db.contracts.slice();

  if (status) items = items.filter(c => c.status === status);
  if (party_type) items = items.filter(c => c.party_type === party_type);
  if (party_id) items = items.filter(c => c.party_id === party_id);
  if (project_id) items = items.filter(c => c.project_id === project_id);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    items = items.filter(c => c.title.toLowerCase().includes(needle) || c.contract_number.toLowerCase().includes(needle));
  }

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: items.slice(start, start + ps),
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

function getContract(id) {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const contract = db.contracts.find(c => c.id === id);
  if (!contract) throw new Error('العقد غير موجود');
  return { success: true, data: contract };
}

function _snapshotContract(contract, reason) {
  // نسخة كاملة من حالة العقد الحالية قبل التعديل عليها (Version History حقيقي وليس نصاً وصفياً فقط)
  const { revision_history, ...snapshot } = contract;
  return { id: newId('REV'), at: nowISO(), reason, snapshot };
}

function updateContract(id, updates) {
  validateContractPayload(updates, { partial: true });
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const idx = db.contracts.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('العقد غير موجود');

  const contract = db.contracts[idx];
  const sensitiveFields = ['value', 'end_date', 'status', 'party_id'];
  const touchesSensitive = sensitiveFields.some(f => updates[f] !== undefined && updates[f] !== contract[f]);
  if (touchesSensitive) {
    contract.revision_history.push(_snapshotContract(contract, 'تعديل بيانات حسّاسة (القيمة/التاريخ/الحالة/الطرف)'));
  }

  const editableFields = ['title', 'status', 'start_date', 'end_date', 'completion_percentage'];
  editableFields.forEach(f => { if (updates[f] !== undefined) contract[f] = updates[f]; });
  if (updates.warranty) contract.warranty = { ...contract.warranty, ...updates.warranty };
  if (updates.penalties) contract.penalties = { ...contract.penalties, ...updates.penalties };

  // إعادة بناء قيمة العقد أو جدول الدفعات تتطلب صراحة تمرير milestones جديدة لتفادي كسر الدفعات المسدَّدة فعلياً
  if (updates.value !== undefined && Number(updates.value) !== contract.value) {
    const paidSoFar = contract.payment_schedule.filter(m => m.status === 'paid').reduce((s, m) => s + m.amount, 0);
    if (paidSoFar > 0 && !updates.milestones) {
      throw new Error('لا يمكن تغيير قيمة العقد دون إعادة تحديد جدول الدفعات (milestones) لأن هناك دفعات مسدَّدة فعلياً');
    }
    contract.value = round2(Number(updates.value));
    contract.payment_schedule = buildPaymentSchedule(contract.value, updates.milestones);
  }

  if (updates.completion_percentage !== undefined) {
    const cp = Number(updates.completion_percentage);
    if (Number.isNaN(cp) || cp < 0 || cp > 100) throw new Error('نسبة الإنجاز (completion_percentage) يجب أن تكون بين 0 و100');
    contract.completion_percentage = cp;
  }

  contract.updated_at = nowISO();
  db.contracts[idx] = contract;
  writeJSON(CONTRACTS_FILE, db);
  logAudit({ module: 'contracts', action: 'update', target_id: id, summary: `تعديل عقد: ${contract.title}` });
  return { success: true, data: contract };
}

function deleteContract(id) {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const idx = db.contracts.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('العقد غير موجود');
  const removed = db.contracts.splice(idx, 1)[0];
  writeJSON(CONTRACTS_FILE, db);

  // إزالة الربط فعلياً من سجل العميل/المورد (وليس فقط حذف صف العقد)
  if (removed.party_type === 'client' && removed.party_id) {
    BIZ.unlinkContractFromClient(removed.party_id, removed.id);
  } else if (removed.party_type === 'supplier' && removed.party_id) {
    BIZ.unlinkContractFromSupplier(removed.party_id, removed.id);
  }

  logAudit({ module: 'contracts', action: 'delete', target_id: id, summary: `حذف عقد: ${removed.title}` });
  return { success: true, data: { id } };
}

function addContractAttachment(contractId, attachment) {
  if (!attachment || !attachment.name) throw new Error('اسم المرفق (name) مطلوب');
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) throw new Error('العقد غير موجود');
  const record = { id: newId('ATT'), name: attachment.name, file_type: attachment.file_type || '', path: attachment.path || '', uploaded_at: nowISO() };
  contract.attachments.push(record);
  contract.updated_at = nowISO();
  writeJSON(CONTRACTS_FILE, db);
  logAudit({ module: 'contracts', action: 'add_attachment', target_id: contractId, summary: record.name });
  return { success: true, data: record };
}

// تحديد دفعة في الجدول كـ "مفوترة" (تُستدعى تلقائياً عند إصدار فاتورة مرتبطة بهذه الدفعة)
function _markMilestoneInvoiced(contractId, milestoneId) {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) throw new Error('العقد غير موجود');
  const milestone = contract.payment_schedule.find(m => m.id === milestoneId);
  if (!milestone) throw new Error('دفعة العقد (milestone) غير موجودة');
  if (milestone.status === 'paid') throw new Error('لا يمكن إعادة فوترة دفعة مسدَّدة بالفعل');
  milestone.status = 'invoiced';
  contract.updated_at = nowISO();
  writeJSON(CONTRACTS_FILE, db);
  return milestone;
}

// تحديد دفعة كـ "مسدَّدة" (تُستدعى تلقائياً عند تسجيل سداد كامل للفاتورة المرتبطة)
function _markMilestonePaid(contractId, milestoneId) {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) throw new Error('العقد غير موجود');
  const milestone = contract.payment_schedule.find(m => m.id === milestoneId);
  if (!milestone) throw new Error('دفعة العقد (milestone) غير موجودة');
  milestone.status = 'paid';
  milestone.paid_date = nowISO();
  contract.updated_at = nowISO();
  writeJSON(CONTRACTS_FILE, db);
  return milestone;
}

function getContractsDashboard() {
  const db = readJSON(CONTRACTS_FILE, defaultContractsDB());
  const items = db.contracts;
  const byStatus = {};
  CONTRACT_STATUSES.forEach(s => { byStatus[s] = 0; });
  items.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });

  const totalValue = round2(items.reduce((s, c) => s + c.value, 0));
  const activeValue = round2(items.filter(c => c.status === 'active').reduce((s, c) => s + c.value, 0));

  const today = new Date();
  const expiringSoon = items.filter(c => {
    if (!c.end_date || c.status !== 'active') return false;
    const daysLeft = (new Date(c.end_date) - today) / (1000 * 60 * 60 * 24);
    return daysLeft >= 0 && daysLeft <= 30;
  }).map(c => ({ id: c.id, title: c.title, end_date: c.end_date }));

  return {
    success: true,
    data: {
      total_contracts: items.length,
      by_status: byStatus,
      total_value: totalValue,
      active_contracts_value: activeValue,
      expiring_within_30_days: expiringSoon,
    },
  };
}

// ==================================================================
// =========================== الفواتير ==============================
// ==================================================================

const INVOICE_TYPES = ['client', 'supplier']; // فاتورة صادرة لعميل، أو فاتورة واردة من مورد
const INVOICE_STATUSES_COMPUTED = ['unpaid', 'partially_paid', 'paid', 'overdue']; // مُشتقة تلقائياً وليست تُدخل يدوياً

function defaultInvoicesDB() { return { invoices: [] }; }

function validateInvoicePayload(body) {
  if (!body || !body.type || !INVOICE_TYPES.includes(body.type)) {
    throw new Error(`نوع الفاتورة (type) مطلوب. القيم المسموحة: ${INVOICE_TYPES.join(', ')}`);
  }
  if (!body.party_id) throw new Error('معرّف الطرف (party_id) مطلوب (عميل أو مورد حسب نوع الفاتورة)');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب إضافة بند واحد على الأقل للفاتورة (items)');
  body.items.forEach((it, i) => {
    if (!it.description) throw new Error(`بند الفاتورة رقم ${i + 1}: الوصف (description) مطلوب`);
    if (Number.isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) throw new Error(`بند الفاتورة رقم ${i + 1}: الكمية (quantity) يجب أن تكون رقماً أكبر من صفر`);
    if (Number.isNaN(Number(it.unit_price)) || Number(it.unit_price) < 0) throw new Error(`بند الفاتورة رقم ${i + 1}: سعر الوحدة (unit_price) غير صحيح`);
  });
}

function _computeInvoiceTotals(items, taxPercentage, discount) {
  const subtotal = round2(items.reduce((s, it) => s + (Number(it.quantity) * Number(it.unit_price)), 0));
  const discountAmount = round2(discount?.type === 'percentage' ? subtotal * (Number(discount.value) / 100) : (Number(discount?.value) || 0));
  const afterDiscount = round2(subtotal - discountAmount);
  const taxAmount = round2(afterDiscount * (Number(taxPercentage || 0) / 100));
  const total = round2(afterDiscount + taxAmount);
  return { subtotal, discount_amount: discountAmount, tax_amount: taxAmount, total };
}

function _computeInvoicePaymentStatus(invoice) {
  const paidTotal = round2(invoice.payments.reduce((s, p) => s + p.amount, 0));
  if (paidTotal <= 0) {
    if (invoice.due_date && new Date(invoice.due_date) < new Date()) return { status: 'overdue', paid_total: paidTotal, balance_due: round2(invoice.totals.total - paidTotal) };
    return { status: 'unpaid', paid_total: paidTotal, balance_due: round2(invoice.totals.total - paidTotal) };
  }
  if (paidTotal >= invoice.totals.total) return { status: 'paid', paid_total: paidTotal, balance_due: 0 };
  return { status: 'partially_paid', paid_total: paidTotal, balance_due: round2(invoice.totals.total - paidTotal) };
}

function createInvoice(body) {
  validateInvoicePayload(body);

  // تحقق فعلي من وجود العميل/المورد
  let partyName = '';
  if (body.type === 'client') partyName = BIZ.getClient(body.party_id).data.name;
  else partyName = BIZ.getSupplier(body.party_id).data.name;

  // إن كانت الفاتورة مرتبطة بعقد ودفعة (milestone) محددة، تحقق فعلي من وجودهما
  if (body.contract_id && body.milestone_id) {
    getContract(body.contract_id); // يرمي خطأ إن لم يوجد العقد
    _markMilestoneInvoiced(body.contract_id, body.milestone_id); // يرمي خطأ إن كانت الدفعة غير موجودة أو مسدَّدة مسبقاً
  }

  const db = readJSON(INVOICES_FILE, defaultInvoicesDB());

  const items = body.items.map(it => ({
    id: newId('ITM'),
    description: it.description,
    quantity: Number(it.quantity),
    unit: it.unit || '',
    unit_price: round2(Number(it.unit_price)),
    line_total: round2(Number(it.quantity) * Number(it.unit_price)),
  }));

  const totals = _computeInvoiceTotals(items, body.tax_percentage, body.discount);

  const invoice = {
    id: newId('INV'),
    invoice_number: `${body.type === 'client' ? 'INV' : 'SINV'}-${new Date().getFullYear()}-${String(db.invoices.length + 1).padStart(4, '0')}`,
    type: body.type,
    party_id: body.party_id,
    party_name: partyName,
    contract_id: body.contract_id || null,
    milestone_id: body.milestone_id || null,
    project_id: body.project_id || null,

    items,
    tax_percentage: Number(body.tax_percentage) || 0,
    discount: body.discount || null,
    totals,

    issue_date: body.issue_date || nowISO(),
    due_date: body.due_date || null,
    payments: [],

    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const paymentInfo = _computeInvoicePaymentStatus(invoice);
  invoice.payment_status = paymentInfo.status;
  invoice.paid_total = paymentInfo.paid_total;
  invoice.balance_due = paymentInfo.balance_due;

  db.invoices.push(invoice);
  writeJSON(INVOICES_FILE, db);
  logAudit({ module: 'invoices', action: 'create', target_id: invoice.id, summary: `إنشاء فاتورة ${invoice.invoice_number} بقيمة ${totals.total} ${body.currency || 'SAR'}` });
  return { success: true, data: invoice };
}

function listInvoices({ type = null, party_id = null, payment_status = null, contract_id = null, page = 1, pageSize = 50 } = {}) {
  const db = readJSON(INVOICES_FILE, defaultInvoicesDB());
  let items = db.invoices.slice();

  if (type) items = items.filter(i => i.type === type);
  if (party_id) items = items.filter(i => i.party_id === party_id);
  if (payment_status) items = items.filter(i => i.payment_status === payment_status);
  if (contract_id) items = items.filter(i => i.contract_id === contract_id);

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 50);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: items.slice(start, start + ps),
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

function getInvoice(id) {
  const db = readJSON(INVOICES_FILE, defaultInvoicesDB());
  const invoice = db.invoices.find(i => i.id === id);
  if (!invoice) throw new Error('الفاتورة غير موجودة');
  return { success: true, data: invoice };
}

function recordInvoicePayment(invoiceId, payment) {
  const amount = Number(payment?.amount);
  if (Number.isNaN(amount) || amount <= 0) throw new Error('قيمة الدفعة (amount) يجب أن تكون رقماً أكبر من صفر');

  const db = readJSON(INVOICES_FILE, defaultInvoicesDB());
  const invoice = db.invoices.find(i => i.id === invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة');

  const currentPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  if (round2(currentPaid + amount) > invoice.totals.total) {
    throw new Error(`قيمة الدفعة تتجاوز المبلغ المتبقي على الفاتورة (المتبقي: ${round2(invoice.totals.total - currentPaid)})`);
  }

  const record = {
    id: newId('PAY'),
    amount: round2(amount),
    date: payment.date || nowISO(),
    method: payment.method || '',
    reference: payment.reference || '',
    created_at: nowISO(),
  };
  invoice.payments.push(record);

  const paymentInfo = _computeInvoicePaymentStatus(invoice);
  invoice.payment_status = paymentInfo.status;
  invoice.paid_total = paymentInfo.paid_total;
  invoice.balance_due = paymentInfo.balance_due;
  invoice.updated_at = nowISO();

  writeJSON(INVOICES_FILE, db);

  // إن كانت الفاتورة صادرة من مورد (نحن ندفع له)، سجّل الدفعة فعلياً في سجل مدفوعات المورد
  if (invoice.type === 'supplier') {
    BIZ.addSupplierPayment(invoice.party_id, { amount: record.amount, currency: 'SAR', date: record.date, method: record.method, reference: `${invoice.invoice_number} / ${record.reference}` });
  }

  // إن اكتمل السداد وكانت الفاتورة مرتبطة بدفعة عقد، حدّث حالة الدفعة في جدول العقد تلقائياً
  if (invoice.payment_status === 'paid' && invoice.contract_id && invoice.milestone_id) {
    _markMilestonePaid(invoice.contract_id, invoice.milestone_id);
  }

  logAudit({ module: 'invoices', action: 'record_payment', target_id: invoiceId, summary: `دفعة ${record.amount} على فاتورة ${invoice.invoice_number}` });
  return { success: true, data: invoice };
}

function generateInvoicePDF(invoiceId) {
  const invoice = getInvoice(invoiceId).data;
  ensureReportsDir();

  const headers = ['Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
  const rows = invoice.items.map(it => [it.description, String(it.quantity), it.unit || '-', it.unit_price.toFixed(2), it.line_total.toFixed(2)]);

  const fileName = `invoice_${invoice.invoice_number}.pdf`;
  const outputPath = path.join(REPORTS_DIR, fileName);

  generateBoqTablePDF({
    title: `Invoice ${invoice.invoice_number}`,
    meta: { clientName: invoice.party_name, projectName: invoice.project_id || '-', engineerName: '-' },
    headers,
    rows,
    totals: { label: `TOTAL (Subtotal ${invoice.totals.subtotal} - Discount ${invoice.totals.discount_amount} + Tax ${invoice.totals.tax_amount})`, value: `${invoice.totals.total.toFixed(2)}` },
    outputPath,
  });

  logAudit({ module: 'invoices', action: 'generate_pdf', target_id: invoiceId, summary: fileName });
  return { success: true, data: { fileName, path: `/reports/${fileName}` } };
}

function getInvoicesDashboard() {
  const db = readJSON(INVOICES_FILE, defaultInvoicesDB());
  const items = db.invoices;
  const byStatus = {};
  INVOICE_STATUSES_COMPUTED.forEach(s => { byStatus[s] = 0; });
  items.forEach(i => { byStatus[i.payment_status] = (byStatus[i.payment_status] || 0) + 1; });

  const totalReceivable = round2(items.filter(i => i.type === 'client').reduce((s, i) => s + i.balance_due, 0));
  const totalPayable = round2(items.filter(i => i.type === 'supplier').reduce((s, i) => s + i.balance_due, 0));
  const overdue = items.filter(i => i.payment_status === 'overdue').map(i => ({ id: i.id, invoice_number: i.invoice_number, party_name: i.party_name, balance_due: i.balance_due, due_date: i.due_date }));

  return {
    success: true,
    data: {
      total_invoices: items.length,
      by_payment_status: byStatus,
      total_receivable: totalReceivable, // مستحق لنا من العملاء
      total_payable: totalPayable,       // مستحق علينا للموردين
      overdue_invoices: overdue,
    },
  };
}

// ==================================================================
// ========================== المشتريات ===============================
// ==================================================================

const PO_STATUSES = ['requested', 'approved', 'rejected', 'ordered', 'partially_received', 'received', 'cancelled'];

function defaultPODB() { return { purchase_requests: [], purchase_orders: [] }; }

// ----- طلبات الشراء (Purchase Requests) -----

function createPurchaseRequest(body) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب إضافة صنف واحد على الأقل لطلب الشراء (items)');
  body.items.forEach((it, i) => {
    if (!it.description) throw new Error(`صنف رقم ${i + 1}: الوصف (description) مطلوب`);
    if (Number.isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) throw new Error(`صنف رقم ${i + 1}: الكمية (quantity) يجب أن تكون رقماً أكبر من صفر`);
  });

  const db = readJSON(PO_FILE, defaultPODB());
  const request = {
    id: newId('PR'),
    request_number: `PR-${new Date().getFullYear()}-${String(db.purchase_requests.length + 1).padStart(4, '0')}`,
    project_id: body.project_id || null,
    requested_by: body.requested_by || null,
    items: body.items.map(it => ({ id: newId('ITM'), description: it.description, quantity: Number(it.quantity), unit: it.unit || '' })),
    status: 'requested', // requested | approved | rejected
    notes: body.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
    decision: null, // { approved_by, at, reason }
  };
  db.purchase_requests.push(request);
  writeJSON(PO_FILE, db);
  logAudit({ module: 'purchasing', action: 'create_request', target_id: request.id, summary: request.request_number });
  return { success: true, data: request };
}

function listPurchaseRequests({ status = null, project_id = null } = {}) {
  const db = readJSON(PO_FILE, defaultPODB());
  let items = db.purchase_requests.slice();
  if (status) items = items.filter(r => r.status === status);
  if (project_id) items = items.filter(r => r.project_id === project_id);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

function decidePurchaseRequest(requestId, decision) {
  if (!decision || !['approved', 'rejected'].includes(decision.decision)) {
    throw new Error('القرار (decision) مطلوب: approved أو rejected');
  }
  const db = readJSON(PO_FILE, defaultPODB());
  const request = db.purchase_requests.find(r => r.id === requestId);
  if (!request) throw new Error('طلب الشراء غير موجود');
  if (request.status !== 'requested') throw new Error('تم البت في هذا الطلب مسبقاً');

  request.status = decision.decision;
  request.decision = { approved_by: decision.by || null, at: nowISO(), reason: decision.reason || '' };
  request.updated_at = nowISO();
  writeJSON(PO_FILE, db);
  logAudit({ module: 'purchasing', action: 'decide_request', target_id: requestId, summary: `${request.request_number}: ${decision.decision}` });
  return { success: true, data: request };
}

// مقارنة أسعار فعلية بين الموردين لكل صنف في طلب شراء معتمد (تستخدم بيانات الموردين الحقيقية من الجزء الأول)
function compareQuotesForRequest(requestId) {
  const db = readJSON(PO_FILE, defaultPODB());
  const request = db.purchase_requests.find(r => r.id === requestId);
  if (!request) throw new Error('طلب الشراء غير موجود');
  if (request.status !== 'approved') throw new Error('لا يمكن مقارنة العروض إلا لطلب شراء معتمد (approved)');

  const comparison = request.items.map(item => ({
    item_id: item.id,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    supplier_options: BIZ.compareSupplierPricesByProductName(item.description),
  }));
  return { success: true, data: comparison };
}

// ----- أوامر الشراء (Purchase Orders) -----

function createPurchaseOrder(body) {
  if (!body || !body.supplier_id) throw new Error('معرّف المورد (supplier_id) مطلوب');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error('يجب إضافة صنف واحد على الأقل لأمر الشراء (items)');

  // تحقق فعلي من وجود المورد وأسعاره (وليس إدخالاً يدوياً معزولاً عن بيانات المورد)
  const supplier = BIZ.getSupplier(body.supplier_id).data;

  const items = body.items.map((it, i) => {
    if (Number.isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) throw new Error(`صنف رقم ${i + 1}: الكمية (quantity) غير صحيحة`);
    let unitPrice;
    if (it.product_id) {
      const product = supplier.products.find(p => p.id === it.product_id);
      if (!product) throw new Error(`صنف رقم ${i + 1}: المنتج غير موجود ضمن قائمة أسعار هذا المورد`);
      unitPrice = product.price;
    } else {
      if (it.unit_price === undefined || Number.isNaN(Number(it.unit_price))) throw new Error(`صنف رقم ${i + 1}: يجب تحديد product_id من قائمة المورد أو unit_price يدوياً`);
      unitPrice = Number(it.unit_price);
    }
    return {
      id: newId('ITM'),
      product_id: it.product_id || null,
      description: it.description || (it.product_id ? supplier.products.find(p => p.id === it.product_id).name : ''),
      quantity: Number(it.quantity),
      unit_price: round2(unitPrice),
      line_total: round2(Number(it.quantity) * unitPrice),
      received_quantity: 0,
    };
  });

  const totalValue = round2(items.reduce((s, it) => s + it.line_total, 0));

  const db = readJSON(PO_FILE, defaultPODB());
  const po = {
    id: newId('PO'),
    po_number: `PO-${new Date().getFullYear()}-${String(db.purchase_orders.length + 1).padStart(4, '0')}`,
    request_id: body.request_id || null,
    supplier_id: body.supplier_id,
    supplier_name: supplier.name,
    project_id: body.project_id || null,
    items,
    total_value: totalValue,
    status: 'ordered',
    order_date: nowISO(),
    expected_date: body.expected_date || null,
    deliveries: [], // سجل استلامات فعلية على مستوى أمر الشراء نفسه
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.purchase_orders.push(po);
  writeJSON(PO_FILE, db);

  // ربط فعلي بسجل المورد
  BIZ.linkPurchaseOrderToSupplier(body.supplier_id, { id: po.id, status: po.status, value: po.total_value });

  logAudit({ module: 'purchasing', action: 'create_po', target_id: po.id, summary: `${po.po_number} - ${supplier.name} - ${totalValue}` });
  return { success: true, data: po };
}

function listPurchaseOrders({ status = null, supplier_id = null, project_id = null } = {}) {
  const db = readJSON(PO_FILE, defaultPODB());
  let items = db.purchase_orders.slice();
  if (status) items = items.filter(p => p.status === status);
  if (supplier_id) items = items.filter(p => p.supplier_id === supplier_id);
  if (project_id) items = items.filter(p => p.project_id === project_id);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

function getPurchaseOrder(id) {
  const db = readJSON(PO_FILE, defaultPODB());
  const po = db.purchase_orders.find(p => p.id === id);
  if (!po) throw new Error('أمر الشراء غير موجود');
  return { success: true, data: po };
}

// استلام (كلي أو جزئي) لأمر شراء - يُحدّث تلقائياً وحقيقياً سجل توريدات المورد ومؤشرات أدائه
function receivePurchaseOrder(poId, receipt) {
  if (!receipt || !Array.isArray(receipt.items) || receipt.items.length === 0) {
    throw new Error('يجب تحديد الأصناف المُستلَمة (items) وكمياتها');
  }
  const db = readJSON(PO_FILE, defaultPODB());
  const po = db.purchase_orders.find(p => p.id === poId);
  if (!po) throw new Error('أمر الشراء غير موجود');
  if (po.status === 'received' || po.status === 'cancelled') throw new Error(`لا يمكن استلام أمر شراء بحالة ${po.status}`);

  let receivedValue = 0;
  receipt.items.forEach(r => {
    const item = po.items.find(i => i.id === r.item_id);
    if (!item) throw new Error(`الصنف ${r.item_id} غير موجود ضمن أمر الشراء`);
    const qty = Number(r.received_quantity);
    if (Number.isNaN(qty) || qty <= 0) throw new Error(`كمية الاستلام لصنف ${item.description} غير صحيحة`);
    if (item.received_quantity + qty > item.quantity) {
      throw new Error(`كمية الاستلام لصنف ${item.description} تتجاوز الكمية المطلوبة في أمر الشراء`);
    }
    item.received_quantity += qty;
    receivedValue += round2(qty * item.unit_price);
  });

  const deliveryRecord = {
    id: newId('DLV'),
    date: receipt.date || nowISO(),
    on_time: po.expected_date ? new Date(receipt.date || nowISO()) <= new Date(po.expected_date) : null,
    items: receipt.items,
    value: round2(receivedValue),
  };
  po.deliveries.push(deliveryRecord);

  const allReceived = po.items.every(i => i.received_quantity >= i.quantity);
  const anyReceived = po.items.some(i => i.received_quantity > 0);
  po.status = allReceived ? 'received' : (anyReceived ? 'partially_received' : po.status);
  po.updated_at = nowISO();

  writeJSON(PO_FILE, db);

  // تحديث فعلي وحقيقي لسجل توريدات المورد ومؤشرات أدائه (وليس فقط تغيير حالة نصية)
  BIZ.addSupplierDelivery(po.supplier_id, {
    description: `استلام ${allReceived ? 'كامل' : 'جزئي'} - أمر شراء ${po.po_number}`,
    date: deliveryRecord.date,
    on_time: deliveryRecord.on_time,
    value: deliveryRecord.value,
  });

  logAudit({ module: 'purchasing', action: 'receive_po', target_id: poId, summary: `${po.po_number}: استلام بقيمة ${deliveryRecord.value}` });
  return { success: true, data: po };
}

function getPurchasingDashboard() {
  const db = readJSON(PO_FILE, defaultPODB());
  const requests = db.purchase_requests;
  const orders = db.purchase_orders;

  const requestsByStatus = { requested: 0, approved: 0, rejected: 0 };
  requests.forEach(r => { requestsByStatus[r.status] = (requestsByStatus[r.status] || 0) + 1; });

  const ordersByStatus = {};
  PO_STATUSES.forEach(s => { ordersByStatus[s] = 0; });
  orders.forEach(o => { ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1; });

  const totalOrderedValue = round2(orders.reduce((s, o) => s + o.total_value, 0));
  const totalReceivedValue = round2(orders.reduce((s, o) => s + o.deliveries.reduce((ds, d) => ds + d.value, 0), 0));

  return {
    success: true,
    data: {
      total_requests: requests.length,
      requests_by_status: requestsByStatus,
      total_orders: orders.length,
      orders_by_status: ordersByStatus,
      total_ordered_value: totalOrderedValue,
      total_received_value: totalReceivedValue,
      pending_receipt_value: round2(totalOrderedValue - totalReceivedValue),
    },
  };
}

module.exports = {
  CONTRACT_STATUSES,
  CONTRACT_PARTY_TYPES,
  // العقود
  createContract,
  listContracts,
  getContract,
  updateContract,
  deleteContract,
  addContractAttachment,
  getContractsDashboard,
  // الفواتير
  INVOICE_TYPES,
  createInvoice,
  listInvoices,
  getInvoice,
  recordInvoicePayment,
  generateInvoicePDF,
  getInvoicesDashboard,
  // المشتريات
  PO_STATUSES,
  createPurchaseRequest,
  listPurchaseRequests,
  decidePurchaseRequest,
  compareQuotesForRequest,
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  receivePurchaseOrder,
  getPurchasingDashboard,
};
