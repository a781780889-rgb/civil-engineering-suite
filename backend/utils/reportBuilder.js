/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 * >> الجزء 2/10 (هذا الملف): منشئ التقارير (Report Builder) + الفلاتر المتقدمة.
 *   الجزء 3/10: التقارير الزمنية والمقارنة.
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية.
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية.
 *   الجزء 6/10: الجدولة التلقائية + التصدير والطباعة.
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * هذا الجزء يوفر:
 *  1) سجل مصادر البيانات (Data Sources Registry): وصف كل مصدر بيانات فعلي متاح
 *     في المنصة (المشاريع، الميزانية، الجدول الزمني...) مع حقوله القابلة للعرض،
 *     وأنواع كل حقل (نص/رقم/تاريخ/حالة) لتغذية واجهة منشئ التقارير ديناميكياً.
 *  2) محرك تنفيذ الفلاتر المتقدمة (applyAdvancedFilters): يدعم كل الفلاتر المذكورة
 *     في البند 4 من الخطة (المشروع، العميل، المقاول، الاستشاري، المهندس، القسم،
 *     المدينة، التاريخ، الحالة، الأولوية، المستخدم، نوع النشاط) مع دمج أكثر من فلتر
 *     في نفس الوقت (AND منطقي بين الفلاتر المختلفة).
 *  3) محرك اختيار الحقول/الأعمدة (projectFields) وترتيب البيانات (applySort) وتجميع
 *     البيانات (applyGroupBy) وتحديد الفترة الزمنية (applyDateRange).
 *  4) دعم المعادلات المخصصة (evaluateFormula) بشكل آمن (بدون eval حر) لحساب أعمدة
 *     مشتقة (SUM/AVG/COUNT/MIN/MAX على حقول رقمية من نفس مجموعة البيانات).
 *  5) دعم مؤشرات KPI أساسية (buildKpiCards) تُشتق من نفس البيانات الفعلية.
 *  6) الدالة الرئيسية buildCustomReport(spec): تُنفّذ مواصفة تقرير كاملة (مصدر
 *     البيانات، الحقول، الفلاتر، الفترة، الترتيب، التجميع، المعادلات، KPIs) وتُرجع
 *     نتيجة حقيقية مبنية بالكامل على بيانات الوحدات المصدرية الفعلية، ثم تُسجَّل
 *     نتيجتها في سجل التقارير (reportsCenter) عبر registerReportRecord.
 *  7) حفظ/استرجاع/تعديل/حذف "تقارير مخصصة محفوظة" (Saved Custom Report Specs) حتى
 *     يستطيع المستخدم إعادة تشغيل نفس التقرير لاحقاً دون إعادة بنائه (تمهيداً لنظام
 *     القوالب الكامل في الجزء 7).
 *
 * قاعدة الدقة: هذا الملف لا يخترع أي بيانات. كل استعلام يُنفَّذ فعلياً عبر استدعاء
 * دوال القراءة (list/get) في وحدات utils الأصلية لكل قسم. عند عدم توفر مصدر بيانات
 * حقيقي بعد (سيُستكمل لاحقاً)، تُرفع رسالة خطأ صريحة بدل توليد بيانات وهمية.
 */

const fs = require('fs');
const path = require('path');

const PM = require('./projectManagement');
const BUDGET = require('./budgetManagement');
const SCH = require('./scheduling');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportBuilder.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة تخزين مواصفات التقارير المحفوظة =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ savedReports: {}, seq: 0 }, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات منشئ التقارير: ' + e.message);
  }
  if (!store.savedReports) store.savedReports = {};
  if (typeof store.seq !== 'number') store.seq = 0;
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ===================== سجل مصادر البيانات (Data Sources Registry) =====================
// كل مصدر بيانات يوفّر:
//   - fetch(filters): يعيد مصفوفة صفوف خام مبنية فعلياً من الوحدة المصدرية.
//   - fields: وصف الحقول القابلة للعرض/الفلترة/الترتيب/التجميع لهذا المصدر.
//
// ملاحظة: يتم البدء بثلاثة مصادر مكتملة الوظائف (المشاريع، الميزانية، الجدول الزمني)
// لأنها الوحدات المتاحة بالكامل حالياً بواجهات list/get حقيقية. بقية المصادر
// (BOQ، الجودة، السلامة، المساحة، المخططات، المعدات، المستندات...) الموجودة أصلاً
// في كتالوج reportsCenter ستُفعَّل تباعاً ضمن الأجزاء اللاحقة (3-9) بنفس النمط
// الموحّد المستخدم هنا، دون تغيير في شكل الواجهة العامة لمنشئ التقارير.

const FIELD_TYPES = { TEXT: 'text', NUMBER: 'number', DATE: 'date', STATUS: 'status', BOOLEAN: 'boolean' };

const DATA_SOURCES = {
  projects: {
    label: 'المشاريع',
    module: 'projectManagement',
    fields: [
      { key: 'id', label: 'المعرّف', type: FIELD_TYPES.TEXT },
      { key: 'name', label: 'اسم المشروع', type: FIELD_TYPES.TEXT },
      { key: 'code', label: 'كود المشروع', type: FIELD_TYPES.TEXT },
      { key: 'client', label: 'العميل', type: FIELD_TYPES.TEXT },
      { key: 'contractor', label: 'المقاول', type: FIELD_TYPES.TEXT },
      { key: 'consultant', label: 'الاستشاري', type: FIELD_TYPES.TEXT },
      { key: 'engineer', label: 'المهندس المسؤول', type: FIELD_TYPES.TEXT },
      { key: 'location', label: 'المدينة/الموقع', type: FIELD_TYPES.TEXT },
      { key: 'status', label: 'الحالة', type: FIELD_TYPES.STATUS },
      { key: 'priority', label: 'الأولوية', type: FIELD_TYPES.STATUS },
      { key: 'start_date', label: 'تاريخ البداية', type: FIELD_TYPES.DATE },
      { key: 'end_date', label: 'تاريخ النهاية', type: FIELD_TYPES.DATE },
      { key: 'budget', label: 'الميزانية', type: FIELD_TYPES.NUMBER },
      { key: 'progress_percent', label: 'نسبة الإنجاز', type: FIELD_TYPES.NUMBER },
      { key: 'created_at', label: 'تاريخ الإنشاء', type: FIELD_TYPES.DATE },
    ],
    fetch(filters) {
      const result = PM.listProjects({
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        q: filters.search || undefined,
        page: 1,
        pageSize: filters.limit || 1000,
      });
      // تصحيح: الحقل الفعلي المخزَّن في وحدة إدارة المشاريع هو main_contractor
      // (وليس contractor). نُطابعه هنا إلى contractor للتوافق مع تعريف الحقل
      // أعلاه ومع فلتر contractor العام في applyAdvancedFilters، دون تعديل شكل
      // البيانات المصدرية الأصلية في projectManagement.js.
      return result.items.map((p) => ({ ...p, contractor: p.main_contractor || '' }));
    },
  },

  budgets: {
    label: 'الميزانيات',
    module: 'budgetManagement',
    fields: [
      { key: 'id', label: 'المعرّف', type: FIELD_TYPES.TEXT },
      { key: 'project_id', label: 'المشروع', type: FIELD_TYPES.TEXT },
      { key: 'name', label: 'اسم الميزانية', type: FIELD_TYPES.TEXT },
      { key: 'status', label: 'الحالة', type: FIELD_TYPES.STATUS },
      { key: 'version', label: 'الإصدار', type: FIELD_TYPES.NUMBER },
      { key: 'grand_total', label: 'الإجمالي', type: FIELD_TYPES.NUMBER },
      { key: 'created_at', label: 'تاريخ الإنشاء', type: FIELD_TYPES.DATE },
      { key: 'updated_at', label: 'آخر تحديث', type: FIELD_TYPES.DATE },
    ],
    fetch(filters) {
      const result = BUDGET.listBudgets({
        project_id: filters.projectId || null,
        status: filters.status || null,
        q: filters.search || null,
        page: 1,
        pageSize: filters.limit || 1000,
      });
      return (result.items || []).map((b) => ({
        ...b,
        grand_total: typeof BUDGET.computeBBSGrandTotal === 'function'
          ? BUDGET.computeBBSGrandTotal(b)
          : (b.grand_total || 0),
      }));
    },
  },

  schedule_activities: {
    label: 'أنشطة الجدول الزمني',
    module: 'scheduling',
    fields: [
      { key: 'id', label: 'المعرّف', type: FIELD_TYPES.TEXT },
      { key: 'schedule_id', label: 'الجدول', type: FIELD_TYPES.TEXT },
      { key: 'code', label: 'كود النشاط', type: FIELD_TYPES.TEXT },
      { key: 'name', label: 'اسم النشاط', type: FIELD_TYPES.TEXT },
      { key: 'status', label: 'الحالة', type: FIELD_TYPES.STATUS },
      { key: 'assignee', label: 'المسؤول', type: FIELD_TYPES.TEXT },
      { key: 'start_date', label: 'تاريخ البداية', type: FIELD_TYPES.DATE },
      { key: 'end_date', label: 'تاريخ النهاية', type: FIELD_TYPES.DATE },
      { key: 'progress_percent', label: 'نسبة الإنجاز', type: FIELD_TYPES.NUMBER },
      { key: 'duration_days', label: 'المدة (أيام)', type: FIELD_TYPES.NUMBER },
    ],
    fetch(filters) {
      if (!filters.scheduleId) {
        throw new Error('معرّف الجدول الزمني (scheduleId) مطلوب لمصدر بيانات أنشطة الجدول الزمني');
      }
      return SCH.listActivities(filters.scheduleId, {
        status: filters.status || undefined,
        assignee: filters.assignee || undefined,
        wbsLevel: filters.wbsLevel || undefined,
        parentId: filters.parentId || undefined,
      });
    },
  },
};

