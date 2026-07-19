/**
 * القسم السابع - نظام إدارة المعدات (Equipment & Assets Management System)
 * =========================================================================
 * الجزء الرابع (4-أ من 4-ب): وحدة التقارير الاحترافية (Reports Module)
 * ------------------------------------------------------------------------
 * يبني فوق equipmentManagement.js (الأجزاء 1-3 المُنجزة) دون تعديلها،
 * بنفس نمط boqReports.js + tablePdfGenerator.js + xlsxWriter.js + csvWriter.js
 * المستخدَم في القسم الثالث (حصر الكميات).
 *
 * التقارير المُنتَجة (حسب مواصفة القسم السابع):
 *  1) تقرير المعدات (Fleet Register Report)
 *  2) تقرير التشغيل (Operations Report)
 *  3) تقرير الصيانة (Maintenance Report)
 *  4) تقرير الوقود (Fuel Report)
 *  5) تقرير الأعطال (Faults Report)
 *  6) تقرير الإنتاجية (Productivity Report)
 *  7) تقرير التكاليف (Costs Report)
 *  8) تقرير الإهلاك (Depreciation Report)
 *  9) تقرير الاستخدام حسب المشروع (Usage by Project Report)
 * 10) التقرير التنفيذي (Executive Summary Report)
 *
 * التصدير: PDF احترافي / Excel / CSV / HTML قابل للطباعة المباشرة.
 */

const path = require('path');
const fs = require('fs');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');
const EQ = require('./equipmentManagement');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function dOnly(d) { return d ? String(d).slice(0, 10) : '—'; }

// ===================== 1) تقرير المعدات (Fleet Register) =====================

function buildFleetRegisterReport({ category = null, type = null, status = null, projectId = null } = {}) {
  const { data: items } = EQ.listEquipment({ category, type, status, projectId });

  const rows = items.map((e, i) => ({
    seq: i + 1,
    code: e.code,
    name: e.name,
    category: e.category,
    type: e.type,
    manufacturer: e.manufacturer || '-',
    model: e.model || '-',
    status: e.status,
    ownership: e.ownership,
    current_project_id: e.current_project_id || '-',
    total_operating_hours: e.total_operating_hours || 0,
    purchase_price: e.purchase_price || 0,
    depreciation_value: e.depreciation_value || 0,
  }));

  const byStatus = {};
  const byCategory = {};
  for (const e of items) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }

  return {
    report_type: 'fleet_register',
    generated_at: new Date().toISOString(),
    filters: { category, type, status, projectId },
    total_count: rows.length,
    by_status: byStatus,
    by_category: byCategory,
    rows,
  };
}

// ===================== 2) تقرير التشغيل (Operations) =====================

function buildOperationsReport({ equipmentId = null, projectId = null, dateFrom = null, dateTo = null } = {}) {
  const { data: ops } = EQ.listOperations({ equipmentId, projectId });
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  const filtered = ops.filter(o => inRange(String(o.started_at).slice(0, 10)));

  const equipmentNameCache = {};
  const nameFor = (id) => {
    if (equipmentNameCache[id] !== undefined) return equipmentNameCache[id];
    try {
      const { data: eq } = EQ.getEquipment(id);
      equipmentNameCache[id] = eq ? eq.name : id;
    } catch (_) { equipmentNameCache[id] = id; }
    return equipmentNameCache[id];
  };

  const rows = filtered.map((o, i) => ({
    seq: i + 1,
    equipment_id: o.equipment_id,
    equipment_name: nameFor(o.equipment_id),
    project_id: o.project_id || '-',
    operator_id: o.operator_id || o.operator_name || '-',
    started_at: o.started_at,
    ended_at: o.ended_at || 'قيد التشغيل',
    duration_hours: o.duration_hours || 0,
  }));

  const totalHours = r2(rows.reduce((s, r) => s + (r.duration_hours || 0), 0));
  const openOperations = rows.filter(r => r.ended_at === 'قيد التشغيل').length;
  const workDays = new Set(rows.map(r => String(r.started_at).slice(0, 10))).size;

  return {
    report_type: 'operations',
    generated_at: new Date().toISOString(),
    filters: { equipmentId, projectId, dateFrom, dateTo },
    total_records: rows.length,
    total_operating_hours: totalHours,
    open_operations: openOperations,
    work_days: workDays,
    rows,
  };
}

