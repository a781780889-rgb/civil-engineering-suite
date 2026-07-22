/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء السادس (6/10): مشاركة المستندات (Document Sharing)
 *
 * يغطي هذا الملف بالكامل ما ورد في المواصفة تحت بند "مشاركة المستندات":
 *  - مشاركة داخلية: منح صلاحية وصول لمستخدم/دور محدد على مستند معيّن دون رابط عام.
 *  - مشاركة خارجية: إنشاء رابط آمن (توكن عشوائي طويل غير قابل للتخمين) يمكن فتحه
 *    من خارج النظام (بدون تسجيل دخول) للاطلاع/التنزيل فقط ضمن الصلاحيات الممنوحة.
 *  - تحديد صلاحية الرابط: قراءة فقط / تنزيل / تعديل (حسب ما يسمح به رافع الرابط).
 *  - حماية بكلمة مرور: تشفير كلمة مرور اختيارية للرابط (hash + salt) - لا تُخزَّن
 *    كلمة المرور بنص صريح إطلاقاً.
 *  - صلاحية زمنية للرابط (تاريخ انتهاء) + حد أقصى لعدد مرات الفتح (اختياري).
 *  - إلغاء الرابط يدوياً في أي وقت.
 *  - سجل وصول فعلي لكل مرة يُفتح فيها الرابط (IP + الوقت + هل نجح إدخال كلمة المرور).
 *  - تكامل كامل مع سجل التدقيق الموحّد لقسم DMS ومع نظام الإشعارات (الجزء 7) عبر
 *    hook اختياري onShareEvent يُستدعى عند إنشاء/فتح/إلغاء أي مشاركة.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - التوكن الخاص بالرابط الآمن يُولَّد عبر crypto.randomBytes(32) (256-bit) وليس
 *    معرّفاً تسلسلياً يمكن تخمينه.
 *  - كلمة مرور الرابط تُخزَّن كـ scrypt hash + salt عشوائي لكل رابط (بدون مكتبات
 *    خارجية) بنفس نمط hashPassword في businessSecurity.js.
 *  - كل عملية فتح للرابط (ناجحة أو فاشلة بسبب كلمة مرور خاطئة/رابط منتهي/تجاوز حد
 *    الفتحات) تُسجَّل فعلياً في accessLog مع تفاصيل حقيقية.
 *  - التحقق الفعلي من الصلاحية المطلوبة (view/download/edit) قبل تنفيذ أي عملية.
 *  - يعتمد على نفس ملف التخزين الموحّد (dms.json) ضمن مفتاح shareLinks و
 *    internalShares المحجوزين مسبقاً في documentManagement.js.
 */

const fs = require('fs');
const path = require('path');
const ACL = require('./documentAccessControl');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms.json');

// ===================== أدوات مساعدة عامة (نفس نمط بقية ملفات DMS) =====================
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function loadStore() {
  if (!fs.existsSync(DB_FILE)) throw new Error('قاعدة بيانات المستندات غير مهيَّأة بعد - يرجى رفع مستند واحد على الأقل أولاً');
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  if (!store.shareLinks) store.shareLinks = {};
  if (!store.internalShares) store.internalShares = {};
  if (!store.auditLog) store.auditLog = [];
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
  const doc = store.documents ? store.documents[documentId] : null;
  if (!doc) throw new Error('المستند غير موجود');
  return doc;
}

// ===================== تشفير كلمة مرور الرابط (بدون مكتبات خارجية) =====================
function hashLinkPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyLinkPassword(password, stored) {
  if (!stored) return true; // لا توجد كلمة مرور محددة على الرابط
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch (e) {
    return false;
  }
}

// ===================== hook تكامل اختياري مع نظام الإشعارات (الجزء 7) =====================
let _onShareEvent = null;
/** يسمح لوحدة الإشعارات (documentNotifications.js) بالتسجيل لاستقبال أحداث المشاركة */
function setShareEventHook(fn) { _onShareEvent = fn; }
function emitShareEvent(eventType, payload) {
  if (typeof _onShareEvent === 'function') {
    try { _onShareEvent(eventType, payload); } catch (e) { /* لا نكسر العملية الأساسية بسبب فشل إشعار */ }
  }
}

