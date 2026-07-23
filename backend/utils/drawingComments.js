/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء السادس (6/10): التعليقات والملاحظات المثبّتة على المخطط
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10 (نفس ملف
 * backend/data/drawings.json) بنفس أسلوب drawingReviews.js / drawingLayers.js:
 * يستخدم drawingManagement.js._internal مباشرة دون أي اعتمادية دائرية.
 *
 * يغطي هذا الجزء بند "التعليقات والملاحظات" من المواصفة الأصلية على مستوى الـ backend:
 *  - كتابة تعليق على مخطط، مع تحديد موضعه بإحداثيات (x, y) فعلية على الرسم (اختياري).
 *  - الرد على تعليق (رد واحد أو عدة ردود متسلسلة، كل رد بمؤلفه ووقته).
 *  - إغلاق التعليق (وإعادة فتحه عند الحاجة).
 *  - تصنيف الملاحظات (تصنيفات ثابتة قابلة للتوسع: عام/تصحيح مطلوب/سؤال/ملاحظة تنسيق... إلخ).
 *  - متابعة حالة تنفيذ التعليق (لم يُنفَّذ / قيد التنفيذ / منفَّذ) مستقلة عن حالة الإغلاق نفسها،
 *    لأن تعليقاً قد يُغلَق دون تنفيذ (مثال: أصبح غير ذي صلة) أو يُنفَّذ قبل إغلاقه رسمياً.
 *  - حساب حقل total_comments في لوحة التحكم فعلياً من سجل التعليقات الحقيقي (بدل الصفر الثابت
 *    في الجزء 1/10) عبر دالة getCommentCountForDashboard المُصدَّرة، بنفس أسلوب الجزء 5/10.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل تعليق يُخزَّن فعلياً في drawings.json بكل حقوله (نص، موضع، مؤلف، تصنيف، حالة إغلاق،
 *    حالة تنفيذ، الردود المتسلسلة).
 *  - التحقق الفعلي من صحة الإحداثيات عند تحديدها (أرقام فعلية، وليست نصوصاً عشوائية).
 *  - لا يمكن الرد على تعليق مغلق دون إعادة فتحه أولاً (يمنع نقاشاً على "ملف مُغلَق" بصمت).
 *  - سجل تدقيق فعلي موحّد مع بقية الأجزاء لكل عملية إنشاء/رد/إغلاق/فتح/تصنيف/تحديث تنفيذ/حذف.
 */

const DRAW = require('./drawingManagement');
const {
  loadDB, saveDB, logAudit, newId, nowISO,
} = DRAW._internal;

