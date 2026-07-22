/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الثالث (3/10): دورة اعتماد المستندات (Workflow) القابلة للتخصيص لكل نوع مستند
 * =====================================================================================
 *
 * يبني هذا الجزء فوق طبقة التخزين الموحّدة المُنشأة في الجزء 1/10 (نفس ملف dms.json عبر
 * loadStore/saveStore/audit المُصدَّرة من documentManagement.js)، ويضيف:
 *
 *  - تعريف مراحل سير عمل مرنة قابلة للتخصيص لكل نوع مستند (store.workflows)، تطابق
 *    المراحل المطلوبة في المواصفة: إنشاء المستند → مراجعة أولية → مراجعة فنية → اعتماد/
 *    رفض → إعادة للمراجعة → نشر → أرشفة، مع إمكانية تعريف سير عمل مختلف (مراحل أقل/أكثر،
 *    مراجعين مختلفين) لكل نوع من أنواع المستندات (عقد، مخطط، تقرير...).
 *  - سير عمل افتراضي (DEFAULT_WORKFLOW_STAGES) يُستخدم تلقائياً لأي نوع مستند لم يُخصَّص
 *    له سير عمل صريح، حتى لا يبقى أي مستند بلا دورة اعتماد.
 *  - محرّك انتقال حالات (State Machine) فعلي يتحقق من صحة كل انتقال (لا يمكن القفز من
 *    "مسودة" إلى "منشور" مباشرة دون المرور بمراحل المراجعة المُعرَّفة)، ويمنع تنفيذ أي
 *    انتقال غير مسموح به من المرحلة الحالية.
 *  - سجل مراحل اعتماد فعلي لكل مستند (store.approvals[documentId] = [مرحلة، ...]) يحفظ:
 *    من قام بالإجراء، دوره، القرار، الملاحظات، والتاريخ الفعلي - وليس مجرد حالة نصية
 *    واحدة على المستند.
 *  - عند الرفض: يُعاد المستند فعلياً لحالة "قيد المراجعة" (أو للمرحلة المحدَّدة في تعريف
 *    سير العمل) مع تسجيل سبب الرفض، بحيث يمكن تتبع أسباب الرفض والمراجعات المتكررة.
 *  - عند اكتمال كل مراحل الاعتماد المطلوبة: يتحول المستند تلقائياً لحالة "معتمد"، ويمكن
 *    عندها نشره فعلياً (published) ثم أرشفته.
 *  - يتكامل مباشرة مع doc.status وdoc.workflow_id المعرَّفين مسبقاً في documentManagement.js
 *    (الجزء 1/10)، ويحدّثهما فعلياً بدلاً من إدارة حالة موازية منفصلة.
 */

const DMS = require('./documentManagement');

// ==================================================================================
// ============================ تعريف سير العمل الافتراضي ===========================
// ==================================================================================

/**
 * المراحل الافتراضية لأي نوع مستند لم يُخصَّص له سير عمل صريح. كل مرحلة تحمل:
 *  - key: مفتاح المرحلة (يُستخدم كحالة doc.status بعد اجتيازها بنجاح فور اكتمالها،
 *         باستثناء المراحل الوسيطة التي تُبقي المستند في حالة "قيد المراجعة").
 *  - label: الاسم المعروض بالعربية.
 *  - resulting_status: الحالة (من DOCUMENT_STATUSES) التي يأخذها المستند بعد اجتياز
 *    هذه المرحلة بنجاح.
 *  - on_reject_status: الحالة التي يعود إليها المستند عند الرفض في هذه المرحلة.
 *  - on_reject_goto_stage: مفتاح المرحلة التي يُعاد توجيه المستند إليها عند الرفض
 *    (لإعادة المراجعة من نقطة محددة بدل البدء من الصفر).
 *  - required_role: الدور الوظيفي المطلوب لاعتماد/رفض هذه المرحلة تحديداً (اختياري -
 *    إن تُرك فارغاً فلا يوجد تقييد دور صارم على هذه المرحلة بعينها).
 */
