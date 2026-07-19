// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم السابع: إدارة المعدات (الجزء 1/4)
// البيانات الأساسية + إدارة التشغيل + إدارة الحجز + تتبع المعدات
// ============================================================

const EQ_API = '/api/equipment';
let EQ_REF = null; // بيانات مرجعية (فئات/أنواع/حالات) من الخادم
let eqEditingId = null;

// ---------- أدوات عامة ----------
function eqEl(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

async function eqFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${EQ_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'حدث خطأ غير متوقع');
  }
  return data;
}

function eqAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function eqFmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function eqFmtDateTime(d) {
  if (!d) return '—';
  return String(d).slice(0, 16).replace('T', ' ');
}

async function eqEnsureRefData() {
  if (EQ_REF) return EQ_REF;
  const res = await eqFetch('/reference-data');
  EQ_REF = res.data;
  return EQ_REF;
}

function eqCategoryOptionsHTML(ref) {
  return Object.entries(ref.categories).map(([key, cat]) => `<option value="${key}">${cat.label}</option>`).join('');
}

function eqTypeOptionsHTML(ref, category) {
  const cat = ref.categories[category];
  if (!cat) return '';
  return cat.types.map(t => `<option value="${t}">${ref.type_labels[t] || t}</option>`).join('');
}

function eqAllTypeOptionsHTML(ref) {
  return Object.entries(ref.categories).flatMap(([, cat]) =>
    cat.types.map(t => `<option value="${t}">${ref.type_labels[t] || t}</option>`)
  ).join('');
}

function eqStatusOptionsHTML(ref) {
  return ref.statuses.map(s => `<option value="${s}">${ref.status_labels[s]}</option>`).join('');
}

function eqFuelOptionsHTML(ref) {
  const labels = { diesel: 'ديزل', gasoline: 'بنزين', electric: 'كهرباء', hybrid: 'هجين', none: 'بدون' };
  return ref.fuel_types.map(f => `<option value="${f}">${labels[f] || f}</option>`).join('');
}

function eqStatusTag(status) {
  const map = {
    available: 'tag-ok', working: 'tag-ok', stopped: 'tag-bad',
    under_maintenance: 'tag-bad', reserved: 'tag-info', out_of_service: 'tag-bad',
  };
  return map[status] || 'tag-info';
}

async function eqPopulateEquipmentSelect(selectEl, { placeholder = 'اختر المعدة...' } = {}) {
  const res = await eqFetch('/items');
  const items = res.data;
  selectEl.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(e => `<option value="${e.id}">${e.code} — ${e.name}</option>`).join('');
}

// ================================================================
// لوحة معلومات المعدات
// ================================================================

document.querySelector('[data-panel="eq-dashboard"]')?.addEventListener('click', () => {
  eqLoadDashboard();
});

async function eqLoadDashboard() {
  const ref = await eqEnsureRefData();
  const cardsEl = document.getElementById('eq-dash-cards');
  const statusChartEl = document.getElementById('eq-chart-status');
  const recentOpsEl = document.getElementById('eq-recent-ops');

  try {
    const res = await eqFetch('/dashboard');
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المعدات</div><div class="value">${d.total_equipment}</div></div>
      <div class="result-card"><div class="label">المعدات العاملة</div><div class="value">${d.by_status.working || 0}</div></div>
      <div class="result-card"><div class="label">المعدات المتاحة</div><div class="value">${d.by_status.available || 0}</div></div>
      <div class="result-card"><div class="label">تحت الصيانة</div><div class="value">${d.by_status.under_maintenance || 0}</div></div>
      <div class="result-card"><div class="label">إجمالي ساعات التشغيل</div><div class="value">${d.total_operating_hours}<span class="unit">ساعة</span></div></div>
      <div class="result-card"><div class="label">الحجوزات النشطة</div><div class="value">${d.active_reservations}</div></div>
    `;

    const maxCount = Math.max(1, ...Object.values(d.by_status));
    statusChartEl.innerHTML = Object.entries(d.by_status).map(([status, count]) => `
      <div class="pm-bar-row">
        <div class="pm-bar-label">${ref.status_labels[status] || status}</div>
        <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxCount) * 100}%"></div></div>
        <div class="pm-bar-value">${count}</div>
      </div>
    `).join('');

    if (!d.recent_operations.length) {
      recentOpsEl.innerHTML = `<div class="pm-empty-state">لا توجد عمليات تشغيل مسجّلة بعد</div>`;
    } else {
      recentOpsEl.innerHTML = d.recent_operations.map(o => `
        <div class="pm-activity-item">
          <span class="ts">${eqFmtDateTime(o.started_at)}</span>
          <span>${o.operator_name || '—'} — ${o.duration_hours != null ? o.duration_hours + ' ساعة' : 'جارٍ التشغيل'}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    eqAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// سجل المعدات
