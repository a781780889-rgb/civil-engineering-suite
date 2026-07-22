/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الرابع (4/10): التوقيع الإلكتروني (اعتماد متعدد المستويات + ختم زمني + سجل توقيعات)
 * =====================================================================================
 *
 * يبني هذا الجزء فوق طبقة التخزين الموحّدة (نفس ملف dms.json المُستخدَم في الجزء 1/10
 * والجزء 3/10)، ويضيف طبقة توقيع إلكتروني فعلية وليست شكلية:
 *
 *  - توقيع إلكتروني حقيقي: كل توقيع هو بصمة تجزئة تشفيرية (HMAC-SHA256) تُحسَب فعلياً
 *    من محتوى الإصدار الحالي للمستند وقت التوقيع (checksum الإصدار) + هوية الموقّع +
 *    دوره + الختم الزمني، باستخدام سرّ توقيع خاص بالنظام (SIGNING_SECRET) لا يمكن
 *    تزويره دون الوصول لملفات الخادم - وليس مجرد نص "تم التوقيع" بلا قيمة تشفيرية.
 *  - التحقق من صحة التوقيع: يعيد حساب نفس بصمة HMAC من البيانات المخزَّنة ويقارنها
 *    ببصمة التوقيع الأصلية؛ أي تعديل لاحق على بيانات التوقيع أو تبديل الموقّع يُكتشَف
 *    فوراً (توقيع غير صالح). كما يتحقق مما إذا تغيّر محتوى المستند نفسه بعد التوقيع
 *    (بمقارنة checksum الإصدار الحالي بما وُقِّع عليه فعلياً).
 *  - اعتماد متعدد المستويات: يدعم تعريف "سياسة توقيع" لكل مستند/نوع مستند تتطلب عدة
 *    توقيعات مرتّبة أو غير مرتّبة (مثال: مهندس المشروع ثم مدير المشروع ثم الاستشاري)،
 *    ولا يُعتبر المستند "مكتمل التوقيع" إلا بعد استيفاء جميع المستويات المطلوبة فعلياً.
 *  - ختم زمني (Timestamp): كل توقيع يحمل توقيتاً حقيقياً (ISO 8601) من ساعة الخادم وقت
 *    التوقيع، يُدرَج ضمن بيانات البصمة نفسها (وليس حقلاً منفصلاً قابلاً للتعديل بمعزل
 *    عن التوقيع).
 *  - سجل توقيعات كامل لكل مستند: كل توقيع سابق يبقى محفوظاً بالكامل (لا يُستبدَل ولا
 *    يُحذَف)، حتى لو أُلغي لاحقاً (يُعلَّم كملغى صراحةً بدل حذفه) لضمان تتبّع تاريخي حقيقي.
 *  - التكامل مع سير العمل (الجزء 3/10): يمكن ربط مرحلة اعتماد معيّنة بمتطلب توقيع
 *    إلكتروني إلزامي، بحيث لا يُعتبر قرار الاعتماد نافذاً على المستند إلا مصحوباً
 *    بتوقيع فعلي صالح لنفس القرار.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DMS = require('./documentManagement');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms.json');
const SIGNING_SECRET_FILE = path.join(DATA_DIR, 'dms_signing.secret');

// ==================================================================================
// ===================== بوابة وصول موحّدة لملف تخزين DMS (نفس dms.json) =============
// ==================================================================================
// بنفس نمط documentWorkflow.js تماماً: إعادة استخدام نفس ملف التخزين والبنية دون أي
// تكرار أو انقسام في مصدر الحقيقة.

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

function getDocOrThrow(store, documentId) {
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  return doc;
}

// ==================================================================================
// ========================= سرّ التوقيع الخاص بالنظام (Signing Secret) =============
// ==================================================================================

