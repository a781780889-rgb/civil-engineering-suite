/**
 * القسم الحادي عشر - نظام إدارة المستندات (DMS)
 * وحدة النسخ الاحتياطي والاستعادة (Backup & Restore)
 * =====================================================================================
 * منفصلة عن النسخ الاحتياطي العام للمنصة (businessSecurity.createBackup الذي يشمل
 * كل ملفات data/*.json بما فيها dms.json ضمنياً)، وتغطي متطلباً إضافياً غير موجود في
 * أي نسخة احتياطية أخرى بالنظام: نسخ **الملفات الثنائية الفعلية** المرفوعة (dms_files/)
 * إلى جانب البيانات الوصفية (dms.json)، لأن استعادة قاعدة بيانات DMS بدون الملفات
 * الفعلية المرتبطة بها عديمة الفائدة عملياً (سجلات تشير لملفات غير موجودة).
 *
 * يدعم:
 *  - نسخ احتياطي كامل (Full): dms.json + كل ملفات dms_files/ الفعلية، داخل حاوية
 *    واحدة مضغوطة فعلياً بـ gzip (بدون أي تبعيات خارجية).
 *  - نسخ احتياطي للبيانات الوصفية فقط (Metadata-only): أسرع وأصغر حجماً، لحالات
 *    الاستخدام التي لا تحتاج نسخ الملفات الثنائية (مثل نسخة يومية سريعة).
 *  - استعادة كاملة مع أخذ نسخة أمان تلقائية للحالة الحالية قبل أي استبدال.
 *  - التحقق من سلامة نسخة احتياطية (checksum SHA-256 لكل ملف داخلها) قبل اعتمادها
 *    للاستعادة، ورفض أي نسخة تالفة بدل استعادة بيانات فاسدة بصمت.
 *  - حفظ النسخ في أكثر من موقع فعلياً (مجلد أساسي محلي + مجلد ثانوي اختياري عبر
 *    متغير البيئة DMS_BACKUP_SECONDARY_DIR، مثل قرص/تخزين شبكي مثبَّت على الخادم).
 *  - جدولة نسخ احتياطي تلقائي دوري.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'dms_files');
const DB_FILE = path.join(DATA_DIR, 'dms.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups', 'dms');

function nowISO() { return new Date().toISOString(); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function getSecondaryDir() {
  const dir = process.env.DMS_BACKUP_SECONDARY_DIR;
  return dir && dir.trim() ? dir.trim() : null;
}

// ==================================================================================
// ============ طبقة أرشفة بسيطة (Container Format) بدون تبعيات خارجية ==============
// ==================================================================================
// تُستخدَم صيغة حاوية JSON مضغوطة بـ gzip بدل ZIP فعلي، لتفادي إعادة تطبيق كاتب ZIP
// معقّد؛ الحاوية تخزّن dms.json + كل ملف من dms_files كـ base64 داخل بنية واحدة، ثم
// تُضغَط الحاوية بأكملها عبر gzip (Node الأصلي، بدون مكتبات خارجية) لتقليل الحجم على
// القرص بشكل حقيقي - وليس مجرد نسخ خام للملفات.

function buildContainer({ includeFiles = true } = {}) {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) throw new Error('قاعدة بيانات إدارة المستندات (dms.json) غير موجودة بعد');

  const dbBuffer = fs.readFileSync(DB_FILE);
  const container = {
    format: 'dms-backup-v1',
    created_at: nowISO(),
    includes_files: includeFiles,
    db: {
      file_name: 'dms.json',
      content_base64: dbBuffer.toString('base64'),
      checksum_sha256: sha256(dbBuffer),
      size_bytes: dbBuffer.length,
    },
    files: [],
  };

  if (includeFiles && fs.existsSync(FILES_DIR)) {
    const fileNames = fs.readdirSync(FILES_DIR).filter((f) => fs.statSync(path.join(FILES_DIR, f)).isFile());
    for (const fName of fileNames) {
      const buf = fs.readFileSync(path.join(FILES_DIR, fName));
      container.files.push({
        file_name: fName,
        content_base64: buf.toString('base64'),
        checksum_sha256: sha256(buf),
        size_bytes: buf.length,
      });
    }
  }

  return container;
}

function writeContainerCompressed(container, outputPath) {
  const json = JSON.stringify(container);
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
  fs.writeFileSync(outputPath, compressed);
  return compressed.length;
}

function readContainerCompressed(inputPath) {
  const compressed = fs.readFileSync(inputPath);
  const json = zlib.gunzipSync(compressed).toString('utf8');
  return JSON.parse(json);
}

// ==================================================================================
// ==================================== إنشاء نسخة احتياطية ==========================
// ==================================================================================

/**
 * ينشئ نسخة احتياطية فعلية (dms.json + ملفات dms_files حسب includeFiles) مضغوطة
 * على القرص، وينسخها أيضاً لموقع ثانوي إن كان مضبوطاً عبر DMS_BACKUP_SECONDARY_DIR.
 */
