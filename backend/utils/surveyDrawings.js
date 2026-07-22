/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * الرسومات التلقائية (Automated Drawings Generation)
 * ---------------------------------------------------------------------------------
 * يغطي هذا الملف توليد رسومات فعلية (ملفات SVG قابلة للعرض والطباعة والتصدير) من
 * بيانات الرفع المخزَّنة فعلياً في survey.json، وليس مجرد حسابات نصية:
 *   - خطوط الكنتور (Contour Lines)                → مبنية على generateContourLines
 *   - المقاطع الطولية (Longitudinal Sections)      → مبنية على derived.longitudinal_section
 *   - المقاطع العرضية (Cross Sections)              → مبنية على derived.cross_section
 *   - نماذج سطح الأرض الرقمية / التضاريس ثلاثية الأبعاد (DTM / 3D Terrain)
 *     → مثلثة Delaunay مبسطة (Grid-based triangulation) + إسقاط إيزومتري حقيقي
 *   - مخططات رفع/توقيع مبسطة (Point Plot Drawings) لأي عملية رفع لها نقاط مخزَّنة
 *
 * التخزين والعرض: يتم كتابة كل رسم كملف SVG فعلي داخل مجلد /reports وإرجاع رابط
 * (url) يمكن فتحه مباشرة في المتصفح أو تضمينه في الواجهة، بنفس نمط surveyReports.js.
 */

const fs = require('fs');
const path = require('path');
const SURVEY = require('./surveyManagement');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const { _internal } = SURVEY;
const { r2, r4 } = _internal;

function newDrawingId() { return `SRV-DWG-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function saveSvg(filenamePrefix, svg) {
  const filename = `${filenamePrefix}-${Date.now()}.svg`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, svg, 'utf8');
  return { outputPath, url: `/reports/${filename}` };
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function svgHeader(width, height, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Tahoma, Arial, sans-serif">
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="${width / 2}" y="26" text-anchor="middle" font-size="16" font-weight="bold" fill="#1b3a5c">${escapeXml(title)}</text>`;
}
const svgFooter = () => '</svg>';

function scaleFit(values, targetMin, targetMax) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;
  return (v) => targetMin + ((v - min) / span) * (targetMax - targetMin);
}

// =====================================================================================
// 1) خطوط الكنتور (Contour Lines) — رسم فعلي من contour_points_by_level
// =====================================================================================
function generateContourDrawing({ survey_id, width = 900, height = 700 } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  if (record.survey_type !== 'contour_survey') {
    throw new Error('هذه العملية ليست من نوع رفع كنتوري (contour_survey)');
  }
  if (!record.derived || !record.derived.contour) {
    throw new Error('لا توجد بيانات كنتور محسوبة لهذه العملية (تأكد من وجود 3 نقاط رفع على الأقل)');
  }
  const contour = record.derived.contour;
  const points = record.points || [];
  if (!points.length) throw new Error('لا توجد نقاط رفع مخزَّنة لهذه العملية');

  const margin = 60;
  const xs = points.map((p) => Number(p.easting));
  const ys = points.map((p) => Number(p.northing));
  const sx = scaleFit(xs, margin, width - margin);
  const sy = scaleFit(ys, height - margin, margin + 30); // عكس المحور الرأسي (Northing لأعلى)

  let svg = svgHeader(width, height, `خطوط الكنتور — ${record.title} (${record.survey_number})`);

  const levels = Object.keys(contour.contour_points_by_level).map(Number).sort((a, b) => a - b);
  const colors = ['#8e44ad', '#2980b9', '#16a085', '#27ae60', '#f39c12', '#d35400', '#c0392b'];
  levels.forEach((level, idx) => {
    const pts = contour.contour_points_by_level[level];
    const color = colors[idx % colors.length];
    pts.forEach((pt) => {
      svg += `<circle cx="${r2(sx(pt.easting))}" cy="${r2(sy(pt.northing))}" r="2.5" fill="${color}"/>`;
    });
    if (pts.length) {
      const last = pts[pts.length - 1];
      svg += `<text x="${r2(sx(last.easting)) + 6}" y="${r2(sy(last.northing))}" font-size="10" fill="${color}">${level}م</text>`;
    }
  });

  // النقاط الأصلية للرفع (رمادي) مع المنسوب
  points.forEach((p) => {
    svg += `<circle cx="${r2(sx(Number(p.easting)))}" cy="${r2(sy(Number(p.northing)))}" r="3" fill="#34495e" stroke="#fff" stroke-width="1"/>`;
    svg += `<text x="${r2(sx(Number(p.easting))) + 5}" y="${r2(sy(Number(p.northing))) - 5}" font-size="9" fill="#2c3e50">${p.elevation}</text>`;
  });

  // مفتاح الرسم (Legend)
  svg += `<g transform="translate(${width - 170}, ${height - 30 - levels.length * 16})">
    <rect x="-10" y="-20" width="170" height="${levels.length * 16 + 30}" fill="#f8f9fb" stroke="#ddd"/>
    <text x="0" y="0" font-size="11" font-weight="bold" fill="#1b3a5c">مفتاح خطوط الكنتور</text>`;
  levels.forEach((level, idx) => {
    const color = colors[idx % colors.length];
    svg += `<circle cx="6" cy="${16 + idx * 16}" r="4" fill="${color}"/><text x="16" y="${19 + idx * 16}" font-size="10" fill="#333">منسوب ${level} م</text>`;
  });
  svg += '</g>';

  svg += `<text x="${margin}" y="${height - 12}" font-size="10" fill="#777">أدنى منسوب: ${contour.min_elevation} م  |  أعلى منسوب: ${contour.max_elevation} م  |  الفاصل الكنتوري: ${contour.interval} م  |  عدد الخطوط: ${contour.levels_count}</text>`;
  svg += svgFooter();

  const { url, outputPath } = saveSvg('contour', svg);
  return {
    drawing_id: newDrawingId(), type: 'contour', survey_id, title: `خطوط الكنتور — ${record.title}`, url, outputPath,
  };
}

