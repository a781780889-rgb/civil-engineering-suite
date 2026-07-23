// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 4/10: إدارة الطبقات (Layers)
// ============================================================

let drawLayersCurrentDrawingId = null;
let drawLayersCache = [];

// ---------- فتح لوحة الطبقات لمخطط معيّن (يُستدعى من زر "الطبقات" في drawings.js) ----------
function drawOpenLayersPanel(drawingId) {
  drawLayersCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-layers"]');
  if (panelNav) panelNav.click();
  else drawLayersRenderAll();
  drawLayersRenderAll();
}

async function drawLayersRenderAll() {
  if (!drawLayersCurrentDrawingId) {
    const box = document.getElementById('draw-layers-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "الطبقات"</div>';
    const table = document.getElementById('draw-layers-table');
    if (table) table.innerHTML = '';
    return;
  }
  await drawLayersRenderHeader();
  await drawLayersRenderList();
}

async function drawLayersRenderHeader() {
  const box = document.getElementById('draw-layers-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawLayersCurrentDrawingId)}`);
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

const DRAW_LAYER_CATEGORY_LABELS_AR = {
  structural: 'إنشائي', architectural: 'معماري', electrical: 'كهربائي', mechanical: 'ميكانيكي',
  annotation: 'تعليقات توضيحية', dimension: 'أبعاد', grid: 'شبكة محاور', other: 'أخرى',
};

// ---------- إنشاء طبقة جديدة ----------
async function drawLayersHandleCreate() {
  const btn = document.getElementById('btn-draw-layer-add');
  const spinner = btn?.querySelector('.loading-spinner');
  try {
    if (!drawLayersCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const name = document.getElementById('draw-layer-name')?.value?.trim();
    if (!name) throw new Error('الرجاء إدخال اسم الطبقة');
    const category = document.getElementById('draw-layer-category')?.value || 'other';
    const color = document.getElementById('draw-layer-color')?.value || null;

    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    await drawFetch('/layers/create', {
      method: 'POST',
      body: {
        drawing_id: drawLayersCurrentDrawingId, name, category, color,
      },
    });

    drawAlert('draw-layers-alert', `تم إنشاء الطبقة (${name}) بنجاح`, 'success');
    const nameEl = document.getElementById('draw-layer-name');
    if (nameEl) nameEl.value = '';

    drawLayersRenderList();
  } catch (e) {
    drawAlert('draw-layers-alert', e.message, 'error');
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

// ---------- سرد الطبقات ----------
async function drawLayersRenderList() {
  const container = document.getElementById('draw-layers-table');
  if (!container) return;
  if (!drawLayersCurrentDrawingId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const search = document.getElementById('draw-layer-search')?.value?.trim() || null;
    const res = search
      ? await drawFetch(`/layers/search?drawing_id=${encodeURIComponent(drawLayersCurrentDrawingId)}&query=${encodeURIComponent(search)}`)
      : await drawFetch(`/layers/list?drawing_id=${encodeURIComponent(drawLayersCurrentDrawingId)}`);

    drawLayersCache = res.layers;

    if (!drawLayersCache.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد طبقات مسجّلة على هذا المخطط بعد</div>';
      return;
    }

    const rows = drawLayersCache.map((l, idx) => `
      <tr>
        <td>${l.color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${l.color};margin-left:6px;vertical-align:middle"></span>` : ''}${l.name}</td>
        <td>${DRAW_LAYER_CATEGORY_LABELS_AR[l.category] || l.category}</td>
        <td>
          <button class="btn btn-sm ${l.visible ? 'btn-primary' : 'btn-outline'}" onclick="drawLayersToggleVisibility('${l.id}', ${!l.visible})">
            ${l.visible ? '👁 ظاهرة' : '🚫 مخفية'}
          </button>
        </td>
        <td>
          <button class="btn btn-sm ${l.locked ? 'btn-primary' : 'btn-outline'}" onclick="drawLayersToggleLock('${l.id}', ${!l.locked})">
            ${l.locked ? '🔒 مقفلة' : '🔓 مفتوحة'}
          </button>
        </td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="drawLayersMove('${l.id}', 'up')" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-sm btn-outline" onclick="drawLayersMove('${l.id}', 'down')" ${idx === drawLayersCache.length - 1 ? 'disabled' : ''}>▼</button>
        </td>
        <td><button class="btn btn-sm btn-outline" onclick="drawLayersDelete('${l.id}')">حذف</button></td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>اسم الطبقة</th><th>التصنيف</th><th>الظهور</th><th>القفل</th><th>الترتيب</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل الطبقات: ${e.message}</div>`;
  }
}

async function drawLayersToggleVisibility(layerId, newVisible) {
  try {
    await drawFetch('/layers/toggle-visibility', {
      method: 'POST',
      body: { drawing_id: drawLayersCurrentDrawingId, layer_id: layerId, visible: newVisible },
    });
    drawLayersRenderList();
  } catch (e) {
    alert(`تعذّر تغيير حالة الظهور: ${e.message}`);
  }
}

async function drawLayersToggleLock(layerId, newLocked) {
  try {
    await drawFetch('/layers/toggle-lock', {
      method: 'POST',
      body: { drawing_id: drawLayersCurrentDrawingId, layer_id: layerId, locked: newLocked },
    });
    drawLayersRenderList();
  } catch (e) {
    alert(`تعذّر تغيير حالة القفل: ${e.message}`);
  }
}

async function drawLayersMove(layerId, direction) {
  try {
    await drawFetch('/layers/move', {
      method: 'POST',
      body: { drawing_id: drawLayersCurrentDrawingId, layer_id: layerId, direction },
    });
    drawLayersRenderList();
  } catch (e) {
    alert(`تعذّر تحريك الطبقة: ${e.message}`);
  }
}

async function drawLayersDelete(layerId) {
  if (!confirm('هل تريد حذف هذه الطبقة؟')) return;
  try {
    await drawFetch('/layers/delete', {
      method: 'POST',
      body: { drawing_id: drawLayersCurrentDrawingId, layer_id: layerId },
    });
    drawLayersRenderList();
  } catch (e) {
    alert(`تعذّر حذف الطبقة: ${e.message}`);
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('btn-draw-layer-add');
  if (addBtn) addBtn.addEventListener('click', drawLayersHandleCreate);

  const searchInput = document.getElementById('draw-layer-search');
  if (searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') drawLayersRenderList(); });

  const searchBtn = document.getElementById('btn-draw-layer-search');
  if (searchBtn) searchBtn.addEventListener('click', drawLayersRenderList);

  document.querySelectorAll('.nav-item[data-panel="draw-layers"]').forEach((el) => {
    el.addEventListener('click', () => drawLayersRenderAll());
  });
});
