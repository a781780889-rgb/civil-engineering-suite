/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 *   الجزء 1/10: البنية الأساسية + لوحة تحكم التقارير + مركز التقارير (الكتالوج). [مكتمل]
 *   الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة. [مكتمل]
 *   الجزء 3/10: التقارير الزمنية والمقارنة. [مكتمل]
 *   الجزء 4/10: التقارير التفاعلية + الرسوم البيانية. [مكتمل]
 *   الجزء 5/10: التقارير التنفيذية + التقارير الدورية. [مكتمل]
 * >> الجزء 6/10 (هذا الملف): الجدولة التلقائية للتقارير (reportExportEngine.js يوفر
 *    التصدير/الطباعة الموحّد ضمن نفس الجزء).
 *   الجزء 7/10: القوالب + التوقيعات والاعتمادات + الصور والمرفقات.
 *   الجزء 8/10: الذكاء الاصطناعي + التقارير التنبؤية.
 *   الجزء 9/10: الربط الكامل بكل الأقسام + سجل التقارير + المشاركة.
 *   الجزء 10/10: الصلاحيات + سجل التدقيق + الأداء + قواعد الدقة (تجميع نهائي).
 *
 * هذا الملف يوفر نظام "Scheduled Reports" حقيقياً وعاماً (وليس مقصوراً على تقرير
 * واحد) يسمح للمستخدم بتحديد: التقرير (أي نوع من كتالوج reportsCenter)، المشروع،
 * الفترة، وقت الإنشاء، التكرار (يومي/أسبوعي/شهري/مخصص)، المستلمين، وطريقة الإرسال
 * (تنبيه داخل النظام فعلياً، مع بنية جاهزة للبريد الإلكتروني لاحقاً).
 *
 * يوفر:
 *  1) طبقة تخزين مستقلة (backend/data/reportSchedules.json) بنفس نمط بقية أجزاء
 *     القسم 14 - بدون أي تبعيات خارجية.
 *  2) CRUD كامل على الجدولات: إنشاء / تعديل / حذف / تفعيل / تعطيل / قائمة / جلب.
 *  3) محرّك حساب "متى يجب أن يعمل الجدول تالياً" (computeNextRunAt) لكل أنواع
 *     التكرار المطلوبة في الخطة: يومي، أسبوعي (بيوم أسبوع محدد)، شهري (بيوم شهر
 *     محدد)، ومخصص (فترة بالأيام cron-like بسيطة).
 *  4) منفّذ فعلي (runDueSchedules) يُشغَّل عبر مؤقّت خلفي (Background Job) كل دقيقة
 *     داخل نفس عملية Node (بدون طابور خارجي أو تبعية جديدة)، يفحص كل الجدولات
 *     المستحقة، يبني التقرير فعلياً عبر الوحدة المصدرية المطابقة لنوعه من الكتالوج
 *     (باستخدام نفس البيانات الحقيقية للنظام - وليس بيانات وهمية)، يُصدّره فعلياً
 *     بالصيغة المطلوبة عبر reportExportEngine، يُسجّله في reportsCenter، ثم يُرسل
 *     تنبيهاً فعلياً داخل النظام لكل مستلم (عبر طبقة تخزين إشعارات مخصصة لقسم
 *     التقارير بنفس نمط drawingNotifications.js)، ويُحدّث تاريخ آخر/تالي تشغيل.
 *  5) دعم "طريقة الإرسال": in_app (تعمل فعلياً الآن) و email (تُبنى الرسالة فعلياً
 *     وتُسجَّل في outbox قابل للمراجعة، بانتظار ربط مزوّد بريد فعلي في جزء لاحق -
 *     لا يُدّعى إرسال بريد فعلي غير موجود، توضيحاً لقاعدة الدقة).
 *  6) سجل تنفيذ لكل جدولة (runHistory): كل تشغيل يُسجَّل بنجاحه أو فشله مع السبب.
 *
 * قاعدة الدقة: لا يُشغَّل أي تقرير تلقائي دون وجود مصدر بيانات فعلي مطابق في
 * الكتالوج. عند فشل توليد التقرير (مثلاً حذف المشروع المرتبط)، يُسجَّل الفشل
 * صراحة في runHistory بدل التظاهر بنجاح وهمي.
 */

