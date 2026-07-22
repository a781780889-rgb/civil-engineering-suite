/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الثاني (2/10): إدارة الإصدارات المتقدمة
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10
 * (نفس ملف backend/data/drawings.json ونفس مجلد backend/data/drawings_files/)
 * دون أي اعتمادية دائرية: drawingManagement.js يُصدِّر `_internal` (loadDB/saveDB/
 * logAudit/newId/nowISO/sha256/bytesToHuman/FILES_DIR) ويستخدمها هذا الملف مباشرة.
 *
 * يغطي هذا الجزء بنود المواصفة التالية تحت عنوان "إدارة الإصدارات":
 *  - إنشاء إصدار جديد لمخطط موجود (رفع ملف فعلي جديد كـ v2, v3, ...).
 *  - مقارنة إصدارين (فرق في الحجم/الـ checksum/رفع كل منهما ومن قام به).
 *  - معرفة الفروقات (نفس نقطة "مقارنة إصدارين" + تفاصيل التغيير المُدخلة يدوياً change_note).
 *  - استعادة إصدار سابق (يصبح هو الحالي دون فقد التاريخ - يُنشئ إصدار جديد "نسخة مستعادة").
 *  - سجل كامل للإصدارات لكل مخطط (من قام بالتعديل، متى، ملاحظة التغيير).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل رفع جديد يستقبل content_base64 فعلياً، يُحسب له checksum (SHA-256) حقيقي،
 *    ويُكتب المحتوى الثنائي الفعلي على القرص باسم ملف مستقل خاص بهذا الإصدار
 *    (لا يُستبدَل أو يُحذف أي ملف إصدار سابق من على القرص أبداً).
 *  - رقم الإصدار متسلسل تلقائياً (current_version + 1) ومُخزَّن في سجل drawings.json.
 *  - منع رفع إصدار مطابق تماماً (نفس checksum) للإصدار الحالي - لا فائدة هندسية من تكراره.
 *  - الاستعادة تُنشئ إصدار جديد فعلي (وليس مجرد تأشير) بنفس محتوى الإصدار القديم،
 *    فيبقى التسلسل التاريخي الكامل محفوظاً كما ورد في المواصفة ("دون فقد التاريخ").
 *  - سجل تدقيق فعلي (Audit Log) موحّد مع بقية الجزء 1/10 لكل عملية.
 */

const fs = require('fs');
const path = require('path');

const DRAW = require('./drawingManagement');
const {
  loadDB, saveDB, logAudit, newId, nowISO, sha256, bytesToHuman, FILES_DIR,
} = DRAW._internal;

