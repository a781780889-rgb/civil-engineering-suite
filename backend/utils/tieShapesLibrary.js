const { calculateHookLength } = require('./constants');

/**
 * مكتبة أشكال الكانات (Stirrups/Ties Shapes Library)
 * كل دالة تحسب الطول الحقيقي الكلي للكانة شاملاً:
 *   - أضلاع الشكل الهندسي الصافية (بعد طرح الغطاء الخرساني وقطر السيخ من المحيط الخارجي لتصل لمحور القضيب)
 *   - انحناءات الزوايا (Bend Deductions تُهمل عملياً لأن القياس على محور القضيب Centerline يعوّض ذلك تلقائياً)
 *   - طول الخطاف في الطرفين (Hook Length) حسب زاوية الخطاف المختارة
 *
 * جميع الأبعاد المُدخلة هي الأبعاد الصافية للمقطع الخرساني بعد طرح الغطاء (net dimensions on bar centerline)
 */

const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** كانة مستطيلة (Rectangular Tie) - الأكثر استخداماً في الأعمدة والكمرات */
function rectangularTie({ netWidth_m, netHeight_m, tieDiameter_mm, hookAngle = 135 }) {
  if (!netWidth_m || !netHeight_m) throw new Error('يجب إدخال العرض والارتفاع الصافيين للكانة المستطيلة');
  const perimeter_m = 2 * (netWidth_m + netHeight_m);
  const hook = calculateHookLength(tieDiameter_mm, hookAngle, true);
  const totalLength_m = perimeter_m + 2 * hook.total_hook_length_m; // خطافان (طرفا الكانة)
  return {
    shape: 'مستطيلة (Rectangular)',
    net_width_m: netWidth_m,
    net_height_m: netHeight_m,
    perimeter_m: round2(perimeter_m),
    hook_angle_deg: hookAngle,
    hook_length_each_m: hook.total_hook_length_m,
    hooks_count: 2,
    total_length_m: round2(totalLength_m),
  };
}

/** كانة مربعة (Square Tie) - حالة خاصة من المستطيلة */
function squareTie({ netSide_m, tieDiameter_mm, hookAngle = 135 }) {
  if (!netSide_m) throw new Error('يجب إدخال الضلع الصافي للكانة المربعة');
  return { ...rectangularTie({ netWidth_m: netSide_m, netHeight_m: netSide_m, tieDiameter_mm, hookAngle }), shape: 'مربعة (Square)' };
}

/** كانة دائرية (Circular Tie/Spiral Ring) - للأعمدة الدائرية */
function circularTie({ netDiameter_m, tieDiameter_mm, hookAngle = 135 }) {
  if (!netDiameter_m) throw new Error('يجب إدخال القطر الصافي للكانة الدائرية');
  const circumference_m = Math.PI * netDiameter_m;
  const hook = calculateHookLength(tieDiameter_mm, hookAngle, true);
  const totalLength_m = circumference_m + 2 * hook.total_hook_length_m;
  return {
    shape: 'دائرية (Circular)',
    net_diameter_m: netDiameter_m,
    circumference_m: round2(circumference_m),
    hook_angle_deg: hookAngle,
    hook_length_each_m: hook.total_hook_length_m,
    hooks_count: 2,
    total_length_m: round2(totalLength_m),
  };
}

/**
 * كانة متعددة الأضلاع (Polygonal Tie) - لمقاطع أعمدة غير منتظمة (مثلث، مسدس، إلخ)
 * @param {Array<number>} sides_m - أطوال الأضلاع الصافية بالمتر بالترتيب حول المحيط
 */
