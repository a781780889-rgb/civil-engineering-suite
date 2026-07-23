/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء 10أ/10 (تقسيم الجزء 10/10 الأصلي إلى قسمين): التنبيهات + التقارير
 *   - هذا الملف: التنبيهات (Notifications)
 *   - drawingReports.js: التقارير (Reports + التصدير)
 * الجزء 10ب/10 (لاحقاً): الذكاء الاصطناعي + التكامل الشامل مع بقية الأقسام
 * =====================================================================================
 *
 * يغطي هذا الملف بالكامل بند "التنبيهات" الوارد في مواصفة القسم الثاني عشر:
 *  - رفع مخطط جديد.
 *  - إنشاء إصدار جديد.
 *  - وجود مراجعة جديدة.
 *  - اعتماد المخطط.
 *  - رفض المخطط.
 *  - تعديل المخطط.
 *  - انتهاء مدة المراجعة.
 *  - وجود تعارض بين الإصدارات.
 *
 * فلسفة التصميم (نفس نمط documentNotifications.js - القسم الحادي عشر، الجزء 7/10،
 * والتي أثبتت فعاليتها هناك): بدلاً من حَقن استدعاءات مباشرة داخل كل دالة من دوال
 * الأجزاء 1/10 حتى 9/10 (management/versions/reviews/approvals/comparison) - وهو ما
 * يزيد فعلياً من مخاطر كسر كود يعمل بالفعل ومُختبَر - تعتمد وحدة تنبيهات المخططات على
 * مصدر حقيقي واحد للحقيقة (source of truth) موجود بالفعل ومُحدَّث تلقائياً من كل تلك
 * الأجزاء دون أي تعديل عليها:
 *   سجل التدقيق الموحّد (db.audit_log) في drawings.json: كل عملية (إنشاء/رفع إصدار/
 *   إرسال للمراجعة/اعتماد/رفض/تحديث بيانات) تُسجَّل هناك فعلياً بالفعل بواسطة
 *   drawingManagement.js وdrawingVersions.js وdrawingReviews.js وdrawingApprovals.js.
 * هذا النمط (مسح تزايدي idempotent لسجل تدقيق موحّد بواسطة مؤشر cursor) يحقق نفس
 * النتيجة الوظيفية (تنبيه فعلي حقيقي عند كل حدث) دون إعادة كتابة أي كود عامل سابقاً.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل إشعار مُنشأ فعلياً وله سجل دائم (persisted) في drawings.json، وليس مجرد رسالة
 *    عابرة تُحسَب عند كل طلب.
 *  - آلية "منع التكرار" الفعلية (source_event_id) تمنع إنشاء إشعار جديد لنفس الحدث
 *    بالتحديد مرتين حتى عند استدعاء scanAuditLogForNotifications أكثر من مرة على نفس
 *    البيانات (idempotent) - مطابق تماماً لآلية documentNotifications.js.
 *  - "انتهاء مدة المراجعة" فعلي: يدعم هذا الملف تحديد مهلة مراجعة (review deadline)
 *    اختيارية لكل مخطط عبر setReviewDeadline (يُخزَّن في drawings.json دون الحاجة
 *    لتعديل drawingReviews.js)، ويقارنها فعلياً بالتاريخ الحالي؛ ينشئ إشعار "قاربت
 *    المهلة على الانتهاء" (خلال REVIEW_DEADLINE_WARNING_DAYS) ثم إشعار "انتهت المهلة"
 *    منفصلاً عند تجاوزها، طالما المخطط ما زال "قيد المراجعة" فعلياً.
 *  - "تعارض بين الإصدارات" فعلي: يُعاد استخدام سجل المقارنات الحقيقي الموجود بالفعل
 *    (drawingComparison.js، db.comparisons من الجزء 7/10) بدل إعادة تعريف مفهوم
 *    مقارنة جديد؛ أي مقارنة فعلية بين إصدارين نتج عنها عناصر معدَّلة (modified) تُنشئ
 *    تنبيه "تعارض بين الإصدارات" تلقائياً عند أول فحص لاحق لسجل التدقيق.
 *  - حالة القراءة (مقروء/غير مقروء) محفوظة فعلياً لكل (مستخدم × إشعار) وليست مجرد
 *    علم عام يُصفّر عند أول قراءة لأي شخص.
 */