// =====================================================================================
// 2) المقطع الطولي (Longitudinal Section) — رسم فعلي لخط المنسوب الطبيعي وخط التصميم
// =====================================================================================
function generateLongitudinalSectionDrawing({ survey_id, width = 900, height = 450 } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  if (record.survey_type !== 'longitudinal_section') {
    throw new Error('هذه العملية ليست من نوع مقطع طولي (longitudinal_section)');
  }
  const points = (record.points || []).map((p) => ({
    chainage: Number(p.chainage), elevation: Number(p.elevation),
    design_elevation: p.design_elevation !== undefined && p.design_elevation !== null ? Number(p.design_elevation) : null,
  })).sort((a, b) => a.chainage - b.chainage);
  if (points.length < 2) throw new Error('يجب توفر نقطتين على الأقل لرسم المقطع الطولي');

  const margin = 60;
  const chainages = points.map((p) => p.chainage);
  const elevations = points.map((p) => p.elevation).concat(
    points.filter((p) => p.design_elevation !== null).map((p) => p.design_elevation),
  );
  const sx = scaleFit(chainages, margin, width - margin);
  const sy = scaleFit(elevations, height - margin, margin + 20);

  let svg = svgHeader(width, height, `المقطع الطولي — ${record.title} (${record.survey_number})`);

  // خطوط الشبكة الأفقية
  const minEl = Math.min(...elevations); const maxEl = Math.max(...elevations);
  const gridStep = ((maxEl - minEl) || 1) / 5;
  for (let i = 0; i <= 5; i++) {
    const val = minEl + gridStep * i;
    const y = r2(sy(val));
    svg += `<line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" stroke="#eee"/>`;
    svg += `<text x="${margin - 8}" y="${y + 3}" font-size="9" text-anchor="end" fill="#777">${r2(val)}</text>`;
  }

  // خط المنسوب الطبيعي (Ground Line)
  const groundPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(sx(p.chainage))} ${r2(sy(p.elevation))}`).join(' ');
  svg += `<path d="${groundPath}" fill="none" stroke="#2c3e50" stroke-width="2.5"/>`;
  points.forEach((p) => {
    svg += `<circle cx="${r2(sx(p.chainage))}" cy="${r2(sy(p.elevation))}" r="3" fill="#2c3e50"/>`;
  });

  // خط منسوب التصميم (Design Line) إن وُجد
  const designPts = points.filter((p) => p.design_elevation !== null);
  if (designPts.length >= 2) {
    const designPath = designPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(sx(p.chainage))} ${r2(sy(p.design_elevation))}`).join(' ');
    svg += `<path d="${designPath}" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="6,4"/>`;
  }

  // محور Chainage
  points.forEach((p) => {
    svg += `<text x="${r2(sx(p.chainage))}" y="${height - margin + 16}" font-size="9" text-anchor="middle" fill="#333">${r2(p.chainage)}</text>`;
  });
  svg += `<text x="${width / 2}" y="${height - 14}" font-size="10" text-anchor="middle" fill="#555">Chainage (م)</text>`;

  // مفتاح الرسم
  svg += `<g transform="translate(${width - 190}, ${margin})">
    <rect x="-10" y="-16" width="185" height="52" fill="#f8f9fb" stroke="#ddd"/>
    <line x1="0" y1="0" x2="20" y2="0" stroke="#2c3e50" stroke-width="2.5"/><text x="26" y="4" font-size="10">المنسوب الطبيعي</text>
    <line x1="0" y1="18" x2="20" y2="18" stroke="#c0392b" stroke-width="2" stroke-dasharray="6,4"/><text x="26" y="22" font-size="10">منسوب التصميم</text>
  </g>`;

  svg += svgFooter();
  const { url, outputPath } = saveSvg('long-section', svg);
  return {
    drawing_id: newDrawingId(), type: 'longitudinal_section', survey_id, title: `المقطع الطولي — ${record.title}`, url, outputPath,
  };
}

// =====================================================================================
// 3) المقطع العرضي (Cross Section) — رسم فعلي لسطح الأرض مقابل منسوب التصميم
// =====================================================================================
function generateCrossSectionDrawing({ survey_id, width = 800, height = 450 } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  if (record.survey_type !== 'cross_section') {
    throw new Error('هذه العملية ليست من نوع مقطع عرضي (cross_section)');
  }
  const points = (record.points || []).map((p) => ({ offset: Number(p.offset), elevation: Number(p.elevation) }))
    .sort((a, b) => a.offset - b.offset);
  if (points.length < 2) throw new Error('يجب توفر نقطتين على الأقل لرسم المقطع العرضي');
  const de = record.design_elevation !== undefined && record.design_elevation !== null ? Number(record.design_elevation) : null;

  const margin = 60;
  const offsets = points.map((p) => p.offset);
  const elevations = points.map((p) => p.elevation).concat(de !== null ? [de] : []);
  const sx = scaleFit(offsets, margin, width - margin);
  const sy = scaleFit(elevations, height - margin, margin + 20);

  let svg = svgHeader(width, height, `المقطع العرضي — ${record.title} (${record.survey_number})`);

  if (de !== null) {
    const y = r2(sy(de));
    svg += `<line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    svg += `<text x="${width - margin + 4}" y="${y + 3}" font-size="9" fill="#c0392b">تصميم ${de}</text>`;
  }

  const groundPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(sx(p.offset))} ${r2(sy(p.elevation))}`).join(' ');
  svg += `<path d="${groundPath}" fill="none" stroke="#2c3e50" stroke-width="2.5"/>`;

  // تظليل مناطق الحفر (فوق التصميم) والردم (تحت التصميم)
  if (de !== null) {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]; const p2 = points[i + 1];
      const x1 = r2(sx(p1.offset)); const x2 = r2(sx(p2.offset));
      const y1 = r2(sy(p1.elevation)); const y2 = r2(sy(p2.elevation));
      const yd = r2(sy(de));
      const isCut = (p1.elevation + p2.elevation) / 2 >= de;
      const color = isCut ? 'rgba(231,76,60,0.18)' : 'rgba(41,128,185,0.18)';
      svg += `<polygon points="${x1},${y1} ${x2},${y2} ${x2},${yd} ${x1},${yd}" fill="${color}"/>`;
    }
  }

  points.forEach((p) => {
    svg += `<circle cx="${r2(sx(p.offset))}" cy="${r2(sy(p.elevation))}" r="3" fill="#2c3e50"/>`;
    svg += `<text x="${r2(sx(p.offset))}" y="${r2(sy(p.elevation)) - 8}" font-size="9" text-anchor="middle" fill="#333">${p.offset}</text>`;
  });

  svg += `<text x="${width / 2}" y="${height - 14}" font-size="10" text-anchor="middle" fill="#555">Offset (م) — أحمر: حفر / أزرق: ردم</text>`;
  svg += svgFooter();
  const { url, outputPath } = saveSvg('cross-section', svg);
  return {
    drawing_id: newDrawingId(), type: 'cross_section', survey_id, title: `المقطع العرضي — ${record.title}`, url, outputPath,
  };
}

// =====================================================================================
// 4) نموذج سطح الأرض الرقمي / التضاريس ثلاثية الأبعاد (DTM / 3D Terrain)
//    مثلثة شبكية مبسطة (Grid Triangulation) + إسقاط إيزومتري حقيقي على مستوى 2D
// =====================================================================================
function isoProject(x, y, z, { scale = 1, originX = 0, originY = 0 } = {}) {
  // إسقاط إيزومتري قياسي: زاوية 30° لكل محور أفقي، والارتفاع (z) يُرفع رأسياً
  const rad = Math.PI / 6; // 30 درجة
  const sx = (x - y) * Math.cos(rad) * scale + originX;
  const sy = (x + y) * Math.sin(rad) * scale - z * scale + originY;
  return { x: sx, y: sy };
}

