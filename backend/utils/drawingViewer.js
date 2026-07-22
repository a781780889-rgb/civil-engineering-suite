/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء الثالث (3/10): عارض المخططات (طبقة API الخلفية)
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة التي أنشأها الجزء 1/10
 * (نفس ملف backend/data/drawings.json) بدون أي اعتمادية دائرية، بنفس أسلوب
 * drawingVersions.js: يستخدم drawingManagement.js._internal مباشرة.
 *
 * يغطي هذا الجزء بند "عارض المخططات" من المواصفة الأصلية على مستوى الـ backend:
 *  - حفظ واسترجاع بيانات وصفية للقياسات التي يجريها المستخدم على مخطط
 *    (مسافة/زاوية/مساحة/طول) مع الإحداثيات الفعلية للنقاط المُقاسة.
 *  - حفظ واسترجاع نقاط "قراءة الإحداثيات" الفردية (نقرة واحدة على المخطط).
 *  - فتح/عرض عدة مخططات معاً: إرجاع بيانات مجموعة من المخططات (وملفاتها إن طُلب)
 *    دفعة واحدة بدل نداء منفصل لكل مخطط.
 *  - حفظ "حالة عرض" اختيارية لكل مخطط (آخر تكبير/تدوير/إزاحة استخدمها المستخدم)
 *    ليُستأنف العرض من حيث توقف - بيانات وصفية بحتة، لا تُنفّذ أي رسم فعلي هنا.
 *
 * ملاحظة نطاق العمل (موثّقة أيضاً في DRAWINGS_PLAN.md): العرض الرسومي الفعلي لملفات
 * CAD (DWG/DXF/RVT/IFC..) يعتمد على مكتبات عميل (frontend) خارج نطاق الـ backend؛
 * هذا الجزء يوفر طبقة البيانات والقياسات المرتبطة بالمخطط التي يحتاجها أي عارض عميل.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل قياس يُخزَّن فعلياً بقيمته المحسوبة ونوعه ونقاطه الإحداثية في drawings.json.
 *  - حساب فعلي للمسافة والمساحة والزاوية من الإحداثيات المُدخلة (وليس فقط تخزين رقم
 *    يُرسله العميل) لضمان صحة البيانات المحفوظة.
 *  - سجل تدقيق فعلي موحّد مع بقية الأجزاء لكل عملية إضافة/حذف قياس أو نقطة إحداثية.
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

function ensureViewerCollections(db) {
  if (!Array.isArray(db.measurements)) db.measurements = [];
  if (!Array.isArray(db.coordinate_points)) db.coordinate_points = [];
  if (!db.viewer_states) db.viewer_states = {}; // drawing_id -> آخر حالة عرض لكل مستخدم
}

function toNumber(v, fieldName) {
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`القيمة (${fieldName}) يجب أن تكون رقماً صحيحاً`);
  return n;
}

function validatePoint(point, index) {
  if (!point || typeof point !== 'object') throw new Error(`النقطة رقم ${index + 1} غير صالحة`);
  const x = toNumber(point.x, `نقطة ${index + 1} - x`);
  const y = toNumber(point.y, `نقطة ${index + 1} - y`);
  const z = point.z !== undefined && point.z !== null ? toNumber(point.z, `نقطة ${index + 1} - z`) : null;
  return { x, y, z };
}

// ===================== الحسابات الهندسية الفعلية =====================
function distanceBetween(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = (p1.z !== null && p2.z !== null) ? (p2.z - p1.z) : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function totalLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distanceBetween(points[i], points[i + 1]);
  }
  return total;
}

// زاوية عند النقطة الوسطى (points[1]) بين الضلعين (points[0]->points[1]) و(points[1]->points[2])
function angleAtVertex(points) {
  if (points.length < 3) throw new Error('قياس الزاوية يتطلب ثلاث نقاط على الأقل (طرف - رأس الزاوية - طرف)');
  const [a, vertex, b] = points;
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 === 0 || mag2 === 0) throw new Error('لا يمكن حساب الزاوية: نقاط متطابقة');
  let cosTheta = dot / (mag1 * mag2);
  cosTheta = Math.min(1, Math.max(-1, cosTheta)); // حماية من أخطاء التقريب العشري
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

// مساحة مضلع مغلق بطريقة Shoelace (تفترض نقاط مرتّبة على محيط الشكل)
function polygonArea(points) {
  if (points.length < 3) throw new Error('قياس المساحة يتطلب ثلاث نقاط على الأقل');
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += (p1.x * p2.y) - (p2.x * p1.y);
  }
  return Math.abs(sum) / 2;
}

const MEASUREMENT_TYPES = ['distance', 'length', 'angle', 'area'];
const MEASUREMENT_TYPE_LABELS_AR = {
  distance: 'مسافة', length: 'طول (خط متعدد النقاط)', angle: 'زاوية', area: 'مساحة',
};

