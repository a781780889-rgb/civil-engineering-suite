const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER, DENSITIES } = require('../utils/constants');

/**
 * حساب البلاطات الخرسانية
 * النوع الأول: بلاطة صماء (Solid Slab) - حجم = مساحة × سمك فعلي
 * النوع الثاني: بلاطة هوردي (Hollow Block / Ribbed Slab) - يُطرح حجم الطوب الهوردي من الحجم الكلي
 */
function calculateSolidSlab({
  length_m,
  width_m,
  thickness_mm,
  mainBarDiameter_mm = 10,
  mainBarSpacing_mm = 150,
  secondaryBarDiameter_mm = 10,
  secondaryBarSpacing_mm = 200,
  concreteCover_mm = CONCRETE_COVER.slab,
  wastePercent = 0.05,
}) {
  if (!length_m || !width_m || !thickness_mm) {
    throw new Error('يجب إدخال طول وعرض وسمك البلاطة');
  }

  const thickness_m = thickness_mm / 1000;
  const area_m2 = length_m * width_m;
  const volume_m3 = area_m2 * thickness_m;

  const cover_m = concreteCover_mm / 1000;
  const mainSpacing_m = mainBarSpacing_mm / 1000;
  const secSpacing_m = secondaryBarSpacing_mm / 1000;

  // عدد أسياخ الاتجاه الرئيسي يمتد بطول width (موزعة عبر length) والعكس للاتجاه الثانوي
  const mainBarsCount = Math.floor(length_m / mainSpacing_m) + 1;
  const secondaryBarsCount = Math.floor(width_m / secSpacing_m) + 1;

  const rebarGroups = [
    { description: 'تسليح سفلي رئيسي (اتجاه قصير)', diameter: mainBarDiameter_mm, length_m: width_m - 2 * cover_m, count: mainBarsCount },
    { description: 'تسليح سفلي ثانوي/توزيع (اتجاه طويل)', diameter: secondaryBarDiameter_mm, length_m: length_m - 2 * cover_m, count: secondaryBarsCount },
    // شبكة علوية فوق الركائز (مماثلة كحد أدنى تصميمي عملي، قابلة للتعديل)
    { description: 'تسليح علوي فوق الركائز (اتجاه قصير)', diameter: mainBarDiameter_mm, length_m: width_m - 2 * cover_m, count: mainBarsCount },
    { description: 'تسليح علوي فوق الركائز (اتجاه طويل)', diameter: secondaryBarDiameter_mm, length_m: length_m - 2 * cover_m, count: secondaryBarsCount },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'بلاطة صماء (Solid Slab)',
    dimensions: { length_m, width_m, thickness_mm },
    area_m2: round(area_m2, 3),
    volume_m3: round(volume_m3, 4),
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

/**
 * البلاطة الهوردي (الطوب الفارغ) - حجم الخرسانة الفعلي = الحجم الكلي ناقص حجم طوب الهوردي
 */
function calculateHollowBlockSlab({
  length_m,
  width_m,
  totalThickness_mm,      // السمك الكلي (بلوك + طبقة علوية)
  blockWidth_mm = 400,     // عرض طوبة الهوردي القياسية
  blockLength_mm = 250,
  blockHeight_mm,          // ارتفاع طوبة الهوردي (= سمك البلاطة - سمك الطبقة العلوية)
  topLayerThickness_mm = 50, // سمك الطبقة الخرسانية العلوية (Topping)
  ribWidth_mm = 120,       // عرض العصب الخرساني
  ribSpacing_mm = 520,     // تباعد محاور الأعصاب (عادة عرض البلوك + عرض العصب)
  mainBarDiameter_mm = 10,
  concreteCover_mm = CONCRETE_COVER.slab,
  wastePercent = 0.05,
}) {
  if (!length_m || !width_m || !totalThickness_mm) {
    throw new Error('يجب إدخال طول وعرض والسمك الكلي للبلاطة الهوردي');
  }

  const effectiveBlockHeight_mm = blockHeight_mm || (totalThickness_mm - topLayerThickness_mm);
  const area_m2 = length_m * width_m;

  // عدد صفوف الطوب عبر عرض البلاطة (بناءً على تباعد الأعصاب الفعلي)
  const numberOfRows = Math.floor(width_m / (ribSpacing_mm / 1000));
  // عدد الطوبات في كل صف (بناءً على طول البلاطة وطول الطوبة الواحدة)
  const blocksPerRow = Math.floor(length_m / (blockLength_mm / 1000));
  const totalBlocks = numberOfRows * blocksPerRow;

  // حجم طوبة هوردي واحدة (م3)
  const blockVolume_m3 = (blockLength_mm / 1000) * (blockWidth_mm / 1000) * (effectiveBlockHeight_mm / 1000);
  const totalBlocksVolume_m3 = totalBlocks * blockVolume_m3;

  // الحجم الكلي للبلاطة (بدون طرح) ناقص حجم الطوب الفعلي = حجم الخرسانة الصافي
  const grossVolume_m3 = area_m2 * (totalThickness_mm / 1000);
  const concreteVolume_m3 = grossVolume_m3 - totalBlocksVolume_m3;

  // تسليح الأعصاب: سيخين سفليين لكل عصب بطول البلاطة
  const numberOfRibs = numberOfRows + 1; // عدد الأعصاب يزيد بمقدار 1 عن عدد الصفوف
  const cover_m = concreteCover_mm / 1000;
  const ribBarsPerRib = 2;
  const totalRibBars = numberOfRibs * ribBarsPerRib;

  const rebarGroups = [
    { description: 'تسليح الأعصاب (سفلي)', diameter: mainBarDiameter_mm, length_m: length_m - 2 * cover_m, count: totalRibBars },
    { description: 'شبكة تسليح الطبقة العلوية (تباعد 200مم)', diameter: 8, length_m: width_m - 2 * cover_m, count: Math.floor(length_m / 0.2) + 1 },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'بلاطة هوردي (Hollow Block Slab)',
    dimensions: { length_m, width_m, totalThickness_mm, topLayerThickness_mm },
    area_m2: round(area_m2, 3),
    gross_volume_m3: round(grossVolume_m3, 4),
    blocks: {
      total_count: totalBlocks,
      rows: numberOfRows,
      per_row: blocksPerRow,
      unit_volume_m3: round(blockVolume_m3, 5),
      total_blocks_volume_m3: round(totalBlocksVolume_m3, 4),
    },
    net_concrete_volume_m3: round(concreteVolume_m3, 4),
    ribs_count: numberOfRibs,
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculateSolidSlab, calculateHollowBlockSlab };