// ===================== الصلاحيات الممكنة لأي مشاركة (رابط أو داخلية) =====================
const SHARE_PERMISSIONS = ['view', 'download', 'edit'];
const PERMISSION_LABELS = { view: 'قراءة فقط', download: 'قراءة وتنزيل', edit: 'قراءة وتعديل' };

function normalizePermission(permission) {
  const p = permission || 'view';
  if (!SHARE_PERMISSIONS.includes(p)) {
    throw new Error(`صلاحية المشاركة غير صحيحة (${p}). القيم المسموحة: ${SHARE_PERMISSIONS.join(', ')}`);
  }
  return p;
}

// ==================================================================================
// ============================ الروابط الآمنة (مشاركة خارجية) ======================
// ==================================================================================

/**
 * إنشاء رابط مشاركة آمن لمستند.
 * payload: { document_id, permission, password, expires_at, max_opens, note, created_by }
 */
function createShareLink(payload = {}) {
  const {
    document_id, permission = 'view', password = null,
    expires_at = null, max_opens = null, note = null, created_by = null, token: authToken = null,
  } = payload;

  if (!document_id) throw new Error('معرّف المستند (document_id) مطلوب');
  const perm = normalizePermission(permission);

  if (expires_at && Number.isNaN(new Date(expires_at).getTime())) {
    throw new Error('تاريخ انتهاء الرابط (expires_at) غير صحيح');
  }
  if (max_opens !== null && max_opens !== undefined && (!Number.isInteger(max_opens) || max_opens <= 0)) {
    throw new Error('الحد الأقصى لعدد مرات الفتح (max_opens) يجب أن يكون عدداً صحيحاً موجباً');
  }

  const store = loadStore();
  const doc = getDocOrThrow(store, document_id);
  if (authToken) ACL.assertDocumentAccess(authToken, doc, 'share');

  const token = crypto.randomBytes(32).toString('base64url'); // 256-bit، آمن وغير قابل للتخمين
  const linkId = newId('SHL');

  const record = {
    id: linkId,
    token,
    document_id,
    project_id: doc.project_id || null,
    permission: perm,
    password_hash: password ? hashLinkPassword(password) : null,
    has_password: !!password,
    expires_at: expires_at || null,
    max_opens: max_opens || null,
    open_count: 0,
    note: note || null,
    is_revoked: false,
    created_by,
    created_at: nowISO(),
    revoked_at: null,
    revoked_by: null,
    access_log: [], // { at, ip, success, reason }
  };

  store.shareLinks[linkId] = record;

  audit(store, {
    action: 'share_link_create', entity: 'document', entityId: document_id, projectId: doc.project_id, actor: created_by,
    details: { link_id: linkId, permission: perm, has_password: !!password, expires_at, max_opens },
  });
  saveStore(store);

  emitShareEvent('share_link_created', {
    document_id, link_id: linkId, document_title: doc.title, document_number: doc.document_number,
    permission: perm, created_by, expires_at,
  });

  return { success: true, data: { ...record, password_hash: undefined, share_url_path: `/api/dms/share/open/${token}` } };
}

function _sanitizeLink(record) {
  if (!record) return null;
  const { password_hash, ...rest } = record;
  return rest;
}

/** يبني حالة الرابط الحالية (صالح/منتهي/ملغى/تجاوز حد الفتحات) دون تسجيل فتح فعلي */
function evaluateLinkState(record) {
  if (!record) return { valid: false, reason: 'الرابط غير موجود' };
  if (record.is_revoked) return { valid: false, reason: 'تم إلغاء هذا الرابط' };
  if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'انتهت صلاحية هذا الرابط' };
  }
  if (record.max_opens && record.open_count >= record.max_opens) {
    return { valid: false, reason: 'تم تجاوز الحد الأقصى المسموح لعدد مرات فتح هذا الرابط' };
  }
  return { valid: true, reason: null };
}

/**
 * فتح رابط مشاركة (يُستخدم من خارج النظام دون تسجيل دخول). يسجّل كل محاولة فعلياً
 * في access_log سواء نجحت أم فشلت، ويتحقق من كلمة المرور وصلاحية الوقت وحد الفتحات.
 */