// ================================================================

document.querySelector('[data-panel="eq-registry"]')?.addEventListener('click', async () => {
  await eqEnsureRefData();
  eqShowListView();
  eqLoadEquipmentTable();
});

function eqShowListView() {
  document.getElementById('eq-list-view').style.display = '';
  document.getElementById('eq-form-view').style.display = 'none';
  document.getElementById('eq-detail-view').style.display = 'none';
}

async function eqLoadEquipmentTable() {
  const ref = await eqEnsureRefData();
  const tbody = document.getElementById('eq-tbody');

  // تعبئة قوائم الفلترة إن لم تكن معبأة
  const catFilter = document.getElementById('eq-filter-category');
  if (catFilter.options.length <= 1) catFilter.innerHTML += eqCategoryOptionsHTML(ref);
  const statusFilter = document.getElementById('eq-filter-status');
  if (statusFilter.options.length <= 1) statusFilter.innerHTML += eqStatusOptionsHTML(ref);

  try {
    const res = await eqFetch('/items', {
      query: {
        search: document.getElementById('eq-search').value || null,
        category: catFilter.value || null,
        status: statusFilter.value || null,
      },
    });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-state">لا توجد معدات مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(e => `
      <tr>
        <td>${e.code}</td>
        <td>${e.name}</td>
        <td>${ref.type_labels[e.type] || e.type}</td>
        <td><span class="tag ${eqStatusTag(e.status)}">${ref.status_labels[e.status] || e.status}</span></td>
        <td>${e.current_location || '—'}</td>
        <td>${e.total_operating_hours}</td>
        <td>
          <button class="pm-link-btn" data-eq-view="${e.id}">عرض</button>
          <button class="pm-link-btn" data-eq-edit="${e.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-eq-delete="${e.id}">حذف</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-eq-view]').forEach(b => b.addEventListener('click', () => eqShowDetail(b.dataset.eqView)));
    tbody.querySelectorAll('[data-eq-edit]').forEach(b => b.addEventListener('click', () => eqShowForm(b.dataset.eqEdit)));
    tbody.querySelectorAll('[data-eq-delete]').forEach(b => b.addEventListener('click', () => eqDeleteEquipment(b.dataset.eqDelete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('eq-search')?.addEventListener('input', debounceEq(() => eqLoadEquipmentTable(), 300));
document.getElementById('eq-filter-category')?.addEventListener('change', () => eqLoadEquipmentTable());
document.getElementById('eq-filter-status')?.addEventListener('change', () => eqLoadEquipmentTable());

function debounceEq(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.getElementById('eq-btn-new')?.addEventListener('click', () => eqShowForm(null));
document.getElementById('eq-btn-back-to-list')?.addEventListener('click', () => { eqShowListView(); eqLoadEquipmentTable(); });
document.getElementById('eq-btn-back-from-detail')?.addEventListener('click', () => { eqShowListView(); eqLoadEquipmentTable(); });

async function eqShowForm(id) {
  const ref = await eqEnsureRefData();
  eqEditingId = id;

  document.getElementById('eq-list-view').style.display = 'none';
  document.getElementById('eq-detail-view').style.display = 'none';
  document.getElementById('eq-form-view').style.display = '';
  document.getElementById('eq-form-alert').innerHTML = '';

  const catSelect = document.getElementById('eq-f-category');
  catSelect.innerHTML = eqCategoryOptionsHTML(ref);
  const typeSelect = document.getElementById('eq-f-type');
  const refreshTypes = () => { typeSelect.innerHTML = eqTypeOptionsHTML(ref, catSelect.value); };
  catSelect.onchange = refreshTypes;
  refreshTypes();

  document.getElementById('eq-f-fuel').innerHTML = eqFuelOptionsHTML(ref);
  document.getElementById('eq-f-status').innerHTML = eqStatusOptionsHTML(ref);

  // إعادة تعيين الحقول
  const ids = ['name', 'code', 'manufacturer', 'model', 'year', 'serial', 'chassis', 'engine', 'color',
    'weight', 'load', 'power', 'tank', 'fuel-avg', 'location', 'project', 'responsible',
    'purchase-date', 'purchase-price', 'useful-life', 'warranty', 'insurance', 'rental-cost'];
  ids.forEach(k => { const elx = document.getElementById(`eq-f-${k}`); if (elx) elx.value = ''; });
  document.getElementById('eq-f-ownership').value = 'owned';

  if (id) {
    try {
      const res = await eqFetch('/items/get', { query: { id } });
      const e = res.data;
      document.getElementById('eq-f-name').value = e.name || '';
      catSelect.value = e.category || '';
      refreshTypes();
      typeSelect.value = e.type || '';
      document.getElementById('eq-f-code').value = e.code || '';
      document.getElementById('eq-f-manufacturer').value = e.manufacturer || '';
      document.getElementById('eq-f-model').value = e.model || '';
      document.getElementById('eq-f-year').value = e.manufacture_year || '';
      document.getElementById('eq-f-serial').value = e.serial_number || '';
      document.getElementById('eq-f-chassis').value = e.chassis_number || '';
      document.getElementById('eq-f-engine').value = e.engine_number || '';
      document.getElementById('eq-f-color').value = e.color || '';
      document.getElementById('eq-f-weight').value = e.weight_kg ?? '';
      document.getElementById('eq-f-load').value = e.load_capacity ?? '';
      document.getElementById('eq-f-power').value = e.operating_power || '';
      document.getElementById('eq-f-tank').value = e.tank_capacity_l ?? '';
      document.getElementById('eq-f-fuel').value = e.fuel_type || 'diesel';
      document.getElementById('eq-f-fuel-avg').value = e.avg_fuel_consumption ?? '';
      document.getElementById('eq-f-location').value = e.current_location || '';
      document.getElementById('eq-f-project').value = e.current_project_id || '';
      document.getElementById('eq-f-responsible').value = e.responsible_person || '';
      document.getElementById('eq-f-status').value = e.status || 'available';
      document.getElementById('eq-f-ownership').value = e.ownership || 'owned';
      document.getElementById('eq-f-purchase-date').value = eqFmtDate(e.purchase_date) !== '—' ? e.purchase_date : '';
      document.getElementById('eq-f-purchase-price').value = e.purchase_price ?? '';
      document.getElementById('eq-f-useful-life').value = e.useful_life_years ?? '';
      document.getElementById('eq-f-warranty').value = eqFmtDate(e.warranty_expiry) !== '—' ? e.warranty_expiry : '';
      document.getElementById('eq-f-insurance').value = eqFmtDate(e.insurance_expiry) !== '—' ? e.insurance_expiry : '';
      document.getElementById('eq-f-rental-cost').value = e.rental_cost_per_hour ?? '';
    } catch (err) {
      eqAlert(document.getElementById('eq-form-alert'), 'error', err.message);
    }
  }
}

document.getElementById('eq-btn-save')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('eq-form-alert');
  const payload = {
    name: document.getElementById('eq-f-name').value.trim(),
    category: document.getElementById('eq-f-category').value,
    type: document.getElementById('eq-f-type').value,
    code: document.getElementById('eq-f-code').value.trim() || undefined,
    manufacturer: document.getElementById('eq-f-manufacturer').value || null,
    model: document.getElementById('eq-f-model').value || null,
    manufacture_year: document.getElementById('eq-f-year').value ? Number(document.getElementById('eq-f-year').value) : null,
    serial_number: document.getElementById('eq-f-serial').value || null,
    chassis_number: document.getElementById('eq-f-chassis').value || null,
    engine_number: document.getElementById('eq-f-engine').value || null,
    color: document.getElementById('eq-f-color').value || null,
    weight_kg: document.getElementById('eq-f-weight').value ? Number(document.getElementById('eq-f-weight').value) : null,
    load_capacity: document.getElementById('eq-f-load').value ? Number(document.getElementById('eq-f-load').value) : null,
    operating_power: document.getElementById('eq-f-power').value || null,
    tank_capacity_l: document.getElementById('eq-f-tank').value ? Number(document.getElementById('eq-f-tank').value) : null,
    fuel_type: document.getElementById('eq-f-fuel').value,
    avg_fuel_consumption: document.getElementById('eq-f-fuel-avg').value ? Number(document.getElementById('eq-f-fuel-avg').value) : null,
    current_location: document.getElementById('eq-f-location').value || null,
    current_project_id: document.getElementById('eq-f-project').value || null,
    responsible_person: document.getElementById('eq-f-responsible').value || null,
    status: document.getElementById('eq-f-status').value,
    ownership: document.getElementById('eq-f-ownership').value,
    purchase_date: document.getElementById('eq-f-purchase-date').value || null,
    purchase_price: document.getElementById('eq-f-purchase-price').value ? Number(document.getElementById('eq-f-purchase-price').value) : null,
    useful_life_years: document.getElementById('eq-f-useful-life').value ? Number(document.getElementById('eq-f-useful-life').value) : null,
    warranty_expiry: document.getElementById('eq-f-warranty').value || null,
    insurance_expiry: document.getElementById('eq-f-insurance').value || null,
    rental_cost_per_hour: document.getElementById('eq-f-rental-cost').value ? Number(document.getElementById('eq-f-rental-cost').value) : null,
  };

  try {
    if (eqEditingId) {
      await eqFetch('/items/update', { method: 'POST', body: { id: eqEditingId, ...payload } });
      eqAlert(alertBox, 'success', 'تم تحديث بيانات المعدة بنجاح');
    } else {
      await eqFetch('/items', { method: 'POST', body: payload });
      eqAlert(alertBox, 'success', 'تم إنشاء المعدة بنجاح');
    }
    setTimeout(() => { eqShowListView(); eqLoadEquipmentTable(); }, 700);
  } catch (e) {
    eqAlert(alertBox, 'error', e.message);
  }
});

async function eqDeleteEquipment(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المعدة؟ سيتم الاحتفاظ بسجلها التاريخي.')) return;
  try {
    await eqFetch('/items/delete', { method: 'POST', body: { id } });
    eqLoadEquipmentTable();
  } catch (e) {
    alert(e.message);
  }
}

async function eqShowDetail(id) {
  const ref = await eqEnsureRefData();
  document.getElementById('eq-list-view').style.display = 'none';
  document.getElementById('eq-form-view').style.display = 'none';
  document.getElementById('eq-detail-view').style.display = '';
  const content = document.getElementById('eq-detail-content');
  content.innerHTML = `<div class="pm-empty-state">جارٍ التحميل...</div>`;

  try {
    const res = await eqFetch('/items/get', { query: { id } });
    const e = res.data;

    const specRows = [
      ['الفئة', ref.categories[e.category]?.label || e.category],
      ['النوع', ref.type_labels[e.type] || e.type],
      ['الشركة المصنعة', e.manufacturer || '—'],
      ['الموديل', e.model || '—'],
      ['سنة الصنع', e.manufacture_year || '—'],
      ['الرقم التسلسلي', e.serial_number || '—'],
      ['رقم الهيكل', e.chassis_number || '—'],
      ['رقم المحرك', e.engine_number || '—'],
      ['الوزن (كجم)', e.weight_kg ?? '—'],
      ['الحمولة', e.load_capacity ?? '—'],
      ['نوع الوقود', e.fuel_type || '—'],
      ['سعة الخزان (لتر)', e.tank_capacity_l ?? '—'],
    ];
    const ownershipRows = [
      ['نوع الملكية', e.ownership === 'owned' ? 'مملوكة' : e.ownership === 'rented' ? 'مستأجرة' : 'تأجير تمويلي'],
      ['تاريخ الشراء', eqFmtDate(e.purchase_date)],
      ['سعر الشراء', e.purchase_price ?? '—'],
      ['تاريخ انتهاء الضمان', eqFmtDate(e.warranty_expiry)],
      ['تاريخ انتهاء التأمين', eqFmtDate(e.insurance_expiry)],
      ['تكلفة الإيجار بالساعة', e.rental_cost_per_hour ?? '—'],
    ];

    content.innerHTML = `
      <div class="panel-header" style="border:none;padding:0 0 12px 0">
        <h2>${e.name} <span class="tag ${eqStatusTag(e.status)}">${ref.status_labels[e.status]}</span></h2>
        <span class="panel-code">${e.code}</span>
      </div>
      <div class="result-cards">
        <div class="result-card"><div class="label">الموقع الحالي</div><div class="value" style="font-size:16px">${e.current_location || '—'}</div></div>
        <div class="result-card"><div class="label">المشروع الحالي</div><div class="value" style="font-size:16px">${e.current_project_id || '—'}</div></div>
        <div class="result-card"><div class="label">إجمالي ساعات التشغيل</div><div class="value">${e.total_operating_hours}</div></div>
        <div class="result-card"><div class="label">أيام العمل</div><div class="value">${e.total_working_days}</div></div>
      </div>

      <div class="pm-grid-2">
        <div class="pm-card">
          <div class="pm-card-title">المواصفات الفنية</div>
          <table class="detail-table">${specRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        </div>
        <div class="pm-card">
          <div class="pm-card-title">الملكية والبيانات المالية</div>
          <table class="detail-table">${ownershipRows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        </div>
      </div>

      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">آخر سجلات التشغيل</div>
        <table class="detail-table">
          <thead><tr><th>البداية</th><th>النهاية</th><th>المدة</th><th>المشغّل</th></tr></thead>
          <tbody>
            ${(e.recent_operations || []).length
              ? e.recent_operations.map(o => `<tr><td>${eqFmtDateTime(o.started_at)}</td><td>${o.ended_at ? eqFmtDateTime(o.ended_at) : 'جارٍ'}</td><td>${o.duration_hours ?? '—'}</td><td>${o.operator_name || '—'}</td></tr>`).join('')
              : `<tr><td colspan="4" class="pm-empty-state">لا توجد سجلات تشغيل</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">الحجوزات</div>
        <table class="detail-table">
          <thead><tr><th>المشروع</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead>
          <tbody>
            ${(e.recent_reservations || []).length
              ? e.recent_reservations.map(r => `<tr><td>${r.project_id}</td><td>${eqFmtDate(r.start_date)}</td><td>${eqFmtDate(r.end_date)}</td><td>${r.status === 'active' ? 'نشط' : 'ملغى'}</td></tr>`).join('')
              : `<tr><td colspan="4" class="pm-empty-state">لا توجد حجوزات</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">آخر التحركات</div>
        <table class="detail-table">
          <thead><tr><th>من</th><th>إلى</th><th>التاريخ</th></tr></thead>
          <tbody>
            ${(e.recent_movements || []).length
              ? e.recent_movements.map(m => `<tr><td>${m.from_location || '—'}</td><td>${m.to_location}</td><td>${eqFmtDateTime(m.moved_at)}</td></tr>`).join('')
              : `<tr><td colspan="3" class="pm-empty-state">لا توجد تحركات مسجّلة</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
}

// ================================================================
// إدارة التشغيل
// ================================================================

document.querySelector('[data-panel="eq-operations"]')?.addEventListener('click', async () => {
  await eqEnsureRefData();
  await eqPopulateEquipmentSelect(document.getElementById('eq-op-equipment'));
  eqLoadOpenOperations();
  eqLoadOperationsLog();
});

document.getElementById('eq-btn-start-op')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('eq-op-alert');
  const equipmentId = document.getElementById('eq-op-equipment').value;
  if (!equipmentId) { eqAlert(alertBox, 'error', 'يرجى اختيار المعدة'); return; }

  try {
    await eqFetch('/operations/start', {
      method: 'POST',
      body: {
        equipment_id: equipmentId,
        project_id: document.getElementById('eq-op-project').value || null,
        operator_name: document.getElementById('eq-op-operator').value || null,
        odometer_start: document.getElementById('eq-op-odometer-start').value ? Number(document.getElementById('eq-op-odometer-start').value) : null,
      },
    });
    eqAlert(alertBox, 'success', 'تم بدء التشغيل بنجاح');
    document.getElementById('eq-op-project').value = '';
    document.getElementById('eq-op-operator').value = '';
    document.getElementById('eq-op-odometer-start').value = '';
    eqLoadOpenOperations();
  } catch (e) {
    eqAlert(alertBox, 'error', e.message);
  }
});

async function eqLoadOpenOperations() {
  const tbody = document.getElementById('eq-open-ops-tbody');
  try {
    const res = await eqFetch('/operations', { query: { openOnly: 'true' } });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="pm-empty-state">لا توجد تشغيلات مفتوحة حالياً</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(o => `
      <tr>
        <td>${o.equipment_id}</td>
        <td>${o.project_id || '—'}</td>
        <td>${o.operator_name || '—'}</td>
        <td>${eqFmtDateTime(o.started_at)}</td>
        <td><button class="pm-link-btn" data-eq-end-op="${o.id}">إنهاء التشغيل</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-eq-end-op]').forEach(b => b.addEventListener('click', () => eqEndOperation(b.dataset.eqEndOp)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

async function eqEndOperation(operationId) {
  const odometerEnd = prompt('قراءة العداد عند نهاية التشغيل (اختياري):');
  try {
    await eqFetch('/operations/end', {
      method: 'POST',
      body: { operation_id: operationId, odometer_end: odometerEnd ? Number(odometerEnd) : null },
    });
    eqLoadOpenOperations();
    eqLoadOperationsLog();
  } catch (e) {
    alert(e.message);
  }
}

async function eqLoadOperationsLog() {
  const tbody = document.getElementById('eq-ops-log-tbody');
  try {
    const res = await eqFetch('/operations');
    const items = res.data.slice(0, 30);
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد سجلات تشغيل</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(o => `
      <tr>
        <td>${o.equipment_id}</td>
        <td>${o.project_id || '—'}</td>
        <td>${eqFmtDateTime(o.started_at)}</td>
        <td>${o.ended_at ? eqFmtDateTime(o.ended_at) : 'جارٍ'}</td>
        <td>${o.duration_hours ?? '—'}</td>
        <td>${o.distance_covered ?? '—'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

// ================================================================
// إدارة الحجز
// ================================================================

document.querySelector('[data-panel="eq-reservations"]')?.addEventListener('click', async () => {
  await eqPopulateEquipmentSelect(document.getElementById('eq-rsv-equipment'));
  eqLoadReservations();
});

document.getElementById('eq-btn-create-rsv')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('eq-rsv-alert');
  const equipmentId = document.getElementById('eq-rsv-equipment').value;
  const projectId = document.getElementById('eq-rsv-project').value.trim();
  const start = document.getElementById('eq-rsv-start').value;
  const end = document.getElementById('eq-rsv-end').value;

  if (!equipmentId) { eqAlert(alertBox, 'error', 'يرجى اختيار المعدة'); return; }
  if (!projectId) { eqAlert(alertBox, 'error', 'معرّف المشروع مطلوب'); return; }
  if (!start || !end) { eqAlert(alertBox, 'error', 'تاريخ البداية والنهاية مطلوبان'); return; }

  try {
    await eqFetch('/reservations', {
      method: 'POST',
      body: {
        equipment_id: equipmentId,
        project_id: projectId,
        start_date: start,
        end_date: end,
        responsible_person: document.getElementById('eq-rsv-responsible').value || null,
        note: document.getElementById('eq-rsv-note').value || null,
      },
    });
    eqAlert(alertBox, 'success', 'تم إنشاء الحجز بنجاح');
    document.getElementById('eq-rsv-project').value = '';
    document.getElementById('eq-rsv-start').value = '';
    document.getElementById('eq-rsv-end').value = '';
    document.getElementById('eq-rsv-responsible').value = '';
    document.getElementById('eq-rsv-note').value = '';
    eqLoadReservations();
  } catch (e) {
    eqAlert(alertBox, 'error', e.message);
  }
});

async function eqLoadReservations() {
  const tbody = document.getElementById('eq-rsv-tbody');
  try {
    const res = await eqFetch('/reservations', { query: { status: 'active' } });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد حجوزات نشطة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(r => `
      <tr>
        <td>${r.equipment_id}</td>
        <td>${r.project_id}</td>
        <td>${eqFmtDate(r.start_date)}</td>
        <td>${eqFmtDate(r.end_date)}</td>
        <td>${r.responsible_person || '—'}</td>
        <td><button class="pm-link-btn pm-mini-btn-danger" data-eq-cancel-rsv="${r.id}">إلغاء</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-eq-cancel-rsv]').forEach(b => b.addEventListener('click', () => eqCancelReservation(b.dataset.eqCancelRsv)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

async function eqCancelReservation(id) {
  if (!confirm('هل تريد إلغاء هذا الحجز؟')) return;
  try {
    await eqFetch('/reservations/cancel', { method: 'POST', body: { id } });
    eqLoadReservations();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// تتبع المعدات
// ================================================================

document.querySelector('[data-panel="eq-tracking"]')?.addEventListener('click', async () => {
  await eqPopulateEquipmentSelect(document.getElementById('eq-mov-equipment'));
  await eqPopulateEquipmentSelect(document.getElementById('eq-track-equipment'));
});

document.getElementById('eq-btn-log-mov')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('eq-mov-alert');
  const equipmentId = document.getElementById('eq-mov-equipment').value;
  const toLocation = document.getElementById('eq-mov-to-location').value.trim();

  if (!equipmentId) { eqAlert(alertBox, 'error', 'يرجى اختيار المعدة'); return; }
  if (!toLocation) { eqAlert(alertBox, 'error', 'الموقع الجديد مطلوب'); return; }

  try {
    await eqFetch('/tracking/movement', {
      method: 'POST',
      body: {
        equipment_id: equipmentId,
        to_location: toLocation,
        to_project_id: document.getElementById('eq-mov-to-project').value || null,
        note: document.getElementById('eq-mov-note').value || null,
      },
    });
    eqAlert(alertBox, 'success', 'تم تسجيل الحركة بنجاح');
    document.getElementById('eq-mov-to-location').value = '';
    document.getElementById('eq-mov-to-project').value = '';
    document.getElementById('eq-mov-note').value = '';
  } catch (e) {
    eqAlert(alertBox, 'error', e.message);
  }
});

document.getElementById('eq-btn-load-track')?.addEventListener('click', async () => {
  const equipmentId = document.getElementById('eq-track-equipment').value;
  const content = document.getElementById('eq-track-content');
  if (!equipmentId) { eqAlert(content, 'error', 'يرجى اختيار المعدة'); return; }

  content.innerHTML = `<div class="pm-empty-state">جارٍ التحميل...</div>`;
  try {
    const res = await eqFetch('/tracking/history', { query: { equipmentId } });
    const d = res.data;
    content.innerHTML = `
      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">الموقع الحالي: ${d.current_location || '—'} | المشروع: ${d.current_project_id || '—'}</div>
        <table class="detail-table">
          <thead><tr><th>من</th><th>إلى</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
          <tbody>
            ${d.movement_history.length
              ? d.movement_history.map(m => `<tr><td>${m.from_location || '—'}</td><td>${m.to_location}</td><td>${eqFmtDateTime(m.moved_at)}</td><td>${m.note || '—'}</td></tr>`).join('')
              : `<tr><td colspan="4" class="pm-empty-state">لا توجد تحركات مسجّلة</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">سجل التشغيل الكامل</div>
        <table class="detail-table">
          <thead><tr><th>البداية</th><th>النهاية</th><th>المدة</th><th>المشغّل</th></tr></thead>
          <tbody>
            ${d.operation_history.length
              ? d.operation_history.map(o => `<tr><td>${eqFmtDateTime(o.started_at)}</td><td>${o.ended_at ? eqFmtDateTime(o.ended_at) : 'جارٍ'}</td><td>${o.duration_hours ?? '—'}</td><td>${o.operator_name || '—'}</td></tr>`).join('')
              : `<tr><td colspan="4" class="pm-empty-state">لا توجد سجلات تشغيل</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
});
