/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الأول (1/10): البنية الأساسية + طبقة التخزين الموحّدة + أنواع المخططات +
 *                      رفع/تنزيل الملفات الفعلي + الإصدار الأول (v1) + سجل تدقيق +
 *                      لوحة التحكم الرئيسية + الربط التلقائي بالمشاريع.
 *
 * خطة التقسيم الكاملة (راجع DRAWINGS_PLAN.md):
 *  1/10: الأساس + التخزين + الأنواع + رفع/تنزيل + v1 + لوحة التحكم (هذا الملف)
 *  2/10: إدارة الإصدارات المتقدمة (نسخ متعددة، فروقات، استعادة، سجل تعديلات) (منجَز - drawingVersions.js)
 *  3/10: عارض المخططات (بيانات القياس/الطبقات/الإحداثيات - طبقة API خلفية)
 *  4/10: إدارة الطبقات (Layers) الوصفية
 *  5/10: مراجعة المخططات (إرسال/مراجعة/رفض/إعادة/اعتماد نهائي) (منجَز - drawingReviews.js)
 *  6/10: التعليقات والملاحظات المثبّتة على المخطط (منجَز - drawingComments.js)
 *  7/10: مقارنة المخططات (فرق بين إصدارين) (منجَز - drawingComparison.js)
 *  8/10: الاعتمادات المتعددة المستويات (داخلي/استشاري/عميل/مقاول) + توقيع
 *  9/10: التكامل مع BIM (Revit/IFC/Navisworks..) + اكتشاف تعارضات وصفي
 *  10/10: التنبيهات + التقارير + الذكاء الاصطناعي + التكامل الشامل مع بقية الأقسام
 *
 * نمط التخزين: نفس نمط DMS (documentManagement.js) - ملف JSON للبيانات الوصفية
 * (backend/data/drawings.json) + تخزين المحتوى الثنائي الفعلي (base64 → Buffer) في
 * مجلد منفصل (backend/data/drawings_files/) بدون أي تبعيات خارجية.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - رفع الملفات يستقبل content_base64 فعلياً، يحسب checksum (SHA-256) حقيقي،
 *    ويكتب المحتوى الثنائي الفعلي على القرص (DWG/DXF/DGN/RVT/IFC/PDF/DWF/STEP/STL/صور).
 *  - رقم المخطط مولَّد تلقائياً بصيغة مرجعية هندسية حقيقية حسب التخصص والمشروع
 *    (مثال: DRW-STR-PRJ001-0007).
 *  - لوحة التحكم: كل الإحصائيات محسوبة فعلياً من البيانات المخزَّنة.
 *  - سجل تدقيق فعلي لكل عملية (رفع/تعديل/حذف/تنزيل).
 *  - الربط بالمشاريع: يتحقق فعلياً من وجود المشروع عبر projectManagement قبل الربط.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'drawings_files');
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'drawings.json');

let PM = null;
try { PM = require('./projectManagement'); } catch (e) { PM = null; }

// require كسول لتفادي أي اعتمادية دائرية مع drawingReviews.js (الجزء 5/10)
// الذي يستورد هو نفسه drawingManagement._internal عند التحميل.
function getReviewCount() {
  try {
    // eslint-disable-next-line global-require
    return require('./drawingReviews').getReviewCountForDashboard();
  } catch (e) {
    return 0;
  }
}

// require كسول مماثل مع drawingComments.js (الجزء 6/10)
function getCommentCount() {
  try {
    // eslint-disable-next-line global-require
    return require('./drawingComments').getCommentCountForDashboard();
  } catch (e) {
    return 0;
  }
}

// require كسول مماثل مع drawingApprovals.js (الجزء 8/10)
function getApprovalCount() {
  try {
    // eslint-disable-next-line global-require
    return require('./drawingApprovals').getApprovalCountForDashboard();
  } catch (e) {
    return 0;
  }
}

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

// ===================== التصنيفات الثابتة =====================

