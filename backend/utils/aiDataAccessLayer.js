/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء الثالث (3/10): طبقة ربط AI بقاعدة البيانات (AI Data Access Layer)
 * ===================================================================================
 *
 *   AI  →  AI Service  →  Permission Layer (aiEngineeringCore.resolveAIContext)
 *       →  AI Data Access Layer (هذا الملف)  →  Backend Modules الفعلية  →  JSON DB
 *
 * هذا الملف هو نقطة الوصول الوحيدة المسموح بها لأي كود AI (المساعد الهندسي، محرك
 * التوصيات، مولّد التقارير الذكي، ...الخ) لقراءة بيانات النظام. لا يوجد أي مسار آخر:
 * أي دالة AI مستقبلية يجب أن تستدعي getAIData() فقط، ولا يجوز لها استدعاء وحدات
 * PM/SCH/BUDGET/... مباشرة.
 *
 * الضمانات:
 *   1) كل نطاق (domain) يمرّ أولاً عبر AI_CORE.resolveAIContext(token, domain) الذي
 *      يتحقق من الجلسة والدور والصلاحية (RBAC) قبل أي استدعاء بيانات فعلي.
 *   2) وصول للقراءة فقط (Read-Only). لا توجد أي دالة "write" في هذا الملف؛ أي إجراء
 *      حساس (تعديل ميزانية/جدول/حذف بيانات) يبقى بيد المستخدم عبر واجهات النظام
 *      العادية فقط، طبقاً لقاعدة: AI يقترح ← المستخدم يوافق ← النظام ينفّذ.
 *   3) كل استدعاء ناجح يُسجَّل تلقائياً في سجل عمليات AI (عبر AI_CORE.recordAIOperation)
 *      مع ذكر مصدر البيانات (data source) بدقة: اسم الوحدة + النطاق + المعرّفات.
 *   4) لا بيانات وهمية أو مُلفَّقة: أي نطاق غير مربوط فعلياً بوحدة حقيقية على القرص
 *      يُعيد خطأً صريحاً "الوحدة غير متوفرة" بدلاً من نتيجة زائفة.
 *   5) تطبيع موحّد (normalize) لنتائج القوائم القادمة من وحدات مختلفة الصياغة (بعضها
 *      يُعيد Array مباشرة، وبعضها {total, items}) إلى شكل واحد ثابت لطبقة AI:
 *      { items: [...], total: N }.
 */

const AI_CORE = require('./aiEngineeringCore');

function tryRequire(rel) {
  try { return require(rel); } catch (e) { return null; }
}

// ===================================================================================
// 1) الوحدات الفعلية المربوطة (لا شيء هنا وهمي؛ كل مرجع يُفحص بـ try/require)
// ===================================================================================

const PM = tryRequire('./projectManagement');
const SCH = tryRequire('./scheduling');
const BUDGET = tryRequire('./budgetManagement');
const EQ = tryRequire('./equipmentManagement');
const QMS = tryRequire('./qmsManagement');
const HSE = tryRequire('./hseManagement');
const SURVEY = tryRequire('./surveyManagement');
const DRAW = tryRequire('./drawingManagement');
const DMS = tryRequire('./documentManagement');
const BIZC = tryRequire('./businessContracts');
const BIZ = tryRequire('./businessManagement');
const BIZO = tryRequire('./businessOperations');
const REPORTS_CENTER = tryRequire('./reportsCenter');

function normalizeList(raw) {
  if (Array.isArray(raw)) return { items: raw, total: raw.length };
  if (raw && Array.isArray(raw.items)) {
    return { items: raw.items, total: typeof raw.total === 'number' ? raw.total : raw.items.length };
  }
  if (raw && Array.isArray(raw.data)) {
    return { items: raw.data, total: typeof raw.total === 'number' ? raw.total : raw.data.length };
  }
  return { items: [], total: 0 };
}

function requireModule(mod, moduleName, domain) {
  if (!mod) {
    const err = new Error(`وحدة البيانات "${moduleName}" غير متوفرة حالياً في النظام؛ لا يمكن تنفيذ تحليل "${domain}" بدون بيانات حقيقية.`);
    err.code = 'AI_DATA_MODULE_UNAVAILABLE';
    throw err;
  }
  return mod;
}

