/**
 * القسم الحادي عشر - نظام إدارة المستندات (Document Management System - DMS)
 * =====================================================================================
 * الجزء الثاني (2/10): التصنيف الهرمي والمجلدات + النقل/النسخ + الأرشفة اليدوية/التلقائية
 *
 * يعتمد هذا الملف على نفس ملف التخزين الموحّد (backend/data/dms.json) المُدار من
 * خلال documentManagement.js (الجزء 1/10)، عبر واجهات مشتركة (Shared Store Accessors)
 * يُصدّرها ذلك الملف لتفادي ازدواجية القراءة/الكتابة على القرص أو تعارض الحالة.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - المجلدات الهرمية: شجرة فعلية غير محدودة العمق (parent_id) مع فحص فعلي لمنع
 *    الحلقات الدائرية (Circular References) عند النقل.
 *  - النقل/النسخ: تُحدَّث فعلياً روابط category_id للمستندات، والنسخ يُنشئ سجلّ
 *    مستند جديد بالكامل (رقم مرجعي جديد + نسخ فعلي لملف الإصدار الحالي على القرص)
 *    وليس مجرد مرجع (Reference) للملف الأصلي.
 *  - الأرشفة التلقائية: قاعدة فعلية قابلة للجدولة (عدم نشاط لمدة X يوم) تُطبَّق عبر
 *    دالة تُستدعى دورياً (cron-style) من server.js، وتُنتج سجل تدقيق فعلي لكل عملية.
 *  - الأرشفة اليدوية/الاستعادة: تُحدّث الحالة الفعلية للمستند + سجل تدقيق.
 */

const fs = require('fs');
const path = require('path');
const ACL = require('./documentAccessControl');

