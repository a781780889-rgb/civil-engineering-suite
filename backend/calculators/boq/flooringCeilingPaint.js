/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الأرضيات (Flooring) + الأسقف المستعارة (Ceilings) + الدهانات (Painting)
 */

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

// أبعاد البلاط القياسية الشائعة (م) - قابلة للتعديل بالكامل
const TILE_SIZES = {
  ceramic_30x30: { length: 0.30, width: 0.30, label: 'سيراميك 30×30' },
  ceramic_40x40: { length: 0.40, width: 0.40, label: 'سيراميك 40×40' },
  ceramic_60x60: { length: 0.60, width: 0.60, label: 'سيراميك 60×60' },
  porcelain_60x60: { length: 0.60, width: 0.60, label: 'بورسلان 60×60' },
  porcelain_80x80: { length: 0.80, width: 0.80, label: 'بورسلان 80×80' },
  porcelain_100x100: { length: 1.00, width: 1.00, label: 'بورسلان 100×100' },
  marble_standard: { length: 0.60, width: 0.40, label: 'رخام (بلاطة قياسية 60×40)' },
  granite_standard: { length: 0.60, width: 0.60, label: 'جرانيت 60×60' },
};

/**
 * حساب أرضيات البلاط (سيراميك/بورسلان/رخام/جرانيت) اعتماداً على المساحة الفعلية وأبعاد البلاطة
 */
