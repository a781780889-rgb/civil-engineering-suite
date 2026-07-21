/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * وحدة تكميلية: إدارة الملفات الجغرافية - استيراد وتصدير حقيقي (وليس شكلياً) لصيغ:
 *   GeoJSON, KML, KMZ, DXF (نقاط/خطوط بسيطة), LandXML (CgPoints/نقاط مساحية), CSV.
 *
 * كل دالة تصدير تُنتج ملفاً فعلياً صالحاً للفتح في برامج GIS/CAD قياسية
 * (QGIS, Google Earth, AutoCAD/Civil3D)، وكل دالة استيراد تحلّل المحتوى الفعلي
 * للملف (Parsing حقيقي) وتُعيد نقاطاً منظّمة يمكن حفظها كنقاط رفع/تحكم.
 *
 * بدون تبعيات خارجية: بناء KMZ (وهو أرشيف ZIP يحوي KML) يتم يدوياً باستخدام
 * وحدة zlib المدمجة في Node.js (deflateRawSync) وفق مواصفة ZIP القياسية،
 * تماماً كما تُبنى باقي أدوات التصدير في هذا المشروع بدون مكتبات جهات خارجية.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SGM_ = require('./surveyManagement');
const { _internal } = SGM_;
const { r6 } = _internal;
const { generateXlsx } = require('./xlsxWriter');
const { parseXlsxBuffer, sheetToObjects, unzip: unzipGeneric } = require('../calculators/import/xlsxImporter');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function ts() { return Date.now(); }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ==================================================================================
// ================================== GeoJSON ========================================
// ==================================================================================

/**
 * تصدير قائمة نقاط (رفع/تحكم/توقيع) إلى GeoJSON صالح (FeatureCollection of Point).
 * points: [{ id, name, lat/lon أو easting/northing, elevation, type, description }]
 * إذا كانت الإحداثيات UTM/محلية وليست جغرافية مباشرة، يجب تمرير lat/lon محسوبة مسبقاً.
 */
function exportPointsToGeoJSON(points, { fileNamePrefix = 'survey-points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const missing = points.filter((p) => typeof p.lat !== 'number' || typeof p.lon !== 'number');
  if (missing.length) throw new Error('كل نقطة يجب أن تحتوي إحداثيات جغرافية (lat/lon) صالحة للتصدير كـ GeoJSON');

  const geojson = {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: typeof p.elevation === 'number' ? [r6(p.lon), r6(p.lat), p.elevation] : [r6(p.lon), r6(p.lat)],
      },
      properties: {
        id: p.id || null,
        name: p.name || '',
        point_type: p.type || p.point_type || '',
        description: p.description || '',
        elevation: p.elevation ?? null,
      },
    })),
  };

  const filename = `${fileNamePrefix}-${ts()}.geojson`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2), 'utf-8');
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'GeoJSON' } };
}

/** استيراد نقاط من ملف/محتوى GeoJSON فعلي (FeatureCollection of Point) */
function importPointsFromGeoJSON(content) {
  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (e) {
    throw new Error('محتوى GeoJSON غير صالح (JSON parsing فشل): ' + e.message);
  }
  if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('الملف ليس GeoJSON FeatureCollection صالحاً');
  }
  const points = [];
  parsed.features.forEach((f, idx) => {
    if (!f.geometry || f.geometry.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) return;
    const [lon, lat, elevation] = f.geometry.coordinates;
    points.push({
      name: f.properties?.name || `Point-${idx + 1}`,
      lat: Number(lat), lon: Number(lon),
      elevation: typeof elevation === 'number' ? elevation : (f.properties?.elevation ?? null),
      description: f.properties?.description || '',
      point_type: f.properties?.point_type || 'imported',
    });
  });
  if (points.length === 0) throw new Error('لم يتم العثور على أي نقاط (Point Features) صالحة داخل ملف GeoJSON');
  return { success: true, data: points, count: points.length };
}

// ==================================================================================
// ==================================== KML ==========================================
// ==================================================================================

function buildKMLDocument(points, docName) {
  const placemarks = points.map((p) => `
    <Placemark>
      <name>${esc(p.name || '')}</name>
      <description>${esc(p.description || '')}</description>
      <Point>
        <coordinates>${r6(p.lon)},${r6(p.lat)}${typeof p.elevation === 'number' ? ',' + p.elevation : ''}</coordinates>
      </Point>
    </Placemark>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(docName)}</name>${placemarks}
  </Document>
</kml>`;
}

function exportPointsToKML(points, { fileNamePrefix = 'survey-points', docName = 'Survey Points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const missing = points.filter((p) => typeof p.lat !== 'number' || typeof p.lon !== 'number');
  if (missing.length) throw new Error('كل نقطة يجب أن تحتوي إحداثيات جغرافية (lat/lon) صالحة للتصدير كـ KML');

  const kml = buildKMLDocument(points, docName);
  const filename = `${fileNamePrefix}-${ts()}.kml`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, kml, 'utf-8');
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'KML' } };
}