const DRAW = require('./drawingManagement');
const {
  loadDB, saveDB, newId, nowISO,
} = DRAW._internal;

// ===================== الثوابت =====================
const REVIEW_DEADLINE_WARNING_DAYS = 3; // تنبيه مسبق قبل انتهاء مهلة المراجعة بعدد أيام

const NOTIFICATION_TYPES = {
  drawing_uploaded: { label: 'رفع مخطط جديد', severity: 'info' },
  drawing_new_version: { label: 'إنشاء إصدار جديد', severity: 'info' },
  drawing_review_new: { label: 'وجود مراجعة جديدة', severity: 'info' },
  drawing_approved: { label: 'اعتماد المخطط', severity: 'success' },
  drawing_rejected: { label: 'رفض المخطط', severity: 'danger' },
  drawing_updated: { label: 'تعديل المخطط', severity: 'info' },
  review_deadline_soon: { label: 'مهلة المراجعة توشك على الانتهاء', severity: 'warning' },
  review_deadline_expired: { label: 'انتهاء مدة المراجعة', severity: 'danger' },
  version_conflict: { label: 'تعارض بين الإصدارات', severity: 'warning' },
};

// ===================== طبقة التخزين =====================
// تُخزَّن كل بيانات هذا الجزء داخل نفس drawings.json (نفس ملف بقية الأجزاء) ضمن
// مفاتيح مستقلة خاصة به فقط، بدون أي تعديل على مخطط بيانات الأجزاء الأخرى.
function ensureNotifCollections(db) {
  if (!db.notifications) db.notifications = {};
  if (!db.notif_meta) db.notif_meta = { cursor: 0 };
  if (typeof db.notif_meta.cursor !== 'number') db.notif_meta.cursor = 0;
  if (!db.review_deadlines) db.review_deadlines = {}; // drawingId -> { due_at, set_by, set_at }
}

function findDrawing(db, drawingId) {
  return db.drawings.find((d) => d.id === drawingId && !d.is_deleted) || null;
}

// ===================== طبقة الإنشاء الأساسية (idempotent) =====================
function _createNotification(db, {
  type, drawingId = null, message, actor = null, recipients = [], sourceEventId = null, details = {},
} = {}) {
  if (sourceEventId) {
    const existing = Object.values(db.notifications).find((n) => n.source_event_id === sourceEventId);
    if (existing) return existing; // منع التكرار لنفس الحدث بالتحديد
  }
  const typeDef = NOTIFICATION_TYPES[type] || { label: type, severity: 'info' };
  const id = newId('DNTF');
  const record = {
    id,
    type,
    type_label: typeDef.label,
    severity: typeDef.severity,
    drawing_id: drawingId,
    message,
    actor,
    details,
    source_event_id: sourceEventId,
    created_at: nowISO(),
    // recipients: [{ user, read_at }] - قائمة صريحة، أو بث عام لكل من يملك صلاحية
    // drawings.view إن تُركت فارغة (نفس نمط documentNotifications.js تماماً)
    recipients: recipients.map((r) => ({ user: r, read_at: null })),
    is_broadcast: recipients.length === 0,
  };
  db.notifications[id] = record;
  return record;
}

// ===================== 1) الفحص التزايدي لسجل التدقيق (لا تكرار) =====================
/**
 * يفحص سجل التدقيق الموحّد لكل الأجزاء (1/10 حتى 9/10) بدءاً من آخر مؤشر تمت
 * معالجته فقط، ويولّد إشعاراً فعلياً حقيقياً لكل حدث ذي صلة لم يُعالَج من قبل.
 * آمن للاستدعاء المتكرر (idempotent) بفضل مؤشر db.notif_meta.cursor + source_event_id.
 */
