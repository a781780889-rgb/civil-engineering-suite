// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم السابع: إدارة المعدات
// الجزء 1/4: البيانات الأساسية + إدارة التشغيل + إدارة الحجز + تتبع المعدات
// الجزء 2/4: الوقود + الصيانة (الدورية والطارئة) + قطع الغيار + المشغلون
// الجزء 3/4: إدارة التكاليف + إدارة الإنتاجية + مركز التنبيهات الموحّد
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

// ================================================================
// ===== الجزء الثاني: إدارة الوقود =====
// ================================================================

let EQ_REF2 = null; // بيانات مرجعية إضافية للجزء الثاني
let eqMrecPartsBuffer = []; // قطع الغيار المضافة مؤقتاً لسجل صيانة قيد الإنشاء

async function eqEnsureRefData2() {
  if (EQ_REF2) return EQ_REF2;
  const res = await eqFetch('/reference-data-p2');
  EQ_REF2 = res.data;
  return EQ_REF2;
}

document.querySelector('[data-panel="eq-fuel"]')?.addEventListener('click', async () => {
  const ref = await eqEnsureRefData();
  await eqPopulateEquipmentSelect(document.getElementById('eq-fuel-equipment'));
  await eqPopulateEquipmentSelect(document.getElementById('eq-fuel-stats-equipment'), { placeholder: 'اختر معدة لعرض إحصائياتها...' });
  const fuelTypeSel = document.getElementById('eq-fuel-type');
  if (fuelTypeSel.options.length <= 1) fuelTypeSel.innerHTML += eqFuelOptionsHTML(ref);
  eqLoadFuelLogTable();
});