// ===================== 3) تقرير الصيانة (Maintenance) =====================

function buildMaintenanceReport({ equipmentId = null, projectId = null, maintenanceType = null, status = null, dateFrom = null, dateTo = null } = {}) {
  const { data: records } = EQ.listMaintenanceRecords({ equipmentId, projectId, maintenanceType, status });
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  const filtered = records.filter(m => inRange(String(m.started_at).slice(0, 10)));

  const rows = filtered.map((m, i) => ({
    seq: i + 1,
    equipment_id: m.equipment_id,
    maintenance_type: m.maintenance_type,
    severity: m.severity || '-',
    technician: m.technician || '-',
    started_at: dOnly(m.started_at),
    completed_at: dOnly(m.completed_at),
    downtime_hours: m.downtime_hours || 0,
    repair_cost: m.repair_cost || 0,
    spare_parts_cost: m.spare_parts_cost || 0,
    total_cost: m.total_cost || 0,
    status: m.status,
  }));

  const totalCost = r2(rows.reduce((s, r) => s + (r.total_cost || 0), 0));
  const totalDowntime = r2(rows.reduce((s, r) => s + (r.downtime_hours || 0), 0));
  const preventiveCount = rows.filter(r => r.maintenance_type !== 'emergency').length;
  const emergencyCount = rows.filter(r => r.maintenance_type === 'emergency').length;

  return {
    report_type: 'maintenance',
    generated_at: new Date().toISOString(),
    filters: { equipmentId, projectId, maintenanceType, status, dateFrom, dateTo },
    total_records: rows.length,
    preventive_count: preventiveCount,
    emergency_count: emergencyCount,
    total_cost: totalCost,
    total_downtime_hours: totalDowntime,
    rows,
  };
}

// ===================== 4) تقرير الوقود (Fuel) =====================

function buildFuelReport({ equipmentId = null, projectId = null, dateFrom = null, dateTo = null } = {}) {
  const { data: logs } = EQ.listFuelLogs({ equipmentId, projectId });
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  const filtered = logs.filter(f => inRange(String(f.filled_at).slice(0, 10)));

  const rows = filtered.map((f, i) => ({
    seq: i + 1,
    equipment_id: f.equipment_id,
    fuel_type: f.fuel_type,
    quantity: f.quantity,
    unit_price: f.unit_price || 0,
    cost: f.cost || 0,
    filled_at: dOnly(f.filled_at),
  }));

  const totalQuantity = r2(rows.reduce((s, r) => s + (r.quantity || 0), 0));
  const totalCost = r2(rows.reduce((s, r) => s + (r.cost || 0), 0));
  const avgUnitPrice = rows.length ? r2(totalCost / totalQuantity) : 0;

  return {
    report_type: 'fuel',
    generated_at: new Date().toISOString(),
    filters: { equipmentId, projectId, dateFrom, dateTo },
    total_records: rows.length,
    total_quantity: totalQuantity,
    total_cost: totalCost,
    average_unit_price: avgUnitPrice,
    rows,
  };
}

// ===================== 5) تقرير الأعطال (Faults) =====================

