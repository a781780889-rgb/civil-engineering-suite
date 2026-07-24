// ============================================================
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 10ج/10 (الأخير): التكامل الشامل مع بقية أقسام النظام
// ------------------------------------------------------------
// هذه الوحدة تُنشئ "جدول ربط" عام (drawing_id <-> module/entity)
// بحيث يظهر أي مخطط مرتبط مباشرة داخل القسم الخاص به، تماماً كما
// ورد حرفياً في مواصفة القسم الثاني عشر تحت بند "التكامل مع
// الأقسام الأخرى":
//   إدارة المشاريع، تطبيق المساحة، حصر الكميات، إدارة الجودة،
//   إدارة السلامة المهنية، إدارة المستندات، إدارة الأعمال،
//   إدارة المعدات، الجدول الزمني، نظام التقارير، قاعدة البيانات
//   المركزية.
//
// الفكرة (نفس نمط documentModuleLinks.js - القسم الحادي عشر -
// الذي أثبت فعاليته هناك): أي قسم آخر في النظام (مثلاً إدارة
// الجودة عند تسجيل فحص، أو BOQ عند استخراج كميات من مخطط) يستدعي
// linkDrawing() لربط مخطط موجود فعلاً في نظام المخططات بسجل ذلك
// القسم. بعدها، يستدعي ذلك القسم getLinkedDrawings() لعرض قائمة
// المخططات المرتبطة مباشرة ضمن واجهته، دون إعادة بناء منطق البحث
// أو التخزين.
//
// كما تربط هذه الوحدة المخططات فعلياً بنظام إدارة المستندات (DMS)
// القسم الحادي عشر — إذ يمكن للمخطط نفسه أن يُدرَج كمرجع مستندي
// داخل ملف مشروع موحّد، عبر ربط اختياري بمعرّف مستند DMS مطابق.
// ============================================================

const fs = require('fs');
const path = require('path');

const DRAW = require('./drawingManagement');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'drawing_module_links.json');

// الأقسام المدعومة رسمياً للربط (module keys) — مطابقة حرفياً لبند
// "التكامل مع الأقسام الأخرى" في مواصفة القسم الثاني عشر
const SUPPORTED_MODULES = {
  project: { label: 'إدارة المشاريع' },
  survey: { label: 'تطبيق المساحة' },
  boq: { label: 'حصر الكميات' },
  quality: { label: 'إدارة الجودة' },
  safety: { label: 'السلامة المهنية' },
  documents: { label: 'إدارة المستندات' },
  business: { label: 'إدارة الأعمال' },
  equipment: { label: 'إدارة المعدات' },
  schedule: { label: 'الجدول الزمني' },
  reports: { label: 'نظام التقارير' },
};

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const initial = { links: {}, audit_log: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { links: {}, audit_log: [] };
  }
}

function saveStore(store) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function audit(store, {
  action, entity, entityId, projectId = null, actor = null, details = {},
}) {
  store.audit_log.push({
    id: newId('LOG'),
    action,
    entity,
    entity_id: entityId,
    project_id: projectId,
    actor,
    details,
    timestamp: nowISO(),
  });
  if (store.audit_log.length > 5000) store.audit_log = store.audit_log.slice(-5000);
}

function assertModuleValid(module) {
  if (!SUPPORTED_MODULES[module]) {
    throw new Error(`القسم "${module}" غير مدعوم للربط. الأقسام المدعومة: ${Object.keys(SUPPORTED_MODULES).join(', ')}`);
  }
}

function assertDrawingExists(drawingId) {
  const drawing = DRAW.getDrawing(drawingId);
  if (!drawing) {
    throw new Error('المخطط المطلوب ربطه غير موجود في نظام إدارة المخططات');
  }
  return drawing;
}

// ------------------------------------------------------------
// ربط مخطط موجود بسجل في أي قسم آخر
// ------------------------------------------------------------
function linkDrawing({
  drawingId, module, entityId, entityLabel = null, projectId = null, actor = null, note = null,
} = {}) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  if (!module) throw new Error('اسم القسم (module) مطلوب');
  if (!entityId) throw new Error('معرّف السجل المرتبط (entityId) مطلوب');

  assertModuleValid(module);
  const drawing = assertDrawingExists(drawingId);

  const store = loadStore();

  // منع تكرار نفس الربط
  const existing = Object.values(store.links).find(
    (l) => l.drawing_id === drawingId && l.module === module && l.entity_id === String(entityId),
  );
  if (existing) return { success: true, data: existing, already_linked: true };

  const link = {
    id: newId('DLNK'),
    drawing_id: drawingId,
    module,
    entity_id: String(entityId),
    entity_label: entityLabel,
    project_id: projectId || drawing.project_id || null,
    note,
    linked_by: actor,
    linked_at: nowISO(),
  };
  store.links[link.id] = link;
  audit(store, {
    action: 'link',
    entity: 'drawing_module_link',
    entityId: link.id,
    projectId: link.project_id,
    actor,
    details: { module, entityId, drawingId },
  });
  saveStore(store);
  return { success: true, data: link };
}

// ربط عدة مخططات دفعة واحدة بنفس السجل
function linkDrawings({
  drawingIds = [], module, entityId, entityLabel = null, projectId = null, actor = null,
} = {}) {
  const results = drawingIds.map((id) => linkDrawing({
    drawingId: id, module, entityId, entityLabel, projectId, actor,
  }));
  return { success: true, data: results };
}

