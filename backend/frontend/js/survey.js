// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم العاشر: تطبيق المساحة (Surveying & Geospatial Management)
// الجزء 1/6: البنية الأساسية + لوحة التحكم + إدارة المشاريع المساحية +
//            إدارة أنظمة الإحداثيات + تحويل الإحداثيات
// الجزء 2/6: نقاط الرفع المساحي + حسابات المساحة الأساسية
// ============================================================

const SURVEY_API = '/api/survey';
let SURVEY_REF = null;
let surveyProjectEditingId = null;
let surveyCurrentProjectsCache = [];

// ---------- أدوات عامة ----------
function surveyFetch(path, { method = 'GET', body = null, query = null } = {}) {
  let url = `${SURVEY_API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  });
}

const SURVEY_STATUS_LABELS = {
  planning: 'التخطيط', active: 'جاري التنفيذ', on_hold: 'متوقف', completed: 'مكتمل', cancelled: 'ملغى',
};
const SURVEY_TYPE_LABELS = {
  land_survey: 'رفع أراضي', road_survey: 'رفع طرق', building_survey: 'رفع مباني',
  bridge_survey: 'رفع جسور', tunnel_survey: 'رفع أنفاق', network_survey: 'رفع شبكات',
  topographic: 'طبوغرافي', boundary: 'حدود', construction_layout: 'توقيع إنشائي', other: 'أخرى',
};
const SURVEY_CP_TYPE_LABELS = {
  survey_point: 'نقطة رفع', benchmark: 'نقطة مرجعية (Benchmark)', control_point: 'نقطة تحكم',
  network_point: 'نقطة شبكة', boundary_point: 'نقطة حدود', elevation_point: 'نقطة مناسيب',
};
const SURVEY_CALC_TYPE_LABELS = {
  distance: 'المسافة', bearing: 'الاتجاه (Bearing)', horizontal_angle: 'الزاوية الأفقية',
  slope: 'الميل', closed_area: 'مساحة مضلع مغلق', traverse_closure: 'إغلاق مضلع (Traverse)',
};
let surveyCpEditingId = null;

async function surveyLoadReferenceData() {
  try {
    const res = await surveyFetch('/reference-data');
    SURVEY_REF = res.data;
  } catch (e) {
    console.error('فشل تحميل بيانات مرجع المساحة', e);
  }
}
surveyLoadReferenceData();

// ============================================================
// لوحة التحكم
// ============================================================
async function surveyLoadDashboard() {
  const cardsEl = document.getElementById('survey-dash-cards');
  const projectsEl = document.getElementById('survey-recent-projects');
  const activityEl = document.getElementById('survey-recent-activity');
  if (!cardsEl) return;
  cardsEl.innerHTML = '<div class="result-card">جارِ التحميل...</div>';
  try {
    const { data } = await surveyFetch('/dashboard');
    cardsEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${data.total_projects}</div><div class="rc-label">إجمالي المشاريع المساحية</div></div>
      <div class="result-card"><div class="rc-value">${data.total_control_points}</div><div class="rc-label">نقاط الرفع</div></div>
      <div class="result-card"><div class="rc-value">${data.total_stakeout_points}</div><div class="rc-label">نقاط التوقيع</div></div>
      <div class="result-card"><div class="rc-value">${data.total_devices}</div><div class="rc-label">الأجهزة المرتبطة</div></div>
      <div class="result-card"><div class="rc-value">${data.total_maps}</div><div class="rc-label">الخرائط</div></div>
      <div class="result-card"><div class="rc-value">${data.total_coordinate_systems}</div><div class="rc-label">أنظمة الإحداثيات المعرَّفة</div></div>
      <div class="result-card"><div class="rc-value">${data.total_calculations_executed}</div><div class="rc-label">الحسابات المنفذة</div></div>
    `;
    projectsEl.innerHTML = data.recent_projects.length
      ? data.recent_projects.map((p) => `
        <div class="log-entry">
          <strong>${p.project_number}</strong> — ${p.name}
          <span class="badge">${SURVEY_STATUS_LABELS[p.status] || p.status}</span>
          <span class="log-date">${new Date(p.created_at).toLocaleString('ar-SA')}</span>
        </div>`).join('')
      : '<div class="log-entry">لا توجد مشاريع بعد</div>';
    activityEl.innerHTML = data.recent_activity.length
      ? data.recent_activity.map((a) => `
        <div class="log-entry">
          <strong>${a.action}</strong> — ${a.entity}
          <span class="log-date">${new Date(a.created_at).toLocaleString('ar-SA')}</span>
        </div>`).join('')
      : '<div class="log-entry">لا توجد عمليات مسجّلة بعد</div>';
  } catch (e) {
    cardsEl.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

// ============================================================
// إدارة المشاريع المساحية
// ============================================================
function surveyShowListView() {
  document.getElementById('survey-project-list-view').style.display = '';
  document.getElementById('survey-project-form-view').style.display = 'none';
  document.getElementById('survey-project-detail-view').style.display = 'none';
}
function surveyShowFormView() {
  document.getElementById('survey-project-list-view').style.display = 'none';
  document.getElementById('survey-project-form-view').style.display = '';
  document.getElementById('survey-project-detail-view').style.display = 'none';
}
function surveyShowDetailView() {
  document.getElementById('survey-project-list-view').style.display = 'none';
  document.getElementById('survey-project-form-view').style.display = 'none';
  document.getElementById('survey-project-detail-view').style.display = '';
}

async function surveyLoadProjects() {
  const tbody = document.getElementById('survey-projects-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">جارِ التحميل...</td></tr>';
  try {
    const query = {
      q: document.getElementById('survey-project-search').value || null,
      status: document.getElementById('survey-project-filter-status').value || null,
      project_type: document.getElementById('survey-project-filter-type').value || null,
    };
    const { data } = await surveyFetch('/projects', { query });
    surveyCurrentProjectsCache = data;
    tbody.innerHTML = data.length ? data.map((p) => `
      <tr>
        <td>${p.project_number}</td>
        <td>${p.name}</td>
        <td>${SURVEY_TYPE_LABELS[p.project_type] || p.project_type}</td>
        <td>${p.location || '-'}</td>
        <td>${p.responsible_engineer || '-'}</td>
        <td><span class="badge">${SURVEY_STATUS_LABELS[p.status] || p.status}</span></td>
        <td>
          <button class="btn btn-sm" data-survey-view="${p.id}">عرض</button>
          <button class="btn btn-sm" data-survey-edit="${p.id}">تعديل</button>
          <button class="btn btn-sm btn-danger" data-survey-delete="${p.id}">حذف</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="7">لا توجد مشاريع مساحية بعد</td></tr>';

    tbody.querySelectorAll('[data-survey-view]').forEach((btn) => {
      btn.addEventListener('click', () => surveyViewProject(btn.dataset.surveyView));
    });
    tbody.querySelectorAll('[data-survey-edit]').forEach((btn) => {
      btn.addEventListener('click', () => surveyEditProject(btn.dataset.surveyEdit));
    });
    tbody.querySelectorAll('[data-survey-delete]').forEach((btn) => {
      btn.addEventListener('click', () => surveyDeleteProject(btn.dataset.surveyDelete));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

function surveyResetForm() {
  surveyProjectEditingId = null;
  document.getElementById('survey-project-id').value = '';
  document.getElementById('survey-f-name').value = '';
  document.getElementById('survey-f-type').value = 'land_survey';
  document.getElementById('survey-f-location').value = '';
  document.getElementById('survey-f-lat').value = '';
  document.getElementById('survey-f-lon').value = '';
  document.getElementById('survey-f-city').value = '';
  document.getElementById('survey-f-country').value = '';
  document.getElementById('survey-f-engineer').value = '';
  document.getElementById('survey-f-start').value = '';
  document.getElementById('survey-f-end').value = '';
  document.getElementById('survey-f-status').value = 'planning';
  document.getElementById('survey-f-notes').value = '';
  document.getElementById('survey-form-error').textContent = '';
  document.getElementById('survey-project-form-title').textContent = 'مشروع مساحي جديد';
}

function surveyNewProject() {
  surveyResetForm();
  surveyShowFormView();
}

async function surveyEditProject(id) {
  try {
    const { data: p } = await surveyFetch('/projects/get', { query: { id } });
    surveyProjectEditingId = id;
    document.getElementById('survey-project-id').value = id;
    document.getElementById('survey-f-name').value = p.name || '';
    document.getElementById('survey-f-type').value = p.project_type || 'land_survey';
    document.getElementById('survey-f-location').value = p.location || '';
    document.getElementById('survey-f-lat').value = p.latitude ?? '';
    document.getElementById('survey-f-lon').value = p.longitude ?? '';
    document.getElementById('survey-f-city').value = p.city || '';
    document.getElementById('survey-f-country').value = p.country || '';
    document.getElementById('survey-f-engineer').value = p.responsible_engineer || '';
    document.getElementById('survey-f-start').value = p.start_date ? p.start_date.slice(0, 10) : '';
    document.getElementById('survey-f-end').value = p.end_date ? p.end_date.slice(0, 10) : '';
    document.getElementById('survey-f-status').value = p.status || 'planning';
    document.getElementById('survey-f-notes').value = p.notes || '';
    document.getElementById('survey-project-form-title').textContent = `تعديل: ${p.project_number}`;
    document.getElementById('survey-form-error').textContent = '';
    surveyShowFormView();
  } catch (e) {
    alert(e.message);
  }
}

async function surveyViewProject(id) {
  const body = document.getElementById('survey-detail-body');
  const title = document.getElementById('survey-detail-title');
  try {
    const { data: p } = await surveyFetch('/projects/get', { query: { id } });
    title.textContent = `${p.project_number} — ${p.name}`;
    body.innerHTML = `
      <div class="form-grid">
        <div><strong>النوع:</strong> ${SURVEY_TYPE_LABELS[p.project_type] || p.project_type}</div>
        <div><strong>الحالة:</strong> ${SURVEY_STATUS_LABELS[p.status] || p.status}</div>
        <div><strong>الموقع:</strong> ${p.location || '-'}</div>
        <div><strong>المدينة/الدولة:</strong> ${p.city || '-'} / ${p.country || '-'}</div>
        <div><strong>الإحداثيات:</strong> ${p.latitude ?? '-'}, ${p.longitude ?? '-'}</div>
        <div><strong>المهندس المسؤول:</strong> ${p.responsible_engineer || '-'}</div>
        <div><strong>تاريخ البداية:</strong> ${p.start_date ? p.start_date.slice(0, 10) : '-'}</div>
        <div><strong>تاريخ النهاية:</strong> ${p.end_date ? p.end_date.slice(0, 10) : '-'}</div>
        <div><strong>عدد نقاط الرفع:</strong> ${p.control_points_count}</div>
      </div>
      <h3 style="margin-top:16px">أنظمة الإحداثيات المرتبطة</h3>
      <table class="data-table">
        <thead><tr><th>الاسم</th><th>النوع</th><th>Datum</th><th>Zone</th><th>افتراضي</th></tr></thead>
        <tbody>
          ${(p.coordinate_systems || []).map((c) => `
            <tr><td>${c.name}</td><td>${c.system_type}</td><td>${c.datum}</td><td>${c.zone ?? '-'}</td><td>${c.is_default ? '✅' : ''}</td></tr>
          `).join('') || '<tr><td colspan="5">لا يوجد</td></tr>'}
        </tbody>
      </table>
      ${p.notes ? `<h3 style="margin-top:16px">ملاحظات</h3><p>${p.notes}</p>` : ''}
    `;
    surveyShowDetailView();
  } catch (e) {
    alert(e.message);
  }
}

async function surveyDeleteProject(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المشروع المساحي؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  try {
    await surveyFetch('/projects/delete', { method: 'POST', body: { id } });
    surveyLoadProjects();
  } catch (e) {
    alert(e.message);
  }
}

async function surveySaveProject() {
  const errEl = document.getElementById('survey-form-error');
  errEl.textContent = '';
  const payload = {
    name: document.getElementById('survey-f-name').value.trim(),
    project_type: document.getElementById('survey-f-type').value,
    location: document.getElementById('survey-f-location').value.trim(),
    latitude: document.getElementById('survey-f-lat').value ? Number(document.getElementById('survey-f-lat').value) : null,
    longitude: document.getElementById('survey-f-lon').value ? Number(document.getElementById('survey-f-lon').value) : null,
    city: document.getElementById('survey-f-city').value.trim(),
    country: document.getElementById('survey-f-country').value.trim(),
    responsible_engineer: document.getElementById('survey-f-engineer').value.trim(),
    start_date: document.getElementById('survey-f-start').value || null,
    end_date: document.getElementById('survey-f-end').value || null,
    status: document.getElementById('survey-f-status').value,
    notes: document.getElementById('survey-f-notes').value.trim(),
  };
  try {
    if (surveyProjectEditingId) {
      await surveyFetch('/projects/update', { method: 'POST', body: { id: surveyProjectEditingId, ...payload } });
    } else {
      await surveyFetch('/projects', { method: 'POST', body: payload });
    }
    surveyShowListView();
    surveyLoadProjects();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ============================================================
// أنظمة الإحداثيات
// ============================================================
async function surveyLoadCoordinateSystems() {
  const projectId = document.getElementById('survey-crs-project-id').value.trim();
  const tbody = document.getElementById('survey-crs-tbody');
  if (!projectId) { tbody.innerHTML = '<tr><td colspan="8">أدخل معرّف المشروع أولاً</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="8">جارِ التحميل...</td></tr>';
  try {
    const { data } = await surveyFetch('/coordinate-systems', { query: { project_id: projectId } });
    tbody.innerHTML = data.length ? data.map((c) => `
      <tr>
        <td>${c.name}</td><td>${c.system_type}</td><td>${c.datum}</td>
        <td>${c.zone ?? '-'}</td><td>${c.hemisphere ?? '-'}</td><td>${c.projection || '-'}</td>
        <td>${c.is_default ? '✅' : ''}</td>
        <td>
          ${!c.is_default ? `<button class="btn btn-sm" data-crs-default="${c.id}">اجعله افتراضي</button>` : ''}
          <button class="btn btn-sm btn-danger" data-crs-delete="${c.id}">حذف</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="8">لا توجد أنظمة إحداثيات لهذا المشروع بعد</td></tr>';

    tbody.querySelectorAll('[data-crs-default]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await surveyFetch('/coordinate-systems/set-default', { method: 'POST', body: { id: btn.dataset.crsDefault } });
        surveyLoadCoordinateSystems();
      });
    });
    tbody.querySelectorAll('[data-crs-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('حذف نظام الإحداثيات هذا؟')) return;
        await surveyFetch('/coordinate-systems/delete', { method: 'POST', body: { id: btn.dataset.crsDelete } });
        surveyLoadCoordinateSystems();
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

async function surveyAddCoordinateSystem() {
  const errEl = document.getElementById('survey-crs-error');
  errEl.textContent = '';
  const projectId = document.getElementById('survey-crs-project-id').value.trim();
  if (!projectId) { errEl.textContent = 'أدخل معرّف المشروع أولاً'; return; }
  const payload = {
    project_id: projectId,
    system_type: document.getElementById('survey-crs-f-type').value,
    datum: document.getElementById('survey-crs-f-datum').value,
    zone: document.getElementById('survey-crs-f-zone').value ? Number(document.getElementById('survey-crs-f-zone').value) : null,
    hemisphere: document.getElementById('survey-crs-f-hemisphere').value,
    name: document.getElementById('survey-crs-f-name').value.trim() || undefined,
  };
  try {
    await surveyFetch('/coordinate-systems', { method: 'POST', body: payload });
    document.getElementById('survey-crs-f-name').value = '';
    document.getElementById('survey-crs-f-zone').value = '';
    surveyLoadCoordinateSystems();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ============================================================
// تحويل الإحداثيات
// ============================================================
function surveyUpdateConvertInputs() {
  const dir = document.getElementById('survey-conv-direction').value;
  document.getElementById('survey-conv-geo-inputs').style.display = dir === 'GEO_TO_UTM' ? '' : 'none';
  document.getElementById('survey-conv-utm-inputs').style.display = dir === 'UTM_TO_GEO' ? '' : 'none';
}

async function surveyConvertCoordinates() {
  const errEl = document.getElementById('survey-conv-error');
  const resultEl = document.getElementById('survey-conv-result');
  errEl.textContent = '';
  resultEl.innerHTML = '';
  const dir = document.getElementById('survey-conv-direction').value;
  try {
    let payload;
    if (dir === 'GEO_TO_UTM') {
      payload = {
        from: 'GEOGRAPHIC',
        to: 'UTM',
        input: {
          lat: Number(document.getElementById('survey-conv-lat').value),
          lon: Number(document.getElementById('survey-conv-lon').value),
        },
      };
    } else {
      payload = {
        from: 'UTM',
        to: 'GEOGRAPHIC',
        input: {
          easting: Number(document.getElementById('survey-conv-easting').value),
          northing: Number(document.getElementById('survey-conv-northing').value),
          zone: Number(document.getElementById('survey-conv-zone').value),
          hemisphere: document.getElementById('survey-conv-hemisphere').value,
        },
      };
    }
    const { data } = await surveyFetch('/coordinates/convert', { method: 'POST', body: payload });
    if (dir === 'GEO_TO_UTM') {
      resultEl.innerHTML = `
        <div class="result-card"><div class="rc-value">${data.easting}</div><div class="rc-label">Easting (م)</div></div>
        <div class="result-card"><div class="rc-value">${data.northing}</div><div class="rc-label">Northing (م)</div></div>
        <div class="result-card"><div class="rc-value">${data.zone}${data.hemisphere}</div><div class="rc-label">منطقة UTM</div></div>
        <div class="result-card"><div class="rc-value">${data.central_meridian}°</div><div class="rc-label">خط الطول المرجعي</div></div>
      `;
    } else {
      resultEl.innerHTML = `
        <div class="result-card"><div class="rc-value">${data.lat}</div><div class="rc-label">خط العرض (Latitude)</div></div>
        <div class="result-card"><div class="rc-value">${data.lon}</div><div class="rc-label">خط الطول (Longitude)</div></div>
      `;
    }
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function surveyExportProjects() {
  try {
    const query = {
      q: document.getElementById('survey-project-search').value || null,
      status: document.getElementById('survey-project-filter-status').value || null,
      project_type: document.getElementById('survey-project-filter-type').value || null,
    };
    const { data } = await surveyFetch('/projects/export-csv', { query });
    window.open(data.url, '_blank');
  } catch (e) {
    alert(e.message);
  }
}

async function surveyExportCoordinateSystems() {
  const projectId = document.getElementById('survey-crs-project-id').value.trim();
  if (!projectId) { alert('أدخل معرّف المشروع أولاً'); return; }
  try {
    const { data } = await surveyFetch('/coordinate-systems/export-csv', { query: { project_id: projectId } });
    window.open(data.url, '_blank');
  } catch (e) {
    alert(e.message);
  }
}

// ============================================================
// نقاط الرفع المساحي (الجزء 2/6)
// ============================================================
function surveyCpShowListView() {
  document.getElementById('survey-cp-list-view').style.display = '';
  document.getElementById('survey-cp-form-view').style.display = 'none';
}
function surveyCpShowFormView() {
  document.getElementById('survey-cp-list-view').style.display = 'none';
  document.getElementById('survey-cp-form-view').style.display = '';
}

async function surveyLoadControlPoints() {
  const projectId = document.getElementById('survey-cp-project-id').value.trim();
  const tbody = document.getElementById('survey-cp-tbody');
  if (!projectId) { tbody.innerHTML = '<tr><td colspan="9">أدخل معرّف المشروع أولاً</td></tr>'; return; }
  tbody.innerHTML = '<tr><td colspan="9">جارِ التحميل...</td></tr>';
  try {
    const query = {
      project_id: projectId,
      q: document.getElementById('survey-cp-search').value || null,
      point_type: document.getElementById('survey-cp-filter-type').value || null,
    };
    const { data } = await surveyFetch('/control-points', { query });
    tbody.innerHTML = data.length ? data.map((p) => `
      <tr>
        <td>${p.point_number}</td>
        <td>${p.name || '-'}</td>
        <td>${SURVEY_CP_TYPE_LABELS[p.point_type] || p.point_type}</td>
        <td>${p.easting}</td>
        <td>${p.northing}</td>
        <td>${p.elevation ?? '-'}</td>
        <td>${p.device_used || '-'}</td>
        <td>${p.accuracy ?? '-'}</td>
        <td>
          <button class="btn btn-sm" data-cp-edit="${p.id}">تعديل</button>
          <button class="btn btn-sm btn-danger" data-cp-delete="${p.id}">حذف</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="9">لا توجد نقاط رفع لهذا المشروع بعد</td></tr>';

    tbody.querySelectorAll('[data-cp-edit]').forEach((btn) => {
      btn.addEventListener('click', () => surveyEditControlPoint(btn.dataset.cpEdit));
    });
    tbody.querySelectorAll('[data-cp-delete]').forEach((btn) => {
      btn.addEventListener('click', () => surveyDeleteControlPoint(btn.dataset.cpDelete));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

function surveyCpResetForm() {
  surveyCpEditingId = null;
  const currentProjectId = document.getElementById('survey-cp-project-id').value.trim();
  document.getElementById('survey-cp-id').value = '';
  document.getElementById('survey-cp-f-project-id').value = currentProjectId;
  document.getElementById('survey-cp-f-number').value = '';
  document.getElementById('survey-cp-f-name').value = '';
  document.getElementById('survey-cp-f-type').value = 'survey_point';
  document.getElementById('survey-cp-f-easting').value = '';
  document.getElementById('survey-cp-f-northing').value = '';
  document.getElementById('survey-cp-f-elevation').value = '';
  document.getElementById('survey-cp-f-accuracy').value = '';
  document.getElementById('survey-cp-f-date').value = '';
  document.getElementById('survey-cp-f-device').value = '';
  document.getElementById('survey-cp-f-description').value = '';
  document.getElementById('survey-cp-f-notes').value = '';
  document.getElementById('survey-cp-form-error').textContent = '';
  document.getElementById('survey-cp-form-title').textContent = 'نقطة رفع جديدة';
}

function surveyNewControlPoint() {
  surveyCpResetForm();
  surveyCpShowFormView();
}

async function surveyEditControlPoint(id) {
  try {
    const { data: p } = await surveyFetch('/control-points/get', { query: { id } });
    surveyCpEditingId = id;
    document.getElementById('survey-cp-id').value = id;
    document.getElementById('survey-cp-f-project-id').value = p.project_id;
    document.getElementById('survey-cp-f-number').value = p.point_number || '';
    document.getElementById('survey-cp-f-name').value = p.name || '';
    document.getElementById('survey-cp-f-type').value = p.point_type || 'survey_point';
    document.getElementById('survey-cp-f-easting').value = p.easting;
    document.getElementById('survey-cp-f-northing').value = p.northing;
    document.getElementById('survey-cp-f-elevation').value = p.elevation ?? '';
    document.getElementById('survey-cp-f-accuracy').value = p.accuracy ?? '';
    document.getElementById('survey-cp-f-date').value = p.measurement_date ? String(p.measurement_date).slice(0, 10) : '';
    document.getElementById('survey-cp-f-device').value = p.device_used || '';
    document.getElementById('survey-cp-f-description').value = p.description || '';
    document.getElementById('survey-cp-f-notes').value = p.notes || '';
    document.getElementById('survey-cp-form-title').textContent = `تعديل: ${p.point_number}`;
    document.getElementById('survey-cp-form-error').textContent = '';
    surveyCpShowFormView();
  } catch (e) {
    alert(e.message);
  }
}

async function surveyDeleteControlPoint(id) {
  if (!confirm('هل أنت متأكد من حذف نقطة الرفع هذه؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  try {
    await surveyFetch('/control-points/delete', { method: 'POST', body: { id } });
    surveyLoadControlPoints();
  } catch (e) {
    alert(e.message);
  }
}

async function surveySaveControlPoint() {
  const errEl = document.getElementById('survey-cp-form-error');
  errEl.textContent = '';
  const projectId = document.getElementById('survey-cp-f-project-id').value.trim();
  if (!projectId) { errEl.textContent = 'معرّف المشروع مطلوب'; return; }
  const payload = {
    project_id: projectId,
    point_number: document.getElementById('survey-cp-f-number').value.trim() || undefined,
    name: document.getElementById('survey-cp-f-name').value.trim(),
    point_type: document.getElementById('survey-cp-f-type').value,
    easting: document.getElementById('survey-cp-f-easting').value,
    northing: document.getElementById('survey-cp-f-northing').value,
    elevation: document.getElementById('survey-cp-f-elevation').value || null,
    accuracy: document.getElementById('survey-cp-f-accuracy').value || null,
    measurement_date: document.getElementById('survey-cp-f-date').value || null,
    device_used: document.getElementById('survey-cp-f-device').value.trim(),
    description: document.getElementById('survey-cp-f-description').value.trim(),
    notes: document.getElementById('survey-cp-f-notes').value.trim(),
  };
  try {
    if (surveyCpEditingId) {
      await surveyFetch('/control-points/update', { method: 'POST', body: { id: surveyCpEditingId, ...payload } });
    } else {
      await surveyFetch('/control-points', { method: 'POST', body: payload });
    }
    document.getElementById('survey-cp-project-id').value = projectId;
    surveyCpShowListView();
    surveyLoadControlPoints();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function surveyExportControlPoints() {
  const projectId = document.getElementById('survey-cp-project-id').value.trim();
  if (!projectId) { alert('أدخل معرّف المشروع أولاً'); return; }
  try {
    const query = {
      project_id: projectId,
      point_type: document.getElementById('survey-cp-filter-type').value || null,
    };
    const { data } = await surveyFetch('/control-points/export-csv', { query });
    window.open(data.url, '_blank');
  } catch (e) {
    alert(e.message);
  }
}

// ============================================================
// حسابات المساحة الأساسية (الجزء 2/6)
// ============================================================
function surveyUpdateCalcInputs() {
  const type = document.getElementById('survey-calc-type').value;
  document.getElementById('survey-calc-2points').style.display = ['distance', 'bearing', 'slope'].includes(type) ? '' : 'none';
  document.getElementById('survey-calc-3points').style.display = type === 'horizontal_angle' ? '' : 'none';
  document.getElementById('survey-calc-polygon').style.display = type === 'closed_area' ? '' : 'none';
  document.getElementById('survey-calc-traverse').style.display = type === 'traverse_closure' ? '' : 'none';
}

function surveyParseNum(id) {
  const v = document.getElementById(id).value;
  return v === '' ? undefined : Number(v);
}

function surveyParsePointLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(',').map((s) => s.trim());
    return { easting: Number(parts[0]), northing: Number(parts[1]) };
  });
}

function surveyParseLegLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(',').map((s) => s.trim());
    return { distance: Number(parts[0]), azimuth: Number(parts[1]) };
  });
}

function surveyRenderCalcResult(calcType, result) {
  const resultEl = document.getElementById('survey-calc-result');
  const extraEl = document.getElementById('survey-calc-result-extra');
  extraEl.innerHTML = '';
  if (calcType === 'distance') {
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.horizontal_distance}</div><div class="rc-label">المسافة الأفقية (م)</div></div>
      <div class="result-card"><div class="rc-value">${result.slope_distance}</div><div class="rc-label">المسافة المائلة (م)</div></div>
      <div class="result-card"><div class="rc-value">${result.elevation_difference ?? '-'}</div><div class="rc-label">فرق المنسوب (م)</div></div>
    `;
  } else if (calcType === 'bearing') {
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.quadrant_bearing}</div><div class="rc-label">الاتجاه (Quadrant Bearing)</div></div>
      <div class="result-card"><div class="rc-value">${result.azimuth_decimal_degrees}°</div><div class="rc-label">Azimuth (درجات عشرية)</div></div>
    `;
  } else if (calcType === 'horizontal_angle') {
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.horizontal_angle_degrees}°</div><div class="rc-label">الزاوية الأفقية</div></div>
      <div class="result-card"><div class="rc-value">${result.bearing_to_backsight}°</div><div class="rc-label">اتجاه الخلفية</div></div>
      <div class="result-card"><div class="rc-value">${result.bearing_to_foresight}°</div><div class="rc-label">اتجاه الأمام</div></div>
    `;
  } else if (calcType === 'slope') {
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.slope_percent}%</div><div class="rc-label">نسبة الميل</div></div>
      <div class="result-card"><div class="rc-value">${result.slope_angle_degrees}°</div><div class="rc-label">زاوية الميل</div></div>
      <div class="result-card"><div class="rc-value">${result.direction}</div><div class="rc-label">الاتجاه</div></div>
      <div class="result-card"><div class="rc-value">${result.horizontal_distance}</div><div class="rc-label">المسافة الأفقية (م)</div></div>
    `;
  } else if (calcType === 'closed_area') {
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.area_sqm}</div><div class="rc-label">المساحة (م²)</div></div>
      <div class="result-card"><div class="rc-value">${result.area_hectares}</div><div class="rc-label">المساحة (هكتار)</div></div>
      <div class="result-card"><div class="rc-value">${result.area_donum}</div><div class="rc-label">المساحة (دونم)</div></div>
      <div class="result-card"><div class="rc-value">${result.perimeter_m}</div><div class="rc-label">المحيط (م)</div></div>
    `;
  } else if (calcType === 'traverse_closure') {
    const c = result.closure_error;
    resultEl.innerHTML = `
      <div class="result-card"><div class="rc-value">${result.total_traverse_length}</div><div class="rc-label">الطول الإجمالي (م)</div></div>
      <div class="result-card"><div class="rc-value">${c.linear_closure_error}</div><div class="rc-label">خطأ الإغلاق الخطي (م)</div></div>
      <div class="result-card"><div class="rc-value">${c.precision_ratio}</div><div class="rc-label">نسبة الدقة</div></div>
      <div class="result-card"><div class="rc-value">${c.accuracy_acceptable ? '✅ مقبول' : '❌ غير مقبول'}</div><div class="rc-label">وفق معيار 1/5000</div></div>
    `;
    extraEl.innerHTML = `
      <h3 style="margin-top:16px">الأضلاع بعد التصحيح (Bowditch)</h3>
      <table class="data-table">
        <thead><tr><th>#</th><th>المسافة</th><th>الاتجاه</th><th>Easting المصحح</th><th>Northing المصحح</th></tr></thead>
        <tbody>
          ${result.corrected_legs.map((l) => `
            <tr><td>${l.leg_number}</td><td>${l.distance}</td><td>${l.azimuth}°</td><td>${l.corrected_easting}</td><td>${l.corrected_northing}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

async function surveyRunCalculation() {
  const errEl = document.getElementById('survey-calc-error');
  const resultEl = document.getElementById('survey-calc-result');
  const extraEl = document.getElementById('survey-calc-result-extra');
  errEl.textContent = '';
  resultEl.innerHTML = '';
  extraEl.innerHTML = '';
  const calcType = document.getElementById('survey-calc-type').value;
  const projectId = document.getElementById('survey-calc-project-id').value.trim() || null;

  let input;
  try {
    if (['distance', 'bearing', 'slope'].includes(calcType)) {
      input = {
        point1: {
          easting: surveyParseNum('survey-calc-p1-e'), northing: surveyParseNum('survey-calc-p1-n'),
          elevation: surveyParseNum('survey-calc-p1-z'),
        },
        point2: {
          easting: surveyParseNum('survey-calc-p2-e'), northing: surveyParseNum('survey-calc-p2-n'),
          elevation: surveyParseNum('survey-calc-p2-z'),
        },
      };
    } else if (calcType === 'horizontal_angle') {
      input = {
        backsight: { easting: surveyParseNum('survey-calc-back-e'), northing: surveyParseNum('survey-calc-back-n') },
        station: { easting: surveyParseNum('survey-calc-sta-e'), northing: surveyParseNum('survey-calc-sta-n') },
        foresight: { easting: surveyParseNum('survey-calc-fore-e'), northing: surveyParseNum('survey-calc-fore-n') },
      };
    } else if (calcType === 'closed_area') {
      const points = surveyParsePointLines(document.getElementById('survey-calc-polygon-points').value);
      input = { points };
    } else if (calcType === 'traverse_closure') {
      const legs = surveyParseLegLines(document.getElementById('survey-calc-traverse-legs').value);
      input = {
        startPoint: { easting: surveyParseNum('survey-calc-trav-start-e'), northing: surveyParseNum('survey-calc-trav-start-n') },
        legs,
      };
    }
    const { data } = await surveyFetch('/calculations/run', {
      method: 'POST', body: { project_id: projectId, calc_type: calcType, input },
    });
    surveyRenderCalcResult(calcType, data.result);
    surveyLoadCalculationHistory();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function surveySummarizeCalcResult(calcType, result) {
  if (calcType === 'distance') return `مسافة أفقية: ${result.horizontal_distance} م`;
  if (calcType === 'bearing') return `${result.quadrant_bearing}`;
  if (calcType === 'horizontal_angle') return `الزاوية: ${result.horizontal_angle_degrees}°`;
  if (calcType === 'slope') return `الميل: ${result.slope_percent}%`;
  if (calcType === 'closed_area') return `المساحة: ${result.area_sqm} م²`;
  if (calcType === 'traverse_closure') return `دقة الإغلاق: ${result.closure_error.precision_ratio}`;
  return '-';
}

async function surveyLoadCalculationHistory() {
  const tbody = document.getElementById('survey-calc-history-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4">جارِ التحميل...</td></tr>';
  try {
    const projectId = document.getElementById('survey-calc-project-id').value.trim() || null;
    const { data } = await surveyFetch('/calculations', { query: { project_id: projectId } });
    tbody.innerHTML = data.length ? data.map((c) => `
      <tr>
        <td>${SURVEY_CALC_TYPE_LABELS[c.calc_type] || c.calc_type}</td>
        <td>${c.project_id || '-'}</td>
        <td>${new Date(c.created_at).toLocaleString('ar-SA')}</td>
        <td>${surveySummarizeCalcResult(c.calc_type, c.result)}</td>
      </tr>`).join('') : '<tr><td colspan="4">لا توجد حسابات مسجّلة بعد</td></tr>';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

// ============================================================
// ربط الأحداث
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const btnDash = document.getElementById('survey-btn-load-dashboard');
  if (btnDash) btnDash.addEventListener('click', surveyLoadDashboard);

  const btnNewProject = document.getElementById('survey-btn-new-project');
  if (btnNewProject) btnNewProject.addEventListener('click', surveyNewProject);

  const btnExportProjects = document.getElementById('survey-btn-export-projects');
  if (btnExportProjects) btnExportProjects.addEventListener('click', surveyExportProjects);

  const btnExportCrs = document.getElementById('survey-btn-export-crs');
  if (btnExportCrs) btnExportCrs.addEventListener('click', surveyExportCoordinateSystems);

  const btnSaveProject = document.getElementById('survey-btn-save-project');
  if (btnSaveProject) btnSaveProject.addEventListener('click', surveySaveProject);

  const btnCancelProject = document.getElementById('survey-btn-cancel-project');
  if (btnCancelProject) btnCancelProject.addEventListener('click', surveyShowListView);

  const btnBackToList = document.getElementById('survey-btn-back-to-list');
  if (btnBackToList) btnBackToList.addEventListener('click', surveyShowListView);

  ['survey-project-search', 'survey-project-filter-status', 'survey-project-filter-type'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', surveyLoadProjects);
    if (el) el.addEventListener('change', surveyLoadProjects);
  });

  const btnLoadCrs = document.getElementById('survey-btn-load-crs');
  if (btnLoadCrs) btnLoadCrs.addEventListener('click', surveyLoadCoordinateSystems);

  const btnAddCrs = document.getElementById('survey-btn-add-crs');
  if (btnAddCrs) btnAddCrs.addEventListener('click', surveyAddCoordinateSystem);

  const convDir = document.getElementById('survey-conv-direction');
  if (convDir) convDir.addEventListener('change', surveyUpdateConvertInputs);

  const btnConvert = document.getElementById('survey-btn-convert');
  if (btnConvert) btnConvert.addEventListener('click', surveyConvertCoordinates);

  // ---- نقاط الرفع المساحي ----
  const btnLoadCp = document.getElementById('survey-btn-load-cp');
  if (btnLoadCp) btnLoadCp.addEventListener('click', surveyLoadControlPoints);

  const btnNewCp = document.getElementById('survey-btn-new-cp');
  if (btnNewCp) btnNewCp.addEventListener('click', surveyNewControlPoint);

  const btnSaveCp = document.getElementById('survey-btn-save-cp');
  if (btnSaveCp) btnSaveCp.addEventListener('click', surveySaveControlPoint);

  const btnCancelCp = document.getElementById('survey-btn-cancel-cp');
  if (btnCancelCp) btnCancelCp.addEventListener('click', surveyCpShowListView);

  const btnExportCp = document.getElementById('survey-btn-export-cp');
  if (btnExportCp) btnExportCp.addEventListener('click', surveyExportControlPoints);

  ['survey-cp-search', 'survey-cp-filter-type'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', surveyLoadControlPoints);
    if (el) el.addEventListener('change', surveyLoadControlPoints);
  });

  // ---- حسابات المساحة ----
  const calcTypeSel = document.getElementById('survey-calc-type');
  if (calcTypeSel) calcTypeSel.addEventListener('change', surveyUpdateCalcInputs);

  const btnRunCalc = document.getElementById('survey-btn-run-calc');
  if (btnRunCalc) btnRunCalc.addEventListener('click', surveyRunCalculation);

  const btnLoadCalcHistory = document.getElementById('survey-btn-load-calc-history');
  if (btnLoadCalcHistory) btnLoadCalcHistory.addEventListener('click', surveyLoadCalculationHistory);

  // تحميل اللوحات عند فتحها لأول مرة عبر نظام nav.js/app.js الحالي
  document.querySelectorAll('.nav-item[data-panel^="survey-"]').forEach((item) => {
    item.addEventListener('click', () => {
      const panel = item.dataset.panel;
      if (panel === 'survey-dashboard') surveyLoadDashboard();
      if (panel === 'survey-projects') surveyLoadProjects();
      if (panel === 'survey-control-points') surveyCpShowListView();
      if (panel === 'survey-calculations') { surveyUpdateCalcInputs(); surveyLoadCalculationHistory(); }
    });
  });
});
