/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * النجارة (Carpentry) + الألمنيوم والزجاج (Aluminum & Glass)
 */

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/**
 * حساب أعمال الأبواب الخشبية (تجميع من قائمة أبواب بمقاسات مختلفة)
 */
function calculateWoodenDoors({ doors }) {
  if (!Array.isArray(doors) || doors.length === 0) {
    throw new Error('يجب إدخال قائمة الأبواب (width_m, height_m, count, type)');
  }
  let totalArea = 0;
  let totalCount = 0;
  const items = doors.map((d, idx) => {
    const { width_m, height_m, count = 1, type = 'standard', frameIncluded = true } = d;
    if (!width_m || !height_m) throw new Error(`أبعاد ناقصة للباب رقم ${idx + 1}`);
    const leafArea = width_m * height_m;
    const totalLeafArea = leafArea * count;
    // طول الكسوة الخشبية للإطار (Frame/Architrave) = محيط الفتحة تقريباً × عدد الوحدات
    const frameLength_m = frameIncluded ? (2 * height_m + width_m) * count : 0;
    totalArea += totalLeafArea;
    totalCount += count;
    return {
      door: idx + 1,
      type,
      size_m: `${width_m}×${height_m}`,
      count,
      leaf_area_m2: round2(leafArea),
      total_leaf_area_m2: round2(totalLeafArea),
      frame_length_m: round2(frameLength_m),
    };
  });

  return {
    items,
    summary: {
      total_doors: totalCount,
      total_leaf_area_m2: round2(totalArea),
    },
  };
}

/**
 * حساب أعمال الشبابيك الخشبية (إن وُجدت) - نفس منطق الأبواب مع فتحة زجاج
 */
function calculateWoodenWindows({ windows }) {
  if (!Array.isArray(windows) || windows.length === 0) {
    throw new Error('يجب إدخال قائمة الشبابيك');
  }
  let totalArea = 0;
  let totalCount = 0;
  const items = windows.map((w, idx) => {
    const { width_m, height_m, count = 1 } = w;
    if (!width_m || !height_m) throw new Error(`أبعاد ناقصة للشباك رقم ${idx + 1}`);
    const area = width_m * height_m * count;
    totalArea += area;
    totalCount += count;
    return { window: idx + 1, size_m: `${width_m}×${height_m}`, count, total_area_m2: round2(area) };
  });
  return { items, summary: { total_windows: totalCount, total_area_m2: round2(totalArea) } };
}

/**
 * حساب المطابخ الخشبية (Linear Meters - وحدات علوية وسفلية) اعتماداً على الطول الفعلي
 */
function calculateKitchenCabinets({
  lowerUnitsLength_m,
  upperUnitsLength_m = 0,
  lowerUnitDepth_m = 0.6,
  upperUnitDepth_m = 0.35,
  counterTopThickness_cm = 3,
  includeBacksplash = true,
  backsplashHeight_m = 0.6,
}) {
  if (!lowerUnitsLength_m) throw new Error('يجب إدخال طول وحدات المطبخ السفلية');

  const counterTopArea_m2 = lowerUnitsLength_m * lowerUnitDepth_m;
  const backsplashArea_m2 = includeBacksplash ? lowerUnitsLength_m * backsplashHeight_m : 0;

  return {
    lower_units_length_m: lowerUnitsLength_m,
    upper_units_length_m: upperUnitsLength_m,
    counter_top_area_m2: round2(counterTopArea_m2),
    counter_top_thickness_cm: counterTopThickness_cm,
    backsplash_area_m2: round2(backsplashArea_m2),
    total_linear_meters: round2(lowerUnitsLength_m + upperUnitsLength_m),
  };
}

/**
 * حساب الخزائن الحائطية (Wardrobes) بالمتر الطولي أو بعدد الوحدات
 */