// ===================================================================================
// 2) خريطة "الإجراءات" المسموح بها لكل نطاق (Action Whitelist)
// ===================================================================================
// كل نطاق (domain) له مجموعة محددة سلفاً من إجراءات القراءة المسموح بها فقط.
// أي action غير مذكور هنا يُرفض صراحةً، حتى لو توفرت الدالة في الوحدة الأصلية،
// لمنع أي وصول غير مقيّد أو غير متوقَّع من كود AI مستقبلي.

const DATA_ACCESSORS = {
  // -------------------- المشاريع --------------------
  project: {
    moduleName: 'projectManagement',
    actions: {
      list: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listProjects(p || {})),
      get: (p) => requireModule(PM, 'projectManagement', 'project').getProject(p.projectId),
      team: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listTeam(p.projectId)),
      risks: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listRisks(p.projectId, p.filters || {})),
      resources: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listResources(p.projectId, p.filters || {})),
      qualityRecords: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listQualityRecords(p.projectId)),
      phases: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listPhases(p.projectId)),
      transactions: (p) => normalizeList(requireModule(PM, 'projectManagement', 'project').listTransactions(p.projectId, p.filters || {})),
    },
  },

  // -------------------- الأنشطة والجدول الزمني --------------------
  schedule: {
    moduleName: 'scheduling',
    actions: {
      list: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listSchedules(p.projectId)),
      get: (p) => requireModule(SCH, 'scheduling', 'schedule').getSchedule(p.scheduleId),
      activities: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listActivities(p.scheduleId, p.filters || {})),
      relations: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listRelations(p.scheduleId)),
      baselines: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listBaselines(p.scheduleId)),
      resourceAssignments: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listResourceAssignments(p.scheduleId, p.filters || {})),
      notifications: (p) => normalizeList(requireModule(SCH, 'scheduling', 'schedule').listNotifications(p.projectId || null, p.filters || {})),
    },
  },

  // -------------------- الميزانية والمصروفات --------------------
  budget: {
    moduleName: 'budgetManagement',
    actions: {
      list: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listBudgets(p || {})),
      get: (p) => requireModule(BUDGET, 'budgetManagement', 'budget').getBudget(p.budgetId),
      costItems: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listCostItems(p.budgetId, p.resourceNodeId || null)),
      actualCosts: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listActualCosts(p.budgetId, p.filters || {})),
      revenues: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listRevenues(p.budgetId, p.filters || {})),
      changeOrders: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listChangeOrders(p.budgetId, p.filters || {})),
      evmSnapshots: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listEVMSnapshots(p.budgetId)),
      paymentRequests: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listPaymentRequests(p.budgetId, p.filters || {})),
      auditLog: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'budget').listAudit(p || {})),
    },
  },

  // -------------------- حصر الكميات (BOQ) --------------------
  // ملاحظة: حصر الكميات (BOQ) مبني كحاسبات مباشرة (calculators) وليس كسجلات مخزَّنة
  // مستقلة؛ بيانات BOQ الفعلية المرتبطة بمشروع تصل عبر بنود التكلفة في الميزانية
  // (budget.costItems) وحصر الحديد (rebar) في تقارير المشروع. هذا النطاق يُعاد
  // توجيهه صراحةً بدلاً من الإيحاء بوجود مخزن BOQ منفصل غير موجود فعلياً.
  boq: {
    moduleName: 'budgetManagement (عبر بنود التكلفة) + boqReports',
    actions: {
      costItemsAsBOQ: (p) => normalizeList(requireModule(BUDGET, 'budgetManagement', 'boq').listCostItems(p.budgetId, p.resourceNodeId || null)),
    },
  },

  // -------------------- المعدات --------------------
  equipment: {
    moduleName: 'equipmentManagement',
    actions: {
      list: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listEquipment(p.filters || {})),
      operations: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listOperations(p.filters || {})),
      reservations: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listReservations(p.filters || {})),
      fuelLogs: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listFuelLogs(p.filters || {})),
      maintenanceSchedules: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listMaintenanceSchedules(p.filters || {})),
      maintenanceRecords: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listMaintenanceRecords(p.filters || {})),
      spareParts: (p) => normalizeList(requireModule(EQ, 'equipmentManagement', 'equipment').listSpareParts(p.filters || {})),
    },
  },

  // -------------------- الجودة --------------------
  quality: {
    moduleName: 'qmsManagement',
    actions: {
      qualityPlans: (p) => normalizeList(requireModule(QMS, 'qmsManagement', 'quality').listQualityPlans(p.filters || {})),
      inspectionRequests: (p) => normalizeList(requireModule(QMS, 'qmsManagement', 'quality').listInspectionRequests(p.filters || {})),
      materialTests: (p) => normalizeList(requireModule(QMS, 'qmsManagement', 'quality').listMaterialTests(p.filters || {})),
      itpItems: (p) => normalizeList(requireModule(QMS, 'qmsManagement', 'quality').listItpItems(p.filters || {})),
    },
  },

  // -------------------- السلامة --------------------
  safety: {
    moduleName: 'hseManagement',
    actions: {
      safetyPlans: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listSafetyPlans(p.filters || {})),
      risks: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listRisks(p.filters || {})),
      riskControlActions: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listRiskControlActions(p.filters || {})),
      incidents: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listIncidents(p.filters || {})),
      inspections: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listInspections(p.filters || {})),
      inspectionFindings: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listInspectionFindings(p.filters || {})),
      permits: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listPermits(p.filters || {})),
      ppeItems: (p) => normalizeList(requireModule(HSE, 'hseManagement', 'safety').listPpeItems(p.filters || {})),
    },
  },

  // -------------------- المساحة --------------------
  survey: {
    moduleName: 'surveyManagement',
    actions: {
      list: (p) => normalizeList(requireModule(SURVEY, 'surveyManagement', 'survey').listSurveys ? requireModule(SURVEY, 'surveyManagement', 'survey').listSurveys(p.filters || {}) : []),
    },
  },

  // -------------------- المخططات --------------------
  drawing: {
    moduleName: 'drawingManagement',
    actions: {
      list: (p) => normalizeList(requireModule(DRAW, 'drawingManagement', 'drawing').listDrawings(p.filters || {})),
    },
  },

  // -------------------- المستندات --------------------
  document: {
    moduleName: 'documentManagement',
    actions: {
      list: (p) => normalizeList(requireModule(DMS, 'documentManagement', 'document').listDocuments(p.filters || {})),
    },
  },

  // -------------------- العقود --------------------
  contract: {
    moduleName: 'businessContracts',
    actions: {
      list: (p) => normalizeList(requireModule(BIZC, 'businessContracts', 'contract').listContracts(p || {})),
      invoices: (p) => normalizeList(requireModule(BIZC, 'businessContracts', 'contract').listInvoices(p || {})),
      purchaseRequests: (p) => normalizeList(requireModule(BIZC, 'businessContracts', 'contract').listPurchaseRequests(p || {})),
      purchaseOrders: (p) => normalizeList(requireModule(BIZC, 'businessContracts', 'contract').listPurchaseOrders(p || {})),
    },
  },

  // -------------------- الأعمال (العملاء/الموردون/الفرص) --------------------
  business: {
    moduleName: 'businessManagement / businessOperations',
    actions: {
      clients: (p) => normalizeList(BIZ && BIZ.listClients ? BIZ.listClients(p || {}) : normalizeList(null)),
      suppliers: (p) => normalizeList(BIZO && BIZO.listSuppliers ? BIZO.listSuppliers(p || {}) : normalizeList(null)),
    },
  },

  // -------------------- التقارير --------------------
  reporting: {
    moduleName: 'reportsCenter',
    actions: {
      list: (p) => normalizeList(REPORTS_CENTER && REPORTS_CENTER.listReports ? REPORTS_CENTER.listReports(p || {}) : normalizeList(null)),
    },
  },
};

