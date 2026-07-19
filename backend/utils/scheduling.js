/**
 * القسم الخامس - نظام الجدول الزمني الاحترافي (Project Scheduling System)
 * =========================================================================
 * نظام جدولة متقدم يعمل بأسلوب مشابه لـ Primavera P6 / MS Project.
 * التخزين: ملف JSON على القرص (backend/data/scheduling.json) بنفس نمط
 * projectManagement.js و priceLibrary.js - بدون تبعيات خارجية.
 *
 * يغطي:
 *  - جداول زمنية متعددة لكل مشروع (إصدارات / Baselines)
 *  - هيكل تقسيم العمل (WBS) هرمي: مرحلة > قسم > نشاط رئيسي > نشاط فرعي > مهمة
 *  - أنشطة تفصيلية (Activities) منفصلة عن مهام إدارة المشاريع (PM Tasks) لكنها قابلة للربط بها
 *  - علاقات بين الأنشطة: FS / SS / FF / SF مع Lag و Lead
 *  - حساب المسار الحرج الحقيقي (CPM): ES/EF/LS/LF/Total Float/Free Float
 *  - إدارة الموارد المرتبطة بالأنشطة (عمال/مهندسين/معدات/مواد/سيارات/موردين) + التكلفة + التعارض
 *  - متابعة التنفيذ الفعلي مقابل المخطط + نسب الانحراف + التوقع النهائي
 *  - إعادة الجدولة مع الاحتفاظ بالإصدارات (Baselines) السابقة للمقارنة
 *  - تقويمات مستقلة (مشروع/عمال/معدات/موردين/نشاط)
 *  - إشعارات تلقائية (تأخر، تعارض، نقص موارد...)
 *  - تقارير احترافية قابلة للتصدير (PDF/Excel/CSV)
 *  - رسوم بيانية: Gantt / Timeline / Resource Histogram / S-Curve / Burndown
 *  - مساعد ذكاء اصطناعي تحليلي (تنبؤ، تحسين جدولة، تحليل مخاطر زمنية)
 *  - صلاحيات + سجل تدقيق (Audit Log)
 *  - تكامل كامل مع بقية أقسام النظام عبر مشاركة نفس معرّف المشروع (project_id)
 */

const fs = require('fs');
const path = require('path');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'scheduling.json');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      schedules: {},      // { id: schedule }  (جدول زمني لكل مشروع، مع دعم إصدارات)
      activities: {},     // { id: activity }   (أنشطة WBS)
      relations: {},      // { id: relation }   (علاقات بين الأنشطة)
      resourceAssignments: {}, // { id: assignment } (ربط مورد بنشاط)
      calendars: {},       // { id: calendar }
      baselines: {},        // { id: baseline }  (لقطة محفوظة لجدول عند إعادة الجدولة)
      notifications: {},   // { id: notification }
      auditLog: [],
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
    throw new Error('تعذر قراءة قاعدة بيانات الجدول الزمني: ' + e.message);
  }
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, details });
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

function pushNotification(store, { projectId, scheduleId = null, type, message, severity = 'info' }) {
  const id = newId('SNOTIF');
  store.notifications[id] = {
    id, projectId, scheduleId, type, message, severity,
    read: false, created_at: nowISO(),
  };
  return store.notifications[id];
}

// ===================== ثوابت =====================

const RELATION_TYPES = ['FS', 'SS', 'FF', 'SF'];
const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'completed', 'delayed', 'on_hold', 'cancelled'];
const ACTIVITY_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const WBS_LEVELS = ['project', 'phase', 'section', 'main_activity', 'sub_activity', 'task', 'subtask'];
const RESOURCE_TYPES = ['worker', 'engineer', 'equipment', 'material', 'vehicle', 'supplier'];
const CALENDAR_TYPES = ['project', 'worker', 'equipment', 'supplier', 'activity'];
const SCHEDULE_ROLES = [
  'system_admin', 'project_manager', 'planning_engineer', 'site_engineer',
  'consultant', 'contractor', 'client_viewer',
];

function daysBetween(d1, d2) {
  const a = new Date(d1); const b = new Date(d2);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// ===================== الجداول الزمنية (Schedules) =====================

function createSchedule(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.name) throw new Error('اسم الجدول الزمني مطلوب');
  if (!body.start_date) throw new Error('تاريخ بداية الجدول مطلوب');
  const store = loadStore();
  store.seq = (store.seq || 0) + 1;
  const id = newId('SCH');
  const schedule = {
    id,
    project_id: body.project_id,
    name: body.name,
    code: body.code || `SCH-${String(store.seq).padStart(4, '0')}`,
    start_date: body.start_date,
    end_date: body.end_date || null,
    duration_days: body.end_date ? daysBetween(body.start_date, body.end_date) : (Number(body.duration_days) || null),
    calendar_id: body.calendar_id || null,
    daily_work_hours: Number(body.daily_work_hours) || 8,
    weekly_work_days: Number(body.weekly_work_days) || 6,
    official_holidays: Array.isArray(body.official_holidays) ? body.official_holidays : [], // ["2026-01-01", ...]
    vacations: Array.isArray(body.vacations) ? body.vacations : [],
    timezone: body.timezone || 'Asia/Riyadh',
    version: 1,
    status: body.status || 'active', // active | archived | superseded
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.schedules[id] = schedule;

  // تقويم افتراضي للمشروع إن لم يُحدد
  if (!schedule.calendar_id) {
    const calId = newId('CAL');
    store.calendars[calId] = {
      id: calId,
      project_id: body.project_id,
      schedule_id: id,
      type: 'project',
      name: 'تقويم المشروع الافتراضي',
      weekly_work_days: schedule.weekly_work_days,
      daily_work_hours: schedule.daily_work_hours,
      holidays: schedule.official_holidays,
      created_at: nowISO(),
    };
    schedule.calendar_id = calId;
  }

  audit(store, { action: 'create', entity: 'schedule', entityId: id, projectId: body.project_id, details: { name: schedule.name } });
  pushNotification(store, { projectId: body.project_id, scheduleId: id, type: 'schedule_created', message: `تم إنشاء جدول زمني جديد: ${schedule.name}`, severity: 'info' });
  saveStore(store);
  return schedule;
}

function listSchedules(projectId) {
  const store = loadStore();
  return Object.values(store.schedules).filter(s => s.project_id === projectId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getSchedule(id) {
  const store = loadStore();
  const schedule = store.schedules[id];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  return schedule;
}

function updateSchedule(id, body) {
  const store = loadStore();
  const schedule = store.schedules[id];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  Object.assign(schedule, body, { id, updated_at: nowISO() });
  if (schedule.start_date && schedule.end_date) schedule.duration_days = daysBetween(schedule.start_date, schedule.end_date);
  store.schedules[id] = schedule;
  audit(store, { action: 'update', entity: 'schedule', entityId: id, projectId: schedule.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  return schedule;
}

function deleteSchedule(id) {
  const store = loadStore();
  const schedule = store.schedules[id];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  // حذف الأنشطة والعلاقات والموارد المرتبطة
  for (const act of Object.values(store.activities).filter(a => a.schedule_id === id)) {
    delete store.activities[act.id];
  }
  for (const rel of Object.values(store.relations).filter(r => r.schedule_id === id)) {
    delete store.relations[rel.id];
  }
  for (const ra of Object.values(store.resourceAssignments).filter(r => r.schedule_id === id)) {
    delete store.resourceAssignments[ra.id];
  }
  delete store.schedules[id];
  audit(store, { action: 'delete', entity: 'schedule', entityId: id, projectId: schedule.project_id, details: { name: schedule.name } });
  saveStore(store);
  return { deleted: true, id };
}

// ===================== هيكل تقسيم العمل + الأنشطة (WBS + Activities) =====================

function validateActivityInput(body) {
  if (!body.schedule_id) throw new Error('معرّف الجدول الزمني مطلوب');
  if (!body.name) throw new Error('اسم النشاط مطلوب');
  if (body.wbs_level && !WBS_LEVELS.includes(body.wbs_level)) {
    throw new Error(`مستوى WBS غير صحيح. القيم المسموحة: ${WBS_LEVELS.join(', ')}`);
  }
  if (body.status && !ACTIVITY_STATUSES.includes(body.status)) {
    throw new Error(`حالة النشاط غير صحيحة. القيم المسموحة: ${ACTIVITY_STATUSES.join(', ')}`);
  }
}

function generateActivityCode(store, scheduleId) {
  const count = Object.values(store.activities).filter(a => a.schedule_id === scheduleId).length;
  return `ACT-${String(count + 1).padStart(4, '0')}`;
}

function createActivity(body) {
  validateActivityInput(body);
  const store = loadStore();
  const schedule = store.schedules[body.schedule_id];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const id = newId('ACT');
  const duration = body.start_date && body.end_date
    ? daysBetween(body.start_date, body.end_date)
    : (Number(body.duration_days) || 1);
  const activity = {
    id,
    schedule_id: body.schedule_id,
    project_id: schedule.project_id,
    code: body.code || generateActivityCode(store, body.schedule_id),
    name: body.name,
    description: body.description || '',
    wbs_level: body.wbs_level || 'task',
    parent_id: body.parent_id || null, // للهيكل الهرمي (WBS)
    order: body.order != null ? Number(body.order) : Object.values(store.activities).filter(a => a.schedule_id === body.schedule_id).length,
    phase: body.phase || '',
    linked_pm_task_id: body.linked_pm_task_id || null, // ربط اختياري بمهمة إدارة المشاريع (القسم الرابع)
    assignee: body.assignee || '',
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    duration_days: duration,
    progress_percent: Number(body.progress_percent) || 0,
    status: body.status || 'not_started',
    priority: body.priority || 'normal',
    location: body.location || '',
    notes: body.notes || '',
    documents: Array.isArray(body.documents) ? body.documents : [],
    images: Array.isArray(body.images) ? body.images : [],
    calendar_id: body.calendar_id || schedule.calendar_id,
    is_milestone: !!body.is_milestone,
    // حقول تُحسب تلقائياً بواسطة خوارزمية CPM (لا تُدخل يدوياً)
    calc: { es: 0, ef: 0, ls: 0, lf: 0, total_float: 0, free_float: 0, is_critical: false },
    // متابعة التنفيذ الفعلي
    actual_start_date: body.actual_start_date || null,
    actual_end_date: body.actual_end_date || null,
    actual_duration_days: null,
    delay_reason: body.delay_reason || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.activities[id] = activity;
  audit(store, { action: 'create', entity: 'activity', entityId: id, projectId: schedule.project_id, details: { name: activity.name, code: activity.code } });
  saveStore(store);
  recalculateSchedule(body.schedule_id, { silent: true, storeOverride: null });
  return getActivity(id);
}

function listActivities(scheduleId, { status, assignee, wbsLevel, parentId } = {}) {
  const store = loadStore();
  if (!store.schedules[scheduleId]) throw new Error('الجدول الزمني غير موجود');
  let items = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  if (status) items = items.filter(a => a.status === status);
  if (assignee) items = items.filter(a => a.assignee === assignee);
  if (wbsLevel) items = items.filter(a => a.wbs_level === wbsLevel);
  if (parentId !== undefined) items = items.filter(a => (a.parent_id || null) === (parentId || null));
  return items.sort((a, b) => a.order - b.order);
}

function getActivity(id) {
  const store = loadStore();
  const activity = store.activities[id];
  if (!activity) throw new Error('النشاط غير موجود');
  const predecessors = Object.values(store.relations).filter(r => r.successor_id === id);
  const successors = Object.values(store.relations).filter(r => r.predecessor_id === id);
  const resources = Object.values(store.resourceAssignments).filter(r => r.activity_id === id);
  return { ...activity, predecessors, successors, resources };
}

function buildWbsTree(scheduleId) {
  const items = listActivities(scheduleId);
  const byId = {};
  items.forEach(a => { byId[a.id] = { ...a, children: [] }; });
  const roots = [];
  for (const a of items) {
    if (a.parent_id && byId[a.parent_id]) byId[a.parent_id].children.push(byId[a.id]);
    else roots.push(byId[a.id]);
  }
  const sortTree = (nodes) => {
    nodes.sort((x, y) => x.order - y.order);
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

function updateActivity(id, body) {
  const store = loadStore();
  const activity = store.activities[id];
  if (!activity) throw new Error('النشاط غير موجود');
  if (body.status && !ACTIVITY_STATUSES.includes(body.status)) {
    throw new Error(`حالة النشاط غير صحيحة. القيم المسموحة: ${ACTIVITY_STATUSES.join(', ')}`);
  }
  if (body.parent_id === id) throw new Error('لا يمكن أن يكون النشاط أباً لنفسه');
  const wasCompleted = activity.status === 'completed';
  Object.assign(activity, body, { id, updated_at: nowISO() });
  if (activity.start_date && activity.end_date) activity.duration_days = daysBetween(activity.start_date, activity.end_date);
  if (activity.actual_start_date && activity.actual_end_date) {
    activity.actual_duration_days = daysBetween(activity.actual_start_date, activity.actual_end_date);
  }
  store.activities[id] = activity;

  if (!wasCompleted && activity.status === 'completed') {
    pushNotification(store, {
      projectId: activity.project_id, scheduleId: activity.schedule_id, type: 'activity_completed', severity: 'success',
      message: `تم إنجاز النشاط: ${activity.name}`,
    });
  }
  if (activity.status === 'delayed') {
    pushNotification(store, {
      projectId: activity.project_id, scheduleId: activity.schedule_id, type: 'activity_delayed', severity: 'warning',
      message: `النشاط "${activity.name}" متأخر`,
    });
  }
  audit(store, { action: 'update', entity: 'activity', entityId: id, projectId: activity.project_id, details: { changed: Object.keys(body) } });
  saveStore(store);
  recalculateSchedule(activity.schedule_id, { silent: true });
  return getActivity(id);
}

function deleteActivity(id) {
  const store = loadStore();
  const activity = store.activities[id];
  if (!activity) throw new Error('النشاط غير موجود');
  // منع حذف نشاط له أبناء في WBS لتفادي تعليق الشجرة
  const hasChildren = Object.values(store.activities).some(a => a.parent_id === id);
  if (hasChildren) throw new Error('لا يمكن حذف نشاط يحتوي على أنشطة فرعية؛ احذف الأنشطة الفرعية أولاً أو انقلها');
  for (const rel of Object.values(store.relations).filter(r => r.predecessor_id === id || r.successor_id === id)) {
    delete store.relations[rel.id];
  }
  for (const ra of Object.values(store.resourceAssignments).filter(r => r.activity_id === id)) {
    delete store.resourceAssignments[ra.id];
  }
  delete store.activities[id];
  audit(store, { action: 'delete', entity: 'activity', entityId: id, projectId: activity.project_id, details: { name: activity.name } });
  saveStore(store);
  recalculateSchedule(activity.schedule_id, { silent: true });
  return { deleted: true, id };
}

function reorderActivities(scheduleId, orderedIds) {
  if (!Array.isArray(orderedIds)) throw new Error('يجب إرسال قائمة معرّفات مرتبة (orderedIds)');
  const store = loadStore();
  orderedIds.forEach((actId, idx) => {
    if (store.activities[actId]) {
      store.activities[actId].order = idx;
      store.activities[actId].updated_at = nowISO();
    }
  });
  audit(store, { action: 'update', entity: 'activity_reorder', entityId: scheduleId, projectId: store.schedules[scheduleId]?.project_id, details: { count: orderedIds.length } });
  saveStore(store);
  return listActivities(scheduleId);
}

// ===================== العلاقات بين الأنشطة (Dependencies) =====================

function detectCycle(store, scheduleId, newRelation = null) {
  const relations = Object.values(store.relations).filter(r => r.schedule_id === scheduleId);
  const edges = relations.map(r => [r.predecessor_id, r.successor_id]);
  if (newRelation) edges.push([newRelation.predecessor_id, newRelation.successor_id]);
  const graph = {};
  for (const [a, b] of edges) {
    if (!graph[a]) graph[a] = [];
    graph[a].push(b);
  }
  const visiting = new Set();
  const visited = new Set();
  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph[node] || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const node of Object.keys(graph)) {
    if (dfs(node)) return true;
  }
  return false;
}

function createRelation(body) {
  if (!body.schedule_id) throw new Error('معرّف الجدول الزمني مطلوب');
  if (!body.predecessor_id || !body.successor_id) throw new Error('يجب تحديد النشاط السابق (predecessor_id) والنشاط اللاحق (successor_id)');
  if (body.predecessor_id === body.successor_id) throw new Error('لا يمكن ربط النشاط بنفسه');
  const type = body.type || 'FS';
  if (!RELATION_TYPES.includes(type)) throw new Error(`نوع العلاقة غير صحيح. القيم المسموحة: ${RELATION_TYPES.join(', ')}`);

  const store = loadStore();
  if (!store.activities[body.predecessor_id]) throw new Error('النشاط السابق غير موجود');
  if (!store.activities[body.successor_id]) throw new Error('النشاط اللاحق غير موجود');

  const exists = Object.values(store.relations).some(r =>
    r.schedule_id === body.schedule_id && r.predecessor_id === body.predecessor_id && r.successor_id === body.successor_id);
  if (exists) throw new Error('توجد بالفعل علاقة بين هذين النشاطين');

  const newRel = { predecessor_id: body.predecessor_id, successor_id: body.successor_id };
  if (detectCycle(store, body.schedule_id, newRel)) {
    throw new Error('لا يمكن إنشاء هذه العلاقة لأنها ستؤدي إلى حلقة دائرية (Circular Dependency) بين الأنشطة');
  }

  const id = newId('REL');
  const relation = {
    id,
    schedule_id: body.schedule_id,
    predecessor_id: body.predecessor_id,
    successor_id: body.successor_id,
    type,
    lag_days: Number(body.lag_days) || 0,  // موجب = Lag، سالب = Lead
    created_at: nowISO(),
  };
  store.relations[id] = relation;
  audit(store, { action: 'create', entity: 'relation', entityId: id, projectId: store.activities[body.predecessor_id].project_id, details: { type, lag: relation.lag_days } });
  saveStore(store);
  recalculateSchedule(body.schedule_id, { silent: true });
  return relation;
}

function listRelations(scheduleId) {
  const store = loadStore();
  return Object.values(store.relations).filter(r => r.schedule_id === scheduleId);
}

function updateRelation(id, body) {
  const store = loadStore();
  const relation = store.relations[id];
  if (!relation) throw new Error('العلاقة غير موجودة');
  if (body.type && !RELATION_TYPES.includes(body.type)) throw new Error(`نوع العلاقة غير صحيح. القيم المسموحة: ${RELATION_TYPES.join(', ')}`);
  Object.assign(relation, body, { id, lag_days: body.lag_days !== undefined ? Number(body.lag_days) : relation.lag_days });
  store.relations[id] = relation;
  saveStore(store);
  recalculateSchedule(relation.schedule_id, { silent: true });
  return relation;
}

function deleteRelation(id) {
  const store = loadStore();
  const relation = store.relations[id];
  if (!relation) throw new Error('العلاقة غير موجودة');
  delete store.relations[id];
  audit(store, { action: 'delete', entity: 'relation', entityId: id, details: {} });
  saveStore(store);
  recalculateSchedule(relation.schedule_id, { silent: true });
  return { deleted: true, id };
}

// ===================== خوارزمية المسار الحرج (CPM) =====================

/**
 * حساب المسار الحرج الحقيقي بالاعتماد على وحدات "الأيام" كوحدة زمنية موحدة،
 * مع دعم أنواع العلاقات الأربعة (FS/SS/FF/SF) والـ Lag/Lead.
 * ES/EF/LS/LF محسوبة كأيام إزاحة من بداية الجدول (Day 0)، ثم تُحوَّل إلى تواريخ فعلية.
 */
function computeCPM(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const relations = Object.values(store.relations).filter(r => r.schedule_id === scheduleId);

  if (activities.length === 0) {
    return { activities: [], critical_path: [], project_duration_days: 0, project_finish_date: schedule.start_date, relations: [] };
  }

  const byId = {};
  for (const a of activities) {
    byId[a.id] = {
      ...a,
      duration: a.is_milestone ? 0 : Math.max(Number(a.duration_days) || 1, 0.0001),
      es: 0, ef: 0, ls: 0, lf: 0,
      preds: [], succs: [],
    };
  }
  for (const rel of relations) {
    if (byId[rel.predecessor_id] && byId[rel.successor_id]) {
      byId[rel.successor_id].preds.push(rel);
      byId[rel.predecessor_id].succs.push(rel);
    }
  }

  // ترتيب طوبولوجي (تجاهل الحلقات دفاعياً حتى لو منعناها عند الإنشاء)
  const visited = new Set();
  const order = [];
  function visit(id, stack = new Set()) {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const rel of byId[id].preds) {
      if (byId[rel.predecessor_id]) visit(rel.predecessor_id, stack);
    }
    stack.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of Object.keys(byId)) visit(id);

  // Forward pass (ES/EF) مع مراعاة نوع العلاقة والـ Lag/Lead
  for (const id of order) {
    const node = byId[id];
    if (node.preds.length === 0) {
      node.es = 0;
    } else {
      let candidateStarts = [];
      for (const rel of node.preds) {
        const pred = byId[rel.predecessor_id];
        const lag = Number(rel.lag_days) || 0;
        switch (rel.type) {
          case 'FS': candidateStarts.push(pred.ef + lag); break;
          case 'SS': candidateStarts.push(pred.es + lag); break;
          case 'FF': candidateStarts.push(pred.ef + lag - node.duration); break;
          case 'SF': candidateStarts.push(pred.es + lag - node.duration); break;
          default: candidateStarts.push(pred.ef + lag);
        }
      }
      node.es = Math.max(0, ...candidateStarts);
    }
    node.ef = node.es + node.duration;
  }

  const projectDuration = Math.max(...order.map(id => byId[id].ef));

  // Backward pass (LS/LF)
  for (const id of [...order].reverse()) {
    const node = byId[id];
    if (node.succs.length === 0) {
      node.lf = projectDuration;
    } else {
      let candidateFinishes = [];
      for (const rel of node.succs) {
        const succ = byId[rel.successor_id];
        const lag = Number(rel.lag_days) || 0;
        switch (rel.type) {
          case 'FS': candidateFinishes.push(succ.ls - lag); break;
          case 'SS': candidateFinishes.push(succ.ls - lag + node.duration); break;
          case 'FF': candidateFinishes.push(succ.lf - lag); break;
          case 'SF': candidateFinishes.push(succ.lf - lag + node.duration); break;
          default: candidateFinishes.push(succ.ls - lag);
        }
      }
      node.lf = Math.min(projectDuration, ...candidateFinishes);
    }
    node.ls = node.lf - node.duration;
  }

  // Total Float / Free Float
  for (const id of order) {
    const node = byId[id];
    node.total_float = r2(node.ls - node.es);
    if (node.succs.length === 0) {
      node.free_float = r2(projectDuration - node.ef);
    } else {
      const minSuccEs = Math.min(...node.succs.map(rel => byId[rel.successor_id].es));
      node.free_float = r2(Math.max(0, minSuccEs - node.ef));
    }
  }

  const result = order.map(id => {
    const n = byId[id];
    const isCritical = n.total_float <= 0.001;
    return {
      id: n.id, code: n.code, name: n.name, wbs_level: n.wbs_level, parent_id: n.parent_id,
      duration_days: n.duration, es: r2(n.es), ef: r2(n.ef), ls: r2(n.ls), lf: r2(n.lf),
      total_float: n.total_float, free_float: n.free_float, is_critical: isCritical,
      calc_start_date: addDays(schedule.start_date, n.es),
      calc_end_date: addDays(schedule.start_date, n.ef),
      status: n.status, progress_percent: n.progress_percent, is_milestone: n.is_milestone,
      assignee: n.assignee,
    };
  });

  return {
    schedule_id: scheduleId,
    activities: result,
    critical_path: result.filter(t => t.is_critical).map(t => t.id),
    project_duration_days: r2(projectDuration),
    project_finish_date: addDays(schedule.start_date, projectDuration),
    relations,
  };
}

/**
 * إعادة حساب المسار الحرج وتحديث حقل calc داخل كل نشاط تلقائياً.
 * تُستدعى تلقائياً بعد أي إضافة/تعديل/حذف لنشاط أو علاقة.
 */
function recalculateSchedule(scheduleId, { silent = false } = {}) {
  const store = loadStore();
  if (!store.schedules[scheduleId]) return null;
  const cpm = computeCPM(scheduleId);
  for (const t of cpm.activities) {
    if (store.activities[t.id]) {
      store.activities[t.id].calc = {
        es: t.es, ef: t.ef, ls: t.ls, lf: t.lf,
        total_float: t.total_float, free_float: t.free_float, is_critical: t.is_critical,
      };
    }
  }
  if (!silent) {
    audit(store, { action: 'recalculate', entity: 'schedule', entityId: scheduleId, projectId: store.schedules[scheduleId].project_id, details: { duration: cpm.project_duration_days } });
  }
  saveStore(store);
  return cpm;
}

// ===================== إعادة الجدولة + الإصدارات (Baselines) =====================

function saveBaseline(scheduleId, { name, note } = {}) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const id = newId('BASE');
  const baseline = {
    id,
    schedule_id: scheduleId,
    project_id: schedule.project_id,
    name: name || `إصدار ${schedule.version}`,
    note: note || '',
    version: schedule.version,
    snapshot: activities.map(a => ({
      id: a.id, code: a.code, name: a.name,
      start_date: a.start_date, end_date: a.end_date, duration_days: a.duration_days,
      calc: a.calc,
    })),
    created_at: nowISO(),
  };
  store.baselines[id] = baseline;
  schedule.version += 1;
  schedule.updated_at = nowISO();
  audit(store, { action: 'create', entity: 'baseline', entityId: id, projectId: schedule.project_id, details: { name: baseline.name } });
  saveStore(store);
  return baseline;
}

function listBaselines(scheduleId) {
  const store = loadStore();
  return Object.values(store.baselines).filter(b => b.schedule_id === scheduleId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function rescheduleActivities(scheduleId, { shiftDays = 0, fromDate = null, activityIds = null } = {}) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  // حفظ إصدار قبل إعادة الجدولة تلقائياً للحفاظ على السجل التاريخي
  saveBaseline(scheduleId, { name: `قبل إعادة الجدولة (${nowISO().slice(0, 10)})`, note: 'تم إنشاؤه تلقائياً قبل تنفيذ إعادة الجدولة' });

  const store2 = loadStore();
  let activities = Object.values(store2.activities).filter(a => a.schedule_id === scheduleId);
  if (Array.isArray(activityIds) && activityIds.length) {
    activities = activities.filter(a => activityIds.includes(a.id));
  }
  if (fromDate) {
    activities = activities.filter(a => a.start_date && new Date(a.start_date) >= new Date(fromDate));
  }
  for (const a of activities) {
    if (a.start_date) a.start_date = addDays(a.start_date, shiftDays);
    if (a.end_date) a.end_date = addDays(a.end_date, shiftDays);
    a.updated_at = nowISO();
    store2.activities[a.id] = a;
  }
  audit(store2, { action: 'reschedule', entity: 'schedule', entityId: scheduleId, projectId: schedule.project_id, details: { shiftDays, affected: activities.length } });
  pushNotification(store2, { projectId: schedule.project_id, scheduleId, type: 'rescheduled', severity: 'info', message: `تمت إعادة جدولة ${activities.length} نشاط بإزاحة ${shiftDays} يوم` });
  saveStore(store2);
  return recalculateSchedule(scheduleId);
}

// ===================== متابعة التنفيذ / المقارنة =====================

function compareScheduleVsActual(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const cpm = computeCPM(scheduleId);
  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const now = new Date();

  const rows = activities.map(a => {
    const calcInfo = cpm.activities.find(c => c.id === a.id) || {};
    const plannedEnd = a.end_date ? new Date(a.end_date) : (calcInfo.calc_end_date ? new Date(calcInfo.calc_end_date) : null);
    const isLate = plannedEnd && plannedEnd < now && a.status !== 'completed';
    const delayDays = isLate ? daysBetween(plannedEnd, now) : 0;
    const actualDuration = a.actual_start_date && a.actual_end_date ? daysBetween(a.actual_start_date, a.actual_end_date) : null;
    const plannedDuration = a.duration_days || calcInfo.duration_days || 0;
    const variance_days = actualDuration != null ? actualDuration - plannedDuration : null;
    const variance_percent = actualDuration != null && plannedDuration > 0 ? r2((variance_days / plannedDuration) * 100) : null;
    return {
      activity_id: a.id, code: a.code, name: a.name,
      planned_start: a.start_date || calcInfo.calc_start_date, planned_end: a.end_date || calcInfo.calc_end_date,
      actual_start: a.actual_start_date, actual_end: a.actual_end_date,
      status: a.status, progress_percent: a.progress_percent,
      is_late: !!isLate, delay_days: delayDays, delay_reason: a.delay_reason || '',
      is_critical: calcInfo.is_critical || false,
      variance_days, variance_percent,
    };
  });

  const delayed = rows.filter(r => r.is_late);
  const ahead = rows.filter(r => r.variance_days != null && r.variance_days < 0);
  const completedCount = rows.filter(r => r.status === 'completed').length;
  const overallProgress = rows.length ? r2(rows.reduce((s, r) => s + (Number(r.progress_percent) || 0), 0) / rows.length) : 0;

  // توقع تاريخ الانتهاء النهائي: يأخذ أكبر تأخير على المسار الحرج ويضيفه لتاريخ الانتهاء المخطط
  const criticalDelay = Math.max(0, ...delayed.filter(r => r.is_critical).map(r => r.delay_days), 0);
  const forecastFinishDate = addDays(cpm.project_finish_date, criticalDelay);

  return {
    schedule_id: scheduleId,
    activities: rows,
    delayed_activities_count: delayed.length,
    ahead_activities_count: ahead.length,
    average_delay_days: delayed.length ? r2(delayed.reduce((s, r) => s + r.delay_days, 0) / delayed.length) : 0,
    overall_progress_percent: overallProgress,
    completed_activities: completedCount,
    total_activities: rows.length,
    planned_finish_date: cpm.project_finish_date,
    forecast_finish_date: forecastFinishDate,
    forecast_delay_days: daysBetween(cpm.project_finish_date, forecastFinishDate),
  };
}

// ===================== الموارد المرتبطة بالأنشطة =====================

function assignResourceToActivity(body) {
  if (!body.activity_id) throw new Error('معرّف النشاط مطلوب');
  if (!body.resource_type || !RESOURCE_TYPES.includes(body.resource_type)) {
    throw new Error(`نوع المورد غير صحيح. القيم المسموحة: ${RESOURCE_TYPES.join(', ')}`);
  }
  if (!body.name) throw new Error('اسم المورد مطلوب');
  const store = loadStore();
  const activity = store.activities[body.activity_id];
  if (!activity) throw new Error('النشاط غير موجود');
  const id = newId('SRES');
  const assignment = {
    id,
    schedule_id: activity.schedule_id,
    project_id: activity.project_id,
    activity_id: body.activity_id,
    resource_type: body.resource_type,
    name: body.name,
    quantity: Number(body.quantity) || 1,
    unit_cost: Number(body.unit_cost) || 0,
    hours_per_day: Number(body.hours_per_day) || 8,
    total_hours: Number(body.total_hours) || (activity.duration_days * (Number(body.hours_per_day) || 8)),
    total_cost: r2((Number(body.quantity) || 1) * (Number(body.unit_cost) || 0)),
    notes: body.notes || '',
    created_at: nowISO(),
  };
  store.resourceAssignments[id] = assignment;
  audit(store, { action: 'create', entity: 'resource_assignment', entityId: id, projectId: activity.project_id, details: { name: assignment.name, activity: activity.name } });
  saveStore(store);
  return assignment;
}

function listResourceAssignments(scheduleId, { resourceType, activityId } = {}) {
  const store = loadStore();
  let items = Object.values(store.resourceAssignments).filter(r => r.schedule_id === scheduleId);
  if (resourceType) items = items.filter(r => r.resource_type === resourceType);
  if (activityId) items = items.filter(r => r.activity_id === activityId);
  return items;
}

function updateResourceAssignment(id, body) {
  const store = loadStore();
  const assignment = store.resourceAssignments[id];
  if (!assignment) throw new Error('تخصيص المورد غير موجود');
  Object.assign(assignment, body, { id });
  assignment.total_cost = r2((Number(assignment.quantity) || 1) * (Number(assignment.unit_cost) || 0));
  store.resourceAssignments[id] = assignment;
  saveStore(store);
  return assignment;
}

function deleteResourceAssignment(id) {
  const store = loadStore();
  const assignment = store.resourceAssignments[id];
  if (!assignment) throw new Error('تخصيص المورد غير موجود');
  delete store.resourceAssignments[id];
  saveStore(store);
  return { deleted: true, id };
}

/**
 * توزيع الموارد اليومي (Resource Histogram) — يحسب إجمالي الساعات/التكلفة لكل مورد
 * في كل يوم بين بداية ونهاية الجدول، بناءً على تواريخ الأنشطة المخصصة له.
 */
function computeResourceHistogram(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const assignments = Object.values(store.resourceAssignments).filter(r => r.schedule_id === scheduleId);
  const cpm = computeCPM(scheduleId);
  const byActivity = {};
  cpm.activities.forEach(a => { byActivity[a.id] = a; });

  const dayMap = {}; // { 'resourceName': { 'YYYY-MM-DD': hours } }
  const conflicts = [];

  for (const asg of assignments) {
    const act = activities.find(a => a.id === asg.activity_id);
    if (!act) continue;
    const calcInfo = byActivity[act.id];
    const start = act.start_date || calcInfo?.calc_start_date;
    const end = act.end_date || calcInfo?.calc_end_date;
    if (!start || !end) continue;
    const days = Math.max(1, daysBetween(start, end));
    if (!dayMap[asg.name]) dayMap[asg.name] = {};
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      dayMap[asg.name][day] = (dayMap[asg.name][day] || 0) + (Number(asg.hours_per_day) || 8) * (Number(asg.quantity) || 1);
    }
  }

  // اكتشاف الحمل الزائد: مورد يعمل أكثر من 12 ساعة/يوم إجمالاً (تعارض/إفراط جدولة)
  for (const [name, days] of Object.entries(dayMap)) {
    for (const [day, hours] of Object.entries(days)) {
      if (hours > 12) conflicts.push({ resource: name, date: day, hours: r2(hours) });
    }
  }

  const series = Object.entries(dayMap).map(([name, days]) => ({
    resource: name,
    daily: Object.entries(days).sort(([d1], [d2]) => new Date(d1) - new Date(d2)).map(([date, hours]) => ({ date, hours: r2(hours) })),
  }));

  return { schedule_id: scheduleId, series, overload_conflicts: conflicts };
}

// ===================== S-Curve / Burndown =====================

function computeSCurve(scheduleId) {
  const cpm = computeCPM(scheduleId);
  if (!cpm.activities.length) return { planned: [], actual: [], burndown: [] };
  const totalDuration = cpm.project_duration_days || 1;
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  const totalWeight = cpm.activities.length;

  const plannedByDay = {};
  for (const a of cpm.activities) {
    const dayKey = Math.round(a.ef);
    plannedByDay[dayKey] = (plannedByDay[dayKey] || 0) + (1 / totalWeight) * 100;
  }
  let cum = 0;
  const planned = [];
  for (let d = 0; d <= totalDuration; d++) {
    cum += plannedByDay[d] || 0;
    planned.push({ day: d, date: addDays(schedule.start_date, d), cumulative_percent: r2(Math.min(100, cum)) });
  }

  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const actualTotal = activities.reduce((s, a) => s + (Number(a.progress_percent) || 0), 0);
  const actualOverall = activities.length ? r2(actualTotal / activities.length) : 0;
  const today = daysBetween(schedule.start_date, nowISO().slice(0, 10));
  const actual = planned
    .filter(p => p.day <= Math.max(0, today))
    .map((p, idx, arr) => ({ day: p.day, date: p.date, cumulative_percent: idx === arr.length - 1 ? actualOverall : r2((actualOverall / Math.max(1, arr.length)) * (idx + 1)) }));

  const burndown = planned.map(p => ({ day: p.day, date: p.date, remaining_percent: r2(100 - p.cumulative_percent) }));

  return { schedule_id: scheduleId, planned, actual, burndown, current_actual_progress_percent: actualOverall };
}

// ===================== التقويمات =====================

function createCalendar(body) {
  if (!body.project_id) throw new Error('معرّف المشروع مطلوب');
  if (!body.type || !CALENDAR_TYPES.includes(body.type)) throw new Error(`نوع التقويم غير صحيح. القيم المسموحة: ${CALENDAR_TYPES.join(', ')}`);
  if (!body.name) throw new Error('اسم التقويم مطلوب');
  const store = loadStore();
  const id = newId('CAL');
  const calendar = {
    id,
    project_id: body.project_id,
    schedule_id: body.schedule_id || null,
    type: body.type,
    name: body.name,
    weekly_work_days: Number(body.weekly_work_days) || 6,
    daily_work_hours: Number(body.daily_work_hours) || 8,
    holidays: Array.isArray(body.holidays) ? body.holidays : [],
    created_at: nowISO(),
  };
  store.calendars[id] = calendar;
  saveStore(store);
  return calendar;
}

function listCalendars(projectId) {
  const store = loadStore();
  return Object.values(store.calendars).filter(c => c.project_id === projectId);
}

function updateCalendar(id, body) {
  const store = loadStore();
  const calendar = store.calendars[id];
  if (!calendar) throw new Error('التقويم غير موجود');
  Object.assign(calendar, body, { id });
  store.calendars[id] = calendar;
  saveStore(store);
  return calendar;
}

// ===================== لوحة المعلومات الرئيسية =====================

function getDashboard(projectId = null) {
  const store = loadStore();
  const schedules = Object.values(store.schedules).filter(s => !projectId || s.project_id === projectId);
  const scheduleIds = new Set(schedules.map(s => s.id));
  const activities = Object.values(store.activities).filter(a => scheduleIds.has(a.schedule_id));

  const totalActivities = activities.length;
  const completed = activities.filter(a => a.status === 'completed').length;
  const inProgress = activities.filter(a => a.status === 'in_progress').length;
  const delayed = activities.filter(a => a.status === 'delayed').length;
  const critical = activities.filter(a => a.calc?.is_critical).length;

  const overallProgress = totalActivities ? r2(activities.reduce((s, a) => s + (Number(a.progress_percent) || 0), 0) / totalActivities) : 0;

  let totalRemainingDays = 0;
  let totalDelayDays = 0;
  const now = new Date();
  for (const s of schedules) {
    const cpm = computeCPM(s.id);
    if (cpm.project_finish_date) {
      const remaining = daysBetween(nowISO().slice(0, 10), cpm.project_finish_date);
      if (remaining > 0) totalRemainingDays += remaining;
      else totalDelayDays += Math.abs(remaining);
    }
  }

  const recentUpdates = Object.values(store.auditLog)
    .filter(a => !projectId || a.projectId === projectId)
    .slice(-15).reverse();

  const progressChartByProject = {};
  for (const s of schedules) {
    const acts = activities.filter(a => a.schedule_id === s.id);
    const p = acts.length ? r2(acts.reduce((sum, a) => sum + (Number(a.progress_percent) || 0), 0) / acts.length) : 0;
    progressChartByProject[s.name] = p;
  }

  const distributionByStatus = ACTIVITY_STATUSES.map(status => ({
    status, count: activities.filter(a => a.status === status).length,
  }));

  return {
    projects_count: new Set(schedules.map(s => s.project_id)).size,
    schedules_count: schedules.length,
    total_activities: totalActivities,
    completed_activities: completed,
    in_progress_activities: inProgress,
    delayed_activities: delayed,
    critical_activities: critical,
    overall_progress_percent: overallProgress,
    remaining_days: totalRemainingDays,
    delayed_days: totalDelayDays,
    recent_updates: recentUpdates,
    progress_chart: Object.entries(progressChartByProject).map(([name, progress]) => ({ name, progress })),
    status_distribution: distributionByStatus,
  };
}

// ===================== الإشعارات =====================

function listNotifications(projectId = null, { unreadOnly = false } = {}) {
  const store = loadStore();
  let items = Object.values(store.notifications);
  if (projectId) items = items.filter(n => n.projectId === projectId);
  if (unreadOnly) items = items.filter(n => !n.read);
  return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function markNotificationRead(id) {
  const store = loadStore();
  const notif = store.notifications[id];
  if (!notif) throw new Error('الإشعار غير موجود');
  notif.read = true;
  saveStore(store);
  return notif;
}

function scanAndPushAutomaticNotifications(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const activities = Object.values(store.activities).filter(a => a.schedule_id === scheduleId);
  const now = new Date();
  const created = [];

  for (const a of activities) {
    if (a.status === 'completed') continue;
    if (a.start_date) {
      const daysToStart = daysBetween(now.toISOString().slice(0, 10), a.start_date);
      if (daysToStart === 3) {
        created.push(pushNotification(store, { projectId: a.project_id, scheduleId, type: 'activity_starting_soon', severity: 'info', message: `النشاط "${a.name}" سيبدأ خلال 3 أيام` }));
      }
    }
    if (a.end_date) {
      const daysToEnd = daysBetween(now.toISOString().slice(0, 10), a.end_date);
      if (daysToEnd === 2) {
        created.push(pushNotification(store, { projectId: a.project_id, scheduleId, type: 'activity_ending_soon', severity: 'warning', message: `النشاط "${a.name}" سينتهي خلال يومين` }));
      }
      if (daysToEnd < 0) {
        created.push(pushNotification(store, { projectId: a.project_id, scheduleId, type: 'activity_overdue', severity: 'danger', message: `النشاط "${a.name}" تجاوز موعد الانتهاء المخطط` }));
      }
    }
  }

  const histogram = computeResourceHistogram(scheduleId);
  for (const c of histogram.overload_conflicts) {
    created.push(pushNotification(store, { projectId: schedule.project_id, scheduleId, type: 'resource_overload', severity: 'danger', message: `المورد "${c.resource}" محمّل بأكثر من طاقته بتاريخ ${c.date} (${c.hours} ساعة)` }));
  }

  saveStore(store);
  return { created_count: created.length };
}

// ===================== سجل التدقيق =====================

function getAuditLog(projectId = null, { limit = 200 } = {}) {
  const store = loadStore();
  let items = store.auditLog || [];
  if (projectId) items = items.filter(a => a.projectId === projectId);
  return items.slice(-limit).reverse();
}

// ===================== التقارير =====================

function buildScheduleReport(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const cpm = computeCPM(scheduleId);
  const comparison = compareScheduleVsActual(scheduleId);
  return {
    schedule: { id: schedule.id, name: schedule.name, code: schedule.code, project_id: schedule.project_id, start_date: schedule.start_date, version: schedule.version },
    project_duration_days: cpm.project_duration_days,
    project_finish_date: cpm.project_finish_date,
    total_activities: cpm.activities.length,
    critical_activities_count: cpm.critical_path.length,
    overall_progress_percent: comparison.overall_progress_percent,
    delayed_activities_count: comparison.delayed_activities_count,
    forecast_finish_date: comparison.forecast_finish_date,
    forecast_delay_days: comparison.forecast_delay_days,
    activities: cpm.activities,
  };
}

function buildProgressReport(scheduleId) { return compareScheduleVsActual(scheduleId); }
function buildDelayReport(scheduleId) {
  const cmp = compareScheduleVsActual(scheduleId);
  return { ...cmp, activities: cmp.activities.filter(a => a.is_late) };
}
function buildCriticalPathReport(scheduleId) {
  const cpm = computeCPM(scheduleId);
  return { ...cpm, activities: cpm.activities.filter(a => a.is_critical) };
}
function buildResourceReport(scheduleId) { return computeResourceHistogram(scheduleId); }
function buildExecutiveReport(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  return {
    schedule_summary: buildScheduleReport(scheduleId),
    resource_summary: computeResourceHistogram(scheduleId),
    s_curve: computeSCurve(scheduleId),
    ai_insights: aiAnalyzeSchedule(scheduleId).insights,
  };
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

function exportReportToPDF(reportData, { title, projectName }) {
  const filename = `schedule-report-${Date.now()}.pdf`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = flattenReportForTable(reportData);
  const result = generateBoqTablePDF({
    title: title || 'Schedule Report', meta: { projectName: projectName || '-' },
    headers, rows, outputPath, colWidths: [280, 280],
  });
  return { ...result, url: `/reports/${filename}` };
}

function exportReportToExcel(reportData, { title }) {
  const filename = `schedule-report-${Date.now()}.xlsx`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = [headers, ...flattenReportForTable(reportData)];
  const buffer = generateXlsx([{ name: title || 'Report', rows }]);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

function exportReportToCSV(reportData) {
  const filename = `schedule-report-${Date.now()}.csv`;
  const outputPath = path.join(REPORTS_DIR, filename);
  const headers = ['البند', 'القيمة'];
  const rows = flattenReportForTable(reportData);
  const buffer = generateCsv(headers, rows);
  fs.writeFileSync(outputPath, buffer);
  return { outputPath, url: `/reports/${filename}` };
}

// ===================== مساعد الذكاء الاصطناعي التحليلي =====================

function aiAnalyzeSchedule(scheduleId) {
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const cpm = computeCPM(scheduleId);
  const comparison = compareScheduleVsActual(scheduleId);
  const histogram = computeResourceHistogram(scheduleId);

  const insights = [];

  if (comparison.delayed_activities_count > 0) {
    insights.push(`يوجد ${comparison.delayed_activities_count} نشاط متأخر بمتوسط تأخير ${comparison.average_delay_days} يوم. يُنصح بمراجعة الموارد المخصصة والعلاقات المرتبطة بهذه الأنشطة.`);
  }
  if (comparison.forecast_delay_days > 0) {
    insights.push(`بناءً على التأخيرات الحالية على المسار الحرج، من المتوقع أن ينتهي المشروع بتأخير ${comparison.forecast_delay_days} يوم عن الموعد المخطط (${comparison.forecast_finish_date}).`);
  } else {
    insights.push('التوقع الحالي يشير إلى إمكانية إنجاز المشروع في الموعد المخطط أو قبله.');
  }
  if (cpm.critical_path.length > 0) {
    const pct = r2((cpm.critical_path.length / Math.max(1, cpm.activities.length)) * 100);
    insights.push(`يشكّل المسار الحرج ${pct}% من إجمالي الأنشطة (${cpm.critical_path.length} نشاط). أي تأخير في هذه الأنشطة سيؤخر تاريخ التسليم مباشرة.`);
  }
  if (histogram.overload_conflicts.length > 0) {
    insights.push(`تم رصد ${histogram.overload_conflicts.length} حالة تحميل زائد على الموارد، ما قد يستدعي إعادة توزيع الموارد أو تمديد بعض الأنشطة.`);
  }
  const nearCriticalCount = cpm.activities.filter(a => !a.is_critical && a.total_float > 0 && a.total_float <= 3).length;
  if (nearCriticalCount > 0) {
    insights.push(`يوجد ${nearCriticalCount} نشاط قريب من الحرج (هامش تأخير 3 أيام أو أقل)؛ يُنصح بمتابعتها عن قرب لأنها قد تتحول لحرجة عند أي انزلاق بسيط.`);
  }
  insights.push(`نسبة الإنجاز الكلية الحالية: ${comparison.overall_progress_percent}% (${comparison.completed_activities} من ${comparison.total_activities} نشاط).`);

  const riskForecast = comparison.forecast_delay_days > 14 ? 'مرتفع'
    : comparison.forecast_delay_days > 3 ? 'متوسط' : 'منخفض';

  return {
    schedule_id: scheduleId,
    project_duration_days: cpm.project_duration_days,
    forecast_finish_date: comparison.forecast_finish_date,
    overall_progress_percent: comparison.overall_progress_percent,
    risk_forecast: riskForecast,
    insights,
  };
}

/**
 * اقتراح إعادة جدولة تلقائي للأنشطة المتأخرة على المسار الحرج فقط،
 * بإزاحتها للأمام بمقدار متوسط التأخير الحالي (اقتراح وليس تنفيذاً تلقائياً).
 */
function aiSuggestRescheduling(scheduleId) {
  const cpm = computeCPM(scheduleId);
  const comparison = compareScheduleVsActual(scheduleId);
  const criticalDelayed = comparison.activities.filter(a => a.is_late && a.is_critical);
  if (criticalDelayed.length === 0) {
    return { schedule_id: scheduleId, suggestions: [], message: 'لا توجد أنشطة حرجة متأخرة تستدعي إعادة جدولة حالياً.' };
  }
  const suggestions = criticalDelayed.map(a => ({
    activity_id: a.activity_id,
    activity_name: a.name,
    current_delay_days: a.delay_days,
    suggested_action: `إزاحة النشاط وجميع الأنشطة اللاحقة له بمقدار ${a.delay_days} يوم، أو ضغط مدة الأنشطة الموازية غير الحرجة لاستيعاب التأخير`,
  }));
  return {
    schedule_id: scheduleId,
    suggestions,
    message: `تم رصد ${suggestions.length} نشاط حرج متأخر يتطلب إجراءً لتفادي تأخير تاريخ التسليم النهائي.`,
  };
}

function aiOptimizeResourceDistribution(scheduleId) {
  const histogram = computeResourceHistogram(scheduleId);
  const recommendations = histogram.overload_conflicts.map(c => ({
    resource: c.resource,
    date: c.date,
    current_hours: c.hours,
    recommendation: `تخفيض التحميل عبر توزيع العمل على وردية إضافية أو مورد بديل بتاريخ ${c.date}`,
  }));
  return {
    schedule_id: scheduleId,
    total_conflicts: histogram.overload_conflicts.length,
    recommendations,
    message: recommendations.length
      ? `تم اقتراح ${recommendations.length} إجراء لتحسين توزيع الموارد وتفادي التحميل الزائد.`
      : 'توزيع الموارد الحالي متوازن ولا توجد حالات تحميل زائد.',
  };
}

function aiPredictFinishDate(scheduleId) {
  const comparison = compareScheduleVsActual(scheduleId);
  return {
    schedule_id: scheduleId,
    planned_finish_date: comparison.planned_finish_date,
    forecast_finish_date: comparison.forecast_finish_date,
    forecast_delay_days: comparison.forecast_delay_days,
    confidence: comparison.delayed_activities_count === 0 ? 'مرتفعة' : (comparison.forecast_delay_days > 14 ? 'منخفضة' : 'متوسطة'),
  };
}

function aiAnswerScheduleQuestion(scheduleId, question) {
  if (!question) throw new Error('يجب إرسال question');
  const store = loadStore();
  const schedule = store.schedules[scheduleId];
  if (!schedule) throw new Error('الجدول الزمني غير موجود');
  const cpm = computeCPM(scheduleId);
  const comparison = compareScheduleVsActual(scheduleId);
  const q = question.toLowerCase();

  let answer;
  if (q.includes('مسار') || q.includes('حرج') || q.includes('critical')) {
    answer = `يحتوي المسار الحرج على ${cpm.critical_path.length} نشاط من إجمالي ${cpm.activities.length}. مدة المشروع الإجمالية المحسوبة ${cpm.project_duration_days} يوم، وتاريخ الانتهاء المخطط ${cpm.project_finish_date}.`;
  } else if (q.includes('متأخر') || q.includes('تأخير') || q.includes('delay')) {
    answer = comparison.delayed_activities_count > 0
      ? `يوجد ${comparison.delayed_activities_count} نشاط متأخر بمتوسط تأخير ${comparison.average_delay_days} يوم. التوقع النهائي للمشروع هو ${comparison.forecast_finish_date} (تأخير متوقع ${comparison.forecast_delay_days} يوم).`
      : 'لا توجد أنشطة متأخرة حالياً في هذا الجدول الزمني.';
  } else if (q.includes('إنجاز') || q.includes('تقدم') || q.includes('progress')) {
    answer = `نسبة الإنجاز الكلية الحالية هي ${comparison.overall_progress_percent}% (${comparison.completed_activities} من ${comparison.total_activities} نشاط منجز).`;
  } else if (q.includes('انتهاء') || q.includes('تسليم') || q.includes('finish')) {
    answer = `تاريخ الانتهاء المخطط ${cpm.project_finish_date}، والتوقع الحالي بناءً على الأداء الفعلي هو ${comparison.forecast_finish_date}.`;
  } else if (q.includes('مورد') || q.includes('resource')) {
    const histogram = computeResourceHistogram(scheduleId);
    answer = histogram.overload_conflicts.length > 0
      ? `يوجد ${histogram.overload_conflicts.length} حالة تحميل زائد على الموارد تحتاج مراجعة.`
      : 'توزيع الموارد الحالي متوازن دون تحميل زائد.';
  } else {
    answer = `الجدول الزمني "${schedule.name}" — مدة إجمالية ${cpm.project_duration_days} يوم، نسبة إنجاز ${comparison.overall_progress_percent}%، وتاريخ انتهاء متوقع ${comparison.forecast_finish_date}.`;
  }
  return { schedule_id: scheduleId, question, answer };
}

// ===================== التكامل مع بقية الأقسام =====================

function getIntegrationSnapshot(projectId) {
  const store = loadStore();
  const schedules = Object.values(store.schedules).filter(s => s.project_id === projectId);
  return {
    project_id: projectId,
    schedules_count: schedules.length,
    schedules: schedules.map(s => {
      const cpm = computeCPM(s.id);
      const comparison = compareScheduleVsActual(s.id);
      return {
        id: s.id, name: s.name, code: s.code,
        project_duration_days: cpm.project_duration_days,
        project_finish_date: cpm.project_finish_date,
        overall_progress_percent: comparison.overall_progress_percent,
        critical_activities_count: cpm.critical_path.length,
        forecast_delay_days: comparison.forecast_delay_days,
      };
    }),
  };
}

module.exports = {
  // ثوابت
  RELATION_TYPES, ACTIVITY_STATUSES, ACTIVITY_PRIORITIES, WBS_LEVELS, RESOURCE_TYPES, CALENDAR_TYPES, SCHEDULE_ROLES,
  // الجداول الزمنية
  createSchedule, listSchedules, getSchedule, updateSchedule, deleteSchedule,
  // الأنشطة / WBS
  createActivity, listActivities, getActivity, updateActivity, deleteActivity, reorderActivities, buildWbsTree,
  // العلاقات
  createRelation, listRelations, updateRelation, deleteRelation,
  // CPM
  computeCPM, recalculateSchedule,
  // إعادة الجدولة والإصدارات
  saveBaseline, listBaselines, rescheduleActivities,
  // متابعة التنفيذ
  compareScheduleVsActual,
  // الموارد
  assignResourceToActivity, listResourceAssignments, updateResourceAssignment, deleteResourceAssignment, computeResourceHistogram,
  // منحنيات
  computeSCurve,
  // التقويمات
  createCalendar, listCalendars, updateCalendar,
  // لوحة المعلومات
  getDashboard,
  // الإشعارات
  listNotifications, markNotificationRead, scanAndPushAutomaticNotifications,
  // سجل التدقيق
  getAuditLog,
  // التقارير
  buildScheduleReport, buildProgressReport, buildDelayReport, buildCriticalPathReport, buildResourceReport, buildExecutiveReport,
  exportReportToPDF, exportReportToExcel, exportReportToCSV,
  // الذكاء الاصطناعي
  aiAnalyzeSchedule, aiSuggestRescheduling, aiOptimizeResourceDistribution, aiPredictFinishDate, aiAnswerScheduleQuestion,
  // التكامل
  getIntegrationSnapshot,
};
