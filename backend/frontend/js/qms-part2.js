// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (Quality Management System - QMS)
// الجزء 2/4: اختبارات المواد + إدارة المختبر (مختبرات/فنيون/أجهزة) +
//            نقاط الفحص (Inspection Test Plan - ITP)
// يعتمد على الدوال المساعدة العامة (qmsFetch, qmsAlert, qmsEsc, ...) من qms.js
// ============================================================

let QMS2_REF = null;
let qmsTestEditingId = null;
let qmsLabEditingId = null;
let qmsEquipEditingId = null;
let qmsItpEditingId = null;

async function qms2EnsureRefData() {
  if (QMS2_REF) return QMS2_REF;
  const res = await qmsFetch('/part2/reference-data');
  QMS2_REF = res.data;
  return QMS2_REF;
}

function qmsTestStatusTag(status) {
  const map = { pending: 'tag-info', in_progress: 'tag-info', completed: 'tag-ok', cancelled: 'tag-bad' };
  return map[status] || 'tag-info';
}
function qmsTestResultTag(result) {
  const map = { pending: 'tag-info', pass: 'tag-ok', fail: 'tag-bad' };
  return map[result] || 'tag-info';
}
function qmsEquipStatusTag(status) {
  const map = { active: 'tag-ok', due_calibration: 'tag-info', out_of_service: 'tag-bad' };
  return map[status] || 'tag-info';
}
function qmsItpStatusTag(status) {
  const map = { pending: 'tag-info', passed: 'tag-ok', failed: 'tag-bad', waived: 'tag-info' };
  return map[status] || 'tag-info';
}

// ================================================================
// اختبارات المواد
// ================================================================

document.querySelector('[data-panel="qms-tests"]')?.addEventListener('click', async () => {
  await qms2EnsureRefData();
  qmsTestShowListView();
  qmsLoadTestTable();
});

function qmsTestShowListView() {
  document.getElementById('qms-test-list-view').style.display = '';
  document.getElementById('qms-test-form-view').style.display = 'none';
  document.getElementById('qms-test-detail-view').style.display = 'none';
}