const fs = require('fs');
const path = require('path');

const REPORTS_CENTER = require('./reportsCenter');
const REPORT_BUILDER = require('./reportBuilder');
const REPORT_PERIODS = require('./reportPeriodsComparisons');
const REPORT_EXEC_PERIODIC = require('./reportExecutivePeriodic');
const EXPORT_ENGINE = require('./reportExportEngine');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportSchedules.json');

const RECURRENCE_TYPES = ['daily', 'weekly', 'monthly', 'custom'];
const DELIVERY_METHODS = ['in_app', 'email'];
// أنواع التقارير القابلة للجدولة التلقائية في هذا الجزء (تُغذّى من الأجزاء
// السابقة المكتملة فعلياً؛ ستتوسع تلقائياً مع أي جزء لاحق يضيف مصادر جديدة)
const SCHEDULABLE_REPORT_KINDS = ['saved_builder_report', 'period_report', 'executive_periodic'];

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      schedules: {},     // { id: scheduleRecord }
      notifications: {}, // { id: notificationRecord } - تنبيهات in_app لقسم التقارير
      emailOutbox: [],    // رسائل بريد مبنية فعلياً بانتظار ربط مزوّد بريد فعلي
      seq: 0,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات جدولة التقارير: ' + e.message);
  }
  let migrated = false;
  if (!store.schedules) { store.schedules = {}; migrated = true; }
  if (!store.notifications) { store.notifications = {}; migrated = true; }
  if (!store.emailOutbox) { store.emailOutbox = []; migrated = true; }
  if (typeof store.seq !== 'number') { store.seq = 0; migrated = true; }
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ===================== حساب موعد التشغيل التالي =====================

/**
 * يحسب موعد التشغيل التالي الفعلي بناءً على نوع التكرار.
 * @param {object} schedule - { recurrence, hour, minute, dayOfWeek, dayOfMonth, customIntervalDays }
 * @param {Date} [from] - نقطة البداية (افتراضياً الآن)
 */
function computeNextRunAt(schedule, from = new Date()) {
  const { recurrence, hour = 20, minute = 0, dayOfWeek = 0, dayOfMonth = 1, customIntervalDays = 1 } = schedule;
  if (!RECURRENCE_TYPES.includes(recurrence)) {
    throw new Error(`نوع تكرار غير مدعوم: ${recurrence}. الأنواع المدعومة: ${RECURRENCE_TYPES.join(', ')}`);
  }

  const base = new Date(from);
  let next = new Date(base);
  next.setHours(hour, minute, 0, 0);

  if (recurrence === 'daily') {
    if (next <= base) next.setDate(next.getDate() + 1);
    return next;
  }

  if (recurrence === 'weekly') {
    const targetDay = Math.max(0, Math.min(6, dayOfWeek)); // 0=الأحد ... 6=السبت
    let diff = targetDay - next.getDay();
    if (diff < 0 || (diff === 0 && next <= base)) diff += 7;
    next.setDate(next.getDate() + diff);
    return next;
  }

  if (recurrence === 'monthly') {
    const targetDom = Math.max(1, Math.min(28, dayOfMonth)); // نحصر بـ 28 لتفادي مشاكل الأشهر القصيرة
    next.setDate(targetDom);
    if (next <= base) next = new Date(next.getFullYear(), next.getMonth() + 1, targetDom, hour, minute, 0, 0);
    return next;
  }

  // custom: كل N يوم بدءاً من الآن
  const interval = Math.max(1, Number(customIntervalDays) || 1);
  if (next <= base) next.setDate(next.getDate() + interval);
  return next;
}

// ===================== CRUD =====================

function validateScheduleInput(input) {
  const errors = [];
  if (!input.reportKind || !SCHEDULABLE_REPORT_KINDS.includes(input.reportKind)) {
    errors.push(`reportKind يجب أن يكون أحد: ${SCHEDULABLE_REPORT_KINDS.join(', ')}`);
  }
  if (!input.reportSpec || typeof input.reportSpec !== 'object') {
    errors.push('reportSpec مطلوب (مواصفة التقرير التي سيُشغَّل بها كل مرة)');
  }
  if (!input.recurrence || !RECURRENCE_TYPES.includes(input.recurrence)) {
    errors.push(`recurrence يجب أن يكون أحد: ${RECURRENCE_TYPES.join(', ')}`);
  }
  if (!input.exportFormat || !EXPORT_ENGINE.SUPPORTED_FORMATS.includes(input.exportFormat)) {
    errors.push(`exportFormat يجب أن يكون أحد: ${EXPORT_ENGINE.SUPPORTED_FORMATS.join(', ')}`);
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    errors.push('recipients يجب أن تكون مصفوفة مستخدمين وتحتوي عنصراً واحداً على الأقل');
  }
  const deliveryMethod = input.deliveryMethod || 'in_app';
  if (!DELIVERY_METHODS.includes(deliveryMethod)) {
    errors.push(`deliveryMethod يجب أن يكون أحد: ${DELIVERY_METHODS.join(', ')}`);
  }
  return errors;
}

function createSchedule(input, actor = null) {
  const errors = validateScheduleInput(input);
  if (errors.length) throw new Error('بيانات الجدولة غير صالحة: ' + errors.join(' | '));

  const store = loadStore();
  const id = newId('SCHED');
  const record = {
    id,
    name: input.name || `جدولة ${input.reportKind}`,
    reportKind: input.reportKind,
    reportSpec: input.reportSpec, // مواصفة التقرير (تختلف حسب النوع: builder spec / period spec / exec spec)
    projectId: input.projectId || null,
    recurrence: input.recurrence,
    hour: Number.isInteger(input.hour) ? input.hour : 20,
    minute: Number.isInteger(input.minute) ? input.minute : 0,
    dayOfWeek: Number.isInteger(input.dayOfWeek) ? input.dayOfWeek : 0,
    dayOfMonth: Number.isInteger(input.dayOfMonth) ? input.dayOfMonth : 1,
    customIntervalDays: Number.isInteger(input.customIntervalDays) ? input.customIntervalDays : 1,
    exportFormat: input.exportFormat,
    recipients: input.recipients,
    deliveryMethod: input.deliveryMethod || 'in_app',
    active: input.active !== false,
    created_by: actor,
    created_at: nowISO(),
    updated_at: nowISO(),
    last_run_at: null,
    last_run_status: null,
    next_run_at: null,
    runHistory: [],
  };
  record.next_run_at = computeNextRunAt(record).toISOString();

  store.schedules[id] = record;
  saveStore(store);
  return record;
}

function updateSchedule(id, updates, actor = null) {
  const store = loadStore();
  const record = store.schedules[id];
  if (!record) throw new Error(`لا توجد جدولة بالمعرّف: ${id}`);

  const merged = { ...record, ...updates, id, updated_at: nowISO() };
  const errors = validateScheduleInput(merged);
  if (errors.length) throw new Error('بيانات الجدولة غير صالحة: ' + errors.join(' | '));

  merged.next_run_at = computeNextRunAt(merged).toISOString();
  store.schedules[id] = merged;
  saveStore(store);
  return merged;
}

function setScheduleActive(id, active) {
  const store = loadStore();
  const record = store.schedules[id];
  if (!record) throw new Error(`لا توجد جدولة بالمعرّف: ${id}`);
  record.active = !!active;
  record.updated_at = nowISO();
  if (record.active) record.next_run_at = computeNextRunAt(record).toISOString();
  saveStore(store);
  return record;
}

function deleteSchedule(id) {
  const store = loadStore();
  if (!store.schedules[id]) throw new Error(`لا توجد جدولة بالمعرّف: ${id}`);
  delete store.schedules[id];
  saveStore(store);
  return { deleted: true, id };
}

function getSchedule(id) {
  const store = loadStore();
  const record = store.schedules[id];
  if (!record) throw new Error(`لا توجد جدولة بالمعرّف: ${id}`);
  return record;
}

function listSchedules({ projectId = null, active = null, page = 1, pageSize = 20 } = {}) {
  const store = loadStore();
  let items = Object.values(store.schedules);
  if (projectId) items = items.filter((s) => s.projectId === projectId);
  if (active !== null) items = items.filter((s) => s.active === !!active);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { items: pageItems, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ===================== توليد التقرير فعلياً حسب نوعه =====================

/** يبني التقرير الفعلي (بيانات حقيقية) من الوحدة المصدرية المطابقة لنوع الجدولة */
function generateReportForSchedule(schedule) {
  switch (schedule.reportKind) {
    case 'saved_builder_report': {
      if (!schedule.reportSpec.savedReportId) throw new Error('reportSpec.savedReportId مطلوب لتقارير Report Builder المحفوظة');
      return REPORT_BUILDER.runSavedReport(schedule.reportSpec.savedReportId, schedule.reportSpec.overrideFilters || {});
    }
    case 'period_report': {
      return REPORT_PERIODS.buildPeriodReport(schedule.reportSpec);
    }
    case 'executive_periodic': {
      // kind يُحدَّد صراحةً في reportSpec.kind: project_executive | portfolio_executive | periodic
      const kind = schedule.reportSpec.kind || 'project_executive';
      return REPORT_EXEC_PERIODIC.generateAndRegister(kind, schedule.reportSpec, { userId: schedule.created_by });
    }
    default:
      throw new Error(`نوع تقرير غير مدعوم للجدولة: ${schedule.reportKind}`);
  }
}

// ===================== الإشعارات الداخلية (in_app) =====================

function notifyRecipients(store, schedule, exportResult, success, errorMessage = null) {
  for (const recipient of schedule.recipients) {
    const notifId = newId('RNOTIF');
    store.notifications[notifId] = {
      id: notifId,
      scheduleId: schedule.id,
      recipient,
      success,
      message: success
        ? `تم إنشاء التقرير المجدوَل "${schedule.name}" بصيغة ${schedule.exportFormat} بنجاح.`
        : `فشل إنشاء التقرير المجدوَل "${schedule.name}": ${errorMessage}`,
      reportUrl: exportResult ? exportResult.url : null,
      read_at: null,
      created_at: nowISO(),
    };
  }

  if (schedule.deliveryMethod === 'email') {
    for (const recipient of schedule.recipients) {
      store.emailOutbox.push({
        id: newId('EMAIL'),
        scheduleId: schedule.id,
        to: recipient,
        subject: success ? `تقرير مجدوَل: ${schedule.name}` : `فشل تقرير مجدوَل: ${schedule.name}`,
        body: success
          ? `مرفق رابط التقرير: ${exportResult ? exportResult.url : ''}`
          : `تعذّر إنشاء التقرير. السبب: ${errorMessage}`,
        status: 'pending_provider', // بانتظار ربط مزوّد بريد فعلي (جزء لاحق) - لا إرسال وهمي
        created_at: nowISO(),
      });
    }
  }
}

function listNotifications(recipient, { unreadOnly = false } = {}) {
  const store = loadStore();
  let items = Object.values(store.notifications).filter((n) => n.recipient === recipient);
  if (unreadOnly) items = items.filter((n) => !n.read_at);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items;
}

function markNotificationRead(notifId) {
  const store = loadStore();
  const n = store.notifications[notifId];
  if (!n) throw new Error(`لا يوجد تنبيه بالمعرّف: ${notifId}`);
  n.read_at = nowISO();
  saveStore(store);
  return n;
}

// ===================== المنفّذ الفعلي (Runner) =====================

/** يُنفَّذ جدولة واحدة فوراً بغض النظر عن موعدها (تشغيل يدوي/اختبار) */
function runScheduleNow(id) {
  const store = loadStore();
  const schedule = store.schedules[id];
  if (!schedule) throw new Error(`لا توجد جدولة بالمعرّف: ${id}`);
  return executeSchedule(store, schedule);
}

function executeSchedule(store, schedule) {
  const runEntry = { ts: nowISO(), success: false, error: null, reportUrl: null };
  try {
    const report = generateReportForSchedule(schedule);
    const meta = {
      projectName: schedule.reportSpec.projectName || null,
      period: schedule.reportSpec.period || schedule.recurrence,
      userName: schedule.created_by,
    };
    const exportResult = EXPORT_ENGINE.exportReport(schedule.exportFormat, report, meta);

    // تسجيل التقرير فعلياً في مركز التقارير (سجل + دورة حياة كاملة)
    let recordId = null;
    try {
      const rec = REPORTS_CENTER.registerReportRecord({
        title: schedule.name,
        category: schedule.reportKind,
        projectId: schedule.projectId,
        userId: schedule.created_by,
        format: schedule.exportFormat,
        filePath: exportResult.outputPath,
        status: 'completed',
      });
      recordId = rec && rec.id ? rec.id : null;
    } catch (e) { /* تسجيل السجل ثانوي - لا يُفشل التنفيذ الأساسي */ }

    runEntry.success = true;
    runEntry.reportUrl = exportResult.url;
    runEntry.reportRecordId = recordId;

    notifyRecipients(store, schedule, exportResult, true);

    schedule.last_run_at = nowISO();
    schedule.last_run_status = 'success';
  } catch (e) {
    runEntry.error = e.message;
    notifyRecipients(store, schedule, null, false, e.message);
    schedule.last_run_at = nowISO();
    schedule.last_run_status = 'failed';
  }

  schedule.runHistory.push(runEntry);
  if (schedule.runHistory.length > 200) schedule.runHistory = schedule.runHistory.slice(-200);
  schedule.next_run_at = computeNextRunAt(schedule, new Date()).toISOString();

  store.schedules[schedule.id] = schedule;
  saveStore(store);
  return runEntry;
}

/** يفحص كل الجدولات النشطة ويُنفّذ ما استحق موعده فعلياً. يُستدعى دورياً من المؤقّت الخلفي. */
function runDueSchedules(now = new Date()) {
  const store = loadStore();
  const due = Object.values(store.schedules).filter((s) => s.active && s.next_run_at && new Date(s.next_run_at) <= now);
  const results = [];
  for (const schedule of due) {
    results.push({ scheduleId: schedule.id, ...executeSchedule(store, schedule) });
  }
  return results;
}

// ===================== المؤقّت الخلفي (Background Job) =====================

let backgroundTimer = null;

/** يبدأ فحصاً دورياً (كل دقيقة افتراضياً) للجدولات المستحقة، دون حجب واجهة النظام. */
function startBackgroundScheduler(intervalMs = 60 * 1000) {
  if (backgroundTimer) return backgroundTimer; // مُشغَّل مسبقاً
  backgroundTimer = setInterval(() => {
    try { runDueSchedules(); } catch (e) { /* لا نُسقط العملية الخلفية بسبب خطأ جدولة واحدة */ }
  }, intervalMs);
  if (backgroundTimer.unref) backgroundTimer.unref(); // لا يمنع إنهاء العملية عند الحاجة
  return backgroundTimer;
}

function stopBackgroundScheduler() {
  if (backgroundTimer) { clearInterval(backgroundTimer); backgroundTimer = null; }
}

module.exports = {
  RECURRENCE_TYPES,
  DELIVERY_METHODS,
  SCHEDULABLE_REPORT_KINDS,
  computeNextRunAt,
  createSchedule,
  updateSchedule,
  setScheduleActive,
  deleteSchedule,
  getSchedule,
  listSchedules,
  runScheduleNow,
  runDueSchedules,
  listNotifications,
  markNotificationRead,
  startBackgroundScheduler,
  stopBackgroundScheduler,
};
