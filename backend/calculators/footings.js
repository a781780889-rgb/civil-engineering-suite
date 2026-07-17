const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * القواعد المنفصلة (Isolated Footings)
 * الحساب يعتمد على الأبعاد الفعلية للقاعدة (طول × عرض × ارتفاع) المُدخلة من المستخدم
 * وليس على معامل تقريبي. يتم أيضاً حساب ضغط التربة الفعلي والتحقق من كفايته.
 *
 * المدخلات:
 * length_m, width_m, depth_m: أبعاد القاعدة
 * columnLength_m, columnWidth_m: أبعاد العمود الجالس على القاعدة (لحساب صافي البروز)
 * appliedLoad_kN: الحمل الواصل من العمود (كيلونيوتن)
 * allowableSoilPressure_kPa: تحمل التربة المسموح (كيلوباسكال) - قيمة من تقرير التربة
 * mainBarDiameter_mm, distributionBarDiameter_mm: أقطار التسليح
 * barSpacing_mm: التباعد بين الأسياخ
 */
function calculateIsolatedFooting({
  length_m,
  width_m,
  depth_m,
  columnLength_m,
  columnWidth_m,
  appliedLoad_kN,
  allowableSoilPressure_kPa,
  mainBarDiameter_mm = 16,
  distributionBarDiameter_mm = 16,
  barSpacing_mm = 150,
  concreteCover_mm = CONCRETE_COVER.footing_bottom,
  wastePercent = 0.05,
}) {
  if (!length_m || !width_m || !depth_m) {
    throw new Error('يجب إدخال أبعاد القاعدة (الطول والعرض والعمق)');
  }

  // مساحة القاعدة الفعلية
  const area_m2 = length_m * width_m;

  // ضغط التربة الفعلي الناتج عن الحمل المطبق
  let actualSoilPressure_kPa = null;
  let soilPressureCheck = null;
  if (appliedLoad_kN && appliedLoad_kN > 0) {
    actualSoilPressure_kPa = appliedLoad_kN / area_m2;
    if (allowableSoilPressure_kPa) {
      soilPressureCheck = {
        actual_kPa: round(actualSoilPressure_kPa, 2),
        allowable_kPa: allowableSoilPressure_kPa,
        safe: actualSoilPressure_kPa <= allowableSoilPressure_kPa,
        utilization_percent: round((actualSoilPressure_kPa / allowableSoilPressure_kPa) * 100, 1),
      };
    }
  }

  // حجم الخرسانة الصافي (طول × عرض × عمق) - أبعاد حقيقية بدون معامل تقريبي
  const volume_m3 = length_m * width_m * depth_m;

  // حساب التسليح: طول القضيب الفعلي = بعد القاعدة ناقص غطاءين خرسانيين (على الجانبين)
  const cover_m = concreteCover_mm / 1000;
  const effectiveLengthX = length_m - 2 * cover_m;
  const effectiveLengthY = width_m - 2 * cover_m;
  const spacing_m = barSpacing_mm / 1000;

  // عدد الأسياخ في كل اتجاه = (البعد العمودي على اتجاه السيخ / التباعد) + 1
  const barsInX = Math.floor(width_m / spacing_m) + 1;   // أسياخ موازية لـ X تتوزع عبر العرض Y
  const barsInY = Math.floor(length_m / spacing_m) + 1;  // أسياخ موازية لـ Y تتوزع عبر الطول X

  const rebarGroups = [
    {
      description: 'تسليح سفلي - اتجاه طولي (X)',
      diameter: mainBarDiameter_mm,
      length_m: effectiveLengthX,
      count: barsInX,
    },
    {
      description: 'تسليح سفلي - اتجاه عرضي (Y)',
      diameter: distributionBarDiameter_mm,
      length_m: effectiveLengthY,
      count: barsInY,
    },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  // بروز القاعدة خارج العمود (Punching shear perimeter reference)
  let projectionX = null, projectionY = null;
  if (columnLength_m && columnWidth_m) {
    projectionX = round((length_m - columnLength_m) / 2, 3);
    projectionY = round((width_m - columnWidth_m) / 2, 3);
  }

  return {
    type: 'قاعدة منفصلة (Isolated Footing)',
    dimensions: { length_m, width_m, depth_m },
    area_m2: round(area_m2, 3),
    volume_m3: round(volume_m3, 4),
    soil_pressure: soilPressureCheck || (actualSoilPressure_kPa ? { actual_kPa: round(actualSoilPressure_kPa, 2) } : null),
    column_projection: projectionX !== null ? { projection_x_m: projectionX, projection_y_m: projectionY } : null,
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

/**
 * القواعد المشتركة (Combined Footings) - لعمودين أو أكثر
 * يتم حساب مركز الثقل الفعلي لتوزيع الأحمال وتحديد أبعاد القاعدة بحيث ينطبق محصلة
 * الأحمال مع مركز مساحة القاعدة (شرط أساسي في تصميم القواعد المشتركة الحقيقي)
 */
function calculateCombinedFooting({
  columns, // [{ name, load_kN, position_m }] المسافة من نقطة مرجعية
  width_m,
  depth_m,
  allowableSoilPressure_kPa,
  mainBarDiameter_mm = 16,
  topBarDiameter_mm = 16,
  barSpacing_mm = 150,
  concreteCover_mm = CONCRETE_COVER.footing_bottom,
  wastePercent = 0.05,
}) {
  if (!columns || columns.length < 2) {
    throw new Error('القاعدة المشتركة تتطلب عمودين على الأقل مع أحمالهما ومواقعهما');
  }
  if (!width_m || !depth_m) {
    throw new Error('يجب إدخال عرض وعمق القاعدة المشتركة');
  }

  const totalLoad_kN = columns.reduce((sum, c) => sum + c.load_kN, 0);

  // مركز ثقل الأحمال (محصلة القوى) من النقطة المرجعية
  const loadCentroid_m = columns.reduce((sum, c) => sum + c.load_kN * c.position_m, 0) / totalLoad_kN;

  // لضمان توزيع ضغط منتظم، يجب أن يتطابق مركز القاعدة مع مركز الأحمال
  // نحسب طول القاعدة بحيث يمتد بالتساوي حول مركز الثقل مع تغطية أبعد عمود + بروز مناسب
  const positions = columns.map(c => c.position_m);
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);

  // البروز المطلوب من كل طرف حتى يتطابق مركز القاعدة الهندسي مع مركز الثقل
  const distFromCentroidToMin = loadCentroid_m - minPos;
  const distFromCentroidToMax = maxPos - loadCentroid_m;
  const halfLength = Math.max(distFromCentroidToMin, distFromCentroidToMax) + 0.3; // 0.3م بروز أدنى معياري
  const length_m = halfLength * 2;

  const area_m2 = length_m * width_m;
  const actualSoilPressure_kPa = totalLoad_kN / area_m2;

  const soilPressureCheck = allowableSoilPressure_kPa ? {
    actual_kPa: round(actualSoilPressure_kPa, 2),
    allowable_kPa: allowableSoilPressure_kPa,
    safe: actualSoilPressure_kPa <= allowableSoilPressure_kPa,
    utilization_percent: round((actualSoilPressure_kPa / allowableSoilPressure_kPa) * 100, 1),
  } : { actual_kPa: round(actualSoilPressure_kPa, 2) };

  const volume_m3 = length_m * width_m * depth_m;

  const cover_m = concreteCover_mm / 1000;
  const effLength = length_m - 2 * cover_m;
  const effWidth = width_m - 2 * cover_m;
  const spacing_m = barSpacing_mm / 1000;

  const barsLongitudinal = Math.floor(width_m / spacing_m) + 1;
  const barsTransverse = Math.floor(length_m / spacing_m) + 1;

  const rebarGroups = [
    { description: 'تسليح سفلي رئيسي (طولي - عزم موجب)', diameter: mainBarDiameter_mm, length_m: effLength, count: barsLongitudinal },
    { description: 'تسليح علوي (فوق الأعمدة - عزم سالب)', diameter: topBarDiameter_mm, length_m: effLength, count: barsLongitudinal },
    { description: 'تسليح توزيع عرضي', diameter: mainBarDiameter_mm, length_m: effWidth, count: barsTransverse },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'قاعدة مشتركة (Combined Footing)',
    columns_count: columns.length,
    total_load_kN: round(totalLoad_kN, 2),
    load_centroid_from_reference_m: round(loadCentroid_m, 3),
    calculated_dimensions: { length_m: round(length_m, 3), width_m, depth_m },
    area_m2: round(area_m2, 3),
    volume_m3: round(volume_m3, 4),
    soil_pressure: soilPressureCheck,
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

/**
 * القاعدة الشريطية (Strip / Strap Footing) - تمتد أسفل جدار أو صف أعمدة
 */
function calculateStripFooting({
  totalLength_m,
  width_m,
  depth_m,
  loadPerMeter_kN_m,
  allowableSoilPressure_kPa,
  mainBarDiameter_mm = 14,
  distributionBarDiameter_mm = 12,
  barSpacing_mm = 200,
  concreteCover_mm = CONCRETE_COVER.footing_bottom,
  wastePercent = 0.05,
}) {
  if (!totalLength_m || !width_m || !depth_m) {
    throw new Error('يجب إدخال الطول الكلي والعرض والعمق للقاعدة الشريطية');
  }

  const area_m2 = totalLength_m * width_m;
  const volume_m3 = area_m2 * depth_m;

  let soilPressureCheck = null;
  if (loadPerMeter_kN_m) {
    const actual = loadPerMeter_kN_m / width_m;
    soilPressureCheck = allowableSoilPressure_kPa ? {
      actual_kPa: round(actual, 2),
      allowable_kPa: allowableSoilPressure_kPa,
      safe: actual <= allowableSoilPressure_kPa,
      utilization_percent: round((actual / allowableSoilPressure_kPa) * 100, 1),
    } : { actual_kPa: round(actual, 2) };
  }

  const cover_m = concreteCover_mm / 1000;
  const spacing_m = barSpacing_mm / 1000;
  const transverseBarsCount = Math.floor(totalLength_m / spacing_m) + 1;
  const longitudinalBarsCount = Math.max(2, Math.floor(width_m / 0.2)); // أسياخ توزيع طولية كل 20سم تقريباً كحد أدنى تنظيمي، معدّلة حسب العرض

  const rebarGroups = [
    { description: 'تسليح رئيسي عرضي (تحت الجدار/الأعمدة)', diameter: mainBarDiameter_mm, length_m: width_m - 2 * cover_m, count: transverseBarsCount },
    { description: 'تسليح توزيع طولي', diameter: distributionBarDiameter_mm, length_m: totalLength_m - 2 * cover_m, count: longitudinalBarsCount },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'قاعدة شريطية (Strip Footing)',
    dimensions: { totalLength_m, width_m, depth_m },
    area_m2: round(area_m2, 3),
    volume_m3: round(volume_m3, 4),
    soil_pressure: soilPressureCheck,
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

/**
 * قاعدة الرابطة (Strap Footing) - قاعدتان منفصلتان مرتبطتان بكمرة رابطة (Strap Beam)
 * لنقل جزء من عزم القاعدة الخارجية اللامركزية إلى القاعدة الداخلية
 */
function calculateStrapFooting({
  exteriorFooting, // { length_m, width_m, depth_m }
  interiorFooting, // { length_m, width_m, depth_m }
  strapBeam, // { length_m, width_m, depth_m }
  exteriorLoad_kN,
  interiorLoad_kN,
  allowableSoilPressure_kPa,
  mainBarDiameter_mm = 16,
  wastePercent = 0.05,
}) {
  if (!exteriorFooting || !interiorFooting || !strapBeam) {
    throw new Error('يجب إدخال أبعاد القاعدة الخارجية والداخلية وكمرة الرابطة');
  }

  const extVolume = exteriorFooting.length_m * exteriorFooting.width_m * exteriorFooting.depth_m;
  const intVolume = interiorFooting.length_m * interiorFooting.width_m * interiorFooting.depth_m;
  const strapVolume = strapBeam.length_m * strapBeam.width_m * strapBeam.depth_m;
  const totalVolume = extVolume + intVolume + strapVolume;

  const extArea = exteriorFooting.length_m * exteriorFooting.width_m;
  const intArea = interiorFooting.length_m * interiorFooting.width_m;

  const results = {
    type: 'قاعدة رابطة (Strap Footing)',
    exterior_footing: {
      dimensions: exteriorFooting,
      volume_m3: round(extVolume, 4),
      soil_pressure_kPa: exteriorLoad_kN ? round(exteriorLoad_kN / extArea, 2) : null,
    },
    interior_footing: {
      dimensions: interiorFooting,
      volume_m3: round(intVolume, 4),
      soil_pressure_kPa: interiorLoad_kN ? round(interiorLoad_kN / intArea, 2) : null,
    },
    strap_beam: {
      dimensions: strapBeam,
      volume_m3: round(strapVolume, 4),
    },
    total_volume_m3: round(totalVolume, 4),
    allowable_soil_pressure_kPa: allowableSoilPressure_kPa || null,
  };

  return results;
}

/**
 * اللبشة (Raft / Mat Foundation) - تغطي كامل مسطح المبنى
 */
function calculateRaftFoundation({
  length_m,
  width_m,
  thickness_m,
  totalBuildingLoad_kN,
  allowableSoilPressure_kPa,
  topBarDiameter_mm = 18,
  bottomBarDiameter_mm = 18,
  barSpacing_mm = 200,
  concreteCover_mm = CONCRETE_COVER.footing_bottom,
  wastePercent = 0.05,
}) {
  if (!length_m || !width_m || !thickness_m) {
    throw new Error('يجب إدخال طول وعرض وسمك اللبشة');
  }

  const area_m2 = length_m * width_m;
  const volume_m3 = area_m2 * thickness_m;

  let soilPressureCheck = null;
  if (totalBuildingLoad_kN) {
    const actual = totalBuildingLoad_kN / area_m2;
    soilPressureCheck = allowableSoilPressure_kPa ? {
      actual_kPa: round(actual, 2),
      allowable_kPa: allowableSoilPressure_kPa,
      safe: actual <= allowableSoilPressure_kPa,
      utilization_percent: round((actual / allowableSoilPressure_kPa) * 100, 1),
    } : { actual_kPa: round(actual, 2) };
  }

  const cover_m = concreteCover_mm / 1000;
  const spacing_m = barSpacing_mm / 1000;
  const barsAlongWidth = Math.floor(length_m / spacing_m) + 1;  // تمتد عبر العرض
  const barsAlongLength = Math.floor(width_m / spacing_m) + 1; // تمتد عبر الطول

  const rebarGroups = [
    { description: 'شبكة سفلية - اتجاه X', diameter: bottomBarDiameter_mm, length_m: width_m - 2 * cover_m, count: barsAlongLength },
    { description: 'شبكة سفلية - اتجاه Y', diameter: bottomBarDiameter_mm, length_m: length_m - 2 * cover_m, count: barsAlongWidth },
    { description: 'شبكة علوية - اتجاه X', diameter: topBarDiameter_mm, length_m: width_m - 2 * cover_m, count: barsAlongLength },
    { description: 'شبكة علوية - اتجاه Y', diameter: topBarDiameter_mm, length_m: length_m - 2 * cover_m, count: barsAlongWidth },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'لبشة (Raft Foundation)',
    dimensions: { length_m, width_m, thickness_m },
    area_m2: round(area_m2, 3),
    volume_m3: round(volume_m3, 4),
    soil_pressure: soilPressureCheck,
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = {
  calculateIsolatedFooting,
  calculateCombinedFooting,
  calculateStripFooting,
  calculateStrapFooting,
  calculateRaftFoundation,
};