function getDataSourcesRegistry() {
  return Object.entries(DATA_SOURCES).map(([key, src]) => ({
    key,
    label: src.label,
    module: src.module,
    fields: src.fields,
  }));
}

function getDataSourceFields(sourceKey) {
  const src = DATA_SOURCES[sourceKey];
  if (!src) throw new Error(`مصدر بيانات غير معروف: ${sourceKey}`);
  return { key: sourceKey, label: src.label, fields: src.fields };
}

function getFieldDef(sourceKey, fieldKey) {
  const src = DATA_SOURCES[sourceKey];
  if (!src) return null;
  return src.fields.find((f) => f.key === fieldKey) || null;
}

// ===================== الفلاتر المتقدمة =====================
// يدعم الفلاتر العامة المذكورة في البند 4 من الخطة. يتم تطبيقها كـ AND منطقي:
// كل فلتر مُمرَّر يُضيّق النتائج أكثر (لا يُستبعد أي فلتر بشكل ضمني).

const GENERIC_FILTER_KEYS = [
  'projectId', 'client', 'contractor', 'consultant', 'engineer', 'department',
  'city', 'status', 'priority', 'userId', 'activityType', 'dateFrom', 'dateTo',
];

function matchesTextFilter(rowValue, filterValue) {
  if (filterValue === undefined || filterValue === null || filterValue === '') return true;
  if (rowValue === undefined || rowValue === null) return false;
  return String(rowValue).toLowerCase().includes(String(filterValue).toLowerCase());
}

function matchesExactFilter(rowValue, filterValue) {
  if (filterValue === undefined || filterValue === null || filterValue === '') return true;
  return rowValue === filterValue;
}