async function qmsLoadTestTable() {
  const ref = await qms2EnsureRefData();
  const tbody = document.getElementById('qms-test-tbody');
  if (!tbody) return;

  const catFilter = document.getElementById('qms-test-filter-category');
  if (catFilter && catFilter.options.length <= 1) {
    catFilter.innerHTML += qmsOptionsHTML(ref.material_categories, ref.material_category_labels);
  }
  const statusFilter = document.getElementById('qms-test-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.material_test_statuses, ref.material_test_status_labels);
  }

  try {
    const res = await qmsFetch('/material-tests', {
      query: {
        search: document.getElementById('qms-test-search')?.value || null,
        materialCategory: catFilter?.value || null,
        status: statusFilter?.value || null,
      },
    });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(t => `
      <tr>
        <td>${t.code}</td>
        <td>${ref.material_category_labels[t.material_category] || t.material_category}</td>
        <td>${qmsEsc(t.test_type_label)}</td>
        <td>${qmsEsc(t.element || '—')}</td>
        <td><span class="tag ${qmsTestStatusTag(t.status)}">${ref.material_test_status_labels[t.status] || t.status}</span></td>
        <td><span class="tag ${qmsTestResultTag(t.result)}">${ref.material_test_result_labels[t.result] || t.result}</span></td>
        <td>
          <button class="btn-icon" data-qms-test-view="${t.id}">عرض</button>
          ${t.status === 'pending' || t.status === 'in_progress' ? `<button class="btn-icon" data-qms-test-edit="${t.id}">تعديل</button>` : ''}
          ${t.status !== 'completed' ? `<button class="btn-icon" data-qms-test-delete="${t.id}">حذف</button>` : ''}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد اختبارات مسجلة بعد</div></td></tr>`;

    tbody.querySelectorAll('[data-qms-test-view]').forEach(b => b.addEventListener('click', () => qmsTestShowDetail(b.dataset.qmsTestView)));
    tbody.querySelectorAll('[data-qms-test-edit]').forEach(b => b.addEventListener('click', () => qmsTestShowForm(b.dataset.qmsTestEdit)));
    tbody.querySelectorAll('[data-qms-test-delete]').forEach(b => b.addEventListener('click', () => qmsTestDelete(b.dataset.qmsTestDelete)));
  } catch (e) {
    qmsAlert(tbody, 'error', e.message);
  }
}
document.getElementById('qms-test-search')?.addEventListener('input', debounceQms(() => qmsLoadTestTable(), 300));
document.getElementById('qms-test-filter-category')?.addEventListener('change', () => qmsLoadTestTable());
document.getElementById('qms-test-filter-status')?.addEventListener('change', () => qmsLoadTestTable());
document.getElementById('qms-test-btn-new')?.addEventListener('click', () => qmsTestShowForm(null));
document.getElementById('qms-test-btn-back-from-detail')?.addEventListener('click', () => { qmsTestShowListView(); qmsLoadTestTable(); });

async function qmsTestShowForm(id) {
  const ref = await qms2EnsureRefData();
  qmsTestEditingId = id;

  document.getElementById('qms-test-list-view').style.display = 'none';
  document.getElementById('qms-test-detail-view').style.display = 'none';
  document.getElementById('qms-test-form-view').style.display = '';
  document.getElementById('qms-test-form-alert').innerHTML = '';

  const catSelect = document.getElementById('qms-test-f-category');
  catSelect.innerHTML = qmsOptionsHTML(ref.material_categories, ref.material_category_labels, { placeholder: 'اختر الفئة' });

  const refreshTestTypes = () => {
    const cat = catSelect.value;
    const typeSelect = document.getElementById('qms-test-f-type');
    const types = ref.test_types_by_category[cat] || [];
    typeSelect.innerHTML = types.map(t => `<option value="${t.code}">${t.label} (${t.unit})</option>`).join('');
  };
  catSelect.onchange = refreshTestTypes;

  const labSelect = document.getElementById('qms-test-f-lab');
  try {
    const labsRes = await qmsFetch('/labs', {});
    labSelect.innerHTML = `<option value="">— بدون مختبر محدد —</option>` + labsRes.data.map(l => `<option value="${l.id}">${qmsEsc(l.name)}</option>`).join('');
  } catch (e) { /* تجاهل خطأ تحميل المختبرات في هذه المرحلة */ }

  const ids = ['project', 'element', 'location', 'sample-reference', 'sample-date', 'acceptance-criteria', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-test-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/material-tests/get', { query: { id } });
      const t = res.data;
      catSelect.value = t.material_category;
      refreshTestTypes();
      document.getElementById('qms-test-f-type').value = t.test_type;
      document.getElementById('qms-test-f-project').value = t.project_id || '';
      document.getElementById('qms-test-f-element').value = t.element || '';
      document.getElementById('qms-test-f-location').value = t.location || '';
      document.getElementById('qms-test-f-sample-reference').value = t.sample_reference || '';
      document.getElementById('qms-test-f-sample-date').value = qmsFmtDate(t.sample_date);
      document.getElementById('qms-test-f-acceptance-criteria').value = t.acceptance_criteria || '';
      document.getElementById('qms-test-f-notes').value = t.notes || '';
      labSelect.value = t.lab_id || '';
      document.getElementById('qms-test-f-project').disabled = true;
      catSelect.disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-test-form-alert'), 'error', e.message);
    }
  } else {
    refreshTestTypes();
    document.getElementById('qms-test-f-project').disabled = false;
    catSelect.disabled = false;
  }
  document.getElementById('qms-test-form-title').textContent = id ? 'تعديل اختبار المادة' : 'اختبار مادة جديد';
}