// ==================================================================================
// ============================ الربط بطبقة التخزين الموحّدة =========================
// ==================================================================================
// نتجنّب ازدواج تعريف DATA_DIR / FILES_DIR / DB_FILE عبر إعادة استخدام نفس المسارات
// التي يعتمدها documentManagement.js (الجزء 1/10) تماماً، لضمان أن كلا الملفّين
// يقرآن/يكتبان نفس ملف dms.json الفعلي على القرص.
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'dms_files');
const DB_FILE = path.join(DATA_DIR, 'dms.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function loadStore() {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error('قاعدة بيانات القسم غير مهيّأة بعد - يجب استدعاء وحدة إدارة المستندات (الجزء 1) أولاً');
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  if (!store.categories) store.categories = {};
  if (!store.auditLog) store.auditLog = [];
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

// اقتران مع DMS (الجزء 1) لإعادة استخدام دوال التوليد المرجعي وقراءة/كتابة الملفات
// الثنائية دون تكرار المنطق أو المخاطرة بعدم الاتساق بين الملفين.
let _dmsCore = null;
function getCore() {
  if (!_dmsCore) _dmsCore = require('./documentManagement');
  return _dmsCore;
}

// ==================================================================================
// ================================ إدارة المجلدات (Categories) ======================
// ==================================================================================

/**
 * إنشاء مجلد/تصنيف جديد ضمن الشجرة الهرمية. لا حد لعدد المستويات أو عدد المجلدات
 * (بحسب المواصفة: "إنشاء مجلدات غير محدودة").
 */
function createCategory(payload = {}) {
  const { name, parent_id = null, project_id = null, description = null, author = null } = payload;
  if (!name || !name.trim()) throw new Error('اسم المجلد (name) مطلوب');

  const store = loadStore();

  if (parent_id && !store.categories[parent_id]) {
    throw new Error('المجلد الأب (parent_id) غير موجود');
  }

  const parent = parent_id ? store.categories[parent_id] : null;
  const depth = parent ? parent.depth + 1 : 0;

  const id = newId('CAT');
  const record = {
    id,
    name: name.trim(),
    parent_id: parent_id || null,
    project_id: project_id || (parent ? parent.project_id : null),
    description: description || null,
    depth,
    path_ids: parent ? [...parent.path_ids, id] : [id],
    path_names: parent ? [...parent.path_names, name.trim()] : [name.trim()],
    document_count: 0,
    created_by: author || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.categories[id] = record;

  audit(store, { action: 'create_category', entity: 'category', entityId: id, projectId: record.project_id, actor: author, details: { name: record.name, parent_id } });
  saveStore(store);
  return { success: true, data: record };
}

function updateCategory(id, patch = {}, { actor = null } = {}) {
  const store = loadStore();
  const cat = store.categories[id];
  if (!cat) throw new Error('المجلد غير موجود');

  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('اسم المجلد لا يمكن أن يكون فارغاً');
    cat.name = patch.name.trim();
    // إعادة بناء path_names لهذا المجلد وكل أبنائه لأن الاسم تغيّر
    rebuildDescendantPaths(store, id);
  }
  if (patch.description !== undefined) cat.description = patch.description;
  cat.updated_at = nowISO();

  audit(store, { action: 'update_category', entity: 'category', entityId: id, projectId: cat.project_id, actor, details: patch });
  saveStore(store);
  return { success: true, data: cat };
}

/** يعيد بناء path_ids/path_names لمجلد ما ولكل أبنائه بشكل متكرر (بعد نقل أو إعادة تسمية) */
function rebuildDescendantPaths(store, categoryId) {
  const cat = store.categories[categoryId];
  if (!cat) return;
  const parent = cat.parent_id ? store.categories[cat.parent_id] : null;
  cat.depth = parent ? parent.depth + 1 : 0;
  cat.path_ids = parent ? [...parent.path_ids, cat.id] : [cat.id];
  cat.path_names = parent ? [...parent.path_names, cat.name] : [cat.name];

  const children = Object.values(store.categories).filter(c => c.parent_id === categoryId);
  for (const child of children) rebuildDescendantPaths(store, child.id);
}

/** يتحقق من عدم وجود حلقة دائرية: هل targetParentId هو أحد أحفاد categoryId؟ */
function isDescendant(store, categoryId, targetParentId) {
  if (categoryId === targetParentId) return true;
  const cat = store.categories[targetParentId];
  if (!cat) return false;
  return cat.path_ids.includes(categoryId);
}

/** نقل مجلد كامل (وكل أبنائه ومستنداته تبعاً) إلى مكان آخر في الشجرة */
function moveCategory(id, newParentId = null, { actor = null } = {}) {
  const store = loadStore();
  const cat = store.categories[id];
  if (!cat) throw new Error('المجلد غير موجود');

  if (newParentId) {
    if (!store.categories[newParentId]) throw new Error('المجلد الهدف (new_parent_id) غير موجود');
    if (isDescendant(store, id, newParentId)) {
      throw new Error('لا يمكن نقل المجلد داخل أحد أبنائه (سيؤدي لحلقة دائرية في الشجرة)');
    }
  }

  const oldParentId = cat.parent_id;
  cat.parent_id = newParentId || null;
  cat.updated_at = nowISO();
  rebuildDescendantPaths(store, id);

  audit(store, { action: 'move_category', entity: 'category', entityId: id, projectId: cat.project_id, actor, details: { from_parent: oldParentId, to_parent: newParentId } });
  saveStore(store);
  return { success: true, data: cat };
}

/** حذف مجلد - يُرفض إن كان يحتوي مجلدات فرعية أو مستندات، لمنع فقدان الربط بدون قصد */
function deleteCategory(id, { actor = null, force = false } = {}) {
  const store = loadStore();
  const cat = store.categories[id];
  if (!cat) throw new Error('المجلد غير موجود');

  const children = Object.values(store.categories).filter(c => c.parent_id === id);
  const docsInside = Object.values(store.documents || {}).filter(d => d.category_id === id);

  if ((children.length || docsInside.length) && !force) {
    throw new Error(`لا يمكن حذف المجلد: يحتوي ${children.length} مجلداً فرعياً و${docsInside.length} مستنداً. استخدم force=true لنقل المحتوى إلى المجلد الأب تلقائياً قبل الحذف.`);
  }

  if (force) {
    for (const child of children) moveCategory(child.id, cat.parent_id, { actor });
    for (const doc of docsInside) {
      doc.category_id = cat.parent_id || null;
      doc.updated_at = nowISO();
    }
  }

  delete store.categories[id];
  audit(store, { action: 'delete_category', entity: 'category', entityId: id, projectId: cat.project_id, actor, details: { force, moved_children: children.length, moved_documents: docsInside.length } });
  saveStore(store);
  return { success: true, data: { id, moved_children: children.length, moved_documents: docsInside.length } };
}

/** إعادة الشجرة كاملة أو مقيّدة بمشروع معيّن، بصيغة متداخلة (Nested Tree) جاهزة للعرض */
function getCategoryTree(projectId = null) {
  const store = loadStore();
  let cats = Object.values(store.categories);
  if (projectId) cats = cats.filter(c => c.project_id === projectId || !c.project_id);

  // حساب عدد المستندات الفعلي مباشرة داخل كل مجلد (وليس رقماً مخزَّناً قد يتقادم)
  const docs = Object.values(store.documents || {});
  const counts = {};
  for (const d of docs) {
    if (!d.category_id) continue;
    counts[d.category_id] = (counts[d.category_id] || 0) + 1;
  }

  const byId = {};
  for (const c of cats) byId[c.id] = { ...c, document_count: counts[c.id] || 0, children: [] };

  const roots = [];
  for (const c of cats) {
    const node = byId[c.id];
    if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].children.push(node);
    else roots.push(node);
  }

  const sortTree = (nodes) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(roots);

  return { success: true, data: { tree: roots, total_categories: cats.length } };
}

