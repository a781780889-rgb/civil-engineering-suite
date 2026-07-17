/**
 * القسم الثالث - نظام حصر الكميات (Quantity Takeoff System - BOQ)
 * الجزء الثاني من ثلاثة: طرق الاستيراد (Excel/CSV/PDF/DXF/IFC) والذكاء الاصطناعي
 * ==========================================================
 * يجمع هذا الملف جميع وحدات الاستيراد والتحليل الذكي في نقطة وصول واحدة.
 *
 * ملاحظات التنفيذ (بيئة بدون اتصال إنترنت للتنفيذ التجريبي):
 * - CSV: parser حقيقي كامل (state machine على مستوى الأحرف) - يعمل 100% بدون إنترنت.
 * - Excel (.xlsx): parser حقيقي لبنية ZIP + XML يدوياً باستخدام zlib المدمجة في Node - بدون مكتبات خارجية.
 * - PDF: مستخرج نصوص حقيقي يفك ضغط FlateDecode ويحلل عمليات النص (Tj/TJ) في المحتوى - بدون مكتبات خارجية.
 * - DXF: محلل حقيقي لأزواج Group Code في صيغة DXF النصية (ASCII) يستخرج كيانات هندسية فعلية بأبعادها.
 * - الذكاء الاصطناعي: واجهة موحدة تستدعي Claude API مباشرة (https المدمجة) - تتطلب متغير بيئة
 *   ANTHROPIC_API_KEY على الخادم لتُفعَّل؛ باقي الوظائف تعمل دونها بالكامل.
 * - IFC (BIM): سيُضاف في تحديث لاحق (صيغة IFC STEP معقدة وتحتاج محلل مخصص أكبر).
 * - الحصر المباشر من المخططات (رسم تفاعلي): جزء من واجهة الرسومات في الجزء الثالث (الواجهة والتكامل).
 */

const csvImporter = require('./csvImporter');
const xlsxImporter = require('./xlsxImporter');
const pdfImporter = require('./pdfImporter');
const dxfImporter = require('./dxfImporter');
const aiAnalyzer = require('./aiAnalyzer');

module.exports = {
  csv: csvImporter,
  xlsx: xlsxImporter,
  pdf: pdfImporter,
  dxf: dxfImporter,
  ai: aiAnalyzer,
};
