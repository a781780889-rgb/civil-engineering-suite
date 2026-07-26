// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الرابع عشر: نظام التقارير والتحليلات المتكامل
// الجزء 5/10: التقارير التنفيذية + التقارير الدورية (يومي/أسبوعي/شهري)
// ============================================================

const REP_API = '/api/reports';
let REP_LAST_REPORT = null; // آخر تقرير تم توليده - يُستخدم عند التصدير

// ---------- أدوات عامة (بنفس نمط reportsCenter.js) ----------
function repFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${REP_API}${path}`;
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

function repEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function repAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${repEsc(message)}</div>`;
}

function repFormatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

const REP_STATUS_LABELS = { ok: 'طبيعي', watch: 'يحتاج متابعة', warning: 'تحذير', critical: 'خطر', unknown: 'غير متوفر' };
const REP_STATUS_CLASS = { ok: 'status-ok', watch: 'status-watch', warning: 'status-warning', critical: 'status-critical', unknown: 'status-unknown' };

// ================================================================
// التقرير التنفيذي على مستوى مشروع واحد
// ================================================================

async function repLoadProjectExecutive(projectId, userId = null) {
  const root = document.getElementById('reports-executive-project-root');
  if (!root) return;
  if (!projectId) { repAlert(root, 'warning', 'يرجى اختيار مشروع أولاً'); return; }
  root.innerHTML = '<div class="loading">جاري إنشاء التقرير التنفيذي...</div>';
  try {
    const res = await repFetch('/executive/project', { query: { projectId, userId } });
    REP_LAST_REPORT = res.data;
    repRenderProjectExecutive(res.data);
  } catch (e) {
    repAlert(root, 'danger', e.message);
  }
}

function repRenderProjectExecutive(report) {
  const root = document.getElementById('reports-executive-project-root');

  const overallClass = REP_STATUS_CLASS[report.overall_status] || 'status-unknown';

  const indicatorsHTML = Object.values(report.indicators || {}).map(ind => {
    const cls = REP_STATUS_CLASS[ind.status] || 'status-unknown';
    const statusLabel = ind.status_label || (ind.status ? REP_STATUS_LABELS[ind.status] : '-');
    return `
      <div class="indicator-card ${cls}">
        <div class="indicator-label">${repEsc(ind.label)}</div>
        <div class="indicator-value">${ind.value === null || ind.value === undefined ? '-' : ind.value}${ind.unit ? ` ${repEsc(ind.unit)}` : ''}</div>
        ${ind.status ? `<div class="indicator-status">${repEsc(statusLabel)}</div>` : ''}
        ${ind.note ? `<div class="indicator-note">${repEsc(ind.note)}</div>` : ''}
      </div>
    `;
  }).join('');

  const fin = report.financial_summary || {};
  const financialHTML = `
    <div class="panel">
      <h3>الملخص المالي</h3>
      <div class="dist-row"><span>الميزانية</span><strong>${fin.budget ?? 0}</strong></div>
      <div class="dist-row"><span>إجمالي المصروفات</span><strong>${fin.total_expenses ?? 0}</strong></div>
      <div class="dist-row"><span>إجمالي الإيرادات</span><strong>${fin.total_revenue ?? 0}</strong></div>
      <div class="dist-row"><span>المتبقي من الميزانية</span><strong>${fin.remaining_budget ?? 0}</strong></div>
      <div class="dist-row"><span>صافي التدفق النقدي</span><strong>${fin.net_cash_flow ?? 0}</strong></div>
      ${fin.over_budget ? '<div class="alert alert-danger">تجاوز الميزانية المخططة</div>' : ''}
    </div>
  `;

  const risks = report.risks_summary || {};
  const risksHTML = `
    <div class="panel">
      <h3>ملخص المخاطر</h3>
      <div class="dist-row"><span>الإجمالي</span><strong>${risks.total ?? 0}</strong></div>
      <div class="dist-row"><span>المفتوحة</span><strong>${risks.open ?? 0}</strong></div>
      <div class="dist-row"><span>عالية/حرجة مفتوحة</span><strong>${risks.high_or_critical_open ?? 0}</strong></div>
    </div>
  `;

  root.innerHTML = `
    <div class="rpt-executive">
      <div class="exec-header">
        <h2>${repEsc(report.title)}</h2>
        <span class="badge ${overallClass}">الحالة العامة: ${repEsc(report.overall_status_label)}</span>
        <span class="meta">تاريخ الإصدار: ${repFormatDate(report.generated_at)}</span>
      </div>

      <div class="indicators-grid">${indicatorsHTML}</div>

      <div class="rpt-grid-2col">
        ${financialHTML}
        ${risksHTML}
      </div>

      <div class="export-actions">
        <button onclick="repExportLastReport('pdf')">تصدير PDF</button>
        <button onclick="repExportLastReport('xlsx')">تصدير Excel</button>
        <button onclick="repExportLastReport('csv')">تصدير CSV</button>
        <button onclick="repExportLastReport('word')">تصدير Word</button>
        <button onclick="repExportLastReport('html')">معاينة للطباعة</button>
      </div>
    </div>
  `;
}

