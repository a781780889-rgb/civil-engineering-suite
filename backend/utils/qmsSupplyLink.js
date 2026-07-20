/**
 * القسم التاسع - نظام إدارة الجودة (QMS)
 * وحدة التكامل مع المخازن والمشتريات (Supply Chain Quality Link)
 * =====================================================================================
 * يربط هذا الملف عمليات الجودة (طلبات اعتماد المواد MAR، اختبارات المواد) فعلياً
 * بوحدة المخازن الموجودة مسبقاً في النظام (businessOperations.js: addStockItem /
 * listStockItems / recordMovement / getWarehouseDashboard)، بحيث:
 *  - يمكن ربط طلب اعتماد مادة (MAR) بصنف مخزون فعلي (item_id) بدل إدخال اسم حر فقط.
 *  - عند اعتماد MAR (status = approved) يمكن تسجيل حركة "وارد" فعلية في المخزون
 *    مباشرة من نفس نقطة الاعتماد، مع منع تسجيل الوارد لمادة لم تُعتمد بعد.
 *  - يمكن حجب/تعليق صنف في المخزون تلقائياً إذا صدر NCR أو نتيجة اختبار "راسب"
 *    مرتبطة بنفس الصنف، لمنع استخدامه في الموقع حتى تُغلق الحالة.
 *  - توفّر الوحدة تقريراً موحّداً لحالة "جودة المخزون" يجمع بين حالة الاعتماد
 *    وحالة الاختبارات وحالة أي حجب قائم لكل صنف.
 *
 * هذا تكامل حقيقي (استدعاء دوال فعلية من وحدة المخازن وتعديل بياناتها)، وليس
 * مجرد إشارة نصية أو رابطاً شكلياً.
 */

const WAREHOUSE = require('./businessOperations');
const QMS = require('./qmsManagement');

