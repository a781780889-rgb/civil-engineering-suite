// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// وحدة إدارة المخالفات (HSE Violations Management)
// ============================================================

const HSE_VIOL_API = '/api/hse/violations';
let HSE_VIOL_REF = null;
let hseViolEditingId = null;
let hseViolDetailId = null;

// ---------- أدوات عامة (بنفس نمط hseFireSafety.js) ----------
function hseViolFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_VIOL_API}${path}`;
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

function hseViolAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseViolEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounceHseViol(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function hseViolEnsureRefData() {
  if (HSE_VIOL_REF) return HSE_VIOL_REF;
  const res = await hseViolFetch('/reference-data');
  HSE_VIOL_REF = res.data;
  return HSE_VIOL_REF;
}

function hseViolOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    (values || []).map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseViolSeverityTag(severity) {
  const map = { critical: 'tag-bad', major: 'tag-bad', moderate: 'tag-info', minor: 'tag-ok' };
  return map[severity] || 'tag-info';
}
function hseViolStatusTag(status) {
  const map = { open: 'tag-bad', in_progress: 'tag-info', closed: 'tag-ok', overdue: 'tag-bad' };
  return map[status] || 'tag-info';
}

// ================================================================
// عرض القائمة / النموذج / التفاصيل
// ================================================================

function hseViolShowListView() {
  document.getElementById('hse-viol-list-view').style.display = '';
  document.getElementById('hse-viol-form-view').style.display = 'none';
  document.getElementById('hse-viol-detail-view').style.display = 'none';
}
function hseViolShowFormView() {
  document.getElementById('hse-viol-list-view').style.display = 'none';
  document.getElementById('hse-viol-form-view').style.display = '';
  document.getElementById('hse-viol-detail-view').style.display = 'none';
}
function hseViolShowDetailView() {
  document.getElementById('hse-viol-list-view').style.display = 'none';
  document.getElementById('hse-viol-form-view').style.display = 'none';
  document.getElementById('hse-viol-detail-view').style.display = '';
}

document.querySelector('[data-panel="hse-viol"]')?.addEventListener('click', async () => {
  await hseViolEnsureRefData();
  hseViolPopulateFilters();
  hseViolShowListView();
  hseViolLoadDashboardCards();
  hseViolLoadTable();
});

async function hseViolPopulateFilters() {
  const ref = await hseViolEnsureRefData();
  const typeSel = document.getElementById('hse-viol-filter-type');
  const sevSel = document.getElementById('hse-viol-filter-severity');
  const statusSel = document.getElementById('hse-viol-filter-status');
  if (typeSel && typeSel.options.length <= 1) typeSel.innerHTML += hseViolOptionsHTML(ref.violation_types, ref.violation_type_labels);
  if (sevSel && sevSel.options.length <= 1) sevSel.innerHTML += hseViolOptionsHTML(ref.violation_severities, ref.violation_severity_labels);
  if (statusSel && statusSel.options.length <= 1) statusSel.innerHTML += hseViolOptionsHTML(ref.violation_statuses, ref.violation_status_labels);

  const formTypeSel = document.getElementById('hse-viol-f-type');
  const formSevSel = document.getElementById('hse-viol-f-severity');
  if (formTypeSel && formTypeSel.options.length === 0) formTypeSel.innerHTML = hseViolOptionsHTML(ref.violation_types, ref.violation_type_labels, { placeholder: 'اختر النوع' });
  if (formSevSel && formSevSel.options.length === 0) formSevSel.innerHTML = hseViolOptionsHTML(ref.violation_severities, ref.violation_severity_labels, { placeholder: 'اختر الدرجة' });
}

async function hseViolLoadDashboardCards() {
  const cardsEl = document.getElementById('hse-viol-dash-cards');
  const projectId = document.getElementById('hse-viol-filter-project')?.value.trim() || null;
  try {
    const res = await hseViolFetch('/dashboard', { query: { projectId } });
    const d = res.data;
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المخالفات</div><div class="value">${d.total_violations ?? 0}</div></div>
      <div class="result-card"><div class="label">مخالفات مفتوحة</div><div class="value">${d.open_count ?? 0}</div></div>
      <div class="result-card"><div class="label">مخالفات متأخرة</div><div class="value">${d.overdue_count ?? 0}</div></div>
      <div class="result-card"><div class="label">مغلقة</div><div class="value">${d.closed_count ?? 0}</div></div>
    `;
  } catch (e) {
    cardsEl.innerHTML = '';
  }
}

