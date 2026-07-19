// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// الجزء 1/4: البنية الأساسية + لوحة التحكم + خطط السلامة +
//            إدارة المخاطر (Risk Assessment) + إدارة الحوادث والإصابات
// الجزء 2/4: إدارة التفتيشات + تصاريح العمل (Permit to Work) +
//            معدات الوقاية الشخصية (PPE)
// ============================================================

const HSE_API = '/api/hse';
let HSE_REF = null;
let hsePlanEditingId = null;
let hseRiskEditingId = null;
let hseIncEditingId = null;
let hseInspEditingId = null;
let hsePermitEditingId = null;
let hsePpeEditingId = null;

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

// ================================================================
// إدارة التفتيشات (Inspections)
// ================================================================

function hseInspStatusTag(status) {
  const map = { scheduled: 'tag-info', in_progress: 'tag-bad', completed: 'tag-info', approved: 'tag-ok' };
  return map[status] || 'tag-info';
}

function hseFindingSeverityTag(sev) {
  const map = { minor: 'tag-ok', moderate: 'tag-info', major: 'tag-bad', critical: 'tag-bad' };
  return map[sev] || 'tag-info';
}

function hseFindingStatusTag(status) {
  const map = { open: 'tag-bad', in_progress: 'tag-info', closed: 'tag-ok', overdue: 'tag-bad', reinspection_required: 'tag-bad' };
  return map[status] || 'tag-info';
}

document.querySelector('[data-panel="hse-inspections"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hseInspShowListView();
  hseLoadInspTable();
});

function hseInspShowListView() {
  document.getElementById('hse-insp-list-view').style.display = '';
  document.getElementById('hse-insp-form-view').style.display = 'none';
  document.getElementById('hse-insp-detail-view').style.display = 'none';
}

