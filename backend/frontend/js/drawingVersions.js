// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 2/10: إدارة الإصدارات المتقدمة (رفع/سجل/مقارنة/استعادة)
// ============================================================

const DRAW_VER_API = '/api/drawings';
let drawVerCurrentDrawingId = null;
let drawVerListCache = [];

// ---------- فتح لوحة إصدارات مخطط معيّن (يُستدعى من زر "الإصدارات" في drawings.js) ----------
function drawOpenVersionsPanel(drawingId) {
  drawVerCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-versions"]');
  if (panelNav) panelNav.click();
  else drawVerRenderAll();
  drawVerRenderAll();
}

async function drawVerRenderAll() {
  if (!drawVerCurrentDrawingId) {
    const box = document.getElementById('draw-ver-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "الإصدارات"</div>';
    return;
  }
  await drawVerRenderHeader();
  await drawVerRenderList();
  drawVerPopulateCompareSelects();
}

async function drawVerRenderHeader() {
  const box = document.getElementById('draw-ver-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawVerCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>الإصدار الحالي</span><b>v${d.current_version}</b></div>
        <div class="mini-stat-row"><span>حجم الملف الحالي</span><b>${d.file_size_human}</b></div>
        <div class="mini-stat-row"><span>حالة الاعتماد</span><b>${drawStatusLabel(d.approval_status)}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

// ---------- رفع إصدار جديد ----------
async function drawVerHandleUpload() {
  const btn = document.getElementById('btn-draw-ver-upload');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawVerCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const fileInput = document.getElementById('draw-ver-up-file');
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('الرجاء اختيار ملف الإصدار الجديد');

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    const contentBase64 = await drawFileToBase64(file);
    const ext = file.name.split('.').pop().toLowerCase();

    const payload = {
      drawing_id: drawVerCurrentDrawingId,
      content_base64: contentBase64,
      file_type: ext,
      change_note: document.getElementById('draw-ver-up-note')?.value?.trim() || null,
    };

    const res = await drawFetch('/versions/upload', { method: 'POST', body: payload });
    drawAlert('draw-ver-upload-alert', `تم رفع الإصدار الجديد بنجاح: v${res.version.version_number}`, 'success');

    const noteEl = document.getElementById('draw-ver-up-note');
    if (noteEl) noteEl.value = '';
    if (fileInput) fileInput.value = '';

    drawVerRenderAll();
    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-ver-upload-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ---------- سجل الإصدارات ----------
async function drawVerRenderList() {
  const container = document.getElementById('draw-ver-list-table');
  if (!container) return;
  if (!drawVerCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch(`/versions/list?drawing_id=${encodeURIComponent(drawVerCurrentDrawingId)}`);
    drawVerListCache = res.versions;

    if (!drawVerListCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد إصدارات مسجلة</div>';
      return;
    }

    const rows = drawVerListCache.map((v) => `
      <tr>
        <td>v${v.version_number}${v.is_restore ? ' (استعادة)' : ''}</td>
        <td>${v.file_size_human}</td>
        <td>${v.uploaded_by || '-'}</td>
        <td>${new Date(v.uploaded_at).toLocaleString('ar-EG')}</td>
        <td>${v.change_note || '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="drawVerDownload(${v.version_number})">تنزيل</button>
          <button class="btn btn-sm btn-outline" onclick="drawVerRestore(${v.version_number})">استعادة</button>
        </td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>الإصدار</th><th>الحجم</th><th>رفعه</th><th>التاريخ</th><th>ملاحظة التغيير</th><th>إجراءات</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل سجل الإصدارات: ${e.message}</div>`;
  }
}

async function drawVerDownload(versionNumber) {
  try {
    const res = await drawFetch(`/versions/download?drawing_id=${encodeURIComponent(drawVerCurrentDrawingId)}&version=${versionNumber}`);
    drawDownloadBase64AsFile(res.content_base64, `${res.drawing_number}_v${res.version_number}.${res.file_type}`);
  } catch (e) {
    alert(`تعذّر تنزيل الإصدار: ${e.message}`);
  }
}

async function drawVerRestore(versionNumber) {
  if (!confirm(`هل تريد استعادة الإصدار v${versionNumber} ليصبح هو الإصدار الحالي؟ سيتم إنشاء إصدار جديد بنفس محتواه.`)) return;
  try {
    await drawFetch('/versions/restore', { method: 'POST', body: { drawing_id: drawVerCurrentDrawingId, version: versionNumber } });
    drawVerRenderAll();
    drawRenderDashboard();
  } catch (e) {
    alert(`تعذّر استعادة الإصدار: ${e.message}`);
  }
}

// ---------- مقارنة إصدارين ----------
function drawVerPopulateCompareSelects() {
  const selA = document.getElementById('draw-ver-cmp-a');
  const selB = document.getElementById('draw-ver-cmp-b');
  if (!selA || !selB) return;
  const options = drawVerListCache
    .map((v) => `<option value="${v.version_number}">v${v.version_number}</option>`).join('');
  selA.innerHTML = options;
  selB.innerHTML = options;
  if (drawVerListCache.length) {
    selA.value = drawVerListCache[drawVerListCache.length - 1].version_number;
    selB.value = drawVerListCache[0].version_number;
  }
}

async function drawVerHandleCompare() {
  const resultBox = document.getElementById('draw-ver-cmp-result');
  if (!resultBox) return;
  try {
    const versionA = document.getElementById('draw-ver-cmp-a')?.value;
    const versionB = document.getElementById('draw-ver-cmp-b')?.value;
    if (!versionA || !versionB) throw new Error('الرجاء اختيار إصدارين للمقارنة');

    resultBox.innerHTML = '<div class="loading-spinner"></div>';
    const q = `drawing_id=${encodeURIComponent(drawVerCurrentDrawingId)}&version_a=${versionA}&version_b=${versionB}`;
    const res = await drawFetch(`/versions/compare?${q}`);

    resultBox.innerHTML = `
      <div class="dashboard-block">
        <div class="mini-stat-row"><span>النتيجة</span><b>${res.summary}</b></div>
        <div class="mini-stat-row"><span>فرق الحجم</span><b>${res.size_diff_human}</b></div>
        <div class="mini-stat-row"><span>v${res.version_a.version_number} — الحجم</span><b>${res.version_a.file_size_human}</b></div>
        <div class="mini-stat-row"><span>v${res.version_a.version_number} — رفعه</span><b>${res.version_a.uploaded_by || '-'}</b></div>
        <div class="mini-stat-row"><span>v${res.version_b.version_number} — الحجم</span><b>${res.version_b.file_size_human}</b></div>
        <div class="mini-stat-row"><span>v${res.version_b.version_number} — رفعه</span><b>${res.version_b.uploaded_by || '-'}</b></div>
      </div>`;
  } catch (e) {
    resultBox.innerHTML = `<div class="alert alert-error">تعذّرت المقارنة: ${e.message}</div>`;
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const uploadBtn = document.getElementById('btn-draw-ver-upload');
  if (uploadBtn) uploadBtn.addEventListener('click', drawVerHandleUpload);

  const compareBtn = document.getElementById('btn-draw-ver-compare');
  if (compareBtn) compareBtn.addEventListener('click', drawVerHandleCompare);

  document.querySelectorAll('.nav-item[data-panel="draw-versions"]').forEach((el) => {
    el.addEventListener('click', () => drawVerRenderAll());
  });
});
