/**
 * ثوابت هندسية معتمدة على المعايير الفعلية (ACI 211.1, ECP 203, ASTM)
 * جميع القيم قابلة للتعديل من المستخدم عبر واجهة الإدخال - لا قيم Hardcoded في الحسابات
 */

// نسب الخلط الخرسانية القياسية (ACI 211.1) - كجم لكل م3 خرسانة
// تُستخدم كقيم افتراضية قابلة للتعديل الكامل من المستخدم
const MIX_DESIGNS = {
  'C20': { cement: 300, sand: 0.5, gravel: 0.8, wc_ratio: 0.55, fck: 20 },
  'C25': { cement: 350, sand: 0.48, gravel: 0.78, wc_ratio: 0.50, fck: 25 },
  'C30': { cement: 400, sand: 0.45, gravel: 0.75, wc_ratio: 0.45, fck: 30 },
  'C35': { cement: 450, sand: 0.42, gravel: 0.72, wc_ratio: 0.42, fck: 35 },
  'C40': { cement: 500, sand: 0.40, gravel: 0.70, wc_ratio: 0.38, fck: 40 },
  'C45': { cement: 520, sand: 0.38, gravel: 0.68, wc_ratio: 0.35, fck: 45 },
  'C50': { cement: 550, sand: 0.36, gravel: 0.65, wc_ratio: 0.32, fck: 50 },
};

// كثافات المواد (كجم/م3) - قيم معيارية ASTM
const DENSITIES = {
  cement: 1440,       // كثافة الأسمنت الفعلية (كجم/م3) لكيس 50كجم = 0.0347 م3 تقريباً
  cement_bag_weight: 50, // وزن كيس الأسمنت القياسي (كجم)
  sand_loose: 1600,   // كثافة الرمل السائب
  gravel: 1500,       // كثافة البحص
  steel: 7850,        // كثافة الحديد (كجم/م3)
  water: 1000,        // كثافة الماء
  concrete_reinforced: 2500, // كثافة الخرسانة المسلحة
  concrete_plain: 2400,      // كثافة الخرسانة العادية
  masonry_brick: 1800,
};

// سعات معدات الخلط والنقل
const EQUIPMENT = {
  mixer_capacity_m3: 0.5,      // سعة الخلاطة العادية (م3 لكل دفعة)
  mixer_capacity_large_m3: 1.0,
  truck_capacity_m3: 6.0,      // سعة خلاطة النقل (ميكسر) القياسية
  truck_capacity_small_m3: 4.0,
};

// أقطار حديد التسليح القياسية (مم) والوزن لكل متر طولي (كجم/م) وفق الوزن النوعي الفعلي
// الوزن محسوب فعلياً: W = (π/4) * d² * ρ_steel وليس تقريبياً
function rebarWeightPerMeter(diameter_mm) {
  const area_m2 = (Math.PI / 4) * Math.pow(diameter_mm / 1000, 2);
  return area_m2 * DENSITIES.steel; // كجم/متر طولي
}

const REBAR_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].map(d => ({
  diameter: d,
  weight_per_m: parseFloat(rebarWeightPerMeter(d).toFixed(4)),
  area_mm2: parseFloat(((Math.PI / 4) * d * d).toFixed(2)),
}));

// طول قضيب الحديد التجاري القياسي (متر) - يُستخدم لحساب عدد القضبان والهدر
const STANDARD_BAR_LENGTH = 12;

// نسب الهدر المعيارية القابلة للتعديل
const DEFAULT_WASTE = {
  concrete: 0.05,  // 5%
  steel: 0.05,     // 5% (يشمل التراكب والقطع)
  formwork: 0.10,  // 10%
};

// أغطية خرسانية دنيا (Concrete Cover) وفق ECP 203 / ACI 318 (مم)
const CONCRETE_COVER = {
  footing_bottom: 75,   // ملامس للتربة
  footing_top: 50,
  column: 40,
  beam: 25,
  slab: 20,
  wall: 25,
  staircase: 20,
  water_tank: 50,       // تعرض للرطوبة والمياه
  pool: 50,
};

// ===================== ثوابت القسم الثاني: حاسبة حديد التسليح =====================
// جميع المعادلات وفق ACI 318-19 (مع بدائل BS 8110 / Eurocode 2 قابلة للاختيار)
// لا معاملات ثابتة تقريبية (مثل ×1.15) — كل قيمة مشتقة من صيغة الكود الفعلية والأبعاد الحقيقية

// إجهاد خضوع الحديد القياسي (MPa) حسب الدرجة
const STEEL_GRADES = {
  'Grade280': { fy: 280, label: 'حديد طبيعي - Grade 280 (40)' },
  'Grade350': { fy: 350, label: 'حديد طبيعي - Grade 350 (50)' },
  'Grade420': { fy: 420, label: 'حديد عالي المقاومة - Grade 420 (60) - الأكثر استخداماً' },
  'Grade520': { fy: 520, label: 'حديد عالي المقاومة - Grade 520 (75)' },
};

// معامل الكود الهندسي المستخدم في الحسابات
const DESIGN_CODES = ['ACI318', 'BS8110', 'Eurocode2'];

// نوع سطح القضيب (مبروم/مشرشر Deformed أو أملس Plain) - يؤثر على معامل التثبيت
const BAR_SURFACE = {
  deformed: { factor: 1.0, label: 'مبروم (Deformed) - الشائع' },
  plain: { factor: 1.5, label: 'أملس (Plain) - يتطلب طول تثبيت أكبر' },
};

// ===== أطوال الخطافات القياسية (Standard Hooks) وفق ACI 318-19 Section 25.3 =====
// طول التمديد بعد الانحناء (الطرف المستقيم) وقطر الانحناء الداخلي كمضاعف لقطر السيخ (db)
// hook_extension = طول الذيل المستقيم بعد الانحناء
// bend_diameter = قطر الانحناء الداخلي (Bend Diameter) = db × multiplier
function getHookMultipliers(barDiameter_mm) {
  // وفق ACI 318-19 Table 25.3.1: قطر الانحناء الداخلي يعتمد على قطر السيخ
  // Ø10-Ø25: 6db | Ø28-Ø36: 8db | Ø40+: 10db (للكانات db أصغر: 4db لـ Ø16 فأقل، 6db لأكبر)
  if (barDiameter_mm <= 16) return { mainBend: 6, tieBend: 4 };
  if (barDiameter_mm <= 25) return { mainBend: 6, tieBend: 6 };
  if (barDiameter_mm <= 36) return { mainBend: 8, tieBend: 6 };
  return { mainBend: 10, tieBend: 6 };
}

/**
 * حساب طول الخطاف الحقيقي (الجزء الإضافي فوق الطول المستقيم) وفق ACI 318-19 25.3
 * @param {number} barDiameter_mm - قطر السيخ
 * @param {number} hookAngle - 90 | 135 | 180
 * @param {boolean} isTie - هل الخطاف لكانة (قطر انحناء أصغر) أم لسيخ رئيسي
 */
function calculateHookLength(barDiameter_mm, hookAngle, isTie = false) {
  const db_m = barDiameter_mm / 1000;
  const { mainBend, tieBend } = getHookMultipliers(barDiameter_mm);
  const bendMultiplier = isTie ? tieBend : mainBend;
  const bendDiameter_m = bendMultiplier * db_m; // قطر الانحناء الداخلي الفعلي

  let straightExtension_m; // الذيل المستقيم بعد الانحناء (Extension)
  if (isTie) {
    // كانات: عقفة 90° تمتد 6db (أو 75مم أكبر)، عقفة 135° تمتد 6db (أو 75مم أكبر)
    if (hookAngle === 90) straightExtension_m = Math.max(6 * db_m, 0.075);
    else if (hookAngle === 135) straightExtension_m = Math.max(6 * db_m, 0.075);
    else straightExtension_m = Math.max(4 * db_m, 0.065); // 180 نادر للكانات
  } else {
    // أسياخ رئيسية: عقفة 90° تمتد 12db، عقفة 180° تمتد أكبر من 4db أو 65مم
    if (hookAngle === 90) straightExtension_m = 12 * db_m;
    else if (hookAngle === 180) straightExtension_m = Math.max(4 * db_m, 0.065);
    else straightExtension_m = 12 * db_m; // 135 يُعامل كالحد الأعلى الاحترازي
  }

  // طول قوس الانحناء الفعلي (محيط ربع/نصف دائرة بقطر الانحناء + قطر السيخ لمحور القضيب)
  const centerlineRadius_m = (bendDiameter_m + db_m) / 2;
  const archAngleRad = (hookAngle * Math.PI) / 180;
  const archLength_m = centerlineRadius_m * archAngleRad;

  // الطول الإضافي الكلي للخطاف (يُضاف لطول السيخ المستقيم الأساسي)
  const totalHookAddition_m = archLength_m + straightExtension_m;

  return {
    hook_angle_deg: hookAngle,
    bend_diameter_mm: round2(bendDiameter_m * 1000),
    arc_length_m: round2(archLength_m),
    straight_extension_m: round2(straightExtension_m),
    total_hook_length_m: round2(totalHookAddition_m),
  };
}

/**
 * طول التراكب (Lap Splice Length) وفق ACI 318-19 Section 25.5
 * Class B splice (الأكثر شيوعاً؛ يُستخدم عندما تتراكب أكثر من نصف الأسياخ في نفس المكان)
 * ld = طول التثبيت الأساسي × معامل الفئة
 * المعادلة الفعلية لطول التثبيت الأساسي بالشد (Tension Development Length) وفق ACI 318-19 Eq. 25.4.2.4:
 *   ld = ( (fy × ψt × ψe × ψs) / (1.1 × λ × sqrt(fc') × ((cb + Ktr)/db)) ) × db
 * مبسطة هنا مع الأخذ بعين الاعتبار الحد الأدنى لـ (cb+Ktr)/db = 2.5
 */
function calculateDevelopmentLength({
  barDiameter_mm,
  fy_MPa = 420,
  fc_MPa = 25,
  barLocation = 'other', // 'top' (أكثر من 300مم صب تحتها) أو 'other'
  barCoating = 'uncoated', // 'uncoated' | 'epoxy'
  lightweight = false,
  concreteCover_mm = 40,
  clearSpacing_mm = null, // المسافة الصافية بين الأسياخ (لتحديد cb)
}) {
  const db_m = barDiameter_mm / 1000;
  const db_mm = barDiameter_mm;

  // معامل موقع السيخ (Reinforcement Location Factor) ψt
  const psi_t = barLocation === 'top' ? 1.3 : 1.0;
  // معامل الطلاء (Coating Factor) ψe
  const psi_e = barCoating === 'epoxy' ? 1.5 : 1.0;
  // معامل حجم السيخ (Size Factor) ψs - أسياخ Ø20 فأصغر تُخفَّض 0.8
  const psi_s = db_mm <= 20 ? 0.8 : 1.0;
  // معامل الخرسانة خفيفة الوزن λ
  const lambda = lightweight ? 0.75 : 1.0;

  // (cb + Ktr)/db — نأخذ الحد الأقصى العملي 2.5 (تبسيط محافظ متوافق مع الكود عند غياب تسليح عرضي إضافي محدد)
  const cb_mm = clearSpacing_mm ? Math.min(concreteCover_mm + db_mm / 2, clearSpacing_mm / 2 + db_mm/2) : concreteCover_mm + db_mm / 2;
  let confinementTerm = cb_mm / db_mm;
  confinementTerm = Math.min(confinementTerm, 2.5); // الحد الأعلى المسموح به بالكود
  confinementTerm = Math.max(confinementTerm, 1.0);

  const sqrtFc = Math.sqrt(fc_MPa);

  // طول التثبيت الأساسي (مم)
  let ld_mm = (fy_MPa * psi_t * psi_e * psi_s) / (1.1 * lambda * sqrtFc * confinementTerm) * db_mm;

  // الحد الأدنى المطلق وفق الكود = 300مم
  ld_mm = Math.max(ld_mm, 300);

  return {
    development_length_mm: round2(ld_mm),
    development_length_m: round2(ld_mm / 1000),
    factors: { psi_t, psi_e, psi_s, lambda, confinement_term: round2(confinementTerm) },
    code: 'ACI 318-19 §25.4.2.4',
  };
}

/**
 * طول التراكب بالشد (Tension Lap Splice) وفق ACI 318-19 Table 25.5.2.1
 * Class A = 1.0×ld (عندما تتراكب أقل من 50% في نفس المقطع ومساحة الحديد الموفرة ضعف المطلوب)
 * Class B = 1.3×ld (الحالة الشائعة والافتراضية الأكثر تحفظاً)
 */
function calculateLapSpliceLength(developmentLength_mm, spliceClass = 'B') {
  const factor = spliceClass === 'A' ? 1.0 : 1.3;
  const lapLength_mm = developmentLength_mm * factor;
  return {
    splice_class: spliceClass,
    factor,
    lap_length_mm: round2(lapLength_mm),
    lap_length_m: round2(lapLength_mm / 1000),
    code: 'ACI 318-19 §25.5.2 Table',
  };
}

