// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (Quality Management System - QMS)
// الجزء 3/4 (تكملة): اعتماد المواد (MAR) + اعتماد الرسومات (SDR)
// يعتمد على الدوال المساعدة العامة (qmsFetch, qmsAlert, qmsEsc, ...) من qms.js
// ============================================================

let QMS4_REF = null;
let qmsMarEditingId = null;
let qmsSdrEditingId = null;

async function qms4EnsureRefData() {
  if (QMS4_REF) return QMS4_REF;
  const res = await qmsFetch('/part3b/reference-data');
  QMS4_REF = res.data;
  return QMS4_REF;
}

function qmsMarStatusTag(status) {
  const map = {
    draft: 'tag-info', submitted: 'tag-info', under_review: 'tag-info',
    approved: 'tag-ok', approved_with_comments: 'tag-ok', rejected: 'tag-bad',
  };
  return map[status] || 'tag-info';
}
function qmsSdrStatusTag(status) {
  const map = {
    draft: 'tag-info', submitted: 'tag-info', under_review: 'tag-info',
    approved: 'tag-ok', approved_with_comments: 'tag-ok', rejected_resubmit: 'tag-bad',
  };
  return map[status] || 'tag-info';
}

// ================================================================
// اعتماد المواد (Material Approval Request - MAR)
// ================================================================

document.querySelector('[data-panel="qms-mar"]')?.addEventListener('click', async () => {
  await qms4EnsureRefData();
  qmsMarShowListView();
  qmsLoadMarTable();
});

function qmsMarShowListView() {
  document.getElementById('qms-mar-list-view').style.display = '';
  document.getElementById('qms-mar-form-view').style.display = 'none';
  document.getElementById('qms-mar-detail-view').style.display = 'none';
}