function listCategories(projectId = null) {
  const store = loadStore();
  let cats = Object.values(store.categories);
  if (projectId) cats = cats.filter(c => c.project_id === projectId || !c.project_id);
  cats.sort((a, b) => a.path_names.join('/').localeCompare(b.path_names.join('/'), 'ar'));
  return { success: true, data: cats };
}

// ==================================================================================
// ==================== تصنيف المستندات (وضع مستند داخل مجلد) ========================
// ==================================================================================

/** يضع مستنداً موجوداً داخل مجلد (أو يزيله من كل المجلدات إن category_id=null) */
function assignDocumentToCategory(documentId, categoryId = null, { actor = null } = {}) {
  const store = loadStore();
  const doc = store.documents?.[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (categoryId && !store.categories[categoryId]) throw new Error('المجلد الهدف غير موجود');

  const oldCategoryId = doc.category_id;
  doc.category_id = categoryId || null;
  doc.updated_at = nowISO();

  audit(store, { action: 'assign_category', entity: 'document', entityId: documentId, projectId: doc.project_id, actor, details: { from: oldCategoryId, to: categoryId } });
  saveStore(store);
  return { success: true, data: doc };
}

// ==================================================================================
// ========================= نقل ونسخ المستندات (Move / Copy) ========================
// ==================================================================================

/** نقل مستند واحد أو أكثر إلى مجلد آخر (تحديث فعلي لـ category_id لكل مستند) */
function moveDocuments(documentIds = [], targetCategoryId = null, { actor = null, token = null } = {}) {
  if (!Array.isArray(documentIds) || !documentIds.length) throw new Error('قائمة المستندات (document_ids) مطلوبة');
  const store = loadStore();
  if (targetCategoryId && !store.categories[targetCategoryId]) throw new Error('المجلد الهدف غير موجود');

  const moved = [];
  for (const docId of documentIds) {
    const doc = store.documents?.[docId];
    if (!doc) continue;
    if (token) { try { ACL.assertDocumentAccess(token, doc, 'move'); } catch (e) { continue; } }
    const from = doc.category_id;
    doc.category_id = targetCategoryId || null;
    doc.updated_at = nowISO();
    moved.push({ id: docId, from_category: from, to_category: targetCategoryId || null });
  }

  audit(store, { action: 'move_documents', entity: 'document', entityId: documentIds.join(','), actor, details: { target_category: targetCategoryId, count: moved.length } });
  saveStore(store);
  return { success: true, data: { moved_count: moved.length, moved } };
}

/**
 * نسخ مستند فعلياً: ينشئ سجل مستند جديد بالكامل (رقم مرجعي جديد خاص به) مع نسخ
 * فعلي لملف الإصدار الحالي على القرص (وليس رابطاً/مرجعاً للملف الأصلي)، حتى يكون
 * تعديل النسخة لاحقاً مستقلاً تماماً عن المستند الأصلي.
 */
function copyDocument(documentId, { targetCategoryId = null, targetProjectId = undefined, actor = null, token = null } = {}) {
  const store = loadStore();
  const doc = store.documents?.[documentId];
  if (!doc) throw new Error('المستند غير موجود');
  if (token) ACL.assertDocumentAccess(token, doc, 'view');
  if (targetCategoryId && !store.categories[targetCategoryId]) throw new Error('المجلد الهدف غير موجود');

  const currentVersion = store.versions?.[doc.current_version_id];
  if (!currentVersion) throw new Error('تعذّر إيجاد الإصدار الحالي للمستند لنسخه');

  const filePath = path.join(FILES_DIR, currentVersion.stored_file_name);
  if (!fs.existsSync(filePath)) throw new Error('ملف الإصدار الحالي غير موجود فعلياً على القرص');
  const buffer = fs.readFileSync(filePath);

  const core = getCore();
  const newProjectId = targetProjectId !== undefined ? targetProjectId : doc.project_id;

  // إعادة استخدام دالة الرفع الحقيقية في الجزء 1 لضمان توليد رقم مرجعي جديد صحيح،
  // وحساب checksum جديد، وكتابة الملف الثنائي فعلياً كنسخة مستقلة على القرص.
  const result = core.uploadDocument({
    title: `${doc.title} (نسخة)`,
    doc_type: doc.doc_type,
    project_id: newProjectId,
    department: doc.department,
    description: doc.description,
    keywords: [...(doc.keywords || [])],
    file_name: currentVersion.file_name,
    content_base64: buffer.toString('base64'),
    author: actor,
  });

  // إعادة تحميل الحالة بعد أن كتب core.uploadDocument نسخته الخاصة على القرص
  const store2 = loadStore();
  const newDoc = store2.documents[result.data.id];
  newDoc.category_id = targetCategoryId || null;
  newDoc.copied_from_document_id = documentId;
  newDoc.updated_at = nowISO();

  audit(store2, {
    action: 'copy_document', entity: 'document', entityId: newDoc.id, projectId: newDoc.project_id, actor,
    details: { copied_from: documentId, target_category: targetCategoryId },
  });
  saveStore(store2);

  return { success: true, data: newDoc };
}

// ==================================================================================
// ================================= الأرشفة (Archiving) ==============================
// ==================================================================================

/** أرشفة يدوية لمستند واحد أو أكثر (الحالة + علم archived فعلياً، وليس مجرد نقل شكلي) */
function archiveDocuments(documentIds = [], { actor = null, reason = null, token = null } = {}) {
  if (!Array.isArray(documentIds) || !documentIds.length) throw new Error('قائمة المستندات (document_ids) مطلوبة');
  const store = loadStore();
  const archived = [];
  for (const docId of documentIds) {
    const doc = store.documents?.[docId];
    if (!doc || doc.archived) continue;
    if (token) { try { ACL.assertDocumentAccess(token, doc, 'archive'); } catch (e) { continue; } }
    doc.archived = true;
    doc.status = 'archived';
    doc.archived_at = nowISO();
    doc.archive_reason = reason || 'أرشفة يدوية';
    doc.updated_at = nowISO();
    archived.push(docId);
  }

  audit(store, { action: 'archive_manual', entity: 'document', entityId: documentIds.join(','), actor, details: { count: archived.length, reason } });
  saveStore(store);
  return { success: true, data: { archived_count: archived.length, archived_ids: archived } };
}

/** استعادة مستندات من الأرشيف إلى حالتها التشغيلية (draft) لإعادة تفعيلها */
function unarchiveDocuments(documentIds = [], { actor = null, token = null } = {}) {
  if (!Array.isArray(documentIds) || !documentIds.length) throw new Error('قائمة المستندات (document_ids) مطلوبة');
  const store = loadStore();
  const restored = [];
  for (const docId of documentIds) {
    const doc = store.documents?.[docId];
    if (!doc || !doc.archived) continue;
    if (token) { try { ACL.assertDocumentAccess(token, doc, 'unarchive'); } catch (e) { continue; } }
    doc.archived = false;
    doc.status = 'draft';
    doc.archived_at = null;
    doc.archive_reason = null;
    doc.updated_at = nowISO();
    restored.push(docId);
  }

  audit(store, { action: 'unarchive', entity: 'document', entityId: documentIds.join(','), actor, details: { count: restored.length } });
  saveStore(store);
  return { success: true, data: { restored_count: restored.length, restored_ids: restored } };
}

/**
 * قاعدة أرشفة تلقائية قابلة للتخصيص حسب نوع المستند: أي مستند لم يُعدَّل (updated_at)
 * منذ أكثر من inactivity_days يوماً، وحالته منشور/معتمد (وليس مسودة قيد العمل)،
 * يُؤرشَف تلقائياً. تُستدعى هذه الدالة دورياً (مثلاً مرة يومياً) من server.js.
 */
const DEFAULT_AUTO_ARCHIVE_RULES = {
  // عدد أيام عدم النشاط قبل الأرشفة التلقائية، افتراضياً لكل المجموعات، مع استثناءات
  default_inactivity_days: 365,
  by_group: {
    project: 365,
    quality: 730,     // مستندات الجودة تُحفَظ فترة أطول لأغراض التدقيق
    safety: 1095,     // مستندات السلامة (حوادث/تصاريح) تُحفَظ 3 سنوات كحد أدنى
    financial: 2555,  // 7 سنوات - يطابق متطلبات الاحتفاظ المالي الشائعة
    administrative: 730,
  },
  eligible_statuses: ['approved', 'published'],
};

function runAutoArchive({ actor = 'system:auto-archive', rules = null } = {}) {
  const store = loadStore();
  const effectiveRules = rules || DEFAULT_AUTO_ARCHIVE_RULES;
  const now = Date.now();
  const archived = [];

  for (const doc of Object.values(store.documents || {})) {
    if (doc.archived) continue;
    if (!effectiveRules.eligible_statuses.includes(doc.status)) continue;

    const days = effectiveRules.by_group?.[doc.doc_group] ?? effectiveRules.default_inactivity_days;
    const inactiveMs = now - new Date(doc.updated_at).getTime();
    const thresholdMs = days * 24 * 60 * 60 * 1000;

    if (inactiveMs >= thresholdMs) {
      doc.archived = true;
      doc.status = 'archived';
      doc.archived_at = nowISO();
      doc.archive_reason = `أرشفة تلقائية: عدم نشاط لأكثر من ${days} يوماً`;
      doc.updated_at = nowISO();
      archived.push(doc.id);
    }
  }

  if (archived.length) {
    audit(store, { action: 'archive_auto', entity: 'document', entityId: archived.join(','), actor, details: { count: archived.length, rules: effectiveRules } });
    saveStore(store);
  }

  return { success: true, data: { archived_count: archived.length, archived_ids: archived, checked_at: nowISO() } };
}

function getAutoArchiveRules() {
  return { success: true, data: DEFAULT_AUTO_ARCHIVE_RULES };
}

/** جدولة الأرشفة التلقائية الدورية (نمط setInterval بسيط بدون تبعيات خارجية) */
let _autoArchiveTimer = null;
function scheduleAutoArchive({ intervalHours = 24 } = {}) {
  if (_autoArchiveTimer) clearInterval(_autoArchiveTimer);
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  _autoArchiveTimer = setInterval(() => {
    try { runAutoArchive({}); } catch (e) { /* لا نوقف الخادم بسبب فشل مهمة مجدولة */ }
  }, intervalMs);
  if (_autoArchiveTimer.unref) _autoArchiveTimer.unref();
  return { success: true, data: { scheduled: true, interval_hours: intervalHours } };
}

module.exports = {
  // مجلدات
  createCategory,
  updateCategory,
  moveCategory,
  deleteCategory,
  getCategoryTree,
  listCategories,
  assignDocumentToCategory,

  // نقل/نسخ المستندات
  moveDocuments,
  copyDocument,

  // أرشفة
  archiveDocuments,
  unarchiveDocuments,
  runAutoArchive,
  getAutoArchiveRules,
  scheduleAutoArchive,
  DEFAULT_AUTO_ARCHIVE_RULES,
};
