/**
 * القسم الخامس عشر - نظام الذكاء الاصطناعي الهندسي المتكامل (AI Engineering System)
 * ===================================================================================
 * الجزء التاسع (9/10): البحث الموحّد + قاعدة المعرفة (RAG) + نظام المصادر والمراجع
 *                       + نظام الثقة والتحقق + ذكاء الأعمال + تحليل الصور + الأسئلة
 *                       المركّبة + الربط الكامل مع كل الأقسام
 * ===================================================================================
 *
 * تنفيذ حقيقي فقط:
 *  - البحث الموحّد (البند 20) يستعلم فعلياً عن بيانات المشاريع، المستندات (عبر
 *    documentSearch.js الحقيقي)، المخططات، العقود، التقارير، المعدات، العملاء،
 *    المهام - كل ذلك عبر استدعاء دوال الوحدات الفعلية (لا بيانات وهمية).
 *  - قاعدة المعرفة (البند 21) تبني فهرساً فعلياً من ملفات النظام الحقيقية الموجودة
 *    على القرص (documents/DMS الفعلية، القوالب الفعلية reportTemplates.js) وتستخدم
 *    استرجاعاً بالكلمات المفتاحية الحقيقي (RAG بدون embeddings خارجية غير متوفرة)،
 *    مع ذكر المصدر دائماً.
 *  - نظام المصادر والمراجع (البند 22) ونظام الثقة (البند 23) يُطبَّقان كطبقة موحّدة
 *    تُغلِّف أي نتيجة AI قادمة من الأجزاء السابقة (1-8) بالإضافة لهذا الجزء.
 *  - ذكاء الأعمال (البند 16) يستدعي businessManagement.js و businessContracts.js
 *    الحقيقيين لتحليل العملاء/الموردين/العقود/الفرص التجارية من بيانات فعلية.
 *  - الأسئلة المركّبة (البند 19) تُترجم شروط السؤال إلى استعلامات آمنة عبر الدوال
 *    الفعلية الموجودة (listProjects بمرشحات، إلخ) - وليس تنفيذ SQL حر غير مقيّد.
 *  - تحليل الصور (البند 18) يعيد استخدام استخراج OCR الحقيقي من drawingAI.js/
 *    documentSearch.js إن كانت الصورة PDF/مستند ممسوح، ويُقرّ بوضوح متى لا تتوفر
 *    خدمة رؤية حاسوبية (Vision Model) فعلية بدل اختلاق وصف.
 *
 * لا ميزات وهمية: أي دالة هنا تحتاج مزوّد AI خارجي (OpenAI/Anthropic Vision, إلخ)
 * غير مهيّأ فعلياً في البيئة (ANTHROPIC_API_KEY غائب) تُعيد حالة صريحة
 * `{ available: false, reason: '...' }` بدل نتيجة ملفّقة.
 */

const fs = require('fs');
const path = require('path');

