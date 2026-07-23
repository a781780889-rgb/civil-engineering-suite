// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings Management)
// الجزء 7/10: مقارنة المخططات (إصدارات / عناصر / طبقات / أبعاد / نصوص)
// ============================================================

const DRAW_CMP_API = '/api/drawings';
let drawCmpCurrentDrawingId = null;
let drawCmpVersionsCache = [];

const DRAW_CMP_TYPE_LABELS_AR = {
  layer: 'طبقة', dimension: 'بُعد', text: 'نص', block: 'كتلة/عنصر رسم', other: 'أخرى',
};

// ---------- فتح لوحة المقارنة لمخطط معيّن (يُستدعى من زر "مقارنة" في drawings.js) ----------
function drawOpenComparisonPanel(drawingId) {
  drawCmpCurrentDrawingId = drawingId;
  const panelNav = document.querySelector('.nav-item[data-panel="draw-compare"]');
  if (panelNav) panelNav.click();
  else drawCmpRenderAll();
  drawCmpRenderAll();
}

async function drawCmpRenderAll() {
  if (!drawCmpCurrentDrawingId) {
    const box = document.getElementById('draw-cmp-header');
    if (box) box.innerHTML = '<div class="mini-list-empty">اختر مخططاً من قائمة "جميع المخططات" أولاً بالضغط على زر "مقارنة"</div>';
    return;
  }
  await drawCmpRenderHeader();
  await drawCmpLoadVersionsAndPopulate();
  await drawCmpRenderHistory();
}

async function drawCmpRenderHeader() {
  const box = document.getElementById('draw-cmp-header');
  if (!box) return;
  try {
    const res = await drawFetch(`/get?id=${encodeURIComponent(drawCmpCurrentDrawingId)}`);
    const d = res.drawing;
    box.innerHTML = `
      <div class="dashboard-block">
        <h4>${d.drawing_number} — ${d.name}</h4>
        <div class="mini-stat-row"><span>الإصدار الحالي</span><b>v${d.current_version}</b></div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">تعذّر تحميل بيانات المخطط: ${e.message}</div>`;
  }
}

async function drawCmpLoadVersionsAndPopulate() {
  try {
    const res = await drawFetch(`/versions/list?drawing_id=${encodeURIComponent(drawCmpCurrentDrawingId)}`);
    drawCmpVersionsCache = res.versions;
    const options = drawCmpVersionsCache
      .map((v) => `<option value="${v.version_number}">v${v.version_number}</option>`).join('');

    ['draw-cmp-a', 'draw-cmp-b', 'draw-cmp-rec-version'].forEach((id) => {
      const sel = document.getElementById(id);
      if (sel) sel.innerHTML = options;
    });

    if (drawCmpVersionsCache.length) {
      const selA = document.getElementById('draw-cmp-a');
      const selB = document.getElementById('draw-cmp-b');
      if (selA) selA.value = drawCmpVersionsCache[drawCmpVersionsCache.length - 1].version_number;
      if (selB) selB.value = drawCmpVersionsCache[0].version_number;
    }
  } catch (e) {
    drawAlert('draw-cmp-alert', `تعذّر تحميل قائمة الإصدارات: ${e.message}`, 'error');
  }
}

// ---------- تسجيل عناصر إصدار (لقطة يدوية/مستوردة: طبقات/أبعاد/نصوص) ----------
async function drawCmpHandleRecordElements() {
  try {
    if (!drawCmpCurrentDrawingId) throw new Error('لم يتم اختيار مخطط');
    const versionNumber = document.getElementById('draw-cmp-rec-version')?.value;
    const type = document.getElementById('draw-cmp-rec-type')?.value;
    const namesRaw = document.getElementById('draw-cmp-rec-names')?.value || '';
    if (!versionNumber) throw new Error('الرجاء اختيار الإصدار');

    const elements = namesRaw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, value] = line.split('|').map((s) => s.trim());
      return { element_type: type, name, value: value || null };
    });
    if (!elements.length) throw new Error('الرجاء إدخال عنصر واحد على الأقل (اسم العنصر بكل سطر)');

    const res = await drawFetch('/compare/elements/record', {
      method: 'POST',
      body: {
        drawing_id: drawCmpCurrentDrawingId, version: versionNumber, elements, replace: true,
      },
    });
    drawAlert('draw-cmp-alert', `تم تسجيل ${res.recorded_count} عنصر للإصدار v${versionNumber} بنجاح`, 'success');
    const namesEl = document.getElementById('draw-cmp-rec-names');
    if (namesEl) namesEl.value = '';
  } catch (e) {
    drawAlert('draw-cmp-alert', e.message, 'error');
  }
}

// ---------- مقارنة شاملة بين إصدارين ----------
function drawCmpStatRow(label, value) {
  return `<div class="mini-stat-row"><span>${label}</span><b>${value}</b></div>`;
}

function drawCmpElementListHtml(title, items) {
  if (!items.length) return `<div class="mini-list-empty">${title}: لا يوجد</div>`;
  const rows = items.map((it) => {
    if (it.before !== undefined) {
      return `<li>[${DRAW_CMP_TYPE_LABELS_AR[it.element_type] || it.element_type}] ${it.name}: `
        + `"${it.before.value ?? '-'}" ← "${it.after.value ?? '-'}"</li>`;
    }
    return `<li>[${DRAW_CMP_TYPE_LABELS_AR[it.element_type] || it.element_type}] ${it.name}${it.value ? ` = ${it.value}` : ''}</li>`;
  }).join('');
  return `<h5 style="margin-bottom:4px">${title} (${items.length})</h5><ul class="mini-list">${rows}</ul>`;
}

