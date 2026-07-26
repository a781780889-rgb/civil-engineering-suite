/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء 7/10 (2 من 3): التوقيعات والاعتمادات على التقارير
 *
 * يعيد استخدام نفس منهجية التوقيع الإلكتروني الحقيقي المطبَّقة في القسم الحادي عشر
 * (documentSignature.js): بصمة تجزئة تشفيرية HMAC-SHA256 قابلة لإعادة الحساب
 * والتحقق (وليست نصاً شكلياً "تم الاعتماد")، بسرّ توقيع خاص بهذا التنصيب مخزَّن
 * بصلاحيات القراءة للخادم فقط، وسجل توقيعات كامل لا يُحذَف (يُلغى صراحة عند الحاجة).
 *
 * دورة حياة التقرير هنا: إعداد (draft) → مراجعة (under_review) → اعتماد/رفض
 * (approved/rejected) → إعادة للمراجعة (returned_for_review) عند الرفض.
 * يدعم مستويات اعتماد متعددة مرتّبة أو غير مرتّبة (مثال: معدّ التقرير ثم مدير
 * المشروع ثم الاستشاري)، مأخوذة إما من قالب تقرير (reportTemplates.js) أو مُمرَّرة
 * مباشرة لكل تقرير عند بدء دورة الاعتماد.
 *
 * التخزين: نفس ملف reportsCenter.json (مفتاح جديد approvals{} يُضاف هنا).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ReportsCenter = require('./reportsCenter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportsCenter.json');
const SIGNING_SECRET_FILE = path.join(DATA_DIR, 'reports_signing.secret');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      reportRecords: {}, templates: {}, scheduledReports: {}, shares: {}, auditLog: [], seq: 0,
    }, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات نظام التقارير: ' + e.message);
  }
  if (!store.approvals) store.approvals = {}; // { reportRecordId: { policy, signatures: [] } }
  if (!store.auditLog) store.auditLog = [];
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, userId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, userId, details });
  if (store.auditLog.length > 10000) store.auditLog = store.auditLog.slice(-10000);
}

// ===================== سرّ التوقيع الخاص بقسم التقارير =====================

function getSigningSecret() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGNING_SECRET_FILE)) {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SIGNING_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
    return secret;
  }
  return fs.readFileSync(SIGNING_SECRET_FILE, 'utf8').trim();
}

function buildSignaturePayload({ reportRecordId, reportVersion, signerName, signerRole, decision, level, comments, signedAt }) {
  return [
    'REPORTS-SIGNATURE-V1',
    reportRecordId, String(reportVersion), signerName, signerRole,
    decision, String(level), comments || '', signedAt,
  ].join('|');
}

function computeSignatureHash(payload) {
  return crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
}

// ===================== بدء/تعديل دورة اعتماد تقرير =====================

const DEFAULT_LEVELS = [{ level: 1, label: 'اعتماد', required_role: null }];

function getOrInitApproval(store, reportRecordId) {
  if (!store.approvals[reportRecordId]) {
    store.approvals[reportRecordId] = {
      report_record_id: reportRecordId,
      status: 'draft', // draft | under_review | approved | rejected | returned_for_review
      policy_levels: DEFAULT_LEVELS.map((l) => ({ ...l })),
      sequential: true,
      signatures: [],
      created_at: nowISO(),
      updated_at: nowISO(),
    };
  }
  return store.approvals[reportRecordId];
}

/**
 * يبدأ (أو يعيد تهيئة) دورة اعتماد تقرير محدد بسياسة مستويات معيّنة (عادة مأخوذة
 * من قالب عبر reportTemplates.applyTemplateToReportRequest، أو مُمرَّرة يدوياً).
 * يتحقق فعلياً من وجود سجل التقرير نفسه في reportsCenter قبل بدء الدورة.
 */