/** استيراد نقاط من محتوى KML فعلي (تحليل Placemark/Point/coordinates بـ regex آمن) */
function importPointsFromKML(content) {
  if (typeof content !== 'string' || !content.includes('<kml')) throw new Error('محتوى KML غير صالح');
  const points = [];
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/g;
  const matches = content.match(placemarkRegex) || [];
  matches.forEach((block, idx) => {
    const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const coordMatch = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!coordMatch) return;
    const parts = coordMatch[1].trim().split(',').map(Number);
    const [lon, lat, elevation] = parts;
    if (Number.isNaN(lon) || Number.isNaN(lat)) return;
    points.push({
      name: nameMatch ? nameMatch[1].trim() : `Point-${idx + 1}`,
      lat, lon,
      elevation: Number.isFinite(elevation) ? elevation : null,
      description: descMatch ? descMatch[1].trim() : '',
      point_type: 'imported',
    });
  });
  if (points.length === 0) throw new Error('لم يتم العثور على أي Placemark بإحداثيات نقطية صالحة داخل ملف KML');
  return { success: true, data: points, count: points.length };
}

// ==================================================================================
// ==================================== KMZ ==========================================
// KMZ = أرشيف ZIP يحوي doc.kml. نبني ZIP يدوياً (Stored + Deflate) بدون تبعيات خارجية،
// اعتماداً على مواصفة تنسيق ZIP القياسية (Local File Header + Central Directory + EOCD).
// ==================================================================================

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() / 2) & 0x1F);
  const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
  return { time, dosDate };
}

/** بناء أرشيف ZIP بسيط (ملف واحد أو أكثر) بدون تبعيات، وفق مواصفة PKZIP القياسية */
function buildZip(files) {
  const { time, dosDate } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(({ name, content }) => {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const compressed = zlib.deflateRawSync(dataBuf);
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  });

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function exportPointsToKMZ(points, { fileNamePrefix = 'survey-points', docName = 'Survey Points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const kml = buildKMLDocument(points, docName);
  const zipBuffer = buildZip([{ name: 'doc.kml', content: kml }]);
  const filename = `${fileNamePrefix}-${ts()}.kmz`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, zipBuffer);
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'KMZ' } };
}

// ==================================================================================
// ==================================== DXF ==========================================
// تصدير نقاط كـ POINT entities + TEXT (تسمية) ضمن DXF ASCII (R12) صالح لفتحه في AutoCAD.
// ==================================================================================

