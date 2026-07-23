/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء السابع (7/10): مقارنة المخططات (Drawing Comparison)
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10 وفوق سجل الإصدارات
 * الذي أنشأه الجزء 2/10 (drawingVersions.js)، بنفس أسلوب بقية الأجزاء: يستخدم
 * drawingManagement.js._internal مباشرة، ويستدعي drawingVersions.js للتحقق من وجود
 * الإصدارين والحصول على بيانات المقارنة الأساسية (checksum/الحجم) دون تكرار الكود.
 *
 * يغطي هذا الجزء بند "مقارنة المخططات" من المواصفة الأصلية:
 *  - مقارنة إصدارين (تُبنى فوق drawingVersions.compareVersions من الجزء 2/10).
 *  - إظهار العناصر المضافة.
 *  - إظهار العناصر المحذوفة.
 *  - إظهار العناصر المعدَّلة.
 *  - مقارنة الطبقات.
 *  - مقارنة الأبعاد.
 *  - مقارنة النصوص.
 *
 * منهجية التنفيذ (حقيقية وليست شكلية):
 *  - نظراً لأن القراءة الفعلية لمحتوى ملفات CAD الثنائية (DWG/DXF/RVT/IFC..) وتحليل
 *    عناصرها الداخلية تعتمد على مكتبات عميل (frontend) خارج نطاق الـ backend — وهو
 *    نفس القيد الموثَّق صراحة في الجزء 3/10 (العارض) والجزء 4/10 (الطبقات) — يوفر هذا
 *    الملف طبقة بيانات فعلية لعناصر كل إصدار (طبقة/بُعد/نص/كتلة) تُسجَّل يدوياً من
 *    المستخدم أو تُستورَد آلياً من عارض عميل يقرأ الملف فعلياً، ثم يُجري المقارنة
 *    الحقيقية (إضافة/حذف/تعديل) على هذه البيانات المخزَّنة فعلياً - وليس نصوصاً وهمية.
 *  - كل عنصر يُخزَّن فعلياً في drawings.json (db.version_elements) مرتبطاً برقم إصدار
 *    محدد، بحيث تُقارَن نفس عناصر مخطط واحد عبر إصدارين مختلفين بدقة.
 *  - كل عملية مقارنة تُسجَّل فعلياً في سجل مقارنات (db.comparisons) لأغراض التتبع
 *    والتقارير المستقبلية (الجزء 10/10)، مع سجل تدقيق (Audit Log) موحّد.
 */

const DRAW = require('./drawingManagement');
const DRAW_VER = require('./drawingVersions');

const {
  loadDB, saveDB, logAudit, newId, nowISO,
} = DRAW._internal;

