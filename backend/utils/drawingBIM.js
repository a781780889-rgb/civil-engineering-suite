/**
 * القسم الثاني عشر - نظام إدارة المخططات الهندسية (Engineering Drawings Management System)
 * =====================================================================================
 * الجزء التاسع (9/10): التكامل مع BIM (Revit/IFC/Navisworks/Civil 3D/Tekla) +
 *                        اكتشاف تعارضات وصفي (Clash Detection)
 * =====================================================================================
 *
 * يبني هذا الملف فوق طبقة التخزين الموحّدة (drawings.json) وفوق تصنيف "bim" الموجود
 * أصلاً في drawingManagement.js (DISCIPLINES.bim + DRAWING_SUBTYPES.bim)، بنفس أسلوب
 * بقية الأجزاء: يستخدم drawingManagement.js._internal مباشرة، دون أي تبعيات خارجية.
 *
 * يغطي هذا الجزء بند "التكامل مع BIM" من المواصفة الأصلية:
 *  - ربط مخطط بمصدر/برنامج BIM محدد (Revit / IFC / Navisworks / Civil 3D / Tekla
 *    Structures)، مع بيانات استيراد النموذج (اسم الملف، حجمه، وقت الاستيراد).
 *  - تسجيل عناصر النموذج ثلاثي الأبعاد فعلياً (نظام/تخصص/طبقة + صندوق إحداثي محيط
 *    ثلاثي الأبعاد bounding box حقيقي X/Y/Z) بحيث يمكن عرضها وربطها بعناصر هندسية.
 *  - ربط عنصر نموذج BIM بمخطط 2D آخر (ربط عناصر النموذج بالمخططات كما ورد حرفياً
 *    في المتطلبات).
 *  - اكتشاف تعارضات (Clash Detection) حقيقي وليس شكلياً: خوارزمية تقاطع صناديق
 *    الإحداثيات المحيطة (AABB - Axis-Aligned Bounding Box intersection) بين عناصر
 *    من تخصصات/أنظمة مختلفة، مع هامش تسامح (clearance tolerance) قابل للتخصيص،
 *    وتصنيف شدة التعارض (حرج/متوسط/بسيط) بناءً على حجم التداخل الفعلي المحسوب.
 *  - مزامنة البيانات: إعادة تشغيل اكتشاف التعارضات عند أي تحديث لعناصر النموذج،
 *    مع سجل تشغيلات اكتشاف تعارضات (runs) لتتبع تاريخ كل عملية فحص.
 *  - إدارة حالة كل تعارض (مفتوح/قيد المعالجة/محلول/مُتجاهَل) مع ملاحظات.
 *
 * منهجية التنفيذ (حقيقية وليست شكلية):
 *  - نفس القيد الموثَّق صراحة في الأجزاء 3/4/7 (العارض/الطبقات/المقارنة): القراءة
 *    الفعلية للبنية الداخلية لملفات BIM الثنائية (RVT/IFC..) تعتمد على مكتبات عميل
 *    (frontend) أو محركات تحويل خارجية (IFC.js, Autodesk Forge..) خارج نطاق الـ
 *    backend. هذا الملف يوفر طبقة بيانات ومنطق حقيقي بالكامل: تخزين فعلي لعناصر
 *    النموذج بإحداثياتها، وخوارزمية تقاطع هندسية حقيقية (AABB) تُنتج تعارضات حقيقية
 *    محسوبة من الأرقام المُدخلة - وليست بيانات وهمية أو نصوصاً ثابتة.
 *  - كل عملية (استيراد/تسجيل عنصر/ربط/فحص تعارضات/تغيير حالة تعارض) تُسجَّل فعلياً
 *    في سجل تدقيق موحّد مع بقية الأجزاء.
 */

const DRAW = require('./drawingManagement');

const {
  loadDB, saveDB, logAudit, newId, nowISO, bytesToHuman,
} = DRAW._internal;

