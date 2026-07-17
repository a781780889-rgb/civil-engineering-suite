/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * مكتبة الأسعار المركزية (Central Price Library)
 * ================================================
 * قاعدة بيانات أسعار موحّدة تُستخدم من جميع حاسبات BOQ وحديد التسليح والخرسانة:
 * - أسعار المواد (لكل بند من كل حاسبة BOQ: طوب، بلوك، سيراميك، دهانات، عزل...)
 * - أسعار الحديد والخرسانة (مرتبطة بنفس مفاتيح constants.js لتفادي الازدواجية)
 * - أسعار العمالة (لكل حرفة/نشاط)
 * - أسعار المعدات (تأجير/تشغيل)
 * - أسعار النقل
 * - الضرائب والخصومات
 * - الموردين (اسم، بند، سعر، جهة اتصال)
 *
 * التخزين: ملف JSON على القرص (backend/data/price_library.json) — قاعدة بيانات
 * مركزية بسيطة بدون تبعيات خارجية (متوافق مع سياسة "صفر تبعيات" للمشروع).
 * يدعم النظام:
 *   - مكتبة أسعار افتراضية عامة (Global / Default)
 *   - مكتبة أسعار مخصصة لكل مشروع (Project-level override)
 *   - مكتبة أسعار مخصصة لكل منطقة (Region-level override)
 * ترتيب الأولوية عند القراءة: Project override > Region override > Global default
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'price_library.json');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

// ===== الأسعار الافتراضية العامة (Global Defaults) - قابلة للتعديل الكامل =====
const DEFAULT_PRICES = {
  materials: {
    // الخرسانة والحديد (مرتبطة منطقياً بـ constants.js لكن قابلة للتخصيص المالي المستقل)
    concrete_per_m3: { c20: 0, c25: 0, c30: 0, c35: 0, c40: 0, lean: 0 },
    rebar_per_ton: { grade280: 0, grade350: 0, grade420: 0, grade520: 0 },
    // مواد المباني
    red_brick_solid: 0, red_brick_perforated: 0,
    cement_block_10: 0, cement_block_15: 0, cement_block_20: 0,
    cement_brick: 0, natural_stone: 0, aac_block_10: 0, aac_block_20: 0,
    // اللياسة
    cement_plaster_per_m3: 0, gypsum_plaster_per_m3: 0,
    // العزل
    waterproofing_membrane_per_m2: 0, thermal_insulation_per_m2: 0,
    // الأرضيات
    ceramic_per_m2: 0, porcelain_per_m2: 0, marble_per_m2: 0, granite_per_m2: 0,
    epoxy_per_m2: 0, parquet_per_m2: 0, printed_concrete_per_m2: 0,
    // الأسقف
    gypsum_ceiling_per_m2: 0, metal_ceiling_per_m2: 0, suspended_ceiling_per_m2: 0,
    // الدهانات
    paint_interior_per_m2: 0, paint_exterior_per_m2: 0, primer_per_m2: 0, putty_per_m2: 0,
    // النجارة والألمنيوم
    door_wood_per_unit: 0, window_wood_per_unit: 0, kitchen_per_m: 0, wardrobe_per_m2: 0,
    aluminum_curtain_wall_per_m2: 0, aluminum_window_per_m2: 0, aluminum_door_per_m2: 0, glass_dome_per_m2: 0,
    // الكهرباء والصحي
    cable_per_m: 0, conduit_per_m: 0, panel_per_unit: 0, switch_outlet_per_unit: 0,
    earthing_per_point: 0, fire_alarm_per_point: 0,
    water_pipe_per_m: 0, drainage_pipe_per_m: 0, vent_pipe_per_m: 0, pump_per_unit: 0,
    // الطرق
    asphalt_per_m3: 0, base_course_per_m3: 0, sidewalk_per_m2: 0, curbstone_per_m: 0, road_marking_per_m: 0,
    // التربة
    excavation_per_m3: 0, backfilling_per_m3: 0, soil_replacement_per_m3: 0, spoil_disposal_per_m3: 0,
  },
  labor: {
    mason_per_day: 0, carpenter_per_day: 0, steel_fixer_per_day: 0, painter_per_day: 0,
    electrician_per_day: 0, plumber_per_day: 0, general_laborer_per_day: 0, surveyor_per_day: 0,
  },
  equipment: {
    excavator_per_hour: 0, crane_per_hour: 0, truck_per_trip: 0, concrete_pump_per_hour: 0,
    mixer_per_hour: 0, generator_per_hour: 0, compactor_per_hour: 0,
  },
  transport: {
    default_per_m3: 0, default_per_ton: 0,
  },
  tax_percent: 0,
  discount_percent: 0,
  suppliers: [], // { id, name, item, unit_price, unit, contact, region, updated_at }
  currency: 'SAR',
  updated_at: null,
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      global: DEFAULT_PRICES,
      regions: {},   // { regionName: { ...partial DEFAULT_PRICES shape... } }
      projects: {},  // { projectId: { ...partial DEFAULT_PRICES shape... } }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات الأسعار: ' + e.message);
  }
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/** دمج عميق لكائنين: base مغطى بقيم override غير الفارغة/غير null فقط */
function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * جلب مكتبة الأسعار الفعّالة: Global < Region < Project (الأعلى يطغى على الأدنى)
 */
