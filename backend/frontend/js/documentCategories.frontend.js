// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (Document Management System)
// الجزء 2/10: التصنيف الهرمي والمجلدات + النقل/النسخ + الأرشفة اليدوية/التلقائية
// ============================================================
// يعتمد هذا الملف على الدوال العامة المعرَّفة في documents.js (الجزء 1/10):
// dmsFetch, DMS_REF, dmsDocsCache, dmsLoadDashboard. يُحمَّل بعده مباشرة في index.html.

let dmsCategoriesFlat = [];
let dmsSelectedDocIds = new Set();

// ============================================================
// أدوات عامة على الشجرة
// ============================================================
function dmsFlattenTree(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) dmsFlattenTree(n.children, out);
  }
  return out;
}

function dmsCategoryOptionsHTML(includeEmpty = true, emptyLabel = '(بدون مجلد)') {
  const opts = includeEmpty ? [`<option value="">${emptyLabel}</option>`] : [];
  for (const c of dmsCategoriesFlat) {
    const indent = '— '.repeat(c.depth);
    opts.push(`<option value="${c.id}">${indent}${c.name}</option>`);
  }
  return opts.join('');
}

function dmsPopulateCategorySelects() {
  const targets = [
    document.getElementById('dms-new-cat-parent'),
    document.getElementById('dms-filter-category'),
    document.getElementById('dms-bulk-target-category'),
  ];
  for (const sel of targets) {
    if (!sel) continue;
    const keepFirst = sel.options.length ? sel.options[0].outerHTML : '';
    sel.innerHTML = keepFirst + dmsCategoryOptionsHTML(false);
  }
}

// ============================================================
// عرض شجرة المجلدات
// ============================================================
async function dmsLoadCategoryTree() {
  const container = document.getElementById('dms-category-tree');
  if (!container) return;
  container.innerHTML = 'جارِ التحميل...';
  try {
    const projectId = document.getElementById('dms-f-project')?.value || null;
    const { data } = await dmsFetch('/categories/tree', { query: { projectId } });
    dmsCategoriesFlat = dmsFlattenTree(data.tree);
    dmsPopulateCategorySelects();
    container.innerHTML = data.tree.length
      ? `<ul class="dms-cat-tree">${dmsRenderCategoryNodes(data.tree)}</ul>`
      : 'لا توجد مجلدات بعد - أنشئ أول مجلد أعلاه';

    container.querySelectorAll('[data-dms-cat-delete]').forEach((btn) => {
      btn.addEventListener('click', () => dmsDeleteCategory(btn.dataset.dmsCatDelete));
    });
    container.querySelectorAll('[data-dms-cat-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('dms-filter-category').value = btn.dataset.dmsCatView;
        dmsSwitchToDocumentsPanel();
        dmsLoadDocuments();
      });
    });
  } catch (e) {
    container.innerHTML = `<span style="color:#c0392b">${e.message}</span>`;
  }
}

function dmsRenderCategoryNodes(nodes) {
  return nodes.map((n) => `
    <li>
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <span>📁 ${n.name}</span>
        <span style="color:#888;font-size:12px">(${n.document_count} مستند)</span>
        <button class="btn btn-sm" data-dms-cat-view="${n.id}">عرض المستندات</button>
        <button class="btn btn-sm btn-danger" data-dms-cat-delete="${n.id}">حذف</button>
      </div>
      ${n.children?.length ? `<ul style="padding-inline-start:24px">${dmsRenderCategoryNodes(n.children)}</ul>` : ''}
    </li>`).join('');
}

function dmsSwitchToDocumentsPanel() {
  const navItem = document.querySelector('.nav-item[data-panel="dms-documents"]');
  if (navItem) navItem.click();
}

async function dmsCreateCategory() {
  const name = document.getElementById('dms-new-cat-name')?.value?.trim();
  const parent_id = document.getElementById('dms-new-cat-parent')?.value || null;
  const project_id = document.getElementById('dms-new-cat-project')?.value?.trim() || null;
  if (!name) { alert('اسم المجلد مطلوب'); return; }
  try {
    await dmsFetch('/categories', { method: 'POST', body: { name, parent_id, project_id } });
    document.getElementById('dms-new-cat-name').value = '';
    dmsLoadCategoryTree();
  } catch (e) {
    alert(`تعذّر إنشاء المجلد: ${e.message}`);
  }
}

