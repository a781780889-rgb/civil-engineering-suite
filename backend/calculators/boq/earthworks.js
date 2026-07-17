/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الجزء الأول: الحسابات الهندسية
 * ==========================================
 * أعمال التربة (Earthworks)
 * جميع الحسابات تعتمد على الأبعاد الفعلية وطرق الحصر الهندسية المعتمدة
 * (طريقة المقاطع العرضية - Average End Area Method) وليس معاملات تقريبية.
 */

const { DENSITIES } = require('../../utils/constants');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

// كثافات التربة النمطية (طن/م3) قابلة للتعديل من المستخدم حسب تقرير التربة
const SOIL_DENSITIES = {
  loose_soil: 1.45,      // تربة سائبة (بعد الحفر)
  natural_soil: 1.65,    // تربة طبيعية (قبل الحفر - Bank)
  compacted_soil: 1.85,  // تربة مدموكة
  sand: 1.6,
  gravel_fill: 1.7,
  rock: 2.6,
};

// معاملات الانتفاخ والانضغاط القياسية للتربة (Swell / Shrinkage Factors)
// Swell Factor: نسبة زيادة حجم التربة بعد الحفر (سائبة) بالنسبة لحالتها الطبيعية
const SWELL_SHRINK_FACTORS = {
  clay: { swell: 1.30, shrink: 0.90 },
  sandy_soil: { swell: 1.15, shrink: 0.95 },
  gravel: { swell: 1.12, shrink: 0.97 },
  rock: { swell: 1.50, shrink: 1.00 },
  mixed: { swell: 1.20, shrink: 0.92 },
};

/**
 * حساب حجم الحفر لحفرة منتظمة (قواعد، سرداب، أساسات عامة)
 * باستخدام طريقة الهرم الناقص (Prismoidal / Frustum) عند وجود ميول جانبية (Side Slope)
 * V = (H/3) × (A1 + A2 + sqrt(A1×A2))
 */
function calculateExcavationVolume({
  length_m,
  width_m,
  depth_m,
  sideSlope = 0, // نسبة الميل الجانبي H:V، مثال 0.5 يعني كل 1م عمق => 0.5م أفقي إضافي لكل جهة
  soilType = 'mixed',
  bulkingAllowance_percent = null, // إن لم يُدخل، يُستخدم معامل الانتفاخ القياسي لنوع التربة
  workingSpace_m = 0, // مساحة عمل إضافية حول القاعدة (لصب الشدة/العزل)
}) {
  if (!length_m || !width_m || !depth_m) {
    throw new Error('يجب إدخال الطول والعرض والعمق لحساب حجم الحفر');
  }

  const L1 = length_m + 2 * workingSpace_m;
  const W1 = width_m + 2 * workingSpace_m;
  const A1 = L1 * W1; // مساحة القاع

  // أبعاد السطح العلوي بعد أخذ الميل الجانبي بعين الاعتبار
  const horizontalOffset = sideSlope * depth_m;
  const L2 = L1 + 2 * horizontalOffset;
  const W2 = W1 + 2 * horizontalOffset;
  const A2 = L2 * W2; // مساحة السطح العلوي

  const volume_m3 = (depth_m / 3) * (A1 + A2 + Math.sqrt(A1 * A2));

  const factors = SWELL_SHRINK_FACTORS[soilType] || SWELL_SHRINK_FACTORS.mixed;
  const swellFactor = bulkingAllowance_percent != null
    ? 1 + bulkingAllowance_percent / 100
    : factors.swell;

  const looseVolume_m3 = volume_m3 * swellFactor; // الحجم بعد الانتفاخ (لحساب عدد الشاحنات)
  const naturalDensity = SOIL_DENSITIES.natural_soil;
  const weight_tons = volume_m3 * naturalDensity;

  return {
    method: 'Frustum / Prismoidal Method',
    bottom_area_m2: round2(A1),
    top_area_m2: round2(A2),
    bank_volume_m3: round3(volume_m3), // الحجم الطبيعي قبل الحفر (Bank Measure)
    loose_volume_m3: round3(looseVolume_m3), // الحجم بعد الحفر (Loose Measure) لحساب عدد الشاحنات
    swell_factor: swellFactor,
    estimated_weight_tons: round2(weight_tons),
    soil_type: soilType,
    side_slope_used: sideSlope,
  };
}

/**
 * حساب حجم الحفر لشريط أساس مستمر (Strip / Trench Excavation) بطول المسار
 * باستخدام طريقة المقاطع العرضية المتوسطة (Average End Area) لمسارات بعمق متغير
 */
