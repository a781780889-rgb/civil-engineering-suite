// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الرابع عشر: نظام التقارير والتحليلات المتكامل
// الجزء 4/10: التقارير التفاعلية + الرسوم البيانية
// ============================================================

const RI_API = '/api/reports/interactive';
let RI_LAST_CHART = null;
let RI_LAST_SPEC = null; // مواصفة التقرير الحالية، تُستخدم لإعادة التشغيل (rerun) وdrill-down

// ---------- أدوات عامة (بنفس نمط reportBuilder.js وreportPeriodsComparisons.js) ----------
function riFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${RI_API}${path}`;
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

function riEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function riAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${riEsc(message)}</div>`;
}

function riNumber(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

// ================================================================
// تحميل أنواع الرسوم البيانية المتاحة
// ================================================================

async function riLoadChartTypes() {
  const select = document.getElementById('ri-chart-type-select');
  if (!select) return;
  try {
    const res = await riFetch('/chart-types');
    select.innerHTML = res.data.map(c => `<option value="${c.key}">${riEsc(c.label)}</option>`).join('');
  } catch (e) {
    riAlert(document.getElementById('ri-root'), 'danger', e.message);
  }
}

// ================================================================
// بناء رسم بياني من مواصفة تقرير (تُستخدم مواصفة منشئ التقارير - الجزء 2)
// ================================================================

/**
 * spec: مواصفة buildCustomReport (نفس التي يجمعها rbCollectSpec في الجزء 2)
 * options: حسب نوع الرسم: labelField/valueField/valueOp (bar), labelField (pie/doughnut),
 *          dateField/valueField/valueOp (line/area), xField/yField (scatter),
 *          labelField/progressField (progress_bars), rowField/colField (heatmap),
 *          scheduleId (gantt/s_curve)
 */
async function riRunChart(spec, options = {}) {
  const root = document.getElementById('ri-chart-result');
  const chartType = document.getElementById('ri-chart-type-select')?.value;
  if (!chartType) { riAlert(root, 'danger', 'يجب اختيار نوع الرسم البياني أولاً'); return; }
  try {
    RI_LAST_SPEC = spec;
    root.innerHTML = '<div class="loading">جاري بناء الرسم البياني من البيانات الفعلية...</div>';
    const res = await riFetch('/chart', { method: 'POST', body: { chartType, reportSpec: spec, options } });
    RI_LAST_CHART = res.data;
    riRenderChart(res.data);
  } catch (e) {
    riAlert(root, 'danger', e.message);
  }
}

function riRenderChart(chart) {
  const root = document.getElementById('ri-chart-result');
  if (!root) return;

  if (chart.type === 'kpi_cards') {
    root.innerHTML = `<div class="stat-cards-grid">${chart.cards.map(c => `
      <div class="stat-card card-primary">
        <div class="stat-value">${riEsc(c.value)}</div>
        <div class="stat-label">${riEsc(c.label)}</div>
      </div>`).join('')}</div>`;
    return;
  }

  if (chart.type === 'progress_bars') {
    root.innerHTML = `<div class="ri-progress-list">${chart.bars.map(b => `
      <div class="ri-progress-row">
        <div class="ri-progress-label">${riEsc(b.label)} <span class="tag">${riEsc(b.status)}</span></div>
        <div class="ri-progress-track"><div class="ri-progress-fill" style="width:${b.percent}%"></div></div>
        <div class="ri-progress-percent">${riNumber(b.percent)}%</div>
      </div>`).join('')}</div>`;
    return;
  }

  if (chart.type === 'heatmap') {
    root.innerHTML = `
      <table class="data-table ri-heatmap">
        <thead><tr><th></th>${chart.cols.map(c => `<th>${riEsc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${chart.rows.map((r, ri) => `
            <tr><th>${riEsc(r)}</th>${chart.matrix[ri].map(v => `<td class="ri-heat-cell" data-value="${v}">${v}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>`;
    return;
  }

  if (chart.type === 'gantt') {
    root.innerHTML = `
      <div class="ri-gantt">
        ${chart.tasks.map(t => `
          <div class="ri-gantt-row">
            <div class="ri-gantt-label">${riEsc(t.name)} ${t.is_critical ? '<span class="tag tag-danger">حرج</span>' : ''}</div>
            <div class="ri-gantt-track">
              <div class="ri-gantt-bar" style="right:${(t.start_day / chart.project_duration_days) * 100}%; width:${((t.end_day - t.start_day) / chart.project_duration_days) * 100}%">
                ${riNumber(t.progress_percent)}%
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    return;
  }

  if (chart.type === 's_curve') {
    root.innerHTML = `
      <div class="ri-meta">نسبة الإنجاز الفعلي الحالية: <strong>${riNumber(chart.current_actual_progress_percent)}%</strong></div>
      <table class="data-table">
        <thead><tr><th>التاريخ</th>${chart.datasets.map(d => `<th>${riEsc(d.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${chart.labels.map((lab, idx) => `
            <tr><td>${riEsc(String(lab).slice(0, 10))}</td>${chart.datasets.map(d => `<td>${riNumber(d.data[idx])}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>`;
    return;
  }

  if (chart.type === 'scatter') {
    root.innerHTML = `
      <table class="data-table">
        <thead><tr><th>${riEsc(chart.x_field)}</th><th>${riEsc(chart.y_field)}</th><th>التسمية</th></tr></thead>
        <tbody>${chart.points.map(p => `<tr><td>${riNumber(p.x)}</td><td>${riNumber(p.y)}</td><td>${riEsc(p.label)}</td></tr>`).join('')}</tbody>
      </table>`;
    return;
  }

  // bar / line / pie / doughnut / area: جدول تسميات وقيم عام + إتاحة drill-down عند توفره
  const canDrill = !!chart.drill_down_capable && !!chart.group_field;
  root.innerHTML = `
    <table class="data-table">
      <thead><tr><th>التسمية</th>${chart.datasets.map(d => `<th>${riEsc(d.label || '')}</th>`).join('')}</tr></thead>
      <tbody>
        ${chart.labels.map((lab, idx) => `
          <tr ${canDrill ? `class="ri-clickable-row" onclick="riDrillDownGroup('${riEsc(lab)}')"` : ''}>
            <td>${riEsc(lab)}</td>
            ${chart.datasets.map(d => `<td>${riNumber(d.data[idx])}</td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>
    ${canDrill ? '<div class="ri-hint">اضغط على أي صف لعرض التفاصيل الكاملة</div>' : ''}
  `;
}

// ================================================================
// التفاعل: drill-down من مجموعة (Summary → Details)
// ================================================================

async function riDrillDownGroup(groupKey) {
  const root = document.getElementById('ri-drilldown-result');
  if (!root || !RI_LAST_SPEC) return;
  try {
    root.innerHTML = '<div class="loading">جاري تحميل التفاصيل...</div>';
    const res = await riFetch('/drill-down/group', { method: 'POST', body: { spec: RI_LAST_SPEC, groupKey } });
    riRenderDrillDownDetails(res.data);
  } catch (e) {
    riAlert(root, 'danger', e.message);
  }
}

function riRenderDrillDownDetails(report) {
  const root = document.getElementById('ri-drilldown-result');
  if (!root) return;
  const columns = report.columns || [];
  root.innerHTML = `
    <div class="panel">
      <h4>${riEsc(report.title)}</h4>
      <div class="ri-meta">عدد السجلات: <strong>${report.total_matched}</strong></div>
      <table class="data-table">
        <thead><tr>${columns.map(c => `<th>${riEsc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${report.rows.map(row => `
            <tr class="ri-clickable-row" onclick="riDrillDownRow('${riEsc(report.data_source)}','${riEsc(row.id)}')">
              ${columns.map(c => `<td>${riEsc(row[c])}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ================================================================
// التفاعل: drill-down لسجل مفرد كامل
// ================================================================

async function riDrillDownRow(dataSource, rowId) {
  const root = document.getElementById('ri-row-detail-result');
  try {
    const res = await riFetch('/drill-down/row', { query: { dataSource, rowId } });
    riRenderRowDetail(res.data);
  } catch (e) {
    riAlert(root || document.getElementById('ri-drilldown-result'), 'danger', e.message);
  }
}

function riRenderRowDetail(data) {
  const root = document.getElementById('ri-row-detail-result');
  if (!root) return;
  const record = data.record;
  root.innerHTML = `
    <div class="panel">
      <h4>تفاصيل السجل الكامل</h4>
      <table class="data-table">
        <tbody>
          ${Object.entries(record).map(([k, v]) => `
            <tr><th>${riEsc(k)}</th><td>${riEsc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ================================================================
// التفاعل: إعادة التشغيل بفلاتر/فترة/ترتيب مختلف من نفس الواجهة
// ================================================================

async function riRerunWithOverrides(overrides) {
  const root = document.getElementById('ri-chart-result');
  if (!RI_LAST_SPEC) { riAlert(root, 'danger', 'لا يوجد تقرير أساسي لإعادة تشغيله بعد'); return; }
  try {
    root.innerHTML = '<div class="loading">جاري إعادة التشغيل بالفلاتر الجديدة...</div>';
    const res = await riFetch('/rerun', { method: 'POST', body: { spec: RI_LAST_SPEC, overrides } });
    // إعادة عرض النتيجة كتقرير جدولي بسيط (وليس رسم بياني) لأن rerun يعيد تقرير buildCustomReport خام
    riRenderRerunAsTable(res.data);
  } catch (e) {
    riAlert(root, 'danger', e.message);
  }
}

function riRenderRerunAsTable(report) {
  const root = document.getElementById('ri-chart-result');
  const columns = report.columns || [];
  root.innerHTML = `
    <div class="ri-meta">${riEsc(report.title)} — إجمالي المطابق: <strong>${report.total_matched}</strong></div>
    <table class="data-table">
      <thead><tr>${columns.map(c => `<th>${riEsc(c)}</th>`).join('')}</tr></thead>
      <tbody>${report.rows.map(row => `<tr>${columns.map(c => `<td>${riEsc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
}

// ================================================================
// التهيئة
// ================================================================

function riInit() {
  riLoadChartTypes();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('ri-root')) {
    riInit();
  }
});
