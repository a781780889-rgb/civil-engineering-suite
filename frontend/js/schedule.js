// ============================================================
// Civil Engineering Suite — Frontend Logic (Section 5: Scheduling System)
// ============================================================

const SCH_API = '/api/schedule';
let schCurrentProjectId = null;
let schCurrentScheduleId = null;
let schCurrentSubtab = 'wbs';
let schEditingActivityId = null;
let schWbsExpanded = new Set();

const SCH_STATUS_LABELS = {
  not_started: 'لم يبدأ', in_progress: 'جاري التنفيذ', completed: 'مكتمل',
  delayed: 'متأخر', on_hold: 'معلّق', cancelled: 'ملغى',
};
const SCH_STATUS_TAG = {
  not_started: 'tag-info', in_progress: 'tag-info', completed: 'tag-ok',
  delayed: 'tag-bad', on_hold: 'tag-bad', cancelled: 'tag-bad',
};
const SCH_WBS_LEVEL_LABELS = {
  project: 'مشروع', phase: 'مرحلة', section: 'قسم', main_activity: 'نشاط رئيسي',
  sub_activity: 'نشاط فرعي', task: 'مهمة', subtask: 'مهمة فرعية',
};

// ---------- أدوات عامة ----------
function schEl(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

async function schFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${SCH_API}${path}`;
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

function schAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function schFmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function schShowModal(id) { document.getElementById(id)?.classList.add('active'); }
function schHideModal(id) { document.getElementById(id)?.classList.remove('active'); }

// ================================================================
// لوحة معلومات الجدول الزمني
// ================================================================

document.querySelector('[data-panel="schedule-dashboard"]')?.addEventListener('click', () => {
  schLoadDashboard();
});
document.querySelector('[data-panel="schedule-main"]')?.addEventListener('click', () => {
  schShowSelectorView();
  schLoadProjectsIntoSelect();
});

async function schLoadDashboard() {
  const cardsEl = document.getElementById('sch-dash-cards');
  const statusChartEl = document.getElementById('sch-chart-status');
  const progressChartEl = document.getElementById('sch-chart-progress');
  const logEl = document.getElementById('sch-activity-log');
  cardsEl.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const d = await schFetch('/dashboard');
    cardsEl.innerHTML = `
      ${schStatCard('عدد المشاريع', d.projects_count)}
      ${schStatCard('عدد الجداول الزمنية', d.schedules_count)}
      ${schStatCard('إجمالي الأنشطة', d.total_activities)}
      ${schStatCard('الأنشطة المنجزة', d.completed_activities)}
      ${schStatCard('الأنشطة الجارية', d.in_progress_activities)}
      ${schStatCard('الأنشطة المتأخرة', d.delayed_activities)}
      ${schStatCard('الأنشطة الحرجة', d.critical_activities)}
      ${schStatCard('نسبة الإنجاز الكلية', d.overall_progress_percent + '%')}
      ${schStatCard('الأيام المتبقية', d.remaining_days)}
      ${schStatCard('الأيام المتأخرة', d.delayed_days)}
    `;
    statusChartEl.innerHTML = d.status_distribution.map(s => schBarRow(SCH_STATUS_LABELS[s.status] || s.status, s.count, Math.max(...d.status_distribution.map(x => x.count), 1))).join('') || '<div class="pm-empty-state">لا توجد بيانات</div>';
    progressChartEl.innerHTML = d.progress_chart.map(p => schBarRow(p.name, p.progress + '%', 100, p.progress)).join('') || '<div class="pm-empty-state">لا توجد جداول زمنية بعد</div>';
    logEl.innerHTML = d.recent_updates.length
      ? d.recent_updates.map(u => `<div class="sch-notif-item"><span class="sch-notif-sev info"></span><div><b>${schAuditActionLabel(u.action)}</b> — ${u.entity} <span style="color:#8a7a5c">(${new Date(u.ts).toLocaleString('ar')})</span></div></div>`).join('')
      : '<div class="pm-empty-state">لا توجد تحديثات بعد</div>';
  } catch (e) {
    cardsEl.innerHTML = '';
    schAlert(cardsEl, 'error', e.message);
  }
}

function schStatCard(label, value) {
  return `<div class="result-card"><div class="result-card-label">${label}</div><div class="result-card-value">${value}</div></div>`;
}
function schBarRow(label, displayVal, max, rawVal = null) {
  const val = rawVal != null ? rawVal : parseFloat(displayVal) || 0;
  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
  return `<div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px"><span>${label}</span><span>${displayVal}</span></div>
    <div class="sch-hist-bar-track"><div class="sch-hist-bar-fill" style="width:${pct}%"></div></div></div>`;
}
function schAuditActionLabel(action) {
  const map = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', recalculate: 'إعادة احتساب', reschedule: 'إعادة جدولة' };
  return map[action] || action;
}

// ================================================================
// اختيار المشروع / الجدول الزمني
// ================================================================

function schShowSelectorView() {
  document.getElementById('sch-selector-view').style.display = '';
  document.getElementById('sch-workspace-view').style.display = 'none';
}
function schShowWorkspaceView() {
  document.getElementById('sch-selector-view').style.display = 'none';
  document.getElementById('sch-workspace-view').style.display = '';
}

async function schLoadProjectsIntoSelect() {
  const sel = document.getElementById('sch-select-project');
  try {
    const result = await pmFetch('/projects', { query: {} });
    const list = Array.isArray(result) ? result : (result.projects || result.items || []);
    sel.innerHTML = '<option value="">اختر المشروع...</option>' + list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">تعذر تحميل المشاريع</option>';
  }
}

document.getElementById('sch-select-project')?.addEventListener('change', async (e) => {
  schCurrentProjectId = e.target.value || null;
  const schSel = document.getElementById('sch-select-schedule');
  const openBtn = document.getElementById('sch-btn-open-schedule');
  const tbody = document.getElementById('sch-list-tbody');
  if (!schCurrentProjectId) {
    schSel.disabled = true; schSel.innerHTML = '<option value="">اختر الجدول الزمني...</option>';
    openBtn.disabled = true;
    tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-state">اختر مشروعاً لعرض جداوله الزمنية</td></tr>';
    return;
  }
  await schRefreshScheduleList();
});

async function schRefreshScheduleList() {
  const schSel = document.getElementById('sch-select-schedule');
  const tbody = document.getElementById('sch-list-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-state">جارٍ التحميل...</td></tr>';
  try {
    const list = await schFetch('/schedules', { query: { projectId: schCurrentProjectId } });
    schSel.disabled = list.length === 0;
    schSel.innerHTML = '<option value="">اختر الجدول الزمني...</option>' + list.map(s => `<option value="${s.id}">${s.name} (${s.code})</option>`).join('');
    tbody.innerHTML = list.length ? list.map(s => `
      <tr>
        <td>${s.code}</td><td>${s.name}</td><td>${schFmtDate(s.start_date)}</td><td>v${s.version}</td>
        <td><span class="tag ${s.status === 'active' ? 'tag-ok' : 'tag-info'}">${s.status === 'active' ? 'نشط' : s.status}</span></td>
        <td><button class="btn btn-outline btn-sm" data-open-sch="${s.id}">فتح</button>
            <button class="btn btn-outline btn-sm" data-del-sch="${s.id}" style="color:#7d2a22">حذف</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="pm-empty-state">لا توجد جداول زمنية لهذا المشروع بعد. أنشئ جدولاً جديداً.</td></tr>';

    tbody.querySelectorAll('[data-open-sch]').forEach(btn => btn.addEventListener('click', () => schOpenSchedule(btn.dataset.openSch)));
    tbody.querySelectorAll('[data-del-sch]').forEach(btn => btn.addEventListener('click', () => schDeleteSchedule(btn.dataset.delSch)));
  } catch (e) {
    tbody.innerHTML = '';
    schAlert(tbody.parentElement, 'error', e.message);
  }
}

