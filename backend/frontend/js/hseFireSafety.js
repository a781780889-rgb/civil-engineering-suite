// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// وحدة إدارة معدات مكافحة الحريق (Fire Fighting Equipment Management)
// ============================================================

const HSE_FIRE_API = '/api/hse/fire';
let HSE_FIRE_REF = null;
let hseFireItemEditingId = null;
let hseFireDetailItemId = null;

// ---------- أدوات عامة (بنفس نمط hseHazmat.frontend.js) ----------
function hseFireFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_FIRE_API}${path}`;
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

function hseFireAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseFireEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounceHseFire(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function hseFireEnsureRefData() {
  if (HSE_FIRE_REF) return HSE_FIRE_REF;
  const res = await hseFireFetch('/reference-data');
  HSE_FIRE_REF = res.data;
  return HSE_FIRE_REF;
}

function hseFireOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseFireStatusTag(status) {
  const map = {
    active: 'tag-ok',
    due_for_inspection: 'tag-info',
    expired: 'tag-bad',
    out_of_service: 'tag-bad',
    decommissioned: 'tag-bad',
  };
  return map[status] || 'tag-info';
}
function hseFireResultTag(result) {
  const map = { pass: 'tag-ok', pass_with_notes: 'tag-info', fail: 'tag-bad' };
  return map[result] || 'tag-info';
}
function hseFireMaintStatusTag(status) {
  const map = { open: 'tag-bad', in_progress: 'tag-info', closed: 'tag-ok' };
  return map[status] || 'tag-info';
}

// ================================================================
// لوحة معلومات معدات مكافحة الحريق
// ================================================================

document.querySelector('[data-panel="hse-fire-dashboard"]')?.addEventListener('click', () => hseFireLoadDashboard());
document.getElementById('hse-fire-btn-load-dashboard')?.addEventListener('click', () => hseFireLoadDashboard());

async function hseFireLoadDashboard() {
  const cardsEl = document.getElementById('hse-fire-dash-cards');
  const typeChartEl = document.getElementById('hse-fire-chart-type');
  const alertsEl = document.getElementById('hse-fire-dash-alerts');
  const ref = await hseFireEnsureRefData();
  const projectId = document.getElementById('hse-fire-dash-project')?.value.trim() || null;

  try {
    const res = await hseFireFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي المعدات</div><div class="value">${d.total_equipment}<span class="unit">سليمة: ${d.active_equipment}</span></div></div>
      <div class="result-card"><div class="label">مستحقة الفحص الدوري</div><div class="value">${d.due_for_inspection}</div></div>
      <div class="result-card"><div class="label">منتهية الصلاحية</div><div class="value">${d.expired_equipment}</div></div>
      <div class="result-card"><div class="label">خارج الخدمة</div><div class="value">${d.out_of_service_equipment}</div></div>
      <div class="result-card"><div class="label">أعطال مفتوحة</div><div class="value">${d.open_faults_count}</div></div>
      <div class="result-card"><div class="label">إجمالي الفحوصات</div><div class="value">${d.total_inspections}<span class="unit">راسبة: ${d.inspections_failed}</span></div></div>
    `;

    const typeEntries = Object.entries(d.by_type).filter(([, c]) => c > 0);
    const maxType = Math.max(1, ...typeEntries.map(([, c]) => c));
    typeChartEl.innerHTML = typeEntries.length
      ? typeEntries.map(([type, count]) => `
        <div class="pm-bar-row">
          <div class="pm-bar-label">${ref.equipment_type_labels[type] || type}</div>
          <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxType) * 100}%"></div></div>
          <div class="pm-bar-value">${count}</div>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد معدات مسجَّلة بعد</div>`;

    const dueRes = await hseFireFetch('/alerts/due-inspection', { query: { projectId, withinDays: 15 } });
    const faultsRes = await hseFireFetch('/alerts/open-faults', { query: { projectId } });
    const combined = [
      ...dueRes.data.slice(0, 5).map(i => ({ type: 'due', item: i })),
      ...faultsRes.data.slice(0, 5).map(i => ({ type: 'fault', item: i })),
    ];
    alertsEl.innerHTML = combined.length
      ? combined.map(({ type, item }) => type === 'due'
        ? `<div class="pm-activity-item"><span class="ts"><span class="tag ${hseFireStatusTag(item.computed_status)}">${item.computed_status_label}</span></span><span>${ref.equipment_type_labels[item.equipment_type]} — ${hseFireEsc(item.location_building)} — الفحص القادم: ${item.next_inspection_date}</span></div>`
        : `<div class="pm-activity-item"><span class="ts"><span class="tag tag-bad">عطل مفتوح</span></span><span>${hseFireEsc(item.item ? (ref.equipment_type_labels[item.item.equipment_type] + ' — ' + item.item.location_building) : item.item_id)} — ${hseFireEsc(item.fault_description)}</span></div>`
      ).join('')
      : `<div class="pm-empty-state">لا توجد تنبيهات حالياً</div>`;
  } catch (e) {
    hseFireAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// معدات مكافحة الحريق (قائمة / نموذج / تفاصيل)
// ================================================================

document.querySelector('[data-panel="hse-fire-items"]')?.addEventListener('click', async () => {
  const ref = await hseFireEnsureRefData();
  document.getElementById('hse-fire-item-filter-type').innerHTML = '<option value="">كل الأنواع</option>' + hseFireOptionsHTML(ref.equipment_types, ref.equipment_type_labels);
  document.getElementById('hse-fire-item-filter-status').innerHTML = '<option value="">كل الحالات</option>' + hseFireOptionsHTML(ref.equipment_statuses, ref.equipment_status_labels);
  hseFireItemShowListView();
  hseFireLoadItemTable();
});

document.getElementById('hse-fire-item-search')?.addEventListener('input', debounceHseFire(() => hseFireLoadItemTable(), 300));
document.getElementById('hse-fire-item-filter-type')?.addEventListener('change', () => hseFireLoadItemTable());
document.getElementById('hse-fire-item-filter-status')?.addEventListener('change', () => hseFireLoadItemTable());

async function hseFireLoadItemTable() {
  const tbody = document.getElementById('hse-fire-item-tbody');
  const ref = await hseFireEnsureRefData();
  try {
    const res = await hseFireFetch('/items', {
      query: {
        search: document.getElementById('hse-fire-item-search')?.value.trim(),
        equipmentType: document.getElementById('hse-fire-item-filter-type')?.value,
        status: document.getElementById('hse-fire-item-filter-status')?.value,
      },
    });
    tbody.innerHTML = res.data.length ? res.data.map(i => `
      <tr>
        <td>${i.code}</td>
        <td>${ref.equipment_type_labels[i.equipment_type] || i.equipment_type}</td>
        <td>${hseFireEsc(i.location_building)}${i.location_floor ? ' / ' + hseFireEsc(i.location_floor) : ''}</td>
        <td>${i.next_inspection_date || '—'}</td>
        <td>${i.expiry_date || '—'}</td>
        <td><span class="tag ${hseFireStatusTag(i.computed_status)}">${i.computed_status_label}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="hseFireItemShowDetail('${i.id}')">عرض</button>
          <button class="btn btn-sm btn-outline" onclick="hseFireItemShowForm('${i.id}')">تعديل</button>
          <button class="btn btn-sm btn-danger" onclick="hseFireItemDelete('${i.id}')">حذف</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد معدات مسجَّلة</div></td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

function hseFireItemShowListView() {
  document.getElementById('hse-fire-item-list-view').style.display = '';
  document.getElementById('hse-fire-item-form-view').style.display = 'none';
  document.getElementById('hse-fire-item-detail-view').style.display = 'none';
}

document.getElementById('hse-fire-item-btn-new')?.addEventListener('click', () => hseFireItemShowForm());
document.getElementById('hse-fire-item-btn-back-to-list')?.addEventListener('click', () => { hseFireItemShowListView(); hseFireLoadItemTable(); });
document.getElementById('hse-fire-item-btn-back-from-detail')?.addEventListener('click', () => { hseFireItemShowListView(); hseFireLoadItemTable(); });

function hseFireToggleTypeFields(type) {
  document.getElementById('hse-fire-item-f-extinguisher-fields').style.display = type === 'fire_extinguisher' ? '' : 'none';
  document.getElementById('hse-fire-item-f-hose-sprinkler-fields').style.display = (type === 'fire_hose' || type === 'sprinkler_system') ? '' : 'none';
  document.getElementById('hse-fire-item-f-alarm-fields').style.display = (type === 'alarm_system' || type === 'smoke_detector') ? '' : 'none';
  document.getElementById('hse-fire-item-f-exit-fields').style.display = type === 'emergency_exit' ? '' : 'none';
}

document.getElementById('hse-fire-item-f-type')?.addEventListener('change', (e) => hseFireToggleTypeFields(e.target.value));

async function hseFireItemShowForm(id = null) {
  const ref = await hseFireEnsureRefData();
  hseFireItemEditingId = id;
  document.getElementById('hse-fire-item-list-view').style.display = 'none';
  document.getElementById('hse-fire-item-detail-view').style.display = 'none';
  document.getElementById('hse-fire-item-form-view').style.display = '';
  document.getElementById('hse-fire-item-form-alert').innerHTML = '';

  document.getElementById('hse-fire-item-f-type').innerHTML = hseFireOptionsHTML(ref.equipment_types, ref.equipment_type_labels, { placeholder: '— اختر —' });
  document.getElementById('hse-fire-item-f-agent-type').innerHTML = hseFireOptionsHTML(ref.extinguisher_agent_types, ref.extinguisher_agent_type_labels, { placeholder: '— اختر —' });
  document.getElementById('hse-fire-item-f-frequency').innerHTML = hseFireOptionsHTML(ref.inspection_frequencies, ref.inspection_frequency_labels, { placeholder: '— اختر —' });

  const fields = ['weight-capacity-kg', 'operating-pressure-bar', 'hose-length-m', 'detector-type',
    'coverage-zone', 'exit-capacity-persons', 'location-building', 'location-floor', 'location-zone',
    'location-notes', 'installation-date', 'last-inspection-date', 'next-inspection-date', 'expiry-date',
    'manufacturer', 'serial-number', 'project-id', 'notes'];
  for (const f of fields) {
    const el = document.getElementById(`hse-fire-item-f-${f}`);
    if (el) el.value = '';
  }
  document.getElementById('hse-fire-item-f-agent-type').value = '';
  document.getElementById('hse-fire-item-f-exit-signage').checked = false;
  hseFireToggleTypeFields('');

  if (id) {
    document.getElementById('hse-fire-item-form-title').textContent = 'تعديل معدة مكافحة حريق';
    const res = await hseFireFetch('/items/get', { query: { id } });
    const i = res.data;
    document.getElementById('hse-fire-item-f-type').value = i.equipment_type || '';
    hseFireToggleTypeFields(i.equipment_type);
    document.getElementById('hse-fire-item-f-agent-type').value = i.agent_type || '';
    document.getElementById('hse-fire-item-f-weight-capacity-kg').value = i.weight_capacity_kg ?? '';
    document.getElementById('hse-fire-item-f-operating-pressure-bar').value = i.operating_pressure_bar ?? '';
    document.getElementById('hse-fire-item-f-hose-length-m').value = i.hose_length_m ?? '';
    document.getElementById('hse-fire-item-f-detector-type').value = i.detector_type || '';
    document.getElementById('hse-fire-item-f-coverage-zone').value = i.coverage_zone || '';
    document.getElementById('hse-fire-item-f-exit-capacity-persons').value = i.exit_capacity_persons ?? '';
    document.getElementById('hse-fire-item-f-exit-signage').checked = !!i.exit_signage_illuminated;
    document.getElementById('hse-fire-item-f-location-building').value = i.location_building || '';
    document.getElementById('hse-fire-item-f-location-floor').value = i.location_floor || '';
    document.getElementById('hse-fire-item-f-location-zone').value = i.location_zone || '';
    document.getElementById('hse-fire-item-f-location-notes').value = i.location_notes || '';
    document.getElementById('hse-fire-item-f-installation-date').value = i.installation_date || '';
    document.getElementById('hse-fire-item-f-frequency').value = i.inspection_frequency || '';
    document.getElementById('hse-fire-item-f-last-inspection-date').value = i.last_inspection_date || '';
    document.getElementById('hse-fire-item-f-next-inspection-date').value = i.next_inspection_date || '';
    document.getElementById('hse-fire-item-f-expiry-date').value = i.expiry_date || '';
    document.getElementById('hse-fire-item-f-manufacturer').value = i.manufacturer || '';
    document.getElementById('hse-fire-item-f-serial-number').value = i.serial_number || '';
    document.getElementById('hse-fire-item-f-project-id').value = i.project_id || '';
    document.getElementById('hse-fire-item-f-notes').value = i.notes || '';
  } else {
    document.getElementById('hse-fire-item-form-title').textContent = 'معدة مكافحة حريق جديدة';
  }
}

document.getElementById('hse-fire-item-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-fire-item-form-alert');
  const payload = {
    equipment_type: document.getElementById('hse-fire-item-f-type').value,
    agent_type: document.getElementById('hse-fire-item-f-agent-type').value || null,
    weight_capacity_kg: document.getElementById('hse-fire-item-f-weight-capacity-kg').value || null,
    operating_pressure_bar: document.getElementById('hse-fire-item-f-operating-pressure-bar').value || null,
    hose_length_m: document.getElementById('hse-fire-item-f-hose-length-m').value || null,
    detector_type: document.getElementById('hse-fire-item-f-detector-type').value.trim() || null,
    coverage_zone: document.getElementById('hse-fire-item-f-coverage-zone').value.trim() || null,
    exit_capacity_persons: document.getElementById('hse-fire-item-f-exit-capacity-persons').value || null,
    exit_signage_illuminated: document.getElementById('hse-fire-item-f-exit-signage').checked,
    location_building: document.getElementById('hse-fire-item-f-location-building').value.trim(),
    location_floor: document.getElementById('hse-fire-item-f-location-floor').value.trim() || null,
    location_zone: document.getElementById('hse-fire-item-f-location-zone').value.trim() || null,
    location_notes: document.getElementById('hse-fire-item-f-location-notes').value.trim() || null,
    installation_date: document.getElementById('hse-fire-item-f-installation-date').value || null,
    inspection_frequency: document.getElementById('hse-fire-item-f-frequency').value,
    last_inspection_date: document.getElementById('hse-fire-item-f-last-inspection-date').value || null,
    next_inspection_date: document.getElementById('hse-fire-item-f-next-inspection-date').value || null,
    expiry_date: document.getElementById('hse-fire-item-f-expiry-date').value || null,
    manufacturer: document.getElementById('hse-fire-item-f-manufacturer').value.trim() || null,
    serial_number: document.getElementById('hse-fire-item-f-serial-number').value.trim() || null,
    project_id: document.getElementById('hse-fire-item-f-project-id').value.trim() || null,
    notes: document.getElementById('hse-fire-item-f-notes').value.trim() || null,
  };
  try {
    if (hseFireItemEditingId) {
      await hseFireFetch('/items/update', { method: 'POST', body: { id: hseFireItemEditingId, ...payload } });
      hseFireAlert(alertEl, 'success', 'تم تحديث بيانات المعدة بنجاح');
    } else {
      await hseFireFetch('/items', { method: 'POST', body: payload });
      hseFireAlert(alertEl, 'success', 'تم تسجيل معدة مكافحة الحريق بنجاح');
    }
    hseFireItemShowListView();
    hseFireLoadItemTable();
  } catch (e) {
    hseFireAlert(alertEl, 'error', e.message);
  }
});

async function hseFireItemDelete(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المعدة؟')) return;
  try {
    await hseFireFetch('/items/delete', { method: 'POST', body: { id } });
    hseFireLoadItemTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseFireItemShowDetail(id) {
  const ref = await hseFireEnsureRefData();
  document.getElementById('hse-fire-item-list-view').style.display = 'none';
  document.getElementById('hse-fire-item-form-view').style.display = 'none';
  document.getElementById('hse-fire-item-detail-view').style.display = '';
  const content = document.getElementById('hse-fire-item-detail-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';

  try {
    const res = await hseFireFetch('/items/get', { query: { id } });
    const i = res.data;
    hseFireDetailItemId = id;

    content.innerHTML = `
      <div class="table-wrap">
        <table class="detail-table">
          <tr><th>الرمز</th><td>${i.code}</td><th>النوع</th><td>${ref.equipment_type_labels[i.equipment_type]}</td></tr>
          <tr><th>الموقع</th><td>${hseFireEsc(i.location_building)}${i.location_floor ? ' / ' + hseFireEsc(i.location_floor) : ''}</td><th>الحالة</th><td><span class="tag ${hseFireStatusTag(i.computed_status)}">${i.computed_status_label}</span></td></tr>
          <tr><th>دورية الفحص</th><td>${ref.inspection_frequency_labels[i.inspection_frequency] || '—'}</td><th>الفحص القادم</th><td>${i.next_inspection_date || '—'}</td></tr>
          <tr><th>آخر فحص</th><td>${i.last_inspection_date || '—'}</td><th>تاريخ الانتهاء/إعادة التعبئة</th><td>${i.expiry_date || '—'}</td></tr>
          <tr><th>الصانع</th><td>${hseFireEsc(i.manufacturer || '—')}</td><th>الرقم التسلسلي</th><td>${hseFireEsc(i.serial_number || '—')}</td></tr>
          <tr><th>أعطال مفتوحة</th><td colspan="3">${i.open_faults_count}</td></tr>
          <tr><th>ملاحظات</th><td colspan="3">${hseFireEsc(i.notes || '—')}</td></tr>
        </table>
      </div>

      <h3 style="margin-top:16px">سجل الفحص الدوري</h3>
      <div class="toolbar">
        <input type="date" id="hse-fire-ins-f-date">
        <input type="text" id="hse-fire-ins-f-inspector" placeholder="اسم الفاحص">
        <select id="hse-fire-ins-f-result"></select>
        <input type="text" id="hse-fire-ins-f-notes" placeholder="ملاحظات">
        <button class="btn btn-primary" id="hse-fire-ins-btn-add">+ تسجيل فحص</button>
      </div>
      <div id="hse-fire-ins-alert"></div>
      <div class="table-wrap">
        <table class="detail-table">
          <thead><tr><th>تاريخ الفحص</th><th>الفاحص</th><th>النتيجة</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody id="hse-fire-ins-tbody">
            ${i.inspections.length ? i.inspections.map(ins => `
              <tr>
                <td>${ins.inspection_date}</td>
                <td>${hseFireEsc(ins.inspector_name || '—')}</td>
                <td><span class="tag ${hseFireResultTag(ins.result)}">${ref.inspection_result_labels[ins.result] || ins.result}</span></td>
                <td>${hseFireEsc(ins.notes || '—')}</td>
                <td><button class="btn btn-sm btn-danger" onclick="hseFireInspectionDelete('${ins.id}')">حذف</button></td>
              </tr>
            `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد فحوصات مسجَّلة</div></td></tr>`}
          </tbody>
        </table>
      </div>

      <h3 style="margin-top:16px">سجل الصيانة والأعطال</h3>
      <div class="toolbar">
        <select id="hse-fire-mnt-f-type"></select>
        <input type="text" id="hse-fire-mnt-f-desc" placeholder="وصف العطل / الصيانة">
        <input type="text" id="hse-fire-mnt-f-reported-by" placeholder="بلّغ عنه">
        <input type="date" id="hse-fire-mnt-f-new-expiry" title="تاريخ انتهاء جديد (عند إعادة التعبئة/الاستبدال)">
        <button class="btn btn-primary" id="hse-fire-mnt-btn-add">+ تسجيل صيانة/عطل</button>
      </div>
      <div id="hse-fire-mnt-alert"></div>
      <div class="table-wrap">
        <table class="detail-table">
          <thead><tr><th>النوع</th><th>الوصف</th><th>الحالة</th><th>الإجراء التصحيحي</th><th></th></tr></thead>
          <tbody id="hse-fire-mnt-tbody">
            ${i.maintenance.length ? i.maintenance.map(m => `
              <tr>
                <td>${ref.maintenance_type_labels[m.type] || m.type}</td>
                <td>${hseFireEsc(m.fault_description)}</td>
                <td><span class="tag ${hseFireMaintStatusTag(m.status)}">${ref.maintenance_status_labels[m.status] || m.status}</span></td>
                <td>${hseFireEsc(m.resolution || '—')}</td>
                <td>
                  ${m.status !== 'closed' ? `<button class="btn btn-sm btn-outline" onclick="hseFireMaintenanceClose('${m.id}')">إغلاق</button>` : ''}
                  <button class="btn btn-sm btn-danger" onclick="hseFireMaintenanceDelete('${m.id}')">حذف</button>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد سجلات صيانة</div></td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('hse-fire-ins-f-result').innerHTML = hseFireOptionsHTML(ref.inspection_results, ref.inspection_result_labels, { placeholder: '— النتيجة —' });
    document.getElementById('hse-fire-ins-f-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('hse-fire-ins-btn-add').addEventListener('click', () => hseFireInspectionAdd());

    document.getElementById('hse-fire-mnt-f-type').innerHTML = hseFireOptionsHTML(ref.maintenance_types, ref.maintenance_type_labels, { placeholder: '— نوع الصيانة —' });
    document.getElementById('hse-fire-mnt-btn-add').addEventListener('click', () => hseFireMaintenanceAdd());
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function hseFireInspectionAdd() {
  const alertEl = document.getElementById('hse-fire-ins-alert');
  const inspection_date = document.getElementById('hse-fire-ins-f-date').value;
  const inspector_name = document.getElementById('hse-fire-ins-f-inspector').value.trim() || null;
  const result = document.getElementById('hse-fire-ins-f-result').value;
  const notes = document.getElementById('hse-fire-ins-f-notes').value.trim() || null;
  try {
    const res = await hseFireFetch('/inspections', {
      method: 'POST',
      body: { item_id: hseFireDetailItemId, inspection_date, inspector_name, result, notes },
    });
    hseFireAlert(alertEl, 'success', res.auto_maintenance
      ? 'تم تسجيل الفحص بنجاح، وتم فتح سجل صيانة تلقائياً لرسوب الفحص'
      : 'تم تسجيل الفحص بنجاح');
    hseFireItemShowDetail(hseFireDetailItemId);
  } catch (e) {
    hseFireAlert(alertEl, 'error', e.message);
  }
}

async function hseFireInspectionDelete(id) {
  if (!confirm('هل أنت متأكد من حذف سجل هذا الفحص؟')) return;
  try {
    await hseFireFetch('/inspections/delete', { method: 'POST', body: { id } });
    hseFireItemShowDetail(hseFireDetailItemId);
  } catch (e) {
    alert(e.message);
  }
}

async function hseFireMaintenanceAdd() {
  const alertEl = document.getElementById('hse-fire-mnt-alert');
  const type = document.getElementById('hse-fire-mnt-f-type').value;
  const fault_description = document.getElementById('hse-fire-mnt-f-desc').value.trim();
  const reported_by = document.getElementById('hse-fire-mnt-f-reported-by').value.trim() || null;
  const new_expiry_date = document.getElementById('hse-fire-mnt-f-new-expiry').value || null;
  try {
    await hseFireFetch('/maintenance', {
      method: 'POST',
      body: { item_id: hseFireDetailItemId, type, fault_description, reported_by, new_expiry_date },
    });
    hseFireAlert(alertEl, 'success', 'تم تسجيل سجل الصيانة/العطل بنجاح');
    hseFireItemShowDetail(hseFireDetailItemId);
  } catch (e) {
    hseFireAlert(alertEl, 'error', e.message);
  }
}

async function hseFireMaintenanceClose(id) {
  const resolution = prompt('أدخل وصف الإجراء التصحيحي لإغلاق سجل الصيانة:');
  if (resolution == null) return;
  if (!resolution.trim()) { alert('وصف الإجراء التصحيحي مطلوب'); return; }
  try {
    await hseFireFetch('/maintenance/close', { method: 'POST', body: { id, resolution } });
    hseFireItemShowDetail(hseFireDetailItemId);
  } catch (e) {
    alert(e.message);
  }
}

async function hseFireMaintenanceDelete(id) {
  if (!confirm('هل أنت متأكد من حذف سجل الصيانة هذا؟')) return;
  try {
    await hseFireFetch('/maintenance/delete', { method: 'POST', body: { id } });
    hseFireItemShowDetail(hseFireDetailItemId);
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// التنبيهات (انتهاء الصلاحية / الفحص الدوري المستحق / الأعطال المفتوحة)
// ================================================================

document.querySelector('[data-panel="hse-fire-alerts"]')?.addEventListener('click', () => hseFireLoadAlerts());
document.getElementById('hse-fire-alerts-btn-load')?.addEventListener('click', () => hseFireLoadAlerts());

async function hseFireLoadAlerts() {
  const ref = await hseFireEnsureRefData();
  const projectId = document.getElementById('hse-fire-alerts-project')?.value.trim() || null;
  const expEl = document.getElementById('hse-fire-alerts-expiry-tbody');
  const dueEl = document.getElementById('hse-fire-alerts-due-tbody');
  const faultsEl = document.getElementById('hse-fire-alerts-faults-tbody');

  try {
    const [expRes, dueRes, faultsRes] = await Promise.all([
      hseFireFetch('/alerts/expiring-equipment', { query: { projectId, withinDays: 60 } }),
      hseFireFetch('/alerts/due-inspection', { query: { projectId, withinDays: 30 } }),
      hseFireFetch('/alerts/open-faults', { query: { projectId } }),
    ]);

    expEl.innerHTML = expRes.data.length ? expRes.data.map(i => `
      <tr><td>${i.code}</td><td>${ref.equipment_type_labels[i.equipment_type]}</td><td>${hseFireEsc(i.location_building)}</td><td>${i.expiry_date}</td><td>${i.days_until_expiry}</td></tr>
    `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد معدات تقترب من انتهاء الصلاحية</div></td></tr>`;

    dueEl.innerHTML = dueRes.data.length ? dueRes.data.map(i => `
      <tr><td>${i.code}</td><td>${ref.equipment_type_labels[i.equipment_type]}</td><td>${hseFireEsc(i.location_building)}</td><td>${i.next_inspection_date}</td><td><span class="tag ${hseFireStatusTag(i.computed_status)}">${i.computed_status_label}</span></td></tr>
    `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد معدات مستحقة للفحص الدوري</div></td></tr>`;

    faultsEl.innerHTML = faultsRes.data.length ? faultsRes.data.map(m => `
      <tr><td>${m.item ? ref.equipment_type_labels[m.item.equipment_type] : '—'}</td><td>${m.item ? hseFireEsc(m.item.location_building) : '—'}</td><td>${ref.maintenance_type_labels[m.type] || m.type}</td><td>${hseFireEsc(m.fault_description)}</td><td><span class="tag ${hseFireMaintStatusTag(m.status)}">${ref.maintenance_status_labels[m.status]}</span></td></tr>
    `).join('') : `<tr><td colspan="5"><div class="pm-empty-state">لا توجد أعطال مفتوحة</div></td></tr>`;
  } catch (e) {
    hseFireAlert(document.getElementById('hse-fire-alerts-error'), 'error', e.message);
  }
}
