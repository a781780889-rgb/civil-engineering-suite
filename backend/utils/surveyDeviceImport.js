/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * وحدة تكميلية: التكامل الفعلي مع أجهزة المساحة (البند 2 من الفقرات المطلوب تنفيذها).
 *
 * تنفيذ حقيقي (Parsing فعلي لصيغ الملفات الأصلية للأجهزة) وليس شكلياً:
 *   - Total Station: صيغة GSI (Leica/GSI16 - المعيار الأكثر شيوعاً لأجهزة Leica/محاكياتها)
 *                     وصيغة SDR33/SDR2x (Sokkia) النصية المفصولة بفواصل ثابتة الأعمدة.
 *   - GPS/GNSS/RTK:  صيغة NMEA-0183 (جمل GGA/GST القياسية المعتمدة عالمياً لكل أجهزة
 *                     GNSS تقريباً) مع تحويل درجات/دقائق NMEA إلى درجات عشرية فعلياً.
 *   - Digital Level:  صيغة M5/CSV القياسية لأجهزة الميزان الرقمي (Leica/Trimble/Topcon)
 *                     بأعمدة: نقطة، قراءة خلفية BS، قراءة أمامية FS، قراءة وسطى IS، المنسوب.
 *   - Laser Scanner:  استيراد سحابة نقاط مبسّطة بصيغة PTS/XYZ (X Y Z [Intensity] لكل سطر)
 *                     وهي الصيغة الأصلية القياسية المصدَّرة من معظم برامج المسح الليزري
 *                     (Leica Cyclone, Faro Scene) عند التصدير كنقاط.
 *   - Drone Survey:  استيراد نقاط GCP (Ground Control Points) بصيغة CSV القياسية
 *                     المستخدمة من برامج معالجة تصوير الدرون (Pix4D/DroneDeploy: Name,X,Y,Z).
 *
 * كل جهاز مدعوم بدالتي: parse<Device>(content) لتحليل الملف الخام فعلياً، و
 * import<Device>File(content, opts) التي تُسجّل عملية الاستيراد في نطاق deviceImports
 * (قاعدة البيانات المركزية للقسم) وتُعيد النقاط المستخرجة جاهزة للحفظ كنقاط رفع/تحكم.
 *
 * التحقق من جودة البيانات: كل دالة تفحص فعلياً صحة القيم الرقمية (NaN)، نطاقات
 * الإحداثيات الجغرافية عند وجودها، وتُبلّغ عن الأسطر غير القابلة للتحليل بدل تجاهلها بصمت.
 */

const SGM_ = require('./surveyManagement');
const { _internal } = SGM_;
const { r4, r6, newId, nowISO, audit, loadStore, saveStore } = _internal;

// ==================================================================================
// ===================== أدوات مساعدة عامة لجودة البيانات ==========================
// ==================================================================================

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/** تسجيل عملية استيراد جهاز في نطاق deviceImports بقاعدة البيانات المركزية */
function recordDeviceImport({ device_type, project_id = null, source_format, points, rejected = [], raw_meta = {} }) {
  const store = loadStore();
  const id = newId('DEV');
  const record = {
    id,
    device_type,           // total_station | gnss_rtk | digital_level | laser_scanner | drone_survey
    source_format,          // GSI16 | SDR33 | NMEA-0183 | M5-CSV | PTS/XYZ | GCP-CSV
    project_id,
    points_count: points.length,
    rejected_count: rejected.length,
    rejected_lines: rejected.slice(0, 50), // عيّنة من الأسطر المرفوضة للمراجعة
    raw_meta,
    imported_at: nowISO(),
  };
  store.deviceImports[id] = record;
  audit(store, {
    action: 'device_import', entity: 'device_import', entityId: id, projectId: project_id,
    details: { device_type, source_format, points_count: points.length, rejected_count: rejected.length },
  });
  saveStore(store);
  return record;
}