function computeMeasurementValue(type, points) {
  switch (type) {
    case 'distance':
      if (points.length !== 2) throw new Error('قياس المسافة يتطلب نقطتين بالضبط');
      return { value: distanceBetween(points[0], points[1]), unit: 'م' };
    case 'length':
      if (points.length < 2) throw new Error('قياس الطول يتطلب نقطتين على الأقل');
      return { value: totalLength(points), unit: 'م' };
    case 'angle':
      return { value: angleAtVertex(points), unit: 'درجة' };
    case 'area':
      return { value: polygonArea(points), unit: 'م²' };
    default:
      throw new Error(`نوع قياس غير معروف: ${type}. الأنواع المتاحة: ${MEASUREMENT_TYPES.join(', ')}`);
  }
}

// ===================== 1) إضافة قياس جديد =====================
/**
 * @param {string} drawingId
 * @param {Object} payload { type: distance|length|angle|area, points: [{x,y,z?}, ...],
 *                            label(اختياري), layer(اختياري), actor }
 */
function addMeasurement(drawingId, payload = {}) {
  const { type, points, label, layer, actor } = payload;
  if (!type) throw new Error('نوع القياس (type) مطلوب');
  if (!Array.isArray(points) || !points.length) throw new Error('نقاط القياس (points) مطلوبة كمصفوفة غير فارغة');
  if (!MEASUREMENT_TYPES.includes(type)) {
    throw new Error(`نوع قياس غير معروف: ${type}. الأنواع المتاحة: ${MEASUREMENT_TYPES.join(', ')}`);
  }

  const db = loadDB();
  ensureViewerCollections(db);
  const rec = findDrawing(db, drawingId);

  const validatedPoints = points.map((p, idx) => validatePoint(p, idx));
  const { value, unit } = computeMeasurementValue(type, validatedPoints);

  const measurement = {
    id: newId('MEA'),
    drawing_id: drawingId,
    type,
    type_label_ar: MEASUREMENT_TYPE_LABELS_AR[type],
    points: validatedPoints,
    value: Math.round(value * 10000) / 10000,
    unit,
    label: label || null,
    layer: layer || null,
    created_by: actor || null,
    created_at: nowISO(),
  };
  db.measurements.push(measurement);

  logAudit(db, {
    action: 'add_measurement',
    drawingId,
    actor,
    details: `إضافة قياس (${MEASUREMENT_TYPE_LABELS_AR[type]}) بقيمة ${measurement.value} ${unit} على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, measurement };
}

// ===================== 2) سرد قياسات مخطط =====================
function listMeasurements(drawingId, filters = {}) {
  const db = loadDB();
  ensureViewerCollections(db);
  findDrawing(db, drawingId);

  let list = db.measurements.filter((m) => m.drawing_id === drawingId);
  if (filters.type) list = list.filter((m) => m.type === filters.type);
  if (filters.layer) list = list.filter((m) => m.layer === filters.layer);

  list = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, measurements: list };
}

// ===================== 3) حذف قياس =====================
function deleteMeasurement(drawingId, measurementId, { actor } = {}) {
  const db = loadDB();
  ensureViewerCollections(db);
  const rec = findDrawing(db, drawingId);

  const idx = db.measurements.findIndex((m) => m.id === measurementId && m.drawing_id === drawingId);
  if (idx === -1) throw new Error('القياس غير موجود');
  const removed = db.measurements.splice(idx, 1)[0];

  logAudit(db, {
    action: 'delete_measurement',
    drawingId,
    actor,
    details: `حذف قياس (${removed.type_label_ar}) من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);
  return { success: true };
}

// ===================== 4) حفظ نقطة قراءة إحداثيات =====================
/**
 * نقطة إحداثية فردية (نقرة واحدة على المخطط لقراءة الموقع) - أخف من "القياس"
 * ولا ترتبط بحساب قيمة، فقط توثيق موقع مهم على المخطط (مثال: منسوب نقطة تحكم).
 */
function addCoordinatePoint(drawingId, payload = {}) {
  const { x, y, z, label, actor } = payload;
  if (x === undefined || y === undefined) throw new Error('الإحداثيات (x, y) مطلوبة');

  const db = loadDB();
  ensureViewerCollections(db);
  const rec = findDrawing(db, drawingId);

  const point = validatePoint({ x, y, z }, 0);
  const record = {
    id: newId('CPT'),
    drawing_id: drawingId,
    ...point,
    label: label || null,
    created_by: actor || null,
    created_at: nowISO(),
  };
  db.coordinate_points.push(record);

  logAudit(db, {
    action: 'add_coordinate_point',
    drawingId,
    actor,
    details: `تسجيل نقطة إحداثية (${point.x}, ${point.y}${point.z !== null ? `, ${point.z}` : ''}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, point: record };
}

function listCoordinatePoints(drawingId) {
  const db = loadDB();
  ensureViewerCollections(db);
  findDrawing(db, drawingId);
  const list = db.coordinate_points
    .filter((p) => p.drawing_id === drawingId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, points: list };
}

function deleteCoordinatePoint(drawingId, pointId, { actor } = {}) {
  const db = loadDB();
  ensureViewerCollections(db);
  const rec = findDrawing(db, drawingId);

  const idx = db.coordinate_points.findIndex((p) => p.id === pointId && p.drawing_id === drawingId);
  if (idx === -1) throw new Error('نقطة الإحداثيات غير موجودة');
  db.coordinate_points.splice(idx, 1);

  logAudit(db, {
    action: 'delete_coordinate_point',
    drawingId,
    actor,
    details: `حذف نقطة إحداثية من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);
  return { success: true };
}

// ===================== 5) فتح/عرض عدة مخططات معاً =====================
/**
 * إرجاع بيانات مجموعة مخططات دفعة واحدة (للعرض المتزامن في العارض).
 * @param {string[]} drawingIds
 * @param {Object} opts { include_file: boolean } - إن كانت true تُرجع محتوى الملف
 *                        base64 لكل مخطط أيضاً (مفيد لعارض يفتح عدة ملفات معاً).
 */
function openMultipleDrawings(drawingIds, opts = {}) {
  if (!Array.isArray(drawingIds) || !drawingIds.length) {
    throw new Error('قائمة معرّفات المخططات (drawingIds) مطلوبة وغير فارغة');
  }
  if (drawingIds.length > 20) {
    throw new Error('الحد الأقصى لعدد المخططات التي يمكن فتحها معاً هو 20 مخططاً');
  }

  const db = loadDB();
  ensureViewerCollections(db);

  const results = drawingIds.map((id) => {
    const rec = db.drawings.find((d) => d.id === id && !d.is_deleted);
    if (!rec) return { id, found: false, error: 'المخطط غير موجود' };

    const { stored_file_name: storedFileName, ...publicRecord } = rec;
    const out = { id, found: true, drawing: publicRecord };

    if (opts.include_file) {
      try {
        const fileResult = DRAW.downloadDrawingFile(id, { actor: opts.actor });
        out.content_base64 = fileResult.content_base64;
        out.file_type = fileResult.file_type;
      } catch (e) {
        out.file_error = e.message;
      }
    }
    return out;
  });

  logAudit(db, {
    action: 'open_multiple_drawings',
    drawingId: null,
    actor: opts.actor,
    details: `فتح ${drawingIds.length} مخطط معاً (${results.filter((r) => r.found).length} تم إيجادها)`,
  });
  saveDB(db);

  return { success: true, count: results.length, drawings: results };
}

// ===================== 6) حفظ/استرجاع حالة العرض (اختياري) =====================
/**
 * حفظ آخر حالة عرض استخدمها مستخدم على مخطط (تكبير/تدوير/إزاحة/الطبقة الحالية)
 * لاستئناف العرض من نفس النقطة عند فتح المخطط مجدداً. بيانات وصفية بحتة.
 */
function saveViewerState(drawingId, payload = {}) {
  const { actor, zoom, rotation, pan_x: panX, pan_y: panY, active_layer: activeLayer } = payload;
  const db = loadDB();
  ensureViewerCollections(db);
  findDrawing(db, drawingId);

  if (!db.viewer_states[drawingId]) db.viewer_states[drawingId] = {};
  const key = actor || '__anonymous__';
  db.viewer_states[drawingId][key] = {
    zoom: zoom !== undefined ? Number(zoom) : null,
    rotation: rotation !== undefined ? Number(rotation) : null,
    pan_x: panX !== undefined ? Number(panX) : null,
    pan_y: panY !== undefined ? Number(panY) : null,
    active_layer: activeLayer || null,
    saved_at: nowISO(),
  };
  saveDB(db);
  return { success: true, state: db.viewer_states[drawingId][key] };
}

function getViewerState(drawingId, { actor } = {}) {
  const db = loadDB();
  ensureViewerCollections(db);
  findDrawing(db, drawingId);
  const key = actor || '__anonymous__';
  const state = db.viewer_states[drawingId]?.[key] || null;
  return { success: true, state };
}

module.exports = {
  MEASUREMENT_TYPES,
  MEASUREMENT_TYPE_LABELS_AR,
  addMeasurement,
  listMeasurements,
  deleteMeasurement,
  addCoordinatePoint,
  listCoordinatePoints,
  deleteCoordinatePoint,
  openMultipleDrawings,
  saveViewerState,
  getViewerState,
};
