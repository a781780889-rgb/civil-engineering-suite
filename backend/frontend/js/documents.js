// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (Document Management System)
// الجزء 1/10: البنية الأساسية + لوحة التحكم + رفع/عرض/بحث/تنزيل المستندات
//             + إدارة الإصدارات الأساسية
// ============================================================

const DMS_API = '/api/dms';
let DMS_REF = null;
let dmsCurrentDocId = null;
let dmsDocsCache = [];

// ---------- أدوات عامة ----------
function dmsFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_API}${pathStr}`;
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

function dmsFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dmsDownloadBase64AsFile(base64, fileName) {
  const link = document.createElement('a');
  link.href = `data:application/octet-stream;base64,${base64}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function dmsLoadReferenceData() {
  try {
    const res = await dmsFetch('/reference-data');
    DMS_REF = res.data;
    dmsPopulateTypeSelects();
  } catch (e) {
    console.error('فشل تحميل بيانات مرجع إدارة المستندات', e);
  }
}
dmsLoadReferenceData();

function dmsPopulateTypeSelects() {
  if (!DMS_REF) return;
  const typeSelects = document.querySelectorAll('.dms-doc-type-select');
  const options = Object.entries(DMS_REF.document_types)
    .map(([key, def]) => `<option value="${key}">${def.label} (${DMS_REF.document_group_labels[def.group]})</option>`)
    .join('');
  typeSelects.forEach((sel) => {
    const keepFirst = sel.dataset.keepFirstOption === 'true';
    sel.innerHTML = (keepFirst ? sel.querySelector('option')?.outerHTML || '' : '') + options;
  });

  const statusSelects = document.querySelectorAll('.dms-status-select');
  const statusOptions = DMS_REF.document_statuses
    .map((s) => `<option value="${s}">${DMS_REF.document_status_labels[s]}</option>`).join('');
  statusSelects.forEach((sel) => {
    const keepFirst = sel.dataset.keepFirstOption === 'true';
    sel.innerHTML = (keepFirst ? sel.querySelector('option')?.outerHTML || '' : '') + statusOptions;
  });

  const groupSelects = document.querySelectorAll('.dms-group-select');
  const groupOptions = DMS_REF.document_groups
    .map((g) => `<option value="${g}">${DMS_REF.document_group_labels[g]}</option>`).join('');
  groupSelects.forEach((sel) => {
    const keepFirst = sel.dataset.keepFirstOption === 'true';
    sel.innerHTML = (keepFirst ? sel.querySelector('option')?.outerHTML || '' : '') + groupOptions;
  });
}

const DMS_STATUS_BADGE_CLASS = {
  draft: 'dms-badge', under_review: 'dms-badge dms-badge-warning', approved: 'dms-badge dms-badge-success',
  rejected: 'dms-badge dms-badge-danger', published: 'dms-badge dms-badge-success', archived: 'dms-badge',
};