function polygonalTie({ sides_m, tieDiameter_mm, hookAngle = 135 }) {
  if (!sides_m || sides_m.length < 3) throw new Error('يجب إدخال 3 أضلاع على الأقل لكانة متعددة الأضلاع');
  const perimeter_m = sides_m.reduce((s, x) => s + x, 0);
  const hook = calculateHookLength(tieDiameter_mm, hookAngle, true);
  const totalLength_m = perimeter_m + 2 * hook.total_hook_length_m;
  return {
    shape: `متعددة الأضلاع (${sides_m.length} أضلاع)`,
    sides_m,
    perimeter_m: round2(perimeter_m),
    hook_angle_deg: hookAngle,
    hook_length_each_m: hook.total_hook_length_m,
    hooks_count: 2,
    total_length_m: round2(totalLength_m),
  };
}

/**
 * كانة مزدوجة (Double/Overlapping Tie) - تُستخدم في الأعمدة كبيرة المقطع لضبط تباعد الأسياخ الوسطية
 * تتكون من كانتين: كانة خارجية محيطة، وكانة/رابطة داخلية (Cross-tie) تربط أسياخ وسطية
 */
function doubleTie({ netWidth_m, netHeight_m, tieDiameter_mm, hookAngle = 135, crossTiesCount = 1 }) {
  if (!netWidth_m || !netHeight_m) throw new Error('يجب إدخال أبعاد المقطع الصافية للكانة المزدوجة');
  const outer = rectangularTie({ netWidth_m, netHeight_m, tieDiameter_mm, hookAngle });
  // الرابطة الداخلية (Cross-tie): تمتد عبر أصغر بعد للعمود مع خطاف 90° من طرف وخطاف 135° من الطرف الآخر (وفق ACI 318 25.7.2.2)
  const hook90 = calculateHookLength(tieDiameter_mm, 90, true);
  const hook135 = calculateHookLength(tieDiameter_mm, 135, true);
  const crossTieSpan_m = Math.min(netWidth_m, netHeight_m);
  const crossTieLength_m = crossTieSpan_m + hook90.total_hook_length_m + hook135.total_hook_length_m;
  const totalCrossTiesLength_m = crossTieLength_m * crossTiesCount;
  return {
    shape: 'مزدوجة (Double Tie with Cross-ties)',
    outer_tie: outer,
    cross_tie_length_each_m: round2(crossTieLength_m),
    cross_ties_count: crossTiesCount,
    cross_ties_total_length_m: round2(totalCrossTiesLength_m),
    total_length_per_set_m: round2(outer.total_length_m + totalCrossTiesLength_m),
  };
}

/**
 * كانة خاصة (Custom Tie) - شكل حر يحدده المستخدم بمجموعة نقاط/أضلاع وأطوال خطافات مخصصة لكل طرف
 */
function customTie({ segments_m, tieDiameter_mm, hooks = [] }) {
  if (!segments_m || segments_m.length === 0) throw new Error('يجب إدخال أطوال أضلاع الشكل الخاص');
  const straightLength_m = segments_m.reduce((s, x) => s + x, 0);
  let hooksTotal_m = 0;
  const hookDetails = hooks.map(h => {
    const hook = calculateHookLength(tieDiameter_mm, h.angle || 135, true);
    hooksTotal_m += hook.total_hook_length_m;
    return hook;
  });
  const totalLength_m = straightLength_m + hooksTotal_m;
  return {
    shape: 'خاصة (Custom)',
    segments_m,
    straight_length_m: round2(straightLength_m),
    hooks: hookDetails,
    total_length_m: round2(totalLength_m),
  };
}

/**
 * دالة موحدة لاختيار وحساب أي شكل كانة من المكتبة
 */
function calculateTieShape(shapeType, params) {
  switch (shapeType) {
    case 'rectangular': return rectangularTie(params);
    case 'square': return squareTie(params);
    case 'circular': return circularTie(params);
    case 'polygonal': return polygonalTie(params);
    case 'double': return doubleTie(params);
    case 'custom': return customTie(params);
    default: throw new Error(`شكل كانة غير معروف: ${shapeType}`);
  }
}

module.exports = {
  rectangularTie,
  squareTie,
  circularTie,
  polygonalTie,
  doubleTie,
  customTie,
  calculateTieShape,
};