function calculateTrenchExcavation({
  segments, // [{length_m, width_m, depth_m}, ...] لكل جزء من الخندق
  sideSlope = 0,
  soilType = 'mixed',
}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('يجب إدخال مقاطع الخندق (segments) لحساب الحفر');
  }

  let totalVolume = 0;
  const segmentResults = segments.map((seg, idx) => {
    const { length_m, width_m, depth_m } = seg;
    if (!length_m || !width_m || !depth_m) {
      throw new Error(`بيانات ناقصة في المقطع رقم ${idx + 1}`);
    }
    const topWidth = width_m + 2 * sideSlope * depth_m;
    const avgWidth = (width_m + topWidth) / 2;
    const volume = avgWidth * depth_m * length_m;
    totalVolume += volume;
    return { segment: idx + 1, length_m, width_m, depth_m, volume_m3: round3(volume) };
  });

  const factors = SWELL_SHRINK_FACTORS[soilType] || SWELL_SHRINK_FACTORS.mixed;
  const looseVolume = totalVolume * factors.swell;

  return {
    method: 'Average End Area Method (Trench)',
    segments: segmentResults,
    total_bank_volume_m3: round3(totalVolume),
    total_loose_volume_m3: round3(looseVolume),
    soil_type: soilType,
  };
}

/**
 * حساب حجم أعمال الحفر لموقع كامل (Mass Excavation) اعتماداً على شبكة مناسيب (Grid Method)
 * يُستخدم عند توفر قراءات مساحية (مناسيب طبيعية ومناسيب تصميم) على شبكة منتظمة
 * الطريقة: Four Point / Grid Method — الأكثر دقة واعتماداً في حصر الكميات الحقيقي
 */
function calculateMassExcavationGrid({
  gridSizeX_m,
  gridSizeY_m,
  cells, // [{cutOrFill: 'cut'|'fill', corners_m: [h1,h2,h3,h4]}, ...] فروق المنسوب على أركان كل خلية
}) {
  if (!gridSizeX_m || !gridSizeY_m || !Array.isArray(cells) || cells.length === 0) {
    throw new Error('يجب إدخال أبعاد الشبكة وقيم فروق المناسيب لكل خلية');
  }
  const cellArea = gridSizeX_m * gridSizeY_m;
  let totalCut = 0;
  let totalFill = 0;

  const cellResults = cells.map((cell, idx) => {
    const { corners_m, cutOrFill } = cell;
    if (!Array.isArray(corners_m) || corners_m.length !== 4) {
      throw new Error(`يجب إدخال 4 قيم مناسيب لأركان الخلية رقم ${idx + 1}`);
    }
    const avgHeight = corners_m.reduce((a, b) => a + b, 0) / 4;
    const volume = cellArea * avgHeight;
    if (cutOrFill === 'fill') totalFill += volume;
    else totalCut += volume;
    return {
      cell: idx + 1,
      type: cutOrFill === 'fill' ? 'ردم' : 'حفر',
      avg_height_m: round3(avgHeight),
      volume_m3: round3(volume),
    };
  });

  return {
    method: 'Grid Method (Four-Point) - Mass Earthwork',
    cell_area_m2: round2(cellArea),
    cells: cellResults,
    total_cut_volume_m3: round3(totalCut),
    total_fill_volume_m3: round3(totalFill),
    net_volume_m3: round3(totalCut - totalFill),
    net_direction: totalCut >= totalFill ? 'فائض حفر (يحتاج نقل للخارج)' : 'عجز يحتاج ردم توريد',
  };
}

/**
 * حساب أعمال الردم والدك (Filling & Compaction)
 * يأخذ بعين الاعتبار معامل الانضغاط (Compaction Factor) لتحويل حجم الردم الفضفاض إلى حجم مدموك
 */
function calculateFillingCompaction({
  volume_required_m3, // الحجم المطلوب بعد الدك (Compacted / In-place Volume)
  soilType = 'mixed',
  compactionFactor = null, // إن لم يُدخل، يُستخدم معامل نوع التربة
  layerThickness_m = 0.2, // سماكة الطبقة الواحدة قبل الدك (نمطي 20-30 سم)
  compactionPasses = 6, // عدد مرات المرور بالمدحلة (معلوماتي)
}) {
  if (!volume_required_m3) throw new Error('يجب إدخال الحجم المطلوب من الردم بعد الدك');

  const factors = SWELL_SHRINK_FACTORS[soilType] || SWELL_SHRINK_FACTORS.mixed;
  const factor = compactionFactor || (1 / factors.shrink); // الحجم الفضفاض اللازم = الحجم المدموك / معامل الانكماش

  const looseFillNeeded_m3 = volume_required_m3 * factor;
  const numberOfLayers = Math.ceil(volume_required_m3 > 0 ? (volume_required_m3 / (volume_required_m3 / Math.max(layerThickness_m, 0.01))) : 0);

  return {
    compacted_volume_m3: round3(volume_required_m3),
    loose_fill_required_m3: round3(looseFillNeeded_m3),
    compaction_factor: round3(factor),
    layer_thickness_m: layerThickness_m,
    recommended_passes: compactionPasses,
    weight_tons: round2(volume_required_m3 * SOIL_DENSITIES.compacted_soil),
    soil_type: soilType,
  };
}

