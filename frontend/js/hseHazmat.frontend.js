// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// الجزء 4/4: إدارة المواد الخطرة (المواد، بطاقات SDS، حركة المخزون، التنبيهات)
// ============================================================

const HSE_HZM_API = '/api/hse/hazmat';
let HSE_HZM_REF = null;
let hseHzmItemEditingId = null;
let hseHzmMovementItemId = null;

// ---------- أدوات عامة (بنفس نمط hseTraining.js) ----------
function hseHzmFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_HZM_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async res => {
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  });
}

function hseHzmAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseHzmEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounceHseHzm(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function hseHzmEnsureRefData() {
  if (HSE_HZM_REF) return HSE_HZM_REF;
  const res = await hseHzmFetch('/reference-data');
  HSE_HZM_REF = res.data;
  return HSE_HZM_REF;
}

function hseHzmOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseHzmStatusTag(status) {
  const map = { active: 'tag-ok', quarantined: 'tag-info', depleted: 'tag-bad', discontinued: 'tag-bad' };
  return map[status] || 'tag-info';
}
function hseHzmStockTag(status) {
  const map = { sufficient: 'tag-ok', below_minimum: 'tag-bad', out_of_stock: 'tag-bad' };
  return map[status] || 'tag-info';
}
function hseHzmSdsTag(status) {
  const map = { valid: 'tag-ok', due_soon: 'tag-bad', expired: 'tag-bad', unknown: 'tag-info' };
  return map[status] || 'tag-info';
}

// ================================================================
// لوحة معلومات المواد الخطرة
// ================================================================

document.querySelector('[data-panel="hse-hzm-dashboard"]')?.addEventListener('click', () => hseHzmLoadDashboard());
document.getElementById('hse-hzm-btn-load-dashboard')?.addEventListener('click', () => hseHzmLoadDashboard());

async function hseHzmLoadDashboard() {
  const cardsEl = document.getElementById('hse-hzm-dash-cards');
  const classChartEl = document.getElementById('hse-hzm-chart-hazard-class');
  const alertsEl = document.getElementById('hse-hzm-dash-alerts');
  const ref = await hseHzmEnsureRefData();
  const projectId = document.getElementById('hse-hzm-dash-project')?.value.trim() || null;

  try {
    const res = await hseHzmFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المواد الخطرة</div><div class="value">${d.total_items}<span class="unit">نشطة: ${d.active_items}</span></div></div>
      <div class="result-card"><div class="label">محجوزة</div><div class="value">${d.quarantined_items}</div></div>
      <div class="result-card"><div class="label">نفدت الكمية</div><div class="value">${d.depleted_items}</div></div>
      <div class="result-card"><div class="label">أقل من الحد الأدنى</div><div class="value">${d.below_minimum_stock}</div></div>
      <div class="result-card"><div class="label">لا يوجد مخزون</div><div class="value">${d.out_of_stock}</div></div>
      <div class="result-card"><div class="label">SDS تقترب من المراجعة</div><div class="value">${d.sds_due_soon}</div></div>
      <div class="result-card"><div class="label">SDS متأخرة عن المراجعة</div><div class="value">${d.sds_expired}</div></div>
      <div class="result-card"><div class="label">عمليات تخلص آمن</div><div class="value">${d.total_disposals}</div></div>
    `;

    const clsEntries = Object.entries(d.by_hazard_class).filter(([, c]) => c > 0);
    const maxCls = Math.max(1, ...clsEntries.map(([, c]) => c));
    classChartEl.innerHTML = clsEntries.length
      ? clsEntries.map(([cls, count]) => `
        <div class="pm-bar-row">
          <div class="pm-bar-label">${ref.ghs_hazard_class_labels[cls] || cls}</div>
          <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxCls) * 100}%"></div></div>
          <div class="pm-bar-value">${count}</div>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد مواد خطرة مسجَّلة بعد</div>`;

    const lowStockRes = await hseHzmFetch('/alerts/low-stock', { query: { projectId } });
    const sdsRes = await hseHzmFetch('/alerts/sds-expiring', { query: { projectId, withinDays: 30 } });
    const combined = [
      ...lowStockRes.data.slice(0, 5).map(i => ({ type: 'stock', item: i })),
      ...sdsRes.data.slice(0, 5).map(i => ({ type: 'sds', item: i })),
    ];
    alertsEl.innerHTML = combined.length
      ? combined.map(({ type, item }) => type === 'stock'
        ? `<div class="pm-activity-item"><span class="ts"><span class="tag ${hseHzmStockTag(item.stock_status)}">${ref.stock_status_labels[item.stock_status]}</span></span><span>${hseHzmEsc(item.name)} — الرصيد الحالي: ${item.current_quantity} ${item.unit}</span></div>`
        : `<div class="pm-activity-item"><span class="ts"><span class="tag ${hseHzmSdsTag(item.sds_status)}">${ref.sds_status_labels[item.sds_status]}</span></span><span>${hseHzmEsc(item.name)} — مراجعة SDS: ${item.sds_review_date || '—'}</span></div>`
      ).join('')
      : `<div class="pm-empty-state">لا توجد تنبيهات حالياً</div>`;
  } catch (e) {
    hseHzmAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// المواد الخطرة (قائمة / نموذج / تفاصيل)
// ================================================================

document.querySelector('[data-panel="hse-hzm-items"]')?.addEventListener('click', async () => {
  const ref = await hseHzmEnsureRefData();
  document.getElementById('hse-hzm-item-filter-class').innerHTML = '<option value="">كل التصنيفات</option>' + hseHzmOptionsHTML(ref.ghs_hazard_classes, ref.ghs_hazard_class_labels);
  document.getElementById('hse-hzm-item-filter-status').innerHTML = '<option value="">كل الحالات</option>' + hseHzmOptionsHTML(ref.hazmat_item_statuses, ref.hazmat_item_status_labels);
  hseHzmItemShowListView();
  hseHzmLoadItemTable();
});

document.getElementById('hse-hzm-item-search')?.addEventListener('input', debounceHseHzm(() => hseHzmLoadItemTable(), 300));
document.getElementById('hse-hzm-item-filter-class')?.addEventListener('change', () => hseHzmLoadItemTable());
document.getElementById('hse-hzm-item-filter-status')?.addEventListener('change', () => hseHzmLoadItemTable());

async function hseHzmLoadItemTable() {
  const tbody = document.getElementById('hse-hzm-item-tbody');
  const ref = await hseHzmEnsureRefData();
  try {
    const res = await hseHzmFetch('/items', {
      query: {
        search: document.getElementById('hse-hzm-item-search')?.value.trim(),
        hazardClass: document.getElementById('hse-hzm-item-filter-class')?.value,
        status: document.getElementById('hse-hzm-item-filter-status')?.value,
      },
    });
    tbody.innerHTML = res.data.length ? res.data.map(i => `
      <tr>
        <td>${i.code}</td>
        <td>${hseHzmEsc(i.name)}</td>
        <td>${ref.ghs_hazard_class_labels[i.hazard_class] || i.hazard_class}</td>
        <td>${i.current_quantity} ${i.unit}</td>
        <td><span class="tag ${hseHzmStockTag(i.stock_status)}">${i.stock_status_label}</span></td>
        <td><span class="tag ${hseHzmSdsTag(i.sds_status)}">${i.sds_status_label}</span></td>
        <td><span class="tag ${hseHzmStatusTag(i.status)}">${ref.hazmat_item_status_labels[i.status]}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="hseHzmItemShowDetail('${i.id}')">عرض</button>
          <button class="btn btn-sm btn-outline" onclick="hseHzmItemShowForm('${i.id}')">تعديل</button>
          <button class="btn btn-sm btn-danger" onclick="hseHzmItemDelete('${i.id}')">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="8"><div class="pm-empty-state">لا توجد مواد خطرة مسجَّلة</div></td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

function hseHzmItemShowListView() {
  document.getElementById('hse-hzm-item-list-view').style.display = '';
  document.getElementById('hse-hzm-item-form-view').style.display = 'none';
  document.getElementById('hse-hzm-item-detail-view').style.display = 'none';
}

document.getElementById('hse-hzm-item-btn-new')?.addEventListener('click', () => hseHzmItemShowForm());
document.getElementById('hse-hzm-item-btn-back-to-list')?.addEventListener('click', () => { hseHzmItemShowListView(); hseHzmLoadItemTable(); });
document.getElementById('hse-hzm-item-btn-back-from-detail')?.addEventListener('click', () => { hseHzmItemShowListView(); hseHzmLoadItemTable(); });

async function hseHzmItemShowForm(id = null) {
  const ref = await hseHzmEnsureRefData();
  hseHzmItemEditingId = id;
  document.getElementById('hse-hzm-item-list-view').style.display = 'none';
  document.getElementById('hse-hzm-item-detail-view').style.display = 'none';
  document.getElementById('hse-hzm-item-form-view').style.display = '';
  document.getElementById('hse-hzm-item-form-alert').innerHTML = '';

  document.getElementById('hse-hzm-item-f-hazardclass').innerHTML = hseHzmOptionsHTML(ref.ghs_hazard_classes, ref.ghs_hazard_class_labels, { placeholder: '— اختر —' });
  document.getElementById('hse-hzm-item-f-unit').innerHTML = hseHzmOptionsHTML(ref.quantity_units, { kg: 'كيلوجرام', liter: 'لتر', drum: 'برميل', cylinder: 'أسطوانة', bag: 'كيس', ton: 'طن' }, { placeholder: '— اختر —' });
  document.getElementById('hse-hzm-item-f-storage').innerHTML = hseHzmOptionsHTML(ref.storage_conditions, ref.storage_condition_labels, { placeholder: '— اختر —' });
  document.getElementById('hse-hzm-item-f-transport').innerHTML = hseHzmOptionsHTML(ref.transport_methods, ref.transport_method_labels, { placeholder: '— غير محدد —' });

  const fields = ['name', 'cas_number', 'sds_number', 'sds_issue_date', 'sds_issuer', 'sds_review_date',
    'storage_location', 'incompatible_materials', 'usage_instructions', 'required_ppe_notes',
    'emergency_procedures', 'first_aid_measures', 'spill_response', 'fire_fighting_measures',
    'disposal_instructions', 'min_stock_level', 'expiry_date', 'project_id', 'opening_quantity'];
  for (const f of fields) {
    const el = document.getElementById(`hse-hzm-item-f-${f.replace(/_/g, '-')}`);
    if (el) el.value = '';
  }
  document.getElementById('hse-hzm-item-f-opening-quantity-row').style.display = id ? 'none' : '';

  if (id) {
    document.getElementById('hse-hzm-item-form-title').textContent = 'تعديل مادة خطرة';
    const res = await hseHzmFetch('/items/get', { query: { id } });
    const i = res.data;
    document.getElementById('hse-hzm-item-f-name').value = i.name || '';
    document.getElementById('hse-hzm-item-f-cas-number').value = i.cas_number || '';
    document.getElementById('hse-hzm-item-f-hazardclass').value = i.hazard_class || '';
    document.getElementById('hse-hzm-item-f-unit').value = i.unit || '';
    document.getElementById('hse-hzm-item-f-min-stock-level').value = i.min_stock_level || 0;
    document.getElementById('hse-hzm-item-f-expiry-date').value = i.expiry_date || '';
    document.getElementById('hse-hzm-item-f-sds-number').value = i.sds_number || '';
    document.getElementById('hse-hzm-item-f-sds-issue-date').value = i.sds_issue_date || '';
    document.getElementById('hse-hzm-item-f-sds-issuer').value = i.sds_issuer || '';
    document.getElementById('hse-hzm-item-f-sds-review-date').value = i.sds_review_date || '';
    document.getElementById('hse-hzm-item-f-storage').value = i.storage_condition || '';
    document.getElementById('hse-hzm-item-f-storage-location').value = i.storage_location || '';
    document.getElementById('hse-hzm-item-f-incompatible-materials').value = i.incompatible_materials || '';
    document.getElementById('hse-hzm-item-f-transport').value = i.transport_method || '';
    document.getElementById('hse-hzm-item-f-usage-instructions').value = i.usage_instructions || '';
    document.getElementById('hse-hzm-item-f-required-ppe-notes').value = i.required_ppe_notes || '';
    document.getElementById('hse-hzm-item-f-emergency-procedures').value = i.emergency_procedures || '';
    document.getElementById('hse-hzm-item-f-first-aid-measures').value = i.first_aid_measures || '';
    document.getElementById('hse-hzm-item-f-spill-response').value = i.spill_response || '';
    document.getElementById('hse-hzm-item-f-fire-fighting-measures').value = i.fire_fighting_measures || '';
    document.getElementById('hse-hzm-item-f-disposal-instructions').value = i.disposal_instructions || '';
    document.getElementById('hse-hzm-item-f-project-id').value = i.project_id || '';
  } else {
    document.getElementById('hse-hzm-item-form-title').textContent = 'مادة خطرة جديدة';
  }
}

document.getElementById('hse-hzm-item-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-hzm-item-form-alert');
  const payload = {
    name: document.getElementById('hse-hzm-item-f-name').value.trim(),
    cas_number: document.getElementById('hse-hzm-item-f-cas-number').value.trim() || null,
    hazard_class: document.getElementById('hse-hzm-item-f-hazardclass').value,
    unit: document.getElementById('hse-hzm-item-f-unit').value,
    min_stock_level: Number(document.getElementById('hse-hzm-item-f-min-stock-level').value) || 0,
    expiry_date: document.getElementById('hse-hzm-item-f-expiry-date').value || null,
    sds_number: document.getElementById('hse-hzm-item-f-sds-number').value.trim(),
    sds_issue_date: document.getElementById('hse-hzm-item-f-sds-issue-date').value || null,
    sds_issuer: document.getElementById('hse-hzm-item-f-sds-issuer').value.trim(),
    sds_review_date: document.getElementById('hse-hzm-item-f-sds-review-date').value || null,
    storage_condition: document.getElementById('hse-hzm-item-f-storage').value,
    storage_location: document.getElementById('hse-hzm-item-f-storage-location').value.trim() || null,
    incompatible_materials: document.getElementById('hse-hzm-item-f-incompatible-materials').value.trim() || null,
    transport_method: document.getElementById('hse-hzm-item-f-transport').value || null,
    usage_instructions: document.getElementById('hse-hzm-item-f-usage-instructions').value.trim() || null,
    required_ppe_notes: document.getElementById('hse-hzm-item-f-required-ppe-notes').value.trim() || null,
    emergency_procedures: document.getElementById('hse-hzm-item-f-emergency-procedures').value.trim() || null,
    first_aid_measures: document.getElementById('hse-hzm-item-f-first-aid-measures').value.trim() || null,
    spill_response: document.getElementById('hse-hzm-item-f-spill-response').value.trim() || null,
    fire_fighting_measures: document.getElementById('hse-hzm-item-f-fire-fighting-measures').value.trim() || null,
    disposal_instructions: document.getElementById('hse-hzm-item-f-disposal-instructions').value.trim() || null,
    project_id: document.getElementById('hse-hzm-item-f-project-id').value.trim() || null,
  };
  if (!hseHzmItemEditingId) {
    payload.opening_quantity = Number(document.getElementById('hse-hzm-item-f-opening-quantity').value) || 0;
  }
  try {
    if (hseHzmItemEditingId) {
      await hseHzmFetch('/items/update', { method: 'POST', body: { id: hseHzmItemEditingId, ...payload } });
      hseHzmAlert(alertEl, 'success', 'تم تحديث بيانات المادة الخطرة بنجاح');
    } else {
      await hseHzmFetch('/items', { method: 'POST', body: payload });
      hseHzmAlert(alertEl, 'success', 'تم تسجيل المادة الخطرة بنجاح');
    }
    hseHzmItemShowListView();
    hseHzmLoadItemTable();
  } catch (e) {
    hseHzmAlert(alertEl, 'error', e.message);
  }
});

