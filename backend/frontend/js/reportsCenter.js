// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الرابع عشر: نظام التقارير والتحليلات المتكامل
// الجزء 1/10: لوحة تحكم التقارير + مركز التقارير (الكتالوج)
// ============================================================

const RPT_API = '/api/reports';
let RPT_CATALOG_CACHE = null;

// ---------- أدوات عامة (بنفس نمط hseViolations.js) ----------
function rptFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${RPT_API}${path}`;
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

function rptEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rptAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${rptEsc(message)}</div>`;
}

function rptFormatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

// ================================================================
// لوحة تحكم التقارير
// ================================================================

async function rptLoadDashboard(projectId = null) {
  const root = document.getElementById('reports-dashboard-root');
  if (!root) return;
  root.innerHTML = '<div class="loading">جاري تحميل لوحة تحكم التقارير...</div>';
  try {
    const res = await rptFetch('/dashboard', { query: { projectId } });
    rptRenderDashboard(res.data);
  } catch (e) {
    rptAlert(root, 'danger', e.message);
  }
}

function rptRenderDashboard(d) {
  const root = document.getElementById('reports-dashboard-root');
  const t = d.totals;

  const cards = [
    { label: 'إجمالي التقارير', value: t.total_reports, cls: 'card-primary' },
    { label: 'تقارير اليوم', value: t.created_today, cls: 'card-info' },
    { label: 'التقارير الأسبوعية', value: t.created_this_week, cls: 'card-info' },
    { label: 'التقارير الشهرية', value: t.created_this_month, cls: 'card-info' },
    { label: 'التقارير المجدولة', value: t.scheduled_reports, cls: 'card-warning' },
    { label: 'التقارير المحفوظة', value: t.saved_reports, cls: 'card-ok' },
    { label: 'التقارير المشتركة', value: t.shared_reports, cls: 'card-ok' },
    { label: 'قيد الإنشاء', value: t.in_progress_reports, cls: 'card-warning' },
  ];

  const cardsHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>
  `).join('');

  const recentHTML = (d.recent_reports || []).length
    ? d.recent_reports.map(r => `
      <tr>
        <td>${rptEsc(r.title)}</td>
        <td>${rptEsc(r.category || '-')}</td>
        <td>${rptEsc(r.project_id || '-')}</td>
        <td>${rptFormatDate(r.created_at)}</td>
        <td><span class="tag tag-info">${rptEsc(r.status)}</span></td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty-row">لا توجد تقارير منشأة بعد</td></tr>';

  const mostUsedHTML = (d.most_used_reports || []).length
    ? d.most_used_reports.map(r => `
      <tr>
        <td>${rptEsc(r.title)}</td>
        <td>${r.count}</td>
        <td>${r.views}</td>
        <td>${r.downloads}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="empty-row">لا توجد بيانات استخدام بعد</td></tr>';

  const byCategoryHTML = Object.entries(d.by_category || {}).length
    ? Object.entries(d.by_category).map(([k, v]) => `
      <div class="dist-row"><span>${rptEsc(k)}</span><strong>${v}</strong></div>
    `).join('')
    : '<div class="empty-row">لا توجد بيانات بعد</div>';

  root.innerHTML = `
    <div class="rpt-dashboard">
      <div class="stat-cards-grid">${cardsHTML}</div>

      <div class="rpt-grid-2col">
        <div class="panel">
          <h3>آخر التقارير</h3>
          <table class="data-table">
            <thead><tr><th>العنوان</th><th>التصنيف</th><th>المشروع</th><th>تاريخ الإنشاء</th><th>الحالة</th></tr></thead>
            <tbody>${recentHTML}</tbody>
          </table>
        </div>

        <div class="panel">
          <h3>الأكثر استخداماً</h3>
          <table class="data-table">
            <thead><tr><th>التقرير</th><th>مرات الإنشاء</th><th>المشاهدات</th><th>التنزيلات</th></tr></thead>
            <tbody>${mostUsedHTML}</tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h3>التوزيع حسب التصنيف</h3>
        <div class="dist-list">${byCategoryHTML}</div>
      </div>
    </div>
  `;
}

// ================================================================
// مركز التقارير (الكتالوج)
// ================================================================

async function rptLoadCatalog() {
  const root = document.getElementById('reports-catalog-root');
  if (!root) return;
  root.innerHTML = '<div class="loading">جاري تحميل مركز التقارير...</div>';
  try {
    const res = await rptFetch('/catalog');
    RPT_CATALOG_CACHE = res.data;
    rptRenderCatalog(res.data);
  } catch (e) {
    rptAlert(root, 'danger', e.message);
  }
}

function rptRenderCatalog(catalog) {
  const root = document.getElementById('reports-catalog-root');

  const summaryHTML = `
    <div class="catalog-summary">
      <span>عدد التصنيفات: <strong>${catalog.categories_count}</strong></span>
      <span>إجمالي أنواع التقارير: <strong>${catalog.total_report_types}</strong></span>
    </div>
  `;

  const categoriesHTML = catalog.categories.map(cat => `
    <div class="catalog-category" data-category-key="${cat.key}">
      <div class="catalog-category-header" onclick="rptToggleCategory('${cat.key}')">
        <span>${rptEsc(cat.label)}</span>
        <span class="tag tag-info">${cat.reportsCount} تقرير</span>
      </div>
      <div class="catalog-category-body" id="catalog-body-${cat.key}" style="display:none">
        <table class="data-table">
          <thead><tr><th>اسم التقرير</th><th>مصدر البيانات</th><th></th></tr></thead>
          <tbody>
            ${cat.reports.map(r => `
              <tr>
                <td>${rptEsc(r.label)}</td>
                <td><code>${rptEsc(r.source)}</code></td>
                <td><button class="btn btn-sm" onclick="rptGenerateFromCatalog('${r.key}')">إنشاء تقرير</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');

  root.innerHTML = `${summaryHTML}<div class="catalog-list">${categoriesHTML}</div>`;
}

function rptToggleCategory(key) {
  const body = document.getElementById(`catalog-body-${key}`);
  if (!body) return;
  body.style.display = body.style.display === 'none' ? '' : 'none';
}

/**
 * إنشاء سجل تقرير أساسي من عنصر في الكتالوج.
 * ملاحظة: التوليد الفعلي لمحتوى كل تقرير (سحب البيانات الحقيقية من وحدته المصدر
 * وتصديره PDF/Excel/CSV) يُنفَّذ بالكامل ضمن الأجزاء 2 و6 من هذا القسم (منشئ
 * التقارير والتصدير). هذا الجزء (1/10) يسجل فقط سجل التقرير في النظام المركزي.
 */
async function rptGenerateFromCatalog(reportKey) {
  try {
    const res = await rptFetch('/records', {
      method: 'POST',
      body: { reportKey, status: 'draft' },
    });
    alert(`تم تسجيل التقرير: ${res.data.title}\nسيتم تفعيل التوليد الكامل (بيانات + تصدير) ضمن الأجزاء القادمة من القسم الرابع عشر.`);
    rptLoadDashboard();
  } catch (e) {
    alert('خطأ: ' + e.message);
  }
}

// ================================================================
// التهيئة
// ================================================================

function rptInit() {
  rptLoadDashboard();
  rptLoadCatalog();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('reports-dashboard-root') || document.getElementById('reports-catalog-root')) {
    rptInit();
  }
});