// ===================== أدوات داخلية =====================
function findDrawing(db, drawingId) {
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

function ensureCommentCollections(db) {
  if (!Array.isArray(db.comments)) db.comments = [];
}

function getDrawingComments(db, drawingId) {
  return db.comments
    .filter((c) => c.drawing_id === drawingId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// تصنيفات الملاحظات (وصفية - قابلة للتوسع، لا تمنع قيماً أخرى)
const COMMENT_CATEGORIES = ['general', 'correction_required', 'question', 'coordination', 'clash', 'approval_condition', 'other'];
const COMMENT_CATEGORY_LABELS_AR = {
  general: 'عام',
  correction_required: 'تصحيح مطلوب',
  question: 'سؤال',
  coordination: 'تنسيق بين تخصصات',
  clash: 'تعارض',
  approval_condition: 'شرط اعتماد',
  other: 'أخرى',
};

// حالات تنفيذ التعليق
const IMPLEMENTATION_STATUSES = ['not_started', 'in_progress', 'implemented'];
const IMPLEMENTATION_STATUS_LABELS_AR = {
  not_started: 'لم يُنفَّذ',
  in_progress: 'قيد التنفيذ',
  implemented: 'منفَّذ',
};

function normalizeCategory(category) {
  if (!category) return 'general';
  const c = String(category).toLowerCase();
  return COMMENT_CATEGORIES.includes(c) ? c : 'other';
}

function normalizeImplementationStatus(status) {
  if (!status) return 'not_started';
  const s = String(status).toLowerCase();
  if (!IMPLEMENTATION_STATUSES.includes(s)) {
    throw new Error(`حالة تنفيذ غير صحيحة: ${status}. القيم المتاحة: ${IMPLEMENTATION_STATUSES.join(', ')}`);
  }
  return s;
}

function validatePosition(position) {
  if (position === undefined || position === null) return null;
  const { x, y } = position;
  if (x === undefined || y === undefined || Number.isNaN(Number(x)) || Number.isNaN(Number(y))) {
    throw new Error('موضع التعليق (position) يجب أن يتضمن إحداثيتين رقميتين x و y فعليتين');
  }
  return { x: Number(x), y: Number(y) };
}

// ===================== 1) كتابة تعليق جديد =====================
/**
 * @param {string} drawingId
 * @param {Object} payload { text, position(اختياري {x,y}), category(اختياري), actor }
 */
function createComment(drawingId, payload = {}) {
  const {
    text, position, category, actor,
  } = payload;
  if (!text || !String(text).trim()) throw new Error('نص التعليق مطلوب');

  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const normalizedPosition = validatePosition(position);

  const comment = {
    id: newId('CMT'),
    drawing_id: drawingId,
    text: String(text).trim(),
    position: normalizedPosition,
    category: normalizeCategory(category),
    implementation_status: 'not_started',
    is_closed: false,
    replies: [],
    created_by: actor || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.comments.push(comment);

  logAudit(db, {
    action: 'create_comment',
    drawingId,
    actor,
    details: `إضافة تعليق على المخطط (${rec.drawing_number})${normalizedPosition ? ` عند الموضع (${normalizedPosition.x}, ${normalizedPosition.y})` : ''}`,
  });
  saveDB(db);

  return { success: true, comment };
}

// ===================== 2) سرد تعليقات مخطط =====================
function listComments(drawingId, filters = {}) {
  const db = loadDB();
  ensureCommentCollections(db);
  findDrawing(db, drawingId);

  let list = getDrawingComments(db, drawingId);
  if (filters.category) list = list.filter((c) => c.category === normalizeCategory(filters.category));
  if (filters.implementation_status) list = list.filter((c) => c.implementation_status === normalizeImplementationStatus(filters.implementation_status));
  if (filters.is_closed !== undefined && filters.is_closed !== null && filters.is_closed !== '') {
    const wantClosed = filters.is_closed === true || filters.is_closed === 'true';
    list = list.filter((c) => c.is_closed === wantClosed);
  }

  return {
    success: true,
    comments: list,
    category_labels_ar: COMMENT_CATEGORY_LABELS_AR,
    implementation_status_labels_ar: IMPLEMENTATION_STATUS_LABELS_AR,
  };
}

function getComment(drawingId, commentId) {
  const db = loadDB();
  ensureCommentCollections(db);
  findDrawing(db, drawingId);
  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');
  return { success: true, comment };
}

// ===================== 3) الرد على تعليق =====================
function replyToComment(drawingId, commentId, { text, actor } = {}) {
  if (!text || !String(text).trim()) throw new Error('نص الرد مطلوب');

  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');
  if (comment.is_closed) throw new Error('لا يمكن الرد على تعليق مُغلَق - الرجاء إعادة فتحه أولاً');

  const reply = {
    id: newId('RPL'),
    text: String(text).trim(),
    actor: actor || null,
    created_at: nowISO(),
  };
  comment.replies.push(reply);
  comment.updated_at = nowISO();

  logAudit(db, {
    action: 'reply_to_comment',
    drawingId,
    actor,
    details: `رد على تعليق على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, comment };
}

// ===================== 4) إغلاق / إعادة فتح تعليق =====================
function closeComment(drawingId, commentId, { actor } = {}) {
  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');
  if (comment.is_closed) throw new Error('التعليق مُغلَق بالفعل');

  comment.is_closed = true;
  comment.updated_at = nowISO();

  logAudit(db, {
    action: 'close_comment',
    drawingId,
    actor,
    details: `إغلاق تعليق على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, comment };
}

function reopenComment(drawingId, commentId, { actor } = {}) {
  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');
  if (!comment.is_closed) throw new Error('التعليق مفتوح بالفعل');

  comment.is_closed = false;
  comment.updated_at = nowISO();

  logAudit(db, {
    action: 'reopen_comment',
    drawingId,
    actor,
    details: `إعادة فتح تعليق على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, comment };
}

// ===================== 5) تصنيف التعليق =====================
function setCommentCategory(drawingId, commentId, { category, actor } = {}) {
  if (!category) throw new Error('التصنيف (category) مطلوب');

  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');

  comment.category = normalizeCategory(category);
  comment.updated_at = nowISO();

  logAudit(db, {
    action: 'set_comment_category',
    drawingId,
    actor,
    details: `تصنيف تعليق على المخطط (${rec.drawing_number}) كـ (${COMMENT_CATEGORY_LABELS_AR[comment.category]})`,
  });
  saveDB(db);

  return { success: true, comment };
}

// ===================== 6) متابعة حالة تنفيذ التعليق =====================
function setImplementationStatus(drawingId, commentId, { status, actor } = {}) {
  const normalized = normalizeImplementationStatus(status);

  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const comment = db.comments.find((c) => c.id === commentId && c.drawing_id === drawingId);
  if (!comment) throw new Error('التعليق غير موجود');

  comment.implementation_status = normalized;
  comment.updated_at = nowISO();

  logAudit(db, {
    action: 'set_comment_implementation_status',
    drawingId,
    actor,
    details: `تحديث حالة تنفيذ تعليق على المخطط (${rec.drawing_number}) إلى (${IMPLEMENTATION_STATUS_LABELS_AR[normalized]})`,
  });
  saveDB(db);

  return { success: true, comment };
}

// ===================== 7) حذف تعليق =====================
function deleteComment(drawingId, commentId, { actor } = {}) {
  const db = loadDB();
  ensureCommentCollections(db);
  const rec = findDrawing(db, drawingId);

  const idx = db.comments.findIndex((c) => c.id === commentId && c.drawing_id === drawingId);
  if (idx === -1) throw new Error('التعليق غير موجود');
  db.comments.splice(idx, 1);

  logAudit(db, {
    action: 'delete_comment',
    drawingId,
    actor,
    details: `حذف تعليق من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true };
}

// ===================== 8) عدّاد التعليقات لاستخدام لوحة التحكم (الجزء 1/10) =====================
/**
 * يُصدَّر ليستخدمه drawingManagement.getDashboardStats بدل الصفر الثابت الذي كان
 * موجوداً قبل إنجاز هذا الجزء، بنفس أسلوب getReviewCountForDashboard في الجزء 5/10،
 * عبر require كسول من drawingManagement.js لتفادي أي اعتمادية دائرية عند التحميل.
 */
function getCommentCountForDashboard() {
  const db = loadDB();
  ensureCommentCollections(db);
  return db.comments.length;
}

module.exports = {
  COMMENT_CATEGORIES,
  COMMENT_CATEGORY_LABELS_AR,
  IMPLEMENTATION_STATUSES,
  IMPLEMENTATION_STATUS_LABELS_AR,
  createComment,
  listComments,
  getComment,
  replyToComment,
  closeComment,
  reopenComment,
  setCommentCategory,
  setImplementationStatus,
  deleteComment,
  getCommentCountForDashboard,
};
