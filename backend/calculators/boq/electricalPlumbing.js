/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * الأعمال الكهربائية (Electrical) + الأعمال الصحية (Plumbing/Sanitary)
 */

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/**
 * حساب كابلات الكهرباء - يجمع دوائر الإنارة والمقابس مع نسبة هدر التمديد (انحناءات وربط)
 */
function calculateElectricalCables({ circuits }) {
  if (!Array.isArray(circuits) || circuits.length === 0) {
    throw new Error('يجب إدخال قائمة الدوائر الكهربائية (length_m, cableSize_mm2, count, wastePercent)');
  }
  let totalLength = 0;
  const bySize = {};

  const items = circuits.map((c, idx) => {
    const { length_m, cableSize_mm2, count = 1, wastePercent = 15, circuitName = `دائرة ${idx + 1}` } = c;
    if (!length_m || !cableSize_mm2) throw new Error(`بيانات ناقصة للدائرة رقم ${idx + 1}`);
    const totalRunLength = length_m * count * (1 + wastePercent / 100);
    totalLength += totalRunLength;
    bySize[cableSize_mm2] = (bySize[cableSize_mm2] || 0) + totalRunLength;
    return {
      circuit: circuitName,
      cable_size_mm2: cableSize_mm2,
      count,
      run_length_m: round2(totalRunLength),
    };
  });

  return {
    items,
    summary: {
      total_cable_length_m: round2(totalLength),
      by_cable_size_mm2: Object.fromEntries(
        Object.entries(bySize).map(([size, len]) => [size, round2(len)])
      ),
    },
  };
}

/**
 * حساب مواسير التمديدات الكهربائية (PVC/Conduit) بالطول مع نسبة هدر
 */
function calculateElectricalConduits({ runs }) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('يجب إدخال قائمة مسارات المواسير (length_m, diameter_mm, count)');
  }
  let totalLength = 0;
  const byDiameter = {};

  const items = runs.map((r, idx) => {
    const { length_m, diameter_mm, count = 1, wastePercent = 10 } = r;
    if (!length_m || !diameter_mm) throw new Error(`بيانات ناقصة للمسار رقم ${idx + 1}`);
    const total = length_m * count * (1 + wastePercent / 100);
    totalLength += total;
    byDiameter[diameter_mm] = (byDiameter[diameter_mm] || 0) + total;
    return { run: idx + 1, diameter_mm, count, total_length_m: round2(total) };
  });

  return {
    items,
    summary: {
      total_conduit_length_m: round2(totalLength),
      by_diameter_mm: Object.fromEntries(
        Object.entries(byDiameter).map(([d, len]) => [d, round2(len)])
      ),
    },
  };
}

/**
 * حساب اللوحات الكهربائية الفرعية والرئيسية (عدد + سعة تحمل تقديرية بالأمبير)
 */
function calculateElectricalPanels({ panels }) {
  if (!Array.isArray(panels) || panels.length === 0) {
    throw new Error('يجب إدخال قائمة اللوحات (type, numberOfWays, mainBreakerAmp, count)');
  }
  let totalPanels = 0;
  const items = panels.map((p, idx) => {
    const { type = 'sub-panel', numberOfWays, mainBreakerAmp, count = 1 } = p;
    if (!numberOfWays || !mainBreakerAmp) throw new Error(`بيانات ناقصة للوحة رقم ${idx + 1}`);
    totalPanels += count;
    return { panel: idx + 1, type, ways: numberOfWays, main_breaker_amp: mainBreakerAmp, count };
  });
  return { items, summary: { total_panels: totalPanels } };
}

/**
 * حساب المفاتيح والمقابس ونقاط الإنارة (عدّ مباشر مع تصنيف حسب النوع)
 */
function calculateSwitchesOutlets({ points }) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('يجب إدخال قائمة النقاط (type, count) مثل: switch, socket, light_point');
  }
  const byType = {};
  let total = 0;
  points.forEach((p) => {
    const { type, count = 1 } = p;
    if (!type) throw new Error('يجب تحديد نوع النقطة (switch/socket/light_point/...)');
    byType[type] = (byType[type] || 0) + count;
    total += count;
  });
  return { by_type: byType, total_points: total };
}