// ===== قواعد التصميم والتحقق (Design Checks) وفق ACI 318-19 =====
const SPACING_RULES = {
  // أقل تباعد صافٍ بين الأسياخ (المادة 25.2.1): أكبر قيمة من (25مم، db، (4/3)×أكبر حجم ركام)
  min_clear_spacing_mm: (barDiameter_mm, maxAggregateSize_mm = 20) =>
    Math.max(25, barDiameter_mm, (4 / 3) * maxAggregateSize_mm),
  // أقصى تباعد للتسليح الرئيسي في البلاطات (25.2.2 / 24.3): أصغر من (3×سمك البلاطة, 450مم)
  max_spacing_slab_mm: (slabThickness_mm) => Math.min(3 * slabThickness_mm, 450),
  // أقصى تباعد لتسليح الانكماش والحرارة (24.4.3.3): أصغر من (5×سمك البلاطة, 450مم)
  max_spacing_temp_steel_mm: (slabThickness_mm) => Math.min(5 * slabThickness_mm, 450),
  // أقصى تباعد للكانات في الكمرات (Non-seismic, 9.7.6.2.2): أصغر من (d/2, 600مم)
  max_stirrup_spacing_beam_mm: (effectiveDepth_mm) => Math.min(effectiveDepth_mm / 2, 600),
  // أقصى تباعد لكانات الأعمدة (10.7.6.5.2): أصغر من (16×db_main, 48×db_tie, أصغر بعد للعمود)
  max_tie_spacing_column_mm: (mainBarDia_mm, tieBarDia_mm, minColumnDim_mm) =>
    Math.min(16 * mainBarDia_mm, 48 * tieBarDia_mm, minColumnDim_mm),
};

const MIN_CONCRETE_COVER_ACI = {
  // الأغطية الدنيا وفق ACI 318-19 Table 20.5.1.3.1 (مم) - خرسانة غير معرضة للطقس/تربة إلا كما هو محدد
  cast_against_soil: 75,
  exposed_to_weather_or_soil_large_bar: 50, // Ø20 وأكبر
  exposed_to_weather_or_soil_small_bar: 40, // أصغر من Ø20
  not_exposed_slabs_walls: 20,
  not_exposed_beams_columns: 40,
};

// نسب التسليح الدنيا والقصوى (ACI 318-19)
const REINFORCEMENT_RATIOS = {
  // الحد الأدنى للتسليح المرن في الكمرات (9.6.1.2): أكبر من (0.25×sqrt(fc')/fy , 1.4/fy) [fc',fy بـ MPa]
  minFlexuralRatio: (fc_MPa, fy_MPa) => Math.max((0.25 * Math.sqrt(fc_MPa)) / fy_MPa, 1.4 / fy_MPa),
  // الحد الأقصى العملي (0.75×النسبة المتوازنة تقريباً؛ يُستخدم كحد تحذيري وليس تصميماً كاملاً)
  maxPracticalRatio: 0.025,
  // الحد الأدنى لتسليح الأعمدة (10.6.1.1): 1% من مساحة المقطع الكلية
  minColumnRatio: 0.01,
  // الحد الأقصى لتسليح الأعمدة (10.6.1.1): 8% من مساحة المقطع الكلية (4% عملياً موصى به لتفادي تكدس)
  maxColumnRatio: 0.08,
  // تسليح الانكماش والحرارة الأدنى للبلاطات (24.4.3.2): 0.0018 (Grade420) أو 0.0020 (Grade280/350)
  minTempSteelRatio: (fy_MPa) => (fy_MPa >= 420 ? 0.0018 : 0.0020),
};

// ===== مكتبة الأسعار الافتراضية (قابلة للتعديل الكامل لكل مشروع) =====
const DEFAULT_STEEL_PRICING = {
  price_per_ton: 0,          // سعر الطن الأساسي (يُدخله المستخدم/المشروع)
  price_per_bar_override: null, // سعر السيخ التجاري إن وُجد تسعير مباشر بدل الوزن
  transport_per_ton: 0,      // سعر النقل للطن
  cutting_per_ton: 0,        // سعر القص للطن
  bending_per_ton: 0,        // سعر التشكيل/الثني للطن
  installation_per_ton: 0,   // سعر التركيب (الرباط والتثبيت) للطن
  tax_percent: 0,            // ضريبة القيمة المضافة %
  discount_percent: 0,       // نسبة خصم %
};

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

module.exports = {
  MIX_DESIGNS,
  DENSITIES,
  EQUIPMENT,
  REBAR_DIAMETERS,
  rebarWeightPerMeter,
  STANDARD_BAR_LENGTH,
  DEFAULT_WASTE,
  CONCRETE_COVER,
  STEEL_GRADES,
  DESIGN_CODES,
  BAR_SURFACE,
  getHookMultipliers,
  calculateHookLength,
  calculateDevelopmentLength,
  calculateLapSpliceLength,
  SPACING_RULES,
  MIN_CONCRETE_COVER_ACI,
  REINFORCEMENT_RATIOS,
  DEFAULT_STEEL_PRICING,
};