document.getElementById('qms-test-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-test-form-alert');
  const payload = {
    project_id: document.getElementById('qms-test-f-project').value.trim(),
    material_category: document.getElementById('qms-test-f-category').value,
    test_type: document.getElementById('qms-test-f-type').value,
    element: document.getElementById('qms-test-f-element').value.trim() || null,
    location: document.getElementById('qms-test-f-location').value.trim() || null,
    sample_reference: document.getElementById('qms-test-f-sample-reference').value.trim() || null,
    lab_id: document.getElementById('qms-test-f-lab').value || null,
    acceptance_criteria: document.getElementById('qms-test-f-acceptance-criteria').value.trim() || null,
    notes: document.getElementById('qms-test-f-notes').value.trim(),
  };
  const sampleDate = document.getElementById('qms-test-f-sample-date').value;
  if (sampleDate) payload.sample_date = sampleDate;

  try {
    if (qmsTestEditingId) {
      await qmsFetch('/material-tests/update', { method: 'POST', body: { id: qmsTestEditingId, ...payload } });
    } else {
      await qmsFetch('/material-tests', { method: 'POST', body: payload });
    }
    qmsTestShowListView();
    qmsLoadTestTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-test-form-cancel')?.addEventListener('click', () => { qmsTestShowListView(); qmsLoadTestTable(); });

async function qmsTestShowDetail(id) {
  document.getElementById('qms-test-list-view').style.display = 'none';
  document.getElementById('qms-test-form-view').style.display = 'none';
  document.getElementById('qms-test-detail-view').style.display = '';
  const box = document.getElementById('qms-test-detail-box');
  const ref = await qms2EnsureRefData();

  try {
    const res = await qmsFetch('/material-tests/get', { query: { id } });
    const t = res.data;

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${t.code} — ${qmsEsc(t.test_type_label)}</h3>
        <span class="tag ${qmsTestStatusTag(t.status)}">${ref.material_test_status_labels[t.status] || t.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(t.project_id)}</div>
        <div><b>فئة المادة:</b> ${ref.material_category_labels[t.material_category] || t.material_category}</div>
        <div><b>العنصر:</b> ${qmsEsc(t.element || '—')}</div>
        <div><b>الموقع:</b> ${qmsEsc(t.location || '—')}</div>
        <div><b>مرجع العينة:</b> ${qmsEsc(t.sample_reference || '—')}</div>
        <div><b>تاريخ أخذ العينة:</b> ${qmsFmtDate(t.sample_date)}</div>
        <div><b>تاريخ الاختبار:</b> ${qmsFmtDateTime(t.test_date)}</div>
        <div><b>معيار القبول:</b> ${qmsEsc(t.acceptance_criteria || '—')}</div>
        <div><b>القيمة المسجّلة:</b> ${t.result_value != null ? `${t.result_value} ${t.unit}` : '—'}</div>
        <div><b>النتيجة:</b> <span class="tag ${qmsTestResultTag(t.result)}">${ref.material_test_result_labels[t.result] || t.result}</span></div>
      </div>
      <div class="pm-detail-block">
        <h4>الملاحظات</h4>
        <p>${qmsEsc(t.notes) || '—'}</p>
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${t.change_log.map(c => `<li>${qmsFmtDateTime(c.ts)} — ${qmsEsc(c.action)} ${c.by ? `(${qmsEsc(c.by)})` : ''}</li>`).join('')}</ul>
      </div>
      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${(t.status === 'pending' || t.status === 'in_progress') ? `<button class="btn btn-primary" id="qms-test-record-result">تسجيل نتيجة الاختبار</button>` : ''}
        ${(t.status === 'pending' || t.status === 'in_progress') ? `<button class="btn btn-outline" id="qms-test-cancel-btn">إلغاء الاختبار</button>` : ''}
      </div>
      <div id="qms-test-detail-alert"></div>
    `;

    document.getElementById('qms-test-record-result')?.addEventListener('click', async () => {
      const val = prompt(`القيمة المقاسة (${t.unit}) — اتركها فارغة لإدخال النتيجة يدوياً:`);
      let payload = { tested_by: prompt('اسم الفني:') || null };
      if (val !== null && val.trim() !== '') {
        payload.result_value = Number(val);
      } else {
        const manual = prompt('النتيجة يدوياً (pass / fail):');
        if (!manual) return;
        payload.result = manual;
      }
      try {
        await qmsFetch('/material-tests/record-result', { method: 'POST', body: { id: t.id, ...payload } });
        qmsTestShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-test-detail-alert'), 'error', e.message);
      }
    });

    document.getElementById('qms-test-cancel-btn')?.addEventListener('click', async () => {
      const reason = prompt('سبب الإلغاء:') || '';
      try {
        await qmsFetch('/material-tests/cancel', { method: 'POST', body: { id: t.id, reason } });
        qmsTestShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-test-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsTestDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الاختبار؟')) return;
  try {
    await qmsFetch('/material-tests/delete', { method: 'POST', body: { id } });
    qmsLoadTestTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// إدارة المختبر: المختبرات + الفنيون + الأجهزة
// ================================================================

document.querySelector('[data-panel="qms-lab"]')?.addEventListener('click', async () => {
  await qms2EnsureRefData();
  qmsLoadLabsTable();
  qmsLoadTechniciansTable();
  qmsLoadEquipmentTable();
});

async function qmsLoadLabsTable() {
  const tbody = document.getElementById('qms-lab-tbody');
  if (!tbody) return;
  try {
    const res = await qmsFetch('/labs', { query: { search: document.getElementById('qms-lab-search')?.value || null } });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(l => `
      <tr>
        <td>${l.code}</td>
        <td>${qmsEsc(l.name)}</td>
        <td>${qmsEsc(l.accreditation_body || '—')}</td>
        <td>${qmsEsc(l.location || '—')}</td>
        <td>${l.is_external ? 'خارجي' : 'داخلي'}</td>
        <td>
          <button class="btn-icon" data-qms-lab-edit="${l.id}">تعديل</button>
          <button class="btn-icon" data-qms-lab-delete="${l.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6"><div class="pm-empty-state">لا توجد مختبرات مسجلة بعد</div></td></tr>`;

    tbody.querySelectorAll('[data-qms-lab-edit]').forEach(b => b.addEventListener('click', () => qmsLabShowForm(b.dataset.qmsLabEdit)));
    tbody.querySelectorAll('[data-qms-lab-delete]').forEach(b => b.addEventListener('click', () => qmsLabDelete(b.dataset.qmsLabDelete)));

    // تحديث قوائم المختبر المنسدلة في نماذج الفنيين والأجهزة
    const labOptions = `<option value="">— بدون مختبر —</option>` + items.map(l => `<option value="${l.id}">${qmsEsc(l.name)}</option>`).join('');
    const techLabSelect = document.getElementById('qms-tech-f-lab');
    if (techLabSelect) techLabSelect.innerHTML = labOptions;
    const eqLabSelect = document.getElementById('qms-equip-f-lab');
    if (eqLabSelect) eqLabSelect.innerHTML = labOptions;
  } catch (e) {
    qmsAlert(tbody, 'error', e.message);
  }
}
document.getElementById('qms-lab-search')?.addEventListener('input', debounceQms(() => qmsLoadLabsTable(), 300));
document.getElementById('qms-lab-btn-new')?.addEventListener('click', () => qmsLabShowForm(null));
document.getElementById('qms-lab-form-cancel')?.addEventListener('click', () => qmsLabHideForm());

function qmsLabHideForm() {
  document.getElementById('qms-lab-form-view').style.display = 'none';
}

async function qmsLabShowForm(id) {
  qmsLabEditingId = id;
  document.getElementById('qms-lab-form-view').style.display = '';
  document.getElementById('qms-lab-form-alert').innerHTML = '';
  const ids = ['name', 'accreditation-body', 'accreditation-number', 'location', 'contact-person', 'phone', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-lab-f-${k}`); if (el) el.value = ''; });
  document.getElementById('qms-lab-f-external').checked = false;

  if (id) {
    try {
      const res = await qmsFetch('/labs/get', { query: { id } });
      const l = res.data;
      document.getElementById('qms-lab-f-name').value = l.name || '';
      document.getElementById('qms-lab-f-accreditation-body').value = l.accreditation_body || '';
      document.getElementById('qms-lab-f-accreditation-number').value = l.accreditation_number || '';
      document.getElementById('qms-lab-f-location').value = l.location || '';
      document.getElementById('qms-lab-f-contact-person').value = l.contact_person || '';
      document.getElementById('qms-lab-f-phone').value = l.phone || '';
      document.getElementById('qms-lab-f-notes').value = l.notes || '';
      document.getElementById('qms-lab-f-external').checked = !!l.is_external;
    } catch (e) {
      qmsAlert(document.getElementById('qms-lab-form-alert'), 'error', e.message);
    }
  }
  document.getElementById('qms-lab-form-title').textContent = id ? 'تعديل بيانات المختبر' : 'مختبر جديد';
}