// التخصصات (Disciplines) - المذكورة في المتطلبات
const DISCIPLINES = {
  structural: { code: 'STR', label_ar: 'إنشائي', label_en: 'Structural' },
  architectural: { code: 'ARC', label_ar: 'معماري', label_en: 'Architectural' },
  electrical: { code: 'ELE', label_ar: 'كهربائي', label_en: 'Electrical' },
  mechanical: { code: 'MEC', label_ar: 'ميكانيكي', label_en: 'Mechanical' },
  roads: { code: 'RD', label_ar: 'طرق', label_en: 'Roads' },
  survey: { code: 'SUR', label_ar: 'مساحة', label_en: 'Survey' },
  bim: { code: 'BIM', label_ar: 'BIM', label_en: 'BIM' },
};

// أنواع المخططات الفرعية لكل تخصص (كما وردت في المتطلبات حرفياً)
const DRAWING_SUBTYPES = {
  structural: ['foundations', 'footings', 'columns', 'beams', 'slabs', 'walls', 'roofs', 'structural_details'],
  architectural: ['plans', 'elevations', 'sections', 'finishes', 'doors_windows', 'architectural_schedules'],
  electrical: ['lighting_distribution', 'power_distribution', 'grounding_systems', 'fire_alarm_systems', 'communication_systems', 'electrical_panels'],
  mechanical: ['hvac', 'ventilation', 'plumbing', 'drainage', 'fire_fighting', 'gas'],
  roads: ['alignments', 'longitudinal_sections', 'cross_sections', 'pavements', 'drainage'],
  survey: ['topographic_survey', 'contours', 'control_points', 'topographic_plans'],
  bim: ['revit_models', 'ifc_models', '3d_models', 'discipline_coordination'],
};

const SUBTYPE_LABELS_AR = {
  foundations: 'الأساسات', footings: 'القواعد', columns: 'الأعمدة', beams: 'الجسور', slabs: 'البلاطات',
  walls: 'الجدران', roofs: 'الأسقف', structural_details: 'التفاصيل الإنشائية',
  plans: 'المساقط', elevations: 'الواجهات', sections: 'المقاطع', finishes: 'التشطيبات',
  doors_windows: 'الأبواب والنوافذ', architectural_schedules: 'الجداول المعمارية',
  lighting_distribution: 'توزيع الإنارة', power_distribution: 'توزيع القوى', grounding_systems: 'أنظمة التأريض',
  fire_alarm_systems: 'أنظمة الحريق', communication_systems: 'أنظمة الاتصالات', electrical_panels: 'لوحات الكهرباء',
  hvac: 'التكييف', ventilation: 'التهوية', plumbing: 'السباكة', drainage: 'الصرف الصحي',
  fire_fighting: 'مكافحة الحريق', gas: 'الغاز',
  alignments: 'المحاور', longitudinal_sections: 'المقاطع الطولية', cross_sections: 'المقاطع العرضية', pavements: 'الأرصفة',
  topographic_survey: 'الرفع المساحي', contours: 'الكنتور', control_points: 'نقاط التحكم', topographic_plans: 'المخططات الطبوغرافية',
  revit_models: 'نماذج Revit', ifc_models: 'نماذج IFC', '3d_models': 'النماذج ثلاثية الأبعاد', discipline_coordination: 'التنسيق بين التخصصات',
};

// أنواع الملفات المدعومة (كما وردت في المتطلبات)
const SUPPORTED_FILE_TYPES = ['dwg', 'dxf', 'dgn', 'rvt', 'ifc', 'pdf', 'dwf', 'step', 'stl', 'jpg', 'jpeg', 'png', 'other_cad'];

// حالات الاعتماد
const APPROVAL_STATUSES = ['draft', 'under_review', 'approved', 'rejected', 'superseded'];
const APPROVAL_STATUS_LABELS_AR = {
  draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', superseded: 'مستبدل بإصدار أحدث',
};

// ===================== طبقة التخزين =====================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      drawings: [],
      versions: [],   // سيُستخدم بشكل كامل في الجزء 2/10 - هنا نخزّن فقط الإصدار v1 التلقائي
      audit_log: [],
      counters: {}, // عداد تسلسلي لكل (تخصص+مشروع) لتوليد رقم المخطط
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('ملف قاعدة بيانات المخططات تالف (drawings.json)');
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function logAudit(db, { action, drawingId, actor, details }) {
  db.audit_log.push({
    id: newId('AUD'),
    action,
    drawing_id: drawingId || null,
    actor: actor || 'system',
    details: details || null,
    timestamp: nowISO(),
  });
  // إبقاء آخر 5000 سجل فقط لتفادي تضخم الملف
  if (db.audit_log.length > 5000) db.audit_log = db.audit_log.slice(-5000);
}

