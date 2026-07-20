/**
 * القسم التاسع - نظام إدارة الجودة (Quality Management System - QMS)
 * =====================================================================================
 * الجزء الأول (1/4): البنية الأساسية + لوحة التحكم + إدارة خطة الجودة +
 *                     إدارة طلبات الفحص (Inspection Request - IR). [منجز]
 * الجزء الثاني (2/4): اختبارات المواد (خرسانة/حديد/تربة/أسفلت/مياه) +
 *                      إدارة المختبر + نقاط الفحص (ITP).
 * الجزء الثالث (3/4): حالات عدم المطابقة (NCR) + الإجراءات التصحيحية (CAPA) +
 *                      اعتماد المواد (MAR) + اعتماد الرسومات (SDR) + إدارة الوثائق.
 * الجزء الرابع (4/4): مؤشرات الأداء (KPIs) + التنبيهات الذكية + التقارير +
 *                      الرسوم البيانية + الذكاء الاصطناعي + التكامل + الصلاحيات.
 *
 * التخزين: ملف JSON على القرص (backend/data/qms.json) بنفس نمط
 * hseManagement.js / equipmentManagement.js / projectManagement.js - بدون تبعيات خارجية.
 *
 * المعايير المرجعية: ISO 9001 (نظام إدارة الجودة) مع دعم متطلبات المشاريع
 * الحكومية والخاصة (خطط جودة، نقاط فحص واعتماد، طلبات فحص IR).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - طلبات الفحص (IR) لها دورة حياة حقيقية: مسودة → مُرسل → مجدول → تم الفحص
 *    (قبول/رفض/قبول مشروط) → مغلق، مع تحقق من صحة الانتقال بين الحالات.
 *  - خطة الجودة تدعم إصدارات متعددة (Version Control) فعلية مع سجل تغييرات،
 *    ولا يمكن اعتماد خطة إلا بعد استيفاء الحقول الإلزامية (أهداف + سياسات +
 *    نقطة فحص واحدة على الأقل).
 *  - لوحة التحكم تحسب المؤشرات فعلياً من البيانات المخزَّنة (لا أرقام وهمية):
 *    نسبة الالتزام بالجودة = طلبات الفحص المقبولة ÷ إجمالي طلبات الفحص المُنجزة.
 *  - سجل تدقيق (Audit Log) فعلي لكل عملية إنشاء/تعديل/حذف/اعتماد.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'qms.json');

function r2(v) { return Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100; }
function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ===================== طبقة التخزين =====================

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      qualityPlans: {},        // { id: qualityPlanRecord }        (خطط الجودة للمشاريع)
      qualityPlanVersions: {}, // { id: versionRecord }             (سجل إصدارات كل خطة)
      inspectionRequests: {},  // { id: irRecord }                  (طلبات الفحص IR)
      materialTests: {},       // { id: materialTestRecord }        (اختبارات المواد - الجزء 2)
      labs: {},                // { id: labRecord }                 (المختبرات - الجزء 2)
      labTechnicians: {},      // { id: technicianRecord }          (فنيو المختبر - الجزء 2)
      labEquipment: {},        // { id: equipmentRecord }           (أجهزة المختبر - الجزء 2)
      itpItems: {},            // { id: itpRecord }                 (نقاط الفحص ITP - الجزء 2)
      ncrs: {},                // { id: ncrRecord }                 (حالات عدم المطابقة NCR - الجزء 3)
      capas: {},               // { id: capaRecord }                (الإجراءات التصحيحية/الوقائية CAPA - الجزء 3)
      mars: {},                // { id: marRecord }                 (طلبات اعتماد المواد MAR - الجزء 3)
      sdrs: {},                // { id: sdrRecord }                 (طلبات اعتماد الرسومات SDR - الجزء 3)
      documents: {},           // { id: documentRecord }            (إدارة الوثائق: مواصفات/أكواد/شهادات - الجزء 5)
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
    throw new Error('تعذر قراءة قاعدة بيانات إدارة الجودة: ' + e.message);
  }
  let migrated = false;
  for (const key of [
    'qualityPlans', 'qualityPlanVersions', 'inspectionRequests',
    'materialTests', 'labs', 'labTechnicians', 'labEquipment', 'itpItems',
    'ncrs', 'capas', 'mars', 'sdrs', 'documents',
  ]) {
    if (!store[key]) { store[key] = {}; migrated = true; }
  }
  if (!store.auditLog) { store.auditLog = []; migrated = true; }
  if (typeof store.seq !== 'number') { store.seq = 0; migrated = true; }
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

// ----- خطة الجودة -----
const QUALITY_PLAN_STATUSES = ['draft', 'under_review', 'approved', 'archived'];
const QUALITY_PLAN_STATUS_LABELS = {
  draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمدة', archived: 'مؤرشفة',
};

// ----- طلبات الفحص (IR) -----
const IR_STATUSES = [
  'draft', 'submitted', 'scheduled', 'inspected', 'closed', 'cancelled',
];
const IR_STATUS_LABELS = {
  draft: 'مسودة',
  submitted: 'مُرسل',
  scheduled: 'مجدول للفحص',
  inspected: 'تم الفحص',
  closed: 'مغلق',
  cancelled: 'ملغى',
};
// الانتقالات المسموحة بين حالات طلب الفحص
const IR_ALLOWED_TRANSITIONS = {
  draft: ['submitted', 'cancelled'],
  submitted: ['scheduled', 'cancelled'],
  scheduled: ['inspected', 'cancelled'],
  inspected: ['closed'],
  closed: [],
  cancelled: [],
};

const IR_RESULTS = ['pending', 'accepted', 'conditional', 'rejected'];
const IR_RESULT_LABELS = {
  pending: 'قيد الانتظار', accepted: 'مقبول', conditional: 'قبول مشروط', rejected: 'مرفوض',
};

const IR_DISCIPLINES = [
  'concrete', 'rebar', 'formwork', 'masonry', 'finishing', 'mep', 'earthwork', 'asphalt', 'other',
];
const IR_DISCIPLINE_LABELS = {
  concrete: 'خرسانة', rebar: 'حديد تسليح', formwork: 'شدة خشبية', masonry: 'مباني (طوب/بلوك)',
  finishing: 'تشطيبات', mep: 'كهروميكانيكال', earthwork: 'أعمال ترابية', asphalt: 'أسفلت', other: 'أخرى',
};

// ----- اختبارات المواد (الجزء 2) -----
// فئات المواد المدعومة
const MATERIAL_CATEGORIES = ['concrete', 'rebar', 'soil', 'asphalt', 'water'];
const MATERIAL_CATEGORY_LABELS = {
  concrete: 'الخرسانة', rebar: 'حديد التسليح', soil: 'التربة', asphalt: 'الأسفلت', water: 'المياه',
};

// أنواع الاختبارات لكل فئة مادة، مع الوحدة القياسية للنتيجة
const TEST_TYPES_BY_CATEGORY = {
  concrete: [
    { code: 'slump', label: 'اختبار الهبوط (Slump Test)', unit: 'mm' },
    { code: 'compressive_strength', label: 'اختبار مقاومة الضغط', unit: 'MPa' },
    { code: 'cube_test', label: 'اختبار المكعبات', unit: 'MPa' },
    { code: 'cylinder_test', label: 'اختبار الأسطوانات', unit: 'MPa' },
    { code: 'temperature', label: 'اختبار درجة الحرارة', unit: '°C' },
    { code: 'density', label: 'اختبار الكثافة', unit: 'kg/m3' },
  ],
  rebar: [
    { code: 'tensile', label: 'اختبار الشد', unit: 'MPa' },
    { code: 'yield', label: 'اختبار الخضوع', unit: 'MPa' },
    { code: 'elongation', label: 'اختبار الاستطالة', unit: '%' },
    { code: 'bend', label: 'اختبار الانحناء', unit: 'pass/fail' },
    { code: 'weld', label: 'اختبار اللحام', unit: 'pass/fail' },
  ],
  soil: [
    { code: 'density', label: 'اختبار الكثافة', unit: 'kg/m3' },
    { code: 'compaction', label: 'اختبار الدمك', unit: '%' },
    { code: 'cbr', label: 'اختبار CBR', unit: '%' },
    { code: 'shear', label: 'اختبار القص', unit: 'kPa' },
    { code: 'sieve_analysis', label: 'اختبار التحليل الحبيبي', unit: '%' },
    { code: 'atterberg_limits', label: 'اختبار حدود أتربرج', unit: '%' },
    { code: 'moisture_content', label: 'اختبار المحتوى المائي', unit: '%' },
  ],
  asphalt: [
    { code: 'density', label: 'اختبار الكثافة', unit: 'kg/m3' },
    { code: 'thickness', label: 'اختبار السماكة', unit: 'mm' },
    { code: 'temperature', label: 'اختبار درجة الحرارة', unit: '°C' },
    { code: 'compaction', label: 'اختبار الدمك', unit: '%' },
  ],
  water: [
    { code: 'quality', label: 'اختبار جودة المياه', unit: 'مطابق/غير مطابق' },
    { code: 'salinity', label: 'اختبار الأملاح', unit: 'ppm' },
    { code: 'ph', label: 'اختبار الرقم الهيدروجيني (pH)', unit: 'pH' },
  ],
};

const MATERIAL_TEST_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const MATERIAL_TEST_STATUS_LABELS = {
  pending: 'قيد الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى',
};

const MATERIAL_TEST_RESULTS = ['pending', 'pass', 'fail'];
const MATERIAL_TEST_RESULT_LABELS = { pending: 'قيد الانتظار', pass: 'مطابق', fail: 'غير مطابق' };

// ----- إدارة المختبر (الجزء 2) -----
const LAB_EQUIPMENT_STATUSES = ['active', 'due_calibration', 'out_of_service'];
const LAB_EQUIPMENT_STATUS_LABELS = {
  active: 'صالح للعمل', due_calibration: 'مستحق معايرة', out_of_service: 'خارج الخدمة',
};

// ----- نقاط الفحص (ITP) (الجزء 2) -----
const ITP_INSPECTION_TYPES = ['witness', 'hold', 'review', 'random', 'surveillance'];
const ITP_INSPECTION_TYPE_LABELS = {
  witness: 'معاينة (Witness)', hold: 'نقطة توقف (Hold Point)', review: 'مراجعة مستندية',
  random: 'فحص عشوائي', surveillance: 'مراقبة',
};
const ITP_RESPONSIBLE_PARTIES = ['contractor', 'consultant', 'owner', 'third_party'];
const ITP_RESPONSIBLE_PARTY_LABELS = {
  contractor: 'المقاول', consultant: 'الاستشاري', owner: 'المالك', third_party: 'جهة خارجية',
};
const ITP_STATUSES = ['pending', 'passed', 'failed', 'waived'];
const ITP_STATUS_LABELS = {
  pending: 'قيد الانتظار', passed: 'مجتاز', failed: 'غير مجتاز', waived: 'مستثنى (Waived)',
};

// ----- حالات عدم المطابقة (NCR) (الجزء 3) -----
// دورة حياة حقيقية: مفتوحة → قيد المعالجة (بعد ربط إجراء تصحيحي CAPA) →
// معلّقة للتحقق (بعد تنفيذ الإجراء) → مغلقة (بعد التحقق والاعتماد) | مرفوضة
const NCR_STATUSES = ['open', 'in_progress', 'pending_verification', 'closed', 'rejected'];
const NCR_STATUS_LABELS = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  pending_verification: 'معلّقة للتحقق',
  closed: 'مغلقة',
  rejected: 'مرفوضة',
};
// الانتقالات المسموحة بين حالات NCR
const NCR_ALLOWED_TRANSITIONS = {
  open: ['in_progress', 'rejected'],
  in_progress: ['pending_verification', 'rejected'],
  pending_verification: ['closed', 'in_progress'],
  closed: [],
  rejected: [],
};

const NCR_SEVERITIES = ['minor', 'major', 'critical'];
const NCR_SEVERITY_LABELS = { minor: 'بسيطة', major: 'جسيمة', critical: 'حرجة' };

const NCR_DISCIPLINES = [
  'concrete', 'rebar', 'formwork', 'masonry', 'finishing', 'mep', 'earthwork', 'asphalt', 'other',
];
const NCR_DISCIPLINE_LABELS = {
  concrete: 'خرسانة', rebar: 'حديد تسليح', formwork: 'شدة خشبية', masonry: 'مباني (طوب/بلوك)',
  finishing: 'تشطيبات', mep: 'كهروميكانيكال', earthwork: 'أعمال ترابية', asphalt: 'أسفلت', other: 'أخرى',
};

// ----- الإجراءات التصحيحية والوقائية (CAPA) (الجزء 3) -----
// دورة حياة حقيقية: مفتوح → خطة معتمدة → قيد التنفيذ → تم التحقق → مغلق (بعد تقييم الفاعلية)
const CAPA_STATUSES = ['open', 'plan_approved', 'in_progress', 'verified', 'closed'];
const CAPA_STATUS_LABELS = {
  open: 'مفتوح',
  plan_approved: 'خطة معتمدة',
  in_progress: 'قيد التنفيذ',
  verified: 'تم التحقق من التنفيذ',
  closed: 'مغلق',
};
const CAPA_ALLOWED_TRANSITIONS = {
  open: ['plan_approved'],
  plan_approved: ['in_progress'],
  in_progress: ['verified'],
  verified: ['closed'],
  closed: [],
};

const CAPA_TYPES = ['corrective', 'preventive'];
const CAPA_TYPE_LABELS = { corrective: 'إجراء تصحيحي', preventive: 'إجراء وقائي' };

const CAPA_EFFECTIVENESS = ['not_evaluated', 'effective', 'partially_effective', 'ineffective'];
const CAPA_EFFECTIVENESS_LABELS = {
  not_evaluated: 'لم يُقيَّم بعد',
  effective: 'فعّال',
  partially_effective: 'فعّال جزئياً',
  ineffective: 'غير فعّال',
};

// ----- طلبات اعتماد المواد (Material Approval Request - MAR) (الجزء 3) -----
// دورة حياة حقيقية: مسودة → مُرسل → قيد المراجعة → معتمد | معتمد بملاحظات | مرفوض → (إعادة تقديم بعد الرفض)
const MAR_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'approved_with_comments', 'rejected'];
const MAR_STATUS_LABELS = {
  draft: 'مسودة',
  submitted: 'مُرسل',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  approved_with_comments: 'معتمد بملاحظات',
  rejected: 'مرفوض',
};
// الانتقالات المسموحة بين حالات طلب اعتماد المواد
const MAR_ALLOWED_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['under_review'],
  under_review: ['approved', 'approved_with_comments', 'rejected'],
  approved: [],
  approved_with_comments: [],
  rejected: ['submitted'],
};

const MAR_DISCIPLINES = [
  'concrete', 'rebar', 'formwork', 'masonry', 'finishing', 'mep', 'earthwork', 'asphalt', 'other',
];
const MAR_DISCIPLINE_LABELS = {
  concrete: 'خرسانة', rebar: 'حديد تسليح', formwork: 'شدة خشبية', masonry: 'مباني (طوب/بلوك)',
  finishing: 'تشطيبات', mep: 'كهروميكانيكال', earthwork: 'أعمال ترابية', asphalt: 'أسفلت', other: 'أخرى',
};

// ----- طلبات اعتماد الرسومات (Shop Drawing Approval - SDR) (الجزء 3) -----
// دورة حياة حقيقية: مسودة → مُرسل → قيد المراجعة → معتمد | معتمد بملاحظات | مرفوض/يتطلب إعادة مراجعة → (إعادة مراجعة برفع إصدار جديد)
const SDR_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'approved_with_comments', 'rejected_resubmit'];
const SDR_STATUS_LABELS = {
  draft: 'مسودة',
  submitted: 'مُرسل',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  approved_with_comments: 'معتمد بملاحظات',
  rejected_resubmit: 'مرفوض - يتطلب إعادة تقديم',
};
// الانتقالات المسموحة بين حالات طلب اعتماد الرسومات
const SDR_ALLOWED_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['under_review'],
  under_review: ['approved', 'approved_with_comments', 'rejected_resubmit'],
  approved: [],
  approved_with_comments: [],
  rejected_resubmit: ['submitted'],
};

const SDR_DISCIPLINES = [
  'concrete', 'rebar', 'formwork', 'masonry', 'finishing', 'mep', 'earthwork', 'structural', 'architectural', 'other',
];
const SDR_DISCIPLINE_LABELS = {
  concrete: 'خرسانة', rebar: 'حديد تسليح', formwork: 'شدة خشبية', masonry: 'مباني (طوب/بلوك)',
  finishing: 'تشطيبات', mep: 'كهروميكانيكال', earthwork: 'أعمال ترابية',
  structural: 'إنشائي', architectural: 'معماري', other: 'أخرى',
};

// ===================== لوحة التحكم (Dashboard) =====================

function getDashboard(projectId = null) {
  const store = loadStore();
  const plans = Object.values(store.qualityPlans).filter(p => !projectId || p.project_id === projectId);
  const irs = Object.values(store.inspectionRequests).filter(r => !projectId || r.project_id === projectId);

  const totalProjects = new Set(
    Object.values(store.qualityPlans).map(p => p.project_id).filter(Boolean)
  ).size;

  const inspectedIrs = irs.filter(r => ['inspected', 'closed'].includes(r.status));
  const acceptedIrs = inspectedIrs.filter(r => r.result === 'accepted');
  const complianceRate = inspectedIrs.length > 0 ? r2((acceptedIrs.length / inspectedIrs.length) * 100) : 0;

  const projectsWithApprovedPlan = new Set(
    plans.filter(p => p.status === 'approved').map(p => p.project_id)
  ).size;

  const tests = Object.values(store.materialTests).filter(t => !projectId || t.project_id === projectId);

  const recentInspections = [...irs]
    .filter(r => r.status === 'inspected' || r.status === 'closed')
    .sort((a, b) => new Date(b.inspection_date || b.updated_at) - new Date(a.inspection_date || a.updated_at))
    .slice(0, 10)
    .map(r => ({
      id: r.id, code: r.code, project_id: r.project_id, element: r.element,
      status: r.status, result: r.result, inspection_date: r.inspection_date,
    }));

  // ----- حالات عدم المطابقة (NCR) - مؤشرات فعلية من البيانات المخزَّنة -----
  const ncrs = Object.values(store.ncrs).filter(n => !projectId || n.project_id === projectId);
  const openNcrs = ncrs.filter(n => !['closed', 'rejected'].includes(n.status));
  const closedNcrs = ncrs.filter(n => n.status === 'closed');
  const avgNcrClosureDays = closedNcrs.length > 0
    ? r2(closedNcrs.reduce((sum, n) => {
        const opened = new Date(n.created_at);
        const closed = new Date(n.closed_at || n.updated_at);
        return sum + Math.max(0, (closed - opened) / (1000 * 60 * 60 * 24));
      }, 0) / closedNcrs.length)
    : 0;

  const recentNcrs = [...ncrs]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
    .map(n => ({
      id: n.id, code: n.code, project_id: n.project_id, element: n.element,
      severity: n.severity, status: n.status, created_at: n.created_at,
    }));

  // ----- الإجراءات التصحيحية والوقائية (CAPA) - مؤشرات فعلية -----
  const capas = Object.values(store.capas).filter(c => !projectId || c.project_id === projectId);
  const openCapas = capas.filter(c => c.status !== 'closed');
  const overdueCapas = capas.filter(c =>
    c.status !== 'closed' && c.due_date && new Date(c.due_date) < new Date()
  );

  // ----- طلبات اعتماد المواد (MAR) - مؤشرات فعلية -----
  const mars = Object.values(store.mars).filter(m => !projectId || m.project_id === projectId);
  const marsPending = mars.filter(m => ['draft', 'submitted', 'under_review'].includes(m.status));
  const marsApproved = mars.filter(m => ['approved', 'approved_with_comments'].includes(m.status));

  // ----- طلبات اعتماد الرسومات (SDR) - مؤشرات فعلية -----
  const sdrs = Object.values(store.sdrs).filter(s => !projectId || s.project_id === projectId);
  const sdrsPending = sdrs.filter(s => ['draft', 'submitted', 'under_review'].includes(s.status));
  const sdrsApproved = sdrs.filter(s => ['approved', 'approved_with_comments'].includes(s.status));

  const recentApprovals = [
    ...mars.filter(m => ['approved', 'approved_with_comments', 'rejected'].includes(m.status))
      .map(m => ({ id: m.id, code: m.code, type: 'MAR', project_id: m.project_id, title: m.material_name, status: m.status, ts: m.updated_at })),
    ...sdrs.filter(s => ['approved', 'approved_with_comments', 'rejected_resubmit'].includes(s.status))
      .map(s => ({ id: s.id, code: s.code, type: 'SDR', project_id: s.project_id, title: s.drawing_title, status: s.status, ts: s.updated_at })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 10);

  return {
    success: true,
    data: {
      total_projects: totalProjects,
      projects_compliant_with_quality: projectsWithApprovedPlan,
      quality_plans_count: plans.length,
      inspection_requests_count: irs.length,
      inspections_done_count: inspectedIrs.length,
      tests_count: tests.length,
      ncr_count: ncrs.length,
      ncr_open_count: openNcrs.length,
      ncr_closed_count: closedNcrs.length,
      ncr_avg_closure_days: avgNcrClosureDays,
      material_approval_requests_count: mars.length,
      material_approval_requests_pending_count: marsPending.length,
      material_approval_requests_approved_count: marsApproved.length,
      shop_drawing_requests_count: sdrs.length,
      shop_drawing_requests_pending_count: sdrsPending.length,
      shop_drawing_requests_approved_count: sdrsApproved.length,
      capa_count: capas.length,
      capa_open_count: openCapas.length,
      capa_overdue_count: overdueCapas.length,
      quality_compliance_rate: complianceRate,
      recent_inspections: recentInspections,
      recent_ncrs: recentNcrs,
      recent_approvals: recentApprovals,
      recent_reports: [],
    },
  };
}

// ===================== إدارة خطة الجودة =====================

function validateQualityPlanPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'title'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء خطة الجودة`);
      }
    }
  }
  if (payload.status && !QUALITY_PLAN_STATUSES.includes(payload.status)) {
    throw new Error(`حالة خطة الجودة غير صالحة: ${payload.status}`);
  }
}

function createQualityPlan(payload) {
  validateQualityPlanPayload(payload);
  const store = loadStore();
  const id = newId('QP');
  const code = generateCode(store, 'QP');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    title: payload.title,
    version: 1,
    status: 'draft',
    quality_objectives: Array.isArray(payload.quality_objectives) ? payload.quality_objectives : [],
    quality_policies: Array.isArray(payload.quality_policies) ? payload.quality_policies : [],
    quality_procedures: Array.isArray(payload.quality_procedures) ? payload.quality_procedures : [],
    work_instructions: Array.isArray(payload.work_instructions) ? payload.work_instructions : [],
    acceptance_criteria: Array.isArray(payload.acceptance_criteria) ? payload.acceptance_criteria : [],
    inspection_hold_points: Array.isArray(payload.inspection_hold_points) ? payload.inspection_hold_points : [],
    reference_standard: payload.reference_standard || 'ISO 9001',
    prepared_by: payload.prepared_by || null,
    approved_by: null,
    approved_at: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.qualityPlans[id] = record;

  // أول إصدار في سجل الإصدارات
  const versionId = newId('QPV');
  store.qualityPlanVersions[versionId] = {
    id: versionId,
    plan_id: id,
    version: 1,
    snapshot: { ...record },
    change_note: 'الإصدار الأول من خطة الجودة',
    created_at: nowISO(),
  };

  audit(store, { action: 'create', entity: 'quality_plan', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listQualityPlans({ projectId, status, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.qualityPlans);
  if (projectId) items = items.filter(p => p.project_id === projectId);
  if (status) items = items.filter(p => p.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(p =>
      (p.title || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getQualityPlan(id) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  const versions = Object.values(store.qualityPlanVersions)
    .filter(v => v.plan_id === id)
    .sort((a, b) => b.version - a.version);
  return { success: true, data: { ...record, versions } };
}

function updateQualityPlan(id, changes) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  if (record.status === 'approved') {
    throw new Error('لا يمكن تعديل خطة معتمدة مباشرة؛ يجب إنشاء إصدار جديد أولاً');
  }
  validateQualityPlanPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'title', 'quality_objectives', 'quality_policies', 'quality_procedures',
    'work_instructions', 'acceptance_criteria', 'inspection_hold_points',
    'reference_standard', 'prepared_by', 'status',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.updated_at = nowISO();
  store.qualityPlans[id] = record;

  audit(store, { action: 'update', entity: 'quality_plan', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteQualityPlan(id) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');
  if (record.status === 'approved') {
    throw new Error('لا يمكن حذف خطة جودة معتمدة؛ يمكن أرشفتها بدلاً من ذلك');
  }
  delete store.qualityPlans[id];
  for (const vId of Object.keys(store.qualityPlanVersions)) {
    if (store.qualityPlanVersions[vId].plan_id === id) delete store.qualityPlanVersions[vId];
  }
  audit(store, { action: 'delete', entity: 'quality_plan', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

function approveQualityPlan(id, { approved_by = null } = {}) {
  const store = loadStore();
  const record = store.qualityPlans[id];
  if (!record) throw new Error('خطة الجودة غير موجودة');

  // تحقق فعلي من اكتمال الخطة قبل السماح بالاعتماد (وليس مجرد تبديل حالة شكلي)
  if (!record.quality_objectives || record.quality_objectives.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد أهداف الجودة');
  }
  if (!record.quality_policies || record.quality_policies.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد سياسات الجودة');
  }
  if (!record.inspection_hold_points || record.inspection_hold_points.length === 0) {
    throw new Error('لا يمكن اعتماد خطة جودة بدون تحديد نقطة فحص واحدة على الأقل');
  }

  record.status = 'approved';
  record.approved_by = approved_by;
  record.approved_at = nowISO();
  record.updated_at = nowISO();
  record.version = (record.version || 1) + 1;

  const versionId = newId('QPV');
  store.qualityPlanVersions[versionId] = {
    id: versionId,
    plan_id: id,
    version: record.version,
    snapshot: { ...record },
    change_note: `اعتماد الخطة بواسطة ${approved_by || 'غير محدد'}`,
    created_at: nowISO(),
  };

  audit(store, { action: 'approve', entity: 'quality_plan', entityId: id, projectId: record.project_id, details: { approved_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة طلبات الفحص (Inspection Request - IR) =====================

function validateIrPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'element'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء طلب الفحص`);
      }
    }
  }
  if (payload.discipline && !IR_DISCIPLINES.includes(payload.discipline)) {
    throw new Error(`تخصص غير صالح: ${payload.discipline}`);
  }
  if (payload.result && !IR_RESULTS.includes(payload.result)) {
    throw new Error(`نتيجة فحص غير صالحة: ${payload.result}`);
  }
}

function createInspectionRequest(payload) {
  validateIrPayload(payload);
  const store = loadStore();
  const id = newId('IR');
  const code = generateCode(store, 'IR');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    stage: payload.stage || null,
    element: payload.element,
    location: payload.location || null,
    contractor: payload.contractor || null,
    consultant: payload.consultant || null,
    discipline: payload.discipline || 'other',
    request_date: payload.request_date || nowISO(),
    inspection_date: payload.inspection_date || null,
    status: 'draft',
    result: 'pending',
    notes: payload.notes || '',
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    signatures: [],
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.inspectionRequests[id] = record;
  audit(store, { action: 'create', entity: 'inspection_request', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listInspectionRequests({ projectId, status, result, discipline, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.inspectionRequests);
  if (projectId) items = items.filter(r => r.project_id === projectId);
  if (status) items = items.filter(r => r.status === status);
  if (result) items = items.filter(r => r.result === result);
  if (discipline) items = items.filter(r => r.discipline === discipline);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(r =>
      (r.element || '').toLowerCase().includes(q) ||
      (r.code || '').toLowerCase().includes(q) ||
      (r.location || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getInspectionRequest(id) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  return { success: true, data: record };
}

function updateInspectionRequest(id, changes) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (['closed', 'cancelled'].includes(record.status)) {
    throw new Error('لا يمكن تعديل طلب فحص مغلق أو ملغى');
  }
  validateIrPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'stage', 'element', 'location', 'contractor', 'consultant', 'discipline',
    'request_date', 'inspection_date', 'notes', 'photos', 'attachments',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'update', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteInspectionRequest(id) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (['inspected', 'closed'].includes(record.status)) {
    throw new Error('لا يمكن حذف طلب فحص تم تنفيذه بالفعل؛ يمكن إلغاؤه فقط إن كان قيد الانتظار');
  }
  delete store.inspectionRequests[id];
  audit(store, { action: 'delete', entity: 'inspection_request', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// انتقال حالة طلب الفحص وفق دورة حياة حقيقية ومقيَّدة
function transitionInspectionRequest(id, { to_status, by = null } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (!IR_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = IR_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${IR_STATUS_LABELS[record.status]}" إلى "${IR_STATUS_LABELS[to_status]}"`);
  }

  record.status = to_status;
  record.change_log.push({ ts: nowISO(), action: `status_changed_to_${to_status}`, by });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'transition', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

// تسجيل نتيجة الفحص فعلياً (يحرك الحالة تلقائياً إلى "تم الفحص")
function recordInspectionResult(id, { result, notes = '', inspected_by = null, photos = [] } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (record.status !== 'scheduled') {
    throw new Error('لا يمكن تسجيل نتيجة الفحص إلا لطلب في حالة "مجدول للفحص"');
  }
  if (!IR_RESULTS.includes(result) || result === 'pending') {
    throw new Error('يجب تحديد نتيجة فحص صالحة: مقبول/قبول مشروط/مرفوض');
  }

  record.result = result;
  record.status = 'inspected';
  record.inspection_date = nowISO();
  if (notes) record.notes = `${record.notes ? record.notes + '\n' : ''}${notes}`;
  if (Array.isArray(photos) && photos.length) record.photos = [...record.photos, ...photos];
  record.change_log.push({ ts: nowISO(), action: 'result_recorded', by: inspected_by, result });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'record_result', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { result, inspected_by } });
  saveStore(store);
  return { success: true, data: record };
}

function signInspectionRequest(id, { party, name, role = null } = {}) {
  const store = loadStore();
  const record = store.inspectionRequests[id];
  if (!record) throw new Error('طلب الفحص غير موجود');
  if (!party || !name) throw new Error('يجب تحديد الطرف والاسم للتوقيع');

  record.signatures.push({ party, name, role, signed_at: nowISO() });
  record.change_log.push({ ts: nowISO(), action: 'signed', by: name, party });
  record.updated_at = nowISO();
  store.inspectionRequests[id] = record;

  audit(store, { action: 'sign', entity: 'inspection_request', entityId: id, projectId: record.project_id, details: { party, name } });
  saveStore(store);
  return { success: true, data: record };
}

// =====================================================================================
// الجزء الثاني (2/4): اختبارات المواد + إدارة المختبر + نقاط الفحص (ITP)
// =====================================================================================

// ===================== اختبارات المواد =====================

function getTestTypesForCategory(category) {
  const list = TEST_TYPES_BY_CATEGORY[category];
  if (!list) throw new Error(`فئة مادة غير صالحة: ${category}`);
  return list;
}

function validateMaterialTestPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'material_category', 'test_type'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء اختبار المادة`);
      }
    }
  }
  if (payload.material_category && !MATERIAL_CATEGORIES.includes(payload.material_category)) {
    throw new Error(`فئة مادة غير صالحة: ${payload.material_category}`);
  }
  if (payload.material_category && payload.test_type) {
    const types = getTestTypesForCategory(payload.material_category);
    if (!types.some(t => t.code === payload.test_type)) {
      throw new Error(`نوع اختبار "${payload.test_type}" غير صالح لفئة "${MATERIAL_CATEGORY_LABELS[payload.material_category]}"`);
    }
  }
  if (payload.status && !MATERIAL_TEST_STATUSES.includes(payload.status)) {
    throw new Error(`حالة اختبار غير صالحة: ${payload.status}`);
  }
  if (payload.result && !MATERIAL_TEST_RESULTS.includes(payload.result)) {
    throw new Error(`نتيجة اختبار غير صالحة: ${payload.result}`);
  }
}

function createMaterialTest(payload) {
  validateMaterialTestPayload(payload);
  const store = loadStore();
  const testTypeDef = getTestTypesForCategory(payload.material_category)
    .find(t => t.code === payload.test_type);
  const id = newId('MT');
  const code = generateCode(store, 'MT');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    material_category: payload.material_category,
    test_type: payload.test_type,
    test_type_label: testTypeDef.label,
    unit: testTypeDef.unit,
    element: payload.element || null,
    location: payload.location || null,
    sample_reference: payload.sample_reference || null,
    lab_id: payload.lab_id || null,
    sampled_by: payload.sampled_by || null,
    sample_date: payload.sample_date || nowISO(),
    test_date: payload.test_date || null,
    acceptance_criteria: payload.acceptance_criteria || null,
    result_value: payload.result_value != null ? Number(payload.result_value) : null,
    status: 'pending',
    result: 'pending',
    notes: payload.notes || '',
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    itp_id: payload.itp_id || null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.materialTests[id] = record;
  audit(store, { action: 'create', entity: 'material_test', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listMaterialTests({ projectId, materialCategory, status, result, labId, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.materialTests);
  if (projectId) items = items.filter(t => t.project_id === projectId);
  if (materialCategory) items = items.filter(t => t.material_category === materialCategory);
  if (status) items = items.filter(t => t.status === status);
  if (result) items = items.filter(t => t.result === result);
  if (labId) items = items.filter(t => t.lab_id === labId);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(t =>
      (t.element || '').toLowerCase().includes(q) ||
      (t.code || '').toLowerCase().includes(q) ||
      (t.sample_reference || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getMaterialTest(id) {
  const store = loadStore();
  const record = store.materialTests[id];
  if (!record) throw new Error('اختبار المادة غير موجود');
  return { success: true, data: record };
}

function updateMaterialTest(id, changes) {
  const store = loadStore();
  const record = store.materialTests[id];
  if (!record) throw new Error('اختبار المادة غير موجود');
  if (record.status === 'completed' || record.status === 'cancelled') {
    throw new Error('لا يمكن تعديل اختبار مكتمل أو ملغى؛ يمكن فقط عرضه');
  }
  validateMaterialTestPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'element', 'location', 'sample_reference', 'lab_id', 'sampled_by',
    'sample_date', 'test_date', 'acceptance_criteria', 'notes', 'attachments', 'itp_id',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.materialTests[id] = record;

  audit(store, { action: 'update', entity: 'material_test', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteMaterialTest(id) {
  const store = loadStore();
  const record = store.materialTests[id];
  if (!record) throw new Error('اختبار المادة غير موجود');
  if (record.status === 'completed') {
    throw new Error('لا يمكن حذف اختبار مكتمل؛ السجل جزء من التوثيق الفني');
  }
  delete store.materialTests[id];
  audit(store, { action: 'delete', entity: 'material_test', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// تسجيل نتيجة الاختبار فعلياً: يقارن القيمة بمعيار القبول (إن أمكن تحليله رقمياً كحد أدنى/أقصى)
// وإلا يعتمد على النتيجة المُدخلة يدوياً (pass/fail) من الفني.
function recordMaterialTestResult(id, { result_value = null, result = null, tested_by = null, test_date = null, notes = '' } = {}) {
  const store = loadStore();
  const record = store.materialTests[id];
  if (!record) throw new Error('اختبار المادة غير موجود');
  if (record.status === 'completed' || record.status === 'cancelled') {
    throw new Error('هذا الاختبار مكتمل أو ملغى بالفعل');
  }

  let finalResult = result;
  if (result_value != null) {
    record.result_value = Number(result_value);
    // محاولة تقييم تلقائي إذا كان معيار القبول رقمياً بصيغة "min-max" أو ">= x" أو "<= x"
    if (!finalResult && record.acceptance_criteria) {
      finalResult = evaluateAgainstCriteria(record.result_value, record.acceptance_criteria);
    }
  }
  if (!finalResult || !MATERIAL_TEST_RESULTS.includes(finalResult) || finalResult === 'pending') {
    throw new Error('يجب تحديد نتيجة الاختبار (مطابق/غير مطابق) أو قيمة رقمية قابلة للمقارنة بمعيار القبول');
  }

  record.result = finalResult;
  record.status = 'completed';
  record.test_date = test_date || nowISO();
  record.tested_by = tested_by;
  if (notes) record.notes = `${record.notes ? record.notes + '\n' : ''}${notes}`;
  record.change_log.push({ ts: nowISO(), action: 'result_recorded', by: tested_by, result: finalResult });
  record.updated_at = nowISO();
  store.materialTests[id] = record;

  audit(store, { action: 'record_result', entity: 'material_test', entityId: id, projectId: record.project_id, details: { result: finalResult } });
  saveStore(store);
  return { success: true, data: record };
}

// تقييم رقمي فعلي مقابل معايير قبول بصيغ شائعة: "min-max", ">=x", "<=x", "=x"
function evaluateAgainstCriteria(value, criteria) {
  const c = String(criteria).trim().replace(/\s+/g, '');
  let m;
  if ((m = c.match(/^([\d.]+)-([\d.]+)$/))) {
    const [, lo, hi] = m;
    return (value >= Number(lo) && value <= Number(hi)) ? 'pass' : 'fail';
  }
  if ((m = c.match(/^>=([\d.]+)$/))) return value >= Number(m[1]) ? 'pass' : 'fail';
  if ((m = c.match(/^<=([\d.]+)$/))) return value <= Number(m[1]) ? 'pass' : 'fail';
  if ((m = c.match(/^>([\d.]+)$/))) return value > Number(m[1]) ? 'pass' : 'fail';
  if ((m = c.match(/^<([\d.]+)$/))) return value < Number(m[1]) ? 'pass' : 'fail';
  if ((m = c.match(/^=([\d.]+)$/))) return value === Number(m[1]) ? 'pass' : 'fail';
  return null; // معيار غير قابل للتحليل تلقائياً؛ يحتاج تقييماً يدوياً
}

function cancelMaterialTest(id, { by = null, reason = '' } = {}) {
  const store = loadStore();
  const record = store.materialTests[id];
  if (!record) throw new Error('اختبار المادة غير موجود');
  if (record.status === 'completed') throw new Error('لا يمكن إلغاء اختبار مكتمل بالفعل');
  record.status = 'cancelled';
  if (reason) record.notes = `${record.notes ? record.notes + '\n' : ''}سبب الإلغاء: ${reason}`;
  record.change_log.push({ ts: nowISO(), action: 'cancelled', by });
  record.updated_at = nowISO();
  store.materialTests[id] = record;
  audit(store, { action: 'cancel', entity: 'material_test', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة المختبر: المختبرات =====================

function validateLabPayload(payload, { partial = false } = {}) {
  if (!partial && (!payload.name || String(payload.name).trim() === '')) {
    throw new Error('اسم المختبر مطلوب');
  }
}

function createLab(payload) {
  validateLabPayload(payload);
  const store = loadStore();
  const id = newId('LAB');
  const record = {
    id,
    code: generateCode(store, 'LAB'),
    name: payload.name,
    accreditation_body: payload.accreditation_body || null,
    accreditation_number: payload.accreditation_number || null,
    location: payload.location || null,
    contact_person: payload.contact_person || null,
    phone: payload.phone || null,
    is_external: !!payload.is_external,
    notes: payload.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.labs[id] = record;
  audit(store, { action: 'create', entity: 'lab', entityId: id });
  saveStore(store);
  return { success: true, data: record };
}

function listLabs({ search } = {}) {
  const store = loadStore();
  let items = Object.values(store.labs);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(l => (l.name || '').toLowerCase().includes(q) || (l.code || '').toLowerCase().includes(q));
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return { success: true, data: items };
}

function getLab(id) {
  const store = loadStore();
  const record = store.labs[id];
  if (!record) throw new Error('المختبر غير موجود');
  return { success: true, data: record };
}

function updateLab(id, changes) {
  const store = loadStore();
  const record = store.labs[id];
  if (!record) throw new Error('المختبر غير موجود');
  validateLabPayload({ ...record, ...changes }, { partial: true });
  const updatable = ['name', 'accreditation_body', 'accreditation_number', 'location', 'contact_person', 'phone', 'is_external', 'notes'];
  for (const f of updatable) if (changes[f] !== undefined) record[f] = changes[f];
  record.updated_at = nowISO();
  store.labs[id] = record;
  audit(store, { action: 'update', entity: 'lab', entityId: id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteLab(id) {
  const store = loadStore();
  const record = store.labs[id];
  if (!record) throw new Error('المختبر غير موجود');
  const linkedTests = Object.values(store.materialTests).some(t => t.lab_id === id);
  if (linkedTests) throw new Error('لا يمكن حذف المختبر لوجود اختبارات مواد مرتبطة به');
  delete store.labs[id];
  audit(store, { action: 'delete', entity: 'lab', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

// ===================== إدارة المختبر: الفنيون =====================

function createLabTechnician(payload) {
  if (!payload.name) throw new Error('اسم الفني مطلوب');
  const store = loadStore();
  if (payload.lab_id && !store.labs[payload.lab_id]) throw new Error('المختبر المحدد غير موجود');
  const id = newId('TECH');
  const record = {
    id,
    name: payload.name,
    lab_id: payload.lab_id || null,
    qualification: payload.qualification || null,
    certificate_number: payload.certificate_number || null,
    certificate_expiry: payload.certificate_expiry || null,
    phone: payload.phone || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.labTechnicians[id] = record;
  audit(store, { action: 'create', entity: 'lab_technician', entityId: id });
  saveStore(store);
  return { success: true, data: record };
}

function listLabTechnicians({ labId } = {}) {
  const store = loadStore();
  let items = Object.values(store.labTechnicians);
  if (labId) items = items.filter(t => t.lab_id === labId);
  items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return { success: true, data: items };
}

function updateLabTechnician(id, changes) {
  const store = loadStore();
  const record = store.labTechnicians[id];
  if (!record) throw new Error('الفني غير موجود');
  const updatable = ['name', 'lab_id', 'qualification', 'certificate_number', 'certificate_expiry', 'phone'];
  for (const f of updatable) if (changes[f] !== undefined) record[f] = changes[f];
  record.updated_at = nowISO();
  store.labTechnicians[id] = record;
  audit(store, { action: 'update', entity: 'lab_technician', entityId: id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteLabTechnician(id) {
  const store = loadStore();
  if (!store.labTechnicians[id]) throw new Error('الفني غير موجود');
  delete store.labTechnicians[id];
  audit(store, { action: 'delete', entity: 'lab_technician', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

// ===================== إدارة المختبر: الأجهزة والمعايرة =====================

function validateEquipmentPayload(payload, { partial = false } = {}) {
  if (!partial && (!payload.name || String(payload.name).trim() === '')) {
    throw new Error('اسم الجهاز مطلوب');
  }
  if (payload.status && !LAB_EQUIPMENT_STATUSES.includes(payload.status)) {
    throw new Error(`حالة جهاز غير صالحة: ${payload.status}`);
  }
}

function createLabEquipment(payload) {
  validateEquipmentPayload(payload);
  const store = loadStore();
  if (payload.lab_id && !store.labs[payload.lab_id]) throw new Error('المختبر المحدد غير موجود');
  const id = newId('EQP');
  const record = {
    id,
    code: generateCode(store, 'LEQ'),
    name: payload.name,
    lab_id: payload.lab_id || null,
    serial_number: payload.serial_number || null,
    last_calibration_date: payload.last_calibration_date || null,
    next_calibration_date: payload.next_calibration_date || null,
    status: payload.status || 'active',
    notes: payload.notes || '',
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.labEquipment[id] = record;
  audit(store, { action: 'create', entity: 'lab_equipment', entityId: id });
  saveStore(store);
  return { success: true, data: record };
}

function listLabEquipment({ labId, status } = {}) {
  const store = loadStore();
  let items = Object.values(store.labEquipment);
  if (labId) items = items.filter(e => e.lab_id === labId);
  if (status) items = items.filter(e => e.status === status);
  // تحديث تلقائي لحالة "مستحق معايرة" بناءً على التاريخ الفعلي (وليس علماً وهمياً)
  const today = new Date();
  items = items.map(e => {
    if (e.status === 'active' && e.next_calibration_date && new Date(e.next_calibration_date) <= today) {
      return { ...e, status: 'due_calibration', status_auto_flagged: true };
    }
    return e;
  });
  items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return { success: true, data: items };
}

function updateLabEquipment(id, changes) {
  const store = loadStore();
  const record = store.labEquipment[id];
  if (!record) throw new Error('الجهاز غير موجود');
  validateEquipmentPayload({ ...record, ...changes }, { partial: true });
  const updatable = ['name', 'lab_id', 'serial_number', 'last_calibration_date', 'next_calibration_date', 'status', 'notes'];
  for (const f of updatable) if (changes[f] !== undefined) record[f] = changes[f];
  record.updated_at = nowISO();
  store.labEquipment[id] = record;
  audit(store, { action: 'update', entity: 'lab_equipment', entityId: id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

// تسجيل معايرة فعلية: يحدّث تاريخ آخر معايرة ويحسب تاريخ الاستحقاق التالي، ويعيد الحالة لـ "صالح"
function recordEquipmentCalibration(id, { calibration_date = null, next_calibration_date = null, calibrated_by = null } = {}) {
  const store = loadStore();
  const record = store.labEquipment[id];
  if (!record) throw new Error('الجهاز غير موجود');
  record.last_calibration_date = calibration_date || nowISO();
  if (next_calibration_date) record.next_calibration_date = next_calibration_date;
  record.status = 'active';
  record.updated_at = nowISO();
  store.labEquipment[id] = record;
  audit(store, { action: 'calibrate', entity: 'lab_equipment', entityId: id, details: { calibrated_by } });
  saveStore(store);
  return { success: true, data: record };
}

function deleteLabEquipment(id) {
  const store = loadStore();
  if (!store.labEquipment[id]) throw new Error('الجهاز غير موجود');
  delete store.labEquipment[id];
  audit(store, { action: 'delete', entity: 'lab_equipment', entityId: id });
  saveStore(store);
  return { success: true, data: { id } };
}

// ===================== نقاط الفحص (Inspection Test Plan - ITP) =====================

function validateItpPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'element', 'stage'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء نقطة فحص (ITP)`);
      }
    }
  }
  if (payload.inspection_type && !ITP_INSPECTION_TYPES.includes(payload.inspection_type)) {
    throw new Error(`نوع فحص غير صالح: ${payload.inspection_type}`);
  }
  if (payload.responsible_party && !ITP_RESPONSIBLE_PARTIES.includes(payload.responsible_party)) {
    throw new Error(`جهة مسؤولة غير صالحة: ${payload.responsible_party}`);
  }
  if (payload.status && !ITP_STATUSES.includes(payload.status)) {
    throw new Error(`حالة فحص غير صالحة: ${payload.status}`);
  }
}

function createItpItem(payload) {
  validateItpPayload(payload);
  const store = loadStore();
  const id = newId('ITP');
  const record = {
    id,
    code: generateCode(store, 'ITP'),
    project_id: payload.project_id,
    element: payload.element,
    stage: payload.stage,
    inspection_type: payload.inspection_type || 'witness',
    responsible_party: payload.responsible_party || 'contractor',
    acceptance_criteria: payload.acceptance_criteria || null,
    status: 'pending',
    notes: payload.notes || '',
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    ir_id: payload.ir_id || null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.itpItems[id] = record;
  audit(store, { action: 'create', entity: 'itp_item', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listItpItems({ projectId, status, inspectionType, responsibleParty, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.itpItems);
  if (projectId) items = items.filter(i => i.project_id === projectId);
  if (status) items = items.filter(i => i.status === status);
  if (inspectionType) items = items.filter(i => i.inspection_type === inspectionType);
  if (responsibleParty) items = items.filter(i => i.responsible_party === responsibleParty);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(i => (i.element || '').toLowerCase().includes(q) || (i.stage || '').toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q));
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getItpItem(id) {
  const store = loadStore();
  const record = store.itpItems[id];
  if (!record) throw new Error('نقطة الفحص غير موجودة');
  return { success: true, data: record };
}

function updateItpItem(id, changes) {
  const store = loadStore();
  const record = store.itpItems[id];
  if (!record) throw new Error('نقطة الفحص غير موجودة');
  if (record.status !== 'pending') {
    throw new Error('لا يمكن تعديل نقطة فحص تم البت فيها بالفعل (مجتازة/غير مجتازة/مستثناة)');
  }
  validateItpPayload({ ...record, ...changes }, { partial: true });
  const updatable = ['element', 'stage', 'inspection_type', 'responsible_party', 'acceptance_criteria', 'notes', 'documents', 'ir_id'];
  for (const f of updatable) if (changes[f] !== undefined) record[f] = changes[f];
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.itpItems[id] = record;
  audit(store, { action: 'update', entity: 'itp_item', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteItpItem(id) {
  const store = loadStore();
  const record = store.itpItems[id];
  if (!record) throw new Error('نقطة الفحص غير موجودة');
  if (record.status !== 'pending') throw new Error('لا يمكن حذف نقطة فحص تم البت فيها؛ السجل جزء من التوثيق');
  delete store.itpItems[id];
  audit(store, { action: 'delete', entity: 'itp_item', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// اعتماد نتيجة نقطة الفحص فعلياً (مجتاز/غير مجتاز/مستثنى) مع تسجيل الجهة المعتمِدة
function decideItpItem(id, { status, decided_by = null, notes = '' } = {}) {
  const store = loadStore();
  const record = store.itpItems[id];
  if (!record) throw new Error('نقطة الفحص غير موجودة');
  if (record.status !== 'pending') throw new Error('تم البت في نقطة الفحص هذه بالفعل');
  if (!['passed', 'failed', 'waived'].includes(status)) {
    throw new Error('يجب أن تكون النتيجة: مجتاز أو غير مجتاز أو مستثنى');
  }
  record.status = status;
  if (notes) record.notes = `${record.notes ? record.notes + '\n' : ''}${notes}`;
  record.change_log.push({ ts: nowISO(), action: `decided_${status}`, by: decided_by });
  record.updated_at = nowISO();
  store.itpItems[id] = record;
  audit(store, { action: 'decide', entity: 'itp_item', entityId: id, projectId: record.project_id, details: { status, decided_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== حالات عدم المطابقة (Non-Conformance Report - NCR) =====================
// (القسم التاسع - الجزء 3/4)

function validateNcrPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'element', 'description'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء حالة عدم مطابقة (NCR)`);
      }
    }
  }
  if (payload.severity && !NCR_SEVERITIES.includes(payload.severity)) {
    throw new Error(`درجة خطورة غير صالحة: ${payload.severity}`);
  }
  if (payload.discipline && !NCR_DISCIPLINES.includes(payload.discipline)) {
    throw new Error(`تخصص غير صالح: ${payload.discipline}`);
  }
}

function createNcr(payload) {
  validateNcrPayload(payload);
  const store = loadStore();
  const id = newId('NCR');
  const code = generateCode(store, 'NCR');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    element: payload.element,
    location: payload.location || null,
    discipline: payload.discipline || 'other',
    violation_type: payload.violation_type || null,
    description: payload.description,
    severity: payload.severity || 'minor',
    root_cause: payload.root_cause || null,
    photos: Array.isArray(payload.photos) ? payload.photos : [],
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    responsible_party: payload.responsible_party || null,
    ir_id: payload.ir_id || null,
    status: 'open',
    capa_ids: [],
    closed_by: null,
    closed_at: null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.ncrs[id] = record;
  audit(store, { action: 'create', entity: 'ncr', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listNcrs({ projectId, status, severity, discipline, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.ncrs);
  if (projectId) items = items.filter(n => n.project_id === projectId);
  if (status) items = items.filter(n => n.status === status);
  if (severity) items = items.filter(n => n.severity === severity);
  if (discipline) items = items.filter(n => n.discipline === discipline);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(n =>
      (n.element || '').toLowerCase().includes(q) ||
      (n.code || '').toLowerCase().includes(q) ||
      (n.description || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getNcr(id) {
  const store = loadStore();
  const record = store.ncrs[id];
  if (!record) throw new Error('حالة عدم المطابقة غير موجودة');
  const capas = Object.values(store.capas).filter(c => (record.capa_ids || []).includes(c.id));
  return { success: true, data: { ...record, capas } };
}

function updateNcr(id, changes) {
  const store = loadStore();
  const record = store.ncrs[id];
  if (!record) throw new Error('حالة عدم المطابقة غير موجودة');
  if (['closed', 'rejected'].includes(record.status)) {
    throw new Error('لا يمكن تعديل حالة عدم مطابقة مغلقة أو مرفوضة');
  }
  validateNcrPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'element', 'location', 'discipline', 'violation_type', 'description', 'severity',
    'root_cause', 'photos', 'documents', 'responsible_party',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.ncrs[id] = record;
  audit(store, { action: 'update', entity: 'ncr', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteNcr(id) {
  const store = loadStore();
  const record = store.ncrs[id];
  if (!record) throw new Error('حالة عدم المطابقة غير موجودة');
  if (record.status !== 'open') {
    throw new Error('لا يمكن حذف حالة عدم مطابقة إلا وهي في حالة "مفتوحة"؛ استخدم الرفض بدلاً من ذلك بعد بدء المعالجة');
  }
  if ((record.capa_ids || []).length > 0) {
    throw new Error('لا يمكن حذف حالة عدم مطابقة مرتبطة بإجراءات تصحيحية/وقائية');
  }
  delete store.ncrs[id];
  audit(store, { action: 'delete', entity: 'ncr', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// انتقال حالة NCR وفق دورة حياة حقيقية ومقيَّدة
function transitionNcr(id, { to_status, by = null, notes = '' } = {}) {
  const store = loadStore();
  const record = store.ncrs[id];
  if (!record) throw new Error('حالة عدم المطابقة غير موجودة');
  if (!NCR_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = NCR_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${NCR_STATUS_LABELS[record.status]}" إلى "${NCR_STATUS_LABELS[to_status]}"`);
  }

  // تحقق فعلي: لا يمكن الانتقال إلى "قيد المعالجة" بدون ربط إجراء تصحيحي واحد على الأقل
  if (to_status === 'in_progress' && (record.capa_ids || []).length === 0) {
    throw new Error('لا يمكن نقل الحالة إلى "قيد المعالجة" قبل ربط إجراء تصحيحي/وقائي واحد على الأقل (CAPA)');
  }
  // تحقق فعلي: لا يمكن الإغلاق إلا بعد أن تكون كل إجراءات CAPA المرتبطة "مغلقة"
  if (to_status === 'closed') {
    const linkedCapas = Object.values(store.capas).filter(c => (record.capa_ids || []).includes(c.id));
    const unclosed = linkedCapas.filter(c => c.status !== 'closed');
    if (unclosed.length > 0) {
      throw new Error('لا يمكن إغلاق حالة عدم المطابقة قبل إغلاق جميع الإجراءات التصحيحية/الوقائية المرتبطة بها');
    }
  }

  record.status = to_status;
  if (to_status === 'closed') {
    record.closed_by = by;
    record.closed_at = nowISO();
  }
  if (notes) record.root_cause = record.root_cause || notes;
  record.change_log.push({ ts: nowISO(), action: `transition_${to_status}`, by, notes });
  record.updated_at = nowISO();
  store.ncrs[id] = record;
  audit(store, { action: 'transition', entity: 'ncr', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== الإجراءات التصحيحية والوقائية (Corrective/Preventive Action - CAPA) =====================
// (القسم التاسع - الجزء 3/4)

function validateCapaPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'action_description', 'responsible_person'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء إجراء تصحيحي/وقائي (CAPA)`);
      }
    }
  }
  if (payload.type && !CAPA_TYPES.includes(payload.type)) {
    throw new Error(`نوع إجراء غير صالح: ${payload.type}`);
  }
  if (payload.effectiveness && !CAPA_EFFECTIVENESS.includes(payload.effectiveness)) {
    throw new Error(`تقييم فاعلية غير صالح: ${payload.effectiveness}`);
  }
}

function createCapa(payload) {
  validateCapaPayload(payload);
  const store = loadStore();

  // إن كان الإجراء مرتبطاً بـ NCR، تحقق من وجودها فعلياً وحدّث ربطها
  let linkedNcr = null;
  if (payload.ncr_id) {
    linkedNcr = store.ncrs[payload.ncr_id];
    if (!linkedNcr) throw new Error('حالة عدم المطابقة (NCR) المرتبطة غير موجودة');
    if (['closed', 'rejected'].includes(linkedNcr.status)) {
      throw new Error('لا يمكن ربط إجراء تصحيحي بحالة عدم مطابقة مغلقة أو مرفوضة');
    }
  }

  const id = newId('CAPA');
  const code = generateCode(store, 'CAPA');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    ncr_id: payload.ncr_id || null,
    type: payload.type || 'corrective',
    root_cause: payload.root_cause || null,
    action_description: payload.action_description,
    action_plan: payload.action_plan || null,
    responsible_person: payload.responsible_person,
    due_date: payload.due_date || null,
    status: 'open',
    verified_by: null,
    verified_at: null,
    verification_notes: null,
    effectiveness: 'not_evaluated',
    effectiveness_notes: null,
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.capas[id] = record;

  if (linkedNcr) {
    linkedNcr.capa_ids = Array.isArray(linkedNcr.capa_ids) ? linkedNcr.capa_ids : [];
    linkedNcr.capa_ids.push(id);
    linkedNcr.updated_at = nowISO();
    store.ncrs[linkedNcr.id] = linkedNcr;
  }

  audit(store, { action: 'create', entity: 'capa', entityId: id, projectId: record.project_id, details: { ncr_id: record.ncr_id } });
  saveStore(store);
  return { success: true, data: record };
}

function listCapas({ projectId, ncrId, status, type, responsiblePerson, overdueOnly, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.capas);
  if (projectId) items = items.filter(c => c.project_id === projectId);
  if (ncrId) items = items.filter(c => c.ncr_id === ncrId);
  if (status) items = items.filter(c => c.status === status);
  if (type) items = items.filter(c => c.type === type);
  if (responsiblePerson) {
    const q = String(responsiblePerson).toLowerCase();
    items = items.filter(c => (c.responsible_person || '').toLowerCase().includes(q));
  }
  if (overdueOnly) {
    const now = new Date();
    items = items.filter(c => c.status !== 'closed' && c.due_date && new Date(c.due_date) < now);
  }
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(c =>
      (c.action_description || '').toLowerCase().includes(q) ||
      (c.code || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getCapa(id) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  const ncr = record.ncr_id ? store.ncrs[record.ncr_id] || null : null;
  return { success: true, data: { ...record, ncr } };
}

function updateCapa(id, changes) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  if (record.status === 'closed') {
    throw new Error('لا يمكن تعديل إجراء تصحيحي/وقائي مغلق');
  }
  validateCapaPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'type', 'root_cause', 'action_description', 'action_plan',
    'responsible_person', 'due_date', 'documents',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.capas[id] = record;
  audit(store, { action: 'update', entity: 'capa', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteCapa(id) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  if (record.status !== 'open') {
    throw new Error('لا يمكن حذف إجراء تصحيحي/وقائي إلا وهو في حالة "مفتوح"');
  }
  delete store.capas[id];

  if (record.ncr_id && store.ncrs[record.ncr_id]) {
    const ncr = store.ncrs[record.ncr_id];
    ncr.capa_ids = (ncr.capa_ids || []).filter(cid => cid !== id);
    ncr.updated_at = nowISO();
    store.ncrs[record.ncr_id] = ncr;
  }

  audit(store, { action: 'delete', entity: 'capa', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// انتقال حالة CAPA وفق دورة حياة حقيقية ومقيَّدة
function transitionCapa(id, { to_status, by = null } = {}) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  if (!CAPA_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = CAPA_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${CAPA_STATUS_LABELS[record.status]}" إلى "${CAPA_STATUS_LABELS[to_status]}"`);
  }

  // تحقق فعلي: لا يمكن اعتماد الخطة بدون خطة تنفيذ مكتوبة فعلياً
  if (to_status === 'plan_approved' && (!record.action_plan || String(record.action_plan).trim() === '')) {
    throw new Error('لا يمكن اعتماد خطة الإجراء بدون تحديد خطة معالجة (action_plan) فعلية');
  }

  record.status = to_status;
  record.change_log.push({ ts: nowISO(), action: `transition_${to_status}`, by });
  record.updated_at = nowISO();
  store.capas[id] = record;
  audit(store, { action: 'transition', entity: 'capa', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

// تسجيل التحقق الفعلي من تنفيذ الإجراء (لا يمكن التحقق قبل أن يكون قيد التنفيذ)
function verifyCapa(id, { verified_by = null, notes = '' } = {}) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  if (record.status !== 'in_progress') {
    throw new Error('لا يمكن التحقق من إجراء إلا وهو في حالة "قيد التنفيذ"');
  }
  if (!verified_by) throw new Error('اسم الجهة المتحقِّقة (verified_by) مطلوب لتسجيل التحقق');

  record.status = 'verified';
  record.verified_by = verified_by;
  record.verified_at = nowISO();
  record.verification_notes = notes || null;
  record.change_log.push({ ts: nowISO(), action: 'verified', by: verified_by, notes });
  record.updated_at = nowISO();
  store.capas[id] = record;
  audit(store, { action: 'verify', entity: 'capa', entityId: id, projectId: record.project_id, details: { verified_by } });
  saveStore(store);
  return { success: true, data: record };
}

// تقييم فاعلية الإجراء واعتماد إغلاقه فعلياً (لا يُغلق إلا بعد التحقق وتقييم الفاعلية)
function evaluateCapaEffectiveness(id, { effectiveness, evaluated_by = null, notes = '' } = {}) {
  const store = loadStore();
  const record = store.capas[id];
  if (!record) throw new Error('الإجراء التصحيحي/الوقائي غير موجود');
  if (record.status !== 'verified') {
    throw new Error('لا يمكن تقييم الفاعلية إلا بعد التحقق من تنفيذ الإجراء');
  }
  if (!CAPA_EFFECTIVENESS.includes(effectiveness) || effectiveness === 'not_evaluated') {
    throw new Error('يجب تحديد تقييم فاعلية صالح: فعّال / فعّال جزئياً / غير فعّال');
  }

  record.effectiveness = effectiveness;
  record.effectiveness_notes = notes || null;
  record.status = 'closed';
  record.change_log.push({ ts: nowISO(), action: 'effectiveness_evaluated', by: evaluated_by, details: { effectiveness } });
  record.updated_at = nowISO();
  store.capas[id] = record;
  audit(store, { action: 'evaluate_effectiveness', entity: 'capa', entityId: id, projectId: record.project_id, details: { effectiveness, evaluated_by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة اعتماد المواد (Material Approval Request - MAR) =====================
// (القسم التاسع - الجزء 3/4)

function validateMarPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'material_name', 'supplier_name'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء طلب اعتماد مواد (MAR)`);
      }
    }
  }
  if (payload.discipline && !MAR_DISCIPLINES.includes(payload.discipline)) {
    throw new Error(`تخصص غير صالح: ${payload.discipline}`);
  }
}

function createMar(payload) {
  validateMarPayload(payload);
  const store = loadStore();
  const id = newId('MAR');
  const code = generateCode(store, 'MAR');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    material_name: payload.material_name,
    discipline: payload.discipline || 'other',
    supplier_name: payload.supplier_name,
    manufacturer: payload.manufacturer || null,
    country_of_origin: payload.country_of_origin || null,
    specification_reference: payload.specification_reference || null,
    quality_certificates: Array.isArray(payload.quality_certificates) ? payload.quality_certificates : [],
    test_results: Array.isArray(payload.test_results) ? payload.test_results : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    notes: payload.notes || null,
    status: 'draft',
    review_comments: [],
    decided_by: null,
    decided_at: null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.mars[id] = record;
  audit(store, { action: 'create', entity: 'mar', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listMars({ projectId, status, discipline, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.mars);
  if (projectId) items = items.filter(m => m.project_id === projectId);
  if (status) items = items.filter(m => m.status === status);
  if (discipline) items = items.filter(m => m.discipline === discipline);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(m =>
      (m.material_name || '').toLowerCase().includes(q) ||
      (m.code || '').toLowerCase().includes(q) ||
      (m.supplier_name || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getMar(id) {
  const store = loadStore();
  const record = store.mars[id];
  if (!record) throw new Error('طلب اعتماد المواد غير موجود');
  return { success: true, data: record };
}

function updateMar(id, changes) {
  const store = loadStore();
  const record = store.mars[id];
  if (!record) throw new Error('طلب اعتماد المواد غير موجود');
  if (['approved', 'approved_with_comments'].includes(record.status)) {
    throw new Error('لا يمكن تعديل طلب اعتماد مواد معتمد بالفعل');
  }
  validateMarPayload({ ...record, ...changes }, { partial: true });

  const updatable = [
    'material_name', 'discipline', 'supplier_name', 'manufacturer', 'country_of_origin',
    'specification_reference', 'quality_certificates', 'test_results', 'attachments', 'notes',
  ];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  // إذا كان الطلب مرفوضاً وجرى تعديله، يعود تلقائياً إلى مسودة لإعادة التقديم
  if (record.status === 'rejected') record.status = 'draft';
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.mars[id] = record;
  audit(store, { action: 'update', entity: 'mar', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteMar(id) {
  const store = loadStore();
  const record = store.mars[id];
  if (!record) throw new Error('طلب اعتماد المواد غير موجود');
  if (record.status !== 'draft') {
    throw new Error('لا يمكن حذف طلب اعتماد مواد إلا وهو في حالة "مسودة"');
  }
  delete store.mars[id];
  audit(store, { action: 'delete', entity: 'mar', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// انتقال حالة MAR وفق دورة حياة حقيقية ومقيَّدة
function transitionMar(id, { to_status, by = null, comment = '' } = {}) {
  const store = loadStore();
  const record = store.mars[id];
  if (!record) throw new Error('طلب اعتماد المواد غير موجود');
  if (!MAR_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = MAR_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${MAR_STATUS_LABELS[record.status]}" إلى "${MAR_STATUS_LABELS[to_status]}"`);
  }

  // تحقق فعلي: لا يمكن الإرسال بدون شهادات جودة أو نتائج اختبارات على الأقل
  if (to_status === 'submitted' && (record.quality_certificates || []).length === 0 && (record.test_results || []).length === 0) {
    throw new Error('لا يمكن إرسال طلب اعتماد المواد قبل إرفاق شهادة جودة واحدة أو نتيجة اختبار واحدة على الأقل');
  }
  // تحقق فعلي: قرارات الاعتماد/الرفض تتطلب تحديد الجهة القارِرة
  if (['approved', 'approved_with_comments', 'rejected'].includes(to_status) && !by) {
    throw new Error('اسم الجهة المُعتمِدة (by) مطلوب لتسجيل قرار الاعتماد أو الرفض');
  }

  record.status = to_status;
  if (['approved', 'approved_with_comments', 'rejected'].includes(to_status)) {
    record.decided_by = by;
    record.decided_at = nowISO();
  }
  if (comment) {
    record.review_comments.push({ ts: nowISO(), by, comment, status: to_status });
  }
  record.change_log.push({ ts: nowISO(), action: `transition_${to_status}`, by, comment });
  record.updated_at = nowISO();
  store.mars[id] = record;
  audit(store, { action: 'transition', entity: 'mar', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

// إضافة تعليق مراجعة دون تغيير الحالة (نقاش أثناء المراجعة)
function addMarComment(id, { by = null, comment } = {}) {
  const store = loadStore();
  const record = store.mars[id];
  if (!record) throw new Error('طلب اعتماد المواد غير موجود');
  if (!comment || String(comment).trim() === '') throw new Error('نص التعليق مطلوب');
  record.review_comments.push({ ts: nowISO(), by, comment, status: record.status });
  record.change_log.push({ ts: nowISO(), action: 'comment_added', by });
  record.updated_at = nowISO();
  store.mars[id] = record;
  audit(store, { action: 'comment', entity: 'mar', entityId: id, projectId: record.project_id, details: { by } });
  saveStore(store);
  return { success: true, data: record };
}

// ===================== إدارة اعتماد الرسومات (Shop Drawing Approval - SDR) =====================
// (القسم التاسع - الجزء 3/4)

function validateSdrPayload(payload, { partial = false } = {}) {
  const required = ['project_id', 'drawing_title', 'drawing_number'];
  if (!partial) {
    for (const f of required) {
      if (!payload[f] || String(payload[f]).trim() === '') {
        throw new Error(`الحقل "${f}" مطلوب لإنشاء طلب اعتماد رسم (SDR)`);
      }
    }
  }
  if (payload.discipline && !SDR_DISCIPLINES.includes(payload.discipline)) {
    throw new Error(`تخصص غير صالح: ${payload.discipline}`);
  }
}

function createSdr(payload) {
  validateSdrPayload(payload);
  const store = loadStore();
  const id = newId('SDR');
  const code = generateCode(store, 'SDR');
  const record = {
    id,
    code,
    project_id: payload.project_id,
    drawing_title: payload.drawing_title,
    drawing_number: payload.drawing_number,
    discipline: payload.discipline || 'other',
    contractor: payload.contractor || null,
    consultant: payload.consultant || null,
    // سجل إصدارات الرسم: كل رفع جديد يُضاف كإصدار برقم تسلسلي، مع رابط الملف وتاريخ الرفع
    versions: [{
      version_no: 1,
      file_url: payload.file_url || null,
      uploaded_by: payload.created_by || null,
      uploaded_at: nowISO(),
    }],
    current_version: 1,
    comments: [],
    status: 'draft',
    decided_by: null,
    decided_at: null,
    change_log: [{ ts: nowISO(), action: 'created', by: payload.created_by || null }],
    created_by: payload.created_by || null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  store.sdrs[id] = record;
  audit(store, { action: 'create', entity: 'sdr', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: record };
}

function listSdrs({ projectId, status, discipline, search } = {}) {
  const store = loadStore();
  let items = Object.values(store.sdrs);
  if (projectId) items = items.filter(s => s.project_id === projectId);
  if (status) items = items.filter(s => s.status === status);
  if (discipline) items = items.filter(s => s.discipline === discipline);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(s =>
      (s.drawing_title || '').toLowerCase().includes(q) ||
      (s.drawing_number || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q)
    );
  }
  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, data: items };
}

function getSdr(id) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  return { success: true, data: record };
}

function updateSdr(id, changes) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  if (['approved', 'approved_with_comments'].includes(record.status)) {
    throw new Error('لا يمكن تعديل طلب اعتماد رسم معتمد بالفعل');
  }
  validateSdrPayload({ ...record, ...changes }, { partial: true });

  const updatable = ['drawing_title', 'drawing_number', 'discipline', 'contractor', 'consultant'];
  for (const f of updatable) {
    if (changes[f] !== undefined) record[f] = changes[f];
  }
  record.change_log.push({ ts: nowISO(), action: 'updated', by: changes.updated_by || null, fields: Object.keys(changes) });
  record.updated_at = nowISO();
  store.sdrs[id] = record;
  audit(store, { action: 'update', entity: 'sdr', entityId: id, projectId: record.project_id, details: changes });
  saveStore(store);
  return { success: true, data: record };
}

function deleteSdr(id) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  if (record.status !== 'draft') {
    throw new Error('لا يمكن حذف طلب اعتماد رسم إلا وهو في حالة "مسودة"');
  }
  delete store.sdrs[id];
  audit(store, { action: 'delete', entity: 'sdr', entityId: id, projectId: record.project_id });
  saveStore(store);
  return { success: true, data: { id } };
}

// رفع إصدار جديد من الرسم (مقارنة الإصدارات وسجل الاعتمادات الفعلي عبر versions[])
function uploadSdrVersion(id, { file_url, uploaded_by = null } = {}) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  if (!file_url) throw new Error('رابط ملف الرسم (file_url) مطلوب لرفع إصدار جديد');
  if (['approved', 'approved_with_comments'].includes(record.status)) {
    throw new Error('لا يمكن رفع إصدار جديد لطلب معتمد بالفعل؛ الرسم المعتمد هو النسخة النهائية');
  }

  const nextVersion = record.current_version + 1;
  record.versions.push({ version_no: nextVersion, file_url, uploaded_by, uploaded_at: nowISO() });
  record.current_version = nextVersion;
  // رفع إصدار جديد بعد الرفض يعيد الطلب تلقائياً لحالة مسودة تمهيداً لإعادة الإرسال
  if (record.status === 'rejected_resubmit') record.status = 'draft';
  record.change_log.push({ ts: nowISO(), action: 'version_uploaded', by: uploaded_by, details: { version_no: nextVersion } });
  record.updated_at = nowISO();
  store.sdrs[id] = record;
  audit(store, { action: 'upload_version', entity: 'sdr', entityId: id, projectId: record.project_id, details: { version_no: nextVersion } });
  saveStore(store);
  return { success: true, data: record };
}

// إضافة تعليق مراجعة على رسم (مرتبط برقم إصدار محدد)
function addSdrComment(id, { by = null, comment, version_no = null } = {}) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  if (!comment || String(comment).trim() === '') throw new Error('نص التعليق مطلوب');
  record.comments.push({
    ts: nowISO(), by, comment, version_no: version_no || record.current_version, status: record.status,
  });
  record.change_log.push({ ts: nowISO(), action: 'comment_added', by });
  record.updated_at = nowISO();
  store.sdrs[id] = record;
  audit(store, { action: 'comment', entity: 'sdr', entityId: id, projectId: record.project_id, details: { by } });
  saveStore(store);
  return { success: true, data: record };
}

// انتقال حالة SDR وفق دورة حياة حقيقية ومقيَّدة (الاعتماد الإلكتروني وسجل الاعتمادات)
function transitionSdr(id, { to_status, by = null, comment = '' } = {}) {
  const store = loadStore();
  const record = store.sdrs[id];
  if (!record) throw new Error('طلب اعتماد الرسم غير موجود');
  if (!SDR_STATUSES.includes(to_status)) throw new Error(`حالة غير صالحة: ${to_status}`);

  const allowed = SDR_ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes(to_status)) {
    throw new Error(`لا يمكن الانتقال من الحالة "${SDR_STATUS_LABELS[record.status]}" إلى "${SDR_STATUS_LABELS[to_status]}"`);
  }

  // تحقق فعلي: لا يمكن الإرسال بدون ملف رسم مرفوع فعلياً للإصدار الحالي
  if (to_status === 'submitted') {
    const currentVersion = record.versions.find(v => v.version_no === record.current_version);
    if (!currentVersion || !currentVersion.file_url) {
      throw new Error('لا يمكن إرسال طلب اعتماد الرسم قبل رفع ملف الرسم للإصدار الحالي');
    }
  }
  // تحقق فعلي: قرارات الاعتماد/الرفض تتطلب تحديد الجهة القارِرة (اعتماد إلكتروني)
  if (['approved', 'approved_with_comments', 'rejected_resubmit'].includes(to_status) && !by) {
    throw new Error('اسم الجهة المُعتمِدة (by) مطلوب لتسجيل قرار الاعتماد أو الرفض');
  }

  record.status = to_status;
  if (['approved', 'approved_with_comments', 'rejected_resubmit'].includes(to_status)) {
    record.decided_by = by;
    record.decided_at = nowISO();
  }
  if (comment) {
    record.comments.push({ ts: nowISO(), by, comment, version_no: record.current_version, status: to_status });
  }
  record.change_log.push({ ts: nowISO(), action: `transition_${to_status}`, by, comment });
  record.updated_at = nowISO();
  store.sdrs[id] = record;
  audit(store, { action: 'transition', entity: 'sdr', entityId: id, projectId: record.project_id, details: { to_status, by } });
  saveStore(store);
  return { success: true, data: record };
}

module.exports = {
  // ثوابت - الجزء 1
  QUALITY_PLAN_STATUSES, QUALITY_PLAN_STATUS_LABELS,
  IR_STATUSES, IR_STATUS_LABELS, IR_ALLOWED_TRANSITIONS,
  IR_RESULTS, IR_RESULT_LABELS,
  IR_DISCIPLINES, IR_DISCIPLINE_LABELS,

  // ثوابت - الجزء 2
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, TEST_TYPES_BY_CATEGORY,
  MATERIAL_TEST_STATUSES, MATERIAL_TEST_STATUS_LABELS,
  MATERIAL_TEST_RESULTS, MATERIAL_TEST_RESULT_LABELS,
  LAB_EQUIPMENT_STATUSES, LAB_EQUIPMENT_STATUS_LABELS,
  ITP_INSPECTION_TYPES, ITP_INSPECTION_TYPE_LABELS,
  ITP_RESPONSIBLE_PARTIES, ITP_RESPONSIBLE_PARTY_LABELS,
  ITP_STATUSES, ITP_STATUS_LABELS,

  // ثوابت - الجزء 3 (NCR / CAPA)
  NCR_STATUSES, NCR_STATUS_LABELS, NCR_ALLOWED_TRANSITIONS,
  NCR_SEVERITIES, NCR_SEVERITY_LABELS,
  NCR_DISCIPLINES, NCR_DISCIPLINE_LABELS,
  CAPA_STATUSES, CAPA_STATUS_LABELS, CAPA_ALLOWED_TRANSITIONS,
  CAPA_TYPES, CAPA_TYPE_LABELS,
  CAPA_EFFECTIVENESS, CAPA_EFFECTIVENESS_LABELS,

  // ثوابت - الجزء 3 (MAR / SDR)
  MAR_STATUSES, MAR_STATUS_LABELS, MAR_ALLOWED_TRANSITIONS,
  MAR_DISCIPLINES, MAR_DISCIPLINE_LABELS,
  SDR_STATUSES, SDR_STATUS_LABELS, SDR_ALLOWED_TRANSITIONS,
  SDR_DISCIPLINES, SDR_DISCIPLINE_LABELS,

  // لوحة التحكم
  getDashboard,

  // خطة الجودة
  createQualityPlan, listQualityPlans, getQualityPlan, updateQualityPlan,
  deleteQualityPlan, approveQualityPlan,

  // طلبات الفحص IR
  createInspectionRequest, listInspectionRequests, getInspectionRequest,
  updateInspectionRequest, deleteInspectionRequest, transitionInspectionRequest,
  recordInspectionResult, signInspectionRequest,

  // اختبارات المواد
  createMaterialTest, listMaterialTests, getMaterialTest, updateMaterialTest,
  deleteMaterialTest, recordMaterialTestResult, cancelMaterialTest,

  // المختبرات
  createLab, listLabs, getLab, updateLab, deleteLab,

  // فنيو المختبر
  createLabTechnician, listLabTechnicians, updateLabTechnician, deleteLabTechnician,

  // أجهزة المختبر والمعايرة
  createLabEquipment, listLabEquipment, updateLabEquipment,
  recordEquipmentCalibration, deleteLabEquipment,

  // نقاط الفحص ITP
  createItpItem, listItpItems, getItpItem, updateItpItem, deleteItpItem, decideItpItem,

  // حالات عدم المطابقة NCR
  createNcr, listNcrs, getNcr, updateNcr, deleteNcr, transitionNcr,

  // الإجراءات التصحيحية والوقائية CAPA
  createCapa, listCapas, getCapa, updateCapa, deleteCapa,
  transitionCapa, verifyCapa, evaluateCapaEffectiveness,

  // اعتماد المواد MAR
  createMar, listMars, getMar, updateMar, deleteMar, transitionMar, addMarComment,

  // اعتماد الرسومات SDR
  createSdr, listSdrs, getSdr, updateSdr, deleteSdr,
  uploadSdrVersion, addSdrComment, transitionSdr,

  // للاستخدام الداخلي من أجزاء لاحقة (4/4)
  loadStore, saveStore, audit, generateCode, newId, nowISO, r2,
};
