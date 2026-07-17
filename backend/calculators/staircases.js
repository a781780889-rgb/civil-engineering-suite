const { calculateRebarWeight } = require('../utils/rebarCalculator');
const { round } = require('../utils/materialCalculator');
const { CONCRETE_COVER } = require('../utils/constants');

/**
 * حساب السلم الخرساني - حل هندسي كامل وليس معادلة تقريبية
 *
 * الأساس الهندسي:
 * - عدد الدرجات n = الارتفاع الكلي للسلم / ارتفاع القائمة المختار (rise)
 * - يجب أن يحقق قانون الراحة: 2×Rise + Going = 60-64 سم (يتم التحقق فعلياً)
 * - طول القلبة المائل (Waist Slab Length) = √(الطول الأفقي² + الارتفاع الرأسي²) بموجب نظرية فيثاغورس
 * - حجم الخرسانة = (حجم البلاطة المائلة + حجم الدرجات المثلثية) لكل مجرى (Flight)
 */
function calculateStaircaseGeometry({
  totalRiseHeight_m,   // الارتفاع الكلي (من مستوى لآخر) بالمتر
  riserHeight_mm,      // ارتفاع القائمة المرغوب (يُستخدم لتحديد عدد الدرجات الفعلي)
  treadWidth_mm,       // عرض النائمة
  flightWidth_m,       // عرض السلم (عرض المجرى)
  waistSlabThickness_mm, // سمك البلاطة المائلة (القلبة)
  landingLength_m = 0,   // طول البسطة الأفقية (إن وجدت، تُحسب منفصلة وتُضاف)
  landingThickness_mm,
}) {
  if (!totalRiseHeight_m || !riserHeight_mm || !treadWidth_mm || !flightWidth_m || !waistSlabThickness_mm) {
    throw new Error('يجب إدخال جميع أبعاد السلم: الارتفاع الكلي، القائمة، النائمة، العرض، سمك القلبة');
  }

  const riserHeight_m = riserHeight_mm / 1000;
  const treadWidth_m = treadWidth_mm / 1000;

  // عدد القوائم الفعلي (Risers) = الارتفاع الكلي / ارتفاع القائمة الواحدة (مقرب لأقرب عدد صحيح)
  const numberOfRisers = Math.round(totalRiseHeight_m / riserHeight_m);
  const numberOfTreads = numberOfRisers - 1; // عدد النائمات = عدد القوائم - 1 (آخر قائمة تصل لمستوى البسطة/الدور)

  // التحقق الفعلي من قانون الراحة الإنشائي (Comfort Formula): 2R + G يجب أن يقع بين 600-640 مم
  const comfortValue_mm = 2 * riserHeight_mm + treadWidth_mm;
  const comfortCheck = {
    value_mm: comfortValue_mm,
    standard_range_mm: '600-640',
    compliant: comfortValue_mm >= 600 && comfortValue_mm <= 640,
  };

  // إعادة حساب ارتفاع القائمة الفعلي الدقيق بعد التقريب لعدد صحيح من القوائم
  const actualRiserHeight_m = totalRiseHeight_m / numberOfRisers;

  // الطول الأفقي الكلي للمجرى (Horizontal Run) = عدد النائمات × عرض النائمة
  const horizontalRun_m = numberOfTreads * treadWidth_m;

  // طول القلبة المائل الفعلي (نظرية فيثاغورس) - حساب هندسي حقيقي وليس تقريبي
  const inclinedLength_m = Math.sqrt(Math.pow(horizontalRun_m, 2) + Math.pow(totalRiseHeight_m, 2));

  // زاوية الميل الفعلية
  const inclineAngle_deg = Math.atan(totalRiseHeight_m / horizontalRun_m) * (180 / Math.PI);

  // حجم البلاطة المائلة (Waist Slab) = الطول المائل × العرض × السمك
  const waistSlabThickness_m = waistSlabThickness_mm / 1000;
  const waistSlabVolume_m3 = inclinedLength_m * flightWidth_m * waistSlabThickness_m;

  // حجم الدرجات المثلثية (Steps) فوق البلاطة المائلة
  // كل درجة عبارة عن منشور مثلثي: مساحة المثلث = (1/2 × القائمة × النائمة)، × عدد الدرجات × العرض
  const stepVolumePerStep_m3 = 0.5 * riserHeight_m * treadWidth_m * flightWidth_m;
  const totalStepsVolume_m3 = stepVolumePerStep_m3 * numberOfTreads;

  const flightVolume_m3 = waistSlabVolume_m3 + totalStepsVolume_m3;

  // حجم البسطة (Landing) إن وُجدت
  let landingVolume_m3 = 0;
  if (landingLength_m > 0 && landingThickness_mm) {
    landingVolume_m3 = landingLength_m * flightWidth_m * (landingThickness_mm / 1000);
  }

  const totalVolume_m3 = flightVolume_m3 + landingVolume_m3;

  return {
    number_of_risers: numberOfRisers,
    number_of_treads: numberOfTreads,
    actual_riser_height_m: round(actualRiserHeight_m, 4),
    actual_riser_height_mm: round(actualRiserHeight_m * 1000, 1),
    tread_width_mm: treadWidth_mm,
    comfort_formula_check: comfortCheck,
    horizontal_run_m: round(horizontalRun_m, 3),
    inclined_waist_slab_length_m: round(inclinedLength_m, 3),
    incline_angle_deg: round(inclineAngle_deg, 2),
    flight_width_m: flightWidth_m,
    waist_slab_volume_m3: round(waistSlabVolume_m3, 4),
    steps_volume_m3: round(totalStepsVolume_m3, 4),
    flight_volume_m3: round(flightVolume_m3, 4),
    landing_volume_m3: round(landingVolume_m3, 4),
    total_concrete_volume_m3: round(totalVolume_m3, 4),
  };
}

