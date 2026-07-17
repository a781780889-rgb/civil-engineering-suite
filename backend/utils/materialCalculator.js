const { MIX_DESIGNS, DENSITIES, EQUIPMENT } = require('./constants');

/**
 * حساب مواد الخرسانة من الحجم الصافي (م3) بناءً على نسبة الخلط الفعلية المختارة
 * جميع القيم مشتقة من volume الفعلي وليست معاملات ثابتة معزولة عنه
 *
 * @param {number} volume_m3 - حجم الخرسانة الصافي بالمتر المكعب
 * @param {string} mixGrade - رمز مقاومة الخرسانة (مثال 'C25')
 * @param {number} wastePercent - نسبة الهدر (مثال 0.05 = 5%)
 * @param {object} customMix - نسبة خلط مخصصة تلغي القيمة الافتراضية إن وُجدت
 * @param {number} cementPricePerBag - سعر كيس الأسمنت
 * @param {number} sandPricePerM3 - سعر م3 الرمل
 * @param {number} gravelPricePerM3 - سعر م3 البحص
 * @param {number} steelPricePerTon - غير مستخدم هنا (خاص بحاسبة الحديد)
 */
function calculateConcreteMaterials({
  volume_m3,
  mixGrade = 'C25',
  wastePercent = 0.05,
  customMix = null,
  cementPricePerBag = 0,
  sandPricePerM3 = 0,
  gravelPricePerM3 = 0,
  waterPricePerM3 = 0,
  mixerCapacity = EQUIPMENT.mixer_capacity_m3,
  truckCapacity = EQUIPMENT.truck_capacity_m3,
}) {
  if (!volume_m3 || volume_m3 <= 0) {
    throw new Error('حجم الخرسانة يجب أن يكون أكبر من الصفر');
  }

  const mix = customMix || MIX_DESIGNS[mixGrade];
  if (!mix) {
    throw new Error(`نسبة الخلط غير معروفة: ${mixGrade}`);
  }

  // الحجم الإجمالي شامل الهدر
  const volumeWithWaste = volume_m3 * (1 + wastePercent);

  // كمية الأسمنت (كجم) = محتوى الأسمنت لكل م3 × الحجم الكلي
  const cement_kg = mix.cement * volumeWithWaste;
  const cement_bags = cement_kg / DENSITIES.cement_bag_weight;

  // كمية الرمل والبحص (م3) بناءً على نسبة الخلط الحقيقية (نسبة حجمية لكل م3 خرسانة)
  const sand_m3 = mix.sand * volumeWithWaste;
  const gravel_m3 = mix.gravel * volumeWithWaste;

  // كمية المياه (لتر) = نسبة الماء/الأسمنت × وزن الأسمنت
  const water_liters = mix.wc_ratio * cement_kg;

  // عدد الخلطات (دفعات الخلاطة)
  const mixerBatches = Math.ceil(volumeWithWaste / mixerCapacity);

  // عدد سيارات الخرسانة الجاهزة (ميكسر النقل)
  const truckLoads = Math.ceil(volumeWithWaste / truckCapacity);

  // التكلفة
  const cementCost = cement_bags * cementPricePerBag;
  const sandCost = sand_m3 * sandPricePerM3;
  const gravelCost = gravel_m3 * gravelPricePerM3;
  const waterCost = (water_liters / 1000) * waterPricePerM3;
  const totalCost = cementCost + sandCost + gravelCost + waterCost;

  return {
    volume_net_m3: round(volume_m3, 4),
    volume_with_waste_m3: round(volumeWithWaste, 4),
    waste_percent: wastePercent * 100,
    mix_grade: mixGrade,
    fck_MPa: mix.fck,
    cement_kg: round(cement_kg, 2),
    cement_bags: Math.ceil(cement_bags * 100) / 100,
    cement_bags_rounded: Math.ceil(cement_bags),
    sand_m3: round(sand_m3, 3),
    gravel_m3: round(gravel_m3, 3),
    water_liters: round(water_liters, 1),
    water_m3: round(water_liters / 1000, 4),
    mixer_batches: mixerBatches,
    truck_loads: truckLoads,
    cost_breakdown: {
      cement: round(cementCost, 2),
      sand: round(sandCost, 2),
      gravel: round(gravelCost, 2),
      water: round(waterCost, 2),
      total: round(totalCost, 2),
    },
  };
}

function round(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

module.exports = { calculateConcreteMaterials, round };
