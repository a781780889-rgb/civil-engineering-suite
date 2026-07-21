/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * الجزء الأول (1/6): البنية الأساسية + لوحة التحكم + إدارة المشاريع المساحية +
 *                     إدارة أنظمة الإحداثيات (تعريف/تحقق/تحويل UTM ↔ جغرافي). [هذا الملف]
 * الجزء الثاني (2/6): نقاط الرفع المساحي + حسابات المساحة الأساسية.
 * الجزء الثالث (3/6): الرفع المساحي المتخصص + التوقيع المساحي.
 * الجزء الرابع (4/6): التكامل مع أجهزة المساحة + إدارة الملفات (استيراد/تصدير).
 * الجزء الخامس (5/6): الخرائط والرسومات + تحليل البيانات + الأعمال الميدانية (Offline).
 * الجزء السادس (6/6): التقارير + الذكاء الاصطناعي + التكامل + الصلاحيات والأمان.
 *
 * التخزين: ملف JSON على القرص (backend/data/survey.json)، بنفس نمط
 * qmsManagement.js / projectManagement.js / equipmentManagement.js - بدون تبعيات خارجية.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - تحويل الإحداثيات بين نظام UTM (WGS84) والإحداثيات الجغرافية (Lat/Lon) يعتمد
 *    على معادلات Transverse Mercator الفعلية (صيغة Karney/Snyder المبسّطة المعتمدة
 *    هندسياً)، وليس أرقاماً وهمية.
 *  - التحقق من صحة الإحداثيات يتحقق فعلياً من نطاقات Easting/Northing/خط الطول
 *    المرجعي لكل منطقة UTM Zone، ومن صحة نطاق خطوط الطول والعرض الجغرافية.
 *  - لوحة التحكم تحسب المؤشرات فعلياً من البيانات المخزَّنة (لا أرقام وهمية).
 *  - سجل تدقيق (Audit Log) فعلي لكل عملية إنشاء/تعديل/حذف/تحويل.
 *  - صلاحيات حسب الدور (RBAC) مطابقة لأدوار قسم المساحة المطلوبة في المواصفة.
 */

const fs = require('fs');
const path = require('path');
const SEC = require('./businessSecurity');
const { generateCsv } = require('./csvWriter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'survey.json');

// ===================== أدوات مساعدة عامة =====================
function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function r4(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 10000) / 10000; }
function r6(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 1000000) / 1000000; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      projects: {},          // { id: surveyProjectRecord }
      coordinateSystems: {}, // { id: coordinateSystemRecord } (أنظمة الإحداثيات المُعرَّفة لكل مشروع)
      auditLog: [],          // سجل تدقيق عمليات القسم بالكامل (لجميع الأجزاء اللاحقة أيضاً)
      // النطاقات أدناه محجوزة للأجزاء القادمة من نفس ملف التخزين الموحّد للقسم:
      controlPoints: {},     // الجزء 2: نقاط الرفع/التحكم/المرجعية
      surveyCalcs: {},        // الجزء 2: سجل الحسابات المنفذة
      surveys: {},            // الجزء 3: أعمال الرفع المتخصصة
      stakeouts: {},           // الجزء 3: أعمال التوقيع
      deviceImports: {},       // الجزء 4: استيراد بيانات الأجهزة
      fileImportsExports: {},  // الجزء 4: سجل استيراد/تصدير الملفات
      maps: {},                // الجزء 5: الخرائط المُنشأة
      fieldTasks: {},          // الجزء 5: الأعمال الميدانية
      reports: {},             // الجزء 6: التقارير المُصدَرة
      meta: { last_project_seq: 0 },
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  return null;
}

function loadStore() {
  ensureStore();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const store = JSON.parse(raw);
  // ضمان توافق الإصدارات القديمة مع الحقول المضافة لاحقاً
  for (const key of ['projects', 'coordinateSystems', 'controlPoints', 'surveyCalcs', 'surveys',
    'stakeouts', 'deviceImports', 'fileImportsExports', 'maps', 'fieldTasks', 'reports']) {
    if (!store[key]) store[key] = {};
  }
  if (!store.auditLog) store.auditLog = [];
  if (!store.meta) store.meta = { last_project_seq: 0 };
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
  // إبقاء آخر 5000 سجل فقط لتفادي تضخم الملف بلا حدود
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

// ==================================================================================
// ========================= إدارة أنظمة الإحداثيات (Datum/UTM) =====================
// ==================================================================================

// ثوابت WGS84 الجيوديسية الرسمية
const WGS84 = {
  a: 6378137.0,            // نصف المحور الرئيسي الاستوائي (متر)
  f: 1 / 298.257223563,    // الاستدارة (Flattening)
};
WGS84.b = WGS84.a * (1 - WGS84.f);
WGS84.e2 = (WGS84.a * WGS84.a - WGS84.b * WGS84.b) / (WGS84.a * WGS84.a); // مربع الاختلاف المركزي الأول
WGS84.ep2 = (WGS84.a * WGS84.a - WGS84.b * WGS84.b) / (WGS84.b * WGS84.b); // الاختلاف المركزي الثاني

const K0 = 0.9996; // عامل القياس المعياري لإسقاط UTM

const SUPPORTED_SYSTEMS = ['UTM', 'GEOGRAPHIC', 'LOCAL'];
const SUPPORTED_DATUMS = ['WGS84', 'LOCAL'];

function deg2rad(d) { return (d * Math.PI) / 180; }
function rad2deg(r) { return (r * 180) / Math.PI; }

/** حساب رقم منطقة UTM من خط الطول الجغرافي */
function utmZoneFromLongitude(lonDeg) {
  return Math.floor((lonDeg + 180) / 6) + 1;
}

/** خط الطول المرجعي المركزي لمنطقة UTM معيّنة */
function centralMeridianForZone(zone) {
  return zone * 6 - 183;
}

/**
 * تحويل من إحداثيات جغرافية (Lat/Lon، درجات عشرية، WGS84) إلى UTM.
 * يعتمد صيغة Transverse Mercator المعتمدة (Snyder 1987 / موافقة لمعادلات Karney المبسّطة)
 * بدقة تكفي للأعمال المساحية الهندسية العملية (خطأ أقل من مليمترات ضمن نفس المنطقة).
 */
function geographicToUTM({ lat, lon, zone = null } = {}) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('يجب إدخال قيمتي خط العرض (lat) وخط الطول (lon) كأرقام صحيحة');
  }
  if (lat < -80 || lat > 84) throw new Error('نظام UTM لا يغطي خطوط عرض خارج النطاق -80° إلى 84°');
  if (lon < -180 || lon > 180) throw new Error('خط الطول يجب أن يكون ضمن النطاق -180° إلى 180°');

  const z = zone || utmZoneFromLongitude(lon);
  const lon0 = deg2rad(centralMeridianForZone(z));
  const latRad = deg2rad(lat);
  const lonRad = deg2rad(lon);

  const { a, e2, ep2 } = WGS84;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ep2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lon0);

  const M = a * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * latRad
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad)
    + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad)
  );

  let easting = K0 * N * (
    A + ((1 - T + C) * A ** 3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120
  ) + 500000.0;

  let northing = K0 * (
    M + N * Math.tan(latRad) * (
      (A * A) / 2
      + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
      + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720
    )
  );

  if (lat < 0) northing += 10000000.0; // إزاحة نصف الكرة الجنوبي

  return {
    easting: r4(easting),
    northing: r4(northing),
    zone: z,
    hemisphere: lat < 0 ? 'S' : 'N',
    central_meridian: r6(rad2deg(lon0)),
  };
}

/**
 * تحويل من UTM إلى إحداثيات جغرافية (Lat/Lon، WGS84) - المعادلة العكسية الكاملة.
 */
function utmToGeographic({ easting, northing, zone, hemisphere = 'N' } = {}) {
  if (typeof easting !== 'number' || typeof northing !== 'number') {
    throw new Error('يجب إدخال قيمتي Easting و Northing كأرقام');
  }
  if (!zone || zone < 1 || zone > 60) throw new Error('رقم منطقة UTM (zone) غير صحيح، يجب أن يكون بين 1 و60');
  if (easting < 100000 || easting > 900000) throw new Error('قيمة Easting خارج النطاق المعتمد لمنطقة UTM (100,000 - 900,000 م)');

  const { a, e2, ep2 } = WGS84;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const x = easting - 500000.0;
  let y = northing;
  if (hemisphere === 'S') y -= 10000000.0;

  const M = y / K0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(phi1) ** 2, 1.5);
  const D = x / (N1 * K0);

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    (D * D) / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720
  );

  const lon0 = deg2rad(centralMeridianForZone(zone));
  const lon = lon0 + (
    D
    - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120
  ) / Math.cos(phi1);

  return { lat: r6(rad2deg(lat)), lon: r6(rad2deg(lon)) };
}

/** التحقق من صحة إحداثيات جغرافية */
function validateGeographic({ lat, lon }) {
  const errors = [];
  if (typeof lat !== 'number' || lat < -90 || lat > 90) errors.push('خط العرض يجب أن يكون بين -90 و90 درجة');
  if (typeof lon !== 'number' || lon < -180 || lon > 180) errors.push('خط الطول يجب أن يكون بين -180 و180 درجة');
  return { valid: errors.length === 0, errors };
}

