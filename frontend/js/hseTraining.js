// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الثامن: إدارة السلامة المهنية (Occupational Health & Safety)
// الجزء 3/4: إدارة التدريب (دورات، جلسات، تسجيل متدربين، شهادات)
// ============================================================

const HSE_TRN_API = '/api/hse/training';
let HSE_TRN_REF = null;
let hseTrnCourseEditingId = null;
let hseTrnSessionCurrentId = null;

// ---------- أدوات عامة (بنفس نمط hseEmergency.js) ----------
function hseTrnFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${HSE_TRN_API}${path}`;
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

function hseTrnAlert(container, type, message) {
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function hseTrnEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function hseTrnEnsureRefData() {
  if (HSE_TRN_REF) return HSE_TRN_REF;
  const res = await hseTrnFetch('/reference-data');
  HSE_TRN_REF = res.data;
  return HSE_TRN_REF;
}

function hseTrnOptionsHTML(values, labels, { placeholder = null } = {}) {
  const opts = (placeholder ? [`<option value="">${placeholder}</option>`] : []).concat(
    values.map(v => `<option value="${v}">${labels[v] || v}</option>`)
  );
  return opts.join('');
}

function hseTrnCourseStatusTag(status) {
  return status === 'active' ? 'tag-ok' : 'tag-info';
}

function hseTrnResultTag(result) {
  const map = { pass: 'tag-ok', fail: 'tag-bad', pending: 'tag-info', absent: 'tag-info' };
  return map[result] || 'tag-info';
}

function hseTrnCertTag(status) {
  const map = { valid: 'tag-ok', expiring_soon: 'tag-bad', expired: 'tag-bad', not_issued: 'tag-info' };
  return map[status] || 'tag-info';
}

// ================================================================
// لوحة معلومات التدريب
// ================================================================

document.querySelector('[data-panel="hse-trn-dashboard"]')?.addEventListener('click', () => hseTrnLoadDashboard());
document.getElementById('hse-trn-btn-load-dashboard')?.addEventListener('click', () => hseTrnLoadDashboard());

async function hseTrnLoadDashboard() {
  const cardsEl = document.getElementById('hse-trn-dash-cards');
  const catChartEl = document.getElementById('hse-trn-chart-categories');
  const upcomingEl = document.getElementById('hse-trn-upcoming-expiry');
  const ref = await hseTrnEnsureRefData();
  const projectId = document.getElementById('hse-trn-dash-project')?.value.trim() || null;

  try {
    const res = await hseTrnFetch('/dashboard', { query: { projectId } });
    const d = res.data;

    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي الدورات</div><div class="value">${d.total_courses}<span class="unit">نشطة: ${d.active_courses}</span></div></div>
      <div class="result-card"><div class="label">دورات إلزامية</div><div class="value">${d.mandatory_courses}</div></div>
      <div class="result-card"><div class="label">الجلسات التدريبية</div><div class="value">${d.total_sessions}<span class="unit">منتهية: ${d.completed_sessions}</span></div></div>
      <div class="result-card"><div class="label">إجمالي المسجَّلين</div><div class="value">${d.total_enrollments}</div></div>
      <div class="result-card"><div class="label">نسبة النجاح</div><div class="value">${d.pass_rate_percent ?? '—'}<span class="unit">%</span></div></div>
      <div class="result-card"><div class="label">ناجحون / راسبون</div><div class="value">${d.passed} <span class="unit">/ ${d.failed}</span></div></div>
      <div class="result-card"><div class="label">شهادات سارية</div><div class="value">${d.valid_certificates}</div></div>
      <div class="result-card"><div class="label">شهادات تنتهي قريباً</div><div class="value">${d.expiring_soon_certificates}</div></div>
      <div class="result-card"><div class="label">شهادات منتهية</div><div class="value">${d.expired_certificates}</div></div>
    `;

    const catEntries = Object.entries(d.by_category);
    const maxCat = Math.max(1, ...catEntries.map(([, c]) => c));
    catChartEl.innerHTML = catEntries.length
      ? catEntries.map(([cat, count]) => `
        <div class="pm-bar-row">
          <div class="pm-bar-label">${ref.course_category_labels[cat] || cat}</div>
          <div class="pm-bar-track"><div class="pm-bar-fill" style="width:${(count / maxCat) * 100}%"></div></div>
          <div class="pm-bar-value">${count}</div>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد دورات مسجَّلة بعد</div>`;

    const expRes = await hseTrnFetch('/certificates/expiring', { query: { projectId, withinDays: 30 } });
    upcomingEl.innerHTML = expRes.data.length
      ? expRes.data.slice(0, 10).map(e => `
        <div class="pm-activity-item">
          <span class="ts"><span class="tag ${hseTrnCertTag(e.certificate_status)}">${ref.certificate_status_labels[e.certificate_status] || e.certificate_status}</span></span>
          <span>${hseTrnEsc(e.trainee_name)} — ${e.certificate_no || '—'} — تنتهي ${e.certificate_expiry_date || '—'}</span>
        </div>
      `).join('')
      : `<div class="pm-empty-state">لا توجد شهادات على وشك الانتهاء</div>`;
  } catch (e) {
    hseTrnAlert(cardsEl, 'error', e.message);
  }
}