/**
 * حساب نظام التأريض (Earthing/Grounding) - طول الموصل النحاسي + عدد قضبان التأريض
 */
function calculateEarthingSystem({
  perimeterLength_m,
  numberOfGroundRods = 1,
  rodSpacing_m = 3,
  copperWireSize_mm2 = 25,
}) {
  if (!perimeterLength_m) throw new Error('يجب إدخال طول محيط شبكة التأريض');
  const calculatedRods = numberOfGroundRods || Math.ceil(perimeterLength_m / rodSpacing_m);
  const wireLength_m = perimeterLength_m * 1.1; // 10% هدر للربط والانحناءات

  return {
    perimeter_length_m: perimeterLength_m,
    ground_rods_count: calculatedRods,
    copper_wire_size_mm2: copperWireSize_mm2,
    copper_wire_length_m: round2(wireLength_m),
  };
}

/**
 * حساب أنظمة إنذار وإطفاء الحريق (كاشفات دخان/حرارة + رشاشات + طفايات)
 */
function calculateFireAlarmSystem({
  floorArea_m2,
  detectorCoverage_m2 = 60, // كاشف واحد لكل 60م2 (تقريب معياري NFPA)
  sprinklerCoverage_m2 = 12, // رشاش واحد لكل 12م2 (نمطي للمخاطر الخفيفة)
  includeSprinklers = true,
  extinguisherCoverage_m2 = 200, // طفاية واحدة لكل 200م2 (تقريب معياري)
}) {
  if (!floorArea_m2) throw new Error('يجب إدخال مساحة الطابق');
  const detectors = Math.ceil(floorArea_m2 / detectorCoverage_m2);
  const sprinklers = includeSprinklers ? Math.ceil(floorArea_m2 / sprinklerCoverage_m2) : 0;
  const extinguishers = Math.ceil(floorArea_m2 / extinguisherCoverage_m2);

  return {
    floor_area_m2: floorArea_m2,
    smoke_heat_detectors: detectors,
    sprinklers,
    fire_extinguishers: extinguishers,
    notes: 'تقديرات وفق معايير تغطية نمطية (NFPA) — تُحدَّد الأعداد النهائية وفق مخطط السلامة المعتمد من المهندس المختص',
  };
}

// ================= الأعمال الصحية (Plumbing / Sanitary) =================

/**
 * حساب مواسير مياه التغذية (Water Supply Pipes) بالطول مع تصنيف حسب القطر
 */
function calculateWaterSupplyPipes({ runs }) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('يجب إدخال قائمة مسارات مواسير المياه (length_m, diameter_mm, material, count)');
  }
  let totalLength = 0;
  const byDiameter = {};
  const items = runs.map((r, idx) => {
    const { length_m, diameter_mm, material = 'PPR', count = 1, wastePercent = 8 } = r;
    if (!length_m || !diameter_mm) throw new Error(`بيانات ناقصة للمسار رقم ${idx + 1}`);
    const total = length_m * count * (1 + wastePercent / 100);
    totalLength += total;
    byDiameter[diameter_mm] = (byDiameter[diameter_mm] || 0) + total;
    return { run: idx + 1, material, diameter_mm, count, total_length_m: round2(total) };
  });

  return {
    items,
    summary: {
      total_length_m: round2(totalLength),
      by_diameter_mm: Object.fromEntries(
        Object.entries(byDiameter).map(([d, len]) => [d, round2(len)])
      ),
    },
  };
}

/**
 * حساب مواسير الصرف الصحي (Drainage) بالطول مع الميل المطلوب (Slope)
 */
function calculateDrainagePipes({ runs, minSlopePercent = 1 }) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('يجب إدخال قائمة مسارات الصرف (length_m, diameter_mm, count)');
  }
  let totalLength = 0;
  const items = runs.map((r, idx) => {
    const { length_m, diameter_mm, count = 1, wastePercent = 8 } = r;
    if (!length_m || !diameter_mm) throw new Error(`بيانات ناقصة لمسار الصرف رقم ${idx + 1}`);
    const total = length_m * count * (1 + wastePercent / 100);
    totalLength += total;
    const requiredDrop_m = length_m * (minSlopePercent / 100); // الهبوط المطلوب في المنسوب وفق الميل الأدنى
    return {
      run: idx + 1, diameter_mm, count,
      total_length_m: round2(total),
      required_slope_percent: minSlopePercent,
      required_drop_m: round2(requiredDrop_m),
    };
  });

  return { items, summary: { total_length_m: round2(totalLength) } };
}