/** التحقق من صحة إحداثيات UTM بناءً على نطاقات المنطقة الفعلية */
function validateUTM({ easting, northing, zone, hemisphere = 'N' }) {
  const errors = [];
  if (!zone || zone < 1 || zone > 60) errors.push('رقم منطقة UTM يجب أن يكون بين 1 و60');
  if (typeof easting !== 'number' || easting < 100000 || easting > 900000) {
    errors.push('قيمة Easting خارج النطاق المعتمد (100,000 - 900,000 متر) لمنطقة UTM');
  }
  if (typeof northing !== 'number' || northing < 0 || northing > 10000000) {
    errors.push('قيمة Northing خارج النطاق المعتمد (0 - 10,000,000 متر)');
  }
  if (!['N', 'S'].includes(hemisphere)) errors.push("نصف الكرة يجب أن يكون 'N' أو 'S'");
  return { valid: errors.length === 0, errors };
}

/** تحويل عام بين الأنظمة المدعومة (يُستخدم من واجهة تحويل الإحداثيات) */
function convertCoordinates({ from, to, input }) {
  if (!SUPPORTED_SYSTEMS.includes(from) || !SUPPORTED_SYSTEMS.includes(to)) {
    throw new Error(`نظام إحداثيات غير مدعوم. الأنظمة المدعومة: ${SUPPORTED_SYSTEMS.join(', ')}`);
  }
  if (from === to) return { ...input };

  if (from === 'GEOGRAPHIC' && to === 'UTM') {
    const v = validateGeographic(input);
    if (!v.valid) throw new Error(v.errors.join(' / '));
    return geographicToUTM(input);
  }
  if (from === 'UTM' && to === 'GEOGRAPHIC') {
    const v = validateUTM(input);
    if (!v.valid) throw new Error(v.errors.join(' / '));
    return utmToGeographic(input);
  }
  throw new Error(`مسار التحويل من ${from} إلى ${to} غير مدعوم بعد ضمن الجزء الحالي من قسم المساحة`);
}

// ==================================================================================
// ============================= إدارة أنظمة إحداثيات المشروع =======================
// ==================================================================================

function createCoordinateSystem(body) {
  const store = loadStore();
  const { project_id, system_type, datum = 'WGS84', zone = null, hemisphere = 'N', projection = '', name } = body || {};

  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  if (!store.projects[project_id]) throw new Error('المشروع المساحي غير موجود');
  if (!SUPPORTED_SYSTEMS.includes(system_type)) {
    throw new Error(`نوع نظام الإحداثيات غير مدعوم. الأنواع المدعومة: ${SUPPORTED_SYSTEMS.join(', ')}`);
  }
  if (!SUPPORTED_DATUMS.includes(datum)) {
    throw new Error(`الـ Datum غير مدعوم. المدعوم حالياً: ${SUPPORTED_DATUMS.join(', ')}`);
  }
  if (system_type === 'UTM' && zone !== null && (zone < 1 || zone > 60)) {
    throw new Error('رقم منطقة UTM يجب أن يكون بين 1 و60');
  }

  const id = newId('CRS');
  const record = {
    id,
    project_id,
    name: name || `نظام إحداثيات ${system_type}`,
    system_type,
    datum,
    zone: system_type === 'UTM' ? (zone || null) : null,
    hemisphere: system_type === 'UTM' ? hemisphere : null,
    projection: projection || (system_type === 'UTM' ? 'Transverse Mercator' : ''),
    is_default: false,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  // إذا كان أول نظام إحداثيات للمشروع، اجعله الافتراضي تلقائياً
  const existingForProject = Object.values(store.coordinateSystems).filter((c) => c.project_id === project_id);
  if (existingForProject.length === 0) record.is_default = true;

  store.coordinateSystems[id] = record;
  audit(store, { action: 'create', entity: 'coordinate_system', entityId: id, projectId: project_id, details: { system_type, datum } });
  saveStore(store);
  return { success: true, data: record };
}

function listCoordinateSystems({ project_id } = {}) {
  const store = loadStore();
  let items = Object.values(store.coordinateSystems);
  if (project_id) items = items.filter((c) => c.project_id === project_id);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data: items };
}

function setDefaultCoordinateSystem({ id }) {
  const store = loadStore();
  const rec = store.coordinateSystems[id];
  if (!rec) throw new Error('نظام الإحداثيات غير موجود');
  Object.values(store.coordinateSystems)
    .filter((c) => c.project_id === rec.project_id)
    .forEach((c) => { c.is_default = c.id === id; });
  audit(store, { action: 'set_default', entity: 'coordinate_system', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: rec };
}

function deleteCoordinateSystem({ id }) {
  const store = loadStore();
  const rec = store.coordinateSystems[id];
  if (!rec) throw new Error('نظام الإحداثيات غير موجود');
  delete store.coordinateSystems[id];
  audit(store, { action: 'delete', entity: 'coordinate_system', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

// ==================================================================================
// ============================= إدارة المشاريع المساحية ============================
// ==================================================================================

const PROJECT_TYPES = ['land_survey', 'road_survey', 'building_survey', 'bridge_survey',
  'tunnel_survey', 'network_survey', 'topographic', 'boundary', 'construction_layout', 'other'];
const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];

function validateProjectInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) errors.push('اسم المشروع مطلوب');
  }
  if (body.project_type !== undefined && body.project_type !== null && body.project_type !== '' && !PROJECT_TYPES.includes(body.project_type)) {
    errors.push(`نوع المشروع غير صحيح. الأنواع المدعومة: ${PROJECT_TYPES.join(', ')}`);
  }
  if (body.status !== undefined && body.status !== null && body.status !== '' && !PROJECT_STATUSES.includes(body.status)) {
    errors.push(`حالة المشروع غير صحيحة. الحالات المدعومة: ${PROJECT_STATUSES.join(', ')}`);
  }
  if (body.start_date && body.end_date && new Date(body.end_date) < new Date(body.start_date)) {
    errors.push('تاريخ النهاية لا يمكن أن يسبق تاريخ البداية');
  }
  if (body.latitude !== undefined && body.latitude !== null && body.latitude !== '') {
    const v = validateGeographic({ lat: Number(body.latitude), lon: Number(body.longitude || 0) });
    if (!v.valid && body.latitude !== undefined) {
      // فقط تحقق من خط العرض إن أُدخل بمعزل عن خط الطول
      if (Number(body.latitude) < -90 || Number(body.latitude) > 90) errors.push('خط العرض يجب أن يكون بين -90 و90 درجة');
    }
  }
  if (body.longitude !== undefined && body.longitude !== null && body.longitude !== '') {
    if (Number(body.longitude) < -180 || Number(body.longitude) > 180) errors.push('خط الطول يجب أن يكون بين -180 و180 درجة');
  }
  return errors;
}

function createProject(body) {
  const store = loadStore();
  const errors = validateProjectInput(body || {});
  if (errors.length) throw new Error(errors.join(' / '));

  store.meta.last_project_seq = (store.meta.last_project_seq || 0) + 1;
  const seq = store.meta.last_project_seq;
  const id = newId('SRV-PRJ');

  const record = {
    id,
    project_number: `SUR-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
    name: body.name.trim(),
    project_type: body.project_type || 'other',
    location: body.location || '',
    latitude: body.latitude !== undefined && body.latitude !== '' ? Number(body.latitude) : null,
    longitude: body.longitude !== undefined && body.longitude !== '' ? Number(body.longitude) : null,
    city: body.city || '',
    country: body.country || '',
    coordinate_system: body.coordinate_system || 'UTM',
    datum: body.datum || 'WGS84',
    projection: body.projection || 'Transverse Mercator',
    responsible_engineer: body.responsible_engineer || '',
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    status: body.status || 'planning',
    notes: body.notes || '',
    photos: Array.isArray(body.photos) ? body.photos : [],
    documents: Array.isArray(body.documents) ? body.documents : [],
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.projects[id] = record;
  audit(store, { action: 'create', entity: 'project', entityId: id, projectId: id, details: { name: record.name } });
  saveStore(store);

  // إنشاء نظام إحداثيات افتراضي تلقائياً للمشروع الجديد (UTM/WGS84)
  try {
    const zone = record.longitude !== null ? utmZoneFromLongitude(record.longitude) : null;
    createCoordinateSystem({
      project_id: id,
      system_type: 'UTM',
      datum: 'WGS84',
      zone,
      hemisphere: record.latitude !== null && record.latitude < 0 ? 'S' : 'N',
      name: 'نظام الإحداثيات الافتراضي (UTM/WGS84)',
    });
  } catch (e) {
    // لا نمنع إنشاء المشروع إن تعذّر إنشاء نظام الإحداثيات الافتراضي (مثلاً بلا موقع محدد)
  }

  return { success: true, data: getProject(id) };
}

function getProject(id) {
  const store = loadStore();
  const rec = store.projects[id];
  if (!rec) throw new Error('المشروع المساحي غير موجود');
  const coordinateSystems = Object.values(store.coordinateSystems).filter((c) => c.project_id === id);
  const controlPointsCount = Object.values(store.controlPoints).filter((p) => p.project_id === id).length;
  return { ...rec, coordinate_systems: coordinateSystems, control_points_count: controlPointsCount };
}

function listProjects({ status, project_type, q, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  let items = Object.values(store.projects);
  if (status) items = items.filter((p) => p.status === status);
  if (project_type) items = items.filter((p) => p.project_type === project_type);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((p) => p.name.toLowerCase().includes(needle)
      || p.project_number.toLowerCase().includes(needle)
      || (p.location || '').toLowerCase().includes(needle));
  }
  items.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[sortBy] < b[sortBy]) return -1 * dir;
    if (a[sortBy] > b[sortBy]) return 1 * dir;
    return 0;
  });
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function updateProject(id, body) {
  const store = loadStore();
  const rec = store.projects[id];
  if (!rec) throw new Error('المشروع المساحي غير موجود');
  const errors = validateProjectInput(body || {}, { partial: true });
  if (errors.length) throw new Error(errors.join(' / '));

  const updatable = ['name', 'project_type', 'location', 'latitude', 'longitude', 'city', 'country',
    'coordinate_system', 'datum', 'projection', 'responsible_engineer', 'start_date', 'end_date',
    'status', 'notes', 'photos', 'documents'];
  for (const key of updatable) {
    if (body[key] !== undefined) rec[key] = body[key];
  }
  rec.updated_at = nowISO();
  audit(store, { action: 'update', entity: 'project', entityId: id, projectId: id });
  saveStore(store);
  return { success: true, data: getProject(id) };
}

function deleteProject(id) {
  const store = loadStore();
  if (!store.projects[id]) throw new Error('المشروع المساحي غير موجود');
  delete store.projects[id];
  Object.keys(store.coordinateSystems).forEach((k) => {
    if (store.coordinateSystems[k].project_id === id) delete store.coordinateSystems[k];
  });
  audit(store, { action: 'delete', entity: 'project', entityId: id, projectId: id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

// ==================================================================================
// ==================================== لوحة التحكم ==================================
// ==================================================================================

function getDashboard() {
  const store = loadStore();
  const projects = Object.values(store.projects);
  const coordinateSystems = Object.values(store.coordinateSystems);
  const controlPoints = Object.values(store.controlPoints);
  const surveyCalcs = Object.values(store.surveyCalcs);
  const surveyRecords = Object.values(store.surveys);

  const projectsByStatus = PROJECT_STATUSES.reduce((acc, s) => {
    acc[s] = projects.filter((p) => p.status === s).length;
    return acc;
  }, {});

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((p) => ({ id: p.id, project_number: p.project_number, name: p.name, status: p.status, created_at: p.created_at }));

  const recentAudit = store.auditLog.slice(-10).reverse();

  const recentMeasurements = [...controlPoints]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((p) => ({
      id: p.id, point_number: p.point_number, point_type: p.point_type,
      easting: p.easting, northing: p.northing, elevation: p.elevation, created_at: p.created_at,
    }));

  return {
    success: true,
    data: {
      total_projects: projects.length,
      total_control_points: controlPoints.length,
      total_survey_records: surveyRecords.length,        // الجزء 3-أ
      total_stakeout_points: 0,                          // الجزء 3-ب
      total_devices: 0,                                  // الجزء الرابع
      total_maps: Object.keys(store.maps).length,        // الجزء الخامس
      total_survey_files: 0,                             // الجزء الرابع
      total_stakeout_files: 0,                           // الجزء الرابع
      total_calculations_executed: surveyCalcs.length,
      projects_by_status: projectsByStatus,
      survey_records_by_type: SURVEY_TYPES.reduce((acc, t) => {
        acc[t] = surveyRecords.filter((s) => s.survey_type === t).length;
        return acc;
      }, {}),
      total_coordinate_systems: coordinateSystems.length,
      recent_projects: recentProjects,
      recent_measurements: recentMeasurements,
      recent_survey_records: [...surveyRecords]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5)
        .map((s) => ({ id: s.id, survey_number: s.survey_number, title: s.title, survey_type: s.survey_type, status: s.status, created_at: s.created_at })),
      recent_reports: [],       // الجزء السادس
      devices_status: [],       // الجزء الرابع
      recent_activity: recentAudit,
    },
  };
}

// ==================================================================================
// ================================= مرجع النظام (reference-data) ===================
// ==================================================================================

function getReferenceData() {
  return {
    success: true,
    data: {
      project_types: PROJECT_TYPES,
      project_statuses: PROJECT_STATUSES,
      supported_coordinate_systems: SUPPORTED_SYSTEMS,
      supported_datums: SUPPORTED_DATUMS,
      utm_zone_count: 60,
      control_point_types: CONTROL_POINT_TYPES,
      control_point_type_labels_ar: CONTROL_POINT_TYPE_LABELS_AR,
      survey_calc_types: ['distance', 'bearing', 'horizontal_angle', 'slope', 'closed_area', 'traverse_closure'],
      survey_record_types: SURVEY_TYPES,
      survey_record_type_labels_ar: SURVEY_TYPE_LABELS_AR2,
      survey_record_statuses: SURVEY_STATUS_VALUES,
    },
  };
}

// ==================================================================================
// ========================== الأدوار والصلاحيات الخاصة بالمساحة =====================
// ==================================================================================

const SURVEY_ROLE_DEFINITIONS = {
  survey_manager: {
    label: 'مدير المساحة',
    permissions: {
      survey: ['view', 'create', 'update', 'delete', 'manage'],
      dashboard: ['view'], reports: ['view', 'export'], ai: ['use'],
    },
  },
  survey_engineer: {
    label: 'مهندس المساحة',
    permissions: {
      survey: ['view', 'create', 'update'], dashboard: ['view'], reports: ['view', 'export'],
    },
  },
  field_surveyor: {
    label: 'المسّاح الميداني',
    permissions: {
      survey: ['view', 'create', 'field_entry'], dashboard: ['view'],
    },
  },
  supervising_engineer: {
    label: 'المهندس المشرف',
    permissions: {
      survey: ['view', 'update', 'approve'], dashboard: ['view'], reports: ['view'],
    },
  },
  survey_consultant: {
    label: 'الاستشاري (مساحة)',
    permissions: {
      survey: ['view'], reports: ['view', 'export'],
    },
  },
  survey_client_viewer: {
    label: 'العميل (عرض فقط - مساحة)',
    permissions: {
      survey: ['view'], reports: ['view'],
    },
  },
};

function ensureSurveyRolesSeeded() {
  const existingRoles = SEC.listRoles().data.map((r) => r.key);
  for (const [key, def] of Object.entries(SURVEY_ROLE_DEFINITIONS)) {
    if (!existingRoles.includes(key)) {
      SEC.upsertRole(key, def);
    }
  }
  return { success: true, data: { seeded_roles: Object.keys(SURVEY_ROLE_DEFINITIONS) } };
}

// ==================================================================================
// ================================= تصدير البيانات (CSV) ===========================
// ==================================================================================

const PROJECT_TYPE_LABELS_AR = {
  land_survey: 'رفع أراضي', road_survey: 'رفع طرق', building_survey: 'رفع مباني',
  bridge_survey: 'رفع جسور', tunnel_survey: 'رفع أنفاق', network_survey: 'رفع شبكات',
  topographic: 'طبوغرافي', boundary: 'حدود', construction_layout: 'توقيع إنشائي', other: 'أخرى',
};
const PROJECT_STATUS_LABELS_AR = {
  planning: 'التخطيط', active: 'جاري التنفيذ', on_hold: 'متوقف', completed: 'مكتمل', cancelled: 'ملغى',
};

/** تصدير قائمة المشاريع المساحية إلى ملف CSV فعلي (متوافق مع Excel، يدعم العربية عبر BOM) */
function exportProjectsToCSV(filters = {}) {
  const { data: projects } = listProjects({ ...filters, pageSize: 100000, page: 1 });
  const headers = ['رقم المشروع', 'الاسم', 'النوع', 'الموقع', 'المدينة', 'الدولة',
    'المهندس المسؤول', 'تاريخ البداية', 'تاريخ النهاية', 'الحالة', 'خط العرض', 'خط الطول'];
  const rows = projects.map((p) => [
    p.project_number, p.name, PROJECT_TYPE_LABELS_AR[p.project_type] || p.project_type,
    p.location || '', p.city || '', p.country || '', p.responsible_engineer || '',
    p.start_date ? p.start_date.slice(0, 10) : '', p.end_date ? p.end_date.slice(0, 10) : '',
    PROJECT_STATUS_LABELS_AR[p.status] || p.status, p.latitude ?? '', p.longitude ?? '',
  ]);
  const buffer = generateCsv(headers, rows);
  const filename = `survey-projects-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);

  const store = loadStore();
  audit(store, { action: 'export_csv', entity: 'project', entityId: null, details: { count: projects.length } });
  saveStore(store);

  return { success: true, data: { url: `/reports/${filename}`, count: projects.length } };
}

/** تصدير أنظمة الإحداثيات الخاصة بمشروع معيّن إلى CSV */
function exportCoordinateSystemsToCSV({ project_id }) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  const { data: items } = listCoordinateSystems({ project_id });
  const headers = ['الاسم', 'نوع النظام', 'Datum', 'منطقة UTM', 'نصف الكرة', 'Projection', 'افتراضي', 'تاريخ الإنشاء'];
  const rows = items.map((c) => [
    c.name, c.system_type, c.datum, c.zone ?? '', c.hemisphere ?? '', c.projection || '',
    c.is_default ? 'نعم' : 'لا', c.created_at.slice(0, 10),
  ]);
  const buffer = generateCsv(headers, rows);
  const filename = `survey-crs-${project_id}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);

  const store = loadStore();
  audit(store, { action: 'export_csv', entity: 'coordinate_system', entityId: null, projectId: project_id, details: { count: items.length } });
  saveStore(store);

  return { success: true, data: { url: `/reports/${filename}`, count: items.length } };
}

// ==================================================================================
// ==================== الجزء الثاني (2/6): نقاط الرفع المساحي ======================
// ==================================================================================

const CONTROL_POINT_TYPES = [
  'survey_point', 'benchmark', 'control_point', 'network_point', 'boundary_point', 'elevation_point',
];

const CONTROL_POINT_TYPE_LABELS_AR = {
  survey_point: 'نقطة رفع', benchmark: 'نقطة مرجعية (Benchmark)', control_point: 'نقطة تحكم',
  network_point: 'نقطة شبكة', boundary_point: 'نقطة حدود', elevation_point: 'نقطة مناسيب',
};

function validateControlPointInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.project_id !== undefined) {
    if (!body.project_id) errors.push('معرّف المشروع (project_id) مطلوب');
  }
  if (!partial || body.point_type !== undefined) {
    if (!body.point_type || !CONTROL_POINT_TYPES.includes(body.point_type)) {
      errors.push(`نوع النقطة غير صحيح. الأنواع المدعومة: ${CONTROL_POINT_TYPES.join(', ')}`);
    }
  }
  if (!partial || body.easting !== undefined) {
    if (body.easting === undefined || body.easting === null || body.easting === '' || Number.isNaN(Number(body.easting))) {
      errors.push('قيمة Easting مطلوبة ويجب أن تكون رقماً');
    }
  }
  if (!partial || body.northing !== undefined) {
    if (body.northing === undefined || body.northing === null || body.northing === '' || Number.isNaN(Number(body.northing))) {
      errors.push('قيمة Northing مطلوبة ويجب أن تكون رقماً');
    }
  }
  if (body.elevation !== undefined && body.elevation !== null && body.elevation !== '' && Number.isNaN(Number(body.elevation))) {
    errors.push('قيمة المنسوب (elevation) يجب أن تكون رقماً');
  }
  if (body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '' && Number(body.accuracy) < 0) {
    errors.push('دقة القياس (accuracy) لا يمكن أن تكون سالبة');
  }
  return errors;
}

function createControlPoint(body) {
  const store = loadStore();
  const errors = validateControlPointInput(body || {});
  if (errors.length) throw new Error(errors.join(' / '));
  if (!store.projects[body.project_id]) throw new Error('المشروع المساحي غير موجود');

  const existingForProject = Object.values(store.controlPoints).filter((p) => p.project_id === body.project_id);
  const seq = existingForProject.length + 1;

  const id = newId('CP');
  const record = {
    id,
    project_id: body.project_id,
    point_number: body.point_number && String(body.point_number).trim()
      ? String(body.point_number).trim()
      : `CP-${String(seq).padStart(4, '0')}`,
    name: body.name || '',
    point_type: body.point_type,
    easting: r4(Number(body.easting)),
    northing: r4(Number(body.northing)),
    elevation: body.elevation !== undefined && body.elevation !== null && body.elevation !== '' ? r4(Number(body.elevation)) : null,
    description: body.description || '',
    measurement_date: body.measurement_date || nowISO(),
    device_used: body.device_used || '',
    accuracy: body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '' ? r4(Number(body.accuracy)) : null,
    photos: Array.isArray(body.photos) ? body.photos : [],
    notes: body.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const dup = existingForProject.find((p) => p.point_number === record.point_number);
  if (dup) throw new Error(`رقم النقطة "${record.point_number}" مستخدم مسبقاً في هذا المشروع`);

  store.controlPoints[id] = record;
  audit(store, {
    action: 'create', entity: 'control_point', entityId: id, projectId: body.project_id,
    details: { point_number: record.point_number, point_type: record.point_type },
  });
  saveStore(store);
  return { success: true, data: record };
}

function getControlPoint(id) {
  const store = loadStore();
  const rec = store.controlPoints[id];
  if (!rec) throw new Error('نقطة الرفع غير موجودة');
  return rec;
}

function listControlPoints({ project_id, point_type, q, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 100 } = {}) {
  const store = loadStore();
  let items = Object.values(store.controlPoints);
  if (project_id) items = items.filter((p) => p.project_id === project_id);
  if (point_type) items = items.filter((p) => p.point_type === point_type);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((p) => p.point_number.toLowerCase().includes(needle)
      || (p.name || '').toLowerCase().includes(needle)
      || (p.description || '').toLowerCase().includes(needle));
  }
  items.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[sortBy] < b[sortBy]) return -1 * dir;
    if (a[sortBy] > b[sortBy]) return 1 * dir;
    return 0;
  });
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function updateControlPoint(id, body) {
  const store = loadStore();
  const rec = store.controlPoints[id];
  if (!rec) throw new Error('نقطة الرفع غير موجودة');
  const errors = validateControlPointInput(body || {}, { partial: true });
  if (errors.length) throw new Error(errors.join(' / '));

  if (body.point_number !== undefined) {
    const newNumber = String(body.point_number).trim();
    if (newNumber && newNumber !== rec.point_number) {
      const dup = Object.values(store.controlPoints)
        .find((p) => p.project_id === rec.project_id && p.point_number === newNumber && p.id !== id);
      if (dup) throw new Error(`رقم النقطة "${newNumber}" مستخدم مسبقاً في هذا المشروع`);
      rec.point_number = newNumber;
    }
  }
  const updatable = ['name', 'point_type', 'easting', 'northing', 'elevation', 'description',
    'measurement_date', 'device_used', 'accuracy', 'photos', 'notes'];
  for (const key of updatable) {
    if (body[key] !== undefined) {
      rec[key] = ['easting', 'northing', 'elevation', 'accuracy'].includes(key) && body[key] !== null && body[key] !== ''
        ? r4(Number(body[key]))
        : body[key];
    }
  }
  rec.updated_at = nowISO();
  audit(store, { action: 'update', entity: 'control_point', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: rec };
}

function deleteControlPoint(id) {
  const store = loadStore();
  const rec = store.controlPoints[id];
  if (!rec) throw new Error('نقطة الرفع غير موجودة');
  delete store.controlPoints[id];
  audit(store, { action: 'delete', entity: 'control_point', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

function exportControlPointsToCSV({ project_id, point_type } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  const { data: items } = listControlPoints({ project_id, point_type, pageSize: 100000, page: 1 });
  const headers = ['رقم النقطة', 'الاسم', 'النوع', 'Easting', 'Northing', 'المنسوب',
    'الوصف', 'تاريخ القياس', 'الجهاز المستخدم', 'دقة القياس'];
  const rows = items.map((p) => [
    p.point_number, p.name || '', CONTROL_POINT_TYPE_LABELS_AR[p.point_type] || p.point_type,
    p.easting, p.northing, p.elevation ?? '', p.description || '',
    p.measurement_date ? String(p.measurement_date).slice(0, 10) : '', p.device_used || '', p.accuracy ?? '',
  ]);
  const buffer = generateCsv(headers, rows);
  const filename = `survey-points-${project_id}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);

  const store = loadStore();
  audit(store, { action: 'export_csv', entity: 'control_point', entityId: null, projectId: project_id, details: { count: items.length } });
  saveStore(store);

  return { success: true, data: { url: `/reports/${filename}`, count: items.length } };
}

// ==================================================================================
// ============ الجزء الثاني (2/6): حسابات المساحة الأساسية (Survey Calculations) ====
// ==================================================================================
// جميع الصيغ أدناه معادلات مساحية/مثلثية قياسية معتمدة هندسياً وليست تقريبية:
//  - المسافة الأفقية بين نقطتين: نظرية فيثاغورس على مستوى الإسقاط (Easting/Northing)
//  - الاتجاه (Bearing/Azimuth): atan2(ΔE, ΔN) محوّلاً إلى Quadrant Bearing القياسي
//  - الميل: نسبة فرق المنسوب إلى المسافة الأفقية (وكذلك بالنسبة المئوية والزاوية)
//  - المساحة المغلقة: صيغة Shoelace (Gauss's Area Formula) على إحداثيات المضلع الفعلية
//  - خطأ الإغلاق وتصحيحه: طريقة Bowditch/Compass Rule القياسية في أعمال المضلعات المساحية

function calcDistance({ point1, point2 } = {}) {
  if (!point1 || !point2) throw new Error('يجب إدخال إحداثيات النقطتين (point1, point2)');
  const dE = Number(point2.easting) - Number(point1.easting);
  const dN = Number(point2.northing) - Number(point1.northing);
  if (Number.isNaN(dE) || Number.isNaN(dN)) throw new Error('إحداثيات Easting/Northing غير صحيحة');
  const horizontalDistance = Math.sqrt(dE * dE + dN * dN);
  let slopeDistance = horizontalDistance;
  let elevationDifference = null;
  if (point1.elevation !== undefined && point1.elevation !== null && point2.elevation !== undefined && point2.elevation !== null) {
    elevationDifference = Number(point2.elevation) - Number(point1.elevation);
    slopeDistance = Math.sqrt(horizontalDistance ** 2 + elevationDifference ** 2);
  }
  return {
    horizontal_distance: r4(horizontalDistance),
    slope_distance: r4(slopeDistance),
    elevation_difference: elevationDifference !== null ? r4(elevationDifference) : null,
    delta_easting: r4(dE),
    delta_northing: r4(dN),
  };
}

function azimuthToQuadrantBearing(azimuthDeg) {
  let quadrant;
  let angle;
  const a = ((azimuthDeg % 360) + 360) % 360;
  if (a >= 0 && a <= 90) { quadrant = ['N', 'E']; angle = a; }
  else if (a > 90 && a <= 180) { quadrant = ['S', 'E']; angle = 180 - a; }
  else if (a > 180 && a <= 270) { quadrant = ['S', 'W']; angle = a - 180; }
  else { quadrant = ['N', 'W']; angle = 360 - a; }

  const deg = Math.floor(angle);
  const minFloat = (angle - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = r2((minFloat - min) * 60);
  return {
    text: `${quadrant[0]}${deg}°${min}'${sec}"${quadrant[1]}`,
    degrees: deg, minutes: min, seconds: sec, quadrant: quadrant.join(''),
  };
}

function calcBearing({ point1, point2 } = {}) {
  if (!point1 || !point2) throw new Error('يجب إدخال إحداثيات النقطتين (point1, point2)');
  const dE = Number(point2.easting) - Number(point1.easting);
  const dN = Number(point2.northing) - Number(point1.northing);
  if (dE === 0 && dN === 0) throw new Error('النقطتان متطابقتان، لا يمكن حساب اتجاه');
  let azimuthDeg = rad2deg(Math.atan2(dE, dN));
  if (azimuthDeg < 0) azimuthDeg += 360;
  const quadrantBearing = azimuthToQuadrantBearing(azimuthDeg);
  return {
    azimuth_decimal_degrees: r6(azimuthDeg),
    quadrant_bearing: quadrantBearing.text,
    quadrant_bearing_components: quadrantBearing,
  };
}

function calcHorizontalAngle({ backsight, station, foresight } = {}) {
  if (!backsight || !station || !foresight) throw new Error('يجب إدخال إحداثيات النقاط الثلاث (backsight, station, foresight)');
  const bearingToBack = calcBearing({ point1: station, point2: backsight }).azimuth_decimal_degrees;
  const bearingToFore = calcBearing({ point1: station, point2: foresight }).azimuth_decimal_degrees;
  let angle = bearingToFore - bearingToBack;
  angle = ((angle % 360) + 360) % 360;
  return {
    horizontal_angle_degrees: r6(angle),
    bearing_to_backsight: r6(bearingToBack),
    bearing_to_foresight: r6(bearingToFore),
  };
}

function calcSlope({ point1, point2 } = {}) {
  if (!point1 || !point2) throw new Error('يجب إدخال إحداثيات النقطتين (point1, point2)');
  if (point1.elevation === undefined || point1.elevation === null || point2.elevation === undefined || point2.elevation === null) {
    throw new Error('يجب توفر منسوب (elevation) لكل من النقطتين لحساب الميل');
  }
  const { horizontal_distance } = calcDistance({ point1, point2 });
  if (horizontal_distance === 0) throw new Error('المسافة الأفقية بين النقطتين تساوي صفراً، لا يمكن حساب الميل');
  const elevationDifference = Number(point2.elevation) - Number(point1.elevation);
  const slopeRatio = elevationDifference / horizontal_distance;
  const slopePercent = slopeRatio * 100;
  const slopeAngleDeg = rad2deg(Math.atan(slopeRatio));
  return {
    elevation_difference: r4(elevationDifference),
    horizontal_distance: r4(horizontal_distance),
    slope_ratio: r6(slopeRatio),
    slope_percent: r4(slopePercent),
    slope_angle_degrees: r4(slopeAngleDeg),
    direction: elevationDifference > 0 ? 'صاعد' : (elevationDifference < 0 ? 'هابط' : 'مستوٍ'),
  };
}

function calcClosedArea({ points } = {}) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('يجب إدخال 3 نقاط على الأقل لتكوين مضلع مغلق');
  }
  const pts = points.map((p) => ({ easting: Number(p.easting), northing: Number(p.northing) }));
  if (pts.some((p) => Number.isNaN(p.easting) || Number.isNaN(p.northing))) {
    throw new Error('إحداثيات إحدى النقاط غير صحيحة');
  }
  let sum = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    sum += cur.easting * next.northing - next.easting * cur.northing;
    perimeter += Math.sqrt((next.easting - cur.easting) ** 2 + (next.northing - cur.northing) ** 2);
  }
  const area = Math.abs(sum) / 2;
  return {
    area_sqm: r4(area),
    area_hectares: r6(area / 10000),
    area_donum: r6(area / 1000),
    perimeter_m: r4(perimeter),
    points_count: pts.length,
  };
}

function calcTraverseClosure({ startPoint, legs } = {}) {
  if (!startPoint) throw new Error('يجب إدخال نقطة البداية (startPoint)');
  if (!Array.isArray(legs) || legs.length < 3) {
    throw new Error('يجب إدخال 3 أضلاع على الأقل (كل ضلع: مسافة أفقية واتجاه/azimuth بالدرجات)');
  }

  let east = Number(startPoint.easting);
  let north = Number(startPoint.northing);
  if (Number.isNaN(east) || Number.isNaN(north)) throw new Error('إحداثيات نقطة البداية غير صحيحة');

  let totalLength = 0;
  const legVectors = legs.map((leg, idx) => {
    const dist = Number(leg.distance);
    const az = Number(leg.azimuth);
    if (Number.isNaN(dist) || dist <= 0) throw new Error(`الضلع رقم ${idx + 1}: المسافة يجب أن تكون رقماً موجباً`);
    if (Number.isNaN(az)) throw new Error(`الضلع رقم ${idx + 1}: الاتجاه (azimuth) يجب أن يكون رقماً`);
    const azRad = deg2rad(az);
    const dE = dist * Math.sin(azRad);
    const dN = dist * Math.cos(azRad);
    totalLength += dist;
    east += dE; north += dN;
    return { distance: dist, azimuth: az, dE, dN };
  });

  const errorEasting = east - Number(startPoint.easting);
  const errorNorthing = north - Number(startPoint.northing);
  const linearClosureError = Math.sqrt(errorEasting ** 2 + errorNorthing ** 2);
  const precisionDenominator = linearClosureError > 0 ? Math.round(totalLength / linearClosureError) : Infinity;

  let runningEast = Number(startPoint.easting);
  let runningNorth = Number(startPoint.northing);
  const correctedLegs = legVectors.map((leg, idx) => {
    const proportion = leg.distance / totalLength;
    const correctionE = -errorEasting * proportion;
    const correctionN = -errorNorthing * proportion;
    const correctedDE = leg.dE + correctionE;
    const correctedDN = leg.dN + correctionN;
    runningEast += correctedDE;
    runningNorth += correctedDN;
    return {
      leg_number: idx + 1,
      distance: r4(leg.distance),
      azimuth: r6(leg.azimuth),
      raw_delta_easting: r4(leg.dE),
      raw_delta_northing: r4(leg.dN),
      correction_easting: r6(correctionE),
      correction_northing: r6(correctionN),
      corrected_easting: r4(runningEast),
      corrected_northing: r4(runningNorth),
    };
  });

  return {
    total_traverse_length: r4(totalLength),
    computed_end_point: { easting: r4(east), northing: r4(north) },
    closure_error: {
      error_easting: r6(errorEasting),
      error_northing: r6(errorNorthing),
      linear_closure_error: r6(linearClosureError),
      precision_ratio: precisionDenominator === Infinity ? '1/∞ (إغلاق مثالي)' : `1/${precisionDenominator}`,
      accuracy_acceptable: precisionDenominator >= 5000,
    },
    corrected_legs: correctedLegs,
    corrected_end_point: { easting: r4(runningEast), northing: r4(runningNorth) },
  };
}

// ==================================================================================
// ===== الجزء الثالث-أ (3-أ): الرفع المساحي المتخصص (Specialized Survey Records) ====
// ==================================================================================
// يغطي هذا النطاق جميع أنواع الرفع المطلوبة عبر نموذج بيانات موحّد ومرن (survey_type)
// بدل تكرار منطق منفصل لكل نوع، مع حسابات هندسية حقيقية للمقاطع الطولية/العرضية
// وبيانات الكنتور، ومحرك حساب أحجام الحفر/الردم يعتمد على طريقة المتوسط
// (Average End Area Method) المعتمدة هندسياً في أعمال المساحة والطرق.

const SURVEY_TYPES = [
  'land_survey', 'road_survey', 'building_survey', 'bridge_survey', 'tunnel_survey',
  'network_survey', 'utility_survey', 'elevation_survey', 'longitudinal_section',
  'cross_section', 'contour_survey',
];

const SURVEY_TYPE_LABELS_AR2 = {
  land_survey: 'رفع أراضي', road_survey: 'رفع طرق', building_survey: 'رفع مباني',
  bridge_survey: 'رفع جسور', tunnel_survey: 'رفع أنفاق', network_survey: 'رفع شبكات',
  utility_survey: 'رفع خطوط خدمات', elevation_survey: 'رفع مناسيب',
  longitudinal_section: 'مقطع طولي', cross_section: 'مقطع عرضي', contour_survey: 'رفع كنتور',
};

