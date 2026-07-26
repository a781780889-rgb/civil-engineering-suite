/**
 * القسم الرابع عشر - نظام التقارير والتحليلات المتكامل (Reports & Analytics System)
 * ====================================================================================
 * الجزء 7/10 (1 من 3): قوالب التقارير (Report Templates)
 *
 * يبني على نفس ملف تخزين reportsCenter.json (المفتاح templates{} كان محجوزاً منذ
 * الجزء 1/10)، بنفس نمط hseManagement.js / documentManagement.js - بدون تبعيات خارجية.
 *
 * يوفر:
 *  - حفظ قالب تقرير كامل: الاسم، نوع التقرير المرتبط (report_key من كتالوج الجزء 1)،
 *    التصميم (columns/sections المختارة من Report Builder الجزء 2)، الرسوم البيانية
 *    المطلوبة (الجزء 4)، الشعار، التوقيعات المطلوبة (يُبنى عليها في نفس الجزء عبر
 *    reportApprovals.js)، رأس/تذييل الصفحة (نفس بنية printOptions في reportExportEngine).
 *  - نسخ القالب (clone) لبناء قالب جديد من قالب موجود بدون التأثير على الأصل.
 *  - تعديل/حذف (حذف فعلي مع منع حذف قالب مستخدَم في جدولة نشطة).
 *  - استخدام القالب في مشاريع متعددة: applyTemplateToReportRequest يدمج إعدادات
 *    القالب مع طلب توليد تقرير فعلي (مشروع/فترة محددة وقت الاستخدام) لإنتاج تعريف
 *    تقرير جاهز يُمرَّر مباشرة لـ reportBuilder / reportExportEngine.
 *  - سجل استخدام حقيقي (usage_count, last_used_at) يُحدَّث عند كل استخدام فعلي.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'reportsCenter.json');

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      reportRecords: {}, templates: {}, scheduledReports: {}, shares: {}, auditLog: [], seq: 0,
    }, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    throw new Error('تعذر قراءة قاعدة بيانات نظام التقارير: ' + e.message);
  }
  if (!store.templates) store.templates = {};
  if (!store.auditLog) store.auditLog = [];
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function audit(store, { action, entity, entityId, projectId = null, userId = null, details = {} }) {
  if (!store.auditLog) store.auditLog = [];
  store.auditLog.push({ ts: nowISO(), action, entity, entityId, projectId, userId, details });
  if (store.auditLog.length > 10000) store.auditLog = store.auditLog.slice(-10000);
}

// ===================== حقول القالب المسموح بها (تصميم القالب) =====================

const TEMPLATE_DESIGN_FIELDS = [
  'reportKey',       // نوع التقرير المرتبط من كتالوج الجزء 1/10 (اختياري لقالب Report Builder المخصّص)
  'columns',         // الأعمدة المختارة (شكل Report Builder - الجزء 2/10)
  'filters',         // الفلاتر الافتراضية للقالب
  'groupBy',         // التجميع الافتراضي
  'sortBy',          // الترتيب الافتراضي
  'charts',          // الرسوم البيانية المطلوبة (الجزء 4/10): [{ type, sourceKey }]
  'kpis',            // مؤشرات KPI المطلوبة
  'sections',         // أقسام فرعية إضافية
];

const PRINT_OPTION_FIELDS = [
  'paperSize', 'orientation', 'marginMm', 'showHeader', 'showFooter',
  'showPageNumbers', 'companyLogoText', 'companyLogoUrl',
];

function pickFields(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function validateTemplateInput({ name, requiredSignatureLevels }) {
  if (!name || !String(name).trim()) throw new Error('اسم القالب (name) مطلوب');
  if (requiredSignatureLevels !== undefined) {
    if (!Array.isArray(requiredSignatureLevels)) throw new Error('requiredSignatureLevels يجب أن تكون مصفوفة');
    const seen = new Set();
    for (const lvl of requiredSignatureLevels) {
      if (!Number.isInteger(lvl.level) || lvl.level < 1) throw new Error('كل مستوى توقيع في القالب يحتاج رقم level صحيح ابتداءً من 1');
      if (seen.has(lvl.level)) throw new Error(`رقم مستوى التوقيع ${lvl.level} مكرر داخل نفس القالب`);
      seen.add(lvl.level);
      if (!lvl.label) throw new Error(`مستوى التوقيع رقم ${lvl.level} يحتاج اسماً (label)`);
    }
  }
}

// ===================== دورة حياة القالب =====================

function createTemplate({
  name, reportType = null, design = {}, printOptions = {}, requiredSignatureLevels = [],
  sequentialSignatures = true, notes = null, userId = null,
} = {}) {
  validateTemplateInput({ name, requiredSignatureLevels });
  const store = loadStore();
  const id = newId('TPL');
  const record = {
    id,
    name: String(name).trim(),
    report_type: reportType,
    design: pickFields(design, TEMPLATE_DESIGN_FIELDS),
    print_options: pickFields(printOptions, PRINT_OPTION_FIELDS),
    required_signature_levels: requiredSignatureLevels.map((l) => ({
      level: l.level, label: l.label, required_role: l.required_role || null,
    })).sort((a, b) => a.level - b.level),
    sequential_signatures: !!sequentialSignatures,
    notes: notes || null,
    created_by: userId,
    created_at: nowISO(),
    updated_at: nowISO(),
    usage_count: 0,
    last_used_at: null,
    is_active: true,
    cloned_from: null,
  };
  store.templates[id] = record;
  audit(store, { action: 'create_template', entity: 'template', entityId: id, userId, details: { name: record.name } });
  saveStore(store);
  return record;
}

function getTemplate(id) {
  const store = loadStore();
  const tpl = store.templates[id];
  if (!tpl) throw new Error('القالب غير موجود');
  return tpl;
}

function listTemplates({ reportType = null, activeOnly = false, search = null } = {}) {
  const store = loadStore();
  let rows = Object.values(store.templates);
  if (reportType) rows = rows.filter((t) => t.report_type === reportType);
  if (activeOnly) rows = rows.filter((t) => t.is_active !== false);
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((t) => t.name.toLowerCase().includes(q));
  }
  rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return rows;
}

function updateTemplate(id, updates = {}, userId = null) {
  const store = loadStore();
  const tpl = store.templates[id];
  if (!tpl) throw new Error('القالب غير موجود');

  if (updates.name !== undefined) {
    if (!String(updates.name).trim()) throw new Error('اسم القالب لا يمكن أن يكون فارغاً');
    tpl.name = String(updates.name).trim();
  }
  if (updates.reportType !== undefined) tpl.report_type = updates.reportType;
  if (updates.design !== undefined) tpl.design = pickFields(updates.design, TEMPLATE_DESIGN_FIELDS);
  if (updates.printOptions !== undefined) tpl.print_options = pickFields(updates.printOptions, PRINT_OPTION_FIELDS);
  if (updates.requiredSignatureLevels !== undefined) {
    validateTemplateInput({ name: tpl.name, requiredSignatureLevels: updates.requiredSignatureLevels });
    tpl.required_signature_levels = updates.requiredSignatureLevels
      .map((l) => ({ level: l.level, label: l.label, required_role: l.required_role || null }))
      .sort((a, b) => a.level - b.level);
  }
  if (updates.sequentialSignatures !== undefined) tpl.sequential_signatures = !!updates.sequentialSignatures;
  if (updates.notes !== undefined) tpl.notes = updates.notes;
  if (updates.isActive !== undefined) tpl.is_active = !!updates.isActive;

  tpl.updated_at = nowISO();
  audit(store, { action: 'update_template', entity: 'template', entityId: id, userId });
  saveStore(store);
  return tpl;
}

function cloneTemplate(id, { newName = null, userId = null } = {}) {
  const store = loadStore();
  const original = store.templates[id];
  if (!original) throw new Error('القالب المطلوب نسخه غير موجود');
  const cloneId = newId('TPL');
  const clone = {
    ...JSON.parse(JSON.stringify(original)),
    id: cloneId,
    name: newName || `${original.name} (نسخة)`,
    created_by: userId,
    created_at: nowISO(),
    updated_at: nowISO(),
    usage_count: 0,
    last_used_at: null,
    cloned_from: id,
  };
  store.templates[cloneId] = clone;
  audit(store, { action: 'clone_template', entity: 'template', entityId: cloneId, userId, details: { cloned_from: id } });
  saveStore(store);
  return clone;
}

function deleteTemplate(id, userId = null) {
  const store = loadStore();
  const tpl = store.templates[id];
  if (!tpl) throw new Error('القالب غير موجود');

  const usedBySchedule = Object.values(store.scheduledReports || {}).some(
    (s) => s.active !== false && s.template_id === id,
  );
  if (usedBySchedule) {
    throw new Error('لا يمكن حذف هذا القالب لأنه مستخدَم في جدولة تلقائية نشطة. عطّل الجدولة أولاً');
  }

  delete store.templates[id];
  audit(store, { action: 'delete_template', entity: 'template', entityId: id, userId, details: { name: tpl.name } });
  saveStore(store);
  return { success: true, deleted_id: id };
}

/**
 * يدمج قالباً محفوظاً مع طلب توليد تقرير فعلي وقت الاستخدام (مشروع/فترة/فلاتر إضافية)
 * لإنتاج تعريف تقرير جاهز يُستهلَك مباشرة من reportBuilder.buildCustomReport أو
 * من أي دالة بناء تقرير أخرى، ويُسجَّل الاستخدام فعلياً (usage_count/last_used_at).
 */
