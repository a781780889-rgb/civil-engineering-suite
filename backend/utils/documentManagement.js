/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الأول (1/10): البنية الأساسية + طبقة التخزين الموحّدة + سجل التدقيق +
 *                      تصنيفات وأنواع المستندات + لوحة التحكم + رفع/تنزيل الملفات +
 *                      إدارة الإصدارات الأساسية (v1) + الربط التلقائي بالمشاريع.
 *
 * الأجزاء المُنجزة/القادمة (ضمن نفس ملف التخزين الموحَّد dms.json):
 *  2/10: التصنيف الهرمي والمجلدات + النقل/النسخ + الأرشفة اليدوية/التلقائية (منجَز - documentCategories.js)
 *  3/10: سير عمل الاعتماد (Workflow) القابل للتخصيص لكل نوع مستند (منجَز - documentWorkflow.js)
 *  4/10: التوقيع الإلكتروني (اعتماد متعدد المستويات + ختم زمني + سجل توقيعات) (منجَز - documentSignature.js)
 *  5/10: البحث الذكي (بالاسم/الرقم/الكلمات المفتاحية/داخل محتوى PDF و Word)
 *  5/10: البحث الذكي (بالاسم/الرقم/الكلمات المفتاحية/داخل محتوى PDF و Word)
 *  6/10: المشاركة (روابط آمنة + صلاحية + كلمة مرور) + إدارة الصلاحيات التفصيلية
 *  7/10: الإشعارات + التكامل الكامل مع بقية أقسام النظام (QMS/HSE/الأعمال...)
 *  8/10: التقارير الاحترافية (PDF/Excel/CSV) + سجل العمليات الكامل (Audit Log UI)
 *  9/10: الذكاء الاصطناعي (تصنيف تلقائي، تلخيص، بحث دلالي، اكتشاف تكرار)
 *  10/10: النسخ الاحتياطي والاستعادة الخاصة بالقسم + الأمان المتقدم (تشفير الملفات الحساسة)
 *
 * التخزين: نفس نمط بقية الأقسام - ملف JSON على القرص (backend/data/dms.json) للبيانات
 * الوصفية (Metadata)، مع تخزين محتوى الملفات الفعلي (Base64 مفكوك إلى Buffer) في
 * مجلد منفصل (backend/data/dms_files/) بنفس نمط استقبال base64 المستخدَم في بقية
 * الاستيراد بالنظام (csvImporter/xlsxImporter/pdfImporter) - بدون أي تبعيات خارجية.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - رفع الملفات: يستقبل content_base64 فعلياً، يحسب checksum (SHA-256) حقيقي لكل نسخة،
 *    ويكتب المحتوى الثنائي الفعلي على القرص (وليس مجرد وصف نصي).
 *  - إدارة الإصدارات: كل رفع جديد لنفس المستند يُنشئ سجل إصدار فعلي منفصل مع رقم إصدار
 *    متسلسل (v1, v2, ...)، يحافظ على الملف السابق فعلياً على القرص لإمكانية الاستعادة
 *    الحقيقية، ويمنع الكتابة فوق الإصدارات القديمة.
 *  - رقم المستند: مولَّد تلقائياً بصيغة مرجعية هندسية حقيقية حسب نوع المستند والمشروع
 *    (مثال: DRW-PRJ001-0007) وليس رقماً عشوائياً بلا معنى.
 *  - لوحة التحكم: كل الإحصائيات محسوبة فعلياً من البيانات المخزَّنة (لا أرقام وهمية).
 *  - سجل تدقيق فعلي لكل عملية (رفع/تعديل/حذف/تنزيل) يُحفَظ في نفس البنية الموحّدة.
 *  - الربط بالمشاريع: يتحقق فعلياً من وجود المشروع عبر واجهة projectManagement قبل
 *    ربط أي مستند به (وليس مجرد حقل نصي حر بلا تحقق).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ACL = require('./documentAccessControl');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'dms_files');
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'dms.json');