// ================================================================
// التقرير التنفيذي على مستوى كل المشاريع (Portfolio)
// ================================================================

async function repLoadPortfolioExecutive(statusFilter = null, userId = null) {
  const root = document.getElementById('reports-executive-portfolio-root');
  if (!root) return;
  root.innerHTML = '<div class="loading">جاري إنشاء التقرير التنفيذي الشامل...</div>';
  try {
    const res = await repFetch('/executive/portfolio', { query: { status: statusFilter, userId } });
    REP_LAST_REPORT = res.data;
    repRenderPortfolioExecutive(res.data);
  } catch (e) {
    repAlert(root, 'danger', e.message);
  }
}

function repRenderPortfolioExecutive(report) {
  const root = document.getElementById('reports-executive-portfolio-root');

  const byStatusHTML = Object.entries(report.by_overall_status || {}).map(([k, v]) => `
    <div class="dist-row"><span>${repEsc(REP_STATUS_LABELS[k] || k)}</span><strong>${v}</strong></div>
  `).join('');

  const rowsHTML = (report.projects || []).map(p => {
    const cls = REP_STATUS_CLASS[p.overall_status] || 'status-unknown';
    return `
      <tr>
        <td>${repEsc(p.project_name)}</td>
        <td>${p.progress_percent ?? '-'}%</td>
        <td>${p.budget_utilization_percent ?? '-'}%</td>
        <td>${p.open_high_critical_risks ?? 0}</td>
        <td>${p.hse_open_incidents ?? 0}</td>
        <td>${p.qms_open_ncrs ?? 0}</td>
        <td><span class="badge ${cls}">${repEsc(p.overall_status_label)}</span></td>
      </tr>
    `;
  }).join('');

  root.innerHTML = `
    <div class="rpt-executive">
      <div class="exec-header">
        <h2>${repEsc(report.title)}</h2>
        <span class="meta">إجمالي المشاريع: ${report.total_projects} | تاريخ الإصدار: ${repFormatDate(report.generated_at)}</span>
      </div>

      <div class="panel">
        <h3>توزيع المشاريع حسب الحالة العامة</h3>
        <div class="dist-list">${byStatusHTML || '<div class="empty-row">لا توجد بيانات</div>'}</div>
      </div>

      <div class="panel">
        <h3>تفاصيل كل مشروع</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>المشروع</th><th>الإنجاز</th><th>استهلاك الميزانية</th>
              <th>مخاطر عالية/حرجة</th><th>حوادث سلامة مفتوحة</th><th>NCR مفتوحة</th><th>الحالة العامة</th>
            </tr>
          </thead>
          <tbody>${rowsHTML || '<tr><td colspan="7" class="empty-row">لا توجد مشاريع</td></tr>'}</tbody>
        </table>
      </div>

      <div class="export-actions">
        <button onclick="repExportLastReport('pdf')">تصدير PDF</button>
        <button onclick="repExportLastReport('xlsx')">تصدير Excel</button>
        <button onclick="repExportLastReport('csv')">تصدير CSV</button>
      </div>
    </div>
  `;
}

// ================================================================
// التقارير الدورية (يومي / أسبوعي / شهري)
// ================================================================

async function repRunPeriodicReport({ projectId, periodType = 'daily', refDate = null, notes = null, userId = null } = {}) {
  const root = document.getElementById('reports-periodic-root');
  if (!root) return;
  if (!projectId) { repAlert(root, 'warning', 'يرجى اختيار مشروع أولاً'); return; }
  root.innerHTML = '<div class="loading">جاري إنشاء التقرير الدوري...</div>';
  try {
    const res = await repFetch('/periodic/run', {
      method: 'POST',
      body: { projectId, periodType, refDate, notes, userId },
    });
    REP_LAST_REPORT = res.data;
    repRenderPeriodicReport(res.data);
  } catch (e) {
    repAlert(root, 'danger', e.message);
  }
}