function generateDtm3DDrawing({ survey_id, width = 900, height = 700, exaggeration = 3 } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  const points = record.points || [];
  if (points.length < 3) throw new Error('يجب توفر 3 نقاط رفع (easting, northing, elevation) على الأقل لبناء نموذج التضاريس');

  const pts = points.map((p) => ({
    x: Number(p.easting), y: Number(p.northing), z: Number(p.elevation),
  })).filter((p) => !Number.isNaN(p.x) && !Number.isNaN(p.y) && !Number.isNaN(p.z));
  if (pts.length < 3) throw new Error('نقاط الرفع لا تحتوي على إحداثيات (easting/northing) ومناسيب صحيحة كافية');

  // تطبيع الإحداثيات إلى شبكة موحدة (Normalized grid) قبل الإسقاط
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y); const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const minZ = Math.min(...zs); const maxZ = Math.max(...zs);
  const spanX = (maxX - minX) || 1; const spanY = (maxY - minY) || 1; const spanZ = (maxZ - minZ) || 1;
  const norm = pts.map((p) => ({
    nx: ((p.x - minX) / spanX) * 100,
    ny: ((p.y - minY) / spanY) * 100,
    nz: ((p.z - minZ) / spanZ) * 20 * (exaggeration / 3), // مبالغة رأسية لإبراز التضاريس
    elevation: p.z,
  }));

  // بناء شبكة مثلثات مبسطة عبر ترتيب النقاط في صفوف تقريبية (Grid Triangulation)
  // نستخدم أقرب-جار (Nearest neighbor rows) عبر فرز حسب northing ثم easting كتقريب عملي بلا تبعيات خارجية
  const sorted = [...norm].sort((a, b) => (a.ny - b.ny) || (a.nx - b.nx));
  const rowsCount = Math.max(2, Math.round(Math.sqrt(sorted.length)));
  const perRow = Math.ceil(sorted.length / rowsCount);
  const rows = [];
  for (let i = 0; i < sorted.length; i += perRow) rows.push(sorted.slice(i, i + perRow).sort((a, b) => a.nx - b.nx));

  const scale = 4.2; const originX = width / 2; const originY = 90;
  const projected = norm.map((p) => isoProject(p.nx, p.ny, p.nz, { scale, originX, originY }));

  let svg = svgHeader(width, height, `نموذج سطح الأرض الرقمي (DTM) — إسقاط إيزومتري ثلاثي الأبعاد — ${record.title}`);

  // ألوان حسب الارتفاع (تدرّج من الأزرق/الأخضر للمرتفعات المنخفضة إلى البني/الأحمر للمرتفعة)
  const elevColor = (z) => {
    const t = (z - minZ) / spanZ;
    if (t < 0.25) return '#2980b9';
    if (t < 0.5) return '#27ae60';
    if (t < 0.75) return '#f39c12';
    return '#c0392b';
  };

  // رسم أضلاع الشبكة (تقريب مثلثي: بين كل نقطة ومجاوريها في نفس الصف والصف التالي)
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      const p1 = isoProject(row[i].nx, row[i].ny, row[i].nz, { scale, originX, originY });
      if (i < row.length - 1) {
        const p2 = isoProject(row[i + 1].nx, row[i + 1].ny, row[i + 1].nz, { scale, originX, originY });
        svg += `<line x1="${r2(p1.x)}" y1="${r2(p1.y)}" x2="${r2(p2.x)}" y2="${r2(p2.y)}" stroke="#999" stroke-width="1"/>`;
      }
      if (r < rows.length - 1 && rows[r + 1][i]) {
        const p3 = isoProject(rows[r + 1][i].nx, rows[r + 1][i].ny, rows[r + 1][i].nz, { scale, originX, originY });
        svg += `<line x1="${r2(p1.x)}" y1="${r2(p1.y)}" x2="${r2(p3.x)}" y2="${r2(p3.y)}" stroke="#999" stroke-width="1"/>`;
      }
    }
  }

  // نقاط الرفع فوق الشبكة، ملونة حسب المنسوب
  norm.forEach((p, idx) => {
    const proj = projected[idx];
    svg += `<circle cx="${r2(proj.x)}" cy="${r2(proj.y)}" r="3.5" fill="${elevColor(p.elevation)}" stroke="#fff" stroke-width="0.8"/>`;
  });

  // مفتاح الرسم (تدرّج الألوان)
  svg += `<g transform="translate(${width - 190}, ${height - 130})">
    <rect x="-10" y="-20" width="180" height="120" fill="#f8f9fb" stroke="#ddd"/>
    <text x="0" y="0" font-size="11" font-weight="bold" fill="#1b3a5c">تدرّج الارتفاع</text>
    <circle cx="6" cy="18" r="5" fill="#2980b9"/><text x="18" y="22" font-size="10">منخفض (${r2(minZ)} م)</text>
    <circle cx="6" cy="38" r="5" fill="#27ae60"/><text x="18" y="42" font-size="10">متوسط منخفض</text>
    <circle cx="6" cy="58" r="5" fill="#f39c12"/><text x="18" y="62" font-size="10">متوسط مرتفع</text>
    <circle cx="6" cy="78" r="5" fill="#c0392b"/><text x="18" y="82" font-size="10">مرتفع (${r2(maxZ)} م)</text>
  </g>`;

  svg += `<text x="20" y="${height - 12}" font-size="10" fill="#777">عدد نقاط النموذج: ${pts.length}  |  فارق الارتفاع: ${r2(spanZ)} م  |  مبالغة رأسية: ×${exaggeration}</text>`;
  svg += svgFooter();

  const { url, outputPath } = saveSvg('dtm-3d', svg);
  return {
    drawing_id: newDrawingId(), type: 'dtm_3d', survey_id, title: `نموذج سطح الأرض الرقمي — ${record.title}`, url, outputPath,
    min_elevation: r4(minZ), max_elevation: r4(maxZ), points_used: pts.length,
  };
}

