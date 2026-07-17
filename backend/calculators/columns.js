const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * حساب الأعمدة الخرسانية - مستطيلة أو دائرية
 * الحجم = مساحة المقطع الفعلية × الارتفاع الصافي (بدون معامل تقريبي)
 * التسليح الطولي محسوب فعلياً حسب عدد الأسياخ المدخلة وقطرها وطول العمود
 * الكانات محسوبة حسب التباعد الفعلي على كامل ارتفاع العمود
 */
function calculateColumn({
  shape = 'rectangular', // rectangular | circular
  width_mm,      // للعمود المستطيل
  depth_mm,      // للعمود المستطيل
  diameter_mm,   // للعمود الدائري
  height_m,
  mainBarDiameter_mm = 16,
  mainBarsCount,
  tieBarDiameter_mm = 8,
  tieSpacing_mm = 200,
  concreteCover_mm = CONCRETE_COVER.column,
  wastePercent = 0.05,
}) {
  if (!height_m || height_m <= 0) {
    throw new Error('يجب إدخال ارتفاع العمود');
  }
  if (!mainBarsCount || mainBarsCount < 4) {
    throw new Error('يجب أن لا يقل عدد الأسياخ الطولية عن 4 أسياخ (اشتراط كود)');
  }

  let area_m2, perimeter_m, sectionLabel;
  if (shape === 'circular') {
    if (!diameter_mm) throw new Error('يجب إدخال قطر العمود الدائري');
    const d_m = diameter_mm / 1000;
    area_m2 = (Math.PI / 4) * d_m * d_m;
    perimeter_m = Math.PI * d_m;
    sectionLabel = `دائري Ø${diameter_mm}مم`;
  } else {
    if (!width_mm || !depth_mm) throw new Error('يجب إدخال عرض وعمق العمود المستطيل');
    const w_m = width_mm / 1000;
    const d_m = depth_mm / 1000;
    area_m2 = w_m * d_m;
    perimeter_m = 2 * (w_m + d_m);
    sectionLabel = `مستطيل ${width_mm}×${depth_mm}مم`;
  }

  const volume_m3 = area_m2 * height_m;

  // التسليح الطولي: طول كل سيخ = ارتفاع العمود (+ طول ربط اختياري يُترك للمستخدم عبر وصلات)
  const mainRebar = calculateRebarWeight([
    { description: 'تسليح طولي رئيسي', diameter: mainBarDiameter_mm, length_m: height_m, count: mainBarsCount },
  ], wastePercent);

  // الكانات: عدد الكانات = (الارتفاع الصافي / التباعد) + 1، طول الكانة = محيط المقطع الصافي (بعد الغطاء) + أطراف تراكب 2×10قطر تقريبي معياري
  const cover_m = concreteCover_mm / 1000;
  let tiePerimeter_m;
  if (shape === 'circular') {
    const effDiameter = (diameter_mm / 1000) - 2 * cover_m;
    tiePerimeter_m = Math.PI * effDiameter;
  } else {
    const effW = (width_mm / 1000) - 2 * cover_m;
    const effD = (depth_mm / 1000) - 2 * cover_m;
    tiePerimeter_m = 2 * (effW + effD);
  }
  const tieHookLength_m = 20 * (tieBarDiameter_mm / 1000); // طول العقفة المعيارية 20d وفق ECP/ACI
  const tieLength_m = tiePerimeter_m + tieHookLength_m;

  const spacing_m = tieSpacing_mm / 1000;
  const tiesCount = Math.floor(height_m / spacing_m) + 1;

  const tieRebar = calculateRebarWeight([
    { description: 'كانات (أساور)', diameter: tieBarDiameter_mm, length_m: tieLength_m, count: tiesCount },
  ], wastePercent);

  const totalWeight = mainRebar.total_weight_kg + tieRebar.total_weight_kg;

  return {
    type: 'عمود خرساني',
    shape: sectionLabel,
    height_m,
    section_area_m2: round(area_m2, 5),
    volume_m3: round(volume_m3, 4),
    reinforcement: {
      main_bars: mainRebar,
      ties: {
        ...tieRebar,
        ties_count: tiesCount,
        tie_length_m: round(tieLength_m, 3),
        spacing_mm: tieSpacing_mm,
      },
      total_steel_weight_kg: round(totalWeight, 2),
      total_steel_weight_ton: round(totalWeight / 1000, 4),
    },
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculateColumn };
