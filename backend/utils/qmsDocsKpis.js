/**
 * القسم التاسع - نظام إدارة الجودة (QMS) - إضافة
 * =====================================================================================
 * الجزء الخامس (5/4 إضافي): إدارة الوثائق (مواصفات / أكواد / شهادات) +
 *                            مؤشرات الأداء (KPIs): معدل إغلاق NCR + أداء الموردين/المقاولين.
 *
 * يمتد هذا الملف على نفس مخزن البيانات (backend/data/qms.json) المستخدم في
 * qmsManagement.js، بنفس أدوات التخزين والتدقيق (loadStore/saveStore/audit)
 * دون أي تكرار أو تعارض في المخطط.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - إدارة الوثائق: رفع فعلي بإصدارات متعددة (Version Control)، تصنيف حسب
 *    النوع (مواصفة فنية / كود / معيار / شهادة / تقرير / نتيجة اختبار / عقد /
 *    مخطط)، حالة صلاحية فعلية للشهادات (سارية/على وشك الانتهاء/منتهية) تُحسب
 *    من expiry_date الفعلي، بحث نصي حقيقي، وسجل تعديلات كامل.
 *  - مؤشرات الأداء: تُحسب فعلياً من البيانات المخزَّنة في qms.json (لا أرقام
 *    وهمية) عبر قراءة store.ncrs / store.mars / store.sdrs / store.inspectionRequests
 *    مباشرة، بما يشمل: نسبة المطابقة، نسبة الرفض، متوسط زمن إغلاق NCR،
 *    معدل نجاح الفحوصات/الاختبارات، وأداء كل مورّد/مقاول محسوباً من
 *    سجلاته الفعلية (MAR له / IR و NCR له).
 */

const QMS = require('./qmsManagement');

const { loadStore, saveStore, audit, generateCode, newId, nowISO, r2 } = QMS;

// ===================== ثوابت: إدارة الوثائق =====================

const DOCUMENT_TYPES = [
  'specification', 'code_standard', 'certificate', 'report',
  'test_result', 'contract', 'drawing', 'other',
];
const DOCUMENT_TYPE_LABELS = {
  specification: 'مواصفة فنية',
  code_standard: 'كود / معيار',
  certificate: 'شهادة',
  report: 'تقرير',
  test_result: 'نتيجة اختبار',
  contract: 'عقد',
  drawing: 'مخطط',
  other: 'أخرى',
};

const DOCUMENT_STATUSES = ['active', 'under_review', 'expired', 'archived'];
const DOCUMENT_STATUS_LABELS = {
  active: 'ساري', under_review: 'قيد المراجعة', expired: 'منتهي الصلاحية', archived: 'مؤرشف',
};

