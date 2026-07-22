// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم العاشر: تطبيق المساحة — الرسومات التلقائية + الخرائط التفاعلية (Leaflet)
// يعتمد على surveyFetch المعرَّفة في survey.js (يجب تحميل survey.js قبل هذا الملف)
// ============================================================

// ------------------------------------------------------------
// الرسومات التلقائية
// ------------------------------------------------------------
const SVYDWG_HISTORY = [];

const SVYDWG_ENDPOINTS = {
  auto: '/drawings/auto',
  contour: '/drawings/contour',
  'longitudinal-section': '/drawings/longitudinal-section',
  'cross-section': '/drawings/cross-section',
  'dtm-3d': '/drawings/dtm-3d',
  'point-plot': '/drawings/point-plot',
};

const SVYDWG_TYPE_LABELS = {
  contour: 'خطوط الكنتور',
  longitudinal_section: 'المقطع الطولي',
  cross_section: 'المقطع العرضي',
  dtm_3d: 'نموذج سطح الأرض الرقمي (DTM)',
  point_plot: 'مخطط نقاط الرفع',
};

function svydwgRenderHistory() {
  const el = document.getElementById('svydwg-history');
  if (!el) return;
  if (!SVYDWG_HISTORY.length) {
    el.innerHTML = '<p class="muted">لا توجد رسومات مولَّدة بعد في هذه الجلسة.</p>';
    return;
  }
  el.innerHTML = SVYDWG_HISTORY.slice().reverse().map((d) => `
    <div class="pm-activity-item">
      <strong>${SVYDWG_TYPE_LABELS[d.type] || d.type}</strong> — ${d.title}
      <br><a href="${d.url}" target="_blank" rel="noopener">فتح/عرض الرسم</a>
      &nbsp;|&nbsp;
      <a href="${d.url}" download>تنزيل SVG</a>
    </div>
  `).join('');
}

async function svydwgGenerate() {
  const errEl = document.getElementById('svydwg-error');
  const resultEl = document.getElementById('svydwg-result');
  errEl.textContent = '';
  resultEl.innerHTML = '';
  const surveyId = document.getElementById('svydwg-survey-id').value.trim();
  const type = document.getElementById('svydwg-type').value;
  if (!surveyId) { errEl.textContent = 'يرجى إدخال معرّف عملية الرفع (Survey ID)'; return; }
  try {
    const { data } = await surveyFetch(SVYDWG_ENDPOINTS[type], { method: 'POST', body: { survey_id: surveyId } });
    SVYDWG_HISTORY.push(data);
    resultEl.innerHTML = `
      <h3>${data.title}</h3>
      <div class="result-box" style="padding:0;overflow:auto;background:#fff">
        <img src="${data.url}" alt="${data.title}" style="max-width:100%;display:block;margin:0 auto">
      </div>
      <div class="toolbar" style="margin-top:10px">
        <a class="btn btn-primary" href="${data.url}" target="_blank" rel="noopener">فتح في نافذة جديدة</a>
        <a class="btn" href="${data.url}" download>تنزيل الرسم (SVG)</a>
      </div>
    `;
    svydwgRenderHistory();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ------------------------------------------------------------
// الخرائط التفاعلية (Leaflet) — خريطة المشاريع
// ------------------------------------------------------------
let SVYMAP_MAIN = null;
let SVYMAP_MAIN_LAYERS = {};
let SVYMAP_MAIN_MARKERS = [];

const SVYMAP_TILE_LAYERS = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap', maxZoom: 17 },
  },
};

function svymapEnsureMainMap() {
  if (SVYMAP_MAIN) return SVYMAP_MAIN;
  SVYMAP_MAIN = L.map('svymap-container').setView([24.7136, 46.6753], 6); // الرياض كمركز افتراضي
  Object.entries(SVYMAP_TILE_LAYERS).forEach(([key, cfg]) => {
    SVYMAP_MAIN_LAYERS[key] = L.tileLayer(cfg.url, cfg.options);
  });
  SVYMAP_MAIN_LAYERS.street.addTo(SVYMAP_MAIN);
  return SVYMAP_MAIN;
}

