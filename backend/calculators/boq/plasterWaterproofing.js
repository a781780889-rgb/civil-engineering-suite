/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * أعمال اللياسة (Plastering) والعزل (Waterproofing / Thermal Insulation)
 */

const { DENSITIES } = require('../../utils/constants');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v) { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

// معدلات استهلاك المواد لكل م2 لكل سم سماكة (كجم/م2/سم) - قيم مرجعية قياسية
const PLASTER_MIX = {
  cement_plaster: { cementRatio: 1, sandRatio: 4, label: 'لياسة إسمنتية 1:4' },
  gypsum_plaster: { density_kg_m3: 950, label: 'لياسة جبسية' },
};

/**
 * حساب أعمال اللياسة الإسمنتية (لياسة خشنة + لياسة ناعمة عادة سماكة إجمالية 2-2.5 سم)
 */
function calculateCementPlaster({
  area_m2,
  thickness_cm = 2, // السماكة الإجمالية (خشنة+ناعمة)
  mixRatio = '1:4', // أسمنت:رمل
  wastePercent = 10,
  openings_m2 = 0,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة اللياسة');
  const netArea = Math.max(area_m2 - openings_m2, 0);
  const thickness_m = thickness_cm / 100;
  const wetVolume_m3 = netArea * thickness_m;

  const parts = mixRatio.split(':').map(Number);
  const cementRatio = parts[0] || 1;
  const sandRatio = parts[1] || 4;
  const totalParts = cementRatio + sandRatio;
  const dryVolumeFactor = 1.30; // معامل التمدد الجاف القياسي للمونة (كمية المواد الجافة قبل الخلط بالماء)
  const dryVolume_m3 = wetVolume_m3 * dryVolumeFactor;

  const cementVolume_m3 = (dryVolume_m3 * cementRatio) / totalParts;
  const sandVolume_m3 = (dryVolume_m3 * sandRatio) / totalParts;
  const cementBags = (cementVolume_m3 * DENSITIES.cement) / DENSITIES.cement_bag_weight;

  const cementWithWaste = cementBags * (1 + wastePercent / 100);
  const sandWithWaste = sandVolume_m3 * (1 + wastePercent / 100);

  return {
    net_area_m2: round2(netArea),
    thickness_cm,
    wet_mortar_volume_m3: round3(wetVolume_m3),
    mix_ratio: mixRatio,
    cement_bags: Math.ceil(cementWithWaste),
    sand_volume_m3: round3(sandWithWaste),
    waste_percent: wastePercent,
  };
}

/**
 * حساب أعمال اللياسة الجبسية (بديل التلييس الإسمنتي للأسطح الداخلية)
 */
function calculateGypsumPlaster({
  area_m2,
  thickness_cm = 1.5,
  wastePercent = 8,
  openings_m2 = 0,
  bagWeight_kg = 30, // وزن كيس الجبس القياسي
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة اللياسة الجبسية');
  const netArea = Math.max(area_m2 - openings_m2, 0);
  const thickness_m = thickness_cm / 100;
  const volume_m3 = netArea * thickness_m;
  const weight_kg = volume_m3 * PLASTER_MIX.gypsum_plaster.density_kg_m3;
  const weightWithWaste_kg = weight_kg * (1 + wastePercent / 100);
  const bags = weightWithWaste_kg / bagWeight_kg;

  return {
    net_area_m2: round2(netArea),
    thickness_cm,
    volume_m3: round3(volume_m3),
    weight_kg: round2(weightWithWaste_kg),
    bags_required: Math.ceil(bags),
    waste_percent: wastePercent,
  };
}

// ================= العزل (Waterproofing & Insulation) =================

// معدلات استهلاك مواد العزل النمطية (كجم/م2 أو لتر/م2 للطبقة الواحدة) - قيم مرجعية من نشرات المصنعين
const WATERPROOFING_MATERIALS = {
  bituminous_membrane: { coverage_kg_m2: 4.0, layers: 2, label: 'عزل بيتوميني (لفائف)' },
  liquid_membrane_acrylic: { coverage_kg_m2: 1.5, layers: 2, label: 'عزل سائل أكريليك' },
  cementitious_coating: { coverage_kg_m2: 2.0, layers: 2, label: 'عزل إسمنتي مطاطي' },
  epdm_sheet: { coverage_kg_m2: 0, layers: 1, label: 'عزل EPDM (رقائق)' }, // يُحسب بالمساحة فقط + لحام
  polyurethane_liquid: { coverage_kg_m2: 1.8, layers: 2, label: 'عزل بولي يوريثان سائل' },
};

const THERMAL_INSULATION_MATERIALS = {
  polystyrene_5cm: { thickness_cm: 5, density_kg_m3: 25, label: 'بوليسترين مبثوق (XPS) 5سم' },
  polystyrene_extruded_5cm: { thickness_cm: 5, density_kg_m3: 35, label: 'بوليسترين مبثوق (XPS) 5سم كثافة عالية' },
  polyurethane_foam_5cm: { thickness_cm: 5, density_kg_m3: 40, label: 'فوم بولي يوريثان رغوي 5سم' },
  rockwool_5cm: { thickness_cm: 5, density_kg_m3: 100, label: 'صوف صخري 5سم' },
};

/**
 * حساب كمية العزل المائي لمساحة معينة (أسطح، خزانات، حمامات) مع نسبة الرفع الجانبي (Upstand)
 */
function calculateWaterproofing({
  area_m2,
  perimeter_m = 0, // محيط المنطقة (لحساب الرفع الجانبي على الحوائط)
  upstandHeight_m = 0.3, // ارتفاع رفع العزل على الحوائط الجانبية (نمطي 20-30 سم)
  materialType = 'bituminous_membrane',
  wastePercent = 10,
  overlapPercent = 10, // نسبة تراكب اللفائف/الرقائق
}) {
  if (!area_m2) throw new Error('يجب إدخال المساحة المطلوب عزلها');
  const material = WATERPROOFING_MATERIALS[materialType];
  if (!material) throw new Error(`نوع مادة العزل غير معروف: ${materialType}`);

  const upstandArea_m2 = perimeter_m * upstandHeight_m;
  const totalArea_m2 = area_m2 + upstandArea_m2;
  const areaWithOverlap_m2 = totalArea_m2 * (1 + overlapPercent / 100);
  const areaWithWaste_m2 = areaWithOverlap_m2 * (1 + wastePercent / 100);

  const materialQuantity_kg = material.coverage_kg_m2 > 0
    ? areaWithWaste_m2 * material.coverage_kg_m2 * material.layers
    : null;

  return {
    material: material.label,
    flat_area_m2: round2(area_m2),
    upstand_area_m2: round2(upstandArea_m2),
    total_area_m2: round2(totalArea_m2),
    area_with_overlap_and_waste_m2: round2(areaWithWaste_m2),
    number_of_layers: material.layers,
    material_quantity_kg: materialQuantity_kg != null ? round2(materialQuantity_kg) : 'يُحسب بعدد رولات EPDM حسب عرض الرول',
    waste_percent: wastePercent,
  };
}

/**
 * حساب العزل الحراري (ألواح أو رغوي) لسطح أو جدار خارجي
 */
function calculateThermalInsulation({
  area_m2,
  materialType = 'polystyrene_5cm',
  actualThickness_cm = null, // إن اختلفت عن السماكة القياسية للمادة
  wastePercent = 8,
}) {
  if (!area_m2) throw new Error('يجب إدخال مساحة العزل الحراري');
  const material = THERMAL_INSULATION_MATERIALS[materialType];
  if (!material) throw new Error(`نوع مادة العزل الحراري غير معروف: ${materialType}`);

  const thickness_cm = actualThickness_cm || material.thickness_cm;
  const thickness_m = thickness_cm / 100;
  const volume_m3 = area_m2 * thickness_m;
  const weight_kg = volume_m3 * material.density_kg_m3;
  const areaWithWaste_m2 = area_m2 * (1 + wastePercent / 100);

  return {
    material: material.label,
    area_m2: round2(area_m2),
    area_with_waste_m2: round2(areaWithWaste_m2),
    thickness_cm,
    volume_m3: round3(volume_m3),
    weight_kg: round2(weight_kg),
    waste_percent: wastePercent,
  };
}

/**
 * حساب عزل الخزانات (مائي داخلي + حراري خارجي اختياري) - يجمع الجدران والقاعدة
 */
function calculateTankInsulation({
  internalLength_m,
  internalWidth_m,
  internalHeight_m,
  materialType = 'cementitious_coating',
  includeBase = true,
  wastePercent = 12,
}) {
  if (!internalLength_m || !internalWidth_m || !internalHeight_m) {
    throw new Error('يجب إدخال الأبعاد الداخلية للخزان (طول، عرض، ارتفاع)');
  }
  const wallArea_m2 = 2 * (internalLength_m + internalWidth_m) * internalHeight_m;
  const baseArea_m2 = includeBase ? internalLength_m * internalWidth_m : 0;
  const totalArea_m2 = wallArea_m2 + baseArea_m2;

  const result = calculateWaterproofing({
    area_m2: totalArea_m2,
    perimeter_m: 0,
    upstandHeight_m: 0,
    materialType,
    wastePercent,
  });

  return { wall_area_m2: round2(wallArea_m2), base_area_m2: round2(baseArea_m2), ...result };
}

/**
 * حساب عزل الحمامات (أرضية + رفع جانبي على الحوائط لمنع تسرب المياه)
 */
function calculateBathroomWaterproofing({
  floorArea_m2,
  perimeter_m,
  upstandHeight_m = 1.2, // نمطي 1.0-1.2م حول الحوائط في الحمامات
  materialType = 'liquid_membrane_acrylic',
  wastePercent = 10,
}) {
  if (!floorArea_m2 || !perimeter_m) {
    throw new Error('يجب إدخال مساحة الأرضية ومحيط الحمام');
  }
  return calculateWaterproofing({
    area_m2: floorArea_m2,
    perimeter_m,
    upstandHeight_m,
    materialType,
    wastePercent,
  });
}

module.exports = {
  PLASTER_MIX,
  WATERPROOFING_MATERIALS,
  THERMAL_INSULATION_MATERIALS,
  calculateCementPlaster,
  calculateGypsumPlaster,
  calculateWaterproofing,
  calculateThermalInsulation,
  calculateTankInsulation,
  calculateBathroomWaterproofing,
};
