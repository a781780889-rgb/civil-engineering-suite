// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// وحدة التقارير الموحّدة + المساعد الذكي (HSE Reports + AI Assistant)
// ============================================================

const HSE_REP_API = '/api/hse/reports';
const HSE_AI_API = '/api/hse/ai';
let hseRepCurrentReport = null;

function hseRepFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_REP_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async res => {
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  });
}

function hseAiFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_AI_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async res => {
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  });
}

function hseRepEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ================================================================
// التقارير الموحّدة
// ================================================================

document.getElementById('hse-rep-btn-generate')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('hse-rep-error');
  const resultEl = document.getElementById('hse-rep-result');
  errorEl.innerHTML = '';
  const projectId = document.getElementById('hse-rep-project')?.value.trim() || null;
  const type = document.getElementById('hse-rep-type')?.value;

  try {
    const res = await hseRepFetch(`/${type}`, { query: { projectId } });
    hseRepCurrentReport = res.report;
    hseRepRenderReport(hseRepCurrentReport);
    resultEl.style.display = '';
  } catch (e) {
    errorEl.innerHTML = `<div class="alert alert-danger">${hseRepEsc(e.message)}</div>`;
    resultEl.style.display = 'none';
  }
});

function hseRepRenderReport(report) {
  const summaryEl = document.getElementById('hse-rep-summary-cards');
  const theadEl = document.getElementById('hse-rep-thead');
  const tbodyEl = document.getElementById('hse-rep-tbody');
  document.getElementById('hse-rep-export-links').innerHTML = '';

  const summaryEntries = Object.entries(report).filter(([k, v]) => k !== 'rows' && typeof v !== 'object');
  summaryEl.innerHTML = summaryEntries.map(([k, v]) => `
    <div class="result-card"><div class="label">${hseRepEsc(k)}</div><div class="value">${hseRepEsc(v)}</div></div>
  `).join('');

  const rows = report.rows || [];
  if (!rows.length) {
    theadEl.innerHTML = '';
    tbodyEl.innerHTML = `<tr><td><div class="pm-empty-state">لا توجد بيانات تفصيلية لهذا التقرير ضمن النطاق المحدد</div></td></tr>`;
    return;
  }
  const keys = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set()));
  theadEl.innerHTML = `<tr>${keys.map(k => `<th>${hseRepEsc(k)}</th>`).join('')}</tr>`;
  tbodyEl.innerHTML = rows.map(r => `<tr>${keys.map(k => {
    const v = r[k];
    const display = v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return `<td>${hseRepEsc(display)}</td>`;
  }).join('')}</tr>`).join('');
}

async function hseRepExport(kind) {
  const errorEl = document.getElementById('hse-rep-error');
  if (!hseRepCurrentReport) {
    errorEl.innerHTML = `<div class="alert alert-danger">يجب إنشاء التقرير أولاً قبل التصدير</div>`;
    return;
  }
  const projectId = document.getElementById('hse-rep-project')?.value.trim() || null;
  try {
    const res = await hseRepFetch(`/export/${kind}`, { method: 'POST', body: { report: hseRepCurrentReport, projectName: projectId } });
    const linksEl = document.getElementById('hse-rep-export-links');
    linksEl.innerHTML = `<div class="alert alert-success">تم إنشاء الملف بنجاح — <a href="${hseRepEsc(res.url)}" target="_blank">فتح / تنزيل الملف</a></div>`;
  } catch (e) {
    errorEl.innerHTML = `<div class="alert alert-danger">${hseRepEsc(e.message)}</div>`;
  }
}

document.getElementById('hse-rep-btn-pdf')?.addEventListener('click', () => hseRepExport('pdf'));
document.getElementById('hse-rep-btn-excel')?.addEventListener('click', () => hseRepExport('excel'));
document.getElementById('hse-rep-btn-csv')?.addEventListener('click', () => hseRepExport('csv'));
document.getElementById('hse-rep-btn-word')?.addEventListener('click', () => hseRepExport('word'));
document.getElementById('hse-rep-btn-print')?.addEventListener('click', () => hseRepExport('print'));

// ================================================================
// المساعد الذكي للسلامة المهنية
// ================================================================

