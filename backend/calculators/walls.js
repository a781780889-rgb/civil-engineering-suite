const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * حساب الجدران الخرسانية (جدران استنادية، جدران قص، جدران بدروم)
 * الحجم = الطول × الارتفاع × السمك الفعلي، مطروحاً منه فتحات الأبواب/الشبابيك إن وُجدت
 */
function calculateWall({
  length_m,
  height_m,
  thickness_mm,
  openings = [], // [{ width_m, height_m, count }]
  verticalBarDiameter_mm = 12,
  verticalBarSpacing_mm = 200,
  horizontalBarDiameter_mm = 10,
  horizontalBarSpacing_mm = 200,
  layers = 2, // طبقتين (وجهين) أو طبقة واحدة
  concreteCover_mm = CONCRETE_COVER.wall,
  wastePercent = 0.05,
}) {
  if (!length_m || !height_m || !thickness_mm) {
    throw new Error('يجب إدخال طول وارتفاع وسمك الجدار');
  }

  const thickness_m = thickness_mm / 1000;
  const grossArea_m2 = length_m * height_m;

  const openingsArea_m2 = openings.reduce((sum, o) => sum + (o.width_m * o.height_m * (o.count || 1)), 0);
  const netArea_m2 = grossArea_m2 - openingsArea_m2;
  const volume_m3 = netArea_m2 * thickness_m;

  const cover_m = concreteCover_mm / 1000;
  const vSpacing_m = verticalBarSpacing_mm / 1000;
  const hSpacing_m = horizontalBarSpacing_mm / 1000;

  // عدد الأسياخ الرأسية = (الطول / التباعد) + 1، لكل طبقة (وجه)
  const verticalBarsPerLayer = Math.floor(length_m / vSpacing_m) + 1;
  const horizontalBarsPerLayer = Math.floor(height_m / hSpacing_m) + 1;

  const rebarGroups = [
    {
      description: `تسليح رأسي (${layers} طبقة/طبقات)`,
      diameter: verticalBarDiameter_mm,
      length_m: height_m - 2 * cover_m,
      count: verticalBarsPerLayer * layers,
    },
    {
      description: `تسليح أفقي (${layers} طبقة/طبقات)`,
      diameter: horizontalBarDiameter_mm,
      length_m: length_m - 2 * cover_m,
      count: horizontalBarsPerLayer * layers,
    },
  ];

  const rebarResult = calculateRebarWeight(rebarGroups, wastePercent);

  return {
    type: 'جدار خرساني',
    dimensions: { length_m, height_m, thickness_mm },
    gross_area_m2: round(grossArea_m2, 3),
    openings_area_m2: round(openingsArea_m2, 3),
    net_area_m2: round(netArea_m2, 3),
    volume_m3: round(volume_m3, 4),
    reinforcement: rebarResult,
    concrete_cover_mm: concreteCover_mm,
  };
}

module.exports = { calculateWall };
