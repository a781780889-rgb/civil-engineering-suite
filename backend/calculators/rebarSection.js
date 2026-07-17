/**
 * ============================================================
 *  القسم الثاني: حاسبة حديد التسليح (Reinforcement Steel Calculator)
 * ============================================================
 * موديول احترافي متكامل مبني على المعايير الهندسية الفعلية (ACI 318-19 كافتراضي،
 * مع دعم BS 8110 / Eurocode 2 كخيار مرجعي). لا معاملات ثابتة تقريبية.
 *
 * يوفر لكل عنصر إنشائي:
 *   - عدد وأطوال القضبان الفعلية (بالاعتماد على حاسبات الأبعاد الحقيقية للعناصر)
 *   - عدد الأسياخ التجارية (12م) اللازمة
 *   - أطوال الكانات الحقيقية من مكتبة الأشكال (شامل الخطافات)
 *   - أطوال التراكب (Lap) والتثبيت (Development Length) وفق ACI 318
 *   - الأوزان الصافية والإجمالية (شاملة الهدر)
 *   - التكلفة الكاملة (مادة + قص + ثني + تركيب + نقل + ضرائب)
 *   - نتائج فحوصات التصميم التلقائية
 */

const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { calculateTieShape } = require('../utils/tieShapesLibrary');
const { runDesignChecks } = require('../utils/rebarDesignChecks');
const { calculateSteelCost } = require('../utils/rebarPricing');
const {
  calculateHookLength,
  calculateDevelopmentLength,
  calculateLapSpliceLength,
  STANDARD_BAR_LENGTH,
  STEEL_GRADES,
} = require('../utils/constants');
const { round } = require('../utils/materialCalculator');

// استيراد حاسبات الأبعاد الإنشائية الموجودة (تُستخدم كمصدر للأبعاد الصافية الفعلية)
const footingsCalc = require('./footings');
const { calculateColumn } = require('./columns');
const { calculateBeam } = require('./beams');
const { calculateSolidSlab, calculateHollowBlockSlab } = require('./slabs');
const { calculateWall } = require('./walls');
const { calculateStaircase } = require('./staircases');
const { calculateTank } = require('./tanks');
const { calculatePool } = require('./pools');

/**
 * دالة مساعدة مركزية: تأخذ مجموعات حديد (bars groups) وتُرجع تفاصيل كاملة
 * شاملة عدد الأسياخ التجارية، الوزن، وربطها بمعلومات القطر
 */
function buildRebarDetail(bars, wastePercent, steelGrade = 'Grade420') {
  const result = calculateRebarWeight(bars, wastePercent);
  const fy = STEEL_GRADES[steelGrade]?.fy || 420;
  return { ...result, steel_grade: steelGrade, fy_MPa: fy };
}

/**
 * تحليل شامل للتراكب والتثبيت لمجموعة أقطار مستخدمة في عنصر معيّن
 */
function analyzeLapAndDevelopment({ barDiameter_mm, fc_MPa = 25, fy_MPa = 420, barLocation = 'other', concreteCover_mm = 40, spliceClass = 'B' }) {
  const dev = calculateDevelopmentLength({ barDiameter_mm, fy_MPa, fc_MPa, barLocation, concreteCover_mm });
  const lap = calculateLapSpliceLength(dev.development_length_mm, spliceClass);
  return { development: dev, lap_splice: lap };
}

/**
 * ============ 1) القواعد المنفصلة/المشتركة/الشريطية/اللبشة ============
 * يُبنى فوق نتائج footings.js الموجودة، مع إضافة تحليل الكانات (إن وُجدت أعمدة مرتبطة)
 * وتحليل التراكب والتثبيت وفحوصات التصميم
 */
function calculateFootingRebarDetailed(footingKind, params) {
  let structural;
  if (footingKind === 'isolated') structural = footingsCalc.calculateIsolatedFooting(params);
  else if (footingKind === 'combined') structural = footingsCalc.calculateCombinedFooting(params);
  else if (footingKind === 'strip') structural = footingsCalc.calculateStripFooting(params);
  else if (footingKind === 'raft') structural = footingsCalc.calculateRaftFoundation(params);
  else if (footingKind === 'strap') structural = footingsCalc.calculateStrapFooting(params);
  else throw new Error('نوع قاعدة غير معروف');

  const barDia = params.mainBarDiameter_mm || 16;
  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm: params.concreteCover_mm || 75,
    spliceClass: params.spliceClass || 'B',
  });

  const designChecks = runDesignChecks({
    elementType: 'footing',
    barDiameter_mm: barDia,
    clearSpacing_mm: params.barSpacing_mm ? params.barSpacing_mm - barDia : null,
    concreteCover_mm: params.concreteCover_mm || 75,
    exposureCondition: 'cast_against_soil',
  });

  const cost = params.pricing ? calculateSteelCost({
    totalWeight_kg: structural.reinforcement?.total_weight_kg || structural.exterior_footing?.volume_m3 || 0,
    ...params.pricing,
  }) : null;

  return { ...structural, lap_and_development: lapDev, design_checks: designChecks, cost };
}

