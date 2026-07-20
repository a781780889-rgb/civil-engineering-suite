// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (Quality Management System - QMS)
// الجزء 5/4 إضافي: إدارة الوثائق (مواصفات/أكواد/شهادات) +
//                   مؤشرات الأداء (KPIs): إغلاق NCR + أداء الموردين/المقاولين
// يعتمد على الأدوات المشتركة المُعرَّفة في qms.js (qmsFetch, qmsAlert, qmsEsc...)
// ============================================================

let QMS5_REF = null;
let qmsDocEditingId = null;

async function qms5EnsureRefData() {
  if (QMS5_REF) return QMS5_REF;
  const res = await qmsFetch('/part5/reference-data');
  QMS5_REF = res.data;

  const typeSel = document.getElementById('qms-doc-f-type');
  const typeFilter = document.getElementById('qms-doc-filter-type');
  const statusFilter = document.getElementById('qms-doc-filter-status');
  if (typeSel) typeSel.innerHTML = QMS5_REF.document_types.map(t => `<option value="${t}">${QMS5_REF.document_type_labels[t]}</option>`).join('');
  if (typeFilter) typeFilter.innerHTML += QMS5_REF.document_types.map(t => `<option value="${t}">${QMS5_REF.document_type_labels[t]}</option>`).join('');
  if (statusFilter) statusFilter.innerHTML += QMS5_REF.document_statuses.map(s => `<option value="${s}">${QMS5_REF.document_status_labels[s]}</option>`).join('');

  return QMS5_REF;
}

function qmsDocValidityTag(state) {
  return { valid: 'tag-success', expiring_soon: 'tag-warning', expired: 'tag-danger', no_expiry: 'tag-muted' }[state] || 'tag-muted';
}

// ---------- إدارة الوثائق: القائمة ----------