async function hseHzmItemDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المادة الخطرة؟')) return;
  try {
    await hseHzmFetch('/items/delete', { method: 'POST', body: { id } });
    hseHzmLoadItemTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseHzmItemShowDetail(id) {
  const ref = await hseHzmEnsureRefData();
  document.getElementById('hse-hzm-item-list-view').style.display = 'none';
  document.getElementById('hse-hzm-item-form-view').style.display = 'none';
  document.getElementById('hse-hzm-item-detail-view').style.display = '';
  const content = document.getElementById('hse-hzm-item-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';

  try {
    const res = await hseHzmFetch('/items/get', { query: { id } });
    const i = res.data;
    hseHzmMovementItemId = id;

    content.innerHTML = `
      <div class="table-wrap">
        <table class="detail-table">
          <tr><th>الرمز</th><td>${i.code}</td><th>الاسم</th><td>${hseHzmEsc(i.name)}</td></tr>
          <tr><th>رقم CAS</th><td>${i.cas_number || '—'}</td><th>تصنيف الخطر (GHS)</th><td>${ref.ghs_hazard_class_labels[i.hazard_class]}</td></tr>
          <tr><th>الرصيد الحالي</th><td>${i.current_quantity} ${i.unit}</td><th>الحد الأدنى للمخزون</th><td>${i.min_stock_level} ${i.unit}</td></tr>
          <tr><th>حالة المخزون</th><td><span class="tag ${hseHzmStockTag(i.stock_status)}">${i.stock_status_label}</span></td><th>الحالة</th><td><span class="tag ${hseHzmStatusTag(i.status)}">${ref.hazmat_item_status_labels[i.status]}</span></td></tr>
          <tr><th>رقم SDS</th><td>${hseHzmEsc(i.sds_number)}</td><th>حالة SDS</th><td><span class="tag ${hseHzmSdsTag(i.sds_status)}">${i.sds_status_label}</span></td></tr>
          <tr><th>جهة إصدار SDS</th><td>${hseHzmEsc(i.sds_issuer)}</td><th>تاريخ مراجعة SDS القادم</th><td>${i.sds_review_date || '—'}</td></tr>
          <tr><th>موقع التخزين</th><td>${hseHzmEsc(i.storage_location || '—')}</td><th>شرط التخزين</th><td>${ref.storage_condition_labels[i.storage_condition]}</td></tr>
          <tr><th>مواد غير متوافقة</th><td colspan="3">${hseHzmEsc(i.incompatible_materials || '—')}</td></tr>
          <tr><th>طريقة النقل</th><td colspan="3">${i.transport_method ? ref.transport_method_labels[i.transport_method] : '—'}</td></tr>
          <tr><th>تعليمات الاستخدام</th><td colspan="3">${hseHzmEsc(i.usage_instructions || '—')}</td></tr>
          <tr><th>معدات الوقاية المطلوبة</th><td colspan="3">${hseHzmEsc(i.required_ppe_notes || '—')}</td></tr>
          <tr><th>إجراءات الطوارئ</th><td colspan="3">${hseHzmEsc(i.emergency_procedures || '—')}</td></tr>
          <tr><th>الإسعافات الأولية</th><td colspan="3">${hseHzmEsc(i.first_aid_measures || '—')}</td></tr>
          <tr><th>الاستجابة لتسرب المادة</th><td colspan="3">${hseHzmEsc(i.spill_response || '—')}</td></tr>
          <tr><th>إجراءات مكافحة الحريق</th><td colspan="3">${hseHzmEsc(i.fire_fighting_measures || '—')}</td></tr>
          <tr><th>تعليمات التخلص الآمن</th><td colspan="3">${hseHzmEsc(i.disposal_instructions || '—')}</td></tr>
        </table>
      </div>

      <h3 style="margin-top:16px">سجل حركة المخزون</h3>
      <div class="toolbar">
        <select id="hse-hzm-mv-f-type"></select>
        <input type="number" id="hse-hzm-mv-f-qty" placeholder="الكمية" min="0" step="0.01">
        <input type="text" id="hse-hzm-mv-f-ref" placeholder="مرجع / ملاحظة">
        <span id="hse-hzm-mv-disposal-wrap" style="display:none">
          <select id="hse-hzm-mv-f-disposal"></select>
        </span>
        <button class="btn btn-primary" id="hse-hzm-mv-btn-add">+ تسجيل حركة</button>
      </div>
      <div id="hse-hzm-mv-alert"></div>
      <div class="table-wrap">
        <table class="detail-table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>طريقة التخلص</th><th>مرجع</th><th></th></tr></thead>
          <tbody id="hse-hzm-mv-tbody">
            ${i.movements.length ? i.movements.map(m => `
              <tr>
                <td>${(m.moved_at || '').slice(0, 10)}</td>
                <td>${ref.movement_type_labels[m.type] || m.type}</td>
                <td>${m.quantity} ${i.unit}</td>
                <td>${m.disposal_method ? ref.disposal_method_labels[m.disposal_method] : '—'}</td>
                <td>${hseHzmEsc(m.reference || m.notes || '—')}</td>
                <td><button class="btn btn-sm btn-danger" onclick="hseHzmMovementDelete('${m.id}')">حذف</button></td>
              </tr>
            `).join('') : `<tr><td colspan="6"><div class="pm-empty-state">لا توجد حركات مسجَّلة</div></td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('hse-hzm-mv-f-type').innerHTML = hseHzmOptionsHTML(ref.movement_types, ref.movement_type_labels);
    document.getElementById('hse-hzm-mv-f-disposal').innerHTML = hseHzmOptionsHTML(ref.disposal_methods, ref.disposal_method_labels, { placeholder: '— اختر طريقة التخلص —' });
    document.getElementById('hse-hzm-mv-f-type').addEventListener('change', (e) => {
      document.getElementById('hse-hzm-mv-disposal-wrap').style.display = e.target.value === 'disposal' ? '' : 'none';
    });
    document.getElementById('hse-hzm-mv-btn-add').addEventListener('click', () => hseHzmMovementAdd());
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function hseHzmMovementAdd() {
  const alertEl = document.getElementById('hse-hzm-mv-alert');
  const type = document.getElementById('hse-hzm-mv-f-type').value;
  const quantity = Number(document.getElementById('hse-hzm-mv-f-qty').value);
  const reference = document.getElementById('hse-hzm-mv-f-ref').value.trim() || null;
  const disposal_method = document.getElementById('hse-hzm-mv-f-disposal')?.value || null;
  try {
    await hseHzmFetch('/movements', {
      method: 'POST',
      body: { item_id: hseHzmMovementItemId, type, quantity, reference, disposal_method: type === 'disposal' ? disposal_method : null },
    });
    hseHzmAlert(alertEl, 'success', 'تم تسجيل الحركة بنجاح');
    hseHzmItemShowDetail(hseHzmMovementItemId);
  } catch (e) {
    hseHzmAlert(alertEl, 'error', e.message);
  }
}

async function hseHzmMovementDelete(id) {
  if (!confirm('هل أنت متأكد من حذف سجل هذه الحركة؟')) return;
  try {
    await hseHzmFetch('/movements/delete', { method: 'POST', body: { id } });
    hseHzmItemShowDetail(hseHzmMovementItemId);
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// التنبيهات (SDS / المخزون / انتهاء صلاحية المواد)
// ================================================================

document.querySelector('[data-panel="hse-hzm-alerts"]')?.addEventListener('click', () => hseHzmLoadAlerts());
document.getElementById('hse-hzm-alerts-btn-load')?.addEventListener('click', () => hseHzmLoadAlerts());

async function hseHzmLoadAlerts() {
  const ref = await hseHzmEnsureRefData();
  const projectId = document.getElementById('hse-hzm-alerts-project')?.value.trim() || null;
  const sdsEl = document.getElementById('hse-hzm-alerts-sds-tbody');
  const stockEl = document.getElementById('hse-hzm-alerts-stock-tbody');
  const expEl = document.getElementById('hse-hzm-alerts-expiry-tbody');

  try {
    const [sdsRes, stockRes, expRes] = await Promise.all([
      hseHzmFetch('/alerts/sds-expiring', { query: { projectId, withinDays: 60 } }),
      hseHzmFetch('/alerts/low-stock', { query: { projectId } }),
      hseHzmFetch('/alerts/expiring-materials', { query: { projectId, withinDays: 60 } }),
    ]);

    sdsEl.innerHTML = sdsRes.data.length ? sdsRes.data.map(i => `
      <tr><td>${i.code}</td><td>${hseHzmEsc(i.name)}</td><td>${i.sds_review_date}</td><td><span class="tag ${hseHzmSdsTag(i.sds_status)}">${i.sds_status_label}</span></td></tr>
    `).join('') : `<tr><td colspan="4"><div class="pm-empty-state">لا توجد تنبيهات SDS</div></td></tr>`;

    stockEl.innerHTML = stockRes.data.length ? stockRes.data.map(i => `
      <tr><td>${i.code}</td><td>${hseHzmEsc(i.name)}</td><td>${i.current_quantity} ${i.unit}</td><td>${i.min_stock_level} ${i.unit}</td><td><span class="tag ${hseHzmStockTag(i.stock_status)}">${i.stock_status_label}</span></td></tr>
    `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد مواد أقل من الحد الأدنى</div></td></tr>`;

    expEl.innerHTML = expRes.data.length ? expRes.data.map(i => `
      <tr><td>${i.code}</td><td>${hseHzmEsc(i.name)}</td><td>${i.expiry_date}</td><td>${i.days_until_expiry}</td></tr>
    `).join('') : `<tr><td colspan="4"><div class="pm-empty-state">لا توجد مواد تقترب من انتهاء الصلاحية</div></td></tr>`;
  } catch (e) {
    hseHzmAlert(document.getElementById('hse-hzm-alerts-error'), 'error', e.message);
  }
}