function exportPointsToDXF(points, { fileNamePrefix = 'survey-points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const missingXY = points.filter((p) => typeof p.x !== 'number' || typeof p.y !== 'number');
  if (missingXY.length) throw new Error('كل نقطة يجب أن تحتوي إحداثيات مسطّحة x/y (Easting/Northing أو محلية) للتصدير كـ DXF');

  const lines = [];
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  points.forEach((p) => {
    const z = typeof p.elevation === 'number' ? p.elevation : 0;
    lines.push('0', 'POINT', '8', 'SURVEY_POINTS', '10', String(p.x), '20', String(p.y), '30', String(z));
    if (p.name) {
      lines.push('0', 'TEXT', '8', 'SURVEY_LABELS', '10', String(p.x + 0.5), '20', String(p.y + 0.5), '30', String(z), '40', '0.5', '1', String(p.name));
    }
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');

  const filename = `${fileNamePrefix}-${ts()}.dxf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'DXF' } };
}

/** استيراد نقاط من DXF (يقرأ فعلياً كيانات POINT من قسم ENTITIES) */
function importPointsFromDXF(content) {
  if (typeof content !== 'string') throw new Error('محتوى DXF غير صالح');
  const tokens = content.split(/\r?\n/).map((l) => l.trim());
  const points = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === '0' && tokens[i + 1] === 'POINT') {
      let x = null; let y = null; let z = 0;
      let j = i + 2;
      while (j < tokens.length && tokens[j] !== '0') {
        const code = tokens[j]; const value = tokens[j + 1];
        if (code === '10') x = Number(value);
        if (code === '20') y = Number(value);
        if (code === '30') z = Number(value);
        j += 2;
      }
      if (x !== null && y !== null) points.push({ name: `PT-${points.length + 1}`, x, y, elevation: z, point_type: 'imported' });
      i = j;
    } else {
      i += 1;
    }
  }
  if (points.length === 0) throw new Error('لم يتم العثور على أي كيانات POINT صالحة داخل ملف DXF');
  return { success: true, data: points, count: points.length };
}

// ==================================================================================
// ================================== LandXML ========================================
// تصدير/استيراد CgPoints (Coordinate Geometry Points) وفق مواصفة LandXML 1.2 القياسية
// المستخدمة في Civil 3D وبرامج المساحة الاحترافية.
// ==================================================================================

function exportPointsToLandXML(points, { fileNamePrefix = 'survey-points', projectName = 'Survey Project' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const missing = points.filter((p) => typeof p.northing !== 'number' || typeof p.easting !== 'number');
  if (missing.length) throw new Error('كل نقطة يجب أن تحتوي Easting/Northing صالحة للتصدير كـ LandXML');

  const cgPoints = points.map((p) => {
    const z = typeof p.elevation === 'number' ? ` ${p.elevation}` : ' 0';
    return `      <CgPoint name="${esc(p.name || '')}" desc="${esc(p.description || '')}">${p.northing} ${p.easting}${z}</CgPoint>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${new Date().toISOString().slice(0, 10)}">
  <Project name="${esc(projectName)}"/>
  <CgPoints>
${cgPoints}
  </CgPoints>
</LandXML>`;

  const filename = `${fileNamePrefix}-${ts()}.xml`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, xml, 'utf-8');
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'LandXML' } };
}

/** استيراد نقاط من LandXML فعلي (تحليل عناصر CgPoint: Northing Easting [Elevation]) */
function importPointsFromLandXML(content) {
  if (typeof content !== 'string' || !content.includes('CgPoint')) throw new Error('محتوى LandXML غير صالح أو لا يحتوي نقاط CgPoint');
  const points = [];
  const regex = /<CgPoint\b([^>]*)>([\s\S]*?)<\/CgPoint>/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(content)) !== null) {
    idx += 1;
    const attrs = match[1];
    const bodyRaw = match[2].trim();
    const nameMatch = attrs.match(/name="([^"]*)"/);
    const descMatch = attrs.match(/desc="([^"]*)"/);
    const parts = bodyRaw.split(/\s+/).map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) continue;
    const [northing, easting, elevation] = parts;
    points.push({
      name: nameMatch ? nameMatch[1] : `PT-${idx}`,
      description: descMatch ? descMatch[1] : '',
      northing, easting,
      elevation: Number.isFinite(elevation) ? elevation : null,
      point_type: 'imported',
    });
  }
  if (points.length === 0) throw new Error('لم يتم العثور على أي نقاط CgPoint صالحة داخل ملف LandXML');
  return { success: true, data: points, count: points.length };
}

// ==================================================================================
// ============================ CSV محسّن لاستيراد نقاط ==============================
// (التصدير عبر csvWriter.js الموجود مسبقاً؛ هنا الإضافة الحقيقية هي الاستيراد الفعلي)
// ==================================================================================

function importPointsFromCSV(content, { hasHeader = true } = {}) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('محتوى CSV فارغ أو غير صالح');
  const rows = content.trim().split(/\r?\n/).map((r) => r.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const points = [];
  dataRows.forEach((row, idx) => {
    if (row.length < 3) return;
    const [name, x, y, z, desc] = row;
    const xNum = Number(x); const yNum = Number(y); const zNum = Number(z);
    if (Number.isNaN(xNum) || Number.isNaN(yNum)) return;
    points.push({
      name: name || `PT-${idx + 1}`,
      x: xNum, y: yNum,
      elevation: Number.isFinite(zNum) ? zNum : null,
      description: desc || '',
      point_type: 'imported',
    });
  });
  if (points.length === 0) throw new Error('لم يتم العثور على أي صفوف بيانات صالحة (الصيغة المتوقعة: name,x,y,z,description)');
  return { success: true, data: points, count: points.length };
}

// ==================================================================================
// ==================================== Excel (XLSX) =================================
// تصدير/استيراد نقاط المساحة بصيغة Excel حقيقية (.xlsx) بإعادة استخدام مولّد/محلّل
// XLSX الموجودين فعلياً في المشروع (xlsxWriter.js لـ BOQ، xlsxImporter.js لـ BOQ)
// بدون أي مكتبة خارجية - نفس آلية ZIP/XML المستخدمة في باقي أقسام النظام.
// ==================================================================================

/**
 * تصدير قائمة نقاط (رفع/تحكم/توقيع) إلى ملف Excel (.xlsx) حقيقي وصالح للفتح في
 * Microsoft Excel / LibreOffice Calc، بورقة عمل واحدة تحوي جميع حقول النقطة.
 * points: [{ name, point_type, x/easting, y/northing, elevation, description, measured_at, device }]
 */
function exportPointsToExcel(points, { fileNamePrefix = 'survey-points', sheetName = 'Survey Points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');

  const headers = ['الاسم', 'النوع', 'Easting/X', 'Northing/Y', 'Elevation', 'الوصف', 'تاريخ القياس', 'الجهاز', 'دقة القياس'];
  const rows = [headers];
  points.forEach((p) => {
    const x = typeof p.x === 'number' ? p.x : (typeof p.easting === 'number' ? p.easting : '');
    const y = typeof p.y === 'number' ? p.y : (typeof p.northing === 'number' ? p.northing : '');
    rows.push([
      p.name || '',
      p.point_type || p.type || '',
      typeof x === 'number' ? r6(x) : '',
      typeof y === 'number' ? r6(y) : '',
      typeof p.elevation === 'number' ? r6(p.elevation) : '',
      p.description || '',
      p.measured_at || p.date || '',
      p.device || '',
      typeof p.accuracy === 'number' ? p.accuracy : '',
    ]);
  });

  const buffer = generateXlsx([{ name: sheetName, rows }]);
  const filename = `${fileNamePrefix}-${ts()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'XLSX' } };
}

/**
 * استيراد نقاط مساحية من ملف Excel (.xlsx) حقيقي: يقرأ أول ورقة عمل تحوي بيانات فعلية،
 * يتعرف على الأعمدة بمرونة (عربي/إنجليزي) ويستخرج النقاط منظّمة.
 * buffer: Buffer لمحتوى ملف .xlsx (يُرسَل كـ base64 من العميل ثم يُحوَّل إلى Buffer قبل الاستدعاء)
 */
function importPointsFromExcel(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('يجب توفير محتوى الملف كـ Buffer صالح');
  const { sheetNames, sheets } = parseXlsxBuffer(buffer);
  if (sheetNames.length === 0) throw new Error('الملف لا يحتوي على أي أوراق عمل');

  let targetSheetName = sheetNames[0];
  for (const name of sheetNames) {
    if (sheets[name] && sheets[name].length > 1) { targetSheetName = name; break; }
  }
  const { headers, records } = sheetToObjects(sheets[targetSheetName] || []);
  if (records.length === 0) throw new Error('لم يتم العثور على بيانات في ورقة العمل');

  const findCol = (candidates) => headers.find((h) => candidates.some((c) => String(h).toLowerCase().includes(c)));
  const nameCol = findCol(['اسم', 'name']);
  const xCol = findCol(['easting', 'x']);
  const yCol = findCol(['northing', 'y']);
  const zCol = findCol(['elevation', 'z', 'منسوب']);
  const descCol = findCol(['وصف', 'description']);
  const typeCol = findCol(['نوع', 'type']);

  if (!xCol || !yCol) {
    throw new Error('تعذر التعرف على أعمدة الإحداثيات (Easting/Northing أو X/Y) في الملف');
  }

  const points = [];
  records.forEach((rec, idx) => {
    const xNum = Number(rec[xCol]); const yNum = Number(rec[yCol]);
    if (Number.isNaN(xNum) || Number.isNaN(yNum)) return;
    points.push({
      name: (nameCol && rec[nameCol]) || `PT-${idx + 1}`,
      x: xNum, y: yNum,
      elevation: zCol && rec[zCol] !== '' && !Number.isNaN(Number(rec[zCol])) ? Number(rec[zCol]) : null,
      description: (descCol && rec[descCol]) || '',
      point_type: (typeCol && rec[typeCol]) || 'imported',
    });
  });

  if (points.length === 0) throw new Error('لم يتم استخراج أي نقاط صالحة من ملف Excel');
  return { success: true, data: points, count: points.length, sheet_used: targetSheetName, detected_headers: headers };
}

// ==================================================================================
// ================================= Shapefile (SHP) ==================================
// تصدير/استيراد Shapefile حقيقي وفق مواصفة ESRI القياسية (Point Shapefile):
// ثلاثة ملفات مترابطة .shp (الهندسة) + .shx (الفهرس) + .dbf (السمات الوصفية)،
// تُبنى يدوياً بايت-بايت وفق التوثيق الرسمي (ESRI Shapefile Technical Description)،
// ثم تُغلَّف معاً في أرشيف ZIP واحد باستخدام buildZip الموجودة أصلاً في هذا الملف.
// ==================================================================================

const SHP_FILE_CODE = 9994;
const SHP_VERSION = 1000;
const SHP_TYPE_POINT = 1;

/** يبني ملف .shp (Point) من مصفوفة نقاط [{x, y}] */
function buildShpFile(points) {
  const recordSize = 4 + 20; // header (4 int16) + content (شكل 1 + X + Y = 20 بايت)
  const contentLenWords = 10; // شكل النقطة: 4 بايت type + 16 بايت x/y = 20 بايت = 10 كلمات (16-bit)
  const fileLenWords = 50 + points.length * (4 + contentLenWords); // 100 بايت هيدر = 50 كلمة

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

  const header = Buffer.alloc(100);
  header.writeInt32BE(SHP_FILE_CODE, 0);
  header.writeInt32BE(fileLenWords, 24);
  header.writeInt32LE(SHP_VERSION, 28);
  header.writeInt32LE(SHP_TYPE_POINT, 32);
  header.writeDoubleLE(minX, 36);
  header.writeDoubleLE(minY, 44);
  header.writeDoubleLE(maxX, 52);
  header.writeDoubleLE(maxY, 60);
  // Z/M ranges (غير مستخدمة لنوع Point ثنائي الأبعاد) تبقى صفراً

  const records = points.map((p, idx) => {
    const rec = Buffer.alloc(8 + 20);
    rec.writeInt32BE(idx + 1, 0);
    rec.writeInt32BE(contentLenWords, 4);
    rec.writeInt32LE(SHP_TYPE_POINT, 8);
    rec.writeDoubleLE(p.x, 12);
    rec.writeDoubleLE(p.y, 20);
    return rec;
  });

  return Buffer.concat([header, ...records]);
}

/** يبني ملف .shx (فهرس السجلات) المرافق لـ .shp */
function buildShxFile(points) {
  const fileLenWords = 50 + points.length * 4;
  const header = Buffer.alloc(100);
  header.writeInt32BE(SHP_FILE_CODE, 0);
  header.writeInt32BE(fileLenWords, 24);
  header.writeInt32LE(SHP_VERSION, 28);
  header.writeInt32LE(SHP_TYPE_POINT, 32);

  let offsetWords = 50;
  const entries = points.map(() => {
    const e = Buffer.alloc(8);
    e.writeInt32BE(offsetWords, 0);
    e.writeInt32BE(10, 4);
    offsetWords += 4 + 10;
    return e;
  });
  return Buffer.concat([header, ...entries]);
}

/** يبني ملف .dbf (جدول السمات dBase III) بحقول: ID, NAME, TYPE, ELEV, DESC */
function buildDbfFile(points) {
  const fields = [
    { name: 'ID', type: 'N', length: 10, decimals: 0 },
    { name: 'NAME', type: 'C', length: 40, decimals: 0 },
    { name: 'TYPE', type: 'C', length: 20, decimals: 0 },
    { name: 'ELEV', type: 'N', length: 18, decimals: 4 },
    { name: 'DESC', type: 'C', length: 60, decimals: 0 },
  ];
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const now = new Date();

  const header = Buffer.alloc(32);
  header.writeUInt8(0x03, 0); // dBase III without memo
  header.writeUInt8(now.getFullYear() - 1900, 1);
  header.writeUInt8(now.getMonth() + 1, 2);
  header.writeUInt8(now.getDate(), 3);
  header.writeInt32LE(points.length, 4);
  header.writeUInt16LE(headerLength, 8);
  header.writeUInt16LE(recordLength, 10);
  header.writeUInt8(0x08, 29); // Language Driver ID: إشارة إلى أن الحقول النصية مرمّزة UTF-8

  const fieldDescriptors = fields.map((f) => {
    const buf = Buffer.alloc(32);
    Buffer.from(f.name.padEnd(11, '\0').slice(0, 11), 'ascii').copy(buf, 0);
    buf.write(f.type, 11, 'ascii');
    buf.writeUInt8(f.length, 16);
    buf.writeUInt8(f.decimals, 17);
    return buf;
  });
  const headerTerminator = Buffer.from([0x0D]);

  const records = points.map((p, idx) => {
    const rec = Buffer.alloc(recordLength);
    rec.writeUInt8(0x20, 0); // مساحة = سجل غير محذوف
    let offset = 1;
    // الحقول تُكتب بترميز UTF-8 محسوبة بعدد البايتات وليس عدد الحروف، لتمكين حفظ نصوص عربية
    // ضمن العرض الثابت للحقل دون تلف بايتات الحروف متعددة البايت.
    const writeField = (value, length, padLeft = false) => {
      const str = String(value ?? '');
      let bytes = Buffer.from(str, 'utf-8');
      if (bytes.length > length) bytes = bytes.slice(0, length); // اقتصاص بالبايت (قد يقطع حرفاً أخيراً نادراً)
      const padLen = length - bytes.length;
      const padding = Buffer.alloc(padLen, 0x20); // مسافات ASCII للحشو
      const fieldBuf = padLeft ? Buffer.concat([padding, bytes]) : Buffer.concat([bytes, padding]);
      fieldBuf.copy(rec, offset);
      offset += length;
    };
    writeField(idx + 1, fields[0].length, true);
    writeField(p.name || '', fields[1].length);
    writeField(p.point_type || p.type || '', fields[2].length);
    writeField(typeof p.elevation === 'number' ? p.elevation.toFixed(4) : '', fields[3].length, true);
    writeField(p.description || '', fields[4].length);
    return rec;
  });

  const eof = Buffer.from([0x1A]);
  return Buffer.concat([header, ...fieldDescriptors, headerTerminator, ...records, eof]);
}

/**
 * تصدير نقاط المساحة كـ Shapefile حقيقي (نوع Point) مطابق لمواصفة ESRI،
 * معبّأ كملف .zip واحد يحوي (name.shp, name.shx, name.dbf) لتسهيل التنزيل والفتح المباشر في QGIS/ArcGIS.
 * يتطلب إحداثيات مستوية (x, y) أو (easting, northing).
 */
function exportPointsToSHP(points, { fileNamePrefix = 'survey-points' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const normalized = points.map((p) => ({
    ...p,
    x: typeof p.x === 'number' ? p.x : p.easting,
    y: typeof p.y === 'number' ? p.y : p.northing,
  }));
  const missing = normalized.filter((p) => typeof p.x !== 'number' || typeof p.y !== 'number');
  if (missing.length > 0) throw new Error('توجد نقاط بدون إحداثيات x/y أو easting/northing صالحة');

  const baseName = 'survey-points';
  const shp = buildShpFile(normalized);
  const shx = buildShxFile(normalized);
  const dbf = buildDbfFile(normalized);

  const zipBuffer = buildZip([
    { name: `${baseName}.shp`, content: shp },
    { name: `${baseName}.shx`, content: shx },
    { name: `${baseName}.dbf`, content: dbf },
  ]);

  const filename = `${fileNamePrefix}-${ts()}.zip`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, zipBuffer);
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'SHP (zipped: shp+shx+dbf)' } };
}