document.getElementById('qms-lab-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-lab-form-alert');
  const payload = {
    name: document.getElementById('qms-lab-f-name').value.trim(),
    accreditation_body: document.getElementById('qms-lab-f-accreditation-body').value.trim() || null,
    accreditation_number: document.getElementById('qms-lab-f-accreditation-number').value.trim() || null,
    location: document.getElementById('qms-lab-f-location').value.trim() || null,
    contact_person: document.getElementById('qms-lab-f-contact-person').value.trim() || null,
    phone: document.getElementById('qms-lab-f-phone').value.trim() || null,
    notes: document.getElementById('qms-lab-f-notes').value.trim(),
    is_external: document.getElementById('qms-lab-f-external').checked,
  };
  try {
    if (qmsLabEditingId) {
      await qmsFetch('/labs/update', { method: 'POST', body: { id: qmsLabEditingId, ...payload } });
    } else {
      await qmsFetch('/labs', { method: 'POST', body: payload });
    }
    qmsLabHideForm();
    qmsLoadLabsTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});

async function qmsLabDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المختبر؟')) return;
  try {
    await qmsFetch('/labs/delete', { method: 'POST', body: { id } });
    qmsLoadLabsTable();
  } catch (e) {
    alert(e.message);
  }
}

// ----- الفنيون -----

