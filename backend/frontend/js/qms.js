// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (Quality Management System - QMS)
// الجزء 1/4: البنية الأساسية + لوحة التحكم + إدارة خطة الجودة +
//            إدارة طلبات الفحص (Inspection Request - IR)
// ============================================================

const QMS_API = '/api/qms';
let QMS_REF = null;
let qmsPlanEditingId = null;
let qmsIrEditingId = null;

// ---------- أدوات عامة ----------
function qmsFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${QMS_API}${path}`;
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

function qmsAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function qmsFmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function qmsFmtDateTime(d) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

function qmsLinesToArray(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function qmsArrayToLines(arr) {
  return Array.isArray(arr) ? arr.join('\n') : '';
}

function qmsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounceQms(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function qmsOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

async function qmsEnsureRefData() {
  if (QMS_REF) return QMS_REF;
  const res = await qmsFetch('/reference-data');
  QMS_REF = res.data;
  return QMS_REF;
}

function qmsPlanStatusTag(status) {
  const map = { draft: 'tag-info', under_review: 'tag-info', approved: 'tag-ok', archived: 'tag-bad' };
  return map[status] || 'tag-info';
}

function qmsIrStatusTag(status) {
  const map = {
    draft: 'tag-info', submitted: 'tag-info', scheduled: 'tag-info',
    inspected: 'tag-ok', closed: 'tag-ok', cancelled: 'tag-bad',
  };
  return map[status] || 'tag-info';
}

function qmsIrResultTag(result) {
  const map = { pending: 'tag-info', accepted: 'tag-ok', conditional: 'tag-info', rejected: 'tag-bad' };
  return map[result] || 'tag-info';
}

// ================================================================
// لوحة معلومات إدارة الجودة
// ================================================================

document.querySelector('[data-panel="qms-dashboard"]')?.addEventListener('click', () => qmsLoadDashboard());
document.getElementById('qms-btn-load-dashboard')?.addEventListener('click', () => qmsLoadDashboard());

async function qmsLoadDashboard() {
  const cardsEl = document.getElementById('qms-dash-cards');
  const recentInspEl = document.getElementById('qms-recent-inspections');
  if (!cardsEl) return;
  await qmsEnsureRefData();
  const projectId = document.getElementById('qms-dash-project')?.value.trim() || null;

  try {
    const res = await qmsFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المشاريع</div><div class="value">${d.total_projects}</div></div>
      <div class="result-card"><div class="label">مشاريع لديها خطة جودة معتمدة</div><div class="value">${d.projects_compliant_with_quality}</div></div>
      <div class="result-card"><div class="label">عدد خطط الجودة</div><div class="value">${d.quality_plans_count}</div></div>
      <div class="result-card"><div class="label">عدد طلبات الفحص (IR)</div><div class="value">${d.inspection_requests_count}</div></div>
      <div class="result-card"><div class="label">عدد عمليات الفحص المنجزة</div><div class="value">${d.inspections_done_count}</div></div>
      <div class="result-card"><div class="label">عدد الاختبارات</div><div class="value">${d.tests_count}</div></div>
      <div class="result-card"><div class="label">حالات عدم المطابقة (NCR)</div><div class="value">${d.ncr_count}</div></div>
      <div class="result-card"><div class="label">NCR مفتوحة</div><div class="value">${d.ncr_open_count}</div></div>
      <div class="result-card"><div class="label">طلبات اعتماد المواد (MAR)</div><div class="value">${d.material_approval_requests_count}</div></div>
      <div class="result-card"><div class="label">MAR قيد المراجعة</div><div class="value">${d.material_approval_requests_pending_count}</div></div>
      <div class="result-card"><div class="label">طلبات اعتماد الرسومات (SDR)</div><div class="value">${d.shop_drawing_requests_count}</div></div>
      <div class="result-card"><div class="label">SDR قيد المراجعة</div><div class="value">${d.shop_drawing_requests_pending_count}</div></div>
      <div class="result-card"><div class="label">الإجراءات التصحيحية (CAPA)</div><div class="value">${d.capa_count}</div></div>
      <div class="result-card"><div class="label">CAPA متأخرة</div><div class="value">${d.capa_overdue_count}</div></div>
      <div class="result-card"><div class="label">نسبة الالتزام بالجودة</div><div class="value">${d.quality_compliance_rate}<span class="unit">%</span></div></div>
    `;

    recentInspEl.innerHTML = d.recent_inspections.length
      ? d.recent_inspections.map(i => `
        <div class="pm-activity-item">
          <span class="ts">${qmsFmtDateTime(i.inspection_date)}</span>
          <span>${i.code} — ${qmsEsc(i.element)} — <span class="tag ${qmsIrResultTag(i.result)}">${QMS_REF.ir_result_labels[i.result] || i.result}</span></span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد عمليات فحص منجزة بعد</div>`;

    const recentNcrEl = document.getElementById('qms-recent-ncrs');
    if (recentNcrEl) {
      recentNcrEl.innerHTML = (d.recent_ncrs && d.recent_ncrs.length)
        ? d.recent_ncrs.map(n => `
          <div class="pm-activity-item">
            <span class="ts">${qmsFmtDateTime(n.created_at)}</span>
            <span>${n.code} — ${qmsEsc(n.element)} — ${qmsEsc(n.severity)} — ${qmsEsc(n.status)}</span>
          </div>
        `).join('')
        : `<div class="pm-empty-state">لا توجد حالات عدم مطابقة بعد</div>`;
    }

    const recentApprovalsEl = document.getElementById('qms-recent-approvals');
    if (recentApprovalsEl) {
      recentApprovalsEl.innerHTML = (d.recent_approvals && d.recent_approvals.length)
        ? d.recent_approvals.map(a => `
          <div class="pm-activity-item">
            <span class="ts">${qmsFmtDateTime(a.ts)}</span>
            <span>[${a.type}] ${a.code} — ${qmsEsc(a.title)} — ${qmsEsc(a.status)}</span>
          </div>
        `).join('')
        : `<div class="pm-empty-state">لا توجد قرارات اعتماد بعد</div>`;
    }
  } catch (e) {
    qmsAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// إدارة خطة الجودة
// ================================================================

document.querySelector('[data-panel="qms-plans"]')?.addEventListener('click', async () => {
  await qmsEnsureRefData();
  qmsPlanShowListView();
  qmsLoadPlanTable();
});

function qmsPlanShowListView() {
  document.getElementById('qms-plan-list-view').style.display = '';
  document.getElementById('qms-plan-form-view').style.display = 'none';
  document.getElementById('qms-plan-detail-view').style.display = 'none';
}

async function qmsLoadPlanTable() {
  const ref = await qmsEnsureRefData();
  const tbody = document.getElementById('qms-plan-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-plan-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.quality_plan_statuses, ref.quality_plan_status_labels);
  }

  try {
    const res = await qmsFetch('/quality-plans', {
      query: {
        search: document.getElementById('qms-plan-search')?.value || null,
        status: statusFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد خطط جودة مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td>${qmsEsc(p.title)}</td>
        <td>${qmsEsc(p.project_id)}</td>
        <td>v${p.version}</td>
        <td><span class="tag ${qmsPlanStatusTag(p.status)}">${ref.quality_plan_status_labels[p.status] || p.status}</span></td>
        <td>
          <button class="pm-link-btn" data-qms-plan-view="${p.id}">عرض</button>
          <button class="pm-link-btn" data-qms-plan-edit="${p.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-qms-plan-delete="${p.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qms-plan-view]').forEach(b => b.addEventListener('click', () => qmsPlanShowDetail(b.dataset.qmsPlanView)));
    tbody.querySelectorAll('[data-qms-plan-edit]').forEach(b => b.addEventListener('click', () => qmsPlanShowForm(b.dataset.qmsPlanEdit)));
    tbody.querySelectorAll('[data-qms-plan-delete]').forEach(b => b.addEventListener('click', () => qmsPlanDelete(b.dataset.qmsPlanDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-plan-search')?.addEventListener('input', debounceQms(() => qmsLoadPlanTable(), 300));
document.getElementById('qms-plan-filter-status')?.addEventListener('change', () => qmsLoadPlanTable());
document.getElementById('qms-plan-btn-new')?.addEventListener('click', () => qmsPlanShowForm(null));
document.getElementById('qms-plan-btn-back-to-list')?.addEventListener('click', () => { qmsPlanShowListView(); qmsLoadPlanTable(); });
document.getElementById('qms-plan-btn-back-from-detail')?.addEventListener('click', () => { qmsPlanShowListView(); qmsLoadPlanTable(); });

async function qmsPlanShowForm(id) {
  qmsPlanEditingId = id;

  document.getElementById('qms-plan-list-view').style.display = 'none';
  document.getElementById('qms-plan-detail-view').style.display = 'none';
  document.getElementById('qms-plan-form-view').style.display = '';
  document.getElementById('qms-plan-form-alert').innerHTML = '';

  const ids = ['project', 'title', 'prepared-by', 'reference-standard', 'objectives', 'policies', 'procedures', 'work-instructions', 'acceptance-criteria', 'hold-points'];
  ids.forEach(k => { const el = document.getElementById(`qms-plan-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/quality-plans/get', { query: { id } });
      const p = res.data;
      document.getElementById('qms-plan-f-project').value = p.project_id || '';
      document.getElementById('qms-plan-f-title').value = p.title || '';
      document.getElementById('qms-plan-f-prepared-by').value = p.prepared_by || '';
      document.getElementById('qms-plan-f-reference-standard').value = p.reference_standard || '';
      document.getElementById('qms-plan-f-objectives').value = qmsArrayToLines(p.quality_objectives);
      document.getElementById('qms-plan-f-policies').value = qmsArrayToLines(p.quality_policies);
      document.getElementById('qms-plan-f-procedures').value = qmsArrayToLines(p.quality_procedures);
      document.getElementById('qms-plan-f-work-instructions').value = qmsArrayToLines(p.work_instructions);
      document.getElementById('qms-plan-f-acceptance-criteria').value = qmsArrayToLines(p.acceptance_criteria);
      document.getElementById('qms-plan-f-hold-points').value = qmsArrayToLines(p.inspection_hold_points);
      document.getElementById('qms-plan-f-project').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-plan-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-plan-f-project').disabled = false;
  }
  document.getElementById('qms-plan-form-title').textContent = id ? 'تعديل خطة الجودة' : 'خطة جودة جديدة';
}

document.getElementById('qms-plan-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-plan-form-alert');
  const payload = {
    project_id: document.getElementById('qms-plan-f-project').value.trim(),
    title: document.getElementById('qms-plan-f-title').value.trim(),
    prepared_by: document.getElementById('qms-plan-f-prepared-by').value.trim() || null,
    reference_standard: document.getElementById('qms-plan-f-reference-standard').value.trim() || 'ISO 9001',
    quality_objectives: qmsLinesToArray(document.getElementById('qms-plan-f-objectives').value),
    quality_policies: qmsLinesToArray(document.getElementById('qms-plan-f-policies').value),
    quality_procedures: qmsLinesToArray(document.getElementById('qms-plan-f-procedures').value),
    work_instructions: qmsLinesToArray(document.getElementById('qms-plan-f-work-instructions').value),
    acceptance_criteria: qmsLinesToArray(document.getElementById('qms-plan-f-acceptance-criteria').value),
    inspection_hold_points: qmsLinesToArray(document.getElementById('qms-plan-f-hold-points').value),
  };
  try {
    if (qmsPlanEditingId) {
      await qmsFetch('/quality-plans/update', { method: 'POST', body: { id: qmsPlanEditingId, ...payload } });
    } else {
      await qmsFetch('/quality-plans', { method: 'POST', body: payload });
    }
    qmsPlanShowListView();
    qmsLoadPlanTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-plan-form-cancel')?.addEventListener('click', () => { qmsPlanShowListView(); qmsLoadPlanTable(); });

async function qmsPlanShowDetail(id) {
  document.getElementById('qms-plan-list-view').style.display = 'none';
  document.getElementById('qms-plan-form-view').style.display = 'none';
  document.getElementById('qms-plan-detail-view').style.display = '';
  const box = document.getElementById('qms-plan-detail-box');
  const ref = await qmsEnsureRefData();

  try {
    const res = await qmsFetch('/quality-plans/get', { query: { id } });
    const p = res.data;
    const listBlock = (title, arr) => `
      <div class="pm-detail-block">
        <h4>${title}</h4>
        ${arr.length ? `<ul>${arr.map(x => `<li>${qmsEsc(x)}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا يوجد</div>'}
      </div>`;

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${p.code} — ${qmsEsc(p.title)}</h3>
        <span class="tag ${qmsPlanStatusTag(p.status)}">${ref.quality_plan_status_labels[p.status] || p.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(p.project_id)}</div>
        <div><b>الإصدار:</b> v${p.version}</div>
        <div><b>المرجع:</b> ${qmsEsc(p.reference_standard)}</div>
        <div><b>أُعدت بواسطة:</b> ${qmsEsc(p.prepared_by || '—')}</div>
        <div><b>اعتُمدت بواسطة:</b> ${qmsEsc(p.approved_by || '—')} ${p.approved_at ? `(${qmsFmtDateTime(p.approved_at)})` : ''}</div>
      </div>
      ${listBlock('أهداف الجودة', p.quality_objectives)}
      ${listBlock('سياسات الجودة', p.quality_policies)}
      ${listBlock('إجراءات الجودة', p.quality_procedures)}
      ${listBlock('تعليمات العمل', p.work_instructions)}
      ${listBlock('معايير القبول', p.acceptance_criteria)}
      ${listBlock('نقاط الفحص والاعتماد (Hold Points)', p.inspection_hold_points)}
      <div class="pm-detail-block">
        <h4>سجل الإصدارات</h4>
        ${p.versions.length ? `<ul>${p.versions.map(v => `<li>v${v.version} — ${qmsEsc(v.change_note)} — ${qmsFmtDateTime(v.created_at)}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا يوجد</div>'}
      </div>
      <div class="modal-actions">
        ${p.status !== 'approved' ? `<button class="btn btn-primary" id="qms-plan-detail-approve">اعتماد الخطة</button>` : ''}
      </div>
      <div id="qms-plan-detail-alert"></div>
    `;

    document.getElementById('qms-plan-detail-approve')?.addEventListener('click', async () => {
      const approvedBy = prompt('اسم المعتمِد:');
      if (approvedBy === null) return;
      try {
        await qmsFetch('/quality-plans/approve', { method: 'POST', body: { id: p.id, approved_by: approvedBy || null } });
        qmsPlanShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-plan-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsPlanDelete(id) {
  if (!confirm('هل أنت متأكد من حذف خطة الجودة هذه؟')) return;
  try {
    await qmsFetch('/quality-plans/delete', { method: 'POST', body: { id } });
    qmsLoadPlanTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// إدارة طلبات الفحص (Inspection Request - IR)
// ================================================================

document.querySelector('[data-panel="qms-ir"]')?.addEventListener('click', async () => {
  await qmsEnsureRefData();
  qmsIrShowListView();
  qmsLoadIrTable();
});

function qmsIrShowListView() {
  document.getElementById('qms-ir-list-view').style.display = '';
  document.getElementById('qms-ir-form-view').style.display = 'none';
  document.getElementById('qms-ir-detail-view').style.display = 'none';
}

async function qmsLoadIrTable() {
  const ref = await qmsEnsureRefData();
  const tbody = document.getElementById('qms-ir-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-ir-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.ir_statuses, ref.ir_status_labels);
  }
  const discFilter = document.getElementById('qms-ir-filter-discipline');
  if (discFilter && discFilter.options.length <= 1) {
    discFilter.innerHTML += qmsOptionsHTML(ref.ir_disciplines, ref.ir_discipline_labels);
  }

  try {
    const res = await qmsFetch('/inspection-requests', {
      query: {
        search: document.getElementById('qms-ir-search')?.value || null,
        status: statusFilter?.value || null,
        discipline: discFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">لا توجد طلبات فحص مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(r => `
      <tr>
        <td>${r.code}</td>
        <td>${qmsEsc(r.project_id)}</td>
        <td>${qmsEsc(r.element)}</td>
        <td>${ref.ir_discipline_labels[r.discipline] || r.discipline}</td>
        <td><span class="tag ${qmsIrStatusTag(r.status)}">${ref.ir_status_labels[r.status] || r.status}</span></td>
        <td><span class="tag ${qmsIrResultTag(r.result)}">${ref.ir_result_labels[r.result] || r.result}</span></td>
        <td>${qmsFmtDate(r.inspection_date)}</td>
        <td>
          <button class="pm-link-btn" data-qms-ir-view="${r.id}">عرض</button>
          ${!['closed', 'cancelled'].includes(r.status) ? `<button class="pm-link-btn" data-qms-ir-edit="${r.id}">تعديل</button>` : ''}
          <button class="pm-link-btn pm-mini-btn-danger" data-qms-ir-delete="${r.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qms-ir-view]').forEach(b => b.addEventListener('click', () => qmsIrShowDetail(b.dataset.qmsIrView)));
    tbody.querySelectorAll('[data-qms-ir-edit]').forEach(b => b.addEventListener('click', () => qmsIrShowForm(b.dataset.qmsIrEdit)));
    tbody.querySelectorAll('[data-qms-ir-delete]').forEach(b => b.addEventListener('click', () => qmsIrDelete(b.dataset.qmsIrDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-ir-search')?.addEventListener('input', debounceQms(() => qmsLoadIrTable(), 300));
document.getElementById('qms-ir-filter-status')?.addEventListener('change', () => qmsLoadIrTable());
document.getElementById('qms-ir-filter-discipline')?.addEventListener('change', () => qmsLoadIrTable());
document.getElementById('qms-ir-btn-new')?.addEventListener('click', () => qmsIrShowForm(null));
document.getElementById('qms-ir-btn-back-to-list')?.addEventListener('click', () => { qmsIrShowListView(); qmsLoadIrTable(); });
document.getElementById('qms-ir-btn-back-from-detail')?.addEventListener('click', () => { qmsIrShowListView(); qmsLoadIrTable(); });

async function qmsIrShowForm(id) {
  const ref = await qmsEnsureRefData();
  qmsIrEditingId = id;

  document.getElementById('qms-ir-list-view').style.display = 'none';
  document.getElementById('qms-ir-detail-view').style.display = 'none';
  document.getElementById('qms-ir-form-view').style.display = '';
  document.getElementById('qms-ir-form-alert').innerHTML = '';

  document.getElementById('qms-ir-f-discipline').innerHTML = qmsOptionsHTML(ref.ir_disciplines, ref.ir_discipline_labels);

  const ids = ['project', 'stage', 'element', 'location', 'contractor', 'consultant', 'request-date', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-ir-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/inspection-requests/get', { query: { id } });
      const r = res.data;
      document.getElementById('qms-ir-f-project').value = r.project_id || '';
      document.getElementById('qms-ir-f-stage').value = r.stage || '';
      document.getElementById('qms-ir-f-element').value = r.element || '';
      document.getElementById('qms-ir-f-location').value = r.location || '';
      document.getElementById('qms-ir-f-contractor').value = r.contractor || '';
      document.getElementById('qms-ir-f-consultant').value = r.consultant || '';
      document.getElementById('qms-ir-f-discipline').value = r.discipline || 'other';
      document.getElementById('qms-ir-f-request-date').value = qmsFmtDate(r.request_date);
      document.getElementById('qms-ir-f-notes').value = r.notes || '';
      document.getElementById('qms-ir-f-project').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-ir-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-ir-f-project').disabled = false;
  }
  document.getElementById('qms-ir-form-title').textContent = id ? 'تعديل طلب الفحص' : 'طلب فحص جديد (IR)';
}

document.getElementById('qms-ir-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-ir-form-alert');
  const payload = {
    project_id: document.getElementById('qms-ir-f-project').value.trim(),
    stage: document.getElementById('qms-ir-f-stage').value.trim() || null,
    element: document.getElementById('qms-ir-f-element').value.trim(),
    location: document.getElementById('qms-ir-f-location').value.trim() || null,
    contractor: document.getElementById('qms-ir-f-contractor').value.trim() || null,
    consultant: document.getElementById('qms-ir-f-consultant').value.trim() || null,
    discipline: document.getElementById('qms-ir-f-discipline').value,
    notes: document.getElementById('qms-ir-f-notes').value.trim(),
  };
  const reqDate = document.getElementById('qms-ir-f-request-date').value;
  if (reqDate) payload.request_date = reqDate;

  try {
    if (qmsIrEditingId) {
      await qmsFetch('/inspection-requests/update', { method: 'POST', body: { id: qmsIrEditingId, ...payload } });
    } else {
      await qmsFetch('/inspection-requests', { method: 'POST', body: payload });
    }
    qmsIrShowListView();
    qmsLoadIrTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-ir-form-cancel')?.addEventListener('click', () => { qmsIrShowListView(); qmsLoadIrTable(); });

async function qmsIrShowDetail(id) {
  document.getElementById('qms-ir-list-view').style.display = 'none';
  document.getElementById('qms-ir-form-view').style.display = 'none';
  document.getElementById('qms-ir-detail-view').style.display = '';
  const box = document.getElementById('qms-ir-detail-box');
  const ref = await qmsEnsureRefData();

  try {
    const res = await qmsFetch('/inspection-requests/get', { query: { id } });
    const r = res.data;
    const nextActions = (ref.ir_allowed_transitions[r.status] || []);

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${r.code} — ${qmsEsc(r.element)}</h3>
        <span class="tag ${qmsIrStatusTag(r.status)}">${ref.ir_status_labels[r.status] || r.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(r.project_id)}</div>
        <div><b>المرحلة:</b> ${qmsEsc(r.stage || '—')}</div>
        <div><b>الموقع:</b> ${qmsEsc(r.location || '—')}</div>
        <div><b>التخصص:</b> ${ref.ir_discipline_labels[r.discipline] || r.discipline}</div>
        <div><b>المقاول:</b> ${qmsEsc(r.contractor || '—')}</div>
        <div><b>الاستشاري:</b> ${qmsEsc(r.consultant || '—')}</div>
        <div><b>تاريخ الطلب:</b> ${qmsFmtDate(r.request_date)}</div>
        <div><b>تاريخ الفحص:</b> ${qmsFmtDateTime(r.inspection_date)}</div>
        <div><b>النتيجة:</b> <span class="tag ${qmsIrResultTag(r.result)}">${ref.ir_result_labels[r.result] || r.result}</span></div>
      </div>
      <div class="pm-detail-block">
        <h4>الملاحظات</h4>
        <p>${qmsEsc(r.notes) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>التوقيعات</h4>
        ${r.signatures.length ? `<ul>${r.signatures.map(s => `<li>${qmsEsc(s.party)} — ${qmsEsc(s.name)} (${qmsFmtDateTime(s.signed_at)})</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا توجد توقيعات بعد</div>'}
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${r.change_log.map(c => `<li>${qmsFmtDateTime(c.ts)} — ${qmsEsc(c.action)} ${c.by ? `(${qmsEsc(c.by)})` : ''}</li>`).join('')}</ul>
      </div>

      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${nextActions.includes('submitted') ? `<button class="btn btn-outline" data-qms-ir-transition="submitted">إرسال الطلب</button>` : ''}
        ${nextActions.includes('scheduled') ? `<button class="btn btn-outline" data-qms-ir-transition="scheduled">جدولة الفحص</button>` : ''}
        ${nextActions.includes('cancelled') ? `<button class="btn btn-outline" data-qms-ir-transition="cancelled">إلغاء الطلب</button>` : ''}
        ${r.status === 'scheduled' ? `<button class="btn btn-primary" id="qms-ir-record-result">تسجيل نتيجة الفحص</button>` : ''}
        ${nextActions.includes('closed') ? `<button class="btn btn-outline" data-qms-ir-transition="closed">إغلاق الطلب</button>` : ''}
        ${!['closed', 'cancelled'].includes(r.status) ? `<button class="btn btn-outline" id="qms-ir-sign">توقيع طرف</button>` : ''}
      </div>
      <div id="qms-ir-detail-alert"></div>
    `;

    box.querySelectorAll('[data-qms-ir-transition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await qmsFetch('/inspection-requests/transition', {
            method: 'POST', body: { id: r.id, to_status: btn.dataset.qmsIrTransition },
          });
          qmsIrShowDetail(id);
        } catch (e) {
          qmsAlert(document.getElementById('qms-ir-detail-alert'), 'error', e.message);
        }
      });
    });

    document.getElementById('qms-ir-record-result')?.addEventListener('click', async () => {
      const result = prompt('نتيجة الفحص (accepted / conditional / rejected):', 'accepted');
      if (!result) return;
      const inspectedBy = prompt('اسم الفاحص:') || null;
      try {
        await qmsFetch('/inspection-requests/record-result', {
          method: 'POST', body: { id: r.id, result, inspected_by: inspectedBy },
        });
        qmsIrShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-ir-detail-alert'), 'error', e.message);
      }
    });

    document.getElementById('qms-ir-sign')?.addEventListener('click', async () => {
      const party = prompt('الطرف الموقّع (المقاول/الاستشاري/المالك):');
      if (!party) return;
      const name = prompt('اسم الموقّع:');
      if (!name) return;
      try {
        await qmsFetch('/inspection-requests/sign', { method: 'POST', body: { id: r.id, party, name } });
        qmsIrShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-ir-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsIrDelete(id) {
  if (!confirm('هل أنت متأكد من حذف طلب الفحص هذا؟')) return;
  try {
    await qmsFetch('/inspection-requests/delete', { method: 'POST', body: { id } });
    qmsLoadIrTable();
  } catch (e) {
    alert(e.message);
  }
}