async function drawCmpHandleCompare() {
  const resultBox = document.getElementById('draw-cmp-result');
  if (!resultBox) return;
  try {
    const versionA = document.getElementById('draw-cmp-a')?.value;
    const versionB = document.getElementById('draw-cmp-b')?.value;
    if (!versionA || !versionB) throw new Error('الرجاء اختيار إصدارين للمقارنة');

    resultBox.innerHTML = '<div class="loading-spinner"></div>';
    const q = `drawing_id=${encodeURIComponent(drawCmpCurrentDrawingId)}&version_a=${versionA}&version_b=${versionB}`;
    const res = await drawFetch(`/compare/versions?${q}`);

    resultBox.innerHTML = `
      <div class="dashboard-block">
        ${drawCmpStatRow('مقارنة الملف', res.file_comparison.summary)}
        ${drawCmpStatRow('فرق الحجم', res.file_comparison.size_diff_human)}
        ${drawCmpStatRow('عناصر مضافة', res.elements_summary.added_count)}
        ${drawCmpStatRow('عناصر محذوفة', res.elements_summary.removed_count)}
        ${drawCmpStatRow('عناصر معدَّلة', res.elements_summary.modified_count)}
        ${res.elements_summary.has_recorded_elements ? '' : '<div class="mini-list-empty">لم تُسجَّل عناصر لهذين الإصدارين بعد — استخدم نموذج \'تسجيل عناصر إصدار\' أعلاه لتفعيل المقارنة التفصيلية</div>'}
      </div>
      <div class="dashboard-block" style="margin-top:10px">
        ${drawCmpElementListHtml('العناصر المضافة', res.elements.added)}
        ${drawCmpElementListHtml('العناصر المحذوفة', res.elements.removed)}
        ${drawCmpElementListHtml('العناصر المعدَّلة', res.elements.modified)}
      </div>`;

    drawCmpRenderHistory();
  } catch (e) {
    resultBox.innerHTML = `<div class="alert alert-error">تعذّرت المقارنة: ${e.message}</div>`;
  }
}

// ---------- مقارنات مختصرة حسب النوع ----------
async function drawCmpHandleCompareByType(type) {
  const resultBox = document.getElementById('draw-cmp-type-result');
  if (!resultBox) return;
  try {
    const versionA = document.getElementById('draw-cmp-a')?.value;
    const versionB = document.getElementById('draw-cmp-b')?.value;
    if (!versionA || !versionB) throw new Error('الرجاء اختيار إصدارين للمقارنة');

    resultBox.innerHTML = '<div class="loading-spinner"></div>';
    const q = `drawing_id=${encodeURIComponent(drawCmpCurrentDrawingId)}&version_a=${versionA}&version_b=${versionB}`;
    const res = await drawFetch(`/compare/${type}?${q}`);

    resultBox.innerHTML = `
      <div class="dashboard-block">
        <h4>مقارنة ${DRAW_CMP_TYPE_LABELS_AR[res.element_type] || type}</h4>
        ${drawCmpStatRow('مضاف', res.added_count)}
        ${drawCmpStatRow('محذوف', res.removed_count)}
        ${drawCmpStatRow('معدَّل', res.modified_count)}
        ${drawCmpStatRow('بدون تغيير', res.unchanged_count)}
      </div>`;
  } catch (e) {
    resultBox.innerHTML = `<div class="alert alert-error">تعذّرت المقارنة: ${e.message}</div>`;
  }
}

// ---------- سجل عمليات المقارنة السابقة ----------
async function drawCmpRenderHistory() {
  const container = document.getElementById('draw-cmp-history');
  if (!container || !drawCmpCurrentDrawingId) return;
  try {
    const res = await drawFetch(`/compare/history?drawing_id=${encodeURIComponent(drawCmpCurrentDrawingId)}`);
    if (!res.comparisons.length) {
      container.innerHTML = '<div class="mini-list-empty">لا توجد عمليات مقارنة سابقة</div>';
      return;
    }
    const rows = res.comparisons.map((c) => `
      <tr>
        <td>v${c.version_a} ↔ v${c.version_b}</td>
        <td>${c.identical_content ? 'متطابق' : 'مختلف'}</td>
        <td>${c.added_count}</td>
        <td>${c.removed_count}</td>
        <td>${c.modified_count}</td>
        <td>${c.compared_by || '-'}</td>
        <td>${new Date(c.compared_at).toLocaleString('ar-EG')}</td>
      </tr>`).join('');
    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>الإصداران</th><th>المحتوى</th><th>إضافات</th><th>حذف</th><th>تعديل</th><th>بواسطة</th><th>التاريخ</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">تعذّر تحميل سجل المقارنات: ${e.message}</div>`;
  }
}

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
  const recordBtn = document.getElementById('btn-draw-cmp-record');
  if (recordBtn) recordBtn.addEventListener('click', drawCmpHandleRecordElements);

  const compareBtn = document.getElementById('btn-draw-cmp-compare');
  if (compareBtn) compareBtn.addEventListener('click', drawCmpHandleCompare);

  const layersBtn = document.getElementById('btn-draw-cmp-layers');
  if (layersBtn) layersBtn.addEventListener('click', () => drawCmpHandleCompareByType('layers'));

  const dimsBtn = document.getElementById('btn-draw-cmp-dimensions');
  if (dimsBtn) dimsBtn.addEventListener('click', () => drawCmpHandleCompareByType('dimensions'));

  const textsBtn = document.getElementById('btn-draw-cmp-texts');
  if (textsBtn) textsBtn.addEventListener('click', () => drawCmpHandleCompareByType('texts'));

  document.querySelectorAll('.nav-item[data-panel="draw-compare"]').forEach((el) => {
    el.addEventListener('click', () => drawCmpRenderAll());
  });
});