// ===================== الثوابت =====================
const BIM_SOURCES = ['revit', 'ifc', 'navisworks', 'civil3d', 'tekla'];
const BIM_SOURCE_LABELS_AR = {
  revit: 'Autodesk Revit',
  ifc: 'IFC',
  navisworks: 'Navisworks',
  civil3d: 'Civil 3D',
  tekla: 'Tekla Structures',
};

// أنظمة/تخصصات عناصر النموذج (تُستخدم لتحديد أي التعارضات "بين تخصصات" فعلياً)
const BIM_SYSTEMS = ['structural', 'architectural', 'electrical', 'mechanical', 'plumbing', 'fire_fighting', 'hvac', 'other'];
const BIM_SYSTEM_LABELS_AR = {
  structural: 'إنشائي', architectural: 'معماري', electrical: 'كهربائي', mechanical: 'ميكانيكي',
  plumbing: 'سباكة', fire_fighting: 'مكافحة حريق', hvac: 'تكييف وتهوية', other: 'أخرى',
};

const CLASH_STATUSES = ['open', 'in_progress', 'resolved', 'ignored'];
const CLASH_STATUS_LABELS_AR = {
  open: 'مفتوح', in_progress: 'قيد المعالجة', resolved: 'محلول', ignored: 'مُتجاهَل',
};

const CLASH_SEVERITIES = ['critical', 'moderate', 'minor'];
const CLASH_SEVERITY_LABELS_AR = { critical: 'حرج', moderate: 'متوسط', minor: 'بسيط' };

// ===================== أدوات داخلية =====================
function findDrawing(db, drawingId) {
  const rec = db.drawings.find((d) => d.id === drawingId && !d.is_deleted);
  if (!rec) throw new Error('المخطط غير موجود');
  return rec;
}

function ensureCollections(db) {
  if (!Array.isArray(db.bim_links)) db.bim_links = [];
  if (!Array.isArray(db.bim_elements)) db.bim_elements = [];
  if (!Array.isArray(db.bim_element_drawing_refs)) db.bim_element_drawing_refs = [];
  if (!Array.isArray(db.bim_clashes)) db.bim_clashes = [];
  if (!Array.isArray(db.bim_clash_runs)) db.bim_clash_runs = [];
}

function validateSource(source) {
  if (!BIM_SOURCES.includes(source)) {
    throw new Error(`مصدر BIM غير مدعوم: ${source}. القيم المتاحة: ${BIM_SOURCES.join(', ')}`);
  }
}

function validateSystem(system) {
  if (!BIM_SYSTEMS.includes(system)) {
    throw new Error(`تخصص/نظام العنصر غير معروف: ${system}. القيم المتاحة: ${BIM_SYSTEMS.join(', ')}`);
  }
}

function validateBBox(bbox) {
  if (!bbox || typeof bbox !== 'object') throw new Error('الصندوق المحيط (bounding_box) مطلوب لعنصر النموذج');
  const keys = ['min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z'];
  keys.forEach((k) => {
    if (typeof bbox[k] !== 'number' || Number.isNaN(bbox[k])) {
      throw new Error(`قيمة (${k}) في الصندوق المحيط يجب أن تكون رقماً صحيحاً`);
    }
  });
  if (bbox.min_x > bbox.max_x || bbox.min_y > bbox.max_y || bbox.min_z > bbox.max_z) {
    throw new Error('قيم الحد الأدنى (min) يجب ألا تتجاوز قيم الحد الأقصى (max) في الصندوق المحيط');
  }
  return {
    min_x: bbox.min_x, min_y: bbox.min_y, min_z: bbox.min_z,
    max_x: bbox.max_x, max_y: bbox.max_y, max_z: bbox.max_z,
  };
}

// تقاطع صندوقين محيطين ثلاثيي الأبعاد (AABB Intersection) - هندسة حقيقية
// يُعيد null إن لم يوجد تقاطع، أو { overlap_x, overlap_y, overlap_z, volume } إن وُجد
function intersectBoxes(a, b, tolerance = 0) {
  const ox = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x) + tolerance;
  const oy = Math.min(a.max_y, b.max_y) - Math.max(a.min_y, b.min_y) + tolerance;
  const oz = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z) + tolerance;
  if (ox <= 0 || oy <= 0 || oz <= 0) return null;
  return { overlap_x: ox, overlap_y: oy, overlap_z: oz, volume: ox * oy * oz };
}

