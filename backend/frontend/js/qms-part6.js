// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم التاسع: إدارة الجودة (QMS) — الجزء 4/4 (الجزء الأول من التنفيذ)
// التنبيهات الذكية (Smart Alerts) + التقارير (Reports)
// ============================================================

const QMS_ALERTS_API = '/api/qms/alerts';
const QMS_REP_API = '/api/qms/reports';
let qmsRepCurrentReport = null;

function qmsAlertsFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${QMS_ALERTS_API}${path}`;
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

function qmsRepFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${QMS_REP_API}${path}`;
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

const QMS_ALERT_SEVERITY_LABELS = { high: 'خطورة عالية', medium: 'خطورة متوسطة', low: 'خطورة منخفضة' };
const QMS_ALERT_SEVERITY_TAGS = { high: 'tag-bad', medium: 'tag-info', low: 'tag-ok' };

const QMS_ALERT_TYPE_LABELS = {
  ir_rejected: 'طلب فحص مرفوض',
  ncr_new: 'حالة عدم مطابقة جديدة',
  capa_overdue: 'إجراء تصحيحي متأخر',
  document_expired: 'وثيقة منتهية الصلاحية',
  document_expiring_soon: 'وثيقة تقترب من الانتهاء',
  calibration_overdue: 'معايرة جهاز متأخرة',
  calibration_due_soon: 'معايرة جهاز قريبة الاستحقاق',
  mar_delayed: 'تأخر اعتماد مادة',
  sdr_delayed: 'تأخر اعتماد رسم',
  kpi_compliance_low: 'انخفاض نسبة نجاح الفحوصات',
  kpi_test_pass_rate_low: 'انخفاض معدل نجاح الاختبارات',
};

// ================================================================
// التنبيهات الذكية
// ================================================================

document.querySelector('[data-panel="qms-alerts"]')?.addEventListener('click', () => qmsLoadAlerts());
document.getElementById('qms-alerts-btn-load')?.addEventListener('click', () => qmsLoadAlerts());

