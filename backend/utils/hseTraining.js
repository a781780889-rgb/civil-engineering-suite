/**
 * القسم الثامن - إدارة السلامة المهنية (HSE)
 * وحدة: إدارة التدريب (Training Management)
 * ======================================================================
 * تشمل: دورات السلامة، توعية الموظفين، اختبارات السلامة، شهادات التدريب،
 *        مواعيد التجديد، تقييم المتدربين، سجل الدورات.
 *
 * التخزين: ملف JSON مستقل (backend/data/hseTraining.json) بنفس نمط
 * hseManagement.js - بدون تبعيات خارجية.
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كل دورة (course) لها تعريف ثابت (مدة الصلاحية بالأيام، الحد الأدنى
 *    لدرجة النجاح) وسجلات حضور (sessions) وسجلات أفراد (enrollments).
 *  - كل enrollment يحسب فعلياً: تاريخ انتهاء صلاحية الشهادة = تاريخ
 *    الإتمام + مدة صلاحية الدورة، وحالة الشهادة (سارية/تنتهي قريباً/منتهية)
 *    تُحسب ديناميكياً من التاريخ الحالي وليست قيمة مخزَّنة يدوياً.
 *  - لا يمكن إصدار شهادة (pass) دون تسجيل درجة الاختبار ومطابقتها للحد
 *    الأدنى المطلوب للدورة.
 *  - دعم إعادة الاختبار (retake) مع سجل كامل للمحاولات.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'hseTraining.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      courses: {},       // { id: courseRecord }        (تعريف الدورات/التوعية)
      sessions: {},       // { id: sessionRecord }       (جلسات/مواعيد تنفيذ الدورة)
      enrollments: {},     // { id: enrollmentRecord }    (تسجيل متدرب في جلسة + النتيجة/الشهادة)
      auditLog: [],
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة التدريب: ' + e.message);
  }
  let migrated = false;
  for (const key of ['courses', 'sessions', 'enrollments']) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
  if (!store.auditLog) { store.auditLog = []; migrated = true; }
  if (migrated) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, details });
  if (store.auditLog.length > 5000) store.auditLog = store.auditLog.slice(-5000);
}

function generateCode(store, prefix) {
  store.seq = (store.seq || 0) + 1;
  return `${prefix}-${String(store.seq).padStart(5, '0')}`;
}

// ===================== ثوابت =====================

const COURSE_CATEGORIES = ['general_awareness', 'fire_safety', 'first_aid', 'working_at_height', 'confined_space', 'electrical_safety', 'ppe_usage', 'hazmat_handling', 'equipment_operation', 'emergency_response', 'other'];
const COURSE_CATEGORY_LABELS = {
  general_awareness: 'توعية عامة بالسلامة',
  fire_safety: 'السلامة من الحريق',
  first_aid: 'الإسعافات الأولية',
  working_at_height: 'العمل في الأماكن المرتفعة',
  confined_space: 'العمل في الأماكن المغلقة',
  electrical_safety: 'السلامة الكهربائية',
  ppe_usage: 'استخدام معدات الوقاية الشخصية',
  hazmat_handling: 'التعامل مع المواد الخطرة',
  equipment_operation: 'تشغيل المعدات',
  emergency_response: 'الاستجابة للطوارئ',
  other: 'أخرى',
};

const DELIVERY_METHODS = ['classroom', 'on_site_practical', 'online', 'toolbox_talk'];
const DELIVERY_METHOD_LABELS = {
  classroom: 'قاعة تدريب',
  on_site_practical: 'تدريب عملي في الموقع',
  online: 'عن بُعد',
  toolbox_talk: 'اجتماع سلامة قصير (Toolbox Talk)',
};

const COURSE_STATUSES = ['active', 'inactive'];
const COURSE_STATUS_LABELS = { active: 'نشطة', inactive: 'موقوفة' };

const SESSION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const SESSION_STATUS_LABELS = {
  scheduled: 'مجدولة', in_progress: 'قيد التنفيذ', completed: 'منتهية', cancelled: 'ملغاة',
};

const ENROLLMENT_RESULTS = ['pending', 'pass', 'fail', 'absent'];
const ENROLLMENT_RESULT_LABELS = { pending: 'قيد الانتظار', pass: 'ناجح', fail: 'راسب', absent: 'غائب' };

const CERTIFICATE_STATUSES = ['not_issued', 'valid', 'expiring_soon', 'expired'];
const CERTIFICATE_STATUS_LABELS = {
  not_issued: 'لم تُصدر', valid: 'سارية', expiring_soon: 'تنتهي قريباً', expired: 'منتهية',
};

const EXPIRING_SOON_THRESHOLD_DAYS = 30;

// ===================== دوال مساعدة للتحقق =====================

function validateCourseInput(body) {
  if (!body || !String(body.title || '').trim()) throw new Error('عنوان الدورة مطلوب');
  if (!body.category || !COURSE_CATEGORIES.includes(body.category)) {
    throw new Error(`فئة الدورة غير صحيحة: ${body.category}`);
  }
  if (body.delivery_method && !DELIVERY_METHODS.includes(body.delivery_method)) {
    throw new Error(`طريقة التنفيذ غير صحيحة: ${body.delivery_method}`);
  }
  const validityDays = Number(body.validity_days);
  if (body.validity_days !== undefined && body.validity_days !== null && (isNaN(validityDays) || validityDays < 0)) {
    throw new Error('مدة صلاحية الشهادة (بالأيام) يجب أن تكون رقماً موجباً');
  }
  const passScore = Number(body.pass_score);
  if (body.pass_score !== undefined && body.pass_score !== null && (isNaN(passScore) || passScore < 0 || passScore > 100)) {
    throw new Error('الحد الأدنى للنجاح يجب أن يكون بين 0 و100');
  }
}

// ===================== إدارة الدورات (Courses) =====================

function createCourse(body) {
  validateCourseInput(body);
  const store = loadStore();
  const id = newId('CRS');
  const code = generateCode(store, 'TRN');

  const record = {
    id,
    code,
    title: String(body.title).trim(),
    category: body.category,
    description: body.description || null,
    delivery_method: body.delivery_method && DELIVERY_METHODS.includes(body.delivery_method) ? body.delivery_method : 'classroom',
    duration_hours: body.duration_hours !== undefined ? Number(body.duration_hours) || 0 : null,
    validity_days: body.validity_days !== undefined && body.validity_days !== null ? Number(body.validity_days) : 365,
    pass_score: body.pass_score !== undefined && body.pass_score !== null ? Number(body.pass_score) : 70,
    mandatory: body.mandatory === true,
    target_roles: Array.isArray(body.target_roles) ? body.target_roles : [],
    status: body.status && COURSE_STATUSES.includes(body.status) ? body.status : 'active',
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.courses[id] = record;
  audit(store, { action: 'create', entity: 'training_course', entityId: id, details: { title: record.title, code } });
  saveStore(store);
  return { success: true, data: record };
}

function listCourses(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.courses).filter(c => c.is_active !== false);
  if (filters.category) items = items.filter(c => c.category === filters.category);
  if (filters.status) items = items.filter(c => c.status === filters.status);
  if (filters.mandatory !== undefined) items = items.filter(c => c.mandatory === (filters.mandatory === true || filters.mandatory === 'true'));
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(c => (c.title || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q));
  }
  items = items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // عدد المسجلين لكل دورة (عبر جميع الجلسات)
  const sessionsByCourse = {};
  for (const s of Object.values(store.sessions)) {
    if (s.is_active === false) continue;
    (sessionsByCourse[s.course_id] = sessionsByCourse[s.course_id] || []).push(s.id);
  }
  const enrollmentCountBySession = {};
  for (const e of Object.values(store.enrollments)) {
    if (e.is_active === false) continue;
    enrollmentCountBySession[e.session_id] = (enrollmentCountBySession[e.session_id] || 0) + 1;
  }
  items = items.map(c => {
    const sessionIds = sessionsByCourse[c.id] || [];
    const enrolledCount = sessionIds.reduce((sum, sid) => sum + (enrollmentCountBySession[sid] || 0), 0);
    return { ...c, sessions_count: sessionIds.length, enrolled_count: enrolledCount };
  });

  return { success: true, data: items, count: items.length };
}

function getCourse(id) {
  const store = loadStore();
  const record = store.courses[id];
  if (!record) throw new Error('الدورة غير موجودة');
  const sessions = Object.values(store.sessions)
    .filter(s => s.course_id === id && s.is_active !== false)
    .sort((a, b) => (b.session_date || '').localeCompare(a.session_date || ''));
  return { success: true, data: { ...record, sessions } };
}

function updateCourse(id, updates) {
  const store = loadStore();
  const record = store.courses[id];
  if (!record) throw new Error('الدورة غير موجودة');

  if (updates.category && !COURSE_CATEGORIES.includes(updates.category)) {
    throw new Error(`فئة الدورة غير صحيحة: ${updates.category}`);
  }
  if (updates.delivery_method && !DELIVERY_METHODS.includes(updates.delivery_method)) {
    throw new Error(`طريقة التنفيذ غير صحيحة: ${updates.delivery_method}`);
  }
  if (updates.status && !COURSE_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الدورة غير صحيحة: ${updates.status}`);
  }
  if (updates.validity_days !== undefined && updates.validity_days !== null) {
    const v = Number(updates.validity_days);
    if (isNaN(v) || v < 0) throw new Error('مدة صلاحية الشهادة يجب أن تكون رقماً موجباً');
  }
  if (updates.pass_score !== undefined && updates.pass_score !== null) {
    const v = Number(updates.pass_score);
    if (isNaN(v) || v < 0 || v > 100) throw new Error('الحد الأدنى للنجاح يجب أن يكون بين 0 و100');
  }

  const blocked = ['id', 'code', 'created_at'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();

  audit(store, { action: 'update', entity: 'training_course', entityId: id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteCourse(id) {
  const store = loadStore();
  const record = store.courses[id];
  if (!record) throw new Error('الدورة غير موجودة');
  const hasActiveSessions = Object.values(store.sessions).some(s => s.course_id === id && s.is_active !== false && s.status !== 'cancelled');
  if (hasActiveSessions) {
    throw new Error('لا يمكن حذف الدورة لوجود جلسات مرتبطة بها؛ يمكن إيقافها بدلاً من ذلك (status = inactive)');
  }
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'training_course', entityId: id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ===================== إدارة الجلسات (Sessions) =====================

function validateSessionInput(body, course) {
  if (!body.session_date) throw new Error('تاريخ الجلسة مطلوب');
  if (!body.project_id) throw new Error('المشروع مطلوب');
  if (body.status && !SESSION_STATUSES.includes(body.status)) {
    throw new Error(`حالة الجلسة غير صحيحة: ${body.status}`);
  }
}

function createSession(body) {
  const store = loadStore();
  const course = store.courses[body.course_id];
  if (!course) throw new Error('الدورة المرتبطة غير موجودة');
  validateSessionInput(body, course);

  const id = newId('SES');
  const code = generateCode(store, 'SESS');

  const record = {
    id,
    code,
    course_id: body.course_id,
    project_id: body.project_id,
    session_date: body.session_date,
    location: body.location || null,
    trainer_name: body.trainer_name || null,
    trainer_organization: body.trainer_organization || null,
    status: body.status && SESSION_STATUSES.includes(body.status) ? body.status : 'scheduled',
    notes: body.notes || null,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.sessions[id] = record;
  audit(store, { action: 'create', entity: 'training_session', entityId: id, projectId: body.project_id, details: { code, courseId: body.course_id } });
  saveStore(store);
  return { success: true, data: record };
}

function listSessions(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.sessions).filter(s => s.is_active !== false);
  if (filters.courseId) items = items.filter(s => s.course_id === filters.courseId);
  if (filters.projectId) items = items.filter(s => s.project_id === filters.projectId);
  if (filters.status) items = items.filter(s => s.status === filters.status);
  if (filters.dateFrom) items = items.filter(s => s.session_date >= filters.dateFrom);
  if (filters.dateTo) items = items.filter(s => s.session_date <= filters.dateTo);
  items = items.sort((a, b) => (b.session_date || '').localeCompare(a.session_date || ''));

  const enrollmentsBySession = {};
  for (const e of Object.values(store.enrollments)) {
    if (e.is_active === false) continue;
    (enrollmentsBySession[e.session_id] = enrollmentsBySession[e.session_id] || []).push(e);
  }
  items = items.map(s => {
    const enrollments = enrollmentsBySession[s.id] || [];
    return {
      ...s,
      course_title: store.courses[s.course_id] ? store.courses[s.course_id].title : null,
      enrolled_count: enrollments.length,
      passed_count: enrollments.filter(e => e.result === 'pass').length,
      failed_count: enrollments.filter(e => e.result === 'fail').length,
    };
  });

  return { success: true, data: items, count: items.length };
}

function getSession(id) {
  const store = loadStore();
  const record = store.sessions[id];
  if (!record) throw new Error('الجلسة التدريبية غير موجودة');
  const enrollments = Object.values(store.enrollments)
    .filter(e => e.session_id === id && e.is_active !== false)
    .sort((a, b) => (a.trainee_name || '').localeCompare(b.trainee_name || ''));
  return { success: true, data: { ...record, course: store.courses[record.course_id] || null, enrollments } };
}

function updateSession(id, updates) {
  const store = loadStore();
  const record = store.sessions[id];
  if (!record) throw new Error('الجلسة التدريبية غير موجودة');

  if (updates.status && !SESSION_STATUSES.includes(updates.status)) {
    throw new Error(`حالة الجلسة غير صحيحة: ${updates.status}`);
  }
  // منع إتمام جلسة لا يوجد بها أي مسجَّل
  if (updates.status === 'completed' && record.status !== 'completed') {
    const hasEnrollments = Object.values(store.enrollments).some(e => e.session_id === id && e.is_active !== false);
    if (!hasEnrollments) throw new Error('لا يمكن إنهاء الجلسة دون تسجيل متدربين فيها');
  }

  const blocked = ['id', 'code', 'created_at', 'course_id'];
  for (const [k, v] of Object.entries(updates)) {
    if (blocked.includes(k)) continue;
    record[k] = v;
  }
  record.updated_at = nowISO();

  audit(store, { action: 'update', entity: 'training_session', entityId: id, projectId: record.project_id, details: { changedFields: Object.keys(updates) } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteSession(id) {
  const store = loadStore();
  const record = store.sessions[id];
  if (!record) throw new Error('الجلسة التدريبية غير موجودة');
  record.is_active = false;
  record.status = 'cancelled';
  record.updated_at = nowISO();
  // إلغاء كل تسجيلات المتدربين المرتبطة
  for (const e of Object.values(store.enrollments)) {
    if (e.session_id === id && e.is_active !== false) {
      e.is_active = false;
      e.updated_at = nowISO();
    }
  }
  audit(store, { action: 'delete', entity: 'training_session', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ===================== إدارة تسجيل المتدربين والشهادات (Enrollments) =====================

function computeCertificateStatus(enrollment, course) {
  if (!enrollment || enrollment.result !== 'pass') return 'not_issued';
  if (!enrollment.certificate_expiry_date) return 'valid';
  const daysLeft = daysBetween(enrollment.certificate_expiry_date, nowISO().slice(0, 10));
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRING_SOON_THRESHOLD_DAYS) return 'expiring_soon';
  return 'valid';
}

function enrichEnrollment(record, store) {
  const course = store.courses[record.course_id] || null;
  return {
    ...record,
    certificate_status: computeCertificateStatus(record, course),
    days_until_expiry: record.certificate_expiry_date ? daysBetween(record.certificate_expiry_date, nowISO().slice(0, 10)) : null,
  };
}

function createEnrollment(body) {
  const store = loadStore();
  const session = store.sessions[body.session_id];
  if (!session) throw new Error('الجلسة التدريبية غير موجودة');
  const course = store.courses[session.course_id];
  if (!course) throw new Error('الدورة المرتبطة غير موجودة');
  if (!String(body.trainee_name || '').trim()) throw new Error('اسم المتدرب مطلوب');

  const alreadyEnrolled = Object.values(store.enrollments).some(
    e => e.session_id === body.session_id && e.is_active !== false &&
      (e.employee_id ? e.employee_id === body.employee_id : e.trainee_name === body.trainee_name)
  );
  if (alreadyEnrolled) throw new Error('هذا المتدرب مسجَّل بالفعل في هذه الجلسة');

  const id = newId('ENR');
  const code = generateCode(store, 'ENRL');

  const record = {
    id,
    code,
    session_id: body.session_id,
    course_id: session.course_id,
    project_id: session.project_id,
    employee_id: body.employee_id || null,
    trainee_name: String(body.trainee_name).trim(),
    trainee_role: body.trainee_role || null,
    attendance: body.attendance !== undefined ? !!body.attendance : true,
    test_score: null,
    result: 'pending',
    trainer_evaluation: body.trainer_evaluation || null,
    completion_date: null,
    certificate_expiry_date: null,
    certificate_no: null,
    attempts: [],
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  store.enrollments[id] = record;
  audit(store, { action: 'create', entity: 'training_enrollment', entityId: id, projectId: session.project_id, details: { code, sessionId: body.session_id, trainee: record.trainee_name } });
  saveStore(store);
  return { success: true, data: enrichEnrollment(record, store) };
}

function listEnrollments(filters = {}) {
  const store = loadStore();
  let items = Object.values(store.enrollments).filter(e => e.is_active !== false);
  if (filters.sessionId) items = items.filter(e => e.session_id === filters.sessionId);
  if (filters.courseId) items = items.filter(e => e.course_id === filters.courseId);
  if (filters.projectId) items = items.filter(e => e.project_id === filters.projectId);
  if (filters.employeeId) items = items.filter(e => e.employee_id === filters.employeeId);
  if (filters.result) items = items.filter(e => e.result === filters.result);
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    items = items.filter(e => (e.trainee_name || '').toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
  }
  items = items.map(e => enrichEnrollment(e, store));
  if (filters.certificateStatus) items = items.filter(e => e.certificate_status === filters.certificateStatus);
  items = items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return { success: true, data: items, count: items.length };
}

function getEnrollment(id) {
  const store = loadStore();
  const record = store.enrollments[id];
  if (!record) throw new Error('تسجيل المتدرب غير موجود');
  return { success: true, data: enrichEnrollment(record, store) };
}

/**
 * تسجيل نتيجة اختبار/تقييم لمتدرب.
 * لا يمكن أن تكون النتيجة "ناجح" إلا إذا كانت الدرجة >= الحد الأدنى المطلوب للدورة.
 * عند النجاح: يُحسب تاريخ انتهاء الشهادة فعلياً = تاريخ الإتمام + مدة صلاحية الدورة.
 */