/**
 * استيراد نقاط من Shapefile: يقرأ أرشيف ZIP يحوي .shp (+ .dbf اختياري للسمات)،
 * يحلّل الهيدر والسجلات وفق مواصفة ESRI لاستخراج نقاط (Point Shapefile فقط - النوع الأكثر شيوعاً للرفع المساحي).
 * zipBuffer: Buffer لأرشيف .zip يحوي ملفات .shp/.dbf (أو .shp فقط بدون سمات).
 */
function importPointsFromSHP(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer)) throw new Error('يجب توفير محتوى الملف كـ Buffer صالح (أرشيف ZIP يحوي .shp)');

  // إعادة استخدام محلّل ZIP العام الموجود فعلياً في xlsxImporter (unzip ليس خاصاً بصيغة XLSX فقط)
  let entries;
  if (typeof unzipGeneric === 'function') {
    entries = unzipGeneric(zipBuffer);
  } else {
    // fallback: استخراج يدوي بسيط لو تعذّر الوصول للدالة العامة
    entries = extractZipEntriesLocal(zipBuffer);
  }

  const shpName = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.shp'));
  if (!shpName) throw new Error('لم يتم العثور على ملف .shp داخل الأرشيف المرفوع');
  const shpBuf = entries[shpName];

  const dbfName = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.dbf'));
  const dbfRecords = dbfName ? parseDbfFile(entries[dbfName]) : [];

  const fileCode = shpBuf.readInt32BE(0);
  if (fileCode !== SHP_FILE_CODE) throw new Error('ملف .shp غير صالح (File Code غير مطابق لمواصفة ESRI)');
  const shapeType = shpBuf.readInt32LE(32);
  if (shapeType !== SHP_TYPE_POINT) {
    throw new Error(`نوع الشكل الهندسي (${shapeType}) غير مدعوم حالياً؛ يدعم النظام حالياً Point Shapefile فقط`);
  }

  const points = [];
  let offset = 100; // نهاية الهيدر الثابت (100 بايت)
  let idx = 0;
  while (offset < shpBuf.length) {
    const recNumber = shpBuf.readInt32BE(offset);
    const contentLenWords = shpBuf.readInt32BE(offset + 4);
    const contentStart = offset + 8;
    const recShapeType = shpBuf.readInt32LE(contentStart);
    if (recShapeType === SHP_TYPE_POINT) {
      const x = shpBuf.readDoubleLE(contentStart + 4);
      const y = shpBuf.readDoubleLE(contentStart + 12);
      const attrs = dbfRecords[idx] || {};
      points.push({
        name: attrs.NAME || `PT-${recNumber}`,
        x, y,
        elevation: attrs.ELEV !== undefined && attrs.ELEV !== '' ? Number(attrs.ELEV) : null,
        description: attrs.DESC || '',
        point_type: attrs.TYPE || 'imported',
      });
    }
    offset = contentStart + contentLenWords * 2;
    idx += 1;
  }

  if (points.length === 0) throw new Error('لم يتم استخراج أي نقاط من ملف .shp');
  return { success: true, data: points, count: points.length };
}