function calculateWardrobes({ units }) {
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error('يجب إدخال قائمة الخزائن (width_m, height_m, depth_m, count)');
  }
  let totalFrontArea = 0;
  let totalVolume = 0;
  const items = units.map((u, idx) => {
    const { width_m, height_m, depth_m = 0.6, count = 1 } = u;
    if (!width_m || !height_m) throw new Error(`أبعاد ناقصة للخزانة رقم ${idx + 1}`);
    const frontArea = width_m * height_m * count;
    const volume = width_m * height_m * depth_m * count;
    totalFrontArea += frontArea;
    totalVolume += volume;
    return {
      unit: idx + 1,
      size_m: `${width_m}×${height_m}×${depth_m}`,
      count,
      front_area_m2: round2(frontArea),
    };
  });
  return { items, summary: { total_front_area_m2: round2(totalFrontArea), total_volume_m3: round2(totalVolume) } };
}

// ================= الألمنيوم والزجاج (Aluminum & Glass) =================

/**
 * حساب واجهات الألمنيوم والزجاج (Curtain Wall) - المساحة الكلية + طول البروفايل التقديري
 * طول البروفايل يُحسب من محيط كل وحدة زجاجية ضمن الشبكة (Grid Pattern)
 */
function calculateCurtainWallFacade({
  totalWidth_m,
  totalHeight_m,
  moduleWidth_m = 1.2, // عرض الوحدة الزجاجية الواحدة (Mullion Spacing)
  moduleHeight_m = 1.5,
  glassThickness_mm = 6,
  isDoubleGlazed = false,
}) {
  if (!totalWidth_m || !totalHeight_m) {
    throw new Error('يجب إدخال العرض والارتفاع الكلي للواجهة');
  }
  const totalArea_m2 = totalWidth_m * totalHeight_m;
  const modulesX = Math.ceil(totalWidth_m / moduleWidth_m);
  const modulesY = Math.ceil(totalHeight_m / moduleHeight_m);
  const totalModules = modulesX * modulesY;

  // طول العمودي (Mullions) والأفقي (Transoms) بناءً على عدد خطوط الشبكة الداخلية
  const verticalMullionsLength_m = (modulesX + 1) * totalHeight_m;
  const horizontalTransomsLength_m = (modulesY + 1) * totalWidth_m;
  const totalProfileLength_m = verticalMullionsLength_m + horizontalTransomsLength_m;

  const glassArea_m2 = totalArea_m2; // صافي تقريبي (يُخصم عرض البروفايل في تصميم تفصيلي لاحق)
  const glassLayers = isDoubleGlazed ? 2 : 1;

  return {
    total_area_m2: round2(totalArea_m2),
    modules_x: modulesX,
    modules_y: modulesY,
    total_modules: totalModules,
    vertical_mullions_length_m: round2(verticalMullionsLength_m),
    horizontal_transoms_length_m: round2(horizontalTransomsLength_m),
    total_aluminum_profile_length_m: round2(totalProfileLength_m),
    glass_area_m2: round2(glassArea_m2),
    glass_thickness_mm: glassThickness_mm,
    glass_type: isDoubleGlazed ? 'زجاج مزدوج (Double Glazed)' : 'زجاج فردي (Single Glazed)',
    glass_layers: glassLayers,
  };
}

/**
 * حساب شبابيك الألمنيوم (سحاب/فتح) - محيط البروفايل + مساحة الزجاج
 */
function calculateAluminumWindows({ windows }) {
  if (!Array.isArray(windows) || windows.length === 0) {
    throw new Error('يجب إدخال قائمة شبابيك الألمنيوم');
  }
  let totalGlassArea = 0;
  let totalProfileLength = 0;
  let totalCount = 0;
  const items = windows.map((w, idx) => {
    const { width_m, height_m, count = 1, panels = 2 } = w;
    if (!width_m || !height_m) throw new Error(`أبعاد ناقصة للشباك رقم ${idx + 1}`);
    const glassArea = width_m * height_m * count;
    // محيط الإطار الخارجي + الحاجز الأوسط بعدد الألواح (Panels)
    const perimeter = 2 * (width_m + height_m);
    const midRails = (panels - 1) * height_m;
    const profileLength = (perimeter + midRails) * count;
    totalGlassArea += glassArea;
    totalProfileLength += profileLength;
    totalCount += count;
    return {
      window: idx + 1,
      size_m: `${width_m}×${height_m}`,
      count,
      panels,
      glass_area_m2: round2(glassArea),
      profile_length_m: round2(profileLength),
    };
  });

  return {
    items,
    summary: {
      total_windows: totalCount,
      total_glass_area_m2: round2(totalGlassArea),
      total_profile_length_m: round2(totalProfileLength),
    },
  };
}