const DEFAULT_WORKFLOW_STAGES = [
  {
    key: 'initial_review', label: 'مراجعة أولية',
    resulting_status: 'under_review', on_reject_status: 'draft', on_reject_goto_stage: null,
    required_role: null,
  },
  {
    key: 'technical_review', label: 'مراجعة فنية',
    resulting_status: 'under_review', on_reject_status: 'under_review', on_reject_goto_stage: 'initial_review',
    required_role: null,
  },
  {
    key: 'approval', label: 'اعتماد',
    resulting_status: 'approved', on_reject_status: 'rejected', on_reject_goto_stage: 'technical_review',
    required_role: null,
  },
  {
    key: 'publish', label: 'نشر',
    resulting_status: 'published', on_reject_status: 'approved', on_reject_goto_stage: null,
    required_role: null,
  },
];

// أسماء المراحل بصيغة معروضة (تُستخدم في الواجهة وفي دالة getReferenceData الموسَّعة)
const STAGE_LABELS_INDEX = DEFAULT_WORKFLOW_STAGES.reduce((acc, s) => {
  acc[s.key] = s.label; return acc;
}, {});

/** يبني سير عمل افتراضي جاهز للاستخدام مباشرة (نسخة عميقة حتى لا يتشارك المراجع). */
function buildDefaultWorkflowStages() {
  return DEFAULT_WORKFLOW_STAGES.map(s => ({ ...s }));
}

// ==================================================================================
// ==================================== أدوات داخلية =================================
// ==================================================================================

function findStageIndex(stages, key) {
  return stages.findIndex(s => s.key === key);
}

function getDocOrThrow(store, documentId) {
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  return doc;
}

function ensureApprovalsList(store, documentId) {
  if (!store.approvals[documentId]) store.approvals[documentId] = [];
  return store.approvals[documentId];
}

// ==================================================================================
// ===================== تعريف/تخصيص سير العمل لكل نوع مستند ========================
// ==================================================================================

/**
 * إنشاء أو تحديث تعريف سير عمل مخصص لنوع مستند معيّن (workflow definition).
 * كل تعريف يُخزَّن في store.workflows بمفتاح doc_type، ويحتوي على مصفوفة stages
 * بنفس بنية DEFAULT_WORKFLOW_STAGES، مما يسمح بتخصيص عدد المراحل وتسلسلها لكل نوع
 * (مثال: العقود قد تحتاج مرحلة "مراجعة قانونية" إضافية، بينما المراسلات قد تُعتمَد
 * مباشرة بمرحلة واحدة فقط).
 */
function defineWorkflow({ docType, name = null, stages, isActive = true } = {}) {
  if (!docType || !DMS.DOCUMENT_TYPES[docType]) {
    throw new Error(`نوع المستند (docType) غير صحيح. الأنواع المدعومة: ${Object.keys(DMS.DOCUMENT_TYPES).join(', ')}`);
  }
  if (!Array.isArray(stages) || !stages.length) {
    throw new Error('يجب تحديد مصفوفة مراحل (stages) لا تقل عن مرحلة واحدة');
  }

  const seenKeys = new Set();
  for (const stage of stages) {
    if (!stage.key || typeof stage.key !== 'string') throw new Error('كل مرحلة يجب أن تحمل مفتاحاً (key) نصياً');
    if (seenKeys.has(stage.key)) throw new Error(`مفتاح المرحلة "${stage.key}" مكرر ضمن نفس سير العمل`);
    seenKeys.add(stage.key);
    if (!stage.label) throw new Error(`المرحلة "${stage.key}" تحتاج اسماً معروضاً (label)`);
    if (!DMS.DOCUMENT_STATUSES.includes(stage.resulting_status)) {
      throw new Error(`الحالة الناتجة (resulting_status) للمرحلة "${stage.key}" غير صحيحة`);
    }
    if (!DMS.DOCUMENT_STATUSES.includes(stage.on_reject_status)) {
      throw new Error(`حالة الرفض (on_reject_status) للمرحلة "${stage.key}" غير صحيحة`);
    }
    if (stage.on_reject_goto_stage && !stages.some(s => s.key === stage.on_reject_goto_stage)) {
      throw new Error(`مرحلة إعادة التوجيه عند الرفض "${stage.on_reject_goto_stage}" غير موجودة ضمن نفس سير العمل`);
    }
  }

  const store = DMS.loadStore ? DMS.loadStore() : null;
  // documentManagement.js لا يُصدِّر loadStore/saveStore/audit مباشرة (خاصة بالوحدة)،
  // لذا نستخدم البوابة الموحّدة المُصدَّرة أدناه (getWorkflowStore) بدلاً من ذلك.
  return _defineWorkflowInternal({ docType, name, stages, isActive });
}