function getEffectivePrices({ projectId = null, region = null } = {}) {
  const store = loadStore();
  let effective = deepMerge(DEFAULT_PRICES, store.global || {});
  if (region && store.regions?.[region]) {
    effective = deepMerge(effective, store.regions[region]);
  }
  if (projectId && store.projects?.[projectId]) {
    effective = deepMerge(effective, store.projects[projectId]);
  }
  return effective;
}

/** تحديث الأسعار على المستوى العام */
function updateGlobalPrices(partial) {
  const store = loadStore();
  store.global = deepMerge(deepMerge(DEFAULT_PRICES, store.global || {}), partial);
  store.global.updated_at = new Date().toISOString();
  saveStore(store);
  return store.global;
}

/** تحديث/إنشاء أسعار مخصصة لمنطقة معينة */
function updateRegionPrices(region, partial) {
  if (!region) throw new Error('اسم المنطقة مطلوب');
  const store = loadStore();
  if (!store.regions) store.regions = {};
  const existing = store.regions[region] || {};
  store.regions[region] = deepMerge(existing, partial);
  store.regions[region].updated_at = new Date().toISOString();
  saveStore(store);
  return store.regions[region];
}

/** تحديث/إنشاء أسعار مخصصة لمشروع معين */
function updateProjectPrices(projectId, partial) {
  if (!projectId) throw new Error('معرّف المشروع مطلوب');
  const store = loadStore();
  if (!store.projects) store.projects = {};
  const existing = store.projects[projectId] || {};
  store.projects[projectId] = deepMerge(existing, partial);
  store.projects[projectId].updated_at = new Date().toISOString();
  saveStore(store);
  return store.projects[projectId];
}

function listRegions() {
  const store = loadStore();
  return Object.keys(store.regions || {});
}

function listProjectsWithPricing() {
  const store = loadStore();
  return Object.keys(store.projects || {});
}

// ===== إدارة الموردين =====
function addSupplier({ name, item, unit_price, unit = '', contact = '', region = '' }) {
  if (!name || !item || unit_price === undefined || unit_price === null) {
    throw new Error('اسم المورد والبند والسعر مطلوبة');
  }
  const store = loadStore();
  if (!store.global.suppliers) store.global.suppliers = [];
  const supplier = {
    id: `SUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name, item,
    unit_price: round2(unit_price),
    unit, contact, region,
    updated_at: new Date().toISOString(),
  };
  store.global.suppliers.push(supplier);
  saveStore(store);
  return supplier;
}

function listSuppliers({ item = null, region = null } = {}) {
  const store = loadStore();
  let suppliers = store.global.suppliers || [];
  if (item) suppliers = suppliers.filter(s => s.item.toLowerCase().includes(item.toLowerCase()));
  if (region) suppliers = suppliers.filter(s => s.region === region);
  return suppliers;
}

function deleteSupplier(id) {
  const store = loadStore();
  const before = (store.global.suppliers || []).length;
  store.global.suppliers = (store.global.suppliers || []).filter(s => s.id !== id);
  saveStore(store);
  if (store.global.suppliers.length === before) throw new Error('المورد غير موجود');
  saveStore(store);
  return { deleted: true, id };
}

function findCheapestSupplier(item) {
  const suppliers = listSuppliers({ item });
  if (suppliers.length === 0) return null;
  return suppliers.reduce((min, s) => (s.unit_price < min.unit_price ? s : min), suppliers[0]);
}

/**
 * تسعير بند حصر كميات (BOQ line item) اعتماداً على مكتبة الأسعار المركزية
 * @param {Object} p
 * @param {string} p.priceKey - المفتاح في materials{} (مثال: 'red_brick_solid')
 * @param {number} p.quantity - الكمية الفعلية المحسوبة من الحاسبة
 * @param {string} [p.projectId]
 * @param {string} [p.region]
 * @param {number} [p.overridePrice] - سعر مباشر يتجاوز المكتبة (اختياري)
 */
function priceLineItem({ priceKey, quantity, projectId = null, region = null, overridePrice = null }) {
  if (quantity === undefined || quantity === null) throw new Error('الكمية مطلوبة لتسعير البند');
  const prices = getEffectivePrices({ projectId, region });
  const unitPrice = overridePrice !== null && overridePrice !== undefined
    ? overridePrice
    : (prices.materials?.[priceKey] ?? 0);
  const totalCost = round2(unitPrice * quantity);
  return {
    price_key: priceKey,
    quantity: round2(quantity),
    unit_price: round2(unitPrice),
    total_cost: totalCost,
    source: overridePrice !== null ? 'override' : (unitPrice ? 'price_library' : 'not_priced'),
  };
}

module.exports = {
  DEFAULT_PRICES,
  getEffectivePrices,
  updateGlobalPrices,
  updateRegionPrices,
  updateProjectPrices,
  listRegions,
  listProjectsWithPricing,
  addSupplier,
  listSuppliers,
  deleteSupplier,
  findCheapestSupplier,
  priceLineItem,
};