async function qmsLoadTechniciansTable() {
  const tbody = document.getElementById('qms-tech-tbody');
  if (!tbody) return;
  try {
    const res = await qmsFetch('/lab-technicians', {});
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(t => `
      <tr>
        <td>${qmsEsc(t.name)}</td>
        <td>${qmsEsc(t.qualification || '—')}</td>
        <td>${qmsEsc(t.certificate_number || '—')}</td>
        <td>${qmsFmtDate(t.certificate_expiry)}</td>
        <td>
          <button class="btn-icon" data-qms-tech-edit="${t.id}">تعديل</button>
          <button class="btn-icon" data-qms-tech-delete="${t.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا يوجد فنيون مسجلون بعد</div></td></tr>`;

    tbody.querySelectorAll('[data-qms-tech-edit]').forEach(b => b.addEventListener('click', () => qmsTechShowForm(b.dataset.qmsTechEdit)));
    tbody.querySelectorAll('[data-qms-tech-delete]').forEach(b => b.addEventListener('click', () => qmsTechDelete(b.dataset.qmsTechDelete)));
  } catch (e) {
    qmsAlert(tbody, 'error', e.message);
  }
}
document.getElementById('qms-tech-btn-new')?.addEventListener('click', () => qmsTechShowForm(null));
document.getElementById('qms-tech-form-cancel')?.addEventListener('click', () => { document.getElementById('qms-tech-form-view').style.display = 'none'; });

async function qmsTechShowForm(id) {
  qmsTestEditingId = null;
  document.getElementById('qms-tech-form-view').style.display = '';
  document.getElementById('qms-tech-form-alert').innerHTML = '';
  const ids = ['name', 'qualification', 'certificate-number', 'certificate-expiry', 'phone'];
  ids.forEach(k => { const el = document.getElementById(`qms-tech-f-${k}`); if (el) el.value = ''; });
  document.getElementById('qms-tech-form-view').dataset.editingId = id || '';

  if (id) {
    const res = await qmsFetch('/lab-technicians', {});
    const t = res.data.find(x => x.id === id);
    if (t) {
      document.getElementById('qms-tech-f-name').value = t.name || '';
      document.getElementById('qms-tech-f-lab').value = t.lab_id || '';
      document.getElementById('qms-tech-f-qualification').value = t.qualification || '';
      document.getElementById('qms-tech-f-certificate-number').value = t.certificate_number || '';
      document.getElementById('qms-tech-f-certificate-expiry').value = qmsFmtDate(t.certificate_expiry);
      document.getElementById('qms-tech-f-phone').value = t.phone || '';
    }
  }
  document.getElementById('qms-tech-form-title').textContent = id ? 'تعديل بيانات الفني' : 'فني مختبر جديد';
}

document.getElementById('qms-tech-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-tech-form-alert');
  const editingId = document.getElementById('qms-tech-form-view').dataset.editingId || null;
  const payload = {
    name: document.getElementById('qms-tech-f-name').value.trim(),
    lab_id: document.getElementById('qms-tech-f-lab').value || null,
    qualification: document.getElementById('qms-tech-f-qualification').value.trim() || null,
    certificate_number: document.getElementById('qms-tech-f-certificate-number').value.trim() || null,
    certificate_expiry: document.getElementById('qms-tech-f-certificate-expiry').value || null,
    phone: document.getElementById('qms-tech-f-phone').value.trim() || null,
  };
  try {
    if (editingId) {
      await qmsFetch('/lab-technicians/update', { method: 'POST', body: { id: editingId, ...payload } });
    } else {
      await qmsFetch('/lab-technicians', { method: 'POST', body: payload });
    }
    document.getElementById('qms-tech-form-view').style.display = 'none';
    qmsLoadTechniciansTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});