function recordEnrollmentResult(id, body) {
  const store = loadStore();
  const record = store.enrollments[id];
  if (!record) throw new Error('تسجيل المتدرب غير موجود');
  const course = store.courses[record.course_id];
  if (!course) throw new Error('الدورة المرتبطة غير موجودة');

  if (body.attendance === false) {
    record.attendance = false;
    record.result = 'absent';
    record.test_score = null;
    record.completion_date = null;
    record.certificate_expiry_date = null;
    record.certificate_no = null;
    record.updated_at = nowISO();
    audit(store, { action: 'record_result', entity: 'training_enrollment', entityId: id, projectId: record.project_id, details: { result: 'absent' } });
    saveStore(store);
    return { success: true, data: enrichEnrollment(record, store) };
  }

  const score = Number(body.test_score);
  if (isNaN(score) || score < 0 || score > 100) {
    throw new Error('درجة الاختبار مطلوبة ويجب أن تكون بين 0 و100');
  }

  const completionDate = body.completion_date || nowISO().slice(0, 10);
  const passed = score >= Number(course.pass_score || 70);

  const attempt = {
    id: newId('ATT'),
    date: completionDate,
    score,
    passed,
    evaluator: body.evaluator || null,
  };
  record.attempts.push(attempt);
  record.attendance = true;
  record.test_score = score;
  record.trainer_evaluation = body.trainer_evaluation !== undefined ? body.trainer_evaluation : record.trainer_evaluation;

  if (passed) {
    record.result = 'pass';
    record.completion_date = completionDate;
    record.certificate_expiry_date = course.validity_days ? addDays(completionDate, course.validity_days) : null;
    record.certificate_no = record.certificate_no || generateCode(store, 'CERT');
  } else {
    record.result = 'fail';
    record.completion_date = null;
    record.certificate_expiry_date = null;
    record.certificate_no = null;
  }

  record.updated_at = nowISO();
  audit(store, {
    action: 'record_result', entity: 'training_enrollment', entityId: id, projectId: record.project_id,
    details: { result: record.result, score, passScoreRequired: course.pass_score },
  });
  saveStore(store);
  return { success: true, data: enrichEnrollment(record, store) };
}

