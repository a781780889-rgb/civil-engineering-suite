/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * أعمال المباني (Masonry Works)
 * الحساب الحقيقي: مساحة الحائط الصافية (بعد خصم الفتحات) ÷ مساحة الوحدة الفعلية (مع مونة الرصّ)
 * = عدد الوحدات، ثم حساب المونة من فراغ الرصّ الفعلي.
 */

const { DENSITIES } = require('../../utils/constants');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

// أبعاد الوحدات القياسية (م) - قابلة للتعديل الكامل من المستخدم
const MASONRY_UNITS = {
  red_brick_solid: { length: 0.25, height: 0.06, width: 0.12, label: 'طوب أحمر مصمت' },
  red_brick_perforated: { length: 0.25, height: 0.06, width: 0.12, label: 'طوب أحمر مثقب' },
  cement_block_10: { length: 0.40, height: 0.20, width: 0.10, label: 'بلوك أسمنتي 10 سم' },
  cement_block_15: { length: 0.40, height: 0.20, width: 0.15, label: 'بلوك أسمنتي 15 سم' },
  cement_block_20: { length: 0.40, height: 0.20, width: 0.20, label: 'بلوك أسمنتي 20 سم' },
  cement_brick: { length: 0.24, height: 0.115, width: 0.115, label: 'طوب أسمنتي' },
  natural_stone: { length: 0.40, height: 0.20, width: 0.20, label: 'حجر طبيعي (بلوك قياسي)' },
  aac_block_10: { length: 0.60, height: 0.20, width: 0.10, label: 'خرسانة خلوية (AAC) 10 سم' },
  aac_block_20: { length: 0.60, height: 0.20, width: 0.20, label: 'خرسانة خلوية (AAC) 20 سم' },
};

const UNIT_WEIGHTS_KG = {
  red_brick_solid: 2.6,
  red_brick_perforated: 2.0,
  cement_block_10: 12.5,
  cement_block_15: 17.0,
  cement_block_20: 21.0,
  cement_brick: 2.8,
  natural_stone: 35.0,
  aac_block_10: 8.0,
  aac_block_20: 16.0,
};

/**
 * حساب كمية وحدات البناء والمونة لحائط
 * @param {Object} p
 * @param {number} p.wallLength_m - طول الحائط الصافي
 * @param {number} p.wallHeight_m - ارتفاع الحائط
 * @param {string} p.unitType - نوع الوحدة (من MASONRY_UNITS)
 * @param {number} p.mortarJoint_m - سماكة فرشة/رأسية المونة (نمطي 0.01-0.015م)
 * @param {Array} p.openings - [{width_m, height_m, count}] الفتحات (أبواب/شبابيك) لخصمها
 * @param {number} p.wastePercent - نسبة الهدر (افتراضي 5%)
 */