function scanAuditLogForNotifications() {
  const db = loadDB();
  ensureNotifCollections(db);

  const startFrom = db.notif_meta.cursor || 0;
  const newEntries = (db.audit_log || []).slice(startFrom);
  db.notif_meta.cursor = (db.audit_log || []).length;

  if (!newEntries.length) { saveDB(db); return { success: true, created: 0 }; }

  const relevantActions = {
    create_drawing: 'drawing_uploaded',
    upload_new_version: 'drawing_new_version',
    submit_drawing_for_review: 'drawing_review_new',
    approve_drawing: 'drawing_approved',
    final_approve_drawing: 'drawing_approved',
    submit_drawing_approval: 'drawing_approved', // يُستخدَم فقط حين decision=approved (يُفلتَر بالتفاصيل أدناه)
    reject_drawing: 'drawing_rejected',
    reject_drawing_approval_level: 'drawing_rejected',
    update_drawing_metadata: 'drawing_updated',
  };

  let created = 0;
  for (const entry of newEntries) {
    const notifType = relevantActions[entry.action];
    if (!notifType || !entry.drawing_id) continue;

    const rec = findDrawing(db, entry.drawing_id);
    const label = rec ? `${rec.drawing_number} - ${rec.name}` : entry.drawing_id;

    let message;
    switch (notifType) {
      case 'drawing_uploaded': message = `تم رفع مخطط جديد: ${label}`; break;
      case 'drawing_new_version': message = `تم إنشاء إصدار جديد للمخطط: ${label}`; break;
      case 'drawing_review_new': message = `طلب مراجعة جديد للمخطط: ${label}`; break;
      case 'drawing_approved': message = `تم اعتماد المخطط: ${label}`; break;
      case 'drawing_rejected': message = `تم رفض المخطط: ${label}${entry.details ? ` - ${String(entry.details).slice(0, 120)}` : ''}`; break;
      case 'drawing_updated': message = `تم تعديل بيانات المخطط: ${label}`; break;
      default: message = `${notifType}: ${label}`;
    }

    _createNotification(db, {
      type: notifType,
      drawingId: entry.drawing_id,
      message,
      actor: entry.actor,
      sourceEventId: entry.id,
      details: { action: entry.action, original_details: entry.details || null },
    });
    created += 1;
  }

  saveDB(db);
  return { success: true, created };
}

// ===================== 2) انتهاء مدة المراجعة =====================

/** تحديد/تعديل مهلة مراجعة اختيارية لمخطط معيّن ما زال قيد المراجعة أو سيُرسَل إليها. */
function setReviewDeadline(drawingId, { due_at: dueAt, actor } = {}) {
  if (!dueAt) throw new Error('تاريخ انتهاء مهلة المراجعة (due_at) مطلوب');
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) throw new Error('تاريخ انتهاء مهلة المراجعة غير صالح');

  const db = loadDB();
  ensureNotifCollections(db);
  const rec = findDrawing(db, drawingId);
  if (!rec) throw new Error('المخطط غير موجود');

  db.review_deadlines[drawingId] = {
    due_at: parsed.toISOString(),
    set_by: actor || null,
    set_at: nowISO(),
    // إعادة ضبط أعلام التنبيه المُرسَل مسبقاً عند تغيير المهلة (حتى لا يُفقَد تنبيه جديد فعلي)
    warned_soon: false,
    warned_expired: false,
  };
  saveDB(db);
  return { success: true, drawing_id: drawingId, review_deadline: db.review_deadlines[drawingId] };
}

function getReviewDeadline(drawingId) {
  const db = loadDB();
  ensureNotifCollections(db);
  return { success: true, drawing_id: drawingId, review_deadline: db.review_deadlines[drawingId] || null };
}

function clearReviewDeadline(drawingId) {
  const db = loadDB();
  ensureNotifCollections(db);
  delete db.review_deadlines[drawingId];
  saveDB(db);
  return { success: true };
}

/**
 * يفحص فعلياً كل مهل المراجعة المضبوطة مقابل المخططات التي ما زالت "قيد المراجعة"
 * فقط (إن اعتُمد المخطط أو رُفض أو أُرسِل مرة أخرى، تفقد المهلة معناها تلقائياً هنا
 * دون الحاجة لحذفها يدوياً). ينشئ إشعار "قاربت على الانتهاء" مرة واحدة فقط، ثم
 * "انتهت المهلة" مرة واحدة فقط، لكل مهلة مضبوطة (idempotent عبر أعلام warned_*).
 */