async function qmsLoadAlerts() {
  const cardsEl = document.getElementById('qms-alerts-summary-cards');
  const chartEl = document.getElementById('qms-alerts-chart-severity');
  const listEl = document.getElementById('qms-alerts-list');
  if (!cardsEl) return;
  const projectId = document.getElementById('qms-alerts-project')?.value.trim() || null;

  try {
    const res = await qmsAlertsFetch('/summary', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي التنبيهات النشطة</div><div class="value">${d.total}</div></div>
      <div class="result-card"><div class="label">خطورة عالية</div><div class="value">${d.by_severity.high || 0}</div></div>
      <div class="result-card"><div class="label">خطورة متوسطة</div><div class="value">${d.by_severity.medium || 0}</div></div>
      <div class="result-card"><div class="label">خطورة منخفضة</div><div class="value">${d.by_severity.low || 0}</div></div>
    `;

    const maxSev = Math.max(1, d.by_severity.high || 0, d.by_severity.medium || 0, d.by_severity.low || 0);
    chartEl.innerHTML = ['high', 'medium', 'low'].map(sev => {
      const count = d.by_severity[sev] || 0;
      return `
        <div class="pm-bar-row">
          <div class="pm-bar-label">${QMS_ALERT_SEVERITY_LABELS[sev]}</div>
          <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxSev) * 100}%"></div></div>
          <div class="pm-bar-value">${count}</div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = d.alerts.length
      ? d.alerts.map(a => `
        <div class="pm-activity-item">
          <span class="tag ${QMS_ALERT_SEVERITY_TAGS[a.severity] || 'tag-info'}">${QMS_ALERT_SEVERITY_LABELS[a.severity] || a.severity}</span>
          <span class="ts">${qmsFmtDateTime(a.generated_at)}</span>
          <span>[${QMS_ALERT_TYPE_LABELS[a.type] || a.type}] ${qmsEsc(a.message)}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد تنبيهات نشطة حالياً</div>`;
  } catch (e) {
    qmsAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// التقارير
// ================================================================

const QMS_REPORT_ENDPOINTS = {
  periodic_daily: () => ({ path: '/periodic', extraQuery: { period: 'daily' } }),
  periodic_weekly: () => ({ path: '/periodic', extraQuery: { period: 'weekly' } }),
  periodic_monthly: () => ({ path: '/periodic', extraQuery: { period: 'monthly' } }),
  inspection_requests: () => ({ path: '/inspection-requests', extraQuery: {} }),
  material_tests: () => ({ path: '/material-tests', extraQuery: {} }),
  ncrs: () => ({ path: '/ncrs', extraQuery: {} }),
  capas: () => ({ path: '/capas', extraQuery: {} }),
  lab: () => ({ path: '/lab', extraQuery: {} }),
  performance: () => ({ path: '/performance', extraQuery: {} }),
  executive: () => ({ path: '/executive', extraQuery: {} }),
};

document.getElementById('qms-report-btn-generate')?.addEventListener('click', async () => {
  const previewEl = document.getElementById('qms-report-preview');
  const exportToolbar = document.getElementById('qms-report-export-toolbar');
  const type = document.getElementById('qms-report-type')?.value;
  const projectId = document.getElementById('qms-report-project')?.value.trim() || null;
  const dateFrom = document.getElementById('qms-report-date-from')?.value || null;
  const dateTo = document.getElementById('qms-report-date-to')?.value || null;

  const cfg = QMS_REPORT_ENDPOINTS[type];
  if (!cfg) return;
  const { path, extraQuery } = cfg();

  try {
    const res = await qmsRepFetch(path, { query: { projectId, dateFrom, dateTo, ...extraQuery } });
    qmsRepCurrentReport = res.report;
    qmsRepRenderReport(qmsRepCurrentReport);
    exportToolbar.style.display = '';
  } catch (e) {
    previewEl.innerHTML = `<div class="alert alert-error">${qmsEsc(e.message)}</div>`;
    exportToolbar.style.display = 'none';
  }
});

function qmsRepRenderReport(report) {
  const previewEl = document.getElementById('qms-report-preview');
  if (!previewEl) return;

  const summaryEntries = Object.entries(report).filter(([k, v]) => k !== 'rows' && typeof v !== 'object');
  const summaryHtml = summaryEntries.length
    ? `<div class="result-cards">${summaryEntries.map(([k, v]) => `
        <div class="result-card"><div class="label">${qmsEsc(k)}</div><div class="value">${qmsEsc(v)}</div></div>
      `).join('')}</div>`
    : '';

  const rows = report.rows || [];
  let tableHtml = '';
  if (rows.length) {
    const keys = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set()));
    tableHtml = `
      <div class="table-wrap" style="margin-top:16px">
        <table class="detail-table">
          <thead><tr>${keys.map(k => `<th>${qmsEsc(k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(r => `<tr>${keys.map(k => {
              const v = r[k];
              const display = v === null || v === undefined ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
              return `<td>${qmsEsc(display)}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    tableHtml = `<div class="pm-empty-state" style="margin-top:16px">لا توجد بيانات تفصيلية لهذا التقرير ضمن النطاق المحدد</div>`;
  }

  previewEl.innerHTML = `<h3>${qmsEsc(report.title || 'تقرير')}</h3>${summaryHtml}${tableHtml}`;
}

async function qmsRepExport(kind) {
  const previewEl = document.getElementById('qms-report-preview');
  if (!qmsRepCurrentReport) {
    previewEl.insertAdjacentHTML('afterbegin', `<div class="alert alert-error">يجب إنشاء التقرير أولاً قبل التصدير</div>`);
    return;
  }
  const projectId = document.getElementById('qms-report-project')?.value.trim() || null;
  try {
    const res = await qmsRepFetch(`/export/${kind}`, { method: 'POST', body: { report: qmsRepCurrentReport, projectName: projectId } });
    previewEl.insertAdjacentHTML('afterbegin', `<div class="alert alert-success">تم إنشاء الملف بنجاح — <a href="${qmsEsc(res.url)}" target="_blank">فتح / تنزيل الملف</a></div>`);
  } catch (e) {
    previewEl.insertAdjacentHTML('afterbegin', `<div class="alert alert-error">${qmsEsc(e.message)}</div>`);
  }
}

document.getElementById('qms-report-btn-pdf')?.addEventListener('click', () => qmsRepExport('pdf'));
document.getElementById('qms-report-btn-excel')?.addEventListener('click', () => qmsRepExport('excel'));
document.getElementById('qms-report-btn-csv')?.addEventListener('click', () => qmsRepExport('csv'));
document.getElementById('qms-report-btn-word')?.addEventListener('click', () => qmsRepExport('word'));
document.getElementById('qms-report-btn-print')?.addEventListener('click', () => qmsRepExport('print'));
