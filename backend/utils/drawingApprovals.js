/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الثامن (8/10): إدارة الاعتمادات المتعددة المستويات (Multi-Level Approvals)
 *                        + توقيع إلكتروني
 * =====================================================================================
 *
 * ملاحظة إصلاح: هذا الملف كان تالفاً في التسليم السابق (يحتوي كود واجهة أمامية
 * document/window بالخطأ بدل منطق الباكيند)، ما جعل جميع نداءات DRAW_APPROVALS.* في
 * server.js (endpoints الجزء 8/10) تفشل فعلياً عند التشغيل لأن module.exports لم يكن
 * موجوداً إطلاقاً. تمت إعادة كتابته بالكامل كمنطق باكيند حقيقي بنفس أسلوب
 * drawingReviews.js/drawingComments.js فوق نفس طبقة التخزين الموحّدة drawings.json.
 *
 * يغطي هذا الجزء:
 *  - تعريف مستويات اعتماد متعددة قابلة للتخصيص لكل مخطط (داخلي/استشاري/عميل/مقاول/نهائي).
 *  - تسجيل قرار اعتماد أو رفض على مستوى معيّن مع "توقيع إلكتروني" فعلي (بصمة SHA-256
 *    محسوبة من محتوى القرار + معرّف المخطط + الإصدار الحالي وقت التوقيع + الوقت).
 *  - إلغاء اعتماد سابق مع سبب.
 *  - التحقق من سلامة توقيع معيّن (سليم/ملغى/تم تعديل المخطط بعد التوقيع/متلاعب به).
 *  - تحديث approval_status على المخطط نفسه تلقائياً حين تكتمل كل المستويات المطلوبة
 *    (final) بما يبقيه متسقاً مع بقية الأجزاء (القوائم ولوحة التحكم).
 *  - سجل تدقيق فعلي موحّد لكل عملية.
 */

const DRAW = require('./drawingManagement');
const {
  loadDB, saveDB, logAudit, newId, nowISO, sha256,
} = DRAW._internal;

// ===================== الثوابت =====================
const APPROVAL_LEVELS = ['internal', 'consultant', 'client', 'contractor', 'final'];
const APPROVAL_LEVEL_LABELS_AR = {
  internal: 'اعتماد داخلي',
  consultant: 'اعتماد الاستشاري',
  client: 'اعتماد العميل',
  contractor: 'اعتماد المقاول',
  final: 'اعتماد نهائي',
};
// المستويات الافتراضية المطلوبة لأي مخطط ما لم يُخصَّص غير ذلك صراحةً
const DEFAULT_REQUIRED_LEVELS = ['internal', 'final'];

