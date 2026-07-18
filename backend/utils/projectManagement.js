/**
 * القسم الرابع - نظام إدارة المشاريع (Project Management System)
 * ================================================================
 * القلب الرئيسي للنظام: إدارة المشاريع من الإنشاء وحتى الإغلاق.
 * التخزين: ملف JSON على القرص (backend/data/projects.json) - بدون تبعيات خارجية،
 * بنفس نمط مكتبة الأسعار المركزية (priceLibrary.js).
 *
 * يغطي:
 *  - المشاريع (CRUD كامل + لوحة معلومات إحصائية)
 *  - مراحل المشروع (Phases) - PMBOK lifecycle
 *  - المهام (Tasks) رئيسية/فرعية مع تبعيات
 *  - الفريق وأعضاء المشروع (Team)
 *  - الميزانية والمعاملات المالية (مصروفات/إيرادات/دفعات/مستخلصات)
 *  - الموارد (عمال/معدات/مواد) المرتبطة بالمشروع
 *  - الجدول الزمني (Gantt) والمسار الحرج (Critical Path - CPM)
 *  - سجل المخاطر (Risk Register)
 *  - الجودة والسلامة (سجلات مرتبطة بالمشروع)
 *  - المستندات (ميتاداتا + إصدارات)
 *  - الاجتماعات ومحاضرها
 *  - الإشعارات التلقائية
 *  - سجل تدقيق شامل (Audit Log)
 *  - تقارير قابلة للتصدير (PDF/Excel/CSV)
 *  - مساعد تحليلي (تأخير/إنتاجية/تنبؤ بالمخاطر) بدون تبعيات خارجية
 */

const fs = require('fs');
const path = require('path');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'projects.json');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');

function round2(v) { return Math.round((Number(v) || 0 + Number.EPSILON) * 100) / 100; }
function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      projects: {},       // { id: project }
      phases: {},         // { id: phase }
      tasks: {},          // { id: task }
      team: {},           // { id: member }
      transactions: {},   // { id: transaction } - مصروفات/إيرادات/دفعات/مستخلصات
      resources: {},      // { id: resourceAssignment }
      risks: {},          // { id: risk }
      quality: {},        // { id: qualityRecord }
      safety: {},         // { id: safetyRecord }
      documents: {},      // { id: document }
      meetings: {},       // { id: meeting }
      notifications: {},  // { id: notification }
      auditLog: [],       // [{ ts, action, entity, entityId, projectId, details }]
      seq: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات المشاريع: ' + e.message);
  }
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, details });
  // الاحتفاظ بآخر 5000 سجل فقط لتفادي تضخم الملف
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

function pushNotification(store, { projectId, type, message, severity = 'info' }) {
  const id = newId('NOTIF');
  store.notifications[id] = {
    id, projectId, type, message, severity,
    read: false, created_at: nowISO(),
  };
  return store.notifications[id];
}

// ===================== أدوات مساعدة =====================

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'delayed', 'completed', 'cancelled'];
const PROJECT_PHASES_TEMPLATE = [
  'study', 'design', 'approval', 'execution', 'finishing',
  'testing', 'initial_handover', 'final_handover', 'maintenance', 'closure',
];
const PHASE_LABELS_AR = {
  study: 'الدراسة', design: 'التصميم', approval: 'الاعتماد', execution: 'التنفيذ',
  finishing: 'التشطيبات', testing: 'الاختبارات', initial_handover: 'التسليم الابتدائي',
  final_handover: 'التسليم النهائي', maintenance: 'الصيانة', closure: 'الإغلاق',
};
const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'delayed', 'blocked', 'cancelled'];
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const TRANSACTION_TYPES = ['expense', 'revenue', 'payment', 'invoice', 'purchase_order', 'contract_value'];

function daysBetween(d1, d2) {
  const a = new Date(d1); const b = new Date(d2);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function validateProjectInput(body) {
  if (!body.name || !String(body.name).trim()) throw new Error('اسم المشروع مطلوب');
  if (body.status && !PROJECT_STATUSES.includes(body.status)) {
    throw new Error(`حالة المشروع غير صحيحة. القيم المسموحة: ${PROJECT_STATUSES.join(', ')}`);
  }
  if (body.start_date && body.end_date && new Date(body.end_date) < new Date(body.start_date)) {
    throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
  }
}

// ===================== المشاريع (CRUD) =====================

function createProject(body) {
  validateProjectInput(body);
  const store = loadStore();
  const id = newId('PRJ');
  store.seq = (store.seq || 0) + 1;
  const project = {
    id,
    code: body.code || `PRJ-${String(store.seq).padStart(4, '0')}`,
    name: body.name,
    type: body.type || '',
    description: body.description || '',
    owner: body.owner || '',
    main_contractor: body.main_contractor || '',
    sub_contractor: body.sub_contractor || '',
    consultant: body.consultant || '',
    project_manager: body.project_manager || '',
    responsible_engineer: body.responsible_engineer || '',
    client: body.client || '',
    location: body.location || '',
    coordinates: body.coordinates || null, // { lat, lng }
    city: body.city || '',
    country: body.country || '',
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    duration_days: body.start_date && body.end_date ? daysBetween(body.start_date, body.end_date) : (body.duration_days || null),
    contract_value: Number(body.contract_value) || 0,
    budget: Number(body.budget) || 0,
    target_profit_percent: Number(body.target_profit_percent) || 0,
    currency: body.currency || 'SAR',
    status: body.status || 'planning',
    priority: body.priority || 'normal', // low | normal | high | urgent
    logo_url: body.logo_url || null,
    images: Array.isArray(body.images) ? body.images : [],
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    progress_percent: 0,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.projects[id] = project;

  // إنشاء مراحل PMBOK الافتراضية تلقائياً
  for (const key of PROJECT_PHASES_TEMPLATE) {
    const phaseId = newId('PHS');
    store.phases[phaseId] = {
      id: phaseId,
      project_id: id,
      key,
      name: PHASE_LABELS_AR[key],
      progress_percent: 0,
      start_date: null,
      end_date: null,
      responsible: '',
      status: 'not_started',
      notes: '',
      documents: [],
      images: [],
      order: PROJECT_PHASES_TEMPLATE.indexOf(key),
      created_at: nowISO(),
      updated_at: nowISO(),
    };
  }

  audit(store, { action: 'create', entity: 'project', entityId: id, projectId: id, details: { name: project.name } });
  pushNotification(store, { projectId: id, type: 'project_created', message: `تم إنشاء مشروع جديد: ${project.name}`, severity: 'info' });
  saveStore(store);
  return project;
}

function getProject(id, { includeRelations = true } = {}) {
  const store = loadStore();
  const project = store.projects[id];
  if (!project) throw new Error('المشروع غير موجود');
  if (!includeRelations) return project;
  return {
    ...project,
    phases: Object.values(store.phases).filter(p => p.project_id === id).sort((a, b) => a.order - b.order),
    tasks: Object.values(store.tasks).filter(t => t.project_id === id),
    team: Object.values(store.team).filter(m => m.project_id === id),
    risks: Object.values(store.risks).filter(r => r.project_id === id),
    financial_summary: computeFinancialSummary(store, id),
  };
}

function listProjects({ status, priority, q, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  let items = Object.values(store.projects);
  if (status) items = items.filter(p => p.status === status);
  if (priority) items = items.filter(p => p.priority === priority);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter(p =>
      p.name.toLowerCase().includes(needle) ||
      (p.code || '').toLowerCase().includes(needle) ||
      (p.client || '').toLowerCase().includes(needle) ||
      (p.location || '').toLowerCase().includes(needle)
    );
  }
  items.sort((a, b) => {
    const av = a[sortBy]; const bv = b[sortBy];
    if (av === bv) return 0;
    const dir = sortDir === 'asc' ? 1 : -1;
    return av > bv ? dir : -dir;
  });
  const total = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: paged.map(p => ({ ...p, progress_percent: computeProjectProgress(store, p.id) })),
  };
}

function updateProject(id, body) {
  const store = loadStore();
  const project = store.projects[id];
  if (!project) throw new Error('المشروع غير موجود');
  if (body.status && !PROJECT_STATUSES.includes(body.status)) {
    throw new Error(`حالة المشروع غير صحيحة. القيم المسموحة: ${PROJECT_STATUSES.join(', ')}`);
  }
  const before = { ...project };
  Object.assign(project, body, { id, updated_at: nowISO() });
  if (project.start_date && project.end_date) {
    project.duration_days = daysBetween(project.start_date, project.end_date);
  }
  store.projects[id] = project;

  if (body.status && body.status !== before.status) {
    pushNotification(store, {
      projectId: id, type: 'status_change', severity: 'info',
      message: `تم تحديث حالة المشروع "${project.name}" إلى: ${project.status}`,
    });
  }
  audit(store, { action: 'update', entity: 'project', entityId: id, projectId: id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return project;
}

function deleteProject(id) {
  const store = loadStore();
  if (!store.projects[id]) throw new Error('المشروع غير موجود');
  const name = store.projects[id].name;
  delete store.projects[id];
  // حذف تسلسلي لكل الكيانات المرتبطة
  for (const key of ['phases', 'tasks', 'team', 'transactions', 'resources', 'risks', 'quality', 'safety', 'documents', 'meetings']) {
    for (const [entId, ent] of Object.entries(store[key])) {
      if (ent.project_id === id) delete store[key][entId];
    }
  }
  audit(store, { action: 'delete', entity: 'project', entityId: id, projectId: id, details: { name } });
  saveStore(store);
  return { deleted: true, id };
}

// ===================== لوحة المعلومات الرئيسية =====================

function computeProjectProgress(store, projectId) {
  const phases = Object.values(store.phases).filter(p => p.project_id === projectId);
  if (phases.length === 0) return 0;
  const sum = phases.reduce((acc, p) => acc + (Number(p.progress_percent) || 0), 0);
  return r2(sum / phases.length);
}

function computeFinancialSummary(store, projectId) {
  const project = store.projects[projectId];
  const txns = Object.values(store.transactions).filter(t => t.project_id === projectId);
  const expenses = txns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const revenue = txns.filter(t => t.type === 'revenue').reduce((s, t) => s + Number(t.amount), 0);
  const payments = txns.filter(t => t.type === 'payment').reduce((s, t) => s + Number(t.amount), 0);
  const invoices = txns.filter(t => t.type === 'invoice').reduce((s, t) => s + Number(t.amount), 0);
  const budget = project ? Number(project.budget) || 0 : 0;
  return {
    budget: r2(budget),
    total_expenses: r2(expenses),
    total_revenue: r2(revenue),
    total_payments: r2(payments),
    total_invoices: r2(invoices),
    remaining_budget: r2(budget - expenses),
    budget_utilization_percent: budget > 0 ? r2((expenses / budget) * 100) : 0,
    net_cash_flow: r2(revenue + payments - expenses),
    over_budget: expenses > budget && budget > 0,
  };
}

function getDashboard() {
  const store = loadStore();
  const projects = Object.values(store.projects);
  const now = new Date();

  const byStatus = { planning: 0, active: 0, on_hold: 0, delayed: 0, completed: 0, cancelled: 0 };
  let totalBudget = 0, totalExpenses = 0, totalRevenue = 0;
  let delayedCount = 0;

  for (const p of projects) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    totalBudget += Number(p.budget) || 0;
    const fs_ = computeFinancialSummary(store, p.id);
    totalExpenses += fs_.total_expenses;
    totalRevenue += fs_.total_revenue;
    if (p.end_date && new Date(p.end_date) < now && p.status !== 'completed' && p.status !== 'cancelled') {
      delayedCount += 1;
    }
  }

  const allTasks = Object.values(store.tasks);
  const openTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length;
  const doneTasks = allTasks.filter(t => t.status === 'completed').length;

  const overallProgress = projects.length > 0
    ? r2(projects.reduce((acc, p) => acc + computeProjectProgress(store, p.id), 0) / projects.length)
    : 0;

  const activeUsersSet = new Set(Object.values(store.team).map(m => m.user_ref || m.name));

  const recentActivities = (store.auditLog || []).slice(-15).reverse();
  const unreadNotifications = Object.values(store.notifications).filter(n => !n.read).length;

  const statusChart = Object.entries(byStatus).map(([status, count]) => ({ status, count }));
  const progressChart = projects.map(p => ({ project: p.name, progress: computeProjectProgress(store, p.id) }));
  const financeChart = projects.map(p => {
    const fs_ = computeFinancialSummary(store, p.id);
    return { project: p.name, expenses: fs_.total_expenses, revenue: fs_.total_revenue };
  });

  return {
    total_projects: projects.length,
    active_projects: byStatus.active,
    completed_projects: byStatus.completed,
    on_hold_projects: byStatus.on_hold,
    delayed_projects: delayedCount,
    planning_projects: byStatus.planning,
    total_budget: r2(totalBudget),
    total_expenses: r2(totalExpenses),
    total_revenue: r2(totalRevenue),
    overall_progress_percent: overallProgress,
    open_tasks: openTasks,
    completed_tasks: doneTasks,
    notifications_count: unreadNotifications,
    active_team_members: activeUsersSet.size,
    recent_activities: recentActivities,
    status_chart: statusChart,
    progress_chart: progressChart,
    finance_chart: financeChart,
  };
}

// ===================== المراحل =====================

function listPhases(projectId) {
  const store = loadStore();
  if (!store.projects[projectId]) throw new Error('المشروع غير موجود');
  return Object.values(store.phases).filter(p => p.project_id === projectId).sort((a, b) => a.order - b.order);
}

function updatePhase(phaseId, body) {
  const store = loadStore();
  const phase = store.phases[phaseId];
  if (!phase) throw new Error('المرحلة غير موجودة');
  Object.assign(phase, body, { id: phaseId, updated_at: nowISO() });
  store.phases[phaseId] = phase;

  // تحديث نسبة إنجاز المشروع تلقائياً
  const project = store.projects[phase.project_id];
  if (project) {
    project.progress_percent = computeProjectProgress(store, project.id);
    project.updated_at = nowISO();
  }
  audit(store, { action: 'update', entity: 'phase', entityId: phaseId, projectId: phase.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return phase;
}

// ===================== المهام =====================

function createTask(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.title) throw new Error('عنوان المهمة مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  if (body.status && !TASK_STATUSES.includes(body.status)) {
    throw new Error(`حالة المهمة غير صحيحة. القيم المسموحة: ${TASK_STATUSES.join(', ')}`);
  }
  const id = newId('TSK');
  const task = {
    id,
    project_id: body.project_id,
    phase_id: body.phase_id || null,
    parent_task_id: body.parent_task_id || null,
    title: body.title,
    description: body.description || '',
    assignee: body.assignee || '',
    priority: body.priority || 'normal',
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    duration_days: body.start_date && body.end_date ? daysBetween(body.start_date, body.end_date) : (body.duration_days || null),
    status: body.status || 'not_started',
    progress_percent: Number(body.progress_percent) || 0,
    dependencies: Array.isArray(body.dependencies) ? body.dependencies : [], // [taskId, ...]
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    comments: [],
    is_recurring: !!body.is_recurring,
    recurrence_rule: body.recurrence_rule || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.tasks[id] = task;
  audit(store, { action: 'create', entity: 'task', entityId: id, projectId: body.project_id, details: { title: task.title } });
  saveStore(store);
  return task;
}

function listTasks(projectId, { status, assignee, phaseId } = {}) {
  const store = loadStore();
  let items = Object.values(store.tasks).filter(t => t.project_id === projectId);
  if (status) items = items.filter(t => t.status === status);
  if (assignee) items = items.filter(t => t.assignee === assignee);
  if (phaseId) items = items.filter(t => t.phase_id === phaseId);
  return items;
}

function updateTask(taskId, body) {
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) throw new Error('المهمة غير موجودة');
  if (body.status && !TASK_STATUSES.includes(body.status)) {
    throw new Error(`حالة المهمة غير صحيحة. القيم المسموحة: ${TASK_STATUSES.join(', ')}`);
  }
  const wasCompleted = task.status === 'completed';
  Object.assign(task, body, { id: taskId, updated_at: nowISO() });
  if (task.start_date && task.end_date) task.duration_days = daysBetween(task.start_date, task.end_date);
  store.tasks[taskId] = task;

  if (task.status === 'delayed' && task.status !== undefined) {
    pushNotification(store, {
      projectId: task.project_id, type: 'task_delayed', severity: 'warning',
      message: `المهمة "${task.title}" متأخرة`,
    });
  }
  if (!wasCompleted && task.status === 'completed') {
    pushNotification(store, {
      projectId: task.project_id, type: 'task_completed', severity: 'success',
      message: `تم إنجاز المهمة: ${task.title}`,
    });
  }
  audit(store, { action: 'update', entity: 'task', entityId: taskId, projectId: task.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return task;
}

function deleteTask(taskId) {
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) throw new Error('المهمة غير موجودة');
  delete store.tasks[taskId];
  audit(store, { action: 'delete', entity: 'task', entityId: taskId, projectId: task.project_id, details: { title: task.title } });
  saveStore(store);
  return { deleted: true, id: taskId };
}

function addTaskComment(taskId, { author, text }) {
  if (!text) throw new Error('نص التعليق مطلوب');
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) throw new Error('المهمة غير موجودة');
  const comment = { id: newId('CMT'), author: author || 'مستخدم', text, created_at: nowISO() };
  task.comments = task.comments || [];
  task.comments.push(comment);
  task.updated_at = nowISO();
  saveStore(store);
  return comment;
}

// ===================== الجدول الزمني (Gantt + المسار الحرج) =====================

/**
 * حساب المسار الحرج (Critical Path Method - CPM) اعتماداً على مهام المشروع وتبعياتها.
 * يفترض أن كل مهمة تملك duration_days وقائمة dependencies (معرّفات مهام سابقة).
 */
function computeCriticalPath(projectId) {
  const store = loadStore();
  const tasks = Object.values(store.tasks).filter(t => t.project_id === projectId);
  if (tasks.length === 0) return { tasks: [], critical_path: [], project_duration_days: 0 };

  const byId = {};
  for (const t of tasks) byId[t.id] = { ...t, duration: Number(t.duration_days) || 1, es: 0, ef: 0, ls: 0, lf: 0 };

  // ترتيب طوبولوجي بسيط لتفادي الحلقات وضمان معالجة التبعيات أولاً
  const visited = new Set();
  const order = [];
  function visit(id, stack = new Set()) {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // حلقة - تجاهل لتفادي التعليق
    stack.add(id);
    const node = byId[id];
    if (node) {
      for (const dep of node.dependencies || []) {
        if (byId[dep]) visit(dep, stack);
      }
    }
    stack.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of Object.keys(byId)) visit(id);

  // Forward pass: أقرب بداية/نهاية (ES/EF)
  for (const id of order) {
    const node = byId[id];
    const deps = (node.dependencies || []).filter(d => byId[d]);
    node.es = deps.length > 0 ? Math.max(...deps.map(d => byId[d].ef)) : 0;
    node.ef = node.es + node.duration;
  }

  const projectDuration = order.length > 0 ? Math.max(...order.map(id => byId[id].ef)) : 0;

  // Backward pass: أبعد بداية/نهاية (LS/LF)
  for (const id of [...order].reverse()) {
    const node = byId[id];
    const successors = order.filter(oid => (byId[oid].dependencies || []).includes(id));
    node.lf = successors.length > 0 ? Math.min(...successors.map(sid => byId[sid].ls)) : projectDuration;
    node.ls = node.lf - node.duration;
  }

  const result = order.map(id => {
    const n = byId[id];
    const slack = r2(n.ls - n.es);
    return {
      id: n.id, title: n.title, duration_days: n.duration,
      es: r2(n.es), ef: r2(n.ef), ls: r2(n.ls), lf: r2(n.lf),
      slack, is_critical: slack <= 0.001,
      dependencies: n.dependencies || [], status: n.status, progress_percent: n.progress_percent,
    };
  });

  return {
    tasks: result,
    critical_path: result.filter(t => t.is_critical).map(t => t.id),
    project_duration_days: r2(projectDuration),
  };
}

function compareScheduleVsActual(projectId) {
  const store = loadStore();
  const tasks = Object.values(store.tasks).filter(t => t.project_id === projectId);
  const now = new Date();
  const rows = tasks.map(t => {
    const plannedEnd = t.end_date ? new Date(t.end_date) : null;
    const isLate = plannedEnd && plannedEnd < now && t.status !== 'completed';
    const delayDays = isLate ? daysBetween(plannedEnd, now) : 0;
    return {
      task_id: t.id, title: t.title,
      planned_start: t.start_date, planned_end: t.end_date,
      status: t.status, progress_percent: t.progress_percent,
      is_late: !!isLate, delay_days: delayDays,
    };
  });
  const delayedTasks = rows.filter(r => r.is_late);
  return {
    tasks: rows,
    delayed_tasks_count: delayedTasks.length,
    average_delay_days: delayedTasks.length > 0
      ? r2(delayedTasks.reduce((s, r) => s + r.delay_days, 0) / delayedTasks.length) : 0,
  };
}

// ===================== الفريق =====================

function addTeamMember(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.name) throw new Error('اسم العضو مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('TEAM');
  const member = {
    id,
    project_id: body.project_id,
    name: body.name,
    role: body.role || '', // project_manager | engineer | supervisor | technician | worker | contractor | supplier | consultant
    permissions: body.permissions || 'member', // owner | admin | member | viewer
    email: body.email || '',
    phone: body.phone || '',
    hourly_rate: Number(body.hourly_rate) || 0,
    hours_worked: Number(body.hours_worked) || 0,
    attendance_days: Number(body.attendance_days) || 0,
    performance_score: body.performance_score != null ? Number(body.performance_score) : null,
    user_ref: body.user_ref || body.name,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.team[id] = member;
  audit(store, { action: 'create', entity: 'team_member', entityId: id, projectId: body.project_id, details: { name: member.name } });
  saveStore(store);
  return member;
}

function listTeam(projectId) {
  const store = loadStore();
  return Object.values(store.team).filter(m => m.project_id === projectId);
}

function updateTeamMember(memberId, body) {
  const store = loadStore();
  const member = store.team[memberId];
  if (!member) throw new Error('العضو غير موجود');
  Object.assign(member, body, { id: memberId, updated_at: nowISO() });
  store.team[memberId] = member;
  audit(store, { action: 'update', entity: 'team_member', entityId: memberId, projectId: member.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return member;
}

function removeTeamMember(memberId) {
  const store = loadStore();
  const member = store.team[memberId];
  if (!member) throw new Error('العضو غير موجود');
  delete store.team[memberId];
  audit(store, { action: 'delete', entity: 'team_member', entityId: memberId, projectId: member.project_id, details: { name: member.name } });
  saveStore(store);
  return { deleted: true, id: memberId };
}

// ===================== الميزانية والمعاملات المالية =====================

function addTransaction(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!TRANSACTION_TYPES.includes(body.type)) {
    throw new Error(`نوع المعاملة غير صحيح. القيم المسموحة: ${TRANSACTION_TYPES.join(', ')}`);
  }
  if (body.amount === undefined || body.amount === null || isNaN(Number(body.amount))) {
    throw new Error('المبلغ مطلوب ويجب أن يكون رقماً');
  }
  const store = loadStore();
  const project = store.projects[body.project_id];
  if (!project) throw new Error('المشروع غير موجود');
  const id = newId('TXN');
  const txn = {
    id,
    project_id: body.project_id,
    type: body.type,
    category: body.category || '',
    description: body.description || '',
    amount: r2(body.amount),
    date: body.date || nowISO().slice(0, 10),
    reference: body.reference || '',
    created_at: nowISO(),
  };
  store.transactions[id] = txn;

  // تنبيه تلقائي عند تجاوز الميزانية
  const fs_ = computeFinancialSummary({ ...store, transactions: { ...store.transactions, [id]: txn } }, body.project_id);
  if (fs_.over_budget) {
    pushNotification(store, {
      projectId: body.project_id, type: 'budget_exceeded', severity: 'danger',
      message: `تحذير: تم تجاوز ميزانية المشروع "${project.name}"`,
    });
  }
  audit(store, { action: 'create', entity: 'transaction', entityId: id, projectId: body.project_id, details: { type: txn.type, amount: txn.amount } });
  saveStore(store);
  return txn;
}

function listTransactions(projectId, { type } = {}) {
  const store = loadStore();
  let items = Object.values(store.transactions).filter(t => t.project_id === projectId);
  if (type) items = items.filter(t => t.type === type);
  return items;
}

function deleteTransaction(txnId) {
  const store = loadStore();
  const txn = store.transactions[txnId];
  if (!txn) throw new Error('المعاملة غير موجودة');
  delete store.transactions[txnId];
  audit(store, { action: 'delete', entity: 'transaction', entityId: txnId, projectId: txn.project_id, details: {} });
  saveStore(store);
  return { deleted: true, id: txnId };
}

function getFinancialSummary(projectId) {
  const store = loadStore();
  if (!store.projects[projectId]) throw new Error('المشروع غير موجود');
  return computeFinancialSummary(store, projectId);
}

// ===================== الموارد (عمال/معدات/مواد) =====================

function assignResource(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.resource_type) throw new Error('نوع المورد مطلوب (worker | equipment | material | vehicle | warehouse | tool)');
  if (!body.name) throw new Error('اسم المورد مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('RES');
  const resource = {
    id,
    project_id: body.project_id,
    resource_type: body.resource_type,
    name: body.name,
    status: body.status || 'active', // active | idle | maintenance | returned
    operating_hours: Number(body.operating_hours) || 0,
    cost: Number(body.cost) || 0,
    maintenance_notes: body.maintenance_notes || '',
    notes: body.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.resources[id] = resource;
  audit(store, { action: 'create', entity: 'resource', entityId: id, projectId: body.project_id, details: { name: resource.name } });
  saveStore(store);
  return resource;
}

function listResources(projectId, { resourceType } = {}) {
  const store = loadStore();
  let items = Object.values(store.resources).filter(r => r.project_id === projectId);
  if (resourceType) items = items.filter(r => r.resource_type === resourceType);
  return items;
}

function updateResource(resourceId, body) {
  const store = loadStore();
  const resource = store.resources[resourceId];
  if (!resource) throw new Error('المورد غير موجود');
  Object.assign(resource, body, { id: resourceId, updated_at: nowISO() });
  store.resources[resourceId] = resource;
  audit(store, { action: 'update', entity: 'resource', entityId: resourceId, projectId: resource.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return resource;
}

// ===================== المخاطر =====================

function addRisk(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.description) throw new Error('وصف الخطر مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const probability = Number(body.probability) || 1; // 1-5
  const impact = Number(body.impact) || 1; // 1-5
  const score = probability * impact;
  let level = 'low';
  if (score >= 15) level = 'critical';
  else if (score >= 9) level = 'high';
  else if (score >= 4) level = 'medium';

  const id = newId('RISK');
  const risk = {
    id,
    project_id: body.project_id,
    description: body.description,
    cause: body.cause || '',
    probability,
    impact,
    score,
    level: body.level && RISK_LEVELS.includes(body.level) ? body.level : level,
    responsible: body.responsible || '',
    mitigation_plan: body.mitigation_plan || '',
    status: body.status || 'open', // open | mitigating | closed
    review_date: body.review_date || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.risks[id] = risk;

  if (risk.level === 'critical' || risk.level === 'high') {
    pushNotification(store, {
      projectId: body.project_id, type: 'high_risk', severity: 'danger',
      message: `تم تسجيل خطر بمستوى ${risk.level === 'critical' ? 'حرج' : 'عالٍ'}: ${risk.description}`,
    });
  }
  audit(store, { action: 'create', entity: 'risk', entityId: id, projectId: body.project_id, details: { level: risk.level } });
  saveStore(store);
  return risk;
}

function listRisks(projectId, { level, status } = {}) {
  const store = loadStore();
  let items = Object.values(store.risks).filter(r => r.project_id === projectId);
  if (level) items = items.filter(r => r.level === level);
  if (status) items = items.filter(r => r.status === status);
  return items;
}

function updateRisk(riskId, body) {
  const store = loadStore();
  const risk = store.risks[riskId];
  if (!risk) throw new Error('الخطر غير موجود');
  Object.assign(risk, body, { id: riskId, updated_at: nowISO() });
  if (body.probability || body.impact) {
    risk.score = Number(risk.probability) * Number(risk.impact);
  }
  store.risks[riskId] = risk;
  audit(store, { action: 'update', entity: 'risk', entityId: riskId, projectId: risk.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return risk;
}

// ===================== الجودة =====================

function addQualityRecord(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.check_type) throw new Error('نوع الفحص مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('QC');
  const record = {
    id,
    project_id: body.project_id,
    check_type: body.check_type, // concrete | soil | rebar | welding | waterproofing
    result: body.result || 'pending', // pass | fail | pending
    lab_reference: body.lab_reference || '',
    inspector: body.inspector || '',
    approval_status: body.approval_status || 'pending',
    corrective_action: body.corrective_action || '',
    notes: body.notes || '',
    date: body.date || nowISO().slice(0, 10),
    created_at: nowISO(),
  };
  store.quality[id] = record;
  if (record.result === 'fail') {
    pushNotification(store, {
      projectId: body.project_id, type: 'quality_issue', severity: 'danger',
      message: `فشل فحص جودة (${record.check_type}) - يتطلب إجراء تصحيحي`,
    });
  }
  audit(store, { action: 'create', entity: 'quality', entityId: id, projectId: body.project_id, details: { check_type: record.check_type, result: record.result } });
  saveStore(store);
  return record;
}

function listQualityRecords(projectId) {
  const store = loadStore();
  return Object.values(store.quality).filter(q => q.project_id === projectId);
}

// ===================== السلامة =====================

function addSafetyRecord(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.record_type) throw new Error('نوع سجل السلامة مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('SAF');
  const record = {
    id,
    project_id: body.project_id,
    record_type: body.record_type, // inspection | incident | injury | ppe | permit | violation
    severity: body.severity || 'low',
    description: body.description || '',
    responsible: body.responsible || '',
    status: body.status || 'open',
    date: body.date || nowISO().slice(0, 10),
    created_at: nowISO(),
  };
  store.safety[id] = record;
  if (record.record_type === 'incident' || record.record_type === 'violation') {
    pushNotification(store, {
      projectId: body.project_id, type: 'safety_alert', severity: 'danger',
      message: `تنبيه سلامة (${record.record_type}): ${record.description || 'بدون وصف'}`,
    });
  }
  audit(store, { action: 'create', entity: 'safety', entityId: id, projectId: body.project_id, details: { record_type: record.record_type } });
  saveStore(store);
  return record;
}

function listSafetyRecords(projectId) {
  const store = loadStore();
  return Object.values(store.safety).filter(s => s.project_id === projectId);
}

// ===================== المستندات =====================

function addDocument(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.name) throw new Error('اسم المستند مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('DOC');
  const doc = {
    id,
    project_id: body.project_id,
    name: body.name,
    doc_type: body.doc_type || 'other', // contract | drawing | report | photo | video | pdf | dwg | excel | word
    url: body.url || null,
    version: body.version || 1,
    versions_history: [],
    uploaded_by: body.uploaded_by || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.documents[id] = doc;
  pushNotification(store, {
    projectId: body.project_id, type: 'document_added', severity: 'info',
    message: `تم إضافة مستند جديد: ${doc.name}`,
  });
  audit(store, { action: 'create', entity: 'document', entityId: id, projectId: body.project_id, details: { name: doc.name } });
  saveStore(store);
  return doc;
}

function listDocuments(projectId, { docType, q } = {}) {
  const store = loadStore();
  let items = Object.values(store.documents).filter(d => d.project_id === projectId);
  if (docType) items = items.filter(d => d.doc_type === docType);
  if (q) items = items.filter(d => d.name.toLowerCase().includes(String(q).toLowerCase()));
  return items;
}

function updateDocumentVersion(docId, { url, uploaded_by }) {
  const store = loadStore();
  const doc = store.documents[docId];
  if (!doc) throw new Error('المستند غير موجود');
  doc.versions_history.push({ version: doc.version, url: doc.url, archived_at: nowISO() });
  doc.version += 1;
  doc.url = url || doc.url;
  doc.uploaded_by = uploaded_by || doc.uploaded_by;
  doc.updated_at = nowISO();
  saveStore(store);
  return doc;
}

// ===================== الاجتماعات =====================

function createMeeting(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.title) throw new Error('عنوان الاجتماع مطلوب');
  const store = loadStore();
  if (!store.projects[body.project_id]) throw new Error('المشروع غير موجود');
  const id = newId('MTG');
  const meeting = {
    id,
    project_id: body.project_id,
    title: body.title,
    date: body.date || nowISO(),
    attendees: Array.isArray(body.attendees) ? body.attendees : [],
    minutes: body.minutes || '',
    decisions: Array.isArray(body.decisions) ? body.decisions : [],
    action_items: Array.isArray(body.action_items) ? body.action_items : [], // [{ text, assignee, due_date }]
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    recording_url: body.recording_url || null,
    created_at: nowISO(),
  };
  store.meetings[id] = meeting;

  // إنشاء مهام تلقائياً من بنود العمل (action items) إن طُلب ذلك
  const createdTasks = [];
  if (body.create_tasks_from_action_items) {
    for (const item of meeting.action_items) {
      const taskId = newId('TSK');
      const task = {
        id: taskId,
        project_id: body.project_id,
        phase_id: null,
        parent_task_id: null,
        title: item.text,
        description: `مهمة ناتجة عن اجتماع: ${meeting.title}`,
        assignee: item.assignee || '',
        priority: 'normal',
        start_date: null,
        end_date: item.due_date || null,
        duration_days: null,
        status: 'not_started',
        progress_percent: 0,
        dependencies: [],
        attachments: [],
        comments: [],
        is_recurring: false,
        recurrence_rule: null,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
      store.tasks[taskId] = task;
      createdTasks.push(taskId);
    }
  }

  audit(store, { action: 'create', entity: 'meeting', entityId: id, projectId: body.project_id, details: { title: meeting.title } });
  saveStore(store);
  return { ...meeting, created_task_ids: createdTasks };
}

function listMeetings(projectId) {
  const store = loadStore();
  return Object.values(store.meetings).filter(m => m.project_id === projectId);
}

// ===================== الإشعارات =====================

function listNotifications(projectId, { unreadOnly = false } = {}) {
  const store = loadStore();
  let items = projectId
    ? Object.values(store.notifications).filter(n => n.projectId === projectId)
    : Object.values(store.notifications);
  if (unreadOnly) items = items.filter(n => !n.read);
  return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function markNotificationRead(notificationId) {
  const store = loadStore();
  const notif = store.notifications[notificationId];
  if (!notif) throw new Error('الإشعار غير موجود');
  notif.read = true;
  saveStore(store);
  return notif;
}

// ===================== سجل التدقيق =====================

function getAuditLog(projectId, { limit = 200 } = {}) {
  const store = loadStore();
  let items = store.auditLog || [];
  if (projectId) items = items.filter(a => a.projectId === projectId);
  return items.slice(-limit).reverse();
}

// ===================== التكامل مع بقية الأقسام =====================

function getIntegrationSnapshot(projectId) {
  const store = loadStore();
  const project = store.projects[projectId];
  if (!project) throw new Error('المشروع غير موجود');
  return {
    project_id: projectId,
    financial_summary: computeFinancialSummary(store, projectId),
    resources_count: Object.values(store.resources).filter(r => r.project_id === projectId).length,
    quality_records_count: Object.values(store.quality).filter(q => q.project_id === projectId).length,
    safety_records_count: Object.values(store.safety).filter(s => s.project_id === projectId).length,
    risks_count: Object.values(store.risks).filter(r => r.project_id === projectId).length,
    documents_count: Object.values(store.documents).filter(d => d.project_id === projectId).length,
    // نقاط الربط: يستخدمها القسم الأول (الخرسانة) والثاني (الحديد) والثالث (BOQ) عبر تمرير
    // projectId إلى priceLibrary.getEffectivePrices({ projectId }) لتسعير مخصص للمشروع،
    // ويُستخدم project_id أيضاً كمعرّف موحّد عند حفظ نتائج الحاسبات كمستندات/معاملات هنا.
  };
}

// ===================== التقارير القابلة للتصدير =====================

function buildDailyReport(projectId, date) {
  const store = loadStore();
  const project = store.projects[projectId];
  if (!project) throw new Error('المشروع غير موجود');
  const targetDate = date || nowISO().slice(0, 10);
  const tasks = Object.values(store.tasks).filter(t => t.project_id === projectId);
  const activeToday = tasks.filter(t => t.status === 'in_progress');
  const completedToday = tasks.filter(t => t.status === 'completed' && (t.updated_at || '').slice(0, 10) === targetDate);
  const txns = Object.values(store.transactions).filter(t => t.project_id === projectId && t.date === targetDate);
  return {
    project: project.name, date: targetDate,
    active_tasks: activeToday.map(t => ({ title: t.title, assignee: t.assignee, progress: t.progress_percent })),
    completed_tasks: completedToday.map(t => t.title),
    financial_movements: txns.map(t => ({ type: t.type, amount: t.amount, description: t.description })),
    progress_percent: computeProjectProgress(store, projectId),
  };
}

function buildExecutiveReport(projectId) {
  const store = loadStore();
  const project = store.projects[projectId];
  if (!project) throw new Error('المشروع غير موجود');
  return {
    project: { name: project.name, code: project.code, status: project.status, priority: project.priority },
    progress_percent: computeProjectProgress(store, projectId),
    financial_summary: computeFinancialSummary(store, projectId),
    critical_path: computeCriticalPath(projectId),
    top_risks: Object.values(store.risks).filter(r => r.project_id === projectId)
      .sort((a, b) => b.score - a.score).slice(0, 5),
    schedule_status: compareScheduleVsActual(projectId),
    team_size: Object.values(store.team).filter(m => m.project_id === projectId).length,
  };
}

function exportReportToPDF(reportData, { title, projectName }) {
  const filename = `pm-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = flattenReportForTable(reportData);
  const result = generateBoqTablePDF({
    title: title || 'Project Management Report',
    meta: { projectName: projectName || '-' },
    headers,
    rows,
    outputPath,
    colWidths: [280, 280],
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportReportToExcel(reportData, { title }) {
  const filename = `pm-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = [headers, ...flattenReportForTable(reportData)];
  const buffer = generateXlsx([{ name: title || 'Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToCSV(reportData) {
  const filename = `pm-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = flattenReportForTable(reportData);
  const buffer = generateCsv(headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function flattenReportForTable(obj, prefix = '') {
  const rows = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      rows.push([label, '-']);
    } else if (Array.isArray(value)) {
      rows.push([label, `[${value.length} عنصر]`]);
    } else if (typeof value === 'object') {
      rows.push(...flattenReportForTable(value, label));
    } else {
      rows.push([label, String(value)]);
    }
  }
  return rows;
}

// ===================== مساعد الذكاء الاصطناعي (تحليلي - بدون تبعيات خارجية) =====================

function aiAnalyzeProject(projectId) {
  const store = loadStore();
  const project = store.projects[projectId];
  if (!project) throw new Error('المشروع غير موجود');

  const schedule = compareScheduleVsActual(projectId);
  const finance = computeFinancialSummary(store, projectId);
  const risks = Object.values(store.risks).filter(r => r.project_id === projectId);
  const tasks = Object.values(store.tasks).filter(t => t.project_id === projectId);

  const insights = [];

  if (schedule.delayed_tasks_count > 0) {
    insights.push(`يوجد ${schedule.delayed_tasks_count} مهمة متأخرة بمتوسط تأخير ${schedule.average_delay_days} يوم. يُنصح بمراجعة الموارد المخصصة لهذه المهام وإعادة الجدولة.`);
  }
  if (finance.over_budget) {
    insights.push(`تم تجاوز الميزانية المعتمدة بنسبة ${finance.budget_utilization_percent}%. يُنصح بمراجعة بنود المصروفات ذات القيمة الأعلى.`);
  } else if (finance.budget_utilization_percent > 80) {
    insights.push(`تم استهلاك ${finance.budget_utilization_percent}% من الميزانية. يُنصح بمتابعة دقيقة للمصروفات المتبقية.`);
  }
  const criticalRisks = risks.filter(r => r.level === 'critical' || r.level === 'high');
  if (criticalRisks.length > 0) {
    insights.push(`يوجد ${criticalRisks.length} خطر بمستوى عالٍ أو حرج يتطلب خطط معالجة فورية.`);
  }
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  if (blockedTasks.length > 0) {
    insights.push(`يوجد ${blockedTasks.length} مهمة معطّلة (blocked) قد تؤثر على المسار الحرج للمشروع.`);
  }
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const productivity = tasks.length > 0 ? r2((completedTasks / tasks.length) * 100) : 0;
  insights.push(`نسبة إنجاز المهام الحالية: ${productivity}% (${completedTasks} من ${tasks.length}).`);

  if (insights.length === 1) {
    insights.unshift('المشروع يسير ضمن المسار الطبيعي دون مخاطر أو تأخيرات جوهرية حالياً.');
  }

  return {
    project_id: projectId,
    project_name: project.name,
    progress_percent: computeProjectProgress(store, projectId),
    productivity_percent: productivity,
    insights,
    risk_forecast: criticalRisks.length > 2 ? 'مرتفع' : (criticalRisks.length > 0 ? 'متوسط' : 'منخفض'),
  };
}

function aiSummarizeMeeting(meetingId) {
  const store = loadStore();
  const meeting = store.meetings[meetingId];
  if (!meeting) throw new Error('الاجتماع غير موجود');
  const decisionsCount = (meeting.decisions || []).length;
  const actionsCount = (meeting.action_items || []).length;
  const summary = `اجتماع "${meeting.title}" بحضور ${meeting.attendees.length} مشارك. `
    + `تم اتخاذ ${decisionsCount} قرار وتحديد ${actionsCount} بند عمل. `
    + (meeting.minutes ? 'تتوفر محضر مفصّل للاجتماع.' : 'لم يتم تسجيل محضر تفصيلي.');
  return { meeting_id: meetingId, summary, decisions: meeting.decisions, action_items: meeting.action_items };
}

function aiAnswerProjectQuestion(projectId, question) {
  if (!question) throw new Error('يجب إرسال question');
  const store = loadStore();
  const project = store.projects[projectId];
  if (!project) throw new Error('المشروع غير موجود');
  const finance = computeFinancialSummary(store, projectId);
  const progress = computeProjectProgress(store, projectId);
  const q = question.toLowerCase();

  let answer;
  if (q.includes('ميزانية') || q.includes('budget') || q.includes('تكلفة') || q.includes('مصروف')) {
    answer = `ميزانية المشروع "${project.name}" هي ${finance.budget} ${project.currency}، `
      + `تم صرف ${finance.total_expenses} ${project.currency} (${finance.budget_utilization_percent}% من الميزانية)، `
      + `والمتبقي ${finance.remaining_budget} ${project.currency}.`;
  } else if (q.includes('إنجاز') || q.includes('تقدم') || q.includes('progress')) {
    answer = `نسبة الإنجاز الحالية للمشروع "${project.name}" هي ${progress}%.`;
  } else if (q.includes('متأخر') || q.includes('تأخير') || q.includes('delay')) {
    const sched = compareScheduleVsActual(projectId);
    answer = sched.delayed_tasks_count > 0
      ? `يوجد ${sched.delayed_tasks_count} مهمة متأخرة بمتوسط تأخير ${sched.average_delay_days} يوم.`
      : 'لا توجد مهام متأخرة حالياً في هذا المشروع.';
  } else if (q.includes('خطر') || q.includes('مخاطر') || q.includes('risk')) {
    const risks = Object.values(store.risks).filter(r => r.project_id === projectId);
    answer = risks.length > 0
      ? `يوجد ${risks.length} خطر مسجل، منها ${risks.filter(r => r.level === 'critical' || r.level === 'high').length} بمستوى عالٍ أو حرج.`
      : 'لا توجد مخاطر مسجلة لهذا المشروع حالياً.';
  } else {
    answer = `المشروع "${project.name}" (${project.status}) بنسبة إنجاز ${progress}%، `
      + `الميزانية ${finance.budget} ${project.currency} والمصروفات حتى الآن ${finance.total_expenses} ${project.currency}.`;
  }
  return { project_id: projectId, question, answer };
}

module.exports = {
  // ثوابت
  PROJECT_STATUSES, TASK_STATUSES, RISK_LEVELS, TRANSACTION_TYPES, PROJECT_PHASES_TEMPLATE,
  // مشاريع
  createProject, getProject, listProjects, updateProject, deleteProject,
  // لوحة معلومات
  getDashboard,
  // مراحل
  listPhases, updatePhase,
  // مهام
  createTask, listTasks, updateTask, deleteTask, addTaskComment,
  // جدول زمني
  computeCriticalPath, compareScheduleVsActual,
  // فريق
  addTeamMember, listTeam, updateTeamMember, removeTeamMember,
  // ميزانية
  addTransaction, listTransactions, deleteTransaction, getFinancialSummary,
  // موارد
  assignResource, listResources, updateResource,
  // مخاطر
  addRisk, listRisks, updateRisk,
  // جودة
  addQualityRecord, listQualityRecords,
  // سلامة
  addSafetyRecord, listSafetyRecords,
  // مستندات
  addDocument, listDocuments, updateDocumentVersion,
  // اجتماعات
  createMeeting, listMeetings,
  // إشعارات
  listNotifications, markNotificationRead,
  // تدقيق
  getAuditLog,
  // تكامل
  getIntegrationSnapshot,
  // تقارير
  buildDailyReport, buildExecutiveReport, exportReportToPDF, exportReportToExcel, exportReportToCSV,
  // ذكاء اصطناعي
  aiAnalyzeProject, aiSummarizeMeeting, aiAnswerProjectQuestion,
};