const SURVEY_STATUS_VALUES = ['draft', 'in_progress', 'completed', 'reviewed', 'approved'];

/** حساب حجم الحفر/الردم بين مقطعين عرضيين متتاليين بطريقة متوسط المساحات (Average End Area) */
function calcEndAreaVolume({ area1, area2, distance } = {}) {
  const a1 = Number(area1); const a2 = Number(area2); const d = Number(distance);
  if (Number.isNaN(a1) || Number.isNaN(a2) || Number.isNaN(d) || d <= 0) {
    throw new Error('يجب إدخال مساحتي المقطعين (area1, area2) والمسافة بينهما (distance > 0)');
  }
  return r4(((a1 + a2) / 2) * d);
}

/** حساب مساحة مقطع عرضي من نقاط (Offset, Elevation) بالنسبة لمنسوب تصميم مرجعي */
function calcCrossSectionArea({ points, designElevation } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('يجب إدخال نقطتين على الأقل للمقطع العرضي (offset, elevation)');
  }
  const de = designElevation !== undefined && designElevation !== null ? Number(designElevation) : null;
  const pts = points.map((p) => ({ offset: Number(p.offset), elevation: Number(p.elevation) }));
  if (pts.some((p) => Number.isNaN(p.offset) || Number.isNaN(p.elevation))) {
    throw new Error('قيم offset/elevation لإحدى نقاط المقطع غير صحيحة');
  }
  pts.sort((a, b) => a.offset - b.offset);

  let cutArea = 0; let fillArea = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]; const p2 = pts[i + 1];
    const width = p2.offset - p1.offset;
    if (de !== null) {
      const h1 = p1.elevation - de;
      const h2 = p2.elevation - de;
      const avgH = (h1 + h2) / 2;
      const segArea = Math.abs(avgH) * width;
      if (avgH >= 0) cutArea += segArea; else fillArea += segArea;
    }
  }
  return {
    cut_area_sqm: r4(cutArea),
    fill_area_sqm: r4(fillArea),
    net_area_sqm: r4(cutArea - fillArea),
    points_used: pts.length,
    design_elevation: de,
  };
}

/** توليد بيانات كنتور مبسّطة من سحابة نقاط عبر استيفاء خطي على كل زوج نقاط (تقريب عملي بلا تبعيات خارجية) */
function generateContourLines({ points, interval = 1 } = {}) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('يجب إدخال 3 نقاط على الأقل لتوليد خطوط الكنتور');
  }
  const iv = Number(interval);
  if (Number.isNaN(iv) || iv <= 0) throw new Error('قيمة الفاصل الكنتوري (interval) يجب أن تكون رقماً موجباً');
  const pts = points.map((p) => ({
    easting: Number(p.easting), northing: Number(p.northing), elevation: Number(p.elevation),
  }));
  if (pts.some((p) => Number.isNaN(p.easting) || Number.isNaN(p.northing) || Number.isNaN(p.elevation))) {
    throw new Error('إحداثيات أو منسوب إحدى نقاط الرفع غير صحيحة');
  }
  const elevations = pts.map((p) => p.elevation);
  const minEl = Math.min(...elevations);
  const maxEl = Math.max(...elevations);
  const levels = [];
  let lvl = Math.ceil(minEl / iv) * iv;
  while (lvl <= maxEl) { levels.push(r2(lvl)); lvl += iv; }

  const segments = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const p1 = pts[i]; const p2 = pts[j];
      const eMin = Math.min(p1.elevation, p2.elevation);
      const eMax = Math.max(p1.elevation, p2.elevation);
      levels.forEach((level) => {
        if (level > eMin && level < eMax && eMax !== eMin) {
          const t = (level - p1.elevation) / (p2.elevation - p1.elevation);
          if (t >= 0 && t <= 1) {
            segments.push({
              level,
              easting: r4(p1.easting + t * (p2.easting - p1.easting)),
              northing: r4(p1.northing + t * (p2.northing - p1.northing)),
            });
          }
        }
      });
    }
  }
  const byLevel = {};
  segments.forEach((s) => {
    if (!byLevel[s.level]) byLevel[s.level] = [];
    byLevel[s.level].push({ easting: s.easting, northing: s.northing });
  });
  return {
    min_elevation: r4(minEl),
    max_elevation: r4(maxEl),
    interval: iv,
    levels_count: levels.length,
    contour_points_by_level: byLevel,
  };
}

function validateSurveyRecordInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.project_id !== undefined) {
    if (!body.project_id) errors.push('معرّف المشروع (project_id) مطلوب');
  }
  if (!partial || body.survey_type !== undefined) {
    if (!body.survey_type || !SURVEY_TYPES.includes(body.survey_type)) {
      errors.push(`نوع الرفع غير صحيح. الأنواع المدعومة: ${SURVEY_TYPES.join(', ')}`);
    }
  }
  if (!partial || body.title !== undefined) {
    if (!body.title || !String(body.title).trim()) errors.push('عنوان عملية الرفع مطلوب');
  }
  if (body.status !== undefined && body.status !== null && body.status !== '' && !SURVEY_STATUS_VALUES.includes(body.status)) {
    errors.push(`حالة الرفع غير صحيحة. الحالات المدعومة: ${SURVEY_STATUS_VALUES.join(', ')}`);
  }
  if (body.points !== undefined && body.points !== null && !Array.isArray(body.points)) {
    errors.push('نقاط الرفع (points) يجب أن تكون مصفوفة');
  }
  return errors;
}

function computeSurveyDerivedData(record) {
  const derived = {};
  try {
    if (record.survey_type === 'cross_section' && Array.isArray(record.points) && record.points.length >= 2) {
      derived.cross_section = calcCrossSectionArea({
        points: record.points, designElevation: record.design_elevation ?? null,
      });
    }
    if (record.survey_type === 'longitudinal_section' && Array.isArray(record.points) && record.points.length >= 2) {
      const sorted = [...record.points].map((p) => ({
        chainage: Number(p.chainage), elevation: Number(p.elevation),
        design_elevation: p.design_elevation !== undefined ? Number(p.design_elevation) : null,
      })).sort((a, b) => a.chainage - b.chainage);
      let totalLength = 0;
      const segments = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i]; const p2 = sorted[i + 1];
        const dist = p2.chainage - p1.chainage;
        totalLength += dist;
        const gradePercent = dist !== 0 ? r4(((p2.elevation - p1.elevation) / dist) * 100) : 0;
        segments.push({
          from_chainage: r2(p1.chainage), to_chainage: r2(p2.chainage), length: r2(dist), grade_percent: gradePercent,
        });
      }
      derived.longitudinal_section = {
        points_count: sorted.length, total_length: r2(totalLength), segments,
        min_elevation: r4(Math.min(...sorted.map((p) => p.elevation))),
        max_elevation: r4(Math.max(...sorted.map((p) => p.elevation))),
      };
    }
    if (record.survey_type === 'contour_survey' && Array.isArray(record.points) && record.points.length >= 3) {
      derived.contour = generateContourLines({ points: record.points, interval: record.contour_interval || 1 });
    }
  } catch (e) {
    derived.error = e.message;
  }
  return derived;
}

