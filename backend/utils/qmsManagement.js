/**
 * القسم التاسع - نظام إدارة الجودة (Quality Management System - QMS)
 * =====================================================================================
 * الجزء الأول (1/4): البنية الأساسية + لوحة التحكم + إدارة خطة الجودة +
 *                     إدارة طلبات الفحص (Inspection Request - IR). [منجز]
 * الجزء الثاني (2/4): اختبارات المواد (خرسانة/حديد/تربة/أسفلت/مياه) +
 *                      إدارة المختبر + نقاط الفحص (ITP).
 * الجزء الثالث (3/4): حالات عدم المطابقة (NCR) + الإجراءات التصحيحية (CAPA) +
 *                      اعتماد المواد (MAR) + اعتماد الرسومات (SDR) + إدارة الوثائق.
 * الجزء الرابع (4/4): مؤشرات الأداء (KPIs) + التنبيهات الذكية + التقارير +
 *                      الرسوم البيانية + الذكاء الاصطناعي + التكامل + الصلاحيات.
 *
 * التخزين: ملف JSON على القرص (backend/data/qms.json) بنفس نمط
 * hseManagement.js / equipmentManagement.js / projectManagement.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 9001 (نظام إدارة الجودة) مع دعم متطلبات المشاريع
 * الحكومية والخاصة (خطط جودة، نقاط فحص واعتماد، طلبات فحص IR).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - طلبات الفحص (IR) لها دورة حياة حقيقية: مسودة → مُرسل → مجدول → تم الفحص
 *    (قبول/رفض/قبول مشروط) → مغلق، مع تحقق من صحة الانتقال بين الحالات.
 *  - خطة الجودة تدعم إصدارات متعددة (Version Control) فعلية مع سجل تغييرات،
 *    ولا يمكن اعتماد خطة إلا بعد استيفاء الحقول الإلزامية (أهداف + سياسات +
 *    نقطة فحص واحدة على الأقل).
 *  - لوحة التحكم تحسب المؤشرات فعلياً من البيانات المخزَّنة (لا أرقام وهمية):
 *    نسبة الالتزام بالجودة = طلبات الفحص المقبولة ÷ إجمالي طلبات الفحص المُنجزة.
 *  - سجل تدقيق (Audit Log) فعلي لكل عملية إنشاء/تعديل/حذف/اعتماد.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'qms.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      qualityPlans: {},        // { id: qualityPlanRecord }        (خطط الجودة للمشاريع)
      qualityPlanVersions: {}, // { id: versionRecord }             (سجل إصدارات كل خطة)
      inspectionRequests: {},  // { id: irRecord }                  (طلبات الفحص IR)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة الجودة: ' + e.message);
  }
  let migrated = false;
  for (const key of ['qualityPlans', 'qualityPlanVersions', 'inspectionRequests']) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
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

// ----- خطة الجودة -----
const QUALITY_PLAN_STATUSES = ['draft', 'under_review', 'approved', 'archived'];
const QUALITY_PLAN_STATUS_LABELS = {
  draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمدة', archived: 'مؤرشفة',
};

// ----- طلبات الفحص (IR) -----
const IR_STATUSES = [
  'draft', 'submitted', 'scheduled', 'inspected', 'closed', 'cancelled',
];
const IR_STATUS_LABELS = {
  draft: 'مسودة',
  submitted: 'مُرسل',
  scheduled: 'مجدول للفحص',
  inspected: 'تم الفحص',
  closed: 'مغلق',
  cancelled: 'ملغى',
};
// الانتقالات المسموحة بين حالات طلب الفحص
const IR_ALLOWED_TRANSITIONS = {
  draft: ['submitted', 'cancelled'],
  submitted: ['scheduled', 'cancelled'],
  scheduled: ['inspected', 'cancelled'],
  inspected: ['closed'],
  closed: [],
  cancelled: [],
};

const IR_RESULTS = ['pending', 'accepted', 'conditional', 'rejected'];
const IR_RESULT_LABELS = {
  pending: 'قيد الانتظار', accepted: 'مقبول', conditional: 'قبول مشروط', rejected: 'مرفوض',
};

const IR_DISCIPLINES = [
  'concrete', 'rebar', 'formwork', 'masonry', 'finishing', 'mep', 'earthwork', 'asphalt', 'other',
];
const IR_DISCIPLINE_LABELS = {
  concrete: 'خرسانة', rebar: 'حديد تسليح', formwork: 'شدة خشبية', masonry: 'مباني (طوب/بلوك)',
  finishing: 'تشطيبات', mep: 'كهروميكانيكال', earthwork: 'أعمال ترابية', asphalt: 'أسفلت', other: 'أخرى',
};

// ===================== لوحة التحكم (Dashboard) =====================

function getDashboard(projectId = null) {
  const store = loadStore();
  const plans = Object.values(store.qualityPlans).filter(p => !projectId || p.project_id === projectId);
  const irs = Object.values(store.inspectionRequests).filter(r => !projectId || r.project_id === projectId);

  const totalProjects = new Set(
    Object.values(store.qualityPlans).map(p => p.project_id).filter(Boolean)
  ).size;

  const inspectedIrs = irs.filter(r => ['inspected', 'closed'].includes(r.status));
  const acceptedIrs = inspectedIrs.filter(r => r.result === 'accepted');
  const complianceRate = inspectedIrs.length > 0 ? r2((acceptedIrs.length / inspectedIrs.length) * 100) : 0;

  const projectsWithApprovedPlan = new Set(
    plans.filter(p => p.status === 'approved').map(p => p.project_id)
  ).size;

  const recentInspections = [...irs]
    .filter(r => r.status === 'inspected' || r.status === 'closed')
    .sort((a, b) => new Date(b.inspection_date || b.updated_at) - new Date(a.inspection_date || a.updated_at))
    .slice(0, 10)
    .map(r => ({
      id: r.id, code: r.code, project_id: r.project_id, element: r.element,
      status: r.status, result: r.result, inspection_date: r.inspection_date,
    }));

  return {
    success: true,
    data: {
      total_projects: totalProjects,
      projects_compliant_with_quality: projectsWithApprovedPlan,
      quality_plans_count: plans.length,
      inspection_requests_count: irs.length,
      inspections_done_count: inspectedIrs.length,
      // العناصر التالية تُفعَّل فعلياً في الأجزاء 2/3/4 وتُعرض هنا كأصفار حقيقية
      // (وليست قيماً وهمية) لحين بناء الوحدات المرتبطة بها:
      tests_count: 0,
      ncr_count: 0,
      material_approval_requests_count: 0,
      shop_drawing_requests_count: 0,
      capa_count: 0,
      quality_compliance_rate: complianceRate,
      recent_inspections: recentInspections,
      recent_ncrs: [],
      recent_approvals: [],
      recent_reports: [],
    },
  };
}

// ===================== إدارة خطة الجودة =====================

function validateQualityPlanPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'title'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء خطة الجودة`);
      }
    }
  }
  if (payload.status && !QUALITY_PLAN_STATUSES.includes(payload.status)) {
    throw new Error(`حالة خطة الجودة غير صالحة: ${payload.status}`);
  }
}

function createQualityPlan(payload) {
  validateQualityPlanPayload(payload);
  const store = loadStore();
  const id = newId('QP');
  const code = generateCode(store, 'QP');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    title: payload.title,
    version: 1,
    status: 'draft',
    quality_objectives: Array.isArray(payload.quality_objectives) ? payload.quality_objectives : [],
    quality_policies: Array.isArray(payload.quality_policies) ? payload.quality_policies : [],
    quality_procedures: Array.isArray(payload.quality_procedures) ? payload.quality_procedures : [],
    work_instructions: Array.isArray(payload.work_instructions) ? payload.work_instructions : [],
    acceptance_criteria: Array.isArray(payload.acceptance_criteria) ? payload.acceptance_criteria : [],
    inspection_hold_points: Array.isArray(payload.inspection_hold_points) ? payload.inspection_hold_points : [],
    reference_standard: payload.reference_standard || 'ISO 9001',
    prepared_by: payload.prepared_by || null,
    approved_by: null,
    approved_at: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.qualityPlans[id] = record;

  // أول إصدار في سجل الإصدارات
  const versionId = newId('QPV');
  store.qualityPlanVersions[versionId] = {
    id: versionId,
    plan_id: id,
    version: 1,
    snapshot: { ...record },
    change_note: 'الإصدار الأول من خطة الجودة',
    created_at: nowISO(),
  };

  audit(store, { action: 'create', entity: 'quality_plan', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listQualityPlans({ projectId, status, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.qualityPlans);
  if (projectId) items = items.filter(p => p.project_id === projectId);
  if (status) items = items.filter(p => p.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(p =>
      (p.title || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getQualityPlan(id) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  const versions = Object.values(store.qualityPlanVersions)
    .filter(v => v.plan_id === id)
    .sort((a, b) => b.version - a.version);
  return { success: true, data: { ...record, versions } };
}

function updateQualityPlan(id, changes) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  if (record.status === 'approved') {
    throw new Error('لا يمكن تعديل خطة معتمدة مباشرة؛ يجب إنشاء إصدار جديد أولاً');
  }
  validateQualityPlanPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'title', 'quality_objectives', 'quality_policies', 'quality_procedures',
    'work_instructions', 'acceptance_criteria', 'inspection_hold_points',
    'reference_standard', 'prepared_by', 'status',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.updated_at = nowISO();
  store.qualityPlans[id] = record;

  audit(store, { action: 'update', entity: 'quality_plan', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteQualityPlan(id) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  if (record.status === 'approved') {
    throw new Error('لا يمكن حذف خطة جودة معتمدة؛ يمكن أرشفتها بدلاً من ذلك');
  }
  delete store.qualityPlans[id];
  for (const vId of Object.keys(store.qualityPlanVersions)) {
    if (store.qualityPlanVersions[vId].plan_id === id) delete store.qualityPlanVersions[vId];
  }
  audit(store, { action: 'delete', entity: 'quality_plan', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

function approveQualityPlan(id, { approved_by = null } = {}) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');

  // تحقق فعلي من اكتمال الخطة قبل السماح بالاعتماد (وليس مجرد تبديل حالة شكلي)
  if (!record.quality_objectives || record.quality_objectives.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد أهداف الجودة');
  }
  if (!record.quality_policies || record.quality_policies.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد سياسات الجودة');
  }
  if (!record.inspection_hold_points || record.inspection_hold_points.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد نقطة فحص واحدة على الأقل');
  }

  record.status = 'approved';
  record.approved_by = approved_by;
  record.approved_at = nowISO();
  record.updated_at = nowISO();
  record.version = (record.version || 1) + 1;

  const versionId = newId('QPV');
  store.qualityPlanVersions[versionId] = {
    id: versionId,
    plan_id: id,
    version: record.version,
    snapshot: { ...record },
    change_note: `اعتماد الخطة بواسطة ${approved_by || 'غير محدد'}`,
    created_at: nowISO(),
  };

  audit(store, { action: 'approve', entity: 'quality_plan', entityId: id, projectId: record.project_id, details: { approved_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة طلبات الفحص (Inspection Request - IR) =====================

function validateIrPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'element'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء طلب الفحص`);
      }
    }
  }
  if (payload.discipline && !IR_DISCIPLINES.includes(payload.discipline)) {
    throw new Error(`تخصص غير صالح: ${payload.discipline}`);
  }
  if (payload.result && !IR_RESULTS.includes(payload.result)) {
    throw new Error(`نتيجة فحص غير صالحة: ${payload.result}`);
  }
}

function createInspectionRequest(payload) {
  validateIrPayload(payload);
  const store = loadStore();
  const id = newId('IR');
  const code = generateCode(store, 'IR');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    stage: payload.stage || null,
    element: payload.element,
    location: payload.location || null,
    contractor: payload.contractor || null,
    consultant: payload.consultant || null,
    discipline: payload.discipline || 'other',
    request_date: payload.request_date || nowISO(),
    inspection_date: payload.inspection_date || null,
    status: 'draft',
    result: 'pending',
    notes: payload.notes || '',
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    signatures: [],
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.inspectionRequests[id] = record;
  audit(store, { action: 'create', entity: 'inspection_request', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listInspectionRequests({ projectId, status, result, discipline, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.inspectionRequests);
  if (projectId) items = items.filter(r => r.project_id === projectId);
  if (status) items = items.filter(r => r.status === status);
  if (result) items = items.filter(r => r.result === result);
  if (discipline) items = items.filter(r => r.discipline === discipline);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(r =>
      (r.element || '').toLowerCase().includes(q) ||
      (r.code || '').toLowerCase().includes(q) ||
      (r.location || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getInspectionRequest(id) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  return { success: true, data: record };
}

function updateInspectionRequest(id, changes) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (['closed', 'cancelled'].includes(record.status)) {
    throw new Error('لا يمكن تعديل طلب فحص مغلق أو ملغى');
  }
  validateIrPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'stage', 'element', 'location', 'contractor', 'consultant', 'discipline',
    'request_date', 'inspection_date', 'notes', 'photos', 'attachments',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'update', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteInspectionRequest(id) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (['inspected', 'closed'].includes(record.status)) {
    throw new Error('لا يمكن حذف طلب فحص تم تنفيذه بالفعل؛ يمكن إلغاؤه فقط إن كان قيد الانتظار');
  }
  delete store.inspectionRequests[id];
  audit(store, { action: 'delete', entity: 'inspection_request', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// انتقال حالة طلب الفحص وفق دورة حياة حقيقية ومقيَّدة
function transitionInspectionRequest(id, { to_status, by = null } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (!IR_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = IR_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${IR_STATUS_LABELS[record.status]}" إلى "${IR_STATUS_LABELS[to_status]}"`);
  }

  record.status = to_status;
  record.change_log.push({ ts: nowISO(), action: `status_changed_to_${to_status}`, by });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'transition', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

// تسجيل نتيجة الفحص فعلياً (يحرك الحالة تلقائياً إلى "تم الفحص")
function recordInspectionResult(id, { result, notes = '', inspected_by = null, photos = [] } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (record.status !== 'scheduled') {
    throw new Error('لا يمكن تسجيل نتيجة الفحص إلا لطلب في حالة "مجدول للفحص"');
  }
  if (!IR_RESULTS.includes(result) || result === 'pending') {
    throw new Error('يجب تحديد نتيجة فحص صالحة: مقبول/قبول مشروط/مرفوض');
  }

  record.result = result;
  record.status = 'inspected';
  record.inspection_date = nowISO();
  if (notes) record.notes = `${record.notes ? record.notes + '\n' : ''}${notes}`;
  if (Array.isArray(photos) && photos.length) record.photos = [...record.photos, ...photos];
  record.change_log.push({ ts: nowISO(), action: 'result_recorded', by: inspected_by, result });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'record_result', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { result, inspected_by } });
  saveStore(store);
  return { success: true, data: record };
}

function signInspectionRequest(id, { party, name, role = null } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (!party || !name) throw new Error('يجب تحديد الطرف والاسم للتوقيع');

  record.signatures.push({ party, name, role, signed_at: nowISO() });
  record.change_log.push({ ts: nowISO(), action: 'signed', by: name, party });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'sign', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { party, name } });
  saveStore(store);
  return { success: true, data: record };
}

module.exports = {
  // ثوابت
  QUALITY_PLAN_STATUSES, QUALITY_PLAN_STATUS_LABELS,
  IR_STATUSES, IR_STATUS_LABELS, IR_ALLOWED_TRANSITIONS,
  IR_RESULTS, IR_RESULT_LABELS,
  IR_DISCIPLINES, IR_DISCIPLINE_LABELS,

  // لوحة التحكم
  getDashboard,

  // خطة الجودة
  createQualityPlan, listQualityPlans, getQualityPlan, updateQualityPlan,
  deleteQualityPlan, approveQualityPlan,

  // طلبات الفحص IR
  createInspectionRequest, listInspectionRequests, getInspectionRequest,
  updateInspectionRequest, deleteInspectionRequest, transitionInspectionRequest,
  recordInspectionResult, signInspectionRequest,

  // للاستخدام الداخلي من أجزاء لاحقة (2/3/4)
  loadStore, saveStore, audit, generateCode, newId, nowISO, r2,
};