/**
 * ============ 2) الأعمدة ============
 * إضافة تحليل الكانة من مكتبة الأشكال (بدلاً من الحساب المبسط) + تراكب الأسياخ الطولية بين الأدوار
 */
function calculateColumnRebarDetailed(params) {
  const { tieDiameter_mm = 8, ...restParams } = params;
  const structural = calculateColumn({ ...restParams, tieBarDiameter_mm: tieDiameter_mm });

  const { shape = 'rectangular', width_mm, depth_mm, diameter_mm, tieShape = 'rectangular', concreteCover_mm = 40 } = params;
  const cover_m = concreteCover_mm / 1000;

  let tieResult;
  if (shape === 'circular') {
    tieResult = calculateTieShape('circular', {
      netDiameter_m: (diameter_mm / 1000) - 2 * cover_m,
      tieDiameter_mm,
      hookAngle: params.hookAngle || 135,
    });
  } else {
    tieResult = calculateTieShape(tieShape === 'double' ? 'double' : 'rectangular', {
      netWidth_m: (width_mm / 1000) - 2 * cover_m,
      netHeight_m: (depth_mm / 1000) - 2 * cover_m,
      tieDiameter_mm,
      hookAngle: params.hookAngle || 135,
      crossTiesCount: params.crossTiesCount || 1,
    });
  }

  const barDia = params.mainBarDiameter_mm || 16;
  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const grossArea_m2 = structural.section_area_m2;
  const mainSteelArea_mm2 = params.mainBarsCount * (Math.PI / 4) * barDia * barDia;
  const steelRatio = mainSteelArea_mm2 / (grossArea_m2 * 1e6);

  const minColumnDim_mm = shape === 'circular' ? diameter_mm : Math.min(width_mm, depth_mm);
  const designChecks = runDesignChecks({
    elementType: 'column',
    concreteCover_mm,
    mainBarDia_mm: barDia,
    tieBarDia_mm: tieDiameter_mm,
    minColumnDim_mm,
    steelRatio,
    exposureCondition: params.exposureCondition || 'not_exposed',
  });

  const cost = params.pricing ? calculateSteelCost({
    totalWeight_kg: structural.reinforcement.total_steel_weight_kg,
    ...params.pricing,
  }) : null;

  return {
    ...structural,
    tie_shape_detail: tieResult,
    lap_and_development: lapDev,
    steel_ratio_percent: round(steelRatio * 100, 3),
    design_checks: designChecks,
    cost,
  };
}

/**
 * ============ 3) الكمرات ============
 * إضافة كانة من المكتبة + خطافات التسليح العلوي/السفلي + التراكب/التثبيت + نسبة التسليح
 */
function calculateBeamRebarDetailed(params) {
  const structural = calculateBeam(params);
  const { width_mm, height_mm, stirrupDiameter_mm = 8, concreteCover_mm = 25 } = params;
  const cover_m = concreteCover_mm / 1000;

  const stirrup = calculateTieShape('rectangular', {
    netWidth_m: (width_mm / 1000) - 2 * cover_m,
    netHeight_m: (height_mm / 1000) - 2 * cover_m,
    tieDiameter_mm: stirrupDiameter_mm,
    hookAngle: params.stirrupHookAngle || 135,
  });

  const bottomBarDia = params.bottomBarDiameter_mm || 16;
  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: bottomBarDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const effectiveDepth_mm = height_mm - concreteCover_mm - stirrupDiameter_mm - (bottomBarDia / 2);
  const steelArea_mm2 = (params.bottomBarsCount || 3) * (Math.PI / 4) * bottomBarDia * bottomBarDia;
  const steelRatio = steelArea_mm2 / (width_mm * effectiveDepth_mm);

  const designChecks = runDesignChecks({
    elementType: 'beam',
    concreteCover_mm,
    effectiveDepth_mm,
    steelRatio,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    exposureCondition: params.exposureCondition || 'not_exposed',
  });

  const cost = params.pricing ? calculateSteelCost({
    totalWeight_kg: structural.reinforcement.total_steel_weight_kg,
    ...params.pricing,
  }) : null;

  return {
    ...structural,
    stirrup_shape_detail: stirrup,
    effective_depth_mm: round(effectiveDepth_mm, 1),
    lap_and_development: lapDev,
    steel_ratio_percent: round(steelRatio * 100, 3),
    design_checks: designChecks,
    cost,
  };
}