// ===================== توليد رقم المخطط =====================
function generateDrawingNumber(db, discipline, projectId) {
  const disc = DISCIPLINES[discipline];
  if (!disc) throw new Error(`تخصص غير معروف: ${discipline}`);
  const projectCode = projectId ? String(projectId).toUpperCase() : 'GEN';
  const counterKey = `${disc.code}_${projectCode}`;
  db.counters[counterKey] = (db.counters[counterKey] || 0) + 1;
  const seq = String(db.counters[counterKey]).padStart(4, '0');
  return `DRW-${disc.code}-${projectCode}-${seq}`;
}

// ===================== التحقق من صحة المدخلات =====================
function validateProjectExists(projectId) {
  if (!projectId) return; // الربط بمشروع اختياري عند الإنشاء لكن يُنصح به
  if (!PM || typeof PM.getProject !== 'function') return; // إن لم تتوفر واجهة المشاريع، تجاوز التحقق بأمان
  const project = PM.getProject(projectId);
  if (!project) throw new Error(`المشروع بالمعرّف (${projectId}) غير موجود`);
}

function validateFileType(fileType) {
  const t = String(fileType || '').toLowerCase().replace(/^\./, '');
  if (!SUPPORTED_FILE_TYPES.includes(t)) {
    throw new Error(`نوع الملف غير مدعوم: ${fileType}. الأنواع المدعومة: ${SUPPORTED_FILE_TYPES.join(', ')}`);
  }
  return t;
}

function validateDiscipline(discipline) {
  if (!DISCIPLINES[discipline]) {
    throw new Error(`التخصص غير معروف: ${discipline}. القيم المتاحة: ${Object.keys(DISCIPLINES).join(', ')}`);
  }
}

function validateSubtype(discipline, subtype) {
  if (!subtype) return;
  const allowed = DRAWING_SUBTYPES[discipline] || [];
  if (!allowed.includes(subtype)) {
    throw new Error(`نوع المخطط الفرعي (${subtype}) غير صحيح للتخصص (${discipline}). القيم المتاحة: ${allowed.join(', ')}`);
  }
}

// ===================== إنشاء مخطط جديد + رفع الملف (v1) =====================
/**
 * إنشاء مخطط جديد مع رفع الملف الفعلي كإصدار أول (v1).
 * @param {Object} input
 *  name, discipline, subtype, project_id, description, keywords[],
 *  responsible_engineer, designer, file_type, content_base64, actor
 */