// ===================== أدوات داخلية =====================
function findDrawing(db, drawingId) {
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

function ensureApprovalCollections(db) {
  if (!Array.isArray(db.approvals)) db.approvals = [];
  if (!db.approval_requirements) db.approval_requirements = {};
}

function validateLevel(level) {
  if (!APPROVAL_LEVELS.includes(level)) {
    throw new Error(`مستوى الاعتماد غير معروف: ${level}. القيم المتاحة: ${APPROVAL_LEVELS.join(', ')}`);
  }
}

function getRequiredLevels(db, drawingId) {
  const custom = db.approval_requirements[drawingId];
  return Array.isArray(custom) && custom.length ? custom : DEFAULT_REQUIRED_LEVELS;
}

function getActiveApprovals(db, drawingId) {
  return db.approvals.filter((a) => a.drawing_id === drawingId && !a.revoked);
}

// بصمة توقيع إلكتروني حقيقية: تُحسب من كل عناصر القرار غير القابلة للتغيير بعد التوقيع
function computeSignatureHash({
  drawingId, level, decision, signerName, signerRole, note, versionAtSigning, signedAt,
}) {
  const payload = JSON.stringify({
    drawingId, level, decision, signerName, signerRole: signerRole || null, note: note || null, versionAtSigning, signedAt,
  });
  return sha256(Buffer.from(payload, 'utf8'));
}

// ===================== 1) تعريف المستويات المطلوبة لمخطط =====================
function defineApprovalRequirement(drawingId, { levels, actor } = {}) {
  if (!Array.isArray(levels) || !levels.length) throw new Error('يجب تحديد مستوى اعتماد واحد على الأقل');
  levels.forEach(validateLevel);

  const db = loadDB();
  ensureApprovalCollections(db);
  const rec = findDrawing(db, drawingId);

  // ترتيب المستويات حسب ترتيبها المرجعي الثابت (وليس ترتيب إدخال المستخدم) لضمان تسلسل منطقي
  const ordered = APPROVAL_LEVELS.filter((lvl) => levels.includes(lvl));
  db.approval_requirements[drawingId] = ordered;

  logAudit(db, {
    action: 'define_drawing_approval_requirement',
    drawingId,
    actor,
    details: `تحديد مستويات الاعتماد المطلوبة للمخطط (${rec.drawing_number}): ${ordered.map((l) => APPROVAL_LEVEL_LABELS_AR[l]).join(' ← ')}`,
  });
  saveDB(db);

  return { success: true, drawing_id: drawingId, required_levels: ordered };
}

// ===================== 2) حالة الاعتماد الكلية لمخطط =====================
function getApprovalStatusInfo(drawingId) {
  const db = loadDB();
  ensureApprovalCollections(db);
  const rec = findDrawing(db, drawingId);

  const requiredLevels = getRequiredLevels(db, drawingId);
  const active = getActiveApprovals(db, drawingId);
  const approvedLevels = requiredLevels.filter((lvl) => active.some((a) => a.level === lvl && a.decision === 'approved'));
  const remainingLevels = requiredLevels.filter((lvl) => !approvedLevels.includes(lvl));
  const isApprovalComplete = remainingLevels.length === 0;
  const nextLevel = remainingLevels[0] || null;

  return {
    success: true,
    drawing_id: drawingId,
    drawing_number: rec.drawing_number,
    required_levels: requiredLevels,
    approved_levels: approvedLevels,
    remaining_levels: remainingLevels,
    is_approval_complete: isApprovalComplete,
    next_level: nextLevel,
    next_level_label: nextLevel ? APPROVAL_LEVEL_LABELS_AR[nextLevel] : null,
  };
}

// ===================== 3) تسجيل اعتماد أو رفض (توقيع إلكتروني) =====================
function submitApproval(drawingId, {
  level, decision, signer_name: signerName, signer_role: signerRole, note, actor,
} = {}) {
  validateLevel(level);
  if (!['approved', 'rejected'].includes(decision)) throw new Error('القرار يجب أن يكون approved أو rejected');
  if (!signerName || !String(signerName).trim()) throw new Error('اسم الموقِّع مطلوب');
  if (decision === 'rejected' && (!note || !String(note).trim())) throw new Error('سبب الرفض مطلوب');

  const db = loadDB();
  ensureApprovalCollections(db);
  const rec = findDrawing(db, drawingId);

  const requiredLevels = getRequiredLevels(db, drawingId);
  if (!requiredLevels.includes(level)) {
    throw new Error(`المستوى (${APPROVAL_LEVEL_LABELS_AR[level] || level}) ليس ضمن مستويات الاعتماد المطلوبة لهذا المخطط`);
  }

  const active = getActiveApprovals(db, drawingId);
  if (active.some((a) => a.level === level && a.decision === 'approved')) {
    throw new Error(`تم اعتماد المستوى (${APPROVAL_LEVEL_LABELS_AR[level]}) مسبقاً لهذا المخطط`);
  }

  const signedAt = nowISO();
  const versionAtSigning = rec.current_version;
  const signatureHash = computeSignatureHash({
    drawingId, level, decision, signerName: signerName.trim(), signerRole, note, versionAtSigning, signedAt,
  });

  const approval = {
    id: newId('APR'),
    drawing_id: drawingId,
    level,
    level_label: APPROVAL_LEVEL_LABELS_AR[level],
    decision,
    signer_name: signerName.trim(),
    signer_role: signerRole || null,
    note: note || null,
    version_number_at_signing: versionAtSigning,
    signature_hash: signatureHash,
    signed_at: signedAt,
    signed_by: actor || signerName.trim(),
    revoked: false,
    revoked_reason: null,
    revoked_at: null,
  };
  db.approvals.push(approval);

  // إذا اكتملت كل المستويات المطلوبة بالاعتماد، أو تم رفض أي مستوى: حدّث حالة المخطط
  if (decision === 'rejected') {
    rec.approval_status = 'rejected';
  } else {
    const nowApprovedLevels = requiredLevels.filter(
      (lvl) => lvl === level || db.approvals.some((a) => a.drawing_id === drawingId && a.level === lvl && a.decision === 'approved' && !a.revoked),
    );
    if (requiredLevels.every((lvl) => nowApprovedLevels.includes(lvl))) {
      rec.approval_status = 'approved';
      rec.approver = signerName.trim();
    }
  }
  rec.updated_at = nowISO();

  logAudit(db, {
    action: decision === 'approved' ? 'submit_drawing_approval' : 'reject_drawing_approval_level',
    drawingId,
    actor,
    details: `${decision === 'approved' ? 'اعتماد' : 'رفض'} المستوى (${APPROVAL_LEVEL_LABELS_AR[level]}) للمخطط (${rec.drawing_number}) بتوقيع: ${signerName.trim()}`,
  });
  saveDB(db);

  return { success: true, approval, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 4) إلغاء اعتماد =====================
function revokeApproval(drawingId, approvalId, { reason, actor } = {}) {
  if (!reason || !String(reason).trim()) throw new Error('سبب إلغاء الاعتماد مطلوب');

  const db = loadDB();
  ensureApprovalCollections(db);
  const rec = findDrawing(db, drawingId);
  const approval = db.approvals.find((a) => a.id === approvalId && a.drawing_id === drawingId);
  if (!approval) throw new Error('سجل الاعتماد غير موجود');
  if (approval.revoked) throw new Error('هذا الاعتماد ملغى مسبقاً');

  approval.revoked = true;
  approval.revoked_reason = reason.trim();
  approval.revoked_at = nowISO();

  // إعادة تقييم حالة المخطط بعد الإلغاء (قد يعود إلى "قيد المراجعة" إن لم تعد كل المستويات مكتملة)
  const requiredLevels = getRequiredLevels(db, drawingId);
  const stillApprovedLevels = requiredLevels.filter(
    (lvl) => db.approvals.some((a) => a.drawing_id === drawingId && a.level === lvl && a.decision === 'approved' && !a.revoked),
  );
  if (rec.approval_status === 'approved' && stillApprovedLevels.length < requiredLevels.length) {
    rec.approval_status = 'under_review';
  }
  rec.updated_at = nowISO();

  logAudit(db, {
    action: 'revoke_drawing_approval',
    drawingId,
    actor,
    details: `إلغاء اعتماد المستوى (${approval.level_label}) للمخطط (${rec.drawing_number}) - السبب: ${reason.trim()}`,
  });
  saveDB(db);

  return { success: true, approval, drawing: DRAW.getDrawing(drawingId) };
}

// ===================== 5) سرد اعتمادات مخطط =====================
function listApprovals(drawingId) {
  const db = loadDB();
  ensureApprovalCollections(db);
  findDrawing(db, drawingId);
  const approvals = db.approvals
    .filter((a) => a.drawing_id === drawingId)
    .sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));
  return { success: true, approvals };
}

