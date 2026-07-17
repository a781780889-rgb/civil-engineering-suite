/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الثاني: طرق الاستيراد
 * ==========================================
 * استيراد DXF - تحليل فعلي لصيغة DXF النصية (ASCII DXF) لاستخراج الأبعاد والعناصر
 * بدون أي مكتبات خارجية.
 *
 * صيغة DXF النصية عبارة عن أزواج (Group Code / Value) متتالية، كل منهما على سطر منفصل.
 * هذا الملف يقوم بتحليل هذه الأزواج فعلياً واستخراج الكيانات الهندسية:
 * LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT/MTEXT, DIMENSION
 * ثم يحسب منها أطوالاً ومساحات وأبعاداً حقيقية (وليس قيماً تقديرية).
 */

/**
 * يحول محتوى DXF النصي إلى مصفوفة من أزواج {code, value}
 * كل زوج يشغل سطرين: رمز المجموعة (رقم) ثم القيمة
 */
function parseDxfPairs(dxfText) {
  const rawLines = dxfText.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i < rawLines.length - 1; i += 2) {
    const code = parseInt(rawLines[i].trim(), 10);
    const value = rawLines[i + 1] !== undefined ? rawLines[i + 1].trim() : '';
    if (!isNaN(code)) {
      pairs.push({ code, value });
    }
  }
  return pairs;
}

/**
 * يقسم أزواج DXF إلى كيانات (entities) بالاعتماد على قسم ENTITIES
 * كل كيان يبدأ بـ (code=0, value=اسم الكيان) وينتهي عند بداية الكيان التالي
 */
function extractEntities(pairs) {
  const entities = [];
  let inEntitiesSection = false;
  let currentEntity = null;

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];

    if (code === 2 && value === 'ENTITIES') {
      inEntitiesSection = true;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = null;
      inEntitiesSection = false;
      continue;
    }
    if (!inEntitiesSection) continue;

    if (code === 0) {
      if (currentEntity) entities.push(currentEntity);
      currentEntity = { type: value, props: {} };
      continue;
    }
    if (currentEntity) {
      if (!currentEntity.props[code]) currentEntity.props[code] = [];
      currentEntity.props[code].push(value);
    }
  }
  if (currentEntity) entities.push(currentEntity);
  return entities;
}

function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function distance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * يعالج كيان LINE ويحسب طوله الفعلي من إحداثيات البداية والنهاية
 */
function processLine(entity) {
  const x1 = toNum((entity.props[10] || [])[0]);
  const y1 = toNum((entity.props[20] || [])[0]);
  const x2 = toNum((entity.props[11] || [])[0]);
  const y2 = toNum((entity.props[21] || [])[0]);
  return {
    type: 'LINE',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    length: round3(distance(x1, y1, x2, y2)),
  };
}

/**
 * يعالج كيان LWPOLYLINE (الأكثر شيوعاً في مخططات AutoCAD الحديثة)
 * يحسب المحيط الكلي، ويحسب المساحة إن كان الخط مغلقاً باستخدام صيغة Shoelace
 */
function processLwPolyline(entity) {
  const xs = (entity.props[10] || []).map(toNum);
  const ys = (entity.props[20] || []).map(toNum);
  const closedFlag = toNum((entity.props[70] || ['0'])[0]);
  const isClosed = (closedFlag & 1) === 1;

  const points = xs.map((x, i) => ({ x, y: ys[i] !== undefined ? ys[i] : 0 }));
  let perimeter = 0;
  for (let i = 0; i < points.length - 1; i++) {
    perimeter += distance(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
  }
  if (isClosed && points.length > 1) {
    perimeter += distance(points[points.length - 1].x, points[points.length - 1].y, points[0].x, points[0].y);
  }

  let area = 0;
  if (isClosed && points.length > 2) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      sum += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    area = Math.abs(sum / 2);
  }

  return {
    type: 'LWPOLYLINE',
    vertex_count: points.length,
    closed: isClosed,
    perimeter: round3(perimeter),
    area: round3(area),
    points,
  };
}

/**
 * يعالج كيان CIRCLE ويحسب المحيط والمساحة من نصف القطر الفعلي
 */