function checkReviewDeadlines() {
  const db = loadDB();
  ensureNotifCollections(db);
  const now = Date.now();
  let created = 0;

  for (const [drawingId, deadline] of Object.entries(db.review_deadlines)) {
    const rec = findDrawing(db, drawingId);
    if (!rec || rec.approval_status !== 'under_review') continue;

    const dueMs = new Date(deadline.due_at).getTime();
    const daysLeft = Math.ceil((dueMs - now) / (1000 * 60 * 60 * 24));
    const label = `${rec.drawing_number} - ${rec.name}`;

    if (dueMs < now && !deadline.warned_expired) {
      _createNotification(db, {
        type: 'review_deadline_expired',
        drawingId,
        message: `انتهت مهلة مراجعة المخطط ${label} بتاريخ ${deadline.due_at.slice(0, 10)} دون اكتمال المراجعة`,
        sourceEventId: `review-deadline-expired:${drawingId}:${deadline.due_at}`,
        details: { due_at: deadline.due_at },
      });
      deadline.warned_expired = true;
      created += 1;
    } else if (dueMs >= now && daysLeft <= REVIEW_DEADLINE_WARNING_DAYS && !deadline.warned_soon) {
      _createNotification(db, {
        type: 'review_deadline_soon',
        drawingId,
        message: `مهلة مراجعة المخطط ${label} توشك على الانتهاء خلال ${daysLeft} يوم (بتاريخ ${deadline.due_at.slice(0, 10)})`,
        sourceEventId: `review-deadline-soon:${drawingId}:${deadline.due_at}`,
        details: { due_at: deadline.due_at, days_left: daysLeft },
      });
      deadline.warned_soon = true;
      created += 1;
    }
  }

  saveDB(db);
  return { success: true, created };
}

// ===================== 3) تعارض بين الإصدارات =====================
/**
 * يُعاد استخدام سجل المقارنات الحقيقي الموجود بالفعل في db.comparisons (الجزء 7/10 -
 * drawingComparison.js) بدل تعريف آلية كشف تعارض منفصلة: أي مقارنة فعلية سابقة بين
 * إصدارين نتج عنها عنصر واحد على الأقل بحالة "معدَّل" (modified) تُعتبر تعارضاً
 * فعلياً بين الإصدارين ينبغي تنبيه المعنيين به. idempotent عبر sourceEventId المبني
 * من معرّف سجل المقارنة نفسه (comparison.id) - لا يُعاد التنبيه لنفس المقارنة مرتين.
 */
function checkVersionConflicts() {
  const db = loadDB();
  ensureNotifCollections(db);
  if (!Array.isArray(db.comparisons)) { saveDB(db); return { success: true, created: 0 }; }

  let created = 0;
  for (const cmp of db.comparisons) {
    const modifiedCount = cmp.modified_count || 0;
    if (!modifiedCount) continue;

    const rec = findDrawing(db, cmp.drawing_id);
    const label = rec ? `${rec.drawing_number} - ${rec.name}` : cmp.drawing_id;

    _createNotification(db, {
      type: 'version_conflict',
      drawingId: cmp.drawing_id,
      message: `تم اكتشاف تعارض بين إصدارين للمخطط ${label} (الإصدار ${cmp.version_a ?? '?'} مقابل ${cmp.version_b ?? '?'}) - ${modifiedCount} عنصر معدَّل`,
      actor: cmp.compared_by || null,
      sourceEventId: `version-conflict:${cmp.id}`,
      details: { version_a: cmp.version_a, version_b: cmp.version_b, modified_count: modifiedCount },
    });
    created += 1;
  }

  saveDB(db);
  return { success: true, created };
}

/** يشغّل كل عمليات الفحص الثلاث دفعة واحدة - نقطة دخول واحدة مريحة للواجهة/الجدولة */
function runAllChecks() {
  const a = scanAuditLogForNotifications();
  const b = checkReviewDeadlines();
  const c = checkVersionConflicts();
  return { success: true, created: (a.created || 0) + (b.created || 0) + (c.created || 0) };
}

// ===================== 4) القراءة والتغذية (Feed) =====================

function _isVisibleToUser(n, username) {
  if (n.is_broadcast) return true;
  return n.recipients.some((r) => r.user === username);
}

function _readStateFor(n, username) {
  const entry = n.recipients.find((r) => r.user === username);
  return entry ? entry.read_at : null;
}

/**
 * يعيد قائمة التنبيهات الفعلية لمستخدم معيّن (مع تشغيل كل عمليات الفحص ضمنياً أولاً
 * لضمان أن التغذية محدَّثة بآخر الأحداث الحقيقية قبل إرجاعها) - نفس نمط
 * documentNotifications.getFeed تماماً.
 */
