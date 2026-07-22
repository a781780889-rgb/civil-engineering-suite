// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (DMS) — وحدة الذكاء الاصطناعي
// ============================================================

const DMS_AI_API = '/api/dms/ai';

function dmsAiFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_AI_API}${pathStr}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  });
}

function dmsAiPrettyJson(obj) {
  try {
    return `<pre style="white-space:pre-wrap;background:#f7f7f9;padding:10px;border-radius:6px;max-height:340px;overflow:auto">${JSON.stringify(obj, null, 2)}</pre>`;
  } catch (e) {
    return '<em>تعذر عرض النتيجة</em>';
  }
}

/** يُضاف داخل لوحة تفاصيل المستند (dmsViewDocument) لعرض أدوات الذكاء الاصطناعي الخاصة بهذا المستند */
async function dmsAiRenderDocumentPanel(docId) {
  const host = document.getElementById('dms-doc-ai-panel');
  if (!host) return;

  host.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <button class="btn btn-sm" data-dms-ai-action="classify">تصنيف تلقائي</button>
      <button class="btn btn-sm" data-dms-ai-action="extract">استخراج البيانات المهمة</button>
      <button class="btn btn-sm" data-dms-ai-action="summarize">تلخيص المستند</button>
      <button class="btn btn-sm" data-dms-ai-action="keywords">اقتراح كلمات مفتاحية</button>
      <button class="btn btn-sm" data-dms-ai-action="analyze-contract">تحليل عقد/تقرير فني</button>
      <button class="btn btn-sm" data-dms-ai-action="suggest-workflow">اقتراح مسار الاعتماد</button>
    </div>
    <div id="dms-doc-ai-result" style="margin-top:10px"></div>
  `;

  host.querySelectorAll('[data-dms-ai-action]').forEach((btn) => {
    btn.addEventListener('click', () => dmsAiRunDocumentAction(docId, btn.dataset.dmsAiAction));
  });
}

async function dmsAiRunDocumentAction(docId, action) {
  const resultEl = document.getElementById('dms-doc-ai-result');
  if (!resultEl) return;
  resultEl.innerHTML = '<div class="result-card">جارِ التحليل عبر الذكاء الاصطناعي...</div>';

  try {
    let res;
    switch (action) {
      case 'classify':
        res = await dmsAiFetch('/classify', { method: 'POST', body: { documentId: docId } });
        resultEl.innerHTML = dmsAiPrettyJson(res.classification || res.classification_raw);
        break;
      case 'extract':
        res = await dmsAiFetch('/extract-key-data', { method: 'POST', body: { documentId: docId } });
        resultEl.innerHTML = dmsAiPrettyJson(res.extracted || res.extracted_raw);
        break;
      case 'summarize':
        res = await dmsAiFetch('/summarize', { method: 'POST', body: { documentId: docId, style: 'brief' } });
        resultEl.innerHTML = dmsAiPrettyJson(res.summary || res.summary_raw);
        break;
      case 'keywords':
        res = await dmsAiFetch('/suggest-keywords', { method: 'POST', body: { documentId: docId } });
        resultEl.innerHTML = dmsAiPrettyJson(res.suggested_keywords || res.suggestion_raw);
        break;
      case 'analyze-contract':
        res = await dmsAiFetch('/analyze-contract', { method: 'POST', body: { documentId: docId } });
        resultEl.innerHTML = dmsAiPrettyJson(res.analysis || res.analysis_raw);
        break;
      case 'suggest-workflow':
        res = await dmsAiFetch('/suggest-workflow', { method: 'POST', body: { documentId: docId } });
        resultEl.innerHTML = dmsAiPrettyJson(res.workflow_suggestion || res.workflow_suggestion_raw);
        break;
      default:
        resultEl.innerHTML = '';
    }
    if (res && res.warning) {
      resultEl.innerHTML += `<div style="color:#b8860b;margin-top:6px">${res.warning}</div>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

/** لوحة عامة (غير مرتبطة بمستند واحد): بحث دلالي، اكتشاف مكررات، مستندات ناقصة، ملخص تنفيذي */
async function dmsAiRenderGlobalPanel(containerId, { projectId = null } = {}) {
  const host = document.getElementById(containerId);
  if (!host) return;

  host.innerHTML = `
    <div class="calc-card">
      <h4>البحث الدلالي</h4>
      <div class="toolbar" style="flex-wrap:wrap">
        <input type="text" id="dms-ai-semantic-q" placeholder="اكتب استعلامك بلغة طبيعية..." style="min-width:260px" />
        <button class="btn btn-primary btn-sm" id="dms-ai-btn-semantic">بحث</button>
      </div>
      <div id="dms-ai-semantic-result" style="margin-top:8px"></div>

      <h4 style="margin-top:18px">اكتشاف المستندات المكررة</h4>
      <button class="btn btn-sm" id="dms-ai-btn-duplicates">فحص التكرار</button>
      <div id="dms-ai-duplicates-result" style="margin-top:8px"></div>

      <h4 style="margin-top:18px">المستندات الناقصة</h4>
      <button class="btn btn-sm" id="dms-ai-btn-missing" ${projectId ? '' : 'disabled title="اختر مشروعاً أولاً"'}>فحص الاكتمال</button>
      <div id="dms-ai-missing-result" style="margin-top:8px"></div>

      <h4 style="margin-top:18px">الملخص التنفيذي</h4>
      <button class="btn btn-sm" id="dms-ai-btn-exec-summary">إنشاء ملخص تنفيذي</button>
      <div id="dms-ai-exec-summary-result" style="margin-top:8px"></div>
    </div>
  `;

  document.getElementById('dms-ai-btn-semantic').addEventListener('click', async () => {
    const q = document.getElementById('dms-ai-semantic-q').value.trim();
    const out = document.getElementById('dms-ai-semantic-result');
    if (!q) { out.innerHTML = '<div style="color:#c0392b">أدخل نص البحث أولاً</div>'; return; }
    out.innerHTML = '<div class="result-card">جارِ البحث...</div>';
    try {
      const res = await dmsAiFetch('/semantic-search', { method: 'POST', body: { query: q, projectId } });
      out.innerHTML = dmsAiPrettyJson(res.semantic || res.semantic_raw || res.results);
    } catch (e) { out.innerHTML = `<div style="color:#c0392b">${e.message}</div>`; }
  });

  document.getElementById('dms-ai-btn-duplicates').addEventListener('click', async () => {
    const out = document.getElementById('dms-ai-duplicates-result');
    out.innerHTML = '<div class="result-card">جارِ الفحص...</div>';
    try {
      const res = await dmsAiFetch('/detect-duplicates', { method: 'POST', body: { projectId } });
      out.innerHTML = dmsAiPrettyJson({
        deterministic: res.deterministic_duplicate_groups,
        ai_detected: res.ai_duplicate_groups || res.ai_duplicate_groups_raw,
      });
    } catch (e) { out.innerHTML = `<div style="color:#c0392b">${e.message}</div>`; }
  });

  document.getElementById('dms-ai-btn-missing').addEventListener('click', async () => {
    const out = document.getElementById('dms-ai-missing-result');
    if (!projectId) return;
    out.innerHTML = '<div class="result-card">جارِ الفحص...</div>';
    try {
      const res = await dmsAiFetch('/detect-missing', { method: 'POST', body: { projectId } });
      out.innerHTML = dmsAiPrettyJson(res.gap_analysis || res.gap_analysis_raw);
    } catch (e) { out.innerHTML = `<div style="color:#c0392b">${e.message}</div>`; }
  });

  document.getElementById('dms-ai-btn-exec-summary').addEventListener('click', async () => {
    const out = document.getElementById('dms-ai-exec-summary-result');
    out.innerHTML = '<div class="result-card">جارِ الإنشاء...</div>';
    try {
      const res = await dmsAiFetch('/executive-summary', { method: 'POST', body: { projectId } });
      out.innerHTML = dmsAiPrettyJson(res.executive_summary || res.executive_summary_raw);
    } catch (e) { out.innerHTML = `<div style="color:#c0392b">${e.message}</div>`; }
  });
}