/**
 * ============ 4) البلاطات (مصمتة/هوردي) ============
 */
function calculateSlabRebarDetailed(slabKind, params) {
  let structural;
  if (slabKind === 'hollow') {
    const topping = params.topLayerThickness_mm || 50;
    const blockHeight_mm = params.blockHeight_mm || Math.max((params.totalThickness_mm || 0) - topping, 100);
    structural = calculateHollowBlockSlab({ ...params, blockHeight_mm, topLayerThickness_mm: topping });
  } else {
    structural = calculateSolidSlab(params);
  }

  const barDia = params.mainBarDiameter_mm || 10;
  const thickness_mm = params.thickness_mm || params.totalThickness_mm;
  const concreteCover_mm = params.concreteCover_mm || 20;
  const effectiveDepth_mm = thickness_mm - concreteCover_mm - (barDia / 2);

  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'A', // البلاطات غالباً Class A (تراكب متباعد)
  });

  const designChecks = runDesignChecks({
    elementType: 'slab',
    concreteCover_mm,
    slabThickness_mm: thickness_mm,
    fy_MPa: params.fy_MPa || 420,
    exposureCondition: params.exposureCondition || 'not_exposed',
  });

  const cost = params.pricing ? calculateSteelCost({
    totalWeight_kg: structural.reinforcement.total_weight_kg,
    ...params.pricing,
  }) : null;

  return { ...structural, effective_depth_mm: round(effectiveDepth_mm, 1), lap_and_development: lapDev, design_checks: designChecks, cost };
}

/**
 * ============ 5) الجدران الخرسانية ============
 */
function calculateWallRebarDetailed(params) {
  const structural = calculateWall(params);
  const barDia = params.verticalBarDiameter_mm || 12;
  const concreteCover_mm = params.concreteCover_mm || 25;

  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const designChecks = runDesignChecks({
    elementType: 'wall',
    concreteCover_mm,
    fy_MPa: params.fy_MPa || 420,
    exposureCondition: params.exposureCondition || 'not_exposed',
  });

  const cost = params.pricing ? calculateSteelCost({
    totalWeight_kg: structural.reinforcement.total_weight_kg,
    ...params.pricing,
  }) : null;

  return { ...structural, lap_and_development: lapDev, design_checks: designChecks, cost };
}

/**
 * ============ 6) السلالم ============
 */
function calculateStaircaseRebarDetailed(params) {
  const {
    totalRiseHeight_m, riserHeight_mm, treadWidth_mm, flightWidth_m, waistSlabThickness_mm,
    landingLength_m, landingThickness_mm,
    mainBarDiameter_mm = 12, barSpacing_mm = 150,
    distributionBarDiameter_mm = 8, distributionBarSpacing_mm = 200,
    concreteCover_mm = 20, wastePercent = 0.05,
    staircaseType = 'straight',
  } = params;

  const structural = calculateStaircase({
    staircaseType,
    flights: [{
      totalRiseHeight_m, riserHeight_mm, treadWidth_mm, flightWidth_m, waistSlabThickness_mm,
      landingLength_m, landingThickness_mm,
    }],
    reinforcementOptions: {
      mainBarDiameter_mm, mainBarSpacing_mm: barSpacing_mm,
      distributionBarDiameter_mm, distributionBarSpacing_mm, concreteCover_mm, wastePercent,
    },
  });

  const barDia = mainBarDiameter_mm;
  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 25,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const designChecks = runDesignChecks({
    elementType: 'staircase',
    concreteCover_mm,
    exposureCondition: params.exposureCondition || 'not_exposed',
  });

  const totalSteelKg = structural.total_steel_weight_kg || 0;

  const cost = params.pricing ? calculateSteelCost({ totalWeight_kg: totalSteelKg, ...params.pricing }) : null;

  return {
    ...structural,
    reinforcement: { total_weight_kg: totalSteelKg, flights_detail: structural.flights.map(f => f.reinforcement) },
    lap_and_development: lapDev,
    design_checks: designChecks,
    cost,
  };
}