function buildFaultsReport({ equipmentId = null, projectId = null, severity = null, dateFrom = null, dateTo = null } = {}) {
  const { data: records } = EQ.listMaintenanceRecords({ equipmentId, projectId, maintenanceType: 'emergency' });
  const inRange = (d) => (!d ? true : (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo));
  let filtered = records.filter(m => inRange(String(m.started_at).slice(0, 10)));
  if (severity) filtered = filtered.filter(m => m.severity === severity);

  const rows = filtered.map((m, i) => ({
    seq: i + 1,
    equipment_id: m.equipment_id,
    fault_description: m.fault_description || '-',
    fault_cause: m.fault_cause || '-',
    severity: m.severity || '-',
    technician: m.technician || '-',
    started_at: dOnly(m.started_at),
    completed_at: dOnly(m.completed_at),
    downtime_hours: m.downtime_hours || 0,
    repair_cost: m.total_cost || 0,
    status: m.status,
  }));

  const bySeverity = {};
  for (const r of rows) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
  const totalDowntime = r2(rows.reduce((s, r) => s + (r.downtime_hours || 0), 0));
  const totalRepairCost = r2(rows.reduce((s, r) => s + (r.repair_cost || 0), 0));

  return {
    report_type: 'faults',
    generated_at: new Date().toISOString(),
    filters: { equipmentId, projectId, severity, dateFrom, dateTo },
    total_faults: rows.length,
    by_severity: bySeverity,
    total_downtime_hours: totalDowntime,
    total_repair_cost: totalRepairCost,
    rows,
  };
}

// ===================== 6) تقرير الإنتاجية (Productivity) =====================

function buildProductivityReport({ type = null, category = null, dateFrom = null, dateTo = null } = {}) {
  const { data } = EQ.compareEquipmentProductivity({ type, category, dateFrom, dateTo });

  const rows = (data.items || []).map((it, i) => ({
    seq: i + 1,
    equipment_code: it.equipment_code,
    equipment_name: it.equipment_name,
    type: it.type,
    operating_hours: it.operating_hours,
    utilization_rate_percent: it.utilization_rate_percent,
    operating_efficiency_percent: it.operating_efficiency_percent,
    fault_rate_per_100h: it.fault_rate_per_100h,
  }));

  return {
    report_type: 'productivity',
    generated_at: new Date().toISOString(),
    filters: { type, category, dateFrom, dateTo },
    equipment_count: data.count || 0,
    average_efficiency_percent: data.average_efficiency_percent || 0,
    best_performing: data.best_performing || null,
    worst_performing: data.worst_performing || null,
    rows,
  };
}

// ===================== 7) تقرير التكاليف (Costs) =====================

function buildCostsReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const { data } = EQ.getFleetCostSummary({ projectId, dateFrom, dateTo });

  const rows = (data.by_equipment || []).map((e, i) => ({
    seq: i + 1,
    equipment_code: e.equipment_code,
    equipment_name: e.equipment_name,
    total_cost: e.total_cost,
  }));

  return {
    report_type: 'costs',
    generated_at: new Date().toISOString(),
    filters: { projectId, dateFrom, dateTo },
    equipment_count: data.equipment_count || 0,
    totals: data.totals || {},
    most_costly_equipment: data.most_costly_equipment || [],
    rows,
  };
}

// ===================== 8) تقرير الإهلاك (Depreciation) =====================

function buildDepreciationReport({ category = null, type = null } = {}) {
  const { data: items } = EQ.listEquipment({ category, type });

  const rows = items.map((e, i) => {
    const purchasePrice = e.purchase_price || 0;
    const usefulLife = e.useful_life_years || null;
    const purchaseDate = e.purchase_date || null;
    let ageYears = null;
    let annualDepreciation = null;
    let netBookValue = null;
    if (purchaseDate) {
      ageYears = r2((new Date() - new Date(purchaseDate)) / (365.25 * 86400000));
    }
    if (usefulLife && purchasePrice) {
      annualDepreciation = r2(purchasePrice / usefulLife);
      const accumulated = ageYears != null ? r2(Math.min(ageYears, usefulLife) * annualDepreciation) : (e.depreciation_value || 0);
      netBookValue = r2(Math.max(0, purchasePrice - accumulated));
    }
    return {
      seq: i + 1,
      equipment_code: e.code,
      equipment_name: e.name,
      purchase_date: dOnly(purchaseDate),
      purchase_price: purchasePrice,
      useful_life_years: usefulLife || '-',
      age_years: ageYears != null ? ageYears : '-',
      annual_depreciation: annualDepreciation != null ? annualDepreciation : '-',
      accumulated_depreciation: e.depreciation_value || 0,
      net_book_value: netBookValue != null ? netBookValue : '-',
    };
  });

  const totalPurchaseValue = r2(rows.reduce((s, r) => s + (r.purchase_price || 0), 0));
  const totalAccumulatedDepreciation = r2(rows.reduce((s, r) => s + (r.accumulated_depreciation || 0), 0));
  const totalNetBookValue = r2(rows.reduce((s, r) => s + (typeof r.net_book_value === 'number' ? r.net_book_value : 0), 0));

  return {
    report_type: 'depreciation',
    generated_at: new Date().toISOString(),
    filters: { category, type },
    equipment_count: rows.length,
    total_purchase_value: totalPurchaseValue,
    total_accumulated_depreciation: totalAccumulatedDepreciation,
    total_net_book_value: totalNetBookValue,
    rows,
  };
}