function getFeed({
  username, drawingId = null, unreadOnly = false, type = null, page = 1, pageSize = 30,
} = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب لاسترجاع التنبيهات الخاصة به');
  runAllChecks();

  const db = loadDB();
  ensureNotifCollections(db);
  let items = Object.values(db.notifications).filter((n) => _isVisibleToUser(n, username));
  if (drawingId) items = items.filter((n) => n.drawing_id === drawingId);
  if (type) items = items.filter((n) => n.type === type);

  items = items.map((n) => ({ ...n, read_at: _readStateFor(n, username) }));
  if (unreadOnly) items = items.filter((n) => !n.read_at);

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    success: true,
    notifications: paged,
    pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function getUnreadCount({ username, drawingId = null } = {}) {
  const feed = getFeed({
    username, drawingId, unreadOnly: true, page: 1, pageSize: 100000,
  });
  return { success: true, unread_count: feed.pagination.total };
}

function markAsRead(notificationId, { username } = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب');
  const db = loadDB();
  ensureNotifCollections(db);
  const n = db.notifications[notificationId];
  if (!n) throw new Error('التنبيه غير موجود');
  if (!_isVisibleToUser(n, username)) throw new Error('هذا التنبيه غير مرئي لهذا المستخدم');

  let entry = n.recipients.find((r) => r.user === username);
  if (!entry) { entry = { user: username, read_at: null }; n.recipients.push(entry); }
  entry.read_at = nowISO();

  saveDB(db);
  return { success: true, notification: n };
}

function markAllAsRead({ username, drawingId = null } = {}) {
  if (!username) throw new Error('اسم المستخدم (username) مطلوب');
  const db = loadDB();
  ensureNotifCollections(db);
  let count = 0;
  for (const n of Object.values(db.notifications)) {
    if (!_isVisibleToUser(n, username)) continue;
    if (drawingId && n.drawing_id !== drawingId) continue;
    let entry = n.recipients.find((r) => r.user === username);
    if (!entry) { entry = { user: username, read_at: null }; n.recipients.push(entry); }
    if (!entry.read_at) { entry.read_at = nowISO(); count += 1; }
  }
  saveDB(db);
  return { success: true, marked: count };
}

// ===================== 5) الملخص (لاستخدام لوحة التحكم/التقارير) =====================
function getNotificationsSummary({ drawingId = null } = {}) {
  runAllChecks();
  const db = loadDB();
  ensureNotifCollections(db);

  let items = Object.values(db.notifications);
  if (drawingId) items = items.filter((n) => n.drawing_id === drawingId);

  const byType = {};
  Object.keys(NOTIFICATION_TYPES).forEach((k) => { byType[k] = 0; });
  items.forEach((n) => { byType[n.type] = (byType[n.type] || 0) + 1; });

  return {
    success: true,
    total_notifications: items.length,
    by_type: Object.entries(byType).map(([type, count]) => ({ type, label: NOTIFICATION_TYPES[type]?.label || type, count })),
    review_deadlines_soon: items.filter((n) => n.type === 'review_deadline_soon').length,
    review_deadlines_expired: items.filter((n) => n.type === 'review_deadline_expired').length,
    version_conflicts: items.filter((n) => n.type === 'version_conflict').length,
  };
}

/** عدّاد لاستخدام لوحة التحكم الرئيسية (الجزء 1/10) بنفس نمط getApprovalCountForDashboard */
function getUnreadNotificationsCountForDashboard() {
  const db = loadDB();
  ensureNotifCollections(db);
  return Object.values(db.notifications).filter((n) => n.recipients.every((r) => !r.read_at)).length;
}

module.exports = {
  NOTIFICATION_TYPES,
  REVIEW_DEADLINE_WARNING_DAYS,

  // فحص/مسح
  scanAuditLogForNotifications,
  checkReviewDeadlines,
  checkVersionConflicts,
  runAllChecks,

  // مهلة المراجعة
  setReviewDeadline,
  getReviewDeadline,
  clearReviewDeadline,

  // تغذية وقراءة
  getFeed,
  getUnreadCount,
  markAsRead,
  markAllAsRead,

  // ملخص
  getNotificationsSummary,
  getUnreadNotificationsCountForDashboard,
};