// ==================================================================================
// ================= بوابة وصول موحّدة لملف تخزين DMS (نفس dms.json) =================
// ==================================================================================
// documentManagement.js (الجزء 1/10) لا يُصدِّر loadStore/saveStore/audit كدوال عامة،
// لذا نُعيد فتح نفس ملف التخزين هنا بنفس المسار والبنية تماماً لضمان اتساق مصدر واحد
// للحقيقة (Single Source of Truth) دون أي تكرار أو انقسام في البيانات.

const fs = require('fs');
const path = require('path');
const ACL = require('./documentAccessControl');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function loadStore() {
  if (!fs.existsSync(DB_FILE)) throw new Error('قاعدة بيانات إدارة المستندات غير مهيّأة بعد (ارفع مستنداً واحداً على الأقل أولاً)');
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  for (const key of ['documents', 'versions', 'categories', 'workflows', 'approvals', 'signatures', 'shareLinks', 'notifications']) {
    if (!store[key]) store[key] = {};
  }
  if (!store.auditLog) store.auditLog = [];
  if (!store.meta) store.meta = { last_doc_seq: {} };
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function audit(store, { action, entity, entityId, projectId = null, actor = null, details = {} }) {
  store.auditLog.push({
    id: newId('AUD'),
    action, entity, entity_id: entityId, project_id: projectId,
    actor: actor || null, details, created_at: nowISO(),
  });
  if (store.auditLog.length > 8000) store.auditLog = store.auditLog.slice(-8000);
}

function _defineWorkflowInternal({ docType, name, stages, isActive }) {
  const store = loadStore();
  const existing = Object.values(store.workflows).find(w => w.doc_type === docType && w.is_active);

  // عند إنشاء تعريف جديد نشِط لنفس النوع، نُعطّل التعريف النشط السابق (بدل حذفه) حتى
  // يبقى تاريخ سير العمل القديم متاحاً للاطلاع دون كسر المستندات التي اعتمدت عليه.
  if (existing && isActive) existing.is_active = false;

  const workflowId = newId('WFL');
  const record = {
    id: workflowId,
    doc_type: docType,
    doc_type_label: DMS.DOCUMENT_TYPES[docType].label,
    name: name || `سير عمل ${DMS.DOCUMENT_TYPES[docType].label}`,
    stages: stages.map(s => ({
      key: s.key,
      label: s.label,
      resulting_status: s.resulting_status,
      on_reject_status: s.on_reject_status,
      on_reject_goto_stage: s.on_reject_goto_stage || null,
      required_role: s.required_role || null,
    })),
    is_active: !!isActive,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.workflows[workflowId] = record;

  audit(store, { action: 'define_workflow', entity: 'workflow', entityId: workflowId, actor: null, details: { doc_type: docType, stages_count: stages.length } });
  saveStore(store);
  return { success: true, data: record };
}

/** يعيد سير العمل النشط الخاص بنوع مستند معيّن، أو سير العمل الافتراضي إن لم يُخصَّص شيء */
function getActiveWorkflow(docType) {
  const store = loadStore();
  const custom = Object.values(store.workflows).find(w => w.doc_type === docType && w.is_active);
  if (custom) return custom;
  return {
    id: null,
    doc_type: docType,
    doc_type_label: DMS.DOCUMENT_TYPES[docType]?.label || docType,
    name: 'سير العمل الافتراضي',
    stages: buildDefaultWorkflowStages(),
    is_active: true,
    is_default: true,
  };
}

/** يعيد كل تعريفات سير العمل (نشِطة وغير نشطة) - لعرض تاريخ التخصيصات في الواجهة */
function listWorkflows({ docType = null } = {}) {
  const store = loadStore();
  let items = Object.values(store.workflows);
  if (docType) items = items.filter(w => w.doc_type === docType);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

// ==================================================================================
// ============================ محرّك انتقال الحالات (Engine) ========================
// ==================================================================================

/**
 * يبدأ (أو يعيد ربط) سير عمل الاعتماد لمستند معيّن. يُستدعى تلقائياً أول مرة يُطلب
 * فيها إجراء اعتماد على مستند لا يملك workflow_id بعد، ويمكن استدعاؤه يدوياً أيضاً.
 */
function startWorkflow(documentId, { actor = null } = {}) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);

  const workflow = getActiveWorkflow(doc.doc_type);
  doc.workflow_id = workflow.id; // قد تكون null إن كان سير العمل الافتراضي (غير مخصَّص)
  doc.updated_at = nowISO();
  if (doc.status === 'draft') doc.status = 'under_review';

  ensureApprovalsList(store, documentId);

  audit(store, {
    action: 'start_workflow', entity: 'document', entityId: documentId, projectId: doc.project_id, actor,
    details: { workflow_name: workflow.name, doc_type: doc.doc_type, is_default: !!workflow.is_default },
  });
  saveStore(store);
  return { success: true, data: doc };
}

/** يحدد المرحلة "الحالية" لمستند بناءً على آخر مرحلة مُكتملة بنجاح في سجل موافقاته */
function getCurrentStageInfo(documentId) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  const workflow = getActiveWorkflow(doc.doc_type);
  const history = (store.approvals[documentId] || []).slice().sort((a, b) => new Date(a.decided_at) - new Date(b.decided_at));

  const lastApproved = [...history].reverse().find(h => h.decision === 'approved');
  let nextIndex = 0;
  if (lastApproved) {
    const idx = findStageIndex(workflow.stages, lastApproved.stage_key);
    nextIndex = idx === -1 ? 0 : idx + 1;
  }
  const lastRejected = history.length ? history[history.length - 1] : null;
  if (lastRejected && lastRejected.decision === 'rejected') {
    const rejectedStage = workflow.stages.find(s => s.key === lastRejected.stage_key);
    const gotoKey = rejectedStage?.on_reject_goto_stage;
    nextIndex = gotoKey ? findStageIndex(workflow.stages, gotoKey) : findStageIndex(workflow.stages, lastRejected.stage_key);
    if (nextIndex === -1) nextIndex = 0;
  }

  const isComplete = nextIndex >= workflow.stages.length;
  return {
    workflow,
    history,
    current_stage: isComplete ? null : workflow.stages[nextIndex],
    is_complete: isComplete,
  };
}

