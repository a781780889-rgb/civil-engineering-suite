const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * حساب التكلفة الكاملة لحديد التسليح بناءً على الوزن الفعلي المحسوب
 * يشمل: سعر المادة، النقل، القص، الثني/التشكيل، التركيب، الضرائب، الخصومات
 * كل بند محسوب من الوزن الفعلي بالطن وليس تقريبياً
 */
function calculateSteelCost({
  totalWeight_kg,
  pricePerTon = 0,
  pricePerBarOverride = null,   // إن وُجد: سعر مباشر للسيخ التجاري بدل الوزن
  barsCount = null,             // عدد الأسياخ التجارية (يُستخدم فقط مع pricePerBarOverride)
  transportPerTon = 0,
  cuttingPerTon = 0,
  bendingPerTon = 0,
  installationPerTon = 0,
  taxPercent = 0,
  discountPercent = 0,
}) {
  if (!totalWeight_kg || totalWeight_kg <= 0) {
    throw new Error('يجب توفير الوزن الإجمالي للحديد لحساب التكلفة');
  }

  const totalWeight_ton = totalWeight_kg / 1000;

  let materialCost;
  if (pricePerBarOverride && barsCount) {
    materialCost = pricePerBarOverride * barsCount;
  } else {
    materialCost = totalWeight_ton * pricePerTon;
  }

  const transportCost = totalWeight_ton * transportPerTon;
  const cuttingCost = totalWeight_ton * cuttingPerTon;
  const bendingCost = totalWeight_ton * bendingPerTon;
  const installationCost = totalWeight_ton * installationPerTon;

  const subtotal = materialCost + transportCost + cuttingCost + bendingCost + installationCost;

  const discountAmount = subtotal * (discountPercent / 100);
  const afterDiscount = subtotal - discountAmount;

  const taxAmount = afterDiscount * (taxPercent / 100);
  const grandTotal = afterDiscount + taxAmount;

  return {
    total_weight_kg: round2(totalWeight_kg),
    total_weight_ton: round2(totalWeight_ton),
    cost_breakdown: {
      material_cost: round2(materialCost),
      transport_cost: round2(transportCost),
      cutting_cost: round2(cuttingCost),
      bending_cost: round2(bendingCost),
      installation_cost: round2(installationCost),
      subtotal: round2(subtotal),
      discount_percent: discountPercent,
      discount_amount: round2(discountAmount),
      after_discount: round2(afterDiscount),
      tax_percent: taxPercent,
      tax_amount: round2(taxAmount),
      grand_total: round2(grandTotal),
    },
  };
}

/**
 * حساب تكلفة مجمّعة لعدة عناصر إنشائية (مشروع كامل) - تجميع الأوزان أولاً ثم تسعير موحد
 */
function calculateProjectSteelCost(elements, pricing) {
  const totalWeight_kg = elements.reduce((sum, el) => sum + (el.total_weight_kg || 0), 0);
  const costResult = calculateSteelCost({ totalWeight_kg, ...pricing });
  return {
    elements_count: elements.length,
    elements_summary: elements.map(el => ({ description: el.description || el.type, weight_kg: el.total_weight_kg })),
    ...costResult,
  };
}

module.exports = { calculateSteelCost, calculateProjectSteelCost };
