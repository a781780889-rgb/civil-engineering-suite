/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * وحدة تكميلية: أنظمة الإحداثيات المتقدمة (State Plane Coordinate Systems + الأنظمة
 * المحلية Local Coordinate Systems) وتحويل Helmert (تشابهي 2D) بين نظام محلي وWGS84.
 *
 * تنفيذ حقيقي:
 *  - State Plane: يُطبَّق إسقاط Lambert Conformal Conic (لولايات الاتجاه الشرقي-غربي)
 *    وTransverse Mercator (لولايات الاتجاه الشمالي-جنوبي) بنفس معادلات NOAA/NGS
 *    الرسمية المستخدمة في NAD83 State Plane Coordinate System 1983.
 *  - Local Coordinate Systems: تحويل تشابهي Helmert 2D كامل (إزاحة + دوران + مقياس)
 *    بين شبكة محلية وWGS84 Geographic، محسوب فعلياً من نقاط تحكم مشتركة (Control
 *    Points) بطريقة المربعات الصغرى (Least Squares) وليس بقيم افتراضية.
 */

const SGM_ = require('./surveyManagement');
const { _internal } = SGM_;
const { r4, r6 } = _internal;

function deg2rad(d) { return (d * Math.PI) / 180; }
function rad2deg(r) { return (r * 180) / Math.PI; }

// ثوابت WGS84 (مطابقة لما هو مستخدم في surveyManagement.js)
const WGS84 = { a: 6378137.0, f: 1 / 298.257223563 };
WGS84.b = WGS84.a * (1 - WGS84.f);
WGS84.e2 = (WGS84.a * WGS84.a - WGS84.b * WGS84.b) / (WGS84.a * WGS84.a);

// ==================================================================================
// ==================== State Plane Coordinate System (NAD83, NOAA/NGS) =============
// ==================================================================================

/**
 * مكتبة مناطق State Plane الأمريكية الشائعة (NAD83).
 * كل منطقة تحدد نوع الإسقاط ومعاملاته الرسمية الصادرة عن NGS.
 * (يمكن التوسّع بإضافة مناطق جديدة دون التأثير على بقية النظام - بنية معيارية).
 */
const STATE_PLANE_ZONES = {
  'CA-III': {
    label: 'California Zone III (NAD83)', projection: 'LCC',
    lat0: 36.5, lon0: -120.5, lat1: 37.066667, lat2: 38.433333,
    falseEasting: 2000000.0 / 3.28083333, falseNorthing: 500000.0 / 3.28083333, // متر
  },
  'TX-C': {
    label: 'Texas Central Zone (NAD83)', projection: 'LCC',
    lat0: 29.666667, lon0: -100.333333, lat1: 30.116667, lat2: 31.883333,
    falseEasting: 700000.0 / 3.28083333, falseNorthing: 3000000.0 / 3.28083333,
  },
  'NY-E': {
    label: 'New York East Zone (NAD83)', projection: 'TM',
    lat0: 38.833333, lon0: -74.5, k0: 0.9999,
    falseEasting: 150000.0 / 3.28083333, falseNorthing: 0,
  },
  'FL-E': {
    label: 'Florida East Zone (NAD83)', projection: 'TM',
    lat0: 24.333333, lon0: -81.0, k0: 0.999941177,
    falseEasting: 200000.0 / 3.28083333, falseNorthing: 0,
  },
  'IL-E': {
    label: 'Illinois East Zone (NAD83)', projection: 'TM',
    lat0: 36.666667, lon0: -88.333333, k0: 0.999975,
    falseEasting: 300000.0 / 3.28083333, falseNorthing: 0,
  },
};

function listStatePlaneZones() {
  return Object.entries(STATE_PLANE_ZONES).map(([code, z]) => ({
    code, label: z.label, projection: z.projection === 'LCC' ? 'Lambert Conformal Conic' : 'Transverse Mercator',
  }));
}

