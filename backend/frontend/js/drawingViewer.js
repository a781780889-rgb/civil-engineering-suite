// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 3/10: عارض المخططات (قياسات + نقاط إحداثية + فتح عدة مخططات معاً)
// ============================================================

let drawViewCurrentDrawingId = null;
let drawViewMeasurementsCache = [];
let drawViewCoordinatesCache = [];
let drawViewMultiSelection = new Set();

// ---------- فتح لوحة العارض لمخطط معيّن (يُستدعى من زر "العارض" في drawings.js) ----------
function drawOpenViewerPanel(drawingId) {
  drawViewCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-viewer"]');
  if (panelNav) panelNav.click();
  else drawViewRenderAll();
  drawViewRenderAll();
}

async function drawViewRenderAll() {
  if (!drawViewCurrentDrawingId) {
    const box = document.getElementById('draw-view-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "العارض"</div>';
    return;
  }
  await drawViewRenderHeader();
  await drawViewRenderMeasurements();
  await drawViewRenderCoordinates();
}

async function drawViewRenderHeader() {
  const box = document.getElementById('draw-view-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawViewCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>التخصص</span><b>${drawDisciplineLabel(d.discipline)}</b></div>
        <div class="mini-stat-row"><span>نوع الملف</span><b>${(d.file_type || '').toUpperCase()}</b></div>
        <div class="mini-stat-row"><span>الإصدار الحالي</span><b>v${d.current_version}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

// ---------- القياسات (مسافة / طول / زاوية / مساحة) ----------
function drawViewReadPointsInput() {
  const raw = document.getElementById('draw-view-mea-points')?.value?.trim();
  if (!raw) throw new Error('الرجاء إدخال نقاط القياس');
  // صيغة مبسّطة: كل نقطة على سطر "x,y" أو "x,y,z"
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(',').map((s) => Number(s.trim()));
    if (parts.some((n) => Number.isNaN(n))) throw new Error(`صيغة نقطة غير صحيحة: "${line}" (استخدم x,y أو x,y,z)`);
    return { x: parts[0], y: parts[1], z: parts[2] !== undefined ? parts[2] : null };
  });
}

async function drawViewHandleAddMeasurement() {
  const btn = document.getElementById('btn-draw-view-mea-add');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawViewCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const type = document.getElementById('draw-view-mea-type')?.value;
    const points = drawViewReadPointsInput();
    const label = document.getElementById('draw-view-mea-label')?.value?.trim() || null;

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    const res = await drawFetch('/viewer/measurements/add', {
      method: 'POST',
      body: { drawing_id: drawViewCurrentDrawingId, type, points, label },
    });

    drawAlert('draw-view-mea-alert', `تم حفظ القياس: ${res.measurement.value} ${res.measurement.unit}`, 'success');
    const labelEl = document.getElementById('draw-view-mea-label');
    if (labelEl) labelEl.value = '';
    const pointsEl = document.getElementById('draw-view-mea-points');
    if (pointsEl) pointsEl.value = '';

    drawViewRenderMeasurements();
  } catch (e) {
    drawAlert('draw-view-mea-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

async function drawViewRenderMeasurements() {
  const container = document.getElementById('draw-view-mea-table');
  if (!container) return;
  if (!drawViewCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch(`/viewer/measurements/list?drawing_id=${encodeURIComponent(drawViewCurrentDrawingId)}`);
    drawViewMeasurementsCache = res.measurements;

    if (!drawViewMeasurementsCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد قياسات مسجّلة على هذا المخطط بعد</div>';
      return;
    }

    const rows = drawViewMeasurementsCache.map((m) => `
      <tr>
        <td>${m.type_label_ar}</td>
        <td>${m.value} ${m.unit}</td>
        <td>${m.points.length}</td>
        <td>${m.label || '-'}</td>
        <td>${new Date(m.created_at).toLocaleString('ar-EG')}</td>
        <td><button class="btn btn-sm btn-outline" onclick="drawViewDeleteMeasurement('${m.id}')">حذف</button></td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>النوع</th><th>القيمة</th><th>عدد النقاط</th><th>ملاحظة</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل القياسات: ${e.message}</div>`;
  }
}

async function drawViewDeleteMeasurement(measurementId) {
  if (!confirm('هل تريد حذف هذا القياس؟')) return;
  try {
    await drawFetch('/viewer/measurements/delete', {
      method: 'POST',
      body: { drawing_id: drawViewCurrentDrawingId, measurement_id: measurementId },
    });
    drawViewRenderMeasurements();
  } catch (e) {
    alert(`تعذّر حذف القياس: ${e.message}`);
  }
}

// ---------- نقاط قراءة الإحداثيات ----------
async function drawViewHandleAddCoordinate() {
  const btn = document.getElementById('btn-draw-view-coord-add');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawViewCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const x = Number(document.getElementById('draw-view-coord-x')?.value);
    const y = Number(document.getElementById('draw-view-coord-y')?.value);
    const zRaw = document.getElementById('draw-view-coord-z')?.value;
    const z = zRaw ? Number(zRaw) : null;
    if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('الرجاء إدخال إحداثيات x و y صحيحة');
    const label = document.getElementById('draw-view-coord-label')?.value?.trim() || null;

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    await drawFetch('/viewer/coordinates/add', {
      method: 'POST',
      body: { drawing_id: drawViewCurrentDrawingId, x, y, z, label },
    });

    drawAlert('draw-view-coord-alert', 'تم تسجيل نقطة الإحداثيات بنجاح', 'success');
    ['draw-view-coord-x', 'draw-view-coord-y', 'draw-view-coord-z', 'draw-view-coord-label'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    drawViewRenderCoordinates();
  } catch (e) {
    drawAlert('draw-view-coord-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

async function drawViewRenderCoordinates() {
  const container = document.getElementById('draw-view-coord-table');
  if (!container) return;
  if (!drawViewCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const res = await drawFetch(`/viewer/coordinates/list?drawing_id=${encodeURIComponent(drawViewCurrentDrawingId)}`);
    drawViewCoordinatesCache = res.points;

    if (!drawViewCoordinatesCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد نقاط إحداثيات مسجّلة بعد</div>';
      return;
    }

    const rows = drawViewCoordinatesCache.map((p) => `
      <tr>
        <td>${p.x}</td>
        <td>${p.y}</td>
        <td>${p.z !== null && p.z !== undefined ? p.z : '-'}</td>
        <td>${p.label || '-'}</td>
        <td><button class="btn btn-sm btn-outline" onclick="drawViewDeleteCoordinate('${p.id}')">حذف</button></td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>X</th><th>Y</th><th>Z</th><th>ملاحظة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل نقاط الإحداثيات: ${e.message}</div>`;
  }
}

async function drawViewDeleteCoordinate(pointId) {
  if (!confirm('هل تريد حذف نقطة الإحداثيات هذه؟')) return;
  try {
    await drawFetch('/viewer/coordinates/delete', {
      method: 'POST',
      body: { drawing_id: drawViewCurrentDrawingId, point_id: pointId },
    });
    drawViewRenderCoordinates();
  } catch (e) {
    alert(`تعذّر حذف نقطة الإحداثيات: ${e.message}`);
  }
}

// ---------- فتح عدة مخططات معاً ----------
function drawViewToggleMultiSelect(drawingId, checked) {
  if (checked) drawViewMultiSelection.add(drawingId);
  else drawViewMultiSelection.delete(drawingId);
}

async function drawViewHandleOpenMultiple() {
  const resultBox = document.getElementById('draw-view-multi-result');
  if (!resultBox) return;
  try {
    const ids = [...drawViewMultiSelection];
    if (!ids.length) throw new Error('الرجاء اختيار مخطط واحد على الأقل من قائمة "جميع المخططات"');

    resultBox.innerHTML = '<div class="loading-spinner"></div>';
    const res = await drawFetch('/viewer/open-multiple', {
      method: 'POST',
      body: { drawing_ids: ids, include_file: false },
    });

    const rows = res.drawings.map((r) => (r.found
      ? `<div class="mini-list-row"><span>${r.drawing.drawing_number} - ${r.drawing.name}</span><span>${drawStatusLabel(r.drawing.approval_status)}</span></div>`
      : `<div class="mini-list-row"><span>${r.id}</span><span class="dms-badge dms-badge-error">${r.error}</span></div>`)).join('');

    resultBox.innerHTML = `<div class="dashboard-block"><h4>تم فتح ${res.count} مخطط</h4>${rows}</div>`;
  } catch (e) {
    resultBox.innerHTML = `<div class="alert alert-error">تعذّر فتح المخططات: ${e.message}</div>`;
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const addMeaBtn = document.getElementById('btn-draw-view-mea-add');
  if (addMeaBtn) addMeaBtn.addEventListener('click', drawViewHandleAddMeasurement);

  const addCoordBtn = document.getElementById('btn-draw-view-coord-add');
  if (addCoordBtn) addCoordBtn.addEventListener('click', drawViewHandleAddCoordinate);

  const openMultiBtn = document.getElementById('btn-draw-view-open-multi');
  if (openMultiBtn) openMultiBtn.addEventListener('click', drawViewHandleOpenMultiple);

  document.querySelectorAll('.nav-item[data-panel="draw-viewer"]').forEach((el) => {
    el.addEventListener('click', () => drawViewRenderAll());
  });
});