function processCircle(entity) {
  const cx = toNum((entity.props[10] || [])[0]);
  const cy = toNum((entity.props[20] || [])[0]);
  const r = toNum((entity.props[40] || [])[0]);
  return {
    type: 'CIRCLE',
    center: { x: cx, y: cy },
    radius: r,
    circumference: round3(2 * Math.PI * r),
    area: round3(Math.PI * r * r),
  };
}

/**
 * يعالج كيان ARC ويحسب طول القوس الفعلي من نصف القطر والزوايا
 */
function processArc(entity) {
  const cx = toNum((entity.props[10] || [])[0]);
  const cy = toNum((entity.props[20] || [])[0]);
  const r = toNum((entity.props[40] || [])[0]);
  const startAngle = toNum((entity.props[50] || [])[0]);
  const endAngle = toNum((entity.props[51] || [])[0]);
  let sweep = endAngle - startAngle;
  if (sweep < 0) sweep += 360;
  const arcLength = (sweep / 360) * 2 * Math.PI * r;
  return {
    type: 'ARC',
    center: { x: cx, y: cy },
    radius: r,
    start_angle: startAngle,
    end_angle: endAngle,
    arc_length: round3(arcLength),
  };
}

/**
 * يعالج كيان TEXT/MTEXT لاستخراج أي تسميات أو أبعاد مكتوبة يدوياً على المخطط
 */
function processText(entity) {
  const content = (entity.props[1] || entity.props[3] || [''])[0];
  const x = toNum((entity.props[10] || [])[0]);
  const y = toNum((entity.props[20] || [])[0]);
  return {
    type: entity.type,
    text: content,
    position: { x, y },
  };
}

/**
 * يعالج كيان DIMENSION لاستخراج قيمة البعد الفعلية المقاسة في المخطط (قياس معتمد من الرسام)
 */
function processDimension(entity) {
  const measurement = toNum((entity.props[42] || [])[0]);
  const textOverride = (entity.props[1] || [''])[0];
  return {
    type: 'DIMENSION',
    measurement,
    text_override: textOverride || null,
  };
}

function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

/**
 * الدالة الرئيسية: تحلل ملف DXF كاملاً وتستخرج جميع الكيانات الهندسية مع أبعادها الفعلية
 */
function parseDxfFile(dxfText) {
  const pairs = parseDxfPairs(dxfText);
  const rawEntities = extractEntities(pairs);

  const lines = [];
  const polylines = [];
  const circles = [];
  const arcs = [];
  const texts = [];
  const dimensions = [];
  let unsupportedCount = 0;

  for (const entity of rawEntities) {
    switch (entity.type) {
      case 'LINE':
        lines.push(processLine(entity));
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        polylines.push(processLwPolyline(entity));
        break;
      case 'CIRCLE':
        circles.push(processCircle(entity));
        break;
      case 'ARC':
        arcs.push(processArc(entity));
        break;
      case 'TEXT':
      case 'MTEXT':
        texts.push(processText(entity));
        break;
      case 'DIMENSION':
        dimensions.push(processDimension(entity));
        break;
      default:
        unsupportedCount++;
    }
  }

  const totalLineLength = round3(lines.reduce((s, l) => s + l.length, 0));
  const totalPolylinePerimeter = round3(polylines.reduce((s, p) => s + p.perimeter, 0));
  const totalClosedArea = round3(polylines.filter(p => p.closed).reduce((s, p) => s + p.area, 0));

  return {
    success: true,
    source: 'dxf',
    entity_counts: {
      lines: lines.length,
      polylines: polylines.length,
      circles: circles.length,
      arcs: arcs.length,
      texts: texts.length,
      dimensions: dimensions.length,
      unsupported: unsupportedCount,
    },
    summary: {
      total_line_length: totalLineLength,
      total_polyline_perimeter: totalPolylinePerimeter,
      total_closed_polygon_area: totalClosedArea,
    },
    entities: { lines, polylines, circles, arcs, texts, dimensions },
  };
}

module.exports = {
  parseDxfPairs,
  extractEntities,
  parseDxfFile,
};