async function dmsDeleteCategory(id) {
  const force = confirm('إذا كان المجلد يحتوي مستندات أو مجلدات فرعية، هل تريد نقلها تلقائياً للمجلد الأب ثم الحذف؟\n(إلغاء = محاولة حذف مجلد فارغ فقط)');
  try {
    await dmsFetch('/categories/delete', { method: 'POST', body: { id, force } });
    dmsLoadCategoryTree();
  } catch (e) {
    alert(`تعذّر حذف المجلد: ${e.message}`);
  }
}

// ============================================================
// تحديد متعدد للمستندات (Bulk Select) + نقل/أرشفة جماعية
// ============================================================
function dmsUpdateSelectedCount() {
  const label = document.getElementById('dms-selected-count');
  if (label) {
    label.textContent = dmsSelectedDocIds.size
      ? `تم تحديد ${dmsSelectedDocIds.size} مستند`
      : 'لم يتم تحديد أي مستند';
  }
}

/** يعيد كتابة صفوف الجدول لإضافة عمود التحديد + المجلد فوق ما بناه الجزء 1 (documents.js) */
async function dmsLoadDocumentsWithCategories() {
  const tbody = document.getElementById('dms-docs-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9">جارِ التحميل...</td></tr>';
  dmsSelectedDocIds.clear();
  dmsUpdateSelectedCount();
  try {
    const query = {
      search: document.getElementById('dms-search')?.value || null,
      doc_type: document.getElementById('dms-filter-type')?.value || null,
      group: document.getElementById('dms-filter-group')?.value || null,
      status: document.getElementById('dms-filter-status')?.value || null,
    };
    const { data } = await dmsFetch('/documents', { query });
    const categoryFilter = document.getElementById('dms-filter-category')?.value || null;
    const filtered = categoryFilter ? data.filter((d) => d.category_id === categoryFilter) : data;
    dmsDocsCache = filtered;

    const catNameById = {};
    for (const c of dmsCategoriesFlat) catNameById[c.id] = c.name;

    tbody.innerHTML = filtered.length ? filtered.map((d) => `
      <tr>
        <td><input type="checkbox" data-dms-select="${d.id}"></td>
        <td>${d.document_number}</td>
        <td>${d.title}</td>
        <td>${d.doc_type_label}</td>
        <td>${d.category_id ? (catNameById[d.category_id] || '—') : '—'}</td>
        <td>v${d.current_version_number}</td>
        <td><span class="${DMS_STATUS_BADGE_CLASS?.[d.status] || 'badge'}">${DMS_REF?.document_status_labels?.[d.status] || d.status}</span></td>
        <td>${new Date(d.updated_at).toLocaleDateString('ar-SA')}</td>
        <td>
          <button class="btn btn-sm" data-dms-view="${d.id}">عرض</button>
          <button class="btn btn-sm" data-dms-download="${d.id}">تنزيل</button>
          <button class="btn btn-sm" data-dms-copy="${d.id}">نسخ</button>
          <button class="btn btn-sm btn-danger" data-dms-archive="${d.id}">أرشفة</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="9">لا توجد مستندات مطابقة</td></tr>';

    tbody.querySelectorAll('[data-dms-select]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) dmsSelectedDocIds.add(cb.dataset.dmsSelect);
        else dmsSelectedDocIds.delete(cb.dataset.dmsSelect);
        dmsUpdateSelectedCount();
      });
    });
    tbody.querySelectorAll('[data-dms-view]').forEach((btn) => {
      btn.addEventListener('click', () => dmsViewDocument(btn.dataset.dmsView));
    });
    tbody.querySelectorAll('[data-dms-download]').forEach((btn) => {
      btn.addEventListener('click', () => dmsDownloadCurrent(btn.dataset.dmsDownload));
    });
    tbody.querySelectorAll('[data-dms-copy]').forEach((btn) => {
      btn.addEventListener('click', () => dmsCopyDocument(btn.dataset.dmsCopy));
    });
    tbody.querySelectorAll('[data-dms-archive]').forEach((btn) => {
      btn.addEventListener('click', () => dmsArchiveOneDocument(btn.dataset.dmsArchive));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

async function dmsCopyDocument(id) {
  const targetCategoryId = document.getElementById('dms-bulk-target-category')?.value || null;
  try {
    await dmsFetch('/documents/copy', { method: 'POST', body: { document_id: id, target_category_id: targetCategoryId } });
    dmsLoadDocumentsWithCategories();
    dmsLoadDashboard();
  } catch (e) {
    alert(`تعذّر نسخ المستند: ${e.message}`);
  }
}

async function dmsArchiveOneDocument(id) {
  if (!confirm('هل تريد أرشفة هذا المستند؟')) return;
  try {
    await dmsFetch('/documents/archive', { method: 'POST', body: { document_ids: [id] } });
    dmsLoadDocumentsWithCategories();
    dmsLoadDashboard();
  } catch (e) {
    alert(`تعذّرت الأرشفة: ${e.message}`);
  }
}

async function dmsBulkMoveSelected() {
  if (!dmsSelectedDocIds.size) { alert('لم يتم تحديد أي مستند'); return; }
  const targetCategoryId = document.getElementById('dms-bulk-target-category')?.value || null;
  try {
    await dmsFetch('/documents/move', {
      method: 'POST',
      body: { document_ids: [...dmsSelectedDocIds], target_category_id: targetCategoryId },
    });
    dmsLoadDocumentsWithCategories();
    dmsLoadCategoryTree();
  } catch (e) {
    alert(`تعذّر نقل المستندات: ${e.message}`);
  }
}

async function dmsBulkArchiveSelected() {
  if (!dmsSelectedDocIds.size) { alert('لم يتم تحديد أي مستند'); return; }
  if (!confirm(`هل تريد أرشفة ${dmsSelectedDocIds.size} مستند؟`)) return;
  try {
    await dmsFetch('/documents/archive', { method: 'POST', body: { document_ids: [...dmsSelectedDocIds] } });
    dmsLoadDocumentsWithCategories();
    dmsLoadDashboard();
  } catch (e) {
    alert(`تعذّرت الأرشفة الجماعية: ${e.message}`);
  }
}

// ============================================================
// الأرشفة التلقائية
// ============================================================
async function dmsViewArchiveRules() {
  const box = document.getElementById('dms-archive-rules-view');
  if (!box) return;
  try {
    const { data } = await dmsFetch('/archive/rules');
    const rows = Object.entries(data.by_group).map(([g, days]) => `
      <tr><td>${DMS_REF?.document_group_labels?.[g] || g}</td><td>${days} يوماً</td></tr>`).join('');
    box.innerHTML = `
      <table class="data-table">
        <thead><tr><th>مجموعة المستندات</th><th>مدة عدم النشاط قبل الأرشفة التلقائية</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:8px;color:#666">تُطبَّق فقط على المستندات بحالة "معتمد" أو "منشور". الافتراضي العام: ${data.default_inactivity_days} يوماً.</p>`;
  } catch (e) {
    box.innerHTML = `<span style="color:#c0392b">${e.message}</span>`;
  }
}

async function dmsRunAutoArchiveNow() {
  const box = document.getElementById('dms-archive-run-result');
  if (!box) return;
  box.textContent = 'جارِ التنفيذ...';
  try {
    const { data } = await dmsFetch('/archive/run-now', { method: 'POST' });
    box.innerHTML = `<span style="color:#1a7a3d">تمت أرشفة ${data.archived_count} مستند تلقائياً.</span>`;
    dmsLoadDocumentsWithCategories();
    dmsLoadDashboard();
  } catch (e) {
    box.innerHTML = `<span style="color:#c0392b">${e.message}</span>`;
  }
}

// ============================================================
// ربط الأزرار عند تحميل الصفحة
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('dms-btn-create-category')?.addEventListener('click', dmsCreateCategory);
  document.getElementById('dms-btn-refresh-tree')?.addEventListener('click', dmsLoadCategoryTree);
  document.getElementById('dms-btn-bulk-move')?.addEventListener('click', dmsBulkMoveSelected);
  document.getElementById('dms-btn-bulk-archive')?.addEventListener('click', dmsBulkArchiveSelected);
  document.getElementById('dms-btn-view-archive-rules')?.addEventListener('click', dmsViewArchiveRules);
  document.getElementById('dms-btn-run-auto-archive')?.addEventListener('click', dmsRunAutoArchiveNow);

  // استبدال أزرار البحث/التحديث في قائمة المستندات (الجزء 1) بالنسخة المطوَّرة
  // من الجزء 2 التي تضيف التحديد المتعدد وعمود المجلد، دون تعديل documents.js نفسه
  const searchBtn = document.getElementById('dms-btn-search');
  const refreshBtn = document.getElementById('dms-btn-refresh-list');
  if (searchBtn) searchBtn.addEventListener('click', dmsLoadDocumentsWithCategories);
  if (refreshBtn) refreshBtn.addEventListener('click', dmsLoadDocumentsWithCategories);
  const catFilter = document.getElementById('dms-filter-category');
  if (catFilter) catFilter.addEventListener('change', dmsLoadDocumentsWithCategories);

  dmsLoadCategoryTree();
});
