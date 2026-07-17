/**
 * القسم الثالث - نظام حصر الكميات (BOQ)
 * وحدة التقارير (Reports Module)
 * ================================
 * تُنتج جميع التقارير المطلوبة في القسم الثالث:
 *  - تقرير الكميات
 *  - جدول الكميات (BOQ)
 *  - تقرير الأسعار
 *  - تقرير التكاليف
 *  - تقرير الهدر
 *  - تقرير مقارنة الكميات
 *  - تقرير الإنجاز
 *  - تقرير الفروقات بين المخططات (يُبنى فوق مقارنة الكميات + aiAnalyzer.compareBOQVersions)
 *  - تقرير ملخص المشروع
 * مع تصدير PDF احترافي / Excel / CSV / طباعة مباشرة (HTML قابل للطباعة من المتصفح)
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');
const { priceLineItem, getEffectivePrices } = require('./priceLibrary');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/**
 * بند حصر كميات موحّد (Normalized Line Item) — كل حاسبات BOQ/الخرسانة/الحديد تُختزل لهذا الشكل
 * موحّد لأن كل حاسبة (masonry, earthworks, rebar...) تُخرج بنية مختلفة تماماً.
 * @typedef {Object} BOQLineItem
 * @property {string} category - القسم (مثال: 'أعمال المباني')
 * @property {string} description - وصف البند
 * @property {number} quantity
 * @property {string} unit - وحدة القياس (م3، م2، طن، عدد...)
 * @property {number} [wastePercent]
 * @property {string} [priceKey] - مفتاح مكتبة الأسعار (اختياري، لو أردنا تسعير مركزي)
 * @property {number} [unitPrice] - سعر مباشر إن لم يوجد priceKey
 */

/**
 * بناء بند BOQ موحّد من مدخلات المستخدم (يُستخدم عند تجميع تقرير من عدة عمليات حصر سابقة)
 */
function makeLineItem({ category, description, quantity, unit, wastePercent = 0, priceKey = null, unitPrice = null }) {
  if (quantity === undefined || quantity === null || !unit) {
    throw new Error('يجب توفير الكمية ووحدة القياس لكل بند');
  }
  return {
    category: category || 'عام',
    description: description || '-',
    quantity: round2(quantity),
    unit,
    waste_percent: wastePercent || 0,
    quantity_with_waste: round2(quantity * (1 + (wastePercent || 0) / 100)),
    price_key: priceKey,
    unit_price_override: unitPrice,
  };
}

/** تسعير قائمة بنود موحّدة عبر مكتبة الأسعار المركزية أو سعر مباشر */
function priceLineItems(items, { projectId = null, region = null } = {}) {
  return items.map((item) => {
    const qty = item.quantity_with_waste ?? item.quantity;
    let priced;
    if (item.price_key) {
      priced = priceLineItem({ priceKey: item.price_key, quantity: qty, projectId, region, overridePrice: item.unit_price_override });
    } else {
      const unitPrice = item.unit_price_override || 0;
      priced = {
        price_key: null,
        quantity: round2(qty),
        unit_price: round2(unitPrice),
        total_cost: round2(unitPrice * qty),
        source: unitPrice ? 'override' : 'not_priced',
      };
    }
    // priced.quantity يمثل الكمية المسعّرة (بعد الهدر) — لا نسمح لها بالكتابة فوق quantity الأساسية للبند
    const { quantity: _pricedQty, ...pricedRest } = priced;
    return { ...item, ...pricedRest };
  });
}

// ===================== 1) تقرير الكميات =====================
function buildQuantityReport(items) {
  const grouped = {};
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  }
  const totalsByUnit = {};
  for (const it of items) {
    const key = `${it.category} (${it.unit})`;
    totalsByUnit[key] = round2((totalsByUnit[key] || 0) + it.quantity_with_waste);
  }
  return {
    report_type: 'quantity_report',
    items_count: items.length,
    grouped,
    totals_by_category_unit: totalsByUnit,
  };
}

// ===================== 2) جدول الكميات (BOQ) =====================
function buildBOQTable(pricedItems) {
  const rows = pricedItems.map((it, idx) => ({
    seq: idx + 1,
    category: it.category,
    description: it.description,
    quantity: it.quantity,
    waste_percent: it.waste_percent,
    quantity_with_waste: it.quantity_with_waste,
    unit: it.unit,
    unit_price: it.unit_price,
    total_cost: it.total_cost,
  }));
  const grandTotal = round2(pricedItems.reduce((s, it) => s + (it.total_cost || 0), 0));
  return { report_type: 'boq_table', rows, grand_total: grandTotal, currency: getEffectivePrices({}).currency };
}

// ===================== 3) تقرير الأسعار =====================
function buildPriceReport(pricedItems, { projectId = null, region = null } = {}) {
  const notPriced = pricedItems.filter(it => it.source === 'not_priced');
  return {
    report_type: 'price_report',
    effective_price_scope: { projectId, region },
    priced_items: pricedItems.map(it => ({
      description: it.description, price_key: it.price_key, unit: it.unit,
      unit_price: it.unit_price, source: it.source,
    })),
    unpriced_items_count: notPriced.length,
    unpriced_items: notPriced.map(it => it.description),
  };
}

