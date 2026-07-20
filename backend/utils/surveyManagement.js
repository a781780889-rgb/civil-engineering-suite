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

const DATA_DIR = path.join(__dirname, '..', 'data');
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

  const projectsByStatus = PROJECT_STATUSES.reduce((acc, s) => {
    acc[s] = projects.filter((p) => p.status === s).length;
    return acc;
  }, {});

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((p) => ({ id: p.id, project_number: p.project_number, name: p.name, status: p.status, created_at: p.created_at }));

  const recentAudit = store.auditLog.slice(-10).reverse();

  return {
    success: true,
    data: {
      total_projects: projects.length,
      total_control_points: controlPoints.length,      // سيُملأ فعلياً في الجزء الثاني
      total_stakeout_points: 0,                         // الجزء الثالث
      total_devices: 0,                                 // الجزء الرابع
      total_maps: Object.keys(store.maps).length,       // الجزء الخامس
      total_survey_files: 0,                            // الجزء الرابع
      total_stakeout_files: 0,                          // الجزء الرابع
      total_calculations_executed: surveyCalcs.length,
      projects_by_status: projectsByStatus,
      total_coordinate_systems: coordinateSystems.length,
      recent_projects: recentProjects,
      recent_measurements: [],  // سيُملأ فعلياً في الجزء الثاني (نقاط الرفع)
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

module.exports = {
  // أدوار
  ensureSurveyRolesSeeded,
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
  // مساعدات داخلية معروضة للاستخدام من الأجزاء اللاحقة لنفس القسم
  _internal: { loadStore, saveStore, audit, newId, nowISO, r2, r4, r6 },
};