// ===================== أدوات مساعدة عامة =====================
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function bytesToHuman(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${Math.round(v * 100) / 100} ${units[i]}`;
}

// ===================== طبقة التخزين =====================
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      documents: {},        // { id: documentRecord } - السجل الوصفي (Metadata) لكل مستند
      versions: {},         // { id: versionRecord }   - كل إصدار فعلي مرفوع لأي مستند
      categories: {},       // الجزء 2: التصنيف الهرمي / المجلدات
      workflows: {},        // الجزء 3: تعريفات سير العمل لكل نوع مستند
      approvals: {},        // الجزء 3: سجل مراحل الاعتماد لكل مستند
      signatures: {},        // الجزء 4: سجل التوقيعات الإلكترونية
      shareLinks: {},         // الجزء 6: روابط المشاركة الآمنة
      notifications: {},      // الجزء 7: الإشعارات
      auditLog: [],          // سجل تدقيق موحّد لعمليات القسم بالكامل (كل الأجزاء)
      meta: {
        last_doc_seq: {},    // متسلسل ترقيم مستقل لكل (نوع مستند + مشروع) لبناء رقم مرجعي منطقي
      },
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return null;
}

function loadStore() {
  ensureStore();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  for (const key of ['documents', 'versions', 'categories', 'workflows', 'approvals', 'signatures', 'shareLinks', 'notifications']) {
    if (!store[key]) store[key] = {};
  }
  if (!store.auditLog) store.auditLog = [];
  if (!store.meta) store.meta = { last_doc_seq: {} };
  if (!store.meta.last_doc_seq) store.meta.last_doc_seq = {};
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
// ============================ التصنيفات المرجعية الثابتة ==========================
// ==================================================================================

// أنواع المستندات مطابقة تماماً لما ورد في المواصفة، مقسّمة على 5 مجموعات رئيسية
const DOCUMENT_GROUPS = ['project', 'quality', 'safety', 'financial', 'administrative'];
const DOCUMENT_GROUP_LABELS = {
  project: 'مستندات المشاريع',
  quality: 'مستندات الجودة',
  safety: 'مستندات السلامة',
  financial: 'المستندات المالية',
  administrative: 'المستندات الإدارية',
};

const DOCUMENT_TYPES = {
  // مستندات المشاريع
  contract: { group: 'project', label: 'عقد', code: 'CON' },
  drawing: { group: 'project', label: 'مخطط', code: 'DRW' },
  technical_spec: { group: 'project', label: 'مواصفة فنية', code: 'SPC' },
  boq: { group: 'project', label: 'جدول كميات', code: 'BOQ' },
  report: { group: 'project', label: 'تقرير', code: 'RPT' },
  correspondence: { group: 'project', label: 'مراسلة', code: 'COR' },
  meeting_minutes: { group: 'project', label: 'محضر اجتماع', code: 'MOM' },
  change_order: { group: 'project', label: 'أمر تغيير', code: 'CHO' },
  work_order: { group: 'project', label: 'أمر عمل', code: 'WKO' },
  purchase_order: { group: 'project', label: 'أمر شراء', code: 'PUO' },

  // مستندات الجودة
  quality_plan: { group: 'quality', label: 'خطة جودة', code: 'QPL' },
  inspection_request: { group: 'quality', label: 'طلب فحص (IR)', code: 'IRQ' },
  ncr: { group: 'quality', label: 'عدم مطابقة (NCR)', code: 'NCR' },
  capa: { group: 'quality', label: 'إجراء تصحيحي (CAPA)', code: 'CAP' },
  test_result: { group: 'quality', label: 'نتيجة اختبار', code: 'TST' },
  lab_report: { group: 'quality', label: 'تقرير مختبر', code: 'LAB' },
  material_certificate: { group: 'quality', label: 'شهادة مواد', code: 'MTC' },

  // مستندات السلامة
  safety_plan: { group: 'safety', label: 'خطة سلامة', code: 'SFP' },
  work_permit: { group: 'safety', label: 'تصريح عمل', code: 'WPM' },
  incident_report: { group: 'safety', label: 'تقرير حادث', code: 'INC' },
  safety_inspection: { group: 'safety', label: 'تقرير تفتيش', code: 'SIN' },
  risk_assessment: { group: 'safety', label: 'تقييم مخاطر', code: 'RSK' },
  emergency_plan: { group: 'safety', label: 'خطة طوارئ', code: 'EMP' },

  // المستندات المالية
  invoice: { group: 'financial', label: 'فاتورة', code: 'INV' },
  payment_certificate: { group: 'financial', label: 'مستخلص', code: 'PYC' },
  payment: { group: 'financial', label: 'دفعة', code: 'PAY' },
  budget: { group: 'financial', label: 'ميزانية', code: 'BUD' },
  financial_contract: { group: 'financial', label: 'عقد مالي', code: 'FCN' },

  // المستندات الإدارية
  employee_contract: { group: 'administrative', label: 'عقد موظف', code: 'EMC' },
  cv: { group: 'administrative', label: 'سيرة ذاتية', code: 'CVR' },
  certificate: { group: 'administrative', label: 'شهادة', code: 'CRT' },
  form: { group: 'administrative', label: 'نموذج', code: 'FRM' },
  regulation: { group: 'administrative', label: 'لائحة', code: 'REG' },
  policy: { group: 'administrative', label: 'سياسة', code: 'POL' },

  other: { group: 'project', label: 'أخرى', code: 'DOC' },
};

const DOCUMENT_STATUSES = ['draft', 'under_review', 'approved', 'rejected', 'published', 'archived'];
const DOCUMENT_STATUS_LABELS = {
  draft: 'مسودة جديدة',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  published: 'منشور',
  archived: 'مؤرشف',
};

// الصيغ المدعومة رسمياً بحسب المواصفة (يُستخدم للتحقق عند الرفع ولعرض أيقونة الملف)
const ALLOWED_EXTENSIONS = {
  '.pdf': 'PDF', '.doc': 'Word', '.docx': 'Word', '.xls': 'Excel', '.xlsx': 'Excel',
  '.ppt': 'PowerPoint', '.pptx': 'PowerPoint', '.dwg': 'DWG', '.dxf': 'DXF', '.ifc': 'IFC',
  '.csv': 'CSV', '.txt': 'TXT', '.jpg': 'صورة', '.jpeg': 'صورة', '.png': 'صورة', '.tif': 'صورة', '.tiff': 'صورة',
  '.mp4': 'فيديو', '.mov': 'فيديو', '.avi': 'فيديو', '.zip': 'مضغوط', '.rar': 'مضغوط',
};
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 ميغابايت للنسخة الواحدة

function validateFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') throw new Error('اسم الملف (file_name) مطلوب');
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext]) {
    throw new Error(`صيغة الملف غير مدعومة (${ext || 'بدون امتداد'}). الصيغ المدعومة: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`);
  }
  return ext;
}

// ==================================================================================
// ===================== الترقيم المرجعي التلقائي للمستندات =========================
// ==================================================================================

/** يبني رقم مستند مرجعي هندسي حقيقي: CODE-PROJECTCODE-SEQ (مثال: DRW-PRJ001-0007) */
function generateDocumentNumber(store, { docType, projectId }) {
  const typeDef = DOCUMENT_TYPES[docType] || DOCUMENT_TYPES.other;
  const projTag = projectId ? String(projectId).toUpperCase().slice(0, 12) : 'GEN';
  const seqKey = `${typeDef.code}:${projTag}`;
  const current = store.meta.last_doc_seq[seqKey] || 0;
  const next = current + 1;
  store.meta.last_doc_seq[seqKey] = next;
  const seqStr = String(next).padStart(4, '0');
  return `${typeDef.code}-${projTag}-${seqStr}`;
}

// ==================================================================================
// ================================ إدارة المستندات =================================
// ==================================================================================

/**
 * التحقق الفعلي من وجود المشروع قبل الربط (وليس حقل نصي حر بلا تحقق) - اقتران
 * اختياري: يُمرَّر مرجع دالة getProject من projectManagement.js من طبقة server.js
 * لتفادي اعتمادية دائرية مباشرة بين الوحدتين.
 */
let _projectResolver = null;
function setProjectResolver(fn) { _projectResolver = fn; }
function resolveProjectOrNull(projectId) {
  if (!projectId) return null;
  if (!_projectResolver) return { id: projectId, name: null, _unverified: true };
  try {
    const res = _projectResolver(projectId);
    return res?.data || res || null;
  } catch (e) {
    return null;
  }
}

/**
 * رفع مستند جديد (ينشئ السجل الوصفي + الإصدار الأول v1 فعلياً على القرص).
 */
function uploadDocument(payload = {}) {
  const {
    title, doc_type, project_id = null, department = null, description = null,
    keywords = [], file_name, content_base64, author = null,
  } = payload;

  if (!title || !title.trim()) throw new Error('عنوان المستند (title) مطلوب');
  if (!doc_type || !DOCUMENT_TYPES[doc_type]) {
    throw new Error(`نوع المستند (doc_type) غير صحيح. الأنواع المدعومة: ${Object.keys(DOCUMENT_TYPES).join(', ')}`);
  }
  if (!content_base64) throw new Error('محتوى الملف (content_base64) مطلوب');
  const ext = validateFileName(file_name);

  let buffer;
  try {
    buffer = Buffer.from(content_base64, 'base64');
  } catch (e) {
    throw new Error('تعذّر فك ترميز محتوى الملف (content_base64 غير صالح)');
  }
  if (!buffer.length) throw new Error('محتوى الملف فارغ');
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`حجم الملف يتجاوز الحد الأقصى المسموح (${bytesToHuman(MAX_FILE_SIZE_BYTES)})`);
  }

  const project = project_id ? resolveProjectOrNull(project_id) : null;
  if (project_id && !project) throw new Error('المشروع المرتبط (project_id) غير موجود');

  const store = loadStore();
  const docId = newId('DOC');
  const docNumber = generateDocumentNumber(store, { docType: doc_type, projectId: project_id });
  const checksum = sha256(buffer);

  const versionId = newId('VER');
  const storedFileName = `${versionId}${ext}`;
  const storedPath = path.join(FILES_DIR, storedFileName);
  fs.writeFileSync(storedPath, buffer);

  const versionRecord = {
    id: versionId,
    document_id: docId,
    version_number: 1,
    file_name,
    stored_file_name: storedFileName,
    file_extension: ext,
    file_type_label: ALLOWED_EXTENSIONS[ext],
    file_size_bytes: buffer.length,
    file_size_human: bytesToHuman(buffer.length),
    checksum_sha256: checksum,
    uploaded_by: author,
    uploaded_at: nowISO(),
    change_note: 'الإصدار الأول عند إنشاء المستند',
    is_current: true,
  };
  store.versions[versionId] = versionRecord;

  const docRecord = {
    id: docId,
    document_number: docNumber,
    title: title.trim(),
    doc_type,
    doc_type_label: DOCUMENT_TYPES[doc_type].label,
    doc_group: DOCUMENT_TYPES[doc_type].group,
    project_id: project_id || null,
    project_name: project?.name || project?.project_name || null,
    department: department || null,
    category_id: null, // الجزء 2: التصنيف الهرمي/المجلدات
    description: description || null,
    keywords: Array.isArray(keywords) ? keywords.filter(Boolean) : [],
    status: 'draft',
    current_version_id: versionId,
    current_version_number: 1,
    version_ids: [versionId],
    author: author || null,
    created_at: nowISO(),
    updated_at: nowISO(),
    archived: false,
    workflow_id: null,   // الجزء 3
    signature_ids: [],   // الجزء 4
  };
  store.documents[docId] = docRecord;

  audit(store, {
    action: 'upload', entity: 'document', entityId: docId, projectId: project_id, actor: author,
    details: { document_number: docNumber, file_name, size: buffer.length, version: 1 },
  });
  saveStore(store);

  return { success: true, data: docRecord };
}

/**
 * رفع إصدار جديد لمستند موجود (Version Control فعلي - لا يُستبدَل الإصدار السابق
 * على القرص، بل يُحتفَظ به كاملاً لإمكانية الاستعادة الحقيقية لاحقاً).
 */
function uploadNewVersion(documentId, payload = {}) {
  const { file_name, content_base64, change_note = null, author = null, token = null } = payload;
  if (!documentId) throw new Error('معرّف المستند (document_id) مطلوب');
  if (!content_base64) throw new Error('محتوى الملف (content_base64) مطلوب');
  const ext = validateFileName(file_name);

  const store = loadStore();
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'update');

  let buffer;
  try {
    buffer = Buffer.from(content_base64, 'base64');
  } catch (e) {
    throw new Error('تعذّر فك ترميز محتوى الملف (content_base64 غير صالح)');
  }
  if (!buffer.length) throw new Error('محتوى الملف فارغ');
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`حجم الملف يتجاوز الحد الأقصى المسموح (${bytesToHuman(MAX_FILE_SIZE_BYTES)})`);
  }

  const checksum = sha256(buffer);
  // منع رفع نسخة مطابقة تماماً للإصدار الحالي (لا فائدة هندسية من إصدار مكرر)
  const currentVersion = store.versions[doc.current_version_id];
  if (currentVersion && currentVersion.checksum_sha256 === checksum) {
    throw new Error('محتوى الملف مطابق تماماً للإصدار الحالي - لم يتم إنشاء إصدار جديد');
  }

  const nextVersionNumber = doc.current_version_number + 1;
  const versionId = newId('VER');
  const storedFileName = `${versionId}${ext}`;
  fs.writeFileSync(path.join(FILES_DIR, storedFileName), buffer);

  // تعليم كل الإصدارات السابقة كغير حالية
  for (const vid of doc.version_ids) {
    if (store.versions[vid]) store.versions[vid].is_current = false;
  }

  const versionRecord = {
    id: versionId,
    document_id: documentId,
    version_number: nextVersionNumber,
    file_name,
    stored_file_name: storedFileName,
    file_extension: ext,
    file_type_label: ALLOWED_EXTENSIONS[ext],
    file_size_bytes: buffer.length,
    file_size_human: bytesToHuman(buffer.length),
    checksum_sha256: checksum,
    uploaded_by: author,
    uploaded_at: nowISO(),
    change_note: change_note || `تحديث إلى الإصدار ${nextVersionNumber}`,
    is_current: true,
  };
  store.versions[versionId] = versionRecord;

  doc.version_ids.push(versionId);
  doc.current_version_id = versionId;
  doc.current_version_number = nextVersionNumber;
  doc.updated_at = nowISO();
  // أي تعديل جوهري (إصدار جديد) يعيد المستند لدورة المراجعة تلقائياً إن كان معتمداً/منشوراً
  if (['approved', 'published'].includes(doc.status)) doc.status = 'under_review';

  audit(store, {
    action: 'new_version', entity: 'document', entityId: documentId, projectId: doc.project_id, actor: author,
    details: { version: nextVersionNumber, file_name, size: buffer.length, change_note: versionRecord.change_note },
  });
  saveStore(store);

  return { success: true, data: doc };
}

/** استعادة إصدار سابق كإصدار حالي جديد (لا يحذف التاريخ، بل يضيف نسخة "استعادة" جديدة فوق التسلسل) */
function restoreVersion(documentId, versionId, { author = null, token = null } = {}) {
  const store = loadStore();
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'update');
  const oldVersion = store.versions[versionId];
  if (!oldVersion || oldVersion.document_id !== documentId) throw new Error('الإصدار المطلوب استعادته غير موجود لهذا المستند');
  if (oldVersion.id === doc.current_version_id) throw new Error('هذا هو الإصدار الحالي بالفعل');

  const oldBuffer = fs.readFileSync(path.join(FILES_DIR, oldVersion.stored_file_name));
  return uploadNewVersion(documentId, {
    file_name: oldVersion.file_name,
    content_base64: oldBuffer.toString('base64'),
    change_note: `استعادة من الإصدار ${oldVersion.version_number}`,
    author,
    token,
  });
}

function getDocument(id, { token = null } = {}) {
  const store = loadStore();
  const doc = store.documents[id];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'view');
  const versions = doc.version_ids.map(vid => store.versions[vid]).filter(Boolean)
    .sort((a, b) => b.version_number - a.version_number);
  return { success: true, data: { ...doc, versions } };
}

/** تنزيل محتوى إصدار معيّن (أو الإصدار الحالي افتراضياً) - يعيد Buffer فعلياً + بيانات الملف */
function downloadDocument(documentId, { versionId = null, actor = null, token = null } = {}) {
  const store = loadStore();
  const doc = store.documents[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'view');
  const targetVersionId = versionId || doc.current_version_id;
  const version = store.versions[targetVersionId];
  if (!version || version.document_id !== documentId) throw new Error('الإصدار المطلوب غير موجود لهذا المستند');

  const filePath = path.join(FILES_DIR, version.stored_file_name);
  if (!fs.existsSync(filePath)) throw new Error('ملف الإصدار غير موجود فعلياً على القرص (تلف أو حذف خارجي)');
  const buffer = fs.readFileSync(filePath);

  audit(store, {
    action: 'download', entity: 'document', entityId: documentId, projectId: doc.project_id, actor,
    details: { version: version.version_number, file_name: version.file_name },
  });
  saveStore(store);

  return {
    success: true,
    data: {
      file_name: version.file_name,
      content_base64: buffer.toString('base64'),
      file_size_bytes: version.file_size_bytes,
      checksum_sha256: version.checksum_sha256,
      version_number: version.version_number,
    },
  };
}

function updateDocumentMetadata(id, patch = {}, { actor = null, token = null } = {}) {
  const store = loadStore();
  const doc = store.documents[id];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'update');

  const allowedFields = ['title', 'description', 'keywords', 'department', 'doc_type', 'expiry_date'];
  for (const field of allowedFields) {
    if (patch[field] === undefined) continue;
    if (field === 'doc_type') {
      if (!DOCUMENT_TYPES[patch.doc_type]) throw new Error('نوع المستند غير صحيح');
      doc.doc_type = patch.doc_type;
      doc.doc_type_label = DOCUMENT_TYPES[patch.doc_type].label;
      doc.doc_group = DOCUMENT_TYPES[patch.doc_type].group;
    } else {
      doc[field] = patch[field];
    }
  }
  doc.updated_at = nowISO();

  audit(store, { action: 'update_metadata', entity: 'document', entityId: id, projectId: doc.project_id, actor, details: patch });
  saveStore(store);
  return { success: true, data: doc };
}

function deleteDocument(id, { actor = null, hardDelete = false, token = null } = {}) {
  const store = loadStore();
  const doc = store.documents[id];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, hardDelete ? 'hard_delete' : 'delete');

  if (hardDelete) {
    for (const vid of doc.version_ids) {
      const v = store.versions[vid];
      if (v) {
        const fp = path.join(FILES_DIR, v.stored_file_name);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        delete store.versions[vid];
      }
    }
    delete store.documents[id];
    audit(store, { action: 'hard_delete', entity: 'document', entityId: id, projectId: doc.project_id, actor });
  } else {
    doc.archived = true;
    doc.status = 'archived';
    doc.updated_at = nowISO();
    audit(store, { action: 'archive', entity: 'document', entityId: id, projectId: doc.project_id, actor });
  }
  saveStore(store);
  return { success: true, data: { id, hardDelete } };
}

function listDocuments({
  projectId = null, docType = null, group = null, status = null, department = null,
  search = null, includeArchived = false, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50,
} = {}) {
  const store = loadStore();
  let items = Object.values(store.documents);

  if (!includeArchived) items = items.filter(d => !d.archived);
  if (projectId) items = items.filter(d => d.project_id === projectId);
  if (docType) items = items.filter(d => d.doc_type === docType);
  if (group) items = items.filter(d => d.doc_group === group);
  if (status) items = items.filter(d => d.status === status);
  if (department) items = items.filter(d => d.department === department);
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(d => (
      d.title.toLowerCase().includes(q)
      || d.document_number.toLowerCase().includes(q)
      || (d.description || '').toLowerCase().includes(q)
      || d.keywords.some(k => k.toLowerCase().includes(q))
    ));
  }

  items.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[sortBy] > b[sortBy]) return dir;
    if (a[sortBy] < b[sortBy]) return -dir;
    return 0;
  });

  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    success: true,
    data: paged,
    pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

// ==================================================================================
// ==================================== لوحة التحكم ==================================
// ==================================================================================

function getDashboard(projectId = null) {
  const store = loadStore();
  let docs = Object.values(store.documents);
  if (projectId) docs = docs.filter(d => d.project_id === projectId);

  const byStatus = {};
  for (const s of DOCUMENT_STATUSES) byStatus[s] = 0;
  for (const d of docs) byStatus[d.status] = (byStatus[d.status] || 0) + 1;

  const byGroup = {};
  for (const g of DOCUMENT_GROUPS) byGroup[g] = 0;
  for (const d of docs) byGroup[d.doc_group] = (byGroup[d.doc_group] || 0) + 1;

  const projectIds = new Set(docs.map(d => d.project_id).filter(Boolean));
  const totalVersions = docs.reduce((sum, d) => sum + d.version_ids.length, 0);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyAdded = docs.filter(d => new Date(d.created_at).getTime() >= sevenDaysAgo).length;

  const activeUsers = new Set(
    store.auditLog.filter(a => a.actor).slice(-500).map(a => a.actor),
  ).size;

  const recentDocs = [...docs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10)
    .map(d => ({ id: d.id, document_number: d.document_number, title: d.title, status: d.status, created_at: d.created_at }));

  const recentEdits = [...store.auditLog]
    .filter(a => a.action === 'new_version' || a.action === 'update_metadata')
    .slice(-10).reverse();

  const recentApprovals = [...store.auditLog]
    .filter(a => a.action === 'approve' || a.action === 'reject')
    .slice(-10).reverse();

  const alerts = [];
  if (byStatus.under_review > 0) alerts.push({ type: 'info', message: `${byStatus.under_review} مستند بانتظار المراجعة` });
  if (byStatus.rejected > 0) alerts.push({ type: 'warning', message: `${byStatus.rejected} مستند مرفوض يحتاج متابعة` });

  return {
    success: true,
    data: {
      total_documents: docs.length,
      total_projects_linked: projectIds.size,
      new_documents_7d: recentlyAdded,
      archived_documents: docs.filter(d => d.archived).length,
      under_review_documents: byStatus.under_review,
      approved_documents: byStatus.approved,
      rejected_documents: byStatus.rejected,
      total_versions: totalVersions,
      active_users: activeUsers,
      recent_documents: recentDocs,
      recent_edits: recentEdits,
      recent_approvals: recentApprovals,
      alerts,
      chart_by_type: Object.entries(
        docs.reduce((acc, d) => { acc[d.doc_type_label] = (acc[d.doc_type_label] || 0) + 1; return acc; }, {}),
      ).map(([label, count]) => ({ label, count })),
      chart_by_status: DOCUMENT_STATUSES.map(s => ({ label: DOCUMENT_STATUS_LABELS[s], count: byStatus[s] })),
      chart_by_group: DOCUMENT_GROUPS.map(g => ({ label: DOCUMENT_GROUP_LABELS[g], count: byGroup[g] })),
    },
  };
}

function getReferenceData() {
  return {
    success: true,
    data: {
      document_groups: DOCUMENT_GROUPS,
      document_group_labels: DOCUMENT_GROUP_LABELS,
      document_types: DOCUMENT_TYPES,
      document_statuses: DOCUMENT_STATUSES,
      document_status_labels: DOCUMENT_STATUS_LABELS,
      allowed_extensions: ALLOWED_EXTENSIONS,
      max_file_size_bytes: MAX_FILE_SIZE_BYTES,
      max_file_size_human: bytesToHuman(MAX_FILE_SIZE_BYTES),
    },
  };
}

// ==================================================================================
// ========================= أدوار قسم إدارة المستندات (RBAC) =======================
// ==================================================================================

// أدوار مخصصة لقسم إدارة المستندات (بالإضافة إلى استخدام صلاحية `documents` العامة
// المعرَّفة مسبقاً لبقية الأدوار المشتركة في businessSecurity.js مثل project_manager
// وengineer وhr_manager التي تملك صلاحيات documents محدودة أصلاً)
const DMS_ROLE_DEFINITIONS = {
  document_controller: {
    label: 'مدير الوثائق (Document Controller)',
    permissions: {
      documents: ['view', 'create', 'update', 'delete', 'approve', 'manage'],
      dashboard: ['view'], reports: ['view', 'export'], ai: ['use'],
    },
  },
  quality_engineer_dms: {
    label: 'مهندس الجودة (وصول المستندات)',
    permissions: { documents: ['view', 'create', 'update'], dashboard: ['view'] },
  },
  consultant_viewer: {
    label: 'الاستشاري (اطلاع على المستندات)',
    permissions: { documents: ['view'], dashboard: ['view'] },
  },
  contractor_viewer: {
    label: 'المقاول (اطلاع على المستندات)',
    permissions: { documents: ['view'] },
  },
};

/**
 * يزرع أدوار قسم إدارة المستندات ضمن جدول الأدوار المركزي (upsert فقط عند عدم
 * الوجود)، بنفس نمط ensureEquipmentRolesSeeded / ensureSurveyRolesSeeded تماماً.
 */
function ensureDmsRolesSeeded() {
  const SEC = require('./businessSecurity');
  const existingRoles = SEC.listRoles().data.map(r => r.key);
  for (const [key, def] of Object.entries(DMS_ROLE_DEFINITIONS)) {
    if (!existingRoles.includes(key)) {
      SEC.upsertRole(key, def);
    }
  }
  return { success: true, data: { seeded_roles: Object.keys(DMS_ROLE_DEFINITIONS) } };
}

module.exports = {
  // مرجع
  DOCUMENT_GROUPS,
  DOCUMENT_GROUP_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  getReferenceData,

  // تكامل
  setProjectResolver,

  // صلاحيات متقدمة (خشنة - على مستوى الوحدة)
  DMS_ROLE_DEFINITIONS,
  ensureDmsRolesSeeded,

  // صلاحيات دقيقة (على مستوى المستند الفردي: مشروع/نوع/دور) - انظر documentAccessControl.js
  setUserProjectScope: ACL.setUserProjectScope,
  getUserProjectScope: ACL.getUserProjectScope,
  listAccessDenials: ACL.listAccessDenials,

  // لوحة تحكم
  getDashboard,

  // CRUD + إصدارات
  uploadDocument,
  uploadNewVersion,
  restoreVersion,
  getDocument,
  downloadDocument,
  updateDocumentMetadata,
  deleteDocument,
  listDocuments,
};