function applyTemplateToReportRequest(templateId, { projectId = null, periodFrom = null, periodTo = null, extraFilters = {} } = {}, userId = null) {
  const store = loadStore();
  const tpl = store.templates[templateId];
  if (!tpl) throw new Error('القالب غير موجود');
  if (tpl.is_active === false) throw new Error('هذا القالب معطَّل حالياً ولا يمكن استخدامه');

  tpl.usage_count = (tpl.usage_count || 0) + 1;
  tpl.last_used_at = nowISO();
  audit(store, {
    action: 'use_template', entity: 'template', entityId: templateId, projectId, userId,
    details: { period_from: periodFrom, period_to: periodTo },
  });
  saveStore(store);

  return {
    template_id: tpl.id,
    template_name: tpl.name,
    report_key: tpl.design.reportKey || tpl.report_type || null,
    columns: tpl.design.columns || null,
    filters: { ...(tpl.design.filters || {}), ...extraFilters, projectId, periodFrom, periodTo },
    group_by: tpl.design.groupBy || null,
    sort_by: tpl.design.sortBy || null,
    charts: tpl.design.charts || [],
    kpis: tpl.design.kpis || [],
    sections: tpl.design.sections || [],
    print_options: tpl.print_options || {},
    required_signature_levels: tpl.required_signature_levels || [],
    sequential_signatures: tpl.sequential_signatures,
  };
}

function getTemplatesSummary() {
  const store = loadStore();
  const all = Object.values(store.templates);
  const active = all.filter((t) => t.is_active !== false);
  const mostUsed = [...all].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)).slice(0, 10)
    .map((t) => ({ id: t.id, name: t.name, usage_count: t.usage_count || 0, last_used_at: t.last_used_at }));
  return {
    total_templates: all.length,
    active_templates: active.length,
    most_used_templates: mostUsed,
  };
}

module.exports = {
  TEMPLATE_DESIGN_FIELDS,
  PRINT_OPTION_FIELDS,
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  cloneTemplate,
  deleteTemplate,
  applyTemplateToReportRequest,
  getTemplatesSummary,
};