async function hseViolLoadTable() {
  const tbody = document.getElementById('hse-viol-tbody');
  const ref = await hseViolEnsureRefData();
  const search = document.getElementById('hse-viol-search')?.value.trim() || null;
  const type = document.getElementById('hse-viol-filter-type')?.value || null;
  const severity = document.getElementById('hse-viol-filter-severity')?.value || null;
  const status = document.getElementById('hse-viol-filter-status')?.value || null;
  const projectId = document.getElementById('hse-viol-filter-project')?.value.trim() || null;

  try {
    const res = await hseViolFetch('', { query: { search, type, severity, status, projectId } });
    const rows = res.data || [];
    tbody.innerHTML = rows.length ? rows.map(v => `
      <tr>
        <td>${hseViolEsc(v.code || v.id)}</td>
        <td>${hseViolEsc(ref.violation_type_labels[v.type] || v.type)}</td>
        <td><span class="tag ${hseViolSeverityTag(v.severity)}">${hseViolEsc(ref.violation_severity_labels[v.severity] || v.severity)}</span></td>
        <td>${hseViolEsc(v.location || '—')}</td>
        <td>${hseViolEsc(v.responsible_person || '—')}</td>
        <td><span class="tag ${hseViolStatusTag(v.status)}">${hseViolEsc(ref.violation_status_labels[v.status] || v.status)}</span></td>
        <td>${hseFmtDate(v.closure_due_date)}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="hseViolOpenDetail('${v.id}')">عرض</button>
          <button class="btn btn-sm btn-outline" onclick="hseViolOpenEdit('${v.id}')">تعديل</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="8"><div class="pm-empty-state">لا توجد مخالفات مسجَّلة بعد</div></td></tr>`;
  } catch (e) {
    hseViolAlert(document.getElementById('hse-viol-error'), 'danger', e.message);
  }
}

document.getElementById('hse-viol-search')?.addEventListener('input', debounceHseViol(() => hseViolLoadTable(), 300));
document.getElementById('hse-viol-filter-type')?.addEventListener('change', () => hseViolLoadTable());
document.getElementById('hse-viol-filter-severity')?.addEventListener('change', () => hseViolLoadTable());
document.getElementById('hse-viol-filter-status')?.addEventListener('change', () => hseViolLoadTable());
document.getElementById('hse-viol-filter-project')?.addEventListener('change', () => { hseViolLoadDashboardCards(); hseViolLoadTable(); });

document.getElementById('hse-viol-btn-overdue')?.addEventListener('click', async () => {
  const ref = await hseViolEnsureRefData();
  const projectId = document.getElementById('hse-viol-filter-project')?.value.trim() || null;
  const tbody = document.getElementById('hse-viol-tbody');
  try {
    const res = await hseViolFetch('/overdue', { query: { projectId } });
    const rows = res.data || [];
    tbody.innerHTML = rows.length ? rows.map(v => `
      <tr>
        <td>${hseViolEsc(v.code || v.id)}</td>
        <td>${hseViolEsc(ref.violation_type_labels[v.type] || v.type)}</td>
        <td><span class="tag ${hseViolSeverityTag(v.severity)}">${hseViolEsc(ref.violation_severity_labels[v.severity] || v.severity)}</span></td>
        <td>${hseViolEsc(v.location || '—')}</td>
        <td>${hseViolEsc(v.responsible_person || '—')}</td>
        <td><span class="tag tag-bad">متأخرة</span></td>
        <td>${hseFmtDate(v.closure_due_date)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="hseViolOpenDetail('${v.id}')">عرض</button></td>
      </tr>
    `).join('') : `<tr><td colspan="8"><div class="pm-empty-state">لا توجد مخالفات متأخرة حالياً</div></td></tr>`;
  } catch (e) {
    hseViolAlert(document.getElementById('hse-viol-error'), 'danger', e.message);
  }
});

// ---------- نموذج إضافة / تعديل ----------

document.getElementById('hse-viol-btn-new')?.addEventListener('click', async () => {
  await hseViolPopulateFilters();
  hseViolEditingId = null;
  document.getElementById('hse-viol-f-type').value = '';
  document.getElementById('hse-viol-f-severity').value = '';
  document.getElementById('hse-viol-f-project').value = '';
  document.getElementById('hse-viol-f-location').value = '';
  document.getElementById('hse-viol-f-responsible').value = '';
  document.getElementById('hse-viol-f-date').value = '';
  document.getElementById('hse-viol-f-description').value = '';
  document.getElementById('hse-viol-f-corrective').value = '';
  document.getElementById('hse-viol-f-photo').value = '';
  document.getElementById('hse-viol-form-alert').innerHTML = '';
  hseViolShowFormView();
});

document.getElementById('hse-viol-btn-back-to-list')?.addEventListener('click', () => { hseViolShowListView(); hseViolLoadTable(); });
document.getElementById('hse-viol-btn-back-from-detail')?.addEventListener('click', () => { hseViolShowListView(); hseViolLoadTable(); });

async function hseViolOpenEdit(id) {
  await hseViolPopulateFilters();
  try {
    const res = await hseViolFetch('/get', { query: { id } });
    const v = res.data;
    hseViolEditingId = id;
    document.getElementById('hse-viol-f-type').value = v.type || '';
    document.getElementById('hse-viol-f-severity').value = v.severity || '';
    document.getElementById('hse-viol-f-project').value = v.project_id || '';
    document.getElementById('hse-viol-f-location').value = v.location || '';
    document.getElementById('hse-viol-f-responsible').value = v.responsible_person || '';
    document.getElementById('hse-viol-f-date').value = hseFmtDate(v.violation_date);
    document.getElementById('hse-viol-f-description').value = v.description || '';
    document.getElementById('hse-viol-f-corrective').value = v.corrective_actions || '';
    document.getElementById('hse-viol-f-photo').value = v.photo_url || '';
    document.getElementById('hse-viol-form-alert').innerHTML = '';
    hseViolShowFormView();
  } catch (e) {
    hseViolAlert(document.getElementById('hse-viol-error'), 'danger', e.message);
  }
}

document.getElementById('hse-viol-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-viol-form-alert');
  const body = {
    type: document.getElementById('hse-viol-f-type').value,
    severity: document.getElementById('hse-viol-f-severity').value,
    project_id: document.getElementById('hse-viol-f-project').value.trim(),
    location: document.getElementById('hse-viol-f-location').value.trim(),
    responsible_person: document.getElementById('hse-viol-f-responsible').value.trim(),
    violation_date: document.getElementById('hse-viol-f-date').value || null,
    description: document.getElementById('hse-viol-f-description').value.trim(),
    corrective_actions: document.getElementById('hse-viol-f-corrective').value.trim(),
    photo_url: document.getElementById('hse-viol-f-photo').value.trim() || null,
  };
  try {
    if (hseViolEditingId) {
      await hseViolFetch('/update', { method: 'POST', body: { id: hseViolEditingId, ...body } });
    } else {
      await hseViolFetch('', { method: 'POST', body });
    }
    hseViolShowListView();
    hseViolLoadDashboardCards();
    hseViolLoadTable();
  } catch (e) {
    hseViolAlert(alertEl, 'danger', e.message);
  }
});