/**
 * حساب أبواب الألمنيوم والزجاج
 */
function calculateAluminumDoors({ doors }) {
  if (!Array.isArray(doors) || doors.length === 0) {
    throw new Error('يجب إدخال قائمة أبواب الألمنيوم');
  }
  let totalGlassArea = 0;
  let totalProfileLength = 0;
  let totalCount = 0;
  const items = doors.map((d, idx) => {
    const { width_m, height_m, count = 1, leaves = 1 } = d;
    if (!width_m || !height_m) throw new Error(`أبعاد ناقصة للباب رقم ${idx + 1}`);
    const glassArea = width_m * height_m * count;
    const perimeter = 2 * (width_m + height_m);
    const midRails = (leaves - 1) * height_m;
    const profileLength = (perimeter + midRails) * count;
    totalGlassArea += glassArea;
    totalProfileLength += profileLength;
    totalCount += count;
    return {
      door: idx + 1,
      size_m: `${width_m}×${height_m}`,
      count,
      leaves,
      glass_area_m2: round2(glassArea),
      profile_length_m: round2(profileLength),
    };
  });

  return {
    items,
    summary: {
      total_doors: totalCount,
      total_glass_area_m2: round2(totalGlassArea),
      total_profile_length_m: round2(totalProfileLength),
    },
  };
}

/**
 * حساب القباب الزجاجية (Skylight Domes) - دائرية أو هرمية
 */
function calculateGlassDome({
  shape = 'circular', // circular | pyramidal
  diameter_m = null,
  baseLength_m = null,
  baseWidth_m = null,
  height_m,
}) {
  if (!height_m) throw new Error('يجب إدخال ارتفاع القبة');

  if (shape === 'circular') {
    if (!diameter_m) throw new Error('يجب إدخال قطر القبة الدائرية');
    const radius = diameter_m / 2;
    // مساحة سطح قبة كروية جزئية تقريبية (Spherical Cap): A = 2πRh حيث R نصف قطر انحناء مكافئ
    const slantHeight = Math.sqrt(radius * radius + height_m * height_m);
    const surfaceArea_m2 = Math.PI * radius * slantHeight; // تقريب مخروطي للقبة (تحفظي وشائع في الحصر)
    const baseArea_m2 = Math.PI * radius * radius;
    return {
      shape: 'دائرية (مخروطية تقريبية)',
      diameter_m,
      height_m,
      base_area_m2: round2(baseArea_m2),
      surface_area_m2: round2(surfaceArea_m2),
    };
  }

  if (shape === 'pyramidal') {
    if (!baseLength_m || !baseWidth_m) throw new Error('يجب إدخال طول وعرض قاعدة القبة الهرمية');
    const halfL = baseLength_m / 2;
    const halfW = baseWidth_m / 2;
    const slantHeightL = Math.sqrt(height_m * height_m + halfW * halfW);
    const slantHeightW = Math.sqrt(height_m * height_m + halfL * halfL);
    const surfaceArea_m2 = baseLength_m * slantHeightL + baseWidth_m * slantHeightW;
    return {
      shape: 'هرمية',
      base_size_m: `${baseLength_m}×${baseWidth_m}`,
      height_m,
      base_area_m2: round2(baseLength_m * baseWidth_m),
      surface_area_m2: round2(surfaceArea_m2),
    };
  }

  throw new Error('نوع شكل القبة غير مدعوم (circular أو pyramidal فقط)');
}

module.exports = {
  calculateWoodenDoors,
  calculateWoodenWindows,
  calculateKitchenCabinets,
  calculateWardrobes,
  calculateCurtainWallFacade,
  calculateAluminumWindows,
  calculateAluminumDoors,
  calculateGlassDome,
};
