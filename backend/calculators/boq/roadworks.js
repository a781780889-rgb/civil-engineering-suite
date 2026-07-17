/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * أعمال الطرق (Road Works)
 */

const { DENSITIES } = require('../../utils/constants');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

// كثافات طبقات الطرق النمطية (طن/م3)
const ROAD_LAYER_DENSITIES = {
  subbase_granular: 1.9,
  base_course_crushed: 2.0,
  asphalt_binder: 2.35,
  asphalt_wearing: 2.4,
  concrete_pavement: 2.4,
};

/**
 * حساب طبقات الردم الهندسي للطريق (Subgrade/Subbase) بالحجم والوزن
 */
function calculateRoadFillLayers({ length_m, width_m, layers }) {
  if (!length_m || !width_m || !Array.isArray(layers) || layers.length === 0) {
    throw new Error('يجب إدخال طول وعرض الطريق وقائمة الطبقات (thickness_cm, layerType)');
  }
  const area_m2 = length_m * width_m;
  let totalVolume = 0;
  let totalWeight = 0;

  const items = layers.map((l, idx) => {
    const { thickness_cm, layerType = 'subbase_granular', compactionFactor = 1.15 } = l;
    if (!thickness_cm) throw new Error(`سماكة الطبقة رقم ${idx + 1} غير محددة`);
    const volume_m3 = area_m2 * (thickness_cm / 100);
    const looseVolume_m3 = volume_m3 * compactionFactor;
    const density = ROAD_LAYER_DENSITIES[layerType] || ROAD_LAYER_DENSITIES.subbase_granular;
    const weight = volume_m3 * density;
    totalVolume += volume_m3;
    totalWeight += weight;
    return {
      layer: idx + 1,
      layer_type: layerType,
      thickness_cm,
      compacted_volume_m3: round3(volume_m3),
      loose_volume_required_m3: round3(looseVolume_m3),
      weight_tons: round2(weight),
    };
  });

  return {
    road_area_m2: round2(area_m2),
    layers: items,
    total_compacted_volume_m3: round3(totalVolume),
    total_weight_tons: round2(totalWeight),
  };
}

/**
 * حساب طبقة الأساس (Base Course) - حصويات مكسرة مدمكة
 */
function calculateBaseCourse({ area_m2, thickness_cm = 20, compactionFactor = 1.2 }) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الطريق');
  const volume_m3 = area_m2 * (thickness_cm / 100);
  const looseVolume_m3 = volume_m3 * compactionFactor;
  const weight_tons = volume_m3 * ROAD_LAYER_DENSITIES.base_course_crushed;

  return {
    area_m2: round2(area_m2),
    thickness_cm,
    compacted_volume_m3: round3(volume_m3),
    loose_volume_required_m3: round3(looseVolume_m3),
    weight_tons: round2(weight_tons),
  };
}

/**
 * حساب طبقات الأسفلت (Binder + Wearing Course)
 */