/**
 * تنفيذ قرار اعتماد/رفض فعلي على المرحلة الحالية لمستند معيّن. هذا هو محرّك انتقال
 * الحالات (State Machine): يتحقق أن المرحلة المطلوب البتّ فيها هي فعلاً المرحلة
 * التالية المستحقة للمستند (لا يمكن اعتماد مرحلة لاحقة قبل سابقتها)، ثم يطبّق أثر
 * القرار على حالة المستند (doc.status) فعلياً حسب تعريف المرحلة.
 */
function decideStage(documentId, {
  stageKey, decision, actor = null, actorRole = null, comments = '',
} = {}) {
  if (!decision || !['approved', 'rejected'].includes(decision)) {
    throw new Error('القرار (decision) يجب أن يكون approved أو rejected');
  }
  if (!actor) throw new Error('اسم الشخص المتخذ للقرار (actor) مطلوب لأغراض التدقيق');

  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  if (doc.archived) throw new Error('لا يمكن اتخاذ إجراء اعتماد على مستند مؤرشف');

  const { workflow, current_stage: currentStage, is_complete } = getCurrentStageInfo(documentId);
  if (is_complete) throw new Error('اكتملت جميع مراحل سير العمل لهذا المستند بالفعل (المستند معتمد بالكامل)');
  if (stageKey && stageKey !== currentStage.key) {
    throw new Error(`المرحلة الحالية المستحقة هي "${currentStage.label}" (${currentStage.key})، ولا يمكن البتّ في مرحلة أخرى قبلها`);
  }
  if (currentStage.required_role && actorRole && currentStage.required_role !== actorRole) {
    throw new Error(`هذه المرحلة تتطلب دور "${currentStage.required_role}" لاتخاذ القرار`);
  }

  doc.workflow_id = doc.workflow_id || workflow.id;

  const approvalRecord = {
    id: newId('APR'),
    document_id: documentId,
    workflow_stage_key: currentStage.key,
    stage_key: currentStage.key,
    stage_label: currentStage.label,
    decision,
    actor,
    actor_role: actorRole || null,
    comments: comments || '',
    decided_at: nowISO(),
  };
  const list = ensureApprovalsList(store, documentId);
  list.push(approvalRecord);

  if (decision === 'approved') {
    doc.status = currentStage.resulting_status;
  } else {
    doc.status = currentStage.on_reject_status;
  }
  doc.updated_at = nowISO();

  audit(store, {
    action: decision === 'approved' ? 'approve' : 'reject',
    entity: 'document', entityId: documentId, projectId: doc.project_id, actor,
    details: {
      stage: currentStage.key, stage_label: currentStage.label, comments,
      resulting_status: doc.status,
    },
  });
  saveStore(store);

  return { success: true, data: { document: doc, approval: approvalRecord } };
}