// ================================================================
// الدورات التدريبية
// ================================================================

document.querySelector('[data-panel="hse-trn-courses"]')?.addEventListener('click', async () => {
  const ref = await hseTrnEnsureRefData();
  document.getElementById('hse-trn-course-filter-category').innerHTML = '<option value="">كل الفئات</option>' + hseTrnOptionsHTML(ref.course_categories, ref.course_category_labels);
  document.getElementById('hse-trn-course-filter-status').innerHTML = '<option value="">كل الحالات</option>' + hseTrnOptionsHTML(ref.course_statuses, ref.course_status_labels);
  hseTrnCourseShowListView();
  hseTrnLoadCourseTable();
});

document.getElementById('hse-trn-course-search')?.addEventListener('input', debounceHseTrn(() => hseTrnLoadCourseTable(), 300));
document.getElementById('hse-trn-course-filter-category')?.addEventListener('change', () => hseTrnLoadCourseTable());
document.getElementById('hse-trn-course-filter-status')?.addEventListener('change', () => hseTrnLoadCourseTable());

function debounceHseTrn(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hseTrnCourseShowListView() {
  document.getElementById('hse-trn-course-list-view').style.display = '';
  document.getElementById('hse-trn-course-form-view').style.display = 'none';
  document.getElementById('hse-trn-course-detail-view').style.display = 'none';
}

async function hseTrnLoadCourseTable() {
  const tbody = document.getElementById('hse-trn-course-tbody');
  const ref = await hseTrnEnsureRefData();
  try {
    const res = await hseTrnFetch('/courses', {
      query: {
        search: document.getElementById('hse-trn-course-search')?.value.trim(),
        category: document.getElementById('hse-trn-course-filter-category')?.value,
        status: document.getElementById('hse-trn-course-filter-status')?.value,
      },
    });
    tbody.innerHTML = res.data.length ? res.data.map(c => `
      <tr>
        <td>${c.code}</td>
        <td><a href="#" onclick="hseTrnCourseShowDetail('${c.id}');return false;">${hseTrnEsc(c.title)}</a></td>
        <td>${ref.course_category_labels[c.category] || c.category}</td>
        <td>${c.validity_days ?? '—'}</td>
        <td>${c.pass_score}%</td>
        <td>${c.mandatory ? 'نعم' : 'لا'}</td>
        <td>${c.sessions_count}</td>
        <td><span class="tag ${hseTrnCourseStatusTag(c.status)}">${ref.course_status_labels[c.status]}</span></td>
        <td>
          <button class="btn-icon" onclick="hseTrnCourseEdit('${c.id}')">✏️</button>
          <button class="btn-icon" onclick="hseTrnCourseDelete('${c.id}')">🗑️</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="9"><div class="pm-empty-state">لا توجد دورات تدريبية بعد</div></td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9"></td></tr>`;
    hseTrnAlert(tbody.closest('.calc-card'), 'error', e.message);
  }
}

document.getElementById('hse-trn-course-btn-new')?.addEventListener('click', () => hseTrnCourseShowForm());
document.getElementById('hse-trn-course-btn-back-to-list')?.addEventListener('click', () => { hseTrnCourseShowListView(); hseTrnLoadCourseTable(); });
document.getElementById('hse-trn-course-btn-back-from-detail')?.addEventListener('click', () => { hseTrnCourseShowListView(); hseTrnLoadCourseTable(); });

async function hseTrnCourseShowForm(course = null) {
  const ref = await hseTrnEnsureRefData();
  hseTrnCourseEditingId = course ? course.id : null;
  document.getElementById('hse-trn-course-list-view').style.display = 'none';
  document.getElementById('hse-trn-course-detail-view').style.display = 'none';
  document.getElementById('hse-trn-course-form-view').style.display = '';
  document.getElementById('hse-trn-course-form-alert').innerHTML = '';

  document.getElementById('hse-trn-course-f-category').innerHTML = hseTrnOptionsHTML(ref.course_categories, ref.course_category_labels);
  document.getElementById('hse-trn-course-f-delivery').innerHTML = hseTrnOptionsHTML(ref.delivery_methods, ref.delivery_method_labels);
  document.getElementById('hse-trn-course-f-status').innerHTML = hseTrnOptionsHTML(ref.course_statuses, ref.course_status_labels);

  document.getElementById('hse-trn-course-f-title').value = course?.title || '';
  document.getElementById('hse-trn-course-f-category').value = course?.category || ref.course_categories[0];
  document.getElementById('hse-trn-course-f-delivery').value = course?.delivery_method || 'classroom';
  document.getElementById('hse-trn-course-f-duration').value = course?.duration_hours ?? '';
  document.getElementById('hse-trn-course-f-validity').value = course?.validity_days ?? 365;
  document.getElementById('hse-trn-course-f-passscore').value = course?.pass_score ?? 70;
  document.getElementById('hse-trn-course-f-mandatory').value = String(course?.mandatory ?? false);
  document.getElementById('hse-trn-course-f-status').value = course?.status || 'active';
  document.getElementById('hse-trn-course-f-description').value = course?.description || '';
}

function hseTrnCourseEdit(id) {
  hseTrnFetch('/courses/get', { query: { id } }).then(res => hseTrnCourseShowForm(res.data)).catch(e => alert(e.message));
}

document.getElementById('hse-trn-course-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-trn-course-form-alert');
  try {
    const body = {
      title: document.getElementById('hse-trn-course-f-title').value.trim(),
      category: document.getElementById('hse-trn-course-f-category').value,
      delivery_method: document.getElementById('hse-trn-course-f-delivery').value,
      duration_hours: document.getElementById('hse-trn-course-f-duration').value ? Number(document.getElementById('hse-trn-course-f-duration').value) : null,
      validity_days: Number(document.getElementById('hse-trn-course-f-validity').value),
      pass_score: Number(document.getElementById('hse-trn-course-f-passscore').value),
      mandatory: document.getElementById('hse-trn-course-f-mandatory').value === 'true',
      status: document.getElementById('hse-trn-course-f-status').value,
      description: document.getElementById('hse-trn-course-f-description').value.trim() || null,
    };
    if (hseTrnCourseEditingId) {
      await hseTrnFetch('/courses/update', { method: 'POST', body: { id: hseTrnCourseEditingId, updates: body } });
    } else {
      await hseTrnFetch('/courses', { method: 'POST', body });
    }
    hseTrnCourseShowListView();
    hseTrnLoadCourseTable();
  } catch (e) {
    hseTrnAlert(alertEl, 'error', e.message);
  }
});