/**
 * يولّد (مرة واحدة فقط) سرّاً عشوائياً قوياً خاصاً بتوقيع هذا التنصيب، ويحفظه على
 * القرص بصلاحيات القراءة للخادم فقط. هذا السرّ هو أساس عدم قابلية تزوير التوقيعات:
 * أي طرف لا يملك وصولاً لملفات الخادم لا يمكنه توليد بصمة HMAC صحيحة، حتى لو عرف
 * محتوى المستند والموقّع والتاريخ بالضبط.
 */
function getSigningSecret() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGNING_SECRET_FILE)) {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SIGNING_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
    return secret;
  }
  return fs.readFileSync(SIGNING_SECRET_FILE, 'utf8').trim();
}

/** يبني نص البصمة القابل لإعادة الحساب (deterministic) من بيانات التوقيع بالكامل */
function buildSignaturePayload({
  documentId, versionId, versionChecksum, signerName, signerRole,
  decision, level, comments, signedAt,
}) {
  return [
    'DMS-SIGNATURE-V1',
    documentId, versionId, versionChecksum,
    signerName, signerRole, decision, String(level),
    comments || '', signedAt,
  ].join('|');
}

function computeSignatureHash(payload) {
  const secret = getSigningSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// ==================================================================================
// ===================== سياسات التوقيع متعدد المستويات لكل نوع مستند ================
// ==================================================================================

/**
 * السياسة الافتراضية: مستوى توقيع واحد إلزامي (أي موقّع واحد يكفي لإتمام التوقيع).
 * يمكن تخصيص سياسة مختلفة (عدة مستويات مرتّبة) لأي نوع مستند عبر defineSignaturePolicy.
 */
const DEFAULT_SIGNATURE_POLICY_LEVELS = [
  { level: 1, label: 'توقيع معتمِد واحد', required_role: null },
];

function buildDefaultPolicyLevels() {
  return DEFAULT_SIGNATURE_POLICY_LEVELS.map(l => ({ ...l }));
}

/**
 * تعريف سياسة توقيع متعدد المستويات مخصّصة لنوع مستند (مثال: عقد يتطلب توقيع مهندس
 * المشروع (مستوى 1) ثم مدير المشروع (مستوى 2) ثم الاستشاري (مستوى 3) بالترتيب).
 */
function defineSignaturePolicy({ docType, name = null, levels, sequential = true, isActive = true } = {}) {
  if (!docType || !DMS.DOCUMENT_TYPES[docType]) {
    throw new Error(`نوع المستند (docType) غير صحيح. الأنواع المدعومة: ${Object.keys(DMS.DOCUMENT_TYPES).join(', ')}`);
  }
  if (!Array.isArray(levels) || !levels.length) {
    throw new Error('يجب تحديد مصفوفة مستويات توقيع (levels) لا تقل عن مستوى واحد');
  }
  const seenLevels = new Set();
  for (const lvl of levels) {
    if (!Number.isInteger(lvl.level) || lvl.level < 1) throw new Error('كل مستوى توقيع يجب أن يحمل رقماً صحيحاً (level) ابتداءً من 1');
    if (seenLevels.has(lvl.level)) throw new Error(`رقم المستوى ${lvl.level} مكرر ضمن نفس السياسة`);
    seenLevels.add(lvl.level);
    if (!lvl.label) throw new Error(`المستوى رقم ${lvl.level} يحتاج اسماً معروضاً (label)`);
  }

  const store = loadStore();
  const existing = Object.values(store.signaturePolicies || {}).find(p => p.doc_type === docType && p.is_active);
  if (!store.signaturePolicies) store.signaturePolicies = {};
  if (existing && isActive) existing.is_active = false;

  const policyId = newId('SPL');
  const record = {
    id: policyId,
    doc_type: docType,
    doc_type_label: DMS.DOCUMENT_TYPES[docType].label,
    name: name || `سياسة توقيع ${DMS.DOCUMENT_TYPES[docType].label}`,
    levels: levels.map(l => ({ level: l.level, label: l.label, required_role: l.required_role || null }))
      .sort((a, b) => a.level - b.level),
    sequential: !!sequential,
    is_active: !!isActive,
    created_at: nowISO(),
  };
  store.signaturePolicies[policyId] = record;

  audit(store, { action: 'define_signature_policy', entity: 'signature_policy', entityId: policyId, actor: null, details: { doc_type: docType, levels: levels.length } });
  saveStore(store);
  return { success: true, data: record };
}

/** يعيد سياسة التوقيع النشطة لنوع مستند، أو السياسة الافتراضية (مستوى واحد) إن لم تُخصَّص */
function getActiveSignaturePolicy(docType) {
  const store = loadStore();
  const custom = Object.values(store.signaturePolicies || {}).find(p => p.doc_type === docType && p.is_active);
  if (custom) return custom;
  return {
    id: null,
    doc_type: docType,
    doc_type_label: DMS.DOCUMENT_TYPES[docType]?.label || docType,
    name: 'سياسة التوقيع الافتراضية',
    levels: buildDefaultPolicyLevels(),
    sequential: true,
    is_active: true,
    is_default: true,
  };
}

function listSignaturePolicies({ docType = null } = {}) {
  const store = loadStore();
  let items = Object.values(store.signaturePolicies || {});
  if (docType) items = items.filter(p => p.doc_type === docType);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

// ==================================================================================
// ================================ التوقيع الفعلي ===================================
// ==================================================================================

function ensureSignaturesList(store, documentId) {
  if (!store.signatures[documentId]) store.signatures[documentId] = [];
  return store.signatures[documentId];
}

/** يحسب المستوى التالي المستحق للتوقيع بناءً على التوقيعات السارية (غير الملغاة) الحالية.
 * يقبل store اختيارياً (نسخة في الذاكرة) لتفادي قراءة نسخة قديمة من القرص عند
 * استدعائه أثناء عملية توقيع لم تُحفَظ بعد. */
function getNextRequiredLevel(documentId, existingStore = null) {
  const store = existingStore || loadStore();
  const doc = getDocOrThrow(store, documentId);
  const policy = getActiveSignaturePolicy(doc.doc_type);
  const signed = (store.signatures[documentId] || []).filter(s => !s.revoked);

  const signedLevels = new Set(signed.map(s => s.level));
  const remaining = policy.levels.filter(l => !signedLevels.has(l.level)).sort((a, b) => a.level - b.level);

  const isComplete = remaining.length === 0;
  const nextLevel = isComplete ? null : (policy.sequential ? remaining[0] : remaining);

  return { policy, signedCount: signed.length, totalLevels: policy.levels.length, isComplete, nextLevel, remaining };
}

/**
 * توقيع إلكتروني فعلي على المستند (على إصداره الحالي وقت التوقيع). ينشئ سجل توقيع
 * جديداً يحمل بصمة HMAC حقيقية غير قابلة للتزوير، ويضيفه لسجل توقيعات المستند
 * (store.signatures[documentId])، ويربط معرّفه ضمن doc.signature_ids.
 */
function signDocument(documentId, {
  signerName, signerRole, level = null, decision = 'approved', comments = '',
} = {}) {
  if (!signerName || !signerRole) throw new Error('اسم الموقّع (signerName) ودوره (signerRole) مطلوبان');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('قرار التوقيع (decision) يجب أن يكون approved أو rejected');

  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  if (doc.archived) throw new Error('لا يمكن التوقيع على مستند مؤرشف');

  const currentVersion = store.versions[doc.current_version_id];
  if (!currentVersion) throw new Error('تعذّر تحديد الإصدار الحالي للمستند لغرض التوقيع');

  const { policy, isComplete, nextLevel } = getNextRequiredLevel(documentId, store);
  if (isComplete) throw new Error('تم استيفاء جميع مستويات التوقيع المطلوبة لهذا المستند بالفعل');

  let targetLevel;
  if (policy.sequential) {
    if (level && level !== nextLevel.level) {
      throw new Error(`المستوى المستحق حالياً للتوقيع هو "${nextLevel.label}" (مستوى ${nextLevel.level})، ولا يمكن التوقيع على مستوى آخر قبله`);
    }
    targetLevel = nextLevel;
  } else {
    targetLevel = level ? policy.levels.find(l => l.level === level) : nextLevel[0];
    if (!targetLevel) throw new Error('مستوى التوقيع المحدد غير موجود ضمن سياسة التوقيع لهذا النوع، أو تم توقيعه بالفعل');
  }

  if (targetLevel.required_role && signerRole !== targetLevel.required_role) {
    throw new Error(`هذا المستوى يتطلب دوراً محدداً: "${targetLevel.required_role}"`);
  }

  const signedAt = nowISO();
  const payload = buildSignaturePayload({
    documentId, versionId: currentVersion.id, versionChecksum: currentVersion.checksum_sha256,
    signerName, signerRole, decision, level: targetLevel.level, comments, signedAt,
  });
  const signatureHash = computeSignatureHash(payload);

  const signatureId = newId('SIG');
  const record = {
    id: signatureId,
    document_id: documentId,
    version_id: currentVersion.id,
    version_checksum_at_signing: currentVersion.checksum_sha256,
    version_number_at_signing: currentVersion.version_number,
    policy_id: policy.id,
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

  const list = ensureSignaturesList(store, documentId);
  list.push(record);
  doc.signature_ids.push(signatureId);
  doc.updated_at = nowISO();

  // إن كان القرار رفضاً، يُطبَّق أثره فوراً على حالة المستند (بمعزل عن أثر سير العمل
  // في الجزء 3/10 الذي يبقى مسؤولاً عن انتقالات الحالة التفصيلية لكل مرحلة)
  if (decision === 'rejected') doc.status = 'rejected';

  const afterInfo = getNextRequiredLevel(documentId, store);
  if (decision === 'approved' && afterInfo.isComplete && doc.status !== 'published') {
    doc.status = 'approved';
  }

  audit(store, {
    action: 'electronic_signature', entity: 'document', entityId: documentId, projectId: doc.project_id, actor: signerName,
    details: {
      level: targetLevel.level, level_label: targetLevel.label, decision,
      version_number: currentVersion.version_number, signature_id: signatureId,
    },
  });
  saveStore(store);

  return {
    success: true,
    data: {
      signature: record,
      document_status: doc.status,
      signature_complete: afterInfo.isComplete,
    },
  };
}

/**
 * إلغاء توقيع سابق (Revoke) - لا يُحذَف من السجل، بل يُعلَّم كملغى مع سبب وتاريخ
 * الإلغاء، حفاظاً على تاريخ تدقيقي كامل وحقيقي لكل ما جرى على المستند.
 */
function revokeSignature(documentId, signatureId, { actor = null, reason = null } = {}) {
  if (!reason || !reason.trim()) throw new Error('يجب توضيح سبب إلغاء التوقيع (reason)');
  const store = loadStore();
  getDocOrThrow(store, documentId);
  const list = store.signatures[documentId] || [];
  const sig = list.find(s => s.id === signatureId);
  if (!sig) throw new Error('التوقيع المطلوب إلغاؤه غير موجود لهذا المستند');
  if (sig.revoked) throw new Error('هذا التوقيع ملغى بالفعل');

  sig.revoked = true;
  sig.revoked_at = nowISO();
  sig.revoked_reason = reason;

  audit(store, {
    action: 'revoke_signature', entity: 'document', entityId: documentId, actor,
    details: { signature_id: signatureId, reason },
  });
  saveStore(store);
  return { success: true, data: sig };
}

// ==================================================================================
// ============================ التحقق من صحة التوقيع =================================
// ==================================================================================

/**
 * التحقق الفعلي من صحة توقيع معيّن: يعيد حساب بصمة HMAC من نفس البيانات المخزَّنة
 * ويقارنها بالبصمة الأصلية المحفوظة (مقارنة زمن ثابت لمنع هجمات التوقيت)، ثم يتحقق
 * إضافياً مما إذا تغيّر محتوى المستند (بمقارنة checksum إصداره الحالي بما وُقِّع عليه).
 */
function verifySignature(documentId, signatureId) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  const list = store.signatures[documentId] || [];
  const sig = list.find(s => s.id === signatureId);
  if (!sig) throw new Error('التوقيع المطلوب التحقق منه غير موجود لهذا المستند');

  const expectedPayload = buildSignaturePayload({
    documentId, versionId: sig.version_id, versionChecksum: sig.version_checksum_at_signing,
    signerName: sig.signer_name, signerRole: sig.signer_role, decision: sig.decision,
    level: sig.level, comments: sig.comments, signedAt: sig.signed_at,
  });
  const expectedHash = computeSignatureHash(expectedPayload);

  let hashesMatch = false;
  try {
    hashesMatch = crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(sig.signature_hash, 'hex'));
  } catch (e) {
    hashesMatch = false; // طول غير متطابق يعني بصمة غير صالحة أصلاً
  }

  const currentVersion = store.versions[doc.current_version_id];
  const documentChangedSinceSigning = !!currentVersion && currentVersion.checksum_sha256 !== sig.version_checksum_at_signing;

  return {
    success: true,
    data: {
      signature_id: signatureId,
      is_authentic: hashesMatch,
      is_revoked: !!sig.revoked,
      document_changed_since_signing: documentChangedSinceSigning,
      integrity_status: !hashesMatch
        ? 'invalid_signature_tampered'
        : sig.revoked
          ? 'revoked'
          : documentChangedSinceSigning
            ? 'document_modified_after_signing'
            : 'valid',
      signed_by: sig.signer_name,
      signed_role: sig.signer_role,
      signed_at: sig.signed_at,
      level_label: sig.level_label,
      decision: sig.decision,
    },
  };
}

/** استرجاع سجل التوقيعات الكامل لمستند (مع حالة الاكتمال العامة لسياسة التوقيع) */
function getSignatureLog(documentId) {
  const store = loadStore();
  const doc = getDocOrThrow(store, documentId);
  const signatures = (store.signatures[documentId] || []).slice()
    .sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));
  const info = getNextRequiredLevel(documentId);

  return {
    success: true,
    data: {
      document_id: documentId,
      policy_name: info.policy.name,
      policy_levels: info.policy.levels,
      sequential: info.policy.sequential,
      signed_levels_count: info.signedCount,
      total_levels_required: info.totalLevels,
      is_signature_complete: info.isComplete,
      next_required_level: info.nextLevel,
      signatures,
    },
  };
}

/** ملخص عام لكل التوقيعات المسجَّلة في النظام (لعرضه ضمن لوحة معلومات المستندات) */
function getSignaturesSummary() {
  const store = loadStore();
  const allSignatures = Object.values(store.signatures).flat();
  const revoked = allSignatures.filter(s => s.revoked).length;
  const active = allSignatures.length - revoked;
  const byDecision = { approved: 0, rejected: 0 };
  for (const s of allSignatures) {
    if (!s.revoked) byDecision[s.decision] = (byDecision[s.decision] || 0) + 1;
  }
  return {
    success: true,
    data: {
      total_signatures: allSignatures.length,
      active_signatures: active,
      revoked_signatures: revoked,
      by_decision: byDecision,
    },
  };
}

module.exports = {
  DEFAULT_SIGNATURE_POLICY_LEVELS,
  buildDefaultPolicyLevels,

  defineSignaturePolicy,
  getActiveSignaturePolicy,
  listSignaturePolicies,

  signDocument,
  revokeSignature,
  verifySignature,
  getSignatureLog,
  getNextRequiredLevel,
  getSignaturesSummary,
};