// ===================== 4) تقرير التكاليف =====================
function buildCostReport(pricedItems, { taxPercent = 0, discountPercent = 0, laborCost = 0, equipmentCost = 0, transportCost = 0 } = {}) {
  const materialsCost = round2(pricedItems.reduce((s, it) => s + (it.total_cost || 0), 0));
  const subtotal = round2(materialsCost + laborCost + equipmentCost + transportCost);
  const discountAmount = round2(subtotal * (discountPercent / 100));
  const afterDiscount = round2(subtotal - discountAmount);
  const taxAmount = round2(afterDiscount * (taxPercent / 100));
  const grandTotal = round2(afterDiscount + taxAmount);

  const byCategory = {};
  for (const it of pricedItems) {
    byCategory[it.category] = round2((byCategory[it.category] || 0) + (it.total_cost || 0));
  }

  return {
    report_type: 'cost_report',
    materials_cost: materialsCost,
    labor_cost: round2(laborCost),
    equipment_cost: round2(equipmentCost),
    transport_cost: round2(transportCost),
    subtotal,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    after_discount: afterDiscount,
    tax_percent: taxPercent,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    cost_by_category: byCategory,
  };
}

// ===================== 5) تقرير الهدر =====================
function buildWasteReport(items) {
  const rows = items.map(it => ({
    description: it.description,
    category: it.category,
    base_quantity: it.quantity,
    waste_percent: it.waste_percent,
    waste_quantity: round2(it.quantity_with_waste - it.quantity),
    quantity_with_waste: it.quantity_with_waste,
    unit: it.unit,
  }));
  const totalWasteByUnit = {};
  for (const r of rows) {
    const key = `${r.category} (${r.unit})`;
    totalWasteByUnit[key] = round2((totalWasteByUnit[key] || 0) + r.waste_quantity);
  }
  const avgWastePercent = items.length
    ? round2(items.reduce((s, it) => s + (it.waste_percent || 0), 0) / items.length)
    : 0;
  return { report_type: 'waste_report', rows, total_waste_by_category_unit: totalWasteByUnit, average_waste_percent: avgWastePercent };
}

// ===================== 6) تقرير مقارنة الكميات =====================
/**
 * يقارن مجموعتي بنود (نسخة سابقة / نسخة حالية) بالوصف كمفتاح مطابقة
 */
function buildComparisonReport(previousItems, currentItems) {
  const prevMap = new Map(previousItems.map(it => [it.description, it]));
  const currMap = new Map(currentItems.map(it => [it.description, it]));
  const allKeys = new Set([...prevMap.keys(), ...currMap.keys()]);

  const changes = [];
  for (const key of allKeys) {
    const prev = prevMap.get(key);
    const curr = currMap.get(key);
    if (prev && curr) {
      const diff = round2(curr.quantity_with_waste - prev.quantity_with_waste);
      if (Math.abs(diff) > 0.001) {
        changes.push({
          description: key, status: 'modified', unit: curr.unit,
          previous_quantity: prev.quantity_with_waste, current_quantity: curr.quantity_with_waste,
          difference: diff,
          percent_change: prev.quantity_with_waste ? round2((diff / prev.quantity_with_waste) * 100) : null,
        });
      }
    } else if (curr && !prev) {
      changes.push({ description: key, status: 'added', unit: curr.unit, previous_quantity: 0, current_quantity: curr.quantity_with_waste, difference: curr.quantity_with_waste });
    } else if (prev && !curr) {
      changes.push({ description: key, status: 'removed', unit: prev.unit, previous_quantity: prev.quantity_with_waste, current_quantity: 0, difference: -prev.quantity_with_waste });
    }
  }
  return {
    report_type: 'comparison_report',
    total_changes: changes.length,
    added_count: changes.filter(c => c.status === 'added').length,
    removed_count: changes.filter(c => c.status === 'removed').length,
    modified_count: changes.filter(c => c.status === 'modified').length,
    changes,
  };
}

// ===================== 7) تقرير الإنجاز =====================
/**
 * @param {Array} plannedItems - البنود المخططة (الكمية الكلية بالعقد/BOQ)
 * @param {Array} executedItems - البنود المنفذة فعلياً حتى تاريخه (بنفس description كمفتاح)
 */