function createDmsBackup({ label = null, includeFiles = true, actor = null } = {}) {
  ensureDirs();
  const container = buildContainer({ includeFiles });

  const fileName = `dms-backup-${includeFiles ? 'full' : 'meta'}-${Date.now()}.dmsbak`;
  const outputPath = path.join(BACKUPS_DIR, fileName);
  const compressedSize = writeContainerCompressed(container, outputPath);

  // التحقق الفوري من سلامة ما كُتب فعلياً على القرص قبل اعتباره ناجحاً
  const verify = verifyBackupIntegrity(fileName);
  if (!verify.valid) {
    fs.unlinkSync(outputPath);
    throw new Error(`فشل إنشاء نسخة احتياطية سليمة: ${verify.reason}`);
  }

  let secondaryCopyPath = null;
  const secondaryDir = getSecondaryDir();
  if (secondaryDir) {
    try {
      if (!fs.existsSync(secondaryDir)) fs.mkdirSync(secondaryDir, { recursive: true });
      secondaryCopyPath = path.join(secondaryDir, fileName);
      fs.copyFileSync(outputPath, secondaryCopyPath);
    } catch (e) {
      secondaryCopyPath = null; // لا نفشل عملية النسخ الأساسية إن تعذّر الموقع الثانوي فقط
    }
  }

  appendMeta({
    action: 'backup_create',
    fileName,
    label: label || null,
    includeFiles,
    filesCount: container.files.length,
    dbSizeBytes: container.db.size_bytes,
    compressedSizeBytes: compressedSize,
    secondaryCopyPath,
    actor,
  });

  return {
    success: true,
    data: {
      fileName,
      label: label || null,
      includeFiles,
      filesCount: container.files.length,
      dbSizeBytes: container.db.size_bytes,
      compressedSizeBytes: compressedSize,
      storedAtLocations: [outputPath, ...(secondaryCopyPath ? [secondaryCopyPath] : [])],
      created_at: container.created_at,
    },
  };
}

// ==================================================================================
// ==================================== سرد النسخ =====================================
// ==================================================================================

