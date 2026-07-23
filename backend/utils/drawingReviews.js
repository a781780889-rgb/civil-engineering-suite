/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الخامس (5/10): مراجعة المخططات (Review Workflow)
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10 (نفس ملف
 * backend/data/drawings.json) بنفس أسلوب drawingVersions.js / drawingViewer.js /
 * drawingLayers.js: يستخدم drawingManagement.js._internal مباشرة دون أي اعتمادية دائرية.
 *
 * يغطي هذا الجزء بند "مراجعة المخططات" من المواصفة الأصلية على مستوى الـ backend:
 *  - إرسال مخطط للمراجعة (draft/rejected → under_review).
 *  - تسجيل قرار مراجعة هندسية: اعتماد / رفض / إعادة للمصمم.
 *  - اعتماد نهائي (خطوة منفصلة بعد المراجعة الهندسية الأولية) → يضبط approval_status = approved
 *    ويحدّث حقل rec.approver على المخطط نفسه.
 *  - سجل كامل لكل خطوة مراجعة (من قام بها، متى، القرار، السبب/الملاحظة) مستقل عن أي مخطط آخر.
 *  - حساب حقل total_reviews في لوحة التحكم فعلياً من سجل المراجعات الحقيقي (بدل الصفر الثابت
 *    في الجزء 1/10) عبر دالة getReviewCountForDashboard المُصدَّرة.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - آلة حالة (state machine) فعلية تمنع أي انتقال غير منطقي (مثال: لا يمكن اعتماد مخطط
 *    لم يُرسَل للمراجعة أصلاً، ولا يمكن إرسال مخطط "معتمد" للمراجعة دون إصدار جديد).
 *  - كل قرار مراجعة يُخزَّن فعلياً كسجل مستقل في drawings.json (وليس فقط حقل واحد يُستبدَل).
 *  - حالة المخطط (approval_status) والحقول (reviewer/approver) على السجل الرئيسي تُحدَّث
 *    فعلياً بما يتوافق مع آخر قرار، لتبقى متسقة مع بقية الأجزاء (القوائم، لوحة التحكم).
 *  - سجل تدقيق فعلي موحّد مع بقية الأجزاء لكل عملية إرسال/مراجعة/رفض/إعادة/اعتماد نهائي.
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

function ensureReviewCollections(db) {
  if (!Array.isArray(db.reviews)) db.reviews = [];
}