async function hseTrnCourseDelete(id) {
  if (!confirm('هل تريد حذف هذه الدورة التدريبية؟')) return;
  try {
    await hseTrnFetch('/courses/delete', { method: 'POST', body: { id } });
    hseTrnLoadCourseTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseTrnCourseShowDetail(id) {
  const ref = await hseTrnEnsureRefData();
  document.getElementById('hse-trn-course-list-view').style.display = 'none';
  document.getElementById('hse-trn-course-form-view').style.display = 'none';
  document.getElementById('hse-trn-course-detail-view').style.display = '';
  const content = document.getElementById('hse-trn-course-detail-content');
  try {
    const res = await hseTrnFetch('/courses/get', { query: { id } });
    const c = res.data;
    content.innerHTML = `
      <h3>${c.code} — ${hseTrnEsc(c.title)}
        <span class="tag ${hseTrnCourseStatusTag(c.status)}">${ref.course_status_labels[c.status]}</span></h3>
      <p><strong>الفئة:</strong> ${ref.course_category_labels[c.category] || c.category}
        &nbsp; <strong>طريقة التنفيذ:</strong> ${ref.delivery_method_labels[c.delivery_method] || c.delivery_method}</p>
      <p><strong>مدة الصلاحية:</strong> ${c.validity_days ?? '—'} يوم
        &nbsp; <strong>الحد الأدنى للنجاح:</strong> ${c.pass_score}%
        &nbsp; <strong>إلزامية:</strong> ${c.mandatory ? 'نعم' : 'لا'}</p>
      ${c.description ? `<p><strong>الوصف:</strong> ${hseTrnEsc(c.description)}</p>` : ''}

      <h4>الجلسات المرتبطة (${c.sessions.length})</h4>
      <div class="table-wrap">
        <table class="detail-table">
          <thead><tr><th>الرمز</th><th>التاريخ</th><th>المدرّب</th><th>الحالة</th></tr></thead>
          <tbody>
            ${c.sessions.length ? c.sessions.map(s => `
              <tr>
                <td><a href="#" onclick="hseTrnSessionShowDetail('${s.id}');document.querySelector('[data-panel=&quot;hse-trn-sessions&quot;]').click();return false;">${s.code}</a></td>
                <td>${s.session_date}</td>
                <td>${hseTrnEsc(s.trainer_name || '—')}</td>
                <td>${ref.session_status_labels[s.status] || s.status}</td>
              </tr>
            `).join('') : `<tr><td colspan="4"><div class="pm-empty-state">لا توجد جلسات بعد</div></td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    hseTrnAlert(content, 'error', e.message);
  }
}

// ================================================================
// الجلسات التدريبية والمتدربون
// ================================================================

document.querySelector('[data-panel="hse-trn-sessions"]')?.addEventListener('click', async () => {
  const ref = await hseTrnEnsureRefData();
  const coursesRes = await hseTrnFetch('/courses');
  const courseOpts = coursesRes.data.map(c => `<option value="${c.id}">${hseTrnEsc(c.title)} (${c.code})</option>`).join('');
  document.getElementById('hse-trn-session-filter-course').innerHTML = '<option value="">كل الدورات</option>' + courseOpts;
  document.getElementById('hse-trn-session-filter-status').innerHTML = '<option value="">كل الحالات</option>' + hseTrnOptionsHTML(ref.session_statuses, ref.session_status_labels);
  hseTrnSessionShowListView();
  hseTrnLoadSessionTable();
});

document.getElementById('hse-trn-session-project')?.addEventListener('input', debounceHseTrn(() => hseTrnLoadSessionTable(), 300));
document.getElementById('hse-trn-session-filter-course')?.addEventListener('change', () => hseTrnLoadSessionTable());
document.getElementById('hse-trn-session-filter-status')?.addEventListener('change', () => hseTrnLoadSessionTable());

function hseTrnSessionShowListView() {
  document.getElementById('hse-trn-session-list-view').style.display = '';
  document.getElementById('hse-trn-session-form-view').style.display = 'none';
  document.getElementById('hse-trn-session-detail-view').style.display = 'none';
}

async function hseTrnLoadSessionTable() {
  const tbody = document.getElementById('hse-trn-session-tbody');
  const ref = await hseTrnEnsureRefData();
  try {
    const res = await hseTrnFetch('/sessions', {
      query: {
        projectId: document.getElementById('hse-trn-session-project')?.value.trim(),
        courseId: document.getElementById('hse-trn-session-filter-course')?.value,
        status: document.getElementById('hse-trn-session-filter-status')?.value,
      },
    });
    tbody.innerHTML = res.data.length ? res.data.map(s => `
      <tr>
        <td><a href="#" onclick="hseTrnSessionShowDetail('${s.id}');return false;">${s.code}</a></td>
        <td>${hseTrnEsc(s.course_title || '—')}</td>
        <td>${s.session_date}</td>
        <td>${hseTrnEsc(s.trainer_name || '—')}</td>
        <td>${s.enrolled_count}</td>
        <td>${s.passed_count}</td>
        <td>${s.failed_count}</td>
        <td>${ref.session_status_labels[s.status] || s.status}</td>
        <td><button class="btn-icon" onclick="hseTrnSessionDelete('${s.id}')">🗑️</button></td>
      </tr>
    `).join('') : `<tr><td colspan="9"><div class="pm-empty-state">لا توجد جلسات تدريبية بعد</div></td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9"></td></tr>`;
    hseTrnAlert(tbody.closest('.calc-card'), 'error', e.message);
  }
}

document.getElementById('hse-trn-session-btn-new')?.addEventListener('click', async () => {
  const coursesRes = await hseTrnFetch('/courses');
  document.getElementById('hse-trn-session-f-course').innerHTML = coursesRes.data.map(c => `<option value="${c.id}">${hseTrnEsc(c.title)} (${c.code})</option>`).join('');
  document.getElementById('hse-trn-session-list-view').style.display = 'none';
  document.getElementById('hse-trn-session-detail-view').style.display = 'none';
  document.getElementById('hse-trn-session-form-view').style.display = '';
  document.getElementById('hse-trn-session-form-alert').innerHTML = '';
  ['project', 'date', 'location', 'trainer', 'trainer-org', 'notes'].forEach(f => {
    const el = document.getElementById(`hse-trn-session-f-${f}`); if (el) el.value = '';
  });
});
document.getElementById('hse-trn-session-btn-back-to-list')?.addEventListener('click', () => { hseTrnSessionShowListView(); hseTrnLoadSessionTable(); });
document.getElementById('hse-trn-session-btn-back-from-detail')?.addEventListener('click', () => { hseTrnSessionShowListView(); hseTrnLoadSessionTable(); });

document.getElementById('hse-trn-session-btn-save')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-trn-session-form-alert');
  try {
    const body = {
      course_id: document.getElementById('hse-trn-session-f-course').value,
      project_id: document.getElementById('hse-trn-session-f-project').value.trim(),
      session_date: document.getElementById('hse-trn-session-f-date').value,
      location: document.getElementById('hse-trn-session-f-location').value.trim() || null,
      trainer_name: document.getElementById('hse-trn-session-f-trainer').value.trim() || null,
      trainer_organization: document.getElementById('hse-trn-session-f-trainer-org').value.trim() || null,
      notes: document.getElementById('hse-trn-session-f-notes').value.trim() || null,
    };
    await hseTrnFetch('/sessions', { method: 'POST', body });
    hseTrnSessionShowListView();
    hseTrnLoadSessionTable();
  } catch (e) {
    hseTrnAlert(alertEl, 'error', e.message);
  }
});