// ===================== 9) تقرير الاستخدام حسب المشروع (Usage by Project) =====================

function buildUsageByProjectReport({ projectId, dateFrom = null, dateTo = null } = {}) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  const opsReport = buildOperationsReport({ projectId, dateFrom, dateTo });
  const costsReport = buildCostsReport({ projectId, dateFrom, dateTo });
  const { data: equipmentInProject } = EQ.listEquipment({ projectId });

  const hoursByEquipment = {};
  for (const row of opsReport.rows) {
    hoursByEquipment[row.equipment_id] = r2((hoursByEquipment[row.equipment_id] || 0) + (row.duration_hours || 0));
  }

  const rows = equipmentInProject.map((e, i) => ({
    seq: i + 1,
    equipment_code: e.code,
    equipment_name: e.name,
    type: e.type,
    status: e.status,
    operating_hours: hoursByEquipment[e.id] || 0,
    total_cost: (costsReport.rows.find(r => r.equipment_code === e.code) || {}).total_cost || 0,
  }));

  return {
    report_type: 'usage_by_project',
    generated_at: new Date().toISOString(),
    filters: { projectId, dateFrom, dateTo },
    project_id: projectId,
    equipment_count: rows.length,
    total_operating_hours: r2(rows.reduce((s, r) => s + (r.operating_hours || 0), 0)),
    total_cost: costsReport.totals.total_cost || 0,
    rows,
  };
}

// ===================== 10) التقرير التنفيذي (Executive Summary) =====================

function buildExecutiveSummaryReport({ projectId = null, dateFrom = null, dateTo = null } = {}) {
  const { data: dashboard } = EQ.getBasicDashboard(projectId);
  const costsReport = buildCostsReport({ projectId, dateFrom, dateTo });
  const faultsReport = buildFaultsReport({ projectId, dateFrom, dateTo });
  const productivityReport = buildProductivityReport({ dateFrom, dateTo });
  const fuelReport = buildFuelReport({ projectId, dateFrom, dateTo });
  const { data: alertsData } = EQ.getAlertsCenter({ withinDays: 14 });

  return {
    report_type: 'executive_summary',
    generated_at: new Date().toISOString(),
    filters: { projectId, dateFrom, dateTo },
    fleet_overview: {
      total_equipment: dashboard.total_equipment,
      working: dashboard.by_status.working || 0,
      idle: dashboard.by_status.stopped || 0,
      under_maintenance: dashboard.by_status.under_maintenance || 0,
      reserved: dashboard.by_status.reserved || 0,
      available: dashboard.by_status.available || 0,
    },
    financials: {
      total_cost: costsReport.totals.total_cost || 0,
      maintenance_cost: costsReport.totals.maintenance_cost || 0,
      fuel_cost: fuelReport.total_cost,
      most_costly_equipment: costsReport.most_costly_equipment.slice(0, 5),
    },
    reliability: {
      total_faults: faultsReport.total_faults,
      total_downtime_hours: faultsReport.total_downtime_hours,
      by_severity: faultsReport.by_severity,
    },
    productivity: {
      average_efficiency_percent: productivityReport.average_efficiency_percent,
      best_performing: productivityReport.best_performing,
      worst_performing: productivityReport.worst_performing,
    },
    active_alerts_count: (alertsData.alerts || []).length,
    top_alerts: (alertsData.alerts || []).slice(0, 5).map(a => ({ type: a.category, message: a.message, severity: a.severity })),
  };
}