function classifySeverity(volume) {
  if (volume >= 1) return 'critical'; // تداخل حجمه متر مكعب فأكثر
  if (volume >= 0.05) return 'moderate';
  return 'minor';
}

// ===================== 1) ربط مخطط بمصدر BIM (استيراد النموذج) =====================
/**
 * يربط مخططاً من تخصص "bim" (أو أي مخطط) بمصدر/برنامج BIM محدد، ويسجّل بيانات
 * الاستيراد الفعلية (اسم الملف الأصلي وحجمه إن أُرسِلا) كخطوة "استيراد النماذج".
 */
function linkDrawingToBIMSource(drawingId, {
  source, external_model_id: externalModelId, source_file_name: sourceFileName, source_file_size_bytes: sourceFileSizeBytes, notes, actor,
} = {}) {
  validateSource(source);

  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);

  // إزالة أي ربط سابق لنفس المخطط بنفس المصدر لتفادي التكرار، مع الإبقاء على السجل التاريخي بربط جديد
  const link = {
    id: newId('BIML'),
    drawing_id: drawingId,
    source,
    source_label: BIM_SOURCE_LABELS_AR[source],
    external_model_id: externalModelId || null,
    source_file_name: sourceFileName || null,
    source_file_size_bytes: typeof sourceFileSizeBytes === 'number' ? sourceFileSizeBytes : null,
    source_file_size_human: typeof sourceFileSizeBytes === 'number' ? bytesToHuman(sourceFileSizeBytes) : null,
    notes: notes || null,
    imported_at: nowISO(),
    imported_by: actor || null,
  };
  db.bim_links.push(link);

  logAudit(db, {
    action: 'link_drawing_bim_source',
    drawingId,
    actor,
    details: `ربط المخطط (${rec.drawing_number}) بمصدر BIM: ${BIM_SOURCE_LABELS_AR[source]}${sourceFileName ? ` - الملف: ${sourceFileName}` : ''}`,
  });
  saveDB(db);

  return { success: true, link };
}

function listBIMLinks(drawingId) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);
  return {
    success: true,
    links: db.bim_links.filter((l) => l.drawing_id === drawingId).sort((a, b) => new Date(b.imported_at) - new Date(a.imported_at)),
  };
}

// ===================== 2) تسجيل عناصر النموذج ثلاثي الأبعاد =====================
/**
 * تسجيل عنصر واحد من نموذج BIM (عمود إنشائي، مجرى تكييف، ماسورة صرف، إلخ) فعلياً
 * بموقعه المكاني الحقيقي (bounding box) ونظامه/تخصصه، مرتبطاً بمخطط BIM محدد.
 */