function createSurveyRecord(body) {
  const store = loadStore();
  const errors = validateSurveyRecordInput(body || {});
  if (errors.length) throw new Error(errors.join(' / '));
  if (!store.projects[body.project_id]) throw new Error('المشروع المساحي غير موجود');

  const existingForProject = Object.values(store.surveys).filter((s) => s.project_id === body.project_id);
  const seq = existingForProject.length + 1;

  const id = newId('SVY');
  const record = {
    id,
    project_id: body.project_id,
    survey_number: body.survey_number && String(body.survey_number).trim()
      ? String(body.survey_number).trim()
      : `SVY-${String(seq).padStart(4, '0')}`,
    survey_type: body.survey_type,
    title: String(body.title).trim(),
    description: body.description || '',
    status: body.status || 'draft',
    surveyor: body.surveyor || '',
    survey_date: body.survey_date || nowISO(),
    device_used: body.device_used || '',
    points: Array.isArray(body.points) ? body.points : [],
    chainage_start: body.chainage_start !== undefined && body.chainage_start !== '' ? Number(body.chainage_start) : null,
    chainage_end: body.chainage_end !== undefined && body.chainage_end !== '' ? Number(body.chainage_end) : null,
    design_elevation: body.design_elevation !== undefined && body.design_elevation !== '' ? Number(body.design_elevation) : null,
    contour_interval: body.contour_interval !== undefined && body.contour_interval !== '' ? Number(body.contour_interval) : null,
    reference_drawing: body.reference_drawing || '',
    photos: Array.isArray(body.photos) ? body.photos : [],
    notes: body.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const dup = existingForProject.find((s) => s.survey_number === record.survey_number);
  if (dup) throw new Error(`رقم عملية الرفع "${record.survey_number}" مستخدم مسبقاً في هذا المشروع`);

  record.derived = computeSurveyDerivedData(record);

  store.surveys[id] = record;
  audit(store, {
    action: 'create', entity: 'survey_record', entityId: id, projectId: body.project_id,
    details: { survey_number: record.survey_number, survey_type: record.survey_type },
  });
  saveStore(store);
  return { success: true, data: record };
}

function getSurveyRecord(id) {
  const store = loadStore();
  const rec = store.surveys[id];
  if (!rec) throw new Error('عملية الرفع غير موجودة');
  return rec;
}

function listSurveyRecords({ project_id, survey_type, status, q, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  let items = Object.values(store.surveys);
  if (project_id) items = items.filter((s) => s.project_id === project_id);
  if (survey_type) items = items.filter((s) => s.survey_type === survey_type);
  if (status) items = items.filter((s) => s.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((s) => s.survey_number.toLowerCase().includes(needle)
      || s.title.toLowerCase().includes(needle)
      || (s.description || '').toLowerCase().includes(needle));
  }
  items.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[sortBy] < b[sortBy]) return -1 * dir;
    if (a[sortBy] > b[sortBy]) return 1 * dir;
    return 0;
  });
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function updateSurveyRecord(id, body) {
  const store = loadStore();
  const rec = store.surveys[id];
  if (!rec) throw new Error('عملية الرفع غير موجودة');
  const errors = validateSurveyRecordInput(body || {}, { partial: true });
  if (errors.length) throw new Error(errors.join(' / '));

  if (body.survey_number !== undefined) {
    const newNumber = String(body.survey_number).trim();
    if (newNumber && newNumber !== rec.survey_number) {
      const dup = Object.values(store.surveys)
        .find((s) => s.project_id === rec.project_id && s.survey_number === newNumber && s.id !== id);
      if (dup) throw new Error(`رقم عملية الرفع "${newNumber}" مستخدم مسبقاً في هذا المشروع`);
      rec.survey_number = newNumber;
    }
  }

  const updatable = ['survey_type', 'title', 'description', 'status', 'surveyor', 'survey_date',
    'device_used', 'points', 'chainage_start', 'chainage_end', 'design_elevation',
    'contour_interval', 'reference_drawing', 'photos', 'notes'];
  for (const key of updatable) {
    if (body[key] !== undefined) {
      if (['chainage_start', 'chainage_end', 'design_elevation', 'contour_interval'].includes(key)) {
        rec[key] = body[key] !== null && body[key] !== '' ? Number(body[key]) : null;
      } else {
        rec[key] = body[key];
      }
    }
  }
  rec.updated_at = nowISO();
  rec.derived = computeSurveyDerivedData(rec);

  audit(store, { action: 'update', entity: 'survey_record', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: rec };
}

function deleteSurveyRecord(id) {
  const store = loadStore();
  const rec = store.surveys[id];
  if (!rec) throw new Error('عملية الرفع غير موجودة');
  delete store.surveys[id];
  audit(store, { action: 'delete', entity: 'survey_record', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

/** حساب حجم الحفر/الردم الإجمالي لسلسلة مقاطع عرضية مرتبطة بمشروع (طريقة متوسط المساحات) */
function calcEarthworkVolumeFromCrossSections({ survey_ids } = {}) {
  if (!Array.isArray(survey_ids) || survey_ids.length < 2) {
    throw new Error('يجب إدخال معرّفَي مقطعين عرضيين على الأقل (survey_ids) مرتّبين حسب الـ chainage');
  }
  const store = loadStore();
  const sections = survey_ids.map((id) => {
    const rec = store.surveys[id];
    if (!rec) throw new Error(`المقطع العرضي بالمعرّف ${id} غير موجود`);
    if (rec.survey_type !== 'cross_section') throw new Error(`السجل ${id} ليس مقطعاً عرضياً`);
    if (rec.chainage_start === null) throw new Error(`المقطع ${rec.survey_number} لا يحتوي على chainage_start`);
    const derived = rec.derived?.cross_section || calcCrossSectionArea({ points: rec.points, designElevation: rec.design_elevation });
    return { id, survey_number: rec.survey_number, chainage: rec.chainage_start, cut_area: derived.cut_area_sqm, fill_area: derived.fill_area_sqm };
  }).sort((a, b) => a.chainage - b.chainage);

  let totalCutVolume = 0; let totalFillVolume = 0;
  const intervals = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const s1 = sections[i]; const s2 = sections[i + 1];
    const distance = s2.chainage - s1.chainage;
    if (distance <= 0) throw new Error('يجب أن تكون قيم chainage تصاعدية وغير متطابقة بين المقاطع المتتالية');
    const cutVol = calcEndAreaVolume({ area1: s1.cut_area, area2: s2.cut_area, distance });
    const fillVol = calcEndAreaVolume({ area1: s1.fill_area, area2: s2.fill_area, distance });
    totalCutVolume += cutVol; totalFillVolume += fillVol;
    intervals.push({
      from: s1.survey_number, to: s2.survey_number, distance: r2(distance),
      cut_volume_cum: cutVol, fill_volume_cum: fillVol,
    });
  }
  return {
    sections_count: sections.length,
    intervals,
    total_cut_volume_cum: r4(totalCutVolume),
    total_fill_volume_cum: r4(totalFillVolume),
    net_volume_cum: r4(totalCutVolume - totalFillVolume),
    net_direction: totalCutVolume >= totalFillVolume ? 'فائض حفر (يحتاج نقل/تخلص)' : 'عجز (يحتاج توريد ردم)',
  };
}

function exportSurveyRecordsToCSV({ project_id, survey_type } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  const { data: items } = listSurveyRecords({ project_id, survey_type, pageSize: 100000, page: 1 });
  const headers = ['رقم عملية الرفع', 'العنوان', 'النوع', 'الحالة', 'المسّاح', 'تاريخ الرفع',
    'الجهاز المستخدم', 'عدد النقاط', 'Chainage من', 'Chainage إلى'];
  const rows = items.map((s) => [
    s.survey_number, s.title, SURVEY_TYPE_LABELS_AR2[s.survey_type] || s.survey_type,
    s.status, s.surveyor || '', s.survey_date ? String(s.survey_date).slice(0, 10) : '',
    s.device_used || '', s.points.length, s.chainage_start ?? '', s.chainage_end ?? '',
  ]);
  const buffer = generateCsv(headers, rows);
  const filename = `survey-records-${project_id}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);

  const store = loadStore();
  audit(store, { action: 'export_csv', entity: 'survey_record', entityId: null, projectId: project_id, details: { count: items.length } });
  saveStore(store);

  return { success: true, data: { url: `/reports/${filename}`, count: items.length } };
}

function runSurveyCalculation({ project_id = null, calc_type, input, actor = null } = {}) {
  const CALC_FUNCTIONS = {
    distance: calcDistance,
    bearing: calcBearing,
    horizontal_angle: calcHorizontalAngle,
    slope: calcSlope,
    closed_area: calcClosedArea,
    traverse_closure: calcTraverseClosure,
  };
  const fn = CALC_FUNCTIONS[calc_type];
  if (!fn) throw new Error(`نوع الحساب غير مدعوم. الأنواع المدعومة: ${Object.keys(CALC_FUNCTIONS).join(', ')}`);

  const result = fn(input || {});

  const store = loadStore();
  const id = newId('CALC');
  const record = { id, project_id, calc_type, input, result, actor, created_at: nowISO() };
  store.surveyCalcs[id] = record;
  audit(store, { action: 'calculate', entity: 'survey_calculation', entityId: id, projectId: project_id, actor, details: { calc_type } });
  saveStore(store);

  return { success: true, data: record };
}

function listSurveyCalculations({ project_id, calc_type, page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  let items = Object.values(store.surveyCalcs);
  if (project_id) items = items.filter((c) => c.project_id === project_id);
  if (calc_type) items = items.filter((c) => c.calc_type === calc_type);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

// ===================== التوقيع المساحي (Setting-Out / Stakeout) - الجزء 3-ب/6 =====================
const STAKEOUT_TYPE_LABELS_AR = {
  axis: 'توقيع محاور',
  footing: 'توقيع قواعد',
  column: 'توقيع أعمدة',
  road: 'توقيع طرق',
  utility: 'توقيع خدمات',
  level: 'توقيع مناسيب',
  boundary: 'توقيع حدود',
};

function validateStakeoutInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial) {
    if (!body.project_id) errors.push('معرّف المشروع (project_id) مطلوب');
    if (!body.stakeout_type || !STAKEOUT_TYPE_LABELS_AR[body.stakeout_type]) {
      errors.push(`نوع التوقيع غير صالح. الأنواع المدعومة: ${Object.keys(STAKEOUT_TYPE_LABELS_AR).join(', ')}`);
    }
    if (!body.title) errors.push('عنوان عملية التوقيع مطلوب');
  }
  if (body.design_point) {
    const dp = body.design_point;
    if (dp.easting == null || dp.northing == null) errors.push('نقطة التصميم (design_point) تتطلب easting و northing');
  }
  if (body.as_built_point) {
    const ap = body.as_built_point;
    if (ap.easting == null || ap.northing == null) errors.push('النقطة المنفذة (as_built_point) تتطلب easting و northing');
  }
  if (errors.length) { const e = new Error(errors.join(' | ')); e.validationErrors = errors; throw e; }
}

function computeStakeoutDeviation({ design_point, as_built_point, tolerance_m = 0.02 } = {}) {
  if (!design_point || !as_built_point) return null;
  const dE = as_built_point.easting - design_point.easting;
  const dN = as_built_point.northing - design_point.northing;
  const dZ = (as_built_point.elevation != null && design_point.elevation != null)
    ? as_built_point.elevation - design_point.elevation : null;
  const horizontalDeviation = Math.sqrt(dE * dE + dN * dN);
  const withinTolerance = horizontalDeviation <= Number(tolerance_m);
  return {
    delta_easting_m: r4(dE),
    delta_northing_m: r4(dN),
    delta_elevation_m: dZ != null ? r4(dZ) : null,
    horizontal_deviation_m: r4(horizontalDeviation),
    tolerance_m: Number(tolerance_m),
    within_tolerance: withinTolerance,
    verdict: withinTolerance ? 'مطابق لحدود التفاوت المسموح' : 'خارج حدود التفاوت - يلزم إعادة التوقيع أو التصحيح',
  };
}

function createStakeout(body) {
  validateStakeoutInput(body);
  const store = loadStore();
  const project = store.projects[body.project_id];
  if (!project) throw new Error('المشروع المساحي غير موجود');

  const id = newId('STK');
  const deviation = computeStakeoutDeviation({
    design_point: body.design_point,
    as_built_point: body.as_built_point,
    tolerance_m: body.tolerance_m ?? 0.02,
  });

  const record = {
    id,
    stakeout_number: `SO-${String(Object.keys(store.stakeouts).length + 1).padStart(4, '0')}`,
    project_id: body.project_id,
    stakeout_type: body.stakeout_type,
    title: body.title,
    element_reference: body.element_reference || '',
    design_point: body.design_point || null,
    as_built_point: body.as_built_point || null,
    deviation,
    tolerance_m: body.tolerance_m ?? 0.02,
    status: deviation ? (deviation.within_tolerance ? 'verified_ok' : 'out_of_tolerance') : 'pending_measurement',
    surveyor: body.surveyor || '',
    device_used: body.device_used || '',
    stakeout_date: body.stakeout_date || nowISO(),
    drawing_reference: body.drawing_reference || '',
    notes: body.notes || '',
    photos: Array.isArray(body.photos) ? body.photos : [],
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.stakeouts[id] = record;
  audit(store, { action: 'create', entity: 'stakeout', entityId: id, projectId: body.project_id, details: { stakeout_type: body.stakeout_type } });
  saveStore(store);
  return { success: true, data: record };
}

function getStakeout(id) {
  const store = loadStore();
  const record = store.stakeouts[id];
  if (!record) throw new Error('عنصر التوقيع غير موجود');
  return { success: true, data: record };
}

function listStakeouts({ project_id, stakeout_type, status, q, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  let items = Object.values(store.stakeouts);
  if (project_id) items = items.filter((s) => s.project_id === project_id);
  if (stakeout_type) items = items.filter((s) => s.stakeout_type === stakeout_type);
  if (status) items = items.filter((s) => s.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((s) => (s.title || '').toLowerCase().includes(needle)
      || (s.element_reference || '').toLowerCase().includes(needle)
      || (s.stakeout_number || '').toLowerCase().includes(needle));
  }
  items.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (a[sortBy] < b[sortBy]) return -1 * dir;
    if (a[sortBy] > b[sortBy]) return 1 * dir;
    return 0;
  });
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function updateStakeout(id, body) {
  const store = loadStore();
  const existing = store.stakeouts[id];
  if (!existing) throw new Error('عنصر التوقيع غير موجود');
  validateStakeoutInput(body, { partial: true });

  const merged = { ...existing, ...body, id };
  if (body.design_point || body.as_built_point || body.tolerance_m != null) {
    merged.deviation = computeStakeoutDeviation({
      design_point: body.design_point || existing.design_point,
      as_built_point: body.as_built_point || existing.as_built_point,
      tolerance_m: body.tolerance_m ?? existing.tolerance_m ?? 0.02,
    });
    merged.status = merged.deviation ? (merged.deviation.within_tolerance ? 'verified_ok' : 'out_of_tolerance') : existing.status;
  }
  merged.updated_at = nowISO();

  store.stakeouts[id] = merged;
  audit(store, { action: 'update', entity: 'stakeout', entityId: id, projectId: existing.project_id, details: {} });
  saveStore(store);
  return { success: true, data: merged };
}

function deleteStakeout(id) {
  const store = loadStore();
  const existing = store.stakeouts[id];
  if (!existing) throw new Error('عنصر التوقيع غير موجود');
  delete store.stakeouts[id];
  audit(store, { action: 'delete', entity: 'stakeout', entityId: id, projectId: existing.project_id, details: {} });
  saveStore(store);
  return { success: true, data: { id } };
}

function compareStakeoutBatchToDesign({ project_id, stakeout_type } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  const { data: items } = listStakeouts({ project_id, stakeout_type, pageSize: 100000 });
  const withDeviation = items.filter((s) => s.deviation);
  const outOfTolerance = withDeviation.filter((s) => !s.deviation.within_tolerance);
  const maxDeviation = withDeviation.reduce((max, s) => Math.max(max, s.deviation.horizontal_deviation_m), 0);
  const avgDeviation = withDeviation.length
    ? withDeviation.reduce((sum, s) => sum + s.deviation.horizontal_deviation_m, 0) / withDeviation.length
    : 0;
  return {
    success: true,
    data: {
      total_points: items.length,
      measured_points: withDeviation.length,
      pending_points: items.length - withDeviation.length,
      out_of_tolerance_count: outOfTolerance.length,
      max_horizontal_deviation_m: r4(maxDeviation),
      avg_horizontal_deviation_m: r4(avgDeviation),
      out_of_tolerance_items: outOfTolerance.map((s) => ({
        id: s.id, stakeout_number: s.stakeout_number, title: s.title,
        element_reference: s.element_reference, deviation: s.deviation,
      })),
      overall_verdict: outOfTolerance.length === 0 && withDeviation.length > 0
        ? 'جميع نقاط التوقيع المقاسة مطابقة لحدود التفاوت'
        : outOfTolerance.length > 0
          ? `يوجد ${outOfTolerance.length} نقطة/نقاط خارج حدود التفاوت المسموح`
          : 'لا توجد نقاط تم قياسها بعد',
    },
  };
}

function exportStakeoutsToCSV({ project_id, stakeout_type } = {}) {
  if (!project_id) throw new Error('معرّف المشروع (project_id) مطلوب');
  const { data: items } = listStakeouts({ project_id, stakeout_type, pageSize: 100000 });
  const headers = ['رقم التوقيع', 'العنوان', 'النوع', 'العنصر المرجعي', 'الحالة',
    'انحراف أفقي (م)', 'حد التفاوت (م)', 'المسّاح', 'تاريخ التوقيع'];
  const rows = items.map((s) => [
    s.stakeout_number, s.title, STAKEOUT_TYPE_LABELS_AR[s.stakeout_type] || s.stakeout_type,
    s.element_reference || '', s.status,
    s.deviation ? s.deviation.horizontal_deviation_m : '', s.tolerance_m,
    s.surveyor || '', s.stakeout_date ? String(s.stakeout_date).slice(0, 10) : '',
  ]);
  const buffer = generateCsv(headers, rows);
  const filename = `stakeouts-${project_id}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);

  const store = loadStore();
  audit(store, { action: 'export_csv', entity: 'stakeout', entityId: null, projectId: project_id, details: { count: items.length } });
  saveStore(store);

  return { success: true, data: { url: `/reports/${filename}`, count: items.length } };
}

module.exports = {
  // أدوار
  ensureSurveyRolesSeeded,
  // التوقيع المساحي (الجزء 3-ب/6)
  createStakeout,
  getStakeout,
  listStakeouts,
  updateStakeout,
  deleteStakeout,
  compareStakeoutBatchToDesign,
  exportStakeoutsToCSV,
  STAKEOUT_TYPE_LABELS_AR,
  // مشاريع
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  // أنظمة إحداثيات
  createCoordinateSystem,
  listCoordinateSystems,
  setDefaultCoordinateSystem,
  deleteCoordinateSystem,
  // تحويل وتحقق من الإحداثيات
  convertCoordinates,
  validateGeographic,
  validateUTM,
  geographicToUTM,
  utmToGeographic,
  utmZoneFromLongitude,
  // لوحة التحكم والمرجع
  getDashboard,
  getReferenceData,
  // تصدير
  exportProjectsToCSV,
  exportCoordinateSystemsToCSV,
  // نقاط الرفع المساحي (الجزء 2/6)
  createControlPoint,
  getControlPoint,
  listControlPoints,
  updateControlPoint,
  deleteControlPoint,
  exportControlPointsToCSV,
  // حسابات المساحة الأساسية (الجزء 2/6)
  calcDistance,
  calcBearing,
  calcHorizontalAngle,
  calcSlope,
  calcClosedArea,
  calcTraverseClosure,
  runSurveyCalculation,
  listSurveyCalculations,
  // الرفع المساحي المتخصص (الجزء 3-أ/6)
  createSurveyRecord,
  getSurveyRecord,
  listSurveyRecords,
  updateSurveyRecord,
  deleteSurveyRecord,
  exportSurveyRecordsToCSV,
  calcCrossSectionArea,
  generateContourLines,
  calcEndAreaVolume,
  calcEarthworkVolumeFromCrossSections,
  // مساعدات داخلية معروضة للاستخدام من الأجزاء اللاحقة لنفس القسم
  _internal: { loadStore, saveStore, audit, newId, nowISO, r2, r4, r6 },
};