function createDrawing(input) {
  const db = loadDB();
  const {
    name, discipline, subtype, project_id, description, keywords,
    responsible_engineer, designer, file_type, content_base64, actor,
  } = input || {};

  if (!name || !String(name).trim()) throw new Error('اسم المخطط مطلوب');
  validateDiscipline(discipline);
  validateSubtype(discipline, subtype);
  validateProjectExists(project_id);
  const normalizedFileType = validateFileType(file_type);
  if (!content_base64) throw new Error('محتوى الملف (content_base64) مطلوب لإنشاء مخطط');

  const buffer = Buffer.from(content_base64, 'base64');
  if (!buffer.length) throw new Error('تعذّر فك ترميز محتوى الملف - تأكد من صحة base64');

  const drawingId = newId('DRAW');
  const drawingNumber = generateDrawingNumber(db, discipline, project_id);
  const checksum = sha256(buffer);
  const storedFileName = `${drawingId}_v1.${normalizedFileType === 'other_cad' ? 'bin' : normalizedFileType}`;
  const storedPath = path.join(FILES_DIR, storedFileName);
  fs.writeFileSync(storedPath, buffer);

  const record = {
    id: drawingId,
    drawing_number: drawingNumber,
    name: String(name).trim(),
    discipline,
    subtype: subtype || null,
    project_id: project_id || null,
    description: description || null,
    keywords: Array.isArray(keywords) ? keywords : (keywords ? String(keywords).split(',').map((k) => k.trim()).filter(Boolean) : []),
    responsible_engineer: responsible_engineer || null,
    designer: designer || null,
    reviewer: null,
    approver: null,
    approval_status: 'draft',
    current_version: 1,
    file_type: normalizedFileType,
    file_size_bytes: buffer.length,
    file_size_human: bytesToHuman(buffer.length),
    checksum_sha256: checksum,
    stored_file_name: storedFileName,
    created_at: nowISO(),
    updated_at: nowISO(),
    created_by: actor || null,
    is_deleted: false,
  };

  db.drawings.push(record);
  // سجل الإصدار الأول ضمن جدول الإصدارات (تفاصيل إضافية في الجزء 2/10)
  db.versions.push({
    id: newId('VER'),
    drawing_id: drawingId,
    version_number: 1,
    stored_file_name: storedFileName,
    file_size_bytes: buffer.length,
    checksum_sha256: checksum,
    uploaded_by: actor || null,
    uploaded_at: nowISO(),
    change_note: 'الإصدار الأول عند إنشاء المخطط',
  });

  logAudit(db, { action: 'create_drawing', drawingId, actor, details: `تم إنشاء المخطط (${drawingNumber}) - ${record.name}` });
  saveDB(db);

  const { stored_file_name, ...publicRecord } = record;
  return { success: true, drawing: publicRecord };
}

// ===================== قراءة/بحث =====================
function stripInternal(record) {
  if (!record) return null;
  const { stored_file_name, ...rest } = record;
  return rest;
}

function getDrawing(drawingId) {
  const db = loadDB();
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  return stripInternal(rec);
}

function listDrawings(filters = {}) {
  const db = loadDB();
  let list = db.drawings.filter((d) => !d.is_deleted);

  if (filters.discipline) list = list.filter((d) => d.discipline === filters.discipline);
  if (filters.subtype) list = list.filter((d) => d.subtype === filters.subtype);
  if (filters.project_id) list = list.filter((d) => d.project_id === filters.project_id);
  if (filters.approval_status) list = list.filter((d) => d.approval_status === filters.approval_status);
  if (filters.responsible_engineer) list = list.filter((d) => d.responsible_engineer === filters.responsible_engineer);
  if (filters.file_type) list = list.filter((d) => d.file_type === filters.file_type);
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    list = list.filter((d) => (
      d.name.toLowerCase().includes(q)
      || d.drawing_number.toLowerCase().includes(q)
      || (d.description || '').toLowerCase().includes(q)
      || (d.keywords || []).some((k) => k.toLowerCase().includes(q))
    ));
  }

  list = list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return list.map(stripInternal);
}

// ===================== تنزيل الملف الفعلي =====================
function downloadDrawingFile(drawingId, { actor } = {}) {
  const db = loadDB();
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  const filePath = path.join(FILES_DIR, rec.stored_file_name);
  if (!fs.existsSync(filePath)) throw new Error('ملف المخطط غير موجود فعلياً على القرص');
  const buffer = fs.readFileSync(filePath);

  logAudit(db, { action: 'download_drawing', drawingId, actor, details: `تنزيل المخطط (${rec.drawing_number})` });
  saveDB(db);

  return {
    success: true,
    drawing_number: rec.drawing_number,
    file_type: rec.file_type,
    file_size_bytes: rec.file_size_bytes,
    content_base64: buffer.toString('base64'),
  };
}

// ===================== تعديل بيانات المخطط (Metadata فقط) =====================
function updateDrawingMetadata(drawingId, updates = {}, { actor } = {}) {
  const db = loadDB();
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');

  const editableFields = ['name', 'description', 'keywords', 'responsible_engineer', 'designer', 'subtype'];
  editableFields.forEach((field) => {
    if (updates[field] !== undefined) {
      if (field === 'subtype') validateSubtype(rec.discipline, updates.subtype);
      rec[field] = updates[field];
    }
  });
  rec.updated_at = nowISO();

  logAudit(db, { action: 'update_drawing_metadata', drawingId, actor, details: `تحديث بيانات المخطط (${rec.drawing_number})` });
  saveDB(db);
  return { success: true, drawing: stripInternal(rec) };
}