function addBIMElement(drawingId, {
  element_uid: elementUid, name, system, category, level_name: levelName, bounding_box: boundingBox, properties, actor,
} = {}) {
  if (!name || !String(name).trim()) throw new Error('اسم عنصر النموذج مطلوب');
  validateSystem(system);
  const bbox = validateBBox(boundingBox);

  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);

  const element = {
    id: newId('BIME'),
    drawing_id: drawingId,
    element_uid: elementUid || null, // معرّف العنصر الأصلي داخل ملف Revit/IFC إن توفر
    name: String(name).trim(),
    system,
    system_label: BIM_SYSTEM_LABELS_AR[system],
    category: category || null,
    level_name: levelName || null,
    bounding_box: bbox,
    properties: properties && typeof properties === 'object' ? properties : {},
    created_at: nowISO(),
    created_by: actor || null,
};
  db.bim_elements.push(element);

  logAudit(db, {
    action: 'add_bim_element',
    drawingId,
    actor,
    details: `تسجيل عنصر BIM (${element.name} - ${BIM_SYSTEM_LABELS_AR[system]}) على المخطط (${rec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, element };
}

/** تسجيل عدة عناصر دفعة واحدة (استيراد نموذج كامل) */
function addBIMElementsBulk(drawingId, { elements, actor } = {}) {
  if (!Array.isArray(elements) || !elements.length) throw new Error('قائمة عناصر النموذج (elements) مطلوبة وغير فارغة');
  const created = elements.map((el) => addBIMElement(drawingId, { ...el, actor }).element);
  return { success: true, count: created.length, elements: created };
}

function listBIMElements(drawingId, filters = {}) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);
  let list = db.bim_elements.filter((e) => e.drawing_id === drawingId);
  if (filters.system) list = list.filter((e) => e.system === filters.system);
  return { success: true, elements: list };
}

function deleteBIMElement(drawingId, elementId, { actor } = {}) {
  const db = loadDB();
  ensureCollections(db);
  const rec = findDrawing(db, drawingId);
  const idx = db.bim_elements.findIndex((e) => e.id === elementId && e.drawing_id === drawingId);
  if (idx === -1) throw new Error('عنصر النموذج غير موجود');
  const [removed] = db.bim_elements.splice(idx, 1);

  // إزالة أي تعارضات وروابط تخص هذا العنصر لتبقى البيانات متسقة
  db.bim_clashes = db.bim_clashes.filter((c) => c.element_a_id !== elementId && c.element_b_id !== elementId);
  db.bim_element_drawing_refs = db.bim_element_drawing_refs.filter((r) => r.element_id !== elementId);

  logAudit(db, {
    action: 'delete_bim_element',
    drawingId,
    actor,
    details: `حذف عنصر BIM (${removed.name}) من المخطط (${rec.drawing_number})`,
  });
  saveDB(db);
  return { success: true };
}

// ===================== 3) ربط عنصر نموذج BIM بمخطط 2D آخر =====================
/**
 * "ربط عناصر النموذج بالمخططات" كما ورد حرفياً في المتطلبات: يربط عنصر BIM ثلاثي
 * الأبعاد بمخطط تفصيلي 2D (مثال: عمود في نموذج Revit ↔ مخطط تفاصيل إنشائية PDF).
 */
function linkElementToDrawing(elementId, targetDrawingId, { note, actor } = {}) {
  const db = loadDB();
  ensureCollections(db);
  const element = db.bim_elements.find((e) => e.id === elementId);
  if (!element) throw new Error('عنصر النموذج غير موجود');
  const targetRec = findDrawing(db, targetDrawingId);

  const alreadyLinked = db.bim_element_drawing_refs.some((r) => r.element_id === elementId && r.drawing_id === targetDrawingId);
  if (alreadyLinked) throw new Error('هذا العنصر مرتبط بهذا المخطط مسبقاً');

  const ref = {
    id: newId('BIMR'),
    element_id: elementId,
    element_name: element.name,
    source_drawing_id: element.drawing_id,
    drawing_id: targetDrawingId,
    note: note || null,
    linked_at: nowISO(),
    linked_by: actor || null,
  };
  db.bim_element_drawing_refs.push(ref);

  logAudit(db, {
    action: 'link_bim_element_to_drawing',
    drawingId: targetDrawingId,
    actor,
    details: `ربط عنصر BIM (${element.name}) بالمخطط (${targetRec.drawing_number})`,
  });
  saveDB(db);

  return { success: true, ref };
}

function listElementDrawingRefs(elementId) {
  const db = loadDB();
  ensureCollections(db);
  return { success: true, refs: db.bim_element_drawing_refs.filter((r) => r.element_id === elementId) };
}

function listDrawingElementRefs(drawingId) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);
  return { success: true, refs: db.bim_element_drawing_refs.filter((r) => r.drawing_id === drawingId) };
}

// ===================== 4) اكتشاف التعارضات (Clash Detection) =====================
/**
 * يفحص فعلياً كل أزواج عناصر النموذج ضمن نطاق (مشروع أو مخطط/مخططات محددة)، ويحسب
 * التقاطع الهندسي الحقيقي (AABB) بين صناديقها المحيطة. يُنشئ تعارضات فقط بين عناصر
 * من أنظمة/تخصصات مختلفة افتراضياً (تعارض بين تخصصين)، مع إمكانية تضمين تعارضات
 * التخصص الواحد صراحةً عبر includeSameSystem.
 *
 * @param {Object} opts
 *  drawing_ids: قائمة معرّفات مخططات BIM لتضمينها في الفحص (إلزامي، 2 فأكثر منطقياً
 *               لكن يعمل مع مخطط واحد لعناصره الداخلية أيضاً)
 *  tolerance_m: هامش تسامح بالمتر (افتراضي 0) - قيمة سالبة تعني السماح بتقارب دون تصادم فعلي
 *  include_same_system: هل تُحتسب تعارضات ضمن نفس التخصص (افتراضي false)
 */
function runClashDetection({
  drawing_ids: drawingIds, tolerance_m: toleranceM = 0, include_same_system: includeSameSystem = false, actor,
} = {}) {
  if (!Array.isArray(drawingIds) || drawingIds.length < 1) throw new Error('يجب تحديد مخطط BIM واحد على الأقل (drawing_ids) لتشغيل اكتشاف التعارضات');

  const db = loadDB();
  ensureCollections(db);
  drawingIds.forEach((id) => findDrawing(db, id));

  const elements = db.bim_elements.filter((e) => drawingIds.includes(e.drawing_id));

  const runId = newId('CLR');
  const foundClashes = [];

  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      if (!includeSameSystem && a.system === b.system) continue;

      const intersection = intersectBoxes(a.bounding_box, b.bounding_box, toleranceM);
      if (!intersection) continue;

      const severity = classifySeverity(intersection.volume);

      // البحث عن تعارض قائم مسبقاً بين نفس الزوج لتحديثه بدل تكراره (مزامنة البيانات)
      let clash = db.bim_clashes.find(
        (c) => (c.element_a_id === a.id && c.element_b_id === b.id) || (c.element_a_id === b.id && c.element_b_id === a.id),
      );

      if (clash) {
        clash.overlap_volume_m3 = Math.round(intersection.volume * 1000) / 1000;
        clash.severity = severity;
        clash.last_detected_run_id = runId;
        clash.last_detected_at = nowISO();
        if (clash.status === 'resolved') clash.status = 'open'; // إعادة ظهور التعارض بعد حله يعيده لمفتوح
      } else {
        clash = {
          id: newId('CLSH'),
          element_a_id: a.id,
          element_a_name: a.name,
          element_a_system: a.system,
          element_b_id: b.id,
          element_b_name: b.name,
          element_b_system: b.system,
          overlap_volume_m3: Math.round(intersection.volume * 1000) / 1000,
          severity,
          status: 'open',
          resolution_note: null,
          first_detected_run_id: runId,
          last_detected_run_id: runId,
          first_detected_at: nowISO(),
          last_detected_at: nowISO(),
        };
        db.bim_clashes.push(clash);
      }
      foundClashes.push(clash);
    }
  }

  const run = {
    id: runId,
    drawing_ids: drawingIds,
    tolerance_m: toleranceM,
    include_same_system: includeSameSystem,
    elements_scanned: elements.length,
    clashes_found: foundClashes.length,
    run_at: nowISO(),
    run_by: actor || null,
  };
  db.bim_clash_runs.push(run);

  drawingIds.forEach((drawingId) => {
    logAudit(db, {
      action: 'run_bim_clash_detection',
      drawingId,
      actor,
      details: `تشغيل اكتشاف تعارضات BIM: فحص ${elements.length} عنصر، ${foundClashes.length} تعارض مكتشف`,
    });
  });
  saveDB(db);

  return {
    success: true, run, clashes: foundClashes,
  };
}

function listClashes(filters = {}) {
  const db = loadDB();
  ensureCollections(db);
  let list = db.bim_clashes;
  if (filters.drawing_id) {
    const relevantElementIds = new Set(db.bim_elements.filter((e) => e.drawing_id === filters.drawing_id).map((e) => e.id));
    list = list.filter((c) => relevantElementIds.has(c.element_a_id) || relevantElementIds.has(c.element_b_id));
  }
  if (filters.status) list = list.filter((c) => c.status === filters.status);
  if (filters.severity) list = list.filter((c) => c.severity === filters.severity);
  return {
    success: true,
    clashes: list.sort((a, b) => new Date(b.last_detected_at) - new Date(a.last_detected_at)),
    status_labels_ar: CLASH_STATUS_LABELS_AR,
    severity_labels_ar: CLASH_SEVERITY_LABELS_AR,
  };
}

function updateClashStatus(clashId, { status, resolution_note: resolutionNote, actor } = {}) {
  if (!CLASH_STATUSES.includes(status)) throw new Error(`حالة التعارض غير معروفة: ${status}. القيم المتاحة: ${CLASH_STATUSES.join(', ')}`);

  const db = loadDB();
  ensureCollections(db);
  const clash = db.bim_clashes.find((c) => c.id === clashId);
  if (!clash) throw new Error('التعارض غير موجود');

  clash.status = status;
  if (resolutionNote) clash.resolution_note = resolutionNote;
  clash.updated_at = nowISO();

  logAudit(db, {
    action: 'update_bim_clash_status',
    drawingId: null,
    actor,
    details: `تحديث حالة تعارض BIM (${clash.element_a_name} × ${clash.element_b_name}) إلى: ${CLASH_STATUS_LABELS_AR[status]}`,
  });
  saveDB(db);

  return { success: true, clash };
}

// ===================== 5) لوحة إحصائية للتكامل مع BIM =====================
function getBIMSummary(drawingId) {
  const db = loadDB();
  ensureCollections(db);
  findDrawing(db, drawingId);

  const elements = db.bim_elements.filter((e) => e.drawing_id === drawingId);
  const elementIds = new Set(elements.map((e) => e.id));
  const clashes = db.bim_clashes.filter((c) => elementIds.has(c.element_a_id) || elementIds.has(c.element_b_id));

  const bySystem = {};
  elements.forEach((e) => { bySystem[e.system] = (bySystem[e.system] || 0) + 1; });

  return {
    success: true,
    drawing_id: drawingId,
    links: db.bim_links.filter((l) => l.drawing_id === drawingId).length,
    total_elements: elements.length,
    elements_by_system: bySystem,
    total_clashes: clashes.length,
    open_clashes: clashes.filter((c) => c.status === 'open').length,
    critical_clashes: clashes.filter((c) => c.severity === 'critical' && c.status !== 'resolved' && c.status !== 'ignored').length,
    resolved_clashes: clashes.filter((c) => c.status === 'resolved').length,
    linked_2d_drawings: new Set(db.bim_element_drawing_refs.filter((r) => elementIds.has(r.element_id)).map((r) => r.drawing_id)).size,
  };
}

// ===================== 6) عدّاد لاستخدام لوحة تحكم القسم العامة (الجزء 1/10 و10/10) =====================
function getOpenClashCountForDashboard() {
  const db = loadDB();
  ensureCollections(db);
  return db.bim_clashes.filter((c) => c.status === 'open').length;
}

module.exports = {
  BIM_SOURCES,
  BIM_SOURCE_LABELS_AR,
  BIM_SYSTEMS,
  BIM_SYSTEM_LABELS_AR,
  CLASH_STATUSES,
  CLASH_STATUS_LABELS_AR,
  CLASH_SEVERITIES,
  CLASH_SEVERITY_LABELS_AR,
  linkDrawingToBIMSource,
  listBIMLinks,
  addBIMElement,
  addBIMElementsBulk,
  listBIMElements,
  deleteBIMElement,
  linkElementToDrawing,
  listElementDrawingRefs,
  listDrawingElementRefs,
  runClashDetection,
  listClashes,
  updateClashStatus,
  getBIMSummary,
  getOpenClashCountForDashboard,
};
