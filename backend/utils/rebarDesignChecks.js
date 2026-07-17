const { SPACING_RULES, MIN_CONCRETE_COVER_ACI, REINFORCEMENT_RATIOS } = require('./constants');

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * تشغيل مجموعة كاملة من قواعد التحقق التلقائي قبل اعتماد الحساب
 * يعيد قائمة نتائج كل فحص + قائمة تحذيرات/أخطاء نصية واضحة للمستخدم
 * لا يوقف الحساب (Warning-based) إلا في حالات مخالفة صريحة للحدين الأدنى/الأقصى المطلقين
 */
function runDesignChecks({
  elementType,        // footing | column | beam | slab | wall | staircase | tank | pool ...
  barDiameter_mm,
  clearSpacing_mm,
  concreteCover_mm,
  exposureCondition = 'not_exposed', // cast_against_soil | exposed_to_weather_or_soil | not_exposed
  slabThickness_mm,
  effectiveDepth_mm,
  mainBarDia_mm,
  tieBarDia_mm,
  minColumnDim_mm,
  steelRatio,          // نسبة التسليح الفعلية المحسوبة (As/Ag أو As/bd)
  fc_MPa = 25,
  fy_MPa = 420,
  maxAggregateSize_mm = 20,
  lapLength_mm,
  developmentLength_mm,
  providedLapLength_mm,
}) {
  const checks = [];
  const warnings = [];
  const errors = [];

  // 1) التحقق من أقل تباعد صافٍ بين الأسياخ
  if (barDiameter_mm && clearSpacing_mm !== undefined && clearSpacing_mm !== null) {
    const minSpacing = SPACING_RULES.min_clear_spacing_mm(barDiameter_mm, maxAggregateSize_mm);
    const ok = clearSpacing_mm >= minSpacing;
    checks.push({
      check: 'أقل تباعد صافٍ بين الأسياخ (ACI 318 §25.2.1)',
      required_min_mm: round2(minSpacing),
      provided_mm: clearSpacing_mm,
      status: ok ? 'مطابق' : 'غير مطابق',
    });
    if (!ok) errors.push(`التباعد الصافي المُدخل (${clearSpacing_mm}مم) أقل من الحد الأدنى المطلوب (${round2(minSpacing)}مم) — يجب تكبير التباعد أو تقليل عدد/قطر الأسياخ`);
  }

  // 2) التحقق من الغطاء الخرساني الأدنى
  if (concreteCover_mm !== undefined && concreteCover_mm !== null) {
    let minCover;
    if (exposureCondition === 'cast_against_soil') minCover = MIN_CONCRETE_COVER_ACI.cast_against_soil;
    else if (exposureCondition === 'exposed_to_weather_or_soil') {
      minCover = (barDiameter_mm && barDiameter_mm >= 20) ? MIN_CONCRETE_COVER_ACI.exposed_to_weather_or_soil_large_bar : MIN_CONCRETE_COVER_ACI.exposed_to_weather_or_soil_small_bar;
    } else {
      minCover = (elementType === 'slab' || elementType === 'wall') ? MIN_CONCRETE_COVER_ACI.not_exposed_slabs_walls : MIN_CONCRETE_COVER_ACI.not_exposed_beams_columns;
    }
    const ok = concreteCover_mm >= minCover;
    checks.push({
      check: 'الغطاء الخرساني الأدنى (ACI 318 §20.5.1.3.1)',
      required_min_mm: minCover,
      provided_mm: concreteCover_mm,
      status: ok ? 'مطابق' : 'غير مطابق',
    });
    if (!ok) errors.push(`الغطاء الخرساني المُدخل (${concreteCover_mm}مم) أقل من الحد الأدنى المطلوب لهذه الحالة (${minCover}مم)`);
  }

  // 3) التحقق من أقصى تباعد في البلاطات
  if (elementType === 'slab' && slabThickness_mm) {
    const maxMain = SPACING_RULES.max_spacing_slab_mm(slabThickness_mm);
    const maxTemp = SPACING_RULES.max_spacing_temp_steel_mm(slabThickness_mm);
    checks.push({
      check: 'أقصى تباعد للتسليح الرئيسي في البلاطات (ACI 318 §24.3)',
      max_allowed_mm: round2(maxMain),
      status: 'مرجعي',
    });
    checks.push({
      check: 'أقصى تباعد لتسليح الانكماش والحرارة (ACI 318 §24.4.3.3)',
      max_allowed_mm: round2(maxTemp),
      status: 'مرجعي',
    });
  }

  // 4) التحقق من أقصى تباعد الكانات في الكمرات
  if (elementType === 'beam' && effectiveDepth_mm) {
    const maxStirrup = SPACING_RULES.max_stirrup_spacing_beam_mm(effectiveDepth_mm);
    checks.push({
      check: 'أقصى تباعد للكانات في الكمرات (ACI 318 §9.7.6.2.2)',
      max_allowed_mm: round2(maxStirrup),
      status: 'مرجعي',
    });
  }

  // 5) التحقق من أقصى تباعد كانات الأعمدة
  if (elementType === 'column' && mainBarDia_mm && tieBarDia_mm && minColumnDim_mm) {
    const maxTie = SPACING_RULES.max_tie_spacing_column_mm(mainBarDia_mm, tieBarDia_mm, minColumnDim_mm);
    checks.push({
      check: 'أقصى تباعد كانات الأعمدة (ACI 318 §10.7.6.5.2)',
      max_allowed_mm: round2(maxTie),
      status: 'مرجعي',
    });
  }

  // 6) التحقق من نسبة التسليح الدنيا/القصوى
  if (steelRatio !== undefined && steelRatio !== null) {
    if (elementType === 'column') {
      const ok = steelRatio >= REINFORCEMENT_RATIOS.minColumnRatio && steelRatio <= REINFORCEMENT_RATIOS.maxColumnRatio;
      checks.push({
        check: 'نسبة تسليح الأعمدة (ACI 318 §10.6.1.1)',
        min_required: REINFORCEMENT_RATIOS.minColumnRatio,
        max_allowed: REINFORCEMENT_RATIOS.maxColumnRatio,
        provided: round2(steelRatio),
        status: ok ? 'مطابق' : 'غير مطابق',
      });
      if (steelRatio < REINFORCEMENT_RATIOS.minColumnRatio) errors.push(`نسبة تسليح العمود (${(steelRatio * 100).toFixed(2)}%) أقل من الحد الأدنى (1%)`);
      if (steelRatio > REINFORCEMENT_RATIOS.maxColumnRatio) errors.push(`نسبة تسليح العمود (${(steelRatio * 100).toFixed(2)}%) تتجاوز الحد الأقصى (8%)`);
    } else if (elementType === 'beam' || elementType === 'slab') {
      const minRatio = elementType === 'beam'
        ? REINFORCEMENT_RATIOS.minFlexuralRatio(fc_MPa, fy_MPa)
        : REINFORCEMENT_RATIOS.minTempSteelRatio(fy_MPa);
      const ok = steelRatio >= minRatio;
      checks.push({
        check: elementType === 'beam' ? 'نسبة التسليح المرن الدنيا (ACI 318 §9.6.1.2)' : 'نسبة تسليح الانكماش والحرارة الدنيا (ACI 318 §24.4.3.2)',
        min_required: round2(minRatio),
        provided: round2(steelRatio),
        status: ok ? 'مطابق' : 'غير مطابق',
      });
      if (!ok) warnings.push(`نسبة التسليح المُدخلة (${(steelRatio * 100).toFixed(3)}%) أقل من الحد الأدنى الموصى به (${(minRatio * 100).toFixed(3)}%)`);
    }
  }

  // 7) التحقق من طول التراكب الفعلي المُدخل مقابل المطلوب
  if (lapLength_mm && providedLapLength_mm) {
    const ok = providedLapLength_mm >= lapLength_mm;
    checks.push({
      check: 'طول التراكب المُنفَّذ مقابل المطلوب (ACI 318 §25.5.2)',
      required_min_mm: round2(lapLength_mm),
      provided_mm: providedLapLength_mm,
      status: ok ? 'مطابق' : 'غير مطابق',
    });
    if (!ok) errors.push(`طول التراكب المُدخل (${providedLapLength_mm}مم) أقل من الطول المطلوب هندسياً (${round2(lapLength_mm)}مم)`);
  }

  return {
    element_type: elementType,
    checks,
    warnings,
    errors,
    overall_status: errors.length === 0 ? 'مقبول' : 'يتطلب مراجعة',
    checks_passed: checks.filter(c => c.status === 'مطابق').length,
    checks_total: checks.filter(c => c.status !== 'مرجعي').length,
  };
}

module.exports = { runDesignChecks };
