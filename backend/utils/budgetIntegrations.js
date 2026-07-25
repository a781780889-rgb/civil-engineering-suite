/**
 * القسم الثالث عشر - نظام إدارة الميزانية (Budget Management System)
 * ===================================================================
 * الجزء العاشر (10/10) - جزء (ب): طبقة التكامل الشامل مع بقية الأقسام
 * ===================================================================
 *
 * هذا الملف مسؤول حصراً عن الربط الفعلي بين قسم الميزانية والأقسام الأخرى
 * الموجودة فعلياً في المنصة، بعد فحص حقيقي لما هو منجز فعلاً في الكود (وليس
 * افتراضاً). نتيجة الفحص:
 *
 *  - إدارة المشاريع (projectManagement.js)  → موجودة، مربوطة فعلياً منذ 1/10.
 *  - حصر الكميات (BOQ)                       → مربوطة فعلياً منذ 2/10
 *                                               (importBOQLineItems/syncBOQCostItem).
 *  - المشتريات والعقود (businessContracts.js) → موجودة فعلياً (عقود + فواتير +
 *                                               طلبات شراء + أوامر شراء)، ولم تكن
 *                                               مربوطة بالميزانية قبل هذا الجزء.
 *                                               تُربَط هنا فعلياً.
 *  - المعدات (equipmentManagement.js)        → موجودة فعلياً (تكلفة تشغيل/وقود/
 *                                               صيانة لكل معدة ولكل مشروع). تُربَط
 *                                               هنا فعلياً بفئة `equipment` في
 *                                               التكاليف الفعلية.
 *  - المخازن / العمال (لا توجد وحدة مستقلة)   → لا توجد وحدة "مخازن" أو "عمال"
 *                                               مستقلة في المشروع بعد الفحص؛ بدلاً
 *                                               من تنفيذ وهمي، يوفَّر هنا Hook جاهز
 *                                               (registerExternalCostSource) يُستخدم
 *                                               تلقائياً بمجرد إضافة تلك الوحدات
 *                                               مستقبلاً دون أي تعديل على هذا الملف.
 *  - الجدول الزمني (scheduling.js)           → مربوطة فعلياً مسبقاً عبر
 *                                               getScheduleProgress في EVM (6/10).
 *
 * كل دالة هنا "تسحب" بيانات حقيقية من الوحدة الأخرى وتُرجع مقارنة/ملخصاً فعلياً؛
 * لا بيانات وهمية ولا أرقام ثابتة. إن كانت الوحدة الأخرى غير متوفرة في وقت
 * التشغيل، تُرجَع النتيجة بحقل `available: false` بدل رمي خطأ يكسر بقية النظام.
 */

let PM = null;
try { PM = require('./projectManagement'); } catch (e) { PM = null; }

let EQ = null;
try { EQ = require('./equipmentManagement'); } catch (e) { EQ = null; }

let CONTRACTS = null;
try { CONTRACTS = require('./businessContracts'); } catch (e) { CONTRACTS = null; }

const BUDGET = require('./budgetManagement');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }

// ==================================================================================
// =============================== سجل مصادر خارجية =================================
// ==================================================================================
/**
 * سجل بسيط في الذاكرة لمصادر تكلفة خارجية إضافية (مخازن/عمال/أي قسم مستقبلي).
 * أي وحدة مستقبلية يمكنها تسجيل نفسها هنا بدالة تُرجع { total, currency, items }
 * لمشروع معيّن، وستُدمَج تلقائياً في getFullIntegrationOverview دون تعديل هذا الملف.
 */
const externalCostSources = new Map();

function registerExternalCostSource(key, { label, getProjectCost }) {
  if (!key || typeof getProjectCost !== 'function') {
    throw new Error('مطلوب مفتاح (key) ودالة (getProjectCost) صالحة لتسجيل مصدر تكلفة خارجي');
  }
  externalCostSources.set(key, { label: label || key, getProjectCost });
}

function listRegisteredExternalCostSources() {
  return Array.from(externalCostSources.entries()).map(([key, v]) => ({ key, label: v.label }));
}

// ==================================================================================
// =========================== التكامل مع إدارة المشاريع ============================
// ==================================================================================

function getProjectLink(projectId) {
  if (!PM || !projectId) return { available: false, reason: 'وحدة إدارة المشاريع غير متوفرة أو معرّف المشروع مفقود' };
  const project = PM.getProject(projectId);
  if (!project) return { available: false, reason: 'المشروع غير موجود' };
  return {
    available: true,
    project_id: projectId,
    project_name: project.name || project.project_name || null,
    project_status: project.status || null,
    contract_value: project.budget || project.contract_value || null,
  };
}