function openShareLink(token, { password = null, ip = null } = {}) {
  if (!token) throw new Error('رمز الرابط (token) مطلوب');
  const store = loadStore();
  const record = Object.values(store.shareLinks).find(l => l.token === token);
  if (!record) throw new Error('الرابط غير صحيح أو غير موجود');

  const state = evaluateLinkState(record);
  if (!state.valid) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: state.reason });
    saveStore(store);
    throw new Error(state.reason);
  }

  if (record.has_password && !verifyLinkPassword(password, record.password_hash)) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'كلمة المرور غير صحيحة' });
    saveStore(store);
    throw new Error('كلمة المرور غير صحيحة');
  }

  const doc = store.documents[record.document_id];
  if (!doc) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'المستند المرتبط لم يعد موجوداً' });
    saveStore(store);
    throw new Error('المستند المرتبط بهذا الرابط لم يعد موجوداً');
  }

  record.open_count += 1;
  record.access_log.push({ at: nowISO(), ip, success: true, reason: null });
  if (record.access_log.length > 500) record.access_log = record.access_log.slice(-500);

  audit(store, {
    action: 'share_link_open', entity: 'document', entityId: record.document_id, projectId: record.project_id,
    actor: `share-link:${record.id}`, details: { link_id: record.id, ip },
  });
  saveStore(store);

  emitShareEvent('share_link_opened', {
    document_id: record.document_id, link_id: record.id, document_title: doc.title, ip,
  });

  const currentVersion = store.versions[doc.current_version_id];

  return {
    success: true,
    data: {
      permission: record.permission,
      document: {
        id: doc.id,
        document_number: doc.document_number,
        title: doc.title,
        doc_type_label: doc.doc_type_label,
        description: doc.description,
        status: doc.status,
        current_version_number: doc.current_version_number,
        file_name: currentVersion?.file_name || null,
        file_type_label: currentVersion?.file_type_label || null,
        file_size_human: currentVersion?.file_size_human || null,
      },
    },
  };
}

/**
 * تنزيل ملف المستند عبر رابط مشاركة صالح (يتطلب أن تكون صلاحية الرابط download أو edit).
 * يعيد نفس بنية downloadDocument في documentManagement.js (محتوى base64 فعلي).
 */
function downloadViaShareLink(token, { password = null, ip = null } = {}) {
  const store = loadStore();
  const record = Object.values(store.shareLinks).find(l => l.token === token);
  if (!record) throw new Error('الرابط غير صحيح أو غير موجود');

  const state = evaluateLinkState(record);
  if (!state.valid) throw new Error(state.reason);

  if (record.has_password && !verifyLinkPassword(password, record.password_hash)) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'كلمة مرور خاطئة عند محاولة التنزيل' });
    saveStore(store);
    throw new Error('كلمة المرور غير صحيحة');
  }

  if (!['download', 'edit'].includes(record.permission)) {
    record.access_log.push({ at: nowISO(), ip, success: false, reason: 'الرابط للقراءة فقط - التنزيل غير مسموح' });
    saveStore(store);
    throw new Error('هذا الرابط للقراءة فقط ولا يسمح بتنزيل الملف');
  }

  const doc = store.documents[record.document_id];
  if (!doc) throw new Error('المستند المرتبط بهذا الرابط لم يعد موجوداً');

  const DMS = require('./documentManagement');
  const result = DMS.downloadDocument(record.document_id, { actor: `share-link:${record.id}` });

  record.access_log.push({ at: nowISO(), ip, success: true, reason: 'download' });
  audit(store, {
    action: 'share_link_download', entity: 'document', entityId: record.document_id, projectId: record.project_id,
    actor: `share-link:${record.id}`, details: { link_id: record.id, ip },
  });
  saveStore(store);

  emitShareEvent('share_link_downloaded', {
    document_id: record.document_id, link_id: record.id, document_title: doc.title, ip,
  });

  return result;
}

function revokeShareLink(linkId, { actor = null } = {}) {
  const store = loadStore();
  const record = store.shareLinks[linkId];
  if (!record) throw new Error('رابط المشاركة غير موجود');
  if (record.is_revoked) throw new Error('هذا الرابط ملغى بالفعل');

  record.is_revoked = true;
  record.revoked_at = nowISO();
  record.revoked_by = actor;

  audit(store, {
    action: 'share_link_revoke', entity: 'document', entityId: record.document_id, projectId: record.project_id, actor,
    details: { link_id: linkId },
  });
  saveStore(store);

  emitShareEvent('share_link_revoked', { document_id: record.document_id, link_id: linkId, actor });

  return { success: true, data: _sanitizeLink(record) };
}