// ===================== التصدير: PDF / Excel / CSV / طباعة =====================

const REPORT_COLUMN_DEFS = {
  fleet_register: {
    headers: ['#', 'Code', 'Name', 'Category', 'Type', 'Status', 'Ownership', 'Hours', 'Purchase Price'],
    keys: ['seq', 'code', 'name', 'category', 'type', 'status', 'ownership', 'total_operating_hours', 'purchase_price'],
    colWidths: [25, 70, 130, 90, 90, 70, 70, 60, 80],
    titleAr: 'تقرير المعدات', titleEn: 'Fleet Register Report',
  },
  operations: {
    headers: ['#', 'Equipment', 'Project', 'Started', 'Ended', 'Duration (h)'],
    keys: ['seq', 'equipment_name', 'project_id', 'started_at', 'ended_at', 'duration_hours'],
    colWidths: [25, 150, 90, 130, 130, 80],
    titleAr: 'تقرير التشغيل', titleEn: 'Operations Report',
  },
  maintenance: {
    headers: ['#', 'Equipment', 'Type', 'Severity', 'Started', 'Completed', 'Downtime (h)', 'Total Cost'],
    keys: ['seq', 'equipment_id', 'maintenance_type', 'severity', 'started_at', 'completed_at', 'downtime_hours', 'total_cost'],
    colWidths: [25, 90, 80, 70, 90, 90, 80, 80],
    titleAr: 'تقرير الصيانة', titleEn: 'Maintenance Report',
  },
  fuel: {
    headers: ['#', 'Equipment', 'Fuel Type', 'Quantity', 'Unit Price', 'Cost', 'Filled At'],
    keys: ['seq', 'equipment_id', 'fuel_type', 'quantity', 'unit_price', 'cost', 'filled_at'],
    colWidths: [25, 90, 80, 70, 70, 70, 90],
    titleAr: 'تقرير الوقود', titleEn: 'Fuel Report',
  },
  faults: {
    headers: ['#', 'Equipment', 'Description', 'Severity', 'Started', 'Downtime (h)', 'Repair Cost'],
    keys: ['seq', 'equipment_id', 'fault_description', 'severity', 'started_at', 'downtime_hours', 'repair_cost'],
    colWidths: [25, 90, 200, 70, 90, 80, 80],
    titleAr: 'تقرير الأعطال', titleEn: 'Faults Report',
  },
  productivity: {
    headers: ['#', 'Code', 'Name', 'Hours', 'Utilization %', 'Efficiency %', 'Fault Rate /100h'],
    keys: ['seq', 'equipment_code', 'equipment_name', 'operating_hours', 'utilization_rate_percent', 'operating_efficiency_percent', 'fault_rate_per_100h'],
    colWidths: [25, 70, 140, 70, 90, 90, 90],
    titleAr: 'تقرير الإنتاجية', titleEn: 'Productivity Report',
  },
  costs: {
    headers: ['#', 'Code', 'Name', 'Total Cost'],
    keys: ['seq', 'equipment_code', 'equipment_name', 'total_cost'],
    colWidths: [25, 90, 200, 100],
    titleAr: 'تقرير التكاليف', titleEn: 'Costs Report',
  },
  depreciation: {
    headers: ['#', 'Code', 'Name', 'Purchase Price', 'Age (y)', 'Annual Depr.', 'Accum. Depr.', 'Net Book Value'],
    keys: ['seq', 'equipment_code', 'equipment_name', 'purchase_price', 'age_years', 'annual_depreciation', 'accumulated_depreciation', 'net_book_value'],
    colWidths: [25, 70, 140, 80, 60, 80, 80, 90],
    titleAr: 'تقرير الإهلاك', titleEn: 'Depreciation Report',
  },
  usage_by_project: {
    headers: ['#', 'Code', 'Name', 'Type', 'Status', 'Operating Hours', 'Total Cost'],
    keys: ['seq', 'equipment_code', 'equipment_name', 'type', 'status', 'operating_hours', 'total_cost'],
    colWidths: [25, 70, 150, 80, 70, 90, 90],
    titleAr: 'تقرير الاستخدام حسب المشروع', titleEn: 'Usage by Project Report',
  },
};

