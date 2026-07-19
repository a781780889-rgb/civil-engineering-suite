/**
 * القسم الثامن - نظام إدارة السلامة المهنية (HSE)
 * وحدة إدارة المخالفات (Violations Management) - وحدة مستقلة
 * =====================================================================================
 * سجل مستقل بالكامل للمخالفات (لا يعتمد على جولات التفتيش)، يشمل:
 * نوع المخالفة، درجة الخطورة، الشخص المسؤول، الموقع، الصور، تاريخ المخالفة،
 * الإجراءات التصحيحية، موعد الإغلاق، حالة التنفيذ.
 *
 * التخزين: ملف JSON منفصل (backend/data/hseViolations.json) بنفس نمط
 * hseManagement.js / hseHazmat.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 45001 وOSHA في تصنيف درجات المخالفات وإجراءات الإغلاق.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل مخالفة تُصنَّف بدرجة خطورة فعلية (بسيطة/متوسطة/كبيرة/حرجة) تتحكم في
 *    مهلة الإغلاق الافتراضية (SLA) وتحدد الأولوية.
 *  - عند حساب "متأخرة" يتم فعلياً مقارنة موعد الإغلاق المستهدف بتاريخ اليوم.
 *  - لا يمكن إغلاق مخالفة دون إجراء تصحيحي فعلي مسجَّل.
 *  - إحصائيات لوحة التحكم (معدل الالتزام، توزيع الخطورة، حالة التنفيذ) تُحسب
 *    فعلياً من السجل وليست أرقاماً وهمية.
 *  - جميع العمليات تُسجَّل في سجل تدقيق (Audit Log) منفصل لهذه الوحدة.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hseViolations.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      violations: {}, // { id: violationRecord }
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
    throw new Error('تعذر قراءة قاعدة بيانات المخالفات: ' + e.message);
  }
  let migrated = false;
  if (!store.violations) { store.violations = {}; migrated = true; }
  if (!store.auditLog) { store.auditLog = []; migrated = true; }
  if (typeof store.seq !== 'number') { store.seq = 0; migrated = true; }
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

const VIOLATION_TYPES = [
  'ppe_non_compliance', 'unsafe_act', 'unsafe_condition', 'housekeeping',
  'permit_violation', 'equipment_misuse', 'environmental', 'documentation',
  'access_control', 'other',
];
const VIOLATION_TYPE_LABELS = {
  ppe_non_compliance: 'عدم الالتزام بمعدات الوقاية', unsafe_act: 'تصرف غير آمن',
  unsafe_condition: 'حالة غير آمنة', housekeeping: 'نظافة وترتيب الموقع',
  permit_violation: 'مخالفة تصريح عمل', equipment_misuse: 'سوء استخدام معدات',
  environmental: 'مخالفة بيئية', documentation: 'مخالفة توثيق/مستندات',
  access_control: 'مخالفة تحكم بالدخول', other: 'أخرى',
};

const VIOLATION_SEVERITIES = ['minor', 'moderate', 'major', 'critical'];
const VIOLATION_SEVERITY_LABELS = {
  minor: 'بسيطة', moderate: 'متوسطة', major: 'كبيرة', critical: 'حرجة (توقف عمل)',
};
// مهلة الإغلاق الافتراضية (أيام) حسب درجة الخطورة - تُستخدم لتحديد موعد الإغلاق المستهدف تلقائياً
const VIOLATION_SEVERITY_SLA_DAYS = { minor: 14, moderate: 7, major: 3, critical: 1 };

const VIOLATION_STATUSES = ['open', 'in_progress', 'closed', 'overdue'];
const VIOLATION_STATUS_LABELS = {
  open: 'مفتوحة', in_progress: 'قيد المعالجة', closed: 'مغلقة', overdue: 'متأخرة',
};

// ===================== دوال مساعدة =====================

function computeEffectiveStatus(record) {
  if (record.status === 'closed') return 'closed';
  const target = record.target_close_date;
  if (target && target < todayStr()) return 'overdue';
  return record.status === 'in_progress' ? 'in_progress' : 'open';
}

function validateInput(body) {
  if (!body || typeof body !== 'object') throw new Error('بيانات المخالفة مطلوبة');
  if (!body.description || !String(body.description).trim()) throw new Error('وصف المخالفة مطلوب');
  if (!body.type || !VIOLATION_TYPES.includes(body.type)) throw new Error(`نوع المخالفة غير صحيح: ${body.type}`);
  if (!body.severity || !VIOLATION_SEVERITIES.includes(body.severity)) throw new Error(`درجة خطورة المخالفة غير صحيحة: ${body.severity}`);
  if (!body.project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
}

// ===================== العمليات الأساسية (CRUD) =====================

function createViolation(body) {
  validateInput(body);
  const store = loadStore();

  const id = newId('VIOL');
  const code = generateCode(store, 'VIO');
  const violationDate = body.violation_date || todayStr();
  const slaDays = VIOLATION_SEVERITY_SLA_DAYS[body.severity] || 7;
  const targetCloseDate = body.target_close_date || addDays(violationDate, slaDays);

  const record = {
    id,
    code,
    project_id: body.project_id,
    type: body.type,
    severity: body.severity,
    description: String(body.description).trim(),
    location: body.location || null,
    responsible_person: body.responsible_person || null,
    reported_by: body.reported_by || null,
    violation_date: violationDate,
    target_close_date: targetCloseDate,
    photo_urls: Array.isArray(body.photo_urls) ? body.photo_urls : (body.photo_url ? [body.photo_url] : []),
    corrective_action: body.corrective_action || null,
    status: 'open',
    closed_at: null,
    closed_by: null,
    closure_notes: null,
    source: body.source || 'manual', // manual | inspection | audit | other
    related_entity_id: body.related_entity_id || null, // لربط اختياري بمصدر خارجي (مثال: جولة تفتيش) دون اعتمادية
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.violations[id] = record;

  audit(store, { action: 'create', entity: 'violation', entityId: id, projectId: record.project_id, details: { severity: record.severity, type: record.type } });
  saveStore(store);
  return { success: true, data: record };
}

function listViolations(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.violations).filter(v => v.is_active !== false);

  if (filters.projectId) items = items.filter(v => v.project_id === filters.projectId);
  if (filters.type) items = items.filter(v => v.type === filters.type);
  if (filters.severity) items = items.filter(v => v.severity === filters.severity);
  if (filters.status) items = items.filter(v => computeEffectiveStatus(v) === filters.status);
  if (filters.responsiblePerson) {
    const q = String(filters.responsiblePerson).toLowerCase();
    items = items.filter(v => (v.responsible_person || '').toLowerCase().includes(q));
  }
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    items = items.filter(v =>
      (v.code || '').toLowerCase().includes(q) ||
      (v.description || '').toLowerCase().includes(q) ||
      (v.location || '').toLowerCase().includes(q));
  }
  if (filters.dateFrom) items = items.filter(v => v.violation_date >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(v => v.violation_date <= filters.dateTo);

  // إسقاط الحالة الفعلية (تحسب "متأخرة" ديناميكياً) دون تعديل السجل المخزّن
  items = items.map(v => ({ ...v, effective_status: computeEffectiveStatus(v) }));
  items = items.sort((a, b) => (b.violation_date || '').localeCompare(a.violation_date || ''));

  return { success: true, data: items, count: items.length };
}

function getViolation(id) {
  const store = loadStore();
  const record = store.violations[id];
  if (!record) throw new Error('المخالفة غير موجودة');
  return { success: true, data: { ...record, effective_status: computeEffectiveStatus(record) } };
}

function updateViolation(id, updates) {
  const store = loadStore();
  const record = store.violations[id];
  if (!record) throw new Error('المخالفة غير موجودة');

  if (updates.type && !VIOLATION_TYPES.includes(updates.type)) throw new Error(`نوع المخالفة غير صحيح: ${updates.type}`);
  if (updates.severity && !VIOLATION_SEVERITIES.includes(updates.severity)) throw new Error(`درجة الخطورة غير صحيحة: ${updates.severity}`);
  if (updates.status && !VIOLATION_STATUSES.includes(updates.status)) throw new Error(`حالة المخالفة غير صحيحة: ${updates.status}`);
  if (updates.status === 'closed') throw new Error('استخدم دالة إغلاق المخالفة (closeViolation) لإغلاق مخالفة');

  const blocked = ['id', 'code', 'created_at', 'project_id', 'closed_at', 'closed_by'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();

  audit(store, { action: 'update', entity: 'violation', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: { ...record, effective_status: computeEffectiveStatus(record) } };
}

function deleteViolation(id) {
  const store = loadStore();
  const record = store.violations[id];
  if (!record) throw new Error('المخالفة غير موجودة');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'violation', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

function closeViolation(id, { closed_by = null, closure_notes = null } = {}) {
  const store = loadStore();
  const record = store.violations[id];
  if (!record) throw new Error('المخالفة غير موجودة');
  if (!record.corrective_action || !String(record.corrective_action).trim()) {
    throw new Error('لا يمكن إغلاق المخالفة دون تسجيل إجراء تصحيحي فعلي');
  }
  record.status = 'closed';
  record.closed_by = closed_by;
  record.closure_notes = closure_notes;
  record.closed_at = nowISO();
  record.updated_at = nowISO();

  audit(store, { action: 'close', entity: 'violation', entityId: id, projectId: record.project_id, details: { closed_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== لوحة التحكم والإحصائيات =====================

function getViolationsDashboard(projectId = null) {
  const store = loadStore();
  let items = Object.values(store.violations).filter(v => v.is_active !== false);
  if (projectId) items = items.filter(v => v.project_id === projectId);

  items = items.map(v => ({ ...v, effective_status: computeEffectiveStatus(v) }));

  const total = items.length;
  const open = items.filter(v => v.effective_status === 'open').length;
  const inProgress = items.filter(v => v.effective_status === 'in_progress').length;
  const closed = items.filter(v => v.effective_status === 'closed').length;
  const overdue = items.filter(v => v.effective_status === 'overdue').length;

  const byType = {};
  for (const t of VIOLATION_TYPES) byType[t] = 0;
  for (const v of items) byType[v.type] = (byType[v.type] || 0) + 1;

  const bySeverity = { minor: 0, moderate: 0, major: 0, critical: 0 };
  for (const v of items) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;

  const closedItems = items.filter(v => v.status === 'closed' && v.closed_at);
  const avgClosureDays = closedItems.length
    ? r2(closedItems.reduce((s, v) => {
        const days = (new Date(v.closed_at) - new Date(v.violation_date)) / (1000 * 60 * 60 * 24);
        return s + Math.max(0, days);
      }, 0) / closedItems.length)
    : 0;

  const closureRate = total > 0 ? r2((closed / total) * 100) : 0;

  const recentViolations = items
    .sort((a, b) => (b.violation_date || '').localeCompare(a.violation_date || ''))
    .slice(0, 10);

  const overdueList = items
    .filter(v => v.effective_status === 'overdue')
    .sort((a, b) => (a.target_close_date || '').localeCompare(b.target_close_date || ''))
    .slice(0, 10);

  return {
    success: true,
    data: {
      total_violations: total,
      open_violations: open,
      in_progress_violations: inProgress,
      closed_violations: closed,
      overdue_violations: overdue,
      closure_rate: closureRate,
      avg_closure_days: avgClosureDays,
      by_type: byType,
      by_severity: bySeverity,
      recent_violations: recentViolations,
      overdue_violations_list: overdueList,
    },
  };
}

function getOverdueViolations(projectId = null) {
  const res = listViolations({ projectId });
  const overdue = res.data.filter(v => v.effective_status === 'overdue');
  return { success: true, data: overdue, count: overdue.length };
}

module.exports = {
  // ثوابت
  VIOLATION_TYPES,
  VIOLATION_TYPE_LABELS,
  VIOLATION_SEVERITIES,
  VIOLATION_SEVERITY_LABELS,
  VIOLATION_SEVERITY_SLA_DAYS,
  VIOLATION_STATUSES,
  VIOLATION_STATUS_LABELS,

  // العمليات الأساسية
  createViolation,
  listViolations,
  getViolation,
  updateViolation,
  deleteViolation,
  closeViolation,

  // لوحة التحكم
  getViolationsDashboard,
  getOverdueViolations,
};