const CORE = require('./aiEngineeringCore');
const DATA_ACCESS = require('./aiDataAccessLayer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KB_INDEX_FILE = path.join(DATA_DIR, 'ai_knowledge_index.json');

function tryRequire(rel) {
  try { return require(rel); } catch (e) { return null; }
}

const PM = tryRequire('./projectManagement');
const DOC_SEARCH = tryRequire('./documentSearch');
const DOC_MGMT = tryRequire('./documentManagement');
const DRAWING_MGMT = tryRequire('./drawingManagement');
const DRAWING_AI = tryRequire('./drawingAI');
const BIZ_CONTRACTS = tryRequire('./businessContracts');
const BIZ_MGMT = tryRequire('./businessManagement');
const EQUIPMENT_MGMT = tryRequire('./equipmentManagement');
const REPORTS_CENTER = tryRequire('./reportsCenter');
const REPORT_TEMPLATES = tryRequire('./reportTemplates');

function nowISO() { return new Date().toISOString(); }

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function isAIAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ===================================================================================
// أدوات مشتركة: نظام المصادر والمراجع (البند 22) + نظام الثقة والتحقق (البند 23)
// ===================================================================================

/**
 * يبني كائن "مصدر" موحّداً يُرفَق مع أي حقيقة يستخرجها AI من بيانات النظام،
 * بالشكل المطلوب حرفياً: اسم المشروع/المستند، رقمه، تاريخ البيانات، مصدر المعلومة.
 */
function buildSource({ type, id, label, projectName = null, updatedAt = null }) {
  return {
    type,                          // project | document | drawing | contract | report | equipment | boq | budget
    id,
    label,
    project_name: projectName,
    data_date: updatedAt || null,
    citation_text: `المصدر: ${label}${id ? ` رقم ${id}` : ''}${updatedAt ? ` — آخر تحديث: ${new Date(updatedAt).toLocaleDateString('ar-EG')}` : ''}`,
  };
}

/**
 * يحسب مستوى ثقة صريحاً بناءً على: عدد المصادر الفعلية المتاحة، اكتمال الحقول
 * المطلوبة، وحداثة البيانات - وليس رقماً عشوائياً. إن لم تتوفر بيانات كافية
 * (لا مصادر إطلاقاً) يعيد null مع سبب واضح بدل اختلاق نتيجة.
 */
function assessConfidence({ sources = [], requiredFields = [], providedFields = [], maxDataAgeDays = 90 }) {
  if (!sources.length) {
    return {
      level: null,
      label_ar: 'غير كافٍ',
      reason: 'لا توجد بيانات كافية لإعطاء نتيجة موثوقة',
      insufficient: true,
    };
  }

  let score = 40; // نقطة بداية لوجود مصدر واحد على الأقل
  score += Math.min(sources.length - 1, 4) * 10; // كل مصدر إضافي حتى 4 يرفع الثقة

  if (requiredFields.length) {
    const completeness = providedFields.length / requiredFields.length;
    score += Math.round(completeness * 30);
  } else {
    score += 20;
  }

  const freshDates = sources.map(s => s.data_date).filter(Boolean).map(d => new Date(d).getTime());
  if (freshDates.length) {
    const mostRecent = Math.max(...freshDates);
    const ageDays = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
    if (ageDays <= maxDataAgeDays) score += 10;
    else score -= Math.min(20, Math.round((ageDays - maxDataAgeDays) / 30) * 5);
  }

  score = Math.max(5, Math.min(100, score));
  let label_ar;
  if (score >= 80) label_ar = 'مرتفعة';
  else if (score >= 55) label_ar = 'متوسطة';
  else label_ar = 'منخفضة - يُنصح بمراجعة بشرية';

  return { level: score, label_ar, reason: null, insufficient: false };
}

/** يغلّف أي نتيجة AI بطبقة المصادر + الثقة الموحّدة قبل إعادتها للواجهة */
function wrapWithTrust(result, { sources = [], requiredFields = [], providedFields = [], reasonForRecommendation = null }) {
  const confidence = assessConfidence({ sources, requiredFields, providedFields });
  return {
    ...result,
    _trust: {
      sources,
      confidence,
      reason_for_recommendation: reasonForRecommendation,
      generated_at: nowISO(),
    },
  };
}

// ===================================================================================
// البند 21: قاعدة المعرفة الهندسية (Knowledge Base) + RAG بالكلمات المفتاحية
// ===================================================================================

const KB_SOURCE_KINDS = {
  report_template: { label_ar: 'قالب تقرير', section: 14 },
  document: { label_ar: 'مستند مُعتمد', section: 11 },
};

function normalizeText(s) {
  return String(s || '')
    .replace(/[\u064B-\u065F]/g, '') // إزالة التشكيل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();
}

function tokenize(s) {
  return normalizeText(s).split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2);
}

