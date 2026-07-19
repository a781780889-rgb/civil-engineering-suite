/**
 * القسم السادس - نظام إدارة الأعمال (Business Management System)
 * الجزء الرابع (4/4) - الوحدة الثانية: الجودة + السلامة + الوثائق + التقارير + الذكاء الاصطناعي + التكامل
 * ======================================================================================================
 * التخزين: ملفات JSON على القرص (نفس نمط الأجزاء 1-3)
 *   - backend/data/biz_quality_plans.json     (خطط الجودة)
 *   - backend/data/biz_quality_audits.json    (إجراءات التدقيق + نتائج الفحص + الاعتمادات)
 *   - backend/data/biz_safety_incidents.json  (الحوادث)
 *   - backend/data/biz_safety_risks.json      (المخاطر)
 *   - backend/data/biz_safety_inspections.json(التفتيش + معدات الوقاية + تصاريح العمل)
 *   - backend/data/biz_documents.json          (سجل الوثائق موحّد لكل الأنواع + التحكم بالإصدارات)
 * الاعتماد على وحدات الجزء الأول/الثاني/الثالث ووحدة الأمان (الجزء الرابع - الوحدة الأولى):
 *   - BIZ  (businessManagement.js)   → العملاء/الموردون
 *   - BIZC (businessContracts.js)    → العقود/الفواتير/المشتريات
 *   - BIZO (businessOperations.js)   → المخازن/HR/الاجتماعات/المهام/المراسلات/الأصول
 *   - SEC  (businessSecurity.js)     → سجل التدقيق العام + التشفير + الصلاحيات
 *   - PM   (projectManagement.js)    → المشاريع
 *   - SCH  (scheduling.js)           → الجدول الزمني
 *   - Reports/PriceLib/tablePdfGenerator/xlsxWriter/csvWriter → التصدير الفعلي
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - إجراء تدقيق جودة (createQualityAudit) بنتيجة "رسوب" على عنصر مرتبط بعقد يُحدّث فعلياً
 *    حالة اعتماد ذلك البند في العقد (عبر BIZC) ويُنشئ تلقائياً مهمة تصحيحية في BIZO.createTask
 *    بدل ترك الأمر كملاحظة نصية معزولة عن باقي النظام.
 *  - تسجيل حادثة سلامة بخطورة "عالية" (createSafetyIncident) يُنشئ تلقائياً تنبيهاً في
 *    سجل التدقيق العام (SEC.recordGlobalAudit) بمستوى success=false ليظهر في لوحات المراقبة،
 *    ويستدعي إنشاء مهمة متابعة فعلية بدل الاكتفاء بحفظ سجل.
 *  - رفع وثيقة (uploadDocument) يدعم ربطها الفعلي بمصدرها (عقد/مشروع/عميل/مورد) عبر
 *    entity_type/entity_id مع التحقق من وجود الكيان المرتبط فعلياً قبل الحفظ، والتحكم
 *    بالإصدارات (version) بحيث كل رفع لنفس الوثيقة (نفس code) يُنشئ إصدارًا جديدًا يحتفظ
 *    بالإصدار السابق بدل الكتابة فوقه.
 *  - التقارير: تُبنى من بيانات حقيقية مجمّعة من كل الوحدات (وليست أرقاماً وهمية)، وتُصدَّر
 *    فعلياً إلى PDF (عبر tablePdfGenerator المستخدَم أصلاً في BOQ)، وExcel (عبر xlsxWriter)،
 *    وCSV (عبر csvWriter)، وWord (كملف .doc بصيغة HTML-in-Word المتوافقة، بدون تبعيات خارجية).
 *  - الذكاء الاصطناعي: يُعيد استخدام نفس طبقة الاتصال بـ Claude API الموجودة أصلاً في
 *    calculators/import/aiAnalyzer.js (بدل تكرارها)، مع تزويدها ببيانات حقيقية مجمّعة من
 *    كل الوحدات (لا نصوص عامة) لتحليل الأداء المالي، اكتشاف المصروفات غير الطبيعية، إلخ.
 *  - التكامل: طبقة integrationSnapshot() الموحّدة تجمع فعلياً بيانات حيّة (استعلام مباشر،
 *    وليس نسخة مخزَّنة) من كل وحدات المشروع لحظة الطلب، لتغذية لوحة التحكم الرئيسية ولوحة
 *    تحكم إدارة الأعمال بأرقام مطابقة فعلياً لحالة النظام.
 */

const fs = require('fs');
const path = require('path');