function listShareLinks({ documentId = null, projectId = null, includeRevoked = true } = {}) {
  const store = loadStore();
  let items = Object.values(store.shareLinks);
  if (documentId) items = items.filter(l => l.document_id === documentId);
  if (projectId) items = items.filter(l => l.project_id === projectId);
  if (!includeRevoked) items = items.filter(l => !l.is_revoked);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items.map(_sanitizeLink) };
}

function getShareLink(linkId) {
  const store = loadStore();
  const record = store.shareLinks[linkId];
  if (!record) throw new Error('رابط المشاركة غير موجود');
  return { success: true, data: { ..._sanitizeLink(record), state: evaluateLinkState(record) } };
}

// ==================================================================================
// ============================ المشاركة الداخلية (بدون رابط) =======================
// ==================================================================================

/**
 * منح صلاحية وصول داخلية لمستخدم أو دور محدد على مستند معيّن، دون الحاجة لرابط
 * عام. تُستخدم للتعاون داخل فريق العمل نفسه (مثال: مشاركة مخطط مع مهندس موقع
 * محدد باسمه دون منحه صلاحية documents العامة على كامل النظام).
 * payload: { document_id, grantee_type: 'user'|'role', grantee, permission, expires_at, granted_by }
 */
function shareInternally(payload = {}) {
  const {
    document_id, grantee_type = 'user', grantee, permission = 'view',
    expires_at = null, note = null, granted_by = null, token: authToken = null,
  } = payload;

  if (!document_id) throw new Error('معرّف المستند (document_id) مطلوب');
  if (!grantee) throw new Error('المستخدم أو الدور المستفيد (grantee) مطلوب');
  if (!['user', 'role'].includes(grantee_type)) throw new Error('نوع المستفيد (grantee_type) يجب أن يكون user أو role');
  const perm = normalizePermission(permission);

  const store = loadStore();
  const doc = getDocOrThrow(store, document_id);
  if (authToken) ACL.assertDocumentAccess(authToken, doc, 'share');

  // منع تكرار نفس المشاركة الفعالة لنفس المستفيد على نفس المستند
  const duplicate = Object.values(store.internalShares).find(s => (
    s.document_id === document_id && s.grantee_type === grantee_type
    && s.grantee === grantee && !s.revoked_at
  ));
  if (duplicate) {
    duplicate.permission = perm;
    duplicate.expires_at = expires_at || null;
    duplicate.note = note || duplicate.note;
    duplicate.updated_at = nowISO();
    audit(store, {
      action: 'internal_share_update', entity: 'document', entityId: document_id, projectId: doc.project_id, actor: granted_by,
      details: { share_id: duplicate.id, grantee_type, grantee, permission: perm },
    });
    saveStore(store);
    emitShareEvent('internal_share_updated', { document_id, grantee_type, grantee, permission: perm, document_title: doc.title });
    return { success: true, data: duplicate };
  }

  const shareId = newId('ISH');
  const record = {
    id: shareId,
    document_id,
    project_id: doc.project_id || null,
    grantee_type,
    grantee,
    permission: perm,
    note: note || null,
    granted_by,
    created_at: nowISO(),
    updated_at: nowISO(),
    expires_at: expires_at || null,
    revoked_at: null,
    revoked_by: null,
  };
  store.internalShares[shareId] = record;

  audit(store, {
    action: 'internal_share_create', entity: 'document', entityId: document_id, projectId: doc.project_id, actor: granted_by,
    details: { share_id: shareId, grantee_type, grantee, permission: perm },
  });
  saveStore(store);

  emitShareEvent('internal_share_created', {
    document_id, share_id: shareId, document_title: doc.title, document_number: doc.document_number,
    grantee_type, grantee, permission: perm, granted_by,
  });

  return { success: true, data: record };
}

