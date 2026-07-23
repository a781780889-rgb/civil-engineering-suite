// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 5/10: مراجعة المخططات (Review Workflow)
// ============================================================

let drawReviewsCurrentDrawingId = null;

const DRAW_REVIEW_DECISION_LABELS_AR = {
  submitted: 'إرسال للمراجعة',
  engineering_review: 'مراجعة هندسية',
  approved: 'اعتماد',
  rejected: 'رفض',
  returned_to_designer: 'إعادة للمصمم',
  final_approval: 'اعتماد نهائي',
};

// ---------- فتح لوحة المراجعة لمخطط معيّن (يُستدعى من زر "مراجعة" في drawings.js) ----------
function drawOpenReviewsPanel(drawingId) {
  drawReviewsCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-reviews"]');
  if (panelNav) panelNav.click();
  else drawReviewsRenderAll();
  drawReviewsRenderAll();
}

async function drawReviewsRenderAll() {
  if (!drawReviewsCurrentDrawingId) {
    const box = document.getElementById('draw-reviews-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "مراجعة"</div>';
    const table = document.getElementById('draw-reviews-table');
    if (table) table.innerHTML = '';
    return;
  }
  await drawReviewsRenderHeader();
  await drawReviewsRenderList();
}

async function drawReviewsRenderHeader() {
  const box = document.getElementById('draw-reviews-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawReviewsCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>التخصص</span><b>${drawDisciplineLabel(d.discipline)}</b></div>
        <div class="mini-stat-row"><span>حالة الاعتماد</span><span class="${DRAW_STATUS_BADGE_CLASS[d.approval_status] || ''}">${drawStatusLabel(d.approval_status)}</span></div>
        <div class="mini-stat-row"><span>المراجع</span><b>${d.reviewer || '-'}</b></div>
        <div class="mini-stat-row"><span>المعتمد</span><b>${d.approver || '-'}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

// ---------- إجراء عام لكل أزرار سير المراجعة ----------
async function drawReviewsRunAction(btnId, endpoint, { requireNote = false, requirePerson = false, personField = null } = {}) {
  const btn = document.getElementById(btnId);
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawReviewsCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const note = document.getElementById('draw-review-note')?.value?.trim() || null;
    const person = document.getElementById('draw-review-person')?.value?.trim() || null;
    if (requireNote && !note) throw new Error('الرجاء إدخال ملاحظة/سبب لهذا الإجراء');
    if (requirePerson && !person) throw new Error('الرجاء إدخال اسم المراجع/المعتمد لهذا الإجراء');

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    const body = { drawing_id: drawReviewsCurrentDrawingId, note };
    if (personField) body[personField] = person;

    await drawFetch(endpoint, { method: 'POST', body });

    drawAlert('draw-reviews-alert', 'تم تنفيذ الإجراء بنجاح', 'success');
    const noteEl = document.getElementById('draw-review-note');
    if (noteEl) noteEl.value = '';

    await drawReviewsRenderAll();
    drawRenderList();
    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-reviews-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ---------- سرد سجل المراجعات ----------
async function drawReviewsRenderList() {
  const container = document.getElementById('draw-reviews-table');
  if (!container) return;
  if (!drawReviewsCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch(`/reviews/list?drawing_id=${encodeURIComponent(drawReviewsCurrentDrawingId)}`);

    if (!res.reviews.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد مراجعات مسجّلة على هذا المخطط بعد</div>';
      return;
    }

    const rows = res.reviews.map((r) => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString('ar')}</td>
        <td>${DRAW_REVIEW_DECISION_LABELS_AR[r.decision] || r.decision}</td>
        <td>${r.actor || '-'}</td>
        <td>${r.note || '-'}</td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>القرار</th><th>بواسطة</th><th>الملاحظة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل سجل المراجعات: ${e.message}</div>`;
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const submitBtn = document.getElementById('btn-draw-review-submit');
  if (submitBtn) submitBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-submit', '/reviews/submit', { personField: 'reviewer' }));

  const engBtn = document.getElementById('btn-draw-review-engineering');
  if (engBtn) engBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-engineering', '/reviews/engineering-review', { requireNote: true }));

  const approveBtn = document.getElementById('btn-draw-review-approve');
  if (approveBtn) approveBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-approve', '/reviews/approve', { personField: 'approver' }));

  const rejectBtn = document.getElementById('btn-draw-review-reject');
  if (rejectBtn) rejectBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-reject', '/reviews/reject', { requireNote: true }));

  const returnBtn = document.getElementById('btn-draw-review-return');
  if (returnBtn) returnBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-return', '/reviews/return-to-designer', { requireNote: true }));

  const finalBtn = document.getElementById('btn-draw-review-final');
  if (finalBtn) finalBtn.addEventListener('click', () => drawReviewsRunAction('btn-draw-review-final', '/reviews/final-approve', { personField: 'approver' }));

  document.querySelectorAll('.nav-item[data-panel="draw-reviews"]').forEach((el) => {
    el.addEventListener('click', () => drawReviewsRenderAll());
  });
});
