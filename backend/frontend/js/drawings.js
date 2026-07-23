// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 1/10: البنية الأساسية + لوحة التحكم + رفع/عرض/بحث المخططات
// ============================================================

const DRAW_API = '/api/drawings';
let DRAW_TAXONOMY = null;
let drawListCache = [];

// ---------- أدوات عامة ----------
function drawFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DRAW_API}${pathStr}`;
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

function drawFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function drawDownloadBase64AsFile(base64, fileName) {
  const link = document.createElement('a');
  link.href = `data:application/octet-stream;base64,${base64}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function drawAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const cls = type === 'error' ? 'alert alert-error' : 'alert alert-success';
  el.innerHTML = `<div class="${cls}">${message}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 6000);
}

// ---------- تحميل بيانات التصنيف (تخصصات/أنواع فرعية/حالات) ----------
async function drawLoadTaxonomy() {
  try {
    const res = await drawFetch('/taxonomy');
    DRAW_TAXONOMY = res;
    drawPopulateDisciplineSelects();
  } catch (e) {
    console.error('فشل تحميل تصنيفات المخططات', e);
  }
}

function drawPopulateDisciplineSelects() {
  if (!DRAW_TAXONOMY) return;

  const upSelect = document.getElementById('draw-up-discipline');
  if (upSelect) {
    upSelect.innerHTML = DRAW_TAXONOMY.disciplines
      .map((d) => `<option value="${d.key}">${d.label_ar} (${d.label_en})</option>`).join('');
    drawUpdateSubtypeOptions(upSelect.value);
    upSelect.addEventListener('change', (e) => drawUpdateSubtypeOptions(e.target.value));
  }

  const filterSelect = document.getElementById('draw-list-discipline-filter');
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">كل التخصصات</option>'
      + DRAW_TAXONOMY.disciplines.map((d) => `<option value="${d.key}">${d.label_ar}</option>`).join('');
  }

  const statusFilter = document.getElementById('draw-list-status-filter');
  if (statusFilter) {
    statusFilter.innerHTML = '<option value="">كل الحالات</option>'
      + DRAW_TAXONOMY.approval_statuses.map((s) => `<option value="${s.key}">${s.label_ar}</option>`).join('');
  }
}

function drawUpdateSubtypeOptions(disciplineKey) {
  const subSelect = document.getElementById('draw-up-subtype');
  if (!subSelect || !DRAW_TAXONOMY) return;
  const disc = DRAW_TAXONOMY.disciplines.find((d) => d.key === disciplineKey);
  subSelect.innerHTML = disc
    ? disc.subtypes.map((s) => `<option value="${s.key}">${s.label_ar}</option>`).join('')
    : '';
}

const DRAW_STATUS_BADGE_CLASS = {
  draft: 'dms-badge', under_review: 'dms-badge dms-badge-warning',
  approved: 'dms-badge dms-badge-success', rejected: 'dms-badge dms-badge-error',
  superseded: 'dms-badge',
};

function drawStatusLabel(status) {
  return DRAW_TAXONOMY?.approval_statuses?.find((s) => s.key === status)?.label_ar || status;
}

function drawDisciplineLabel(key) {
  return DRAW_TAXONOMY?.disciplines?.find((d) => d.key === key)?.label_ar || key;
}

// ---------- لوحة التحكم ----------
async function drawRenderDashboard() {
  const body = document.getElementById('draw-dashboard-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch('/dashboard');
    const t = res.totals;

    const statCards = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${t.total_drawings}</div><div class="stat-label">إجمالي المخططات</div></div>
        <div class="stat-card"><div class="stat-value">${t.approved}</div><div class="stat-label">المخططات المعتمدة</div></div>
        <div class="stat-card"><div class="stat-value">${t.under_review}</div><div class="stat-label">قيد المراجعة</div></div>
        <div class="stat-card"><div class="stat-value">${t.rejected}</div><div class="stat-label">مرفوضة</div></div>
        <div class="stat-card"><div class="stat-value">${t.total_versions}</div><div class="stat-label">عدد الإصدارات</div></div>
        <div class="stat-card"><div class="stat-value">${t.total_projects}</div><div class="stat-label">عدد المشاريع</div></div>
        <div class="stat-card"><div class="stat-value">${t.total_reviews}</div><div class="stat-label">عدد المراجعات</div></div>
        <div class="stat-card"><div class="stat-value">${t.total_comments}</div><div class="stat-label">عدد التعليقات</div></div>
      </div>`;

    const byDiscipline = Object.entries(res.by_discipline)
      .map(([k, v]) => `<div class="mini-stat-row"><span>${drawDisciplineLabelFromTaxonomy(k, res)}</span><b>${v}</b></div>`)
      .join('');

    const recentList = (items, emptyMsg) => (items.length
      ? items.map((d) => `<div class="mini-list-row"><span>${d.drawing_number} - ${d.name}</span><span class="${DRAW_STATUS_BADGE_CLASS[d.approval_status] || ''}">${res.status_labels_ar[d.approval_status] || d.approval_status}</span></div>`).join('')
      : `<div class="mini-list-empty">${emptyMsg}</div>`);

    body.innerHTML = `
      ${statCards}
      <div class="dashboard-grid-2col">
        <div class="dashboard-block">
          <h4>إحصائيات حسب التخصص</h4>
          ${byDiscipline}
        </div>
        <div class="dashboard-block">
          <h4>آخر المخططات المضافة</h4>
          ${recentList(res.recent_drawings, 'لا توجد مخططات بعد')}
        </div>
        <div class="dashboard-block">
          <h4>آخر الاعتمادات</h4>
          ${recentList(res.recent_approvals, 'لا توجد اعتمادات بعد')}
        </div>
        <div class="dashboard-block">
          <h4>آخر التعديلات</h4>
          ${recentList(res.recent_edits, 'لا توجد تعديلات بعد')}
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="alert alert-error">تعذّر تحميل لوحة التحكم: ${e.message}</div>`;
  }
}