function repRenderPeriodicReport(report) {
  const root = document.getElementById('reports-periodic-root');

  const ew = report.executed_works || {};
  const tasksHTML = (ew.tasks_updated || []).map(t => `
    <tr>
      <td>${repEsc(t.title)}</td>
      <td>${repEsc(t.assignee || '-')}</td>
      <td>${t.progress_percent ?? 0}%</td>
      <td>${repEsc(t.status)}</td>
    </tr>
  `).join('');

  const workforce = report.workforce || {};
  const issues = report.issues || {};
  const issuesHTML = (issues.open_risks || []).map(r => `
    <tr><td>${repEsc(r.description)}</td><td>${repEsc(r.level)}</td><td>${repEsc(r.status)}</td></tr>
  `).join('');

  root.innerHTML = `
    <div class="rpt-executive">
      <div class="exec-header">
        <h2>${repEsc(report.title)}</h2>
        <span class="meta">
          الفترة: ${repFormatDate(report.period?.from)} — ${repFormatDate(report.period?.to)}
        </span>
      </div>

      <div class="panel">
        <h3>الأعمال المنفذة</h3>
        <div class="dist-row"><span>مهام مُحدَّثة خلال الفترة</span><strong>${ew.tasks_updated_count ?? 0}</strong></div>
        <div class="dist-row"><span>مهام مكتملة</span><strong>${ew.tasks_completed_count ?? 0}</strong></div>
        <div class="dist-row"><span>مهام متأخرة</span><strong>${ew.tasks_delayed_count ?? 0}</strong></div>
        <table class="data-table">
          <thead><tr><th>المهمة</th><th>المسؤول</th><th>الإنجاز</th><th>الحالة</th></tr></thead>
          <tbody>${tasksHTML || '<tr><td colspan="4" class="empty-row">لا توجد مهام مُحدَّثة خلال هذه الفترة</td></tr>'}</tbody>
        </table>
      </div>

      <div class="panel">
        <h3>العمال (فريق المشروع)</h3>
        <div class="dist-row"><span>إجمالي أعضاء الفريق</span><strong>${workforce.total_team_members ?? 0}</strong></div>
      </div>

      <div class="panel">
        <h3>المشاكل (المخاطر المفتوحة)</h3>
        <div class="dist-row"><span>إجمالي المخاطر المفتوحة</span><strong>${issues.open_risks_total ?? 0}</strong></div>
        <div class="dist-row"><span>مخاطر جديدة خلال الفترة</span><strong>${issues.risks_raised_in_period ?? 0}</strong></div>
        <table class="data-table">
          <thead><tr><th>الوصف</th><th>المستوى</th><th>الحالة</th></tr></thead>
          <tbody>${issuesHTML || '<tr><td colspan="3" class="empty-row">لا توجد مخاطر مفتوحة</td></tr>'}</tbody>
        </table>
      </div>

      ${report.notes ? `<div class="panel"><h3>ملاحظات</h3><p>${repEsc(report.notes)}</p></div>` : ''}

      <div class="export-actions">
        <button onclick="repExportLastReport('pdf')">تصدير PDF</button>
        <button onclick="repExportLastReport('xlsx')">تصدير Excel</button>
        <button onclick="repExportLastReport('csv')">تصدير CSV</button>
        <button onclick="repExportLastReport('word')">تصدير Word</button>
        <button onclick="repExportLastReport('html')">معاينة للطباعة</button>
      </div>
    </div>
  `;
}

// ================================================================
// التصدير (مشترك بين كل أنواع تقارير هذا الجزء)
// ================================================================

async function repExportLastReport(format) {
  if (!REP_LAST_REPORT) { alert('لا يوجد تقرير مُنشأ بعد للتصدير'); return; }
  try {
    const res = await repFetch('/executive-periodic/export', {
      method: 'POST',
      body: { report: REP_LAST_REPORT, format, meta: { projectName: REP_LAST_REPORT.project_name } },
    });
    if (res.data?.url) window.open(res.data.url, '_blank');
  } catch (e) {
    alert(e.message);
  }
}
