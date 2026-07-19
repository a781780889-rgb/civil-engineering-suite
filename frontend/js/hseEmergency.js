// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// الجزء 3/4: إدارة الطوارئ (خطط، فرق، نقاط تجمع، معدات إطفاء،
//            تمارين إخلاء، سجلات طوارئ فعلية)
// ============================================================

const HSE_EMG_API = '/api/hse/emergency';
let HSE_EMG_REF = null;
let hseEmgPlanEditingId = null;
let hseEmgDrillEditingId = null;
let hseEmgDrillCompletingId = null;
let hseEmgActEditingId = null;

// ---------- أدوات عامة (بنفس نمط hse.js) ----------
function hseEmgFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_EMG_API}${path}`;
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

function hseEmgAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseEmgFmtDateTime(d) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

function hseEmgLinesToArray(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function hseEmgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function hseEmgEnsureRefData() {
  if (HSE_EMG_REF) return HSE_EMG_REF;
  const res = await hseEmgFetch('/reference-data');
  HSE_EMG_REF = res.data;
  return HSE_EMG_REF;
}

function debounceHseEmg(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hseEmgOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseEmgResultTag(result) {
  const map = { passed: 'tag-ok', needs_improvement: 'tag-info', failed: 'tag-bad', not_evaluated: 'tag-info' };
  return map[result] || 'tag-info';
}

function hseEmgActStatusTag(status) {
  const map = { reported: 'tag-info', in_progress: 'tag-bad', contained: 'tag-info', closed: 'tag-ok' };
  return map[status] || 'tag-info';
}

// pipe-line parsers لتحويل النصوص متعددة الأسطر إلى كائنات (نفس فلسفة hseLinesToArray)
function hseEmgParsePipeLines(text, keys) {
  return hseEmgLinesToArray(text).map(line => {
    const parts = line.split('|').map(p => p.trim());
    const obj = {};
    keys.forEach((k, i) => { obj[k] = parts[i] || null; });
    return obj;
  });
}

// ================================================================
// لوحة معلومات إدارة الطوارئ
// ================================================================

document.querySelector('[data-panel="hse-emg-dashboard"]')?.addEventListener('click', () => hseEmgLoadDashboard());
document.getElementById('hse-emg-btn-load-dashboard')?.addEventListener('click', () => hseEmgLoadDashboard());

async function hseEmgLoadDashboard() {
  const cardsEl = document.getElementById('hse-emg-dash-cards');
  const fireChartEl = document.getElementById('hse-emg-chart-fire-equipment');
  const upcomingEl = document.getElementById('hse-emg-upcoming-drills');
  const recentActEl = document.getElementById('hse-emg-recent-activations');
  const ref = await hseEmgEnsureRefData();
  const projectId = document.getElementById('hse-emg-dash-project')?.value.trim() || null;

  try {
    const res = await hseEmgFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">خطط طوارئ معتمدة</div><div class="value">${d.approved_emergency_plans}<span class="unit">من ${d.total_emergency_plans}</span></div></div>
      <div class="result-card"><div class="label">إجمالي التمارين</div><div class="value">${d.total_drills}</div></div>
      <div class="result-card"><div class="label">تمارين منفَّذة</div><div class="value">${d.completed_drills}</div></div>
      <div class="result-card"><div class="label">نسبة نجاح التمارين</div><div class="value">${d.drill_pass_rate_percent ?? '—'}<span class="unit">%</span></div></div>
      <div class="result-card"><div class="label">متوسط زمن الإخلاء</div><div class="value">${d.average_evacuation_time_seconds ?? '—'}<span class="unit">ثانية</span></div></div>
      <div class="result-card"><div class="label">سجلات طوارئ فعلية</div><div class="value">${d.total_activations}</div></div>
      <div class="result-card"><div class="label">حالات طوارئ مفتوحة</div><div class="value">${d.open_activations}</div></div>
      <div class="result-card"><div class="label">إجمالي معدات الإطفاء</div><div class="value">${d.fire_equipment_total}</div></div>
    `;

    const maxFire = Math.max(1, ...Object.values(d.fire_equipment_by_status));
    fireChartEl.innerHTML = Object.entries(d.fire_equipment_by_status).map(([status, count]) => `
      <div class="pm-bar-row">
        <div class="pm-bar-label">${ref.fire_equipment_status_labels[status] || status}</div>
        <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxFire) * 100}%"></div></div>
        <div class="pm-bar-value">${count}</div>
      </div>
    `).join('');

    upcomingEl.innerHTML = d.upcoming_drills.length
      ? d.upcoming_drills.map(dr => `
        <div class="pm-activity-item">
          <span class="ts">${dr.scheduled_date}</span>
          <span>${dr.code} — ${ref.drill_type_labels[dr.drill_type] || dr.drill_type}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد تمارين مجدولة</div>`;

    recentActEl.innerHTML = d.recent_activations.length
      ? d.recent_activations.map(a => `
        <div class="pm-activity-item">
          <span class="ts"><span class="tag ${hseEmgActStatusTag(a.status)}">${ref.activation_status_labels[a.status] || a.status}</span></span>
          <span>${a.code} — ${ref.scenario_type_labels[a.scenario_type] || a.scenario_type} — ${hseEmgEsc(a.location)}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد سجلات طوارئ فعلية</div>`;
  } catch (e) {
    hseEmgAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// خطط الطوارئ
// ================================================================

document.querySelector('[data-panel="hse-emg-plans"]')?.addEventListener('click', async () => {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-plan-filter-status').innerHTML =
    hseEmgOptionsHTML(ref.plan_statuses, ref.plan_status_labels, { placeholder: 'كل الحالات' });
  document.getElementById('hse-emg-plan-filter-scenario').innerHTML =
    hseEmgOptionsHTML(ref.scenario_types, ref.scenario_type_labels, { placeholder: 'كل السيناريوهات' });
  hseEmgPlanShowListView();
  hseEmgLoadPlanTable();
});

function hseEmgPlanShowListView() {
  document.getElementById('hse-emg-plan-list-view').style.display = '';
  document.getElementById('hse-emg-plan-form-view').style.display = 'none';
  document.getElementById('hse-emg-plan-detail-view').style.display = 'none';
}

async function hseEmgLoadPlanTable() {
  const tbody = document.getElementById('hse-emg-plan-tbody');
  const ref = await hseEmgEnsureRefData();
  try {
    const res = await hseEmgFetch('/plans', {
      query: {
        search: document.getElementById('hse-emg-plan-search').value || null,
        status: document.getElementById('hse-emg-plan-filter-status').value || null,
        scenarioType: document.getElementById('hse-emg-plan-filter-scenario').value || null,
      },
    });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td>${hseEmgEsc(p.title)}</td>
        <td>${(p.scenario_types || []).map(s => ref.scenario_type_labels[s] || s).join('، ')}</td>
        <td>${(p.teams || []).length}</td>
        <td>${(p.assembly_points || []).length}</td>
        <td><span class="tag ${p.status === 'approved' ? 'tag-ok' : 'tag-info'}">${ref.plan_status_labels[p.status] || p.status}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" data-hse-emg-plan-view="${p.id}">عرض</button>
          <button class="btn btn-sm btn-outline" data-hse-emg-plan-edit="${p.id}">تعديل</button>
          <button class="btn btn-sm btn-danger" data-hse-emg-plan-delete="${p.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد خطط طوارئ</div></td></tr>`;

    tbody.querySelectorAll('[data-hse-emg-plan-view]').forEach(b => b.addEventListener('click', () => hseEmgPlanShowDetail(b.dataset.hseEmgPlanView)));
    tbody.querySelectorAll('[data-hse-emg-plan-edit]').forEach(b => b.addEventListener('click', () => hseEmgPlanShowForm(b.dataset.hseEmgPlanEdit)));
    tbody.querySelectorAll('[data-hse-emg-plan-delete]').forEach(b => b.addEventListener('click', () => hseEmgPlanDelete(b.dataset.hseEmgPlanDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-emg-plan-search')?.addEventListener('input', debounceHseEmg(() => hseEmgLoadPlanTable(), 300));
document.getElementById('hse-emg-plan-filter-status')?.addEventListener('change', () => hseEmgLoadPlanTable());
document.getElementById('hse-emg-plan-filter-scenario')?.addEventListener('change', () => hseEmgLoadPlanTable());
document.getElementById('hse-emg-plan-btn-new')?.addEventListener('click', () => hseEmgPlanShowForm(null));
document.getElementById('hse-emg-plan-btn-back-to-list')?.addEventListener('click', () => { hseEmgPlanShowListView(); hseEmgLoadPlanTable(); });
document.getElementById('hse-emg-plan-btn-back-from-detail')?.addEventListener('click', () => { hseEmgPlanShowListView(); hseEmgLoadPlanTable(); });

async function hseEmgPlanShowForm(id) {
  hseEmgPlanEditingId = id;
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-plan-list-view').style.display = 'none';
  document.getElementById('hse-emg-plan-detail-view').style.display = 'none';
  document.getElementById('hse-emg-plan-form-view').style.display = '';
  document.getElementById('hse-emg-plan-form-alert').innerHTML = '';

  document.getElementById('hse-emg-plan-f-scenarios').innerHTML =
    ref.scenario_types.map(v => `<option value="${v}">${ref.scenario_type_labels[v] || v}</option>`).join('');

  const fields = ['title', 'project', 'description', 'teams', 'assembly', 'exits', 'fire-eq', 'contacts', 'procedures'];
  fields.forEach(f => { const el = document.getElementById(`hse-emg-plan-f-${f}`); if (el) el.value = ''; });
  [...document.getElementById('hse-emg-plan-f-scenarios').options].forEach(o => o.selected = false);

  if (id) {
    const res = await hseEmgFetch('/plans/get', { query: { id } });
    const p = res.data;
    document.getElementById('hse-emg-plan-f-title').value = p.title || '';
    document.getElementById('hse-emg-plan-f-project').value = p.project_id || '';
    document.getElementById('hse-emg-plan-f-description').value = p.description || '';
    [...document.getElementById('hse-emg-plan-f-scenarios').options].forEach(o => {
      o.selected = (p.scenario_types || []).includes(o.value);
    });
    document.getElementById('hse-emg-plan-f-teams').value =
      (p.teams || []).map(t => [t.role, t.member_name, t.contact_number, t.responsibilities].filter(x => x !== null).join(' | ')).join('\n');
    document.getElementById('hse-emg-plan-f-assembly').value =
      (p.assembly_points || []).map(a => [a.name, a.location_description, a.capacity].filter(x => x !== null).join(' | ')).join('\n');
    document.getElementById('hse-emg-plan-f-exits').value =
      (p.emergency_exits || []).map(e => [e.name, e.location_description].filter(x => x !== null).join(' | ')).join('\n');
    document.getElementById('hse-emg-plan-f-fire-eq').value =
      (p.fire_equipment || []).map(f => [f.type, f.location, f.status].filter(x => x !== null).join(' | ')).join('\n');
    document.getElementById('hse-emg-plan-f-contacts').value =
      (p.external_contacts || []).map(c => [c.name, c.phone].filter(x => x !== null).join(' | ')).join('\n');
    document.getElementById('hse-emg-plan-f-procedures').value = p.response_procedures || '';
  }
}

document.getElementById('hse-emg-plan-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-emg-plan-form-alert');
  try {
    const selectedScenarios = [...document.getElementById('hse-emg-plan-f-scenarios').selectedOptions].map(o => o.value);
    const body = {
      title: document.getElementById('hse-emg-plan-f-title').value.trim(),
      project_id: document.getElementById('hse-emg-plan-f-project').value.trim(),
      scenario_types: selectedScenarios,
      description: document.getElementById('hse-emg-plan-f-description').value.trim() || null,
      teams: hseEmgParsePipeLines(document.getElementById('hse-emg-plan-f-teams').value, ['role', 'member_name', 'contact_number', 'responsibilities']),
      assembly_points: hseEmgParsePipeLines(document.getElementById('hse-emg-plan-f-assembly').value, ['name', 'location_description', 'capacity']),
      emergency_exits: hseEmgParsePipeLines(document.getElementById('hse-emg-plan-f-exits').value, ['name', 'location_description']),
      fire_equipment: hseEmgParsePipeLines(document.getElementById('hse-emg-plan-f-fire-eq').value, ['type', 'location', 'status']),
      external_contacts: hseEmgParsePipeLines(document.getElementById('hse-emg-plan-f-contacts').value, ['name', 'phone']),
      response_procedures: document.getElementById('hse-emg-plan-f-procedures').value.trim() || null,
    };
    if (hseEmgPlanEditingId) {
      await hseEmgFetch('/plans/update', { method: 'POST', body: { id: hseEmgPlanEditingId, updates: body } });
    } else {
      await hseEmgFetch('/plans', { method: 'POST', body });
    }
    hseEmgPlanShowListView();
    hseEmgLoadPlanTable();
  } catch (e) {
    hseEmgAlert(alertEl, 'error', e.message);
  }
});

async function hseEmgPlanShowDetail(id) {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-plan-list-view').style.display = 'none';
  document.getElementById('hse-emg-plan-form-view').style.display = 'none';
  document.getElementById('hse-emg-plan-detail-view').style.display = '';
  const content = document.getElementById('hse-emg-plan-detail-content');
  try {
    const res = await hseEmgFetch('/plans/get', { query: { id } });
    const p = res.data;
    content.innerHTML = `
      <h3>${hseEmgEsc(p.title)} <span class="tag ${p.status === 'approved' ? 'tag-ok' : 'tag-info'}">${ref.plan_status_labels[p.status]}</span></h3>
      <p><strong>الرمز:</strong> ${p.code} &nbsp; <strong>المشروع:</strong> ${hseEmgEsc(p.project_id)} &nbsp; <strong>الإصدار:</strong> ${p.version}</p>
      <p><strong>السيناريوهات:</strong> ${(p.scenario_types || []).map(s => ref.scenario_type_labels[s] || s).join('، ')}</p>
      ${p.description ? `<p><strong>الوصف:</strong> ${hseEmgEsc(p.description)}</p>` : ''}

      <h4>فريق الطوارئ</h4>
      ${(p.teams || []).length ? `<ul>${p.teams.map(t => `<li>${ref.team_role_labels[t.role] || t.role} — ${hseEmgEsc(t.member_name || '—')} — ${hseEmgEsc(t.contact_number || '—')}</li>`).join('')}</ul>` : '<p class="pm-empty-state">لا يوجد أعضاء فريق</p>'}

      <h4>نقاط التجمع</h4>
      ${(p.assembly_points || []).length ? `<ul>${p.assembly_points.map(a => `<li>${hseEmgEsc(a.name)} — ${hseEmgEsc(a.location_description || '—')} ${a.capacity ? `(السعة: ${a.capacity})` : ''}</li>`).join('')}</ul>` : '<p class="pm-empty-state">لا توجد نقاط تجمع</p>'}

      <h4>مخارج الطوارئ</h4>
      ${(p.emergency_exits || []).length ? `<ul>${p.emergency_exits.map(e => `<li>${hseEmgEsc(e.name)} — ${hseEmgEsc(e.location_description || '—')}</li>`).join('')}</ul>` : '<p class="pm-empty-state">لا توجد مخارج مسجّلة</p>'}

      <h4>معدات الإطفاء</h4>
      ${(p.fire_equipment || []).length ? `<ul>${p.fire_equipment.map(f => `<li>${ref.fire_equipment_type_labels[f.type] || f.type} — ${hseEmgEsc(f.location || '—')} — <span class="tag ${f.status === 'operational' ? 'tag-ok' : 'tag-bad'}">${ref.fire_equipment_status_labels[f.status]}</span></li>`).join('')}</ul>` : '<p class="pm-empty-state">لا توجد معدات إطفاء مسجّلة</p>'}

      <h4>جهات الاتصال الخارجية</h4>
      ${(p.external_contacts || []).length ? `<ul>${p.external_contacts.map(c => `<li>${hseEmgEsc(c.name)} — ${hseEmgEsc(c.phone || '—')}</li>`).join('')}</ul>` : '<p class="pm-empty-state">لا توجد جهات اتصال</p>'}

      ${p.response_procedures ? `<h4>إجراءات الاستجابة</h4><p>${hseEmgEsc(p.response_procedures)}</p>` : ''}

      ${p.status !== 'approved' ? `<button class="btn btn-primary" id="hse-emg-plan-btn-approve">اعتماد الخطة</button>` : ''}
      <div id="hse-emg-plan-approve-alert"></div>
    `;
    document.getElementById('hse-emg-plan-btn-approve')?.addEventListener('click', async () => {
      const approveAlert = document.getElementById('hse-emg-plan-approve-alert');
      try {
        await hseEmgFetch('/plans/approve', { method: 'POST', body: { id: p.id } });
        hseEmgPlanShowDetail(id);
      } catch (e) {
        hseEmgAlert(approveAlert, 'error', e.message);
      }
    });
  } catch (e) {
    hseEmgAlert(content, 'error', e.message);
  }
}

async function hseEmgPlanDelete(id) {
  if (!confirm('هل تريد حذف خطة الطوارئ هذه؟')) return;
  try {
    await hseEmgFetch('/plans/delete', { method: 'POST', body: { id } });
    hseEmgLoadPlanTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// تمارين وتدريبات الإخلاء (Drills)
// ================================================================

document.querySelector('[data-panel="hse-emg-drills"]')?.addEventListener('click', async () => {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-drill-filter-type').innerHTML =
    hseEmgOptionsHTML(ref.drill_types, ref.drill_type_labels, { placeholder: 'كل الأنواع' });
  document.getElementById('hse-emg-drill-filter-status').innerHTML =
    hseEmgOptionsHTML(ref.drill_statuses, ref.drill_status_labels, { placeholder: 'كل الحالات' });
  hseEmgDrillShowListView();
  hseEmgLoadDrillTable();
});

function hseEmgDrillShowListView() {
  document.getElementById('hse-emg-drill-list-view').style.display = '';
  document.getElementById('hse-emg-drill-form-view').style.display = 'none';
  document.getElementById('hse-emg-drill-complete-view').style.display = 'none';
}

async function hseEmgLoadDrillTable() {
  const tbody = document.getElementById('hse-emg-drill-tbody');
  const ref = await hseEmgEnsureRefData();
  try {
    const res = await hseEmgFetch('/drills', {
      query: {
        projectId: document.getElementById('hse-emg-drill-project').value || null,
        drillType: document.getElementById('hse-emg-drill-filter-type').value || null,
        status: document.getElementById('hse-emg-drill-filter-status').value || null,
      },
    });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(d => `
      <tr>
        <td>${d.code}</td>
        <td>${ref.drill_type_labels[d.drill_type] || d.drill_type}</td>
        <td>${d.scheduled_date}</td>
        <td>${d.target_time_seconds ?? '—'} / ${d.actual_time_seconds ?? '—'} ث</td>
        <td>${d.attendance_rate != null ? d.attendance_rate + '%' : '—'}</td>
        <td><span class="tag ${hseEmgResultTag(d.result)}">${d.result_label}</span></td>
        <td><span class="tag ${d.status === 'completed' ? 'tag-ok' : 'tag-info'}">${ref.drill_status_labels[d.status] || d.status}</span></td>
        <td>
          ${d.status === 'scheduled' ? `<button class="btn btn-sm btn-primary" data-hse-emg-drill-complete="${d.id}">إتمام</button>` : ''}
          <button class="btn btn-sm btn-outline" data-hse-emg-drill-edit="${d.id}">تعديل</button>
          <button class="btn btn-sm btn-danger" data-hse-emg-drill-delete="${d.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="8"><div class="pm-empty-state">لا توجد تمارين مسجّلة</div></td></tr>`;

    tbody.querySelectorAll('[data-hse-emg-drill-complete]').forEach(b => b.addEventListener('click', () => hseEmgDrillShowComplete(b.dataset.hseEmgDrillComplete)));
    tbody.querySelectorAll('[data-hse-emg-drill-edit]').forEach(b => b.addEventListener('click', () => hseEmgDrillShowForm(b.dataset.hseEmgDrillEdit)));
    tbody.querySelectorAll('[data-hse-emg-drill-delete]').forEach(b => b.addEventListener('click', () => hseEmgDrillDelete(b.dataset.hseEmgDrillDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-emg-drill-project')?.addEventListener('input', debounceHseEmg(() => hseEmgLoadDrillTable(), 300));
document.getElementById('hse-emg-drill-filter-type')?.addEventListener('change', () => hseEmgLoadDrillTable());
document.getElementById('hse-emg-drill-filter-status')?.addEventListener('change', () => hseEmgLoadDrillTable());
document.getElementById('hse-emg-drill-btn-new')?.addEventListener('click', () => hseEmgDrillShowForm(null));
document.getElementById('hse-emg-drill-btn-back-to-list')?.addEventListener('click', () => { hseEmgDrillShowListView(); hseEmgLoadDrillTable(); });
document.getElementById('hse-emg-drill-btn-back-from-complete')?.addEventListener('click', () => { hseEmgDrillShowListView(); hseEmgLoadDrillTable(); });

async function hseEmgDrillShowForm(id) {
  hseEmgDrillEditingId = id;
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-drill-list-view').style.display = 'none';
  document.getElementById('hse-emg-drill-complete-view').style.display = 'none';
  document.getElementById('hse-emg-drill-form-view').style.display = '';
  document.getElementById('hse-emg-drill-form-alert').innerHTML = '';

  document.getElementById('hse-emg-drill-f-type').innerHTML = hseEmgOptionsHTML(ref.drill_types, ref.drill_type_labels);
  document.getElementById('hse-emg-drill-f-scenario').innerHTML = hseEmgOptionsHTML(ref.scenario_types, ref.scenario_type_labels, { placeholder: '(بدون سيناريو محدد)' });

  ['project', 'date', 'coordinator', 'target-time', 'expected'].forEach(f => {
    const el = document.getElementById(`hse-emg-drill-f-${f}`); if (el) el.value = '';
  });

  if (id) {
    const res = await hseEmgFetch('/drills/get', { query: { id } });
    const d = res.data;
    document.getElementById('hse-emg-drill-f-type').value = d.drill_type;
    document.getElementById('hse-emg-drill-f-scenario').value = d.scenario_type || '';
    document.getElementById('hse-emg-drill-f-project').value = d.project_id || '';
    document.getElementById('hse-emg-drill-f-date').value = d.scheduled_date || '';
    document.getElementById('hse-emg-drill-f-coordinator').value = d.coordinator_name || '';
    document.getElementById('hse-emg-drill-f-target-time').value = d.target_time_seconds ?? '';
    document.getElementById('hse-emg-drill-f-expected').value = d.total_participants_expected ?? '';
  }
}

document.getElementById('hse-emg-drill-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-emg-drill-form-alert');
  try {
    const body = {
      drill_type: document.getElementById('hse-emg-drill-f-type').value,
      scenario_type: document.getElementById('hse-emg-drill-f-scenario').value || null,
      project_id: document.getElementById('hse-emg-drill-f-project').value.trim(),
      scheduled_date: document.getElementById('hse-emg-drill-f-date').value,
      coordinator_name: document.getElementById('hse-emg-drill-f-coordinator').value.trim() || null,
      target_time_seconds: document.getElementById('hse-emg-drill-f-target-time').value || null,
      total_participants_expected: document.getElementById('hse-emg-drill-f-expected').value || 0,
    };
    if (hseEmgDrillEditingId) {
      await hseEmgFetch('/drills/update', { method: 'POST', body: { id: hseEmgDrillEditingId, updates: body } });
    } else {
      await hseEmgFetch('/drills', { method: 'POST', body });
    }
    hseEmgDrillShowListView();
    hseEmgLoadDrillTable();
  } catch (e) {
    hseEmgAlert(alertEl, 'error', e.message);
  }
});

function hseEmgDrillShowComplete(id) {
  hseEmgDrillCompletingId = id;
  document.getElementById('hse-emg-drill-list-view').style.display = 'none';
  document.getElementById('hse-emg-drill-form-view').style.display = 'none';
  document.getElementById('hse-emg-drill-complete-view').style.display = '';
  document.getElementById('hse-emg-drill-complete-alert').innerHTML = '';
  ['actual-time', 'attended', 'observations', 'issues'].forEach(f => {
    const el = document.getElementById(`hse-emg-drill-c-${f}`); if (el) el.value = '';
  });
}

document.getElementById('hse-emg-drill-btn-complete')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-emg-drill-complete-alert');
  try {
    const body = {
      id: hseEmgDrillCompletingId,
      actual_time_seconds: document.getElementById('hse-emg-drill-c-actual-time').value,
      total_participants_attended: document.getElementById('hse-emg-drill-c-attended').value,
      observations: document.getElementById('hse-emg-drill-c-observations').value.trim() || null,
      issues_identified: hseEmgLinesToArray(document.getElementById('hse-emg-drill-c-issues').value),
    };
    await hseEmgFetch('/drills/complete', { method: 'POST', body });
    hseEmgDrillShowListView();
    hseEmgLoadDrillTable();
  } catch (e) {
    hseEmgAlert(alertEl, 'error', e.message);
  }
});

async function hseEmgDrillDelete(id) {
  if (!confirm('هل تريد حذف هذا التمرين؟')) return;
  try {
    await hseEmgFetch('/drills/delete', { method: 'POST', body: { id } });
    hseEmgLoadDrillTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// سجلات الطوارئ الفعلية (Activation Log)
// ================================================================

document.querySelector('[data-panel="hse-emg-activations"]')?.addEventListener('click', async () => {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-act-filter-scenario').innerHTML =
    hseEmgOptionsHTML(ref.scenario_types, ref.scenario_type_labels, { placeholder: 'كل السيناريوهات' });
  document.getElementById('hse-emg-act-filter-status').innerHTML =
    hseEmgOptionsHTML(ref.activation_statuses, ref.activation_status_labels, { placeholder: 'كل الحالات' });
  hseEmgActShowListView();
  hseEmgLoadActTable();
});

function hseEmgActShowListView() {
  document.getElementById('hse-emg-act-list-view').style.display = '';
  document.getElementById('hse-emg-act-form-view').style.display = 'none';
  document.getElementById('hse-emg-act-detail-view').style.display = 'none';
}

async function hseEmgLoadActTable() {
  const tbody = document.getElementById('hse-emg-act-tbody');
  const ref = await hseEmgEnsureRefData();
  try {
    const res = await hseEmgFetch('/activations', {
      query: {
        projectId: document.getElementById('hse-emg-act-project').value || null,
        scenarioType: document.getElementById('hse-emg-act-filter-scenario').value || null,
        status: document.getElementById('hse-emg-act-filter-status').value || null,
      },
    });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(a => `
      <tr>
        <td>${a.code}</td>
        <td>${ref.scenario_type_labels[a.scenario_type] || a.scenario_type}</td>
        <td>${hseEmgEsc(a.location)}</td>
        <td>${hseEmgFmtDateTime(a.reported_at)}</td>
        <td><span class="tag ${hseEmgActStatusTag(a.status)}">${ref.activation_status_labels[a.status] || a.status}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" data-hse-emg-act-view="${a.id}">عرض</button>
          <button class="btn btn-sm btn-danger" data-hse-emg-act-delete="${a.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6"><div class="pm-empty-state">لا توجد سجلات طوارئ فعلية</div></td></tr>`;

    tbody.querySelectorAll('[data-hse-emg-act-view]').forEach(b => b.addEventListener('click', () => hseEmgActShowDetail(b.dataset.hseEmgActView)));
    tbody.querySelectorAll('[data-hse-emg-act-delete]').forEach(b => b.addEventListener('click', () => hseEmgActDelete(b.dataset.hseEmgActDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('hse-emg-act-project')?.addEventListener('input', debounceHseEmg(() => hseEmgLoadActTable(), 300));
document.getElementById('hse-emg-act-filter-scenario')?.addEventListener('change', () => hseEmgLoadActTable());
document.getElementById('hse-emg-act-filter-status')?.addEventListener('change', () => hseEmgLoadActTable());
document.getElementById('hse-emg-act-btn-new')?.addEventListener('click', () => hseEmgActShowForm());
document.getElementById('hse-emg-act-btn-back-to-list')?.addEventListener('click', () => { hseEmgActShowListView(); hseEmgLoadActTable(); });
document.getElementById('hse-emg-act-btn-back-from-detail')?.addEventListener('click', () => { hseEmgActShowListView(); hseEmgLoadActTable(); });

async function hseEmgActShowForm() {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-act-list-view').style.display = 'none';
  document.getElementById('hse-emg-act-detail-view').style.display = 'none';
  document.getElementById('hse-emg-act-form-view').style.display = '';
  document.getElementById('hse-emg-act-form-alert').innerHTML = '';
  document.getElementById('hse-emg-act-f-scenario').innerHTML = hseEmgOptionsHTML(ref.scenario_types, ref.scenario_type_labels);
  ['project', 'location', 'reported', 'reported-by', 'description'].forEach(f => {
    const el = document.getElementById(`hse-emg-act-f-${f}`); if (el) el.value = '';
  });
}

document.getElementById('hse-emg-act-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-emg-act-form-alert');
  try {
    const reportedLocal = document.getElementById('hse-emg-act-f-reported').value;
    const body = {
      scenario_type: document.getElementById('hse-emg-act-f-scenario').value,
      project_id: document.getElementById('hse-emg-act-f-project').value.trim(),
      location: document.getElementById('hse-emg-act-f-location').value.trim(),
      reported_at: reportedLocal ? new Date(reportedLocal).toISOString() : null,
      reported_by: document.getElementById('hse-emg-act-f-reported-by').value.trim() || null,
      description: document.getElementById('hse-emg-act-f-description').value.trim() || null,
    };
    await hseEmgFetch('/activations', { method: 'POST', body });
    hseEmgActShowListView();
    hseEmgLoadActTable();
  } catch (e) {
    hseEmgAlert(alertEl, 'error', e.message);
  }
});

async function hseEmgActShowDetail(id) {
  const ref = await hseEmgEnsureRefData();
  document.getElementById('hse-emg-act-list-view').style.display = 'none';
  document.getElementById('hse-emg-act-form-view').style.display = 'none';
  document.getElementById('hse-emg-act-detail-view').style.display = '';
  const content = document.getElementById('hse-emg-act-detail-content');
  try {
    const res = await hseEmgFetch('/activations/get', { query: { id } });
    const a = res.data;
    content.innerHTML = `
      <h3>${a.code} — ${ref.scenario_type_labels[a.scenario_type] || a.scenario_type}
        <span class="tag ${hseEmgActStatusTag(a.status)}">${ref.activation_status_labels[a.status]}</span></h3>
      <p><strong>الموقع:</strong> ${hseEmgEsc(a.location)} &nbsp; <strong>المشروع:</strong> ${hseEmgEsc(a.project_id)}</p>
      <p><strong>وقت التبليغ:</strong> ${hseEmgFmtDateTime(a.reported_at)} &nbsp; <strong>المُبلِّغ:</strong> ${hseEmgEsc(a.reported_by || '—')}</p>
      ${a.contained_at ? `<p><strong>وقت الاحتواء:</strong> ${hseEmgFmtDateTime(a.contained_at)}</p>` : ''}
      ${a.closed_at ? `<p><strong>وقت الإغلاق:</strong> ${hseEmgFmtDateTime(a.closed_at)}</p>` : ''}
      ${a.description ? `<p><strong>الوصف:</strong> ${hseEmgEsc(a.description)}</p>` : ''}
      <p><strong>عدد الإصابات:</strong> ${a.casualties}</p>

      <h4>تغيير الحالة</h4>
      <div class="form-grid">
        <div class="field"><label>الحالة</label>
          <select id="hse-emg-act-d-status">${hseEmgOptionsHTML(ref.activation_statuses, ref.activation_status_labels)}</select>
        </div>
        <div class="field"><label>تقييم الاستجابة (مطلوب للإغلاق)</label>
          <select id="hse-emg-act-d-rating">${hseEmgOptionsHTML(ref.response_evaluation_ratings, ref.response_evaluation_rating_labels, { placeholder: '—' })}</select>
        </div>
        <div class="field field-full"><label>الدروس المستفادة</label><textarea id="hse-emg-act-d-lessons" rows="2"></textarea></div>
      </div>
      <button class="btn btn-primary" id="hse-emg-act-btn-update-status">تحديث الحالة</button>
      <div id="hse-emg-act-update-alert"></div>
    `;
    document.getElementById('hse-emg-act-d-status').value = a.status;
    if (a.response_evaluation_rating) document.getElementById('hse-emg-act-d-rating').value = a.response_evaluation_rating;
    document.getElementById('hse-emg-act-d-lessons').value = a.lessons_learned || '';

    document.getElementById('hse-emg-act-btn-update-status')?.addEventListener('click', async () => {
      const updAlert = document.getElementById('hse-emg-act-update-alert');
      try {
        const updates = {
          status: document.getElementById('hse-emg-act-d-status').value,
          response_evaluation_rating: document.getElementById('hse-emg-act-d-rating').value || null,
          lessons_learned: document.getElementById('hse-emg-act-d-lessons').value.trim() || null,
        };
        await hseEmgFetch('/activations/update', { method: 'POST', body: { id: a.id, updates } });
        hseEmgActShowDetail(id);
      } catch (e) {
        hseEmgAlert(updAlert, 'error', e.message);
      }
    });
  } catch (e) {
    hseEmgAlert(content, 'error', e.message);
  }
}

async function hseEmgActDelete(id) {
  if (!confirm('هل تريد حذف سجل الطوارئ هذا؟')) return;
  try {
    await hseEmgFetch('/activations/delete', { method: 'POST', body: { id } });
    hseEmgLoadActTable();
  } catch (e) {
    alert(e.message);
  }
}