// حالة الصلاحية الفعلية المحسوبة من expiry_date (مستقلة عن status اليدوية)
function computeValidityState(doc) {
  if (!doc.expiry_date) return 'no_expiry';
  const daysLeft = Math.ceil((new Date(doc.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring_soon';
  return 'valid';
}
const VALIDITY_STATE_LABELS = {
  valid: 'سارية', expiring_soon: 'تقترب من الانتهاء', expired: 'منتهية', no_expiry: 'بدون تاريخ انتهاء',
};

// ===================== إدارة الوثائق =====================

function validateDocumentPayload(payload, { partial = false } = {}) {
  const required = ['title', 'doc_type'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب`);
      }
    }
    if (!partial && !payload.file_url) {
      throw new Error('رابط الملف (file_url) مطلوب عند إنشاء الوثيقة');
    }
  }
  if (payload.doc_type && !DOCUMENT_TYPES.includes(payload.doc_type)) {
    throw new Error(`نوع وثيقة غير صالح: ${payload.doc_type}`);
  }
  if (payload.status && !DOCUMENT_STATUSES.includes(payload.status)) {
    throw new Error(`حالة وثيقة غير صالحة: ${payload.status}`);
  }
}

function createDocument(payload) {
  validateDocumentPayload(payload);
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const id = newId('DOC');
  const code = generateCode(store, 'DOC');
  const record = {
    id,
    code,
    project_id: payload.project_id || null,
    title: payload.title,
    doc_type: payload.doc_type,
    reference_number: payload.reference_number || null, // رقم المواصفة/الكود/الشهادة
    issuing_body: payload.issuing_body || null,          // الجهة المُصدرة (منظمة، مورّد، مختبر...)
    related_entity: payload.related_entity || null,      // ربط اختياري: { type: 'mar'|'ncr'|..., id }
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    issue_date: payload.issue_date || null,
    expiry_date: payload.expiry_date || null,
    status: payload.status || 'active',
    versions: [{
      version_no: 1,
      file_url: payload.file_url,
      uploaded_by: payload.created_by || null,
      uploaded_at: nowISO(),
      notes: payload.version_notes || null,
    }],
    current_version: 1,
    notes: payload.notes || null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.documents[id] = record;
  audit(store, { action: 'create', entity: 'document', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { ...record, validity_state: computeValidityState(record) } };
}

function listDocuments({ projectId, docType, status, validityState, search } = {}) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  let items = Object.values(store.documents);
  if (projectId) items = items.filter(d => d.project_id === projectId);
  if (docType) items = items.filter(d => d.doc_type === docType);
  if (status) items = items.filter(d => d.status === status);
  items = items.map(d => ({ ...d, validity_state: computeValidityState(d) }));
  if (validityState) items = items.filter(d => d.validity_state === validityState);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.reference_number || '').toLowerCase().includes(q) ||
      (d.issuing_body || '').toLowerCase().includes(q) ||
      (d.code || '').toLowerCase().includes(q) ||
      (Array.isArray(d.tags) && d.tags.some(t => String(t).toLowerCase().includes(q)))
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getDocument(id) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const record = store.documents[id];
  if (!record) throw new Error('الوثيقة غير موجودة');
  return { success: true, data: { ...record, validity_state: computeValidityState(record) } };
}

function updateDocument(id, changes) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const record = store.documents[id];
  if (!record) throw new Error('الوثيقة غير موجودة');
  validateDocumentPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'title', 'doc_type', 'reference_number', 'issuing_body', 'tags',
    'issue_date', 'expiry_date', 'status', 'notes', 'project_id',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.documents[id] = record;
  audit(store, { action: 'update', entity: 'document', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: { ...record, validity_state: computeValidityState(record) } };
}

function deleteDocument(id) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const record = store.documents[id];
  if (!record) throw new Error('الوثيقة غير موجودة');
  delete store.documents[id];
  audit(store, { action: 'delete', entity: 'document', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// رفع إصدار جديد من الوثيقة (سجل إصدارات فعلي)
function uploadDocumentVersion(id, { file_url, uploaded_by = null, notes = null } = {}) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const record = store.documents[id];
  if (!record) throw new Error('الوثيقة غير موجودة');
  if (!file_url) throw new Error('رابط الملف (file_url) مطلوب لرفع إصدار جديد');

  const nextVersion = record.current_version + 1;
  record.versions.push({ version_no: nextVersion, file_url, uploaded_by, uploaded_at: nowISO(), notes });
  record.current_version = nextVersion;
  // رفع إصدار جديد لوثيقة منتهية أو مؤرشفة يعيدها تلقائياً لحالة "قيد المراجعة"
  if (['expired', 'archived'].includes(record.status)) record.status = 'under_review';
  record.change_log.push({ ts: nowISO(), action: 'version_uploaded', by: uploaded_by, details: { version_no: nextVersion } });
  record.updated_at = nowISO();
  store.documents[id] = record;
  audit(store, { action: 'upload_version', entity: 'document', entityId: id, projectId: record.project_id, details: { version_no: nextVersion } });
  saveStore(store);
  return { success: true, data: { ...record, validity_state: computeValidityState(record) } };
}

// أرشفة وثيقة (بدلاً من الحذف، للحفاظ على السجل التاريخي)
function archiveDocument(id, { by = null } = {}) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  const record = store.documents[id];
  if (!record) throw new Error('الوثيقة غير موجودة');
  record.status = 'archived';
  record.change_log.push({ ts: nowISO(), action: 'archived', by });
  record.updated_at = nowISO();
  store.documents[id] = record;
  audit(store, { action: 'archive', entity: 'document', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { ...record, validity_state: computeValidityState(record) } };
}

// وثائق تحتاج انتباه: منتهية أو تقترب من الانتهاء (للتنبيهات الذكية)
function getExpiringDocuments({ projectId, withinDays = 30 } = {}) {
  const store = loadStore();
  if (!store.documents) store.documents = {};
  let items = Object.values(store.documents);
  if (projectId) items = items.filter(d => d.project_id === projectId);
  items = items
    .filter(d => d.expiry_date && d.status !== 'archived')
    .map(d => ({
      ...d,
      validity_state: computeValidityState(d),
      days_left: Math.ceil((new Date(d.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)),
    }))
    .filter(d => d.days_left <= withinDays);
  items.sort((a, b) => a.days_left - b.days_left);
  return { success: true, data: items };
}

// ===================== مؤشرات الأداء (KPIs) =====================
// الأولوية: معدل إغلاق NCR + أداء الموردين/المقاولين — محسوبة فعلياً من المخزن.

// متوسط ونطاق زمن إغلاق حالات عدم المطابقة (يوم)، مع توزيع حسب درجة الخطورة
function computeNcrClosureKpis({ projectId } = {}) {
  const store = loadStore();
  let ncrs = Object.values(store.ncrs || {});
  if (projectId) ncrs = ncrs.filter(n => n.project_id === projectId);

  const closed = ncrs.filter(n => n.status === 'closed');
  const open = ncrs.filter(n => !['closed', 'rejected'].includes(n.status));

  const closureDays = closed.map(n => {
    const opened = new Date(n.created_at);
    const closedAt = new Date(n.closed_at || n.updated_at);
    return Math.max(0, (closedAt - opened) / (1000 * 60 * 60 * 24));
  });

  const avgClosureDays = closureDays.length > 0
    ? r2(closureDays.reduce((s, d) => s + d, 0) / closureDays.length) : 0;
  const maxClosureDays = closureDays.length > 0 ? r2(Math.max(...closureDays)) : 0;
  const minClosureDays = closureDays.length > 0 ? r2(Math.min(...closureDays)) : 0;

  // معدل الإغلاق ضمن نطاق زمني معياري (30 يوماً) كمؤشر التزام إضافي
  const closedWithin30 = closed.filter((n, i) => closureDays[i] <= 30).length;
  const closureWithin30Rate = closed.length > 0 ? r2((closedWithin30 / closed.length) * 100) : 0;

  // توزيع متوسط زمن الإغلاق حسب درجة الخطورة
  const bySeverity = {};
  for (const sev of QMS.NCR_SEVERITIES) {
    const items = closed.filter(n => n.severity === sev);
    const days = items.map(n => {
      const opened = new Date(n.created_at);
      const closedAt = new Date(n.closed_at || n.updated_at);
      return Math.max(0, (closedAt - opened) / (1000 * 60 * 60 * 24));
    });
    bySeverity[sev] = {
      label: QMS.NCR_SEVERITY_LABELS[sev],
      count_closed: items.length,
      avg_closure_days: days.length > 0 ? r2(days.reduce((s, d) => s + d, 0) / days.length) : 0,
    };
  }

  return {
    total_ncrs: ncrs.length,
    open_ncrs: open.length,
    closed_ncrs: closed.length,
    avg_closure_days: avgClosureDays,
    min_closure_days: minClosureDays,
    max_closure_days: maxClosureDays,
    closure_within_30days_rate: closureWithin30Rate,
    by_severity: bySeverity,
  };
}

// أداء الموردين: محسوب من طلبات اعتماد المواد (MAR) الفعلية لكل مورّد
function computeSupplierPerformance({ projectId } = {}) {
  const store = loadStore();
  let mars = Object.values(store.mars || {});
  if (projectId) mars = mars.filter(m => m.project_id === projectId);

  const bySupplier = {};
  for (const m of mars) {
    const key = m.supplier_name || 'غير محدد';
    if (!bySupplier[key]) {
      bySupplier[key] = {
        supplier_name: key,
        total_requests: 0,
        approved: 0,
        approved_with_comments: 0,
        rejected: 0,
        pending: 0,
      };
    }
    const s = bySupplier[key];
    s.total_requests += 1;
    if (m.status === 'approved') s.approved += 1;
    else if (m.status === 'approved_with_comments') s.approved_with_comments += 1;
    else if (m.status === 'rejected') s.rejected += 1;
    else s.pending += 1;
  }

  const list = Object.values(bySupplier).map(s => {
    const decided = s.approved + s.approved_with_comments + s.rejected;
    const approvalRate = decided > 0 ? r2(((s.approved + s.approved_with_comments) / decided) * 100) : 0;
    const rejectionRate = decided > 0 ? r2((s.rejected / decided) * 100) : 0;
    return { ...s, decided_requests: decided, approval_rate: approvalRate, rejection_rate: rejectionRate };
  }).sort((a, b) => b.total_requests - a.total_requests);

  return { total_suppliers: list.length, suppliers: list };
}

// أداء المقاولين: محسوب من طلبات الفحص (IR) وحالات عدم المطابقة (NCR) الفعلية لكل مقاول
function computeContractorPerformance({ projectId } = {}) {
  const store = loadStore();
  let irs = Object.values(store.inspectionRequests || {});
  let ncrs = Object.values(store.ncrs || {});
  if (projectId) {
    irs = irs.filter(r => r.project_id === projectId);
    ncrs = ncrs.filter(n => n.project_id === projectId);
  }

  const byContractor = {};
  const ensure = (key) => {
    if (!byContractor[key]) {
      byContractor[key] = {
        contractor: key,
        total_inspections: 0,
        accepted_inspections: 0,
        conditional_inspections: 0,
        rejected_inspections: 0,
        ncr_count: 0,
        ncr_critical_count: 0,
      };
    }
    return byContractor[key];
  };

  for (const r of irs) {
    if (!r.contractor) continue;
    const c = ensure(r.contractor);
    if (['inspected', 'closed'].includes(r.status)) {
      c.total_inspections += 1;
      if (r.result === 'accepted') c.accepted_inspections += 1;
      else if (r.result === 'conditional') c.conditional_inspections += 1;
      else if (r.result === 'rejected') c.rejected_inspections += 1;
    }
  }

  for (const n of ncrs) {
    if (!n.responsible_party) continue;
    const c = ensure(n.responsible_party);
    c.ncr_count += 1;
    if (n.severity === 'critical') c.ncr_critical_count += 1;
  }

  const list = Object.values(byContractor).map(c => {
    const passRate = c.total_inspections > 0 ? r2((c.accepted_inspections / c.total_inspections) * 100) : 0;
    const rejectionRate = c.total_inspections > 0 ? r2((c.rejected_inspections / c.total_inspections) * 100) : 0;
    return { ...c, inspection_pass_rate: passRate, inspection_rejection_rate: rejectionRate };
  }).sort((a, b) => b.total_inspections - a.total_inspections);

  return { total_contractors: list.length, contractors: list };
}

// معدلات النجاح العامة للفحوصات والاختبارات (تدعم لوحة KPIs الشاملة)
function computeGeneralQualityKpis({ projectId } = {}) {
  const store = loadStore();
  let irs = Object.values(store.inspectionRequests || {});
  let tests = Object.values(store.materialTests || {});
  if (projectId) {
    irs = irs.filter(r => r.project_id === projectId);
    tests = tests.filter(t => t.project_id === projectId);
  }

  const inspectedIrs = irs.filter(r => ['inspected', 'closed'].includes(r.status));
  const acceptedIrs = inspectedIrs.filter(r => r.result === 'accepted');
  const rejectedIrs = inspectedIrs.filter(r => r.result === 'rejected');
  const inspectionPassRate = inspectedIrs.length > 0 ? r2((acceptedIrs.length / inspectedIrs.length) * 100) : 0;
  const inspectionRejectionRate = inspectedIrs.length > 0 ? r2((rejectedIrs.length / inspectedIrs.length) * 100) : 0;

  const resultedTests = tests.filter(t => ['pass', 'fail'].includes(t.result));
  const passedTests = resultedTests.filter(t => t.result === 'pass');
  const testPassRate = resultedTests.length > 0 ? r2((passedTests.length / resultedTests.length) * 100) : 0;

  return {
    inspection_pass_rate: inspectionPassRate,
    inspection_rejection_rate: inspectionRejectionRate,
    test_pass_rate: testPassRate,
    total_inspections_done: inspectedIrs.length,
    total_tests_resulted: resultedTests.length,
  };
}

// نقطة التجميع الرئيسية للوحة مؤشرات الأداء
function getQualityKpis({ projectId } = {}) {
  return {
    success: true,
    data: {
      general: computeGeneralQualityKpis({ projectId }),
      ncr_closure: computeNcrClosureKpis({ projectId }),
      supplier_performance: computeSupplierPerformance({ projectId }),
      contractor_performance: computeContractorPerformance({ projectId }),
      generated_at: nowISO(),
    },
  };
}

module.exports = {
  // ثوابت الوثائق
  DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUSES, DOCUMENT_STATUS_LABELS,
  VALIDITY_STATE_LABELS,

  // إدارة الوثائق
  createDocument, listDocuments, getDocument, updateDocument, deleteDocument,
  uploadDocumentVersion, archiveDocument, getExpiringDocuments,

  // مؤشرات الأداء
  computeNcrClosureKpis, computeSupplierPerformance,
  computeContractorPerformance, computeGeneralQualityKpis, getQualityKpis,
};