function reportRowsToTable(report) {
  const def = REPORT_COLUMN_DEFS[report.report_type];
  if (!def) throw new Error(`لا يوجد تعريف أعمدة لهذا النوع من التقارير: ${report.report_type}`);
  const rows = (report.rows || []).map(row => def.keys.map(k => row[k] ?? '-'));
  return { def, rows };
}

function exportReportToPDF(report, meta = {}) {
  if (report.report_type === 'executive_summary') return exportExecutiveSummaryToPDF(report, meta);
  const { def, rows } = reportRowsToTable(report);
  const filename = `equipment-${report.report_type}-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const result = generateBoqTablePDF({
    title: def.titleEn,
    meta: { ...meta, generatedAt: report.generated_at },
    headers: def.headers,
    rows,
    totals: report.total_cost != null ? { label: 'Total Cost', value: report.total_cost } : null,
    outputPath,
    colWidths: def.colWidths,
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportReportToExcel(report) {
  const { def, rows } = reportRowsToTable(report);
  const filename = `equipment-${report.report_type}-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const sheetRows = [def.headers, ...rows];
  const buffer = generateXlsx([{ name: def.titleEn.slice(0, 28), rows: sheetRows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToCSV(report) {
  const { def, rows } = reportRowsToTable(report);
  const filename = `equipment-${report.report_type}-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const buffer = generateCsv(def.headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToPrintableHTML(report, meta = {}) {
  if (report.report_type === 'executive_summary') return exportExecutiveSummaryToPrintableHTML(report, meta);
  const def = REPORT_COLUMN_DEFS[report.report_type];
  if (!def) throw new Error(`لا يوجد تعريف أعمدة لهذا النوع من التقارير: ${report.report_type}`);
  const filename = `equipment-${report.report_type}-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);

  const rowsHtml = (report.rows || []).map(row => `
    <tr>${def.keys.map(k => `<td>${row[k] ?? '-'}</td>`).join('')}</tr>`).join('');
  const headersHtml = def.headers.map(h => `<th>${h}</th>`).join('');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>${def.titleAr}</title>
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
<h1>${def.titleAr}</h1>
<div class="meta">المشروع: ${meta.projectName || '-'} | تاريخ الإصدار: ${new Date(report.generated_at).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>
<table><thead><tr>${headersHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
${report.total_cost != null ? `<div class="total">إجمالي التكلفة: ${report.total_cost}</div>` : ''}
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

// ---- تصدير خاص بالتقرير التنفيذي (بنية مختلفة، بدون صفوف جدولية موحّدة) ----

function exportExecutiveSummaryToPDF(report, meta = {}) {
  const filename = `equipment-executive-summary-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['Metric', 'Value'];
  const rows = [
    ['Total Equipment', report.fleet_overview.total_equipment],
    ['Working', report.fleet_overview.working],
    ['Idle', report.fleet_overview.idle],
    ['Under Maintenance', report.fleet_overview.under_maintenance],
    ['Reserved', report.fleet_overview.reserved],
    ['Available', report.fleet_overview.available],
    ['Total Cost', report.financials.total_cost],
    ['Maintenance Cost', report.financials.maintenance_cost],
    ['Fuel Cost', report.financials.fuel_cost],
    ['Total Faults', report.reliability.total_faults],
    ['Total Downtime (h)', report.reliability.total_downtime_hours],
    ['Average Efficiency %', report.productivity.average_efficiency_percent],
    ['Active Alerts', report.active_alerts_count],
  ];
  const result = generateBoqTablePDF({
    title: 'Equipment Executive Summary Report',
    meta: { ...meta, generatedAt: report.generated_at },
    headers,
    rows,
    totals: null,
    outputPath,
    colWidths: [220, 150],
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportExecutiveSummaryToPrintableHTML(report, meta = {}) {
  const filename = `equipment-executive-summary-${Date.now()}.html`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>التقرير التنفيذي - إدارة المعدات</title>
<style>
body{font-family:'Segoe UI',Tahoma,sans-serif;padding:24px;color:#1a2634}
h1{border-bottom:3px solid #0d2438;padding-bottom:8px}
h2{margin-top:24px;color:#0d2438}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
.card{background:#f5f7fa;border:1px solid #ddd;border-radius:8px;padding:12px 18px;min-width:150px}
.card .val{font-size:22px;font-weight:bold;color:#0d2438}
.card .lbl{font-size:12px;color:#666}
.meta{margin:10px 0;color:#555}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
th{background:#0d2438;color:#fff}
@media print{button{display:none}}
</style></head><body>
<h1>التقرير التنفيذي - إدارة المعدات</h1>
<div class="meta">المشروع: ${meta.projectName || 'كل المشاريع'} | تاريخ الإصدار: ${new Date(report.generated_at).toLocaleString('ar-EG')}</div>
<button onclick="window.print()">طباعة</button>

<h2>نظرة عامة على الأسطول</h2>
<div class="cards">
  <div class="card"><div class="val">${report.fleet_overview.total_equipment}</div><div class="lbl">إجمالي المعدات</div></div>
  <div class="card"><div class="val">${report.fleet_overview.working}</div><div class="lbl">تعمل</div></div>
  <div class="card"><div class="val">${report.fleet_overview.idle}</div><div class="lbl">متوقفة</div></div>
  <div class="card"><div class="val">${report.fleet_overview.under_maintenance}</div><div class="lbl">تحت الصيانة</div></div>
  <div class="card"><div class="val">${report.fleet_overview.reserved}</div><div class="lbl">محجوزة</div></div>
  <div class="card"><div class="val">${report.fleet_overview.available}</div><div class="lbl">متاحة</div></div>
</div>

<h2>الماليات</h2>
<div class="cards">
  <div class="card"><div class="val">${report.financials.total_cost}</div><div class="lbl">إجمالي التكلفة</div></div>
  <div class="card"><div class="val">${report.financials.maintenance_cost}</div><div class="lbl">تكلفة الصيانة</div></div>
  <div class="card"><div class="val">${report.financials.fuel_cost}</div><div class="lbl">تكلفة الوقود</div></div>
</div>
<h3>الأعلى تكلفة</h3>
<table><thead><tr><th>الكود</th><th>الاسم</th><th>التكلفة</th></tr></thead>
<tbody>${report.financials.most_costly_equipment.map(e => `<tr><td>${e.equipment_code}</td><td>${e.equipment_name}</td><td>${e.total_cost}</td></tr>`).join('')}</tbody></table>

<h2>الموثوقية</h2>
<div class="cards">
  <div class="card"><div class="val">${report.reliability.total_faults}</div><div class="lbl">إجمالي الأعطال</div></div>
  <div class="card"><div class="val">${report.reliability.total_downtime_hours}</div><div class="lbl">ساعات التوقف</div></div>
</div>

<h2>الإنتاجية</h2>
<div class="cards">
  <div class="card"><div class="val">${report.productivity.average_efficiency_percent}%</div><div class="lbl">متوسط الكفاءة</div></div>
</div>

<h2>التنبيهات النشطة (${report.active_alerts_count})</h2>
<table><thead><tr><th>النوع</th><th>الرسالة</th><th>الخطورة</th></tr></thead>
<tbody>${report.top_alerts.map(a => `<tr><td>${a.type || '-'}</td><td>${a.message || '-'}</td><td>${a.severity || '-'}</td></tr>`).join('')}</tbody></table>
</body></html>`;
  fs.writeFileSync(outputPath, html, 'utf-8');
  return { outputPath, url: `/reports/${filename}` };
}

module.exports = {
  buildFleetRegisterReport,
  buildOperationsReport,
  buildMaintenanceReport,
  buildFuelReport,
  buildFaultsReport,
  buildProductivityReport,
  buildCostsReport,
  buildDepreciationReport,
  buildUsageByProjectReport,
  buildExecutiveSummaryReport,
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  exportReportToPrintableHTML,
};