// ===================== أدوات داخلية =====================
function findDrawing(db, drawingId) {
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

function versionsOf(db, drawingId) {
  return db.versions
    .filter((v) => v.drawing_id === drawingId)
    .sort((a, b) => b.version_number - a.version_number);
}

function extensionFor(fileType) {
  return fileType === 'other_cad' ? 'bin' : fileType;
}

// ===================== 1) رفع إصدار جديد =====================
/**
 * رفع إصدار جديد فعلي لمخطط موجود (v2, v3, ...).
 * @param {string} drawingId
 * @param {Object} payload { content_base64, file_type(اختياري - نفس نوع المخطط افتراضياً),
 *                            change_note, actor }
 */
function uploadNewVersion(drawingId, payload = {}) {
  const { content_base64, file_type, change_note, actor } = payload;
  if (!content_base64) throw new Error('محتوى الملف (content_base64) مطلوب لرفع إصدار جديد');

  const db = loadDB();
  const rec = findDrawing(db, drawingId);

  const fileType = file_type ? String(file_type).toLowerCase().replace(/^\./, '') : rec.file_type;
  if (!DRAW.SUPPORTED_FILE_TYPES.includes(fileType)) {
    throw new Error(`نوع الملف غير مدعوم: ${fileType}`);
  }

  let buffer;
  try {
    buffer = Buffer.from(content_base64, 'base64');
  } catch (e) {
    throw new Error('تعذّر فك ترميز محتوى الملف (content_base64 غير صالح)');
  }
  if (!buffer.length) throw new Error('محتوى الملف فارغ');

  const checksum = sha256(buffer);
  const currentVersionRecord = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === rec.current_version);
  if (currentVersionRecord && currentVersionRecord.checksum_sha256 === checksum) {
    throw new Error('محتوى الملف مطابق تماماً للإصدار الحالي - لم يتم إنشاء إصدار جديد');
  }

  const nextVersionNumber = rec.current_version + 1;
  const versionId = newId('VER');
  const storedFileName = `${drawingId}_v${nextVersionNumber}.${extensionFor(fileType)}`;
  fs.writeFileSync(path.join(FILES_DIR, storedFileName), buffer);

  const versionRecord = {
    id: versionId,
    drawing_id: drawingId,
    version_number: nextVersionNumber,
    stored_file_name: storedFileName,
    file_type: fileType,
    file_size_bytes: buffer.length,
    file_size_human: bytesToHuman(buffer.length),
    checksum_sha256: checksum,
    uploaded_by: actor || null,
    uploaded_at: nowISO(),
    change_note: change_note || `تحديث إلى الإصدار ${nextVersionNumber}`,
    is_restore: false,
  };
  db.versions.push(versionRecord);

  // تحديث سجل المخطط الرئيسي ليعكس الإصدار الحالي الجديد
  rec.current_version = nextVersionNumber;
  rec.file_type = fileType;
  rec.file_size_bytes = buffer.length;
  rec.file_size_human = bytesToHuman(buffer.length);
  rec.checksum_sha256 = checksum;
  rec.stored_file_name = storedFileName;
  rec.updated_at = nowISO();
  // أي إصدار جديد فعلي على مخطط معتمد سابقاً يعيده لحالة "مراجعة" تلقائياً
  if (rec.approval_status === 'approved') rec.approval_status = 'under_review';

  logAudit(db, {
    action: 'upload_new_version',
    drawingId,
    actor,
    details: `تم رفع إصدار جديد (v${nextVersionNumber}) للمخطط (${rec.drawing_number}) - ${versionRecord.change_note}`,
  });
  saveDB(db);

  return { success: true, drawing: DRAW.getDrawing(drawingId), version: versionRecord };
}

// ===================== 2) سجل الإصدارات الكامل لمخطط =====================
function listVersions(drawingId) {
  const db = loadDB();
  findDrawing(db, drawingId); // للتحقق من الوجود ورمي خطأ واضح إن لم يوجد
  return { success: true, versions: versionsOf(db, drawingId) };
}

function getVersion(drawingId, versionNumber) {
  const db = loadDB();
  findDrawing(db, drawingId);
  const version = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === Number(versionNumber));
  if (!version) throw new Error(`الإصدار رقم (${versionNumber}) غير موجود لهذا المخطط`);
  return { success: true, version };
}

