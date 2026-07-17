const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER, DENSITIES } = require('../utils/constants');

const WATER_UNIT_WEIGHT_KN_m3 = 9.81; // وزن المياه النوعي (كيلونيوتن/م3) - قيمة فيزيائية ثابتة

/**
 * حساب الخزان الخرساني (مستطيل أو دائري) - أرضي أو علوي
 * يشمل حساب القاعدة، الجدران، السقف، الأعصاب، العزل، اللياسة
 * الضغط الهيدروستاتيكي محسوب فعلياً: P = γw × h (عند القاع) - معادلة هيدروستاتيكية حقيقية
 */
function calculateTank({
  tankShape = 'rectangular', // rectangular | circular
  location = 'ground',        // ground | elevated
  length_m,   // للمستطيل
  width_m,    // للمستطيل
  diameter_m, // للدائري
  waterHeight_m,
  freeboard_m = 0.3, // فراغ أمان أعلى منسوب المياه
  baseThickness_mm,
  wallThickness_mm,
  roofThickness_mm,
  hasRibs = false,
  ribCount = 0,
  ribWidth_mm = 200,
  ribDepth_mm = 300,
  insulationThickness_mm = 0,     // العزل المائي
  insulationCostPerM2 = 0,
  internalPlasterThickness_mm = 20,
  externalPlasterThickness_mm = 20,
  plasterCostPerM2 = 0,
  mainBarDiameter_mm = 12,
  barSpacing_mm = 150,
  concreteCover_mm = CONCRETE_COVER.water_tank,
  wastePercent = 0.05,
}) {
  const totalHeight_m = waterHeight_m + freeboard_m;

  let footprintArea_m2, perimeter_m, shapeLabel;
  if (tankShape === 'circular') {
    if (!diameter_m) throw new Error('يجب إدخال قطر الخزان الدائري');
    footprintArea_m2 = Math.PI * Math.pow(diameter_m / 2, 2);
    perimeter_m = Math.PI * diameter_m;
    shapeLabel = `دائري Ø${diameter_m}م`;
  } else {
    if (!length_m || !width_m) throw new Error('يجب إدخال طول وعرض الخزان المستطيل');
    footprintArea_m2 = length_m * width_m;
    perimeter_m = 2 * (length_m + width_m);
    shapeLabel = `مستطيل ${length_m}×${width_m}م`;
  }

  const waterVolume_m3 = footprintArea_m2 * waterHeight_m;

  // === القاعدة ===
  const baseThickness_m = baseThickness_mm / 1000;
  const baseVolume_m3 = footprintArea_m2 * baseThickness_m;

  // === الجدران ===
  const wallThickness_m = wallThickness_mm / 1000;
  const wallArea_m2 = perimeter_m * totalHeight_m; // مساحة سطح الجدار (محيط × ارتفاع)
  const wallVolume_m3 = wallArea_m2 * wallThickness_m;

  // === السقف ===
  const roofThickness_m = roofThickness_mm / 1000;
  const roofVolume_m3 = footprintArea_m2 * roofThickness_m;

  // === الأعصاب (لتقوية الجدران أو السقف في الخزانات الكبيرة) ===
  let ribsVolume_m3 = 0;
  if (hasRibs && ribCount > 0) {
    const ribLength_m = tankShape === 'circular' ? diameter_m : Math.max(length_m, width_m);
    ribsVolume_m3 = ribCount * (ribWidth_mm / 1000) * (ribDepth_mm / 1000) * ribLength_m;
  }

  const totalConcreteVolume_m3 = baseVolume_m3 + wallVolume_m3 + roofVolume_m3 + ribsVolume_m3;

  // === الضغط الهيدروستاتيكي الفعلي عند القاع (معادلة فيزيائية حقيقية P = γ×h) ===
  const hydrostaticPressureAtBase_kPa = WATER_UNIT_WEIGHT_KN_m3 * waterHeight_m;
  // القوة الأفقية الكلية على الجدار للمتر الطولي الواحد (محصلة توزيع مثلثي) = 0.5 × γ × h²
  const totalHorizontalForcePerMeter_kN = 0.5 * WATER_UNIT_WEIGHT_KN_m3 * Math.pow(waterHeight_m, 2);

  // === التسليح ===
  const cover_m = concreteCover_mm / 1000;
  const spacing_m = barSpacing_mm / 1000;

  // تسليح القاعدة (شبكة سفلية وعلوية)
  let baseBarsX, baseBarsY;
  if (tankShape === 'circular') {
    baseBarsX = Math.floor(diameter_m / spacing_m) + 1;
    baseBarsY = baseBarsX;
  } else {
    baseBarsX = Math.floor(width_m / spacing_m) + 1;
    baseBarsY = Math.floor(length_m / spacing_m) + 1;
  }
  const baseRebar = calculateRebarWeight([
    { description: 'تسليح قاعدة سفلي - X', diameter: mainBarDiameter_mm, length_m: (tankShape === 'circular' ? diameter_m : length_m) - 2 * cover_m, count: baseBarsX },
    { description: 'تسليح قاعدة سفلي - Y', diameter: mainBarDiameter_mm, length_m: (tankShape === 'circular' ? diameter_m : width_m) - 2 * cover_m, count: baseBarsY },
  ], wastePercent);

  // تسليح الجدران: أفقي (يقاوم الضغط الهيدروستاتيكي الحلقي) ورأسي
  const horizontalBarsCount = Math.floor(totalHeight_m / spacing_m) + 1;
  const verticalBarsCount = Math.floor(perimeter_m / spacing_m) + 1;
  const wallRebar = calculateRebarWeight([
    { description: 'تسليح جدار أفقي (مقاوم للضغط الهيدروستاتيكي)', diameter: mainBarDiameter_mm, length_m: perimeter_m, count: horizontalBarsCount },
    { description: 'تسليح جدار رأسي', diameter: mainBarDiameter_mm, length_m: totalHeight_m - cover_m, count: verticalBarsCount },
  ], wastePercent);

  // تسليح السقف (شبكة)
  const roofRebar = calculateRebarWeight([
    { description: 'تسليح سقف - X', diameter: mainBarDiameter_mm, length_m: (tankShape === 'circular' ? diameter_m : length_m) - 2 * cover_m, count: baseBarsX },
    { description: 'تسليح سقف - Y', diameter: mainBarDiameter_mm, length_m: (tankShape === 'circular' ? diameter_m : width_m) - 2 * cover_m, count: baseBarsY },
  ], wastePercent);

  const totalSteelWeight = baseRebar.total_weight_kg + wallRebar.total_weight_kg + roofRebar.total_weight_kg;

  // === العزل واللياسة ===
  const wetSurfaceArea_m2 = footprintArea_m2 + wallArea_m2; // القاعدة + الجدران (السطح الملامس للمياه)
  const insulationArea_m2 = insulationThickness_mm > 0 ? wetSurfaceArea_m2 : 0;
  const insulationCost = insulationArea_m2 * insulationCostPerM2;

  const internalPlasterArea_m2 = wetSurfaceArea_m2 + footprintArea_m2; // القاعدة+الجدران الداخلية+أسفل السقف
  const externalPlasterArea_m2 = wallArea_m2; // الجدران الخارجية (للخزانات الأرضية المدفونة جزئياً أو العلوية)
  const plasterCost = (internalPlasterArea_m2 + externalPlasterArea_m2) * plasterCostPerM2;

  return {
    type: `خزان ${location === 'elevated' ? 'علوي' : 'أرضي'} - ${shapeLabel}`,
    capacity: {
      water_height_m: waterHeight_m,
      freeboard_m,
      total_height_m: round(totalHeight_m, 3),
      footprint_area_m2: round(footprintArea_m2, 3),
      water_volume_m3: round(waterVolume_m3, 3),
      water_volume_liters: round(waterVolume_m3 * 1000, 0),
    },
    hydrostatic_analysis: {
      pressure_at_base_kPa: round(hydrostaticPressureAtBase_kPa, 2),
      total_horizontal_force_per_meter_kN: round(totalHorizontalForcePerMeter_kN, 2),
    },
    concrete_volumes: {
      base_m3: round(baseVolume_m3, 4),
      walls_m3: round(wallVolume_m3, 4),
      roof_m3: round(roofVolume_m3, 4),
      ribs_m3: round(ribsVolume_m3, 4),
      total_m3: round(totalConcreteVolume_m3, 4),
    },
    reinforcement: {
      base: baseRebar,
      walls: wallRebar,
      roof: roofRebar,
      total_steel_weight_kg: round(totalSteelWeight, 2),
      total_steel_weight_ton: round(totalSteelWeight / 1000, 4),
    },
    finishes: {
      insulation_area_m2: round(insulationArea_m2, 3),
      insulation_cost: round(insulationCost, 2),
      internal_plaster_area_m2: round(internalPlasterArea_m2, 3),
      external_plaster_area_m2: round(externalPlasterArea_m2, 3),
      plaster_cost: round(plasterCost, 2),
    },
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculateTank };
