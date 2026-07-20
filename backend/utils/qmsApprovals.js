/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * وحدة الاعتماد الإلكتروني الموحّد (Electronic Approval & Digital Signature Log)
 * =====================================================================================
 * حتى الآن، الاعتماد كان موزّعاً داخل كل كيان (توقيع IR ضمن نفس السجل، تعليق/قرار MAR
 * و SDR ضمن سجلاتها الخاصة). هذه الوحدة تضيف طبقة موحّدة إضافية فوق كل ذلك:
 *  - سجل موافقات إلكتروني مركزي (approvalLog) يغطي كل أنواع الكيانات القابلة للاعتماد
 *    في القسم: خطة الجودة، طلب الفحص (IR)، اختبار المادة، NCR، CAPA، MAR، SDR، الوثيقة.
 *  - كل توقيع/اعتماد يُسجَّل بخاتم زمني، اسم الموقّع، دوره، وبصمة تجزئة (hash) لمحتوى
 *    السجل وقت التوقيع، بحيث يمكن لاحقاً اكتشاف أي تعديل على البيانات بعد الاعتماد
 *    (لا يمنع التعديل، لكنه يجعله قابلاً للرصد عبر مقارنة البصمة الحالية بالمُسجَّلة).
 *  - يُستخدم نفس ملف تخزين QMS (qms.json) عبر الدوال المُصدَّرة من qmsManagement.js
 *    (loadStore/saveStore/audit) لضمان اتساق البيانات وعدم ازدواجية مصدر الحقيقة.
 *
 * ملاحظة: هذه الوحدة إضافية (لا تُلغي منطق الاعتماد الموجود مسبقاً داخل كل كيان)،
 * بل توفّر سجلاً موحّداً يسهل تدقيقه والاستعلام عنه عبر كل أقسام الجودة دفعة واحدة.
 */

const crypto = require('crypto');
const QMS = require('./qmsManagement');

const APPROVABLE_ENTITIES = {
  quality_plan: { getFn: 'getQualityPlan', label: 'خطة الجودة' },
  inspection_request: { getFn: 'getInspectionRequest', label: 'طلب فحص (IR)' },
  material_test: { getFn: 'getMaterialTest', label: 'اختبار مادة' },
  ncr: { getFn: 'getNcr', label: 'حالة عدم مطابقة (NCR)' },
  capa: { getFn: 'getCapa', label: 'إجراء تصحيحي/وقائي (CAPA)' },
  mar: { getFn: 'getMar', label: 'طلب اعتماد مواد (MAR)' },
  sdr: { getFn: 'getSdr', label: 'طلب اعتماد رسم (SDR)' },
};

function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function hashRecord(record) {
  const json = JSON.stringify(record || {});
  return crypto.createHash('sha256').update(json).digest('hex');
}

function ensureApprovalLog(store) {
  if (!Array.isArray(store.approvalLog)) store.approvalLog = [];
  return store.approvalLog;
}

/**
 * تسجيل اعتماد/توقيع إلكتروني رسمي على كيان معيّن من كيانات الجودة.
 * لا يغيّر حالة الكيان نفسه (ذلك يتم عبر دوال qmsManagement المخصصة لكل كيان)،
 * بل يضيف سجلاً موقّعاً ومؤرَّخاً في سجل الموافقات المركزي.
 */
function recordApproval({
  entityType, entityId, decision, signerName, signerRole,
  comments = '', projectId = null,
}) {
  if (!APPROVABLE_ENTITIES[entityType]) {
    throw new Error(`نوع كيان غير مدعوم للاعتماد الإلكتروني: ${entityType}`);
  }
  if (!entityId) throw new Error('معرّف الكيان (entityId) مطلوب');
  if (!decision || !['approved', 'rejected', 'approved_with_comments'].includes(decision)) {
    throw new Error('قرار الاعتماد (decision) يجب أن يكون approved أو rejected أو approved_with_comments');
  }
  if (!signerName || !signerRole) throw new Error('اسم الموقّع (signerName) ودوره (signerRole) مطلوبان');

  const { getFn, label } = APPROVABLE_ENTITIES[entityType];
  const entity = unwrap(QMS[getFn](entityId));
  if (!entity) throw new Error(`لم يتم العثور على ${label} بالمعرّف المحدد`);

  const store = QMS.loadStore();
  const log = ensureApprovalLog(store);

  const record = {
    id: QMS.newId('APR'),
    entity_type: entityType,
    entity_label: label,
    entity_id: entityId,
    project_id: projectId || entity.project_id || null,
    decision,
    signer_name: signerName,
    signer_role: signerRole,
    comments,
    signed_at: QMS.nowISO(),
    entity_snapshot_hash: hashRecord(entity),
  };

  log.push(record);
  QMS.saveStore(store);
  QMS.audit(store, {
    action: 'electronic_approval',
    entity: entityType,
    entityId,
    projectId: record.project_id,
    details: { decision, signer_name: signerName, signer_role: signerRole },
  });

  return { success: true, approval: record };
}

/** استرجاع سجل الموافقات لكيان محدد، مع التحقق مما إذا كانت البيانات قد تغيّرت بعد آخر اعتماد */
function getApprovalHistory({ entityType, entityId }) {
  if (!APPROVABLE_ENTITIES[entityType]) {
    throw new Error(`نوع كيان غير مدعوم للاعتماد الإلكتروني: ${entityType}`);
  }
  const store = QMS.loadStore();
  const log = ensureApprovalLog(store);
  const history = log
    .filter(a => a.entity_type === entityType && a.entity_id === entityId)
    .sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));

  let integrity_status = 'no_approvals';
  if (history.length) {
    const { getFn } = APPROVABLE_ENTITIES[entityType];
    const current = unwrap(QMS[getFn](entityId));
    const currentHash = current ? hashRecord(current) : null;
    integrity_status = currentHash === history[0].entity_snapshot_hash
      ? 'unchanged_since_last_approval'
      : 'modified_since_last_approval';
  }

  return { success: true, entity_type: entityType, entity_id: entityId, integrity_status, history };
}

/** استعلام عام في سجل الموافقات بالكامل، مع فلاتر اختيارية */
function listApprovals({ projectId = null, entityType = null, decision = null, signerName = null } = {}) {
  const store = QMS.loadStore();
  let log = ensureApprovalLog(store).slice();

  if (projectId) log = log.filter(a => a.project_id === projectId);
  if (entityType) log = log.filter(a => a.entity_type === entityType);
  if (decision) log = log.filter(a => a.decision === decision);
  if (signerName) log = log.filter(a => (a.signer_name || '').includes(signerName));

  log.sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));
  return { success: true, total: log.length, approvals: log };
}

/** ملخص إحصائي لسجل الاعتمادات (لعرضه في لوحة معلومات الجودة) */
function getApprovalsSummary({ projectId = null } = {}) {
  const { approvals } = unwrap(listApprovals({ projectId })) || { approvals: [] };
  const list = approvals || [];

  const byDecision = { approved: 0, rejected: 0, approved_with_comments: 0 };
  const byEntityType = {};
  for (const a of list) {
    byDecision[a.decision] = (byDecision[a.decision] || 0) + 1;
    byEntityType[a.entity_type] = (byEntityType[a.entity_type] || 0) + 1;
  }

  return {
    success: true,
    total_approvals: list.length,
    by_decision: byDecision,
    by_entity_type: byEntityType,
    latest: list.slice(0, 10),
  };
}

module.exports = {
  APPROVABLE_ENTITIES,
  recordApproval,
  getApprovalHistory,
  listApprovals,
  getApprovalsSummary,
};
