// ============================================================
// القسم الثاني عشر: نظام إدارة المخططات الهندسية (Drawings)
// الجزء 10ج/10 (الأخير): التكامل الشامل مع بقية أقسام النظام (الواجهة)
// ------------------------------------------------------------
// عنصر واجهة عام قابل لإعادة الاستخدام: يعرض "المخططات المرتبطة"
// داخل أي قسم آخر (المشاريع، المساحة، BOQ، الجودة، السلامة،
// المستندات، الأعمال، المعدات، الجدول الزمني، التقارير) دون إعادة
// كتابة منطق العرض في كل قسم — بنفس فلسفة documentModuleLinks.js
// (القسم الحادي عشر) التي أثبتت فعاليتها هناك.
//
// طريقة الاستخدام من أي قسم آخر:
//   drawLinksRender({
//     containerId: 'qms-ir-linked-drawings',
//     module: 'quality',
//     entityId: irId,
//     projectId: currentProjectId,
//   });
// ============================================================

const DRAW_LINKS_API = '/api/drawings/links';

function drawLinksFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DRAW_LINKS_API}${pathStr}`;
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

function drawLinkApprovalBadge(status) {
  const map = {
    draft: 'مسودة',
    under_review: 'قيد المراجعة',
    approved: 'معتمد',
    rejected: 'مرفوض',
  };
  return map[status] || status || '-';
}

// عرض قائمة المخططات المرتبطة بسجل معيّن داخل أي حاوية HTML
async function drawLinksRender({
  containerId, module, entityId, projectId = null,
}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="draw-links-loading">جاري تحميل المخططات المرتبطة...</div>';

  try {
    const res = await drawLinksFetch('/for-entity', { query: { module, entityId } });
    const items = res.data || [];

    if (!items.length) {
      container.innerHTML = `
        <div class="draw-links-empty">
          لا توجد مخططات مرتبطة بعد.
          <button class="btn btn-sm btn-outline" onclick="drawLinksOpenPicker('${module}', '${entityId}', '${projectId || ''}', '${containerId}')">
            + ربط مخطط
          </button>
        </div>`;
      return;
    }

    const rows = items.map((it) => {
      const d = it.drawing;
      if (!d) {
        return `<div class="draw-link-row draw-link-missing">مخطط محذوف (رابط: ${it.link_id})</div>`;
      }
      return `
        <div class="draw-link-row" data-link-id="${it.link_id}">
          <span class="draw-link-title">${d.name} <small>(${d.drawing_number})</small></span>
          <span class="draw-link-status status-${d.approval_status}">${drawLinkApprovalBadge(d.approval_status)}</span>
          <button class="btn-icon" title="فتح المخطط" onclick="drawLinksOpenDrawing('${d.id}')">📐</button>
          <button class="btn-icon" title="فك الربط" onclick="drawLinksUnlink('${it.link_id}', '${containerId}', '${module}', '${entityId}', '${projectId || ''}')">✕</button>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="draw-links-list">${rows}</div>
      <button class="btn btn-sm btn-outline" onclick="drawLinksOpenPicker('${module}', '${entityId}', '${projectId || ''}', '${containerId}')">
        + ربط مخطط آخر
      </button>`;
  } catch (err) {
    container.innerHTML = `<div class="draw-links-error">تعذر تحميل المخططات المرتبطة: ${err.message}</div>`;
  }
}

// فتح مخطط من قسم إدارة المخططات (ينتقل مباشرة لقائمة المخططات إن لم توجد شاشة تفصيل مخصصة)
function drawLinksOpenDrawing(drawingId) {
  if (typeof window.drawOpenDrawingDetail === 'function') {
    window.drawOpenDrawingDetail(drawingId);
    return;
  }
  const panel = document.querySelector('[data-panel="draw-list"]');
  if (panel) panel.click();
}

// فك ربط مخطط وإعادة تحديث العرض
async function drawLinksUnlink(linkId, containerId, module, entityId, projectId) {
  if (!confirm('هل تريد فك ربط هذا المخطط عن هذا السجل؟')) return;
  try {
    await drawLinksFetch('/unlink', { method: 'POST', body: { link_id: linkId } });
    drawLinksRender({
      containerId, module, entityId, projectId: projectId || null,
    });
  } catch (err) {
    alert('تعذر فك الربط: ' + err.message);
  }
}

// نافذة اختيار مخطط من قسم المخططات لربطه بالسجل الحالي
async function drawLinksOpenPicker(module, entityId, projectId, containerId) {
  const query = prompt('ابحث عن مخطط لربطه (اسم أو رقم المخطط):');
  if (query === null) return;

  try {
    const searchRes = await fetch(`/api/drawings/list?search=${encodeURIComponent(query)}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}`)
      .then((r) => r.json());
    const drawings = searchRes.data || searchRes.drawings || [];

    if (!drawings.length) {
      alert('لم يتم العثور على مخططات مطابقة');
      return;
    }

    const listText = drawings.map((d, i) => `${i + 1}. ${d.name} (${d.drawing_number})`).join('\n');
    const choice = prompt(`اختر رقم المخطط لربطه:\n${listText}`);
    const idx = parseInt(choice, 10) - 1;
    if (Number.isNaN(idx) || !drawings[idx]) return;

    await drawLinksFetch('/link', {
      method: 'POST',
      body: {
        drawing_id: drawings[idx].id,
        module,
        entity_id: entityId,
        project_id: projectId || null,
      },
    });

    drawLinksRender({
      containerId, module, entityId, projectId: projectId || null,
    });
  } catch (err) {
    alert('تعذر ربط المخطط: ' + err.message);
  }
}

// عرض ملخص المخططات المرتبطة بمشروع كامل، مجمّعة حسب القسم (لوحة تحكم المشروع)
async function drawLinksRenderProjectSummary({ containerId, projectId }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="draw-links-loading">جاري التحميل...</div>';

  try {
    const res = await drawLinksFetch('/by-project', { query: { projectId } });
    const grouped = res.data || {};
    const moduleLabels = {
      project: 'المشاريع',
      survey: 'المساحة',
      boq: 'حصر الكميات',
      quality: 'الجودة',
      safety: 'السلامة',
      documents: 'المستندات',
      business: 'الأعمال',
      equipment: 'المعدات',
      schedule: 'الجدول الزمني',
      reports: 'التقارير',
    };

    const rows = Object.entries(grouped)
      .filter(([, items]) => items.length > 0)
      .map(([module, items]) => `
        <div class="draw-project-module-row">
          <strong>${moduleLabels[module] || module}</strong>
          <span class="badge">${items.length} مخطط</span>
        </div>`)
      .join('');

    container.innerHTML = rows || '<div class="draw-links-empty">لا توجد مخططات مرتبطة بهذا المشروع بعد.</div>';
  } catch (err) {
    container.innerHTML = `<div class="draw-links-error">تعذر تحميل الملخص: ${err.message}</div>`;
  }
}