/**
 * حساب أعمال الإحلال (Soil Replacement) - استبدال تربة ضعيفة بردم هندسي منتقى
 */
function calculateSoilReplacement({
  length_m,
  width_m,
  depth_m,
  replacementMaterial = 'gravel_fill', // sand | gravel_fill
  compactionFactor = 0.90, // نسبة الدك المطلوبة (Proctor %) - معلوماتي
}) {
  if (!length_m || !width_m || !depth_m) {
    throw new Error('يجب إدخال أبعاد منطقة الإحلال (طول، عرض، عمق)');
  }
  const removedVolume_m3 = length_m * width_m * depth_m;
  const density = SOIL_DENSITIES[replacementMaterial] || SOIL_DENSITIES.gravel_fill;
  const materialWeight_tons = removedVolume_m3 * density;

  return {
    excavated_weak_soil_volume_m3: round3(removedVolume_m3),
    replacement_material: replacementMaterial,
    replacement_volume_m3: round3(removedVolume_m3),
    replacement_weight_tons: round2(materialWeight_tons),
    required_compaction_percent: compactionFactor * 100,
  };
}

/**
 * حساب أعمال الدفان (Backfilling) حول الأساسات والجدران الاستنادية
 * الحجم = حجم الحفر الكلي - حجم العنصر الإنشائي المغمور بالتربة
 */
function calculateBackfilling({
  excavationVolume_m3,
  structureVolumeBelowGrade_m3, // حجم الخرسانة/البناء المدفون داخل الحفرة
  soilType = 'mixed',
}) {
  if (excavationVolume_m3 == null || structureVolumeBelowGrade_m3 == null) {
    throw new Error('يجب إدخال حجم الحفر وحجم العنصر الإنشائي المدفون');
  }
  const backfillVolume = Math.max(excavationVolume_m3 - structureVolumeBelowGrade_m3, 0);
  const factors = SWELL_SHRINK_FACTORS[soilType] || SWELL_SHRINK_FACTORS.mixed;

  return {
    backfill_compacted_volume_m3: round3(backfillVolume),
    loose_material_required_m3: round3(backfillVolume / factors.shrink),
    weight_tons: round2(backfillVolume * SOIL_DENSITIES.compacted_soil),
  };
}

/**
 * حساب نقل المخلفات (Spoil Removal / Disposal) - عدد الشحنات والتكلفة التقديرية
 */
function calculateSpoilDisposal({
  looseVolume_m3, // الحجم الفضفاض الناتج عن الحفر (Loose Measure)
  truckCapacity_m3 = 10, // سعة الشاحنة (م3) - نمطي 10-15م3 لشاحنة قلاب متوسطة
  haulDistance_km = 5,
  truckSpeed_kmh = 30, // سرعة تشغيلية متوسطة (تحميل+نقل+تفريغ+عودة)
  loadingTime_min = 10,
  unloadingTime_min = 5,
}) {
  if (!looseVolume_m3) throw new Error('يجب إدخال الحجم الفضفاض الناتج عن الحفر');

  const numberOfTrips = Math.ceil(looseVolume_m3 / truckCapacity_m3);
  const travelTimePerTrip_min = (haulDistance_km * 2 / truckSpeed_kmh) * 60; // ذهاب وعودة
  const totalCycleTime_min = travelTimePerTrip_min + loadingTime_min + unloadingTime_min;
  const totalHours = (numberOfTrips * totalCycleTime_min) / 60;

  return {
    loose_volume_m3: round3(looseVolume_m3),
    truck_capacity_m3: truckCapacity_m3,
    number_of_trips: numberOfTrips,
    cycle_time_per_trip_min: round2(totalCycleTime_min),
    total_estimated_hours: round2(totalHours),
    haul_distance_km: haulDistance_km,
  };
}

module.exports = {
  SOIL_DENSITIES,
  SWELL_SHRINK_FACTORS,
  calculateExcavationVolume,
  calculateTrenchExcavation,
  calculateMassExcavationGrid,
  calculateFillingCompaction,
  calculateSoilReplacement,
  calculateBackfilling,
  calculateSpoilDisposal,
};