document.getElementById('sch-select-schedule')?.addEventListener('change', (e) => {
  document.getElementById('sch-btn-open-schedule').disabled = !e.target.value;
});
document.getElementById('sch-btn-open-schedule')?.addEventListener('click', () => {
  const id = document.getElementById('sch-select-schedule').value;
  if (id) schOpenSchedule(id);
});

document.getElementById('sch-btn-new-schedule')?.addEventListener('click', () => {
  const form = document.getElementById('sch-new-form');
  form.style.display = form.style.display === 'none' ? '' : 'none';
});
document.getElementById('sch-btn-cancel-new-schedule')?.addEventListener('click', () => {
  document.getElementById('sch-new-form').style.display = 'none';
});
document.getElementById('sch-btn-save-schedule')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('sch-new-form-alert');
  if (!schCurrentProjectId) { schAlert(alertBox, 'error', 'يجب اختيار مشروع أولاً'); return; }
  const name = document.getElementById('sch-f-name').value.trim();
  const start = document.getElementById('sch-f-start').value;
  if (!name || !start) { schAlert(alertBox, 'error', 'اسم الجدول وتاريخ البداية مطلوبان'); return; }
  try {
    const payload = {
      project_id: schCurrentProjectId, name, start_date: start,
      daily_work_hours: Number(document.getElementById('sch-f-hours').value) || 8,
      weekly_work_days: Number(document.getElementById('sch-f-days').value) || 6,
    };
    const saved = await schFetch('/schedules', { method: 'POST', body: payload });
    document.getElementById('sch-new-form').style.display = 'none';
    document.getElementById('sch-f-name').value = '';
    await schRefreshScheduleList();
    schOpenSchedule(saved.id);
  } catch (e) {
    schAlert(alertBox, 'error', e.message);
  }
});