function calculateWallMasonry({
  wallLength_m,
  wallHeight_m,
  unitType = 'cement_block_20',
  mortarJoint_m = 0.01,
  openings = [],
  wastePercent = 5,
  mortarMixRatio = '1:4', // أسمنت:رمل
}) {
  if (!wallLength_m || !wallHeight_m) {
    throw new Error('يجب إدخال طول الحائط وارتفاعه');
  }
  const unit = MASONRY_UNITS[unitType];
  if (!unit) throw new Error(`نوع الوحدة غير معروف: ${unitType}`);

  const grossArea_m2 = wallLength_m * wallHeight_m;
  const openingsArea_m2 = (openings || []).reduce(
    (sum, o) => sum + (o.width_m * o.height_m * (o.count || 1)), 0
  );
  const netArea_m2 = Math.max(grossArea_m2 - openingsArea_m2, 0);

  // مساحة الوحدة الفعلية شاملة فرشة المونة المحيطة بها (Nominal Area)
  const unitNominalArea_m2 = (unit.length + mortarJoint_m) * (unit.height + mortarJoint_m);
  const unitsPerM2 = 1 / unitNominalArea_m2;

  const netUnitsCount = netArea_m2 * unitsPerM2;
  const unitsWithWaste = Math.ceil(netUnitsCount * (1 + wastePercent / 100));

  // حجم المونة الفعلي = (الحجم الكلي للحائط) - (حجم الوحدات الصافي)
  const wallThickness_m = unit.width;
  const grossVolume_m3 = netArea_m2 * wallThickness_m;
  const unitsNetVolume_m3 = netUnitsCount * (unit.length * unit.height * unit.width);
  const mortarVolume_m3 = Math.max(grossVolume_m3 - unitsNetVolume_m3, 0);

  // نسبة خلط المونة لتحديد كمية الأسمنت والرمل (1 أسمنت : N رمل بالحجم)
  const mortarParts = mortarMixRatio.split(':').map(Number);
  const cementRatio = mortarParts[0] || 1;
  const sandRatio = mortarParts[1] || 4;
  const totalParts = cementRatio + sandRatio;
  const dryVolumeFactor = 1.33; // معامل الانكماش الجاف للمونة (33% إضافية معياري)
  const dryMortarVolume = mortarVolume_m3 * dryVolumeFactor;
  const cementVolume_m3 = (dryMortarVolume * cementRatio) / totalParts;
  const sandVolume_m3 = (dryMortarVolume * sandRatio) / totalParts;
  const cementBags = (cementVolume_m3 * DENSITIES.cement) / DENSITIES.cement_bag_weight;

  const unitWeight = UNIT_WEIGHTS_KG[unitType] || 0;
  const totalWeight_kg = unitsWithWaste * unitWeight;

  return {
    unit_type: unit.label,
    wall_thickness_m: wallThickness_m,
    gross_area_m2: round2(grossArea_m2),
    openings_area_m2: round2(openingsArea_m2),
    net_area_m2: round2(netArea_m2),
    units_per_m2: round2(unitsPerM2),
    units_required_net: Math.ceil(netUnitsCount),
    units_required_with_waste: unitsWithWaste,
    waste_percent: wastePercent,
    mortar_volume_m3: round3(mortarVolume_m3),
    mortar_mix_ratio: mortarMixRatio,
    cement_volume_m3: round3(cementVolume_m3),
    cement_bags: Math.ceil(cementBags),
    sand_volume_m3: round3(sandVolume_m3),
    total_units_weight_kg: round2(totalWeight_kg),
    total_units_weight_tons: round3(totalWeight_kg / 1000),
  };
}

/**
 * حساب أعمال البناء لمشروع كامل (تجميع عدة حوائط بأنواع مختلفة)
 */
function calculateProjectMasonry({ walls }) {
  if (!Array.isArray(walls) || walls.length === 0) {
    throw new Error('يجب إدخال قائمة الحوائط (walls) لحساب البناء الإجمالي');
  }
  const results = walls.map((w, idx) => ({ wall_id: idx + 1, ...calculateWallMasonry(w) }));

  const totals = results.reduce((acc, r) => {
    acc.total_net_area_m2 += r.net_area_m2;
    acc.total_units += r.units_required_with_waste;
    acc.total_mortar_m3 += r.mortar_volume_m3;
    acc.total_cement_bags += r.cement_bags;
    acc.total_sand_m3 += r.sand_volume_m3;
    acc.total_weight_tons += r.total_units_weight_tons;
    return acc;
  }, { total_net_area_m2: 0, total_units: 0, total_mortar_m3: 0, total_cement_bags: 0, total_sand_m3: 0, total_weight_tons: 0 });

  return {
    walls: results,
    summary: {
      total_net_area_m2: round2(totals.total_net_area_m2),
      total_units: totals.total_units,
      total_mortar_m3: round3(totals.total_mortar_m3),
      total_cement_bags: Math.ceil(totals.total_cement_bags),
      total_sand_m3: round3(totals.total_sand_m3),
      total_weight_tons: round3(totals.total_weight_tons),
    },
  };
}

module.exports = {
  MASONRY_UNITS,
  UNIT_WEIGHTS_KG,
  calculateWallMasonry,
  calculateProjectMasonry,
};
