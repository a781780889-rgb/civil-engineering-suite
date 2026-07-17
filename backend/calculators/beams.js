const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * حساب الكمرات الخرسانية
 * الحجم = العرض × الارتفاع الفعلي × الطول الصافي (بين محاور الدعامات)
 * التسليح العلوي والسفلي والكانات محسوبة فعلياً من الأبعاد المدخلة
 */
function calculateBeam({
  width_mm,
  height_mm,
  span_m,          // الطول الصافي للكمرة (بين الدعامات)
  topBarDiameter_mm = 16,
  topBarsCount = 2,
  bottomBarDiameter_mm = 16,
  bottomBarsCount = 3,
  stirrupDiameter_mm = 8,
  stirrupSpacing_mm = 150,
  concreteCover_mm = CONCRETE_COVER.beam,
  wastePercent = 0.05,
}) {
  if (!width_mm || !height_mm || !span_m) {
    throw new Error('يجب إدخال عرض وارتفاع وطول الكمرة');
  }

  const width_m = width_mm / 1000;
  const height_m = height_mm / 1000;

  const crossSectionArea_m2 = width_m * height_m;
  const volume_m3 = crossSectionArea_m2 * span_m;

  const cover_m = concreteCover_mm / 1000;
  // طول سيخ التسليح الطولي = طول الكمرة (بافتراض عدم التمديد خارج الدعامات، يمكن تعديله من المستخدم)
  const barLength = span_m - 2 * cover_m + 2 * cover_m; // = span_m (يُترك صراحة لتوضيح أن الغطاء يُطبق شاقولياً وليس على الطول)

  const topRebar = calculateRebarWeight([
    { description: 'تسليح علوي (سالب)', diameter: topBarDiameter_mm, length_m: span_m, count: topBarsCount },
  ], wastePercent);

  const bottomRebar = calculateRebarWeight([
    { description: 'تسليح سفلي (موجب)', diameter: bottomBarDiameter_mm, length_m: span_m, count: bottomBarsCount },
  ], wastePercent);

  // الكانات: محيط المقطع الصافي (بعد طرح الغطاء من الجهتين) + عقفة معيارية 20d لكل طرف (2 عقفة)
  const effWidth = width_m - 2 * cover_m;
  const effHeight = height_m - 2 * cover_m;
  const stirrupPerimeter = 2 * (effWidth + effHeight);
  const hookLength = 2 * 20 * (stirrupDiameter_mm / 1000);
  const stirrupLength = stirrupPerimeter + hookLength;

  const spacing_m = stirrupSpacing_mm / 1000;
  const stirrupsCount = Math.floor(span_m / spacing_m) + 1;

  const stirrupRebar = calculateRebarWeight([
    { description: 'كانات', diameter: stirrupDiameter_mm, length_m: stirrupLength, count: stirrupsCount },
  ], wastePercent);

  const totalSteel = topRebar.total_weight_kg + bottomRebar.total_weight_kg + stirrupRebar.total_weight_kg;

  return {
    type: 'كمرة خرسانية',
    dimensions: { width_mm, height_mm, span_m },
    cross_section_area_m2: round(crossSectionArea_m2, 5),
    volume_m3: round(volume_m3, 4),
    reinforcement: {
      top_bars: topRebar,
      bottom_bars: bottomRebar,
      stirrups: {
        ...stirrupRebar,
        stirrups_count: stirrupsCount,
        stirrup_length_m: round(stirrupLength, 3),
        spacing_mm: stirrupSpacing_mm,
      },
      total_steel_weight_kg: round(totalSteel, 2),
      total_steel_weight_ton: round(totalSteel / 1000, 4),
    },
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculateBeam };
