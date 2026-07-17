const { rebarWeightPerMeter, STANDARD_BAR_LENGTH } = require('./constants');
const { round } = require('./materialCalculator');

/**
 * حساب وزن مجموعة من قضبان الحديد بناءً على القطر الفعلي وطول القضيب الفعلي والعدد
 * الوزن = (π/4 × d²) × ρ_steel × الطول × العدد  -- معادلة فيزيائية حقيقية وليست تقريبية
 *
 * @param {Array} bars - [{ diameter, length_m, count, description }]
 * @param {number} wastePercent - نسبة هدر/تراكب
 */
function calculateRebarWeight(bars, wastePercent = 0.05) {
  let totalWeight = 0;
  let totalLength = 0;
  const details = bars.map(bar => {
    const { diameter, length_m, count, description = '' } = bar;
    if (!diameter || !length_m || !count) {
      throw new Error('يجب تحديد القطر والطول والعدد لكل مجموعة حديد');
    }
    const unitWeight = rebarWeightPerMeter(diameter); // كجم/م
    const barLength = length_m * count;
    const weight = unitWeight * barLength * (1 + wastePercent);
    totalWeight += weight;
    totalLength += barLength;

    const numberOfStandardBars = Math.ceil((length_m * count) / STANDARD_BAR_LENGTH);

    return {
      description,
      diameter_mm: diameter,
      unit_weight_kg_per_m: round(unitWeight, 4),
      count,
      length_per_bar_m: length_m,
      total_length_m: round(barLength, 2),
      weight_kg: round(weight, 2),
      standard_bars_needed: numberOfStandardBars, // عدد القضبان التجارية (12م) المطلوبة
    };
  });

  return {
    details,
    total_weight_kg: round(totalWeight, 2),
    total_weight_ton: round(totalWeight / 1000, 4),
    total_length_m: round(totalLength, 2),
    waste_percent: wastePercent * 100,
  };
}

module.exports = { calculateRebarWeight };