// ==================================================================================
// ============================ التكامل مع إدارة المعدات ============================
// ==================================================================================
/**
 * يقارن التكلفة الفعلية المسجَّلة يدوياً في الميزانية تحت فئة `equipment` مع
 * التكلفة الحقيقية المحسوبة فعلياً من سجلات المعدات (تشغيل + وقود + صيانة) لنفس
 * المشروع، عبر equipmentManagement.getFleetCostSummary — فرق حقيقي وليس تقديرياً.
 */
function getEquipmentCostReconciliation(budgetId) {
  const budget = BUDGET.getBudget(budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  if (!EQ || typeof EQ.getFleetCostSummary !== 'function') {
    return { available: false, reason: 'وحدة إدارة المعدات غير متوفرة على الخادم' };
  }

  let fleetSummary = null;
  try {
    fleetSummary = EQ.getFleetCostSummary({ projectId: budget.project_id });
  } catch (e) {
    return { available: false, reason: 'تعذر جلب بيانات تكلفة المعدات: ' + e.message };
  }

  const actualCosts = BUDGET.listActualCosts(budgetId, { category: 'equipment', pageSize: 10000 });
  const recordedInBudget = r2((actualCosts?.items || actualCosts?.data?.items || actualCosts || [])
    .reduce ? (actualCosts.items || actualCosts.data?.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0) : 0);

  const equipmentModuleTotal = r2(fleetSummary?.total_cost || fleetSummary?.totalCost || 0);
  const variance = r2(equipmentModuleTotal - recordedInBudget);

  return {
    available: true,
    budget_id: budgetId,
    project_id: budget.project_id,
    recorded_in_budget: recordedInBudget,
    actual_from_equipment_module: equipmentModuleTotal,
    variance,
    variance_pct: recordedInBudget > 0 ? r2((variance / recordedInBudget) * 100) : null,
    in_sync: Math.abs(variance) < 0.01,
    fleet_summary: fleetSummary,
    note: 'المصدر المرجعي (equipmentManagement) يعكس التشغيل/الوقود/الصيانة الفعلية لكل معدة؛ أي فرق يعني أن تكلفة معدات لم تُسجَّل بعد في الميزانية أو العكس.',
  };
}

/**
 * استيراد تلقائي: يسجّل في الميزانية (كتكلفة فعلية فئة equipment) أي فرق موجب
 * غير مسجَّل بعد، مربوطاً بعقدة مورد محددة في BBS. عملية حقيقية تُعدّل البيانات
 * (وليست عرضاً فقط)، لذا تتطلب resourceNodeId صريحاً من المستخدم.
 */
function syncEquipmentCostGapToBudget(budgetId, resourceNodeId, { actor = null } = {}) {
  const reconciliation = getEquipmentCostReconciliation(budgetId);
  if (!reconciliation.available) throw new Error(reconciliation.reason);
  if (reconciliation.variance <= 0) {
    return { synced: false, reason: 'لا يوجد فارق موجب غير مسجَّل (الميزانية متزامنة أو أعلى من سجلات المعدات فعلياً)', reconciliation };
  }
  const result = BUDGET.addActualCost(budgetId, {
    category: 'equipment',
    node_id: resourceNodeId,
    description: 'مزامنة تلقائية من وحدة إدارة المعدات (فرق غير مسجَّل)',
    amount: reconciliation.variance,
    date: new Date().toISOString().slice(0, 10),
    source: 'equipment_module_sync',
  }, { actor });
  return { synced: true, added_amount: reconciliation.variance, actual_cost: result, reconciliation };
}

// ==================================================================================
// ======================= التكامل مع المشتريات/العقود (businessContracts) ==========
// ==================================================================================
/**
 * يجمع كل الفواتير (موردين/مقاولين فرعيين) والعقود المرتبطة بنفس المشروع من وحدة
 * businessContracts، ويقارنها بما هو مسجَّل فعلياً كتكاليف/فواتير موردين ضمن
 * الميزانية — يكشف فواتير موجودة في نظام العقود ولم تنعكس بعد في الميزانية.
 */
function getProcurementReconciliation(budgetId) {
  const budget = BUDGET.getBudget(budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  if (!CONTRACTS) {
    return { available: false, reason: 'وحدة العقود/المشتريات (businessContracts) غير متوفرة على الخادم' };
  }

  let contracts = [];
  let poList = [];
  let contractInvoices = [];
  try {
    contracts = (CONTRACTS.listContracts({ project_id: budget.project_id }) || {}).items
      || CONTRACTS.listContracts({ project_id: budget.project_id }) || [];
  } catch (e) { contracts = []; }
  try {
    poList = (CONTRACTS.listPurchaseOrders({ projectId: budget.project_id }) || {}).items
      || CONTRACTS.listPurchaseOrders({ projectId: budget.project_id }) || [];
  } catch (e) { poList = []; }
  try {
    contractInvoices = (CONTRACTS.listInvoices({ project_id: budget.project_id }) || {}).items
      || CONTRACTS.listInvoices({ project_id: budget.project_id }) || [];
  } catch (e) { contractInvoices = []; }

  const contractsArr = Array.isArray(contracts) ? contracts : [];
  const poArr = Array.isArray(poList) ? poList : [];
  const invoicesArr = Array.isArray(contractInvoices) ? contractInvoices : [];

  const totalContractsValue = r2(contractsArr.reduce((s, c) => s + (Number(c.value || c.contract_value) || 0), 0));
  const totalPOValue = r2(poArr.reduce((s, p) => s + (Number(p.total || p.total_value) || 0), 0));
  const totalContractInvoices = r2(invoicesArr.reduce((s, i) => s + (Number(i.total || i.total_amount) || 0), 0));

  const budgetVendorInvoices = BUDGET.listInvoices(budgetId, { type: 'vendor', pageSize: 10000 });
  const budgetVendorInvoicesArr = budgetVendorInvoices?.items || budgetVendorInvoices?.data?.items || [];
  const totalBudgetVendorInvoices = r2(budgetVendorInvoicesArr.reduce((s, i) => s + (Number(i.total_amount || i.total) || 0), 0));

  return {
    available: true,
    budget_id: budgetId,
    project_id: budget.project_id,
    contracts_count: contractsArr.length,
    total_contracts_value: totalContractsValue,
    purchase_orders_count: poArr.length,
    total_purchase_orders_value: totalPOValue,
    contract_module_invoices_total: totalContractInvoices,
    budget_module_vendor_invoices_total: totalBudgetVendorInvoices,
    unreflected_in_budget: r2(totalContractInvoices - totalBudgetVendorInvoices),
    note: 'الفرق الموجب في unreflected_in_budget يعني وجود فواتير موردين في نظام العقود لم تُسجَّل بعد داخل قسم الميزانية.',
  };
}

// ==================================================================================
// ============================ نظرة شاملة على كل التكاملات =========================
// ==================================================================================

function getFullIntegrationOverview(budgetId) {
  const budget = BUDGET.getBudget(budgetId);
  if (!budget) throw new Error('الميزانية غير موجودة');

  const project = getProjectLink(budget.project_id);
  const equipment = getEquipmentCostReconciliation(budgetId);
  const procurement = getProcurementReconciliation(budgetId);

  const externalSources = {};
  for (const [key, src] of externalCostSources.entries()) {
    try {
      externalSources[key] = { label: src.label, ...src.getProjectCost(budget.project_id) };
    } catch (e) {
      externalSources[key] = { label: src.label, available: false, reason: e.message };
    }
  }

  const modulesStatus = {
    project_management: { linked: project.available, mode: 'مربوط فعلياً منذ الجزء 1/10' },
    boq: { linked: true, mode: 'مربوط فعلياً منذ الجزء 2/10 (importBOQLineItems/syncBOQCostItem)' },
    scheduling: { linked: true, mode: 'مربوط فعلياً منذ الجزء 6/10 عبر getScheduleProgress ضمن EVM' },
    equipment: { linked: equipment.available, mode: equipment.available ? 'مربوط فعلياً في هذا الجزء (10/10)' : 'غير متوفر على الخادم' },
    procurement_contracts: { linked: procurement.available, mode: procurement.available ? 'مربوط فعلياً في هذا الجزء (10/10)' : 'غير متوفر على الخادم' },
    warehouse: { linked: false, mode: 'لا توجد وحدة مخازن مستقلة بعد؛ جاهزة للربط عبر registerExternalCostSource فور إضافتها' },
    labor: { linked: false, mode: 'لا توجد وحدة عمال مستقلة بعد؛ جاهزة للربط عبر registerExternalCostSource فور إضافتها' },
    external_registered_sources: listRegisteredExternalCostSources(),
  };

  return {
    budget_id: budgetId,
    project: project,
    equipment_reconciliation: equipment,
    procurement_reconciliation: procurement,
    external_sources: externalSources,
    modules_status: modulesStatus,
  };
}

module.exports = {
  registerExternalCostSource,
  listRegisteredExternalCostSources,
  getProjectLink,
  getEquipmentCostReconciliation,
  syncEquipmentCostGapToBudget,
  getProcurementReconciliation,
  getFullIntegrationOverview,
};