// ---------- عرض التفاصيل ----------

async function hseViolOpenDetail(id) {
  const ref = await hseViolEnsureRefData();
  const contentEl = document.getElementById('hse-viol-detail-content');
  try {
    const res = await hseViolFetch('/get', { query: { id } });
    const v = res.data;
    hseViolDetailId = id;
    contentEl.innerHTML = `
      <div class="detail-block">
        <h3>${hseViolEsc(v.code || v.id)} — ${hseViolEsc(ref.violation_type_labels[v.type] || v.type)}</h3>
        <p><span class="tag ${hseViolSeverityTag(v.severity)}">${hseViolEsc(ref.violation_severity_labels[v.severity] || v.severity)}</span>
           <span class="tag ${hseViolStatusTag(v.status)}">${hseViolEsc(ref.violation_status_labels[v.status] || v.status)}</span></p>
        <p><strong>المشروع:</strong> ${hseViolEsc(v.project_id || '—')}</p>
        <p><strong>الموقع:</strong> ${hseViolEsc(v.location || '—')}</p>
        <p><strong>الشخص المسؤول:</strong> ${hseViolEsc(v.responsible_person || '—')}</p>
        <p><strong>تاريخ المخالفة:</strong> ${hseFmtDate(v.violation_date)}</p>
        <p><strong>موعد الإغلاق المستحق:</strong> ${hseFmtDate(v.closure_due_date)}</p>
        <p><strong>الوصف:</strong> ${hseViolEsc(v.description || '—')}</p>
        <p><strong>الإجراءات التصحيحية:</strong> ${hseViolEsc(v.corrective_actions || '—')}</p>
        ${v.photo_url ? `<p><strong>الصورة:</strong> <a href="${hseViolEsc(v.photo_url)}" target="_blank">عرض الصورة</a></p>` : ''}
        ${v.closed_at ? `<p><strong>تاريخ الإغلاق:</strong> ${hseFmtDateTime(v.closed_at)} — بواسطة: ${hseViolEsc(v.closed_by || '—')}</p><p><strong>ملاحظات الإغلاق:</strong> ${hseViolEsc(v.closure_notes || '—')}</p>` : ''}
      </div>
      ${v.status !== 'closed' ? `
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>اسم من قام بالإغلاق</label><input type="text" id="hse-viol-close-by"></div>
        <div class="field field-full"><label>ملاحظات الإغلاق</label><textarea id="hse-viol-close-notes" rows="2"></textarea></div>
      </div>
      <button class="btn btn-primary" id="hse-viol-btn-do-close">إغلاق المخالفة</button>
      ` : ''}
    `;
    document.getElementById('hse-viol-btn-do-close')?.addEventListener('click', hseViolCloseCurrent);
    hseViolShowDetailView();
  } catch (e) {
    hseViolAlert(document.getElementById('hse-viol-error'), 'danger', e.message);
  }
}

async function hseViolCloseCurrent() {
  if (!hseViolDetailId) return;
  const closed_by = document.getElementById('hse-viol-close-by')?.value.trim() || null;
  const closure_notes = document.getElementById('hse-viol-close-notes')?.value.trim() || null;
  try {
    await hseViolFetch('/close', { method: 'POST', body: { id: hseViolDetailId, closed_by, closure_notes } });
    hseViolOpenDetail(hseViolDetailId);
    hseViolLoadDashboardCards();
  } catch (e) {
    hseViolAlert(document.getElementById('hse-viol-error'), 'danger', e.message);
  }
}
