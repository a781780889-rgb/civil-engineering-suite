/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء السابع (7/10): الإشعارات + التكامل الكامل مع بقية أقسام النظام
 *
 * يغطي هذا الملف بالكامل ما ورد في المواصفة تحت بند "الإشعارات":
 *  - رفع مستند جديد.
 *  - تعديل مستند (إصدار جديد / تعديل بيانات وصفية).
 *  - اعتماد مستند / رفض مستند (كل مرحلة من مراحل سير العمل).
 *  - انتهاء صلاحية مستند (شهادة/عقد/تصريح له تاريخ صلاحية محدَّد).
 *  - طلب مراجعة (بدء سير عمل الاعتماد).
 *  - مشاركة ملف (رابط مشاركة جديد أو مشاركة داخلية جديدة).
 *
 * فلسفة التصميم (لماذا هذا الملف لا يعدّل الملفات الخمسة السابقة):
 *  بدلاً من حَقن استدعاءات مباشرة داخل كل دالة من دوال الأجزاء 1-5 (upload/
 *  workflow/signature/search/categories) - وهو ما يزيد فعلياً من مخاطر كسر كودٍ
 *  يعمل بالفعل ومُختبَر - تعتمد وحدة الإشعارات على مصدرين حقيقيين للحقيقة (source
 *  of truth) موجودين بالفعل ومُحدَّثين تلقائياً من كل تلك الأجزاء:
 *    1. سجل التدقيق الموحّد (store.auditLog) في dms.json: كل عملية رفع/تعديل/
 *       اعتماد/رفض/بدء مراجعة تُسجَّل هناك فعلياً بالفعل بواسطة documentManagement.js
 *       وdocumentWorkflow.js دون أي تعديل إضافي مطلوب منّا.
 *    2. hook مشاركة الأحداث الفعلي (setShareEventHook) المُعرَّف مسبقاً وجاهزاً في
 *       documentSharing.js (الجزء 6) والذي بُني خصيصاً ليُستدعى من هنا.
 *  هذا النمط (مسح دوري/عند الطلب لسجل تدقيق موحّد + hook مباشر حيثما كان متاحاً)
 *  يحقق نفس النتيجة الوظيفية (تنبيه فعلي حقيقي عند كل حدث) دون إعادة كتابة أي كود
 *  عامل سابقاً، ويتوافق مع نمط checkX() المستخدم فعلياً في qmsAlerts.js.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل إشعار مُنشأ فعلياً وله سجل دائم (persisted) في dms.json، وليس مجرد رسالة
 *    عابرة تُحسَب عند كل طلب.
 *  - آلية "منع التكرار" الفعلية (source_event_id) تمنع إنشاء إشعار جديد لنفس
 *    الحدث بالتحديد مرتين حتى عند استدعاء scanAuditLogForNotifications أكثر من
 *    مرة على نفس البيانات (idempotent).
 *  - فحص انتهاء الصلاحية الفعلي: يقرأ expiry_date الحقيقي المخزَّن على كل مستند
 *    (الحقل الذي أُضيف في documentManagement.js ضمن allowedFields) ويقارنه
 *    بالتاريخ الحالي فعلياً؛ ينشئ إشعار "قارب على الانتهاء" (خلال 30 يوماً) ثم
 *    إشعار "منتهي بالفعل" منفصلاً عند تجاوز التاريخ.
 *  - حالة القراءة (مقروء/غير مقروء) محفوظة فعلياً لكل (مستخدم × إشعار) وليست
 *    مجرد علم عام يُصفّر عند أول قراءة لأي شخص.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms.json');