// فك ربط مخطط عن سجل
function unlinkDrawing(linkId, { actor = null } = {}) {
  const store = loadStore();
  const link = store.links[linkId];
  if (!link) throw new Error('رابط المخطط غير موجود');
  delete store.links[linkId];
  audit(store, {
    action: 'unlink',
    entity: 'drawing_module_link',
    entityId: linkId,
    projectId: link.project_id,
    actor,
    details: { module: link.module, entityId: link.entity_id, drawingId: link.drawing_id },
  });
  saveStore(store);
  return { success: true };
}

// ------------------------------------------------------------
// الاستعلام: جلب كل المخططات المرتبطة بسجل معيّن داخل قسم معيّن
// (هذه هي الدالة التي تستدعيها كل الأقسام الأخرى لعرض "المخططات
// المرتبطة" مباشرة ضمن واجهتها)
// ------------------------------------------------------------
function getLinkedDrawings(module, entityId) {
  assertModuleValid(module);
  const store = loadStore();
  const links = Object.values(store.links).filter(
    (l) => l.module === module && l.entity_id === String(entityId),
  );

  const drawings = links.map((link) => {
    const d = DRAW.getDrawing(link.drawing_id) || null;
    return {
      link_id: link.id,
      drawing_id: link.drawing_id,
      linked_at: link.linked_at,
      linked_by: link.linked_by,
      note: link.note,
      drawing: d ? {
        id: d.id,
        drawing_number: d.drawing_number,
        name: d.name,
        discipline: d.discipline,
        subtype: d.subtype,
        current_version: d.current_version,
        approval_status: d.approval_status,
        file_type: d.file_type,
        updated_at: d.updated_at,
      } : null,
      missing: !d,
    };
  });

  return { success: true, data: drawings, count: drawings.length };
}

// جلب كل الروابط الخاصة بمشروع معيّن مجمّعة حسب القسم (لعرضها في
// لوحة تحكم المشروع)
function getLinkedDrawingsByProject(projectId) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const store = loadStore();
  const links = Object.values(store.links).filter((l) => l.project_id === projectId);

  const grouped = {};
  for (const module of Object.keys(SUPPORTED_MODULES)) grouped[module] = [];

  for (const link of links) {
    const d = DRAW.getDrawing(link.drawing_id) || null;
    if (!grouped[link.module]) grouped[link.module] = [];
    grouped[link.module].push({
      link_id: link.id,
      drawing_id: link.drawing_id,
      entity_id: link.entity_id,
      entity_label: link.entity_label,
      drawing: d ? {
        drawing_number: d.drawing_number,
        name: d.name,
        approval_status: d.approval_status,
        discipline: d.discipline,
      } : null,
      missing: !d,
    });
  }

  return { success: true, data: grouped, total: links.length };
}

// جلب كل السجلات (في كل الأقسام) المرتبطة بمخطط معيّن — مفيد داخل
// شاشة المخطط نفسه لمعرفة أين يُستخدم
function getModulesLinkedToDrawing(drawingId) {
  const store = loadStore();
  const links = Object.values(store.links).filter((l) => l.drawing_id === drawingId);
  return {
    success: true,
    data: links.map((l) => ({
      link_id: l.id,
      module: l.module,
      module_label: SUPPORTED_MODULES[l.module]?.label || l.module,
      entity_id: l.entity_id,
      entity_label: l.entity_label,
      linked_at: l.linked_at,
    })),
  };
}

function getSupportedModules() {
  return { success: true, data: SUPPORTED_MODULES };
}

// ملخص إحصائي عام (لعرضه في لوحة تحكم المخططات الرئيسية)
function getIntegrationSummary() {
  const store = loadStore();
  const links = Object.values(store.links);
  const byModule = {};
  for (const module of Object.keys(SUPPORTED_MODULES)) byModule[module] = 0;
  for (const l of links) byModule[l.module] = (byModule[l.module] || 0) + 1;
  return {
    success: true,
    data: {
      total_links: links.length,
      by_module: byModule,
    },
  };
}

// ------------------------------------------------------------
// ربط اختياري بمستند مطابق داخل نظام إدارة المستندات (DMS، القسم
// الحادي عشر) — يسمح بإدراج المخطط كمرجع موحّد ضمن ملف المشروع
// المستندي، عبر معرّف الربط الفعلي الذي تُنشئه documentModuleLinks
// (module: 'documents'، entityId: drawingId) دون الحاجة لتكرار
// منطق ذلك القسم هنا.
// ------------------------------------------------------------
function linkDrawingToDocument({
  drawingId, documentId, projectId = null, actor = null, note = null,
} = {}) {
  if (!drawingId) throw new Error('معرّف المخطط (drawingId) مطلوب');
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');

  const drawing = assertDrawingExists(drawingId);

  // نستخدم نفس جدول الربط، بحيث "documents" قسم مدعوم رسمياً،
  // والـ entityId هنا هو معرّف المستند في DMS
  return linkDrawing({
    drawingId,
    module: 'documents',
    entityId: documentId,
    entityLabel: `مستند DMS: ${documentId}`,
    projectId: projectId || drawing.project_id || null,
    actor,
    note,
  });
}

module.exports = {
  SUPPORTED_MODULES,
  linkDrawing,
  linkDrawings,
  unlinkDrawing,
  getLinkedDrawings,
  getLinkedDrawingsByProject,
  getModulesLinkedToDrawing,
  getSupportedModules,
  getIntegrationSummary,
  linkDrawingToDocument,
};
