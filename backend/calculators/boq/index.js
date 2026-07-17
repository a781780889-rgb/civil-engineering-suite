/**
 * القسم الثالث - نظام حصر الكميات (Quantity Takeoff System - BOQ)
 * الجزء الأول من ثلاثة: الحسابات الهندسية لجميع عناصر الحصر
 * ==========================================================
 * يجمع هذا الملف جميع حاسبات BOQ في نقطة وصول واحدة.
 *
 * الأجزاء القادمة (لاحقاً):
 * - الجزء الثاني: طرق الاستيراد (Excel/CSV/PDF/DWG/DXF/IFC) والذكاء الاصطناعي لتحليل المخططات
 * - الجزء الثالث: الواجهة، التقارير، والتكامل الكامل مع باقي أقسام النظام
 */

const earthworks = require('./earthworks');
const masonry = require('./masonry');
const plasterWaterproofing = require('./plasterWaterproofing');
const flooringCeilingPaint = require('./flooringCeilingPaint');
const carpentryAluminum = require('./carpentryAluminum');
const electricalPlumbing = require('./electricalPlumbing');
const roadworks = require('./roadworks');

module.exports = {
  earthworks,
  masonry,
  plasterWaterproofing,
  flooringCeilingPaint,
  carpentryAluminum,
  electricalPlumbing,
  roadworks,
};