async function hseLoadInspTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-insp-tbody');

  const typeFilter = document.getElementById('hse-insp-filter-type');
  if (typeFilter.options.length <= 1) typeFilter.innerHTML += hseOptionsHTML(ref.inspection_types, ref.inspection_type_labels);
  const statusFilter = document.getElementById('hse-insp-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.inspection_statuses, ref.inspection_status_labels);

  try {
    const res = await hseFetch('/inspections', {
      query: {
        search: document.getElementById('hse-insp-search').value || null,
        type: typeFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="pm-empty-state">لا توجد جولات تفتيش مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(i => `
      <tr>
        <td>${i.code}</td>
        <td>${ref.inspection_type_labels[i.type] || i.type}</td>
        <td>${hseEsc(i.project_id)}</td>
        <td>${hseEsc(i.location) || '—'}</td>
        <td>${hseFmtDateTime(i.scheduled_date)}</td>
        <td>${hseEsc(i.inspector_name)}</td>
        <td>${i.findings_count}</td>
        <td><span class="tag ${hseInspStatusTag(i.status)}">${ref.inspection_status_labels[i.status] || i.status}</span></td>
        <td>
          <button class="pm-link-btn" data-hse-insp-view="${i.id}">عرض</button>
          <button class="pm-link-btn" data-hse-insp-edit="${i.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-insp-delete="${i.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-insp-view]').forEach(b => b.addEventListener('click', () => hseInspShowDetail(b.dataset.hseInspView)));
    tbody.querySelectorAll('[data-hse-insp-edit]').forEach(b => b.addEventListener('click', () => hseInspShowForm(b.dataset.hseInspEdit)));
    tbody.querySelectorAll('[data-hse-insp-delete]').forEach(b => b.addEventListener('click', () => hseInspDelete(b.dataset.hseInspDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-insp-search')?.addEventListener('input', debounceHse(() => hseLoadInspTable(), 300));
document.getElementById('hse-insp-filter-type')?.addEventListener('change', () => hseLoadInspTable());
document.getElementById('hse-insp-filter-status')?.addEventListener('change', () => hseLoadInspTable());
document.getElementById('hse-insp-btn-new')?.addEventListener('click', () => hseInspShowForm(null));
document.getElementById('hse-insp-btn-back-to-list')?.addEventListener('click', () => { hseInspShowListView(); hseLoadInspTable(); });
document.getElementById('hse-insp-btn-back-from-detail')?.addEventListener('click', () => { hseInspShowListView(); hseLoadInspTable(); });

function hseChecklistToLines(checklist) {
  return (checklist || []).map(c => {
    const resultLabel = { compliant: 'مطابق', non_compliant: 'غير مطابق', not_applicable: 'لا ينطبق' }[c.result] || c.result;
    return `${c.item} | ${resultLabel}${c.notes ? ' | ' + c.notes : ''}`;
  }).join('\n');
}

function hseLinesToChecklist(text) {
  const resultMap = { 'مطابق': 'compliant', 'غير مطابق': 'non_compliant', 'لا ينطبق': 'not_applicable' };
  return hseLinesToArray(text).map(line => {
    const parts = line.split('|').map(s => s.trim());
    const result = resultMap[parts[1]] || 'not_applicable';
    return { item: parts[0] || '', result, notes: parts[2] || null };
  }).filter(c => c.item);
}

async function hseInspShowForm(id) {
  const ref = await hseEnsureRefData();
  hseInspEditingId = id;

  document.getElementById('hse-insp-list-view').style.display = 'none';
  document.getElementById('hse-insp-detail-view').style.display = 'none';
  document.getElementById('hse-insp-form-view').style.display = '';
  document.getElementById('hse-insp-form-alert').innerHTML = '';

  document.getElementById('hse-insp-f-type').innerHTML = hseOptionsHTML(ref.inspection_types, ref.inspection_type_labels);
  document.getElementById('hse-insp-f-status').innerHTML = hseOptionsHTML(ref.inspection_statuses, ref.inspection_status_labels);

  const ids = ['project', 'location', 'scheduled', 'inspector', 'checklist', 'notes'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-insp-f-${k}`); if (el2) el2.value = ''; });
  document.getElementById('hse-insp-f-status').value = 'scheduled';

  if (id) {
    try {
      const res = await hseFetch('/inspections/get', { query: { id } });
      const i = res.data;
      document.getElementById('hse-insp-f-type').value = i.type || '';
      document.getElementById('hse-insp-f-project').value = i.project_id || '';
      document.getElementById('hse-insp-f-location').value = i.location || '';
      document.getElementById('hse-insp-f-scheduled').value = i.scheduled_date ? i.scheduled_date.slice(0, 16) : '';
      document.getElementById('hse-insp-f-inspector').value = i.inspector_name || '';
      document.getElementById('hse-insp-f-status').value = i.status || 'scheduled';
      document.getElementById('hse-insp-f-checklist').value = hseChecklistToLines(i.checklist);
      document.getElementById('hse-insp-f-notes').value = i.general_notes || '';
    } catch (e) {
      hseAlert(document.getElementById('hse-insp-form-alert'), 'error', e.message);
    }
  }
}

document.getElementById('hse-insp-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-insp-form-alert');
  const scheduledRaw = document.getElementById('hse-insp-f-scheduled').value;
  const payload = {
    type: document.getElementById('hse-insp-f-type').value,
    project_id: document.getElementById('hse-insp-f-project').value.trim(),
    location: document.getElementById('hse-insp-f-location').value.trim() || null,
    scheduled_date: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
    inspector_name: document.getElementById('hse-insp-f-inspector').value.trim(),
    status: document.getElementById('hse-insp-f-status').value,
    checklist: hseLinesToChecklist(document.getElementById('hse-insp-f-checklist').value),
    general_notes: document.getElementById('hse-insp-f-notes').value.trim() || null,
  };
  try {
    if (hseInspEditingId) {
      await hseFetch('/inspections/update', { method: 'POST', body: { id: hseInspEditingId, ...payload } });
    } else {
      await hseFetch('/inspections', { method: 'POST', body: payload });
    }
    hseInspShowListView();
    hseLoadInspTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hseInspDelete(id) {
  if (!confirm('هل تريد حذف جولة التفتيش هذه؟')) return;
  try {
    await hseFetch('/inspections/delete', { method: 'POST', body: { id } });
    hseLoadInspTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseInspShowDetail(id) {
  const ref = await hseEnsureRefData();
  hseInspEditingId = id;
  document.getElementById('hse-insp-list-view').style.display = 'none';
  document.getElementById('hse-insp-form-view').style.display = 'none';
  document.getElementById('hse-insp-detail-view').style.display = '';

  document.getElementById('hse-find-f-severity').innerHTML = hseOptionsHTML(ref.finding_severities, ref.finding_severity_labels);

  await hseRenderInspDetail(id);
}

async function hseRenderInspDetail(id) {
  const ref = await hseEnsureRefData();
  const content = document.getElementById('hse-insp-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const res = await hseFetch('/inspections/get', { query: { id } });
    const i = res.data;
    content.innerHTML = `
      <div class="pm-card">
        <div class="pm-card-title">${i.code} — ${ref.inspection_type_labels[i.type]} <span class="tag ${hseInspStatusTag(i.status)}">${ref.inspection_status_labels[i.status]}</span></div>
        <p><b>المشروع:</b> ${hseEsc(i.project_id)} &nbsp; <b>الموقع:</b> ${hseEsc(i.location) || '—'} &nbsp; <b>التاريخ:</b> ${hseFmtDateTime(i.scheduled_date)}</p>
        <p><b>المفتش:</b> ${hseEsc(i.inspector_name)}</p>
        ${i.general_notes ? `<p><b>ملاحظات عامة:</b> ${hseEsc(i.general_notes)}</p>` : ''}
      </div>
      <div class="pm-card">
        <div class="pm-card-title">قائمة التحقق (Checklist)</div>
        ${i.checklist && i.checklist.length ? `
          <table class="detail-table">
            <thead><tr><th>#</th><th>البند</th><th>النتيجة</th><th>ملاحظات</th></tr></thead>
            <tbody>
              ${i.checklist.map(c => `<tr><td>${c.seq}</td><td>${hseEsc(c.item)}</td><td><span class="tag ${c.result === 'compliant' ? 'tag-ok' : c.result === 'non_compliant' ? 'tag-bad' : 'tag-info'}">${ref.checklist_item_result_labels[c.result] || c.result}</span></td><td>${hseEsc(c.notes) || '—'}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : `<div class="pm-empty-state">لا توجد بنود تحقق مسجّلة</div>`}
      </div>
    `;

    await hseLoadFindingsTable(id);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function hseLoadFindingsTable(inspectionId) {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-find-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">جارٍ التحميل...</td></tr>`;
  try {
    const res = await hseFetch('/inspections/findings', { query: { inspectionId } });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد مخالفات مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(f => `
      <tr>
        <td>${f.code}</td>
        <td>${hseEsc(f.description)}</td>
        <td><span class="tag ${hseFindingSeverityTag(f.severity)}">${ref.finding_severity_labels[f.severity] || f.severity}</span></td>
        <td>${hseFmtDate(f.due_date)}</td>
        <td><span class="tag ${hseFindingStatusTag(f.status)}">${ref.finding_status_labels[f.status] || f.status}</span></td>
        <td>${f.status !== 'closed' ? `<button class="pm-link-btn" data-hse-find-close="${f.id}">إغلاق</button>` : '—'}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-find-close]').forEach(b => b.addEventListener('click', () => hseFindingClose(b.dataset.hseFindClose, inspectionId)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-find-btn-add')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-find-form-alert');
  const payload = {
    inspection_id: hseInspEditingId,
    description: document.getElementById('hse-find-f-description').value.trim(),
    severity: document.getElementById('hse-find-f-severity').value,
    responsible_person: document.getElementById('hse-find-f-responsible').value.trim() || null,
    due_date: document.getElementById('hse-find-f-due-date').value || null,
    corrective_action: document.getElementById('hse-find-f-corrective').value.trim() || null,
  };
  try {
    await hseFetch('/inspections/findings', { method: 'POST', body: payload });
    document.getElementById('hse-find-f-description').value = '';
    document.getElementById('hse-find-f-responsible').value = '';
    document.getElementById('hse-find-f-due-date').value = '';
    document.getElementById('hse-find-f-corrective').value = '';
    alertEl.innerHTML = '';
    hseLoadFindingsTable(hseInspEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hseFindingClose(id, inspectionId) {
  try {
    await hseFetch('/inspections/findings/update', { method: 'POST', body: { id, status: 'closed' } });
    hseLoadFindingsTable(inspectionId);
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById('hse-insp-btn-approve')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-insp-approve-alert');
  try {
    await hseFetch('/inspections/approve', { method: 'POST', body: { id: hseInspEditingId } });
    alertEl.innerHTML = '';
    hseRenderInspDetail(hseInspEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

// ================================================================
// إدارة تصاريح العمل (Permit to Work)
// ================================================================

function hsePermitStatusTag(status) {
  const map = {
    draft: 'tag-info', pending_approval: 'tag-info', approved: 'tag-ok', active: 'tag-ok',
    suspended: 'tag-bad', closed: 'tag-info', expired: 'tag-bad', rejected: 'tag-bad',
  };
  return map[status] || 'tag-info';
}

document.querySelector('[data-panel="hse-permits"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hsePermitShowListView();
  hseLoadPermitTable();
});

function hsePermitShowListView() {
  document.getElementById('hse-permit-list-view').style.display = '';
  document.getElementById('hse-permit-form-view').style.display = 'none';
  document.getElementById('hse-permit-detail-view').style.display = 'none';
}

async function hseLoadPermitTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-permit-tbody');

  const typeFilter = document.getElementById('hse-permit-filter-type');
  if (typeFilter.options.length <= 1) typeFilter.innerHTML += hseOptionsHTML(ref.permit_types, ref.permit_type_labels);
  const statusFilter = document.getElementById('hse-permit-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.permit_statuses, ref.permit_status_labels);

  try {
    const res = await hseFetch('/permits', {
      query: {
        search: document.getElementById('hse-permit-search').value || null,
        type: typeFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">لا توجد تصاريح عمل مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td>${ref.permit_type_labels[p.type] || p.type}</td>
        <td>${hseEsc(p.project_id)}</td>
        <td>${hseEsc(p.location)}</td>
        <td>${hseFmtDateTime(p.start_date)}</td>
        <td>${hseFmtDateTime(p.end_date)}</td>
        <td><span class="tag ${hsePermitStatusTag(p.status)}">${ref.permit_status_labels[p.status] || p.status}</span></td>
        <td>
          <button class="pm-link-btn" data-hse-permit-view="${p.id}">عرض</button>
          <button class="pm-link-btn" data-hse-permit-edit="${p.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-permit-delete="${p.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-permit-view]').forEach(b => b.addEventListener('click', () => hsePermitShowDetail(b.dataset.hsePermitView)));
    tbody.querySelectorAll('[data-hse-permit-edit]').forEach(b => b.addEventListener('click', () => hsePermitShowForm(b.dataset.hsePermitEdit)));
    tbody.querySelectorAll('[data-hse-permit-delete]').forEach(b => b.addEventListener('click', () => hsePermitDelete(b.dataset.hsePermitDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-permit-search')?.addEventListener('input', debounceHse(() => hseLoadPermitTable(), 300));
document.getElementById('hse-permit-filter-type')?.addEventListener('change', () => hseLoadPermitTable());
document.getElementById('hse-permit-filter-status')?.addEventListener('change', () => hseLoadPermitTable());
document.getElementById('hse-permit-btn-new')?.addEventListener('click', () => hsePermitShowForm(null));
document.getElementById('hse-permit-btn-back-to-list')?.addEventListener('click', () => { hsePermitShowListView(); hseLoadPermitTable(); });
document.getElementById('hse-permit-btn-back-from-detail')?.addEventListener('click', () => { hsePermitShowListView(); hseLoadPermitTable(); });

async function hsePermitShowForm(id) {
  const ref = await hseEnsureRefData();
  hsePermitEditingId = id;

  document.getElementById('hse-permit-list-view').style.display = 'none';
  document.getElementById('hse-permit-detail-view').style.display = 'none';
  document.getElementById('hse-permit-form-view').style.display = '';
  document.getElementById('hse-permit-form-alert').innerHTML = '';

  document.getElementById('hse-permit-f-type').innerHTML = hseOptionsHTML(ref.permit_types, ref.permit_type_labels);

  const ids = ['project', 'location', 'description', 'start', 'end', 'responsible', 'team', 'risk-summary', 'precautions'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-permit-f-${k}`); if (el2) el2.value = ''; });

  if (id) {
    try {
      const res = await hseFetch('/permits/get', { query: { id } });
      const p = res.data;
      document.getElementById('hse-permit-f-type').value = p.type || '';
      document.getElementById('hse-permit-f-project').value = p.project_id || '';
      document.getElementById('hse-permit-f-location').value = p.location || '';
      document.getElementById('hse-permit-f-description').value = p.work_description || '';
      document.getElementById('hse-permit-f-start').value = p.start_date ? p.start_date.slice(0, 16) : '';
      document.getElementById('hse-permit-f-end').value = p.end_date ? p.end_date.slice(0, 16) : '';
      document.getElementById('hse-permit-f-responsible').value = p.responsible_person || '';
      document.getElementById('hse-permit-f-team').value = hseArrayToLines(p.work_team);
      document.getElementById('hse-permit-f-risk-summary').value = p.risk_assessment_summary || '';
      document.getElementById('hse-permit-f-precautions').value = hseArrayToLines(p.precautions);
    } catch (e) {
      hseAlert(document.getElementById('hse-permit-form-alert'), 'error', e.message);
    }
  }
}

document.getElementById('hse-permit-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-permit-form-alert');
  const startRaw = document.getElementById('hse-permit-f-start').value;
  const endRaw = document.getElementById('hse-permit-f-end').value;
  const payload = {
    type: document.getElementById('hse-permit-f-type').value,
    project_id: document.getElementById('hse-permit-f-project').value.trim(),
    location: document.getElementById('hse-permit-f-location').value.trim(),
    work_description: document.getElementById('hse-permit-f-description').value.trim(),
    start_date: startRaw ? new Date(startRaw).toISOString() : null,
    end_date: endRaw ? new Date(endRaw).toISOString() : null,
    responsible_person: document.getElementById('hse-permit-f-responsible').value.trim(),
    work_team: hseLinesToArray(document.getElementById('hse-permit-f-team').value),
    risk_assessment_summary: document.getElementById('hse-permit-f-risk-summary').value.trim() || null,
    precautions: hseLinesToArray(document.getElementById('hse-permit-f-precautions').value),
  };
  try {
    if (hsePermitEditingId) {
      await hseFetch('/permits/update', { method: 'POST', body: { id: hsePermitEditingId, ...payload } });
    } else {
      await hseFetch('/permits', { method: 'POST', body: payload });
    }
    hsePermitShowListView();
    hseLoadPermitTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hsePermitDelete(id) {
  if (!confirm('هل تريد حذف تصريح العمل هذا؟')) return;
  try {
    await hseFetch('/permits/delete', { method: 'POST', body: { id } });
    hseLoadPermitTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hsePermitShowDetail(id) {
  hsePermitEditingId = id;
  document.getElementById('hse-permit-list-view').style.display = 'none';
  document.getElementById('hse-permit-form-view').style.display = 'none';
  document.getElementById('hse-permit-detail-view').style.display = '';
  await hseRenderPermitDetail(id);
}

async function hseRenderPermitDetail(id) {
  const ref = await hseEnsureRefData();
  const content = document.getElementById('hse-permit-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const res = await hseFetch('/permits/get', { query: { id } });
    const p = res.data;
    content.innerHTML = `
      <div class="pm-card">
        <div class="pm-card-title">${p.code} — ${ref.permit_type_labels[p.type]} <span class="tag ${hsePermitStatusTag(p.status)}">${ref.permit_status_labels[p.status]}</span></div>
        <p><b>المشروع:</b> ${hseEsc(p.project_id)} &nbsp; <b>الموقع:</b> ${hseEsc(p.location)}</p>
        <p><b>من:</b> ${hseFmtDateTime(p.start_date)} &nbsp; <b>إلى:</b> ${hseFmtDateTime(p.end_date)}</p>
        <p><b>وصف العمل:</b> ${hseEsc(p.work_description)}</p>
        <p><b>المسؤول:</b> ${hseEsc(p.responsible_person)}</p>
        ${p.work_team && p.work_team.length ? `<p><b>فريق التنفيذ:</b> ${p.work_team.map(hseEsc).join('، ')}</p>` : ''}
        ${p.risk_assessment_summary ? `<p><b>ملخص تقييم المخاطر:</b> ${hseEsc(p.risk_assessment_summary)}</p>` : ''}
      </div>
      ${hseListSection('إجراءات الاحتياط المطلوبة', p.precautions)}
      <div class="pm-card">
        <div class="pm-card-title">سجل الموافقات</div>
        ${p.approvals && p.approvals.length ? `
          <table class="detail-table">
            <thead><tr><th>المعتمِد</th><th>الصفة</th><th>ملاحظات</th><th>التاريخ</th></tr></thead>
            <tbody>${p.approvals.map(a => `<tr><td>${hseEsc(a.approver_name)}</td><td>${hseEsc(a.approver_role) || '—'}</td><td>${hseEsc(a.notes) || '—'}</td><td>${hseFmtDateTime(a.approved_at)}</td></tr>`).join('')}</tbody>
          </table>
        ` : `<div class="pm-empty-state">لا توجد موافقات مسجّلة بعد</div>`}
      </div>
    `;

    const activateBtn = document.getElementById('hse-permit-btn-activate');
    const closeBtn = document.getElementById('hse-permit-btn-close');
    const approveBtn = document.getElementById('hse-permit-btn-approve');
    if (approveBtn) approveBtn.disabled = !['draft', 'pending_approval'].includes(p.status);
    if (activateBtn) activateBtn.disabled = p.status !== 'approved';
    if (closeBtn) closeBtn.disabled = !['active', 'approved', 'suspended'].includes(p.status);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

document.getElementById('hse-permit-btn-approve')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-permit-action-alert');
  const payload = {
    id: hsePermitEditingId,
    approver_name: document.getElementById('hse-permit-f-approver-name').value.trim(),
    approver_role: document.getElementById('hse-permit-f-approver-role').value.trim() || null,
    notes: document.getElementById('hse-permit-f-approver-notes').value.trim() || null,
  };
  try {
    await hseFetch('/permits/approve', { method: 'POST', body: payload });
    alertEl.innerHTML = '';
    hseRenderPermitDetail(hsePermitEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

document.getElementById('hse-permit-btn-activate')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-permit-action-alert');
  try {
    await hseFetch('/permits/activate', { method: 'POST', body: { id: hsePermitEditingId } });
    alertEl.innerHTML = '';
    hseRenderPermitDetail(hsePermitEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

document.getElementById('hse-permit-btn-close')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-permit-action-alert');
  try {
    await hseFetch('/permits/close', { method: 'POST', body: { id: hsePermitEditingId } });
    alertEl.innerHTML = '';
    hseRenderPermitDetail(hsePermitEditingId);
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

// ================================================================
// إدارة معدات الوقاية الشخصية (PPE)
// ================================================================

function hsePpeStatusTag(status) {
  const map = { issued: 'tag-ok', due_for_replacement: 'tag-bad', replaced: 'tag-info', returned: 'tag-info' };
  return map[status] || 'tag-info';
}

document.querySelector('[data-panel="hse-ppe"]')?.addEventListener('click', async () => {
  await hseEnsureRefData();
  hsePpeShowListView();
  hseLoadPpeTable();
});

function hsePpeShowListView() {
  document.getElementById('hse-ppe-list-view').style.display = '';
  document.getElementById('hse-ppe-form-view').style.display = 'none';
}

document.getElementById('hse-ppe-btn-load-compliance')?.addEventListener('click', () => hseLoadPpeCompliance());

async function hseLoadPpeCompliance() {
  const cardsEl = document.getElementById('hse-ppe-compliance-cards');
  const projectId = document.getElementById('hse-ppe-compliance-project').value.trim() || null;
  try {
    const res = await hseFetch('/ppe/compliance-summary', { query: { projectId } });
    const d = res.data;
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي معدات الوقاية المسجّلة</div><div class="value">${d.total_ppe_items}</div></div>
      <div class="result-card"><div class="label">مستحقة الاستبدال</div><div class="value">${d.due_for_replacement}</div></div>
      <div class="result-card"><div class="label">نسبة الالتزام</div><div class="value">${d.compliance_rate}<span class="unit">%</span></div></div>
    `;
  } catch (e) {
    hseAlert(cardsEl, 'error', e.message);
  }
}

async function hseLoadPpeTable() {
  const ref = await hseEnsureRefData();
  const tbody = document.getElementById('hse-ppe-tbody');

  const typeFilter = document.getElementById('hse-ppe-filter-type');
  if (typeFilter.options.length <= 1) typeFilter.innerHTML += hseOptionsHTML(ref.ppe_types, ref.ppe_type_labels);
  const statusFilter = document.getElementById('hse-ppe-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += hseOptionsHTML(ref.ppe_item_statuses, ref.ppe_item_status_labels);

  try {
    const res = await hseFetch('/ppe', {
      query: {
        search: document.getElementById('hse-ppe-search').value || null,
        type: typeFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">لا توجد سجلات معدات وقاية</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td>${ref.ppe_type_labels[p.type] || p.type}</td>
        <td>${hseEsc(p.employee_name)}</td>
        <td>${p.quantity}</td>
        <td><span class="tag ${p.condition === 'damaged' || p.condition === 'expired' ? 'tag-bad' : 'tag-ok'}">${ref.ppe_condition_labels[p.condition] || p.condition}</span></td>
        <td>${hseFmtDate(p.replacement_due_date)}</td>
        <td><span class="tag ${hsePpeStatusTag(p.status)}">${ref.ppe_item_status_labels[p.status] || p.status}</span></td>
        <td>
          <button class="pm-link-btn" data-hse-ppe-edit="${p.id}">تعديل</button>
          ${p.status !== 'replaced' ? `<button class="pm-link-btn" data-hse-ppe-replace="${p.id}">استبدال</button>` : ''}
          <button class="pm-link-btn pm-mini-btn-danger" data-hse-ppe-delete="${p.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-hse-ppe-edit]').forEach(b => b.addEventListener('click', () => hsePpeShowForm(b.dataset.hsePpeEdit)));
    tbody.querySelectorAll('[data-hse-ppe-replace]').forEach(b => b.addEventListener('click', () => hsePpeReplace(b.dataset.hsePpeReplace)));
    tbody.querySelectorAll('[data-hse-ppe-delete]').forEach(b => b.addEventListener('click', () => hsePpeDelete(b.dataset.hsePpeDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-ppe-search')?.addEventListener('input', debounceHse(() => hseLoadPpeTable(), 300));
document.getElementById('hse-ppe-filter-type')?.addEventListener('change', () => hseLoadPpeTable());
document.getElementById('hse-ppe-filter-status')?.addEventListener('change', () => hseLoadPpeTable());
document.getElementById('hse-ppe-btn-new')?.addEventListener('click', () => hsePpeShowForm(null));
document.getElementById('hse-ppe-btn-back-to-list')?.addEventListener('click', () => { hsePpeShowListView(); hseLoadPpeTable(); });

async function hsePpeShowForm(id) {
  const ref = await hseEnsureRefData();
  hsePpeEditingId = id;

  document.getElementById('hse-ppe-list-view').style.display = 'none';
  document.getElementById('hse-ppe-form-view').style.display = '';
  document.getElementById('hse-ppe-form-alert').innerHTML = '';

  document.getElementById('hse-ppe-f-type').innerHTML = hseOptionsHTML(ref.ppe_types, ref.ppe_type_labels);
  document.getElementById('hse-ppe-f-condition').innerHTML = hseOptionsHTML(ref.ppe_conditions, ref.ppe_condition_labels);

  const ids = ['project', 'employee', 'role', 'lifespan', 'notes'];
  ids.forEach(k => { const el2 = document.getElementById(`hse-ppe-f-${k}`); if (el2) el2.value = ''; });
  document.getElementById('hse-ppe-f-quantity').value = '1';
  document.getElementById('hse-ppe-f-condition').value = 'new';
  document.getElementById('hse-ppe-f-issue-date').value = new Date().toISOString().slice(0, 10);

  if (id) {
    try {
      const res = await hseFetch('/ppe/get', { query: { id } });
      const p = res.data;
      document.getElementById('hse-ppe-f-type').value = p.type || '';
      document.getElementById('hse-ppe-f-project').value = p.project_id || '';
      document.getElementById('hse-ppe-f-employee').value = p.employee_name || '';
      document.getElementById('hse-ppe-f-role').value = p.employee_role || '';
      document.getElementById('hse-ppe-f-quantity').value = p.quantity || 1;
      document.getElementById('hse-ppe-f-condition').value = p.condition || 'new';
      document.getElementById('hse-ppe-f-issue-date').value = p.issue_date ? hseFmtDate(p.issue_date) : '';
      document.getElementById('hse-ppe-f-lifespan').value = p.lifespan_days || '';
      document.getElementById('hse-ppe-f-notes').value = p.notes || '';
    } catch (e) {
      hseAlert(document.getElementById('hse-ppe-form-alert'), 'error', e.message);
    }
  }
}

document.getElementById('hse-ppe-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-ppe-form-alert');
  const payload = {
    type: document.getElementById('hse-ppe-f-type').value,
    project_id: document.getElementById('hse-ppe-f-project').value.trim() || null,
    employee_name: document.getElementById('hse-ppe-f-employee').value.trim(),
    employee_role: document.getElementById('hse-ppe-f-role').value.trim() || null,
    quantity: Number(document.getElementById('hse-ppe-f-quantity').value) || 1,
    condition: document.getElementById('hse-ppe-f-condition').value,
    issue_date: document.getElementById('hse-ppe-f-issue-date').value,
    lifespan_days: document.getElementById('hse-ppe-f-lifespan').value ? Number(document.getElementById('hse-ppe-f-lifespan').value) : null,
    notes: document.getElementById('hse-ppe-f-notes').value.trim() || null,
  };
  try {
    if (hsePpeEditingId) {
      await hseFetch('/ppe/update', { method: 'POST', body: { id: hsePpeEditingId, ...payload } });
    } else {
      await hseFetch('/ppe', { method: 'POST', body: payload });
    }
    hsePpeShowListView();
    hseLoadPpeTable();
  } catch (e) {
    hseAlert(alertEl, 'error', e.message);
  }
});

async function hsePpeReplace(id) {
  if (!confirm('هل تريد استبدال هذه المعدة بسجل تسليم جديد؟')) return;
  try {
    await hseFetch('/ppe/replace', { method: 'POST', body: { id } });
    hseLoadPpeTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hsePpeDelete(id) {
  if (!confirm('هل تريد حذف سجل معدة الوقاية هذا؟')) return;
  try {
    await hseFetch('/ppe/delete', { method: 'POST', body: { id } });
    hseLoadPpeTable();
  } catch (e) {
    alert(e.message);
  }
}