/** يبني/يحدّث فهرس قاعدة المعرفة من مصادر حقيقية فعلية على القرص */
function rebuildKnowledgeIndex() {
  const entries = [];

  // 1) قوالب التقارير الحقيقية (القسم 14، الجزء 7/10) كإجراءات عمل/قوالب موثّقة
  if (REPORT_TEMPLATES && typeof REPORT_TEMPLATES.listTemplates === 'function') {
    try {
      const templates = REPORT_TEMPLATES.listTemplates() || [];
      for (const t of templates) {
        entries.push({
          id: `kb_tpl_${t.id}`,
          kind: 'report_template',
          title: t.name || t.title || `قالب ${t.id}`,
          content: [t.name, t.description, t.category].filter(Boolean).join(' — '),
          tokens: tokenize([t.name, t.description, t.category].filter(Boolean).join(' ')),
          source: buildSource({ type: 'report', id: t.id, label: `قالب تقرير: ${t.name || t.id}`, updatedAt: t.updated_at || t.created_at }),
        });
      }
    } catch (e) { /* لا نوقف بناء الفهرس بسبب فشل مصدر واحد */ }
  }

  // 2) المستندات المعتمدة الفعلية من نظام DMS (القسم 11) مع نصها المفهرس فعلياً
  //    إن توفّر (يعاد استخدام فهرس البحث الحقيقي في documentSearch.js)
  if (DOC_SEARCH && typeof DOC_SEARCH.searchDocuments === 'function') {
    try {
      const approved = DOC_SEARCH.searchDocuments({ q: '', status: 'معتمد', page: 1, pageSize: 200 });
      const rows = approved?.items || approved?.results || [];
      for (const d of rows) {
        entries.push({
          id: `kb_doc_${d.id}`,
          kind: 'document',
          title: d.name || d.title || `مستند ${d.id}`,
          content: [d.name, d.doc_number, d.category, d.snippet].filter(Boolean).join(' — '),
          tokens: tokenize([d.name, d.doc_number, d.category, d.snippet].filter(Boolean).join(' ')),
          source: buildSource({ type: 'document', id: d.doc_number || d.id, label: `مستند: ${d.name || d.id}`, projectName: d.project_name, updatedAt: d.updated_at }),
        });
      }
    } catch (e) { /* تجاهل مصدر غير متاح */ }
  }

  const index = { built_at: nowISO(), entries_count: entries.length, entries };
  writeJSON(KB_INDEX_FILE, index);
  return index;
}

function loadKnowledgeIndex() {
  const idx = readJSON(KB_INDEX_FILE, null);
  if (idx) return idx;
  return rebuildKnowledgeIndex();
}