/**
 * إعادة اختبار لمتدرب راسب - يعيد الحالة إلى "قيد الانتظار" مع الاحتفاظ بسجل المحاولة السابقة.
 */
function retakeEnrollment(id) {
  const store = loadStore();
  const record = store.enrollments[id];
  if (!record) throw new Error('تسجيل المتدرب غير موجود');
  if (record.result !== 'fail') throw new Error('إعادة الاختبار متاحة فقط للمتدربين الراسبين');
  record.result = 'pending';
  record.test_score = null;
  record.updated_at = nowISO();
  audit(store, { action: 'retake', entity: 'training_enrollment', entityId: id, projectId: record.project_id, details: { attemptsSoFar: record.attempts.length } });
  saveStore(store);
  return { success: true, data: enrichEnrollment(record, store) };
}

function deleteEnrollment(id) {
  const store = loadStore();
  const record = store.enrollments[id];
  if (!record) throw new Error('تسجيل المتدرب غير موجود');
  record.is_active = false;
  record.updated_at = nowISO();
  audit(store, { action: 'delete', entity: 'training_enrollment', entityId: id, projectId: record.project_id, details: { code: record.code } });
  saveStore(store);
  return { success: true, data: { id, deleted: true } };
}

// ===================== شهادات منتهية / على وشك الانتهاء =====================