/** إسقاط Lambert Conformal Conic (نطاقين متوازيين قياسيين) - صيغة Snyder الرسمية */
function geographicToLCC({ lat, lon }, zone) {
  const { a, e2 } = WGS84;
  const e = Math.sqrt(e2);
  const phi = deg2rad(lat);
  const lam = deg2rad(lon);
  const phi0 = deg2rad(zone.lat0);
  const lam0 = deg2rad(zone.lon0);
  const phi1 = deg2rad(zone.lat1);
  const phi2 = deg2rad(zone.lat2);

  const m = (phi_) => Math.cos(phi_) / Math.sqrt(1 - e2 * Math.sin(phi_) ** 2);
  const t = (phi_) => Math.tan(Math.PI / 4 - phi_ / 2) / Math.pow((1 - e * Math.sin(phi_)) / (1 + e * Math.sin(phi_)), e / 2);

  const m1 = m(phi1); const m2 = m(phi2);
  const t0 = t(phi0); const t1 = t(phi1); const t2 = t(phi2); const tPhi = t(phi);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const rho = a * F * Math.pow(tPhi, n);
  const theta = n * (lam - lam0);

  const x = rho * Math.sin(theta) + zone.falseEasting;
  const y = rho0 - rho * Math.cos(theta) + zone.falseNorthing;
  return { x, y };
}

function lccToGeographic({ x, y }, zone) {
  const { a, e2 } = WGS84;
  const e = Math.sqrt(e2);
  const phi0 = deg2rad(zone.lat0);
  const lam0 = deg2rad(zone.lon0);
  const phi1 = deg2rad(zone.lat1);
  const phi2 = deg2rad(zone.lat2);

  const m = (phi_) => Math.cos(phi_) / Math.sqrt(1 - e2 * Math.sin(phi_) ** 2);
  const t = (phi_) => Math.tan(Math.PI / 4 - phi_ / 2) / Math.pow((1 - e * Math.sin(phi_)) / (1 + e * Math.sin(phi_)), e / 2);

  const m1 = m(phi1); const m2 = m(phi2);
  const t0 = t(phi0); const t1 = t(phi1); const t2 = t(phi2);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);

  const xp = x - zone.falseEasting;
  const yp = rho0 - (y - zone.falseNorthing);
  let rho = Math.sign(n) * Math.sqrt(xp * xp + yp * yp);
  const theta = Math.atan2(xp, yp);
  const tChi = Math.pow(rho / (a * F), 1 / n);

  let phi = Math.PI / 2 - 2 * Math.atan(tChi);
  for (let i = 0; i < 6; i += 1) {
    const sinPhi = Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tChi * Math.pow((1 - e * sinPhi) / (1 + e * sinPhi), e / 2));
  }
  const lam = theta / n + lam0;
  return { lat: r6(rad2deg(phi)), lon: r6(rad2deg(lam)) };
}

/** إسقاط Transverse Mercator بمعامل مقياس k0 مخصص (لمناطق State Plane ذات الاتجاه الشمالي-جنوبي) */
function geographicToTMCustom({ lat, lon }, zone) {
  const { a, e2 } = WGS84;
  const ep2 = e2 / (1 - e2);
  const phi = deg2rad(lat);
  const lam = deg2rad(lon);
  const lam0 = deg2rad(zone.lon0);
  const k0 = zone.k0;

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);

  const M = a * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi)
  );
  const phi0 = deg2rad(zone.lat0);
  const M0 = a * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi0
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi0)
    + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi0)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi0)
  );

  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6) + zone.falseEasting;
  const y = k0 * (M - M0 + N * Math.tan(phi) * (A * A) / 2) + zone.falseNorthing;
  return { x, y };
}

function geographicToStatePlane({ lat, lon, zoneCode }) {
  const zone = STATE_PLANE_ZONES[zoneCode];
  if (!zone) throw new Error(`منطقة State Plane غير معروفة: ${zoneCode}. المتاح: ${Object.keys(STATE_PLANE_ZONES).join(', ')}`);
  if (typeof lat !== 'number' || typeof lon !== 'number') throw new Error('يجب إدخال lat/lon كأرقام');

  const result = zone.projection === 'LCC' ? geographicToLCC({ lat, lon }, zone) : geographicToTMCustom({ lat, lon }, zone);
  return { x: r4(result.x), y: r4(result.y), zone_code: zoneCode, zone_label: zone.label, projection: zone.projection };
}

function statePlaneToGeographic({ x, y, zoneCode }) {
  const zone = STATE_PLANE_ZONES[zoneCode];
  if (!zone) throw new Error(`منطقة State Plane غير معروفة: ${zoneCode}`);
  if (zone.projection !== 'LCC') throw new Error('التحويل العكسي مدعوم حالياً لإسقاط Lambert Conformal Conic فقط ضمن هذا الإصدار');
  return lccToGeographic({ x, y }, zone);
}