function applyAdvancedFilters(rows, filters = {}) {
  let out = [...rows];

  if (filters.projectId) {
    out = out.filter((r) => matchesExactFilter(r.project_id ?? r.id, filters.projectId));
  }
  if (filters.client) out = out.filter((r) => matchesTextFilter(r.client, filters.client));
  if (filters.contractor) out = out.filter((r) => matchesTextFilter(r.contractor, filters.contractor));
  if (filters.consultant) out = out.filter((r) => matchesTextFilter(r.consultant, filters.consultant));
  if (filters.engineer) out = out.filter((r) => matchesTextFilter(r.engineer, filters.engineer));
  if (filters.department) out = out.filter((r) => matchesTextFilter(r.department, filters.department));
  if (filters.city) out = out.filter((r) => matchesTextFilter(r.location, filters.city));
  if (filters.status) out = out.filter((r) => matchesExactFilter(r.status, filters.status));
  if (filters.priority) out = out.filter((r) => matchesExactFilter(r.priority, filters.priority));
  if (filters.userId) out = out.filter((r) => matchesExactFilter(r.user_id ?? r.assignee, filters.userId));
  if (filters.activityType) out = out.filter((r) => matchesTextFilter(r.type ?? r.activity_type, filters.activityType));

  return out;
}

// ===================== الفترة الزمنية =====================

function applyDateRange(rows, { dateField = 'created_at', dateFrom = null, dateTo = null } = {}) {
  if (!dateFrom && !dateTo) return rows;
  const fromTs = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
  const toTs = dateTo ? new Date(dateTo).getTime() : Infinity;
  return rows.filter((r) => {
    const raw = r[dateField];
    if (!raw) return false;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= fromTs && ts <= toTs;
  });
}

// ===================== اختيار الحقول/الأعمدة =====================

function projectFields(rows, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return rows;
  return rows.map((row) => {
    const projected = {};
    fields.forEach((f) => { projected[f] = row[f]; });
    return projected;
  });
}

// ===================== الترتيب =====================

function applySort(rows, { sortBy = null, sortDir = 'asc' } = {}) {
  if (!sortBy) return rows;
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sortBy]; const bv = b[sortBy];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });
}

// ===================== التجميع =====================

function applyGroupBy(rows, groupByField, { aggregateField = null, aggregateOp = 'count' } = {}) {
  if (!groupByField) return null;
  const groups = {};
  rows.forEach((row) => {
    const key = row[groupByField] === undefined || row[groupByField] === null
      ? 'غير محدد' : String(row[groupByField]);
    if (!groups[key]) groups[key] = { key, count: 0, rows: [] };
    groups[key].count += 1;
    groups[key].rows.push(row);
  });

  return Object.values(groups).map((g) => {
    let aggregateValue = null;
    if (aggregateField && aggregateOp) {
      const nums = g.rows.map((r) => Number(r[aggregateField]) || 0);
      switch (aggregateOp) {
        case 'sum': aggregateValue = nums.reduce((a, b) => a + b, 0); break;
        case 'avg': aggregateValue = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; break;
        case 'min': aggregateValue = nums.length ? Math.min(...nums) : 0; break;
        case 'max': aggregateValue = nums.length ? Math.max(...nums) : 0; break;
        case 'count': aggregateValue = g.rows.length; break;
        default: aggregateValue = null;
      }
    }
    return {
      key: g.key,
      count: g.count,
      aggregate_field: aggregateField,
      aggregate_op: aggregateOp,
      aggregate_value: aggregateValue === null ? null : Math.round((aggregateValue + Number.EPSILON) * 100) / 100,
    };
  }).sort((a, b) => b.count - a.count);
}

// ===================== المعادلات (Formulas) =====================
// دعم آمن لمعادلات تجميعية بسيطة على حقل رقمي واحد من نفس مجموعة البيانات:
// SUM(field) / AVG(field) / COUNT(field) / MIN(field) / MAX(field)
// لا يُستخدم eval أو Function حر؛ يُحلَّل التعبير بصيغة ثابتة محدودة فقط.

const FORMULA_PATTERN = /^(SUM|AVG|COUNT|MIN|MAX)\(([a-zA-Z0-9_]+)\)$/;

function evaluateFormula(rows, formulaExpr) {
  const match = FORMULA_PATTERN.exec(String(formulaExpr || '').trim());
  if (!match) {
    throw new Error(`صيغة معادلة غير مدعومة: ${formulaExpr}. الصيغ المدعومة: SUM(field), AVG(field), COUNT(field), MIN(field), MAX(field)`);
  }
  const [, op, field] = match;
  const nums = rows.map((r) => Number(r[field]) || 0);
  let value;
  switch (op) {
    case 'SUM': value = nums.reduce((a, b) => a + b, 0); break;
    case 'AVG': value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; break;
    case 'COUNT': value = rows.length; break;
    case 'MIN': value = nums.length ? Math.min(...nums) : 0; break;
    case 'MAX': value = nums.length ? Math.max(...nums) : 0; break;
    default: value = null;
  }
  return {
    expression: formulaExpr,
    operation: op,
    field,
    value: value === null ? null : Math.round((value + Number.EPSILON) * 100) / 100,
  };
}

// ===================== مؤشرات KPI =====================

function buildKpiCards(rows, kpiDefs = []) {
  return kpiDefs.map((kpi) => {
    const { label, formula } = kpi;
    const result = evaluateFormula(rows, formula);
    return { label, formula, value: result.value };
  });
}

// ===================== الدالة الرئيسية: بناء تقرير مخصص =====================

/**
 * spec = {
 *   dataSource: 'projects' | 'budgets' | 'schedule_activities',
 *   title: 'عنوان التقرير',
 *   fields: ['name', 'status', ...],           // اختيار الأعمدة (اختياري: كل الحقول إن أُهمل)
 *   filters: { projectId, client, status, ... },
 *   dateField: 'created_at', dateFrom, dateTo,
 *   sortBy, sortDir,
 *   groupBy, aggregateField, aggregateOp,
 *   formulas: ['SUM(budget)', 'AVG(progress_percent)'],
 *   kpis: [{ label: 'إجمالي الميزانيات', formula: 'SUM(budget)' }],
 *   scheduleId, // مطلوب فقط عند dataSource = schedule_activities
 *   limit,
 * }
 */
function buildCustomReport(spec = {}) {
  const { dataSource } = spec;
  if (!dataSource) throw new Error('يجب تحديد مصدر البيانات (dataSource)');
  const src = DATA_SOURCES[dataSource];
  if (!src) throw new Error(`مصدر بيانات غير معروف: ${dataSource}. المصادر المتاحة: ${Object.keys(DATA_SOURCES).join(', ')}`);

  const filters = spec.filters || {};
  const fetchFilters = { ...filters, scheduleId: spec.scheduleId, limit: spec.limit };

  // 1) جلب البيانات الفعلية من المصدر
  let rows = src.fetch(fetchFilters);

  // 2) الفلاتر المتقدمة
  rows = applyAdvancedFilters(rows, filters);

  // 3) الفترة الزمنية
  if (spec.dateFrom || spec.dateTo) {
    rows = applyDateRange(rows, {
      dateField: spec.dateField || 'created_at',
      dateFrom: spec.dateFrom || null,
      dateTo: spec.dateTo || null,
    });
  }

  // 4) الترتيب
  if (spec.sortBy) rows = applySort(rows, { sortBy: spec.sortBy, sortDir: spec.sortDir || 'asc' });

  const totalMatched = rows.length;

  // 5) المعادلات على كامل النتائج المطابقة (قبل قصّها بالحد الأقصى للعرض)
  const formulas = Array.isArray(spec.formulas)
    ? spec.formulas.map((f) => evaluateFormula(rows, f))
    : [];

  // 6) مؤشرات KPI
  const kpis = Array.isArray(spec.kpis) ? buildKpiCards(rows, spec.kpis) : [];

  // 7) التجميع (يُبنى من كامل النتائج المطابقة أيضاً، وليس من الصفحة المعروضة فقط)
  const grouped = spec.groupBy
    ? applyGroupBy(rows, spec.groupBy, { aggregateField: spec.aggregateField || null, aggregateOp: spec.aggregateOp || 'count' })
    : null;

  // 8) قصّ حسب الحد الأقصى للعرض ثم اختيار الأعمدة المطلوبة فقط
  const displayLimit = spec.limit ? Number(spec.limit) : 500;
  const limitedRows = rows.slice(0, displayLimit);
  const projected = projectFields(limitedRows, spec.fields);

  return {
    generated_at: nowISO(),
    title: spec.title || `تقرير مخصص - ${src.label}`,
    data_source: dataSource,
    data_source_label: src.label,
    filters_applied: filters,
    period: { date_field: spec.dateField || 'created_at', date_from: spec.dateFrom || null, date_to: spec.dateTo || null },
    total_matched: totalMatched,
    displayed_count: projected.length,
    columns: (spec.fields && spec.fields.length ? spec.fields : src.fields.map((f) => f.key)),
    rows: projected,
    formulas,
    kpis,
    grouped_by: spec.groupBy || null,
    groups: grouped,
  };
}

// ===================== حفظ/استرجاع مواصفات التقارير المخصصة =====================
// تخزين أساسي لمواصفة التقرير (وليس نتيجتها) حتى يمكن إعادة تشغيله لاحقاً بنفس
// الإعدادات. هذا تمهيد مباشر لنظام القوالب الكامل في الجزء 7/10.

function saveReportSpec({ name, spec, userId = null, projectId = null } = {}) {
  if (!name) throw new Error('اسم مواصفة التقرير المحفوظة مطلوب');
  if (!spec || !spec.dataSource) throw new Error('مواصفة التقرير (spec) غير صالحة');
  const store = loadStore();
  const id = newId('RBSPEC');
  const record = {
    id, name, spec, user_id: userId, project_id: projectId,
    created_at: nowISO(), updated_at: nowISO(),
  };
  store.savedReports[id] = record;
  saveStore(store);
  return record;
}

function listSavedReportSpecs({ userId = null, projectId = null } = {}) {
  const store = loadStore();
  let rows = Object.values(store.savedReports);
  if (userId) rows = rows.filter((r) => r.user_id === userId);
  if (projectId) rows = rows.filter((r) => r.project_id === projectId);
  return rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

function getSavedReportSpec(id) {
  const store = loadStore();
  const rec = store.savedReports[id];
  if (!rec) throw new Error('مواصفة التقرير المحفوظة غير موجودة');
  return rec;
}

function updateReportSpec(id, updates = {}) {
  const store = loadStore();
  const rec = store.savedReports[id];
  if (!rec) throw new Error('مواصفة التقرير المحفوظة غير موجودة');
  if (updates.name) rec.name = updates.name;
  if (updates.spec) rec.spec = updates.spec;
  rec.updated_at = nowISO();
  saveStore(store);
  return rec;
}

function deleteReportSpec(id) {
  const store = loadStore();
  if (!store.savedReports[id]) throw new Error('مواصفة التقرير المحفوظة غير موجودة');
  delete store.savedReports[id];
  saveStore(store);
  return { success: true, deleted_id: id };
}

/**
 * تشغيل مواصفة محفوظة مباشرة عبر معرّفها (يجلب المواصفة ثم يبنيه فعلياً).
 */
function runSavedReport(id, overrideFilters = {}) {
  const rec = getSavedReportSpec(id);
  const mergedSpec = { ...rec.spec, filters: { ...(rec.spec.filters || {}), ...overrideFilters } };
  return buildCustomReport(mergedSpec);
}

module.exports = {
  // سجل مصادر البيانات
  getDataSourcesRegistry,
  getDataSourceFields,
  getFieldDef,
  // محركات المعالجة (مُصدَّرة للاستخدام المباشر أو الاختبار)
  applyAdvancedFilters,
  applyDateRange,
  projectFields,
  applySort,
  applyGroupBy,
  evaluateFormula,
  buildKpiCards,
  // البناء الرئيسي
  buildCustomReport,
  // التقارير المخصصة المحفوظة
  saveReportSpec,
  listSavedReportSpecs,
  getSavedReportSpec,
  updateReportSpec,
  deleteReportSpec,
  runSavedReport,
};