// ===================== حذف (منطقي - Soft Delete) =====================
function deleteDrawing(drawingId, { actor } = {}) {
  const db = loadDB();
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  rec.is_deleted = true;
  rec.updated_at = nowISO();

  logAudit(db, { action: 'delete_drawing', drawingId, actor, details: `حذف المخطط (${rec.drawing_number})` });
  saveDB(db);
  return { success: true };
}

// ===================== لوحة التحكم الرئيسية =====================
function getDashboardStats() {
  const db = loadDB();
  const active = db.drawings.filter((d) => !d.is_deleted);

  const byStatus = {};
  APPROVAL_STATUSES.forEach((s) => { byStatus[s] = 0; });
  active.forEach((d) => { byStatus[d.approval_status] = (byStatus[d.approval_status] || 0) + 1; });

  const byDiscipline = {};
  Object.keys(DISCIPLINES).forEach((k) => { byDiscipline[k] = 0; });
  active.forEach((d) => { byDiscipline[d.discipline] = (byDiscipline[d.discipline] || 0) + 1; });

  const projectIds = new Set(active.map((d) => d.project_id).filter(Boolean));

  const recentDrawings = [...active]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map(stripInternal);

  const recentApprovals = [...active]
    .filter((d) => d.approval_status === 'approved')
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
    .map(stripInternal);

  const recentEdits = [...active]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
    .map(stripInternal);

  const recentAuditEvents = db.audit_log.slice(-15).reverse();

  return {
    success: true,
    totals: {
      total_drawings: active.length,
      approved: byStatus.approved || 0,
      under_review: byStatus.under_review || 0,
      rejected: byStatus.rejected || 0,
      total_versions: db.versions.length, // محسوبة فعلياً - تشمل كل إصدارات كل المخططات (الجزء 1/10 + 2/10)
      total_projects: projectIds.size,
      total_reviews: getReviewCount(), // محسوبة فعلياً من سجل المراجعات (الجزء 5/10)
      total_comments: getCommentCount(), // محسوبة فعلياً من سجل التعليقات (الجزء 6/10)
      total_approvals: getApprovalCount(), // محسوبة فعلياً من سجل الاعتمادات المتعددة (الجزء 8/10)
    },
    by_status: byStatus,
    by_discipline: byDiscipline,
    status_labels_ar: APPROVAL_STATUS_LABELS_AR,
    discipline_labels: DISCIPLINES,
    recent_drawings: recentDrawings,
    recent_approvals: recentApprovals,
    recent_edits: recentEdits,
    recent_audit_events: recentAuditEvents,
  };
}

// ===================== قوائم مرجعية للواجهة =====================
function getTaxonomy() {
  const disciplines = Object.entries(DISCIPLINES).map(([key, v]) => ({
    key,
    code: v.code,
    label_ar: v.label_ar,
    label_en: v.label_en,
    subtypes: (DRAWING_SUBTYPES[key] || []).map((s) => ({ key: s, label_ar: SUBTYPE_LABELS_AR[s] || s })),
  }));
  return {
    success: true,
    disciplines,
    file_types: SUPPORTED_FILE_TYPES,
    approval_statuses: APPROVAL_STATUSES.map((s) => ({ key: s, label_ar: APPROVAL_STATUS_LABELS_AR[s] })),
  };
}

module.exports = {
  DISCIPLINES,
  DRAWING_SUBTYPES,
  SUBTYPE_LABELS_AR,
  SUPPORTED_FILE_TYPES,
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABELS_AR,
  createDrawing,
  getDrawing,
  listDrawings,
  downloadDrawingFile,
  updateDrawingMetadata,
  deleteDrawing,
  getDashboardStats,
  getTaxonomy,
  // مُصدَّرة للاستخدام الداخلي من قبل الأجزاء القادمة (2/10 وما بعدها)
  _internal: { loadDB, saveDB, logAudit, newId, nowISO, sha256, bytesToHuman, FILES_DIR, validateProjectExists },
};
