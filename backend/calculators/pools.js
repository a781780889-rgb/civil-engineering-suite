const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * حساب المسبح - مستطيل، دائري، أو حر الشكل (بمساحة ومحيط مُدخلين مباشرة)
 * يشمل: الحفر، الخرسانة، الحديد، العزل، البلاط، اللياسة، المضخات، الفلاتر، التكلفة الكاملة
 */
function calculatePool({
  poolShape = 'rectangular', // rectangular | circular | freeform
  length_m,
  width_m,
  diameter_m,
  freeformArea_m2,
  freeformPerimeter_m,
  shallowDepth_m,   // العمق عند الطرف الضحل
  deepDepth_m,      // العمق عند الطرف العميق
  wallThickness_mm,
  floorThickness_mm,
  excavationMargin_m = 0.5, // هامش الحفر الإضافي حول المسبح للعمل
  mainBarDiameter_mm = 12,
  barSpacing_mm = 150,
  concreteCover_mm = CONCRETE_COVER.pool,
  wastePercent = 0.05,
  waterproofingCostPerM2 = 0,
  tilingCostPerM2 = 0,
  plasterCostPerM2 = 0,
  pumpFlowRate_m3_per_hour, // معدل تدفق المضخة (لحساب عدد دورات الفلترة اللازمة)
  pumpCost = 0,
  filterCost = 0,
  excavationCostPerM3 = 0,
}) {
  if (!shallowDepth_m || !deepDepth_m || !wallThickness_mm || !floorThickness_mm) {
    throw new Error('يجب إدخال عمق الطرف الضحل والعميق وسماكة الجدران والأرضية');
  }

  const averageDepth_m = (shallowDepth_m + deepDepth_m) / 2;

  let surfaceArea_m2, perimeter_m, shapeLabel;
  if (poolShape === 'circular') {
    if (!diameter_m) throw new Error('يجب إدخال قطر المسبح الدائري');
    surfaceArea_m2 = Math.PI * Math.pow(diameter_m / 2, 2);
    perimeter_m = Math.PI * diameter_m;
    shapeLabel = `دائري Ø${diameter_m}م`;
  } else if (poolShape === 'freeform') {
    if (!freeformArea_m2 || !freeformPerimeter_m) throw new Error('يجب إدخال المساحة والمحيط للمسبح حر الشكل');
    surfaceArea_m2 = freeformArea_m2;
    perimeter_m = freeformPerimeter_m;
    shapeLabel = 'حر الشكل';
  } else {
    if (!length_m || !width_m) throw new Error('يجب إدخال طول وعرض المسبح المستطيل');
    surfaceArea_m2 = length_m * width_m;
    perimeter_m = 2 * (length_m + width_m);
    shapeLabel = `مستطيل ${length_m}×${width_m}م`;
  }

  // حجم المياه الفعلي (بمتوسط العمق - يمثل الشكل المنحدر الحقيقي لقاع المسبح)
  const waterVolume_m3 = surfaceArea_m2 * averageDepth_m;

  // === الحفر ===
  // أبعاد الحفر = أبعاد المسبح + هامش عمل على كل جانب، وعمق = العمق الأقصى + سمك الأرضية
  let excavationArea_m2;
  if (poolShape === 'rectangular') {
    excavationArea_m2 = (length_m + 2 * excavationMargin_m) * (width_m + 2 * excavationMargin_m);
  } else if (poolShape === 'circular') {
    excavationArea_m2 = Math.PI * Math.pow(diameter_m / 2 + excavationMargin_m, 2);
  } else {
    // للشكل الحر: تقدير هامشي بإضافة شريط بعرض الهامش حول المحيط: A' ≈ A + P×margin + π×margin²
    excavationArea_m2 = surfaceArea_m2 + perimeter_m * excavationMargin_m + Math.PI * Math.pow(excavationMargin_m, 2);
  }
  const excavationDepth_m = deepDepth_m + (floorThickness_mm / 1000);
  const excavationVolume_m3 = excavationArea_m2 * excavationDepth_m;
  const excavationCost = excavationVolume_m3 * excavationCostPerM3;

  // === الخرسانة ===
  const floorThickness_m = floorThickness_mm / 1000;
  const floorVolume_m3 = surfaceArea_m2 * floorThickness_m;

  const wallThickness_m = wallThickness_mm / 1000;
  // مساحة سطح الجدار الجانبي = المحيط × متوسط العمق (يمثل الشكل المنحدر فعلياً)
  const wallSurfaceArea_m2 = perimeter_m * averageDepth_m;
  const wallVolume_m3 = wallSurfaceArea_m2 * wallThickness_m;

  const totalConcreteVolume_m3 = floorVolume_m3 + wallVolume_m3;

  // === التسليح ===
  const cover_m = concreteCover_mm / 1000;
  const spacing_m = barSpacing_mm / 1000;

  let floorBarsX, floorBarsY, xLen, yLen;
  if (poolShape === 'rectangular') {
    floorBarsX = Math.floor(width_m / spacing_m) + 1;
    floorBarsY = Math.floor(length_m / spacing_m) + 1;
    xLen = length_m - 2 * cover_m;
    yLen = width_m - 2 * cover_m;
  } else {
    const equivSide = Math.sqrt(surfaceArea_m2);
    floorBarsX = Math.floor(equivSide / spacing_m) + 1;
    floorBarsY = floorBarsX;
    xLen = equivSide - 2 * cover_m;
    yLen = equivSide - 2 * cover_m;
  }

  const floorRebar = calculateRebarWeight([
    { description: 'تسليح أرضية سفلي - X', diameter: mainBarDiameter_mm, length_m: xLen, count: floorBarsX },
    { description: 'تسليح أرضية علوي - Y', diameter: mainBarDiameter_mm, length_m: yLen, count: floorBarsY },
  ], wastePercent);

  const wallHorizontalBars = Math.floor(averageDepth_m / spacing_m) + 1;
  const wallVerticalBars = Math.floor(perimeter_m / spacing_m) + 1;
  const wallRebar = calculateRebarWeight([
    { description: 'تسليح جدار أفقي', diameter: mainBarDiameter_mm, length_m: perimeter_m, count: wallHorizontalBars },
    { description: 'تسليح جدار رأسي', diameter: mainBarDiameter_mm, length_m: averageDepth_m - cover_m, count: wallVerticalBars },
  ], wastePercent);

  const totalSteelWeight = floorRebar.total_weight_kg + wallRebar.total_weight_kg;

  // === العزل والتشطيبات ===
  const totalWetArea_m2 = surfaceArea_m2 + wallSurfaceArea_m2; // الأرضية + الجدران (السطح الملامس للماء)
  const waterproofingCost = totalWetArea_m2 * waterproofingCostPerM2;
  const tilingCost = totalWetArea_m2 * tilingCostPerM2;
  const plasterCost = totalWetArea_m2 * plasterCostPerM2;

  // === المضخات والفلاتر ===
  // معدل الدوران المطلوب: يُنصح فنياً بدورة فلترة كل 6-8 ساعات لحجم المياه الكلي
  let filtrationCycles = null;
  if (pumpFlowRate_m3_per_hour) {
    const hoursForFullCycle = waterVolume_m3 / pumpFlowRate_m3_per_hour;
    filtrationCycles = {
      hours_per_full_cycle: round(hoursForFullCycle, 2),
      recommended_daily_cycles: round(24 / hoursForFullCycle, 2),
    };
  }

  const totalCost = excavationCost + waterproofingCost + tilingCost + plasterCost + pumpCost + filterCost;

  return {
    type: `مسبح ${shapeLabel}`,
    dimensions: {
      shallow_depth_m: shallowDepth_m,
      deep_depth_m: deepDepth_m,
      average_depth_m: round(averageDepth_m, 3),
      surface_area_m2: round(surfaceArea_m2, 3),
      perimeter_m: round(perimeter_m, 3),
    },
    water_volume_m3: round(waterVolume_m3, 3),
    water_volume_liters: round(waterVolume_m3 * 1000, 0),
    excavation: {
      area_m2: round(excavationArea_m2, 3),
      depth_m: round(excavationDepth_m, 3),
      volume_m3: round(excavationVolume_m3, 3),
      cost: round(excavationCost, 2),
    },
    concrete_volumes: {
      floor_m3: round(floorVolume_m3, 4),
      walls_m3: round(wallVolume_m3, 4),
      total_m3: round(totalConcreteVolume_m3, 4),
    },
    reinforcement: {
      floor: floorRebar,
      walls: wallRebar,
      total_steel_weight_kg: round(totalSteelWeight, 2),
      total_steel_weight_ton: round(totalSteelWeight / 1000, 4),
    },
    finishes_and_equipment: {
      wet_area_m2: round(totalWetArea_m2, 3),
      waterproofing_cost: round(waterproofingCost, 2),
      tiling_cost: round(tilingCost, 2),
      plaster_cost: round(plasterCost, 2),
      pump_cost: pumpCost,
      filter_cost: filterCost,
      filtration_analysis: filtrationCycles,
    },
    total_cost: round(totalCost, 2),
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculatePool };
