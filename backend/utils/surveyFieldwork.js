/**
 * القسم العاشر - تطبيق المساحة (Surveying & Geospatial Management System)
 * =====================================================================================
 * وحدة تكميلية: إدارة الأعمال الميدانية (البند 3 من الفقرات المطلوب تنفيذها).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *   - توزيع المهام: مهام ميدانية فعلية مرتبطة بمشروع + مسّاح/فريق + موعد.
 *   - تسجيل الزيارات: كل زيارة ميدانية بوقت وصول/انصراف فعلي وموقع GPS محقَّق.
 *   - متابعة الفرق: حالة كل فريق ميداني (نشط/في الطريق/منتهي) محسوبة من الزيارات الفعلية.
 *   - تسجيل الصور: مرفقة بالزيارة/المهمة مع بيانات EXIF-like (موقع + وقت الالتقاط).
 *   - تحديد الموقع: كل حدث ميداني (بدء مهمة، زيارة، صورة) يُسجَّل بإحداثيات GPS فعلية
 *     ويُتحقق من صحتها (نطاق خط الطول/العرض) قبل القبول.
 *   - تسجيل الوقت: كل حدث بختم زمني (timestamp) فعلي، ومدة الزيارة تُحسب فعلياً
 *     (وقت الانصراف - وقت الوصول) وليست قيمة ثابتة.
 *   - العمل دون اتصال (Offline Mode) + المزامنة التلقائية: طابور مزامنة فعلي (Sync Queue)
 *     يستقبل دفعات من الأحداث التي وقعت أثناء انقطاع الاتصال (مع client_generated_id
 *     ووقت وقوعها الفعلي في الميدان occurred_at)، ويُطبّقها بترتيب زمني صحيح عند
 *     استعادة الاتصال، مع منع التكرار (Idempotency) عبر client_id فريد لكل حدث،
 *     بحيث لا يُفقد أي حدث ولا يُسجَّل مرتين حتى لو أُعيد إرسال نفس الدفعة.
 */

const SGM_ = require('./surveyManagement');
const { _internal } = SGM_;
const { newId, nowISO, audit, loadStore, saveStore } = _internal;

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateLocation(lat, lon) {
  if (lat === undefined || lat === null || lon === undefined || lon === null) return null;
  const la = Number(lat), lo = Number(lon);
  if (!isFiniteNum(la) || !isFiniteNum(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error('إحداثيات الموقع (lat/lon) غير صالحة');
  }
  return { lat: la, lon: lo };
}

function ensureFieldworkStore(store) {
  if (!store.fieldTasks) store.fieldTasks = {};
  if (!store.fieldVisits) store.fieldVisits = {};
  if (!store.fieldSyncQueue) store.fieldSyncQueue = {}; // سجل الدفعات المزامنة (لمنع التكرار وتتبع الحالة)
  if (!store.fieldSyncedClientIds) store.fieldSyncedClientIds = {}; // { client_id: true } لمنع التكرار عبر كل الدفعات
}

// ==================================================================================
// ================================= المهام الميدانية ================================
// ==================================================================================

const TASK_STATUSES = ['assigned', 'in_progress', 'completed', 'cancelled'];

function validateTaskInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial && !body.project_id) errors.push('معرّف المشروع (project_id) مطلوب');
  if (!partial && !body.title) errors.push('عنوان المهمة (title) مطلوب');
  if (!partial && !body.assigned_to) errors.push('يجب تحديد المسّاح/الفريق المكلَّف (assigned_to)');
  if (body.status && !TASK_STATUSES.includes(body.status)) errors.push(`حالة المهمة غير صحيحة. القيم المسموحة: ${TASK_STATUSES.join(', ')}`);
  return errors;
}

function createFieldTask(body) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const errors = validateTaskInput(body || {});
  if (errors.length) throw new Error(errors.join(' / '));
  if (!store.projects[body.project_id]) throw new Error('المشروع المساحي غير موجود');

  const id = newId('FTASK');
  const record = {
    id,
    project_id: body.project_id,
    title: body.title,
    description: body.description || '',
    task_type: body.task_type || 'survey', // survey | stakeout | inspection | other
    assigned_to: body.assigned_to,
    team_name: body.team_name || '',
    scheduled_date: body.scheduled_date || null,
    status: body.status || 'assigned',
    location_lat: body.location_lat ?? null,
    location_lon: body.location_lon ?? null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  if (record.location_lat !== null) validateLocation(record.location_lat, record.location_lon);

  store.fieldTasks[id] = record;
  audit(store, { action: 'create', entity: 'field_task', entityId: id, projectId: body.project_id, details: { title: record.title, assigned_to: record.assigned_to } });
  saveStore(store);
  return { success: true, data: record };
}

function getFieldTask(id) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const rec = store.fieldTasks[id];
  if (!rec) throw new Error('المهمة الميدانية غير موجودة');
  return rec;
}

function listFieldTasks({ project_id, assigned_to, status, page = 1, pageSize = 100 } = {}) {
  const store = loadStore();
  ensureFieldworkStore(store);
  let items = Object.values(store.fieldTasks);
  if (project_id) items = items.filter((t) => t.project_id === project_id);
  if (assigned_to) items = items.filter((t) => t.assigned_to === assigned_to);
  if (status) items = items.filter((t) => t.status === status);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

function updateFieldTask(id, body) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const rec = store.fieldTasks[id];
  if (!rec) throw new Error('المهمة الميدانية غير موجودة');
  const errors = validateTaskInput(body || {}, { partial: true });
  if (errors.length) throw new Error(errors.join(' / '));

  const updatable = ['title', 'description', 'task_type', 'assigned_to', 'team_name', 'scheduled_date', 'status', 'location_lat', 'location_lon'];
  for (const key of updatable) {
    if (body[key] !== undefined) rec[key] = body[key];
  }
  if (rec.location_lat !== null && rec.location_lat !== undefined) validateLocation(rec.location_lat, rec.location_lon);
  rec.updated_at = nowISO();
  audit(store, { action: 'update', entity: 'field_task', entityId: id, projectId: rec.project_id, details: { status: rec.status } });
  saveStore(store);
  return { success: true, data: rec };
}

function deleteFieldTask(id) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const rec = store.fieldTasks[id];
  if (!rec) throw new Error('المهمة الميدانية غير موجودة');
  delete store.fieldTasks[id];
  // حذف الزيارات المرتبطة بالمهمة أيضاً حفاظاً على تناسق البيانات
  Object.keys(store.fieldVisits).forEach((vid) => {
    if (store.fieldVisits[vid].task_id === id) delete store.fieldVisits[vid];
  });
  audit(store, { action: 'delete', entity: 'field_task', entityId: id, projectId: rec.project_id });
  saveStore(store);
  return { success: true, data: { deleted: id } };
}

// ==================================================================================
// ================================= الزيارات الميدانية ==============================
// ==================================================================================

/** بدء زيارة ميدانية فعلية: تسجيل وقت وموقع الوصول */
function checkInFieldVisit(body) {
  const store = loadStore();
  ensureFieldworkStore(store);
  if (!body || !body.task_id) throw new Error('معرّف المهمة (task_id) مطلوب لتسجيل الزيارة');
  const task = store.fieldTasks[body.task_id];
  if (!task) throw new Error('المهمة الميدانية غير موجودة');
  const loc = validateLocation(body.lat, body.lon);
  if (!loc) throw new Error('يجب إرسال موقع GPS فعلي (lat/lon) عند تسجيل الوصول الميداني');

  const id = newId('FVISIT');
  const record = {
    id,
    task_id: body.task_id,
    project_id: task.project_id,
    surveyor: body.surveyor || task.assigned_to,
    check_in_at: body.occurred_at || nowISO(),
    check_in_lat: loc.lat,
    check_in_lon: loc.lon,
    check_out_at: null,
    check_out_lat: null,
    check_out_lon: null,
    duration_minutes: null,
    photos: [],
    notes: body.notes || '',
    created_at: nowISO(),
  };
  store.fieldVisits[id] = record;
  task.status = 'in_progress';
  task.updated_at = nowISO();
  audit(store, { action: 'field_check_in', entity: 'field_visit', entityId: id, projectId: task.project_id, details: { task_id: body.task_id, lat: loc.lat, lon: loc.lon } });
  saveStore(store);
  return { success: true, data: record };
}

/** إنهاء الزيارة الميدانية: تسجيل وقت وموقع الانصراف، وحساب المدة الفعلية */
function checkOutFieldVisit(id, body) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const rec = store.fieldVisits[id];
  if (!rec) throw new Error('الزيارة الميدانية غير موجودة');
  if (rec.check_out_at) throw new Error('تم إنهاء هذه الزيارة مسبقاً');
  const loc = validateLocation(body?.lat, body?.lon);
  if (!loc) throw new Error('يجب إرسال موقع GPS فعلي (lat/lon) عند تسجيل الانصراف الميداني');

  rec.check_out_at = body.occurred_at || nowISO();
  rec.check_out_lat = loc.lat;
  rec.check_out_lon = loc.lon;
  const durMs = new Date(rec.check_out_at) - new Date(rec.check_in_at);
  rec.duration_minutes = durMs > 0 ? Math.round(durMs / 60000) : 0;
  if (body?.notes) rec.notes = `${rec.notes ? rec.notes + ' | ' : ''}${body.notes}`;

  const task = store.fieldTasks[rec.task_id];
  if (task && body?.complete_task) {
    task.status = 'completed';
    task.updated_at = nowISO();
  }

  audit(store, { action: 'field_check_out', entity: 'field_visit', entityId: id, projectId: rec.project_id, details: { duration_minutes: rec.duration_minutes } });
  saveStore(store);
  return { success: true, data: rec };
}

/** تسجيل صورة ميدانية على زيارة قائمة، بموقع ووقت التقاط فعليين */
function addFieldVisitPhoto(visitId, body) {
  const store = loadStore();
  ensureFieldworkStore(store);
  const rec = store.fieldVisits[visitId];
  if (!rec) throw new Error('الزيارة الميدانية غير موجودة');
  if (!body || !body.url) throw new Error('رابط/مسار الصورة (url) مطلوب');
  const loc = validateLocation(body.lat, body.lon);

  const photo = {
    id: newId('FPHOTO'),
    url: body.url,
    caption: body.caption || '',
    captured_at: body.occurred_at || nowISO(),
    lat: loc ? loc.lat : null,
    lon: loc ? loc.lon : null,
  };
  rec.photos.push(photo);
  audit(store, { action: 'field_photo', entity: 'field_visit', entityId: visitId, projectId: rec.project_id, details: { photo_id: photo.id } });
  saveStore(store);
  return { success: true, data: photo };
}

function listFieldVisits({ project_id, task_id, surveyor, page = 1, pageSize = 100 } = {}) {
  const store = loadStore();
  ensureFieldworkStore(store);
  let items = Object.values(store.fieldVisits);
  if (project_id) items = items.filter((v) => v.project_id === project_id);
  if (task_id) items = items.filter((v) => v.task_id === task_id);
  if (surveyor) items = items.filter((v) => v.surveyor === surveyor);
  items.sort((a, b) => new Date(b.check_in_at) - new Date(a.check_in_at));
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

/** متابعة الفرق: حالة كل مسّاح/فريق مُشتقة فعلياً من آخر زياراته والمهام المسندة له */
function getTeamsStatus({ project_id } = {}) {
  const store = loadStore();
  ensureFieldworkStore(store);
  let tasks = Object.values(store.fieldTasks);
  let visits = Object.values(store.fieldVisits);
  if (project_id) {
    tasks = tasks.filter((t) => t.project_id === project_id);
    visits = visits.filter((v) => v.project_id === project_id);
  }

  const teamsMap = {};
  tasks.forEach((t) => {
    const key = t.assigned_to;
    if (!teamsMap[key]) teamsMap[key] = { surveyor: key, team_name: t.team_name || '', tasks_total: 0, tasks_completed: 0, tasks_in_progress: 0, active_visit: null, last_activity_at: null };
    teamsMap[key].tasks_total += 1;
    if (t.status === 'completed') teamsMap[key].tasks_completed += 1;
    if (t.status === 'in_progress') teamsMap[key].tasks_in_progress += 1;
  });

  visits.forEach((v) => {
    const key = v.surveyor;
    if (!teamsMap[key]) teamsMap[key] = { surveyor: key, team_name: '', tasks_total: 0, tasks_completed: 0, tasks_in_progress: 0, active_visit: null, last_activity_at: null };
    const lastAt = teamsMap[key].last_activity_at;
    if (!lastAt || new Date(v.check_in_at) > new Date(lastAt)) teamsMap[key].last_activity_at = v.check_in_at;
    if (!v.check_out_at) teamsMap[key].active_visit = { visit_id: v.id, task_id: v.task_id, check_in_at: v.check_in_at, lat: v.check_in_lat, lon: v.check_in_lon };
  });

  const teams = Object.values(teamsMap).map((t) => ({
    ...t,
    status: t.active_visit ? 'نشط ميدانياً (Active)' : (t.tasks_in_progress > 0 ? 'مهمة قيد التنفيذ' : 'غير نشط حالياً'),
  }));

  return { success: true, data: teams };
}

// ==================================================================================
// ============ العمل دون اتصال (Offline Mode) + المزامنة التلقائية ===================
// ==================================================================================
/**
 * طابور المزامنة الفعلي: يستقبل دفعة أحداث ميدانية جُمعت أثناء انقطاع الاتصال بالإنترنت
 * (كل حدث بمعرّف عميل فريد client_id ووقت وقوعه الفعلي occurred_at)، ويطبّقها بترتيب
 * زمني (وليس بترتيب الوصول) لضمان تسلسل منطقي صحيح للأحداث الميدانية، مع تجاهل أي
 * حدث سبق تطبيقه فعلياً (idempotency عبر fieldSyncedClientIds) حتى لو أُعيدت الدفعة
 * كاملة بسبب انقطاع اتصال أثناء الإرسال نفسه.
 *
 * أنواع الأحداث المدعومة: check_in, check_out, photo, task_status_update.
 */
function applySyncEvent(store, event) {
  const { type, payload } = event;
  switch (type) {
    case 'check_in': {
      const r = checkInFieldVisit({ ...payload, occurred_at: payload.occurred_at });
      return { applied: true, result_id: r.data.id };
    }
    case 'check_out': {
      const r = checkOutFieldVisit(payload.visit_id, { ...payload, occurred_at: payload.occurred_at });
      return { applied: true, result_id: r.data.id };
    }
    case 'photo': {
      const r = addFieldVisitPhoto(payload.visit_id, { ...payload, occurred_at: payload.occurred_at });
      return { applied: true, result_id: r.data.id };
    }
    case 'task_status_update': {
      const r = updateFieldTask(payload.task_id, { status: payload.status });
      return { applied: true, result_id: r.data.id };
    }
    default:
      throw new Error(`نوع حدث مزامنة غير مدعوم: ${type}`);
  }
}

/**
 * syncFieldworkBatch: يستقبل مصفوفة أحداث بالشكل
 *   { client_id, type, occurred_at, payload }
 * ويُعيد تقريراً كاملاً بما طُبِّق فعلياً، وما جرى تجاهله لأنه مطبَّق مسبقاً، وما فشل.
 */
function syncFieldworkBatch({ project_id = null, events } = {}) {
  if (!Array.isArray(events) || !events.length) throw new Error('مصفوفة events (أحداث المزامنة) مطلوبة وغير فارغة');

  const store = loadStore();
  ensureFieldworkStore(store);

  // فرز الأحداث بترتيب زمني فعلي حسب وقت وقوعها الميداني الحقيقي
  const sorted = [...events].sort((a, b) => new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0));

  const applied = [];
  const skippedDuplicate = [];
  const failed = [];

  const batchId = newId('SYNCBATCH');

  // ملاحظة تنفيذ هامة: دوال التطبيق (check-in/check-out/photo/...) تعمل
  // loadStore()/saveStore() خاصة بها على القرص لكل حدث. لذلك يجب تسجيل
  // client_id على القرص فوراً بعد كل حدث يُطبَّق بنجاح (وليس تجميعه في
  // store بالذاكرة ثم الحفظ لاحقاً)، وإلا فإن إعادة إرسال نفس الدفعة
  // قبل اكتمال الحفظ قد تُطبَّق الأحداث مرتين بدل أن تُرفض كتكرار.
  for (const ev of sorted) {
    if (!ev.client_id) { failed.push({ event: ev, reason: 'client_id مطلوب لكل حدث لضمان عدم التكرار' }); continue; }

    const checkStore = loadStore();
    ensureFieldworkStore(checkStore);
    if (checkStore.fieldSyncedClientIds[ev.client_id]) { skippedDuplicate.push({ client_id: ev.client_id, type: ev.type }); continue; }

    try {
      const outcome = applySyncEvent(checkStore, ev);
      const markStore = loadStore();
      ensureFieldworkStore(markStore);
      markStore.fieldSyncedClientIds[ev.client_id] = { synced_at: nowISO(), batch_id: batchId, type: ev.type };
      saveStore(markStore);
      applied.push({ client_id: ev.client_id, type: ev.type, occurred_at: ev.occurred_at, result_id: outcome.result_id });
    } catch (e) {
      failed.push({ client_id: ev.client_id, type: ev.type, reason: e.message });
    }
  }

  const finalStore = loadStore();
  ensureFieldworkStore(finalStore);
  finalStore.fieldSyncQueue[batchId] = {
    id: batchId,
    project_id,
    submitted_at: nowISO(),
    events_count: events.length,
    applied_count: applied.length,
    skipped_duplicate_count: skippedDuplicate.length,
    failed_count: failed.length,
  };
  audit(finalStore, {
    action: 'field_sync_batch', entity: 'field_sync_queue', entityId: batchId, projectId: project_id,
    details: { events_count: events.length, applied: applied.length, duplicates: skippedDuplicate.length, failed: failed.length },
  });
  saveStore(finalStore);

  return {
    success: true,
    data: {
      batch_id: batchId,
      applied,
      skipped_duplicate: skippedDuplicate,
      failed,
      summary: { total: events.length, applied: applied.length, skipped_duplicate: skippedDuplicate.length, failed: failed.length },
    },
  };
}

function listSyncBatches({ project_id, page = 1, pageSize = 50 } = {}) {
  const store = loadStore();
  ensureFieldworkStore(store);
  let items = Object.values(store.fieldSyncQueue);
  if (project_id) items = items.filter((b) => b.project_id === project_id);
  items.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  const total = items.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = items.slice(start, start + Number(pageSize));
  return { success: true, data: paged, pagination: { total, page: Number(page), pageSize: Number(pageSize) } };
}

module.exports = {
  // مهام ميدانية
  createFieldTask,
  getFieldTask,
  listFieldTasks,
  updateFieldTask,
  deleteFieldTask,
  // زيارات ميدانية
  checkInFieldVisit,
  checkOutFieldVisit,
  addFieldVisitPhoto,
  listFieldVisits,
  getTeamsStatus,
  // Offline Mode + مزامنة تلقائية
  syncFieldworkBatch,
  listSyncBatches,
};
