// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (Quality Management System - QMS)
// الجزء 3/4: حالات عدم المطابقة (NCR) + الإجراءات التصحيحية والوقائية (CAPA)
// يعتمد على الدوال المساعدة العامة (qmsFetch, qmsAlert, qmsEsc, ...) من qms.js
// ============================================================

let QMS3_REF = null;
let qmsNcrEditingId = null;
let qmsCapaEditingId = null;

async function qms3EnsureRefData() {
  if (QMS3_REF) return QMS3_REF;
  const res = await qmsFetch('/part3/reference-data');
  QMS3_REF = res.data;
  return QMS3_REF;
}

function qmsNcrStatusTag(status) {
  const map = {
    open: 'tag-bad', in_progress: 'tag-info', pending_verification: 'tag-info',
    closed: 'tag-ok', rejected: 'tag-bad',
  };
  return map[status] || 'tag-info';
}
function qmsNcrSeverityTag(severity) {
  const map = { minor: 'tag-info', major: 'tag-info', critical: 'tag-bad' };
  return map[severity] || 'tag-info';
}
function qmsCapaStatusTag(status) {
  const map = {
    open: 'tag-bad', plan_approved: 'tag-info', in_progress: 'tag-info',
    verified: 'tag-info', closed: 'tag-ok',
  };
  return map[status] || 'tag-info';
}

// ================================================================
// حالات عدم المطابقة (NCR)
// ================================================================

document.querySelector('[data-panel="qms-ncr"]')?.addEventListener('click', async () => {
  await qms3EnsureRefData();
  qmsNcrShowListView();
  qmsLoadNcrTable();
});

function qmsNcrShowListView() {
  document.getElementById('qms-ncr-list-view').style.display = '';
  document.getElementById('qms-ncr-form-view').style.display = 'none';
  document.getElementById('qms-ncr-detail-view').style.display = 'none';
}