document.querySelector('[data-panel="hse-ai"]')?.addEventListener('click', hseAiCheckStatus);

async function hseAiCheckStatus() {
  const banner = document.getElementById('hse-ai-status-banner');
  try {
    const res = await hseAiFetch('/status');
    banner.innerHTML = res.available
      ? `<div class="alert alert-success">المساعد الذكي مفعّل وجاهز للاستخدام</div>`
      : `<div class="alert alert-warning">ميزة الذكاء الاصطناعي غير مفعّلة حالياً على الخادم (يتطلب ضبط متغير البيئة ANTHROPIC_API_KEY). باقي أقسام السلامة المهنية تعمل بشكل طبيعي وكامل دون تأثر.</div>`;
  } catch (e) {
    banner.innerHTML = '';
  }
}

function hseAiSetLoading(loading) {
  document.getElementById('hse-ai-loading').style.display = loading ? '' : 'none';
}

function hseAiRenderResult(title, data) {
  const resultEl = document.getElementById('hse-ai-result');
  const pretty = typeof data === 'string' ? `<p>${hseRepEsc(data)}</p>` : `<pre style="white-space:pre-wrap;direction:ltr;text-align:left">${hseRepEsc(JSON.stringify(data, null, 2))}</pre>`;
  resultEl.innerHTML = `<h3>${hseRepEsc(title)}</h3>${pretty}`;
}

async function hseAiRun(endpoint, title, extraBody = {}) {
  const errorEl = document.getElementById('hse-ai-error');
  errorEl.innerHTML = '';
  document.getElementById('hse-ai-result').innerHTML = '';
  const projectId = document.getElementById('hse-ai-project')?.value.trim() || null;
  hseAiSetLoading(true);
  try {
    const res = await hseAiFetch(endpoint, { method: 'POST', body: { projectId, ...extraBody } });
    const payload = res.analysis || res.prediction || res.root_cause_analysis || res.improvement_plan || res.evaluation
      || res.analysis_raw || res.prediction_raw || res.root_cause_analysis_raw || res.improvement_plan_raw || res.evaluation_raw || res;
    hseAiRenderResult(title, payload);
    if (res.warning) errorEl.innerHTML = `<div class="alert alert-warning">${hseRepEsc(res.warning)}</div>`;
  } catch (e) {
    errorEl.innerHTML = `<div class="alert alert-danger">${hseRepEsc(e.message)}</div>`;
  } finally {
    hseAiSetLoading(false);
  }
}

document.getElementById('hse-ai-btn-analyze')?.addEventListener('click', () => hseAiRun('/analyze-data', 'تحليل بيانات السلامة'));
document.getElementById('hse-ai-btn-predict')?.addEventListener('click', () => hseAiRun('/predict-risks', 'التنبؤ بالمخاطر المحتملة'));
document.getElementById('hse-ai-btn-causes')?.addEventListener('click', () => hseAiRun('/recurring-causes', 'تحليل أسباب الحوادث المتكررة'));
document.getElementById('hse-ai-btn-plan')?.addEventListener('click', () => hseAiRun('/improvement-plan', 'خطة تحسين السلامة'));
document.getElementById('hse-ai-btn-team')?.addEventListener('click', () => hseAiRun('/team-performance', 'تقييم أداء فريق السلامة'));

document.getElementById('hse-ai-btn-ask')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('hse-ai-error');
  const answerEl = document.getElementById('hse-ai-answer');
  const question = document.getElementById('hse-ai-question')?.value.trim();
  const projectId = document.getElementById('hse-ai-project')?.value.trim() || null;
  errorEl.innerHTML = '';
  answerEl.innerHTML = '';
  if (!question) {
    errorEl.innerHTML = `<div class="alert alert-danger">يرجى كتابة سؤال أولاً</div>`;
    return;
  }
  hseAiSetLoading(true);
  try {
    const res = await hseAiFetch('/ask', { method: 'POST', body: { question, projectId } });
    answerEl.innerHTML = `<p>${hseRepEsc(res.answer)}</p>`;
  } catch (e) {
    errorEl.innerHTML = `<div class="alert alert-danger">${hseRepEsc(e.message)}</div>`;
  } finally {
    hseAiSetLoading(false);
  }
});