async function qmsLoadMarTable() {
  const ref = await qms4EnsureRefData();
  const tbody = document.getElementById('qms-mar-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-mar-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.mar_statuses, ref.mar_status_labels);
  }
  const disciplineFilter = document.getElementById('qms-mar-filter-discipline');
  if (disciplineFilter && disciplineFilter.options.length <= 1) {
    disciplineFilter.innerHTML += qmsOptionsHTML(ref.mar_disciplines, ref.mar_discipline_labels);
  }

  try {
    const res = await qmsFetch('/mars', {
      query: {
        search: document.getElementById('qms-mar-search')?.value || null,
        status: statusFilter?.value || null,
        discipline: disciplineFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد طلبات اعتماد مواد مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(m => `
      <tr>
        <td>${m.code}</td>
        <td>${qmsEsc(m.project_id)}</td>
        <td>${qmsEsc(m.material_name)}</td>
        <td>${qmsEsc(m.supplier_name)}</td>
        <td>${ref.mar_discipline_labels[m.discipline] || m.discipline}</td>
        <td><span class="tag ${qmsMarStatusTag(m.status)}">${ref.mar_status_labels[m.status] || m.status}</span></td>
        <td>
          <button class="pm-link-btn" data-qms-mar-view="${m.id}">عرض</button>
          ${!['approved', 'approved_with_comments'].includes(m.status) ? `<button class="pm-link-btn" data-qms-mar-edit="${m.id}">تعديل</button>` : ''}
          ${m.status === 'draft' ? `<button class="pm-link-btn pm-mini-btn-danger" data-qms-mar-delete="${m.id}">حذف</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qms-mar-view]').forEach(b => b.addEventListener('click', () => qmsMarShowDetail(b.dataset.qmsMarView)));
    tbody.querySelectorAll('[data-qms-mar-edit]').forEach(b => b.addEventListener('click', () => qmsMarShowForm(b.dataset.qmsMarEdit)));
    tbody.querySelectorAll('[data-qms-mar-delete]').forEach(b => b.addEventListener('click', () => qmsMarDelete(b.dataset.qmsMarDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-mar-search')?.addEventListener('input', debounceQms(() => qmsLoadMarTable(), 300));
document.getElementById('qms-mar-filter-status')?.addEventListener('change', () => qmsLoadMarTable());
document.getElementById('qms-mar-filter-discipline')?.addEventListener('change', () => qmsLoadMarTable());
document.getElementById('qms-mar-btn-new')?.addEventListener('click', () => qmsMarShowForm(null));
document.getElementById('qms-mar-btn-back-from-detail')?.addEventListener('click', () => { qmsMarShowListView(); qmsLoadMarTable(); });

// تحويل نص متعدد الأسطر بصيغة "التسمية | الرابط" إلى مصفوفة كائنات
function qmsParseLabeledLines(text) {
  return String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const [label, url] = line.split('|').map(s => (s || '').trim());
      return { label: label || line, url: url || null };
    });
}
function qmsLabeledLinesToText(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map(item => item.url ? `${item.label} | ${item.url}` : item.label).join('\n');
}

async function qmsMarShowForm(id) {
  const ref = await qms4EnsureRefData();
  qmsMarEditingId = id;

  document.getElementById('qms-mar-list-view').style.display = 'none';
  document.getElementById('qms-mar-detail-view').style.display = 'none';
  document.getElementById('qms-mar-form-view').style.display = '';
  document.getElementById('qms-mar-form-alert').innerHTML = '';

  document.getElementById('qms-mar-f-discipline').innerHTML = qmsOptionsHTML(ref.mar_disciplines, ref.mar_discipline_labels);

  const ids = ['project', 'material-name', 'supplier-name', 'manufacturer', 'country-of-origin', 'specification-reference', 'certificates', 'test-results', 'notes'];
  ids.forEach(k => { const el = document.getElementById(`qms-mar-f-${k}`); if (el) el.value = ''; });

  if (id) {
    try {
      const res = await qmsFetch('/mars/get', { query: { id } });
      const m = res.data;
      document.getElementById('qms-mar-f-project').value = m.project_id || '';
      document.getElementById('qms-mar-f-material-name').value = m.material_name || '';
      document.getElementById('qms-mar-f-discipline').value = m.discipline || 'other';
      document.getElementById('qms-mar-f-supplier-name').value = m.supplier_name || '';
      document.getElementById('qms-mar-f-manufacturer').value = m.manufacturer || '';
      document.getElementById('qms-mar-f-country-of-origin').value = m.country_of_origin || '';
      document.getElementById('qms-mar-f-specification-reference').value = m.specification_reference || '';
      document.getElementById('qms-mar-f-certificates').value = qmsLabeledLinesToText(m.quality_certificates);
      document.getElementById('qms-mar-f-test-results').value = qmsLabeledLinesToText(m.test_results);
      document.getElementById('qms-mar-f-notes').value = m.notes || '';
      document.getElementById('qms-mar-f-project').disabled = true;
    } catch (e) {
      qmsAlert(document.getElementById('qms-mar-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-mar-f-project').disabled = false;
  }
  document.getElementById('qms-mar-form-title').textContent = id ? 'تعديل طلب اعتماد المواد' : 'طلب اعتماد مواد جديد (MAR)';
}

document.getElementById('qms-mar-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-mar-form-alert');
  const payload = {
    project_id: document.getElementById('qms-mar-f-project').value.trim(),
    material_name: document.getElementById('qms-mar-f-material-name').value.trim(),
    discipline: document.getElementById('qms-mar-f-discipline').value,
    supplier_name: document.getElementById('qms-mar-f-supplier-name').value.trim(),
    manufacturer: document.getElementById('qms-mar-f-manufacturer').value.trim() || null,
    country_of_origin: document.getElementById('qms-mar-f-country-of-origin').value.trim() || null,
    specification_reference: document.getElementById('qms-mar-f-specification-reference').value.trim() || null,
    quality_certificates: qmsParseLabeledLines(document.getElementById('qms-mar-f-certificates').value),
    test_results: qmsParseLabeledLines(document.getElementById('qms-mar-f-test-results').value),
    notes: document.getElementById('qms-mar-f-notes').value.trim() || null,
  };

  try {
    if (qmsMarEditingId) {
      await qmsFetch('/mars/update', { method: 'POST', body: { id: qmsMarEditingId, ...payload } });
    } else {
      await qmsFetch('/mars', { method: 'POST', body: payload });
    }
    qmsMarShowListView();
    qmsLoadMarTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-mar-form-cancel')?.addEventListener('click', () => { qmsMarShowListView(); qmsLoadMarTable(); });

async function qmsMarShowDetail(id) {
  document.getElementById('qms-mar-list-view').style.display = 'none';
  document.getElementById('qms-mar-form-view').style.display = 'none';
  document.getElementById('qms-mar-detail-view').style.display = '';
  const box = document.getElementById('qms-mar-detail-box');
  const ref = await qms4EnsureRefData();

  try {
    const res = await qmsFetch('/mars/get', { query: { id } });
    const m = res.data;
    const nextActions = (ref.mar_allowed_transitions[m.status] || []);

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${m.code} — ${qmsEsc(m.material_name)}</h3>
        <span class="tag ${qmsMarStatusTag(m.status)}">${ref.mar_status_labels[m.status] || m.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(m.project_id)}</div>
        <div><b>التخصص:</b> ${ref.mar_discipline_labels[m.discipline] || m.discipline}</div>
        <div><b>المورد:</b> ${qmsEsc(m.supplier_name)}</div>
        <div><b>المصنّع:</b> ${qmsEsc(m.manufacturer || '—')}</div>
        <div><b>بلد المنشأ:</b> ${qmsEsc(m.country_of_origin || '—')}</div>
        <div><b>مرجع المواصفة:</b> ${qmsEsc(m.specification_reference || '—')}</div>
        <div><b>اعتُمد بواسطة:</b> ${qmsEsc(m.decided_by || '—')}</div>
        <div><b>تاريخ القرار:</b> ${qmsFmtDateTime(m.decided_at)}</div>
      </div>
      <div class="pm-detail-block">
        <h4>شهادات الجودة</h4>
        ${m.quality_certificates.length ? `<ul>${m.quality_certificates.map(c => `<li>${qmsEsc(c.label)}${c.url ? ` — <a href="${qmsEsc(c.url)}" target="_blank" rel="noopener">رابط</a>` : ''}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا توجد شهادات مرفقة</div>'}
      </div>
      <div class="pm-detail-block">
        <h4>نتائج الاختبارات</h4>
        ${m.test_results.length ? `<ul>${m.test_results.map(t => `<li>${qmsEsc(t.label)}${t.url ? ` — <a href="${qmsEsc(t.url)}" target="_blank" rel="noopener">رابط</a>` : ''}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا توجد نتائج اختبارات مرفقة</div>'}
      </div>
      ${m.notes ? `<div class="pm-detail-block"><h4>ملاحظات</h4><p>${qmsEsc(m.notes)}</p></div>` : ''}
      <div class="pm-detail-block">
        <h4>سجل المراجعة والتعليقات</h4>
        ${m.review_comments.length ? `<ul>${m.review_comments.map(c => `<li>${qmsFmtDateTime(c.ts)} — ${qmsEsc(c.by || 'غير محدد')}: ${qmsEsc(c.comment)}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا توجد تعليقات بعد</div>'}
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${m.change_log.map(l => `<li>${qmsFmtDateTime(l.ts)} — ${qmsEsc(l.action)} ${l.by ? `(${qmsEsc(l.by)})` : ''}</li>`).join('')}</ul>
      </div>

      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${nextActions.includes('submitted') ? `<button class="btn btn-outline" data-qms-mar-transition="submitted">إرسال الطلب</button>` : ''}
        ${nextActions.includes('under_review') ? `<button class="btn btn-outline" data-qms-mar-transition="under_review">بدء المراجعة</button>` : ''}
        ${nextActions.includes('approved') ? `<button class="btn btn-primary" data-qms-mar-transition="approved">اعتماد</button>` : ''}
        ${nextActions.includes('approved_with_comments') ? `<button class="btn btn-outline" data-qms-mar-transition="approved_with_comments">اعتماد بملاحظات</button>` : ''}
        ${nextActions.includes('rejected') ? `<button class="btn btn-outline" data-qms-mar-transition="rejected">رفض</button>` : ''}
        ${!['approved', 'approved_with_comments'].includes(m.status) ? `<button class="btn btn-outline" id="qms-mar-comment-btn">إضافة تعليق مراجعة</button>` : ''}
      </div>
      <div id="qms-mar-detail-alert"></div>
    `;

    box.querySelectorAll('[data-qms-mar-transition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const toStatus = btn.dataset.qmsMarTransition;
        let by = null;
        let comment = '';
        if (['approved', 'approved_with_comments', 'rejected'].includes(toStatus)) {
          by = prompt('اسم الجهة المُعتمِدة (QA/QC Manager):');
          if (!by) return;
          comment = prompt('ملاحظات القرار (اختياري):') || '';
        }
        try {
          await qmsFetch('/mars/transition', { method: 'POST', body: { id: m.id, to_status: toStatus, by, comment } });
          qmsMarShowDetail(id);
        } catch (e) {
          qmsAlert(document.getElementById('qms-mar-detail-alert'), 'error', e.message);
        }
      });
    });

    document.getElementById('qms-mar-comment-btn')?.addEventListener('click', async () => {
      const comment = prompt('نص التعليق:');
      if (!comment) return;
      const by = prompt('اسمك (اختياري):') || null;
      try {
        await qmsFetch('/mars/comment', { method: 'POST', body: { id: m.id, comment, by } });
        qmsMarShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-mar-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsMarDelete(id) {
  if (!confirm('هل أنت متأكد من حذف طلب اعتماد المواد هذا؟')) return;
  try {
    await qmsFetch('/mars/delete', { method: 'POST', body: { id } });
    qmsLoadMarTable();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// اعتماد الرسومات (Shop Drawing Approval - SDR)
// ================================================================

document.querySelector('[data-panel="qms-sdr"]')?.addEventListener('click', async () => {
  await qms4EnsureRefData();
  qmsSdrShowListView();
  qmsLoadSdrTable();
});

function qmsSdrShowListView() {
  document.getElementById('qms-sdr-list-view').style.display = '';
  document.getElementById('qms-sdr-form-view').style.display = 'none';
  document.getElementById('qms-sdr-detail-view').style.display = 'none';
}

async function qmsLoadSdrTable() {
  const ref = await qms4EnsureRefData();
  const tbody = document.getElementById('qms-sdr-tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('qms-sdr-filter-status');
  if (statusFilter && statusFilter.options.length <= 1) {
    statusFilter.innerHTML += qmsOptionsHTML(ref.sdr_statuses, ref.sdr_status_labels);
  }
  const disciplineFilter = document.getElementById('qms-sdr-filter-discipline');
  if (disciplineFilter && disciplineFilter.options.length <= 1) {
    disciplineFilter.innerHTML += qmsOptionsHTML(ref.sdr_disciplines, ref.sdr_discipline_labels);
  }

  try {
    const res = await qmsFetch('/sdrs', {
      query: {
        search: document.getElementById('qms-sdr-search')?.value || null,
        status: statusFilter?.value || null,
        discipline: disciplineFilter?.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد طلبات اعتماد رسومات مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(s => `
      <tr>
        <td>${s.code}</td>
        <td>${qmsEsc(s.project_id)}</td>
        <td>${qmsEsc(s.drawing_title)}</td>
        <td>${qmsEsc(s.drawing_number)}</td>
        <td>Rev ${s.current_version}</td>
        <td><span class="tag ${qmsSdrStatusTag(s.status)}">${ref.sdr_status_labels[s.status] || s.status}</span></td>
        <td>
          <button class="pm-link-btn" data-qms-sdr-view="${s.id}">عرض</button>
          ${!['approved', 'approved_with_comments'].includes(s.status) ? `<button class="pm-link-btn" data-qms-sdr-edit="${s.id}">تعديل</button>` : ''}
          ${s.status === 'draft' ? `<button class="pm-link-btn pm-mini-btn-danger" data-qms-sdr-delete="${s.id}">حذف</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-qms-sdr-view]').forEach(b => b.addEventListener('click', () => qmsSdrShowDetail(b.dataset.qmsSdrView)));
    tbody.querySelectorAll('[data-qms-sdr-edit]').forEach(b => b.addEventListener('click', () => qmsSdrShowForm(b.dataset.qmsSdrEdit)));
    tbody.querySelectorAll('[data-qms-sdr-delete]').forEach(b => b.addEventListener('click', () => qmsSdrDelete(b.dataset.qmsSdrDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('qms-sdr-search')?.addEventListener('input', debounceQms(() => qmsLoadSdrTable(), 300));
document.getElementById('qms-sdr-filter-status')?.addEventListener('change', () => qmsLoadSdrTable());
document.getElementById('qms-sdr-filter-discipline')?.addEventListener('change', () => qmsLoadSdrTable());
document.getElementById('qms-sdr-btn-new')?.addEventListener('click', () => qmsSdrShowForm(null));
document.getElementById('qms-sdr-btn-back-from-detail')?.addEventListener('click', () => { qmsSdrShowListView(); qmsLoadSdrTable(); });

async function qmsSdrShowForm(id) {
  const ref = await qms4EnsureRefData();
  qmsSdrEditingId = id;

  document.getElementById('qms-sdr-list-view').style.display = 'none';
  document.getElementById('qms-sdr-detail-view').style.display = 'none';
  document.getElementById('qms-sdr-form-view').style.display = '';
  document.getElementById('qms-sdr-form-alert').innerHTML = '';

  document.getElementById('qms-sdr-f-discipline').innerHTML = qmsOptionsHTML(ref.sdr_disciplines, ref.sdr_discipline_labels);

  const ids = ['project', 'drawing-title', 'drawing-number', 'contractor', 'consultant', 'file-url'];
  ids.forEach(k => { const el = document.getElementById(`qms-sdr-f-${k}`); if (el) el.value = ''; });

  const fileUrlField = document.getElementById('qms-sdr-f-file-url');
  const fileUrlFieldWrap = fileUrlField?.closest('.field');

  if (id) {
    try {
      const res = await qmsFetch('/sdrs/get', { query: { id } });
      const s = res.data;
      document.getElementById('qms-sdr-f-project').value = s.project_id || '';
      document.getElementById('qms-sdr-f-drawing-title').value = s.drawing_title || '';
      document.getElementById('qms-sdr-f-drawing-number').value = s.drawing_number || '';
      document.getElementById('qms-sdr-f-discipline').value = s.discipline || 'other';
      document.getElementById('qms-sdr-f-contractor').value = s.contractor || '';
      document.getElementById('qms-sdr-f-consultant').value = s.consultant || '';
      document.getElementById('qms-sdr-f-project').disabled = true;
      // عند التعديل، رفع إصدار جديد يتم من شاشة التفاصيل وليس هنا
      if (fileUrlFieldWrap) fileUrlFieldWrap.style.display = 'none';
    } catch (e) {
      qmsAlert(document.getElementById('qms-sdr-form-alert'), 'error', e.message);
    }
  } else {
    document.getElementById('qms-sdr-f-project').disabled = false;
    if (fileUrlFieldWrap) fileUrlFieldWrap.style.display = '';
  }
  document.getElementById('qms-sdr-form-title').textContent = id ? 'تعديل طلب اعتماد الرسم' : 'طلب اعتماد رسم جديد (SDR)';
}

document.getElementById('qms-sdr-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-sdr-form-alert');
  const payload = {
    project_id: document.getElementById('qms-sdr-f-project').value.trim(),
    drawing_title: document.getElementById('qms-sdr-f-drawing-title').value.trim(),
    drawing_number: document.getElementById('qms-sdr-f-drawing-number').value.trim(),
    discipline: document.getElementById('qms-sdr-f-discipline').value,
    contractor: document.getElementById('qms-sdr-f-contractor').value.trim() || null,
    consultant: document.getElementById('qms-sdr-f-consultant').value.trim() || null,
  };

  try {
    if (qmsSdrEditingId) {
      await qmsFetch('/sdrs/update', { method: 'POST', body: { id: qmsSdrEditingId, ...payload } });
    } else {
      payload.file_url = document.getElementById('qms-sdr-f-file-url').value.trim() || null;
      await qmsFetch('/sdrs', { method: 'POST', body: payload });
    }
    qmsSdrShowListView();
    qmsLoadSdrTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-sdr-form-cancel')?.addEventListener('click', () => { qmsSdrShowListView(); qmsLoadSdrTable(); });

async function qmsSdrShowDetail(id) {
  document.getElementById('qms-sdr-list-view').style.display = 'none';
  document.getElementById('qms-sdr-form-view').style.display = 'none';
  document.getElementById('qms-sdr-detail-view').style.display = '';
  const box = document.getElementById('qms-sdr-detail-box');
  const ref = await qms4EnsureRefData();

  try {
    const res = await qmsFetch('/sdrs/get', { query: { id } });
    const s = res.data;
    const nextActions = (ref.sdr_allowed_transitions[s.status] || []);
    const canUploadVersion = !['approved', 'approved_with_comments'].includes(s.status);

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${s.code} — ${qmsEsc(s.drawing_title)}</h3>
        <span class="tag ${qmsSdrStatusTag(s.status)}">${ref.sdr_status_labels[s.status] || s.status}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>المشروع:</b> ${qmsEsc(s.project_id)}</div>
        <div><b>رقم الرسم:</b> ${qmsEsc(s.drawing_number)}</div>
        <div><b>التخصص:</b> ${ref.sdr_discipline_labels[s.discipline] || s.discipline}</div>
        <div><b>المقاول:</b> ${qmsEsc(s.contractor || '—')}</div>
        <div><b>الاستشاري:</b> ${qmsEsc(s.consultant || '—')}</div>
        <div><b>الإصدار الحالي:</b> Rev ${s.current_version}</div>
        <div><b>اعتُمد بواسطة:</b> ${qmsEsc(s.decided_by || '—')}</div>
        <div><b>تاريخ القرار:</b> ${qmsFmtDateTime(s.decided_at)}</div>
      </div>
      <div class="pm-detail-block">
        <h4>سجل الإصدارات (مقارنة الإصدارات)</h4>
        <ul>${s.versions.map(v => `<li>Rev ${v.version_no} — ${qmsFmtDateTime(v.uploaded_at)} ${v.uploaded_by ? `(${qmsEsc(v.uploaded_by)})` : ''} ${v.file_url ? ` — <a href="${qmsEsc(v.file_url)}" target="_blank" rel="noopener">فتح الملف</a>` : ''}</li>`).join('')}</ul>
      </div>
      <div class="pm-detail-block">
        <h4>التعليقات (سجل المراجعة)</h4>
        ${s.comments.length ? `<ul>${s.comments.map(c => `<li>${qmsFmtDateTime(c.ts)} — Rev ${c.version_no} — ${qmsEsc(c.by || 'غير محدد')}: ${qmsEsc(c.comment)}</li>`).join('')}</ul>` : '<div class="pm-empty-state">لا توجد تعليقات بعد</div>'}
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${s.change_log.map(l => `<li>${qmsFmtDateTime(l.ts)} — ${qmsEsc(l.action)} ${l.by ? `(${qmsEsc(l.by)})` : ''}</li>`).join('')}</ul>
      </div>

      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        ${canUploadVersion ? `<button class="btn btn-outline" id="qms-sdr-upload-version-btn">رفع إصدار جديد</button>` : ''}
        ${nextActions.includes('submitted') ? `<button class="btn btn-outline" data-qms-sdr-transition="submitted">إرسال الطلب</button>` : ''}
        ${nextActions.includes('under_review') ? `<button class="btn btn-outline" data-qms-sdr-transition="under_review">بدء المراجعة</button>` : ''}
        ${nextActions.includes('approved') ? `<button class="btn btn-primary" data-qms-sdr-transition="approved">اعتماد</button>` : ''}
        ${nextActions.includes('approved_with_comments') ? `<button class="btn btn-outline" data-qms-sdr-transition="approved_with_comments">اعتماد بملاحظات</button>` : ''}
        ${nextActions.includes('rejected_resubmit') ? `<button class="btn btn-outline" data-qms-sdr-transition="rejected_resubmit">رفض - يتطلب إعادة تقديم</button>` : ''}
        ${canUploadVersion ? `<button class="btn btn-outline" id="qms-sdr-comment-btn">إضافة تعليق</button>` : ''}
      </div>
      <div id="qms-sdr-detail-alert"></div>
    `;

    document.getElementById('qms-sdr-upload-version-btn')?.addEventListener('click', async () => {
      const fileUrl = prompt('رابط ملف الإصدار الجديد:');
      if (!fileUrl) return;
      const uploadedBy = prompt('اسم من قام بالرفع (اختياري):') || null;
      try {
        await qmsFetch('/sdrs/upload-version', { method: 'POST', body: { id: s.id, file_url: fileUrl, uploaded_by: uploadedBy } });
        qmsSdrShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-sdr-detail-alert'), 'error', e.message);
      }
    });

    box.querySelectorAll('[data-qms-sdr-transition]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const toStatus = btn.dataset.qmsSdrTransition;
        let by = null;
        let comment = '';
        if (['approved', 'approved_with_comments', 'rejected_resubmit'].includes(toStatus)) {
          by = prompt('اسم الجهة المُعتمِدة (الاعتماد الإلكتروني):');
          if (!by) return;
          comment = prompt('ملاحظات القرار (اختياري):') || '';
        }
        try {
          await qmsFetch('/sdrs/transition', { method: 'POST', body: { id: s.id, to_status: toStatus, by, comment } });
          qmsSdrShowDetail(id);
        } catch (e) {
          qmsAlert(document.getElementById('qms-sdr-detail-alert'), 'error', e.message);
        }
      });
    });

    document.getElementById('qms-sdr-comment-btn')?.addEventListener('click', async () => {
      const comment = prompt('نص التعليق:');
      if (!comment) return;
      const by = prompt('اسمك (اختياري):') || null;
      try {
        await qmsFetch('/sdrs/comment', { method: 'POST', body: { id: s.id, comment, by } });
        qmsSdrShowDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-sdr-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function qmsSdrDelete(id) {
  if (!confirm('هل أنت متأكد من حذف طلب اعتماد الرسم هذا؟')) return;
  try {
    await qmsFetch('/sdrs/delete', { method: 'POST', body: { id } });
    qmsLoadSdrTable();
  } catch (e) {
    alert(e.message);
  }
}