// ===================== 3) تنزيل ملف إصدار محدد (وليس الحالي فقط) =====================
function downloadVersionFile(drawingId, versionNumber, { actor } = {}) {
  const db = loadDB();
  const rec = findDrawing(db, drawingId);
  const version = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === Number(versionNumber));
  if (!version) throw new Error(`الإصدار رقم (${versionNumber}) غير موجود لهذا المخطط`);

  const filePath = path.join(FILES_DIR, version.stored_file_name);
  if (!fs.existsSync(filePath)) throw new Error('ملف هذا الإصدار غير موجود فعلياً على القرص');
  const buffer = fs.readFileSync(filePath);

  logAudit(db, {
    action: 'download_version',
    drawingId,
    actor,
    details: `تنزيل الإصدار v${versionNumber} من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return {
    success: true,
    drawing_number: rec.drawing_number,
    version_number: version.version_number,
    file_type: version.file_type,
    file_size_bytes: version.file_size_bytes,
    content_base64: buffer.toString('base64'),
  };
}

// ===================== 4) مقارنة إصدارين =====================
/**
 * مقارنة إصدارين لنفس المخطط: الفرق في الحجم، اختلاف المحتوى (checksum)،
 * من رفع كل إصدار ومتى، وملاحظة التغيير. هذه البيانات تُشكّل أيضاً الأساس
 * الذي سيُبنى عليه الجزء 7/10 (مقارنة المخططات بصرياً/على مستوى الطبقات).
 */
function compareVersions(drawingId, versionA, versionB) {
  const db = loadDB();
  const rec = findDrawing(db, drawingId);
  const vA = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === Number(versionA));
  const vB = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === Number(versionB));
  if (!vA) throw new Error(`الإصدار رقم (${versionA}) غير موجود لهذا المخطط`);
  if (!vB) throw new Error(`الإصدار رقم (${versionB}) غير موجود لهذا المخطط`);

  const identical = vA.checksum_sha256 === vB.checksum_sha256;
  const sizeDiffBytes = vB.file_size_bytes - vA.file_size_bytes;

  return {
    success: true,
    drawing_number: rec.drawing_number,
    identical_content: identical,
    size_diff_bytes: sizeDiffBytes,
    size_diff_human: `${sizeDiffBytes >= 0 ? '+' : ''}${bytesToHuman(Math.abs(sizeDiffBytes))}`,
    version_a: vA,
    version_b: vB,
    summary: identical
      ? 'الإصداران متطابقان تماماً من حيث المحتوى (نفس checksum)'
      : `الإصداران مختلفان في المحتوى، فرق الحجم: ${sizeDiffBytes >= 0 ? '+' : ''}${bytesToHuman(Math.abs(sizeDiffBytes))}`,
  };
}

// ===================== 5) استعادة إصدار سابق =====================
/**
 * استعادة إصدار سابق: تُنشئ إصدار جديد فعلي (v(n+1)) بنفس محتوى الإصدار القديم
 * ليصبح هو الحالي، دون حذف أو فقد أي إصدار من السجل التاريخي.
 */
function restoreVersion(drawingId, versionNumber, { actor } = {}) {
  const db = loadDB();
  const rec = findDrawing(db, drawingId);
  const oldVersion = db.versions.find((v) => v.drawing_id === drawingId && v.version_number === Number(versionNumber));
  if (!oldVersion) throw new Error(`الإصدار رقم (${versionNumber}) غير موجود لهذا المخطط`);
  if (oldVersion.version_number === rec.current_version) {
    throw new Error('هذا هو الإصدار الحالي بالفعل، لا حاجة لاستعادته');
  }

  const oldFilePath = path.join(FILES_DIR, oldVersion.stored_file_name);
  if (!fs.existsSync(oldFilePath)) throw new Error('ملف الإصدار القديم غير موجود فعلياً على القرص - تعذّرت الاستعادة');
  const oldBuffer = fs.readFileSync(oldFilePath);

  const result = uploadNewVersion(drawingId, {
    content_base64: oldBuffer.toString('base64'),
    file_type: oldVersion.file_type,
    change_note: `استعادة من الإصدار v${oldVersion.version_number}`,
    actor,
  });

  // تعليم آخر إصدار (الذي أُنشئ للتو) كإصدار "استعادة" لتمييزه في السجل
  const db2 = loadDB();
  const newestVersion = db2.versions
    .filter((v) => v.drawing_id === drawingId)
    .sort((a, b) => b.version_number - a.version_number)[0];
  if (newestVersion) {
    newestVersion.is_restore = true;
    newestVersion.restored_from_version = oldVersion.version_number;
    saveDB(db2);
  }

  return result;
}

module.exports = {
  uploadNewVersion,
  listVersions,
  getVersion,
  downloadVersionFile,
  compareVersions,
  restoreVersion,
};