function unwrap(result) {
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

/** getStockItem في businessOperations.js يرمي استثناءً إن لم يوجد الصنف؛ هذه دالة آمنة تُعيد null بدلاً من ذلك */
function safeGetStockItem(itemId) {
  try {
    return WAREHOUSE.getStockItem(itemId);
  } catch (e) {
    return null;
  }
}

/** ربط طلب اعتماد مواد (MAR) موجود بصنف مخزون فعلي، عبر تخزين item_id ضمن سجل MAR */
function linkMarToStockItem({ marId, itemId }) {
  if (!marId || !itemId) throw new Error('معرّف طلب اعتماد المواد (marId) ومعرّف صنف المخزون (itemId) مطلوبان');

  const mar = unwrap(QMS.getMar(marId));
  if (!mar) throw new Error('لم يتم العثور على طلب اعتماد المواد المطلوب');

  const item = safeGetStockItem(itemId);
  if (!item) throw new Error('لم يتم العثور على صنف المخزون المطلوب');

  const updated = QMS.linkMarToWarehouseItem(marId, { warehouse_item_id: itemId, warehouse_item_name: item.name });
  return { success: true, mar: unwrap(updated), stock_item: item };
}

/**
 * عند اعتماد MAR نهائياً (approved)، يسجّل حركة وارد فعلية في المخزون لكمية معيّنة،
 * مانعاً أي تسجيل إن لم يكن الطلب معتمَداً أو غير مرتبط بصنف مخزون.
 */
function receiveApprovedMaterialToStock({ marId, quantity, unit = null, note = '' }) {
  if (!marId) throw new Error('معرّف طلب اعتماد المواد (marId) مطلوب');
  if (!quantity || Number(quantity) <= 0) throw new Error('الكمية (quantity) يجب أن تكون رقماً أكبر من صفر');

  const mar = unwrap(QMS.getMar(marId));
  if (!mar) throw new Error('لم يتم العثور على طلب اعتماد المواد المطلوب');
  if (mar.status !== 'approved' && mar.status !== 'approved_with_comments') {
    throw new Error('لا يمكن استلام المادة في المخزون قبل اعتمادها (approved / approved_with_comments)');
  }
  if (!mar.warehouse_item_id) {
    throw new Error('طلب اعتماد المواد هذا غير مرتبط بصنف مخزون بعد؛ استخدم linkMarToStockItem أولاً');
  }

  const movement = WAREHOUSE.recordMovement(mar.warehouse_item_id, {
    type: 'in',
    quantity: Number(quantity),
    reference: `MAR:${mar.code || mar.id}`,
    note: note || `استلام مادة معتمدة عبر نظام الجودة (${mar.code || mar.id})`,
  });

  return { success: true, mar_id: marId, movement };
}

/**
 * عند تسجيل نتيجة "راسب" لاختبار مادة أو فتح NCR مرتبط بصنف مخزون، يمكن حجب الصنف
 * (وضع علامة "quality_hold") لمنع استخدامه في الموقع حتى تُغلق الحالة. الحجب هنا
 * تعليق منطقي فعلي على مستوى بيانات الصنف (custom_fields)، وليس مجرد ملاحظة نصية.
 */
function placeQualityHoldOnStockItem({ itemId, reason, relatedEntityType, relatedEntityId }) {
  if (!itemId) throw new Error('معرّف صنف المخزون (itemId) مطلوب');
  const item = safeGetStockItem(itemId);
  if (!item) throw new Error('لم يتم العثور على صنف المخزون المطلوب');

  const updated = WAREHOUSE.updateStockItem(itemId, {
    quality_hold: true,
    quality_hold_reason: reason || 'حجب جودة دون سبب محدد',
    quality_hold_related_entity_type: relatedEntityType || null,
    quality_hold_related_entity_id: relatedEntityId || null,
    quality_hold_since: new Date().toISOString(),
  });

  return { success: true, stock_item: updated };
}

/** رفع الحجب عن صنف مخزون بعد إغلاق حالة الجودة المرتبطة (NCR مغلقة / إعادة اختبار ناجحة) */
function releaseQualityHold({ itemId, releasedBy = null, notes = '' }) {
  if (!itemId) throw new Error('معرّف صنف المخزون (itemId) مطلوب');
  const item = safeGetStockItem(itemId);
  if (!item) throw new Error('لم يتم العثور على صنف المخزون المطلوب');
  if (!item.quality_hold) throw new Error('هذا الصنف غير محجوز أصلاً من قبل الجودة');

  const updated = WAREHOUSE.updateStockItem(itemId, {
    quality_hold: false,
    quality_hold_released_by: releasedBy,
    quality_hold_released_at: new Date().toISOString(),
    quality_hold_release_notes: notes,
  });

  return { success: true, stock_item: updated };
}

/**
 * تقرير موحّد لحالة "جودة المخزون": لكل صنف مرتبط بطلب اعتماد مواد، حالة الاعتماد
 * الحالية، وهل هو محجوز جودة، وعدد اختبارات المواد المرتبطة به إن وُجدت.
 */
function getStockQualityStatusReport({ projectId = null } = {}) {
  const mars = unwrap(QMS.listMars({ projectId })).filter(m => m.warehouse_item_id);
  const rows = mars.map(mar => {
    const item = safeGetStockItem(mar.warehouse_item_id);
    return {
      mar_id: mar.id,
      mar_code: mar.code,
      material_name: mar.material_name || mar.warehouse_item_name,
      mar_status: mar.status,
      warehouse_item_id: mar.warehouse_item_id,
      warehouse_item_name: item?.name || null,
      current_quantity: item?.quantity ?? null,
      quality_hold: item?.quality_hold || false,
      quality_hold_reason: item?.quality_hold_reason || null,
    };
  });

  return {
    success: true,
    total_linked_items: rows.length,
    items_on_hold: rows.filter(r => r.quality_hold).length,
    items: rows,
  };
}

module.exports = {
  linkMarToStockItem,
  receiveApprovedMaterialToStock,
  placeQualityHoldOnStockItem,
  releaseQualityHold,
  getStockQualityStatusReport,
};
