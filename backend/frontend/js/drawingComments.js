// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 6/10: التعليقات والملاحظات
// ============================================================

let drawCommentsCurrentDrawingId = null;
let drawCommentsCache = [];

const DRAW_COMMENT_CATEGORY_LABELS_AR = {
  general: 'عام',
  correction_required: 'تصحيح مطلوب',
  question: 'سؤال',
  coordination: 'تنسيق بين تخصصات',
  clash: 'تعارض',
  approval_condition: 'شرط اعتماد',
  other: 'أخرى',
};

const DRAW_COMMENT_IMPL_STATUS_LABELS_AR = {
  not_started: 'لم يُنفَّذ',
  in_progress: 'قيد التنفيذ',
  implemented: 'منفَّذ',
};

// ---------- فتح لوحة التعليقات لمخطط معيّن (يُستدعى من زر "تعليقات" في drawings.js) ----------
function drawOpenCommentsPanel(drawingId) {
  drawCommentsCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-comments"]');
  if (panelNav) panelNav.click();
  else drawCommentsRenderAll();
  drawCommentsRenderAll();
}

async function drawCommentsRenderAll() {
  if (!drawCommentsCurrentDrawingId) {
    const box = document.getElementById('draw-comments-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "تعليقات"</div>';
    const list = document.getElementById('draw-comments-list');
    if (list) list.innerHTML = '';
    return;
  }
  await drawCommentsRenderHeader();
  await drawCommentsRenderList();
}

async function drawCommentsRenderHeader() {
  const box = document.getElementById('draw-comments-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawCommentsCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>التخصص</span><b>${drawDisciplineLabel(d.discipline)}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

// ---------- إضافة تعليق جديد ----------
async function drawCommentsHandleCreate() {
  const btn = document.getElementById('btn-draw-comment-add');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawCommentsCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const text = document.getElementById('draw-comment-text')?.value?.trim();
    if (!text) throw new Error('الرجاء إدخال نص التعليق');
    const xVal = document.getElementById('draw-comment-x')?.value;
    const yVal = document.getElementById('draw-comment-y')?.value;
    const category = document.getElementById('draw-comment-category')?.value || 'general';
    const position = (xVal !== '' && yVal !== '' && xVal !== undefined && yVal !== undefined)
      ? { x: Number(xVal), y: Number(yVal) } : null;

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    await drawFetch('/comments/create', {
      method: 'POST',
      body: {
        drawing_id: drawCommentsCurrentDrawingId, text, position, category,
      },
    });

    drawAlert('draw-comments-alert', 'تم إضافة التعليق بنجاح', 'success');
    const textEl = document.getElementById('draw-comment-text');
    if (textEl) textEl.value = '';
    const xEl = document.getElementById('draw-comment-x');
    if (xEl) xEl.value = '';
    const yEl = document.getElementById('draw-comment-y');
    if (yEl) yEl.value = '';

    drawCommentsRenderList();
    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-comments-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ---------- سرد التعليقات ----------
async function drawCommentsRenderList() {
  const container = document.getElementById('draw-comments-list');
  if (!container) return;
  if (!drawCommentsCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const isClosed = document.getElementById('draw-comment-filter-closed')?.value || '';
    const query = { drawing_id: drawCommentsCurrentDrawingId };
    if (isClosed !== '') query.is_closed = isClosed;
    const qs = new URLSearchParams(query).toString();
    const res = await drawFetch(`/comments/list?${qs}`);
    drawCommentsCache = res.comments;

    if (!drawCommentsCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد تعليقات مسجّلة على هذا المخطط بعد</div>';
      return;
    }

    container.innerHTML = drawCommentsCache.map((c) => drawCommentsRenderCard(c)).join('');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل التعليقات: ${e.message}</div>`;
  }
}

function drawCommentsRenderCard(c) {
  const repliesHtml = (c.replies || []).map((r) => `
    <div class="mini-list-row" style="padding-right:16px;opacity:0.9">
      <span>↳ ${r.text}</span>
      <span>${r.actor || '-'} — ${new Date(r.created_at).toLocaleString('ar')}</span>
    </div>`).join('');

  return `
    <div class="dashboard-block" style="margin-bottom:10px">
      <div class="mini-stat-row">
        <span><b>${c.text}</b></span>
        <span class="${c.is_closed ? 'dms-badge' : 'dms-badge dms-badge-warning'}">${c.is_closed ? 'مغلق' : 'مفتوح'}</span>
      </div>
      <div class="mini-stat-row">
        <span>${c.position ? `الموضع: (${c.position.x}, ${c.position.y})` : 'بدون موضع محدد'}</span>
        <span>${DRAW_COMMENT_CATEGORY_LABELS_AR[c.category] || c.category}</span>
      </div>
      <div class="mini-stat-row">
        <span>بواسطة ${c.created_by || '-'} — ${new Date(c.created_at).toLocaleString('ar')}</span>
        <span>${DRAW_COMMENT_IMPL_STATUS_LABELS_AR[c.implementation_status] || c.implementation_status}</span>
      </div>
      ${repliesHtml}
      <div class="field" style="margin-top:8px">
        <input type="text" id="draw-comment-reply-${c.id}" placeholder="اكتب رداً...">
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn btn-sm btn-outline" onclick="drawCommentsReply('${c.id}')">رد</button>
        ${c.is_closed
    ? `<button class="btn btn-sm btn-outline" onclick="drawCommentsReopen('${c.id}')">إعادة فتح</button>`
    : `<button class="btn btn-sm btn-outline" onclick="drawCommentsClose('${c.id}')">إغلاق</button>`}
        <select id="draw-comment-cat-${c.id}" onchange="drawCommentsSetCategory('${c.id}', this.value)">
          ${Object.entries(DRAW_COMMENT_CATEGORY_LABELS_AR).map(([k, v]) => `<option value="${k}" ${k === c.category ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="draw-comment-impl-${c.id}" onchange="drawCommentsSetImplStatus('${c.id}', this.value)">
          ${Object.entries(DRAW_COMMENT_IMPL_STATUS_LABELS_AR).map(([k, v]) => `<option value="${k}" ${k === c.implementation_status ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-outline" onclick="drawCommentsDelete('${c.id}')">حذف</button>
      </div>
    </div>`;
}

async function drawCommentsReply(commentId) {
  try {
    const input = document.getElementById(`draw-comment-reply-${commentId}`);
    const text = input?.value?.trim();
    if (!text) throw new Error('الرجاء إدخال نص الرد');
    await drawFetch('/comments/reply', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId, text },
    });
    drawCommentsRenderList();
  } catch (e) {
    alert(`تعذّر إضافة الرد: ${e.message}`);
  }
}

async function drawCommentsClose(commentId) {
  try {
    await drawFetch('/comments/close', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId },
    });
    drawCommentsRenderList();
  } catch (e) {
    alert(`تعذّر إغلاق التعليق: ${e.message}`);
  }
}

async function drawCommentsReopen(commentId) {
  try {
    await drawFetch('/comments/reopen', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId },
    });
    drawCommentsRenderList();
  } catch (e) {
    alert(`تعذّر إعادة فتح التعليق: ${e.message}`);
  }
}

async function drawCommentsSetCategory(commentId, category) {
  try {
    await drawFetch('/comments/set-category', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId, category },
    });
  } catch (e) {
    alert(`تعذّر تحديث التصنيف: ${e.message}`);
    drawCommentsRenderList();
  }
}

async function drawCommentsSetImplStatus(commentId, status) {
  try {
    await drawFetch('/comments/set-implementation-status', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId, status },
    });
  } catch (e) {
    alert(`تعذّر تحديث حالة التنفيذ: ${e.message}`);
    drawCommentsRenderList();
  }
}

async function drawCommentsDelete(commentId) {
  if (!confirm('هل تريد حذف هذا التعليق؟')) return;
  try {
    await drawFetch('/comments/delete', {
      method: 'POST',
      body: { drawing_id: drawCommentsCurrentDrawingId, comment_id: commentId },
    });
    drawCommentsRenderList();
    drawRenderDashboard();
  } catch (e) {
    alert(`تعذّر حذف التعليق: ${e.message}`);
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('btn-draw-comment-add');
  if (addBtn) addBtn.addEventListener('click', drawCommentsHandleCreate);

  const refreshBtn = document.getElementById('btn-draw-comment-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', drawCommentsRenderList);

  document.querySelectorAll('.nav-item[data-panel="draw-comments"]').forEach((el) => {
    el.addEventListener('click', () => drawCommentsRenderAll());
  });
});