/**
 * ============ 7) الخزانات (أرضية/علوية) ============
 */
function calculateTankRebarDetailed(params) {
  const structural = calculateTank(params);
  const barDia = params.mainBarDiameter_mm || 12;
  const concreteCover_mm = params.concreteCover_mm || 50; // تعرض للرطوبة

  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 30,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const designChecks = runDesignChecks({
    elementType: 'tank',
    concreteCover_mm,
    exposureCondition: 'exposed_to_weather_or_soil',
  });

  const totalSteelKg = structural.reinforcement?.total_steel_weight_kg || 0;
  const cost = params.pricing ? calculateSteelCost({ totalWeight_kg: totalSteelKg, ...params.pricing }) : null;

  return { ...structural, lap_and_development: lapDev, design_checks: designChecks, cost };
}

/**
 * ============ 8) المسابح ============
 */
function calculatePoolRebarDetailed(params) {
  const structural = calculatePool(params);
  const barDia = params.mainBarDiameter_mm || 12;
  const concreteCover_mm = params.concreteCover_mm || 50;

  const lapDev = analyzeLapAndDevelopment({
    barDiameter_mm: barDia,
    fc_MPa: params.fc_MPa || 30,
    fy_MPa: params.fy_MPa || 420,
    barLocation: 'other',
    concreteCover_mm,
    spliceClass: params.spliceClass || 'B',
  });

  const designChecks = runDesignChecks({
    elementType: 'pool',
    concreteCover_mm,
    exposureCondition: 'exposed_to_weather_or_soil',
  });

  const totalSteelKg = structural.reinforcement?.total_steel_weight_kg || 0;
  const cost = params.pricing ? calculateSteelCost({ totalWeight_kg: totalSteelKg, ...params.pricing }) : null;

  return { ...structural, lap_and_development: lapDev, design_checks: designChecks, cost };
}

/**
 * ============ حاسبة عامة حرة (Custom Element) ============
 * لأي عنصر لا يقع ضمن الحاسبات الجاهزة: يُدخل المستخدم مجموعات القضبان مباشرة
 * bars: [{ diameter, length_m, count, description }]
 * ties: { shapeType, params } اختياري
 */
function calculateCustomRebarElement({
  elementName = 'عنصر مخصص',
  bars,
  wastePercent = 0.05,
  steelGrade = 'Grade420',
  ties = null,
  tiesCount = 0,
  lapAnalysis = null, // { barDiameter_mm, fc_MPa, fy_MPa, concreteCover_mm, spliceClass }
  pricing = null,
}) {
  if (!bars || bars.length === 0) throw new Error('يجب إدخال مجموعة قضبان واحدة على الأقل');

  const rebarResult = buildRebarDetail(bars, wastePercent, steelGrade);

  let tieResult = null;
  let tiesRebar = null;
  if (ties) {
    tieResult = calculateTieShape(ties.shapeType, ties.params);
    if (tiesCount > 0) {
      tiesRebar = calculateRebarWeight([
        { description: 'كانات العنصر المخصص', diameter: ties.params.tieDiameter_mm, length_m: tieResult.total_length_m, count: tiesCount },
      ], wastePercent);
    }
  }

  const lapDev = lapAnalysis ? analyzeLapAndDevelopment(lapAnalysis) : null;

  const totalWeightKg = rebarResult.total_weight_kg + (tiesRebar?.total_weight_kg || 0);
  const cost = pricing ? calculateSteelCost({ totalWeight_kg: totalWeightKg, ...pricing }) : null;

  return {
    type: elementName,
    main_reinforcement: rebarResult,
    tie_shape_detail: tieResult,
    ties_reinforcement: tiesRebar,
    total_weight_kg: round(totalWeightKg, 2),
    total_weight_ton: round(totalWeightKg / 1000, 4),
    lap_and_development: lapDev,
    cost,
  };
}

module.exports = {
  calculateFootingRebarDetailed,
  calculateColumnRebarDetailed,
  calculateBeamRebarDetailed,
  calculateSlabRebarDetailed,
  calculateWallRebarDetailed,
  calculateStaircaseRebarDetailed,
  calculateTankRebarDetailed,
  calculatePoolRebarDetailed,
  calculateCustomRebarElement,
  analyzeLapAndDevelopment,
  buildRebarDetail,
};
