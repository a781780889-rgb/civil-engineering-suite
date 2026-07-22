// ============================================================
// القسم الحادي عشر: نظام إدارة المستندات (DMS)
// البند المتبقي: التكامل التلقائي مع باقي أقسام النظام
// ------------------------------------------------------------
// هذه الوحدة تُنشئ "جدول ربط" عام (document_id <-> module/entity)
// بحيث تظهر المستندات المرتبطة مباشرة داخل كل قسم من أقسام النظام:
// إدارة المشاريع، حصر الكميات، الجودة، السلامة، المعدات، المساحة،
// الجدول الزمني، المشتريات، العقود، التقارير ... إلخ.
//
// الفكرة: أي قسم آخر في النظام (مثلاً QMS عند إنشاء طلب فحص IR،
// أو HSE عند تسجيل حادثة) يستدعي linkDocument() لربط مستند موجود
// فعلاً في DMS بسجل ذلك القسم. بعدها، يستدعي ذلك القسم
// getLinkedDocuments() لعرض قائمة المستندات المرتبطة مباشرة ضمن
// واجهته، دون الحاجة لإعادة بناء منطق البحث أو التخزين.
// ============================================================

const fs = require('fs');
const path = require('path');

const DMS = require('./documentManagement');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dms_module_links.json');

