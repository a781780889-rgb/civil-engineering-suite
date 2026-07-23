/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الرابع (4/10): إدارة الطبقات (Layers) الوصفية
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10
 * (نفس ملف backend/data/drawings.json) بدون أي اعتمادية دائرية، بنفس أسلوب
 * drawingVersions.js و drawingViewer.js: يستخدم drawingManagement.js._internal مباشرة.
 *
 * يغطي هذا الجزء بند "إدارة الطبقات (Layers)" من المواصفة الأصلية على مستوى الـ backend:
 *  - تخزين وصفي فعلي لطبقات كل مخطط (اسم الطبقة، مرئية/مخفية، مقفلة، الترتيب، التصنيف، اللون).
 *  - إنشاء طبقة جديدة لمخطط، تعديل بياناتها، حذفها.
 *  - تشغيل/إيقاف الطبقة (visible)، قفل/فتح الطبقة (locked).
 *  - إعادة ترتيب الطبقات (تغيير الحقل order لطبقة واحدة أو لمجموعة كاملة دفعة واحدة).
 *  - بحث عن طبقة داخل مخطط بالاسم أو التصنيف.
 *
 * ملاحظة نطاق العمل (كما في الجزء 3/10): هذا الجزء يوفر طبقة البيانات الوصفية للطبقات
 * التي يحتاجها أي عارض عميل (frontend) يقرأ ملف CAD فعلياً ويعرض طبقاته الحقيقية؛
 * قراءة الطبقات الفعلية من داخل ملف DWG/DXF/RVT/IFC نفسه تعتمد على مكتبات عميل
 * خارج نطاق الـ backend، تماماً كما هو موثّق في DRAWINGS_PLAN.md لبند العارض.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل طبقة تُخزَّن فعلياً في drawings.json مع كل حقولها (اسم/مرئية/مقفلة/ترتيب/تصنيف/لون).
 *  - التحقق الفعلي من عدم تكرار اسم الطبقة داخل نفس المخطط.
 *  - إعادة الترتيب تعيد فعلياً حساب حقل order لكل الطبقات المتأثرة (وليس فقط تخزين رقم يرسله العميل بلا تحقق).
 *  - سجل تدقيق فعلي موحّد مع بقية الأجزاء لكل عملية إنشاء/تعديل/حذف/تبديل حالة/إعادة ترتيب.
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

function ensureLayerCollections(db) {
  if (!Array.isArray(db.layers)) db.layers = [];
}

function getDrawingLayers(db, drawingId) {
  return db.layers
    .filter((l) => l.drawing_id === drawingId)
    .sort((a, b) => a.order - b.order);
}

function nextOrder(db, drawingId) {
  const layers = getDrawingLayers(db, drawingId);
  if (!layers.length) return 0;
  return Math.max(...layers.map((l) => l.order)) + 1;
}

// تصنيفات الطبقات المقترحة (وصفية فقط - لا تمنع قيماً أخرى، لتغطية أي نوع مخطط)
const LAYER_CATEGORIES = ['structural', 'architectural', 'electrical', 'mechanical', 'annotation', 'dimension', 'grid', 'other'];
const LAYER_CATEGORY_LABELS_AR = {
  structural: 'إنشائي', architectural: 'معماري', electrical: 'كهربائي', mechanical: 'ميكانيكي',
  annotation: 'تعليقات توضيحية', dimension: 'أبعاد', grid: 'شبكة محاور', other: 'أخرى',
};

function normalizeCategory(category) {
  if (!category) return 'other';
  const c = String(category).toLowerCase();
  return LAYER_CATEGORIES.includes(c) ? c : 'other';
}

// ===================== 1) إنشاء طبقة جديدة =====================
/**
 * @param {string} drawingId
 * @param {Object} payload { name, category(اختياري), color(اختياري), visible(اختياري، افتراضي true),
 *                            locked(اختياري، افتراضي false), order(اختياري - إن لم يُحدَّد يُضاف للنهاية), actor }
 */