function listDmsBackups() {
  ensureDirs();
  const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.dmsbak'));
  const meta = loadMeta();
  const data = files.map((f) => {
    const full = path.join(BACKUPS_DIR, f);
    const stat = fs.statSync(full);
    const metaEntry = meta.entries.find((e) => e.fileName === f) || null;
    return {
      fileName: f,
      sizeBytes: stat.size,
      created_at: metaEntry?.created_at || stat.mtime.toISOString(),
      label: metaEntry?.label || null,
      includeFiles: metaEntry?.includeFiles ?? null,
      filesCount: metaEntry?.filesCount ?? null,
      hasSecondaryCopy: Boolean(metaEntry?.secondaryCopyPath),
    };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return { success: true, data };
}

// ==================================================================================
// ============================ التحقق من سلامة نسخة احتياطية ========================
// ==================================================================================

/** يتحقق من سلامة نسخة احتياطية عبر إعادة حساب checksum لكل ملف داخلها ومقارنته بالمخزَّن */
function verifyBackupIntegrity(fileName) {
  ensureDirs();
  const full = path.join(BACKUPS_DIR, fileName);
  if (!full.startsWith(BACKUPS_DIR) || !fs.existsSync(full)) {
    return { valid: false, reason: 'ملف النسخة الاحتياطية غير موجود' };
  }

  let container;
  try {
    container = readContainerCompressed(full);
  } catch (e) {
    return { valid: false, reason: 'تعذّر فك ضغط/قراءة ملف النسخة الاحتياطية (تالف)' };
  }

  if (!container || container.format !== 'dms-backup-v1' || !container.db) {
    return { valid: false, reason: 'صيغة النسخة الاحتياطية غير معروفة أو غير صالحة' };
  }

  const dbBuffer = Buffer.from(container.db.content_base64, 'base64');
  if (sha256(dbBuffer) !== container.db.checksum_sha256) {
    return { valid: false, reason: 'فشل التحقق من سلامة قاعدة البيانات (dms.json) داخل النسخة - checksum غير مطابق' };
  }

  const brokenFiles = [];
  for (const f of container.files || []) {
    const buf = Buffer.from(f.content_base64, 'base64');
    if (sha256(buf) !== f.checksum_sha256) brokenFiles.push(f.file_name);
  }
  if (brokenFiles.length) {
    return { valid: false, reason: `فشل التحقق من سلامة ${brokenFiles.length} ملف داخل النسخة الاحتياطية`, brokenFiles };
  }

  return {
    valid: true,
    reason: null,
    checkedFiles: (container.files || []).length,
    dbSizeBytes: container.db.size_bytes,
    created_at: container.created_at,
    includesFiles: container.includes_files,
  };
}

// ==================================================================================
// ==================================== الاستعادة =====================================
// ==================================================================================

/**
 * يستعيد قاعدة بيانات DMS (وملفات dms_files إن كانت النسخة كاملة) من نسخة احتياطية
 * محددة، بعد التحقق الإلزامي من سلامتها، مع أخذ نسخة أمان تلقائية للحالة الحالية أولاً.
 */
function restoreDmsBackup(fileName, { actor = null, restoreFilesToo = true } = {}) {
  ensureDirs();

  const verify = verifyBackupIntegrity(fileName);
  if (!verify.valid) {
    throw new Error(`تعذّرت الاستعادة: النسخة الاحتياطية غير سليمة (${verify.reason})`);
  }

  // نسخة أمان تلقائية للحالة الحالية قبل أي استبدال، لإمكانية التراجع الحقيقي
  let autoSafetyBackup = null;
  try {
    autoSafetyBackup = createDmsBackup({ label: 'auto-before-restore', includeFiles: true, actor });
  } catch (e) {
    // إن لم توجد بيانات حالية أصلاً (أول استخدام)، نتابع الاستعادة دون نسخة أمان
    autoSafetyBackup = null;
  }

  const full = path.join(BACKUPS_DIR, fileName);
  const container = readContainerCompressed(full);

  // استعادة قاعدة البيانات الوصفية
  const dbBuffer = Buffer.from(container.db.content_base64, 'base64');
  fs.writeFileSync(DB_FILE, dbBuffer);

  // استعادة الملفات الثنائية الفعلية (إن طُلب ذلك وكانت النسخة تحتويها)
  let restoredFilesCount = 0;
  if (restoreFilesToo && container.includes_files && Array.isArray(container.files)) {
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
    for (const f of container.files) {
      const buf = Buffer.from(f.content_base64, 'base64');
      fs.writeFileSync(path.join(FILES_DIR, f.file_name), buf);
      restoredFilesCount += 1;
    }
  }

  appendMeta({
    action: 'backup_restore',
    fileName,
    actor,
    restoredFilesCount,
    autoSafetyBackupFileName: autoSafetyBackup?.data?.fileName || null,
  });

  return {
    success: true,
    data: {
      restoredFrom: fileName,
      restored_at: nowISO(),
      restoredFilesCount,
      autoSafetyBackupFileName: autoSafetyBackup?.data?.fileName || null,
    },
  };
}

// ==================================================================================
// ============================ سجل عمليات النسخ (Meta) ==============================
// ==================================================================================

const META_FILE = path.join(BACKUPS_DIR, '_meta.json');

function loadMeta() {
  ensureDirs();
  if (!fs.existsSync(META_FILE)) return { entries: [] };
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch (e) {
    return { entries: [] };
  }
}

function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

function appendMeta(entry) {
  const meta = loadMeta();
  meta.entries.push({ ...entry, created_at: nowISO() });
  if (meta.entries.length > 500) meta.entries = meta.entries.slice(-500);
  saveMeta(meta);
}

/** سجل عمليات النسخ الاحتياطي/الاستعادة الخاص بـ DMS فقط (منفصل عن سجل التدقيق العام للمستندات) */
function getBackupOperationsLog({ limit = 100 } = {}) {
  const meta = loadMeta();
  const items = [...meta.entries].reverse().slice(0, limit);
  return { success: true, data: items };
}

// ==================================================================================
// ==================================== الجدولة التلقائية ============================
// ==================================================================================

let autoBackupInterval = null;

/** يجدول نسخاً احتياطياً كاملاً تلقائياً بشكل دوري */
function scheduleAutoDmsBackup({ intervalHours = 24, includeFiles = true } = {}) {
  if (autoBackupInterval) clearInterval(autoBackupInterval);
  autoBackupInterval = setInterval(() => {
    try {
      createDmsBackup({ label: 'auto-scheduled', includeFiles, actor: 'system:auto-backup' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('فشلت النسخة الاحتياطية التلقائية لإدارة المستندات:', e.message);
    }
  }, intervalHours * 60 * 60 * 1000);
  if (typeof autoBackupInterval.unref === 'function') autoBackupInterval.unref();
  return { success: true, data: { scheduled: true, intervalHours, includeFiles } };
}

/** يحذف نسخة احتياطية محددة (من الموقع الأساسي فقط؛ الموقع الثانوي يُدار خارجياً) */
function deleteDmsBackup(fileName, { actor = null } = {}) {
  ensureDirs();
  const full = path.join(BACKUPS_DIR, fileName);
  if (!full.startsWith(BACKUPS_DIR) || !fs.existsSync(full)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود');
  }
  fs.unlinkSync(full);
  appendMeta({ action: 'backup_delete', fileName, actor });
  return { success: true, data: { deleted: fileName } };
}

module.exports = {
  createDmsBackup,
  listDmsBackups,
  verifyBackupIntegrity,
  restoreDmsBackup,
  deleteDmsBackup,
  getBackupOperationsLog,
  scheduleAutoDmsBackup,
};
