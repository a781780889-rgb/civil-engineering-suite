// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 8/10: إدارة الاعتمادات المتعددة المستويات (Multi-Level Approvals)
// ============================================================

let drawAprCurrentDrawingId = null;
let DRAW_APR_LEVELS = ['internal', 'consultant', 'client', 'contractor', 'final'];
let DRAW_APR_LABELS_AR = {
  internal: 'اعتماد داخلي',
  consultant: 'اعتماد الاستشاري',
  client: 'اعتماد العميل',
  contractor: 'اعتماد المقاول',
  final: 'اعتماد نهائي',
};

// ---------- فتح لوحة الاعتمادات لمخطط معيّن (يُستدعى من زر "اعتمادات" في drawings.js) ----------
function drawOpenApprovalsPanel(drawingId) {
  drawAprCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-approvals"]');
  if (panelNav) panelNav.click();
  else drawAprRenderAll();
  drawAprRenderAll();
}

async function drawAprLoadLevels() {
  try {
    const res = await drawFetch('/approvals/levels');
    DRAW_APR_LEVELS = res.levels;
    DRAW_APR_LABELS_AR = res.labels_ar;
  } catch (e) {
    // القيم الافتراضية أعلاه تكفي إن تعذّر التحميل
  }
}

async function drawAprRenderAll() {
  if (!drawAprCurrentDrawingId) {
    const box = document.getElementById('draw-apr-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "اعتمادات"</div>';
    const progress = document.getElementById('draw-apr-progress');
    if (progress) progress.innerHTML = '';
    const table = document.getElementById('draw-apr-table');
    if (table) table.innerHTML = '';
    return;
  }
  await drawAprRenderHeader();
  await drawAprRenderStatus();
  await drawAprRenderList();
}

async function drawAprRenderHeader() {
  const box = document.getElementById('draw-apr-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawAprCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>التخصص</span><b>${drawDisciplineLabel(d.discipline)}</b></div>
        <div class="mini-stat-row"><span>حالة الاعتماد</span><span class="${DRAW_STATUS_BADGE_CLASS[d.approval_status] || ''}">${drawStatusLabel(d.approval_status)}</span></div>
        <div class="mini-stat-row"><span>الإصدار الحالي</span><b>v${d.current_version}</b></div>
        <div class="mini-stat-row"><span>المعتمد</span><b>${d.approver || '-'}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

// ---------- شريط تقدّم مستويات الاعتماد + تعبئة قائمة المستوى المستحق ----------
async function drawAprRenderStatus() {
  const box = document.getElementById('draw-apr-progress');
  const levelSelect = document.getElementById('draw-apr-level');
  if (!box) return;
  try {
    const res = await drawFetch(`/approvals/status?drawing_id=${encodeURIComponent(drawAprCurrentDrawingId)}`);

    const steps = res.required_levels.map((lvl) => {
      const isApproved = res.approved_levels.includes(lvl);
      const isNext = res.next_level === lvl;
      const cls = isApproved ? 'dms-badge dms-badge-success' : (isNext ? 'dms-badge dms-badge-warning' : 'dms-badge');
      return `<span class="${cls}" style="margin-inline-end:6px">${DRAW_APR_LABELS_AR[lvl] || lvl}${isApproved ? ' ✓' : ''}</span>`;
    }).join(' ← ');

    box.innerHTML = `
      <div class="dashboard-block">
        <div>${steps}</div>
        <div class="mini-stat-row" style="margin-top:8px">
          <span>حالة الاعتماد الكلية</span>
          <b>${res.is_approval_complete ? 'مكتملة ✅' : `بانتظار: ${res.next_level_label || '-'}`}</b>
        </div>
      </div>`;

    // تعبئة قوائم اختيار "المستوى المطلوب حفظه"
    document.querySelectorAll('.draw-apr-req-cb').forEach((cb) => {
      cb.checked = res.required_levels.includes(cb.value);
    });

    // تعبئة قائمة اختيار مستوى الاعتماد/الرفض: كل المستويات غير المعتمدة بعد
    if (levelSelect) {
      const remaining = res.remaining_levels.length ? res.remaining_levels : res.required_levels;
      levelSelect.innerHTML = remaining.map((lvl) => `<option value="${lvl}" ${lvl === res.next_level ? 'selected' : ''}>${DRAW_APR_LABELS_AR[lvl] || lvl}</option>`).join('');
      const approveBtn = document.getElementById('btn-draw-apr-approve');
      const rejectBtn = document.getElementById('btn-draw-apr-reject');
      if (approveBtn) approveBtn.disabled = res.is_approval_complete;
      if (rejectBtn) rejectBtn.disabled = res.is_approval_complete;
    }
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل حالة الاعتماد: ${e.message}</div>`;
  }
}

// ---------- حفظ المستويات المطلوبة فعلياً لهذا المخطط ----------
async function drawAprSaveRequirement() {
  const btn = document.getElementById('btn-draw-apr-req-save');
  try {
    if (!drawAprCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const levels = [...document.querySelectorAll('.draw-apr-req-cb:checked')].map((cb) => cb.value);
    if (!levels.length) throw new Error('اختر مستوى واحداً على الأقل');

    btn.disabled = true;
    await drawFetch('/approvals/requirement', {
      method: 'POST',
      body: { drawing_id: drawAprCurrentDrawingId, levels },
    });
    drawAlert('draw-apr-req-alert', 'تم حفظ مستويات الاعتماد المطلوبة لهذا المخطط', 'success');
    await drawAprRenderStatus();
  } catch (e) {
    drawAlert('draw-apr-req-alert', e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- تسجيل اعتماد أو رفض (توقيع إلكتروني فعلي) ----------
async function drawAprSubmit(decision) {
  const btnId = decision === 'approved' ? 'btn-draw-apr-approve' : 'btn-draw-apr-reject';
  const btn = document.getElementById(btnId);
  try {
    if (!drawAprCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const level = document.getElementById('draw-apr-level')?.value;
    const signerName = document.getElementById('draw-apr-signer-name')?.value?.trim();
    const signerRole = document.getElementById('draw-apr-signer-role')?.value?.trim() || null;
    const note = document.getElementById('draw-apr-note')?.value?.trim() || null;

    if (!level) throw new Error('لا يوجد مستوى متاح للاعتماد حالياً');
    if (!signerName) throw new Error('الرجاء إدخال اسم الموقِّع');
    if (decision === 'rejected' && !note) throw new Error('الرجاء إدخال سبب الرفض');

    if (btn) btn.disabled = true;

    await drawFetch('/approvals/submit', {
      method: 'POST',
      body: {
        drawing_id: drawAprCurrentDrawingId, level, decision, signer_name: signerName, signer_role: signerRole, note,
      },
    });

    drawAlert('draw-apr-alert', decision === 'approved' ? 'تم تسجيل الاعتماد بالتوقيع الإلكتروني بنجاح' : 'تم تسجيل الرفض بنجاح', 'success');
    const noteEl = document.getElementById('draw-apr-note');
    if (noteEl) noteEl.value = '';

    await drawAprRenderAll();
    drawRenderList();
    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-apr-alert', e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- إلغاء اعتماد سابق ----------
async function drawAprRevoke(approvalId) {
  // eslint-disable-next-line no-alert
  const reason = window.prompt('سبب إلغاء هذا الاعتماد:');
  if (!reason || !reason.trim()) return;
  try {
    await drawFetch('/approvals/revoke', {
      method: 'POST',
      body: { drawing_id: drawAprCurrentDrawingId, approval_id: approvalId, reason: reason.trim() },
    });
    drawAlert('draw-apr-alert', 'تم إلغاء الاعتماد', 'success');
    await drawAprRenderAll();
    drawRenderList();
    drawRenderDashboard();
  } catch (e) {
    drawAlert('draw-apr-alert', e.message, 'error');
  }
}

// ---------- التحقق من صحة توقيع اعتماد معيّن ----------
async function drawAprVerify(approvalId) {
  try {
    const res = await drawFetch(`/approvals/verify?drawing_id=${encodeURIComponent(drawAprCurrentDrawingId)}&approval_id=${encodeURIComponent(approvalId)}`);
    const statusText = {
      valid: 'التوقيع سليم وصالح ✅',
      revoked: 'التوقيع سليم لكن الاعتماد مُلغى',
      drawing_modified_after_approval: 'التوقيع سليم، لكن رُفع إصدار جديد للمخطط بعد هذا الاعتماد',
      invalid_signature_tampered: 'تحذير: بصمة التوقيع غير مطابقة - قد تكون البيانات تم التلاعب بها ❌',
    }[res.integrity_status] || res.integrity_status;
    // eslint-disable-next-line no-alert
    window.alert(`${statusText}\nالموقِّع: ${res.signed_by}\nالمستوى: ${res.level_label}\nالتاريخ: ${new Date(res.signed_at).toLocaleString('ar')}`);
  } catch (e) {
    drawAlert('draw-apr-alert', e.message, 'error');
  }
}

// ---------- سرد سجل الاعتمادات (بالتوقيع والختم الزمني) ----------
async function drawAprRenderList() {
  const container = document.getElementById('draw-apr-table');
  if (!container) return;
  if (!drawAprCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch(`/approvals/list?drawing_id=${encodeURIComponent(drawAprCurrentDrawingId)}`);

    if (!res.approvals.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد اعتمادات مسجّلة على هذا المخطط بعد</div>';
      return;
    }

    const rows = res.approvals.map((a) => `
      <tr>
        <td>${new Date(a.signed_at).toLocaleString('ar')}</td>
        <td>${a.level_label}</td>
        <td>${a.decision === 'approved' ? '<span class="dms-badge dms-badge-success">اعتماد</span>' : '<span class="dms-badge dms-badge-danger">رفض</span>'}</td>
        <td>${a.signer_name}${a.signer_role ? ` (${a.signer_role})` : ''}</td>
        <td>v${a.version_number_at_signing}</td>
        <td>${a.revoked ? `<span class="dms-badge dms-badge-danger">ملغى</span><br><small>${a.revoked_reason || ''}</small>` : '<span class="dms-badge dms-badge-success">ساري</span>'}</td>
        <td>${a.note || '-'}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="drawAprVerify('${a.id}')">تحقق من التوقيع</button>
          ${!a.revoked ? `<button class="btn btn-sm btn-outline" onclick="drawAprRevoke('${a.id}')">إلغاء</button>` : ''}
        </td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>الختم الزمني</th><th>المستوى</th><th>القرار</th><th>الموقِّع</th><th>الإصدار</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل سجل الاعتمادات: ${e.message}</div>`;
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  drawAprLoadLevels();

  const saveReqBtn = document.getElementById('btn-draw-apr-req-save');
  if (saveReqBtn) saveReqBtn.addEventListener('click', drawAprSaveRequirement);

  const approveBtn = document.getElementById('btn-draw-apr-approve');
  if (approveBtn) approveBtn.addEventListener('click', () => drawAprSubmit('approved'));

  const rejectBtn = document.getElementById('btn-draw-apr-reject');
  if (rejectBtn) rejectBtn.addEventListener('click', () => drawAprSubmit('rejected'));

  document.querySelectorAll('.nav-item[data-panel="draw-approvals"]').forEach((el) => {
    el.addEventListener('click', () => drawAprRenderAll());
  });
});