function startApprovalCycle(reportRecordId, { levels = null, sequential = true, userId = null } = {}) {
  ReportsCenter.getReportRecord(reportRecordId); // يرمي خطأ فعلي لو التقرير غير موجود
  const store = loadStore();
  const policyLevels = (levels && levels.length ? levels : DEFAULT_LEVELS).map((l) => ({
    level: l.level, label: l.label, required_role: l.required_role || null,
  })).sort((a, b) => a.level - b.level);

  const seen = new Set();
  for (const lvl of policyLevels) {
    if (seen.has(lvl.level)) throw new Error(`رقم مستوى الاعتماد ${lvl.level} مكرر`);
    seen.add(lvl.level);
  }

  store.approvals[reportRecordId] = {
    report_record_id: reportRecordId,
    status: 'under_review',
    policy_levels: policyLevels,
    sequential: !!sequential,
    signatures: [],
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const rec = ReportsCenter.getReportRecord(reportRecordId);
  audit(store, {
    action: 'start_report_approval_cycle', entity: 'report', entityId: reportRecordId,
    projectId: rec.project_id, userId, details: { levels: policyLevels.length },
  });
  saveStore(store);
  return store.approvals[reportRecordId];
}

function getApprovalState(reportRecordId) {
  const store = loadStore();
  const approval = getOrInitApproval(store, reportRecordId);
  const activeSignatures = approval.signatures.filter((s) => !s.revoked);
  const signedLevels = new Set(activeSignatures.filter((s) => s.decision === 'approved').map((s) => s.level));
  const totalLevels = approval.policy_levels.length;
  const isComplete = approval.policy_levels.every((l) => signedLevels.has(l.level));

  let nextLevel = null;
  if (!isComplete) {
    const sortedLevels = [...approval.policy_levels].sort((a, b) => a.level - b.level);
    if (approval.sequential) {
      nextLevel = sortedLevels.find((l) => !signedLevels.has(l.level)) || null;
    } else {
      const remaining = sortedLevels.filter((l) => !signedLevels.has(l.level));
      nextLevel = remaining.length ? remaining : null;
    }
  }

  return {
    report_record_id: reportRecordId,
    status: approval.status,
    policy_levels: approval.policy_levels,
    sequential: approval.sequential,
    signed_levels_count: signedLevels.size,
    total_levels_required: totalLevels,
    is_complete: isComplete,
    next_required_level: nextLevel,
    signatures: [...activeSignatures].sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at)),
  };
}

/**
 * توقيع/اعتماد أو رفض مستوى معيّن من دورة اعتماد التقرير. يحسب بصمة HMAC حقيقية
 * من بيانات القرار + هوية الموقّع + الختم الزمني، غير قابلة للتزوير بدون الوصول
 * لملفات الخادم (سرّ التوقيع الخاص بقسم التقارير).
 */
function signReport(reportRecordId, { signerName, signerRole = null, decision, level = null, comments = null } = {}) {
  if (!signerName || !signerName.trim()) throw new Error('اسم الموقّع (signerName) مطلوب');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('decision يجب أن تكون approved أو rejected');

  const reportRec = ReportsCenter.getReportRecord(reportRecordId);
  const store = loadStore();
  const approval = getOrInitApproval(store, reportRecordId);
  if (approval.status === 'draft') approval.status = 'under_review';
  if (approval.status === 'approved') throw new Error('هذا التقرير معتمَد بالفعل بكامل مستوياته');

  const activeSignatures = approval.signatures.filter((s) => !s.revoked);
  const signedLevels = new Set(activeSignatures.filter((s) => s.decision === 'approved').map((s) => s.level));
  const sortedLevels = [...approval.policy_levels].sort((a, b) => a.level - b.level);

  let targetLevel;
  if (level != null) {
    targetLevel = approval.policy_levels.find((l) => l.level === level);
    if (!targetLevel) throw new Error(`مستوى الاعتماد ${level} غير معرَّف في سياسة هذا التقرير`);
    if (approval.sequential) {
      const idx = sortedLevels.findIndex((l) => l.level === level);
      const prerequisitesSigned = sortedLevels.slice(0, idx).every((l) => signedLevels.has(l.level));
      if (!prerequisitesSigned) throw new Error('يجب اعتماد المستويات السابقة أولاً قبل هذا المستوى (سياسة اعتماد مرتّبة)');
    }
  } else {
    if (approval.sequential) {
      targetLevel = sortedLevels.find((l) => !signedLevels.has(l.level));
      if (!targetLevel) throw new Error('كل مستويات الاعتماد مكتملة بالفعل');
    } else {
      throw new Error('يجب تحديد level صراحةً لسياسة اعتماد غير مرتّبة');
    }
  }

  const signedAt = nowISO();
  const payload = buildSignaturePayload({
    reportRecordId, reportVersion: reportRec.version || 1, signerName, signerRole,
    decision, level: targetLevel.level, comments, signedAt,
  });
  const signatureHash = computeSignatureHash(payload);

  const signature = {
    id: newId('RSIG'),
    report_record_id: reportRecordId,
    report_version_at_signing: reportRec.version || 1,
    level: targetLevel.level,
    level_label: targetLevel.label,
    signer_name: signerName,
    signer_role: signerRole,
    decision,
    comments: comments || '',
    signed_at: signedAt,
    signature_hash: signatureHash,
    revoked: false,
    revoked_at: null,
    revoked_reason: null,
  };
  approval.signatures.push(signature);
  approval.updated_at = nowISO();

  if (decision === 'rejected') {
    approval.status = 'rejected';
  } else {
    const newSignedLevels = new Set([...signedLevels, targetLevel.level]);
    const nowComplete = approval.policy_levels.every((l) => newSignedLevels.has(l.level));
    approval.status = nowComplete ? 'approved' : 'under_review';
  }

  audit(store, {
    action: 'sign_report', entity: 'report', entityId: reportRecordId, projectId: reportRec.project_id,
    userId: signerName, details: { level: targetLevel.level, decision, signature_id: signature.id },
  });
  saveStore(store);

  return { signature, approval_status: approval.status };
}