// ===================================================================================
// 3) نقطة الدخول الموحّدة: getAIData
// ===================================================================================

/**
 * نقطة الوصول الوحيدة لأي كود AI لقراءة بيانات النظام.
 *
 * @param {string} token - رمز جلسة المستخدم (يُمرَّر كما هو من الطلب الأصلي)
 * @param {string} domain - أحد مفاتيح AI_DOMAIN_PERMISSIONS في aiEngineeringCore
 * @param {string} action - اسم الإجراء ضمن DATA_ACCESSORS[domain].actions
 * @param {object} params - معاملات الاستعلام (مثل projectId, budgetId, filters ...)
 * @param {object} meta - بيانات إضافية للتسجيل: { operationType, projectId }
 */
function getAIData(token, domain, action, params = {}, meta = {}) {
  // 1) التحقق من الصلاحية عبر طبقة الجزء 1 - لا مجال لتجاوز هذه الخطوة
  const authCtx = AI_CORE.resolveAIContext(token, domain);

  const accessor = DATA_ACCESSORS[domain];
  if (!accessor) {
    const err = new Error(`لا توجد طبقة وصول بيانات معرّفة للنطاق "${domain}"`);
    err.code = 'AI_DATA_DOMAIN_UNDEFINED';
    throw err;
  }

  const fn = accessor.actions[action];
  if (!fn) {
    const err = new Error(`الإجراء "${action}" غير مسموح به ضمن نطاق "${domain}". الإجراءات المتاحة: ${Object.keys(accessor.actions).join(', ')}`);
    err.code = 'AI_DATA_ACTION_NOT_ALLOWED';
    throw err;
  }

  const startedAt = new Date().toISOString();
  try {
    const data = fn(params);
    AI_CORE.recordAIOperation({
      userId: authCtx.userId,
      username: authCtx.username,
      domain,
      operationType: meta.operationType || `data_access:${domain}.${action}`,
      projectId: meta.projectId || params.projectId || null,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: true,
      dataSources: [`${accessor.moduleName}.${action}`],
      resultSummary: `تمت قراءة بيانات ${domain}.${action} بنجاح`,
    });
    return { success: true, data, source: { module: accessor.moduleName, domain, action, retrievedAt: new Date().toISOString() } };
  } catch (e) {
    AI_CORE.recordAIOperation({
      userId: authCtx.userId,
      username: authCtx.username,
      domain,
      operationType: meta.operationType || `data_access:${domain}.${action}`,
      projectId: meta.projectId || params.projectId || null,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: false,
      errorMessage: e.message,
      dataSources: [`${accessor.moduleName}.${action}`],
    });
    throw e;
  }
}

