// ============================================================
// Civil Engineering Suite — Frontend Logic (Section 4: Project Management)
// ============================================================

const PM_API = '/api/pm';
let pmCurrentProjectId = null;
let pmEditingProjectId = null;
let pmDetailSubtab = 'overview';

// ---------- أدوات عامة ----------
function pmEl(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

async function pmFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${PM_API}${path}`;
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

function pmFormatMoney(v, currency = '') {
  const n = Number(v) || 0;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}${currency ? ' ' + currency : ''}`;
}

function pmFormatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-GB'); } catch (e) { return d; }
}

const PM_STATUS_LABELS = {
  planning: 'قيد التخطيط', active: 'نشط', on_hold: 'متوقف',
  delayed: 'متأخر', completed: 'مكتمل', cancelled: 'ملغى',
};
const PM_PRIORITY_LABELS = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: 'عاجلة' };
const PM_TASK_STATUS_LABELS = {
  not_started: 'لم تبدأ', in_progress: 'قيد التنفيذ', completed: 'منجزة',
  delayed: 'متأخرة', blocked: 'معطّلة', cancelled: 'ملغاة',
};
const PM_RISK_LEVEL_LABELS = { low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج' };

function pmStatusBadge(status) {
  return `<span class="pm-badge pm-badge-${status}">${PM_STATUS_LABELS[status] || status}</span>`;
}
function pmPriorityBadge(priority) {
  return `<span class="pm-badge pm-badge-priority-${priority}">${PM_PRIORITY_LABELS[priority] || priority}</span>`;
}
function pmRiskBadge(level) {
  return `<span class="pm-badge pm-badge-risk-${level}">${PM_RISK_LEVEL_LABELS[level] || level}</span>`;
}

function pmAlert(container, type, message) {
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

// ---------- تفعيل تحميل اللوحات عند التنقل إليها ----------
document.querySelector('[data-panel="pm-dashboard"]')?.addEventListener('click', () => {
  pmLoadDashboard();
});
document.querySelector('[data-panel="pm-projects"]')?.addEventListener('click', () => {
  pmShowListView();
  pmLoadProjectsList();
});

// ================================================================
// لوحة المعلومات (Dashboard)
// ================================================================

async function pmLoadDashboard() {
  const cardsEl = document.getElementById('pm-dash-cards');
  cardsEl.innerHTML = `<div class="pm-empty-state">جارِ التحميل...</div>`;
  try {
    const d = await pmFetch('/dashboard');
    cardsEl.innerHTML = `
      ${pmDashCard('إجمالي المشاريع', d.total_projects, '')}
      ${pmDashCard('المشاريع النشطة', d.active_projects, '')}
      ${pmDashCard('المشاريع المكتملة', d.completed_projects, '')}
      ${pmDashCard('المشاريع المتأخرة', d.delayed_projects, '')}
      ${pmDashCard('نسبة الإنجاز الكلية', d.overall_progress_percent, '%')}
      ${pmDashCard('إجمالي الميزانيات', pmFormatMoney(d.total_budget), '')}
      ${pmDashCard('إجمالي المصروفات', pmFormatMoney(d.total_expenses), '')}
      ${pmDashCard('المهام المفتوحة', d.open_tasks, '')}
      ${pmDashCard('المهام المنجزة', d.completed_tasks, '')}
      ${pmDashCard('الإشعارات غير المقروءة', d.notifications_count, '')}
    `;

    const statusEl = document.getElementById('pm-chart-status');
    const maxStatus = Math.max(1, ...d.status_chart.map(s => s.count));
    statusEl.innerHTML = d.status_chart.map(s => pmBarRow(PM_STATUS_LABELS[s.status] || s.status, s.count, maxStatus)).join('')
      || `<div class="pm-empty-state">لا توجد بيانات</div>`;

    const progEl = document.getElementById('pm-chart-progress');
    progEl.innerHTML = d.progress_chart.length
      ? d.progress_chart.map(p => pmBarRow(p.project, p.progress, 100, '%')).join('')
      : `<div class="pm-empty-state">لا توجد مشاريع بعد</div>`;

    const logEl = document.getElementById('pm-activity-log');
    logEl.innerHTML = d.recent_activities.length
      ? d.recent_activities.map(a => `
        <div class="pm-activity-item">
          <span class="ts">${pmFormatDate(a.ts)}</span>
          <span class="desc">${pmActivityLabel(a)}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا يوجد نشاط بعد</div>`;

    const notifBanner = document.getElementById('pm-notif-banner');
    try {
      const notifs = await pmFetch('/notifications', { query: { unreadOnly: 'true' } });
      if (notifs.length) {
        notifBanner.innerHTML = notifs.slice(0, 5).map(n => `
          <div class="pm-notif-item pm-notif-${n.severity}">
            <span>${n.message}</span>
            <button class="pm-link-btn" onclick="pmMarkNotifRead('${n.id}')">تعليم كمقروء</button>
          </div>
        `).join('');
      } else {
        notifBanner.innerHTML = '';
      }
    } catch (e) { /* تجاهل صمتاً */ }

  } catch (e) {
    cardsEl.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

function pmDashCard(label, value, unit) {
  return `<div class="result-card"><div class="label">${label}</div><div class="value">${value}<span class="unit">${unit}</span></div></div>`;
}

function pmBarRow(label, value, max, unit = '') {
  const pct = max > 0 ? Math.min(100, (Number(value) / max) * 100) : 0;
  return `
    <div class="pm-bar-row">
      <span class="pm-bar-label" title="${label}">${label}</span>
      <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${pct}%"></div></div>
      <span class="pm-bar-value">${value}${unit}</span>
    </div>
  `;
}

const PM_ACTION_LABELS = { create: 'إنشاء', update: 'تحديث', delete: 'حذف' };
const PM_ENTITY_LABELS = {
  project: 'مشروع', phase: 'مرحلة', task: 'مهمة', team_member: 'عضو فريق',
  transaction: 'معاملة مالية', resource: 'مورد', risk: 'خطر', quality: 'سجل جودة',
  safety: 'سجل سلامة', document: 'مستند', meeting: 'اجتماع',
};
function pmActivityLabel(a) {
  const action = PM_ACTION_LABELS[a.action] || a.action;
  const entity = PM_ENTITY_LABELS[a.entity] || a.entity;
  const detail = a.details?.name || a.details?.title || '';
  return `${action} ${entity}${detail ? ' — ' + detail : ''}`;
}

async function pmMarkNotifRead(id) {
  try { await pmFetch('/notifications/read', { method: 'POST', body: { id } }); pmLoadDashboard(); } catch (e) { /* ignore */ }
}

// ================================================================
// قائمة المشاريع
// ================================================================

function pmShowListView() {
  document.getElementById('pm-list-view').style.display = '';
  document.getElementById('pm-form-view').style.display = 'none';
  document.getElementById('pm-detail-view').style.display = 'none';
}
function pmShowFormView() {
  document.getElementById('pm-list-view').style.display = 'none';
  document.getElementById('pm-form-view').style.display = '';
  document.getElementById('pm-detail-view').style.display = 'none';
}
function pmShowDetailView() {
  document.getElementById('pm-list-view').style.display = 'none';
  document.getElementById('pm-form-view').style.display = 'none';
  document.getElementById('pm-detail-view').style.display = '';
}

async function pmLoadProjectsList() {
  const tbody = document.getElementById('pm-projects-tbody');
  tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">جارِ التحميل...</td></tr>`;
  try {
    const q = document.getElementById('pm-search').value.trim();
    const status = document.getElementById('pm-filter-status').value;
    const result = await pmFetch('/projects', { query: { q, status } });
    if (!result.items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-state">لا توجد مشاريع بعد. أنشئ أول مشروع بالضغط على "+ مشروع جديد".</td></tr>`;
      return;
    }
    tbody.innerHTML = result.items.map(p => `
      <tr>
        <td>${p.code}</td>
        <td><a href="#" class="pm-link-btn" onclick="pmOpenProjectDetail('${p.id}');return false;">${p.name}</a></td>
        <td>${pmStatusBadge(p.status)}</td>
        <td>${pmPriorityBadge(p.priority)}</td>
        <td>${p.progress_percent}%</td>
        <td>${pmFormatMoney(p.budget, p.currency)}</td>
        <td>${pmFormatDate(p.end_date)}</td>
        <td>
          <button class="pm-mini-btn" onclick="pmOpenProjectDetail('${p.id}')">فتح</button>
          <button class="pm-mini-btn pm-mini-btn-danger" onclick="pmDeleteProject('${p.id}')">حذف</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="alert alert-error">${e.message}</div></td></tr>`;
  }
}

document.getElementById('pm-search')?.addEventListener('input', pmDebounce(pmLoadProjectsList, 350));
document.getElementById('pm-filter-status')?.addEventListener('change', pmLoadProjectsList);
document.getElementById('pm-btn-new-project')?.addEventListener('click', () => pmOpenProjectForm(null));
document.getElementById('pm-btn-back-to-list')?.addEventListener('click', () => { pmShowListView(); pmLoadProjectsList(); });
document.getElementById('pm-btn-back-from-detail')?.addEventListener('click', () => { pmShowListView(); pmLoadProjectsList(); });

function pmDebounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

async function pmDeleteProject(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المشروع؟ سيتم حذف جميع البيانات المرتبطة به (مهام، ميزانية، مخاطر...الخ) نهائياً.')) return;
  try {
    await pmFetch('/projects/delete', { method: 'POST', body: { id } });
    pmLoadProjectsList();
  } catch (e) { alert(e.message); }
}

// ================================================================
// نموذج إنشاء / تعديل مشروع
// ================================================================

function pmOpenProjectForm(project) {
  pmEditingProjectId = project ? project.id : null;
  document.getElementById('pm-form-alert').innerHTML = '';
  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  set('pm-f-name', project?.name);
  set('pm-f-type', project?.type);
  set('pm-f-description', project?.description);
  set('pm-f-status', project?.status || 'planning');
  set('pm-f-priority', project?.priority || 'normal');
  set('pm-f-owner', project?.owner);
  set('pm-f-main-contractor', project?.main_contractor);
  set('pm-f-sub-contractor', project?.sub_contractor);
  set('pm-f-consultant', project?.consultant);
  set('pm-f-pm', project?.project_manager);
  set('pm-f-engineer', project?.responsible_engineer);
  set('pm-f-client', project?.client);
  set('pm-f-location', project?.location);
  set('pm-f-city', project?.city);
  set('pm-f-country', project?.country);
  set('pm-f-start', project?.start_date ? project.start_date.slice(0, 10) : '');
  set('pm-f-end', project?.end_date ? project.end_date.slice(0, 10) : '');
  set('pm-f-contract-value', project?.contract_value || 0);
  set('pm-f-budget', project?.budget || 0);
  set('pm-f-profit', project?.target_profit_percent || 0);
  set('pm-f-currency', project?.currency || 'SAR');
  pmShowFormView();
}

document.getElementById('pm-btn-save-project')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('pm-form-alert');
  const spinner = document.getElementById('pm-save-spinner');
  const payload = {
    name: document.getElementById('pm-f-name').value.trim(),
    type: document.getElementById('pm-f-type').value.trim(),
    description: document.getElementById('pm-f-description').value.trim(),
    status: document.getElementById('pm-f-status').value,
    priority: document.getElementById('pm-f-priority').value,
    owner: document.getElementById('pm-f-owner').value.trim(),
    main_contractor: document.getElementById('pm-f-main-contractor').value.trim(),
    sub_contractor: document.getElementById('pm-f-sub-contractor').value.trim(),
    consultant: document.getElementById('pm-f-consultant').value.trim(),
    project_manager: document.getElementById('pm-f-pm').value.trim(),
    responsible_engineer: document.getElementById('pm-f-engineer').value.trim(),
    client: document.getElementById('pm-f-client').value.trim(),
    location: document.getElementById('pm-f-location').value.trim(),
    city: document.getElementById('pm-f-city').value.trim(),
    country: document.getElementById('pm-f-country').value.trim(),
    start_date: document.getElementById('pm-f-start').value || null,
    end_date: document.getElementById('pm-f-end').value || null,
    contract_value: Number(document.getElementById('pm-f-contract-value').value) || 0,
    budget: Number(document.getElementById('pm-f-budget').value) || 0,
    target_profit_percent: Number(document.getElementById('pm-f-profit').value) || 0,
    currency: document.getElementById('pm-f-currency').value.trim() || 'SAR',
  };
  if (!payload.name) { pmAlert(alertEl, 'error', 'اسم المشروع مطلوب'); return; }

  spinner.style.display = 'inline-block';
  try {
    let saved;
    if (pmEditingProjectId) {
      saved = await pmFetch('/projects/update', { method: 'POST', body: { id: pmEditingProjectId, ...payload } });
    } else {
      saved = await pmFetch('/projects', { method: 'POST', body: payload });
    }
    pmAlert(alertEl, 'success', 'تم حفظ المشروع بنجاح');
    setTimeout(() => pmOpenProjectDetail(saved.id), 400);
  } catch (e) {
    pmAlert(alertEl, 'error', e.message);
  } finally {
    spinner.style.display = 'none';
  }
});

// ================================================================
// تفاصيل المشروع
// ================================================================

async function pmOpenProjectDetail(id) {
  pmCurrentProjectId = id;
  pmDetailSubtab = 'overview';
  document.querySelectorAll('#pm-detail-subtabs .subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === 'overview'));
  pmShowDetailView();
  await pmRenderProjectHeader();
  await pmRenderDetailSubtab('overview');
}

document.getElementById('pm-btn-edit-project')?.addEventListener('click', async () => {
  if (!pmCurrentProjectId) return;
  const project = await pmFetch('/projects/get', { query: { id: pmCurrentProjectId } });
  pmOpenProjectForm(project);
});

document.querySelectorAll('#pm-detail-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#pm-detail-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pmDetailSubtab = btn.dataset.sub;
    pmRenderDetailSubtab(pmDetailSubtab);
  });
});

async function pmRenderProjectHeader() {
  const headerEl = document.getElementById('pm-detail-header');
  try {
    const p = await pmFetch('/projects/get', { query: { id: pmCurrentProjectId } });
    headerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--blueprint-navy)">${p.name} <span style="font-family:var(--mono);font-size:12px;color:var(--ink-soft)">(${p.code})</span></div>
          <div style="margin-top:6px">${pmStatusBadge(p.status)} ${pmPriorityBadge(p.priority)}</div>
        </div>
        <div class="result-cards" style="margin:0">
          ${pmDashCard('الإنجاز', p.progress_percent, '%')}
          ${pmDashCard('الميزانية', pmFormatMoney(p.financial_summary.budget), '')}
          ${pmDashCard('المصروفات', pmFormatMoney(p.financial_summary.total_expenses), '')}
        </div>
      </div>
    `;
  } catch (e) {
    headerEl.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function pmRenderDetailSubtab(sub) {
  const content = document.getElementById('pm-detail-content');
  content.innerHTML = `<div class="pm-empty-state">جارِ التحميل...</div>`;
  try {
    switch (sub) {
      case 'overview': return pmRenderOverview(content);
      case 'phases': return pmRenderPhases(content);
      case 'tasks': return pmRenderTasks(content);
      case 'schedule': return pmRenderSchedule(content);
      case 'team': return pmRenderTeam(content);
      case 'finance': return pmRenderFinance(content);
      case 'risks': return pmRenderRisks(content);
      case 'quality': return pmRenderQuality(content);
      case 'safety': return pmRenderSafety(content);
      case 'documents': return pmRenderDocuments(content);
      case 'meetings': return pmRenderMeetings(content);
      case 'reports': return pmRenderReports(content);
      case 'ai': return pmRenderAI(content);
      default: content.innerHTML = '';
    }
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

// ----- نظرة عامة -----
async function pmRenderOverview(content) {
  const p = await pmFetch('/projects/get', { query: { id: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-grid-2">
      <div class="pm-card">
        <div class="pm-card-title">بيانات المشروع</div>
        <table class="detail-table">
          <tr><td>الوصف</td><td>${p.description || '-'}</td></tr>
          <tr><td>النوع</td><td>${p.type || '-'}</td></tr>
          <tr><td>المالك</td><td>${p.owner || '-'}</td></tr>
          <tr><td>المقاول الرئيسي</td><td>${p.main_contractor || '-'}</td></tr>
          <tr><td>المكتب الاستشاري</td><td>${p.consultant || '-'}</td></tr>
          <tr><td>مدير المشروع</td><td>${p.project_manager || '-'}</td></tr>
          <tr><td>الموقع</td><td>${p.location || '-'} ${p.city ? '- ' + p.city : ''}</td></tr>
        </table>
      </div>
      <div class="pm-card">
        <div class="pm-card-title">الجدول الزمني والمالية</div>
        <table class="detail-table">
          <tr><td>تاريخ البداية</td><td>${pmFormatDate(p.start_date)}</td></tr>
          <tr><td>تاريخ النهاية</td><td>${pmFormatDate(p.end_date)}</td></tr>
          <tr><td>المدة (يوم)</td><td>${p.duration_days ?? '-'}</td></tr>
          <tr><td>قيمة العقد</td><td>${pmFormatMoney(p.contract_value, p.currency)}</td></tr>
          <tr><td>الميزانية</td><td>${pmFormatMoney(p.budget, p.currency)}</td></tr>
          <tr><td>المصروفات</td><td>${pmFormatMoney(p.financial_summary.total_expenses, p.currency)}</td></tr>
          <tr><td>المتبقي</td><td>${pmFormatMoney(p.financial_summary.remaining_budget, p.currency)}</td></tr>
        </table>
      </div>
    </div>
  `;
}

// ----- المراحل -----
async function pmRenderPhases(content) {
  const phases = await pmFetch('/phases', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">مراحل المشروع (PMBOK Lifecycle)</div>
      <div id="pm-phases-list"></div>
    </div>
  `;
  const list = document.getElementById('pm-phases-list');
  list.innerHTML = phases.map(ph => `
    <div class="pm-gantt-row" style="grid-template-columns:160px 1fr 90px 90px">
      <span class="pm-gantt-label">${ph.name}</span>
      <div class="pm-gantt-track"><div class="pm-gantt-fill" style="width:${ph.progress_percent}%"></div></div>
      <input type="number" min="0" max="100" value="${ph.progress_percent}" style="width:70px;padding:6px;font-family:var(--mono)" id="pm-phase-input-${ph.id}">
      <button class="pm-mini-btn" onclick="pmUpdatePhaseProgress('${ph.id}')">تحديث</button>
    </div>
  `).join('');
}

async function pmUpdatePhaseProgress(phaseId) {
  const val = Number(document.getElementById(`pm-phase-input-${phaseId}`).value) || 0;
  try {
    await pmFetch('/phases/update', { method: 'POST', body: { id: phaseId, progress_percent: Math.max(0, Math.min(100, val)), status: val >= 100 ? 'completed' : (val > 0 ? 'in_progress' : 'not_started') } });
    pmRenderPhases(document.getElementById('pm-detail-content'));
    pmRenderProjectHeader();
  } catch (e) { alert(e.message); }
}

// ----- المهام -----
async function pmRenderTasks(content) {
  const tasks = await pmFetch('/tasks', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>عنوان المهمة</label><input type="text" id="pm-task-title"></div>
      <div class="field"><label>المسؤول</label><input type="text" id="pm-task-assignee"></div>
      <div class="field"><label>تاريخ البداية</label><input type="date" id="pm-task-start"></div>
      <div class="field"><label>تاريخ النهاية</label><input type="date" id="pm-task-end"></div>
      <button class="btn btn-primary" id="pm-btn-add-task">+ إضافة مهمة</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>العنوان</th><th>المسؤول</th><th>البداية</th><th>النهاية</th><th>الحالة</th><th>الإنجاز</th><th></th></tr></thead>
        <tbody id="pm-tasks-tbody"></tbody>
      </table>
    </div>
  `;
  const tbody = document.getElementById('pm-tasks-tbody');
  tbody.innerHTML = tasks.length ? tasks.map(t => `
    <tr>
      <td>${t.title}</td>
      <td>${t.assignee || '-'}</td>
      <td>${pmFormatDate(t.start_date)}</td>
      <td>${pmFormatDate(t.end_date)}</td>
      <td>
        <select onchange="pmUpdateTaskStatus('${t.id}', this.value)">
          ${Object.entries(PM_TASK_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </td>
      <td>${t.progress_percent}%</td>
      <td><button class="pm-mini-btn pm-mini-btn-danger" onclick="pmDeleteTask('${t.id}')">حذف</button></td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="pm-empty-state">لا توجد مهام بعد</td></tr>`;

  document.getElementById('pm-btn-add-task').addEventListener('click', async () => {
    const title = document.getElementById('pm-task-title').value.trim();
    if (!title) { alert('عنوان المهمة مطلوب'); return; }
    try {
      await pmFetch('/tasks', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId,
          title,
          assignee: document.getElementById('pm-task-assignee').value.trim(),
          start_date: document.getElementById('pm-task-start').value || null,
          end_date: document.getElementById('pm-task-end').value || null,
        },
      });
      pmRenderTasks(content);
    } catch (e) { alert(e.message); }
  });
}

async function pmUpdateTaskStatus(taskId, status) {
  const progress_percent = status === 'completed' ? 100 : undefined;
  try {
    await pmFetch('/tasks/update', { method: 'POST', body: { id: taskId, status, ...(progress_percent !== undefined ? { progress_percent } : {}) } });
    pmRenderTasks(document.getElementById('pm-detail-content'));
  } catch (e) { alert(e.message); }
}
async function pmDeleteTask(taskId) {
  if (!confirm('حذف هذه المهمة؟')) return;
  try {
    await pmFetch('/tasks/delete', { method: 'POST', body: { id: taskId } });
    pmRenderTasks(document.getElementById('pm-detail-content'));
  } catch (e) { alert(e.message); }
}

// ----- الجدول الزمني (Gantt + المسار الحرج) -----
async function pmRenderSchedule(content) {
  const cp = await pmFetch('/schedule/critical-path', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">الجدول الزمني والمسار الحرج (Critical Path Method)</div>
      <div style="margin-bottom:10px;font-family:var(--mono);font-size:13px;color:var(--ink-soft)">
        مدة المشروع الإجمالية المحسوبة: <strong style="color:var(--blueprint-navy)">${cp.project_duration_days} يوم</strong>
        — المهام الحرجة (بدون هامش تأخير) موضحة بلون أحمر
      </div>
      <div id="pm-gantt"></div>
    </div>
  `;
  const gantt = document.getElementById('pm-gantt');
  const maxEf = Math.max(1, ...cp.tasks.map(t => t.ef));
  gantt.innerHTML = cp.tasks.length ? cp.tasks.map(t => {
    const leftPct = (t.es / maxEf) * 100;
    const widthPct = Math.max(1, ((t.ef - t.es) / maxEf) * 100);
    return `
      <div class="pm-gantt-row">
        <span class="pm-gantt-label" title="${t.title}">${t.title} ${t.is_critical ? '⚠' : ''}</span>
        <div class="pm-gantt-track">
          <div class="pm-gantt-fill ${t.is_critical ? 'critical' : ''}" style="right:${leftPct}%;width:${widthPct}%"></div>
        </div>
      </div>
    `;
  }).join('') : `<div class="pm-empty-state">لا توجد مهام لعرض الجدول الزمني</div>`;
}

// ----- الفريق -----
async function pmRenderTeam(content) {
  const team = await pmFetch('/team', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>الاسم</label><input type="text" id="pm-team-name"></div>
      <div class="field"><label>الدور</label><input type="text" id="pm-team-role" placeholder="مهندس / مشرف / عامل..."></div>
      <div class="field"><label>البريد الإلكتروني</label><input type="text" id="pm-team-email"></div>
      <div class="field"><label>الهاتف</label><input type="text" id="pm-team-phone"></div>
      <button class="btn btn-primary" id="pm-btn-add-team">+ إضافة عضو</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>الاسم</th><th>الدور</th><th>البريد</th><th>الهاتف</th><th>ساعات العمل</th><th></th></tr></thead>
        <tbody id="pm-team-tbody"></tbody>
      </table>
    </div>
  `;
  document.getElementById('pm-team-tbody').innerHTML = team.length ? team.map(m => `
    <tr>
      <td>${m.name}</td><td>${m.role || '-'}</td><td>${m.email || '-'}</td><td>${m.phone || '-'}</td>
      <td>${m.hours_worked}</td>
      <td><button class="pm-mini-btn pm-mini-btn-danger" onclick="pmRemoveTeamMember('${m.id}')">إزالة</button></td>
    </tr>
  `).join('') : `<tr><td colspan="6" class="pm-empty-state">لا يوجد أعضاء بعد</td></tr>`;

  document.getElementById('pm-btn-add-team').addEventListener('click', async () => {
    const name = document.getElementById('pm-team-name').value.trim();
    if (!name) { alert('اسم العضو مطلوب'); return; }
    try {
      await pmFetch('/team', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId, name,
          role: document.getElementById('pm-team-role').value.trim(),
          email: document.getElementById('pm-team-email').value.trim(),
          phone: document.getElementById('pm-team-phone').value.trim(),
        },
      });
      pmRenderTeam(content);
    } catch (e) { alert(e.message); }
  });
}
async function pmRemoveTeamMember(id) {
  if (!confirm('إزالة هذا العضو من الفريق؟')) return;
  try { await pmFetch('/team/delete', { method: 'POST', body: { id } }); pmRenderTeam(document.getElementById('pm-detail-content')); } catch (e) { alert(e.message); }
}

// ----- الميزانية -----
async function pmRenderFinance(content) {
  const [summary, txns] = await Promise.all([
    pmFetch('/finance/summary', { query: { projectId: pmCurrentProjectId } }),
    pmFetch('/finance/transactions', { query: { projectId: pmCurrentProjectId } }),
  ]);
  content.innerHTML = `
    <div class="result-cards">
      ${pmDashCard('الميزانية', pmFormatMoney(summary.budget), '')}
      ${pmDashCard('المصروفات', pmFormatMoney(summary.total_expenses), '')}
      ${pmDashCard('الإيرادات', pmFormatMoney(summary.total_revenue), '')}
      ${pmDashCard('المتبقي', pmFormatMoney(summary.remaining_budget), '')}
      ${pmDashCard('نسبة الاستهلاك', summary.budget_utilization_percent, '%')}
    </div>
    ${summary.over_budget ? `<div class="alert alert-danger">⚠ تم تجاوز الميزانية المعتمدة لهذا المشروع</div>` : ''}
    <div class="pm-inline-form" style="margin-top:16px">
      <div class="field"><label>النوع</label>
        <select id="pm-txn-type">
          <option value="expense">مصروف</option>
          <option value="revenue">إيراد</option>
          <option value="payment">دفعة</option>
          <option value="invoice">فاتورة</option>
        </select>
      </div>
      <div class="field"><label>الفئة</label><input type="text" id="pm-txn-category"></div>
      <div class="field"><label>الوصف</label><input type="text" id="pm-txn-desc"></div>
      <div class="field"><label>المبلغ</label><input type="number" id="pm-txn-amount" value="0"></div>
      <button class="btn btn-primary" id="pm-btn-add-txn">+ إضافة معاملة</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th></th></tr></thead>
        <tbody id="pm-txn-tbody"></tbody>
      </table>
    </div>
  `;
  const txnLabels = { expense: 'مصروف', revenue: 'إيراد', payment: 'دفعة', invoice: 'فاتورة', purchase_order: 'أمر شراء', contract_value: 'قيمة عقد' };
  document.getElementById('pm-txn-tbody').innerHTML = txns.length ? txns.map(t => `
    <tr>
      <td>${pmFormatDate(t.date)}</td><td>${txnLabels[t.type] || t.type}</td><td>${t.category || '-'}</td>
      <td>${t.description || '-'}</td><td>${pmFormatMoney(t.amount)}</td>
      <td><button class="pm-mini-btn pm-mini-btn-danger" onclick="pmDeleteTxn('${t.id}')">حذف</button></td>
    </tr>
  `).join('') : `<tr><td colspan="6" class="pm-empty-state">لا توجد معاملات مالية بعد</td></tr>`;

  document.getElementById('pm-btn-add-txn').addEventListener('click', async () => {
    try {
      await pmFetch('/finance/transactions', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId,
          type: document.getElementById('pm-txn-type').value,
          category: document.getElementById('pm-txn-category').value.trim(),
          description: document.getElementById('pm-txn-desc').value.trim(),
          amount: Number(document.getElementById('pm-txn-amount').value) || 0,
        },
      });
      pmRenderFinance(content);
      pmRenderProjectHeader();
    } catch (e) { alert(e.message); }
  });
}
async function pmDeleteTxn(id) {
  if (!confirm('حذف هذه المعاملة؟')) return;
  try {
    await pmFetch('/finance/transactions/delete', { method: 'POST', body: { id } });
    pmRenderFinance(document.getElementById('pm-detail-content'));
    pmRenderProjectHeader();
  } catch (e) { alert(e.message); }
}