// ===================== 6) التحقق من سلامة توقيع =====================
function verifyApproval(drawingId, approvalId) {
  const db = loadDB();
  ensureApprovalCollections(db);
  const rec = findDrawing(db, drawingId);
  const approval = db.approvals.find((a) => a.id === approvalId && a.drawing_id === drawingId);
  if (!approval) throw new Error('سجل الاعتماد غير موجود');

  const recomputed = computeSignatureHash({
    drawingId,
    level: approval.level,
    decision: approval.decision,
    signerName: approval.signer_name,
    signerRole: approval.signer_role,
    note: approval.note,
    versionAtSigning: approval.version_number_at_signing,
    signedAt: approval.signed_at,
  });

  let integrityStatus;
  if (recomputed !== approval.signature_hash) {
    integrityStatus = 'invalid_signature_tampered';
  } else if (approval.revoked) {
    integrityStatus = 'revoked';
  } else if (rec.current_version > approval.version_number_at_signing) {
    integrityStatus = 'drawing_modified_after_approval';
  } else {
    integrityStatus = 'valid';
  }

  return {
    success: true,
    integrity_status: integrityStatus,
    signed_by: approval.signer_name,
    level: approval.level,
    level_label: approval.level_label,
    decision: approval.decision,
    signed_at: approval.signed_at,
    version_number_at_signing: approval.version_number_at_signing,
    current_drawing_version: rec.current_version,
    revoked: approval.revoked,
  };
}

// ===================== 7) عدّاد لاستخدام لوحة التحكم (الجزء 1/10) =====================
function getApprovalCountForDashboard() {
  const db = loadDB();
  ensureApprovalCollections(db);
  return db.approvals.filter((a) => a.decision === 'approved' && !a.revoked).length;
}

module.exports = {
  APPROVAL_LEVELS,
  APPROVAL_LEVEL_LABELS_AR,
  DEFAULT_REQUIRED_LEVELS,
  defineApprovalRequirement,
  getApprovalStatusInfo,
  submitApproval,
  revokeApproval,
  listApprovals,
  verifyApproval,
  getApprovalCountForDashboard,
};