async function qmsTechDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الفني؟')) return;
  try {
    await qmsFetch('/lab-technicians/delete', { method: 'POST', body: { id } });
    qmsLoadTechniciansTable();
  } catch (e) {
    alert(e.message);
  }
}

// ----- الأجهزة والمعايرة -----

async function qmsLoadEquipmentTable() {
  const ref = await qms2EnsureRefData();
  const tbody = document.getElementById('qms-equip-tbody');
  if (!tbody) return;
  try {
    const res = await qmsFetch('/lab-equipment', {});
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(eq => `
      <tr>
        <td>${eq.code}</td>
        <td>${qmsEsc(eq.name)}</td>
        <td>${qmsEsc(eq.serial_number || '—')}</td>
        <td>${qmsFmtDate(eq.last_calibration_date)}</td>
        <td>${qmsFmtDate(eq.next_calibration_date)}</td>
        <td><span class="tag ${qmsEquipStatusTag(eq.status)}">${ref.lab_equipment_status_labels[eq.status] || eq.status}</span></td>
        <td>
          <button class="btn-icon" data-qms-equip-calibrate="${eq.id}">تسجيل معايرة</button>
          <button class="btn-icon" data-qms-equip-edit="${eq.id}">تعديل</button>
          <button class="btn-icon" data-qms-equip-delete="${eq.id}">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد أجهزة مسجلة بعد</div></td></tr>`;

    tbody.querySelectorAll('[data-qms-equip-edit]').forEach(b => b.addEventListener('click', () => qmsEquipShowForm(b.dataset.qmsEquipEdit)));
    tbody.querySelectorAll('[data-qms-equip-delete]').forEach(b => b.addEventListener('click', () => qmsEquipDelete(b.dataset.qmsEquipDelete)));
    tbody.querySelectorAll('[data-qms-equip-calibrate]').forEach(b => b.addEventListener('click', () => qmsEquipCalibrate(b.dataset.qmsEquipCalibrate)));
  } catch (e) {
    qmsAlert(tbody, 'error', e.message);
  }
}
document.getElementById('qms-equip-btn-new')?.addEventListener('click', () => qmsEquipShowForm(null));
document.getElementById('qms-equip-form-cancel')?.addEventListener('click', () => { document.getElementById('qms-equip-form-view').style.display = 'none'; });

async function qmsEquipShowForm(id) {
  document.getElementById('qms-equip-form-view').style.display = '';
  document.getElementById('qms-equip-form-alert').innerHTML = '';
  const ids = ['name', 'serial-number', 'last-calibration-date', 'next-calibration-date', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-equip-f-${k}`); if (el) el.value = ''; });
  document.getElementById('qms-equip-form-view').dataset.editingId = id || '';

  if (id) {
    const res = await qmsFetch('/lab-equipment', {});
    const eq = res.data.find(x => x.id === id);
    if (eq) {
      document.getElementById('qms-equip-f-name').value = eq.name || '';
      document.getElementById('qms-equip-f-lab').value = eq.lab_id || '';
      document.getElementById('qms-equip-f-serial-number').value = eq.serial_number || '';
      document.getElementById('qms-equip-f-last-calibration-date').value = qmsFmtDate(eq.last_calibration_date);
      document.getElementById('qms-equip-f-next-calibration-date').value = qmsFmtDate(eq.next_calibration_date);
      document.getElementById('qms-equip-f-notes').value = eq.notes || '';
    }
  }
  document.getElementById('qms-equip-form-title').textContent = id ? 'تعديل بيانات الجهاز' : 'جهاز مختبر جديد';
}

document.getElementById('qms-equip-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-equip-form-alert');
  const editingId = document.getElementById('qms-equip-form-view').dataset.editingId || null;
  const payload = {
    name: document.getElementById('qms-equip-f-name').value.trim(),
    lab_id: document.getElementById('qms-equip-f-lab').value || null,
    serial_number: document.getElementById('qms-equip-f-serial-number').value.trim() || null,
    last_calibration_date: document.getElementById('qms-equip-f-last-calibration-date').value || null,
    next_calibration_date: document.getElementById('qms-equip-f-next-calibration-date').value || null,
    notes: document.getElementById('qms-equip-f-notes').value.trim(),
  };
  try {
    if (editingId) {
      await qmsFetch('/lab-equipment/update', { method: 'POST', body: { id: editingId, ...payload } });
    } else {
      await qmsFetch('/lab-equipment', { method: 'POST', body: payload });
    }
    document.getElementById('qms-equip-form-view').style.display = 'none';
    qmsLoadEquipmentTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});

async function qmsEquipDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الجهاز؟')) return;
  try {
    await qmsFetch('/lab-equipment/delete', { method: 'POST', body: { id } });
    qmsLoadEquipmentTable();
  } catch (e) {
    alert(e.message);
  }
}

async function qmsEquipCalibrate(id) {
  const nextDate = prompt('تاريخ استحقاق المعايرة القادمة (YYYY-MM-DD):');
  if (!nextDate) return;
  const calibratedBy = prompt('اسم من قام بالمعايرة:') || null;
  try {
    await qmsFetch('/lab-equipment/calibrate', {
      method: 'POST',
      body: { id, next_calibration_date: nextDate, calibrated_by: calibratedBy },
    });
    qmsLoadEquipmentTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// نقاط الفحص (Inspection Test Plan - ITP)
// ================================================================

document.querySelector('[data-panel="qms-itp"]')?.addEventListener('click', async () => {
  await qms2EnsureRefData();
  qmsItpShowListView();
  qmsLoadItpTable();
});

function qmsItpShowListView() {
  document.getElementById('qms-itp-list-view').style.display = '';
  document.getElementById('qms-itp-form-view').style.display = 'none';
}

async function qmsLoadItpTable() {
  const ref = await qms2EnsureRefData();
  const tbody = document.getElementById('qms-itp-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-itp-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.itp_statuses, ref.itp_status_labels);
  }

  try {
    const res = await qmsFetch('/itp', {
      query: {
        search: document.getElementById('qms-itp-search')?.value || null,
        status: statusFilter?.value || null,
      },
    });
    const items = res.data;
    tbody.innerHTML = items.length ? items.map(i => `
      <tr>
        <td>${i.code}</td>
        <td>${qmsEsc(i.element)}</td>
        <td>${qmsEsc(i.stage)}</td>
        <td>${ref.itp_inspection_type_labels[i.inspection_type] || i.inspection_type}</td>
        <td>${ref.itp_responsible_party_labels[i.responsible_party] || i.responsible_party}</td>
        <td><span class="tag ${qmsItpStatusTag(i.status)}">${ref.itp_status_labels[i.status] || i.status}</span></td>
        <td>
          ${i.status === 'pending' ? `<button class="btn-icon" data-qms-itp-decide="${i.id}">اعتماد النتيجة</button>` : ''}
          ${i.status === 'pending' ? `<button class="btn-icon" data-qms-itp-edit="${i.id}">تعديل</button>` : ''}
          ${i.status === 'pending' ? `<button class="btn-icon" data-qms-itp-delete="${i.id}">حذف</button>` : ''}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد نقاط فحص مسجلة بعد</div></td></tr>`;

    tbody.querySelectorAll('[data-qms-itp-edit]').forEach(b => b.addEventListener('click', () => qmsItpShowForm(b.dataset.qmsItpEdit)));
    tbody.querySelectorAll('[data-qms-itp-delete]').forEach(b => b.addEventListener('click', () => qmsItpDelete(b.dataset.qmsItpDelete)));
    tbody.querySelectorAll('[data-qms-itp-decide]').forEach(b => b.addEventListener('click', () => qmsItpDecide(b.dataset.qmsItpDecide)));
  } catch (e) {
    qmsAlert(tbody, 'error', e.message);
  }
}
document.getElementById('qms-itp-search')?.addEventListener('input', debounceQms(() => qmsLoadItpTable(), 300));
document.getElementById('qms-itp-filter-status')?.addEventListener('change', () => qmsLoadItpTable());
document.getElementById('qms-itp-btn-new')?.addEventListener('click', () => qmsItpShowForm(null));
document.getElementById('qms-itp-form-cancel')?.addEventListener('click', () => { qmsItpShowListView(); qmsLoadItpTable(); });

async function qmsItpShowForm(id) {
  const ref = await qms2EnsureRefData();
  qmsItpEditingId = id;

  document.getElementById('qms-itp-list-view').style.display = 'none';
  document.getElementById('qms-itp-form-view').style.display = '';
  document.getElementById('qms-itp-form-alert').innerHTML = '';

  document.getElementById('qms-itp-f-inspection-type').innerHTML = qmsOptionsHTML(ref.itp_inspection_types, ref.itp_inspection_type_labels);
  document.getElementById('qms-itp-f-responsible-party').innerHTML = qmsOptionsHTML(ref.itp_responsible_parties, ref.itp_responsible_party_labels);

  const ids = ['project', 'element', 'stage', 'acceptance-criteria', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-itp-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/itp/get', { query: { id } });
      const i = res.data;
      document.getElementById('qms-itp-f-project').value = i.project_id || '';
      document.getElementById('qms-itp-f-element').value = i.element || '';
      document.getElementById('qms-itp-f-stage').value = i.stage || '';
      document.getElementById('qms-itp-f-inspection-type').value = i.inspection_type;
      document.getElementById('qms-itp-f-responsible-party').value = i.responsible_party;
      document.getElementById('qms-itp-f-acceptance-criteria').value = i.acceptance_criteria || '';
      document.getElementById('qms-itp-f-notes').value = i.notes || '';
      document.getElementById('qms-itp-f-project').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-itp-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-itp-f-project').disabled = false;
  }
  document.getElementById('qms-itp-form-title').textContent = id ? 'تعديل نقطة الفحص' : 'نقطة فحص جديدة (ITP)';
}

document.getElementById('qms-itp-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-itp-form-alert');
  const payload = {
    project_id: document.getElementById('qms-itp-f-project').value.trim(),
    element: document.getElementById('qms-itp-f-element').value.trim(),
    stage: document.getElementById('qms-itp-f-stage').value.trim(),
    inspection_type: document.getElementById('qms-itp-f-inspection-type').value,
    responsible_party: document.getElementById('qms-itp-f-responsible-party').value,
    acceptance_criteria: document.getElementById('qms-itp-f-acceptance-criteria').value.trim() || null,
    notes: document.getElementById('qms-itp-f-notes').value.trim(),
  };
  try {
    if (qmsItpEditingId) {
      await qmsFetch('/itp/update', { method: 'POST', body: { id: qmsItpEditingId, ...payload } });
    } else {
      await qmsFetch('/itp', { method: 'POST', body: payload });
    }
    qmsItpShowListView();
    qmsLoadItpTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});

async function qmsItpDelete(id) {
  if (!confirm('هل أنت متأكد من حذف نقطة الفحص هذه؟')) return;
  try {
    await qmsFetch('/itp/delete', { method: 'POST', body: { id } });
    qmsLoadItpTable();
  } catch (e) {
    alert(e.message);
  }
}

async function qmsItpDecide(id) {
  const status = prompt('نتيجة الفحص (passed / failed / waived):', 'passed');
  if (!status) return;
  const decidedBy = prompt('اسم المعتمِد:') || null;
  try {
    await qmsFetch('/itp/decide', { method: 'POST', body: { id, status, decided_by: decidedBy } });
    qmsLoadItpTable();
  } catch (e) {
    alert(e.message);
  }
}