/** اختصار لاعتماد المرحلة الحالية */
function approveCurrentStage(documentId, { actor, actorRole = null, comments = '', token = null } = {}) {
  if (token) ACL.assertDocumentAccess(token, getDocOrThrow(loadStore(), documentId), 'approve');
  return decideStage(documentId, { decision: 'approved', actor, actorRole, comments });
}

/** اختصار لرفض المرحلة الحالية (يُعيد المستند فعلياً لحالة/مرحلة سابقة للمراجعة) */
function rejectCurrentStage(documentId, { actor, actorRole = null, comments = '', token = null } = {}) {
  if (!comments || !comments.trim()) throw new Error('يجب توضيح سبب الرفض (comments) لأي قرار رفض');
  if (token) ACL.assertDocumentAccess(token, getDocOrThrow(loadStore(), documentId), 'reject');
  return decideStage(documentId, { decision: 'rejected', actor, actorRole, comments });
}

/**
 * إعادة تقديم مستند مرفوض للمراجعة مجدداً (Resubmit) - يتحقق من رفعة إصدار جديد
 * فعلياً قبل أو بعد الاستدعاء ليس شرطاً برمجياً هنا، لكنه يُعيد ضبط حالة المستند
 * صراحة إلى "قيد المراجعة" ليبدأ اجتياز المراحل من نقطة إعادة التوجيه المحدَّدة.
 */
function resubmitForReview(documentId, { actor = null, note = null } = {}) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  if (doc.status !== 'rejected') throw new Error('إعادة التقديم للمراجعة متاحة فقط للمستندات المرفوضة حالياً');

  doc.status = 'under_review';
  doc.updated_at = nowISO();

  audit(store, {
    action: 'resubmit_for_review', entity: 'document', entityId: documentId, projectId: doc.project_id, actor,
    details: { note: note || null },
  });
  saveStore(store);
  return { success: true, data: doc };
}

/**
 * نشر مستند معتمد بالكامل (approved) فعلياً كحالة "منشور" - خطوة صريحة منفصلة عن
 * الاعتماد. إن كانت مرحلة "نشر" معرَّفة ضمن سير العمل النشط لنوع هذا المستند، يُسجَّل
 * لها فعلياً سجل اعتماد (approved) في نفس سجل الموافقات، بحيث تعكس is_complete/history
 * أن مرحلة النشر اجتازت أيضاً وليس فقط أن doc.status أصبح "published" بمعزل عن السجل.
 */