async function hseTrnSessionDelete(id) {
  if (!confirm('هل تريد إلغاء هذه الجلسة التدريبية؟ سيتم إلغاء تسجيل جميع المتدربين المرتبطين بها.')) return;
  try {
    await hseTrnFetch('/sessions/delete', { method: 'POST', body: { id } });
    hseTrnLoadSessionTable();
  } catch (e) {
    alert(e.message);
  }
}

async function hseTrnSessionShowDetail(id) {
  const ref = await hseTrnEnsureRefData();
  hseTrnSessionCurrentId = id;
  document.getElementById('hse-trn-session-list-view').style.display = 'none';
  document.getElementById('hse-trn-session-form-view').style.display = 'none';
  document.getElementById('hse-trn-session-detail-view').style.display = '';
  const content = document.getElementById('hse-trn-session-detail-content');
  ['hse-trn-enr-f-name', 'hse-trn-enr-f-employee', 'hse-trn-enr-f-role'].forEach(id2 => { const el = document.getElementById(id2); if (el) el.value = ''; });
  document.getElementById('hse-trn-enroll-form-alert').innerHTML = '';

  try {
    const res = await hseTrnFetch('/sessions/get', { query: { id } });
    const s = res.data;
    content.innerHTML = `
      <h3>${s.code} — ${hseTrnEsc(s.course?.title || '—')}
        <span class="tag">${ref.session_status_labels[s.status] || s.status}</span></h3>
      <p><strong>المشروع:</strong> ${hseTrnEsc(s.project_id)} &nbsp; <strong>التاريخ:</strong> ${s.session_date}
        &nbsp; <strong>المدرّب:</strong> ${hseTrnEsc(s.trainer_name || '—')}</p>
      ${s.location ? `<p><strong>الموقع:</strong> ${hseTrnEsc(s.location)}</p>` : ''}

      <div class="form-grid">
        <div class="field"><label>حالة الجلسة</label>
          <select id="hse-trn-session-d-status">${hseTrnOptionsHTML(ref.session_statuses, ref.session_status_labels)}</select>
        </div>
      </div>
      <button class="btn btn-outline" id="hse-trn-session-btn-update-status">تحديث حالة الجلسة</button>
      <div id="hse-trn-session-update-alert"></div>
    `;
    document.getElementById('hse-trn-session-d-status').value = s.status;
    document.getElementById('hse-trn-session-btn-update-status')?.addEventListener('click', async () => {
      const updAlert = document.getElementById('hse-trn-session-update-alert');
      try {
        await hseTrnFetch('/sessions/update', { method: 'POST', body: { id, updates: { status: document.getElementById('hse-trn-session-d-status').value } } });
        hseTrnSessionShowDetail(id);
      } catch (e) {
        hseTrnAlert(updAlert, 'error', e.message);
      }
    });

    hseTrnRenderEnrollTable(s.enrollments, ref);
  } catch (e) {
    hseTrnAlert(content, 'error', e.message);
  }
}

