// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الرابع عشر: نظام التقارير والتحليلات المتكامل
// الجزء 2/10: منشئ التقارير (Report Builder) + الفلاتر المتقدمة
// ============================================================

const RB_API = '/api/reports/builder';
let RB_DATASOURCES_CACHE = null;
let RB_CURRENT_FIELDS = [];
let RB_LAST_REPORT = null;

// ---------- أدوات عامة (بنفس نمط reportsCenter.js) ----------
function rbFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${RB_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  const token = (typeof getAuthToken === 'function') ? getAuthToken() : (localStorage.getItem('authToken') || '');
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
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

function rbEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rbAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${rbEsc(message)}</div>`;
}

// ================================================================
// تحميل مصادر البيانات المتاحة
// ================================================================

async function rbLoadDataSources() {
  const select = document.getElementById('rb-datasource-select');
  if (!select) return;
  try {
    const res = await rbFetch('/data-sources');
    RB_DATASOURCES_CACHE = res.data;
    select.innerHTML = '<option value="">اختر مصدر البيانات...</option>' +
      res.data.map(s => `<option value="${s.key}">${rbEsc(s.label)}</option>`).join('');
  } catch (e) {
    const root = document.getElementById('rb-builder-root');
    rbAlert(root, 'danger', e.message);
  }
}

// ================================================================
// عند اختيار مصدر بيانات: عرض الحقول + الفلاتر المتاحة
// ================================================================

function rbOnDataSourceChange() {
  const select = document.getElementById('rb-datasource-select');
  const key = select.value;
  const fieldsRoot = document.getElementById('rb-fields-root');
  const scheduleWrap = document.getElementById('rb-schedule-id-wrap');
  if (!key) {
    fieldsRoot.innerHTML = '';
    RB_CURRENT_FIELDS = [];
    return;
  }
  const src = (RB_DATASOURCES_CACHE || []).find(s => s.key === key);
  if (!src) return;
  RB_CURRENT_FIELDS = src.fields;

  if (scheduleWrap) scheduleWrap.style.display = (key === 'schedule_activities') ? '' : 'none';

  fieldsRoot.innerHTML = `
    <div class="rb-fields-checklist">
      ${src.fields.map(f => `
        <label class="rb-field-chip">
          <input type="checkbox" class="rb-field-checkbox" value="${f.key}" checked>
          ${rbEsc(f.label)}
        </label>
      `).join('')}
    </div>
  `;

  // تعبئة قوائم الترتيب/التجميع بنفس الحقول
  const sortSelect = document.getElementById('rb-sort-field');
  const groupSelect = document.getElementById('rb-group-field');
  const dateFieldSelect = document.getElementById('rb-date-field');
  const optionsHTML = '<option value="">بدون</option>' + src.fields.map(f => `<option value="${f.key}">${rbEsc(f.label)}</option>`).join('');
  if (sortSelect) sortSelect.innerHTML = optionsHTML;
  if (groupSelect) groupSelect.innerHTML = optionsHTML;
  if (dateFieldSelect) {
    const dateFields = src.fields.filter(f => f.type === 'date');
    dateFieldSelect.innerHTML = dateFields.map(f => `<option value="${f.key}">${rbEsc(f.label)}</option>`).join('') || '<option value="created_at">تاريخ الإنشاء</option>';
  }
}

function rbGetSelectedFields() {
  return [...document.querySelectorAll('.rb-field-checkbox:checked')].map(cb => cb.value);
}

// ================================================================
// جمع مواصفة التقرير (spec) من الواجهة
// ================================================================

function rbCollectSpec() {
  const dataSource = document.getElementById('rb-datasource-select').value;
  if (!dataSource) throw new Error('يجب اختيار مصدر البيانات أولاً');

  const title = document.getElementById('rb-title-input').value || undefined;
  const fields = rbGetSelectedFields();

  const filters = {};
  ['projectId', 'client', 'contractor', 'consultant', 'engineer', 'department', 'city', 'status', 'priority', 'userId', 'activityType']
    .forEach(key => {
      const el = document.getElementById(`rb-filter-${key}`);
      if (el && el.value) filters[key] = el.value;
    });

  const dateField = document.getElementById('rb-date-field')?.value || 'created_at';
  const dateFrom = document.getElementById('rb-date-from')?.value || null;
  const dateTo = document.getElementById('rb-date-to')?.value || null;

  const sortBy = document.getElementById('rb-sort-field')?.value || null;
  const sortDir = document.getElementById('rb-sort-dir')?.value || 'asc';

  const groupBy = document.getElementById('rb-group-field')?.value || null;
  const aggregateField = document.getElementById('rb-aggregate-field')?.value || null;
  const aggregateOp = document.getElementById('rb-aggregate-op')?.value || 'count';

  const formulasRaw = document.getElementById('rb-formulas-input')?.value || '';
  const formulas = formulasRaw.split(',').map(f => f.trim()).filter(Boolean);

  const scheduleId = document.getElementById('rb-schedule-id')?.value || undefined;

  return {
    dataSource, title, fields: fields.length ? fields : undefined,
    filters, dateField, dateFrom, dateTo,
    sortBy: sortBy || undefined, sortDir,
    groupBy: groupBy || undefined, aggregateField: aggregateField || undefined, aggregateOp,
    formulas: formulas.length ? formulas : undefined,
    scheduleId,
  };
}

// ================================================================
// تشغيل التقرير المخصص
// ================================================================

async function rbRunReport() {
  const resultRoot = document.getElementById('rb-result-root');
  try {
    const spec = rbCollectSpec();
    resultRoot.innerHTML = '<div class="loading">جاري بناء التقرير من البيانات الفعلية...</div>';
    const res = await rbFetch('/run', { method: 'POST', body: spec });
    RB_LAST_REPORT = res.data;
    rbRenderReport(res.data);
  } catch (e) {
    rbAlert(resultRoot, 'danger', e.message);
  }
}

function rbRenderReport(report) {
  const root = document.getElementById('rb-result-root');

  const kpisHTML = (report.kpis || []).length
    ? `<div class="stat-cards-grid">${report.kpis.map(k => `
        <div class="stat-card card-primary">
          <div class="stat-value">${rbEsc(k.value)}</div>
          <div class="stat-label">${rbEsc(k.label)}</div>
        </div>`).join('')}</div>`
    : '';

  const formulasHTML = (report.formulas || []).length
    ? `<div class="panel"><h4>المعادلات</h4>${report.formulas.map(f => `
        <div class="dist-row"><span>${rbEsc(f.expression)}</span><strong>${rbEsc(f.value)}</strong></div>`).join('')}</div>`
    : '';

  const columns = report.columns || [];
  const rowsHTML = (report.rows || []).length
    ? report.rows.map(row => `<tr>${columns.map(c => `<td>${rbEsc(row[c])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-row">لا توجد بيانات مطابقة للفلاتر المحددة</td></tr>`;

  const groupsHTML = report.groups
    ? `<div class="panel"><h4>التجميع حسب: ${rbEsc(report.grouped_by)}</h4>
        <table class="data-table">
          <thead><tr><th>القيمة</th><th>العدد</th><th>${rbEsc(report.groups[0]?.aggregate_op || '')}</th></tr></thead>
          <tbody>${report.groups.map(g => `
            <tr><td>${rbEsc(g.key)}</td><td>${g.count}</td><td>${g.aggregate_value !== null ? rbEsc(g.aggregate_value) : '-'}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>`
    : '';

  root.innerHTML = `
    <div class="rb-report">
      <div class="rb-report-header">
        <h3>${rbEsc(report.title)}</h3>
        <span class="tag tag-info">${rbEsc(report.data_source_label)}</span>
        <span class="rb-meta">إجمالي المطابق: <strong>${report.total_matched}</strong> — المعروض: <strong>${report.displayed_count}</strong></span>
      </div>
      ${kpisHTML}
      ${formulasHTML}
      ${groupsHTML}
      <div class="panel">
        <h4>البيانات</h4>
        <table class="data-table">
          <thead><tr>${columns.map(c => `<th>${rbEsc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
      <div class="rb-actions">
        <button class="btn btn-sm" onclick="rbOpenSaveDialog()">حفظ مواصفة التقرير</button>
      </div>
    </div>
  `;
}

// ================================================================
// حفظ / تشغيل مواصفات محفوظة
// ================================================================

async function rbOpenSaveDialog() {
  const name = prompt('اسم التقرير المحفوظ:');
  if (!name) return;
  try {
    const spec = rbCollectSpec();
    await rbFetch('/saved', { method: 'POST', body: { name, spec } });
    alert('تم حفظ مواصفة التقرير بنجاح. يمكنك تشغيلها لاحقاً من قائمة التقارير المحفوظة.');
    rbLoadSavedReports();
  } catch (e) {
    alert('خطأ: ' + e.message);
  }
}

async function rbLoadSavedReports() {
  const root = document.getElementById('rb-saved-root');
  if (!root) return;
  try {
    const res = await rbFetch('/saved');
    rbRenderSavedReports(res.data);
  } catch (e) {
    rbAlert(root, 'danger', e.message);
  }
}

function rbRenderSavedReports(list) {
  const root = document.getElementById('rb-saved-root');
  if (!list.length) {
    root.innerHTML = '<div class="empty-row">لا توجد تقارير محفوظة بعد</div>';
    return;
  }
  root.innerHTML = `
    <table class="data-table">
      <thead><tr><th>الاسم</th><th>مصدر البيانات</th><th>آخر تحديث</th><th></th></tr></thead>
      <tbody>
        ${list.map(r => `
          <tr>
            <td>${rbEsc(r.name)}</td>
            <td><code>${rbEsc(r.spec?.dataSource || '-')}</code></td>
            <td>${rbEsc(new Date(r.updated_at).toLocaleString('ar-EG'))}</td>
            <td>
              <button class="btn btn-sm" onclick="rbRunSaved('${r.id}')">تشغيل</button>
              <button class="btn btn-sm btn-danger" onclick="rbDeleteSaved('${r.id}')">حذف</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function rbRunSaved(id) {
  const resultRoot = document.getElementById('rb-result-root');
  try {
    resultRoot.innerHTML = '<div class="loading">جاري تشغيل التقرير المحفوظ...</div>';
    const res = await rbFetch('/saved/run', { method: 'POST', body: { id } });
    RB_LAST_REPORT = res.data;
    rbRenderReport(res.data);
  } catch (e) {
    rbAlert(resultRoot, 'danger', e.message);
  }
}

async function rbDeleteSaved(id) {
  if (!confirm('هل تريد حذف مواصفة التقرير المحفوظة؟')) return;
  try {
    await rbFetch('/saved/delete', { method: 'POST', body: { id } });
    rbLoadSavedReports();
  } catch (e) {
    alert('خطأ: ' + e.message);
  }
}

// ================================================================
// التهيئة
// ================================================================

function rbInit() {
  rbLoadDataSources();
  rbLoadSavedReports();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('rb-builder-root')) {
    rbInit();
  }
});