function getExpiringCertificates(filters = {}) {
  const store = loadStore();
  const withinDays = filters.withinDays !== undefined ? Number(filters.withinDays) : EXPIRING_SOON_THRESHOLD_DAYS;
  let items = Object.values(store.enrollments)
    .filter(e => e.is_active !== false && e.result === 'pass' && e.certificate_expiry_date)
    .map(e => enrichEnrollment(e, store))
    .filter(e => e.days_until_expiry !== null && e.days_until_expiry <= withinDays);

  if (filters.projectId) items = items.filter(e => e.project_id === filters.projectId);
  items = items.sort((a, b) => (a.days_until_expiry || 0) - (b.days_until_expiry || 0));

  return {
    success: true,
    data: items,
    count: items.length,
    expired_count: items.filter(e => e.certificate_status === 'expired').length,
    expiring_soon_count: items.filter(e => e.certificate_status === 'expiring_soon').length,
  };
}

// ===================== لوحة إحصائيات التدريب =====================

function getTrainingDashboard(filters = {}) {
  const store = loadStore();
  const projectId = filters.projectId || null;

  let courses = Object.values(store.courses).filter(c => c.is_active !== false);
  let sessions = Object.values(store.sessions).filter(s => s.is_active !== false);
  let enrollments = Object.values(store.enrollments).filter(e => e.is_active !== false).map(e => enrichEnrollment(e, store));

  if (projectId) {
    sessions = sessions.filter(s => s.project_id === projectId);
    enrollments = enrollments.filter(e => e.project_id === projectId);
  }

  const totalEnrollments = enrollments.length;
  const passed = enrollments.filter(e => e.result === 'pass').length;
  const failed = enrollments.filter(e => e.result === 'fail').length;
  const pending = enrollments.filter(e => e.result === 'pending').length;
  const absent = enrollments.filter(e => e.result === 'absent').length;

  const evaluatedCount = passed + failed;
  const passRate = evaluatedCount > 0 ? Math.round((passed / evaluatedCount) * 1000) / 10 : null;

  const expiring = getExpiringCertificates({ projectId, withinDays: EXPIRING_SOON_THRESHOLD_DAYS });

  return {
    success: true,
    data: {
      total_courses: courses.length,
      active_courses: courses.filter(c => c.status === 'active').length,
      mandatory_courses: courses.filter(c => c.mandatory).length,

      total_sessions: sessions.length,
      scheduled_sessions: sessions.filter(s => s.status === 'scheduled').length,
      completed_sessions: sessions.filter(s => s.status === 'completed').length,

      total_enrollments: totalEnrollments,
      passed,
      failed,
      pending,
      absent,
      pass_rate_percent: passRate,

      valid_certificates: enrollments.filter(e => e.certificate_status === 'valid').length,
      expiring_soon_certificates: expiring.expiring_soon_count,
      expired_certificates: expiring.expired_count,

      by_category: courses.reduce((acc, c) => {
        acc[c.category] = (acc[c.category] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

module.exports = {
  // ثوابت
  COURSE_CATEGORIES,
  COURSE_CATEGORY_LABELS,
  DELIVERY_METHODS,
  DELIVERY_METHOD_LABELS,
  COURSE_STATUSES,
  COURSE_STATUS_LABELS,
  SESSION_STATUSES,
  SESSION_STATUS_LABELS,
  ENROLLMENT_RESULTS,
  ENROLLMENT_RESULT_LABELS,
  CERTIFICATE_STATUSES,
  CERTIFICATE_STATUS_LABELS,
  EXPIRING_SOON_THRESHOLD_DAYS,

  // الدورات
  createCourse,
  listCourses,
  getCourse,
  updateCourse,
  deleteCourse,

  // الجلسات
  createSession,
  listSessions,
  getSession,
  updateSession,
  deleteSession,

  // تسجيل المتدربين والشهادات
  createEnrollment,
  listEnrollments,
  getEnrollment,
  recordEnrollmentResult,
  retakeEnrollment,
  deleteEnrollment,
  getExpiringCertificates,

  // لوحة الإحصائيات
  getTrainingDashboard,
};