function returnForReview(reportRecordId, { reason, userId = null } = {}) {
  if (!reason || !reason.trim()) throw new Error('يجب توضيح سبب إعادة التقرير للمراجعة (reason)');
  const reportRec = ReportsCenter.getReportRecord(reportRecordId);
  const store = loadStore();
  const approval = getOrInitApproval(store, reportRecordId);
  approval.status = 'returned_for_review';
  approval.updated_at = nowISO();
  audit(store, {
    action: 'return_report_for_review', entity: 'report', entityId: reportRecordId,
    projectId: reportRec.project_id, userId, details: { reason },
  });
  saveStore(store);
  return getApprovalState(reportRecordId);
}

function revokeReportSignature(reportRecordId, signatureId, { reason, userId = null } = {}) {
  if (!reason || !reason.trim()) throw new Error('يجب توضيح سبب إلغاء التوقيع (reason)');
  const reportRec = ReportsCenter.getReportRecord(reportRecordId);
  const store = loadStore();
  const approval = getOrInitApproval(store, reportRecordId);
  const sig = approval.signatures.find((s) => s.id === signatureId);
  if (!sig) throw new Error('التوقيع غير موجود لهذا التقرير');
  if (sig.revoked) throw new Error('هذا التوقيع ملغى بالفعل');

  sig.revoked = true;
  sig.revoked_at = nowISO();
  sig.revoked_reason = reason;
  // بعد الإلغاء، تُعاد حالة الدورة إلى "قيد المراجعة" (ليست معتمَدة بعد الآن) إن كانت مكتملة
  if (approval.status === 'approved') approval.status = 'under_review';
  approval.updated_at = nowISO();

  audit(store, {
    action: 'revoke_report_signature', entity: 'report', entityId: reportRecordId,
    projectId: reportRec.project_id, userId, details: { signature_id: signatureId, reason },
  });
  saveStore(store);
  return getApprovalState(reportRecordId);
}

/** التحقق الفعلي من صحة توقيع معيّن على تقرير: إعادة حساب البصمة ومقارنتها بزمن ثابت */
function verifyReportSignature(reportRecordId, signatureId) {
  const store = loadStore();
  const approval = getOrInitApproval(store, reportRecordId);
  const sig = approval.signatures.find((s) => s.id === signatureId);
  if (!sig) throw new Error('التوقيع غير موجود لهذا التقرير');

  const expectedPayload = buildSignaturePayload({
    reportRecordId, reportVersion: sig.report_version_at_signing, signerName: sig.signer_name,
    signerRole: sig.signer_role, decision: sig.decision, level: sig.level, comments: sig.comments, signedAt: sig.signed_at,
  });
  const expectedHash = computeSignatureHash(expectedPayload);

  let hashesMatch = false;
  try {
    hashesMatch = crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(sig.signature_hash, 'hex'));
  } catch (e) {
    hashesMatch = false;
  }

  let currentVersion = null;
  try { currentVersion = ReportsCenter.getReportRecord(reportRecordId).version || 1; } catch (e) { /* حُذف التقرير */ }
  const changedSinceSigning = currentVersion != null && currentVersion !== sig.report_version_at_signing;

  return {
    signature_id: signatureId,
    is_authentic: hashesMatch,
    is_revoked: !!sig.revoked,
    report_changed_since_signing: changedSinceSigning,
    integrity_status: !hashesMatch
      ? 'invalid_signature_tampered'
      : sig.revoked
        ? 'revoked'
        : changedSinceSigning
          ? 'report_modified_after_signing'
          : 'valid',
    signed_by: sig.signer_name,
    signed_role: sig.signer_role,
    signed_at: sig.signed_at,
    level_label: sig.level_label,
    decision: sig.decision,
  };
}

function listPendingApprovals({ projectId = null, level = null } = {}) {
  const store = loadStore();
  const rows = Object.values(store.approvals).filter((a) => a.status === 'under_review' || a.status === 'returned_for_review');
  const result = [];
  for (const a of rows) {
    let rec;
    try { rec = ReportsCenter.getReportRecord(a.report_record_id); } catch (e) { continue; }
    if (projectId && rec.project_id !== projectId) continue;
    const state = getApprovalState(a.report_record_id);
    if (level != null && (!state.next_required_level || (Array.isArray(state.next_required_level) ? !state.next_required_level.some((l) => l.level === level) : state.next_required_level.level !== level))) continue;
    result.push({ report: { id: rec.id, title: rec.title, project_id: rec.project_id, category: rec.category_label }, approval: state });
  }
  return result;
}

module.exports = {
  DEFAULT_LEVELS,
  startApprovalCycle,
  getApprovalState,
  signReport,
  returnForReview,
  revokeReportSignature,
  verifyReportSignature,
  listPendingApprovals,
};