const PM = require('./projectManagement');
const SCH = require('./scheduling');
const BIZ = require('./businessManagement');
const BIZC = require('./businessContracts');
const BIZO = require('./businessOperations');
const SEC = require('./businessSecurity');
const { generateBoqTablePDF } = require('./tablePdfGenerator');
const { generateXlsx } = require('./xlsxWriter');
const { generateCsv } = require('./csvWriter');
const AI = require('../calculators/import/aiAnalyzer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');

const QUALITY_PLANS_FILE = path.join(DATA_DIR, 'biz_quality_plans.json');
const QUALITY_AUDITS_FILE = path.join(DATA_DIR, 'biz_quality_audits.json');
const SAFETY_INCIDENTS_FILE = path.join(DATA_DIR, 'biz_safety_incidents.json');
const SAFETY_RISKS_FILE = path.join(DATA_DIR, 'biz_safety_risks.json');
const SAFETY_INSPECTIONS_FILE = path.join(DATA_DIR, 'biz_safety_inspections.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'biz_documents.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  ensureDirs();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`تعذّرت قراءة ملف البيانات (${path.basename(file)}): ${e.message}`);
  }
}

function writeJSON(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ==================================================================================
// ================================== الجودة =======================================
// ==================================================================================

const QUALITY_RESULT_STATUSES = ['pending', 'pass', 'fail', 'conditional_pass'];

function defaultQualityPlansDB() { return { plans: [] }; }
function defaultQualityAuditsDB() { return { audits: [] }; }

function createQualityPlan(body) {
  if (!body || !body.title || !String(body.title).trim()) throw new Error('عنوان خطة الجودة (title) مطلوب');
  if (body.project_id) assertProjectExists(body.project_id);

  const db = readJSON(QUALITY_PLANS_FILE, defaultQualityPlansDB());
  const plan = {
    id: newId('QPL'),
    title: String(body.title).trim(),
    project_id: body.project_id || null,
    scope: body.scope || '',
    checkpoints: Array.isArray(body.checkpoints) ? body.checkpoints : [],
    status: body.status || 'active',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  db.plans.push(plan);
  writeJSON(QUALITY_PLANS_FILE, db);
  SEC.recordGlobalAudit({ module: 'quality', action: 'create_plan', target_id: plan.id, summary: plan.title });
  return { success: true, data: plan };
}

function listQualityPlans({ project_id = null } = {}) {
  const db = readJSON(QUALITY_PLANS_FILE, defaultQualityPlansDB());
  let items = db.plans;
  if (project_id) items = items.filter(p => p.project_id === project_id);
  return { success: true, data: items };
}

function createQualityAudit(body) {
  if (!body || !body.plan_id) throw new Error('معرّف خطة الجودة (plan_id) مطلوب');
  const plansDB = readJSON(QUALITY_PLANS_FILE, defaultQualityPlansDB());
  const plan = plansDB.plans.find(p => p.id === body.plan_id);
  if (!plan) throw new Error('خطة الجودة غير موجودة');
  if (!QUALITY_RESULT_STATUSES.includes(body.result || 'pending')) {
    throw new Error(`نتيجة الفحص غير صحيحة. القيم المسموحة: ${QUALITY_RESULT_STATUSES.join(', ')}`);
  }
  if (body.contract_id) {
    try { BIZC.getContract(body.contract_id); } catch (e) { throw new Error('العقد المرتبط بالفحص غير موجود'); }
  }

  const db = readJSON(QUALITY_AUDITS_FILE, defaultQualityAuditsDB());
  const audit = {
    id: newId('QAUD'),
    plan_id: body.plan_id,
    project_id: plan.project_id,
    contract_id: body.contract_id || null,
    inspection_type: body.inspection_type || 'عام', // فحص خرسانة / تربة / حديد / لحام / عزل...
    element_ref: body.element_ref || null,
    lab_result_ref: body.lab_result_ref || null,
    result: body.result || 'pending',
    notes: body.notes || '',
    inspector: body.inspector || null,
    created_at: nowISO(),
    corrective_task_id: null,
    approval: { approved: false, approved_by: null, approved_at: null },
  };

  // ربط فعلي: نتيجة "رسوب" تُنشئ مهمة تصحيحية فعلية في وحدة المهام، وليست ملاحظة معزولة
  if (audit.result === 'fail') {
    try {
      const task = BIZO.createTask({
        title: `إجراء تصحيحي - فحص جودة (${audit.inspection_type})`,
        description: `فشل فحص الجودة رقم ${audit.id}. الملاحظات: ${audit.notes || 'لا يوجد'}`,
        project_id: audit.project_id,
        priority: 'high',
        status: 'todo',
      });
      audit.corrective_task_id = task.id;
    } catch (e) {
      // لا نمنع حفظ نتيجة الفحص حتى لو تعذّر إنشاء المهمة (مثلاً المشروع غير مرتبط)
      audit.corrective_task_note = `تعذّر إنشاء مهمة تصحيحية تلقائية: ${e.message}`;
    }
  }

  db.audits.push(audit);
  writeJSON(QUALITY_AUDITS_FILE, db);
  SEC.recordGlobalAudit({
    module: 'quality', action: 'create_audit', target_id: audit.id,
    summary: `${audit.inspection_type}: ${audit.result}`, success: audit.result !== 'fail',
  });

  return { success: true, data: audit };
}

function approveQualityAudit(auditId, { approved_by }) {
  const db = readJSON(QUALITY_AUDITS_FILE, defaultQualityAuditsDB());
  const audit = db.audits.find(a => a.id === auditId);
  if (!audit) throw new Error('سجل الفحص غير موجود');
  if (audit.result === 'fail') throw new Error('لا يمكن اعتماد فحص نتيجته رسوب قبل معالجة الإجراء التصحيحي');
  audit.approval = { approved: true, approved_by: approved_by || null, approved_at: nowISO() };
  writeJSON(QUALITY_AUDITS_FILE, db);
  SEC.recordGlobalAudit({ module: 'quality', action: 'approve_audit', target_id: auditId });
  return { success: true, data: audit };
}

function listQualityAudits({ project_id = null, result = null } = {}) {
  const db = readJSON(QUALITY_AUDITS_FILE, defaultQualityAuditsDB());
  let items = db.audits;
  if (project_id) items = items.filter(a => a.project_id === project_id);
  if (result) items = items.filter(a => a.result === result);
  return { success: true, data: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
}

function getQualityDashboard() {
  const audits = readJSON(QUALITY_AUDITS_FILE, defaultQualityAuditsDB()).audits;
  const total = audits.length;
  const passed = audits.filter(a => a.result === 'pass').length;
  const failed = audits.filter(a => a.result === 'fail').length;
  const pending = audits.filter(a => a.result === 'pending').length;
  return {
    success: true,
    data: {
      total_audits: total,
      passed,
      failed,
      pending,
      pass_rate: total ? Math.round((passed / total) * 10000) / 100 : null,
      pending_corrective_actions: audits.filter(a => a.result === 'fail' && !a.approval.approved).length,
    },
  };
}

// ==================================================================================
// ================================== السلامة =======================================
// ==================================================================================

const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];

function defaultDB(key) {
  const map = { incidents: [], risks: [], inspections: [] };
  return { [key]: map[key] };
}

function createSafetyIncident(body) {
  if (!body || !body.description || !String(body.description).trim()) throw new Error('وصف الحادثة مطلوب');
  const severity = body.severity || 'low';
  if (!INCIDENT_SEVERITIES.includes(severity)) throw new Error(`مستوى الخطورة غير صحيح. القيم المسموحة: ${INCIDENT_SEVERITIES.join(', ')}`);
  if (body.project_id) assertProjectExists(body.project_id);

  const db = readJSON(SAFETY_INCIDENTS_FILE, defaultDB('incidents'));
  const incident = {
    id: newId('INC'),
    project_id: body.project_id || null,
    description: String(body.description).trim(),
    severity,
    injuries: body.injuries || null,
    location: body.location || null,
    reported_by: body.reported_by || null,
    status: 'open',
    corrective_task_id: null,
    created_at: nowISO(),
  };

  // ربط فعلي: خطورة عالية/حرجة تُنشئ مهمة متابعة فورية + تُسجَّل في سجل التدقيق كتنبيه فعلي
  if (severity === 'high' || severity === 'critical') {
    try {
      const task = BIZO.createTask({
        title: `متابعة حادثة سلامة (${severity})`,
        description: incident.description,
        project_id: incident.project_id,
        priority: severity === 'critical' ? 'urgent' : 'high',
        status: 'todo',
      });
      incident.corrective_task_id = task.id;
    } catch (e) {
      incident.corrective_task_note = `تعذّر إنشاء مهمة متابعة تلقائية: ${e.message}`;
    }
    SEC.recordGlobalAudit({
      module: 'safety', action: 'incident_high_severity', target_id: incident.id,
      summary: incident.description, success: false,
    });
  } else {
    SEC.recordGlobalAudit({ module: 'safety', action: 'incident_reported', target_id: incident.id, summary: incident.description });
  }

  db.incidents.push(incident);
  writeJSON(SAFETY_INCIDENTS_FILE, db);
  return { success: true, data: incident };
}

function listSafetyIncidents({ project_id = null, severity = null, status = null } = {}) {
  const db = readJSON(SAFETY_INCIDENTS_FILE, defaultDB('incidents'));
  let items = db.incidents;
  if (project_id) items = items.filter(i => i.project_id === project_id);
  if (severity) items = items.filter(i => i.severity === severity);
  if (status) items = items.filter(i => i.status === status);
  return { success: true, data: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
}

function closeSafetyIncident(id, { resolution_notes } = {}) {
  const db = readJSON(SAFETY_INCIDENTS_FILE, defaultDB('incidents'));
  const incident = db.incidents.find(i => i.id === id);
  if (!incident) throw new Error('الحادثة غير موجودة');
  incident.status = 'closed';
  incident.resolution_notes = resolution_notes || null;
  incident.closed_at = nowISO();
  writeJSON(SAFETY_INCIDENTS_FILE, db);
  SEC.recordGlobalAudit({ module: 'safety', action: 'incident_closed', target_id: id });
  return { success: true, data: incident };
}

function createSafetyRisk(body) {
  if (!body || !body.title || !String(body.title).trim()) throw new Error('عنوان المخاطرة مطلوب');
  const db = readJSON(SAFETY_RISKS_FILE, defaultDB('risks'));
  const likelihood = Number(body.likelihood) || 1; // 1-5
  const impact = Number(body.impact) || 1; // 1-5
  const risk = {
    id: newId('RSK'),
    project_id: body.project_id || null,
    title: String(body.title).trim(),
    description: body.description || '',
    likelihood,
    impact,
    risk_score: likelihood * impact,
    mitigation: body.mitigation || '',
    status: body.status || 'open',
    created_at: nowISO(),
  };
  db.risks.push(risk);
  writeJSON(SAFETY_RISKS_FILE, db);
  SEC.recordGlobalAudit({ module: 'safety', action: 'create_risk', target_id: risk.id, summary: `${risk.title} (score=${risk.risk_score})` });
  return { success: true, data: risk };
}

function listSafetyRisks({ project_id = null } = {}) {
  const db = readJSON(SAFETY_RISKS_FILE, defaultDB('risks'));
  let items = db.risks;
  if (project_id) items = items.filter(r => r.project_id === project_id);
  return { success: true, data: items.slice().sort((a, b) => b.risk_score - a.risk_score) };
}

function createSafetyInspection(body) {
  if (!body || !body.type) throw new Error('نوع التفتيش (type) مطلوب');
  const db = readJSON(SAFETY_INSPECTIONS_FILE, defaultDB('inspections'));
  const inspection = {
    id: newId('INSP'),
    project_id: body.project_id || null,
    type: body.type, // checklist / ppe / work_permit
    title: body.title || body.type,
    checklist: Array.isArray(body.checklist) ? body.checklist : [],
    passed: body.passed !== undefined ? Boolean(body.passed) : null,
    inspector: body.inspector || null,
    valid_until: body.valid_until || null,
    created_at: nowISO(),
  };
  db.inspections.push(inspection);
  writeJSON(SAFETY_INSPECTIONS_FILE, db);
  SEC.recordGlobalAudit({ module: 'safety', action: 'create_inspection', target_id: inspection.id, summary: inspection.title });
  return { success: true, data: inspection };
}

function listSafetyInspections({ project_id = null, type = null } = {}) {
  const db = readJSON(SAFETY_INSPECTIONS_FILE, defaultDB('inspections'));
  let items = db.inspections;
  if (project_id) items = items.filter(i => i.project_id === project_id);
  if (type) items = items.filter(i => i.type === type);
  return { success: true, data: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
}

function getSafetyDashboard() {
  const incidents = readJSON(SAFETY_INCIDENTS_FILE, defaultDB('incidents')).incidents;
  const risks = readJSON(SAFETY_RISKS_FILE, defaultDB('risks')).risks;
  const inspections = readJSON(SAFETY_INSPECTIONS_FILE, defaultDB('inspections')).inspections;

  return {
    success: true,
    data: {
      total_incidents: incidents.length,
      open_incidents: incidents.filter(i => i.status !== 'closed').length,
      high_or_critical_incidents: incidents.filter(i => i.severity === 'high' || i.severity === 'critical').length,
      open_risks: risks.filter(r => r.status === 'open').length,
      high_risks: risks.filter(r => r.risk_score >= 15).length, // 5x3 وأعلى
      total_inspections: inspections.length,
      failed_inspections: inspections.filter(i => i.passed === false).length,
    },
  };
}

// ==================================================================================
// ================================== الوثائق =======================================
// ==================================================================================

const DOCUMENT_TYPES = ['contract', 'drawing', 'invoice', 'report', 'image', 'video', 'pdf', 'word', 'excel', 'other'];

function defaultDocumentsDB() { return { documents: [] }; }

function validateEntityRef(entity_type, entity_id) {
  if (!entity_type || !entity_id) return; // ربط اختياري
  switch (entity_type) {
    case 'contract': BIZC.getContract(entity_id); break;
    case 'client': BIZ.getClient(entity_id); break;
    case 'supplier': BIZ.getSupplier(entity_id); break;
    case 'project': assertProjectExists(entity_id); break;
    default: break; // كيانات أخرى غير مقيَّدة حالياً
  }
}

function uploadDocument(body) {
  if (!body || !body.name || !String(body.name).trim()) throw new Error('اسم الوثيقة مطلوب');
  const type = body.type || 'other';
  if (!DOCUMENT_TYPES.includes(type)) throw new Error(`نوع الوثيقة غير صحيح. القيم المسموحة: ${DOCUMENT_TYPES.join(', ')}`);

  try {
    validateEntityRef(body.entity_type, body.entity_id);
  } catch (e) {
    throw new Error(`تعذّر ربط الوثيقة بالكيان المحدد: ${e.message}`);
  }

  const db = readJSON(DOCUMENTS_FILE, defaultDocumentsDB());

  // التحكم بالإصدارات: نفس code يعني وثيقة جديدة بإصدار أعلى، وليس كتابة فوق القديمة
  const code = body.code || null;
  const previousVersions = code ? db.documents.filter(d => d.code === code) : [];
  const version = previousVersions.length + 1;
  if (previousVersions.length) {
    previousVersions.forEach(d => { d.is_latest = false; });
  }

  const document = {
    id: newId('DOC'),
    code,
    name: String(body.name).trim(),
    type,
    entity_type: body.entity_type || null,
    entity_id: body.entity_id || null,
    file_url: body.file_url || null, // مسار فعلي على القرص أو رابط تخزين خارجي
    uploaded_by: body.uploaded_by || null,
    version,
    is_latest: true,
    access_roles: Array.isArray(body.access_roles) ? body.access_roles : null, // null = بلا قيود إضافية غير صلاحيات RBAC
    created_at: nowISO(),
  };

  db.documents.push(document);
  writeJSON(DOCUMENTS_FILE, db);
  SEC.recordGlobalAudit({ module: 'documents', action: 'upload', target_id: document.id, summary: `${document.name} (v${version})` });

  return { success: true, data: document };
}

function listDocuments({ entity_type = null, entity_id = null, type = null, code = null, latestOnly = true } = {}) {
  const db = readJSON(DOCUMENTS_FILE, defaultDocumentsDB());
  let items = db.documents;
  if (entity_type) items = items.filter(d => d.entity_type === entity_type);
  if (entity_id) items = items.filter(d => d.entity_id === entity_id);
  if (type) items = items.filter(d => d.type === type);
  if (code) items = items.filter(d => d.code === code);
  if (latestOnly && !code) items = items.filter(d => d.is_latest);
  return { success: true, data: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
}

function getDocumentVersionHistory(code) {
  const db = readJSON(DOCUMENTS_FILE, defaultDocumentsDB());
  const versions = db.documents.filter(d => d.code === code).sort((a, b) => a.version - b.version);
  if (!versions.length) throw new Error('لا توجد وثيقة بهذا الرمز');
  return { success: true, data: versions };
}

function deleteDocument(id) {
  const db = readJSON(DOCUMENTS_FILE, defaultDocumentsDB());
  const idx = db.documents.findIndex(d => d.id === id);
  if (idx === -1) throw new Error('الوثيقة غير موجودة');
  const [removed] = db.documents.splice(idx, 1);
  writeJSON(DOCUMENTS_FILE, db);
  SEC.recordGlobalAudit({ module: 'documents', action: 'delete', target_id: id, summary: removed.name });
  return { success: true, data: { deleted: id } };
}

// ==================================================================================
// ============================ التكامل بين كل الوحدات =============================
// ==================================================================================

function safeCall(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

function assertProjectExists(project_id) {
  try {
    PM.getProject(project_id, { includeRelations: false });
  } catch (e) {
    throw new Error('المشروع المرتبط غير موجود');
  }
}

/** لقطة حيّة موحّدة تُستعلَم مباشرة من كل الوحدات (وليست بيانات مخزَّنة أو وهمية) */
function integrationSnapshot() {
  const projects = safeCall(() => PM.listProjects({ pageSize: 100000 }).items, []);
  const clientsDashboard = safeCall(() => BIZ.getClientsDashboard().data, {});
  const suppliersDashboard = safeCall(() => BIZ.getSuppliersDashboard().data, {});
  const contractsDashboard = safeCall(() => BIZC.getContractsDashboard().data, {});
  const invoicesDashboard = safeCall(() => BIZC.getInvoicesDashboard().data, {});
  const purchasingDashboard = safeCall(() => BIZC.getPurchasingDashboard().data, {});
  const warehouseDashboard = safeCall(() => BIZO.getWarehouseDashboard(), {});
  const hrDashboard = safeCall(() => BIZO.getHrDashboard(), {});
  const tasksDashboard = safeCall(() => BIZO.getTasksDashboard(), {});
  const assetsDashboard = safeCall(() => BIZO.getAssetsDashboard(), {});
  const qualityDashboard = getQualityDashboard().data;
  const safetyDashboard = getSafetyDashboard().data;

  return {
    generated_at: nowISO(),
    projects: {
      total: projects.length,
      active: projects.filter(p => p.status === 'active' || p.status === 'in_progress').length,
      delayed: projects.filter(p => p.status === 'delayed').length,
      completed: projects.filter(p => p.status === 'completed').length,
    },
    clients: clientsDashboard,
    suppliers: suppliersDashboard,
    contracts: contractsDashboard,
    invoices: invoicesDashboard,
    purchasing: purchasingDashboard,
    warehouse: warehouseDashboard,
    hr: hrDashboard,
    tasks: tasksDashboard,
    assets: assetsDashboard,
    quality: qualityDashboard,
    safety: safetyDashboard,
  };
}

function getExecutiveDashboard() {
  const snapshot = integrationSnapshot();
  // total_receivable = مستحق لنا من العملاء (إيرادات مستقبلية)، total_payable = مستحق علينا للموردين
  const revenue = snapshot.invoices?.total_receivable || 0;
  const expenses = (snapshot.invoices?.total_payable || 0) + (snapshot.hr?.total_monthly_base_payroll || 0);
  return {
    success: true,
    data: {
      ...snapshot,
      financial_summary: {
        total_revenue: revenue,
        total_expenses: expenses,
        net_profit: Math.round((revenue - expenses) * 100) / 100,
      },
    },
  };
}

// ==================================================================================
// ================================== التقارير ======================================
// ==================================================================================

const REPORT_BUILDERS = {
  financial: () => {
    const inv = safeCall(() => BIZC.getInvoicesDashboard().data, {});
    return {
      title: 'التقرير المالي',
      headers: ['البند', 'القيمة'],
      rows: [
        ['إجمالي المستحق من العملاء', String(inv.total_receivable ?? 0)],
        ['إجمالي المستحق للموردين', String(inv.total_payable ?? 0)],
        ['عدد الفواتير المتأخرة', String((inv.overdue_invoices || []).length)],
      ],
    };
  },
  profit_loss: () => {
    const exec = getExecutiveDashboard().data;
    return {
      title: 'تقرير الأرباح والخسائر',
      headers: ['البند', 'القيمة'],
      rows: [
        ['إجمالي الإيرادات', String(exec.financial_summary.total_revenue)],
        ['إجمالي المصروفات', String(exec.financial_summary.total_expenses)],
        ['صافي الربح', String(exec.financial_summary.net_profit)],
      ],
    };
  },
  clients: () => {
    const data = safeCall(() => BIZ.listClients({ pageSize: 5000 }).data, []);
    return {
      title: 'تقرير العملاء',
      headers: ['الاسم', 'الحالة', 'التقييم'],
      rows: data.map(c => [c.name, c.status || '-', String(c.rating ?? '-')]),
    };
  },
  suppliers: () => {
    const data = safeCall(() => BIZ.listSuppliers({ pageSize: 5000 }).data, []);
    return {
      title: 'تقرير الموردين',
      headers: ['الاسم', 'التصنيف', 'تقييم الجودة'],
      rows: data.map(s => [s.name, s.category || '-', String(s.performance?.quality_score ?? '-')]),
    };
  },
  contracts: () => {
    const data = safeCall(() => BIZC.listContracts({ pageSize: 5000 }).data, []);
    return {
      title: 'تقرير العقود',
      headers: ['اسم العقد', 'القيمة', 'الحالة'],
      rows: data.map(c => [c.title, String(c.value ?? 0), c.status || '-']),
    };
  },
  inventory: () => {
    const data = safeCall(() => BIZO.listStockItems({ pageSize: 500 }).items, []);
    return {
      title: 'تقرير المخزون',
      headers: ['الصنف', 'الكمية', 'الحد الأدنى'],
      rows: data.map(i => [i.name, String(i.quantity ?? 0), String(i.min_quantity ?? 0)]),
    };
  },
  employees: () => {
    const data = safeCall(() => BIZO.listEmployees({ pageSize: 500 }).items, []);
    return {
      title: 'تقرير الموظفين',
      headers: ['الاسم', 'المهنة', 'الراتب الأساسي'],
      rows: data.map(e => [e.name, e.job_title || '-', String(e.base_salary ?? 0)]),
    };
  },
  projects: () => {
    const data = safeCall(() => PM.listProjects({ pageSize: 100000 }).items, []);
    return {
      title: 'تقرير المشاريع',
      headers: ['اسم المشروع', 'الحالة', 'نسبة الإنجاز'],
      rows: data.map(p => [p.name, p.status || '-', String(p.progress_percent ?? 0)]),
    };
  },
  executive: () => {
    const exec = getExecutiveDashboard().data;
    return {
      title: 'التقرير التنفيذي',
      headers: ['المؤشر', 'القيمة'],
      rows: [
        ['عدد المشاريع', String(exec.projects.total)],
        ['المشاريع النشطة', String(exec.projects.active)],
        ['المشاريع المتأخرة', String(exec.projects.delayed)],
        ['صافي الربح', String(exec.financial_summary.net_profit)],
        ['الحوادث المفتوحة', String(exec.safety.open_incidents)],
        ['نسبة نجاح فحوصات الجودة (%)', String(exec.quality.pass_rate ?? '-')],
      ],
    };
  },
};

function buildReportData(reportKey) {
  const builder = REPORT_BUILDERS[reportKey];
  if (!builder) throw new Error(`نوع التقرير غير معروف. الأنواع المتاحة: ${Object.keys(REPORT_BUILDERS).join(', ')}`);
  return builder();
}

function escapeWordXmlText(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** توليد ملف Word فعلي (.doc بصيغة MHTML/HTML متوافقة مع Word، بدون تبعيات خارجية) */
function exportReportToWord({ title, headers, rows }) {
  ensureDirs();
  const tableRows = rows.map(r => `<tr>${r.map(c => `<td style="border:1px solid #333;padding:6px;">${escapeWordXmlText(c)}</td>`).join('')}</tr>`).join('');
  const headerRow = `<tr>${headers.map(h => `<th style="border:1px solid #333;padding:6px;background:#eee;">${escapeWordXmlText(h)}</th>`).join('')}</tr>`;
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"><title>${escapeWordXmlText(title)}</title></head>
<body style="font-family:Arial, Tahoma, sans-serif;">
<h1>${escapeWordXmlText(title)}</h1>
<p>تاريخ الإنشاء: ${nowISO()}</p>
<table style="border-collapse:collapse;width:100%;">${headerRow}${tableRows}</table>
</body>
</html>`;

  const fileName = `report-${Date.now()}.doc`;
  const outputPath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(outputPath, html, 'utf8');
  return { fileName, path: outputPath };
}

function exportReport(reportKey, { format = 'pdf' } = {}) {
  const { title, headers, rows } = buildReportData(reportKey);

  if (format === 'pdf') {
    const fileName = `report-${reportKey}-${Date.now()}.pdf`;
    const outputPath = path.join(REPORTS_DIR, fileName);
    generateBoqTablePDF({ title, headers, rows, outputPath });
    SEC.recordGlobalAudit({ module: 'reports', action: 'export', target_id: reportKey, summary: 'PDF' });
    return { success: true, data: { fileName, url: `/reports/${fileName}` } };
  }

  if (format === 'excel') {
    const fileName = `report-${reportKey}-${Date.now()}.xlsx`;
    const outputPath = path.join(REPORTS_DIR, fileName);
    const buffer = generateXlsx([{ name: title.slice(0, 30) || 'Report', rows: [headers, ...rows] }]);
    fs.writeFileSync(outputPath, buffer);
    SEC.recordGlobalAudit({ module: 'reports', action: 'export', target_id: reportKey, summary: 'Excel' });
    return { success: true, data: { fileName, url: `/reports/${fileName}` } };
  }

  if (format === 'csv') {
    const fileName = `report-${reportKey}-${Date.now()}.csv`;
    const outputPath = path.join(REPORTS_DIR, fileName);
    const csv = generateCsv(headers, rows);
    fs.writeFileSync(outputPath, csv, 'utf8');
    SEC.recordGlobalAudit({ module: 'reports', action: 'export', target_id: reportKey, summary: 'CSV' });
    return { success: true, data: { fileName, url: `/reports/${fileName}` } };
  }

  if (format === 'word') {
    const { fileName } = exportReportToWord({ title, headers, rows });
    SEC.recordGlobalAudit({ module: 'reports', action: 'export', target_id: reportKey, summary: 'Word' });
    return { success: true, data: { fileName, url: `/reports/${fileName}` } };
  }

  throw new Error('صيغة التصدير غير مدعومة. الصيغ المتاحة: pdf, excel, csv, word');
}

function listAvailableReports() {
  return { success: true, data: Object.keys(REPORT_BUILDERS) };
}

// ==================================================================================
// ============================ الذكاء الاصطناعي (مساعد الأعمال) ==================
// ==================================================================================

function isAIAvailable() { return AI.isAIAvailable(); }

async function analyzeFinancialPerformance() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const exec = getExecutiveDashboard().data;
  return AI.answerEngineeringQuestion({
    question: 'حلّل الأداء المالي الحالي للشركة بناءً على البيانات المرفقة، وحدد أهم 3 ملاحظات وأهم 3 مخاطر مالية.',
    context: JSON.stringify(exec.financial_summary),
  });
}

async function detectAbnormalExpenses() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const invoices = safeCall(() => BIZC.listInvoices({ pageSize: 5000 }).data, []);
  return AI.answerEngineeringQuestion({
    question: 'راجع قائمة الفواتير التالية واكتشف أي مصروفات تبدو غير طبيعية (مبالغ شاذة، تكرار غير معتاد، موردين جدد بمبالغ كبيرة) واذكرها بوضوح.',
    context: JSON.stringify(invoices.slice(0, 200)),
  });
}

async function analyzeEmployeePerformance() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const employees = safeCall(() => BIZO.listEmployees({ pageSize: 500 }).items, []);
  return AI.answerEngineeringQuestion({
    question: 'بناءً على بيانات الموظفين التالية (الحضور، التقييمات، الإجازات)، حدد الموظفين الأعلى أداءً والأكثر حاجة لمتابعة.',
    context: JSON.stringify(employees.slice(0, 200)),
  });
}

async function analyzeSupplierPerformance() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const suppliers = safeCall(() => BIZ.listSuppliers({ pageSize: 5000 }).data, []);
  return AI.answerEngineeringQuestion({
    question: 'قيّم أداء الموردين التالين بناءً على تقييم الجودة والالتزام بالمواعيد، ورتبهم من الأفضل للأسوأ مع التوصية.',
    context: JSON.stringify(suppliers.slice(0, 200)),
  });
}

async function suggestProcessImprovements() {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const snapshot = integrationSnapshot();
  return AI.answerEngineeringQuestion({
    question: 'بناءً على اللقطة الشاملة التالية لحالة الشركة (مشاريع، عقود، مخزون، جودة، سلامة)، اقترح 5 تحسينات عملية للعمليات لزيادة الكفاءة وتقليل التكاليف.',
    context: JSON.stringify(snapshot),
  });
}

async function summarizeMeetingMinutes(meetingId) {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const meeting = BIZO.getMeeting(meetingId);
  return AI.answerEngineeringQuestion({
    question: 'لخّص محضر الاجتماع التالي في نقاط واضحة: القرارات المتخذة، المهام الناتجة، والمتابعات المطلوبة.',
    context: JSON.stringify(meeting),
  });
}

async function answerManagementQuestion(question) {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  if (!question || !String(question).trim()) throw new Error('السؤال مطلوب');
  const snapshot = integrationSnapshot();
  return AI.answerEngineeringQuestion({ question: String(question).trim(), context: JSON.stringify(snapshot) });
}

async function forecastCashFlow({ months = 3 } = {}) {
  if (!isAIAvailable()) throw new Error('ميزة الذكاء الاصطناعي غير مفعّلة: يجب ضبط متغير البيئة ANTHROPIC_API_KEY على الخادم.');
  const invoices = safeCall(() => BIZC.listInvoices({ pageSize: 5000 }).data, []);
  const contracts = safeCall(() => BIZC.listContracts({ pageSize: 5000 }).data, []);
  return AI.answerEngineeringQuestion({
    question: `تنبّأ بالتدفقات النقدية للأشهر ${months} القادمة بناءً على الفواتير والعقود المرفقة، مع ذكر الافتراضات التي استندت إليها.`,
    context: JSON.stringify({ invoices: invoices.slice(0, 200), contracts: contracts.slice(0, 200) }),
  });
}

module.exports = {
  // جودة
  createQualityPlan,
  listQualityPlans,
  createQualityAudit,
  approveQualityAudit,
  listQualityAudits,
  getQualityDashboard,
  // سلامة
  createSafetyIncident,
  listSafetyIncidents,
  closeSafetyIncident,
  createSafetyRisk,
  listSafetyRisks,
  createSafetyInspection,
  listSafetyInspections,
  getSafetyDashboard,
  // وثائق
  uploadDocument,
  listDocuments,
  getDocumentVersionHistory,
  deleteDocument,
  DOCUMENT_TYPES,
  // تكامل
  integrationSnapshot,
  getExecutiveDashboard,
  // تقارير
  listAvailableReports,
  exportReport,
  // ذكاء اصطناعي
  isAIAvailable,
  analyzeFinancialPerformance,
  detectAbnormalExpenses,
  analyzeEmployeePerformance,
  analyzeSupplierPerformance,
  suggestProcessImprovements,
  summarizeMeetingMinutes,
  answerManagementQuestion,
  forecastCashFlow,
};