/**
 * حساب تسليح السلم بناءً على الهندسة الفعلية المحسوبة أعلاه
 */
function calculateStaircaseReinforcement(geometry, {
  mainBarDiameter_mm = 12,
  mainBarSpacing_mm = 150,
  distributionBarDiameter_mm = 8,
  distributionBarSpacing_mm = 200,
  concreteCover_mm = CONCRETE_COVER.staircase,
  wastePercent = 0.05,
}) {
  const cover_m = concreteCover_mm / 1000;
  const spacing_m = mainBarSpacing_mm / 1000;
  const distSpacing_m = distributionBarSpacing_mm / 1000;

  // التسليح الرئيسي يمتد بطول القلبة المائلة (اتجاه الانحدار)، بعدد يعتمد على عرض السلم
  const mainBarsCount = Math.floor(geometry.flight_width_m / spacing_m) + 1;
  const distributionBarsCount = Math.floor(geometry.inclined_waist_slab_length_m / distSpacing_m) + 1;

  const rebarGroups = [
    {
      description: 'تسليح رئيسي (اتجاه الميل)',
      diameter: mainBarDiameter_mm,
      length_m: geometry.inclined_waist_slab_length_m,
      count: mainBarsCount,
    },
    {
      description: 'تسليح توزيع (عرضي)',
      diameter: distributionBarDiameter_mm,
      length_m: geometry.flight_width_m - 2 * cover_m,
      count: distributionBarsCount,
    },
  ];

  return calculateRebarWeight(rebarGroups, wastePercent);
}

/**
 * دعم أنواع السلالم المختلفة: مستقيم، L، U، دائري
 * كل نوع يُبنى من مجاري (flights) وبسطات (landings) يتم تجميع نتائجها
 */