// ----- المخاطر -----
async function pmRenderRisks(content) {
  const risks = await pmFetch('/risks', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>وصف الخطر</label><input type="text" id="pm-risk-desc"></div>
      <div class="field"><label>الاحتمالية (1-5)</label><input type="number" id="pm-risk-prob" min="1" max="5" value="3"></div>
      <div class="field"><label>التأثير (1-5)</label><input type="number" id="pm-risk-impact" min="1" max="5" value="3"></div>
      <div class="field"><label>المسؤول</label><input type="text" id="pm-risk-resp"></div>
      <button class="btn btn-primary" id="pm-btn-add-risk">+ تسجيل خطر</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>الوصف</th><th>المستوى</th><th>الدرجة</th><th>المسؤول</th><th>الحالة</th></tr></thead>
        <tbody id="pm-risks-tbody"></tbody>
      </table>
    </div>
  `;
  document.getElementById('pm-risks-tbody').innerHTML = risks.length
    ? risks.sort((a, b) => b.score - a.score).map(r => `
      <tr>
        <td>${r.description}</td><td>${pmRiskBadge(r.level)}</td><td>${r.score}</td>
        <td>${r.responsible || '-'}</td><td>${r.status}</td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="pm-empty-state">لا توجد مخاطر مسجلة بعد</td></tr>`;

  document.getElementById('pm-btn-add-risk').addEventListener('click', async () => {
    const description = document.getElementById('pm-risk-desc').value.trim();
    if (!description) { alert('وصف الخطر مطلوب'); return; }
    try {
      await pmFetch('/risks', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId, description,
          probability: Number(document.getElementById('pm-risk-prob').value) || 1,
          impact: Number(document.getElementById('pm-risk-impact').value) || 1,
          responsible: document.getElementById('pm-risk-resp').value.trim(),
        },
      });
      pmRenderRisks(content);
    } catch (e) { alert(e.message); }
  });
}

// ----- الجودة -----
async function pmRenderQuality(content) {
  const records = await pmFetch('/quality', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>نوع الفحص</label>
        <select id="pm-qc-type">
          <option value="concrete">خرسانة</option><option value="soil">تربة</option>
          <option value="rebar">حديد</option><option value="welding">لحام</option>
          <option value="waterproofing">عزل</option>
        </select>
      </div>
      <div class="field"><label>النتيجة</label>
        <select id="pm-qc-result"><option value="pending">قيد الانتظار</option><option value="pass">ناجح</option><option value="fail">فشل</option></select>
      </div>
      <div class="field"><label>المفتش</label><input type="text" id="pm-qc-inspector"></div>
      <button class="btn btn-primary" id="pm-btn-add-qc">+ تسجيل فحص</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>التاريخ</th><th>نوع الفحص</th><th>النتيجة</th><th>المفتش</th></tr></thead>
        <tbody id="pm-qc-tbody"></tbody>
      </table>
    </div>
  `;
  const resultTag = r => r === 'pass' ? '<span class="tag tag-ok">ناجح</span>' : r === 'fail' ? '<span class="tag tag-bad">فشل</span>' : '<span class="tag tag-info">قيد الانتظار</span>';
  document.getElementById('pm-qc-tbody').innerHTML = records.length ? records.map(r => `
    <tr><td>${pmFormatDate(r.date)}</td><td>${r.check_type}</td><td>${resultTag(r.result)}</td><td>${r.inspector || '-'}</td></tr>
  `).join('') : `<tr><td colspan="4" class="pm-empty-state">لا توجد سجلات جودة بعد</td></tr>`;

  document.getElementById('pm-btn-add-qc').addEventListener('click', async () => {
    try {
      await pmFetch('/quality', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId,
          check_type: document.getElementById('pm-qc-type').value,
          result: document.getElementById('pm-qc-result').value,
          inspector: document.getElementById('pm-qc-inspector').value.trim(),
        },
      });
      pmRenderQuality(content);
    } catch (e) { alert(e.message); }
  });
}