/** استخراج بسيط لملفات ZIP غير مضغوطة/مضغوطة deflate (بديل احتياطي محلي إن تعذّر الوصول لـ unzip الداخلية) */
function extractZipEntriesLocal(buffer) {
  const entries = {};
  let offset = 0;
  while (offset < buffer.length - 4) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString('utf-8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const rawData = buffer.slice(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? zlib.inflateRawSync(rawData) : rawData;
    offset = dataStart + compSize;
  }
  return entries;
}

/** يحلّل ملف .dbf (dBase III) ويعيد مصفوفة كائنات {FIELD: value} بنفس ترتيب سجلات .shp */
function parseDbfFile(buf) {
  const numFields = Math.floor((buf.readUInt16LE(8) - 32 - 1) / 32);
  const numRecords = buf.readInt32LE(4);
  const recordLength = buf.readUInt16LE(10);
  const fields = [];
  for (let i = 0; i < numFields; i += 1) {
    const fOffset = 32 + i * 32;
    const name = buf.toString('ascii', fOffset, fOffset + 11).replace(/\0.*$/, '');
    const length = buf.readUInt8(fOffset + 16);
    fields.push({ name, length });
  }
  const headerLength = buf.readUInt16LE(8);
  const records = [];
  for (let r = 0; r < numRecords; r += 1) {
    const recOffset = headerLength + r * recordLength;
    let fieldOffset = recOffset + 1; // تجاوز بايت حالة الحذف
    const obj = {};
    fields.forEach((f) => {
      // الحقول النصية مكتوبة UTF-8 (انظر buildDbfFile)، لذا يُقرأ الحقل كبايتات UTF-8 وليس ascii
      // لضمان استرجاع النصوص العربية بشكل صحيح، ثم تُزال المسافات الزائدة من الحشو.
      const raw = buf.toString('utf-8', fieldOffset, fieldOffset + f.length).replace(/\0/g, '').trim();
      obj[f.name] = raw;
      fieldOffset += f.length;
    });
    records.push(obj);
  }
  return records;
}