async function schDeleteSchedule(id) {
  if (!confirm('هل أنت متأكد من حذف هذا الجدول الزمني وجميع أنشطته وعلاقاته؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  try {
    await schFetch('/schedules/delete', { method: 'POST', body: { id } });
    await schRefreshScheduleList();
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// مساحة عمل الجدول الزمني
// ================================================================

async function schOpenSchedule(scheduleId) {
  schCurrentScheduleId = scheduleId;
  schShowWorkspaceView();
  await schRenderWorkspaceHeader();
  schCurrentSubtab = 'wbs';
  document.querySelectorAll('#sch-workspace-subtabs .subtab').forEach(b => b.classList.remove('active'));
  document.querySelector('#sch-workspace-subtabs [data-sub="wbs"]')?.classList.add('active');
  await schRenderSubtab('wbs');
}

document.getElementById('sch-btn-back-to-selector')?.addEventListener('click', () => {
  schShowSelectorView();
  if (schCurrentProjectId) schRefreshScheduleList();
});

document.getElementById('sch-workspace-subtabs')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.subtab');
  if (!btn) return;
  document.querySelectorAll('#sch-workspace-subtabs .subtab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  schCurrentSubtab = btn.dataset.sub;
  await schRenderSubtab(schCurrentSubtab);
});

async function schRenderWorkspaceHeader() {
  const header = document.getElementById('sch-workspace-header');
  header.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    const [schedule, cpm, comparison] = await Promise.all([
      schFetch('/schedules/get', { query: { id: schCurrentScheduleId } }),
      schFetch('/cpm', { query: { scheduleId: schCurrentScheduleId } }),
      schFetch('/comparison', { query: { scheduleId: schCurrentScheduleId } }),
    ]);
    header.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center">
        <div>
          <div class="pm-card-title" style="margin-bottom:4px">${schedule.name} <span style="color:#8a7a5c;font-weight:400">(${schedule.code} — الإصدار v${schedule.version})</span></div>
          <div style="font-size:12.5px;color:#6b5f45">بداية: ${schFmtDate(schedule.start_date)} · مدة محسوبة: ${cpm.project_duration_days} يوم · انتهاء مخطط: ${schFmtDate(cpm.project_finish_date)} · انتهاء متوقع: ${schFmtDate(comparison.forecast_finish_date)}</div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${schMiniStat('نسبة الإنجاز', comparison.overall_progress_percent + '%')}
          ${schMiniStat('أنشطة حرجة', cpm.critical_path.length)}
          ${schMiniStat('متأخرة', comparison.delayed_activities_count)}
          ${schMiniStat('تأخير متوقع', comparison.forecast_delay_days + ' يوم')}
        </div>
      </div>`;
  } catch (e) {
    schAlert(header, 'error', e.message);
  }
}
function schMiniStat(label, val) {
  return `<div style="text-align:center"><div style="font-size:11px;color:#8a7a5c">${label}</div><div style="font-size:18px;font-weight:700;color:var(--blueprint-navy)">${val}</div></div>`;
}

async function schRenderSubtab(name) {
  const content = document.getElementById('sch-workspace-content');
  content.innerHTML = '<div class="pm-empty-state">جارٍ التحميل...</div>';
  try {
    if (name === 'wbs') return await schRenderWbsTab(content);
    if (name === 'relations') return await schRenderRelationsTab(content);
    if (name === 'gantt') return await schRenderGanttTab(content);
    if (name === 'tracking') return await schRenderTrackingTab(content);
    if (name === 'resources') return await schRenderResourcesTab(content);
    if (name === 'scurve') return await schRenderSCurveTab(content);
    if (name === 'baselines') return await schRenderBaselinesTab(content);
    if (name === 'notifications') return await schRenderNotificationsTab(content);
    if (name === 'reports') return await schRenderReportsTab(content);
    if (name === 'ai') return await schRenderAiTab(content);
  } catch (e) {
    content.innerHTML = '';
    schAlert(content, 'error', e.message);
  }
}

// ---------------- WBS Tab ----------------

async function schRenderWbsTab(content) {
  const tree = await schFetch('/activities/tree', { query: { scheduleId: schCurrentScheduleId } });
  content.innerHTML = `
    <div class="pm-toolbar">
      <button class="btn btn-primary" id="sch-btn-add-activity">+ نشاط جديد</button>
      <button class="btn btn-outline" id="sch-btn-recalc">إعادة احتساب المسار الحرج</button>
    </div>
    <div class="pm-card"><div id="sch-wbs-tree"></div></div>
  `;
  const treeEl = document.getElementById('sch-wbs-tree');
  treeEl.innerHTML = tree.length ? schRenderWbsNodes(tree, 0) : '<div class="pm-empty-state">لا توجد أنشطة بعد. أضف أول نشاط لبدء بناء هيكل تقسيم العمل.</div>';

  treeEl.querySelectorAll('[data-edit-act]').forEach(b => b.addEventListener('click', () => schOpenActivityModal(b.dataset.editAct)));
  treeEl.querySelectorAll('[data-add-child]').forEach(b => b.addEventListener('click', () => schOpenActivityModal(null, b.dataset.addChild)));
  treeEl.querySelectorAll('[data-del-act]').forEach(b => b.addEventListener('click', () => schDeleteActivity(b.dataset.delAct)));
  treeEl.querySelectorAll('[data-toggle-node]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.toggleNode;
    if (schWbsExpanded.has(id)) schWbsExpanded.delete(id); else schWbsExpanded.add(id);
    schRenderWbsTab(content);
  }));

  document.getElementById('sch-btn-add-activity')?.addEventListener('click', () => schOpenActivityModal(null, null));
  document.getElementById('sch-btn-recalc')?.addEventListener('click', async () => {
    await schFetch('/recalculate', { method: 'POST', body: { scheduleId: schCurrentScheduleId } });
    await schRenderWorkspaceHeader();
    await schRenderWbsTab(content);
  });
}

function schRenderWbsNodes(nodes, depth) {
  return nodes.map(n => {
    const hasChildren = n.children && n.children.length > 0;
    const expanded = schWbsExpanded.has(n.id);
    const isCritical = n.calc?.is_critical;
    return `
      <div class="sch-wbs-row ${isCritical ? 'critical' : ''}" style="padding-right:${depth * 22 + 6}px">
        <span class="sch-wbs-toggle" ${hasChildren ? `data-toggle-node="${n.id}"` : ''}>${hasChildren ? (expanded ? '▾' : '▸') : '·'}</span>
        <span class="sch-wbs-code">${n.code}</span>
        <span class="sch-wbs-name">${n.is_milestone ? '◆ ' : ''}${n.name} ${isCritical ? '<span class="sch-badge critical">حرج</span>' : ''}</span>
        <span class="sch-wbs-meta">
          <span>${SCH_WBS_LEVEL_LABELS[n.wbs_level] || n.wbs_level}</span>
          <span>${schFmtDate(n.start_date)} → ${schFmtDate(n.end_date)}</span>
          <span>${n.duration_days} يوم</span>
          <span class="tag ${SCH_STATUS_TAG[n.status]}">${SCH_STATUS_LABELS[n.status]}</span>
          <span><span class="sch-progress-bar"><span class="sch-progress-bar-fill" style="width:${n.progress_percent}%"></span></span> ${n.progress_percent}%</span>
        </span>
        <span class="sch-wbs-actions">
          <button data-add-child="${n.id}" title="إضافة نشاط فرعي">➕</button>
          <button data-edit-act="${n.id}" title="تعديل">✎</button>
          <button data-del-act="${n.id}" title="حذف">🗑</button>
        </span>
      </div>
      ${hasChildren && expanded ? schRenderWbsNodes(n.children, depth + 1) : ''}
    `;
  }).join('');
}

async function schOpenActivityModal(activityId, parentId) {
  schEditingActivityId = activityId || null;
  document.getElementById('sch-activity-modal-title').textContent = activityId ? 'تعديل النشاط' : 'نشاط جديد';
  document.getElementById('sch-activity-modal-alert').innerHTML = '';
  ['name', 'code', 'assignee', 'start', 'end', 'location', 'notes'].forEach(f => document.getElementById(`sch-act-${f}`).value = '');
  document.getElementById('sch-act-duration').value = 1;
  document.getElementById('sch-act-progress').value = 0;
  document.getElementById('sch-act-milestone').checked = false;
  document.getElementById('sch-act-wbs-level').value = 'task';
  document.getElementById('sch-act-priority').value = 'normal';

  // تعبئة قائمة الأنشطة الأب
  const allActs = await schFetch('/activities', { query: { scheduleId: schCurrentScheduleId } });
  const parentSel = document.getElementById('sch-act-parent');
  parentSel.innerHTML = '<option value="">بدون (جذر)</option>' + allActs
    .filter(a => a.id !== activityId)
    .map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('');
  parentSel.value = parentId || '';

  if (activityId) {
    const act = await schFetch('/activities/get', { query: { id: activityId } });
    document.getElementById('sch-act-name').value = act.name || '';
    document.getElementById('sch-act-code').value = act.code || '';
    document.getElementById('sch-act-wbs-level').value = act.wbs_level || 'task';
    parentSel.value = act.parent_id || '';
    document.getElementById('sch-act-assignee').value = act.assignee || '';
    document.getElementById('sch-act-priority').value = act.priority || 'normal';
    document.getElementById('sch-act-start').value = schFmtDate(act.start_date) === '—' ? '' : act.start_date;
    document.getElementById('sch-act-end').value = schFmtDate(act.end_date) === '—' ? '' : act.end_date;
    document.getElementById('sch-act-duration').value = act.duration_days || 1;
    document.getElementById('sch-act-progress').value = act.progress_percent || 0;
    document.getElementById('sch-act-location').value = act.location || '';
    document.getElementById('sch-act-notes').value = act.notes || '';
    document.getElementById('sch-act-milestone').checked = !!act.is_milestone;
  }
  schShowModal('sch-activity-modal');
}

document.getElementById('sch-activity-modal-cancel')?.addEventListener('click', () => schHideModal('sch-activity-modal'));
document.getElementById('sch-activity-modal-save')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('sch-activity-modal-alert');
  const name = document.getElementById('sch-act-name').value.trim();
  if (!name) { schAlert(alertBox, 'error', 'اسم النشاط مطلوب'); return; }
  const payload = {
    schedule_id: schCurrentScheduleId,
    name,
    code: document.getElementById('sch-act-code').value.trim() || undefined,
    wbs_level: document.getElementById('sch-act-wbs-level').value,
    parent_id: document.getElementById('sch-act-parent').value || null,
    assignee: document.getElementById('sch-act-assignee').value.trim(),
    priority: document.getElementById('sch-act-priority').value,
    start_date: document.getElementById('sch-act-start').value || null,
    end_date: document.getElementById('sch-act-end').value || null,
    duration_days: Number(document.getElementById('sch-act-duration').value) || 1,
    progress_percent: Number(document.getElementById('sch-act-progress').value) || 0,
    location: document.getElementById('sch-act-location').value.trim(),
    notes: document.getElementById('sch-act-notes').value.trim(),
    is_milestone: document.getElementById('sch-act-milestone').checked,
  };
  try {
    if (schEditingActivityId) {
      await schFetch('/activities/update', { method: 'POST', body: { id: schEditingActivityId, ...payload } });
    } else {
      await schFetch('/activities', { method: 'POST', body: payload });
    }
    schHideModal('sch-activity-modal');
    await schRenderWorkspaceHeader();
    await schRenderSubtab(schCurrentSubtab);
  } catch (e) {
    schAlert(alertBox, 'error', e.message);
  }
});

async function schDeleteActivity(id) {
  if (!confirm('هل تريد حذف هذا النشاط؟ سيتم حذف علاقاته وموارده المرتبطة أيضاً.')) return;
  try {
    await schFetch('/activities/delete', { method: 'POST', body: { id } });
    await schRenderWorkspaceHeader();
    await schRenderSubtab(schCurrentSubtab);
  } catch (e) {
    alert(e.message);
  }
}

// ---------------- Relations Tab ----------------

async function schRenderRelationsTab(content) {
  const [relations, activities] = await Promise.all([
    schFetch('/relations', { query: { scheduleId: schCurrentScheduleId } }),
    schFetch('/activities', { query: { scheduleId: schCurrentScheduleId } }),
  ]);
  const nameOf = (id) => activities.find(a => a.id === id)?.name || id;
  content.innerHTML = `
    <div class="pm-toolbar"><button class="btn btn-primary" id="sch-btn-add-relation">+ علاقة جديدة</button></div>
    <div class="pm-table-wrap"><table class="detail-table">
      <thead><tr><th>النشاط السابق</th><th>النوع</th><th>النشاط اللاحق</th><th>Lag/Lead (يوم)</th><th></th></tr></thead>
      <tbody>
        ${relations.length ? relations.map(r => `
          <tr><td>${nameOf(r.predecessor_id)}</td><td>${r.type}</td><td>${nameOf(r.successor_id)}</td><td>${r.lag_days}</td>
          <td><button class="btn btn-outline btn-sm" data-del-rel="${r.id}" style="color:#7d2a22">حذف</button></td></tr>
        `).join('') : '<tr><td colspan="5" class="pm-empty-state">لا توجد علاقات معرّفة بعد بين الأنشطة</td></tr>'}
      </tbody>
    </table></div>
  `;
  document.getElementById('sch-btn-add-relation')?.addEventListener('click', () => schOpenRelationModal(activities));
  content.querySelectorAll('[data-del-rel]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('حذف هذه العلاقة؟')) return;
    await schFetch('/relations/delete', { method: 'POST', body: { id: b.dataset.delRel } });
    await schRenderWorkspaceHeader();
    await schRenderRelationsTab(content);
  }));
}

function schOpenRelationModal(activities) {
  document.getElementById('sch-relation-modal-alert').innerHTML = '';
  const opts = activities.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('');
  document.getElementById('sch-rel-pred').innerHTML = opts;
  document.getElementById('sch-rel-succ').innerHTML = opts;
  document.getElementById('sch-rel-type').value = 'FS';
  document.getElementById('sch-rel-lag').value = 0;
  schShowModal('sch-relation-modal');
}
document.getElementById('sch-relation-modal-cancel')?.addEventListener('click', () => schHideModal('sch-relation-modal'));
document.getElementById('sch-relation-modal-save')?.addEventListener('click', async () => {
  const alertBox = document.getElementById('sch-relation-modal-alert');
  const predecessor_id = document.getElementById('sch-rel-pred').value;
  const successor_id = document.getElementById('sch-rel-succ').value;
  if (!predecessor_id || !successor_id) { schAlert(alertBox, 'error', 'يجب اختيار النشاطين'); return; }
  try {
    await schFetch('/relations', {
      method: 'POST',
      body: {
        schedule_id: schCurrentScheduleId, predecessor_id, successor_id,
        type: document.getElementById('sch-rel-type').value,
        lag_days: Number(document.getElementById('sch-rel-lag').value) || 0,
      },
    });
    schHideModal('sch-relation-modal');
    await schRenderWorkspaceHeader();
    await schRenderSubtab('relations');
  } catch (e) {
    schAlert(alertBox, 'error', e.message);
  }
});

// ---------------- Gantt / Critical Path Tab ----------------

async function schRenderGanttTab(content) {
  const cpm = await schFetch('/cpm', { query: { scheduleId: schCurrentScheduleId } });
  if (!cpm.activities.length) {
    content.innerHTML = '<div class="pm-empty-state">لا توجد أنشطة لعرضها في المخطط الزمني</div>';
    return;
  }
  const minEs = 0;
  const maxEf = Math.max(...cpm.activities.map(a => a.ef), 1);
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">Gantt Chart — المدة الإجمالية: ${cpm.project_duration_days} يوم | المسار الحرج: ${cpm.critical_path.length} نشاط (باللون الأحمر)</div>
      <div id="sch-gantt-rows"></div>
    </div>`;
  const rowsEl = document.getElementById('sch-gantt-rows');
  rowsEl.innerHTML = cpm.activities.map(a => {
    const leftPct = ((a.es - minEs) / (maxEf - minEs || 1)) * 100;
    const widthPct = Math.max(0.6, ((a.ef - a.es) / (maxEf - minEs || 1)) * 100);
    return `<div class="sch-gantt-row">
      <div class="sch-gantt-label" title="${a.name}">${a.code} ${a.name}</div>
      <div class="sch-gantt-track">
        <div class="sch-gantt-bar ${a.is_critical ? 'critical' : ''} ${a.is_milestone ? 'milestone' : ''}" style="right:${leftPct}%;width:${widthPct}%" title="ES:${a.es} EF:${a.ef} TF:${a.total_float}"></div>
      </div>
    </div>`;
  }).join('');
}

// ---------------- Tracking Tab (المخطط مقابل الفعلي) ----------------

async function schRenderTrackingTab(content) {
  const cmp = await schFetch('/comparison', { query: { scheduleId: schCurrentScheduleId } });
  content.innerHTML = `
    <div class="result-cards">
      ${schStatCard('نسبة الإنجاز الكلية', cmp.overall_progress_percent + '%')}
      ${schStatCard('أنشطة متأخرة', cmp.delayed_activities_count)}
      ${schStatCard('متوسط التأخير', cmp.average_delay_days + ' يوم')}
      ${schStatCard('التاريخ المتوقع للتسليم', schFmtDate(cmp.forecast_finish_date))}
    </div>
    <div class="pm-table-wrap"><table class="detail-table">
      <thead><tr><th>النشاط</th><th>مخطط بداية</th><th>مخطط نهاية</th><th>فعلي بداية</th><th>فعلي نهاية</th><th>الحالة</th><th>الإنجاز</th><th>التأخير</th></tr></thead>
      <tbody>
        ${cmp.activities.map(a => `
          <tr class="${a.is_late ? '' : ''}">
            <td>${a.code} ${a.name} ${a.is_critical ? '<span class="sch-badge critical">حرج</span>' : ''}</td>
            <td>${schFmtDate(a.planned_start)}</td><td>${schFmtDate(a.planned_end)}</td>
            <td>${schFmtDate(a.actual_start)}</td><td>${schFmtDate(a.actual_end)}</td>
            <td><span class="tag ${SCH_STATUS_TAG[a.status]}">${SCH_STATUS_LABELS[a.status]}</span></td>
            <td>${a.progress_percent}%</td>
            <td>${a.is_late ? `<span class="tag tag-bad">${a.delay_days} يوم</span>` : '<span class="tag tag-ok">في الموعد</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>
  `;
}

// ---------------- Resources Tab ----------------

async function schRenderResourcesTab(content) {
  const [assignments, activities, histogram] = await Promise.all([
    schFetch('/resources', { query: { scheduleId: schCurrentScheduleId } }),
    schFetch('/activities', { query: { scheduleId: schCurrentScheduleId } }),
    schFetch('/resources/histogram', { query: { scheduleId: schCurrentScheduleId } }),
  ]);
  const nameOf = (id) => activities.find(a => a.id === id)?.name || id;
  content.innerHTML = `
    <div class="pm-toolbar">
      <select id="sch-res-activity">${activities.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select>
      <select id="sch-res-type">
        <option value="worker">عامل</option><option value="engineer">مهندس</option><option value="equipment">معدة</option>
        <option value="material">مادة</option><option value="vehicle">سيارة</option><option value="supplier">مورّد</option>
      </select>
      <input type="text" id="sch-res-name" placeholder="اسم المورد">
      <input type="number" id="sch-res-qty" placeholder="الكمية" value="1" style="width:90px">
      <input type="number" id="sch-res-cost" placeholder="تكلفة الوحدة" value="0" style="width:110px">
      <button class="btn btn-primary" id="sch-btn-add-resource">+ إضافة مورد</button>
    </div>
    <div id="sch-res-alert"></div>
    <div class="pm-table-wrap"><table class="detail-table">
      <thead><tr><th>النشاط</th><th>النوع</th><th>الاسم</th><th>الكمية</th><th>تكلفة الوحدة</th><th>التكلفة الإجمالية</th><th></th></tr></thead>
      <tbody>
        ${assignments.length ? assignments.map(r => `
          <tr><td>${nameOf(r.activity_id)}</td><td>${r.resource_type}</td><td>${r.name}</td><td>${r.quantity}</td>
          <td>${r.unit_cost}</td><td>${r.total_cost}</td>
          <td><button class="btn btn-outline btn-sm" data-del-res="${r.id}" style="color:#7d2a22">حذف</button></td></tr>
        `).join('') : '<tr><td colspan="7" class="pm-empty-state">لا توجد موارد مخصصة بعد</td></tr>'}
      </tbody>
    </table></div>
    <div class="pm-card" style="margin-top:14px">
      <div class="pm-card-title">توزيع الموارد اليومي (Resource Histogram)</div>
      <div id="sch-res-histogram"></div>
      ${histogram.overload_conflicts.length ? `<div class="alert alert-error" style="margin-top:10px">تحميل زائد: ${histogram.overload_conflicts.map(c => `${c.resource} بتاريخ ${c.date} (${c.hours} ساعة)`).join(' · ')}</div>` : ''}
    </div>
  `;
  const histEl = document.getElementById('sch-res-histogram');
  histEl.innerHTML = histogram.series.length ? histogram.series.map(s => {
    const totalHours = s.daily.reduce((sum, d) => sum + d.hours, 0);
    const maxDay = Math.max(...s.daily.map(d => d.hours), 1);
    const overloaded = s.daily.some(d => d.hours > 12);
    return `<div class="sch-hist-row"><span style="width:120px">${s.resource}</span>
      <div class="sch-hist-bar-track"><div class="sch-hist-bar-fill ${overloaded ? 'overload' : ''}" style="width:${Math.min(100, (maxDay / 12) * 100)}%"></div></div>
      <span style="width:90px;text-align:left">${totalHours} ساعة</span></div>`;
  }).join('') : '<div class="pm-empty-state">لا توجد بيانات موارد بعد</div>';

  document.getElementById('sch-btn-add-resource')?.addEventListener('click', async () => {
    const alertBox = document.getElementById('sch-res-alert');
    const name = document.getElementById('sch-res-name').value.trim();
    if (!name) { schAlert(alertBox, 'error', 'اسم المورد مطلوب'); return; }
    try {
      await schFetch('/resources', {
        method: 'POST',
        body: {
          activity_id: document.getElementById('sch-res-activity').value,
          resource_type: document.getElementById('sch-res-type').value,
          name,
          quantity: Number(document.getElementById('sch-res-qty').value) || 1,
          unit_cost: Number(document.getElementById('sch-res-cost').value) || 0,
        },
      });
      await schRenderResourcesTab(content);
    } catch (e) {
      schAlert(alertBox, 'error', e.message);
    }
  });
  content.querySelectorAll('[data-del-res]').forEach(b => b.addEventListener('click', async () => {
    await schFetch('/resources/delete', { method: 'POST', body: { id: b.dataset.delRes } });
    await schRenderResourcesTab(content);
  }));
}

// ---------------- S-Curve Tab ----------------

async function schRenderSCurveTab(content) {
  const sc = await schFetch('/scurve', { query: { scheduleId: schCurrentScheduleId } });
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">منحنى S-Curve — المخطط مقابل الفعلي (نسبة الإنجاز التراكمية)</div>
      <svg class="sch-scurve-svg" viewBox="0 0 600 260" preserveAspectRatio="none" id="sch-scurve-svg"></svg>
      <div style="display:flex;gap:16px;font-size:12.5px;margin-top:6px">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--blueprint-navy);border-radius:2px"></span> المخطط</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent-copper-bright);border-radius:2px"></span> الفعلي</span>
      </div>
    </div>`;
  if (!sc.planned || !sc.planned.length) return;
  const svg = document.getElementById('sch-scurve-svg');
  const w = 600, h = 260, pad = 20;
  const maxDay = sc.planned[sc.planned.length - 1].day || 1;
  const toPoint = (arr) => arr.map(p => {
    const x = pad + (p.day / maxDay) * (w - pad * 2);
    const y = h - pad - (p.cumulative_percent / 100) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  svg.innerHTML = `
    <polyline points="${toPoint(sc.planned)}" fill="none" stroke="#0d2438" stroke-width="2.5"/>
    <polyline points="${toPoint(sc.actual)}" fill="none" stroke="#c98a2c" stroke-width="2.5"/>
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#ccc" stroke-width="1"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#ccc" stroke-width="1"/>
  `;
}

// ---------------- Baselines & Reschedule Tab ----------------

async function schRenderBaselinesTab(content) {
  const baselines = await schFetch('/baselines', { query: { scheduleId: schCurrentScheduleId } });
  content.innerHTML = `
    <div class="pm-grid-2">
      <div class="pm-card">
        <div class="pm-card-title">حفظ إصدار (Baseline)</div>
        <div class="pm-inline-form">
          <div class="field"><label>اسم الإصدار</label><input type="text" id="sch-base-name" placeholder="مثال: خط الأساس الأولي"></div>
          <button class="btn btn-primary" id="sch-btn-save-baseline">حفظ إصدار الآن</button>
        </div>
      </div>
      <div class="pm-card">
        <div class="pm-card-title">إعادة الجدولة</div>
        <div class="pm-inline-form">
          <div class="field"><label>إزاحة بالأيام (+ تأخير / - تقديم)</label><input type="number" id="sch-resched-days" value="0"></div>
          <button class="btn btn-primary" id="sch-btn-reschedule">تنفيذ إعادة الجدولة</button>
        </div>
        <div style="font-size:12px;color:#8a7a5c">سيتم حفظ إصدار تلقائياً قبل إعادة الجدولة للحفاظ على السجل التاريخي.</div>
      </div>
    </div>
    <div class="pm-table-wrap" style="margin-top:14px"><table class="detail-table">
      <thead><tr><th>الاسم</th><th>الإصدار</th><th>عدد الأنشطة</th><th>تاريخ الحفظ</th></tr></thead>
      <tbody>
        ${baselines.length ? baselines.map(b => `<tr><td>${b.name}</td><td>v${b.version}</td><td>${b.snapshot.length}</td><td>${new Date(b.created_at).toLocaleString('ar')}</td></tr>`).join('') : '<tr><td colspan="4" class="pm-empty-state">لا توجد إصدارات محفوظة بعد</td></tr>'}
      </tbody>
    </table></div>
  `;
  document.getElementById('sch-btn-save-baseline')?.addEventListener('click', async () => {
    const name = document.getElementById('sch-base-name').value.trim();
    await schFetch('/baselines', { method: 'POST', body: { scheduleId: schCurrentScheduleId, name } });
    await schRenderWorkspaceHeader();
    await schRenderBaselinesTab(content);
  });
  document.getElementById('sch-btn-reschedule')?.addEventListener('click', async () => {
    const shiftDays = Number(document.getElementById('sch-resched-days').value) || 0;
    if (!confirm(`سيتم إزاحة الأنشطة بمقدار ${shiftDays} يوم. متابعة؟`)) return;
    await schFetch('/reschedule', { method: 'POST', body: { scheduleId: schCurrentScheduleId, shiftDays } });
    await schRenderWorkspaceHeader();
    await schRenderBaselinesTab(content);
  });
}

// ---------------- Notifications Tab ----------------

async function schRenderNotificationsTab(content) {
  const notifs = await schFetch('/notifications', { query: { projectId: schCurrentProjectId } });
  content.innerHTML = `
    <div class="pm-toolbar"><button class="btn btn-outline" id="sch-btn-scan-notifs">فحص وإنشاء تنبيهات تلقائية الآن</button></div>
    <div class="pm-card"><div id="sch-notif-list"></div></div>
  `;
  const listEl = document.getElementById('sch-notif-list');
  listEl.innerHTML = notifs.length ? notifs.map(n => `
    <div class="sch-notif-item">
      <span class="sch-notif-sev ${n.severity}"></span>
      <div style="flex:1">${n.message}<div style="font-size:11px;color:#8a7a5c">${new Date(n.created_at).toLocaleString('ar')}</div></div>
      ${!n.read ? `<button class="btn btn-outline btn-sm" data-read-notif="${n.id}">تعليم كمقروء</button>` : '<span class="tag tag-info">مقروء</span>'}
    </div>`).join('') : '<div class="pm-empty-state">لا توجد إشعارات بعد</div>';
  listEl.querySelectorAll('[data-read-notif]').forEach(b => b.addEventListener('click', async () => {
    await schFetch('/notifications/read', { method: 'POST', body: { id: b.dataset.readNotif } });
    await schRenderNotificationsTab(content);
  }));
  document.getElementById('sch-btn-scan-notifs')?.addEventListener('click', async () => {
    await schFetch('/notifications/scan', { method: 'POST', body: { scheduleId: schCurrentScheduleId } });
    await schRenderNotificationsTab(content);
  });
}

// ---------------- Reports Tab ----------------

const SCH_REPORT_TYPES = {
  schedule: 'تقرير الجدول الزمني', progress: 'تقرير نسبة الإنجاز', delay: 'تقرير التأخير',
  critical_path: 'تقرير المسار الحرج', resources: 'تقرير الموارد', executive: 'التقرير التنفيذي',
};

async function schRenderReportsTab(content) {
  content.innerHTML = `
    <div class="pm-card">
      <div class="pm-card-title">إنشاء وتصدير التقارير</div>
      <div class="pm-inline-form">
        <div class="field"><label>نوع التقرير</label>
          <select id="sch-report-type">${Object.entries(SCH_REPORT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
        <button class="btn btn-outline" id="sch-btn-preview-report">معاينة</button>
        <button class="btn btn-primary" id="sch-btn-export-pdf">تصدير PDF</button>
        <button class="btn btn-primary" id="sch-btn-export-excel">تصدير Excel</button>
        <button class="btn btn-primary" id="sch-btn-export-csv">تصدير CSV</button>
      </div>
      <div id="sch-report-alert"></div>
    </div>
    <div class="pm-card" style="margin-top:14px"><div id="sch-report-preview" class="pm-empty-state">اختر نوع التقرير واضغط معاينة</div></div>
  `;
  const previewEl = document.getElementById('sch-report-preview');
  const alertBox = document.getElementById('sch-report-alert');

  document.getElementById('sch-btn-preview-report')?.addEventListener('click', async () => {
    const type = document.getElementById('sch-report-type').value;
    const endpoints = {
      schedule: '/reports/schedule', progress: '/reports/progress', delay: '/reports/delay',
      critical_path: '/reports/critical-path', resources: '/reports/resources', executive: '/reports/executive',
    };
    try {
      const data = await schFetch(endpoints[type], { query: { scheduleId: schCurrentScheduleId } });
      previewEl.innerHTML = `<pre style="white-space:pre-wrap;font-size:12.5px;max-height:400px;overflow:auto">${JSON.stringify(data, null, 2)}</pre>`;
    } catch (e) {
      schAlert(alertBox, 'error', e.message);
    }
  });

  async function exportReport(kind) {
    const type = document.getElementById('sch-report-type').value;
    try {
      const result = await schFetch(`/reports/export/${kind}`, { method: 'POST', body: { scheduleId: schCurrentScheduleId, reportType: type } });
      schAlert(alertBox, 'success', `تم إنشاء التقرير بنجاح. <a href="${result.url}" target="_blank" style="font-weight:700">تحميل الملف</a>`);
    } catch (e) {
      schAlert(alertBox, 'error', e.message);
    }
  }
  document.getElementById('sch-btn-export-pdf')?.addEventListener('click', () => exportReport('pdf'));
  document.getElementById('sch-btn-export-excel')?.addEventListener('click', () => exportReport('excel'));
  document.getElementById('sch-btn-export-csv')?.addEventListener('click', () => exportReport('csv'));
}

// ---------------- AI Assistant Tab ----------------

async function schRenderAiTab(content) {
  content.innerHTML = `
    <div class="pm-grid-2">
      <div class="pm-card pm-ai-box">
        <div class="pm-card-title">تحليل الجدول الزمني</div>
        <button class="btn btn-outline" id="sch-btn-ai-analyze">تشغيل التحليل</button>
        <div id="sch-ai-analyze-result" style="margin-top:10px"></div>
      </div>
      <div class="pm-card pm-ai-box">
        <div class="pm-card-title">التنبؤ بتاريخ الانتهاء</div>
        <button class="btn btn-outline" id="sch-btn-ai-predict">تشغيل التنبؤ</button>
        <div id="sch-ai-predict-result" style="margin-top:10px"></div>
      </div>
      <div class="pm-card pm-ai-box">
        <div class="pm-card-title">اقتراح إعادة الجدولة</div>
        <button class="btn btn-outline" id="sch-btn-ai-reschedule">اقترح الآن</button>
        <div id="sch-ai-reschedule-result" style="margin-top:10px"></div>
      </div>
      <div class="pm-card pm-ai-box">
        <div class="pm-card-title">تحسين توزيع الموارد</div>
        <button class="btn btn-outline" id="sch-btn-ai-resources">تحليل الموارد</button>
        <div id="sch-ai-resources-result" style="margin-top:10px"></div>
      </div>
    </div>
    <div class="pm-card pm-ai-box" style="margin-top:14px">
      <div class="pm-card-title">اسأل المساعد الذكي عن الجدول الزمني</div>
      <div class="pm-inline-form">
        <input type="text" id="sch-ai-question" placeholder="مثال: ما هو المسار الحرج؟ هل يوجد تأخير؟" style="flex:1">
        <button class="btn btn-primary" id="sch-btn-ai-ask">اسأل</button>
      </div>
      <div id="sch-ai-ask-result" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById('sch-btn-ai-analyze')?.addEventListener('click', async () => {
    const box = document.getElementById('sch-ai-analyze-result');
    box.innerHTML = '<div class="pm-empty-state">جارٍ التحليل...</div>';
    try {
      const r = await schFetch('/ai/analyze', { query: { scheduleId: schCurrentScheduleId } });
      box.innerHTML = `<div class="tag ${r.risk_forecast === 'مرتفع' ? 'tag-bad' : r.risk_forecast === 'متوسط' ? 'tag-info' : 'tag-ok'}">مستوى الخطورة: ${r.risk_forecast}</div>` +
        r.insights.map(i => `<div class="pm-ai-insight">• ${i}</div>`).join('');
    } catch (e) { schAlert(box, 'error', e.message); }
  });

  document.getElementById('sch-btn-ai-predict')?.addEventListener('click', async () => {
    const box = document.getElementById('sch-ai-predict-result');
    box.innerHTML = '<div class="pm-empty-state">جارٍ التنبؤ...</div>';
    try {
      const r = await schFetch('/ai/predict-finish', { query: { scheduleId: schCurrentScheduleId } });
      box.innerHTML = `<div class="pm-ai-insight">التاريخ المخطط: ${schFmtDate(r.planned_finish_date)}</div>
        <div class="pm-ai-insight">التاريخ المتوقع: ${schFmtDate(r.forecast_finish_date)}</div>
        <div class="pm-ai-insight">تأخير متوقع: ${r.forecast_delay_days} يوم</div>
        <div class="pm-ai-insight">درجة الثقة: ${r.confidence}</div>`;
    } catch (e) { schAlert(box, 'error', e.message); }
  });

  document.getElementById('sch-btn-ai-reschedule')?.addEventListener('click', async () => {
    const box = document.getElementById('sch-ai-reschedule-result');
    box.innerHTML = '<div class="pm-empty-state">جارٍ التحليل...</div>';
    try {
      const r = await schFetch('/ai/suggest-reschedule', { query: { scheduleId: schCurrentScheduleId } });
      box.innerHTML = `<div class="pm-ai-insight">${r.message}</div>` +
        r.suggestions.map(s => `<div class="pm-ai-insight">• ${s.activity_name}: ${s.suggested_action}</div>`).join('');
    } catch (e) { schAlert(box, 'error', e.message); }
  });

  document.getElementById('sch-btn-ai-resources')?.addEventListener('click', async () => {
    const box = document.getElementById('sch-ai-resources-result');
    box.innerHTML = '<div class="pm-empty-state">جارٍ التحليل...</div>';
    try {
      const r = await schFetch('/ai/optimize-resources', { query: { scheduleId: schCurrentScheduleId } });
      box.innerHTML = `<div class="pm-ai-insight">${r.message}</div>` +
        r.recommendations.map(rec => `<div class="pm-ai-insight">• ${rec.resource} (${rec.date}): ${rec.recommendation}</div>`).join('');
    } catch (e) { schAlert(box, 'error', e.message); }
  });

  document.getElementById('sch-btn-ai-ask')?.addEventListener('click', async () => {
    const box = document.getElementById('sch-ai-ask-result');
    const q = document.getElementById('sch-ai-question').value.trim();
    if (!q) return;
    box.innerHTML = '<div class="pm-empty-state">جارٍ التفكير...</div>';
    try {
      const r = await schFetch('/ai/ask', { method: 'POST', body: { scheduleId: schCurrentScheduleId, question: q } });
      box.innerHTML = `<div class="pm-ai-insight">${r.answer}</div>`;
    } catch (e) { schAlert(box, 'error', e.message); }
  });
}