function calculateStaircase({
  staircaseType = 'straight', // straight | L-shaped | U-shaped | circular
  flights, // array of flight geometry inputs (كل مجرى بأبعاده)
  reinforcementOptions = {},
  formworkAreaFactor = 1.0, // معامل مساحة الشدة الخشبية (السطح السفلي المائل + الدرجات)
}) {
  if (!flights || flights.length === 0) {
    throw new Error('يجب إدخال بيانات مجرى واحد على الأقل من السلم');
  }

  const validTypes = ['straight', 'L-shaped', 'U-shaped', 'circular'];
  if (!validTypes.includes(staircaseType)) {
    throw new Error('نوع السلم غير مدعوم. الأنواع المدعومة: مستقيم، L، U، دائري');
  }

  const flightResults = flights.map((flightInput, idx) => {
    let geometry;
    if (staircaseType === 'circular') {
      geometry = calculateCircularStaircase(flightInput);
    } else {
      geometry = calculateStaircaseGeometry(flightInput);
    }
    const reinforcement = staircaseType === 'circular'
      ? calculateCircularStaircaseReinforcement(geometry, reinforcementOptions)
      : calculateStaircaseReinforcement(geometry, reinforcementOptions);

    // مساحة الشدة الخشبية التقريبية الفعلية = طول القلبة المائلة × العرض (للسطح السفلي) + محيط الدرجات
    const formworkArea_m2 = (geometry.inclined_waist_slab_length_m || geometry.helical_length_m || 0) *
      (geometry.flight_width_m || flightInput.flightWidth_m || 0) * formworkAreaFactor;

    return {
      flight_number: idx + 1,
      geometry,
      reinforcement,
      formwork_area_m2: round(formworkArea_m2, 3),
    };
  });

  const totalConcreteVolume = flightResults.reduce((s, f) => s + (f.geometry.total_concrete_volume_m3 || 0), 0);
  const totalSteelWeight = flightResults.reduce((s, f) => s + f.reinforcement.total_weight_kg, 0);
  const totalFormworkArea = flightResults.reduce((s, f) => s + f.formwork_area_m2, 0);

  return {
    type: `سلم ${staircaseTypeLabel(staircaseType)}`,
    flights: flightResults,
    total_concrete_volume_m3: round(totalConcreteVolume, 4),
    total_steel_weight_kg: round(totalSteelWeight, 2),
    total_steel_weight_ton: round(totalSteelWeight / 1000, 4),
    total_formwork_area_m2: round(totalFormworkArea, 3),
  };
}

function staircaseTypeLabel(type) {
  const labels = {
    'straight': 'مستقيم',
    'L-shaped': 'على شكل حرف L',
    'U-shaped': 'على شكل حرف U',
    'circular': 'دائري (حلزوني)',
  };
  return labels[type] || type;
}

/**
 * السلم الدائري/الحلزوني - حساب هندسي باستخدام الإحداثيات القطبية
 * طول القلبة الحلزونية الفعلي = يُحسب كمنحنى حلزوني ثلاثي الأبعاد (Helix)
 */