function calculateTileFlooring({
  area_m2,
  tileType = 'porcelain_60x60',
  customTileSize_m = null, // {length, width} إن أراد المستخدم مقاس مخصص
  wastePercent = 10, // 10% نمطي (يزيد لأنماط القطع المائل/الديكور)
  groutJoint_m = 0.003,
  adhesiveCoverage_kg_m2 = 5, // استهلاك لاصق البلاط (كجم/م2) - قيمة مرجعية
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الأرضية');
  const tile = customTileSize_m || TILE_SIZES[tileType];
  if (!tile) throw new Error(`نوع/مقاس البلاط غير معروف: ${tileType}`);

  const tileAreaWithJoint_m2 = (tile.length + groutJoint_m) * (tile.width + groutJoint_m);
  const tilesPerM2 = 1 / tileAreaWithJoint_m2;
  const netTiles = area_m2 * tilesPerM2;
  const tilesWithWaste = Math.ceil(netTiles * (1 + wastePercent / 100));

  const adhesiveWeight_kg = area_m2 * adhesiveCoverage_kg_m2 * (1 + wastePercent / 100);

  return {
    tile_label: tile.label || tileType,
    tile_size_m: `${tile.length}×${tile.width}`,
    net_area_m2: round2(area_m2),
    tiles_per_m2: round2(tilesPerM2),
    tiles_required_net: Math.ceil(netTiles),
    tiles_required_with_waste: tilesWithWaste,
    waste_percent: wastePercent,
    adhesive_weight_kg: round2(adhesiveWeight_kg),
    grout_joint_mm: groutJoint_m * 1000,
  };
}

/**
 * حساب أرضيات الباركيه (ألواح - Laminate/Engineered) بالمتر المربع مع نسبة هدر القطع
 */
function calculateParquetFlooring({
  area_m2,
  boardLength_m = 1.2,
  boardWidth_m = 0.19,
  wastePercent = 8,
  underlaymentIncluded = true,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة أرضية الباركيه');
  const boardArea_m2 = boardLength_m * boardWidth_m;
  const boardsNet = area_m2 / boardArea_m2;
  const boardsWithWaste = Math.ceil(boardsNet * (1 + wastePercent / 100));
  const underlaymentArea_m2 = underlaymentIncluded ? round2(area_m2 * 1.05) : 0;

  return {
    net_area_m2: round2(area_m2),
    board_size_m: `${boardLength_m}×${boardWidth_m}`,
    boards_required_net: Math.ceil(boardsNet),
    boards_required_with_waste: boardsWithWaste,
    underlayment_area_m2: underlaymentArea_m2,
    waste_percent: wastePercent,
  };
}

/**
 * حساب الأرضيات الإيبوكسي (طبقات: برايمر + طبقة أساس + طبقة نهائية)
 */
function calculateEpoxyFlooring({
  area_m2,
  primerCoverage_kg_m2 = 0.2,
  baseCoatCoverage_kg_m2 = 1.0,
  topCoatCoverage_kg_m2 = 0.4,
  wastePercent = 8,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الأرضية الإيبوكسي');
  const factor = 1 + wastePercent / 100;
  return {
    net_area_m2: round2(area_m2),
    primer_kg: round2(area_m2 * primerCoverage_kg_m2 * factor),
    base_coat_kg: round2(area_m2 * baseCoatCoverage_kg_m2 * factor),
    top_coat_kg: round2(area_m2 * topCoatCoverage_kg_m2 * factor),
    waste_percent: wastePercent,
  };
}

/**
 * حساب الخرسانة المطبوعة (Stamped Concrete) - سماكة الخرسانة + مواد التلوين والختم
 */
function calculatePrintedConcrete({
  area_m2,
  slabThickness_cm = 10,
  colorHardenerCoverage_kg_m2 = 4, // مادة تصليب الألوان
  releaseAgentCoverage_kg_m2 = 0.15, // مسحوق الفصل
  sealerCoverage_l_m2 = 0.15, // طبقة الحماية النهائية
  wastePercent = 8,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الخرسانة المطبوعة');
  const volume_m3 = area_m2 * (slabThickness_cm / 100);
  const factor = 1 + wastePercent / 100;

  return {
    net_area_m2: round2(area_m2),
    concrete_volume_m3: round3(volume_m3 * factor),
    color_hardener_kg: round2(area_m2 * colorHardenerCoverage_kg_m2 * factor),
    release_agent_kg: round2(area_m2 * releaseAgentCoverage_kg_m2 * factor),
    sealer_liters: round2(area_m2 * sealerCoverage_l_m2 * factor),
    waste_percent: wastePercent,
  };
}

// ================= الأسقف المستعارة (Suspended Ceilings) =================

const CEILING_SYSTEMS = {
  gypsum_board: { boardArea_m2: 2.88, screwsPerM2: 15, label: 'أسقف جبسية (بورد)' }, // لوح قياسي 1.2×2.4
  metal_grid_60x60: { tileArea_m2: 0.36, label: 'أسقف معدنية شبكية 60×60' },
  suspended_mineral_tile: { tileArea_m2: 0.36, label: 'أسقف مستعارة (بلاط معدني/معدني مزخرف)' },
};

/**
 * حساب الأسقف الجبسية (بورد) مع الهيكل المعدني (Metal Frame) والمسامير
 */
function calculateGypsumCeiling({
  area_m2,
  wastePercent = 10,
  mainRunnerSpacing_m = 1.2,
  crossRunnerSpacing_m = 0.6,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة السقف الجبسي');
  const system = CEILING_SYSTEMS.gypsum_board;
  const boardsNet = area_m2 / system.boardArea_m2;
  const boardsWithWaste = Math.ceil(boardsNet * (1 + wastePercent / 100));
  const screws = Math.ceil(area_m2 * system.screwsPerM2 * (1 + wastePercent / 100));

  // طول الهيكل المعدني التقريبي بناءً على شبكة التباعد (Main + Cross Runners)
  const mainRunnerLength_m = area_m2 / crossRunnerSpacing_m; // تقدير هندسي مبني على كثافة الشبكة
  const crossRunnerLength_m = area_m2 / mainRunnerSpacing_m;

  return {
    net_area_m2: round2(area_m2),
    boards_required_net: Math.ceil(boardsNet),
    boards_required_with_waste: boardsWithWaste,
    screws_required: screws,
    main_runner_length_m: round2(mainRunnerLength_m),
    cross_runner_length_m: round2(crossRunnerLength_m),
    waste_percent: wastePercent,
  };
}

/**
 * حساب الأسقف المعدنية/المستعارة الشبكية (T-Grid) بالبلاط المعياري
 */
function calculateGridCeiling({
  area_m2,
  systemType = 'metal_grid_60x60',
  wastePercent = 8,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة السقف');
  const system = CEILING_SYSTEMS[systemType];
  if (!system) throw new Error(`نظام السقف غير معروف: ${systemType}`);

  const tilesNet = area_m2 / system.tileArea_m2;
  const tilesWithWaste = Math.ceil(tilesNet * (1 + wastePercent / 100));
  // طول زوايا التعليق التقريبي (محيط الشبكة) — يُقدَّر بمعادلة هندسية مبسطة لكثافة القضبان
  const gridLength_m = Math.ceil(area_m2 / Math.sqrt(system.tileArea_m2)) * Math.sqrt(system.tileArea_m2) * 2;

  return {
    system: system.label,
    net_area_m2: round2(area_m2),
    tiles_required_net: Math.ceil(tilesNet),
    tiles_required_with_waste: tilesWithWaste,
    estimated_grid_length_m: round2(gridLength_m),
    waste_percent: wastePercent,
  };
}

// ================= الدهانات (Painting) =================

const PAINT_COVERAGE = {
  primer: { coverage_m2_per_liter: 10, coats: 1 },
  putty_filler: { coverage_kg_m2: 1.0, coats: 1 },
  emulsion_interior: { coverage_m2_per_liter: 12, coats: 2 },
  emulsion_exterior: { coverage_m2_per_liter: 8, coats: 2 },
  finishing_coat: { coverage_m2_per_liter: 11, coats: 1 },
};

/**
 * حساب أعمال الدهان الكامل: معجون + برايمر + طبقتين تشطيب (داخلي أو خارجي)
 */
function calculatePainting({
  area_m2,
  paintType = 'emulsion_interior', // emulsion_interior | emulsion_exterior
  includePutty = true,
  includePrimer = true,
  numberOfCoats = 2,
  wastePercent = 10,
  openings_m2 = 0,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة الدهان');
  const netArea = Math.max(area_m2 - openings_m2, 0);
  const factor = 1 + wastePercent / 100;

  const puttyKg = includePutty
    ? round2(netArea * PAINT_COVERAGE.putty_filler.coverage_kg_m2 * factor)
    : 0;

  const primerLiters = includePrimer
    ? round2((netArea / PAINT_COVERAGE.primer.coverage_m2_per_liter) * factor)
    : 0;

  const paintSpec = PAINT_COVERAGE[paintType] || PAINT_COVERAGE.emulsion_interior;
  const paintLiters = round2(((netArea * numberOfCoats) / paintSpec.coverage_m2_per_liter) * factor);

  return {
    net_area_m2: round2(netArea),
    paint_type: paintType,
    putty_kg: puttyKg,
    primer_liters: primerLiters,
    paint_liters: paintLiters,
    number_of_coats: numberOfCoats,
    waste_percent: wastePercent,
  };
}

module.exports = {
  TILE_SIZES,
  CEILING_SYSTEMS,
  PAINT_COVERAGE,
  calculateTileFlooring,
  calculateParquetFlooring,
  calculateEpoxyFlooring,
  calculatePrintedConcrete,
  calculateGypsumCeiling,
  calculateGridCeiling,
  calculatePainting,
};