async function qmsLoadDocTable() {
  const ref = await qms5EnsureRefData();
  const tbody = document.getElementById('qms-doc-tbody');
  tbody.innerHTML = `<tr><td colspan="8">جارٍ التحميل...</td></tr>`;
  try {
    const res = await qmsFetch('/documents', {
      query: {
        search: document.getElementById('qms-doc-search').value.trim(),
        docType: document.getElementById('qms-doc-filter-type').value,
        status: document.getElementById('qms-doc-filter-status').value,
        validityState: document.getElementById('qms-doc-filter-validity').value,
      },
    });
    const docs = res.data;
    if (!docs.length) {
      tbody.innerHTML = `<tr><td colspan="8">لا توجد وثائق مسجلة بعد</td></tr>`;
    } else {
      tbody.innerHTML = docs.map(d => `
        <tr>
          <td>${qmsEsc(d.code)}</td>
          <td>${qmsEsc(d.title)}</td>
          <td>${ref.document_type_labels[d.doc_type] || d.doc_type}</td>
          <td>${qmsEsc(d.issuing_body) || '—'}</td>
          <td>${qmsFmtDate(d.expiry_date)}</td>
          <td><span class="tag">${ref.document_status_labels[d.status] || d.status}</span></td>
          <td><span class="tag ${qmsDocValidityTag(d.validity_state)}">${ref.validity_state_labels[d.validity_state] || d.validity_state}</span></td>
          <td>
            <button class="btn btn-sm" data-qms-doc-view="${d.id}">عرض</button>
            <button class="btn btn-sm btn-danger" data-qms-doc-delete="${d.id}">حذف</button>
          </td>
        </tr>
      `).join('');
    }
    tbody.querySelectorAll('[data-qms-doc-view]').forEach(btn => {
      btn.addEventListener('click', () => qmsDocShowDetail(btn.dataset.qmsDocView));
    });
    tbody.querySelectorAll('[data-qms-doc-delete]').forEach(btn => {
      btn.addEventListener('click', () => qmsDocDelete(btn.dataset.qmsDocDelete));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8">خطأ: ${qmsEsc(e.message)}</td></tr>`;
  }

  // تنبيه الوثائق التي تحتاج انتباه (منتهية أو تقترب من الانتهاء) خلال 30 يوماً
  try {
    const exp = await qmsFetch('/documents/expiring', { query: { withinDays: 30 } });
    const box = document.getElementById('qms-doc-expiring-alert');
    if (exp.data.length) {
      box.innerHTML = `<div class="alert alert-warning">
        ⚠️ ${exp.data.length} وثيقة/شهادة منتهية أو تقترب من الانتهاء خلال 30 يوماً:
        ${exp.data.slice(0, 5).map(d => `${qmsEsc(d.title)} (${d.days_left < 0 ? 'منتهية منذ ' + Math.abs(d.days_left) + ' يوم' : 'متبقٍ ' + d.days_left + ' يوم'})`).join('، ')}
      </div>`;
    } else {
      box.innerHTML = '';
    }
  } catch (e) { /* تجاهل صامت لعدم تعطيل القائمة الرئيسية */ }
}

function qmsDocShowListView() {
  document.getElementById('qms-doc-list-view').style.display = '';
  document.getElementById('qms-doc-form-view').style.display = 'none';
  document.getElementById('qms-doc-detail-view').style.display = 'none';
}

document.getElementById('qms-doc-search')?.addEventListener('input', () => qmsLoadDocTable());
document.getElementById('qms-doc-filter-type')?.addEventListener('change', () => qmsLoadDocTable());
document.getElementById('qms-doc-filter-status')?.addEventListener('change', () => qmsLoadDocTable());
document.getElementById('qms-doc-filter-validity')?.addEventListener('change', () => qmsLoadDocTable());

// ---------- إدارة الوثائق: النموذج ----------

document.getElementById('qms-doc-btn-new')?.addEventListener('click', async () => {
  await qms5EnsureRefData();
  qmsDocEditingId = null;
  document.getElementById('qms-doc-form-title').textContent = 'وثيقة جديدة';
  document.getElementById('qms-doc-form-alert').innerHTML = '';
  ['project', 'title', 'reference-number', 'issuing-body', 'issue-date', 'expiry-date', 'tags', 'file-url', 'notes']
    .forEach(f => { const el = document.getElementById(`qms-doc-f-${f}`); if (el) el.value = ''; });
  document.getElementById('qms-doc-f-file-url').closest('.field').style.display = '';
  document.getElementById('qms-doc-list-view').style.display = 'none';
  document.getElementById('qms-doc-detail-view').style.display = 'none';
  document.getElementById('qms-doc-form-view').style.display = '';
});

document.getElementById('qms-doc-form-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('qms-doc-form-alert');
  const tagsRaw = document.getElementById('qms-doc-f-tags').value.trim();
  const payload = {
    project_id: document.getElementById('qms-doc-f-project').value.trim() || null,
    title: document.getElementById('qms-doc-f-title').value.trim(),
    doc_type: document.getElementById('qms-doc-f-type').value,
    reference_number: document.getElementById('qms-doc-f-reference-number').value.trim() || null,
    issuing_body: document.getElementById('qms-doc-f-issuing-body').value.trim() || null,
    issue_date: document.getElementById('qms-doc-f-issue-date').value || null,
    expiry_date: document.getElementById('qms-doc-f-expiry-date').value || null,
    tags: tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    notes: document.getElementById('qms-doc-f-notes').value.trim() || null,
  };
  if (!qmsDocEditingId) {
    payload.file_url = document.getElementById('qms-doc-f-file-url').value.trim();
  }

  try {
    if (qmsDocEditingId) {
      await qmsFetch('/documents/update', { method: 'POST', body: { id: qmsDocEditingId, ...payload } });
    } else {
      await qmsFetch('/documents', { method: 'POST', body: payload });
    }
    qmsDocShowListView();
    qmsLoadDocTable();
  } catch (e) {
    qmsAlert(alertEl, 'error', e.message);
  }
});
document.getElementById('qms-doc-form-cancel')?.addEventListener('click', () => qmsDocShowListView());
document.getElementById('qms-doc-btn-back-from-detail')?.addEventListener('click', () => {
  qmsDocShowListView();
  qmsLoadDocTable();
});

// ---------- إدارة الوثائق: التفاصيل ----------

async function qmsDocShowDetail(id) {
  document.getElementById('qms-doc-list-view').style.display = 'none';
  document.getElementById('qms-doc-form-view').style.display = 'none';
  document.getElementById('qms-doc-detail-view').style.display = '';
  await qmsDocRenderDetail(id);
}

async function qmsDocRenderDetail(id) {
  const ref = await qms5EnsureRefData();
  const box = document.getElementById('qms-doc-detail-box');
  try {
    const res = await qmsFetch('/documents/get', { query: { id } });
    const d = res.data;

    box.innerHTML = `
      <div class="pm-detail-header">
        <h3>${qmsEsc(d.code)} — ${qmsEsc(d.title)}</h3>
        <span class="tag ${qmsDocValidityTag(d.validity_state)}">${ref.validity_state_labels[d.validity_state]}</span>
      </div>
      <div class="pm-detail-meta">
        <div><b>النوع:</b> ${ref.document_type_labels[d.doc_type] || d.doc_type}</div>
        <div><b>الحالة:</b> ${ref.document_status_labels[d.status] || d.status}</div>
        <div><b>الرقم المرجعي:</b> ${qmsEsc(d.reference_number) || '—'}</div>
        <div><b>الجهة المُصدرة:</b> ${qmsEsc(d.issuing_body) || '—'}</div>
        <div><b>تاريخ الإصدار:</b> ${qmsFmtDate(d.issue_date)}</div>
        <div><b>تاريخ الانتهاء:</b> ${qmsFmtDate(d.expiry_date)}</div>
        <div><b>الوسوم:</b> ${(d.tags || []).map(t => qmsEsc(t)).join('، ') || '—'}</div>
        <div><b>الإصدار الحالي:</b> رقم ${d.current_version}</div>
      </div>
      ${d.notes ? `<div class="pm-detail-block"><h4>ملاحظات</h4><p>${qmsEsc(d.notes)}</p></div>` : ''}
      <div class="pm-detail-block">
        <h4>سجل الإصدارات</h4>
        <ul>${d.versions.map(v => `<li>إصدار ${v.version_no} — ${qmsFmtDateTime(v.uploaded_at)} ${v.uploaded_by ? `(${qmsEsc(v.uploaded_by)})` : ''} — <a href="${qmsEsc(v.file_url)}" target="_blank" rel="noopener">فتح الملف</a>${v.notes ? ` — ${qmsEsc(v.notes)}` : ''}</li>`).join('')}</ul>
      </div>
      <div class="pm-detail-block">
        <h4>سجل التعديلات</h4>
        <ul>${d.change_log.map(l => `<li>${qmsFmtDateTime(l.ts)} — ${qmsEsc(l.action)} ${l.by ? `(${qmsEsc(l.by)})` : ''}</li>`).join('')}</ul>
      </div>
      <div class="modal-actions" style="flex-wrap:wrap; gap:8px">
        <button class="btn btn-outline" id="qms-doc-edit-btn">تعديل البيانات</button>
        <button class="btn btn-outline" id="qms-doc-upload-version-btn">رفع إصدار جديد</button>
        ${d.status !== 'archived' ? `<button class="btn btn-outline" id="qms-doc-archive-btn">أرشفة الوثيقة</button>` : ''}
      </div>
      <div id="qms-doc-detail-alert"></div>
    `;

    document.getElementById('qms-doc-edit-btn')?.addEventListener('click', () => {
      qmsDocEditingId = id;
      document.getElementById('qms-doc-form-title').textContent = 'تعديل الوثيقة';
      document.getElementById('qms-doc-form-alert').innerHTML = '';
      document.getElementById('qms-doc-f-project').value = d.project_id || '';
      document.getElementById('qms-doc-f-title').value = d.title || '';
      document.getElementById('qms-doc-f-type').value = d.doc_type;
      document.getElementById('qms-doc-f-reference-number').value = d.reference_number || '';
      document.getElementById('qms-doc-f-issuing-body').value = d.issuing_body || '';
      document.getElementById('qms-doc-f-issue-date').value = d.issue_date ? String(d.issue_date).slice(0, 10) : '';
      document.getElementById('qms-doc-f-expiry-date').value = d.expiry_date ? String(d.expiry_date).slice(0, 10) : '';
      document.getElementById('qms-doc-f-tags').value = (d.tags || []).join(', ');
      document.getElementById('qms-doc-f-notes').value = d.notes || '';
      document.getElementById('qms-doc-f-file-url').closest('.field').style.display = 'none';
      document.getElementById('qms-doc-list-view').style.display = 'none';
      document.getElementById('qms-doc-detail-view').style.display = 'none';
      document.getElementById('qms-doc-form-view').style.display = '';
    });

    document.getElementById('qms-doc-upload-version-btn')?.addEventListener('click', async () => {
      const fileUrl = prompt('رابط ملف الإصدار الجديد:');
      if (!fileUrl) return;
      const notes = prompt('ملاحظات على هذا الإصدار (اختياري):') || null;
      try {
        await qmsFetch('/documents/upload-version', { method: 'POST', body: { id, file_url: fileUrl, notes } });
        qmsDocRenderDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-doc-detail-alert'), 'error', e.message);
      }
    });

    document.getElementById('qms-doc-archive-btn')?.addEventListener('click', async () => {
      if (!confirm('هل تريد أرشفة هذه الوثيقة؟')) return;
      try {
        await qmsFetch('/documents/archive', { method: 'POST', body: { id } });
        qmsDocRenderDetail(id);
      } catch (e) {
        qmsAlert(document.getElementById('qms-doc-detail-alert'), 'error', e.message);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${qmsEsc(e.message)}</div>`;
  }
}

async function qmsDocDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الوثيقة؟')) return;
  try {
    await qmsFetch('/documents/delete', { method: 'POST', body: { id } });
    qmsLoadDocTable();
  } catch (e) {
    alert(e.message);
  }
}

// ============================================================
// مؤشرات الأداء (Quality KPIs)
// ============================================================

async function qmsLoadKpis() {
  const projectId = document.getElementById('qms-kpi-project').value.trim();
  const generalCards = document.getElementById('qms-kpi-general-cards');
  const ncrCards = document.getElementById('qms-kpi-ncr-cards');
  const ncrSevTbody = document.getElementById('qms-kpi-ncr-severity-tbody');
  const supplierTbody = document.getElementById('qms-kpi-supplier-tbody');
  const contractorTbody = document.getElementById('qms-kpi-contractor-tbody');

  generalCards.innerHTML = '<div class="result-card">جارٍ التحميل...</div>';
  try {
    const res = await qmsFetch('/kpis', { query: { projectId } });
    const { general, ncr_closure, supplier_performance, contractor_performance } = res.data;

    generalCards.innerHTML = `
      <div class="result-card"><div class="rc-label">نسبة نجاح الفحوصات</div><div class="rc-value">${general.inspection_pass_rate}%</div></div>
      <div class="result-card"><div class="rc-label">نسبة رفض الفحوصات</div><div class="rc-value">${general.inspection_rejection_rate}%</div></div>
      <div class="result-card"><div class="rc-label">نسبة نجاح الاختبارات</div><div class="rc-value">${general.test_pass_rate}%</div></div>
      <div class="result-card"><div class="rc-label">إجمالي الفحوصات المُنجزة</div><div class="rc-value">${general.total_inspections_done}</div></div>
    `;

    ncrCards.innerHTML = `
      <div class="result-card"><div class="rc-label">إجمالي NCR</div><div class="rc-value">${ncr_closure.total_ncrs}</div></div>
      <div class="result-card"><div class="rc-label">NCR مفتوحة</div><div class="rc-value">${ncr_closure.open_ncrs}</div></div>
      <div class="result-card"><div class="rc-label">NCR مغلقة</div><div class="rc-value">${ncr_closure.closed_ncrs}</div></div>
      <div class="result-card"><div class="rc-label">متوسط زمن الإغلاق (يوم)</div><div class="rc-value">${ncr_closure.avg_closure_days}</div></div>
      <div class="result-card"><div class="rc-label">نسبة الإغلاق خلال 30 يوماً</div><div class="rc-value">${ncr_closure.closure_within_30days_rate}%</div></div>
    `;

    const sevRows = Object.entries(ncr_closure.by_severity)
      .filter(([, v]) => v.count_closed > 0)
      .map(([, v]) => `<tr><td>${qmsEsc(v.label)}</td><td>${v.count_closed}</td><td>${v.avg_closure_days}</td></tr>`)
      .join('');
    ncrSevTbody.innerHTML = sevRows || '<tr><td colspan="3">لا توجد حالات مغلقة بعد</td></tr>';

    supplierTbody.innerHTML = supplier_performance.suppliers.length
      ? supplier_performance.suppliers.map(s => `
        <tr>
          <td>${qmsEsc(s.supplier_name)}</td>
          <td>${s.total_requests}</td>
          <td>${s.approved}</td>
          <td>${s.approved_with_comments}</td>
          <td>${s.rejected}</td>
          <td>${s.approval_rate}%</td>
          <td>${s.rejection_rate}%</td>
        </tr>`).join('')
      : '<tr><td colspan="7">لا توجد بيانات موردين بعد</td></tr>';

    contractorTbody.innerHTML = contractor_performance.contractors.length
      ? contractor_performance.contractors.map(c => `
        <tr>
          <td>${qmsEsc(c.contractor)}</td>
          <td>${c.total_inspections}</td>
          <td>${c.accepted_inspections}</td>
          <td>${c.conditional_inspections}</td>
          <td>${c.rejected_inspections}</td>
          <td>${c.inspection_pass_rate}%</td>
          <td>${c.ncr_count}</td>
          <td>${c.ncr_critical_count}</td>
        </tr>`).join('')
      : '<tr><td colspan="8">لا توجد بيانات مقاولين بعد</td></tr>';
  } catch (e) {
    generalCards.innerHTML = `<div class="alert alert-error">${qmsEsc(e.message)}</div>`;
  }
}

document.getElementById('qms-kpi-btn-load')?.addEventListener('click', () => qmsLoadKpis());

// ---------- تهيئة اللوحات عند فتحها من القائمة الجانبية ----------
document.querySelectorAll('[data-panel="qms-documents"]').forEach(el => {
  el.addEventListener('click', () => { qms5EnsureRefData().then(() => qmsLoadDocTable()); });
});
document.querySelectorAll('[data-panel="qms-kpis"]').forEach(el => {
  el.addEventListener('click', () => qmsLoadKpis());
});