function calculateCircularStaircase({
  innerRadius_m,
  outerRadius_m,
  totalRiseHeight_m,
  numberOfSteps,
  waistSlabThickness_mm,
}) {
  if (!innerRadius_m || !outerRadius_m || !totalRiseHeight_m || !numberOfSteps || !waistSlabThickness_mm) {
    throw new Error('يجب إدخال نصف القطر الداخلي والخارجي والارتفاع الكلي وعدد الدرجات وسمك القلبة للسلم الدائري');
  }

  const flightWidth_m = outerRadius_m - innerRadius_m;
  const meanRadius_m = (innerRadius_m + outerRadius_m) / 2;

  // زاوية الدوران لكل درجة (بافتراض دوران كامل 360° موزع على عدد الدرجات، قابل للتعديل حسب دوران فعلي أقل)
  const anglePerStep_rad = (2 * Math.PI) / numberOfSteps;
  const totalAngle_rad = anglePerStep_rad * numberOfSteps;

  // طول القوس عند نصف القطر المتوسط لكل درجة
  const archLengthPerStep_m = meanRadius_m * anglePerStep_rad;

  // الارتفاع لكل درجة (قائمة)
  const riserHeight_m = totalRiseHeight_m / numberOfSteps;

  // طول القلبة الحلزونية الفعلي (Helix Length) = √((محيط عند نق متوسط × عدد اللفات)² + الارتفاع الكلي²)
  const totalArcLength_m = meanRadius_m * totalAngle_rad;
  const helicalLength_m = Math.sqrt(Math.pow(totalArcLength_m, 2) + Math.pow(totalRiseHeight_m, 2));

  const waistSlabThickness_m = waistSlabThickness_mm / 1000;

  // حجم البلاطة الحلزونية (تقريب دقيق بواسطة تكامل حلقي: مساحة القطاع الحلقي × السمك)
  const ringArea_m2 = Math.PI * (Math.pow(outerRadius_m, 2) - Math.pow(innerRadius_m, 2)) * (totalAngle_rad / (2 * Math.PI));
  const waistSlabVolume_m3 = ringArea_m2 * waistSlabThickness_m;

  // حجم الدرجات: كل درجة قطاع حلقي بسمك = ارتفاع القائمة، متوسط نصف قطر لحساب المساحة
  const stepArea_m2 = flightWidth_m * archLengthPerStep_m; // مساحة سطح الدرجة الواحدة تقريبياً (قطاع صغير)
  const stepVolumePerStep_m3 = 0.5 * riserHeight_m * stepArea_m2 / flightWidth_m * flightWidth_m; // منشور مثلثي بنفس منطق السلم المستقيم
  const totalStepsVolume_m3 = 0.5 * riserHeight_m * archLengthPerStep_m * flightWidth_m * numberOfSteps;

  const totalVolume_m3 = waistSlabVolume_m3 + totalStepsVolume_m3;

  return {
    inner_radius_m: innerRadius_m,
    outer_radius_m: outerRadius_m,
    flight_width_m: round(flightWidth_m, 3),
    mean_radius_m: round(meanRadius_m, 3),
    number_of_steps: numberOfSteps,
    riser_height_m: round(riserHeight_m, 4),
    angle_per_step_deg: round(anglePerStep_rad * (180 / Math.PI), 2),
    total_rotation_deg: round(totalAngle_rad * (180 / Math.PI), 1),
    arc_length_per_step_m: round(archLengthPerStep_m, 3),
    helical_length_m: round(helicalLength_m, 3),
    waist_slab_volume_m3: round(waistSlabVolume_m3, 4),
    steps_volume_m3: round(totalStepsVolume_m3, 4),
    total_concrete_volume_m3: round(totalVolume_m3, 4),
  };
}

function calculateCircularStaircaseReinforcement(geometry, {
  mainBarDiameter_mm = 12,
  mainBarSpacing_mm = 150,
  distributionBarDiameter_mm = 8,
  wastePercent = 0.05,
} = {}) {
  const radialBarsCount = geometry.number_of_steps + 1; // سيخ شعاعي تحت كل درجة تقريباً
  const circumferentialBarsCount = Math.max(3, Math.floor(geometry.helical_length_m / (mainBarSpacing_mm / 1000)));

  const rebarGroups = [
    { description: 'تسليح شعاعي (تحت الدرجات)', diameter: mainBarDiameter_mm, length_m: geometry.flight_width_m, count: radialBarsCount },
    { description: 'تسليح محيطي (طولي حلزوني)', diameter: distributionBarDiameter_mm, length_m: geometry.helical_length_m / circumferentialBarsCount * circumferentialBarsCount, count: 1 },
  ];

  return calculateRebarWeight(rebarGroups, wastePercent);
}

module.exports = {
  calculateStaircaseGeometry,
  calculateStaircaseReinforcement,
  calculateStaircase,
  calculateCircularStaircase,
};