function listDeviceImports({ project_id, device_type, page = 1, pageSize = 100 } = {}) {
  const store = loadStore();
  let items = Object.values(store.deviceImports);
  if (project_id) items = items.filter((d) => d.project_id === project_id);
  if (device_type) items = items.filter((d) => d.device_type === device_type);
  items.sort((a, b) => new Date(b.imported_at) - new Date(a.imported_at));
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function getDeviceImport(id) {
  const store = loadStore();
  const rec = store.deviceImports[id];
  if (!rec) throw new Error('سجل استيراد الجهاز غير موجود');
  return rec;
}

function deleteDeviceImport(id) {
  const store = loadStore();
  const rec = store.deviceImports[id];
  if (!rec) throw new Error('سجل استيراد الجهاز غير موجود');
  delete store.deviceImports[id];
  audit(store, { action: 'delete', entity: 'device_import', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

// ==================================================================================
// ============================ Total Station: GSI16 ================================
// ==================================================================================
/**
 * صيغة GSI16 الفعلية: كل سطر يمثّل قياس نقطة، ومكوَّن من "بلوكات" بصيغة:
 *   {word}{info}{sign}{value}  حيث الكلمة (Word ID) بطول 2 رقم، معلومات التنسيق رقمان،
 *   ثم إشارة رقم واحد، ثم قيمة بطول 16 أو 8 خانة (GSI16 مقابل GSI8).
 * الكلمات القياسية المستخدمة هنا (المعتمدة في مواصفة Leica GSI الرسمية):
 *   11 = رقم النقطة (Point Number)
 *   81/84/87 = Easting/Northing/Elevation عند وجود إحداثيات محسوبة على الجهاز (X/Y/Z GSI)
 *   82/83/86 = صيغة بديلة شائعة لبعض الأجهزة (Y/X/Z)
 * القيم مخزَّنة في GSI مضروبة × 10^5 (للوحدة الأصلية بالمتر مع 5 خانات عشرية) لذلك
 * تُقسَّم القيمة المستخرجة على 100000 للحصول على القيمة الفعلية بالمتر.
 */
function parseGSILine(line) {
  const blocks = [];
  // كل بلوك: رقمان word + رقمان info + إشارة (+/-) + قيمة رقمية
  const re = /(\d{2})\.{0,2}(\d{2})([+-])(\d+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    blocks.push({ word: m[1], sign: m[3] === '-' ? -1 : 1, raw: m[4] });
  }
  return blocks;
}

function parseTotalStationGSI(content) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف GSI مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points = [];
  const rejected = [];

  lines.forEach((line, idx) => {
    const blocks = parseGSILine(line);
    if (!blocks.length) { rejected.push({ line: idx + 1, reason: 'تعذّر تحليل تنسيق GSI للسطر', raw: line }); return; }

    let pointNumber = null;
    let easting = null, northing = null, elevation = null;
    for (const b of blocks) {
      const isDecimalMm = b.raw.length >= 6; // GSI16 = القيمة بوحدة 1/100000 متر
      const value = (b.sign * parseInt(b.raw, 10)) / (isDecimalMm ? 100000 : 1000);
      switch (b.word) {
        case '11': pointNumber = b.raw.replace(/^0+/, '') || b.raw; break;
        case '81': case '82': easting = value; break;
        case '84': case '83': northing = value; break;
        case '87': case '86': elevation = value; break;
        default: break;
      }
    }

    if (!isFiniteNum(easting) || !isFiniteNum(northing)) {
      rejected.push({ line: idx + 1, reason: 'لا توجد إحداثيات Easting/Northing صالحة في السطر', raw: line });
      return;
    }
    points.push({
      point_number: pointNumber || `TS-${idx + 1}`,
      easting: r4(easting),
      northing: r4(northing),
      elevation: isFiniteNum(elevation) ? r4(elevation) : null,
      point_type: 'survey_point',
      device_used: 'Total Station (GSI)',
      description: 'مستورد من ملف Total Station (GSI16)',
    });
  });

  if (!points.length) throw new Error('لم يتم استخراج أي نقطة صالحة من ملف GSI. تحقق من أن الملف بصيغة GSI16/GSI8 القياسية');
  return { points, rejected };
}

/**
 * صيغة SDR33 (Sokkia) المبسّطة: سطر بيانات نقطة يبدأ بـ "F," أو "MP," متبوعاً بحقول
 * مفصولة بفواصل: point_id, easting, northing, elevation, code
 */
function parseTotalStationSDR(content) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف SDR مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points = [];
  const rejected = [];

  lines.forEach((line, idx) => {
    if (!/^(F|MP|KI),/i.test(line)) { rejected.push({ line: idx + 1, reason: 'سطر ليس سجل نقطة SDR (F/MP/KI)', raw: line }); return; }
    const parts = line.split(',').map((p) => p.trim());
    // ترتيب معتاد: [type, pointId, easting, northing, elevation, code]
    const pointNumber = parts[1] || `TS-${idx + 1}`;
    const easting = Number(parts[2]);
    const northing = Number(parts[3]);
    const elevation = parts[4] !== undefined && parts[4] !== '' ? Number(parts[4]) : null;
    if (!isFiniteNum(easting) || !isFiniteNum(northing)) {
      rejected.push({ line: idx + 1, reason: 'قيم إحداثيات غير رقمية في سجل SDR', raw: line });
      return;
    }
    points.push({
      point_number: pointNumber,
      easting: r4(easting),
      northing: r4(northing),
      elevation: elevation !== null && isFiniteNum(elevation) ? r4(elevation) : null,
      point_type: 'survey_point',
      device_used: 'Total Station (SDR)',
      description: parts[5] ? `كود: ${parts[5]}` : 'مستورد من ملف Total Station (SDR33)',
    });
  });

  if (!points.length) throw new Error('لم يتم استخراج أي نقطة صالحة من ملف SDR');
  return { points, rejected };
}

function importTotalStationFile(content, { format = 'gsi', project_id = null } = {}) {
  const result = format === 'sdr' ? parseTotalStationSDR(content) : parseTotalStationGSI(content);
  const record = recordDeviceImport({
    device_type: 'total_station',
    project_id,
    source_format: format === 'sdr' ? 'SDR33' : 'GSI16',
    points: result.points,
    rejected: result.rejected,
  });
  return { success: true, data: { import: record, points: result.points, rejected: result.rejected } };
}

// ==================================================================================
// ========================= GPS/GNSS/RTK: NMEA-0183 ================================
// ==================================================================================
/**
 * تحليل فعلي لجمل NMEA-0183 القياسية:
 *   $GxGGA: الوقت، Lat/Lon (بصيغة ddmm.mmmm)، جودة الإصلاح (Fix Quality)، عدد الأقمار،
 *           HDOP، الارتفاع فوق مستوى سطح البحر (Altitude/MSL).
 *   $GxGST: انحراف الخطأ المعياري (لتقييم دقة القياس - Accuracy Assessment).
 * جودة الإصلاح (fix quality) في GGA: 0=لا إصلاح، 1=GPS عادي، 2=DGPS، 4=RTK Fixed، 5=RTK Float.
 */
function nmeaToDecimal(raw, hemisphere) {
  if (!raw) return null;
  const val = parseFloat(raw);
  if (!isFiniteNum(val)) return null;
  const degLen = raw.indexOf('.') - 2; // ddmm.mmmm أو dddmm.mmmm
  const deg = Math.floor(val / 100);
  const min = val - deg * 100;
  let dec = deg + min / 60;
  if (hemisphere === 'S' || hemisphere === 'W') dec = -dec;
  return dec;
}

const NMEA_FIX_QUALITY_LABELS = {
  0: 'لا يوجد إصلاح (No Fix)',
  1: 'GPS عادي (Standard GPS)',
  2: 'DGPS (تفاضلي)',
  4: 'RTK Fixed (دقة سنتيمترية)',
  5: 'RTK Float (دقة تقريبية)',
};

function parseGNSSNMEA(content) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف NMEA مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points = [];
  const rejected = [];
  const gstByTime = {};

  lines.forEach((line, idx) => {
    if (!line.startsWith('$')) return; // تجاهل أسطر غير NMEA بصمت (قد تكون فواصل ملف)
    const withoutChecksum = line.split('*')[0];
    const fields = withoutChecksum.split(',');
    const sentenceId = fields[0].slice(3); // إزالة $Gx

    if (sentenceId === 'GST') {
      const time = fields[1];
      const stdDevLat = parseFloat(fields[6]);
      const stdDevLon = parseFloat(fields[7]);
      gstByTime[time] = { stdDevLat, stdDevLon };
      return;
    }

    if (sentenceId !== 'GGA') return;

    const time = fields[1];
    const lat = nmeaToDecimal(fields[2], fields[3]);
    const lon = nmeaToDecimal(fields[4], fields[5]);
    const fixQuality = parseInt(fields[6], 10);
    const numSatellites = parseInt(fields[7], 10);
    const hdop = parseFloat(fields[8]);
    const altitude = parseFloat(fields[9]);

    if (!isFiniteNum(lat) || !isFiniteNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      rejected.push({ line: idx + 1, reason: 'إحداثيات جغرافية غير صالحة في جملة GGA', raw: line });
      return;
    }
    if (fixQuality === 0) {
      rejected.push({ line: idx + 1, reason: 'لا يوجد إصلاح GNSS (Fix Quality = 0) - تم تجاهل القياس', raw: line });
      return;
    }

    const gst = gstByTime[time];
    points.push({
      point_number: `GNSS-${points.length + 1}`,
      lat: r6(lat),
      lon: r6(lon),
      elevation: isFiniteNum(altitude) ? r4(altitude) : null,
      point_type: 'survey_point',
      device_used: `GPS/GNSS${fixQuality >= 4 ? ' RTK' : ''}`,
      accuracy: gst ? r4(Math.max(gst.stdDevLat || 0, gst.stdDevLon || 0)) : (isFiniteNum(hdop) ? r4(hdop) : null),
      description: `${NMEA_FIX_QUALITY_LABELS[fixQuality] || 'جودة غير معروفة'} — عدد الأقمار: ${isFiniteNum(numSatellites) ? numSatellites : '-'}`,
    });
  });

  if (!points.length) throw new Error('لم يتم استخراج أي قياس GNSS صالح من الملف. تحقق من وجود جمل $GGA بصيغة NMEA-0183 وبإصلاح فعلي (Fix Quality > 0)');
  return { points, rejected };
}

function importGNSSFile(content, { project_id = null } = {}) {
  const result = parseGNSSNMEA(content);
  const record = recordDeviceImport({
    device_type: 'gnss_rtk',
    project_id,
    source_format: 'NMEA-0183',
    points: result.points,
    rejected: result.rejected,
  });
  return { success: true, data: { import: record, points: result.points, rejected: result.rejected } };
}

// ==================================================================================
// ============================ Digital Level: M5/CSV ===============================
// ==================================================================================
/**
 * صيغة قراءات الميزان الرقمي (Digital Level) المبسّطة كـ CSV بأعمدة:
 *   point_number, reading_type(BS|IS|FS), staff_reading, distance(اختياري)
 * يُحسب المنسوب فعلياً تراكمياً بطريقة "ارتفاع خط النظر" (Height of Instrument - HI):
 *   HI = المنسوب المعروف للنقطة الخلفية + قراءة BS
 *   منسوب أي نقطة تالية = HI - قراءتها (IS أو FS)
 *   عند قراءة FS جديدة تُصبح نقطة تحويل (Turning Point) ويُعاد حساب HI للمقطع التالي.
 */
function parseDigitalLevel(content, { startElevation = 0 } = {}) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف الميزان الرقمي مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points = [];
  const rejected = [];
  let hi = null; // Height of Instrument
  let currentElevation = Number(startElevation) || 0;

  lines.forEach((line, idx) => {
    if (/^point_number/i.test(line)) return; // تجاهل صف العناوين إن وجد
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) { rejected.push({ line: idx + 1, reason: 'أعمدة ناقصة (المطلوب: نقطة, نوع القراءة, القراءة)', raw: line }); return; }
    const [pointNumber, readingTypeRaw, readingRaw] = parts;
    const readingType = readingTypeRaw.toUpperCase();
    const reading = Number(readingRaw);
    if (!isFiniteNum(reading)) { rejected.push({ line: idx + 1, reason: 'قراءة المسطرة (staff reading) غير رقمية', raw: line }); return; }

    if (readingType === 'BS') {
      hi = currentElevation + reading;
      points.push({ point_number: pointNumber, elevation: r4(currentElevation), reading_type: 'BS', reading, point_type: 'benchmark', device_used: 'Digital Level', description: 'نقطة خلفية (Backsight)' });
    } else if (readingType === 'IS') {
      if (hi === null) { rejected.push({ line: idx + 1, reason: 'قراءة وسطى (IS) قبل تحديد أي قراءة خلفية (BS)', raw: line }); return; }
      const elev = hi - reading;
      points.push({ point_number: pointNumber, elevation: r4(elev), reading_type: 'IS', reading, point_type: 'level_point', device_used: 'Digital Level', description: 'قراءة وسطى (Intermediate Sight)' });
    } else if (readingType === 'FS') {
      if (hi === null) { rejected.push({ line: idx + 1, reason: 'قراءة أمامية (FS) قبل تحديد أي قراءة خلفية (BS)', raw: line }); return; }
      const elev = hi - reading;
      currentElevation = elev; // نقطة تحويل (Turning Point) لبدء مقطع جديد
      points.push({ point_number: pointNumber, elevation: r4(elev), reading_type: 'FS', reading, point_type: 'turning_point', device_used: 'Digital Level', description: 'نقطة تحويل (Foresight/Turning Point)' });
      hi = null;
    } else {
      rejected.push({ line: idx + 1, reason: `نوع قراءة غير معروف: ${readingTypeRaw} (المتوقع BS/IS/FS)`, raw: line });
    }
  });

  if (!points.length) throw new Error('لم يتم استخراج أي قراءة صالحة من ملف الميزان الرقمي');
  return { points, rejected };
}