function calculateAsphaltLayers({
  area_m2,
  binderThickness_cm = 6,
  wearingThickness_cm = 4,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الطريق للأسفلت');

  const binderVolume_m3 = area_m2 * (binderThickness_cm / 100);
  const wearingVolume_m3 = area_m2 * (wearingThickness_cm / 100);
  const binderWeight_tons = binderVolume_m3 * ROAD_LAYER_DENSITIES.asphalt_binder;
  const wearingWeight_tons = wearingVolume_m3 * ROAD_LAYER_DENSITIES.asphalt_wearing;

  return {
    area_m2: round2(area_m2),
    binder_course: {
      thickness_cm: binderThickness_cm,
      volume_m3: round3(binderVolume_m3),
      weight_tons: round2(binderWeight_tons),
    },
    wearing_course: {
      thickness_cm: wearingThickness_cm,
      volume_m3: round3(wearingVolume_m3),
      weight_tons: round2(wearingWeight_tons),
    },
    total_asphalt_weight_tons: round2(binderWeight_tons + wearingWeight_tons),
  };
}

/**
 * حساب الأرصفة (Sidewalks) - خرسانة أو بلاط إنترلوك
 */
function calculateSidewalks({
  length_m,
  width_m,
  thickness_cm = 10,
  finishType = 'concrete', // concrete | interlock
  interlockUnitArea_m2 = 0.04, // مساحة وحدة الإنترلوك القياسية تقريباً
  wastePercent = 8,
}) {
  if (!length_m || !width_m) throw new Error('يجب إدخال طول وعرض الرصيف');
  const area_m2 = length_m * width_m;

  if (finishType === 'concrete') {
    const volume_m3 = area_m2 * (thickness_cm / 100);
    return {
      finish_type: 'خرسانة',
      area_m2: round2(area_m2),
      thickness_cm,
      concrete_volume_m3: round3(volume_m3 * (1 + wastePercent / 100)),
    };
  }

  const unitsNet = area_m2 / interlockUnitArea_m2;
  const unitsWithWaste = Math.ceil(unitsNet * (1 + wastePercent / 100));
  const sandBeddingVolume_m3 = area_m2 * 0.05; // طبقة رمل تحت الإنترلوك (نمطي 5 سم)

  return {
    finish_type: 'إنترلوك',
    area_m2: round2(area_m2),
    interlock_units_required: unitsWithWaste,
    sand_bedding_volume_m3: round3(sandBeddingVolume_m3),
    waste_percent: wastePercent,
  };
}

/**
 * حساب البردورات (Curbs/Kerbstones) بالطول الطولي مع تحديد عدد الوحدات القياسية
 */
function calculateCurbstones({
  totalLength_m,
  unitLength_m = 0.5,
  wastePercent = 5,
  includeBaseConcrete = true,
  baseWidth_m = 0.3,
  baseThickness_cm = 10,
}) {
  if (!totalLength_m) throw new Error('يجب إدخال الطول الكلي للبردورات');
  const unitsNet = totalLength_m / unitLength_m;
  const unitsWithWaste = Math.ceil(unitsNet * (1 + wastePercent / 100));

  const baseConcreteVolume_m3 = includeBaseConcrete
    ? totalLength_m * baseWidth_m * (baseThickness_cm / 100)
    : 0;

  return {
    total_length_m: totalLength_m,
    unit_length_m: unitLength_m,
    units_required_net: Math.ceil(unitsNet),
    units_required_with_waste: unitsWithWaste,
    base_concrete_volume_m3: round3(baseConcreteVolume_m3),
    waste_percent: wastePercent,
  };
}

/**
 * حساب دهانات الطرق الأرضية (Road Markings) - خطوط طولية وعرضية بمساحة الطلاء
 */
function calculateRoadMarkings({
  lines, // [{length_m, width_cm, count}]
  paintCoverage_kg_m2 = 0.6, // استهلاك دهان الطرق (كجم/م2) - قيمة مرجعية
  wastePercent = 15,
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('يجب إدخال قائمة خطوط الدهان (length_m, width_cm, count)');
  }
  let totalArea = 0;
  const items = lines.map((l, idx) => {
    const { length_m, width_cm, count = 1 } = l;
    if (!length_m || !width_cm) throw new Error(`بيانات ناقصة لخط الدهان رقم ${idx + 1}`);
    const area = length_m * (width_cm / 100) * count;
    totalArea += area;
    return { line: idx + 1, length_m, width_cm, count, area_m2: round2(area) };
  });

  const paintWeight_kg = totalArea * paintCoverage_kg_m2 * (1 + wastePercent / 100);

  return {
    items,
    summary: {
      total_marking_area_m2: round2(totalArea),
      paint_required_kg: round2(paintWeight_kg),
    },
  };
}

module.exports = {
  ROAD_LAYER_DENSITIES,
  calculateRoadFillLayers,
  calculateBaseCourse,
  calculateAsphaltLayers,
  calculateSidewalks,
  calculateCurbstones,
  calculateRoadMarkings,
};