function drawDisciplineLabelFromTaxonomy(key, dashboardRes) {
  return dashboardRes?.discipline_labels?.[key]?.label_ar || key;
}

// ---------- رفع مخطط جديد ----------
async function drawHandleUpload() {
  const btn = document.getElementById('btn-draw-upload');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    const fileInput = document.getElementById('draw-up-file');
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('الرجاء اختيار ملف المخطط');

    const ext = file.name.split('.').pop().toLowerCase();
    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    const contentBase64 = await drawFileToBase64(file);

    const payload = {
      name: document.getElementById('draw-up-name')?.value?.trim(),
      discipline: document.getElementById('draw-up-discipline')?.value,
      subtype: document.getElementById('draw-up-subtype')?.value || null,
      project_id: document.getElementById('draw-up-project')?.value?.trim() || null,
      responsible_engineer: document.getElementById('draw-up-engineer')?.value?.trim() || null,
      designer: document.getElementById('draw-up-designer')?.value?.trim() || null,
      description: document.getElementById('draw-up-description')?.value?.trim() || null,
      keywords: document.getElementById('draw-up-keywords')?.value || null,
      file_type: ext,
      content_base64: contentBase64,
    };

    const res = await drawFetch('/create', { method: 'POST', body: payload });
    drawAlert('draw-upload-alert', `تم رفع المخطط بنجاح - الرقم المرجعي: ${res.drawing.drawing_number}`, 'success');

    ['draw-up-name', 'draw-up-project', 'draw-up-engineer', 'draw-up-designer', 'draw-up-description', 'draw-up-keywords'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (fileInput) fileInput.value = '';

    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-upload-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ---------- قائمة المخططات والبحث ----------
async function drawRenderList() {
  const container = document.getElementById('draw-list-table');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const query = {
      search: document.getElementById('draw-list-search')?.value?.trim() || null,
      discipline: document.getElementById('draw-list-discipline-filter')?.value || null,
      approval_status: document.getElementById('draw-list-status-filter')?.value || null,
    };
    const res = await drawFetch('/list', { query });
    drawListCache = res.drawings;

    if (!drawListCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد مخططات مطابقة</div>';
      return;
    }

    const rows = drawListCache.map((d) => `
      <tr>
        <td><input type="checkbox" onchange="drawViewToggleMultiSelect('${d.id}', this.checked)"></td>
        <td>${d.drawing_number}</td>
        <td>${d.name}</td>
        <td>${drawDisciplineLabel(d.discipline)}</td>
        <td>v${d.current_version}</td>
        <td><span class="${DRAW_STATUS_BADGE_CLASS[d.approval_status] || ''}">${drawStatusLabel(d.approval_status)}</span></td>
        <td>${d.file_size_human}</td>
        <td>${d.responsible_engineer || '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="drawDownload('${d.id}')">تنزيل</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenVersionsPanel('${d.id}')">الإصدارات</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenViewerPanel('${d.id}')">العارض</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenLayersPanel('${d.id}')">الطبقات</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenReviewsPanel('${d.id}')">مراجعة</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenCommentsPanel('${d.id}')">تعليقات</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenComparisonPanel('${d.id}')">مقارنة</button>
          <button class="btn btn-sm btn-outline" onclick="drawOpenApprovalsPanel('${d.id}')">اعتمادات</button>
          <button class="btn btn-sm btn-outline" onclick="drawDeleteDrawing('${d.id}')">حذف</button>
        </td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th></th><th>الرقم المرجعي</th><th>الاسم</th><th>التخصص</th><th>الإصدار</th>
            <th>الحالة</th><th>الحجم</th><th>المهندس المسؤول</th><th>إجراءات</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل قائمة المخططات: ${e.message}</div>`;
  }
}

async function drawDownload(drawingId) {
  try {
    const res = await drawFetch('/download', { query: { id: drawingId } });
    const record = drawListCache.find((d) => d.id === drawingId);
    const fileName = `${record?.drawing_number || drawingId}.${res.file_type}`;
    drawDownloadBase64AsFile(res.content_base64, fileName);
  } catch (e) {
    alert(`تعذّر تنزيل المخطط: ${e.message}`);
  }
}

async function drawDeleteDrawing(drawingId) {
  if (!confirm('هل أنت متأكد من حذف هذا المخطط؟')) return;
  try {
    await drawFetch('/delete', { method: 'POST', body: { id: drawingId } });
    drawRenderList();
    drawRenderDashboard();
  } catch (e) {
    alert(`تعذّر حذف المخطط: ${e.message}`);
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  drawLoadTaxonomy();

  const uploadBtn = document.getElementById('btn-draw-upload');
  if (uploadBtn) uploadBtn.addEventListener('click', drawHandleUpload);

  const refreshBtn = document.getElementById('btn-draw-list-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', drawRenderList);

  const searchInput = document.getElementById('draw-list-search');
  if (searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') drawRenderList(); });

  // تحديث لوحة التحكم والقائمة عند فتح تبويباتها (تماشياً مع آلية nav-item الحالية)
  document.querySelectorAll('.nav-item[data-panel="draw-dashboard"]').forEach((el) => {
    el.addEventListener('click', () => drawRenderDashboard());
  });
  document.querySelectorAll('.nav-item[data-panel="draw-list"]').forEach((el) => {
    el.addEventListener('click', () => drawRenderList());
  });
});