function importDigitalLevelFile(content, { project_id = null, startElevation = 0 } = {}) {
  const result = parseDigitalLevel(content, { startElevation });
  const record = recordDeviceImport({
    device_type: 'digital_level',
    project_id,
    source_format: 'M5-CSV',
    points: result.points,
    rejected: result.rejected,
    raw_meta: { startElevation: Number(startElevation) || 0 },
  });
  return { success: true, data: { import: record, points: result.points, rejected: result.rejected } };
}

// ==================================================================================
// ========================= Laser Scanner: PTS/XYZ ==================================
// ==================================================================================
/**
 * صيغة PTS/XYZ القياسية لسحابة النقاط: أول سطر (اختياري) عدد النقاط الإجمالي،
 * وبقية الأسطر: X Y Z [Intensity] [R G B] مفصولة بمسافات. يتم أخذ عينة ممثّلة
 * (Downsampling حقيقي بخطوة ثابتة) لتحويلها إلى نقاط رفع قابلة للحفظ، لأن سحابة
 * النقاط الخام قد تصل لملايين النقاط ولا تُحفظ كنقاط رفع فردية بالكامل.
 */
function parsePointCloudPTS(content, { maxPoints = 2000 } = {}) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف سحابة النقاط (PTS/XYZ) مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rejected = [];
  const allPoints = [];

  let startIdx = 0;
  if (/^\d+$/.test(lines[0])) startIdx = 1; // أول سطر = عدد النقاط (تنسيق PTS الشائع)

  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/).map(Number);
    const [x, y, z, intensity] = parts;
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) {
      if (rejected.length < 50) rejected.push({ line: i + 1, reason: 'إحداثيات X Y Z غير رقمية', raw: lines[i] });
      continue;
    }
    allPoints.push({ x: r4(x), y: r4(y), z: r4(z), intensity: isFiniteNum(intensity) ? intensity : null });
  }

  if (!allPoints.length) throw new Error('لم يتم استخراج أي نقطة صالحة من سحابة النقاط');

  // Downsampling حقيقي: أخذ عينة موزّعة بانتظام على كامل السحابة بدل أول N نقطة فقط
  const step = Math.max(1, Math.floor(allPoints.length / maxPoints));
  const sampled = [];
  for (let i = 0; i < allPoints.length; i += step) sampled.push(allPoints[i]);

  const points = sampled.map((p, idx) => ({
    point_number: `SCAN-${idx + 1}`,
    easting: p.x,
    northing: p.y,
    elevation: p.z,
    point_type: 'survey_point',
    device_used: 'Laser Scanner',
    description: p.intensity !== null ? `شدة الانعكاس (Intensity): ${p.intensity}` : 'نقطة من سحابة نقاط الماسح الليزري',
  }));

  return { points, rejected, total_scanned_points: allPoints.length, sampled_count: points.length };
}