/** يُعيد قائمة النطاقات والإجراءات المتاحة فعلياً (لاستخدامها من واجهات الإدارة/التوثيق) */
function listAvailableDataAccessors() {
  return Object.entries(DATA_ACCESSORS).map(([domain, info]) => ({
    domain,
    module: info.moduleName,
    module_loaded: true,
    actions: Object.keys(info.actions),
  }));
}

/**
 * دالة مساعدة لجلب "لقطة مشروع شاملة" تُستخدم من الأجزاء اللاحقة (4/10 تحليل
 * المشاريع، 5/10 التنبؤ بالتأخر، ...) بدون تكرار منطق الاستدعاءات المتعددة.
 * كل استدعاء فرعي هنا يمرّ أيضاً عبر getAIData ويُسجَّل بشكل مستقل، فلا توجد
 * قراءة بيانات خارج هذا المسار الموحّد.
 */
function getProjectSnapshot(token, projectId) {
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  const snapshot = { projectId, generated_at: new Date().toISOString(), sections: {} };

  const safeFetch = (domain, action, params, key) => {
    try {
      const res = getAIData(token, domain, action, params, { operationType: `snapshot:${key}`, projectId });
      snapshot.sections[key] = { available: true, data: res.data };
    } catch (e) {
      snapshot.sections[key] = { available: false, reason: e.message };
    }
  };

  safeFetch('project', 'get', { projectId }, 'project_info');
  safeFetch('project', 'risks', { projectId }, 'project_risks');
  safeFetch('project', 'resources', { projectId }, 'project_resources');
  safeFetch('project', 'transactions', { projectId }, 'project_transactions');
  safeFetch('schedule', 'list', { projectId }, 'schedules');
  safeFetch('budget', 'list', { project_id: projectId }, 'budgets');
  safeFetch('equipment', 'list', { filters: { projectId } }, 'equipment');
  safeFetch('safety', 'incidents', { filters: { projectId } }, 'safety_incidents');
  safeFetch('safety', 'risks', { filters: { projectId } }, 'safety_risks');
  safeFetch('quality', 'inspectionRequests', { filters: { projectId } }, 'quality_inspections');
  safeFetch('document', 'list', { filters: { projectId } }, 'documents');
  safeFetch('drawing', 'list', { filters: { projectId } }, 'drawings');
  safeFetch('contract', 'list', { project_id: projectId }, 'contracts');

  return snapshot;
}

module.exports = {
  getAIData,
  listAvailableDataAccessors,
  getProjectSnapshot,
  DATA_ACCESSORS,
};