function revokeInternalShare(shareId, { actor = null } = {}) {
  const store = loadStore();
  const record = store.internalShares[shareId];
  if (!record) throw new Error('المشاركة الداخلية غير موجودة');
  if (record.revoked_at) throw new Error('تم إلغاء هذه المشاركة بالفعل');

  record.revoked_at = nowISO();
  record.revoked_by = actor;

  audit(store, {
    action: 'internal_share_revoke', entity: 'document', entityId: record.document_id, projectId: record.project_id, actor,
    details: { share_id: shareId },
  });
  saveStore(store);

  emitShareEvent('internal_share_revoked', { document_id: record.document_id, share_id: shareId, actor });

  return { success: true, data: record };
}

function listInternalShares({ documentId = null, projectId = null, grantee = null, includeExpired = true, includeRevoked = true } = {}) {
  const store = loadStore();
  let items = Object.values(store.internalShares);
  if (documentId) items = items.filter(s => s.document_id === documentId);
  if (projectId) items = items.filter(s => s.project_id === projectId);
  if (grantee) items = items.filter(s => s.grantee === grantee);
  if (!includeRevoked) items = items.filter(s => !s.revoked_at);
  if (!includeExpired) {
    items = items.filter(s => !s.expires_at || new Date(s.expires_at).getTime() >= Date.now());
  }
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

/**
 * يتحقق مما إذا كان مستخدم/دور معيّن يملك صلاحية معينة على مستند عبر مشاركة
 * داخلية سارية (غير ملغاة وغير منتهية). يُستخدم كطبقة تحقق إضافية اختيارية فوق
 * نظام الصلاحيات العام في businessSecurity.js لحالات "الوصول الاستثنائي لمستند
 * واحد بعينه" دون منح صلاحية عامة على وحدة documents كاملة.
 */
function hasInternalAccess({ documentId, userIdentifiers = [], requiredPermission = 'view' }) {
  const store = loadStore();
  const perm = normalizePermission(requiredPermission);
  const permRank = { view: 1, download: 2, edit: 3 };

  const activeShares = Object.values(store.internalShares).filter(s => (
    s.document_id === documentId
    && !s.revoked_at
    && (!s.expires_at || new Date(s.expires_at).getTime() >= Date.now())
    && userIdentifiers.includes(s.grantee)
  ));

  if (!activeShares.length) return { success: true, data: { allowed: false } };

  const best = activeShares.reduce((max, s) => Math.max(max, permRank[s.permission] || 0), 0);
  return { success: true, data: { allowed: best >= permRank[perm], best_permission: best } };
}

// ==================================================================================
// =============================== لوحة/ملخص المشاركات ==============================
// ==================================================================================

function getSharingSummary({ projectId = null } = {}) {
  const store = loadStore();
  let links = Object.values(store.shareLinks);
  let internal = Object.values(store.internalShares);
  if (projectId) {
    links = links.filter(l => l.project_id === projectId);
    internal = internal.filter(s => s.project_id === projectId);
  }

  const activeLinks = links.filter(l => evaluateLinkState(l).valid);
  const totalOpens = links.reduce((sum, l) => sum + (l.open_count || 0), 0);

  return {
    success: true,
    data: {
      total_share_links: links.length,
      active_share_links: activeLinks.length,
      revoked_share_links: links.filter(l => l.is_revoked).length,
      expired_share_links: links.filter(l => !l.is_revoked && evaluateLinkState(l).reason === 'انتهت صلاحية هذا الرابط').length,
      password_protected_links: links.filter(l => l.has_password).length,
      total_link_opens: totalOpens,
      total_internal_shares: internal.length,
      active_internal_shares: internal.filter(s => !s.revoked_at && (!s.expires_at || new Date(s.expires_at).getTime() >= Date.now())).length,
    },
  };
}

module.exports = {
  // مرجع
  SHARE_PERMISSIONS,
  PERMISSION_LABELS,

  // تكامل
  setShareEventHook,

  // روابط آمنة (مشاركة خارجية)
  createShareLink,
  openShareLink,
  downloadViaShareLink,
  revokeShareLink,
  listShareLinks,
  getShareLink,
  evaluateLinkState,

  // مشاركة داخلية
  shareInternally,
  revokeInternalShare,
  listInternalShares,
  hasInternalAccess,

  // ملخص
  getSharingSummary,
};