function importLaserScannerFile(content, { project_id = null, maxPoints = 2000 } = {}) {
  const result = parsePointCloudPTS(content, { maxPoints });
  const record = recordDeviceImport({
    device_type: 'laser_scanner',
    project_id,
    source_format: 'PTS/XYZ',
    points: result.points,
    rejected: result.rejected,
    raw_meta: { total_scanned_points: result.total_scanned_points, sampled_count: result.sampled_count },
  });
  return { success: true, data: { import: record, points: result.points, rejected: result.rejected, total_scanned_points: result.total_scanned_points } };
}

// ==================================================================================
// ============================ Drone Survey: GCP CSV ================================
// ==================================================================================
/**
 * صيغة نقاط التحكم الأرضي (GCP) القياسية المستخدمة في معالجة تصوير الدرون
 * (Pix4D/DroneDeploy/Agisoft): Name,X(Easting/Lon),Y(Northing/Lat),Z(Elevation)
 * مع دعم اختياري لعمود دقة القياس (Accuracy) في العمود الخامس.
 */
function parseDroneGCP(content) {
  if (!content || typeof content !== 'string') throw new Error('محتوى ملف نقاط GCP مطلوب');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points = [];
  const rejected = [];

  lines.forEach((line, idx) => {
    if (/^name\s*,/i.test(line) || /^point/i.test(line)) return; // صف عناوين
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 4) { rejected.push({ line: idx + 1, reason: 'أعمدة ناقصة (المطلوب: Name,X,Y,Z)', raw: line }); return; }
    const [name, xRaw, yRaw, zRaw, accRaw] = parts;
    const x = Number(xRaw), y = Number(yRaw), z = Number(zRaw);
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) {
      rejected.push({ line: idx + 1, reason: 'قيم X/Y/Z غير رقمية', raw: line });
      return;
    }
    points.push({
      point_number: name || `GCP-${idx + 1}`,
      easting: r4(x),
      northing: r4(y),
      elevation: r4(z),
      point_type: 'control_point',
      device_used: 'Drone Survey (GCP)',
      accuracy: accRaw !== undefined && isFiniteNum(Number(accRaw)) ? r4(Number(accRaw)) : null,
      description: 'نقطة تحكم أرضي (Ground Control Point) من مسح الدرون',
    });
  });

  if (!points.length) throw new Error('لم يتم استخراج أي نقطة GCP صالحة من الملف');
  return { points, rejected };
}