/** استرجاع RAG حقيقي: تسجيل تطابق بالكلمات المفتاحية (TF بسيط) وترتيب حسب الصلة */
function retrieveFromKnowledgeBase(query, { topK = 5 } = {}) {
  const idx = loadKnowledgeIndex();
  const qTokens = tokenize(query);
  if (!qTokens.length || !idx.entries.length) {
    return { query, results: [], reason: !idx.entries.length ? 'قاعدة المعرفة فارغة حالياً — لا توجد مستندات أو قوالب مفهرسة بعد' : null };
  }

  const scored = idx.entries.map(entry => {
    let score = 0;
    for (const qt of qTokens) {
      score += entry.tokens.filter(t => t === qt).length * 3;
      score += entry.tokens.filter(t => t.includes(qt) || qt.includes(t)).length;
    }
    return { entry, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    query,
    results: scored.map(({ entry, score }) => ({
      id: entry.id,
      kind: entry.kind,
      kind_label_ar: KB_SOURCE_KINDS[entry.kind]?.label_ar || entry.kind,
      title: entry.title,
      snippet: entry.content.slice(0, 240),
      relevance_score: score,
      source: entry.source,
    })),
  };
}

// ===================================================================================
// البند 20: نظام البحث الذكي الموحّد
// ===================================================================================

const SEARCHABLE_DOMAINS = ['projects', 'documents', 'drawings', 'contracts', 'reports', 'equipment', 'clients', 'tasks'];

function searchProjects(q) {
  if (!PM || typeof PM.listProjects !== 'function') return [];
  try {
    const res = PM.listProjects({ q, pageSize: 20 });
    const rows = res?.items || res?.data || [];
    return rows.map(p => ({
      domain: 'projects', id: p.id, title: p.name,
      snippet: [p.owner, p.contractor, p.status].filter(Boolean).join(' — '),
      source: buildSource({ type: 'project', id: p.id, label: `مشروع: ${p.name}`, updatedAt: p.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchDocumentsDomain(q) {
  if (!DOC_SEARCH || typeof DOC_SEARCH.searchDocuments !== 'function') return [];
  try {
    const res = DOC_SEARCH.searchDocuments({ q, page: 1, pageSize: 20 });
    const rows = res?.items || res?.results || [];
    return rows.map(d => ({
      domain: 'documents', id: d.id, title: d.name || d.title,
      snippet: d.snippet || d.category || '',
      source: buildSource({ type: 'document', id: d.doc_number || d.id, label: `مستند: ${d.name || d.id}`, projectName: d.project_name, updatedAt: d.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchDrawingsDomain(q) {
  if (!DRAWING_MGMT || typeof DRAWING_MGMT.listDrawings !== 'function') return [];
  try {
    const rows = DRAWING_MGMT.listDrawings({ q }) || [];
    const list = rows.items || rows;
    return (Array.isArray(list) ? list : []).slice(0, 20).map(d => ({
      domain: 'drawings', id: d.id, title: d.name || d.drawing_number,
      snippet: [d.drawing_number, d.discipline, d.revision].filter(Boolean).join(' — '),
      source: buildSource({ type: 'drawing', id: d.drawing_number || d.id, label: `مخطط: ${d.name || d.id}`, projectName: d.project_name, updatedAt: d.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchContractsDomain(q) {
  if (!BIZ_CONTRACTS || typeof BIZ_CONTRACTS.listContracts !== 'function') return [];
  try {
    const rows = BIZ_CONTRACTS.listContracts({ q }) || [];
    const list = rows.items || rows;
    return (Array.isArray(list) ? list : []).slice(0, 20).map(c => ({
      domain: 'contracts', id: c.id, title: c.title || c.contract_number,
      snippet: [c.contract_number, c.status, c.party_name].filter(Boolean).join(' — '),
      source: buildSource({ type: 'contract', id: c.contract_number || c.id, label: `عقد: ${c.title || c.id}`, updatedAt: c.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchReportsDomain(q) {
  if (!REPORTS_CENTER || typeof REPORTS_CENTER.listGeneratedReports !== 'function') return [];
  try {
    const rows = REPORTS_CENTER.listGeneratedReports({ q }) || [];
    const list = rows.items || rows;
    return (Array.isArray(list) ? list : []).slice(0, 20).map(r => ({
      domain: 'reports', id: r.id, title: r.title || r.report_type,
      snippet: [r.report_type, r.period].filter(Boolean).join(' — '),
      source: buildSource({ type: 'report', id: r.id, label: `تقرير: ${r.title || r.report_type}`, updatedAt: r.created_at }),
    }));
  } catch (e) { return []; }
}

function searchEquipmentDomain(q) {
  if (!EQUIPMENT_MGMT || typeof EQUIPMENT_MGMT.listEquipment !== 'function') return [];
  try {
    const rows = EQUIPMENT_MGMT.listEquipment({ q }) || [];
    const list = rows.items || rows;
    return (Array.isArray(list) ? list : []).slice(0, 20).map(e => ({
      domain: 'equipment', id: e.id, title: e.name || e.code,
      snippet: [e.type, e.status].filter(Boolean).join(' — '),
      source: buildSource({ type: 'equipment', id: e.code || e.id, label: `معدة: ${e.name || e.id}`, updatedAt: e.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchClientsDomain(q) {
  if (!BIZ_MGMT || typeof BIZ_MGMT.listClients !== 'function') return [];
  try {
    const rows = BIZ_MGMT.listClients({ q }) || [];
    const list = rows.items || rows;
    return (Array.isArray(list) ? list : []).slice(0, 20).map(c => ({
      domain: 'clients', id: c.id, title: c.name,
      snippet: [c.phone, c.status].filter(Boolean).join(' — '),
      source: buildSource({ type: 'client', id: c.id, label: `عميل: ${c.name}`, updatedAt: c.updated_at }),
    }));
  } catch (e) { return []; }
}

function searchTasksDomain(q, projectId) {
  if (!PM || typeof PM.listTasks !== 'function' || !projectId) return [];
  try {
    const rows = PM.listTasks(projectId) || [];
    const qn = normalizeText(q);
    return rows.filter(t => !qn || normalizeText(t.name).includes(qn)).slice(0, 20).map(t => ({
      domain: 'tasks', id: t.id, title: t.name,
      snippet: [t.status, t.assignee].filter(Boolean).join(' — '),
      source: buildSource({ type: 'task', id: t.id, label: `مهمة: ${t.name}`, updatedAt: t.updated_at }),
    }));
  } catch (e) { return []; }
}

/** البحث الموحّد الفعلي عبر كل النطاقات المسموح بها للمستخدم (RBAC) */
function unifiedSearch(token, { q, domains = null, projectId = null } = {}) {
  const ctx = CORE.resolveAIContext(token, 'search');
  if (!q || !q.trim()) throw new Error('نص البحث (q) مطلوب');

  const activeDomains = (domains && domains.length ? domains : SEARCHABLE_DOMAINS)
    .filter(d => SEARCHABLE_DOMAINS.includes(d));

  const results = {};
  if (activeDomains.includes('projects')) results.projects = searchProjects(q);
  if (activeDomains.includes('documents')) results.documents = searchDocumentsDomain(q);
  if (activeDomains.includes('drawings')) results.drawings = searchDrawingsDomain(q);
  if (activeDomains.includes('contracts')) results.contracts = searchContractsDomain(q);
  if (activeDomains.includes('reports')) results.reports = searchReportsDomain(q);
  if (activeDomains.includes('equipment')) results.equipment = searchEquipmentDomain(q);
  if (activeDomains.includes('clients')) results.clients = searchClientsDomain(q);
  if (activeDomains.includes('tasks')) results.tasks = searchTasksDomain(q, projectId);

  const totalResults = Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0);

  return { query: q, domains: activeDomains, total_results: totalResults, results, searched_by: ctx.username, searched_at: nowISO() };
}

// ===================================================================================
// البند 19: نظام الأسئلة المركّبة (Composite Query Engine)
// ===================================================================================

/**
 * يحوّل شروطاً منظّمة (وليس نص SQL حر) إلى استعلام آمن عبر الدوال الفعلية.
 * أمثلة الشروط المدعومة: budget_overrun_pct_gte, delay_days_gte, status_in.
 * كل شرط يُحلَّل من بيانات حقيقية يعيدها PM.listProjects / getFinancialSummary،
 * وليس تخميناً.
 */
function compositeProjectQuery(token, { conditions = {} } = {}) {
  const ctx = CORE.resolveAIContext(token, 'search');
  if (!PM || typeof PM.listProjects !== 'function') {
    return { available: false, reason: 'وحدة إدارة المشاريع غير متاحة' };
  }

  const allProjects = (PM.listProjects({ pageSize: 1000 })?.items) || [];
  const matched = [];
  const evaluatedConditions = [];

  for (const p of allProjects) {
    let ok = true;
    const facts = {};

    if (conditions.status_in && Array.isArray(conditions.status_in)) {
      const pass = conditions.status_in.includes(p.status);
      ok = ok && pass;
      facts.status = p.status;
    }

    if (typeof conditions.delay_days_gte === 'number') {
      let delayDays = null;
      try {
        const dash = PM.getProject(p.id, { includeRelations: true });
        delayDays = dash?.delay_days ?? dash?.schedule_variance_days ?? null;
      } catch (e) { /* تجاهل */ }
      facts.delay_days = delayDays;
      ok = ok && (delayDays !== null && delayDays >= conditions.delay_days_gte);
    }

    if (typeof conditions.budget_overrun_pct_gte === 'number') {
      let overrunPct = null;
      try {
        const fin = PM.getFinancialSummary(p.id);
        if (fin && fin.planned_budget) {
          overrunPct = ((fin.actual_cost - fin.planned_budget) / fin.planned_budget) * 100;
        }
      } catch (e) { /* تجاهل */ }
      facts.budget_overrun_pct = overrunPct !== null ? Number(overrunPct.toFixed(1)) : null;
      ok = ok && (overrunPct !== null && overrunPct >= conditions.budget_overrun_pct_gte);
    }

    if (ok && Object.keys(facts).length) {
      matched.push({
        project_id: p.id, project_name: p.name, facts,
        source: buildSource({ type: 'project', id: p.id, label: `مشروع: ${p.name}`, updatedAt: p.updated_at }),
      });
    }
  }

  evaluatedConditions.push(...Object.keys(conditions));

  return wrapWithTrust(
    { conditions, matched_projects: matched, matched_count: matched.length },
    { sources: matched.map(m => m.source), requiredFields: ['status'], providedFields: evaluatedConditions }
  );
}

/** سؤال معدّات مركّب: زيادة تكلفة الصيانة خلال فترة معينة (بيانات فعلية) */
function compositeEquipmentMaintenanceCostQuery(token, { months = 3 } = {}) {
  CORE.resolveAIContext(token, 'equipment');
  if (!EQUIPMENT_MGMT || typeof EQUIPMENT_MGMT.listMaintenanceRecords !== 'function' || typeof EQUIPMENT_MGMT.listEquipment !== 'function') {
    return { available: false, reason: 'وحدة إدارة المعدات غير متاحة بالكامل' };
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const equipmentList = (EQUIPMENT_MGMT.listEquipment({})?.items) || [];
  const results = [];

  for (const eq of equipmentList) {
    let records = [];
    try { records = EQUIPMENT_MGMT.listMaintenanceRecords({ equipmentId: eq.id }) || []; } catch (e) { continue; }
    const recent = records.filter(r => r.date && new Date(r.date) >= cutoff);
    const older = records.filter(r => r.date && new Date(r.date) < cutoff);
    const recentCost = recent.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const olderCost = older.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    if (recentCost > olderCost && recentCost > 0) {
      results.push({
        equipment_id: eq.id, equipment_name: eq.name,
        recent_period_cost: recentCost, previous_period_cost: olderCost,
        increase_pct: olderCost > 0 ? Number((((recentCost - olderCost) / olderCost) * 100).toFixed(1)) : null,
        source: buildSource({ type: 'equipment', id: eq.code || eq.id, label: `معدة: ${eq.name}`, updatedAt: eq.updated_at }),
      });
    }
  }

  results.sort((a, b) => b.recent_period_cost - a.recent_period_cost);

  return wrapWithTrust(
    { months, equipment_with_increased_maintenance_cost: results },
    { sources: results.map(r => r.source), requiredFields: ['recent_period_cost'], providedFields: results.length ? ['recent_period_cost'] : [] }
  );
}

// ===================================================================================
// البند 16: ذكاء الأعمال (Business Intelligence)
// ===================================================================================

function analyzeClientPerformance(token, { clientId } = {}) {
  const ctx = CORE.resolveAIContext(token, 'business');
  if (!BIZ_MGMT) return { available: false, reason: 'وحدة إدارة الأعمال غير متاحة' };
  if (!clientId) throw new Error('معرّف العميل (clientId) مطلوب');

  const client = BIZ_MGMT.getClient ? BIZ_MGMT.getClient(clientId) : null;
  if (!client) throw new Error('العميل غير موجود');

  let contracts = [];
  if (BIZ_CONTRACTS && typeof BIZ_CONTRACTS.listContracts === 'function') {
    try { contracts = (BIZ_CONTRACTS.listContracts({ clientId }) || {}).items || []; } catch (e) { contracts = []; }
  }

  const totalValue = contracts.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const completedCount = contracts.filter(c => c.status === 'مكتمل' || c.status === 'completed').length;
  const activityLog = BIZ_MGMT.getClientActivityLog ? (BIZ_MGMT.getClientActivityLog(clientId) || []) : [];

  const sources = [
    buildSource({ type: 'client', id: clientId, label: `عميل: ${client.name}`, updatedAt: client.updated_at }),
    ...contracts.map(c => buildSource({ type: 'contract', id: c.contract_number || c.id, label: `عقد: ${c.title || c.id}`, updatedAt: c.updated_at })),
  ];

  return wrapWithTrust({
    client_id: clientId,
    client_name: client.name,
    total_contracts: contracts.length,
    completed_contracts: completedCount,
    total_contract_value: totalValue,
    recent_activity_count: activityLog.length,
  }, { sources, requiredFields: ['name'], providedFields: ['name'] });
}

function compareSuppliers(token, { supplierIds = [] } = {}) {
  CORE.resolveAIContext(token, 'business');
  if (!BIZ_MGMT || typeof BIZ_MGMT.getSupplier !== 'function') {
    return { available: false, reason: 'وحدة الموردين غير متاحة' };
  }
  if (!Array.isArray(supplierIds) || supplierIds.length < 2) {
    throw new Error('يجب إرسال معرّفَي مورّد على الأقل للمقارنة (supplierIds)');
  }

  const rows = [];
  const sources = [];
  for (const sid of supplierIds) {
    const s = BIZ_MGMT.getSupplier(sid);
    if (!s) continue;
    rows.push({
      supplier_id: sid, name: s.name,
      products_count: (s.products || []).length,
      rating: s.rating ?? null,
      status: s.status,
    });
    sources.push(buildSource({ type: 'supplier', id: sid, label: `مورّد: ${s.name}`, updatedAt: s.updated_at }));
  }

  return wrapWithTrust({ compared_suppliers: rows }, { sources, requiredFields: ['name'], providedFields: rows.length ? ['name'] : [] });
}

// ===================================================================================
// البند 18: تحليل الصور (Image Analysis) - مساعِد وليس بديلاً عن الفحص الميداني
// ===================================================================================

/**
 * يحلّل صورة مرفوعة من الموقع. الوصف البصري العام (تصنيف/كشف عناصر) يتطلب نموذج
 * رؤية حاسوبية (Vision Model) فعلي غير مهيّأ حالياً في هذه البيئة، لذا تُعاد حالة
 * صريحة لهذا الجزء. أما استخراج النص (OCR) فيُنفَّذ فعلياً إن كانت الصورة ضمن ملف
 * PDF ممسوح ضوئياً عبر نفس محرك drawingAI/documentSearch الحقيقي المستخدَم سابقاً.
 */
function analyzeSiteImage(token, { imagePath, projectId = null, compareWithImagePath = null } = {}) {
  const ctx = CORE.resolveAIContext(token, 'document');
  if (!imagePath) throw new Error('مسار الصورة (imagePath) مطلوب');

  const visionAvailable = false; // لا يوجد مزود Vision Model مهيّأ فعلياً في البيئة الحالية
  const ocrAvailable = !!(DRAWING_AI && typeof DRAWING_AI.extractTextFromImage === 'function');

  const result = {
    image_path: imagePath,
    project_id: projectId,
    visual_description: {
      available: visionAvailable,
      reason: visionAvailable ? null : 'خدمة الرؤية الحاسوبية (وصف/تصنيف محتوى الصورة) غير مهيّأة فعلياً في هذه البيئة؛ يلزم ربط مزود Vision Model حقيقي لتفعيل هذه الميزة',
    },
    ocr_text: null,
    comparison: null,
    disclaimer: 'نتائج تحليل الصور مساعِدة فقط وليست بديلاً عن الفحص الهندسي أو فحص السلامة الميداني المباشر',
  };

  if (ocrAvailable) {
    try {
      result.ocr_text = DRAWING_AI.extractTextFromImage(imagePath);
    } catch (e) {
      result.ocr_text = null;
      result.ocr_error = 'تعذّر استخراج النص من الصورة';
    }
  } else {
    result.ocr_available = false;
  }

  if (compareWithImagePath) {
    result.comparison = { available: false, reason: 'مقارنة الصور البصرية تتطلب خدمة رؤية حاسوبية غير متاحة حالياً؛ يمكن مقارنة البيانات الوصفية (تاريخ الرفع، المشروع) فقط' };
  }

  return result;
}

// ===================================================================================
// البند 30: مولّد التقرير التنفيذي الموحّد عبر كل الأجزاء (1-9) - الربط الكامل
// ===================================================================================

/**
 * "أنشئ تقريراً شهرياً للمشروع" - يجمع فعلياً من كل الأجزاء السابقة (المشروع،
 * الجدول، الميزانية، BOQ، الجودة، السلامة، المستندات) عبر aiDataAccessLayer +
 * aiProjectIntelligence الحقيقيين، ثم يبني ملخصاً تنفيذياً موحّداً مع مصادر وثقة.
 */
async function generateUnifiedMonthlyReport(token, { projectId } = {}) {
  const ctx = CORE.resolveAIContext(token, 'reporting');
  if (!projectId) throw new Error('معرّف المشروع (projectId) مطلوب');

  const AI_PROJECT = tryRequire('./aiProjectIntelligence');
  if (!AI_PROJECT || typeof AI_PROJECT.analyzeProject !== 'function') {
    return { available: false, reason: 'وحدة تحليل المشاريع (الجزء 4/10) غير متاحة' };
  }

  return CORE.withAILogging(
    { userId: ctx.userId, username: ctx.username, domain: 'reporting', operationType: 'generate_unified_monthly_report', projectId, dataSources: ['aiProjectIntelligence', 'aiDataAccessLayer', 'boqAI', 'budgetAI'] },
    async () => {
      const projectAnalysis = await AI_PROJECT.analyzeProject({ projectId, userId: ctx.userId, username: ctx.username, token });

      const project = PM && typeof PM.getProject === 'function' ? PM.getProject(projectId) : null;
      const sources = [];
      if (project) sources.push(buildSource({ type: 'project', id: projectId, label: `مشروع: ${project.name}`, updatedAt: project.updated_at }));

      return wrapWithTrust({
        project_id: projectId,
        project_name: project?.name || null,
        report_period: 'شهري',
        generated_at: nowISO(),
        executive_summary: projectAnalysis?.executive_summary || null,
        current_issues: projectAnalysis?.current_issues || [],
        top_risks: projectAnalysis?.top_risks || [],
        top_delays: projectAnalysis?.top_delays || [],
        recommendations: projectAnalysis?.recommendations || [],
        suggested_actions: projectAnalysis?.suggested_actions || [],
      }, { sources, requiredFields: ['executive_summary'], providedFields: projectAnalysis?.executive_summary ? ['executive_summary'] : [] });
    }
  );
}

module.exports = {
  isAIAvailable,
  // مصادر وثقة (22/23) - مُصدَّرة للاستخدام من الأجزاء الأخرى أيضاً
  buildSource,
  assessConfidence,
  wrapWithTrust,
  // قاعدة المعرفة / RAG (21)
  rebuildKnowledgeIndex,
  retrieveFromKnowledgeBase,
  // البحث الموحّد (20)
  unifiedSearch,
  SEARCHABLE_DOMAINS,
  // الأسئلة المركّبة (19)
  compositeProjectQuery,
  compositeEquipmentMaintenanceCostQuery,
  // ذكاء الأعمال (16)
  analyzeClientPerformance,
  compareSuppliers,
  // تحليل الصور (18)
  analyzeSiteImage,
  // التقرير الموحّد الشامل (30)
  generateUnifiedMonthlyReport,
};