// ----- السلامة -----
async function pmRenderSafety(content) {
  const records = await pmFetch('/safety', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>نوع السجل</label>
        <select id="pm-saf-type">
          <option value="inspection">تفتيش</option><option value="incident">حادث</option>
          <option value="injury">إصابة</option><option value="ppe">معدات وقاية</option>
          <option value="permit">تصريح عمل</option><option value="violation">مخالفة</option>
        </select>
      </div>
      <div class="field"><label>الوصف</label><input type="text" id="pm-saf-desc"></div>
      <button class="btn btn-primary" id="pm-btn-add-saf">+ تسجيل</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>الحالة</th></tr></thead>
        <tbody id="pm-saf-tbody"></tbody>
      </table>
    </div>
  `;
  const typeLabels = { inspection: 'تفتيش', incident: 'حادث', injury: 'إصابة', ppe: 'معدات وقاية', permit: 'تصريح عمل', violation: 'مخالفة' };
  document.getElementById('pm-saf-tbody').innerHTML = records.length ? records.map(r => `
    <tr><td>${pmFormatDate(r.date)}</td><td>${typeLabels[r.record_type] || r.record_type}</td><td>${r.description || '-'}</td><td>${r.status}</td></tr>
  `).join('') : `<tr><td colspan="4" class="pm-empty-state">لا توجد سجلات سلامة بعد</td></tr>`;

  document.getElementById('pm-btn-add-saf').addEventListener('click', async () => {
    try {
      await pmFetch('/safety', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId,
          record_type: document.getElementById('pm-saf-type').value,
          description: document.getElementById('pm-saf-desc').value.trim(),
        },
      });
      pmRenderSafety(content);
    } catch (e) { alert(e.message); }
  });
}

// ----- المستندات -----
async function pmRenderDocuments(content) {
  const docs = await pmFetch('/documents', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>اسم المستند</label><input type="text" id="pm-doc-name"></div>
      <div class="field"><label>النوع</label>
        <select id="pm-doc-type">
          <option value="contract">عقد</option><option value="drawing">مخطط</option>
          <option value="report">تقرير</option><option value="photo">صورة</option>
          <option value="pdf">PDF</option><option value="dwg">DWG</option>
          <option value="excel">Excel</option><option value="word">Word</option><option value="other">أخرى</option>
        </select>
      </div>
      <div class="field"><label>الرابط (اختياري)</label><input type="text" id="pm-doc-url"></div>
      <button class="btn btn-primary" id="pm-btn-add-doc">+ إضافة مستند</button>
    </div>
    <div class="pm-table-wrap">
      <table class="detail-table">
        <thead><tr><th>الاسم</th><th>النوع</th><th>الإصدار</th><th>تاريخ الإضافة</th></tr></thead>
        <tbody id="pm-doc-tbody"></tbody>
      </table>
    </div>
  `;
  document.getElementById('pm-doc-tbody').innerHTML = docs.length ? docs.map(d => `
    <tr>
      <td>${d.url ? `<a href="${d.url}" target="_blank">${d.name}</a>` : d.name}</td>
      <td>${d.doc_type}</td><td>v${d.version}</td><td>${pmFormatDate(d.created_at)}</td>
    </tr>
  `).join('') : `<tr><td colspan="4" class="pm-empty-state">لا توجد مستندات بعد</td></tr>`;

  document.getElementById('pm-btn-add-doc').addEventListener('click', async () => {
    const name = document.getElementById('pm-doc-name').value.trim();
    if (!name) { alert('اسم المستند مطلوب'); return; }
    try {
      await pmFetch('/documents', {
        method: 'POST',
        body: {
          project_id: pmCurrentProjectId, name,
          doc_type: document.getElementById('pm-doc-type').value,
          url: document.getElementById('pm-doc-url').value.trim() || null,
        },
      });
      pmRenderDocuments(content);
    } catch (e) { alert(e.message); }
  });
}

// ----- الاجتماعات -----
async function pmRenderMeetings(content) {
  const meetings = await pmFetch('/meetings', { query: { projectId: pmCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-inline-form">
      <div class="field"><label>عنوان الاجتماع</label><input type="text" id="pm-mtg-title"></div>
      <div class="field"><label>المحضر (اختياري)</label><input type="text" id="pm-mtg-minutes"></div>
      <button class="btn btn-primary" id="pm-btn-add-mtg">+ إضافة اجتماع</button>
    </div>
    <div id="pm-mtg-list"></div>
  `;
  const list = document.getElementById('pm-mtg-list');
  list.innerHTML = meetings.length ? meetings.map(m => `
    <div class="pm-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between">
        <strong>${m.title}</strong>
        <span style="font-family:var(--mono);font-size:12px;color:var(--ink-soft)">${pmFormatDate(m.date)}</span>
      </div>
      ${m.minutes ? `<div style="margin-top:8px;font-size:13.5px">${m.minutes}</div>` : ''}
    </div>
  `).join('') : `<div class="pm-empty-state">لا توجد اجتماعات مسجلة بعد</div>`;

  document.getElementById('pm-btn-add-mtg').addEventListener('click', async () => {
    const title = document.getElementById('pm-mtg-title').value.trim();
    if (!title) { alert('عنوان الاجتماع مطلوب'); return; }
    try {
      await pmFetch('/meetings', {
        method: 'POST',
        body: { project_id: pmCurrentProjectId, title, minutes: document.getElementById('pm-mtg-minutes').value.trim() },
      });
      pmRenderMeetings(content);
    } catch (e) { alert(e.message); }
  });
}

// ----- التقارير -----
async function pmRenderReports(content) {
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">تصدير التقارير</div>
      <div class="pm-inline-form">
        <div class="field"><label>نوع التقرير</label>
          <select id="pm-report-type">
            <option value="executive">تقرير تنفيذي شامل</option>
            <option value="daily">تقرير يومي</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="pmExportReport('pdf')">تصدير PDF</button>
        <button class="btn btn-outline" onclick="pmExportReport('excel')">تصدير Excel</button>
        <button class="btn btn-outline" onclick="pmExportReport('csv')">تصدير CSV</button>
      </div>
      <div id="pm-report-result"></div>
    </div>
  `;
}
async function pmExportReport(format) {
  const resultEl = document.getElementById('pm-report-result');
  const reportType = document.getElementById('pm-report-type').value;
  resultEl.innerHTML = `<div class="pm-empty-state">جارِ إنشاء التقرير...</div>`;
  try {
    const result = await pmFetch(`/reports/export/${format}`, {
      method: 'POST',
      body: { projectId: pmCurrentProjectId, reportType },
    });
    resultEl.innerHTML = `<div class="alert alert-success">تم إنشاء التقرير — <a href="${result.url}" target="_blank">تحميل الملف</a></div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

// ----- المساعد الذكي -----
async function pmRenderAI(content) {
  content.innerHTML = `<div class="pm-empty-state">جارِ تحليل المشروع...</div>`;
  try {
    const analysis = await pmFetch('/ai/analyze-project', { query: { projectId: pmCurrentProjectId } });
    content.innerHTML = `
      <div class="pm-ai-box">
        <div class="pm-card-title">تحليل المساعد الذكي</div>
        <div style="margin-bottom:14px;font-size:13px">
          نسبة الإنجاز: <strong>${analysis.progress_percent}%</strong> —
          الإنتاجية: <strong>${analysis.productivity_percent}%</strong> —
          توقع المخاطر: <strong>${analysis.risk_forecast}</strong>
        </div>
        ${analysis.insights.map(i => `<div class="pm-ai-insight">💡 ${i}</div>`).join('')}
      </div>
      <div class="pm-card" style="margin-top:16px">
        <div class="pm-card-title">اسأل عن المشروع</div>
        <div class="pm-inline-form">
          <div class="field" style="flex:1"><label>سؤالك</label><input type="text" id="pm-ai-question" placeholder="مثال: كم متبقي من الميزانية؟"></div>
          <button class="btn btn-primary" id="pm-btn-ask-ai">اسأل</button>
        </div>
        <div id="pm-ai-answer"></div>
      </div>
    `;
    document.getElementById('pm-btn-ask-ai').addEventListener('click', async () => {
      const question = document.getElementById('pm-ai-question').value.trim();
      if (!question) return;
      const answerEl = document.getElementById('pm-ai-answer');
      answerEl.innerHTML = `<div class="pm-empty-state">جارِ التفكير...</div>`;
      try {
        const res = await pmFetch('/ai/ask', { method: 'POST', body: { projectId: pmCurrentProjectId, question } });
        answerEl.innerHTML = `<div class="alert alert-success">${res.answer}</div>`;
      } catch (e) {
        answerEl.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
      }
    });
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

// ---------- تحميل مبدئي عند فتح التطبيق إذا كانت لوحة المشاريع نشطة افتراضياً ----------
if (document.getElementById('panel-pm-dashboard')?.classList.contains('active')) {
  pmLoadDashboard();
}