function getDrawingReviews(db, drawingId) {
  return db.reviews
    .filter((r) => r.drawing_id === drawingId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// أنواع قرارات المراجعة (خطوات سير العمل كما وردت في المتطلبات حرفياً)
const REVIEW_DECISIONS = ['submitted', 'engineering_review', 'approved', 'rejected', 'returned_to_designer', 'final_approval'];
const REVIEW_DECISION_LABELS_AR = {
  submitted: 'إرسال للمراجعة',
  engineering_review: 'مراجعة هندسية',
  approved: 'اعتماد',
  rejected: 'رفض',
  returned_to_designer: 'إعادة للمصمم',
  final_approval: 'اعتماد نهائي',
};

function addReviewRecord(db, drawingId, { decision, actor, note }) {
  const record = {
    id: newId('REV'),
    drawing_id: drawingId,
    decision,
    actor: actor || null,
    note: note || null,
    created_at: nowISO(),
  };
  db.reviews.push(record);
  return record;
}

// ===================== 1) إرسال مخطط للمراجعة =====================
/**
 * ينقل المخطط من (مسودة) أو (مرفوض) إلى (قيد المراجعة).
 * @param {string} drawingId
 * @param {Object} opts { reviewer(اختياري - تعيين المراجع المسؤول), note(اختياري), actor }
 */
function submitForReview(drawingId, { reviewer, note, actor } = {}) {
  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (!['draft', 'rejected'].includes(rec.approval_status)) {
    throw new Error(`لا يمكن إرسال المخطط للمراجعة من حالته الحالية (${rec.approval_status}). يجب أن يكون "مسودة" أو "مرفوض"`);
  }

  rec.approval_status = 'under_review';
  if (reviewer) rec.reviewer = reviewer;
  rec.updated_at = nowISO();

  addReviewRecord(db, drawingId, { decision: 'submitted', actor, note });

  logAudit(db, {
    action: 'submit_drawing_for_review',
    drawingId,
    actor,
    details: `إرسال المخطط (${rec.drawing_number}) للمراجعة${reviewer ? ` - المراجع: ${reviewer}` : ''}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 2) تسجيل قرار مراجعة هندسية (وسيطة - لا تغيّر الحالة النهائية) =====================
/**
 * تسجّل ملاحظة/رأي مراجعة هندسية على مخطط "قيد المراجعة" دون تغيير حالته النهائية.
 * تُستخدم لتوثيق خطوات المراجعة قبل اتخاذ القرار (اعتماد/رفض/إعادة).
 */
function recordEngineeringReview(drawingId, { note, actor } = {}) {
  if (!note || !String(note).trim()) throw new Error('ملاحظة المراجعة الهندسية مطلوبة');

  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (rec.approval_status !== 'under_review') {
    throw new Error(`لا يمكن تسجيل مراجعة هندسية إلا لمخطط "قيد المراجعة" (الحالة الحالية: ${rec.approval_status})`);
  }

  addReviewRecord(db, drawingId, { decision: 'engineering_review', actor, note });
  rec.updated_at = nowISO();

  logAudit(db, {
    action: 'record_engineering_review',
    drawingId,
    actor,
    details: `تسجيل مراجعة هندسية على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 3) اعتماد (أولي) =====================
/**
 * اعتماد المخطط بعد المراجعة الهندسية. يضبط approval_status = approved ويسجّل المُعتمِد.
 */
function approveDrawing(drawingId, { approver, note, actor } = {}) {
  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (rec.approval_status !== 'under_review') {
    throw new Error(`لا يمكن اعتماد مخطط إلا وهو "قيد المراجعة" (الحالة الحالية: ${rec.approval_status})`);
  }

  rec.approval_status = 'approved';
  rec.approver = approver || actor || rec.approver || null;
  rec.updated_at = nowISO();

  addReviewRecord(db, drawingId, { decision: 'approved', actor, note });

  logAudit(db, {
    action: 'approve_drawing',
    drawingId,
    actor,
    details: `اعتماد المخطط (${rec.drawing_number})${rec.approver ? ` - بواسطة: ${rec.approver}` : ''}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 4) رفض =====================
function rejectDrawing(drawingId, { note, actor } = {}) {
  if (!note || !String(note).trim()) throw new Error('سبب الرفض مطلوب');

  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (rec.approval_status !== 'under_review') {
    throw new Error(`لا يمكن رفض مخطط إلا وهو "قيد المراجعة" (الحالة الحالية: ${rec.approval_status})`);
  }

  rec.approval_status = 'rejected';
  rec.updated_at = nowISO();

  addReviewRecord(db, drawingId, { decision: 'rejected', actor, note });

  logAudit(db, {
    action: 'reject_drawing',
    drawingId,
    actor,
    details: `رفض المخطط (${rec.drawing_number}) - السبب: ${note}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 5) إعادة للمصمم =====================
/**
 * إعادة المخطط للمصمم لإجراء تعديلات (حالة وسيطة بين المراجعة والرفض النهائي).
 * تُعيد المخطط إلى حالة "مسودة" مع الاحتفاظ بسبب الإعادة في سجل المراجعات.
 */
function returnToDesigner(drawingId, { note, actor } = {}) {
  if (!note || !String(note).trim()) throw new Error('ملاحظة الإعادة للمصمم مطلوبة');

  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (rec.approval_status !== 'under_review') {
    throw new Error(`لا يمكن إعادة مخطط للمصمم إلا وهو "قيد المراجعة" (الحالة الحالية: ${rec.approval_status})`);
  }

  rec.approval_status = 'draft';
  rec.updated_at = nowISO();

  addReviewRecord(db, drawingId, { decision: 'returned_to_designer', actor, note });

  logAudit(db, {
    action: 'return_drawing_to_designer',
    drawingId,
    actor,
    details: `إعادة المخطط (${rec.drawing_number}) للمصمم - الملاحظة: ${note}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 6) اعتماد نهائي =====================
/**
 * خطوة اعتماد نهائي منفصلة عن الاعتماد الأولي (approveDrawing) — تُستخدم عندما يتطلب
 * سير العمل توثيق اعتماد نهائي صريح بعد الاعتماد الأولي (مثال: بعد اعتمادات خارجية
 * إضافية ستُدار بالتفصيل في الجزء 8/10). لا تُغيّر approval_status إن كان already
 * approved، لكنها تُسجّل خطوة "اعتماد نهائي" موثّقة في سجل المراجعات لهذا المخطط.
 */
function finalApproveDrawing(drawingId, { approver, note, actor } = {}) {
  const db = loadDB();
  ensureReviewCollections(db);
  const rec = findDrawing(db, drawingId);

  if (rec.approval_status !== 'approved') {
    throw new Error(`لا يمكن تسجيل اعتماد نهائي إلا لمخطط "معتمد" مسبقاً (الحالة الحالية: ${rec.approval_status})`);
  }

  if (approver) rec.approver = approver;
  rec.updated_at = nowISO();

  addReviewRecord(db, drawingId, { decision: 'final_approval', actor, note });

  logAudit(db, {
    action: 'final_approve_drawing',
    drawingId,
    actor,
    details: `اعتماد نهائي للمخطط (${rec.drawing_number})${rec.approver ? ` - بواسطة: ${rec.approver}` : ''}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 7) سجل مراجعات مخطط =====================
function listReviews(drawingId) {
  const db = loadDB();
  ensureReviewCollections(db);
  findDrawing(db, drawingId);
  return { success: true, reviews: getDrawingReviews(db, drawingId), decision_labels_ar: REVIEW_DECISION_LABELS_AR };
}

// ===================== 8) عدّاد المراجعات لاستخدام لوحة التحكم (الجزء 1/10) =====================
/**
 * يُصدَّر ليستخدمه drawingManagement.getDashboardStats بدل الصفر الثابت الذي كان
 * موجوداً قبل إنجاز هذا الجزء، دون أي اعتمادية دائرية (drawingManagement لا يستورد
 * هذا الملف مباشرة عند التحميل، بل يستدعي هذه الدالة بشكل كسول عبر require داخلي).
 */
function getReviewCountForDashboard() {
  const db = loadDB();
  ensureReviewCollections(db);
  return db.reviews.length;
}

module.exports = {
  REVIEW_DECISIONS,
  REVIEW_DECISION_LABELS_AR,
  submitForReview,
  recordEngineeringReview,
  approveDrawing,
  rejectDrawing,
  returnToDesigner,
  finalApproveDrawing,
  listReviews,
  getReviewCountForDashboard,
};