document.getElementById('eq-btn-log-fuel')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-fuel-alert');
  try {
    const payload = {
      equipment_id: document.getElementById('eq-fuel-equipment').value,
      quantity: Number(document.getElementById('eq-fuel-quantity').value) || 0,
      fuel_type: document.getElementById('eq-fuel-type').value || null,
      unit_price: Number(document.getElementById('eq-fuel-price').value) || 0,
      odometer_or_hours: document.getElementById('eq-fuel-odometer').value ? Number(document.getElementById('eq-fuel-odometer').value) : null,
      station: document.getElementById('eq-fuel-station').value || null,
      note: document.getElementById('eq-fuel-note').value || null,
    };
    if (!payload.equipment_id) throw new Error('يرجى اختيار المعدة');
    await eqFetch('/fuel/log', { method: 'POST', body: payload });
    eqAlert(alertEl, 'success', 'تم تسجيل عملية التعبئة بنجاح');
    ['eq-fuel-quantity', 'eq-fuel-price', 'eq-fuel-odometer', 'eq-fuel-station', 'eq-fuel-note'].forEach(id => document.getElementById(id).value = '');
    eqLoadFuelLogTable();
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

async function eqLoadFuelLogTable() {
  const tbody = document.getElementById('eq-fuel-log-tbody');
  try {
    const res = await eqFetch('/fuel/logs');
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد عمليات تعبئة مسجّلة</td></tr>`;
      return;
    }
    const eqRes = await eqFetch('/items');
    const eqMap = Object.fromEntries(eqRes.data.map(e => [e.id, e]));
    tbody.innerHTML = items.map(f => `
      <tr>
        <td>${eqMap[f.equipment_id] ? eqMap[f.equipment_id].code + ' — ' + eqMap[f.equipment_id].name : f.equipment_id}</td>
        <td>${f.quantity}</td>
        <td>${f.unit_price}</td>
        <td>${f.cost}</td>
        <td>${f.station || '—'}</td>
        <td>${eqFmtDateTime(f.filled_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('eq-btn-load-fuel-stats')?.addEventListener('click', async () => {
  const content = document.getElementById('eq-fuel-stats-content');
  const equipmentId = document.getElementById('eq-fuel-stats-equipment').value;
  if (!equipmentId) { eqAlert(content, 'error', 'يرجى اختيار المعدة'); return; }
  const period = document.getElementById('eq-fuel-stats-period').value;
  try {
    const res = await eqFetch('/fuel/stats', { query: { equipmentId, period } });
    const d = res.data;
    content.innerHTML = `
      <div class="result-cards">
        <div class="result-card"><div class="label">عدد عمليات التعبئة</div><div class="value">${d.entries_count}</div></div>
        <div class="result-card"><div class="label">إجمالي الكمية</div><div class="value">${d.total_quantity}<span class="unit">لتر</span></div></div>
        <div class="result-card"><div class="label">إجمالي التكلفة</div><div class="value">${d.total_cost}</div></div>
        <div class="result-card"><div class="label">متوسط سعر اللتر</div><div class="value">${d.average_unit_price}</div></div>
        <div class="result-card"><div class="label">متوسط الاستهلاك</div><div class="value">${d.average_consumption_per_hour_or_km ?? '—'}</div></div>
      </div>
      ${d.abnormal_consumption_entries.length ? `
        <div class="alert alert-error" style="margin-top:12px">
          تم رصد ${d.abnormal_consumption_entries.length} عملية تعبئة باستهلاك غير طبيعي (تتجاوز المتوسط بنسبة كبيرة).
        </div>` : ''}
    `;
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
});

// ================================================================
// ===== الجزء الثاني: إدارة الصيانة =====
// ================================================================

document.querySelector('[data-panel="eq-maintenance"]')?.addEventListener('click', async () => {
  const ref = await eqEnsureRefData();
  const ref2 = await eqEnsureRefData2();

  await eqPopulateEquipmentSelect(document.getElementById('eq-msch-equipment'));
  await eqPopulateEquipmentSelect(document.getElementById('eq-mrec-equipment'));
  await eqPopulateEquipmentSelect(document.getElementById('eq-mstats-equipment'), { placeholder: 'اختر معدة لعرض إحصائياتها...' });

  const freqSel = document.getElementById('eq-msch-frequency');
  if (freqSel.options.length === 0) {
    freqSel.innerHTML = ref2.maintenance_frequencies.map(f => `<option value="${f}">${ref2.maintenance_frequency_labels[f]}</option>`).join('');
  }
  const sevSel = document.getElementById('eq-mrec-severity');
  if (sevSel.options.length <= 1) {
    sevSel.innerHTML += ref2.maintenance_severities.map(s => `<option value="${s}">${ref2.maintenance_severity_labels[s]}</option>`).join('');
  }
  const statusSel = document.getElementById('eq-mrec-status');
  if (statusSel.options.length === 0) {
    statusSel.innerHTML = ref2.maintenance_statuses.map(s => `<option value="${s}"${s === 'scheduled' ? ' selected' : ''}>${ref2.maintenance_status_labels[s]}</option>`).join('');
  }
  await eqPopulateSparePartSelect(document.getElementById('eq-mrec-part'));

  eqLoadMaintenanceAlerts();
  eqLoadMaintenanceSchedulesTable(ref2);
  eqLoadMaintenanceRecordsTable(ref2);
});

document.getElementById('eq-btn-load-maint-alerts')?.addEventListener('click', () => eqLoadMaintenanceAlerts());

async function eqLoadMaintenanceAlerts() {
  const content = document.getElementById('eq-maint-alerts-content');
  try {
    const res = await eqFetch('/maintenance/alerts', { query: { withinDays: 14 } });
    const items = res.data;
    if (!items.length) {
      content.innerHTML = `<div class="pm-empty-state">لا توجد تنبيهات صيانة حالياً</div>`;
      return;
    }
    const typeLabel = { date_due: 'موعد قادم', date_overdue: 'متأخرة', hours_due: 'اقتراب ساعات التشغيل', hours_overdue: 'تجاوز ساعات التشغيل' };
    content.innerHTML = items.map(a => `
      <div class="pm-activity-item">
        <span class="tag ${a.type.includes('overdue') ? 'tag-danger' : 'tag-warning'}">${typeLabel[a.type] || a.type}</span>
        <span>${a.equipment_code} — ${a.equipment_name}${a.due_date ? ' — ' + eqFmtDate(a.due_date) : ''}${a.remaining_hours != null ? ' — متبقٍ ' + a.remaining_hours + ' ساعة' : ''}</span>
      </div>
    `).join('');
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
}

document.getElementById('eq-btn-create-msch')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-msch-alert');
  try {
    const payload = {
      equipment_id: document.getElementById('eq-msch-equipment').value,
      frequency: document.getElementById('eq-msch-frequency').value,
      interval_hours: document.getElementById('eq-msch-interval-hours').value ? Number(document.getElementById('eq-msch-interval-hours').value) : null,
      next_due_date: document.getElementById('eq-msch-next-date').value || null,
      next_due_hours: document.getElementById('eq-msch-next-hours').value ? Number(document.getElementById('eq-msch-next-hours').value) : null,
      assigned_to: document.getElementById('eq-msch-assigned').value || null,
      description: document.getElementById('eq-msch-desc').value || null,
    };
    if (!payload.equipment_id) throw new Error('يرجى اختيار المعدة');
    await eqFetch('/maintenance/schedules', { method: 'POST', body: payload });
    eqAlert(alertEl, 'success', 'تم إنشاء جدولة الصيانة بنجاح');
    ['eq-msch-interval-hours', 'eq-msch-next-date', 'eq-msch-next-hours', 'eq-msch-assigned', 'eq-msch-desc'].forEach(id => document.getElementById(id).value = '');
    const ref2 = await eqEnsureRefData2();
    eqLoadMaintenanceSchedulesTable(ref2);
    eqLoadMaintenanceAlerts();
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

async function eqLoadMaintenanceSchedulesTable(ref2) {
  const tbody = document.getElementById('eq-msch-tbody');
  try {
    const res = await eqFetch('/maintenance/schedules');
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="pm-empty-state">لا توجد جداول صيانة</td></tr>`;
      return;
    }
    const eqRes = await eqFetch('/items');
    const eqMap = Object.fromEntries(eqRes.data.map(e => [e.id, e]));
    tbody.innerHTML = items.map(s => `
      <tr>
        <td>${eqMap[s.equipment_id] ? eqMap[s.equipment_id].code + ' — ' + eqMap[s.equipment_id].name : s.equipment_id}</td>
        <td>${ref2.maintenance_frequency_labels[s.frequency] || s.frequency}</td>
        <td>${s.next_due_date ? eqFmtDate(s.next_due_date) : (s.next_due_hours != null ? s.next_due_hours + ' ساعة' : '—')}</td>
        <td>${s.assigned_to || '—'}</td>
        <td><button class="pm-link-btn pm-mini-btn-danger" data-msch-delete="${s.id}">حذف</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-msch-delete]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('هل تريد حذف جدولة الصيانة؟')) return;
      await eqFetch('/maintenance/schedules/delete', { method: 'POST', body: { id: b.dataset.mschDelete } });
      eqLoadMaintenanceSchedulesTable(ref2);
      eqLoadMaintenanceAlerts();
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

async function eqPopulateSparePartSelect(selectEl) {
  const res = await eqFetch('/spare-parts');
  selectEl.innerHTML = `<option value="">اختر قطعة الغيار...</option>` +
    res.data.map(p => `<option value="${p.id}">${p.name} (متاح: ${p.stock_quantity})</option>`).join('');
}

document.getElementById('eq-btn-add-part-use')?.addEventListener('click', () => {
  const partSel = document.getElementById('eq-mrec-part');
  const qtyInput = document.getElementById('eq-mrec-part-qty');
  const partId = partSel.value;
  const qty = Number(qtyInput.value) || 0;
  if (!partId || qty <= 0) return;
  const partName = partSel.options[partSel.selectedIndex].textContent;
  eqMrecPartsBuffer.push({ part_id: partId, quantity: qty, label: partName });
  eqRenderMrecPartsBuffer();
  qtyInput.value = 1;
});

function eqRenderMrecPartsBuffer() {
  const el = document.getElementById('eq-mrec-parts-list');
  if (!eqMrecPartsBuffer.length) {
    el.innerHTML = `<div class="pm-empty-state">لم تُضف أي قطع غيار بعد</div>`;
    return;
  }
  el.innerHTML = eqMrecPartsBuffer.map((p, idx) => `
    <div class="pm-activity-item">
      <span>${p.label} — الكمية: ${p.quantity}</span>
      <button class="pm-link-btn pm-mini-btn-danger" data-remove-part="${idx}">إزالة</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-remove-part]').forEach(b => b.addEventListener('click', () => {
    eqMrecPartsBuffer.splice(Number(b.dataset.removePart), 1);
    eqRenderMrecPartsBuffer();
  }));
}
eqRenderMrecPartsBuffer();

document.getElementById('eq-btn-create-mrec')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-mrec-alert');
  try {
    const payload = {
      equipment_id: document.getElementById('eq-mrec-equipment').value,
      maintenance_type: document.getElementById('eq-mrec-type').value,
      severity: document.getElementById('eq-mrec-severity').value || null,
      technician: document.getElementById('eq-mrec-technician').value || null,
      repair_cost: Number(document.getElementById('eq-mrec-cost').value) || 0,
      status: document.getElementById('eq-mrec-status').value,
      started_at: document.getElementById('eq-mrec-start').value ? new Date(document.getElementById('eq-mrec-start').value).toISOString() : null,
      completed_at: document.getElementById('eq-mrec-end').value ? new Date(document.getElementById('eq-mrec-end').value).toISOString() : null,
      fault_description: document.getElementById('eq-mrec-fault-desc').value || null,
      fault_cause: document.getElementById('eq-mrec-fault-cause').value || null,
      notes: document.getElementById('eq-mrec-notes').value || null,
      spare_parts_used: eqMrecPartsBuffer.map(p => ({ part_id: p.part_id, quantity: p.quantity })),
    };
    if (!payload.equipment_id) throw new Error('يرجى اختيار المعدة');
    await eqFetch('/maintenance/records', { method: 'POST', body: payload });
    eqAlert(alertEl, 'success', 'تم حفظ سجل الصيانة بنجاح');
    ['eq-mrec-technician', 'eq-mrec-cost', 'eq-mrec-start', 'eq-mrec-end', 'eq-mrec-fault-desc', 'eq-mrec-fault-cause', 'eq-mrec-notes'].forEach(id => document.getElementById(id).value = '');
    eqMrecPartsBuffer = [];
    eqRenderMrecPartsBuffer();
    await eqPopulateSparePartSelect(document.getElementById('eq-mrec-part'));
    const ref2 = await eqEnsureRefData2();
    eqLoadMaintenanceRecordsTable(ref2);
    eqLoadMaintenanceAlerts();
    eqLoadMaintenanceSchedulesTable(ref2);
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

async function eqLoadMaintenanceRecordsTable(ref2) {
  const tbody = document.getElementById('eq-mrec-tbody');
  try {
    const res = await eqFetch('/maintenance/records');
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد سجلات صيانة</td></tr>`;
      return;
    }
    const eqRes = await eqFetch('/items');
    const eqMap = Object.fromEntries(eqRes.data.map(e => [e.id, e]));
    tbody.innerHTML = items.map(m => `
      <tr>
        <td>${eqMap[m.equipment_id] ? eqMap[m.equipment_id].code + ' — ' + eqMap[m.equipment_id].name : m.equipment_id}</td>
        <td>${ref2.maintenance_type_labels[m.maintenance_type] || m.maintenance_type}</td>
        <td>${ref2.maintenance_status_labels[m.status] || m.status}</td>
        <td>${m.total_cost}</td>
        <td>${m.downtime_hours ?? '—'}</td>
        <td>${eqFmtDateTime(m.started_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('eq-btn-load-mstats')?.addEventListener('click', async () => {
  const content = document.getElementById('eq-mstats-content');
  const equipmentId = document.getElementById('eq-mstats-equipment').value;
  if (!equipmentId) { eqAlert(content, 'error', 'يرجى اختيار المعدة'); return; }
  try {
    const res = await eqFetch('/maintenance/stats', { query: { equipmentId } });
    const d = res.data;
    content.innerHTML = `
      <div class="result-cards">
        <div class="result-card"><div class="label">إجمالي السجلات</div><div class="value">${d.total_records}</div></div>
        <div class="result-card"><div class="label">أعطال طارئة</div><div class="value">${d.emergency_faults_count}</div></div>
        <div class="result-card"><div class="label">صيانات دورية</div><div class="value">${d.preventive_count}</div></div>
        <div class="result-card"><div class="label">إجمالي تكلفة الصيانة</div><div class="value">${d.total_maintenance_cost}</div></div>
        <div class="result-card"><div class="label">إجمالي ساعات التوقف</div><div class="value">${d.total_downtime_hours}</div></div>
        <div class="result-card"><div class="label">متوسط زمن الإصلاح</div><div class="value">${d.average_repair_time_hours}<span class="unit">ساعة</span></div></div>
        <div class="result-card"><div class="label">متوسط الأيام بين الأعطال</div><div class="value">${d.average_days_between_faults ?? '—'}</div></div>
      </div>
    `;
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
});

// ================================================================
// ===== الجزء الثاني: إدارة قطع الغيار =====
// ================================================================

let eqEditingPartId = null;

document.querySelector('[data-panel="eq-spareparts"]')?.addEventListener('click', () => {
  eqLoadLowStockParts();
  eqLoadPartsTable();
});

document.getElementById('eq-btn-load-low-stock')?.addEventListener('click', () => eqLoadLowStockParts());

async function eqLoadLowStockParts() {
  const content = document.getElementById('eq-low-stock-content');
  try {
    const res = await eqFetch('/spare-parts/low-stock');
    const items = res.data;
    if (!items.length) {
      content.innerHTML = `<div class="pm-empty-state">لا توجد قطع غيار وصلت للحد الأدنى</div>`;
      return;
    }
    content.innerHTML = items.map(p => `
      <div class="pm-activity-item">
        <span class="tag tag-danger">مخزون منخفض</span>
        <span>${p.name} — المتاح: ${p.stock_quantity} (الحد الأدنى: ${p.min_stock_level})</span>
      </div>
    `).join('');
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
}

document.getElementById('eq-btn-save-part')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-part-alert');
  try {
    const payload = {
      name: document.getElementById('eq-part-name').value,
      part_number: document.getElementById('eq-part-number').value || null,
      manufacturer: document.getElementById('eq-part-manufacturer').value || null,
      supplier: document.getElementById('eq-part-supplier').value || null,
      stock_quantity: Number(document.getElementById('eq-part-stock').value) || 0,
      unit_price: Number(document.getElementById('eq-part-price').value) || 0,
      min_stock_level: Number(document.getElementById('eq-part-min-stock').value) || 0,
      expected_lifespan: document.getElementById('eq-part-lifespan').value || null,
    };
    if (!payload.name) throw new Error('اسم القطعة مطلوب');
    if (eqEditingPartId) {
      await eqFetch('/spare-parts/update', { method: 'POST', body: { id: eqEditingPartId, ...payload } });
      eqAlert(alertEl, 'success', 'تم تحديث قطعة الغيار بنجاح');
    } else {
      await eqFetch('/spare-parts', { method: 'POST', body: payload });
      eqAlert(alertEl, 'success', 'تم إضافة قطعة الغيار بنجاح');
    }
    eqResetPartForm();
    eqLoadPartsTable();
    eqLoadLowStockParts();
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

function eqResetPartForm() {
  eqEditingPartId = null;
  ['eq-part-name', 'eq-part-number', 'eq-part-manufacturer', 'eq-part-supplier', 'eq-part-lifespan'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('eq-part-stock').value = 0;
  document.getElementById('eq-part-price').value = 0;
  document.getElementById('eq-part-min-stock').value = 0;
}
document.getElementById('eq-btn-reset-part-form')?.addEventListener('click', eqResetPartForm);

document.getElementById('eq-part-search')?.addEventListener('input', debounceEq(() => eqLoadPartsTable(), 300));

async function eqLoadPartsTable() {
  const tbody = document.getElementById('eq-parts-tbody');
  try {
    const res = await eqFetch('/spare-parts', { query: { search: document.getElementById('eq-part-search').value || null } });
    const items = res.data;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا توجد قطع غيار مسجّلة</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${p.part_number || '—'}</td>
        <td>${p.stock_quantity <= p.min_stock_level ? `<span class="tag tag-danger">${p.stock_quantity}</span>` : p.stock_quantity}</td>
        <td>${p.min_stock_level}</td>
        <td>${p.unit_price}</td>
        <td>
          <button class="pm-link-btn" data-part-restock="${p.id}">تزويد مخزون</button>
          <button class="pm-link-btn" data-part-edit="${p.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-part-delete="${p.id}">حذف</button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-part-edit]').forEach(b => b.addEventListener('click', () => {
      const p = items.find(x => x.id === b.dataset.partEdit);
      eqEditingPartId = p.id;
      document.getElementById('eq-part-name').value = p.name || '';
      document.getElementById('eq-part-number').value = p.part_number || '';
      document.getElementById('eq-part-manufacturer').value = p.manufacturer || '';
      document.getElementById('eq-part-supplier').value = p.supplier || '';
      document.getElementById('eq-part-stock').value = p.stock_quantity;
      document.getElementById('eq-part-price').value = p.unit_price;
      document.getElementById('eq-part-min-stock').value = p.min_stock_level;
      document.getElementById('eq-part-lifespan').value = p.expected_lifespan || '';
    }));
    tbody.querySelectorAll('[data-part-restock]').forEach(b => b.addEventListener('click', async () => {
      const qty = prompt('كمية التزويد الجديدة:');
      if (!qty || Number(qty) <= 0) return;
      await eqFetch('/spare-parts/restock', { method: 'POST', body: { id: b.dataset.partRestock, quantity: Number(qty) } });
      eqLoadPartsTable();
      eqLoadLowStockParts();
    }));
    tbody.querySelectorAll('[data-part-delete]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('هل تريد حذف قطعة الغيار؟')) return;
      await eqFetch('/spare-parts/delete', { method: 'POST', body: { id: b.dataset.partDelete } });
      eqLoadPartsTable();
      eqLoadLowStockParts();
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

// ================================================================
// ===== الجزء الثاني: إدارة المشغلين =====
// ================================================================

let eqEditingOperatorId = null;

document.querySelector('[data-panel="eq-operators"]')?.addEventListener('click', async () => {
  const ref2 = await eqEnsureRefData2();
  const licSel = document.getElementById('eq-opr-license-type');
  if (licSel.options.length <= 1) {
    licSel.innerHTML += ref2.license_types.map(t => `<option value="${t}">${ref2.license_type_labels[t]}</option>`).join('');
  }
  eqLoadLicenseAlerts();
  eqLoadOperatorsTable();
});

document.getElementById('eq-btn-load-license-alerts')?.addEventListener('click', () => eqLoadLicenseAlerts());

async function eqLoadLicenseAlerts() {
  const content = document.getElementById('eq-license-alerts-content');
  try {
    const res = await eqFetch('/operators/license-alerts', { query: { withinDays: 30 } });
    const items = res.data;
    if (!items.length) {
      content.innerHTML = `<div class="pm-empty-state">لا توجد رخص تنتهي قريباً</div>`;
      return;
    }
    content.innerHTML = items.map(o => `
      <div class="pm-activity-item">
        <span class="tag ${o.status === 'expired' ? 'tag-danger' : 'tag-warning'}">${o.status === 'expired' ? 'منتهية' : 'قريبة الانتهاء'}</span>
        <span>${o.name} — رخصة رقم ${o.license_number || '—'} — تنتهي ${eqFmtDate(o.license_expiry)}</span>
      </div>
    `).join('');
  } catch (e) {
    eqAlert(content, 'error', e.message);
  }
}

document.getElementById('eq-btn-save-operator')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-opr-alert');
  try {
    const payload = {
      name: document.getElementById('eq-opr-name').value,
      national_id: document.getElementById('eq-opr-national-id').value || null,
      license_number: document.getElementById('eq-opr-license-number').value || null,
      license_type: document.getElementById('eq-opr-license-type').value || null,
      license_expiry: document.getElementById('eq-opr-license-expiry').value || null,
      experience_years: Number(document.getElementById('eq-opr-experience').value) || 0,
    };
    if (!payload.name) throw new Error('اسم المشغل مطلوب');
    if (eqEditingOperatorId) {
      await eqFetch('/operators/update', { method: 'POST', body: { id: eqEditingOperatorId, ...payload } });
      eqAlert(alertEl, 'success', 'تم تحديث بيانات المشغّل بنجاح');
    } else {
      await eqFetch('/operators', { method: 'POST', body: payload });
      eqAlert(alertEl, 'success', 'تم إضافة المشغّل بنجاح');
    }
    eqResetOperatorForm();
    eqLoadOperatorsTable();
    eqLoadLicenseAlerts();
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

function eqResetOperatorForm() {
  eqEditingOperatorId = null;
  ['eq-opr-name', 'eq-opr-national-id', 'eq-opr-license-number', 'eq-opr-license-expiry'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('eq-opr-license-type').value = '';
  document.getElementById('eq-opr-experience').value = 0;
}
document.getElementById('eq-btn-reset-op-form')?.addEventListener('click', eqResetOperatorForm);

document.getElementById('eq-opr-search')?.addEventListener('input', debounceEq(() => eqLoadOperatorsTable(), 300));

async function eqLoadOperatorsTable() {
  const tbody = document.getElementById('eq-operators-tbody');
  const ref2 = await eqEnsureRefData2();
  try {
    const res = await eqFetch('/operators', { query: { search: document.getElementById('eq-opr-search').value || null } });
    const items = res.data;

    const actionSel = document.getElementById('eq-opr-action-select');
    actionSel.innerHTML = `<option value="">اختر مشغّلاً...</option>` + items.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-state">لا يوجد مشغّلون مسجّلون</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(o => `
      <tr>
        <td>${o.name}</td>
        <td>${o.license_type ? (ref2.license_type_labels[o.license_type] || o.license_type) : '—'}</td>
        <td>${o.license_expiry ? eqFmtDate(o.license_expiry) : '—'}</td>
        <td>${o.experience_years}</td>
        <td>${o.performance_rating != null ? o.performance_rating + ' / 5' : '—'}</td>
        <td>
          <button class="pm-link-btn" data-opr-edit="${o.id}">تعديل</button>
          <button class="pm-link-btn pm-mini-btn-danger" data-opr-delete="${o.id}">حذف</button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-opr-edit]').forEach(b => b.addEventListener('click', () => {
      const o = items.find(x => x.id === b.dataset.oprEdit);
      eqEditingOperatorId = o.id;
      document.getElementById('eq-opr-name').value = o.name || '';
      document.getElementById('eq-opr-national-id').value = o.national_id || '';
      document.getElementById('eq-opr-license-number').value = o.license_number || '';
      document.getElementById('eq-opr-license-type').value = o.license_type || '';
      document.getElementById('eq-opr-license-expiry').value = o.license_expiry || '';
      document.getElementById('eq-opr-experience').value = o.experience_years || 0;
    }));
    tbody.querySelectorAll('[data-opr-delete]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('هل تريد حذف المشغّل؟')) return;
      await eqFetch('/operators/delete', { method: 'POST', body: { id: b.dataset.oprDelete } });
      eqLoadOperatorsTable();
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('eq-btn-rate-operator')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-opr-action-alert');
  try {
    const id = document.getElementById('eq-opr-action-select').value;
    const rating = Number(document.getElementById('eq-opr-rating').value);
    if (!id) throw new Error('يرجى اختيار المشغّل');
    await eqFetch('/operators/rate', { method: 'POST', body: { id, rating } });
    eqAlert(alertEl, 'success', 'تم حفظ التقييم بنجاح');
    document.getElementById('eq-opr-rating').value = '';
    eqLoadOperatorsTable();
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

document.getElementById('eq-btn-add-violation')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-opr-action-alert');
  try {
    const id = document.getElementById('eq-opr-action-select').value;
    const description = document.getElementById('eq-opr-violation-desc').value;
    if (!id) throw new Error('يرجى اختيار المشغّل');
    if (!description) throw new Error('يرجى إدخال وصف المخالفة');
    await eqFetch('/operators/violations/add', { method: 'POST', body: { id, description } });
    eqAlert(alertEl, 'success', 'تم تسجيل المخالفة بنجاح');
    document.getElementById('eq-opr-violation-desc').value = '';
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

// ================================================================
// الجزء الثالث: إدارة التكاليف
// ================================================================

document.querySelector('[data-panel="eq-costs"]')?.addEventListener('click', async () => {
  await eqEnsureRefData();
  await eqPopulateEquipmentSelect(document.getElementById('eq-cost-equipment'));
  await eqPopulateEquipmentSelect(document.getElementById('eq-transport-equipment'));
  eqLoadFleetCostSummary();
});

function eqCostCardsHTML(totals) {
  return `
    <div class="result-card"><div class="label">تكلفة التشغيل</div><div class="value">${totals.operating_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة الوقود</div><div class="value">${totals.fuel_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة العمالة</div><div class="value">${totals.labor_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة الصيانة</div><div class="value">${totals.maintenance_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة قطع الغيار</div><div class="value">${totals.spare_parts_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة النقل</div><div class="value">${totals.transport_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة الإيجار</div><div class="value">${totals.rental_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة التأمين</div><div class="value">${totals.insurance_cost}</div></div>
    <div class="result-card"><div class="label">تكلفة الإهلاك</div><div class="value">${totals.depreciation_cost}</div></div>
    <div class="result-card"><div class="label">التكلفة الإجمالية</div><div class="value">${totals.total_cost}</div></div>
  `;
}

async function eqLoadFleetCostSummary() {
  const cardsEl = document.getElementById('eq-fleet-cost-cards');
  const tbody = document.getElementById('eq-fleet-cost-tbody');
  try {
    const res = await eqFetch('/costs/fleet-summary', {
      query: {
        projectId: document.getElementById('eq-cost-project').value || null,
        dateFrom: document.getElementById('eq-cost-from').value || null,
        dateTo: document.getElementById('eq-cost-to').value || null,
      },
    });
    const d = res.data;
    cardsEl.innerHTML = eqCostCardsHTML(d.totals);
    if (!d.most_costly_equipment.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="pm-empty-state">لا توجد بيانات تكاليف بعد</td></tr>`;
    } else {
      tbody.innerHTML = d.most_costly_equipment.map(e => `
        <tr><td>${e.equipment_code}</td><td>${e.equipment_name}</td><td>${e.total_cost}</td></tr>
      `).join('');
    }
  } catch (e) {
    eqAlert(cardsEl, 'error', e.message);
  }
}

document.getElementById('eq-btn-load-fleet-cost')?.addEventListener('click', eqLoadFleetCostSummary);

document.getElementById('eq-btn-load-eq-cost')?.addEventListener('click', async () => {
  const detailEl = document.getElementById('eq-cost-detail');
  try {
    const equipmentId = document.getElementById('eq-cost-equipment').value;
    if (!equipmentId) throw new Error('يرجى اختيار المعدة');
    const res = await eqFetch('/costs/breakdown', {
      query: {
        equipmentId,
        dateFrom: document.getElementById('eq-cost-from').value || null,
        dateTo: document.getElementById('eq-cost-to').value || null,
      },
    });
    const d = res.data;
    detailEl.innerHTML = `
      <div class="pm-card-title">${d.equipment_code} — ${d.equipment_name} (ساعات التشغيل: ${d.operating_hours})</div>
      <div class="result-cards">${eqCostCardsHTML(d.breakdown)}</div>
      <div class="result-card" style="margin-top:8px"><div class="label">تكلفة الساعة التشغيلية</div><div class="value">${d.cost_per_operating_hour}</div></div>
    `;
  } catch (e) {
    eqAlert(detailEl, 'error', e.message);
  }
});

document.getElementById('eq-btn-log-transport')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('eq-transport-alert');
  try {
    const equipment_id = document.getElementById('eq-transport-equipment').value;
    const amount = document.getElementById('eq-transport-amount').value;
    const note = document.getElementById('eq-transport-note').value || null;
    if (!equipment_id) throw new Error('يرجى اختيار المعدة');
    if (!amount || Number(amount) <= 0) throw new Error('يرجى إدخال قيمة تكلفة نقل صحيحة');
    await eqFetch('/costs/transport/log', { method: 'POST', body: { equipment_id, amount: Number(amount), note } });
    eqAlert(alertEl, 'success', 'تم تسجيل تكلفة النقل بنجاح');
    document.getElementById('eq-transport-amount').value = '';
    document.getElementById('eq-transport-note').value = '';
  } catch (e) {
    eqAlert(alertEl, 'error', e.message);
  }
});

// ================================================================
// الجزء الثالث: إدارة الإنتاجية
// ================================================================

document.querySelector('[data-panel="eq-productivity"]')?.addEventListener('click', async () => {
  const ref = await eqEnsureRefData();
  await eqPopulateEquipmentSelect(document.getElementById('eq-prod-equipment'));
  const catSelect = document.getElementById('eq-prod-cmp-category');
  if (catSelect.options.length <= 0) {
    catSelect.innerHTML = `<option value="">كل الفئات</option>` + eqCategoryOptionsHTML(ref);
  }
});

document.getElementById('eq-btn-load-productivity')?.addEventListener('click', async () => {
  const cardsEl = document.getElementById('eq-prod-cards');
  try {
    const equipmentId = document.getElementById('eq-prod-equipment').value;
    if (!equipmentId) throw new Error('يرجى اختيار المعدة');
    const res = await eqFetch('/productivity', {
      query: {
        equipmentId,
        dateFrom: document.getElementById('eq-prod-from').value || null,
        dateTo: document.getElementById('eq-prod-to').value || null,
      },
    });
    const d = res.data;
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">ساعات التشغيل</div><div class="value">${d.operating_hours}</div></div>
      <div class="result-card"><div class="label">ساعات التوقف</div><div class="value">${d.downtime_hours}</div></div>
      <div class="result-card"><div class="label">نسبة الاستغلال</div><div class="value">${d.utilization_rate_percent}<span class="unit">%</span></div></div>
      <div class="result-card"><div class="label">كفاءة التشغيل</div><div class="value">${d.operating_efficiency_percent}<span class="unit">%</span></div></div>
      <div class="result-card"><div class="label">كفاءة الوقود</div><div class="value">${d.fuel_efficiency_hours_per_unit ?? '—'}</div></div>
      <div class="result-card"><div class="label">معدل الأعطال / 100 ساعة</div><div class="value">${d.fault_rate_per_100h}</div></div>
      <div class="result-card"><div class="label">متوسط الفترة بين الأعطال (يوم)</div><div class="value">${d.average_time_between_faults_days ?? '—'}</div></div>
      <div class="result-card"><div class="label">متوسط زمن الإصلاح MTTR (ساعة)</div><div class="value">${d.average_repair_time_hours_mttr}</div></div>
      <div class="result-card"><div class="label">متوسط ساعات العمل/يوم</div><div class="value">${d.average_hours_per_work_day}</div></div>
    `;
  } catch (e) {
    eqAlert(cardsEl, 'error', e.message);
  }
});

document.getElementById('eq-btn-compare-productivity')?.addEventListener('click', async () => {
  const summaryEl = document.getElementById('eq-prod-cmp-summary');
  const tbody = document.getElementById('eq-prod-cmp-tbody');
  try {
    const category = document.getElementById('eq-prod-cmp-category').value || null;
    const res = await eqFetch('/productivity/compare', { query: { category } });
    const d = res.data;
    if (!d.count) {
      summaryEl.innerHTML = '';
      tbody.innerHTML = `<tr><td colspan="5" class="pm-empty-state">لا توجد معدات مطابقة</td></tr>`;
      return;
    }
    summaryEl.innerHTML = `
      <div class="pm-activity-item"><span>متوسط الكفاءة: ${d.average_efficiency_percent}%</span></div>
      <div class="pm-activity-item"><span>الأفضل أداءً: ${d.best_performing ? d.best_performing.equipment_name : '—'}</span></div>
      <div class="pm-activity-item"><span>الأقل أداءً: ${d.worst_performing ? d.worst_performing.equipment_name : '—'}</span></div>
    `;
    tbody.innerHTML = d.items.map(i => `
      <tr>
        <td>${i.equipment_code}</td><td>${i.equipment_name}</td>
        <td>${i.utilization_rate_percent}</td><td>${i.operating_efficiency_percent}</td>
        <td>${i.fault_rate_per_100h}</td>
      </tr>
    `).join('');
  } catch (e) {
    eqAlert(summaryEl, 'error', e.message);
  }
});

// ================================================================
// الجزء الثالث: مركز التنبيهات الموحّد
// ================================================================

document.querySelector('[data-panel="eq-alerts"]')?.addEventListener('click', () => {
  eqLoadAlertsCenter();
});

function eqAlertSeverityTag(severity) {
  const map = { critical: 'tag-bad', warning: 'tag-info', info: 'tag-ok' };
  return map[severity] || 'tag-info';
}

const EQ_ALERT_SEVERITY_LABELS = { critical: 'حرج', warning: 'تحذير', info: 'معلومة' };

async function eqLoadAlertsCenter() {
  const cardsEl = document.getElementById('eq-alerts-summary-cards');
  const listEl = document.getElementById('eq-alerts-list');
  try {
    const withinDays = document.getElementById('eq-alerts-within-days').value || 14;
    const res = await eqFetch('/alerts/center', { query: { withinDays } });
    const d = res.data;
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي التنبيهات</div><div class="value">${d.count}</div></div>
      <div class="result-card"><div class="label">حرجة</div><div class="value">${d.by_severity.critical || 0}</div></div>
      <div class="result-card"><div class="label">تحذير</div><div class="value">${d.by_severity.warning || 0}</div></div>
      <div class="result-card"><div class="label">معلومة</div><div class="value">${d.by_severity.info || 0}</div></div>
    `;
    if (!d.alerts.length) {
      listEl.innerHTML = `<div class="pm-empty-state">لا توجد تنبيهات حالياً</div>`;
      return;
    }
    listEl.innerHTML = d.alerts.map(a => `
      <div class="pm-activity-item">
        <span class="tag ${eqAlertSeverityTag(a.severity)}">${EQ_ALERT_SEVERITY_LABELS[a.severity] || a.severity}</span>
        <span>${a.message}</span>
        ${a.equipment_code ? `<span class="ts">(${a.equipment_code})</span>` : ''}
        ${a.operator_name ? `<span class="ts">(${a.operator_name})</span>` : ''}
      </div>
    `).join('');
  } catch (e) {
    eqAlert(cardsEl, 'error', e.message);
  }
}
