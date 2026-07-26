/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء 7/10 (3 من 3): الصور والمرفقات المرتبطة بالتقارير
 *
 * نفس نمط استقبال content_base64 المستخدَم في documentManagement.js (القسم 11)،
 * مع تخزين فعلي على القرص في backend/data/report_attachments/ + checksum SHA-256
 * حقيقي لكل ملف (للتحقق من عدم تلف/تبديل الملف لاحقاً)، بدون أي تبعيات خارجية.
 *
 * كل مرفق يُربَط إلزامياً بسجل تقرير موجود فعلياً في reportsCenter (يتحقق من وجوده)،
 * ويمكن إضافياً ربطه بنشاط/بند محدد داخل التقرير (activity_ref) لتوثيق دقيق.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ReportsCenter = require('./reportsCenter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportsCenter.json');
const FILES_DIR = path.join(DATA_DIR, 'report_attachments');

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB لكل مرفق
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.dwg', '.dxf'];

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      reportRecords: {}, templates: {}, scheduledReports: {}, shares: {}, auditLog: [], seq: 0,
    }, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureDirs();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات نظام التقارير: ' + e.message);
  }
  if (!store.attachments) store.attachments = {}; // { id: attachmentRecord }
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

function computeChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * إضافة مرفق/صورة فعلية إلى تقرير موجود. يتحقق من وجود سجل التقرير في reportsCenter،
 * يفك ترميز base64 فعلياً، يتحقق من الحجم والامتداد، يكتب الملف على القرص، ويحسب
 * checksum حقيقياً - وليس مجرد رابط أو اسم ملف بلا محتوى.
 */
function addAttachment(reportRecordId, {
  fileName, contentBase64, mimeType = null, description = null, location = null,
  activityRef = null, capturedAt = null, userId = null,
} = {}) {
  if (!fileName) throw new Error('اسم الملف (fileName) مطلوب');
  if (!contentBase64) throw new Error('محتوى الملف (contentBase64) مطلوب');

  const reportRec = ReportsCenter.getReportRecord(reportRecordId); // يرمي خطأ إن لم يوجد فعلياً

  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`امتداد الملف غير مدعوم (${ext || 'بدون امتداد'}). المسموح: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  let buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch (e) {
    throw new Error('تعذّر فك ترميز محتوى الملف (contentBase64 غير صالح)');
  }
  if (!buffer.length) throw new Error('محتوى الملف فارغ بعد فك الترميز');
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`حجم الملف (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) يتجاوز الحد الأقصى المسموح (20MB)`);
  }

  const store = loadStore();
  const id = newId('RATT');
  const storedFileName = `${id}${ext}`;
  const checksum = computeChecksum(buffer);
  fs.writeFileSync(path.join(FILES_DIR, storedFileName), buffer);

  const record = {
    id,
    report_record_id: reportRecordId,
    project_id: reportRec.project_id,
    original_file_name: fileName,
    stored_file_name: storedFileName,
    mime_type: mimeType || null,
    size_bytes: buffer.length,
    checksum_sha256: checksum,
    description: description || null,
    location: location || null,
    activity_ref: activityRef || null,
    captured_at: capturedAt || nowISO(),
    uploaded_by: userId,
    uploaded_at: nowISO(),
  };
  store.attachments[id] = record;

  audit(store, {
    action: 'add_report_attachment', entity: 'report_attachment', entityId: id,
    projectId: reportRec.project_id, userId, details: { report_record_id: reportRecordId, file_name: fileName, size_bytes: buffer.length },
  });
  saveStore(store);

  const { stored_file_name, ...publicRecord } = record;
  return publicRecord;
}

function listAttachments(reportRecordId) {
  const store = loadStore();
  return Object.values(store.attachments)
    .filter((a) => a.report_record_id === reportRecordId)
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
    .map(({ stored_file_name, ...rest }) => rest);
}

function getAttachmentFile(attachmentId) {
  const store = loadStore();
  const att = store.attachments[attachmentId];
  if (!att) throw new Error('المرفق غير موجود');
  const filePath = path.join(FILES_DIR, att.stored_file_name);
  if (!fs.existsSync(filePath)) throw new Error('ملف المرفق غير موجود فعلياً على القرص (تلف أو حذف خارجي)');
  const buffer = fs.readFileSync(filePath);
  const currentChecksum = computeChecksum(buffer);
  return {
    original_file_name: att.original_file_name,
    mime_type: att.mime_type,
    content_base64: buffer.toString('base64'),
    checksum_sha256: att.checksum_sha256,
    checksum_verified: currentChecksum === att.checksum_sha256,
  };
}

function updateAttachmentMeta(attachmentId, { description, location, activityRef } = {}, userId = null) {
  const store = loadStore();
  const att = store.attachments[attachmentId];
  if (!att) throw new Error('المرفق غير موجود');
  if (description !== undefined) att.description = description;
  if (location !== undefined) att.location = location;
  if (activityRef !== undefined) att.activity_ref = activityRef;
  audit(store, {
    action: 'update_report_attachment', entity: 'report_attachment', entityId: attachmentId,
    projectId: att.project_id, userId,
  });
  saveStore(store);
  const { stored_file_name, ...rest } = att;
  return rest;
}

function deleteAttachment(attachmentId, userId = null) {
  const store = loadStore();
  const att = store.attachments[attachmentId];
  if (!att) throw new Error('المرفق غير موجود');
  const filePath = path.join(FILES_DIR, att.stored_file_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  delete store.attachments[attachmentId];
  audit(store, {
    action: 'delete_report_attachment', entity: 'report_attachment', entityId: attachmentId,
    projectId: att.project_id, userId, details: { file_name: att.original_file_name },
  });
  saveStore(store);
  return { success: true, deleted_id: attachmentId };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  addAttachment,
  listAttachments,
  getAttachmentFile,
  updateAttachmentMeta,
  deleteAttachment,
};