/**
 * حساب مواسير التهوية (Vent Pipes) - عادة نفس مسارات الصرف الرأسية
 */
function calculateVentPipes({ verticalStacks }) {
  if (!Array.isArray(verticalStacks) || verticalStacks.length === 0) {
    throw new Error('يجب إدخال قائمة مواسير التهوية الرأسية (height_m, diameter_mm, count)');
  }
  let totalLength = 0;
  const items = verticalStacks.map((v, idx) => {
    const { height_m, diameter_mm, count = 1 } = v;
    if (!height_m || !diameter_mm) throw new Error(`بيانات ناقصة لماسورة التهوية رقم ${idx + 1}`);
    const total = height_m * count * 1.05; // 5% هدر للوصلات
    totalLength += total;
    return { stack: idx + 1, diameter_mm, count, total_length_m: round2(total) };
  });
  return { items, summary: { total_length_m: round2(totalLength) } };
}

/**
 * حساب مضخات المياه المطلوبة اعتماداً على معدل التدفق والارتفاع الكلي للرفع (TDH)
 */
function calculateWaterPumps({
  requiredFlowRate_lps, // لتر/ثانية
  staticHead_m,
  frictionLossPercent = 15, // نسبة فقد الاحتكاك من الارتفاع الساكن (تقريب هندسي شائع)
  pumpEfficiencyPercent = 70,
}) {
  if (!requiredFlowRate_lps || !staticHead_m) {
    throw new Error('يجب إدخال معدل التدفق المطلوب والارتفاع الساكن');
  }
  const totalDynamicHead_m = staticHead_m * (1 + frictionLossPercent / 100);
  const flowRate_m3h = requiredFlowRate_lps * 3.6;
  // القدرة الهيدروليكية (kW) = ρ×g×Q×H / (1000×η)  حيث Q بـ m3/s
  const flowRate_m3s = requiredFlowRate_lps / 1000;
  const hydraulicPower_kW = (1000 * 9.81 * flowRate_m3s * totalDynamicHead_m) / 1000;
  const shaftPower_kW = hydraulicPower_kW / (pumpEfficiencyPercent / 100);

  return {
    flow_rate_lps: requiredFlowRate_lps,
    flow_rate_m3h: round2(flowRate_m3h),
    total_dynamic_head_m: round2(totalDynamicHead_m),
    hydraulic_power_kW: round2(hydraulicPower_kW),
    required_pump_power_kW: round2(shaftPower_kW),
    required_pump_power_hp: round2(shaftPower_kW * 1.341),
  };
}

/**
 * حساب سعة خزانات المياه المطلوبة (علوي/أرضي) بناءً على عدد المستخدمين ومعدل الاستهلاك اليومي
 */
function calculateWaterTankCapacity({
  numberOfOccupants,
  dailyConsumptionPerPerson_l = 150, // معدل استهلاك نمطي للفرد (لتر/يوم) - قابل للتعديل
  storageDays = 1, // عدد أيام التخزين الاحتياطي
  safetyFactor = 1.1,
}) {
  if (!numberOfOccupants) throw new Error('يجب إدخال عدد المستخدمين المتوقع');
  const dailyDemand_l = numberOfOccupants * dailyConsumptionPerPerson_l;
  const requiredCapacity_l = dailyDemand_l * storageDays * safetyFactor;

  return {
    daily_demand_liters: round2(dailyDemand_l),
    storage_days: storageDays,
    required_tank_capacity_liters: round2(requiredCapacity_l),
    required_tank_capacity_m3: round2(requiredCapacity_l / 1000),
  };
}

module.exports = {
  calculateElectricalCables,
  calculateElectricalConduits,
  calculateElectricalPanels,
  calculateSwitchesOutlets,
  calculateEarthingSystem,
  calculateFireAlarmSystem,
  calculateWaterSupplyPipes,
  calculateDrainagePipes,
  calculateVentPipes,
  calculateWaterPumps,
  calculateWaterTankCapacity,
};