// ==================================================================================
// ================== Local Coordinate Systems: تحويل Helmert 2D ====================
// ==================================================================================

/**
 * حساب معاملات تحويل Helmert 2D (تشابهي: إزاحة + دوران + مقياس موحّد) من مجموعة
 * نقاط تحكم مشتركة (لها إحداثيات محلية وإحداثيات WGS84/UTM مرجعية معاً)، باستخدام
 * طريقة المربعات الصغرى الخطية القياسية (Least Squares).
 * pairs: [{ local: {x,y}, reference: {x,y} }, ...] (لا يقل عن نقطتين، ويُفضّل 3+)
 */
function computeHelmertTransform(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new Error('يلزم نقطتا تحكم مشتركتان على الأقل لحساب تحويل Helmert (يُفضّل 3 نقاط أو أكثر لدقة أعلى)');
  }

  // نموذج خطي: X' = a*x - b*y + tx ,  Y' = b*x + a*y + ty
  // حل بالمربعات الصغرى عبر معادلات المصفوفات الطبيعية (Normal Equations)
  let Sxx = 0; let Syy = 0; let Sxy = 0; let Sx = 0; let Sy = 0;
  let SxX = 0; let SxY = 0; let SyX = 0; let SyY = 0; let SX = 0; let SY = 0;
  const n = pairs.length;

  pairs.forEach(({ local, reference }) => {
    const { x, y } = local;
    const { x: X, y: Y } = reference;
    Sxx += x * x; Syy += y * y; Sxy += x * y; Sx += x; Sy += y;
    SxX += x * X; SxY += x * Y; SyX += y * X; SyY += y * Y; SX += X; SY += Y;
  });

  // بناء نظام 4x4 لحل [a, b, tx, ty] بشكل مباشر (اشتقاق مغلق الصيغة لتحويل Helmert 2D)
  const denom = n * (Sxx + Syy) - (Sx * Sx + Sy * Sy);
  if (Math.abs(denom) < 1e-9) throw new Error('تعذّر حساب التحويل: نقاط التحكم متطابقة أو غير كافية هندسياً');

  const a = (n * (SxX + SyY) - (Sx * SX + Sy * SY)) / denom;
  const b = (n * (SxY - SyX) - (Sx * SY - Sy * SX)) / denom;
  const tx = (SX - a * Sx + b * Sy) / n;
  const ty = (SY - b * Sx - a * Sy) / n;

  const scale = Math.sqrt(a * a + b * b);
  const rotationDeg = rad2deg(Math.atan2(b, a));

  // حساب دقة التحويل (RMSE) بتطبيقه على نفس نقاط التحكم ومقارنتها بالقيم المرجعية
  let sqErrSum = 0;
  pairs.forEach(({ local, reference }) => {
    const X = a * local.x - b * local.y + tx;
    const Y = b * local.x + a * local.y + ty;
    const dx = X - reference.x; const dy = Y - reference.y;
    sqErrSum += dx * dx + dy * dy;
  });
  const rmse = Math.sqrt(sqErrSum / n);

  return {
    a: r6(a), b: r6(b), tx: r4(tx), ty: r4(ty),
    scale: r6(scale), rotation_deg: r6(rotationDeg),
    rmse_m: r4(rmse), control_points_used: n,
  };
}

/** تطبيق تحويل Helmert محسوب مسبقاً على نقطة محلية للحصول على إحداثياتها المرجعية */
function applyHelmertTransform({ x, y }, params) {
  const { a, b, tx, ty } = params;
  return {
    x: r4(a * x - b * y + tx),
    y: r4(b * x + a * y + ty),
  };
}

/** التحويل العكسي (من النظام المرجعي إلى المحلي) */
function applyInverseHelmertTransform({ x, y }, params) {
  const { a, b, tx, ty } = params;
  const denom = a * a + b * b;
  if (denom < 1e-12) throw new Error('معاملات التحويل غير صالحة (مقياس صفري)');
  const dx = x - tx; const dy = y - ty;
  return {
    x: r4((a * dx + b * dy) / denom),
    y: r4((a * dy - b * dx) / denom),
  };
}

module.exports = {
  STATE_PLANE_ZONES,
  listStatePlaneZones,
  geographicToStatePlane,
  statePlaneToGeographic,
  computeHelmertTransform,
  applyHelmertTransform,
  applyInverseHelmertTransform,
};
