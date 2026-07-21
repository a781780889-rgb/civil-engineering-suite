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
  buildZip,
  crc32,
};
