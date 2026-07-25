// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الرابع عشر: نظام التقارير والتحليلات المتكامل
// الجزء 3/10: التقارير الزمنية والمقارنة
// ============================================================

const RPC_API = '/api/reports';
let RPC_DATASOURCES_CACHE = null;
let RPC_LAST_PERIOD_REPORT = null;
let RPC_LAST_COMPARISON_REPORT = null;

// ---------- أدوات عامة (بنفس نمط reportBuilder.js) ----------
function rpcFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${RPC_API}${path}`;
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

function rpcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rpcAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${rpcEsc(message)}</div>`;
}

function rpcNumber(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

const RPC_PERIOD_TYPE_LABELS = {
  daily: 'يومي', weekly: 'أسبوعي', biweekly: 'نصف شهري', monthly: 'شهري',
  quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي', custom: 'فترة مخصصة',
};

// ================================================================
// تبويب التقارير الزمنية (Period Reports)
// ================================================================

async function rpcLoadDataSourcesForPeriods() {
  const select = document.getElementById('rpc-period-datasource-select');
  if (!select) return;
  try {
    // إعادة استخدام نفس نقطة نهاية مصادر البيانات المسجَّلة في منشئ التقارير
    // (الجزء 2/10)، دون تكرارها هنا.
    const res = await rpcFetch('/builder/data-sources');
    RPC_DATASOURCES_CACHE = res.data;
    select.innerHTML = '<option value="">اختر مصدر البيانات...</option>' +
      res.data.map(s => `<option value="${s.key}">${rpcEsc(s.label)}</option>`).join('');
  } catch (e) {
    rpcAlert(document.getElementById('rpc-period-root'), 'danger', e.message);
  }
}

function rpcPeriodTypeSelectHTML(id) {
  return `
    <select id="${id}" class="form-select">
      ${Object.entries(RPC_PERIOD_TYPE_LABELS).map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
    </select>
  `;
}

function rpcOnPeriodTypeChange() {
  const type = document.getElementById('rpc-period-type-select').value;
  const customWrap = document.getElementById('rpc-period-custom-wrap');
  if (customWrap) customWrap.style.display = (type === 'custom') ? '' : 'none';
}

async function rpcRunPeriodReport() {
  const root = document.getElementById('rpc-period-result');
  try {
    const dataSource = document.getElementById('rpc-period-datasource-select').value;
    if (!dataSource) throw new Error('يجب اختيار مصدر البيانات أولاً');
    const periodType = document.getElementById('rpc-period-type-select').value;
    const refDate = document.getElementById('rpc-period-refdate-input')?.value || undefined;
    const customFrom = document.getElementById('rpc-period-from-input')?.value || undefined;
    const customTo = document.getElementById('rpc-period-to-input')?.value || undefined;
    const formulasRaw = document.getElementById('rpc-period-formulas-input')?.value || '';
    const formulas = formulasRaw.split(',').map(f => f.trim()).filter(Boolean);

    const spec = {
      dataSource, periodType, refDate, customFrom, customTo,
      title: document.getElementById('rpc-period-title-input')?.value || undefined,
      formulas: formulas.length ? formulas : undefined,
    };

    const res = await rpcFetch('/periods/run', { method: 'POST', body: spec });
    RPC_LAST_PERIOD_REPORT = res.data;
    rpcRenderPeriodReport(res.data);
  } catch (e) {
    rpcAlert(root, 'danger', e.message);
  }
}

function rpcRenderPeriodReport(report) {
  const root = document.getElementById('rpc-period-result');
  if (!root) return;
  root.innerHTML = `
    <div class="rpc-report-card">
      <h4>${rpcEsc(report.title)}</h4>
      <div class="rpc-meta">
        نوع الفترة: ${rpcEsc(RPC_PERIOD_TYPE_LABELS[report.period_type] || report.period_type)} |
        من ${rpcEsc(report.period_range.from.slice(0, 10))} إلى ${rpcEsc(report.period_range.to.slice(0, 10))} |
        عدد السجلات المطابقة: ${rpcNumber(report.total_matched)}
      </div>
      ${report.formulas && report.formulas.length ? `
        <div class="rpc-formulas">
          ${report.formulas.map(f => `<div class="rpc-formula-chip"><b>${rpcEsc(f.expression)}</b>: ${rpcNumber(f.value)}</div>`).join('')}
        </div>` : ''}
      <table class="rpc-table">
        <thead><tr>${report.columns.map(c => `<th>${rpcEsc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${report.rows.map(r => `<tr>${report.columns.map(c => `<td>${rpcEsc(r[c])}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ================================================================
// تبويب مقارنة الفترة الحالية مقابل السابقة
// ================================================================

async function rpcRunPeriodComparison() {
  const root = document.getElementById('rpc-period-compare-result');
  try {
    const dataSource = document.getElementById('rpc-compare-datasource-select').value;
    if (!dataSource) throw new Error('يجب اختيار مصدر البيانات أولاً');
    const periodType = document.getElementById('rpc-compare-period-type-select').value;
    const refDate = document.getElementById('rpc-compare-refdate-input')?.value || undefined;
    const formulasRaw = document.getElementById('rpc-compare-formulas-input')?.value || '';
    const formulas = formulasRaw.split(',').map(f => f.trim()).filter(Boolean);

    const spec = {
      dataSource, periodType, refDate,
      title: document.getElementById('rpc-compare-title-input')?.value || undefined,
      formulas: formulas.length ? formulas : undefined,
    };

    const res = await rpcFetch('/periods/compare', { method: 'POST', body: spec });
    RPC_LAST_COMPARISON_REPORT = res.data;
    rpcRenderPeriodComparison(res.data);
  } catch (e) {
    rpcAlert(root, 'danger', e.message);
  }
}

function rpcTrendIcon(trend) {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '—';
}

function rpcRenderPeriodComparison(report) {
  const root = document.getElementById('rpc-period-compare-result');
  if (!root) return;
  const allMetrics = [...report.comparison.counts, ...report.comparison.formulas, ...report.comparison.kpis];
  root.innerHTML = `
    <div class="rpc-report-card">
      <h4>${rpcEsc(report.title)}</h4>
      <div class="rpc-meta">
        الفترة الحالية: ${rpcEsc(report.current_period.range.from.slice(0, 10))} → ${rpcEsc(report.current_period.range.to.slice(0, 10))}<br>
        الفترة السابقة: ${rpcEsc(report.previous_period.range.from.slice(0, 10))} → ${rpcEsc(report.previous_period.range.to.slice(0, 10))}
      </div>
      <table class="rpc-table">
        <thead><tr><th>المؤشر</th><th>الحالية</th><th>السابقة</th><th>الفرق</th><th>نسبة التغيّر</th><th>الاتجاه</th></tr></thead>
        <tbody>
          ${allMetrics.map(m => `
            <tr>
              <td>${rpcEsc(m.label)}</td>
              <td>${rpcNumber(m.current_value)}</td>
              <td>${rpcNumber(m.previous_value)}</td>
              <td>${rpcNumber(m.difference)}</td>
              <td>${m.change_percent === null ? '—' : m.change_percent + '%'}</td>
              <td>${rpcTrendIcon(m.trend)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ================================================================
// تبويب المقارنات العامة (مشروع/مقاول/ميزانية/إصدار/فترة...)
// ================================================================

async function rpcLoadComparisonDimensions() {
  const select = document.getElementById('rpc-dimension-select');
  if (!select) return;
  try {
    const res = await rpcFetch('/comparisons/dimensions');
    select.innerHTML = '<option value="">اختر نوع المقارنة...</option>' +
      res.data.map(d => `<option value="${d.key}">${rpcEsc(d.label)}</option>`).join('');
  } catch (e) {
    rpcAlert(document.getElementById('rpc-comparison-root'), 'danger', e.message);
  }
}

/**
 * itemA/itemB قد تكونان نصاً بسيطاً (مثل معرّف مشروع أو اسم مقاول) أو JSON صالحاً
 * لمقارنات أكثر تعقيداً (مثل { projectId, version } أو { scheduleId }). نحاول
 * تحليل JSON أولاً، وإن فشل نستخدم النص كما هو.
 */
function rpcParseItemInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return trimmed;
  }
}

async function rpcRunComparison() {
  const root = document.getElementById('rpc-comparison-result');
  try {
    const dimension = document.getElementById('rpc-dimension-select').value;
    if (!dimension) throw new Error('يجب اختيار نوع المقارنة أولاً');
    const itemA = rpcParseItemInput(document.getElementById('rpc-item-a-input')?.value);
    const itemB = rpcParseItemInput(document.getElementById('rpc-item-b-input')?.value);
    if (itemA === null || itemB === null) throw new Error('يجب إدخال قيمة لكلا العنصرين المطلوب مقارنتهما');

    const spec = {
      dimension, itemA, itemB,
      title: document.getElementById('rpc-comparison-title-input')?.value || undefined,
    };

    const res = await rpcFetch('/comparisons/run', { method: 'POST', body: spec });
    rpcRenderComparison(res.data);
  } catch (e) {
    rpcAlert(root, 'danger', e.message);
  }
}

function rpcRenderComparison(report) {
  const root = document.getElementById('rpc-comparison-result');
  if (!root) return;
  root.innerHTML = `
    <div class="rpc-report-card">
      <h4>${rpcEsc(report.title)}</h4>
      <div class="rpc-meta">نوع المقارنة: ${rpcEsc(report.dimension_label)}</div>
      <table class="rpc-table">
        <thead>
          <tr><th>المؤشر</th><th>${rpcEsc(report.item_a.label)}</th><th>${rpcEsc(report.item_b.label)}</th><th>الفرق</th><th>نسبة التغيّر</th><th>الاتجاه</th></tr>
        </thead>
        <tbody>
          ${report.comparison.map(m => `
            <tr>
              <td>${rpcEsc(m.label)}</td>
              <td>${rpcNumber(m.current_value)}</td>
              <td>${rpcNumber(m.previous_value)}</td>
              <td>${rpcNumber(m.difference)}</td>
              <td>${m.change_percent === null ? '—' : m.change_percent + '%'}</td>
              <td>${rpcTrendIcon(m.trend)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ================================================================
// تهيئة عند تحميل الصفحة (إن وُجدت عناصر هذا القسم في DOM)
// ================================================================

function rpcInit() {
  if (document.getElementById('rpc-period-datasource-select')) rpcLoadDataSourcesForPeriods();
  if (document.getElementById('rpc-compare-datasource-select')) {
    // تحميل نفس مصادر البيانات لقائمة مقارنة الفترات
    rpcFetch('/builder/data-sources').then(res => {
      const select = document.getElementById('rpc-compare-datasource-select');
      if (select) {
        select.innerHTML = '<option value="">اختر مصدر البيانات...</option>' +
          res.data.map(s => `<option value="${s.key}">${rpcEsc(s.label)}</option>`).join('');
      }
    }).catch(() => {});
  }
  if (document.getElementById('rpc-dimension-select')) rpcLoadComparisonDimensions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', rpcInit);
} else {
  rpcInit();
}