function buildCompletionReport(plannedItems, executedItems) {
  const execMap = new Map(executedItems.map(it => [it.description, it]));
  const rows = plannedItems.map(planned => {
    const executed = execMap.get(planned.description);
    const executedQty = executed ? executed.quantity_with_waste : 0;
    const plannedQty = planned.quantity_with_waste;
    const completionPercent = plannedQty ? round2(Math.min(100, (executedQty / plannedQty) * 100)) : 0;
    return {
      description: planned.description, category: planned.category, unit: planned.unit,
      planned_quantity: plannedQty, executed_quantity: executedQty,
      remaining_quantity: round2(Math.max(0, plannedQty - executedQty)),
      completion_percent: completionPercent,
    };
  });
  const overallCompletion = rows.length
    ? round2(rows.reduce((s, r) => s + r.completion_percent, 0) / rows.length)
    : 0;
  return { report_type: 'completion_report', rows, overall_completion_percent: overallCompletion };
}

// ===================== 8) تقرير ملخص المشروع =====================
function buildProjectSummaryReport({ projectName, quantityReport, boqTable, costReport, wasteReport, completionReport }) {
  return {
    report_type: 'project_summary',
    project_name: projectName || '-',
    generated_at: new Date().toISOString(),
    total_line_items: boqTable ? boqTable.rows.length : 0,
    grand_total_cost: boqTable ? boqTable.grand_total : (costReport ? costReport.grand_total : 0),
    average_waste_percent: wasteReport ? wasteReport.average_waste_percent : null,
    overall_completion_percent: completionReport ? completionReport.overall_completion_percent : null,
    categories_summary: quantityReport ? quantityReport.totals_by_category_unit : {},
  };
}

// ===================== التصدير =====================

function exportBOQToPDF(boqTable, meta = {}) {
  const filename = `boq-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['#', 'Category', 'Description', 'Qty', 'Waste%', 'Qty+Waste', 'Unit', 'Unit Price', 'Total Cost'];
  const rows = boqTable.rows.map(r => [r.seq, r.category, r.description, r.quantity, r.waste_percent, r.quantity_with_waste, r.unit, r.unit_price, r.total_cost]);
  const result = generateBoqTablePDF({
    title: 'Bill of Quantities (BOQ)',
    meta,
    headers,
    rows,
    totals: { label: 'Grand Total', value: `${boqTable.grand_total} ${boqTable.currency || ''}` },
    outputPath,
    colWidths: [25, 110, 260, 55, 50, 65, 45, 70, 80],
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportBOQToExcel(boqTable) {
  const filename = `boq-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['#', 'Category', 'Description', 'Quantity', 'Waste %', 'Qty+Waste', 'Unit', 'Unit Price', 'Total Cost'];
  const rows = [headers, ...boqTable.rows.map(r => [r.seq, r.category, r.description, r.quantity, r.waste_percent, r.quantity_with_waste, r.unit, r.unit_price, r.total_cost]), [], ['', '', '', '', '', '', '', 'Grand Total', boqTable.grand_total]];
  const buffer = generateXlsx([{ name: 'BOQ', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportBOQToCSV(boqTable) {
  const filename = `boq-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['#', 'Category', 'Description', 'Quantity', 'Waste %', 'Qty+Waste', 'Unit', 'Unit Price', 'Total Cost'];
  const rows = boqTable.rows.map(r => [r.seq, r.category, r.description, r.quantity, r.waste_percent, r.quantity_with_waste, r.unit, r.unit_price, r.total_cost]);
  const buffer = generateCsv(headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/** نسخة HTML جاهزة للطباعة المباشرة من المتصفح (window.print) */
function exportBOQToPrintableHTML(boqTable, meta = {}) {
  const filename = `boq-report-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const rowsHtml = boqTable.rows.map(r => `
    <tr>
      <td>${r.seq}</td><td>${r.category}</td><td>${r.description}</td>
      <td>${r.quantity}</td><td>${r.waste_percent}%</td><td>${r.quantity_with_waste}</td>
      <td>${r.unit}</td><td>${r.unit_price}</td><td>${r.total_cost}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>جدول حصر الكميات (BOQ)</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#1a2634}
h1{border-bottom:3px solid #0d2438;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
th{background:#0d2438;color:#fff}
tr:nth-child(even){background:#f5f7fa}
.meta{margin:10px 0;color:#555}
.total{font-weight:bold;font-size:16px;margin-top:16px;text-align:left}
@media print{button{display:none}}
</style></head><body>
<h1>جدول حصر الكميات (Bill of Quantities)</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | المهندس: ${meta.engineerName || '-'} | التاريخ: ${new Date().toLocaleDateString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr><th>#</th><th>القسم</th><th>الوصف</th><th>الكمية</th><th>الهدر%</th><th>الكمية+الهدر</th><th>الوحدة</th><th>سعر الوحدة</th><th>التكلفة</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class="total">الإجمالي الكلي: ${boqTable.grand_total} ${boqTable.currency || ''}</div>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  makeLineItem,
  priceLineItems,
  buildQuantityReport,
  buildBOQTable,
  buildPriceReport,
  buildCostReport,
  buildWasteReport,
  buildComparisonReport,
  buildCompletionReport,
  buildProjectSummaryReport,
  exportBOQToPDF,
  exportBOQToExcel,
  exportBOQToCSV,
  exportBOQToPrintableHTML,
};