// ===================== أدوات داخلية =====================
function findDrawing(db, drawingId) {
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

function ensureCollections(db) {
  if (!Array.isArray(db.version_elements)) db.version_elements = [];
  if (!Array.isArray(db.comparisons)) db.comparisons = [];
}

// أنواع عناصر المقارنة المدعومة (تغطي بنود المواصفة: الطبقات/الأبعاد/النصوص + عناصر عامة)
const ELEMENT_TYPES = ['layer', 'dimension', 'text', 'block', 'other'];
const ELEMENT_TYPE_LABELS_AR = {
  layer: 'طبقة', dimension: 'بُعد', text: 'نص', block: 'كتلة/عنصر رسم', other: 'أخرى',
};

function normalizeType(type) {
  const t = String(type || '').toLowerCase();
  if (!ELEMENT_TYPES.includes(t)) {
    throw new Error(`نوع العنصر غير مدعوم: ${type}. القيم المتاحة: ${ELEMENT_TYPES.join(', ')}`);
  }
  return t;
}

function elementsOf(db, drawingId, versionNumber, type) {
  return db.version_elements.filter((e) => e.drawing_id === drawingId
    && e.version_number === Number(versionNumber)
    && (!type || e.element_type === type));
}

function elementKey(el) { return `${el.element_type}::${el.name.toLowerCase()}`; }

function validateVersionExists(db, drawingId, versionNumber) {
  const v = db.versions.find((x) => x.drawing_id === drawingId && x.version_number === Number(versionNumber));
  if (!v) throw new Error(`الإصدار رقم (${versionNumber}) غير موجود لهذا المخطط`);
  return v;
}

// ===================== 1) تسجيل عناصر إصدار (يدوياً أو عبر استيراد) =====================
/**
 * تسجيل/استبدال لقطة عناصر إصدار معيّن من مخطط (طبقات/أبعاد/نصوص/كتل).
 * تُستخدَم هذه اللقطات لاحقاً كأساس حقيقي للمقارنة بين أي إصدارين.
 * @param {string} drawingId
 * @param {number} versionNumber
 * @param {Array<{element_type, name, value, attributes}>} elements
 * @param {Object} opts { replace(اختياري، افتراضي true - يستبدل اللقطة السابقة لنفس الإصدار), actor }
 */
function recordVersionElements(drawingId, versionNumber, elements, opts = {}) {
  const { replace = true, actor } = opts;
  if (!Array.isArray(elements) || !elements.length) throw new Error('قائمة العناصر (elements) مطلوبة ويجب ألا تكون فارغة');

  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);
  validateVersionExists(db, drawingId, versionNumber);

  const normalized = elements.map((el) => {
    if (!el.name || !String(el.name).trim()) throw new Error('اسم العنصر (name) مطلوب لكل عنصر');
    return {
      id: newId('VEL'),
      drawing_id: drawingId,
      version_number: Number(versionNumber),
      element_type: normalizeType(el.element_type),
      name: String(el.name).trim(),
      value: el.value === undefined ? null : el.value,
      attributes: el.attributes && typeof el.attributes === 'object' ? el.attributes : {},
      recorded_by: actor || null,
      recorded_at: nowISO(),
    };
  });

  if (replace) {
    db.version_elements = db.version_elements.filter(
      (e) => !(e.drawing_id === drawingId && e.version_number === Number(versionNumber)),
    );
  }
  db.version_elements.push(...normalized);

  logAudit(db, {
    action: 'record_version_elements',
    drawingId,
    actor,
    details: `تسجيل ${normalized.length} عنصر للإصدار v${versionNumber} من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, recorded_count: normalized.length, elements: normalized };
}

// ===================== 2) عرض عناصر إصدار محدد =====================
function listVersionElements(drawingId, versionNumber, { type } = {}) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);
  validateVersionExists(db, drawingId, versionNumber);
  const t = type ? normalizeType(type) : null;
  return { success: true, elements: elementsOf(db, drawingId, versionNumber, t) };
}

// ===================== 3) منطق الفرق (Diff) بين لقطتين =====================
function diffElementSets(elemsA, elemsB) {
  const mapA = new Map(elemsA.map((e) => [elementKey(e), e]));
  const mapB = new Map(elemsB.map((e) => [elementKey(e), e]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  mapB.forEach((elB, key) => {
    if (!mapA.has(key)) {
      added.push(elB);
    } else {
      const elA = mapA.get(key);
      const changed = JSON.stringify(elA.value) !== JSON.stringify(elB.value)
        || JSON.stringify(elA.attributes) !== JSON.stringify(elB.attributes);
      if (changed) {
        modified.push({
          name: elB.name,
          element_type: elB.element_type,
          before: { value: elA.value, attributes: elA.attributes },
          after: { value: elB.value, attributes: elB.attributes },
        });
      } else {
        unchanged.push(elB);
      }
    }
  });

  mapA.forEach((elA, key) => {
    if (!mapB.has(key)) removed.push(elA);
  });

  return {
    added_count: added.length,
    removed_count: removed.length,
    modified_count: modified.length,
    unchanged_count: unchanged.length,
    added,
    removed,
    modified,
  };
}

function groupByType(elements) {
  const groups = {};
  ELEMENT_TYPES.forEach((t) => { groups[t] = []; });
  elements.forEach((e) => { groups[e.element_type].push(e); });
  return groups;
}

// ===================== 4) مقارنة شاملة بين إصدارين =====================
/**
 * مقارنة شاملة: تجمع بين مقارنة الملف (checksum/الحجم - من الجزء 2/10) ومقارنة
 * العناصر المسجَّلة فعلياً (طبقات/أبعاد/نصوص/كتل) لكل من الإصدارين، مع تفصيل
 * العناصر المضافة والمحذوفة والمعدَّلة إجمالاً وحسب كل نوع على حدة.
 */
function compareVersions(drawingId, versionA, versionB, opts = {}) {
  const { actor } = opts;
  if (String(versionA) === String(versionB)) throw new Error('الرجاء اختيار إصدارين مختلفين للمقارنة');

  // يعيد استخدام تحقق ومقارنة الملف الفعلية من الجزء 2/10 (checksum/الحجم/من رفع كل إصدار)
  const fileComparison = DRAW_VER.compareVersions(drawingId, versionA, versionB);

  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);

  const elemsA = elementsOf(db, drawingId, versionA);
  const elemsB = elementsOf(db, drawingId, versionB);

  const overallDiff = diffElementSets(elemsA, elemsB);

  const byType = {};
  ELEMENT_TYPES.forEach((t) => {
    byType[t] = diffElementSets(
      elemsA.filter((e) => e.element_type === t),
      elemsB.filter((e) => e.element_type === t),
    );
  });

  const comparisonRecord = {
    id: newId('CMP'),
    drawing_id: drawingId,
    version_a: Number(versionA),
    version_b: Number(versionB),
    identical_content: fileComparison.identical_content,
    added_count: overallDiff.added_count,
    removed_count: overallDiff.removed_count,
    modified_count: overallDiff.modified_count,
    compared_by: actor || null,
    compared_at: nowISO(),
  };
  db.comparisons.push(comparisonRecord);

  logAudit(db, {
    action: 'compare_versions',
    drawingId,
    actor,
    details: `مقارنة الإصدار v${versionA} مع v${versionB} للمخطط (${rec.drawing_number}) - `
      + `إضافات: ${overallDiff.added_count}، حذف: ${overallDiff.removed_count}، تعديل: ${overallDiff.modified_count}`,
  });
  saveDB(db);

  return {
    success: true,
    drawing_number: rec.drawing_number,
    version_a: Number(versionA),
    version_b: Number(versionB),
    file_comparison: {
      identical_content: fileComparison.identical_content,
      size_diff_bytes: fileComparison.size_diff_bytes,
      size_diff_human: fileComparison.size_diff_human,
      summary: fileComparison.summary,
    },
    elements_summary: {
      added_count: overallDiff.added_count,
      removed_count: overallDiff.removed_count,
      modified_count: overallDiff.modified_count,
      unchanged_count: overallDiff.unchanged_count,
      has_recorded_elements: (elemsA.length + elemsB.length) > 0,
    },
    elements: {
      added: overallDiff.added,
      removed: overallDiff.removed,
      modified: overallDiff.modified,
    },
    by_type: {
      layers: byType.layer,
      dimensions: byType.dimension,
      texts: byType.text,
      blocks: byType.block,
      other: byType.other,
    },
    comparison_id: comparisonRecord.id,
  };
}

// ===================== 5) مقارنات مختصرة حسب النوع (اختصارات مباشرة) =====================
function compareLayers(drawingId, versionA, versionB) {
  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);
  validateVersionExists(db, drawingId, versionA);
  validateVersionExists(db, drawingId, versionB);
  const diff = diffElementSets(
    elementsOf(db, drawingId, versionA, 'layer'),
    elementsOf(db, drawingId, versionB, 'layer'),
  );
  return {
    success: true, drawing_number: rec.drawing_number, element_type: 'layer', ...diff,
  };
}

function compareDimensions(drawingId, versionA, versionB) {
  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);
  validateVersionExists(db, drawingId, versionA);
  validateVersionExists(db, drawingId, versionB);
  const diff = diffElementSets(
    elementsOf(db, drawingId, versionA, 'dimension'),
    elementsOf(db, drawingId, versionB, 'dimension'),
  );
  return {
    success: true, drawing_number: rec.drawing_number, element_type: 'dimension', ...diff,
  };
}

function compareTexts(drawingId, versionA, versionB) {
  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);
  validateVersionExists(db, drawingId, versionA);
  validateVersionExists(db, drawingId, versionB);
  const diff = diffElementSets(
    elementsOf(db, drawingId, versionA, 'text'),
    elementsOf(db, drawingId, versionB, 'text'),
  );
  return {
    success: true, drawing_number: rec.drawing_number, element_type: 'text', ...diff,
  };
}

// ===================== 6) سجل عمليات المقارنة السابقة (لمخطط معيّن) =====================
function listComparisonHistory(drawingId) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);
  return {
    success: true,
    comparisons: db.comparisons
      .filter((c) => c.drawing_id === drawingId)
      .sort((a, b) => new Date(b.compared_at) - new Date(a.compared_at)),
  };
}

// مُصدَّرة للوحة التحكم المستقبلية (الجزء 10/10) بنفس نمط getReviewCountForDashboard/getCommentCountForDashboard
function getComparisonCountForDashboard() {
  const db = loadDB();
  ensureCollections(db);
  return db.comparisons.length;
}

module.exports = {
  ELEMENT_TYPES,
  ELEMENT_TYPE_LABELS_AR,
  recordVersionElements,
  listVersionElements,
  compareVersions,
  compareLayers,
  compareDimensions,
  compareTexts,
  listComparisonHistory,
  getComparisonCountForDashboard,
};