// ============================================================
// لوحة التحكم
// ============================================================
async function dmsLoadDashboard() {
  const cardsEl = document.getElementById('dms-dash-cards');
  const recentDocsEl = document.getElementById('dms-recent-documents');
  const recentEditsEl = document.getElementById('dms-recent-edits');
  const recentApprovalsEl = document.getElementById('dms-recent-approvals');
  const alertsEl = document.getElementById('dms-dash-alerts');
  if (!cardsEl) return;
  cardsEl.innerHTML = '<div class="result-card">جارِ التحميل...</div>';
  try {
    const { data } = await dmsFetch('/dashboard');
    const card = (value, label) => `<div class="result-card"><div class="label">${label}</div><div class="value">${value}</div></div>`;
    cardsEl.innerHTML = [
      card(data.total_documents, 'إجمالي المستندات'),
      card(data.total_projects_linked, 'المشاريع المرتبطة'),
      card(data.new_documents_7d, 'ملفات جديدة (7 أيام)'),
      card(data.archived_documents, 'الملفات المؤرشفة'),
      card(data.under_review_documents, 'قيد المراجعة'),
      card(data.approved_documents, 'معتمدة'),
      card(data.rejected_documents, 'مرفوضة'),
      card(data.total_versions, 'إجمالي الإصدارات'),
      card(data.active_users, 'مستخدمون نشطون'),
    ].join('');
    if (alertsEl) {
      alertsEl.innerHTML = data.alerts.length
        ? data.alerts.map((a) => `<div class="alert-info">${a.message}</div>`).join('')
        : '';
    }
    if (recentDocsEl) {
      recentDocsEl.innerHTML = data.recent_documents.length
        ? data.recent_documents.map((d) => `
          <div class="pm-activity-item">
            <strong>${d.document_number}</strong> — ${d.title}
            <span class="${DMS_STATUS_BADGE_CLASS[d.status] || 'dms-badge'}">${DMS_REF?.document_status_labels?.[d.status] || d.status}</span>
            <span class="ts">${new Date(d.created_at).toLocaleString('ar-SA')}</span>
          </div>`).join('')
        : '<div class="pm-activity-item">لا توجد مستندات بعد</div>';
    }
    if (recentEditsEl) {
      recentEditsEl.innerHTML = data.recent_edits.length
        ? data.recent_edits.map((a) => `
          <div class="pm-activity-item">
            <strong>${a.action}</strong> — ${a.details?.file_name || a.entity_id}
            <span class="ts">${new Date(a.created_at).toLocaleString('ar-SA')}</span>
          </div>`).join('')
        : '<div class="pm-activity-item">لا توجد تعديلات مسجّلة بعد</div>';
    }
    if (recentApprovalsEl) {
      recentApprovalsEl.innerHTML = data.recent_approvals.length
        ? data.recent_approvals.map((a) => `
          <div class="pm-activity-item">
            <strong>${a.action}</strong> — ${a.entity_id}
            <span class="ts">${new Date(a.created_at).toLocaleString('ar-SA')}</span>
          </div>`).join('')
        : '<div class="pm-activity-item">لا توجد موافقات بعد (تُفعَّل ضمن الجزء 3/10)</div>';
    }
  } catch (e) {
    cardsEl.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

// ============================================================
// قائمة المستندات + البحث + الفلاتر
// ============================================================
async function dmsLoadDocuments() {
  const tbody = document.getElementById('dms-docs-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">جارِ التحميل...</td></tr>';
  try {
    const query = {
      search: document.getElementById('dms-search')?.value || null,
      doc_type: document.getElementById('dms-filter-type')?.value || null,
      group: document.getElementById('dms-filter-group')?.value || null,
      status: document.getElementById('dms-filter-status')?.value || null,
    };
    const { data } = await dmsFetch('/documents', { query });
    dmsDocsCache = data;
    tbody.innerHTML = data.length ? data.map((d) => `
      <tr>
        <td>${d.document_number}</td>
        <td>${d.title}</td>
        <td>${d.doc_type_label}</td>
        <td>v${d.current_version_number}</td>
        <td><span class="${DMS_STATUS_BADGE_CLASS[d.status] || 'badge'}">${DMS_REF?.document_status_labels?.[d.status] || d.status}</span></td>
        <td>${new Date(d.updated_at).toLocaleDateString('ar-SA')}</td>
        <td>
          <button class="btn btn-sm" data-dms-view="${d.id}">عرض</button>
          <button class="btn btn-sm" data-dms-download="${d.id}">تنزيل</button>
          <button class="btn btn-sm btn-danger" data-dms-archive="${d.id}">أرشفة</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="7">لا توجد مستندات مطابقة</td></tr>';

    tbody.querySelectorAll('[data-dms-view]').forEach((btn) => {
      btn.addEventListener('click', () => dmsViewDocument(btn.dataset.dmsView));
    });
    tbody.querySelectorAll('[data-dms-download]').forEach((btn) => {
      btn.addEventListener('click', () => dmsDownloadCurrent(btn.dataset.dmsDownload));
    });
    tbody.querySelectorAll('[data-dms-archive]').forEach((btn) => {
      btn.addEventListener('click', () => dmsArchiveDocument(btn.dataset.dmsArchive));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

async function dmsDownloadCurrent(docId) {
  try {
    const { data } = await dmsFetch(`/documents/download`, { query: { id: docId } });
    dmsDownloadBase64AsFile(data.content_base64, data.file_name);
  } catch (e) {
    alert(`تعذّر تنزيل الملف: ${e.message}`);
  }
}

async function dmsArchiveDocument(docId) {
  if (!confirm('هل تريد أرشفة هذا المستند؟')) return;
  try {
    await dmsFetch('/documents/delete', { method: 'POST', body: { id: docId, hard_delete: false } });
    dmsLoadDocuments();
  } catch (e) {
    alert(`تعذّرت الأرشفة: ${e.message}`);
  }
}

// ============================================================
// رفع مستند جديد
// ============================================================
function dmsResetUploadForm() {
  const form = document.getElementById('dms-upload-form');
  if (form) form.reset();
  const errEl = document.getElementById('dms-upload-error');
  if (errEl) errEl.textContent = '';
}

async function dmsSubmitUpload(event) {
  event.preventDefault();
  const errEl = document.getElementById('dms-upload-error');
  errEl.textContent = '';
  try {
    const fileInput = document.getElementById('dms-f-file');
    const file = fileInput.files[0];
    if (!file) throw new Error('يجب اختيار ملف للرفع');
    const content_base64 = await dmsFileToBase64(file);

    const keywordsRaw = document.getElementById('dms-f-keywords').value || '';
    const payload = {
      title: document.getElementById('dms-f-title').value,
      doc_type: document.getElementById('dms-f-type').value,
      project_id: document.getElementById('dms-f-project').value || null,
      department: document.getElementById('dms-f-department').value || null,
      description: document.getElementById('dms-f-description').value || null,
      keywords: keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean),
      file_name: file.name,
      content_base64,
      author: document.getElementById('dms-f-author').value || null,
    };
    await dmsFetch('/documents', { method: 'POST', body: payload });
    dmsResetUploadForm();
    dmsLoadDocuments();
    dmsLoadDashboard();
    alert('تم رفع المستند بنجاح');
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ============================================================
// عرض تفاصيل مستند + الإصدارات
// ============================================================
async function dmsViewDocument(docId) {
  dmsCurrentDocId = docId;
  const panel = document.getElementById('dms-detail-panel');
  if (!panel) return;
  panel.style.display = '';
  panel.innerHTML = '<div class="result-card">جارِ التحميل...</div>';
  try {
    const { data } = await dmsFetch('/documents/get', { query: { id: docId } });
    panel.innerHTML = `
      <div class="calc-card">
        <h3>${data.title} <span class="${DMS_STATUS_BADGE_CLASS[data.status] || 'badge'}">${DMS_REF?.document_status_labels?.[data.status] || data.status}</span></h3>
        <p><strong>رقم المستند:</strong> ${data.document_number} — <strong>النوع:</strong> ${data.doc_type_label}</p>
        <p><strong>المشروع:</strong> ${data.project_name || '-'} — <strong>القسم:</strong> ${data.department || '-'}</p>
        <p><strong>الوصف:</strong> ${data.description || '-'}</p>
        <p><strong>الكلمات المفتاحية:</strong> ${data.keywords.join('، ') || '-'}</p>
        <p><strong>المؤلف:</strong> ${data.author || '-'} — <strong>آخر تحديث:</strong> ${new Date(data.updated_at).toLocaleString('ar-SA')}</p>

        <h4 style="margin-top:16px">سير عمل الاعتماد (الجزء 3/10)</h4>
        <div id="dms-doc-wf-panel" class="pm-activity-log" style="margin-bottom:12px">جارِ تحميل حالة سير العمل...</div>

        <h4 style="margin-top:16px">رفع إصدار جديد</h4>
        <div class="toolbar" style="flex-wrap:wrap">
          <input type="file" id="dms-new-version-file" />
          <input type="text" id="dms-new-version-note" placeholder="ملاحظة التعديل (اختياري)" />
          <button class="btn btn-primary" id="dms-btn-upload-version">رفع إصدار جديد</button>
        </div>
        <div id="dms-version-error" style="color:#c0392b"></div>

        <h4 style="margin-top:16px">سجل الإصدارات (${data.versions.length})</h4>
        <table class="data-table">
          <thead><tr><th>الإصدار</th><th>اسم الملف</th><th>الحجم</th><th>بواسطة</th><th>التاريخ</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>
            ${data.versions.map((v) => `
              <tr>
                <td>v${v.version_number}${v.is_current ? ' (الحالي)' : ''}</td>
                <td>${v.file_name}</td>
                <td>${v.file_size_human}</td>
                <td>${v.uploaded_by || '-'}</td>
                <td>${new Date(v.uploaded_at).toLocaleString('ar-SA')}</td>
                <td>${v.change_note || '-'}</td>
                <td>
                  <button class="btn btn-sm" data-dms-dl-version="${v.id}">تنزيل</button>
                  ${!v.is_current ? `<button class="btn btn-sm" data-dms-restore-version="${v.id}">استعادة</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        <button class="btn" id="dms-btn-close-detail" style="margin-top:12px">إغلاق</button>
      </div>
    `;

    document.getElementById('dms-btn-close-detail').addEventListener('click', () => { panel.style.display = 'none'; });
    document.getElementById('dms-btn-upload-version').addEventListener('click', () => dmsUploadNewVersion(docId));
    panel.querySelectorAll('[data-dms-dl-version]').forEach((btn) => {
      btn.addEventListener('click', () => dmsDownloadSpecificVersion(docId, btn.dataset.dmsDlVersion));
    });
    panel.querySelectorAll('[data-dms-restore-version]').forEach((btn) => {
      btn.addEventListener('click', () => dmsRestoreVersion(docId, btn.dataset.dmsRestoreVersion));
    });
    dmsLoadDocWorkflowPanel(docId);
  } catch (e) {
    panel.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsDownloadSpecificVersion(docId, versionId) {
  try {
    const { data } = await dmsFetch('/documents/download', { query: { id: docId, versionId } });
    dmsDownloadBase64AsFile(data.content_base64, data.file_name);
  } catch (e) {
    alert(`تعذّر تنزيل الإصدار: ${e.message}`);
  }
}

async function dmsUploadNewVersion(docId) {
  const errEl = document.getElementById('dms-version-error');
  errEl.textContent = '';
  try {
    const fileInput = document.getElementById('dms-new-version-file');
    const file = fileInput.files[0];
    if (!file) throw new Error('يجب اختيار ملف الإصدار الجديد');
    const content_base64 = await dmsFileToBase64(file);
    const change_note = document.getElementById('dms-new-version-note').value || null;
    await dmsFetch('/documents/versions', {
      method: 'POST',
      body: { document_id: docId, file_name: file.name, content_base64, change_note },
    });
    dmsViewDocument(docId);
    dmsLoadDocuments();
    dmsLoadDashboard();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function dmsRestoreVersion(docId, versionId) {
  if (!confirm('هل تريد استعادة هذا الإصدار كإصدار حالي جديد؟')) return;
  try {
    await dmsFetch('/documents/versions/restore', { method: 'POST', body: { document_id: docId, version_id: versionId } });
    dmsViewDocument(docId);
    dmsLoadDocuments();
    dmsLoadDashboard();
  } catch (e) {
    alert(`تعذّرت الاستعادة: ${e.message}`);
  }
}

// ============================================================
// الجزء 3/10: سير عمل الاعتماد (Workflow)
// ============================================================

const DMS_WF_STAGE_BADGE = {
  approved: 'dms-badge dms-badge-success',
  rejected: 'dms-badge dms-badge-danger',
};

/** يعرض داخل تفاصيل المستند: المرحلة الحالية + أزرار اعتماد/رفض/نشر + سجل القرارات */
async function dmsLoadDocWorkflowPanel(docId) {
  const el = document.getElementById('dms-doc-wf-panel');
  if (!el) return;
  el.innerHTML = 'جارِ تحميل حالة سير العمل...';
  try {
    const { data } = await dmsFetch('/documents/workflow/status', { query: { id: docId } });
    const stageLine = data.is_complete
      ? '<div class="alert-info">اكتملت جميع مراحل سير العمل لهذا المستند.</div>'
      : `<p><strong>المرحلة الحالية المستحقة:</strong> ${data.current_stage.label} (${data.current_stage.key})</p>`;

    const historyRows = data.history.length
      ? data.history.map((h) => `
        <tr>
          <td>${h.stage_label}</td>
          <td><span class="${DMS_WF_STAGE_BADGE[h.decision] || 'dms-badge'}">${h.decision === 'approved' ? 'معتمد' : 'مرفوض'}</span></td>
          <td>${h.actor}</td>
          <td>${h.comments || '-'}</td>
          <td>${new Date(h.decided_at).toLocaleString('ar-SA')}</td>
        </tr>`).join('')
      : '<tr><td colspan="5">لا يوجد سجل قرارات بعد لهذا المستند</td></tr>';

    el.innerHTML = `
      <p><strong>سير العمل:</strong> ${data.workflow_name} — <strong>حالة المستند:</strong> ${DMS_REF?.document_status_labels?.[data.document_status] || data.document_status}</p>
      ${stageLine}
      <div class="toolbar" style="flex-wrap:wrap;margin:8px 0">
        <input type="text" id="dms-wf-actor" placeholder="اسمك (المعتمِد)">
        <input type="text" id="dms-wf-comments" placeholder="ملاحظات (إلزامي عند الرفض)">
        <button class="btn btn-primary" id="dms-wf-btn-approve" ${data.is_complete ? 'disabled' : ''}>اعتماد المرحلة الحالية</button>
        <button class="btn" id="dms-wf-btn-reject" ${data.is_complete ? 'disabled' : ''}>رفض المرحلة الحالية</button>
        ${data.document_status === 'approved' ? '<button class="btn btn-primary" id="dms-wf-btn-publish">نشر المستند</button>' : ''}
        ${data.document_status === 'rejected' ? '<button class="btn" id="dms-wf-btn-resubmit">إعادة تقديم للمراجعة</button>' : ''}
      </div>
      <div id="dms-wf-action-error" style="color:#c0392b"></div>
      <table class="data-table" style="margin-top:8px">
        <thead><tr><th>المرحلة</th><th>القرار</th><th>بواسطة</th><th>ملاحظات</th><th>التاريخ</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    `;

    const approveBtn = document.getElementById('dms-wf-btn-approve');
    if (approveBtn) approveBtn.addEventListener('click', () => dmsWfDecide(docId, 'approve'));
    const rejectBtn = document.getElementById('dms-wf-btn-reject');
    if (rejectBtn) rejectBtn.addEventListener('click', () => dmsWfDecide(docId, 'reject'));
    const publishBtn = document.getElementById('dms-wf-btn-publish');
    if (publishBtn) publishBtn.addEventListener('click', () => dmsWfPublish(docId));
    const resubmitBtn = document.getElementById('dms-wf-btn-resubmit');
    if (resubmitBtn) resubmitBtn.addEventListener('click', () => dmsWfResubmit(docId));
  } catch (e) {
    // إن لم يبدأ سير العمل بعد لهذا المستند، نعرض زر بدء بدلاً من رسالة خطأ فقط
    el.innerHTML = `
      <p style="color:#c0392b">${e.message}</p>
      <button class="btn btn-primary" id="dms-wf-btn-start-inline">بدء سير عمل الاعتماد لهذا المستند</button>
    `;
    const startBtn = document.getElementById('dms-wf-btn-start-inline');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        try {
          await dmsFetch('/documents/workflow/start', { method: 'POST', body: { document_id: docId } });
          dmsLoadDocWorkflowPanel(docId);
        } catch (err) {
          el.innerHTML = `<p style="color:#c0392b">${err.message}</p>`;
        }
      });
    }
  }
}

async function dmsWfDecide(docId, action) {
  const errEl = document.getElementById('dms-wf-action-error');
  errEl.textContent = '';
  try {
    const actor = document.getElementById('dms-wf-actor').value || null;
    const comments = document.getElementById('dms-wf-comments').value || '';
    if (!actor) throw new Error('يجب إدخال اسم المعتمِد');
    await dmsFetch(`/documents/workflow/${action}`, {
      method: 'POST', body: { document_id: docId, actor, comments },
    });
    dmsLoadDocWorkflowPanel(docId);
    dmsLoadDocuments();
    dmsLoadDashboard();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function dmsWfPublish(docId) {
  const errEl = document.getElementById('dms-wf-action-error');
  errEl.textContent = '';
  try {
    const actor = document.getElementById('dms-wf-actor').value || null;
    await dmsFetch('/documents/workflow/publish', { method: 'POST', body: { document_id: docId, actor } });
    dmsLoadDocWorkflowPanel(docId);
    dmsLoadDocuments();
    dmsLoadDashboard();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function dmsWfResubmit(docId) {
  const errEl = document.getElementById('dms-wf-action-error');
  errEl.textContent = '';
  try {
    const actor = document.getElementById('dms-wf-actor').value || null;
    await dmsFetch('/documents/workflow/resubmit', { method: 'POST', body: { document_id: docId, actor } });
    dmsLoadDocWorkflowPanel(docId);
    dmsLoadDocuments();
    dmsLoadDashboard();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ---------- صندوق الموافقات المعلّقة ----------
async function dmsLoadPendingApprovals() {
  const tbody = document.getElementById('dms-pending-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6">جارِ التحميل...</td></tr>';
  try {
    const projectId = document.getElementById('dms-wf-filter-project')?.value || null;
    const { data } = await dmsFetch('/approvals/pending', { query: { projectId } });
    tbody.innerHTML = data.length ? data.map((p) => `
      <tr>
        <td>${p.document_number}</td>
        <td>${p.title}</td>
        <td>${p.doc_type_label}</td>
        <td>${p.current_stage.label}</td>
        <td>${new Date(p.waiting_since).toLocaleString('ar-SA')}</td>
        <td><button class="btn btn-sm" data-dms-wf-view="${p.document_id}">فتح</button></td>
      </tr>`).join('') : '<tr><td colspan="6">لا توجد مستندات بانتظار الاعتماد حالياً</td></tr>';

    tbody.querySelectorAll('[data-dms-wf-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('dms-wf-doc-id').value = btn.dataset.dmsWfView;
        dmsLoadWfStatusStandalone();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

async function dmsLoadWfStatusStandalone() {
  const docId = document.getElementById('dms-wf-doc-id')?.value;
  const panel = document.getElementById('dms-wf-status-panel');
  if (!docId || !panel) return;
  panel.innerHTML = 'جارِ التحميل...';
  try {
    const { data } = await dmsFetch('/documents/workflow/status', { query: { id: docId } });
    panel.innerHTML = `
      <p><strong>سير العمل:</strong> ${data.workflow_name}</p>
      <p><strong>حالة المستند:</strong> ${DMS_REF?.document_status_labels?.[data.document_status] || data.document_status}</p>
      <p><strong>المرحلة الحالية:</strong> ${data.is_complete ? 'اكتملت جميع المراحل' : `${data.current_stage.label} (${data.current_stage.key})`}</p>
      <p style="color:#666">لاتخاذ قرار اعتماد/رفض أو رفع إصدار جديد، افتح المستند من قائمة "جميع المستندات والبحث".</p>
    `;
  } catch (e) {
    panel.innerHTML = `<p style="color:#c0392b">${e.message}</p>`;
  }
}

async function dmsStartWorkflowStandalone() {
  const docId = document.getElementById('dms-wf-doc-id')?.value;
  if (!docId) return;
  try {
    await dmsFetch('/documents/workflow/start', { method: 'POST', body: { document_id: docId } });
    dmsLoadWfStatusStandalone();
  } catch (e) {
    const panel = document.getElementById('dms-wf-status-panel');
    if (panel) panel.innerHTML = `<p style="color:#c0392b">${e.message}</p>`;
  }
}

async function dmsLoadActiveWorkflowForType() {
  const docType = document.getElementById('dms-wf-def-type')?.value;
  const viewEl = document.getElementById('dms-wf-active-view');
  if (!docType || !viewEl) return;
  viewEl.innerHTML = 'جارِ التحميل...';
  try {
    const { data } = await dmsFetch('/workflows/active', { query: { docType } });
    viewEl.innerHTML = `
      <p><strong>${data.name}</strong> ${data.is_default ? '(افتراضي - غير مخصَّص)' : ''}</p>
      <ol>${data.stages.map((s) => `<li>${s.label} — عند الاعتماد: ${DMS_REF?.document_status_labels?.[s.resulting_status] || s.resulting_status}، عند الرفض: ${DMS_REF?.document_status_labels?.[s.on_reject_status] || s.on_reject_status}</li>`).join('')}</ol>
    `;
  } catch (e) {
    viewEl.innerHTML = `<p style="color:#c0392b">${e.message}</p>`;
  }
}

// ============================================================
// ربط الأزرار عند تحميل الصفحة
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const uploadForm = document.getElementById('dms-upload-form');
  if (uploadForm) uploadForm.addEventListener('submit', dmsSubmitUpload);

  const loadDashBtn = document.getElementById('dms-btn-load-dashboard');
  if (loadDashBtn) loadDashBtn.addEventListener('click', dmsLoadDashboard);

  const searchBtn = document.getElementById('dms-btn-search');
  if (searchBtn) searchBtn.addEventListener('click', dmsLoadDocuments);

  const refreshBtn = document.getElementById('dms-btn-refresh-list');
  if (refreshBtn) refreshBtn.addEventListener('click', dmsLoadDocuments);

  const pendingBtn = document.getElementById('dms-btn-refresh-pending');
  if (pendingBtn) pendingBtn.addEventListener('click', dmsLoadPendingApprovals);

  const loadWfStatusBtn = document.getElementById('dms-btn-load-wf-status');
  if (loadWfStatusBtn) loadWfStatusBtn.addEventListener('click', dmsLoadWfStatusStandalone);

  const startWfBtn = document.getElementById('dms-btn-start-wf');
  if (startWfBtn) startWfBtn.addEventListener('click', dmsStartWorkflowStandalone);

  const loadActiveWfBtn = document.getElementById('dms-btn-load-active-wf');
  if (loadActiveWfBtn) loadActiveWfBtn.addEventListener('click', dmsLoadActiveWorkflowForType);
});