// الأقسام المدعومة رسمياً للربط (module keys) — تُستخدم للتحقق والعرض في الواجهات
const SUPPORTED_MODULES = {
  project: { label: 'إدارة المشاريع' },
  boq: { label: 'حصر الكميات' },
  quality: { label: 'إدارة الجودة' },
  safety: { label: 'السلامة المهنية' },
  equipment: { label: 'إدارة المعدات' },
  workers: { label: 'إدارة العمال' },
  survey: { label: 'تطبيق المساحة' },
  schedule: { label: 'الجدول الزمني' },
  procurement: { label: 'إدارة المشتريات' },
  contracts: { label: 'إدارة العقود' },
  reports: { label: 'التقارير' },
  finance: { label: 'إدارة الميزانية' },
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

function audit(store, { action, entity, entityId, projectId = null, actor = null, details = {} }) {
  store.audit_log.push({
    id: newId('LOG'), action, entity, entity_id: entityId,
    project_id: projectId, actor, details, timestamp: nowISO(),
  });
  if (store.audit_log.length > 5000) store.audit_log = store.audit_log.slice(-5000);
}

function assertModuleValid(module) {
  if (!SUPPORTED_MODULES[module]) {
    throw new Error(`القسم "${module}" غير مدعوم للربط. الأقسام المدعومة: ${Object.keys(SUPPORTED_MODULES).join(', ')}`);
  }
}

function assertDocumentExists(documentId) {
  const res = DMS.getDocument(documentId, {});
  if (!res || res.success === false || !res.data) {
    throw new Error('المستند المطلوب ربطه غير موجود في نظام إدارة المستندات');
  }
  return res.data;
}

// ------------------------------------------------------------
// ربط مستند موجود بسجل في أي قسم آخر
// ------------------------------------------------------------
function linkDocument({
  documentId, module, entityId, entityLabel = null, projectId = null, actor = null, note = null,
} = {}) {
  if (!documentId) throw new Error('معرّف المستند (documentId) مطلوب');
  if (!module) throw new Error('اسم القسم (module) مطلوب');
  if (!entityId) throw new Error('معرّف السجل المرتبط (entityId) مطلوب');

  assertModuleValid(module);
  const doc = assertDocumentExists(documentId);

  const store = loadStore();

  // منع تكرار نفس الربط
  const existing = Object.values(store.links).find(
    (l) => l.document_id === documentId && l.module === module && l.entity_id === String(entityId),
  );
  if (existing) return { success: true, data: existing, already_linked: true };

  const link = {
    id: newId('LNK'),
    document_id: documentId,
    module,
    entity_id: String(entityId),
    entity_label: entityLabel,
    project_id: projectId || doc.project_id || null,
    note,
    linked_by: actor,
    linked_at: nowISO(),
  };
  store.links[link.id] = link;
  audit(store, {
    action: 'link', entity: 'module_link', entityId: link.id,
    projectId: link.project_id, actor, details: { module, entityId, documentId },
  });
  saveStore(store);
  return { success: true, data: link };
}

// ربط عدة مستندات دفعة واحدة بنفس السجل
function linkDocuments({ documentIds = [], module, entityId, entityLabel = null, projectId = null, actor = null } = {}) {
  const results = documentIds.map((docId) => linkDocument({
    documentId: docId, module, entityId, entityLabel, projectId, actor,
  }));
  return { success: true, data: results };
}

// فك ربط مستند عن سجل
function unlinkDocument(linkId, { actor = null } = {}) {
  const store = loadStore();
  const link = store.links[linkId];
  if (!link) throw new Error('رابط المستند غير موجود');
  delete store.links[linkId];
  audit(store, {
    action: 'unlink', entity: 'module_link', entityId: linkId,
    projectId: link.project_id, actor, details: { module: link.module, entityId: link.entity_id, documentId: link.document_id },
  });
  saveStore(store);
  return { success: true };
}

// ------------------------------------------------------------
// الاستعلام: جلب كل المستندات المرتبطة بسجل معيّن داخل قسم معيّن
// (هذه هي الدالة التي تستدعيها كل الأقسام الأخرى لعرض
// "المستندات المرتبطة" مباشرة في واجهتها)
// ------------------------------------------------------------
function getLinkedDocuments(module, entityId) {
  assertModuleValid(module);
  const store = loadStore();
  const links = Object.values(store.links).filter(
    (l) => l.module === module && l.entity_id === String(entityId),
  );

  const documents = links.map((link) => {
    const docRes = DMS.getDocument(link.document_id, {});
    const doc = docRes && docRes.success !== false ? docRes.data : null;
    return {
      link_id: link.id,
      document_id: link.document_id,
      linked_at: link.linked_at,
      linked_by: link.linked_by,
      note: link.note,
      document: doc ? {
        id: doc.id,
        title: doc.title,
        document_number: doc.document_number,
        doc_type: doc.doc_type,
        doc_group: doc.doc_group,
        status: doc.status,
        current_version: doc.current_version,
        file_type: doc.file_type,
        updated_at: doc.updated_at,
      } : null,
      missing: !doc,
    };
  });

  return { success: true, data: documents, count: documents.length };
}

// جلب كل الروابط الخاصة بمشروع معيّن مجمّعة حسب القسم (لعرضها في لوحة تحكم المشروع)
function getLinkedDocumentsByProject(projectId) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');
  const store = loadStore();
  const links = Object.values(store.links).filter((l) => l.project_id === projectId);

  const grouped = {};
  for (const module of Object.keys(SUPPORTED_MODULES)) grouped[module] = [];

  for (const link of links) {
    const docRes = DMS.getDocument(link.document_id, {});
    const doc = docRes && docRes.success !== false ? docRes.data : null;
    if (!grouped[link.module]) grouped[link.module] = [];
    grouped[link.module].push({
      link_id: link.id,
      document_id: link.document_id,
      entity_id: link.entity_id,
      entity_label: link.entity_label,
      document: doc ? {
        title: doc.title,
        document_number: doc.document_number,
        status: doc.status,
        doc_type: doc.doc_type,
      } : null,
      missing: !doc,
    });
  }

  return { success: true, data: grouped, total: links.length };
}

// جلب كل السجلات (في كل الأقسام) المرتبطة بمستند معيّن — مفيد داخل شاشة المستند نفسه
function getModulesLinkedToDocument(documentId) {
  const store = loadStore();
  const links = Object.values(store.links).filter((l) => l.document_id === documentId);
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

// ملخص إحصائي عام (لعرضه في لوحة تحكم DMS الرئيسية)
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

module.exports = {
  SUPPORTED_MODULES,
  linkDocument,
  linkDocuments,
  unlinkDocument,
  getLinkedDocuments,
  getLinkedDocumentsByProject,
  getModulesLinkedToDocument,
  getSupportedModules,
  getIntegrationSummary,
};
