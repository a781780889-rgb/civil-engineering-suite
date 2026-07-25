/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * الجزء 9/10: التقارير المالية + الرسوم البيانية + التصدير (PDF/Excel/CSV/Word)
 * ================================================================================
 * يبني 10 تقارير مالية احترافية مباشرة من بيانات الميزانية الحقيقية المخزَّنة
 * (budgets.json عبر budgetManagement.js) - لا أرقام وهمية، كل رقم في كل تقرير
 * محسوب فعلياً من BBS / التكاليف الفعلية / الإيرادات / أوامر التغيير / الفواتير /
 * EVM / التدفقات النقدية المُنفَّذة في الأجزاء 1-8.
 *
 * التقارير العشرة (حسب الطلب الأصلي):
 *  1) تقرير الميزانية العامة        buildGeneralBudgetReport
 *  2) تقرير المصروفات               buildExpensesReport
 *  3) تقرير الإيرادات               buildRevenuesReport
 *  4) تقرير الأرباح والخسائر        buildProfitLossReport
 *  5) تقرير الانحرافات              buildDeviationReport      (يُعيد استخدام BUDGET.getDeviationAnalysis)
 *  6) تقرير التدفقات النقدية        buildCashFlowReport       (يُعيد استخدام BUDGET.getComprehensiveCashFlow)
 *  7) تقرير تكلفة كل بند            buildCostByItemReport
 *  8) تقرير تكلفة كل مرحلة          buildCostByPhaseReport
 *  9) تقرير أداء المشروع المالي     buildFinancialPerformanceReport
 * 10) تقرير القيمة المكتسبة         buildEVMReport            (يُعيد استخدام BUDGET.getBudgetEVM)
 *
 * كل تقرير قابل للتصدير PDF / Excel / CSV / Word عبر exportReport(reportType, data, format)
 * بنفس نمط boqReports.js (لا تبعيات خارجية: tablePdfGenerator + xlsxWriter + csvWriter + docxWriter)
 */

const path = require('path');
const fs = require('fs');

const BUDGET = require('./budgetManagement');
const { TablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');
const { generateDocx } = require('./docxWriter');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const { _internal } = BUDGET;
const { loadDB, findNode, computeNodeTotal, computeBBSGrandTotal, computeActualCostSummary, computeRevenueSummary, r2 } = _internal;

function findBudgetOrThrow(db, budgetId) {
  const budget = db.budgets.find(b => b.id === budgetId || b.budget_number === budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');
  return budget;
}

function iterBBSNodes(nodes, cb, ancestors = []) {
  for (const node of nodes || []) {
    cb(node, ancestors);
    if (node.children && node.children.length) iterBBSNodes(node.children, cb, [...ancestors, node]);
  }
}

// ===================== 1) تقرير الميزانية العامة =====================
function buildGeneralBudgetReport(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const plannedTotal = computeBBSGrandTotal(budget);
  const actualSummary = computeActualCostSummary(budget);
  const revenueSummary = computeRevenueSummary(budget);
  const changeOrdersApproved = (budget.change_orders || []).filter(co => co.status === 'management_approved' || co.status === 'approved');
  const changeOrdersValue = r2(changeOrdersApproved.reduce((s, co) => s + (co.additional_cost || 0), 0));

  const consumptionPct = plannedTotal > 0 ? r2((actualSummary.total_actual_cost / plannedTotal) * 100) : 0;
  const remaining = r2(plannedTotal - actualSummary.total_actual_cost);
  const expectedProfit = r2(budget.contract_value - plannedTotal);
  const actualProfit = r2(revenueSummary.total_received - actualSummary.total_actual_cost);

  return {
    report_type: 'general_budget_report',
    budget_id: budget.id,
    budget_number: budget.budget_number,
    project_name: budget.project_name,
    client: budget.client,
    contractor: budget.contractor,
    currency: budget.currency,
    status: budget.status,
    version: budget.version,
    contract_value: budget.contract_value,
    planned_budget_total: plannedTotal,
    approved_change_orders_value: changeOrdersValue,
    actual_cost_total: actualSummary.total_actual_cost,
    budget_consumption_percent: consumptionPct,
    remaining_budget: remaining,
    expected_profit: expectedProfit,
    actual_profit: actualProfit,
    total_revenue_received: revenueSummary.total_received,
    total_revenue_expected: revenueSummary.total_expected,
    generated_at: new Date().toISOString(),
  };
}

// ===================== 2) تقرير المصروفات =====================
function buildExpensesReport(budgetId, { fromDate = null, toDate = null, category = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  let costs = (budget.actual_costs || []).slice();
  if (fromDate) costs = costs.filter(c => c.date >= fromDate);
  if (toDate) costs = costs.filter(c => c.date <= toDate);
  if (category) costs = costs.filter(c => c.category === category);

  const byCategory = {};
  for (const c of costs) {
    byCategory[c.category] = r2((byCategory[c.category] || 0) + c.amount);
  }

  const rows = costs
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(c => ({
      date: c.date,
      category: c.category,
      category_label: BUDGET.ACTUAL_COST_CATEGORY_LABELS[c.category] || c.category,
      description: c.description || '-',
      node_id: c.node_id || null,
      amount: c.amount,
      vendor: c.supplier || '-',
    }));

  const total = r2(costs.reduce((s, c) => s + c.amount, 0));

  return {
    report_type: 'expenses_report',
    budget_id: budget.id,
    currency: budget.currency,
    filters: { fromDate, toDate, category },
    rows,
    total_expenses: total,
    expenses_by_category: byCategory,
    count: rows.length,
  };
}

// ===================== 3) تقرير الإيرادات =====================
function buildRevenuesReport(budgetId, { fromDate = null, toDate = null, status = null } = {}) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  let revenues = (budget.revenues || []).slice();
  if (fromDate) revenues = revenues.filter(r => r.date >= fromDate);
  if (toDate) revenues = revenues.filter(r => r.date <= toDate);
  if (status) revenues = revenues.filter(r => r.status === status);

  const byStatus = {};
  for (const r of revenues) {
    byStatus[r.status] = r2((byStatus[r.status] || 0) + r.amount);
  }

  const rows = revenues
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(r => ({
      date: r.date,
      type: r.type,
      type_label: BUDGET.REVENUE_TYPE_LABELS[r.type] || r.type,
      description: r.description || '-',
      status: r.status,
      status_label: BUDGET.REVENUE_STATUS_LABELS[r.status] || r.status,
      amount: r.amount,
      due_date: r.due_date || '-',
    }));

  const total = r2(revenues.reduce((s, r) => s + r.amount, 0));

  return {
    report_type: 'revenues_report',
    budget_id: budget.id,
    currency: budget.currency,
    filters: { fromDate, toDate, status },
    rows,
    total_revenues: total,
    revenues_by_status: byStatus,
    count: rows.length,
  };
}

// ===================== 4) تقرير الأرباح والخسائر =====================
function buildProfitLossReport(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const revenueSummary = computeRevenueSummary(budget);
  const actualSummary = computeActualCostSummary(budget);

  const costsByCategory = {};
  for (const c of (budget.actual_costs || [])) {
    costsByCategory[c.category] = r2((costsByCategory[c.category] || 0) + c.amount);
  }

  const totalRevenueReceived = revenueSummary.total_received;
  const totalCostActual = actualSummary.total_actual_cost;
  const grossProfit = r2(totalRevenueReceived - totalCostActual);
  const grossMarginPct = totalRevenueReceived > 0 ? r2((grossProfit / totalRevenueReceived) * 100) : 0;

  const projectedRevenue = budget.contract_value;
  const projectedCost = computeBBSGrandTotal(budget);
  const projectedProfit = r2(projectedRevenue - projectedCost);
  const projectedMarginPct = projectedRevenue > 0 ? r2((projectedProfit / projectedRevenue) * 100) : 0;

  return {
    report_type: 'profit_loss_report',
    budget_id: budget.id,
    currency: budget.currency,
    actual: {
      total_revenue: totalRevenueReceived,
      total_cost: totalCostActual,
      costs_by_category: costsByCategory,
      gross_profit: grossProfit,
      gross_margin_percent: grossMarginPct,
    },
    projected: {
      contract_value: projectedRevenue,
      planned_cost: projectedCost,
      projected_profit: projectedProfit,
      projected_margin_percent: projectedMarginPct,
    },
    variance_vs_projection: r2(grossProfit - projectedProfit),
  };
}

// ===================== 5) تقرير الانحرافات (يعيد استخدام الجزء 6/10) =====================
function buildDeviationReport(budgetId) {
  const analysis = BUDGET.getDeviationAnalysis(budgetId).data;
  return { report_type: 'deviation_report', ...analysis };
}

// ===================== 6) تقرير التدفقات النقدية (يعيد استخدام الجزء 7/10) =====================
function buildCashFlowReport(budgetId) {
  const flow = BUDGET.getComprehensiveCashFlow(budgetId).data;
  return { report_type: 'cash_flow_report', ...flow };
}

// ===================== 7) تقرير تكلفة كل بند (Cost Items عبر BBS) =====================
function buildCostByItemReport(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const rows = [];
  iterBBSNodes(budget.bbs, (node) => {
    if (node.node_type === 'resource' && (node.cost_items || []).length) {
      for (const item of node.cost_items) {
        rows.push({
          resource_node_id: node.id,
          resource_name: node.name,
          item_code: item.code || '-',
          item_name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total_cost: r2(item.quantity * item.unit_price),
        });
      }
    }
  });

  const grandTotal = r2(rows.reduce((s, r) => s + r.total_cost, 0));

  return {
    report_type: 'cost_by_item_report',
    budget_id: budget.id,
    currency: budget.currency,
    rows,
    grand_total: grandTotal,
    count: rows.length,
  };
}

// ===================== 8) تقرير تكلفة كل مرحلة =====================
function buildCostByPhaseReport(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const phases = (budget.bbs || []).filter(n => n.node_type === 'phase');
  const actualCosts = budget.actual_costs || [];

  const rows = phases.map(phase => {
    const planned = computeNodeTotal(phase);
    const actual = r2(actualCosts.filter(ac => ac.phase_id === phase.id).reduce((s, ac) => s + ac.amount, 0));
    const remaining = r2(planned - actual);
    const consumptionPct = planned > 0 ? r2((actual / planned) * 100) : 0;
    return {
      phase_id: phase.id,
      phase_name: phase.name,
      planned_cost: planned,
      actual_cost: actual,
      remaining,
      consumption_percent: consumptionPct,
    };
  });

  const totals = {
    planned_cost: r2(rows.reduce((s, r) => s + r.planned_cost, 0)),
    actual_cost: r2(rows.reduce((s, r) => s + r.actual_cost, 0)),
    remaining: r2(rows.reduce((s, r) => s + r.remaining, 0)),
  };

  return {
    report_type: 'cost_by_phase_report',
    budget_id: budget.id,
    currency: budget.currency,
    rows,
    totals,
  };
}

// ===================== 9) تقرير أداء المشروع المالي =====================
function buildFinancialPerformanceReport(budgetId) {
  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);

  const evm = BUDGET.getBudgetEVM(budgetId).data;
  const deviation = BUDGET.getDeviationAnalysis(budgetId).data;
  const invoiceSummary = BUDGET.getInvoiceSummary(budgetId).data;
  const paymentRequestsOverview = (() => {
    try { return BUDGET.getPendingApprovalsOverview ? null : null; } catch (e) { return null; }
  })();
  const changeOrders = budget.change_orders || [];
  const approvedCOs = changeOrders.filter(co => co.status === 'management_approved' || co.status === 'approved');
  const pendingCOs = changeOrders.filter(co => !['management_approved', 'approved', 'rejected'].includes(co.status));

  return {
    report_type: 'financial_performance_report',
    budget_id: budget.id,
    project_name: budget.project_name,
    currency: budget.currency,
    evm_summary: {
      cpi: evm.cpi,
      spi: evm.spi,
      cv: evm.cv,
      sv: evm.sv,
      eac: evm.eac,
      etc: evm.etc,
    },
    deviation_summary: {
      overall_variance_pct: deviation.overall ? deviation.overall.variance_pct : null,
      deviation_label: deviation.overall_deviation ? deviation.overall_deviation.label : null,
      phases_at_risk: (deviation.by_phase || []).filter(p => p.deviation && p.deviation.severity === 'severe').length,
    },
    invoicing_summary: {
      client_outstanding: invoiceSummary.client_invoices.total_outstanding,
      vendor_outstanding: invoiceSummary.vendor_invoices.total_outstanding,
      overdue_outstanding: invoiceSummary.overdue_total_outstanding,
    },
    change_orders_summary: {
      approved_count: approvedCOs.length,
      approved_value: r2(approvedCOs.reduce((s, co) => s + (co.additional_cost || 0), 0)),
      pending_count: pendingCOs.length,
    },
  };
}

// ===================== 10) تقرير القيمة المكتسبة (يعيد استخدام الجزء 6/10) =====================
function buildEVMReport(budgetId) {
  const evm = BUDGET.getBudgetEVM(budgetId).data;
  const snapshots = BUDGET.listEVMSnapshots(budgetId).data.items;
  return { report_type: 'evm_report', ...evm, snapshots_history: snapshots };
}

// ===================== الرسوم البيانية (بيانات جاهزة لأي مكتبة رسم في الواجهة) =====================
function buildBudgetCharts(budgetId) {
  const cashFlow = BUDGET.getComprehensiveCashFlow(budgetId).data;
  const costByPhase = buildCostByPhaseReport(budgetId);
  const expenses = buildExpensesReport(budgetId);
  const revenues = buildRevenuesReport(budgetId);
  const deviation = buildDeviationReport(budgetId);
  const plReport = buildProfitLossReport(budgetId);

  return {
    budget_consumption_chart: {
      type: 'gauge',
      labels: ['مُستهلَك', 'متبقٍ'],
      values: [
        r2(costByPhase.totals.actual_cost),
        r2(Math.max(0, costByPhase.totals.planned_cost - costByPhase.totals.actual_cost)),
      ],
    },
    monthly_expenses_chart: {
      type: 'bar',
      labels: cashFlow.months.map(m => m.month),
      values: cashFlow.months.map(m => m.expense_actual),
    },
    monthly_revenues_chart: {
      type: 'bar',
      labels: cashFlow.months.map(m => m.month),
      values: cashFlow.months.map(m => m.revenue_received),
    },
    profit_chart: {
      type: 'bar',
      labels: ['الربح الفعلي', 'الربح المتوقَّع'],
      values: [plReport.actual.gross_profit, plReport.projected.projected_profit],
    },
    deviation_by_phase_chart: {
      type: 'bar',
      labels: (deviation.by_phase || []).map(p => p.phase_name),
      values: (deviation.by_phase || []).map(p => p.variance_pct),
    },
    planned_vs_actual_cashflow_chart: {
      type: 'line',
      labels: cashFlow.months.map(m => m.month),
      planned: cashFlow.months.map(m => m.expense_planned),
      actual: cashFlow.months.map(m => m.expense_actual),
    },
    expenses_by_category_chart: {
      type: 'pie',
      labels: Object.keys(expenses.expenses_by_category),
      values: Object.values(expenses.expenses_by_category),
    },
  };
}

// ===================== نظرة عامة على كل التقارير في تقرير واحد شامل =====================
function buildFullReportPack(budgetId) {
  return {
    general: buildGeneralBudgetReport(budgetId),
    expenses: buildExpensesReport(budgetId),
    revenues: buildRevenuesReport(budgetId),
    profit_loss: buildProfitLossReport(budgetId),
    deviation: buildDeviationReport(budgetId),
    cash_flow: buildCashFlowReport(budgetId),
    cost_by_item: buildCostByItemReport(budgetId),
    cost_by_phase: buildCostByPhaseReport(budgetId),
    financial_performance: buildFinancialPerformanceReport(budgetId),
    evm: buildEVMReport(budgetId),
    charts: buildBudgetCharts(budgetId),
  };
}

// ========================================================================================
// ===================================== التصدير ==========================================
// ========================================================================================

// كل تقرير له تعريف (headers, rows-mapper, title) موحّد يُستخدم في كل صيغ التصدير الأربع
const REPORT_TABLE_DEFS = {
  general_budget_report: (data) => ({
    title: 'General Budget Report / تقرير الميزانية العامة',
    headers: ['البند', 'القيمة'],
    rows: [
      ['رقم الميزانية', data.budget_number],
      ['المشروع', data.project_name],
      ['قيمة العقد', data.contract_value],
      ['الميزانية المخططة', data.planned_budget_total],
      ['قيمة أوامر التغيير المعتمدة', data.approved_change_orders_value],
      ['إجمالي التكلفة الفعلية', data.actual_cost_total],
      ['نسبة استهلاك الميزانية %', data.budget_consumption_percent],
      ['المتبقي من الميزانية', data.remaining_budget],
      ['الربح المتوقع', data.expected_profit],
      ['الربح الفعلي', data.actual_profit],
      ['إجمالي الإيرادات المستلمة', data.total_revenue_received],
      ['إجمالي الإيرادات المتوقعة', data.total_revenue_expected],
    ],
  }),
  expenses_report: (data) => ({
    title: 'Expenses Report / تقرير المصروفات',
    headers: ['التاريخ', 'الفئة', 'الوصف', 'المورد', 'المبلغ'],
    rows: data.rows.map(r => [r.date, r.category_label, r.description, r.vendor, r.amount]),
    totalsRow: ['', '', '', 'الإجمالي', data.total_expenses],
  }),
  revenues_report: (data) => ({
    title: 'Revenues Report / تقرير الإيرادات',
    headers: ['التاريخ', 'النوع', 'الوصف', 'الحالة', 'المبلغ'],
    rows: data.rows.map(r => [r.date, r.type_label, r.description, r.status_label, r.amount]),
    totalsRow: ['', '', '', 'الإجمالي', data.total_revenues],
  }),
  profit_loss_report: (data) => ({
    title: 'Profit & Loss Report / تقرير الأرباح والخسائر',
    headers: ['البند', 'فعلي', 'متوقَّع'],
    rows: [
      ['الإيرادات', data.actual.total_revenue, data.projected.contract_value],
      ['التكاليف', data.actual.total_cost, data.projected.planned_cost],
      ['الربح', data.actual.gross_profit, data.projected.projected_profit],
      ['هامش الربح %', data.actual.gross_margin_percent, data.projected.projected_margin_percent],
    ],
  }),
  deviation_report: (data) => ({
    title: 'Deviation Report / تقرير الانحرافات',
    headers: ['المرحلة', 'المخطط', 'الفعلي', 'الانحراف', 'نسبة الانحراف %', 'التصنيف'],
    rows: (data.by_phase || []).map(p => [p.phase_name, p.planned_cost, p.actual_cost, p.variance, p.variance_pct, p.deviation.label]),
  }),
  cash_flow_report: (data) => ({
    title: 'Cash Flow Report / تقرير التدفقات النقدية',
    headers: ['الشهر', 'إيراد متوقَّع', 'إيراد مستلَم', 'مصروف مخطَّط', 'مصروف فعلي', 'الرصيد التراكمي الفعلي'],
    rows: (data.months || []).map(m => [m.month, m.revenue_expected, m.revenue_received, m.expense_planned, m.expense_actual, m.cumulative_balance_actual]),
  }),
  cost_by_item_report: (data) => ({
    title: 'Cost By Item Report / تقرير تكلفة كل بند',
    headers: ['المورد', 'كود البند', 'اسم البند', 'الكمية', 'الوحدة', 'سعر الوحدة', 'التكلفة الإجمالية'],
    rows: data.rows.map(r => [r.resource_name, r.item_code, r.item_name, r.quantity, r.unit, r.unit_price, r.total_cost]),
    totalsRow: ['', '', '', '', '', 'الإجمالي', data.grand_total],
  }),
  cost_by_phase_report: (data) => ({
    title: 'Cost By Phase Report / تقرير تكلفة كل مرحلة',
    headers: ['المرحلة', 'التكلفة المخططة', 'التكلفة الفعلية', 'المتبقي', 'نسبة الاستهلاك %'],
    rows: data.rows.map(r => [r.phase_name, r.planned_cost, r.actual_cost, r.remaining, r.consumption_percent]),
    totalsRow: ['الإجمالي', data.totals.planned_cost, data.totals.actual_cost, data.totals.remaining, ''],
  }),
  financial_performance_report: (data) => ({
    title: 'Financial Performance Report / تقرير أداء المشروع المالي',
    headers: ['المؤشر', 'القيمة'],
    rows: [
      ['CPI', data.evm_summary.cpi], ['SPI', data.evm_summary.spi],
      ['CV', data.evm_summary.cv], ['SV', data.evm_summary.sv],
      ['EAC', data.evm_summary.eac], ['ETC', data.evm_summary.etc],
      ['نسبة الانحراف الكلي %', data.deviation_summary.overall_variance_pct],
      ['مراحل عالية الخطورة', data.deviation_summary.phases_at_risk],
      ['مستحق على العملاء', data.invoicing_summary.client_outstanding],
      ['مستحق للموردين', data.invoicing_summary.vendor_outstanding],
      ['متأخرات', data.invoicing_summary.overdue_outstanding],
      ['أوامر تغيير معتمدة (عدد)', data.change_orders_summary.approved_count],
      ['قيمة أوامر التغيير المعتمدة', data.change_orders_summary.approved_value],
      ['أوامر تغيير معلَّقة (عدد)', data.change_orders_summary.pending_count],
    ],
  }),
  evm_report: (data) => ({
    title: 'Earned Value Management Report / تقرير القيمة المكتسبة',
    headers: ['المؤشر', 'القيمة'],
    rows: [
      ['Planned Value (PV)', data.pv], ['Earned Value (EV)', data.ev], ['Actual Cost (AC)', data.ac],
      ['Cost Variance (CV)', data.cv], ['Schedule Variance (SV)', data.sv],
      ['CPI', data.cpi], ['SPI', data.spi],
      ['Estimate At Completion (EAC)', data.eac], ['Estimate To Complete (ETC)', data.etc],
    ],
  }),
};

function getReportDef(reportType, data) {
  const fn = REPORT_TABLE_DEFS[reportType];
  if (!fn) throw new Error(`نوع تقرير غير معروف للتصدير: ${reportType}`);
  return fn(data);
}

function exportReportToPDF(reportType, data, meta = {}) {
  const def = getReportDef(reportType, data);
  const filename = `budget-${reportType}-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const doc = new TablePDF();
  const reportNumber = `BUD-${Date.now().toString().slice(-8)}`;
  doc.addTitle(def.title, `Report ${reportNumber} | ${new Date().toLocaleDateString('en-GB')}`);
  doc.addKeyValueRow([
    ['Project', meta.projectName || data.project_name || '-'],
    ['Budget', meta.budgetNumber || data.budget_number || '-'],
    ['Currency', data.currency || '-'],
  ]);
  doc.addSpacing(10);

  const rows = def.totalsRow ? [...def.rows, def.totalsRow] : def.rows;
  doc.addTable(def.headers, rows);

  for (const page of doc.pages) {
    page.commands.push(`BT /F1 7 Tf 0.5 0.5 0.5 rg 36 20 Td (Civil Engineering Suite | Budget Report ${reportNumber}) Tj ET`);
  }

  const buffer = doc._buildFinal();
  fs.writeFileSync(outputPath, buffer);
  return { reportNumber, outputPath, url: `/reports/${filename}` };
}

function exportReportToExcel(reportType, data) {
  const def = getReportDef(reportType, data);
  const filename = `budget-${reportType}-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const sheetRows = [def.headers, ...def.rows];
  if (def.totalsRow) { sheetRows.push([]); sheetRows.push(def.totalsRow); }

  const buffer = generateXlsx([{ name: def.title.slice(0, 28), rows: sheetRows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToCSV(reportType, data) {
  const def = getReportDef(reportType, data);
  const filename = `budget-${reportType}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const rows = def.totalsRow ? [...def.rows, def.totalsRow] : def.rows;
  const buffer = generateCsv(def.headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToWord(reportType, data, meta = {}) {
  const def = getReportDef(reportType, data);
  const filename = `budget-${reportType}-${Date.now()}.docx`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const rows = def.totalsRow ? [...def.rows, def.totalsRow] : def.rows;
  const elements = [
    { type: 'heading', text: def.title },
    { type: 'text', text: `المشروع: ${meta.projectName || data.project_name || '-'} | الميزانية: ${meta.budgetNumber || data.budget_number || '-'} | التاريخ: ${new Date().toLocaleDateString('ar-EG')}` },
    { type: 'table', headers: def.headers, rows },
  ];

  const buffer = generateDocx(elements);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

/**
 * نقطة دخول موحّدة للتصدير: تبني التقرير المطلوب من budgetId ثم تصدّره بالصيغة المطلوبة
 * @param {string} reportType - أحد أنواع REPORT_TABLE_DEFS
 * @param {string} budgetId
 * @param {string} format - pdf | excel | csv | word
 * @param {Object} [filters] - يُمرَّر فقط لتقارير المصروفات/الإيرادات (fromDate/toDate/category/status)
 */
function exportBudgetReport(reportType, budgetId, format, filters = {}) {
  let data;
  switch (reportType) {
    case 'general_budget_report': data = buildGeneralBudgetReport(budgetId); break;
    case 'expenses_report': data = buildExpensesReport(budgetId, filters); break;
    case 'revenues_report': data = buildRevenuesReport(budgetId, filters); break;
    case 'profit_loss_report': data = buildProfitLossReport(budgetId); break;
    case 'deviation_report': data = buildDeviationReport(budgetId); break;
    case 'cash_flow_report': data = buildCashFlowReport(budgetId); break;
    case 'cost_by_item_report': data = buildCostByItemReport(budgetId); break;
    case 'cost_by_phase_report': data = buildCostByPhaseReport(budgetId); break;
    case 'financial_performance_report': data = buildFinancialPerformanceReport(budgetId); break;
    case 'evm_report': data = buildEVMReport(budgetId); break;
    default: throw new Error(`نوع تقرير غير معروف: ${reportType}`);
  }

  const db = loadDB();
  const budget = findBudgetOrThrow(db, budgetId);
  const meta = { projectName: budget.project_name, budgetNumber: budget.budget_number };

  switch (format) {
    case 'pdf': return { data, export: exportReportToPDF(reportType, data, meta) };
    case 'excel': return { data, export: exportReportToExcel(reportType, data) };
    case 'csv': return { data, export: exportReportToCSV(reportType, data) };
    case 'word': return { data, export: exportReportToWord(reportType, data, meta) };
    default: throw new Error(`صيغة تصدير غير مدعومة: ${format}. الصيغ المدعومة: pdf, excel, csv, word`);
  }
}

module.exports = {
  buildGeneralBudgetReport,
  buildExpensesReport,
  buildRevenuesReport,
  buildProfitLossReport,
  buildDeviationReport,
  buildCashFlowReport,
  buildCostByItemReport,
  buildCostByPhaseReport,
  buildFinancialPerformanceReport,
  buildEVMReport,
  buildBudgetCharts,
  buildFullReportPack,
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  exportReportToWord,
  exportBudgetReport,
  REPORT_TABLE_DEFS,
};