function svymapSwitchLayer(layerKey) {
  const map = svymapEnsureMainMap();
  Object.values(SVYMAP_MAIN_LAYERS).forEach((layer) => { if (map.hasLayer(layer)) map.removeLayer(layer); });
  (SVYMAP_MAIN_LAYERS[layerKey] || SVYMAP_MAIN_LAYERS.street).addTo(map);
}

async function svymapLoadProjects() {
  const errEl = document.getElementById('svymap-error');
  errEl.textContent = '';
  const map = svymapEnsureMainMap();
  SVYMAP_MAIN_MARKERS.forEach((m) => map.removeLayer(m));
  SVYMAP_MAIN_MARKERS = [];
  try {
    const { data } = await surveyFetch('/projects', { query: { pageSize: 1000 } });
    const withCoords = (data || []).filter((p) => p.latitude !== null && p.latitude !== undefined
      && p.longitude !== null && p.longitude !== undefined);
    if (!withCoords.length) {
      errEl.textContent = 'لا توجد مشاريع مساحية بها إحداثيات (latitude/longitude) لعرضها على الخريطة بعد.';
      return;
    }
    const bounds = [];
    withCoords.forEach((p) => {
      const marker = L.marker([p.latitude, p.longitude]).addTo(map);
      marker.bindPopup(`
        <strong>${p.name}</strong><br>
        رقم المشروع: ${p.project_number}<br>
        الحالة: ${p.status}<br>
        المهندس المسؤول: ${p.responsible_engineer || '-'}<br>
        المدينة: ${p.city || '-'}
      `);
      SVYMAP_MAIN_MARKERS.push(marker);
      bounds.push([p.latitude, p.longitude]);
    });
    if (bounds.length === 1) {
      map.setView(bounds[0], 12);
    } else {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function svymapSearchPlace() {
  const errEl = document.getElementById('svymap-error');
  errEl.textContent = '';
  const q = document.getElementById('svymap-search').value.trim();
  if (!q) return;
  try {
    const map = svymapEnsureMainMap();
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, {
      headers: { Accept: 'application/json' },
    });
    const results = await resp.json();
    if (!results || !results.length) { errEl.textContent = 'لم يتم العثور على نتائج لهذا الموقع'; return; }
    const { lat, lon, display_name: displayName } = results[0];
    map.setView([Number(lat), Number(lon)], 13);
    L.popup().setLatLng([Number(lat), Number(lon)]).setContent(displayName).openOn(map);
  } catch (e) {
    errEl.textContent = 'تعذّر البحث عن الموقع (تحقق من الاتصال بالإنترنت)';
  }
}

// ------------------------------------------------------------
// خريطة عرض نقاط عملية رفع محددة
// ------------------------------------------------------------
let SVYMAP_REC = null;
let SVYMAP_REC_LAYER = null;

function svymapEnsureRecMap() {
  if (SVYMAP_REC) return SVYMAP_REC;
  SVYMAP_REC = L.map('svymap-rec-container').setView([24.7136, 46.6753], 6);
  L.tileLayer(SVYMAP_TILE_LAYERS.street.url, SVYMAP_TILE_LAYERS.street.options).addTo(SVYMAP_REC);
  return SVYMAP_REC;
}

/** يحاول استخراج lat/lon من نقطة رفع: يدعم إما lat/lon مباشرة أو easting/northing + منطقة UTM */
async function svymapPointToLatLon(point, utmZoneInput) {
  if (point.lat !== undefined && point.lon !== undefined) {
    return { lat: Number(point.lat), lon: Number(point.lon) };
  }
  if (point.latitude !== undefined && point.longitude !== undefined) {
    return { lat: Number(point.latitude), lon: Number(point.longitude) };
  }
  if (point.easting !== undefined && point.northing !== undefined && utmZoneInput) {
    const match = /^(\d+)\s*([NnSs])?$/.exec(utmZoneInput.trim());
    if (!match) throw new Error('صيغة منطقة UTM غير صحيحة. مثال صحيح: 38N');
    const zone = Number(match[1]);
    const hemisphere = (match[2] || 'N').toUpperCase();
    const { data } = await surveyFetch('/coordinates/convert', {
      method: 'POST',
      body: {
        from: 'UTM',
        to: 'GEOGRAPHIC',
        input: { easting: Number(point.easting), northing: Number(point.northing), zone, hemisphere },
      },
    });
    return { lat: data.latitude, lon: data.longitude };
  }
  return null;
}

async function svymapLoadRecord() {
  const errEl = document.getElementById('svymap-rec-error');
  errEl.textContent = '';
  const surveyId = document.getElementById('svymap-rec-survey-id').value.trim();
  const utmZone = document.getElementById('svymap-rec-utm-zone').value.trim();
  if (!surveyId) { errEl.textContent = 'يرجى إدخال معرّف عملية الرفع'; return; }

  const map = svymapEnsureRecMap();
  if (SVYMAP_REC_LAYER) { map.removeLayer(SVYMAP_REC_LAYER); SVYMAP_REC_LAYER = null; }

  try {
    const { data: rec } = await surveyFetch('/records/get', { query: { id: surveyId } });
    const points = rec.points || [];
    if (!points.length) { errEl.textContent = 'لا توجد نقاط مخزَّنة لهذه العملية'; return; }

    const latlngs = [];
    const markers = [];
    for (let i = 0; i < points.length; i++) {
      let ll;
      try {
        ll = await svymapPointToLatLon(points[i], utmZone);
      } catch (convErr) {
        errEl.textContent = convErr.message;
        return;
      }
      if (!ll) continue;
      latlngs.push([ll.lat, ll.lon]);
      const label = points[i].point_id || points[i].description || `نقطة ${i + 1}`;
      markers.push(L.marker([ll.lat, ll.lon]).bindPopup(`${label}${points[i].elevation !== undefined ? ` — منسوب: ${points[i].elevation}` : ''}`));
    }

    if (!latlngs.length) {
      errEl.textContent = 'تعذّر تحديد إحداثيات جغرافية لنقاط هذه العملية. إذا كانت النقاط بنظام UTM (easting/northing)، يرجى إدخال منطقة UTM الصحيحة.';
      return;
    }

    const group = L.layerGroup(markers);
    const polyline = latlngs.length >= 2 ? L.polyline(latlngs, { color: '#2980b9', weight: 2, dashArray: '5,5' }) : null;
    SVYMAP_REC_LAYER = L.layerGroup([...(polyline ? [polyline] : []), group]).addTo(map);
    map.fitBounds(latlngs, { padding: [30, 30] });
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ------------------------------------------------------------
// ربط الأحداث
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const btnGenDwg = document.getElementById('svydwg-btn-generate');
  if (btnGenDwg) btnGenDwg.addEventListener('click', svydwgGenerate);
  svydwgRenderHistory();

  const btnLoadProjects = document.getElementById('svymap-btn-load-projects');
  if (btnLoadProjects) btnLoadProjects.addEventListener('click', svymapLoadProjects);

  const layerSelect = document.getElementById('svymap-layer-select');
  if (layerSelect) layerSelect.addEventListener('change', (e) => svymapSwitchLayer(e.target.value));

  const btnSearch = document.getElementById('svymap-btn-search');
  if (btnSearch) btnSearch.addEventListener('click', svymapSearchPlace);
  const searchInput = document.getElementById('svymap-search');
  if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') svymapSearchPlace(); });

  const btnLoadRecord = document.getElementById('svymap-btn-load-record');
  if (btnLoadRecord) btnLoadRecord.addEventListener('click', svymapLoadRecord);

  // تهيئة الخريطة الرئيسية فقط عند فتح تبويب الخرائط لأول مرة (Leaflet يحتاج أن يكون الحاوي مرئياً بأبعاد صحيحة)
  const mapsNavItem = document.querySelector('.nav-item[data-panel="survey-maps"]');
  if (mapsNavItem) {
    mapsNavItem.addEventListener('click', () => {
      setTimeout(() => {
        const map = svymapEnsureMainMap();
        map.invalidateSize();
        if (SVYMAP_REC) SVYMAP_REC.invalidateSize();
      }, 50);
    });
  }
});
