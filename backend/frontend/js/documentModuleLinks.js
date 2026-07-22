// ============================================================
// القسم الحادي عشر: نظام إدارة المستندات (DMS)
// البند المتبقي: التكامل التلقائي مع باقي أقسام النظام (الواجهة)
// ------------------------------------------------------------
// عنصر واجهة عام قابل لإعادة الاستخدام: يعرض "المستندات المرتبطة"
// داخل أي قسم آخر (الجودة، السلامة، المعدات، المساحة ... إلخ)
// دون إعادة كتابة منطق العرض في كل قسم.
//
// طريقة الاستخدام من أي قسم آخر:
//   dmsRenderLinkedDocuments({
//     containerId: 'qms-ir-linked-docs',
//     module: 'quality',
//     entityId: irId,
//     projectId: currentProjectId,
//   });
// ============================================================

const DMS_LINKS_API = '/api/dms/links';

function dmsLinksFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_LINKS_API}${pathStr}`;
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

function dmsLinkStatusBadge(status) {
  const map = {
    draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد',
    rejected: 'مرفوض', published: 'منشور', archived: 'مؤرشف',
  };
  return map[status] || status || '-';
}

// عرض قائمة المستندات المرتبطة بسجل معيّن داخل أي حاوية HTML
async function dmsRenderLinkedDocuments({ containerId, module, entityId, projectId = null }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="dms-links-loading">جاري تحميل المستندات المرتبطة...</div>';

  try {
    const res = await dmsLinksFetch('/for-entity', { query: { module, entityId } });
    const items = res.data || [];

    if (!items.length) {
      container.innerHTML = `
        <div class="dms-links-empty">
          لا توجد مستندات مرتبطة بعد.
          <button class="btn btn-sm btn-outline" onclick="dmsOpenLinkPicker('${module}', '${entityId}', '${projectId || ''}', '${containerId}')">
            + ربط مستند
          </button>
        </div>`;
      return;
    }

    const rows = items.map((it) => {
      const doc = it.document;
      if (!doc) {
        return `<div class="dms-link-row dms-link-missing">مستند محذوف (رابط: ${it.link_id})</div>`;
      }
      return `
        <div class="dms-link-row" data-link-id="${it.link_id}">
          <span class="dms-link-title">${doc.title} <small>(${doc.document_number})</small></span>
          <span class="dms-link-status status-${doc.status}">${dmsLinkStatusBadge(doc.status)}</span>
          <button class="btn-icon" title="فتح المستند" onclick="dmsOpenDocument('${doc.id}')">📄</button>
          <button class="btn-icon" title="فك الربط" onclick="dmsUnlinkDocument('${it.link_id}', '${containerId}', '${module}', '${entityId}', '${projectId || ''}')">✕</button>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="dms-links-list">${rows}</div>
      <button class="btn btn-sm btn-outline" onclick="dmsOpenLinkPicker('${module}', '${entityId}', '${projectId || ''}', '${containerId}')">
        + ربط مستند آخر
      </button>`;
  } catch (err) {
    container.innerHTML = `<div class="dms-links-error">تعذر تحميل المستندات المرتبطة: ${err.message}</div>`;
  }
}

// فتح مستند من نظام DMS (يفتح شاشة DMS مباشرة على المستند المطلوب إن كانت موجودة)
function dmsOpenDocument(documentId) {
  if (typeof window.dmsOpenDocumentDetail === 'function') {
    window.dmsOpenDocumentDetail(documentId);
    return;
  }
  const panel = document.querySelector('[data-panel="dms-documents"]');
  if (panel) panel.click();
}

// فك ربط مستند وإعادة تحديث العرض
async function dmsUnlinkDocument(linkId, containerId, module, entityId, projectId) {
  if (!confirm('هل تريد فك ربط هذا المستند عن هذا السجل؟')) return;
  try {
    await dmsLinksFetch('/unlink', { method: 'POST', body: { link_id: linkId } });
    dmsRenderLinkedDocuments({ containerId, module, entityId, projectId: projectId || null });
  } catch (err) {
    alert('تعذر فك الربط: ' + err.message);
  }
}

// نافذة اختيار مستند من DMS لربطه بالسجل الحالي
async function dmsOpenLinkPicker(module, entityId, projectId, containerId) {
  const query = prompt('ابحث عن مستند لربطه (اسم أو رقم المستند):');
  if (query === null) return;

  try {
    const searchRes = await fetch(`/api/dms/documents?search=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`)
      .then((r) => r.json());
    const docs = searchRes.data || [];

    if (!docs.length) {
      alert('لم يتم العثور على مستندات مطابقة');
      return;
    }

    const listText = docs.map((d, i) => `${i + 1}. ${d.title} (${d.document_number})`).join('\n');
    const choice = prompt(`اختر رقم المستند لربطه:\n${listText}`);
    const idx = parseInt(choice, 10) - 1;
    if (Number.isNaN(idx) || !docs[idx]) return;

    await dmsLinksFetch('/link', {
      method: 'POST',
      body: {
        document_id: docs[idx].id,
        module,
        entity_id: entityId,
        project_id: projectId || null,
      },
    });

    dmsRenderLinkedDocuments({ containerId, module, entityId, projectId: projectId || null });
  } catch (err) {
    alert('تعذر ربط المستند: ' + err.message);
  }
}

// عرض ملخص المستندات المرتبطة بمشروع كامل، مجمّعة حسب القسم (لوحة تحكم المشروع)
async function dmsRenderProjectLinkedDocumentsSummary({ containerId, projectId }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="dms-links-loading">جاري التحميل...</div>';

  try {
    const res = await dmsLinksFetch('/by-project', { query: { projectId } });
    const grouped = res.data || {};
    const moduleLabels = {
      project: 'المشاريع', boq: 'حصر الكميات', quality: 'الجودة', safety: 'السلامة',
      equipment: 'المعدات', workers: 'العمال', survey: 'المساحة', schedule: 'الجدول الزمني',
      procurement: 'المشتريات', contracts: 'العقود', reports: 'التقارير', finance: 'الميزانية',
    };

    const rows = Object.entries(grouped)
      .filter(([, items]) => items.length > 0)
      .map(([module, items]) => `
        <div class="dms-project-module-row">
          <strong>${moduleLabels[module] || module}</strong>
          <span class="badge">${items.length} مستند</span>
        </div>`)
      .join('');

    container.innerHTML = rows || '<div class="dms-links-empty">لا توجد مستندات مرتبطة بهذا المشروع بعد.</div>';
  } catch (err) {
    container.innerHTML = `<div class="dms-links-error">تعذر تحميل الملخص: ${err.message}</div>`;
  }
}