// =====================================================================================
// 5) مخطط نقاط رفع/توقيع عام (Point Plot) — لأي عملية رفع بها نقاط easting/northing
// =====================================================================================
function generatePointPlotDrawing({ survey_id, width = 900, height = 700 } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  const points = (record.points || []).filter((p) => p.easting !== undefined && p.northing !== undefined);
  if (points.length < 1) throw new Error('لا توجد نقاط برفع إحداثيات (easting/northing) لهذه العملية لرسمها');

  const margin = 60;
  const xs = points.map((p) => Number(p.easting));
  const ys = points.map((p) => Number(p.northing));
  const sx = scaleFit(xs, margin, width - margin);
  const sy = scaleFit(ys, height - margin, margin + 30);

  let svg = svgHeader(width, height, `مخطط نقاط الرفع — ${record.title} (${record.survey_number})`);

  if (points.length >= 2) {
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(sx(Number(p.easting)))} ${r2(sy(Number(p.northing)))}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="#95a5a6" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }
  points.forEach((p, idx) => {
    const x = r2(sx(Number(p.easting))); const y = r2(sy(Number(p.northing)));
    svg += `<circle cx="${x}" cy="${y}" r="4" fill="#2980b9" stroke="#fff" stroke-width="1"/>`;
    svg += `<text x="${x + 6}" y="${y - 6}" font-size="9" fill="#2c3e50">${escapeXml(p.point_id || p.description || `P${idx + 1}`)}${p.elevation !== undefined ? ` (${p.elevation})` : ''}</text>`;
  });

  svg += svgFooter();
  const { url, outputPath } = saveSvg('point-plot', svg);
  return {
    drawing_id: newDrawingId(), type: 'point_plot', survey_id, title: `مخطط نقاط الرفع — ${record.title}`, url, outputPath,
  };
}

// =====================================================================================
// موجّه عام: توليد رسم حسب نوع عملية الرفع تلقائياً
// =====================================================================================
function generateAutoDrawing({ survey_id } = {}) {
  const record = SURVEY.getSurveyRecord(survey_id);
  if (!record) throw new Error('عملية الرفع غير موجودة');
  switch (record.survey_type) {
    case 'contour_survey': return generateContourDrawing({ survey_id });
    case 'longitudinal_section': return generateLongitudinalSectionDrawing({ survey_id });
    case 'cross_section': return generateCrossSectionDrawing({ survey_id });
    default: return generatePointPlotDrawing({ survey_id });
  }
}

module.exports = {
  generateContourDrawing,
  generateLongitudinalSectionDrawing,
  generateCrossSectionDrawing,
  generateDtm3DDrawing,
  generatePointPlotDrawing,
  generateAutoDrawing,
};
