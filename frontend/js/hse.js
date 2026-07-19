// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// الجزء 1/4: البنية الأساسية + لوحة التحكم + خطط السلامة +
//            إدارة المخاطر (Risk Assessment) + إدارة الحوادث والإصابات
// ============================================================

const HSE_API = '/api/hse';
let HSE_REF = null;
let hsePlanEditingId = null;
let hseRiskEditingId = null;
let hseIncEditingId = null;

// ---------- أدوات عامة ----------
function hseFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_API}${path}`;
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

function hseAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseFmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function hseFmtDateTime(d) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

function hseLinesToArray(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function hseArrayToLines(arr) {
  return Array.isArray(arr) ? arr.join('\n') : '';
}

function hseEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function hseEnsureRefData() {
  if (HSE_REF) return HSE_REF;
  const res = await hseFetch('/reference-data');
  HSE_REF = res.data;
  return HSE_REF;
}

function debounceHse(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hseOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseRiskLevelTag(level) {
  const map = { low: 'tag-ok', medium: 'tag-info', high: 'tag-bad', critical: 'tag-bad' };
  return map[level] || 'tag-info';
}

function hseIncidentStatusTag(status) {
  const map = { reported: 'tag-info', under_investigation: 'tag-info', corrective_actions_pending: 'tag-bad', closed: 'tag-ok' };
  return map[status] || 'tag-info';
}

function hseSeverityTag(sev) {
  const map = { none: 'tag-ok', minor: 'tag-ok', moderate: 'tag-info', severe: 'tag-bad', fatal: 'tag-bad' };
  return map[sev] || 'tag-info';
}

// ================================================================
// لوحة معلومات السلامة
// ================================================================

document.querySelector('[data-panel="hse-dashboard"]')?.addEventListener('click', () => hseLoadDashboard());
document.getElementById('hse-btn-load-dashboard')?.addEventListener('click', () => hseLoadDashboard());

async function hseLoadDashboard() {
  const cardsEl = document.getElementById('hse-dash-cards');
  const riskChartEl = document.getElementById('hse-chart-risk-level');
  const incChartEl = document.getElementById('hse-chart-incident-type');
  const recentIncEl = document.getElementById('hse-recent-incidents');
  const topRisksEl = document.getElementById('hse-top-risks');
  const ref = await hseEnsureRefData();
  const projectId = document.getElementById('hse-dash-project')?.value.trim() || null;

  try {
    const res = await hseFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المشاريع المتابَعة</div><div class="value">${d.total_projects_tracked}</div></div>
      <div class="result-card"><div class="label">نسبة الالتزام بالسلامة</div><div class="value">${d.safety_compliance_rate}<span class="unit">%</span></div></div>
      <div class="result-card"><div class="label">إجمالي الحوادث</div><div class="value">${d.total_incidents}</div></div>
      <div class="result-card"><div class="label">إجمالي الإصابات</div><div class="value">${d.total_injuries}</div></div>
      <div class="result-card"><div class="label">حوادث مفتوحة</div><div class="value">${d.open_incidents}</div></div>
      <div class="result-card"><div class="label">حالات الوفاة</div><div class="value">${d.fatalities}</div></div>
      <div class="result-card"><div class="label">أيام العمل الضائعة</div><div class="value">${d.total_lost_work_days}</div></div>
      <div class="result-card"><div class="label">مخاطر مفتوحة</div><div class="value">${d.total_open_risks}</div></div>
      <div class="result-card"><div class="label">مخاطر حرجة</div><div class="value">${d.critical_risks}</div></div>
      <div class="result-card"><div class="label">مخاطر عالية</div><div class="value">${d.high_risks}</div></div>
      <div class="result-card"><div class="label">خطط سلامة معتمدة</div><div class="value">${d.approved_plans}<span class="unit">من ${d.total_safety_plans}</span></div></div>
    `;

    const maxRisk = Math.max(1, ...Object.values(d.by_risk_level));
    riskChartEl.innerHTML = Object.entries(d.by_risk_level).map(([level, count]) => `
      <div class="pm-bar-row">
        <div class="pm-bar-label">${({ low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج' })[level]}</div>
        <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxRisk) * 100}%"></div></div>
        <div class="pm-bar-value">${count}</div>
      </div>
    `).join('');

    const maxInc = Math.max(1, ...Object.values(d.by_incident_type));
    incChartEl.innerHTML = Object.entries(d.by_incident_type).map(([type, count]) => `
      <div class="pm-bar-row">
        <div class="pm-bar-label">${ref.incident_type_labels[type] || type}</div>
        <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxInc) * 100}%"></div></div>
        <div class="pm-bar-value">${count}</div>
      </div>
    `).join('');

    recentIncEl.innerHTML = d.recent_incidents.length
      ? d.recent_incidents.map(i => `
        <div class="pm-activity-item">
          <span class="ts">${hseFmtDateTime(i.occurred_at)}</span>
          <span>${i.code} — ${ref.incident_type_labels[i.type] || i.type} — ${hseEsc(i.location)}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد حوادث مسجّلة بعد</div>`;

    topRisksEl.innerHTML = d.top_risks.length
      ? d.top_risks.map(r => `
        <div class="pm-activity-item">
          <span class="ts"><span class="tag ${hseRiskLevelTag(r.risk_level)}">${r.risk_level_label}</span></span>
          <span>${r.code} — ${hseEsc(r.title)} (درجة ${r.risk_score})</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد مخاطر مفتوحة</div>`;
  } catch (e) {
    hseAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// خطط السلامة
// ================================================================

document.querySelector('[data-panel="hse-plans"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hsePlanShowListView();
  hseLoadPlanTable();
});

function hsePlanShowListView() {
  document.getElementById('hse-plan-list-view').style.display = '';
  document.getElementById('hse-plan-form-view').style.display = 'none';
  document.getElementById('hse-plan-detail-view').style.display = 'none';
}

async function hseLoadPlanTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-plan-tbody');

  const typeFilter = document.getElementById('hse-plan-filter-type');
  if (typeFilter.options.length <= 1) typeFilter.innerHTML += hseOptionsHTML(ref.safety_plan_types, ref.safety_plan_type_labels);
  const statusFilter = document.getElementById('hse-plan-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.safety_plan_statuses, ref.safety_plan_status_labels);

  try {
    const res = await hseFetch('/safety-plans', {
      query: {
        search: document.getElementById('hse-plan-search').value || null,
        type: typeFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد خطط سلامة مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td>${hseEsc(p.title)}</td>
        <td>${ref.safety_plan_type_labels[p.type] || p.type}</td>
        <td>${hseEsc(p.project_id)}</td>
        <td>v${p.version}</td>
        <td><span class="tag ${p.status === 'approved' ? 'tag-ok' : p.status === 'archived' ? 'tag-bad' : 'tag-info'}">${ref.safety_plan_status_labels[p.status] || p.status}</span></td>
        <td>
          <button class="pm-link-btn" data-hse-plan-view="${p.id}">عرض</button>
          <button class="pm-link-btn" data-hse-plan-edit="${p.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-plan-delete="${p.id}">أرشفة</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-plan-view]').forEach(b => b.addEventListener('click', () => hsePlanShowDetail(b.dataset.hsePlanView)));
    tbody.querySelectorAll('[data-hse-plan-edit]').forEach(b => b.addEventListener('click', () => hsePlanShowForm(b.dataset.hsePlanEdit)));
    tbody.querySelectorAll('[data-hse-plan-delete]').forEach(b => b.addEventListener('click', () => hsePlanDelete(b.dataset.hsePlanDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-plan-search')?.addEventListener('input', debounceHse(() => hseLoadPlanTable(), 300));
document.getElementById('hse-plan-filter-type')?.addEventListener('change', () => hseLoadPlanTable());
document.getElementById('hse-plan-filter-status')?.addEventListener('change', () => hseLoadPlanTable());
document.getElementById('hse-plan-btn-new')?.addEventListener('click', () => hsePlanShowForm(null));
document.getElementById('hse-plan-btn-back-to-list')?.addEventListener('click', () => { hsePlanShowListView(); hseLoadPlanTable(); });
document.getElementById('hse-plan-btn-back-from-detail')?.addEventListener('click', () => { hsePlanShowListView(); hseLoadPlanTable(); });

async function hsePlanShowForm(id) {
  const ref = await hseEnsureRefData();
  hsePlanEditingId = id;

  document.getElementById('hse-plan-list-view').style.display = 'none';
  document.getElementById('hse-plan-detail-view').style.display = 'none';
  document.getElementById('hse-plan-form-view').style.display = '';
  document.getElementById('hse-plan-form-alert').innerHTML = '';

  document.getElementById('hse-plan-f-type').innerHTML = hseOptionsHTML(ref.safety_plan_types, ref.safety_plan_type_labels);

  const ids = ['title', 'project', 'responsible', 'effective', 'review', 'description', 'objectives', 'policies', 'procedures', 'assembly', 'routes', 'map-url'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-plan-f-${k}`); if (el2) el2.value = ''; });

  if (id) {
    try {
      const res = await hseFetch('/safety-plans/get', { query: { id } });
      const p = res.data;
      document.getElementById('hse-plan-f-title').value = p.title || '';
      document.getElementById('hse-plan-f-type').value = p.type || '';
      document.getElementById('hse-plan-f-project').value = p.project_id || '';
      document.getElementById('hse-plan-f-responsible').value = p.responsible_person || '';
      document.getElementById('hse-plan-f-effective').value = p.effective_date ? hseFmtDate(p.effective_date) : '';
      document.getElementById('hse-plan-f-review').value = p.review_date ? hseFmtDate(p.review_date) : '';
      document.getElementById('hse-plan-f-description').value = p.description || '';
      document.getElementById('hse-plan-f-objectives').value = hseArrayToLines(p.objectives);
      document.getElementById('hse-plan-f-policies').value = hseArrayToLines(p.policies);
      document.getElementById('hse-plan-f-procedures').value = hseArrayToLines(p.procedures);
      document.getElementById('hse-plan-f-assembly').value = hseArrayToLines(p.assembly_points);
      document.getElementById('hse-plan-f-routes').value = hseArrayToLines(p.evacuation_routes);
      document.getElementById('hse-plan-f-map-url').value = p.safety_map_url || '';
    } catch (e) {
      hseAlert(document.getElementById('hse-plan-form-alert'), 'error', e.message);
    }
  }
}

document.getElementById('hse-plan-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-plan-form-alert');
  const payload = {
    title: document.getElementById('hse-plan-f-title').value.trim(),
    type: document.getElementById('hse-plan-f-type').value,
    project_id: document.getElementById('hse-plan-f-project').value.trim(),
    responsible_person: document.getElementById('hse-plan-f-responsible').value.trim() || null,
    effective_date: document.getElementById('hse-plan-f-effective').value || null,
    review_date: document.getElementById('hse-plan-f-review').value || null,
    description: document.getElementById('hse-plan-f-description').value.trim() || null,
    objectives: hseLinesToArray(document.getElementById('hse-plan-f-objectives').value),
    policies: hseLinesToArray(document.getElementById('hse-plan-f-policies').value),
    procedures: hseLinesToArray(document.getElementById('hse-plan-f-procedures').value),
    assembly_points: hseLinesToArray(document.getElementById('hse-plan-f-assembly').value),
    evacuation_routes: hseLinesToArray(document.getElementById('hse-plan-f-routes').value),
    safety_map_url: document.getElementById('hse-plan-f-map-url').value.trim() || null,
  };
  try {
    if (hsePlanEditingId) {
      await hseFetch('/safety-plans/update', { method: 'POST', body: { id: hsePlanEditingId, ...payload } });
    } else {
      await hseFetch('/safety-plans', { method: 'POST', body: payload });
    }
    hsePlanShowListView();
    hseLoadPlanTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hsePlanShowDetail(id) {
  const ref = await hseEnsureRefData();
  document.getElementById('hse-plan-list-view').style.display = 'none';
  document.getElementById('hse-plan-form-view').style.display = 'none';
  document.getElementById('hse-plan-detail-view').style.display = '';
  const content = document.getElementById('hse-plan-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';

  try {
    const res = await hseFetch('/safety-plans/get', { query: { id } });
    const p = res.data;
    content.innerHTML = `
      <div class="pm-card">
        <div class="pm-card-title">${hseEsc(p.title)} <span class="tag ${p.status === 'approved' ? 'tag-ok' : 'tag-info'}">${ref.safety_plan_type_labels[p.type]} — ${ref.safety_plan_status_labels[p.status]}</span></div>
        <p><b>الرمز:</b> ${p.code} &nbsp; <b>المشروع:</b> ${hseEsc(p.project_id)} &nbsp; <b>الإصدار الحالي:</b> v${p.version}</p>
        <p><b>المسؤول:</b> ${hseEsc(p.responsible_person) || '—'} &nbsp; <b>تاريخ السريان:</b> ${hseFmtDate(p.effective_date)} &nbsp; <b>تاريخ المراجعة:</b> ${hseFmtDate(p.review_date)}</p>
        ${p.description ? `<p><b>الوصف:</b> ${hseEsc(p.description)}</p>` : ''}
        ${p.status !== 'approved' ? `<button class="btn btn-primary" id="hse-plan-btn-approve">اعتماد الخطة</button>` : ''}
      </div>

      ${hseListSection('أهداف السلامة', p.objectives)}
      ${hseListSection('سياسات السلامة', p.policies)}
      ${hseListSection('إجراءات السلامة / تعليمات العمل الآمن', p.procedures)}
      ${hseListSection('نقاط التجمع', p.assembly_points)}
      ${hseListSection('مسارات الإخلاء', p.evacuation_routes)}

      <div class="pm-card">
        <div class="pm-card-title">سجل الإصدارات (Version History)</div>
        ${p.versions && p.versions.length ? `
          <table class="detail-table">
            <thead><tr><th>الإصدار</th><th>ملاحظة التغيير</th><th>التاريخ</th></tr></thead>
            <tbody>
              ${p.versions.map(v => `<tr><td>v${v.version}</td><td>${hseEsc(v.change_note)}</td><td>${hseFmtDateTime(v.created_at)}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : `<div class="pm-empty-state">لا يوجد سجل إصدارات</div>`}
      </div>
    `;

    document.getElementById('hse-plan-btn-approve')?.addEventListener('click', async () => {
      try {
        await hseFetch('/safety-plans/approve', { method: 'POST', body: { id: p.id } });
        hsePlanShowDetail(id);
      } catch (e) {
        alert(e.message);
      }
    });
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

function hseListSection(title, items) {
  if (!items || !items.length) return '';
  return `
    <div class="pm-card">
      <div class="pm-card-title">${title}</div>
      <ul>${items.map(i => `<li>${hseEsc(i)}</li>`).join('')}</ul>
    </div>
  `;
}

async function hsePlanDelete(id) {
  if (!confirm('هل تريد أرشفة خطة السلامة هذه؟')) return;
  try {
    await hseFetch('/safety-plans/delete', { method: 'POST', body: { id } });
    hseLoadPlanTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// إدارة المخاطر (Risk Assessment)
// ================================================================

document.querySelector('[data-panel="hse-risks"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hseRiskShowListView();
  hseLoadRiskTable();
});

function hseRiskShowListView() {
  document.getElementById('hse-risk-list-view').style.display = '';
  document.getElementById('hse-risk-form-view').style.display = 'none';
  document.getElementById('hse-risk-detail-view').style.display = 'none';
}

document.getElementById('hse-btn-load-matrix')?.addEventListener('click', () => hseLoadRiskMatrix());

async function hseLoadRiskMatrix() {
  const content = document.getElementById('hse-matrix-content');
  const projectId = document.getElementById('hse-matrix-project').value.trim() || null;
  try {
    const res = await hseFetch('/risks/matrix', { query: { projectId } });
    const d = res.data;
    const sevOrder = [5, 4, 3, 2, 1];
    const cellClass = (s, l) => {
      const score = s * l;
      if (score <= 4) return 'hse-cell-low';
      if (score <= 9) return 'hse-cell-medium';
      if (score <= 15) return 'hse-cell-high';
      return 'hse-cell-critical';
    };
    content.innerHTML = `
      <div class="pm-table-wrap">
        <table class="detail-table hse-matrix-table">
          <thead>
            <tr>
              <th>الشدة \\ الاحتمالية</th>
              ${[1, 2, 3, 4, 5].map(l => `<th>${l} - ${d.likelihood_levels[l]}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${sevOrder.map(s => `
              <tr>
                <th>${s} - ${d.severity_levels[s]}</th>
                ${[1, 2, 3, 4, 5].map(l => `<td class="${cellClass(s, l)}">${d.matrix[s][l]}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p style="margin-top:8px">
        <span class="tag tag-ok">منخفض: ${d.by_level.low}</span>
        <span class="tag tag-info">متوسط: ${d.by_level.medium}</span>
        <span class="tag tag-bad">عالٍ: ${d.by_level.high}</span>
        <span class="tag tag-bad">حرج: ${d.by_level.critical}</span>
        — إجمالي: ${d.total_risks}
      </p>
    `;
  } catch (e) {
    hseAlert(content, 'error', e.message);
  }
}

async function hseLoadRiskTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-risk-tbody');

  const catFilter = document.getElementById('hse-risk-filter-category');
  if (catFilter.options.length <= 1) catFilter.innerHTML += hseOptionsHTML(ref.risk_categories, ref.risk_category_labels);
  const levelFilter = document.getElementById('hse-risk-filter-level');
  if (levelFilter.options.length <= 1) {
    levelFilter.innerHTML += ['low', 'medium', 'high', 'critical'].map(l => `<option value="${l}">${({ low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج' })[l]}</option>`).join('');
  }
  const statusFilter = document.getElementById('hse-risk-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.risk_statuses, ref.risk_status_labels);

  try {
    const res = await hseFetch('/risks', {
      query: {
        search: document.getElementById('hse-risk-search').value || null,
        category: catFilter.value || null,
        level: levelFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="pm-empty-state">لا توجد مخاطر مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(r => `
      <tr>
        <td>${r.code}</td>
        <td>${hseEsc(r.title)}</td>
        <td>${ref.risk_category_labels[r.category] || r.category}</td>
        <td>${r.likelihood} - ${r.likelihood_label}</td>
        <td>${r.severity} - ${r.severity_label}</td>
        <td>${r.risk_score}</td>
        <td><span class="tag ${hseRiskLevelTag(r.risk_level)}">${r.risk_level_label}</span></td>
        <td>${ref.risk_status_labels[r.status] || r.status}</td>
        <td>
          <button class="pm-link-btn" data-hse-risk-view="${r.id}">عرض</button>
          <button class="pm-link-btn" data-hse-risk-edit="${r.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-risk-delete="${r.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-risk-view]').forEach(b => b.addEventListener('click', () => hseRiskShowDetail(b.dataset.hseRiskView)));
    tbody.querySelectorAll('[data-hse-risk-edit]').forEach(b => b.addEventListener('click', () => hseRiskShowForm(b.dataset.hseRiskEdit)));
    tbody.querySelectorAll('[data-hse-risk-delete]').forEach(b => b.addEventListener('click', () => hseRiskDelete(b.dataset.hseRiskDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-risk-search')?.addEventListener('input', debounceHse(() => hseLoadRiskTable(), 300));
document.getElementById('hse-risk-filter-category')?.addEventListener('change', () => hseLoadRiskTable());
document.getElementById('hse-risk-filter-level')?.addEventListener('change', () => hseLoadRiskTable());
document.getElementById('hse-risk-filter-status')?.addEventListener('change', () => hseLoadRiskTable());
document.getElementById('hse-risk-btn-new')?.addEventListener('click', () => hseRiskShowForm(null));
document.getElementById('hse-risk-btn-back-to-list')?.addEventListener('click', () => { hseRiskShowListView(); hseLoadRiskTable(); });
document.getElementById('hse-risk-btn-back-from-detail')?.addEventListener('click', () => { hseRiskShowListView(); hseLoadRiskTable(); });

async function hseRiskShowForm(id) {
  const ref = await hseEnsureRefData();
  hseRiskEditingId = id;

  document.getElementById('hse-risk-list-view').style.display = 'none';
  document.getElementById('hse-risk-detail-view').style.display = 'none';
  document.getElementById('hse-risk-form-view').style.display = '';
  document.getElementById('hse-risk-form-alert').innerHTML = '';

  document.getElementById('hse-risk-f-category').innerHTML = hseOptionsHTML(ref.risk_categories, ref.risk_category_labels);
  document.getElementById('hse-risk-f-hierarchy').innerHTML =
    '<option value="">— بدون تحديد —</option>' + hseOptionsHTML(ref.control_hierarchy, ref.control_hierarchy_labels);

  const ids = ['title', 'project', 'location', 'description', 'responsible', 'review', 'control-measures'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-risk-f-${k}`); if (el2) el2.value = ''; });
  document.getElementById('hse-risk-f-likelihood').value = '3';
  document.getElementById('hse-risk-f-severity').value = '3';

  if (id) {
    try {
      const res = await hseFetch('/risks/get', { query: { id } });
      const r = res.data;
      document.getElementById('hse-risk-f-title').value = r.title || '';
      document.getElementById('hse-risk-f-project').value = r.project_id || '';
      document.getElementById('hse-risk-f-category').value = r.category || '';
      document.getElementById('hse-risk-f-location').value = r.location || '';
      document.getElementById('hse-risk-f-description').value = r.description || '';
      document.getElementById('hse-risk-f-likelihood').value = String(r.likelihood);
      document.getElementById('hse-risk-f-severity').value = String(r.severity);
      document.getElementById('hse-risk-f-hierarchy').value = r.control_hierarchy || '';
      document.getElementById('hse-risk-f-responsible').value = r.responsible_person || '';
      document.getElementById('hse-risk-f-review').value = r.review_date ? hseFmtDate(r.review_date) : '';
      document.getElementById('hse-risk-f-control-measures').value = r.control_measures || '';
    } catch (e) {
      hseAlert(document.getElementById('hse-risk-form-alert'), 'error', e.message);
    }
  }
}

document.getElementById('hse-risk-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-risk-form-alert');
  const payload = {
    title: document.getElementById('hse-risk-f-title').value.trim(),
    project_id: document.getElementById('hse-risk-f-project').value.trim(),
    category: document.getElementById('hse-risk-f-category').value,
    location: document.getElementById('hse-risk-f-location').value.trim() || null,
    description: document.getElementById('hse-risk-f-description').value.trim() || null,
    likelihood: Number(document.getElementById('hse-risk-f-likelihood').value),
    severity: Number(document.getElementById('hse-risk-f-severity').value),
    control_hierarchy: document.getElementById('hse-risk-f-hierarchy').value || null,
    responsible_person: document.getElementById('hse-risk-f-responsible').value.trim() || null,
    review_date: document.getElementById('hse-risk-f-review').value || null,
    control_measures: document.getElementById('hse-risk-f-control-measures').value.trim() || null,
  };
  try {
    if (hseRiskEditingId) {
      await hseFetch('/risks/update', { method: 'POST', body: { id: hseRiskEditingId, ...payload } });
    } else {
      await hseFetch('/risks', { method: 'POST', body: payload });
    }
    hseRiskShowListView();
    hseLoadRiskTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hseRiskDelete(id) {
  if (!confirm('هل تريد حذف سجل الخطر هذا؟')) return;
  try {
    await hseFetch('/risks/delete', { method: 'POST', body: { id } });
    hseLoadRiskTable();
  } catch (e) {
    alert(e.message);
  }
}

let hseCurrentRiskDetailId = null;

async function hseRiskShowDetail(id) {
  const ref = await hseEnsureRefData();
  hseCurrentRiskDetailId = id;
  document.getElementById('hse-risk-list-view').style.display = 'none';
  document.getElementById('hse-risk-form-view').style.display = 'none';
  document.getElementById('hse-risk-detail-view').style.display = '';

  document.getElementById('hse-rca-f-hierarchy').innerHTML =
    '<option value="">— بدون تحديد —</option>' + hseOptionsHTML(ref.control_hierarchy, ref.control_hierarchy_labels);

  await hseRenderRiskDetail(id);
}

async function hseRenderRiskDetail(id) {
  const ref = await hseEnsureRefData();
  const content = document.getElementById('hse-risk-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const res = await hseFetch('/risks/get', { query: { id } });
    const r = res.data;
    content.innerHTML = `
      <div class="pm-card">
        <div class="pm-card-title">${hseEsc(r.title)} <span class="tag ${hseRiskLevelTag(r.risk_level)}">${r.risk_level_label} (${r.risk_score})</span></div>
        <p><b>الرمز:</b> ${r.code} &nbsp; <b>المشروع:</b> ${hseEsc(r.project_id)} &nbsp; <b>التصنيف:</b> ${ref.risk_category_labels[r.category] || r.category}</p>
        <p><b>الموقع:</b> ${hseEsc(r.location) || '—'} &nbsp; <b>الحالة:</b> ${ref.risk_status_labels[r.status]}</p>
        <p><b>الاحتمالية:</b> ${r.likelihood} - ${r.likelihood_label} &nbsp; <b>الشدة:</b> ${r.severity} - ${r.severity_label}</p>
        ${r.description ? `<p><b>الوصف:</b> ${hseEsc(r.description)}</p>` : ''}
        ${r.control_measures ? `<p><b>إجراءات التحكم الموصوفة:</b> ${hseEsc(r.control_measures)}</p>` : ''}
        <p><b>المسؤول:</b> ${hseEsc(r.responsible_person) || '—'} &nbsp; <b>تاريخ المراجعة:</b> ${hseFmtDate(r.review_date)}</p>
        ${r.residual_score ? `<p><b>الخطر المتبقي بعد التحكم:</b> <span class="tag ${hseRiskLevelTag(r.residual_level)}">${r.residual_score}</span></p>` : ''}
      </div>
    `;
    hseRenderControlActions(r.control_actions || []);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

function hseRenderControlActions(actions) {
  const tbody = document.getElementById('hse-rca-tbody');
  const ref = HSE_REF;
  if (!actions.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد إجراءات تحكم مسجّلة بعد</td></tr>`;
    return;
  }
  tbody.innerHTML = actions.map(a => `
    <tr>
      <td>${hseEsc(a.action_description)}</td>
      <td>${a.hierarchy_level ? (ref.control_hierarchy_labels[a.hierarchy_level] || a.hierarchy_level) : '—'}</td>
      <td>${hseEsc(a.responsible_person) || '—'}</td>
      <td>${hseFmtDate(a.due_date)}</td>
      <td><span class="tag ${a.status === 'completed' || a.status === 'verified' ? 'tag-ok' : a.status === 'overdue' ? 'tag-bad' : 'tag-info'}">${ref.control_action_status_labels[a.status] || a.status}</span></td>
      <td>
        ${a.status !== 'completed' && a.status !== 'verified' ? `<button class="pm-link-btn" data-hse-rca-complete="${a.id}">تعليم كمكتمل</button>` : ''}
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-hse-rca-complete]').forEach(b => b.addEventListener('click', async () => {
    try {
      await hseFetch('/risks/control-actions/update', { method: 'POST', body: { id: b.dataset.hseRcaComplete, status: 'completed' } });
      hseRenderRiskDetail(hseCurrentRiskDetailId);
    } catch (e) {
      alert(e.message);
    }
  }));
}

document.getElementById('hse-rca-btn-add')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-rca-form-alert');
  const payload = {
    risk_id: hseCurrentRiskDetailId,
    action_description: document.getElementById('hse-rca-f-description').value.trim(),
    hierarchy_level: document.getElementById('hse-rca-f-hierarchy').value || null,
    responsible_person: document.getElementById('hse-rca-f-responsible').value.trim() || null,
    due_date: document.getElementById('hse-rca-f-due').value || null,
  };
  try {
    await hseFetch('/risks/control-actions', { method: 'POST', body: payload });
    document.getElementById('hse-rca-f-description').value = '';
    document.getElementById('hse-rca-f-responsible').value = '';
    document.getElementById('hse-rca-f-due').value = '';
    alertEl.innerHTML = '';
    hseRenderRiskDetail(hseCurrentRiskDetailId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

// ================================================================
// إدارة الحوادث والإصابات
// ================================================================

document.querySelector('[data-panel="hse-incidents"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hseIncShowListView();
  hseLoadIncTable();
});

function hseIncShowListView() {
  document.getElementById('hse-inc-list-view').style.display = '';
  document.getElementById('hse-inc-form-view').style.display = 'none';
  document.getElementById('hse-inc-detail-view').style.display = 'none';
}

document.getElementById('hse-btn-load-kpis')?.addEventListener('click', () => hseLoadKPIs());

async function hseLoadKPIs() {
  const cardsEl = document.getElementById('hse-kpi-cards');
  const projectId = document.getElementById('hse-kpi-project').value.trim() || null;
  const manhours = document.getElementById('hse-kpi-manhours').value || null;
  try {
    const res = await hseFetch('/incidents/kpis', { query: { projectId, totalManHours: manhours } });
    const d = res.data;
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي الحوادث</div><div class="value">${d.total_incidents}</div></div>
      <div class="result-card"><div class="label">الحوادث القابلة للتسجيل</div><div class="value">${d.recordable_incidents}</div></div>
      <div class="result-card"><div class="label">إصابات فقدان وقت العمل</div><div class="value">${d.lost_time_incidents}</div></div>
      <div class="result-card"><div class="label">حالات وشيكة (Near Miss)</div><div class="value">${d.near_misses}</div></div>
      <div class="result-card"><div class="label">أيام العمل الضائعة</div><div class="value">${d.total_lost_work_days}</div></div>
      <div class="result-card"><div class="label">معدل تكرار الحوادث (IFR)</div><div class="value">${d.incident_frequency_rate ?? '—'}</div></div>
      <div class="result-card"><div class="label">معدل شدة الإصابات</div><div class="value">${d.injury_severity_rate ?? '—'}</div></div>
    `;
    if (d.note) cardsEl.innerHTML += `<div class="alert alert-info" style="grid-column:1/-1">${d.note}</div>`;
  } catch (e) {
    hseAlert(cardsEl, 'error', e.message);
  }
}

async function hseLoadIncTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-inc-tbody');

  const typeFilter = document.getElementById('hse-inc-filter-type');
  if (typeFilter.options.length <= 1) typeFilter.innerHTML += hseOptionsHTML(ref.incident_types, ref.incident_type_labels);
  const sevFilter = document.getElementById('hse-inc-filter-severity');
  if (sevFilter.options.length <= 1) sevFilter.innerHTML += hseOptionsHTML(ref.injury_severities, ref.injury_severity_labels);
  const statusFilter = document.getElementById('hse-inc-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.incident_statuses, ref.incident_status_labels);

  try {
    const res = await hseFetch('/incidents', {
      query: {
        search: document.getElementById('hse-inc-search').value || null,
        type: typeFilter.value || null,
        severity: sevFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">لا توجد حوادث مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(i => `
      <tr>
        <td>${i.code}</td>
        <td>${ref.incident_type_labels[i.type] || i.type}</td>
        <td>${hseFmtDateTime(i.occurred_at)}</td>
        <td>${hseEsc(i.location)}</td>
        <td>${hseEsc(i.injured_person_name) || '—'}</td>
        <td><span class="tag ${hseSeverityTag(i.injury_severity)}">${ref.injury_severity_labels[i.injury_severity] || i.injury_severity}</span></td>
        <td><span class="tag ${hseIncidentStatusTag(i.status)}">${ref.incident_status_labels[i.status] || i.status}</span></td>
        <td>
          <button class="pm-link-btn" data-hse-inc-view="${i.id}">عرض</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-inc-delete="${i.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-inc-view]').forEach(b => b.addEventListener('click', () => hseIncShowDetail(b.dataset.hseIncView)));
    tbody.querySelectorAll('[data-hse-inc-delete]').forEach(b => b.addEventListener('click', () => hseIncDelete(b.dataset.hseIncDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-inc-search')?.addEventListener('input', debounceHse(() => hseLoadIncTable(), 300));
document.getElementById('hse-inc-filter-type')?.addEventListener('change', () => hseLoadIncTable());
document.getElementById('hse-inc-filter-severity')?.addEventListener('change', () => hseLoadIncTable());
document.getElementById('hse-inc-filter-status')?.addEventListener('change', () => hseLoadIncTable());
document.getElementById('hse-inc-btn-new')?.addEventListener('click', () => hseIncShowForm());
document.getElementById('hse-inc-btn-back-to-list')?.addEventListener('click', () => { hseIncShowListView(); hseLoadIncTable(); });
document.getElementById('hse-inc-btn-back-from-detail')?.addEventListener('click', () => { hseIncShowListView(); hseLoadIncTable(); });

async function hseIncShowForm() {
  const ref = await hseEnsureRefData();
  document.getElementById('hse-inc-list-view').style.display = 'none';
  document.getElementById('hse-inc-detail-view').style.display = 'none';
  document.getElementById('hse-inc-form-view').style.display = '';
  document.getElementById('hse-inc-form-alert').innerHTML = '';

  document.getElementById('hse-inc-f-type').innerHTML = hseOptionsHTML(ref.incident_types, ref.incident_type_labels);
  document.getElementById('hse-inc-f-injury-type').innerHTML =
    '<option value="">— لا يوجد —</option>' + hseOptionsHTML(ref.injury_types, ref.injury_type_labels);
  document.getElementById('hse-inc-f-injury-severity').innerHTML = hseOptionsHTML(ref.injury_severities, ref.injury_severity_labels);

  const ids = ['project', 'occurred', 'location', 'description', 'injured-name', 'injured-role', 'witnesses', 'reported-by'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-inc-f-${k}`); if (el2) el2.value = ''; });
  document.getElementById('hse-inc-f-lost-days').value = '0';
}

document.getElementById('hse-inc-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-inc-form-alert');
  const occurredRaw = document.getElementById('hse-inc-f-occurred').value;
  const payload = {
    type: document.getElementById('hse-inc-f-type').value,
    project_id: document.getElementById('hse-inc-f-project').value.trim(),
    occurred_at: occurredRaw ? new Date(occurredRaw).toISOString() : null,
    location: document.getElementById('hse-inc-f-location').value.trim(),
    description: document.getElementById('hse-inc-f-description').value.trim(),
    injured_person_name: document.getElementById('hse-inc-f-injured-name').value.trim() || null,
    injured_person_role: document.getElementById('hse-inc-f-injured-role').value.trim() || null,
    injury_type: document.getElementById('hse-inc-f-injury-type').value || null,
    injury_severity: document.getElementById('hse-inc-f-injury-severity').value || 'none',
    lost_work_days: Number(document.getElementById('hse-inc-f-lost-days').value) || 0,
    witnesses: hseLinesToArray(document.getElementById('hse-inc-f-witnesses').value),
    reported_by: document.getElementById('hse-inc-f-reported-by').value.trim() || null,
  };
  try {
    await hseFetch('/incidents', { method: 'POST', body: payload });
    hseIncShowListView();
    hseLoadIncTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hseIncDelete(id) {
  if (!confirm('هل تريد حذف سجل الحادث هذا؟')) return;
  try {
    await hseFetch('/incidents/delete', { method: 'POST', body: { id } });
    hseLoadIncTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseIncShowDetail(id) {
  const ref = await hseEnsureRefData();
  hseIncEditingId = id;
  document.getElementById('hse-inc-list-view').style.display = 'none';
  document.getElementById('hse-inc-form-view').style.display = 'none';
  document.getElementById('hse-inc-detail-view').style.display = '';

  document.getElementById('hse-inc-f-status').innerHTML = hseOptionsHTML(ref.incident_statuses, ref.incident_status_labels);

  await hseRenderIncDetail(id);
}

async function hseRenderIncDetail(id) {
  const ref = await hseEnsureRefData();
  const content = document.getElementById('hse-inc-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const res = await hseFetch('/incidents/get', { query: { id } });
    const i = res.data;
    content.innerHTML = `
      <div class="pm-card">
        <div class="pm-card-title">${i.code} — ${ref.incident_type_labels[i.type]} <span class="tag ${hseIncidentStatusTag(i.status)}">${ref.incident_status_labels[i.status]}</span></div>
        <p><b>المشروع:</b> ${hseEsc(i.project_id)} &nbsp; <b>التاريخ:</b> ${hseFmtDateTime(i.occurred_at)} &nbsp; <b>الموقع:</b> ${hseEsc(i.location)}</p>
        <p><b>الوصف:</b> ${hseEsc(i.description)}</p>
        ${i.injured_person_name ? `<p><b>المصاب:</b> ${hseEsc(i.injured_person_name)} (${hseEsc(i.injured_person_role) || '—'}) — <b>نوع الإصابة:</b> ${ref.injury_type_labels[i.injury_type] || '—'} — <b>الدرجة:</b> <span class="tag ${hseSeverityTag(i.injury_severity)}">${ref.injury_severity_labels[i.injury_severity]}</span> — <b>أيام ضائعة:</b> ${i.lost_work_days}</p>` : ''}
        ${i.witnesses && i.witnesses.length ? `<p><b>الشهود:</b> ${i.witnesses.map(hseEsc).join('، ')}</p>` : ''}
        <p><b>المُبلِّغ:</b> ${hseEsc(i.reported_by) || '—'}</p>
        ${i.direct_cause ? `<p><b>السبب المباشر:</b> ${hseEsc(i.direct_cause)}</p>` : ''}
        ${i.root_cause ? `<p><b>السبب الجذري:</b> ${hseEsc(i.root_cause)}</p>` : ''}
        ${i.corrective_actions && i.corrective_actions.length ? `
          <p><b>الإجراءات التصحيحية:</b></p>
          <ul>${i.corrective_actions.map(a => `<li>${hseEsc(a.description)} — <span class="tag ${a.status === 'completed' ? 'tag-ok' : 'tag-info'}">${a.status === 'completed' ? 'مكتمل' : 'قيد التنفيذ'}</span></li>`).join('')}</ul>
        ` : ''}
      </div>
    `;

    document.getElementById('hse-inc-f-direct-cause').value = i.direct_cause || '';
    document.getElementById('hse-inc-f-root-cause').value = i.root_cause || '';
    document.getElementById('hse-inc-f-corrective').value = (i.corrective_actions || [])
      .map(a => `${a.description}${a.status === 'completed' ? ' !مكتمل' : ''}`).join('\n');
    document.getElementById('hse-inc-f-status').value = i.status;
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

document.getElementById('hse-inc-btn-update-investigation')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-inc-investigation-alert');
  const correctiveLines = hseLinesToArray(document.getElementById('hse-inc-f-corrective').value);
  const correctiveActions = correctiveLines.map(line => {
    const done = /!مكتمل\s*$/.test(line);
    const description = line.replace(/!مكتمل\s*$/, '').trim();
    return { description, status: done ? 'completed' : 'pending' };
  });
  const payload = {
    direct_cause: document.getElementById('hse-inc-f-direct-cause').value.trim() || null,
    root_cause: document.getElementById('hse-inc-f-root-cause').value.trim() || null,
    corrective_actions: correctiveActions,
    status: document.getElementById('hse-inc-f-status').value,
  };
  try {
    await hseFetch('/incidents/update', { method: 'POST', body: { id: hseIncEditingId, ...payload } });
    alertEl.innerHTML = '';
    hseRenderIncDetail(hseIncEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});