async function qmsLoadNcrTable() {
  const ref = await qms3EnsureRefData();
  const tbody = document.getElementById('qms-ncr-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-ncr-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.ncr_statuses, ref.ncr_status_labels);
  }
  const severityFilter = document.getElementById('qms-ncr-filter-severity');
  if (severityFilter && severityFilter.options.length <= 1) {
    severityFilter.innerHTML += qmsOptionsHTML(ref.ncr_severities, ref.ncr_severity_labels);
  }

  try {
    const res = await qmsFetch('/ncrs', {
      query: {
        search: document.getElementById('qms-ncr-search')?.value || null,
        status: statusFilter?.value || null,
        severity: severityFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد حالات عدم مطابقة مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(n => `
      <tr>
        <td>${n.code}</td>
        <td>${qmsEsc(n.project_id)}</td>
        <td>${qmsEsc(n.element)}</td>
        <td><span class="tag ${qmsNcrSeverityTag(n.severity)}">${ref.ncr_severity_labels[n.severity] || n.severity}</span></td>
        <td><span class="tag ${qmsNcrStatusTag(n.status)}">${ref.ncr_status_labels[n.status] || n.status}</span></td>
        <td>${qmsFmtDate(n.created_at)}</td>
        <td>
          <button class="pm-link-btn" data-qms-ncr-view="${n.id}">عرض</button>
          ${!['closed', 'rejected'].includes(n.status) ? `<button class="pm-link-btn" data-qms-ncr-edit="${n.id}">تعديل</button>` : ''}
          ${n.status === 'open' ? `<button class="pm-link-btn pm-mini-btn-danger" data-qms-ncr-delete="${n.id}">حذف</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qms-ncr-view]').forEach(b => b.addEventListener('click', () => qmsNcrShowDetail(b.dataset.qmsNcrView)));
    tbody.querySelectorAll('[data-qms-ncr-edit]').forEach(b => b.addEventListener('click', () => qmsNcrShowForm(b.dataset.qmsNcrEdit)));
    tbody.querySelectorAll('[data-qms-ncr-delete]').forEach(b => b.addEventListener('click', () => qmsNcrDelete(b.dataset.qmsNcrDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-ncr-search')?.addEventListener('input', debounceQms(() => qmsLoadNcrTable(), 300));
document.getElementById('qms-ncr-filter-status')?.addEventListener('change', () => qmsLoadNcrTable());
document.getElementById('qms-ncr-filter-severity')?.addEventListener('change', () => qmsLoadNcrTable());
document.getElementById('qms-ncr-btn-new')?.addEventListener('click', () => qmsNcrShowForm(null));
document.getElementById('qms-ncr-btn-back-from-detail')?.addEventListener('click', () => { qmsNcrShowListView(); qmsLoadNcrTable(); });

async function qmsNcrShowForm(id) {
  const ref = await qms3EnsureRefData();
  qmsNcrEditingId = id;

  document.getElementById('qms-ncr-list-view').style.display = 'none';
  document.getElementById('qms-ncr-detail-view').style.display = 'none';
  document.getElementById('qms-ncr-form-view').style.display = '';
  document.getElementById('qms-ncr-form-alert').innerHTML = '';

  document.getElementById('qms-ncr-f-discipline').innerHTML = qmsOptionsHTML(ref.ncr_disciplines, ref.ncr_discipline_labels);
  document.getElementById('qms-ncr-f-severity').innerHTML = qmsOptionsHTML(ref.ncr_severities, ref.ncr_severity_labels);

  const ids = ['project', 'element', 'location', 'violation-type', 'responsible-party', 'ir-id', 'description', 'root-cause'];
  ids.forEach(k => { const el = document.getElementById(`qms-ncr-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/ncrs/get', { query: { id } });
      const n = res.data;
      document.getElementById('qms-ncr-f-project').value = n.project_id || '';
      document.getElementById('qms-ncr-f-element').value = n.element || '';
      document.getElementById('qms-ncr-f-location').value = n.location || '';
      document.getElementById('qms-ncr-f-discipline').value = n.discipline || 'other';
      document.getElementById('qms-ncr-f-violation-type').value = n.violation_type || '';
      document.getElementById('qms-ncr-f-severity').value = n.severity || 'minor';
      document.getElementById('qms-ncr-f-responsible-party').value = n.responsible_party || '';
      document.getElementById('qms-ncr-f-ir-id').value = n.ir_id || '';
      document.getElementById('qms-ncr-f-description').value = n.description || '';
      document.getElementById('qms-ncr-f-root-cause').value = n.root_cause || '';
      document.getElementById('qms-ncr-f-project').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-ncr-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-ncr-f-project').disabled = false;
  }
  document.getElementById('qms-ncr-form-title').textContent = id ? 'تعديل حالة عدم المطابقة' : 'حالة عدم مطابقة جديدة (NCR)';
}

document.getElementById('qms-ncr-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-ncr-form-alert');
  const payload = {
    project_id: document.getElementById('qms-ncr-f-project').value.trim(),
    element: document.getElementById('qms-ncr-f-element').value.trim(),
    location: document.getElementById('qms-ncr-f-location').value.trim() || null,
    discipline: document.getElementById('qms-ncr-f-discipline').value,
    violation_type: document.getElementById('qms-ncr-f-violation-type').value.trim() || null,
    severity: document.getElementById('qms-ncr-f-severity').value,
    responsible_party: document.getElementById('qms-ncr-f-responsible-party').value.trim() || null,
    ir_id: document.getElementById('qms-ncr-f-ir-id').value.trim() || null,
    description: document.getElementById('qms-ncr-f-description').value.trim(),
    root_cause: document.getElementById('qms-ncr-f-root-cause').value.trim() || null,
  };

  try {
    if (qmsNcrEditingId) {
      await qmsFetch('/ncrs/update', { method: 'POST', body: { id: qmsNcrEditingId, ...payload } });
    } else {
      await qmsFetch('/ncrs', { method: 'POST', body: payload });
    }
    qmsNcrShowListView();
    qmsLoadNcrTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-ncr-form-cancel')?.addEventListener('click', () => { qmsNcrShowListView(); qmsLoadNcrTable(); });

async function qmsNcrShowDetail(id) {
  document.getElementById('qms-ncr-list-view').style.display = 'none';
  document.getElementById('qms-ncr-form-view').style.display = 'none';
  document.getElementById('qms-ncr-detail-view').style.display = '';
  const box = document.getElementById('qms-ncr-detail-box');
  const ref = await qms3EnsureRefData();

  try {
    const res = await qmsFetch('/ncrs/get', { query: { id } });
    const n = res.data;
    const nextActions = (ref.ncr_allowed_transitions[n.status] || []);

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${n.code} — ${qmsEsc(n.element)}</h3>
        <span class="tag ${qmsNcrStatusTag(n.status)}">${ref.ncr_status_labels[n.status] || n.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(n.project_id)}</div>
        <div><b>الموقع:</b> ${qmsEsc(n.location || '—')}</div>
        <div><b>التخصص:</b> ${ref.ncr_discipline_labels[n.discipline] || n.discipline}</div>
        <div><b>نوع المخالفة:</b> ${qmsEsc(n.violation_type || '—')}</div>
        <div><b>درجة الخطورة:</b> <span class="tag ${qmsNcrSeverityTag(n.severity)}">${ref.ncr_severity_labels[n.severity] || n.severity}</span></div>
        <div><b>المسؤول:</b> ${qmsEsc(n.responsible_party || '—')}</div>
        <div><b>طلب الفحص المرتبط:</b> ${qmsEsc(n.ir_id || '—')}</div>
        <div><b>تاريخ الإنشاء:</b> ${qmsFmtDateTime(n.created_at)}</div>
        <div><b>تاريخ الإغلاق:</b> ${qmsFmtDateTime(n.closed_at)}</div>
      </div>
      <div class="pm-detail-block">
        <h4>وصف المخالفة</h4>
        <p>${qmsEsc(n.description) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>السبب الجذري</h4>
        <p>${qmsEsc(n.root_cause) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>الإجراءات التصحيحية/الوقائية المرتبطة (CAPA)</h4>
        ${n.capas && n.capas.length ? `
          <table class="data-table">
            <thead><tr><th>الكود</th><th>النوع</th><th>المسؤول</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              ${n.capas.map(c => `
                <tr>
                  <td>${c.code}</td>
                  <td>${qmsEsc(c.type)}</td>
                  <td>${qmsEsc(c.responsible_person)}</td>
                  <td><span class="tag ${qmsCapaStatusTag(c.status)}">${c.status}</span></td>
                  <td><button class="pm-link-btn" data-qms-ncr-view-capa="${c.id}">عرض</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="pm-empty-state">لا توجد إجراءات مرتبطة بعد</div>'}
        ${!['closed', 'rejected'].includes(n.status) ? `<button class="btn btn-outline" id="qms-ncr-add-capa" style="margin-top:8px">+ إضافة إجراء تصحيحي/وقائي</button>` : ''}
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${n.change_log.map(c => `<li>${qmsFmtDateTime(c.ts)} — ${qmsEsc(c.action)} ${c.by ? `(${qmsEsc(c.by)})` : ''}</li>`).join('')}</ul>
      </div>

      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${nextActions.includes('in_progress') ? `<button class="btn btn-outline" data-qms-ncr-transition="in_progress">بدء المعالجة</button>` : ''}
        ${nextActions.includes('pending_verification') ? `<button class="btn btn-outline" data-qms-ncr-transition="pending_verification">تعليق للتحقق</button>` : ''}
        ${nextActions.includes('closed') ? `<button class="btn btn-primary" data-qms-ncr-transition="closed">إغلاق الحالة</button>` : ''}
        ${nextActions.includes('rejected') ? `<button class="btn btn-outline pm-mini-btn-danger" data-qms-ncr-transition="rejected">رفض الحالة</button>` : ''}
      </div>
      <div id="qms-ncr-detail-alert"></div>
    `;

    box.querySelectorAll('[data-qms-ncr-transition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const by = prompt('اسم المسؤول عن هذا الإجراء:') || null;
        try {
          await qmsFetch('/ncrs/transition', {
            method: 'POST', body: { id: n.id, to_status: btn.dataset.qmsNcrTransition, by },
          });
          qmsNcrShowDetail(id);
        } catch (e) {
          qmsAlert(document.getElementById('qms-ncr-detail-alert'), 'error', e.message);
        }
      });
    });

    box.querySelectorAll('[data-qms-ncr-view-capa]').forEach(btn => {
      btn.addEventListener('click', () => qmsCapaShowDetailFromPanel(btn.dataset.qmsNcrViewCapa, 'qms-ncr'));
    });

    document.getElementById('qms-ncr-add-capa')?.addEventListener('click', () => {
      qmsCapaShowForm(null, { presetNcrId: n.id, presetProjectId: n.project_id, returnTo: () => qmsNcrShowDetail(id) });
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsNcrDelete(id) {
  if (!confirm('هل أنت متأكد من حذف حالة عدم المطابقة هذه؟')) return;
  try {
    await qmsFetch('/ncrs/delete', { method: 'POST', body: { id } });
    qmsLoadNcrTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// الإجراءات التصحيحية والوقائية (CAPA)
// ================================================================

let qmsCapaFormReturnTo = null;

document.querySelector('[data-panel="qms-capa"]')?.addEventListener('click', async () => {
  await qms3EnsureRefData();
  qmsCapaShowListView();
  qmsLoadCapaTable();
});

function qmsCapaShowListView() {
  document.getElementById('qms-capa-list-view').style.display = '';
  document.getElementById('qms-capa-form-view').style.display = 'none';
  document.getElementById('qms-capa-detail-view').style.display = 'none';
}

async function qmsLoadCapaTable() {
  const ref = await qms3EnsureRefData();
  const tbody = document.getElementById('qms-capa-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-capa-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.capa_statuses, ref.capa_status_labels);
  }
  const typeFilter = document.getElementById('qms-capa-filter-type');
  if (typeFilter && typeFilter.options.length <= 1) {
    typeFilter.innerHTML += qmsOptionsHTML(ref.capa_types, ref.capa_type_labels);
  }

  try {
    const res = await qmsFetch('/capas', {
      query: {
        search: document.getElementById('qms-capa-search')?.value || null,
        status: statusFilter?.value || null,
        type: typeFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد إجراءات تصحيحية/وقائية مسجّلة</td></tr>`;
      return;
    }
    const now = new Date();
    tbody.innerHTML = items.map(c => {
      const overdue = c.status !== 'closed' && c.due_date && new Date(c.due_date) < now;
      return `
      <tr>
        <td>${c.code}</td>
        <td>${qmsEsc(c.project_id)}</td>
        <td>${ref.capa_type_labels[c.type] || c.type}</td>
        <td>${qmsEsc(c.responsible_person)}</td>
        <td>${qmsFmtDate(c.due_date)} ${overdue ? '<span class="tag tag-bad">متأخر</span>' : ''}</td>
        <td><span class="tag ${qmsCapaStatusTag(c.status)}">${ref.capa_status_labels[c.status] || c.status}</span></td>
        <td>
          <button class="pm-link-btn" data-qms-capa-view="${c.id}">عرض</button>
          ${c.status !== 'closed' ? `<button class="pm-link-btn" data-qms-capa-edit="${c.id}">تعديل</button>` : ''}
          ${c.status === 'open' ? `<button class="pm-link-btn pm-mini-btn-danger" data-qms-capa-delete="${c.id}">حذف</button>` : ''}
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('[data-qms-capa-view]').forEach(b => b.addEventListener('click', () => qmsCapaShowDetail(b.dataset.qmsCapaView)));
    tbody.querySelectorAll('[data-qms-capa-edit]').forEach(b => b.addEventListener('click', () => qmsCapaShowForm(b.dataset.qmsCapaEdit)));
    tbody.querySelectorAll('[data-qms-capa-delete]').forEach(b => b.addEventListener('click', () => qmsCapaDelete(b.dataset.qmsCapaDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-capa-search')?.addEventListener('input', debounceQms(() => qmsLoadCapaTable(), 300));
document.getElementById('qms-capa-filter-status')?.addEventListener('change', () => qmsLoadCapaTable());
document.getElementById('qms-capa-filter-type')?.addEventListener('change', () => qmsLoadCapaTable());
document.getElementById('qms-capa-btn-new')?.addEventListener('click', () => qmsCapaShowForm(null));
document.getElementById('qms-capa-btn-back-from-detail')?.addEventListener('click', () => { qmsCapaShowListView(); qmsLoadCapaTable(); });

async function qmsCapaShowForm(id, { presetNcrId = null, presetProjectId = null, returnTo = null } = {}) {
  const ref = await qms3EnsureRefData();
  qmsCapaEditingId = id;
  qmsCapaFormReturnTo = returnTo;

  document.getElementById('qms-capa-list-view').style.display = 'none';
  document.getElementById('qms-capa-detail-view').style.display = 'none';
  document.getElementById('qms-capa-form-view').style.display = '';
  document.getElementById('qms-capa-form-alert').innerHTML = '';

  document.getElementById('qms-capa-f-type').innerHTML = qmsOptionsHTML(ref.capa_types, ref.capa_type_labels);

  const ids = ['project', 'ncr-id', 'responsible-person', 'due-date', 'action-description', 'root-cause', 'action-plan'];
  ids.forEach(k => { const el = document.getElementById(`qms-capa-f-${k}`); if (el) el.value = ''; });

  if (presetNcrId) document.getElementById('qms-capa-f-ncr-id').value = presetNcrId;
  if (presetProjectId) document.getElementById('qms-capa-f-project').value = presetProjectId;

  if (id) {
    try {
      const res = await qmsFetch('/capas/get', { query: { id } });
      const c = res.data;
      document.getElementById('qms-capa-f-project').value = c.project_id || '';
      document.getElementById('qms-capa-f-ncr-id').value = c.ncr_id || '';
      document.getElementById('qms-capa-f-type').value = c.type || 'corrective';
      document.getElementById('qms-capa-f-responsible-person').value = c.responsible_person || '';
      document.getElementById('qms-capa-f-due-date').value = qmsFmtDate(c.due_date) === '—' ? '' : qmsFmtDate(c.due_date);
      document.getElementById('qms-capa-f-action-description').value = c.action_description || '';
      document.getElementById('qms-capa-f-root-cause').value = c.root_cause || '';
      document.getElementById('qms-capa-f-action-plan').value = c.action_plan || '';
      document.getElementById('qms-capa-f-project').disabled = true;
      document.getElementById('qms-capa-f-ncr-id').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-capa-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-capa-f-project').disabled = !!presetProjectId;
    document.getElementById('qms-capa-f-ncr-id').disabled = !!presetNcrId;
  }
  document.getElementById('qms-capa-form-title').textContent = id ? 'تعديل الإجراء' : 'إجراء تصحيحي/وقائي جديد (CAPA)';
}

document.getElementById('qms-capa-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-capa-form-alert');
  const payload = {
    project_id: document.getElementById('qms-capa-f-project').value.trim(),
    ncr_id: document.getElementById('qms-capa-f-ncr-id').value.trim() || null,
    type: document.getElementById('qms-capa-f-type').value,
    responsible_person: document.getElementById('qms-capa-f-responsible-person').value.trim(),
    action_description: document.getElementById('qms-capa-f-action-description').value.trim(),
    root_cause: document.getElementById('qms-capa-f-root-cause').value.trim() || null,
    action_plan: document.getElementById('qms-capa-f-action-plan').value.trim() || null,
  };
  const dueDate = document.getElementById('qms-capa-f-due-date').value;
  if (dueDate) payload.due_date = dueDate;

  try {
    if (qmsCapaEditingId) {
      await qmsFetch('/capas/update', { method: 'POST', body: { id: qmsCapaEditingId, ...payload } });
    } else {
      await qmsFetch('/capas', { method: 'POST', body: payload });
    }
    const returnTo = qmsCapaFormReturnTo;
    qmsCapaFormReturnTo = null;
    if (returnTo) {
      returnTo();
    } else {
      qmsCapaShowListView();
      qmsLoadCapaTable();
    }
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-capa-form-cancel')?.addEventListener('click', () => {
  const returnTo = qmsCapaFormReturnTo;
  qmsCapaFormReturnTo = null;
  if (returnTo) { returnTo(); } else { qmsCapaShowListView(); qmsLoadCapaTable(); }
});

async function qmsCapaShowDetail(id) {
  document.getElementById('qms-capa-list-view').style.display = 'none';
  document.getElementById('qms-capa-form-view').style.display = 'none';
  document.getElementById('qms-capa-detail-view').style.display = '';
  await qmsCapaRenderDetail(id, document.getElementById('qms-capa-detail-box'), () => qmsCapaShowDetail(id));
}

// عرض تفاصيل CAPA من داخل لوحة NCR دون تغيير اللوحة النشطة، مع إمكانية الرجوع
async function qmsCapaShowDetailFromPanel(id, returnPanel) {
  document.getElementById('qms-capa-list-view').style.display = 'none';
  document.getElementById('qms-capa-form-view').style.display = 'none';
  document.getElementById('qms-capa-detail-view').style.display = '';
  document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-qms-capa').classList.add('active');
  await qmsCapaRenderDetail(id, document.getElementById('qms-capa-detail-box'), () => qmsCapaShowDetailFromPanel(id, returnPanel));
}

async function qmsCapaRenderDetail(id, box, refreshSelf) {
  const ref = await qms3EnsureRefData();
  try {
    const res = await qmsFetch('/capas/get', { query: { id } });
    const c = res.data;
    const nextActions = (ref.capa_allowed_transitions[c.status] || []);

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${c.code} — ${ref.capa_type_labels[c.type] || c.type}</h3>
        <span class="tag ${qmsCapaStatusTag(c.status)}">${ref.capa_status_labels[c.status] || c.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(c.project_id)}</div>
        <div><b>NCR المرتبطة:</b> ${c.ncr ? `${qmsEsc(c.ncr.code)} — ${qmsEsc(c.ncr.element)}` : '—'}</div>
        <div><b>المسؤول عن التنفيذ:</b> ${qmsEsc(c.responsible_person)}</div>
        <div><b>تاريخ الاستحقاق:</b> ${qmsFmtDate(c.due_date)}</div>
        <div><b>تم التحقق بواسطة:</b> ${qmsEsc(c.verified_by || '—')}</div>
        <div><b>تاريخ التحقق:</b> ${qmsFmtDateTime(c.verified_at)}</div>
        <div><b>تقييم الفاعلية:</b> ${ref.capa_effectiveness_labels[c.effectiveness] || c.effectiveness}</div>
      </div>
      <div class="pm-detail-block">
        <h4>وصف الإجراء</h4>
        <p>${qmsEsc(c.action_description) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>السبب الجذري</h4>
        <p>${qmsEsc(c.root_cause) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>خطة المعالجة</h4>
        <p>${qmsEsc(c.action_plan) || '—'}</p>
      </div>
      ${c.verification_notes ? `<div class="pm-detail-block"><h4>ملاحظات التحقق</h4><p>${qmsEsc(c.verification_notes)}</p></div>` : ''}
      ${c.effectiveness_notes ? `<div class="pm-detail-block"><h4>ملاحظات تقييم الفاعلية</h4><p>${qmsEsc(c.effectiveness_notes)}</p></div>` : ''}
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${c.change_log.map(l => `<li>${qmsFmtDateTime(l.ts)} — ${qmsEsc(l.action)} ${l.by ? `(${qmsEsc(l.by)})` : ''}</li>`).join('')}</ul>
      </div>

      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${nextActions.includes('plan_approved') ? `<button class="btn btn-outline" data-qms-capa-transition="plan_approved">اعتماد خطة المعالجة</button>` : ''}
        ${nextActions.includes('in_progress') ? `<button class="btn btn-outline" data-qms-capa-transition="in_progress">بدء التنفيذ</button>` : ''}
        ${c.status === 'in_progress' ? `<button class="btn btn-primary" id="qms-capa-verify-btn">تسجيل التحقق من التنفيذ</button>` : ''}
        ${c.status === 'verified' ? `<button class="btn btn-primary" id="qms-capa-effectiveness-btn">تقييم الفاعلية وإغلاق الإجراء</button>` : ''}
      </div>
      <div id="qms-capa-detail-alert"></div>
    `;

    box.querySelectorAll('[data-qms-capa-transition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const by = prompt('اسم المسؤول عن هذا الإجراء:') || null;
        try {
          await qmsFetch('/capas/transition', {
            method: 'POST', body: { id: c.id, to_status: btn.dataset.qmsCapaTransition, by },
          });
          refreshSelf();
        } catch (e) {
          qmsAlert(document.getElementById('qms-capa-detail-alert'), 'error', e.message);
        }
      });
    });

    document.getElementById('qms-capa-verify-btn')?.addEventListener('click', async () => {
      const verifiedBy = prompt('اسم الجهة المتحقِّقة من التنفيذ:');
      if (!verifiedBy) return;
      const notes = prompt('ملاحظات التحقق (اختياري):') || '';
      try {
        await qmsFetch('/capas/verify', { method: 'POST', body: { id: c.id, verified_by: verifiedBy, notes } });
        refreshSelf();
      } catch (e) {
        qmsAlert(document.getElementById('qms-capa-detail-alert'), 'error', e.message);
      }
    });

    document.getElementById('qms-capa-effectiveness-btn')?.addEventListener('click', async () => {
      const effectiveness = prompt('تقييم الفاعلية (effective / partially_effective / ineffective):', 'effective');
      if (!effectiveness) return;
      const evaluatedBy = prompt('اسم المُقيِّم:') || null;
      const notes = prompt('ملاحظات التقييم (اختياري):') || '';
      try {
        await qmsFetch('/capas/evaluate-effectiveness', {
          method: 'POST', body: { id: c.id, effectiveness, evaluated_by: evaluatedBy, notes },
        });
        refreshSelf();
      } catch (e) {
        qmsAlert(document.getElementById('qms-capa-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsCapaDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الإجراء؟')) return;
  try {
    await qmsFetch('/capas/delete', { method: 'POST', body: { id } });
    qmsLoadCapaTable();
  } catch (e) {
    alert(e.message);
  }
}