function hseTrnRenderEnrollTable(enrollments, ref) {
  const tbody = document.getElementById('hse-trn-enroll-tbody');
  tbody.innerHTML = enrollments.length ? enrollments.map(e => `
    <tr>
      <td>${hseTrnEsc(e.trainee_name)}</td>
      <td>${e.attendance ? 'حاضر' : 'غائب'}</td>
      <td>${e.test_score ?? '—'}</td>
      <td><span class="tag ${hseTrnResultTag(e.result)}">${ref.enrollment_result_labels[e.result] || e.result}</span></td>
      <td>${e.certificate_no || '—'}</td>
      <td>${e.certificate_expiry_date || '—'} ${e.certificate_status !== 'not_issued' ? `<span class="tag ${hseTrnCertTag(e.certificate_status)}">${ref.certificate_status_labels[e.certificate_status]}</span>` : ''}</td>
      <td>
        ${e.result === 'pending' || e.result === 'absent' ? `<button class="btn-icon" onclick="hseTrnRecordResultPrompt('${e.id}')">📝</button>` : ''}
        ${e.result === 'fail' ? `<button class="btn-icon" onclick="hseTrnRetake('${e.id}')">🔁</button>` : ''}
        <button class="btn-icon" onclick="hseTrnEnrollmentDelete('${e.id}')">🗑️</button>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا يوجد متدربون مسجَّلون في هذه الجلسة بعد</div></td></tr>`;
}

document.getElementById('hse-trn-enr-btn-add')?.addEventListener('click', async () => {
  const alertEl = document.getElementById('hse-trn-enroll-form-alert');
  try {
    const body = {
      session_id: hseTrnSessionCurrentId,
      trainee_name: document.getElementById('hse-trn-enr-f-name').value.trim(),
      employee_id: document.getElementById('hse-trn-enr-f-employee').value.trim() || null,
      trainee_role: document.getElementById('hse-trn-enr-f-role').value.trim() || null,
    };
    await hseTrnFetch('/enrollments', { method: 'POST', body });
    hseTrnSessionShowDetail(hseTrnSessionCurrentId);
  } catch (e) {
    hseTrnAlert(alertEl, 'error', e.message);
  }
});

async function hseTrnRecordResultPrompt(enrollmentId) {
  const attended = confirm('هل حضر المتدرب الجلسة؟\nOK = حضر (لإدخال درجة الاختبار) — إلغاء = غائب');
  try {
    if (!attended) {
      await hseTrnFetch('/enrollments/record-result', { method: 'POST', body: { id: enrollmentId, attendance: false } });
    } else {
      const scoreStr = prompt('أدخل درجة الاختبار (0-100):');
      if (scoreStr === null) return;
      const score = Number(scoreStr);
      if (isNaN(score) || score < 0 || score > 100) { alert('درجة غير صحيحة'); return; }
      await hseTrnFetch('/enrollments/record-result', { method: 'POST', body: { id: enrollmentId, test_score: score } });
    }
    hseTrnSessionShowDetail(hseTrnSessionCurrentId);
  } catch (e) {
    alert(e.message);
  }
}

async function hseTrnRetake(enrollmentId) {
  if (!confirm('إعادة فتح الاختبار لهذا المتدرب؟')) return;
  try {
    await hseTrnFetch('/enrollments/retake', { method: 'POST', body: { id: enrollmentId } });
    hseTrnSessionShowDetail(hseTrnSessionCurrentId);
  } catch (e) {
    alert(e.message);
  }
}

async function hseTrnEnrollmentDelete(enrollmentId) {
  if (!confirm('هل تريد إزالة هذا المتدرب من الجلسة؟')) return;
  try {
    await hseTrnFetch('/enrollments/delete', { method: 'POST', body: { id: enrollmentId } });
    hseTrnSessionShowDetail(hseTrnSessionCurrentId);
  } catch (e) {
    alert(e.message);
  }
}

// ================================================================
// الشهادات وصلاحيتها
// ================================================================

document.querySelector('[data-panel="hse-trn-certificates"]')?.addEventListener('click', () => hseTrnLoadCertificates());
document.getElementById('hse-trn-cert-btn-load')?.addEventListener('click', () => hseTrnLoadCertificates());

async function hseTrnLoadCertificates() {
  const cardsEl = document.getElementById('hse-trn-cert-cards');
  const tbody = document.getElementById('hse-trn-cert-tbody');
  const ref = await hseTrnEnsureRefData();
  try {
    const res = await hseTrnFetch('/certificates/expiring', {
      query: {
        projectId: document.getElementById('hse-trn-cert-project')?.value.trim(),
        withinDays: document.getElementById('hse-trn-cert-within')?.value || 30,
      },
    });
    cardsEl.innerHTML = `
      <div class="result-card"><div class="label">إجمالي الشهادات ضمن النطاق</div><div class="value">${res.count}</div></div>
      <div class="result-card"><div class="label">تنتهي قريباً</div><div class="value">${res.expiring_soon_count}</div></div>
      <div class="result-card"><div class="label">منتهية بالفعل</div><div class="value">${res.expired_count}</div></div>
    `;
    tbody.innerHTML = res.data.length ? res.data.map(e => `
      <tr>
        <td>${hseTrnEsc(e.trainee_name)}</td>
        <td>${e.certificate_no || '—'}</td>
        <td>${hseTrnEsc(e.course_id)}</td>
        <td>${e.completion_date || '—'}</td>
        <td>${e.certificate_expiry_date || '—'}</td>
        <td>${e.days_until_expiry ?? '—'}</td>
        <td><span class="tag ${hseTrnCertTag(e.certificate_status)}">${ref.certificate_status_labels[e.certificate_status] || e.certificate_status}</span></td>
      </tr>
    `).join('') : `<tr><td colspan="7"><div class="pm-empty-state">لا توجد شهادات ضمن هذا النطاق الزمني</div></td></tr>`;
  } catch (e) {
    hseTrnAlert(cardsEl, 'error', e.message);
  }
}