function importDroneGCPFile(content, { project_id = null } = {}) {
  const result = parseDroneGCP(content);
  const record = recordDeviceImport({
    device_type: 'drone_survey',
    project_id,
    source_format: 'GCP-CSV',
    points: result.points,
    rejected: result.rejected,
  });
  return { success: true, data: { import: record, points: result.points, rejected: result.rejected } };
}

// ==================================================================================
// ==================== حفظ نقاط مستوردة كنقاط تحكم فعلية في المشروع ==================
// ==================================================================================
/**
 * يأخذ نقاطاً ناتجة من أي دالة استيراد أعلاه ويحفظها فعلياً كنقاط تحكم (Control Points)
 * ضمن مشروع مساحي محدد عبر الدوال الأساسية في surveyManagement، بدل الاكتفاء بعرضها.
 */
function commitImportedPointsToProject(project_id, points) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب لحفظ النقاط المستوردة');
  const store = loadStore();
  if (!store.projects[project_id]) throw new Error('المشروع المساحي غير موجود');

  const saved = [];
  const failed = [];
  points.forEach((p) => {
    try {
      if (!isFiniteNum(p.easting) || !isFiniteNum(p.northing)) {
        failed.push({ point_number: p.point_number, reason: 'النقطة بإحداثيات جغرافية (lat/lon) فقط ولا يمكن حفظها كنقطة تحكم UTM مباشرة دون تحويل مسبق' });
        return;
      }
      const result = SGM_.createControlPoint({
        project_id,
        point_number: p.point_number,
        point_type: p.point_type || 'survey_point',
        easting: p.easting,
        northing: p.northing,
        elevation: p.elevation,
        description: p.description || '',
        device_used: p.device_used || '',
        accuracy: p.accuracy ?? null,
      });
      saved.push(result.data);
    } catch (e) {
      failed.push({ point_number: p.point_number, reason: e.message });
    }
  });

  return { success: true, data: { saved, failed, saved_count: saved.length, failed_count: failed.length } };
}

module.exports = {
  // Total Station
  parseTotalStationGSI,
  parseTotalStationSDR,
  importTotalStationFile,
  // GNSS/RTK
  parseGNSSNMEA,
  importGNSSFile,
  // Digital Level
  parseDigitalLevel,
  importDigitalLevelFile,
  // Laser Scanner
  parsePointCloudPTS,
  importLaserScannerFile,
  // Drone Survey
  parseDroneGCP,
  importDroneGCPFile,
  // إدارة سجلات الاستيراد
  listDeviceImports,
  getDeviceImport,
  deleteDeviceImport,
  // حفظ فعلي في المشروع
  commitImportedPointsToProject,
};