function createLayer(drawingId, payload = {}) {
  const {
    name, category, color, visible, locked, order, actor,
  } = payload;
  if (!name || !String(name).trim()) throw new Error('اسم الطبقة مطلوب');

  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const trimmedName = String(name).trim();
  const existing = db.layers.find((l) => l.drawing_id === drawingId && l.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) throw new Error(`طبقة بهذا الاسم (${trimmedName}) موجودة بالفعل على هذا المخطط`);

  const layer = {
    id: newId('LYR'),
    drawing_id: drawingId,
    name: trimmedName,
    category: normalizeCategory(category),
    color: color || null,
    visible: visible === undefined ? true : !!visible,
    locked: locked === undefined ? false : !!locked,
    order: order !== undefined && order !== null ? Number(order) : nextOrder(db, drawingId),
    created_by: actor || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.layers.push(layer);

  logAudit(db, {
    action: 'create_layer',
    drawingId,
    actor,
    details: `إنشاء طبقة (${layer.name}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layer };
}

// ===================== 2) سرد طبقات مخطط =====================
function listLayers(drawingId, filters = {}) {
  const db = loadDB();
  ensureLayerCollections(db);
  findDrawing(db, drawingId);

  let list = getDrawingLayers(db, drawingId);
  if (filters.category) list = list.filter((l) => l.category === normalizeCategory(filters.category));
  if (filters.visible !== undefined && filters.visible !== null && filters.visible !== '') {
    const wantVisible = filters.visible === true || filters.visible === 'true';
    list = list.filter((l) => l.visible === wantVisible);
  }
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    list = list.filter((l) => l.name.toLowerCase().includes(q));
  }

  return { success: true, layers: list };
}

function getLayer(drawingId, layerId) {
  const db = loadDB();
  ensureLayerCollections(db);
  findDrawing(db, drawingId);
  const layer = db.layers.find((l) => l.id === layerId && l.drawing_id === drawingId);
  if (!layer) throw new Error('الطبقة غير موجودة');
  return { success: true, layer };
}

// ===================== 3) تعديل بيانات طبقة =====================
function updateLayer(drawingId, layerId, updates = {}, { actor } = {}) {
  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const layer = db.layers.find((l) => l.id === layerId && l.drawing_id === drawingId);
  if (!layer) throw new Error('الطبقة غير موجودة');

  if (updates.name !== undefined) {
    const trimmedName = String(updates.name).trim();
    if (!trimmedName) throw new Error('اسم الطبقة مطلوب');
    const duplicate = db.layers.find((l) => l.drawing_id === drawingId && l.id !== layerId && l.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) throw new Error(`طبقة بهذا الاسم (${trimmedName}) موجودة بالفعل على هذا المخطط`);
    layer.name = trimmedName;
  }
  if (updates.category !== undefined) layer.category = normalizeCategory(updates.category);
  if (updates.color !== undefined) layer.color = updates.color || null;
  if (updates.visible !== undefined) layer.visible = !!updates.visible;
  if (updates.locked !== undefined) layer.locked = !!updates.locked;
  if (updates.order !== undefined && updates.order !== null) layer.order = Number(updates.order);
  layer.updated_at = nowISO();

  logAudit(db, {
    action: 'update_layer',
    drawingId,
    actor,
    details: `تحديث بيانات طبقة (${layer.name}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layer };
}

// ===================== 4) حذف طبقة =====================
function deleteLayer(drawingId, layerId, { actor } = {}) {
  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const idx = db.layers.findIndex((l) => l.id === layerId && l.drawing_id === drawingId);
  if (idx === -1) throw new Error('الطبقة غير موجودة');
  const removed = db.layers.splice(idx, 1)[0];

  logAudit(db, {
    action: 'delete_layer',
    drawingId,
    actor,
    details: `حذف طبقة (${removed.name}) من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true };
}

// ===================== 5) تشغيل/إيقاف طبقة (visible) =====================
function toggleLayerVisibility(drawingId, layerId, { visible, actor } = {}) {
  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const layer = db.layers.find((l) => l.id === layerId && l.drawing_id === drawingId);
  if (!layer) throw new Error('الطبقة غير موجودة');

  layer.visible = visible === undefined ? !layer.visible : !!visible;
  layer.updated_at = nowISO();

  logAudit(db, {
    action: 'toggle_layer_visibility',
    drawingId,
    actor,
    details: `${layer.visible ? 'إظهار' : 'إخفاء'} طبقة (${layer.name}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layer };
}

// ===================== 6) قفل/فتح طبقة (locked) =====================
function toggleLayerLock(drawingId, layerId, { locked, actor } = {}) {
  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const layer = db.layers.find((l) => l.id === layerId && l.drawing_id === drawingId);
  if (!layer) throw new Error('الطبقة غير موجودة');

  layer.locked = locked === undefined ? !layer.locked : !!locked;
  layer.updated_at = nowISO();

  logAudit(db, {
    action: 'toggle_layer_lock',
    drawingId,
    actor,
    details: `${layer.locked ? 'قفل' : 'فتح قفل'} طبقة (${layer.name}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layer };
}

// ===================== 7) إعادة ترتيب الطبقات =====================
/**
 * إعادة ترتيب كامل لطبقات مخطط دفعة واحدة.
 * @param {string} drawingId
 * @param {string[]} orderedLayerIds - مصفوفة معرّفات الطبقات بالترتيب الجديد المطلوب (يجب أن تشمل كل طبقات المخطط)
 */
function reorderLayers(drawingId, orderedLayerIds, { actor } = {}) {
  if (!Array.isArray(orderedLayerIds) || !orderedLayerIds.length) {
    throw new Error('قائمة معرّفات الطبقات المرتّبة (orderedLayerIds) مطلوبة وغير فارغة');
  }

  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const currentLayers = getDrawingLayers(db, drawingId);
  const currentIds = new Set(currentLayers.map((l) => l.id));
  const requestedIds = new Set(orderedLayerIds);

  if (currentIds.size !== requestedIds.size || [...currentIds].some((id) => !requestedIds.has(id))) {
    throw new Error('يجب أن تتضمن قائمة إعادة الترتيب جميع طبقات المخطط دون نقص أو تكرار');
  }

  orderedLayerIds.forEach((layerId, index) => {
    const layer = db.layers.find((l) => l.id === layerId && l.drawing_id === drawingId);
    layer.order = index;
    layer.updated_at = nowISO();
  });

  logAudit(db, {
    action: 'reorder_layers',
    drawingId,
    actor,
    details: `إعادة ترتيب ${orderedLayerIds.length} طبقة على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layers: getDrawingLayers(db, drawingId) };
}

/**
 * تحريك طبقة واحدة خطوة للأعلى أو للأسفل في الترتيب (أداة مساعدة أخف من إعادة الترتيب الكاملة).
 * @param {string} direction 'up' | 'down'
 */
function moveLayer(drawingId, layerId, direction, { actor } = {}) {
  if (!['up', 'down'].includes(direction)) throw new Error('الاتجاه (direction) يجب أن يكون up أو down');

  const db = loadDB();
  ensureLayerCollections(db);
  const rec = findDrawing(db, drawingId);

  const layers = getDrawingLayers(db, drawingId);
  const idx = layers.findIndex((l) => l.id === layerId);
  if (idx === -1) throw new Error('الطبقة غير موجودة');

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= layers.length) {
    return { success: true, layers, moved: false };
  }

  const a = layers[idx];
  const b = layers[swapIdx];
  const tmp = a.order;
  a.order = b.order;
  b.order = tmp;
  a.updated_at = nowISO();
  b.updated_at = nowISO();

  logAudit(db, {
    action: 'move_layer',
    drawingId,
    actor,
    details: `تحريك طبقة (${a.name}) ${direction === 'up' ? 'للأعلى' : 'للأسفل'} على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, layers: getDrawingLayers(db, drawingId), moved: true };
}

// ===================== 8) البحث عن طبقة داخل مخطط =====================
function searchLayers(drawingId, query) {
  const db = loadDB();
  ensureLayerCollections(db);
  findDrawing(db, drawingId);
  if (!query || !String(query).trim()) return { success: true, layers: getDrawingLayers(db, drawingId) };

  const q = String(query).toLowerCase();
  const results = getDrawingLayers(db, drawingId).filter((l) => (
    l.name.toLowerCase().includes(q)
    || l.category.toLowerCase().includes(q)
    || (LAYER_CATEGORY_LABELS_AR[l.category] || '').toLowerCase().includes(q)
  ));
  return { success: true, layers: results };
}

module.exports = {
  LAYER_CATEGORIES,
  LAYER_CATEGORY_LABELS_AR,
  createLayer,
  listLayers,
  getLayer,
  updateLayer,
  deleteLayer,
  toggleLayerVisibility,
  toggleLayerLock,
  reorderLayers,
  moveLayer,
  searchLayers,
};