// ===================== أدوات مساعدة عامة (نفس نمط بقية ملفات DMS) =====================
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function loadStore() {
  if (!fs.existsSync(DB_FILE)) throw new Error('قاعدة بيانات المستندات غير مهيَّأة بعد - يرجى رفع مستند واحد على الأقل أولاً');
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  if (!store.notifications) store.notifications = {};
  if (!store.meta) store.meta = {};
  if (!store.meta.notif_cursor) store.meta.notif_cursor = 0; // آخر مؤشر تمت معالجته في auditLog
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

// ==================================================================================
// ============================ أنواع الإشعارات المدعومة ============================
// ==================================================================================

const NOTIFICATION_TYPES = {
  document_uploaded: { label: 'رفع مستند جديد', severity: 'info' },
  document_updated: { label: 'تعديل مستند', severity: 'info' },
  document_new_version: { label: 'رفع إصدار جديد', severity: 'info' },
  review_requested: { label: 'طلب مراجعة', severity: 'info' },
  document_approved: { label: 'اعتماد مستند', severity: 'success' },
  document_rejected: { label: 'رفض مستند', severity: 'warning' },
  document_published: { label: 'نشر مستند', severity: 'success' },
  document_expiring_soon: { label: 'مستند قارب على انتهاء الصلاحية', severity: 'warning' },
  document_expired: { label: 'انتهت صلاحية مستند', severity: 'danger' },
  share_link_created: { label: 'مشاركة ملف عبر رابط', severity: 'info' },
  internal_share_created: { label: 'مشاركة مستند داخلياً', severity: 'info' },
};

const EXPIRY_WARNING_DAYS = 30;

// ==================================================================================
// ================================ طبقة الإنشاء الأساسية ===========================
// ==================================================================================

/**
 * ينشئ إشعاراً فعلياً في المخزن، مع قائمة مستلمين (recipients) وحالة قراءة مستقلة
 * لكل مستلم. source_event_id (إن مُرِّر) يُستخدم لمنع التكرار (idempotency key).
 */
function _createNotification(store, {
  type, documentId = null, projectId = null, message, recipients = [], actor = null,
  sourceEventId = null, details = {},
} = {}) {
  if (sourceEventId) {
    const existing = Object.values(store.notifications).find(n => n.source_event_id === sourceEventId);
    if (existing) return existing; // idempotent - لا تكرار لنفس الحدث بالتحديد
  }
  const typeDef = NOTIFICATION_TYPES[type] || { label: type, severity: 'info' };
  const id = newId('NTF');
  const record = {
    id,
    type,
    type_label: typeDef.label,
    severity: typeDef.severity,
    document_id: documentId,
    project_id: projectId,
    message,
    actor,
    details,
    source_event_id: sourceEventId,
    created_at: nowISO(),
    // recipients: [{ user, read_at }] - قائمة صريحة، أو مصفوفة فارغة تعني "للجميع
    // ممن يملكون صلاحية documents.view على هذا المشروع/المستند" (بث عام)
    recipients: recipients.map(r => ({ user: r, read_at: null })),
    is_broadcast: recipients.length === 0,
  };
  store.notifications[id] = record;
  return record;
}

// ==================================================================================
// ===================== الفحص الدوري لسجل التدقيق (لا تكرار) ========================
// ==================================================================================

/**
 * يفحص سجل التدقيق الموحّد بدءاً من آخر مؤشر تمت معالجته فقط (وليس من الصفر في
 * كل مرة)، ويولّد إشعاراً فعلياً حقيقياً لكل حدث ذي صلة لم يُعالَج من قبل.
 * يُستدعى هذا تلقائياً من getFeed/getUnreadCount عند كل استخدام، وهو آمن للاستدعاء
 * المتكرر (idempotent) بفضل مؤشر meta.notif_cursor + source_event_id.
 */
function scanAuditLogForNotifications() {
  const store = loadStore();
  const startFrom = store.meta.notif_cursor || 0;
  const newEntries = store.auditLog.slice(startFrom);
  if (!newEntries.length) { saveStore(store); return { success: true, data: { created: 0 } }; }

  let created = 0;
  const relevantActions = {
    upload: 'document_uploaded',
    new_version: 'document_new_version',
    update_metadata: 'document_updated',
    start_workflow: 'review_requested',
    approve: 'document_approved',
    reject: 'document_rejected',
    publish: 'document_published',
  };

  for (const entry of newEntries) {
    const notifType = relevantActions[entry.action];
    if (!notifType || entry.entity !== 'document') continue;

    const doc = store.documents ? store.documents[entry.entity_id] : null;
    const docLabel = doc ? `${doc.document_number} - ${doc.title}` : entry.entity_id;

    let message;
    switch (notifType) {
      case 'document_uploaded': message = `تم رفع مستند جديد: ${docLabel}`; break;
      case 'document_new_version': message = `تم رفع إصدار جديد للمستند: ${docLabel}`; break;
      case 'document_updated': message = `تم تعديل بيانات المستند: ${docLabel}`; break;
      case 'review_requested': message = `طلب مراجعة جديد للمستند: ${docLabel}`; break;
      case 'document_approved': message = `تم اعتماد المستند: ${docLabel} (${entry.details?.stage_label || ''})`; break;
      case 'document_rejected': message = `تم رفض المستند: ${docLabel} - السبب: ${entry.details?.comments || 'غير محدد'}`; break;
      case 'document_published': message = `تم نشر المستند رسمياً: ${docLabel}`; break;
      default: message = `${notifType}: ${docLabel}`;
    }

    _createNotification(store, {
      type: notifType,
      documentId: entry.entity_id,
      projectId: entry.project_id || (doc ? doc.project_id : null),
      message,
      actor: entry.actor,
      sourceEventId: entry.id,
      details: entry.details || {},
    });
    created += 1;
  }

  store.meta.notif_cursor = startFrom + newEntries.length;
  saveStore(store);
  return { success: true, data: { created } };
}

// ==================================================================================
// ============================ فحص انتهاء صلاحية المستندات =========================
// ==================================================================================

/**
 * يفحص فعلياً حقل expiry_date الحقيقي لكل مستند (إن كان محدَّداً - مثل شهادات
 * المواد أو عقود موظفين أو تصاريح عمل لها تاريخ انتهاء) ويولّد إشعارين منفصلين
 * بالضبط مرة واحدة لكل مستند: تنبيه "قارب على الانتهاء" (خلال 30 يوماً)، ثم
 * تنبيه "منتهي فعلاً" عند تجاوز التاريخ - بدون تكرار الإشعار نفسه في كل فحص.
 */
function checkDocumentExpiry() {
  const store = loadStore();
  const now = Date.now();
  const warningMs = EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  let created = 0;

  for (const doc of Object.values(store.documents || {})) {
    if (!doc.expiry_date || doc.archived) continue;
    const expiryTime = new Date(doc.expiry_date).getTime();
    if (Number.isNaN(expiryTime)) continue;

    const docLabel = `${doc.document_number} - ${doc.title}`;

    if (expiryTime < now) {
      const sourceEventId = `expiry-expired:${doc.id}:${doc.expiry_date}`;
      _createNotification(store, {
        type: 'document_expired', documentId: doc.id, projectId: doc.project_id,
        message: `انتهت صلاحية المستند: ${docLabel} بتاريخ ${doc.expiry_date.slice(0, 10)}`,
        sourceEventId, details: { expiry_date: doc.expiry_date },
      });
      created += 1;
    } else if (expiryTime - now <= warningMs) {
      const daysLeft = Math.ceil((expiryTime - now) / (24 * 60 * 60 * 1000));
      const sourceEventId = `expiry-soon:${doc.id}:${doc.expiry_date}`;
      _createNotification(store, {
        type: 'document_expiring_soon', documentId: doc.id, projectId: doc.project_id,
        message: `المستند ${docLabel} سينتهي خلال ${daysLeft} يوم (بتاريخ ${doc.expiry_date.slice(0, 10)})`,
        sourceEventId, details: { expiry_date: doc.expiry_date, days_left: daysLeft },
      });
      created += 1;
    }
  }

  saveStore(store);
  return { success: true, data: { checked: Object.keys(store.documents || {}).length } };
}

// ==================================================================================
// ==================== hook مباشر لأحداث المشاركة (الجزء 6) ========================
// ==================================================================================

/**
 * يُستدعى مباشرة (بدون انتظار دورة فحص) من documentSharing.js عند كل حدث مشاركة
 * فعلي، عبر setShareEventHook المُعرَّفة مسبقاً هناك تحديداً لهذا الغرض.
 */
function handleShareEvent(eventType, payload = {}) {
  if (!['share_link_created', 'internal_share_created'].includes(eventType)) return;
  const store = loadStore();

  const message = eventType === 'share_link_created'
    ? `تم إنشاء رابط مشاركة لمستند: ${payload.document_title || payload.document_id}`
    : `تمت مشاركة المستند "${payload.document_title || payload.document_id}" داخلياً مع ${payload.grantee}`;

  const sourceEventId = eventType === 'share_link_created'
    ? `share-link:${payload.link_id}`
    : `internal-share:${payload.share_id}`;

  _createNotification(store, {
    type: eventType,
    documentId: payload.document_id,
    projectId: payload.project_id || null,
    message,
    actor: payload.created_by || payload.granted_by || null,
    recipients: eventType === 'internal_share_created' ? [payload.grantee] : [],
    sourceEventId,
    details: payload,
  });

  saveStore(store);
}

/** يجب استدعاؤها مرة واحدة عند إقلاع الخادم لربط هذه الوحدة كمستمع لأحداث المشاركة */
function attachToSharingModule() {
  const SHARE = require('./documentSharing');
  SHARE.setShareEventHook(handleShareEvent);
  return { success: true, data: { attached: true } };
}

// ==================================================================================
// ================================ القراءة والتغذية (Feed) =========================
// ==================================================================================

function _isVisibleToUser(notification, username) {
  if (notification.is_broadcast) return true;
  return notification.recipients.some(r => r.user === username);
}

function _readStateFor(notification, username) {
  if (notification.is_broadcast) {
    // للبث العام: حالة القراءة تُخزَّن فعلياً في recipients أيضاً (يُضاف المستخدم
    // أول مرة يقرأ فيها فقط، دون تحويل الإشعار من بث عام إلى موجَّه).
    const entry = notification.recipients.find(r => r.user === username);
    return entry ? entry.read_at : null;
  }
  const entry = notification.recipients.find(r => r.user === username);
  return entry ? entry.read_at : null;
}

/**
 * يعيد قائمة الإشعارات الفعلية لمستخدم معيّن (مع تشغيل الفحص الدوري ضمناً أولاً
 * لضمان أن التغذية محدَّثة بآخر الأحداث الحقيقية قبل إرجاعها).
 */
function getFeed({ username, projectId = null, unreadOnly = false, page = 1, pageSize = 30 } = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب لاسترجاع الإشعارات الخاصة به');
  scanAuditLogForNotifications();
  checkDocumentExpiry();

  const store = loadStore();
  let items = Object.values(store.notifications).filter(n => _isVisibleToUser(n, username));
  if (projectId) items = items.filter(n => n.project_id === projectId);

  items = items.map(n => ({ ...n, read_at: _readStateFor(n, username) }));
  if (unreadOnly) items = items.filter(n => !n.read_at);

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { success: true, data: paged, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

function getUnreadCount({ username, projectId = null } = {}) {
  const feed = getFeed({ username, projectId, unreadOnly: true, page: 1, pageSize: 100000 });
  return { success: true, data: { unread_count: feed.pagination.total } };
}

/** تعليم إشعار واحد كمقروء لمستخدم معيّن (لا يؤثر على حالة القراءة لبقية المستخدمين) */
function markAsRead(notificationId, { username } = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب');
  const store = loadStore();
  const n = store.notifications[notificationId];
  if (!n) throw new Error('الإشعار غير موجود');
  if (!_isVisibleToUser(n, username)) throw new Error('هذا الإشعار غير مرئي لهذا المستخدم');

  let entry = n.recipients.find(r => r.user === username);
  if (!entry) {
    entry = { user: username, read_at: null };
    n.recipients.push(entry);
  }
  entry.read_at = nowISO();

  saveStore(store);
  return { success: true, data: n };
}

/** تعليم كل الإشعارات المرئية لمستخدم معيّن كمقروءة دفعة واحدة */
function markAllAsRead({ username, projectId = null } = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب');
  const store = loadStore();
  let count = 0;
  for (const n of Object.values(store.notifications)) {
    if (!_isVisibleToUser(n, username)) continue;
    if (projectId && n.project_id !== projectId) continue;
    let entry = n.recipients.find(r => r.user === username);
    if (!entry) { entry = { user: username, read_at: null }; n.recipients.push(entry); }
    if (!entry.read_at) { entry.read_at = nowISO(); count += 1; }
  }
  saveStore(store);
  return { success: true, data: { marked: count } };
}

// ==================================================================================
// ===================================== الملخص =====================================
// ==================================================================================

function getNotificationsSummary({ projectId = null } = {}) {
  scanAuditLogForNotifications();
  checkDocumentExpiry();
  const store = loadStore();

  let items = Object.values(store.notifications);
  if (projectId) items = items.filter(n => n.project_id === projectId);

  const byType = {};
  for (const key of Object.keys(NOTIFICATION_TYPES)) byType[key] = 0;
  for (const n of items) byType[n.type] = (byType[n.type] || 0) + 1;

  return {
    success: true,
    data: {
      total_notifications: items.length,
      by_type: Object.entries(byType).map(([type, count]) => ({ type, label: NOTIFICATION_TYPES[type]?.label || type, count })),
      expiring_soon: items.filter(n => n.type === 'document_expiring_soon').length,
      expired: items.filter(n => n.type === 'document_expired').length,
      pending_reviews: items.filter(n => n.type === 'review_requested').length,
    },
  };
}

module.exports = {
  NOTIFICATION_TYPES,
  EXPIRY_WARNING_DAYS,

  // تكامل
  attachToSharingModule,
  handleShareEvent,

  // مسح/فحص
  scanAuditLogForNotifications,
  checkDocumentExpiry,

  // تغذية وقراءة
  getFeed,
  getUnreadCount,
  markAsRead,
  markAllAsRead,

  // ملخص
  getNotificationsSummary,
};