// ==================================================================================
// ==================================== IFC ==========================================
// تصدير/استيراد مبسّط لصيغة IFC (Industry Foundation Classes - STEP/ISO-10303-21) خاص
// بنقاط المساحة: كل نقطة تُمثَّل كـ IfcCartesianPoint مرتبطة بـ IfcBuildingElementProxy
// (تمثيل قياسي لعناصر مساحية/مرجعية في نماذج BIM لا تندرج تحت تصنيف إنشائي محدد).
// الملف الناتج STEP نصي صالح البنية ويمكن فتحه في برامج BIM (Revit, BIMcollab, Solibri, IFC viewers).
// ==================================================================================

function ifcTimestamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, '');
}

/**
 * تصدير نقاط المساحة إلى ملف IFC (STEP) حقيقي البنية: هيدر ISO-10303-21 قياسي،
 * ونقطة IfcCartesianPoint + IfcBuildingElementProxy لكل نقطة رفع/تحكم/توقيع.
 */
function exportPointsToIFC(points, { fileNamePrefix = 'survey-points', projectName = 'Survey Project' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('لا توجد نقاط لتصديرها');
  const normalized = points.map((p) => ({
    ...p,
    x: typeof p.x === 'number' ? p.x : p.easting,
    y: typeof p.y === 'number' ? p.y : p.northing,
  }));
  const missing = normalized.filter((p) => typeof p.x !== 'number' || typeof p.y !== 'number');
  if (missing.length > 0) throw new Error('توجد نقاط بدون إحداثيات x/y أو easting/northing صالحة');

  const lines = [];
  let id = 1;
  const nextId = () => id++;

  const ownerHistoryId = nextId();
  const personId = nextId();
  const orgId = nextId();
  const appId = nextId();
  const originPointId = nextId();
  const axis2PlacementId = nextId();
  const projectId = nextId();
  const geomContextId = nextId();
  const unitAssignmentId = nextId();

  lines.push(`#${personId}=IFCPERSON($,$,'Surveyor',$,$,$,$,$);`);
  lines.push(`#${orgId}=IFCORGANIZATION($,'Civil Engineering Suite',$,$,$);`);
  lines.push(`#${appId}=IFCAPPLICATION(#${orgId},'1.0','Civil Engineering Suite - Survey Module','CES-SURVEY');`);
  lines.push(`#${ownerHistoryId}=IFCOWNERHISTORY(IFCPERSONANDORGANIZATION(#${personId},#${orgId},$),#${appId},$,.ADDED.,$,$,$,0);`);
  lines.push(`#${originPointId}=IFCCARTESIANPOINT((0.,0.,0.));`);
  lines.push(`#${axis2PlacementId}=IFCAXIS2PLACEMENT3D(#${originPointId},$,$);`);
  lines.push(`#${unitAssignmentId}=IFCUNITASSIGNMENT((IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)));`);
  lines.push(`#${geomContextId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${axis2PlacementId},$);`);
  lines.push(`#${projectId}=IFCPROJECT('${projectName.replace(/'/g, '')}',#${ownerHistoryId},'${projectName.replace(/'/g, '')}',$,$,$,$,(#${geomContextId}),#${unitAssignmentId});`);

  normalized.forEach((p, idx) => {
    const ptId = nextId();
    const placementId = nextId();
    const localPlacementId = nextId();
    const proxyId = nextId();
    const z = typeof p.elevation === 'number' ? p.elevation : 0;
    const label = (p.name || `PT-${idx + 1}`).replace(/'/g, '');
    const desc = (p.description || p.point_type || 'Survey Point').replace(/'/g, '');
    lines.push(`#${ptId}=IFCCARTESIANPOINT((${r6(p.x)},${r6(p.y)},${r6(z)}));`);
    lines.push(`#${placementId}=IFCAXIS2PLACEMENT3D(#${ptId},$,$);`);
    lines.push(`#${localPlacementId}=IFCLOCALPLACEMENT($,#${placementId});`);
    lines.push(`#${proxyId}=IFCBUILDINGELEMENTPROXY('${newGuidLike()}',#${ownerHistoryId},'${label}','${desc}',$,#${localPlacementId},$,$,.NOTDEFINED.);`);
  });

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Survey Points Export'),'2;1');`,
    `FILE_NAME('${fileNamePrefix}.ifc','${ifcTimestamp()}',('Civil Engineering Suite'),('Survey Module'),'CES-IFC-Writer','CES-SURVEY','');`,
    `FILE_SCHEMA(('IFC4'));`,
    'ENDSEC;',
    'DATA;',
  ].join('\n');

  const footer = ['ENDSEC;', 'END-ISO-10303-21;'].join('\n');

  const content = [header, ...lines, footer].join('\n');
  const filename = `${fileNamePrefix}-${ts()}.ifc`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, content, 'utf-8');
  return { success: true, data: { url: `/reports/${filename}`, count: points.length, format: 'IFC (STEP/ISO-10303-21)' } };
}

function newGuidLike() {
  // معرّف بسيط يشبه IFC GUID (22 حرف) - لأغراض عدم التكرار داخل الملف فقط، وليس IFC GlobalId المضغوط رسمياً
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
  let out = '';
  for (let i = 0; i < 22; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * استيراد نقاط من ملف IFC: يحلّل أسطر IFCCARTESIANPOINT وIFCBUILDINGELEMENTPROXY المرتبطة بها
 * عبر IFCLOCALPLACEMENT/IFCAXIS2PLACEMENT3D لاستخراج الإحداثيات والاسم/الوصف لكل نقطة مساحية مُصدَّرة سابقاً.
 * content: نص محتوى ملف .ifc (STEP ASCII)
 */
function importPointsFromIFC(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('محتوى ملف IFC فارغ أو غير صالح');

  const entityMap = {};
  content.split('\n').forEach((line) => {
    const m = line.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);\s*$/);
    if (m) entityMap[m[1]] = { type: m[2], args: m[3] };
  });

  const points = [];
  Object.entries(entityMap).forEach(([id, entity]) => {
    if (entity.type !== 'IFCBUILDINGELEMENTPROXY') return;
    // البنية: (GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, Tag, PredefinedType)
    const args = splitStepArgs(entity.args);
    const name = (args[2] || '').replace(/^'|'$/g, '');
    const description = (args[3] || '').replace(/^'|'$/g, '');
    const placementRef = (args[5] || '').replace('#', '');
    const localPlacement = entityMap[placementRef];
    if (!localPlacement) return;
    const lpArgs = splitStepArgs(localPlacement.args);
    const axisRef = (lpArgs[1] || '').replace('#', '');
    const axisEntity = entityMap[axisRef];
    if (!axisEntity) return;
    const axisArgs = splitStepArgs(axisEntity.args);
    const pointRef = (axisArgs[0] || '').replace('#', '');
    const pointEntity = entityMap[pointRef];
    if (!pointEntity || pointEntity.type !== 'IFCCARTESIANPOINT') return;
    const coordsMatch = pointEntity.args.match(/\(([^()]*)\)/);
    if (!coordsMatch) return;
    const coords = coordsMatch[1].split(',').map((c) => Number(c.trim()));
    if (coords.length < 2 || coords.some((c) => Number.isNaN(c))) return;

    points.push({
      name: name || `PT-${id}`,
      x: coords[0], y: coords[1],
      elevation: coords.length > 2 ? coords[2] : null,
      description: description || '',
      point_type: 'imported',
    });
  });

  if (points.length === 0) throw new Error('لم يتم العثور على أي نقاط (IfcBuildingElementProxy) صالحة داخل ملف IFC');
  return { success: true, data: points, count: points.length };
}

/** يقسّم قائمة وسائط STEP مع مراعاة الأقواس والفواصل داخل النصوص المقتبسة */
function splitStepArgs(argsStr) {
  const result = [];
  let depth = 0; let current = ''; let inString = false;
  for (let i = 0; i < argsStr.length; i += 1) {
    const ch = argsStr[i];
    if (ch === "'" ) inString = !inString;
    if (!inString) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
    }
    if (ch === ',' && depth === 0 && !inString) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

module.exports = {
  exportPointsToGeoJSON,
  importPointsFromGeoJSON,
  exportPointsToKML,
  importPointsFromKML,
  exportPointsToKMZ,
  exportPointsToDXF,
  importPointsFromDXF,
  exportPointsToLandXML,
  importPointsFromLandXML,
  importPointsFromCSV,
  exportPointsToExcel,
  importPointsFromExcel,
  exportPointsToSHP,
  importPointsFromSHP,
  exportPointsToIFC,
  importPointsFromIFC,
  buildZip,
  crc32,
};