function publishDocument(documentId, { actor = null, token = null } = {}) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  if (token) ACL.assertDocumentAccess(token, doc, 'publish');
  if (doc.status !== 'approved') throw new Error('لا يمكن نشر مستند لم يكتمل اعتماده بعد (الحالة الحالية ليست "معتمد")');

  const { workflow, current_stage: currentStage, is_complete } = getCurrentStageInfo(documentId);
  if (!is_complete && currentStage && currentStage.key === 'publish') {
    const list = ensureApprovalsList(store, documentId);
    list.push({
      id: newId('APR'),
      document_id: documentId,
      workflow_stage_key: currentStage.key,
      stage_key: currentStage.key,
      stage_label: currentStage.label,
      decision: 'approved',
      actor,
      actor_role: null,
      comments: 'نشر رسمي للمستند',
      decided_at: nowISO(),
    });
  }

  doc.status = 'published';
  doc.updated_at = nowISO();

  audit(store, { action: 'publish', entity: 'document', entityId: documentId, projectId: doc.project_id, actor });
  saveStore(store);
  return { success: true, data: doc };
}

/** استرجاع سجل مراحل الاعتماد الكامل لمستند معيّن (تاريخ فعلي، وليس حالة واحدة فقط) */
function getApprovalHistory(documentId) {
  const store = loadStore();
  getDocOrThrow(store, documentId); // للتحقق من الوجود فقط
  const history = (store.approvals[documentId] || []).slice()
    .sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at));
  return { success: true, data: history };
}

/** ملخص حالة سير العمل الحالية لمستند: المرحلة القادمة، هل اكتمل، وسجل القرارات */
function getWorkflowStatus(documentId) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  const info = getCurrentStageInfo(documentId);
  return {
    success: true,
    data: {
      document_id: documentId,
      document_status: doc.status,
      workflow_name: info.workflow.name,
      workflow_stages: info.workflow.stages,
      current_stage: info.current_stage,
      is_complete: info.is_complete,
      history: info.history,
    },
  };
}

/**
 * لوحة معلومات مصغّرة لكل المستندات "قيد الانتظار الفعلي لدى المستخدم/الدور الحالي" -
 * تُستخدم لعرض "صندوق وارد الموافقات" (Approval Inbox) في واجهة المستخدم.
 */
function listPendingApprovals({ projectId = null, actorRole = null } = {}) {
  const store = loadStore();
  let docs = Object.values(store.documents).filter(d => !d.archived && d.status === 'under_review');
  if (projectId) docs = docs.filter(d => d.project_id === projectId);

  const pending = [];
  for (const doc of docs) {
    const info = getCurrentStageInfo(doc.id);
    if (info.is_complete || !info.current_stage) continue;
    if (actorRole && info.current_stage.required_role && info.current_stage.required_role !== actorRole) continue;
    pending.push({
      document_id: doc.id,
      document_number: doc.document_number,
      title: doc.title,
      doc_type_label: doc.doc_type_label,
      project_id: doc.project_id,
      project_name: doc.project_name,
      current_stage: info.current_stage,
      waiting_since: doc.updated_at,
    });
  }
  pending.sort((a, b) => new Date(a.waiting_since) - new Date(b.waiting_since));
  return { success: true, total: pending.length, data: pending };
}

module.exports = {
  DEFAULT_WORKFLOW_STAGES,
  STAGE_LABELS_INDEX,
  buildDefaultWorkflowStages,

  defineWorkflow,
  getActiveWorkflow,
  listWorkflows,

  startWorkflow,
  getCurrentStageInfo,
  decideStage,
  approveCurrentStage,
  rejectCurrentStage,
  resubmitForReview,
  publishDocument,
  getApprovalHistory,
  getWorkflowStatus,
  listPendingApprovals,
};
