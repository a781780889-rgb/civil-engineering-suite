// ============================================================
// Civil Engineering Suite — Frontend Logic (Section 1: Concrete)
// ============================================================

const API_BASE = '/api/concrete';
let REFERENCE_DATA = { mix_designs: {}, rebar_diameters: [] };
let lastResults = {}; // يخزن آخر نتيجة لكل حاسبة لأجل تصدير PDF
let lastInputs = {};
let currentPdfTarget = null;

// ---------- تحميل البيانات المرجعية ----------
async function loadReferenceData() {
  try {
    const res = await fetch(`${API_BASE}/reference-data`);
    const data = await res.json();
    REFERENCE_DATA = data;
    populateMixSelects();
  } catch (e) {
    console.error('فشل تحميل البيانات المرجعية', e);
  }
}

function populateMixSelects() {
  const ids = ['col-mix', 'beam-mix', 'wall-mix', 'tank-mix'];
  const grades = Object.keys(REFERENCE_DATA.mix_designs || {});
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = grades.map(g => {
      const m = REFERENCE_DATA.mix_designs[g];
      return `<option value="${g}" ${g === 'C25' ? 'selected' : ''}>${g} (fck=${m.fck} MPa)</option>`;
    }).join('');
  });
  // نماذج ديناميكية (footings/slabs/staircases/pools) تحتاج تحديث بعد إنشائها
  document.querySelectorAll('select.mix-select-dynamic').forEach(el => {
    el.innerHTML = grades.map(g => {
      const m = REFERENCE_DATA.mix_designs[g];
      return `<option value="${g}" ${g === 'C25' ? 'selected' : ''}>${g} (fck=${m.fck} MPa)</option>`;
    }).join('');
  });
}

function mixSelectHTML(idAttr) {
  return `<select id="${idAttr}" class="mix-select-dynamic"></select>`;
}

// ---------- التنقل بين اللوحات ----------
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`panel-${item.dataset.panel}`).classList.add('active');
  });
});

// ---------- أدوات عامة ----------
function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
}

function costFieldsHTML(prefix) {
  return `
    <div class="field-group-title">الخرسانة والتكلفة</div>
    <div class="field"><label>مقاومة الخرسانة</label>${mixSelectHTML(prefix + '-mix')}</div>
    <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="${prefix}-waste" value="5"></div>
    <div class="field"><label>سعر كيس الأسمنت</label><input type="number" id="${prefix}-cement-price" value="0"></div>
    <div class="field"><label>سعر م³ الرمل</label><input type="number" id="${prefix}-sand-price" value="0"></div>
    <div class="field"><label>سعر م³ البحص</label><input type="number" id="${prefix}-gravel-price" value="0"></div>
  `;
}

function getVal(id) {
  const e = document.getElementById(id);
  if (!e) return null;
  if (e.tagName === 'SELECT') return e.value;
  return e.value === '' ? null : parseFloat(e.value);
}
function getStrVal(id) {
  const e = document.getElementById(id);
  return e ? e.value : '';
}

async function postJSON(endpoint, body, base = API_BASE) {
  const res = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'حدث خطأ في الحساب');
  }
  return data.data;
}

function showError(container, message) {
  container.innerHTML = `<div class="alert alert-error">⚠ خطأ: ${message}</div>`;
  container.classList.add('active');
}

function setLoading(btn, loading) {
  const spinner = btn.querySelector('.loading-spinner');
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  btn.disabled = loading;
}

// ============================================================
// عرض النتائج (مشترك لكل الحاسبات)
// ============================================================
function renderResultCards(cards) {
  return `<div class="result-cards">${cards.map(c => `
    <div class="result-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}<span class="unit">${c.unit || ''}</span></div>
    </div>`).join('')}</div>`;
}

function renderRebarTable(rebarResult, title = 'تفاصيل حديد التسليح') {
  if (!rebarResult || !rebarResult.details) return '';
  const rows = rebarResult.details.map(d => `
    <tr>
      <td>${d.description}</td>
      <td>Ø${d.diameter_mm}</td>
      <td>${d.count}</td>
      <td>${d.length_per_bar_m} م</td>
      <td>${d.total_length_m} م</td>
      <td>${d.standard_bars_needed} قضيب</td>
      <td>${d.weight_kg} كجم</td>
    </tr>`).join('');
  return `
    <table class="detail-table">
      <caption>${title}</caption>
      <thead><tr><th>الوصف</th><th>القطر</th><th>العدد</th><th>الطول/سيخ</th><th>الطول الكلي</th><th>قضبان 12م</th><th>الوزن</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="font-weight:bold;background:#f0ead9"><td colspan="6">الإجمالي</td><td>${rebarResult.total_weight_kg} كجم (${rebarResult.total_weight_ton} طن)</td></tr></tfoot>
    </table>`;
}

function renderMaterialsSection(materials) {
  if (!materials) return '';
  return `
    ${renderResultCards([
      { label: 'حجم الخرسانة (صافي)', value: materials.volume_net_m3, unit: 'م³' },
      { label: 'حجم شامل الهدر', value: materials.volume_with_waste_m3, unit: 'م³' },
      { label: 'أكياس الأسمنت', value: materials.cement_bags_rounded, unit: 'كيس' },
      { label: 'الرمل', value: materials.sand_m3, unit: 'م³' },
      { label: 'البحص', value: materials.gravel_m3, unit: 'م³' },
      { label: 'المياه', value: materials.water_liters, unit: 'لتر' },
      { label: 'دفعات الخلاطة', value: materials.mixer_batches, unit: 'دفعة' },
      { label: 'سيارات الخرسانة', value: materials.truck_loads, unit: 'سيارة' },
    ])}
    ${materials.cost_breakdown && materials.cost_breakdown.total > 0 ? `
    <table class="detail-table">
      <caption>تفصيل التكلفة</caption>
      <tbody>
        <tr><td>الأسمنت</td><td>${materials.cost_breakdown.cement}</td></tr>
        <tr><td>الرمل</td><td>${materials.cost_breakdown.sand}</td></tr>
        <tr><td>البحص</td><td>${materials.cost_breakdown.gravel}</td></tr>
        <tr><td>المياه</td><td>${materials.cost_breakdown.water}</td></tr>
        <tr style="font-weight:bold;background:#f0ead9"><td>الإجمالي</td><td>${materials.cost_breakdown.total}</td></tr>
      </tbody>
    </table>` : ''}
  `;
}

function soilPressureAlert(sp) {
  if (!sp) return '';
  if (sp.safe === undefined) {
    return `<div class="alert alert-warn">ضغط التربة الفعلي: ${sp.actual_kPa} kPa (لم يتم إدخال قيمة تحمل التربة المسموح للمقارنة)</div>`;
  }
  return sp.safe
    ? `<div class="alert alert-success">✓ آمن: ضغط التربة الفعلي ${sp.actual_kPa} kPa أقل من المسموح ${sp.allowable_kPa} kPa (نسبة استغلال ${sp.utilization_percent}%)</div>`
    : `<div class="alert alert-danger">⚠ غير آمن: ضغط التربة الفعلي ${sp.actual_kPa} kPa يتجاوز المسموح ${sp.allowable_kPa} kPa (نسبة استغلال ${sp.utilization_percent}%) — يلزم تكبير أبعاد القاعدة</div>`;
}

// ============================================================
// 1) القواعد (Footings)
// ============================================================
const footingForms = {
  isolated: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد القاعدة</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="fi-length" value="2.0"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fi-width" value="2.0"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fi-depth" value="0.5"></div>
      <div class="field"><label>عرض العمود (م) اختياري</label><input type="number" step="0.01" id="fi-col-w"></div>
      <div class="field"><label>عمق العمود (م) اختياري</label><input type="number" step="0.01" id="fi-col-d"></div>

      <div class="field-group-title">الأحمال والتربة</div>
      <div class="field"><label>الحمل من العمود (kN)</label><input type="number" id="fi-load"></div>
      <div class="field"><label>تحمل التربة المسموح (kPa)</label><input type="number" id="fi-soil"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="fi-main-dia" value="16"></div>
      <div class="field"><label>قطر تسليح التوزيع (مم)</label><input type="number" id="fi-dist-dia" value="16"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="fi-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="fi-cover" value="75"></div>

      ${costFieldsHTML('fi')}
    </div>`,
  combined: () => `
    <div class="form-grid">
      <div class="field-group-title">الأعمدة (عمودين على الأقل)</div>
      <div class="dynamic-rows" id="fc-columns"></div>
      <button type="button" class="add-row-btn" id="fc-add-column">+ إضافة عمود</button>

      <div class="field-group-title">أبعاد القاعدة</div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fc-width" value="2.5"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fc-depth" value="0.6"></div>
      <div class="field"><label>تحمل التربة المسموح (kPa)</label><input type="number" id="fc-soil"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="fc-main-dia" value="16"></div>
      <div class="field"><label>قطر التسليح العلوي (مم)</label><input type="number" id="fc-top-dia" value="16"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="fc-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="fc-cover" value="75"></div>

      ${costFieldsHTML('fc')}
    </div>`,
  strip: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد القاعدة الشريطية</div>
      <div class="field"><label>الطول الكلي (م)</label><input type="number" step="0.01" id="fs-length" value="10"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fs-width" value="1.0"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fs-depth" value="0.4"></div>
      <div class="field"><label>الحمل لكل متر طولي (kN/m)</label><input type="number" id="fs-load"></div>
      <div class="field"><label>تحمل التربة المسموح (kPa)</label><input type="number" id="fs-soil"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="fs-main-dia" value="14"></div>
      <div class="field"><label>قطر تسليح التوزيع (مم)</label><input type="number" id="fs-dist-dia" value="12"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="fs-spacing" value="200"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="fs-cover" value="75"></div>

      ${costFieldsHTML('fs')}
    </div>`,
  strap: () => `
    <div class="form-grid">
      <div class="field-group-title">القاعدة الخارجية</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="fp-ext-l" value="1.5"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fp-ext-w" value="1.5"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fp-ext-d" value="0.5"></div>
      <div class="field"><label>الحمل (kN)</label><input type="number" id="fp-ext-load"></div>

      <div class="field-group-title">القاعدة الداخلية</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="fp-int-l" value="2.0"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fp-int-w" value="2.0"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fp-int-d" value="0.5"></div>
      <div class="field"><label>الحمل (kN)</label><input type="number" id="fp-int-load"></div>

      <div class="field-group-title">كمرة الرابطة</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="fp-strap-l" value="3.5"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fp-strap-w" value="0.3"></div>
      <div class="field"><label>العمق (م)</label><input type="number" step="0.01" id="fp-strap-d" value="0.6"></div>

      <div class="field"><label>تحمل التربة المسموح (kPa)</label><input type="number" id="fp-soil"></div>

      ${costFieldsHTML('fp')}
    </div>`,
  raft: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد اللبشة</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="fr-length" value="15"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="fr-width" value="10"></div>
      <div class="field"><label>السماكة (م)</label><input type="number" step="0.01" id="fr-thickness" value="0.5"></div>
      <div class="field"><label>الحمل الكلي للمبنى (kN)</label><input type="number" id="fr-load"></div>
      <div class="field"><label>تحمل التربة المسموح (kPa)</label><input type="number" id="fr-soil"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح العلوي (مم)</label><input type="number" id="fr-top-dia" value="18"></div>
      <div class="field"><label>قطر التسليح السفلي (مم)</label><input type="number" id="fr-bottom-dia" value="18"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="fr-spacing" value="200"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="fr-cover" value="75"></div>

      ${costFieldsHTML('fr')}
    </div>`,
};

let footingColumnRows = 2;
function renderFootingColumnRow(idx) {
  return `<div class="dynamic-row" data-idx="${idx}">
    <div class="field"><label>اسم العمود</label><input type="text" value="C${idx + 1}" id="fc-col-name-${idx}"></div>
    <div class="field"><label>الحمل (kN)</label><input type="number" id="fc-col-load-${idx}" value="500"></div>
    <div class="field"><label>الموقع (م)</label><input type="number" step="0.01" id="fc-col-pos-${idx}" value="${idx * 3}"></div>
    <button type="button" class="remove-row-btn" onclick="this.closest('.dynamic-row').remove()">حذف</button>
  </div>`;
}

let currentFootingSub = 'isolated';
function renderFootingForm(sub) {
  currentFootingSub = sub;
  document.getElementById('footing-forms').innerHTML = footingForms[sub]();
  populateMixSelects();
  if (sub === 'combined') {
    const container = document.getElementById('fc-columns');
    container.innerHTML = renderFootingColumnRow(0) + renderFootingColumnRow(1);
    document.getElementById('fc-add-column').onclick = () => {
      const idx = container.children.length;
      container.insertAdjacentHTML('beforeend', renderFootingColumnRow(idx));
    };
  }
}
document.querySelectorAll('#footing-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#footing-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('results-footing').classList.remove('active');
    document.getElementById('btn-pdf-footing').style.display = 'none';
    renderFootingForm(btn.dataset.sub);
  });
});
renderFootingForm('isolated');

function collectFootingInputs() {
  const sub = currentFootingSub;
  if (sub === 'isolated') {
    return {
      endpoint: '/footings/isolated',
      body: {
        length_m: getVal('fi-length'), width_m: getVal('fi-width'), depth_m: getVal('fi-depth'),
        columnLength_m: getVal('fi-col-w'), columnWidth_m: getVal('fi-col-d'),
        appliedLoad_kN: getVal('fi-load'), allowableSoilPressure_kPa: getVal('fi-soil'),
        mainBarDiameter_mm: getVal('fi-main-dia'), distributionBarDiameter_mm: getVal('fi-dist-dia'),
        barSpacing_mm: getVal('fi-spacing'), concreteCover_mm: getVal('fi-cover'),
        mixGrade: getVal('fi-mix'), wastePercent: getVal('fi-waste') / 100,
        cementPricePerBag: getVal('fi-cement-price'), sandPricePerM3: getVal('fi-sand-price'), gravelPricePerM3: getVal('fi-gravel-price'),
      },
    };
  }
  if (sub === 'combined') {
    const rows = [...document.querySelectorAll('#fc-columns .dynamic-row')];
    const columns = rows.map(r => {
      const idx = r.dataset.idx;
      return { name: getStrVal(`fc-col-name-${idx}`), load_kN: getVal(`fc-col-load-${idx}`), position_m: getVal(`fc-col-pos-${idx}`) };
    });
    return {
      endpoint: '/footings/combined',
      body: {
        columns, width_m: getVal('fc-width'), depth_m: getVal('fc-depth'),
        allowableSoilPressure_kPa: getVal('fc-soil'),
        mainBarDiameter_mm: getVal('fc-main-dia'), topBarDiameter_mm: getVal('fc-top-dia'),
        barSpacing_mm: getVal('fc-spacing'), concreteCover_mm: getVal('fc-cover'),
        mixGrade: getVal('fc-mix'), wastePercent: getVal('fc-waste') / 100,
        cementPricePerBag: getVal('fc-cement-price'), sandPricePerM3: getVal('fc-sand-price'), gravelPricePerM3: getVal('fc-gravel-price'),
      },
    };
  }
  if (sub === 'strip') {
    return {
      endpoint: '/footings/strip',
      body: {
        totalLength_m: getVal('fs-length'), width_m: getVal('fs-width'), depth_m: getVal('fs-depth'),
        loadPerMeter_kN_m: getVal('fs-load'), allowableSoilPressure_kPa: getVal('fs-soil'),
        mainBarDiameter_mm: getVal('fs-main-dia'), distributionBarDiameter_mm: getVal('fs-dist-dia'),
        barSpacing_mm: getVal('fs-spacing'), concreteCover_mm: getVal('fs-cover'),
        mixGrade: getVal('fs-mix'), wastePercent: getVal('fs-waste') / 100,
        cementPricePerBag: getVal('fs-cement-price'), sandPricePerM3: getVal('fs-sand-price'), gravelPricePerM3: getVal('fs-gravel-price'),
      },
    };
  }
  if (sub === 'strap') {
    return {
      endpoint: '/footings/strap',
      body: {
        exteriorFooting: { length_m: getVal('fp-ext-l'), width_m: getVal('fp-ext-w'), depth_m: getVal('fp-ext-d') },
        interiorFooting: { length_m: getVal('fp-int-l'), width_m: getVal('fp-int-w'), depth_m: getVal('fp-int-d') },
        strapBeam: { length_m: getVal('fp-strap-l'), width_m: getVal('fp-strap-w'), depth_m: getVal('fp-strap-d') },
        exteriorLoad_kN: getVal('fp-ext-load'), interiorLoad_kN: getVal('fp-int-load'),
        allowableSoilPressure_kPa: getVal('fp-soil'),
        mixGrade: getVal('fp-mix'), wastePercent: getVal('fp-waste') / 100,
        cementPricePerBag: getVal('fp-cement-price'), sandPricePerM3: getVal('fp-sand-price'), gravelPricePerM3: getVal('fp-gravel-price'),
      },
    };
  }
  if (sub === 'raft') {
    return {
      endpoint: '/footings/raft',
      body: {
        length_m: getVal('fr-length'), width_m: getVal('fr-width'), thickness_m: getVal('fr-thickness'),
        totalBuildingLoad_kN: getVal('fr-load'), allowableSoilPressure_kPa: getVal('fr-soil'),
        topBarDiameter_mm: getVal('fr-top-dia'), bottomBarDiameter_mm: getVal('fr-bottom-dia'),
        barSpacing_mm: getVal('fr-spacing'), concreteCover_mm: getVal('fr-cover'),
        mixGrade: getVal('fr-mix'), wastePercent: getVal('fr-waste') / 100,
        cementPricePerBag: getVal('fr-cement-price'), sandPricePerM3: getVal('fr-sand-price'), gravelPricePerM3: getVal('fr-gravel-price'),
      },
    };
  }
}

document.getElementById('btn-calc-footing').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-footing');
  const resultsEl = document.getElementById('results-footing');
  setLoading(btn, true);
  try {
    const { endpoint, body } = collectFootingInputs();
    const data = await postJSON(endpoint, body);
    lastResults.footing = data;
    lastInputs.footing = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += soilPressureAlert(s.soil_pressure);
    html += renderResultCards([
      { label: 'حجم الخرسانة', value: s.volume_m3 || s.total_volume_m3, unit: 'م³' },
      { label: 'المساحة', value: s.area_m2 || '-', unit: 'م²' },
    ]);
    if (s.reinforcement) html += renderRebarTable(s.reinforcement);
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-footing').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally {
    setLoading(btn, false);
  }
});
document.getElementById('btn-pdf-footing').addEventListener('click', () => openPdfModal('footing', 'حاسبة القواعد'));

// ============================================================
// 2) الأعمدة
// ============================================================
document.getElementById('col-shape').addEventListener('change', (e) => {
  const isCircular = e.target.value === 'circular';
  document.getElementById('col-width-field').style.display = isCircular ? 'none' : '';
  document.getElementById('col-depth-field').style.display = isCircular ? 'none' : '';
  document.getElementById('col-diameter-field').style.display = isCircular ? '' : 'none';
});

document.getElementById('btn-calc-column').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-column');
  const resultsEl = document.getElementById('results-column');
  setLoading(btn, true);
  try {
    const body = {
      shape: getVal('col-shape'), width_mm: getVal('col-width'), depth_mm: getVal('col-depth'),
      diameter_mm: getVal('col-diameter'), height_m: getVal('col-height'),
      mainBarDiameter_mm: getVal('col-main-dia'), mainBarsCount: getVal('col-main-count'),
      tieBarDiameter_mm: getVal('col-tie-dia'), tieSpacing_mm: getVal('col-tie-spacing'), concreteCover_mm: getVal('col-cover'),
      mixGrade: getVal('col-mix'), wastePercent: getVal('col-waste') / 100,
      cementPricePerBag: getVal('col-cement-price'), sandPricePerM3: getVal('col-sand-price'), gravelPricePerM3: getVal('col-gravel-price'),
    };
    const data = await postJSON('/columns', body);
    lastResults.column = data; lastInputs.column = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type} — ${s.shape}</h3></div>`;
    html += renderResultCards([
      { label: 'مساحة المقطع', value: s.section_area_m2, unit: 'م²' },
      { label: 'حجم الخرسانة', value: s.volume_m3, unit: 'م³' },
      { label: 'إجمالي وزن الحديد', value: s.reinforcement.total_steel_weight_kg, unit: 'كجم' },
    ]);
    html += renderRebarTable(s.reinforcement.main_bars, 'التسليح الطولي');
    html += renderRebarTable(s.reinforcement.ties, 'الكانات');
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-column').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-column').addEventListener('click', () => openPdfModal('column', 'حاسبة الأعمدة'));

// ============================================================
// 3) الكمرات
// ============================================================
document.getElementById('btn-calc-beam').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-beam');
  const resultsEl = document.getElementById('results-beam');
  setLoading(btn, true);
  try {
    const body = {
      width_mm: getVal('beam-width'), height_mm: getVal('beam-height'), span_m: getVal('beam-span'),
      topBarDiameter_mm: getVal('beam-top-dia'), topBarsCount: getVal('beam-top-count'),
      bottomBarDiameter_mm: getVal('beam-bottom-dia'), bottomBarsCount: getVal('beam-bottom-count'),
      stirrupDiameter_mm: getVal('beam-stirrup-dia'), stirrupSpacing_mm: getVal('beam-stirrup-spacing'),
      concreteCover_mm: getVal('beam-cover'),
      mixGrade: getVal('beam-mix'), wastePercent: getVal('beam-waste') / 100,
      cementPricePerBag: getVal('beam-cement-price'), sandPricePerM3: getVal('beam-sand-price'), gravelPricePerM3: getVal('beam-gravel-price'),
    };
    const data = await postJSON('/beams', body);
    lastResults.beam = data; lastInputs.beam = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += renderResultCards([
      { label: 'مساحة المقطع', value: s.cross_section_area_m2, unit: 'م²' },
      { label: 'حجم الخرسانة', value: s.volume_m3, unit: 'م³' },
      { label: 'إجمالي وزن الحديد', value: s.reinforcement.total_steel_weight_kg, unit: 'كجم' },
    ]);
    html += renderRebarTable(s.reinforcement.top_bars, 'التسليح العلوي');
    html += renderRebarTable(s.reinforcement.bottom_bars, 'التسليح السفلي');
    html += renderRebarTable(s.reinforcement.stirrups, 'الكانات');
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-beam').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-beam').addEventListener('click', () => openPdfModal('beam', 'حاسبة الكمرات'));

// ============================================================
// 4) البلاطات
// ============================================================
const slabForms = {
  solid: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد البلاطة</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="ss-length" value="6"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="ss-width" value="5"></div>
      <div class="field"><label>السماكة (مم)</label><input type="number" id="ss-thickness" value="150"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر رئيسي (مم)</label><input type="number" id="ss-main-dia" value="10"></div>
      <div class="field"><label>تباعد رئيسي (مم)</label><input type="number" id="ss-main-spacing" value="150"></div>
      <div class="field"><label>قطر ثانوي (مم)</label><input type="number" id="ss-sec-dia" value="10"></div>
      <div class="field"><label>تباعد ثانوي (مم)</label><input type="number" id="ss-sec-spacing" value="200"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="ss-cover" value="20"></div>

      ${costFieldsHTML('ss')}
    </div>`,
  hollow: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد البلاطة</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="sh-length" value="6"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="sh-width" value="5"></div>
      <div class="field"><label>السماكة الكلية (مم)</label><input type="number" id="sh-total-thickness" value="250"></div>
      <div class="field"><label>سماكة الطبقة العلوية (مم)</label><input type="number" id="sh-top-thickness" value="50"></div>

      <div class="field-group-title">أبعاد طوبة الهوردي</div>
      <div class="field"><label>عرض الطوبة (مم)</label><input type="number" id="sh-block-width" value="400"></div>
      <div class="field"><label>طول الطوبة (مم)</label><input type="number" id="sh-block-length" value="250"></div>
      <div class="field"><label>تباعد الأعصاب (مم)</label><input type="number" id="sh-rib-spacing" value="520"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر تسليح الأعصاب (مم)</label><input type="number" id="sh-main-dia" value="10"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="sh-cover" value="20"></div>

      ${costFieldsHTML('sh')}
    </div>`,
};
let currentSlabSub = 'solid';
function renderSlabForm(sub) {
  currentSlabSub = sub;
  document.getElementById('slab-forms').innerHTML = slabForms[sub]();
  populateMixSelects();
}
document.querySelectorAll('#slab-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#slab-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('results-slab').classList.remove('active');
    document.getElementById('btn-pdf-slab').style.display = 'none';
    renderSlabForm(btn.dataset.sub);
  });
});
renderSlabForm('solid');

document.getElementById('btn-calc-slab').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-slab');
  const resultsEl = document.getElementById('results-slab');
  setLoading(btn, true);
  try {
    let endpoint, body;
    if (currentSlabSub === 'solid') {
      endpoint = '/slabs/solid';
      body = {
        length_m: getVal('ss-length'), width_m: getVal('ss-width'), thickness_mm: getVal('ss-thickness'),
        mainBarDiameter_mm: getVal('ss-main-dia'), mainBarSpacing_mm: getVal('ss-main-spacing'),
        secondaryBarDiameter_mm: getVal('ss-sec-dia'), secondaryBarSpacing_mm: getVal('ss-sec-spacing'),
        concreteCover_mm: getVal('ss-cover'),
        mixGrade: getVal('ss-mix'), wastePercent: getVal('ss-waste') / 100,
        cementPricePerBag: getVal('ss-cement-price'), sandPricePerM3: getVal('ss-sand-price'), gravelPricePerM3: getVal('ss-gravel-price'),
      };
    } else {
      endpoint = '/slabs/hollow-block';
      body = {
        length_m: getVal('sh-length'), width_m: getVal('sh-width'),
        totalThickness_mm: getVal('sh-total-thickness'), topLayerThickness_mm: getVal('sh-top-thickness'),
        blockWidth_mm: getVal('sh-block-width'), blockLength_mm: getVal('sh-block-length'),
        ribSpacing_mm: getVal('sh-rib-spacing'), mainBarDiameter_mm: getVal('sh-main-dia'),
        concreteCover_mm: getVal('sh-cover'),
        mixGrade: getVal('sh-mix'), wastePercent: getVal('sh-waste') / 100,
        cementPricePerBag: getVal('sh-cement-price'), sandPricePerM3: getVal('sh-sand-price'), gravelPricePerM3: getVal('sh-gravel-price'),
      };
    }
    const data = await postJSON(endpoint, body);
    lastResults.slab = data; lastInputs.slab = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    if (currentSlabSub === 'solid') {
      html += renderResultCards([
        { label: 'المساحة', value: s.area_m2, unit: 'م²' },
        { label: 'حجم الخرسانة', value: s.volume_m3, unit: 'م³' },
      ]);
    } else {
      html += renderResultCards([
        { label: 'المساحة', value: s.area_m2, unit: 'م²' },
        { label: 'الحجم الإجمالي', value: s.gross_volume_m3, unit: 'م³' },
        { label: 'عدد طوب الهوردي', value: s.blocks.total_count, unit: 'طوبة' },
        { label: 'حجم الخرسانة الصافي', value: s.net_concrete_volume_m3, unit: 'م³' },
        { label: 'عدد الأعصاب', value: s.ribs_count, unit: '' },
      ]);
    }
    html += renderRebarTable(s.reinforcement);
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-slab').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-slab').addEventListener('click', () => openPdfModal('slab', 'حاسبة البلاطات'));

// ============================================================
// 5) الجدران
// ============================================================
let wallOpeningIdx = 0;
document.getElementById('add-wall-opening').addEventListener('click', () => {
  const idx = wallOpeningIdx++;
  document.getElementById('wall-openings').insertAdjacentHTML('beforeend', `
    <div class="dynamic-row" data-idx="${idx}">
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="wo-w-${idx}" value="1.0"></div>
      <div class="field"><label>الارتفاع (م)</label><input type="number" step="0.01" id="wo-h-${idx}" value="1.2"></div>
      <div class="field"><label>العدد</label><input type="number" id="wo-c-${idx}" value="1"></div>
      <button type="button" class="remove-row-btn" onclick="this.closest('.dynamic-row').remove()">حذف</button>
    </div>`);
});

document.getElementById('btn-calc-wall').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-wall');
  const resultsEl = document.getElementById('results-wall');
  setLoading(btn, true);
  try {
    const openings = [...document.querySelectorAll('#wall-openings .dynamic-row')].map(r => {
      const idx = r.dataset.idx;
      return { width_m: getVal(`wo-w-${idx}`), height_m: getVal(`wo-h-${idx}`), count: getVal(`wo-c-${idx}`) };
    });
    const body = {
      length_m: getVal('wall-length'), height_m: getVal('wall-height'), thickness_mm: getVal('wall-thickness'),
      openings, layers: getVal('wall-layers'),
      verticalBarDiameter_mm: getVal('wall-v-dia'), verticalBarSpacing_mm: getVal('wall-v-spacing'),
      horizontalBarDiameter_mm: getVal('wall-h-dia'), horizontalBarSpacing_mm: getVal('wall-h-spacing'),
      concreteCover_mm: getVal('wall-cover'),
      mixGrade: getVal('wall-mix'), wastePercent: getVal('wall-waste') / 100,
      cementPricePerBag: getVal('wall-cement-price'), sandPricePerM3: getVal('wall-sand-price'), gravelPricePerM3: getVal('wall-gravel-price'),
    };
    const data = await postJSON('/walls', body);
    lastResults.wall = data; lastInputs.wall = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += renderResultCards([
      { label: 'المساحة الإجمالية', value: s.gross_area_m2, unit: 'م²' },
      { label: 'مساحة الفتحات', value: s.openings_area_m2, unit: 'م²' },
      { label: 'المساحة الصافية', value: s.net_area_m2, unit: 'م²' },
      { label: 'حجم الخرسانة', value: s.volume_m3, unit: 'م³' },
    ]);
    html += renderRebarTable(s.reinforcement);
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-wall').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-wall').addEventListener('click', () => openPdfModal('wall', 'حاسبة الجدران'));

// ============================================================
// 6) السلالم
// ============================================================
const stairForms = {
  straight: () => `
    <div class="form-grid">
      <div class="field-group-title">هندسة المجرى</div>
      <div class="field"><label>الارتفاع الكلي (م)</label><input type="number" step="0.01" id="st-rise" value="3.0"></div>
      <div class="field"><label>ارتفاع القائمة (مم)</label><input type="number" id="st-riser" value="171"></div>
      <div class="field"><label>عرض النائمة (مم)</label><input type="number" id="st-tread" value="280"></div>
      <div class="field"><label>عرض السلم (م)</label><input type="number" step="0.01" id="st-width" value="1.2"></div>
      <div class="field"><label>سماكة القلبة (مم)</label><input type="number" id="st-waist" value="150"></div>
      <div class="field"><label>طول البسطة (م) اختياري</label><input type="number" step="0.01" id="st-landing-len" value="0"></div>
      <div class="field"><label>سماكة البسطة (مم)</label><input type="number" id="st-landing-thick" value="150"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر رئيسي (مم)</label><input type="number" id="st-main-dia" value="12"></div>
      <div class="field"><label>تباعد رئيسي (مم)</label><input type="number" id="st-main-spacing" value="150"></div>
      <div class="field"><label>قطر توزيع (مم)</label><input type="number" id="st-dist-dia" value="8"></div>
      <div class="field"><label>تباعد توزيع (مم)</label><input type="number" id="st-dist-spacing" value="200"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="st-cover" value="20"></div>

      ${costFieldsHTML('st')}
    </div>`,
  circular: () => `
    <div class="form-grid">
      <div class="field-group-title">هندسة السلم الدائري</div>
      <div class="field"><label>نصف القطر الداخلي (م)</label><input type="number" step="0.01" id="stc-inner-r" value="0.5"></div>
      <div class="field"><label>نصف القطر الخارجي (م)</label><input type="number" step="0.01" id="stc-outer-r" value="1.5"></div>
      <div class="field"><label>الارتفاع الكلي (م)</label><input type="number" step="0.01" id="stc-rise" value="3.0"></div>
      <div class="field"><label>عدد الدرجات</label><input type="number" id="stc-steps" value="18"></div>
      <div class="field"><label>سماكة القلبة (مم)</label><input type="number" id="stc-waist" value="150"></div>

      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر رئيسي (مم)</label><input type="number" id="stc-main-dia" value="12"></div>
      <div class="field"><label>تباعد رئيسي (مم)</label><input type="number" id="stc-main-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="stc-cover" value="20"></div>

      ${costFieldsHTML('stc')}
    </div>`,
};
// L و U يستخدمان نفس نموذج المجرى المستقيم لكن بعدد 2 (L) أو 2-3 مجاري (U) — نبني ديناميكياً
function multiFlightForm(numFlights) {
  let html = '<div class="form-grid">';
  for (let i = 0; i < numFlights; i++) {
    html += `
      <div class="field-group-title">مجرى رقم ${i + 1}</div>
      <div class="field"><label>الارتفاع الكلي للمجرى (م)</label><input type="number" step="0.01" id="mf-rise-${i}" value="1.5"></div>
      <div class="field"><label>ارتفاع القائمة (مم)</label><input type="number" id="mf-riser-${i}" value="171"></div>
      <div class="field"><label>عرض النائمة (مم)</label><input type="number" id="mf-tread-${i}" value="280"></div>
      <div class="field"><label>عرض السلم (م)</label><input type="number" step="0.01" id="mf-width-${i}" value="1.2"></div>
      <div class="field"><label>سماكة القلبة (مم)</label><input type="number" id="mf-waist-${i}" value="150"></div>
    `;
  }
  html += `
    <div class="field-group-title">بسطة الدوران (Landing)</div>
    <div class="field"><label>طول البسطة (م)</label><input type="number" step="0.01" id="mf-landing-len" value="1.2"></div>
    <div class="field"><label>سماكة البسطة (مم)</label><input type="number" id="mf-landing-thick" value="150"></div>

    <div class="field-group-title">التسليح (لكل المجاري)</div>
    <div class="field"><label>قطر رئيسي (مم)</label><input type="number" id="mf-main-dia" value="12"></div>
    <div class="field"><label>تباعد رئيسي (مم)</label><input type="number" id="mf-main-spacing" value="150"></div>
    <div class="field"><label>قطر توزيع (مم)</label><input type="number" id="mf-dist-dia" value="8"></div>
    <div class="field"><label>تباعد توزيع (مم)</label><input type="number" id="mf-dist-spacing" value="200"></div>
    <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="mf-cover" value="20"></div>

    ${costFieldsHTML('mf')}
  </div>`;
  return html;
}

let currentStairSub = 'straight';
function renderStairForm(sub) {
  currentStairSub = sub;
  const container = document.getElementById('stair-forms');
  if (sub === 'straight') container.innerHTML = stairForms.straight();
  else if (sub === 'circular') container.innerHTML = stairForms.circular();
  else if (sub === 'L-shaped') container.innerHTML = multiFlightForm(2);
  else if (sub === 'U-shaped') container.innerHTML = multiFlightForm(2);
  populateMixSelects();
}
document.querySelectorAll('#stair-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#stair-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('results-stair').classList.remove('active');
    document.getElementById('btn-pdf-stair').style.display = 'none';
    renderStairForm(btn.dataset.sub);
  });
});
renderStairForm('straight');

document.getElementById('btn-calc-stair').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-stair');
  const resultsEl = document.getElementById('results-stair');
  setLoading(btn, true);
  try {
    let body;
    if (currentStairSub === 'straight') {
      body = {
        staircaseType: 'straight',
        flights: [{
          totalRiseHeight_m: getVal('st-rise'), riserHeight_mm: getVal('st-riser'), treadWidth_mm: getVal('st-tread'),
          flightWidth_m: getVal('st-width'), waistSlabThickness_mm: getVal('st-waist'),
          landingLength_m: getVal('st-landing-len') || 0, landingThickness_mm: getVal('st-landing-thick'),
        }],
        reinforcementOptions: {
          mainBarDiameter_mm: getVal('st-main-dia'), mainBarSpacing_mm: getVal('st-main-spacing'),
          distributionBarDiameter_mm: getVal('st-dist-dia'), distributionBarSpacing_mm: getVal('st-dist-spacing'),
          concreteCover_mm: getVal('st-cover'), wastePercent: getVal('st-waste') / 100,
        },
        mixGrade: getVal('st-mix'), wastePercent: getVal('st-waste') / 100,
        cementPricePerBag: getVal('st-cement-price'), sandPricePerM3: getVal('st-sand-price'), gravelPricePerM3: getVal('st-gravel-price'),
      };
    } else if (currentStairSub === 'circular') {
      body = {
        staircaseType: 'circular',
        flights: [{
          innerRadius_m: getVal('stc-inner-r'), outerRadius_m: getVal('stc-outer-r'),
          totalRiseHeight_m: getVal('stc-rise'), numberOfSteps: getVal('stc-steps'),
          waistSlabThickness_mm: getVal('stc-waist'),
        }],
        reinforcementOptions: {
          mainBarDiameter_mm: getVal('stc-main-dia'), mainBarSpacing_mm: getVal('stc-main-spacing'),
          concreteCover_mm: getVal('stc-cover'), wastePercent: getVal('stc-waste') / 100,
        },
        mixGrade: getVal('stc-mix'), wastePercent: getVal('stc-waste') / 100,
        cementPricePerBag: getVal('stc-cement-price'), sandPricePerM3: getVal('stc-sand-price'), gravelPricePerM3: getVal('stc-gravel-price'),
      };
    } else {
      const numFlights = 2;
      const flights = [];
      for (let i = 0; i < numFlights; i++) {
        flights.push({
          totalRiseHeight_m: getVal(`mf-rise-${i}`), riserHeight_mm: getVal(`mf-riser-${i}`), treadWidth_mm: getVal(`mf-tread-${i}`),
          flightWidth_m: getVal(`mf-width-${i}`), waistSlabThickness_mm: getVal(`mf-waist-${i}`),
          landingLength_m: i === 0 ? (getVal('mf-landing-len') || 0) : 0, landingThickness_mm: getVal('mf-landing-thick'),
        });
      }
      body = {
        staircaseType: currentStairSub,
        flights,
        reinforcementOptions: {
          mainBarDiameter_mm: getVal('mf-main-dia'), mainBarSpacing_mm: getVal('mf-main-spacing'),
          distributionBarDiameter_mm: getVal('mf-dist-dia'), distributionBarSpacing_mm: getVal('mf-dist-spacing'),
          concreteCover_mm: getVal('mf-cover'), wastePercent: getVal('mf-waste') / 100,
        },
        mixGrade: getVal('mf-mix'), wastePercent: getVal('mf-waste') / 100,
        cementPricePerBag: getVal('mf-cement-price'), sandPricePerM3: getVal('mf-sand-price'), gravelPricePerM3: getVal('mf-gravel-price'),
      };
    }
    const data = await postJSON('/staircases', body);
    lastResults.stair = data; lastInputs.stair = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += renderResultCards([
      { label: 'حجم الخرسانة الكلي', value: s.total_concrete_volume_m3, unit: 'م³' },
      { label: 'وزن الحديد الكلي', value: s.total_steel_weight_kg, unit: 'كجم' },
      { label: 'مساحة الشدة الخشبية', value: s.total_formwork_area_m2, unit: 'م²' },
    ]);
    s.flights.forEach(f => {
      const g = f.geometry;
      if (g.number_of_risers) {
        html += `<div class="alert ${g.comfort_formula_check.compliant ? 'alert-success' : 'alert-warn'}">
          مجرى ${f.flight_number}: عدد القوائم ${g.number_of_risers} / عدد النائمات ${g.number_of_treads} —
          قانون الراحة (2R+G) = ${g.comfort_formula_check.value_mm}مم
          (${g.comfort_formula_check.compliant ? 'مطابق ✓' : 'خارج النطاق المعياري 600-640مم ⚠'})
        </div>`;
        html += renderResultCards([
          { label: `طول القلبة المائل (مجرى ${f.flight_number})`, value: g.inclined_waist_slab_length_m, unit: 'م' },
          { label: 'زاوية الميل', value: g.incline_angle_deg, unit: '°' },
          { label: 'حجم المجرى', value: g.total_concrete_volume_m3, unit: 'م³' },
        ]);
      } else {
        html += renderResultCards([
          { label: `دوران السلم الدائري`, value: g.total_rotation_deg, unit: '°' },
          { label: 'طول القلبة الحلزوني', value: g.helical_length_m, unit: 'م' },
          { label: 'حجم المجرى', value: g.total_concrete_volume_m3, unit: 'م³' },
        ]);
      }
      html += renderRebarTable(f.reinforcement, `تسليح المجرى ${f.flight_number}`);
    });
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-stair').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-stair').addEventListener('click', () => openPdfModal('stair', 'حاسبة السلالم'));

// ============================================================
// 7) الخزانات
// ============================================================
document.getElementById('tank-shape').addEventListener('change', (e) => {
  const isCircular = e.target.value === 'circular';
  document.getElementById('tank-length-field').style.display = isCircular ? 'none' : '';
  document.getElementById('tank-width-field').style.display = isCircular ? 'none' : '';
  document.getElementById('tank-diameter-field').style.display = isCircular ? '' : 'none';
});

document.getElementById('btn-calc-tank').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-tank');
  const resultsEl = document.getElementById('results-tank');
  setLoading(btn, true);
  try {
    const body = {
      tankShape: getVal('tank-shape'), location: getVal('tank-location'),
      length_m: getVal('tank-length'), width_m: getVal('tank-width'), diameter_m: getVal('tank-diameter'),
      waterHeight_m: getVal('tank-water-height'), freeboard_m: getVal('tank-freeboard'),
      baseThickness_mm: getVal('tank-base-thickness'), wallThickness_mm: getVal('tank-wall-thickness'), roofThickness_mm: getVal('tank-roof-thickness'),
      hasRibs: getVal('tank-has-ribs') === 'true', ribCount: getVal('tank-rib-count'),
      mainBarDiameter_mm: getVal('tank-bar-dia'), barSpacing_mm: getVal('tank-bar-spacing'), concreteCover_mm: getVal('tank-cover'),
      insulationThickness_mm: getVal('tank-insulation-thickness'), insulationCostPerM2: getVal('tank-insulation-price'),
      plasterCostPerM2: getVal('tank-plaster-price'),
      mixGrade: getVal('tank-mix'), wastePercent: getVal('tank-waste') / 100,
      cementPricePerBag: getVal('tank-cement-price'), sandPricePerM3: getVal('tank-sand-price'), gravelPricePerM3: getVal('tank-gravel-price'),
    };
    const data = await postJSON('/tanks', body);
    lastResults.tank = data; lastInputs.tank = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += renderResultCards([
      { label: 'حجم المياه', value: s.capacity.water_volume_m3, unit: 'م³' },
      { label: 'سعة المياه', value: s.capacity.water_volume_liters, unit: 'لتر' },
      { label: 'ضغط عند القاع', value: s.hydrostatic_analysis.pressure_at_base_kPa, unit: 'kPa' },
      { label: 'حجم الخرسانة الكلي', value: s.concrete_volumes.total_m3, unit: 'م³' },
      { label: 'وزن الحديد الكلي', value: s.reinforcement.total_steel_weight_kg, unit: 'كجم' },
    ]);
    html += `<table class="detail-table"><caption>تفصيل أحجام الخرسانة</caption><tbody>
      <tr><td>القاعدة</td><td>${s.concrete_volumes.base_m3} م³</td></tr>
      <tr><td>الجدران</td><td>${s.concrete_volumes.walls_m3} م³</td></tr>
      <tr><td>السقف</td><td>${s.concrete_volumes.roof_m3} م³</td></tr>
      <tr><td>الأعصاب</td><td>${s.concrete_volumes.ribs_m3} م³</td></tr>
    </tbody></table>`;
    html += renderRebarTable(s.reinforcement.base, 'تسليح القاعدة');
    html += renderRebarTable(s.reinforcement.walls, 'تسليح الجدران');
    html += renderRebarTable(s.reinforcement.roof, 'تسليح السقف');
    html += `<table class="detail-table"><caption>التشطيبات</caption><tbody>
      <tr><td>مساحة العزل</td><td>${s.finishes.insulation_area_m2} م² (تكلفة: ${s.finishes.insulation_cost})</td></tr>
      <tr><td>اللياسة الداخلية</td><td>${s.finishes.internal_plaster_area_m2} م²</td></tr>
      <tr><td>اللياسة الخارجية</td><td>${s.finishes.external_plaster_area_m2} م² (تكلفة اللياسة: ${s.finishes.plaster_cost})</td></tr>
    </tbody></table>`;
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-tank').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-tank').addEventListener('click', () => openPdfModal('tank', 'حاسبة الخزانات'));

// ============================================================
// 8) المسابح
// ============================================================
const poolForms = {
  rectangular: () => `
    <div class="form-grid">
      <div class="field-group-title">الأبعاد</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="pl-length" value="10"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="pl-width" value="5"></div>
      ${poolCommonFields('pl')}
    </div>`,
  circular: () => `
    <div class="form-grid">
      <div class="field-group-title">الأبعاد</div>
      <div class="field"><label>القطر (م)</label><input type="number" step="0.01" id="pc-diameter" value="6"></div>
      ${poolCommonFields('pc')}
    </div>`,
  freeform: () => `
    <div class="form-grid">
      <div class="field-group-title">الأبعاد</div>
      <div class="field"><label>المساحة (م²)</label><input type="number" step="0.01" id="pf-area" value="40"></div>
      <div class="field"><label>المحيط (م)</label><input type="number" step="0.01" id="pf-perimeter" value="26"></div>
      ${poolCommonFields('pf')}
    </div>`,
};
function poolCommonFields(prefix) {
  return `
    <div class="field-group-title">الأعماق والسماكات</div>
    <div class="field"><label>العمق الضحل (م)</label><input type="number" step="0.01" id="${prefix}-shallow" value="1.0"></div>
    <div class="field"><label>العمق العميق (م)</label><input type="number" step="0.01" id="${prefix}-deep" value="2.0"></div>
    <div class="field"><label>سماكة الجدران (مم)</label><input type="number" id="${prefix}-wall-thickness" value="200"></div>
    <div class="field"><label>سماكة الأرضية (مم)</label><input type="number" id="${prefix}-floor-thickness" value="200"></div>
    <div class="field"><label>هامش الحفر (م)</label><input type="number" step="0.01" id="${prefix}-excavation-margin" value="0.5"></div>
    <div class="field"><label>سعر حفر م³</label><input type="number" id="${prefix}-excavation-price" value="0"></div>

    <div class="field-group-title">التسليح</div>
    <div class="field"><label>قطر التسليح (مم)</label><input type="number" id="${prefix}-bar-dia" value="12"></div>
    <div class="field"><label>التباعد (مم)</label><input type="number" id="${prefix}-bar-spacing" value="150"></div>
    <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="${prefix}-cover" value="50"></div>

    <div class="field-group-title">التشطيبات والمعدات</div>
    <div class="field"><label>سعر م² العزل المائي</label><input type="number" id="${prefix}-waterproof-price" value="0"></div>
    <div class="field"><label>سعر م² البلاط</label><input type="number" id="${prefix}-tiling-price" value="0"></div>
    <div class="field"><label>سعر م² اللياسة</label><input type="number" id="${prefix}-plaster-price" value="0"></div>
    <div class="field"><label>معدل تدفق المضخة (م³/ساعة)</label><input type="number" id="${prefix}-pump-flow" value="10"></div>
    <div class="field"><label>سعر المضخة</label><input type="number" id="${prefix}-pump-cost" value="0"></div>
    <div class="field"><label>سعر الفلتر</label><input type="number" id="${prefix}-filter-cost" value="0"></div>

    ${costFieldsHTML(prefix)}
  `;
}
let currentPoolSub = 'rectangular';
function renderPoolForm(sub) {
  currentPoolSub = sub;
  document.getElementById('pool-forms').innerHTML = poolForms[sub]();
  populateMixSelects();
}
document.querySelectorAll('#pool-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#pool-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('results-pool').classList.remove('active');
    document.getElementById('btn-pdf-pool').style.display = 'none';
    renderPoolForm(btn.dataset.sub);
  });
});
renderPoolForm('rectangular');

document.getElementById('btn-calc-pool').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-pool');
  const resultsEl = document.getElementById('results-pool');
  setLoading(btn, true);
  try {
    const p = currentPoolSub === 'rectangular' ? 'pl' : currentPoolSub === 'circular' ? 'pc' : 'pf';
    const body = {
      poolShape: currentPoolSub,
      length_m: getVal(`${p}-length`), width_m: getVal(`${p}-width`), diameter_m: getVal(`${p}-diameter`),
      freeformArea_m2: getVal(`${p}-area`), freeformPerimeter_m: getVal(`${p}-perimeter`),
      shallowDepth_m: getVal(`${p}-shallow`), deepDepth_m: getVal(`${p}-deep`),
      wallThickness_mm: getVal(`${p}-wall-thickness`), floorThickness_mm: getVal(`${p}-floor-thickness`),
      excavationMargin_m: getVal(`${p}-excavation-margin`), excavationCostPerM3: getVal(`${p}-excavation-price`),
      mainBarDiameter_mm: getVal(`${p}-bar-dia`), barSpacing_mm: getVal(`${p}-bar-spacing`), concreteCover_mm: getVal(`${p}-cover`),
      waterproofingCostPerM2: getVal(`${p}-waterproof-price`), tilingCostPerM2: getVal(`${p}-tiling-price`), plasterCostPerM2: getVal(`${p}-plaster-price`),
      pumpFlowRate_m3_per_hour: getVal(`${p}-pump-flow`), pumpCost: getVal(`${p}-pump-cost`), filterCost: getVal(`${p}-filter-cost`),
      mixGrade: getVal(`${p}-mix`), wastePercent: getVal(`${p}-waste`) / 100,
      cementPricePerBag: getVal(`${p}-cement-price`), sandPricePerM3: getVal(`${p}-sand-price`), gravelPricePerM3: getVal(`${p}-gravel-price`),
    };
    const data = await postJSON('/pools', body);
    lastResults.pool = data; lastInputs.pool = body;

    const s = data.structural;
    let html = `<div class="results-header"><span class="status-dot"></span><h3>${s.type}</h3></div>`;
    html += renderResultCards([
      { label: 'حجم المياه', value: s.water_volume_m3, unit: 'م³' },
      { label: 'حجم الحفر', value: s.excavation.volume_m3, unit: 'م³' },
      { label: 'حجم الخرسانة الكلي', value: s.concrete_volumes.total_m3, unit: 'م³' },
      { label: 'وزن الحديد الكلي', value: s.reinforcement.total_steel_weight_kg, unit: 'كجم' },
      { label: 'التكلفة الكلية للتشطيبات', value: s.total_cost, unit: '' },
    ]);
    if (s.finishes_and_equipment.filtration_analysis) {
      html += `<div class="alert alert-success">دورة فلترة كاملة كل ${s.finishes_and_equipment.filtration_analysis.hours_per_full_cycle} ساعة (${s.finishes_and_equipment.filtration_analysis.recommended_daily_cycles} دورة/يوم)</div>`;
    }
    html += renderRebarTable(s.reinforcement.floor, 'تسليح الأرضية');
    html += renderRebarTable(s.reinforcement.walls, 'تسليح الجدران');
    html += renderMaterialsSection(data.materials);
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    document.getElementById('btn-pdf-pool').style.display = 'inline-block';
  } catch (e) {
    showError(resultsEl, e.message);
  } finally { setLoading(btn, false); }
});
document.getElementById('btn-pdf-pool').addEventListener('click', () => openPdfModal('pool', 'حاسبة المسابح'));

// ============================================================
// تصدير PDF (مشترك)
// ============================================================
function openPdfModal(target, calcType, apiBase = API_BASE) {
  currentPdfTarget = { target, calcType, apiBase };
  document.getElementById('pdf-modal').classList.add('active');
}
document.getElementById('pdf-cancel-btn').addEventListener('click', () => {
  document.getElementById('pdf-modal').classList.remove('active');
});
document.getElementById('pdf-confirm-btn').addEventListener('click', async () => {
  const btn = document.getElementById('pdf-confirm-btn');
  const { target, calcType, apiBase } = currentPdfTarget;
  const projectName = getStrVal('pdf-project-name');
  const engineerName = getStrVal('pdf-engineer-name');
  const clientName = getStrVal('pdf-client-name');

  btn.disabled = true;
  btn.textContent = 'جارٍ الإنشاء...';
  try {
    const res = await fetch(`${apiBase || API_BASE}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName, engineerName, clientName,
        calculationType: calcType,
        inputs: lastInputs[target],
        results: lastResults[target],
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    window.open(data.downloadUrl, '_blank');
    document.getElementById('pdf-modal').classList.remove('active');
  } catch (e) {
    alert('فشل إنشاء التقرير: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'إنشاء التقرير';
  }
});

// ============================================================
// القسم الثاني: حاسبة حديد التسليح (Rebar Calculator)
// ============================================================
const REBAR_API_BASE = '/api/rebar';
let REBAR_REFERENCE = { rebar_diameters: [], steel_grades: {}, tie_shapes: [], hook_angles: [] };
let rebarProjectLog = []; // سجل نتائج الجلسة لأجل لوحة المعلومات

async function loadRebarReferenceData() {
  try {
    const res = await fetch(`${REBAR_API_BASE}/reference-data`);
    const json = await res.json();
    REBAR_REFERENCE = json.data;
    renderRebarDashboard();
  } catch (e) {
    console.error('فشل تحميل بيانات مرجعية القسم الثاني', e);
  }
}

function steelGradeSelectHTML(id) {
  const grades = Object.keys(REBAR_REFERENCE.steel_grades || { Grade420: {} });
  return `<select id="${id}">${grades.map(g => `<option value="${g}" ${g === 'Grade420' ? 'selected' : ''}>${(REBAR_REFERENCE.steel_grades[g] || {}).label || g}</option>`).join('')}</select>`;
}

function rebarPricingFieldsHTML(prefix) {
  return `
    <div class="field-group-title">مكتبة الأسعار</div>
    <div class="field"><label>سعر طن الحديد</label><input type="number" id="${prefix}-price-ton" value="0"></div>
    <div class="field"><label>سعر النقل / طن</label><input type="number" id="${prefix}-price-transport" value="0"></div>
    <div class="field"><label>سعر القص / طن</label><input type="number" id="${prefix}-price-cutting" value="0"></div>
    <div class="field"><label>سعر الثني / طن</label><input type="number" id="${prefix}-price-bending" value="0"></div>
    <div class="field"><label>سعر التركيب / طن</label><input type="number" id="${prefix}-price-installation" value="0"></div>
    <div class="field"><label>الضريبة %</label><input type="number" step="0.1" id="${prefix}-price-tax" value="0"></div>
    <div class="field"><label>الخصم %</label><input type="number" step="0.1" id="${prefix}-price-discount" value="0"></div>
  `;
}
function readRebarPricing(prefix) {
  return {
    pricePerTon: getVal(`${prefix}-price-ton`) || 0,
    transportPerTon: getVal(`${prefix}-price-transport`) || 0,
    cuttingPerTon: getVal(`${prefix}-price-cutting`) || 0,
    bendingPerTon: getVal(`${prefix}-price-bending`) || 0,
    installationPerTon: getVal(`${prefix}-price-installation`) || 0,
    taxPercent: getVal(`${prefix}-price-tax`) || 0,
    discountPercent: getVal(`${prefix}-price-discount`) || 0,
  };
}

function designCodeFieldsHTML(prefix) {
  return `
    <div class="field-group-title">معايير التصميم</div>
    <div class="field"><label>درجة الحديد</label>${steelGradeSelectHTML(prefix + '-grade')}</div>
    <div class="field"><label>مقاومة الخرسانة fc' (MPa)</label><input type="number" id="${prefix}-fc" value="25"></div>
    <div class="field"><label>فئة التراكب</label>
      <select id="${prefix}-splice-class"><option value="B" selected>B (الشائعة)</option><option value="A">A</option></select>
    </div>
  `;
}
function readDesignCodeFields(prefix) {
  const fy = (REBAR_REFERENCE.steel_grades[getStrVal(`${prefix}-grade`)] || {}).fy || 420;
  return { fy_MPa: fy, fc_MPa: getVal(`${prefix}-fc`) || 25, spliceClass: getStrVal(`${prefix}-splice-class`) || 'B' };
}

// ---------- لوحة المعلومات المباشرة ----------
function renderRebarDashboard() {
  const container = document.getElementById('rebar-dashboard-cards');
  if (!container) return;
  const totalWeight = rebarProjectLog.reduce((s, r) => s + (r.weight_kg || 0), 0);
  const totalCost = rebarProjectLog.reduce((s, r) => s + (r.cost || 0), 0);
  const totalBars = rebarProjectLog.reduce((s, r) => s + (r.bars || 0), 0);
  container.innerHTML = renderResultCards([
    { label: 'إجمالي وزن الحديد (الجلسة)', value: round1(totalWeight), unit: 'كجم' },
    { label: 'إجمالي الوزن (طن)', value: round1(totalWeight / 1000), unit: 'طن' },
    { label: 'إجمالي التكلفة', value: round1(totalCost), unit: '' },
    { label: 'عدد العمليات المنفذة', value: rebarProjectLog.length, unit: 'عملية' },
  ]);
}
function round1(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function logRebarOperation(elementLabel, weight_kg, cost) {
  rebarProjectLog.unshift({ elementLabel, weight_kg, weight: weight_kg, cost: cost || 0, time: new Date().toLocaleTimeString('ar-EG') });
  renderRebarDashboard();
}

// ---------- عرض نتائج التحقق التصميمي ----------
function renderDesignChecks(dc) {
  if (!dc) return '';
  const rows = dc.checks.map(c => `
    <tr>
      <td>${c.check}</td>
      <td>${c.required_min_mm ?? c.max_allowed_mm ?? c.min_required ?? '-'}</td>
      <td>${c.provided_mm ?? c.provided ?? '-'}</td>
      <td><span class="tag ${c.status === 'مطابق' ? 'tag-ok' : c.status === 'مرجعي' ? 'tag-info' : 'tag-bad'}">${c.status}</span></td>
    </tr>`).join('');
  const alerts = dc.errors.map(e => `<div class="alert alert-danger">⚠ ${e}</div>`).join('')
    + dc.warnings.map(w => `<div class="alert alert-warn">${w}</div>`).join('');
  return `
    ${alerts}
    <table class="detail-table">
      <caption>فحوصات التصميم التلقائية (${dc.overall_status})</caption>
      <thead><tr><th>البند</th><th>الحد المطلوب</th><th>القيمة المُدخلة</th><th>الحالة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderLapDevelopment(ld) {
  if (!ld) return '';
  return `
    ${renderResultCards([
      { label: 'طول التثبيت (Development Length)', value: ld.development.development_length_m, unit: 'م' },
      { label: `طول التراكب (Class ${ld.lap_splice.splice_class})`, value: ld.lap_splice.lap_length_m, unit: 'م' },
    ])}
    <div class="alert alert-warn" style="font-family:var(--mono);font-size:12px">${ld.development.code} | ${ld.lap_splice.code}</div>`;
}

function renderTieShapeDetail(t, title = 'تفاصيل شكل الكانة') {
  if (!t) return '';
  if (t.outer_tie) {
    return `
      ${renderResultCards([
        { label: 'طول الكانة الخارجية', value: t.outer_tie.total_length_m, unit: 'م' },
        { label: 'طول كل رابطة داخلية (Cross-tie)', value: t.cross_tie_length_each_m, unit: 'م' },
        { label: 'عدد الروابط الداخلية', value: t.cross_ties_count, unit: '' },
        { label: 'إجمالي طول المجموعة', value: t.total_length_per_set_m, unit: 'م' },
      ])}`;
  }
  return renderResultCards([
    { label: `شكل الكانة: ${t.shape}`, value: t.total_length_m, unit: 'م' },
    { label: 'طول الخطاف الواحد', value: t.hook_length_each_m, unit: 'م' },
    { label: 'عدد الخطافات', value: t.hooks_count, unit: '' },
  ]);
}

function renderCostBreakdown(cost) {
  if (!cost) return '';
  const cb = cost.cost_breakdown;
  return `
    <table class="detail-table">
      <caption>تفصيل تكلفة الحديد</caption>
      <tbody>
        <tr><td>المادة</td><td>${cb.material_cost}</td></tr>
        <tr><td>النقل</td><td>${cb.transport_cost}</td></tr>
        <tr><td>القص</td><td>${cb.cutting_cost}</td></tr>
        <tr><td>الثني</td><td>${cb.bending_cost}</td></tr>
        <tr><td>التركيب</td><td>${cb.installation_cost}</td></tr>
        <tr><td>المجموع الفرعي</td><td>${cb.subtotal}</td></tr>
        <tr><td>الخصم (${cb.discount_percent}%)</td><td>-${cb.discount_amount}</td></tr>
        <tr><td>الضريبة (${cb.tax_percent}%)</td><td>+${cb.tax_amount}</td></tr>
        <tr style="font-weight:bold;background:#f0ead9"><td>الإجمالي النهائي</td><td>${cb.grand_total}</td></tr>
      </tbody>
    </table>`;
}

// ---------- نماذج الإدخال لكل نوع عنصر ----------
const rebarForms = {
  footing: () => `
    <div class="form-grid">
      <div class="field-group-title">نوع القاعدة</div>
      <div class="field"><label>نوع القاعدة</label>
        <select id="rf-kind">
          <option value="isolated">منفصلة</option>
          <option value="combined">مشتركة</option>
          <option value="strip">شريطية</option>
          <option value="raft">لبشة</option>
        </select>
      </div>
      <div class="field-group-title">أبعاد القاعدة (منفصلة/لبشة/شريطية)</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="rf-length" value="2.0"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="rf-width" value="2.0"></div>
      <div class="field"><label>العمق/السمك (م)</label><input type="number" step="0.01" id="rf-depth" value="0.5"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="rf-main-dia" value="16"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="rf-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rf-cover" value="75"></div>
      ${designCodeFieldsHTML('rf')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rf-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rf')}
    </div>`,

  column: () => `
    <div class="form-grid">
      <div class="field-group-title">شكل المقطع</div>
      <div class="field"><label>شكل العمود</label>
        <select id="rc-shape"><option value="rectangular">مستطيل</option><option value="circular">دائري</option></select>
      </div>
      <div class="field" id="rc-width-field"><label>عرض المقطع (مم)</label><input type="number" id="rc-width" value="400"></div>
      <div class="field" id="rc-depth-field"><label>عمق المقطع (مم)</label><input type="number" id="rc-depth" value="400"></div>
      <div class="field" id="rc-diameter-field" style="display:none"><label>القطر (مم)</label><input type="number" id="rc-diameter" value="400"></div>
      <div class="field"><label>ارتفاع العمود (م)</label><input type="number" step="0.01" id="rc-height" value="3.0"></div>
      <div class="field-group-title">التسليح الطولي والكانات</div>
      <div class="field"><label>قطر التسليح الطولي (مم)</label><input type="number" id="rc-main-dia" value="16"></div>
      <div class="field"><label>عدد الأسياخ الطولية</label><input type="number" id="rc-main-count" value="8"></div>
      <div class="field"><label>قطر الكانات (مم)</label><input type="number" id="rc-tie-dia" value="8"></div>
      <div class="field"><label>تباعد الكانات (مم)</label><input type="number" id="rc-tie-spacing" value="200"></div>
      <div class="field"><label>شكل الكانة</label>
        <select id="rc-tie-shape"><option value="rectangular">مستطيلة/مربعة</option><option value="double">مزدوجة (Cross-ties)</option></select>
      </div>
      <div class="field"><label>زاوية الخطاف</label>
        <select id="rc-hook-angle"><option value="135" selected>135°</option><option value="90">90°</option><option value="180">180°</option></select>
      </div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rc-cover" value="40"></div>
      ${designCodeFieldsHTML('rc')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rc-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rc')}
    </div>`,

  beam: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد الكمرة</div>
      <div class="field"><label>العرض (مم)</label><input type="number" id="rb-width" value="250"></div>
      <div class="field"><label>الارتفاع (مم)</label><input type="number" id="rb-height" value="500"></div>
      <div class="field"><label>الطول الصافي (م)</label><input type="number" step="0.01" id="rb-span" value="5.0"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح العلوي (مم)</label><input type="number" id="rb-top-dia" value="16"></div>
      <div class="field"><label>عدد الأسياخ العلوية</label><input type="number" id="rb-top-count" value="2"></div>
      <div class="field"><label>قطر التسليح السفلي (مم)</label><input type="number" id="rb-bottom-dia" value="16"></div>
      <div class="field"><label>عدد الأسياخ السفلية</label><input type="number" id="rb-bottom-count" value="3"></div>
      <div class="field"><label>قطر الكانات (مم)</label><input type="number" id="rb-stirrup-dia" value="8"></div>
      <div class="field"><label>تباعد الكانات (مم)</label><input type="number" id="rb-stirrup-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rb-cover" value="25"></div>
      ${designCodeFieldsHTML('rb')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rb-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rb')}
    </div>`,

  slab: () => `
    <div class="form-grid">
      <div class="field-group-title">نوع البلاطة</div>
      <div class="field"><label>النوع</label>
        <select id="rs-kind"><option value="solid">مصمتة</option><option value="hollow">هوردي</option></select>
      </div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="rs-length" value="5.0"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="rs-width" value="4.0"></div>
      <div class="field"><label>السمك (مم)</label><input type="number" id="rs-thickness" value="150"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="rs-main-dia" value="10"></div>
      <div class="field"><label>التباعد الرئيسي (مم)</label><input type="number" id="rs-main-spacing" value="150"></div>
      <div class="field"><label>قطر تسليح التوزيع (مم)</label><input type="number" id="rs-sec-dia" value="10"></div>
      <div class="field"><label>تباعد التوزيع (مم)</label><input type="number" id="rs-sec-spacing" value="200"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rs-cover" value="20"></div>
      ${designCodeFieldsHTML('rs')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rs-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rs')}
    </div>`,

  wall: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد الجدار</div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="rw-length" value="5.0"></div>
      <div class="field"><label>الارتفاع (م)</label><input type="number" step="0.01" id="rw-height" value="3.0"></div>
      <div class="field"><label>السمك (مم)</label><input type="number" id="rw-thickness" value="200"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرأسي (مم)</label><input type="number" id="rw-vert-dia" value="12"></div>
      <div class="field"><label>تباعد رأسي (مم)</label><input type="number" id="rw-vert-spacing" value="200"></div>
      <div class="field"><label>قطر التسليح الأفقي (مم)</label><input type="number" id="rw-horiz-dia" value="10"></div>
      <div class="field"><label>تباعد أفقي (مم)</label><input type="number" id="rw-horiz-spacing" value="200"></div>
      <div class="field"><label>عدد الطبقات</label><input type="number" id="rw-layers" value="2"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rw-cover" value="25"></div>
      ${designCodeFieldsHTML('rw')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rw-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rw')}
    </div>`,

  staircase: () => `
    <div class="form-grid">
      <div class="field-group-title">أبعاد السلم (مجرى واحد)</div>
      <div class="field"><label>الارتفاع الكلي (م)</label><input type="number" step="0.01" id="rst-rise" value="1.7"></div>
      <div class="field"><label>ارتفاع القائمة (مم)</label><input type="number" id="rst-riser" value="170"></div>
      <div class="field"><label>عرض النائمة (مم)</label><input type="number" id="rst-tread" value="280"></div>
      <div class="field"><label>عرض السلم (م)</label><input type="number" step="0.01" id="rst-width" value="1.2"></div>
      <div class="field"><label>سمك البلاطة المائلة/القلبة (مم)</label><input type="number" id="rst-thickness" value="150"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="rst-main-dia" value="12"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="rst-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rst-cover" value="20"></div>
      ${designCodeFieldsHTML('rst')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rst-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rst')}
    </div>`,

  tank: () => `
    <div class="form-grid">
      <div class="field-group-title">شكل وأبعاد الخزان</div>
      <div class="field"><label>الشكل</label><select id="rt-shape"><option value="rectangular">مستطيل</option><option value="circular">دائري</option></select></div>
      <div class="field"><label>الطول (م) [مستطيل]</label><input type="number" step="0.01" id="rt-length" value="3.0"></div>
      <div class="field"><label>العرض (م) [مستطيل]</label><input type="number" step="0.01" id="rt-width" value="3.0"></div>
      <div class="field"><label>القطر (م) [دائري]</label><input type="number" step="0.01" id="rt-diameter" value="3.0"></div>
      <div class="field"><label>ارتفاع منسوب المياه (م)</label><input type="number" step="0.01" id="rt-water-height" value="2.2"></div>
      <div class="field"><label>فراغ أمان (م)</label><input type="number" step="0.01" id="rt-freeboard" value="0.3"></div>
      <div class="field"><label>سمك القاعدة (مم)</label><input type="number" id="rt-base-thickness" value="250"></div>
      <div class="field"><label>سمك الجدار (مم)</label><input type="number" id="rt-wall-thickness" value="200"></div>
      <div class="field"><label>سمك السقف (مم)</label><input type="number" id="rt-roof-thickness" value="150"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="rt-main-dia" value="12"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="rt-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rt-cover" value="50"></div>
      ${designCodeFieldsHTML('rt')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rt-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rt')}
    </div>`,

  pool: () => `
    <div class="form-grid">
      <div class="field-group-title">شكل وأبعاد المسبح</div>
      <div class="field"><label>الشكل</label><select id="rp-shape"><option value="rectangular">مستطيل</option><option value="circular">دائري</option></select></div>
      <div class="field"><label>الطول (م)</label><input type="number" step="0.01" id="rp-length" value="8.0"></div>
      <div class="field"><label>العرض (م)</label><input type="number" step="0.01" id="rp-width" value="4.0"></div>
      <div class="field"><label>القطر (م) [دائري]</label><input type="number" step="0.01" id="rp-diameter" value="5.0"></div>
      <div class="field"><label>العمق الضحل (م)</label><input type="number" step="0.01" id="rp-shallow" value="1.0"></div>
      <div class="field"><label>العمق العميق (م)</label><input type="number" step="0.01" id="rp-deep" value="2.0"></div>
      <div class="field"><label>سمك الجدار (مم)</label><input type="number" id="rp-wall-thickness" value="250"></div>
      <div class="field"><label>سمك القاعدة (مم)</label><input type="number" id="rp-floor-thickness" value="250"></div>
      <div class="field-group-title">التسليح</div>
      <div class="field"><label>قطر التسليح الرئيسي (مم)</label><input type="number" id="rp-main-dia" value="12"></div>
      <div class="field"><label>التباعد (مم)</label><input type="number" id="rp-spacing" value="150"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rp-cover" value="50"></div>
      ${designCodeFieldsHTML('rp')}
      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rp-waste" value="5"></div>
      ${rebarPricingFieldsHTML('rp')}
    </div>`,

  custom: () => `
    <div class="form-grid">
      <div class="field-group-title">عنصر مخصص (خوازيق، قبعات خرسانية، ميدات، جسور، أساسات شريطية، أو أي عنصر آخر)</div>
      <div class="field"><label>اسم العنصر</label><input type="text" id="rcu-name" value="عنصر إنشائي مخصص"></div>
      <div class="field-group-title">مجموعات القضبان</div>
      <div class="dynamic-rows" id="rcu-bars"></div>
      <button type="button" class="add-row-btn" id="rcu-add-bar">+ إضافة مجموعة قضبان</button>

      <div class="field-group-title">الكانة (اختياري)</div>
      <div class="field"><label>هل يحتاج العنصر كانات؟</label>
        <select id="rcu-has-ties"><option value="no">لا</option><option value="yes">نعم</option></select>
      </div>
      <div id="rcu-ties-fields" style="display:none">
        <div class="field"><label>شكل الكانة</label>
          <select id="rcu-tie-shape">
            <option value="rectangular">مستطيلة</option>
            <option value="square">مربعة</option>
            <option value="circular">دائرية</option>
            <option value="polygonal">متعددة الأضلاع</option>
          </select>
        </div>
        <div class="field" id="rcu-tie-w-field"><label>العرض الصافي (م)</label><input type="number" step="0.01" id="rcu-tie-w" value="0.3"></div>
        <div class="field" id="rcu-tie-h-field"><label>الارتفاع الصافي (م)</label><input type="number" step="0.01" id="rcu-tie-h" value="0.3"></div>
        <div class="field" id="rcu-tie-d-field" style="display:none"><label>القطر الصافي (م)</label><input type="number" step="0.01" id="rcu-tie-d" value="0.3"></div>
        <div class="field"><label>قطر سيخ الكانة (مم)</label><input type="number" id="rcu-tie-dia" value="8"></div>
        <div class="field"><label>عدد الكانات</label><input type="number" id="rcu-tie-count" value="10"></div>
        <div class="field"><label>زاوية الخطاف</label>
          <select id="rcu-tie-hook"><option value="135">135°</option><option value="90">90°</option><option value="180">180°</option></select>
        </div>
      </div>

      <div class="field-group-title">التراكب والتثبيت (اختياري)</div>
      <div class="field"><label>حساب التراكب/التثبيت؟</label>
        <select id="rcu-has-lap"><option value="no">لا</option><option value="yes">نعم</option></select>
      </div>
      <div id="rcu-lap-fields" style="display:none">
        <div class="field"><label>قطر السيخ الرئيسي (مم)</label><input type="number" id="rcu-lap-dia" value="16"></div>
        <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="rcu-lap-cover" value="40"></div>
        ${designCodeFieldsHTML('rcu-lap')}
      </div>

      <div class="field"><label>نسبة الهدر %</label><input type="number" step="0.1" id="rcu-waste" value="5"></div>
      <div class="field"><label>درجة الحديد</label>${steelGradeSelectHTML('rcu-grade')}</div>
      ${rebarPricingFieldsHTML('rcu')}
    </div>`,

  tools: () => `
    <div class="form-grid">
      <div class="field-group-title">أداة 1: حساب طول الخطاف</div>
      <div class="field"><label>قطر السيخ (مم)</label><input type="number" id="tool-hook-dia" value="16"></div>
      <div class="field"><label>زاوية الخطاف</label>
        <select id="tool-hook-angle"><option value="90">90°</option><option value="135" selected>135°</option><option value="180">180°</option></select>
      </div>
      <div class="field"><label>نوع السيخ</label>
        <select id="tool-hook-type"><option value="main">رئيسي</option><option value="tie">كانة</option></select>
      </div>
      <div class="btn-row"><button type="button" class="btn btn-outline" id="btn-tool-hook">احسب طول الخطاف</button></div>
      <div id="tool-hook-result"></div>

      <div class="field-group-title">أداة 2: مكتبة الكانات - أي شكل</div>
      <div class="field"><label>شكل الكانة</label>
        <select id="tool-tie-shape">
          <option value="rectangular">مستطيلة</option>
          <option value="square">مربعة</option>
          <option value="circular">دائرية</option>
          <option value="polygonal">متعددة الأضلاع (أدخل الأضلاع مفصولة بفاصلة، بالمتر)</option>
        </select>
      </div>
      <div class="field"><label>العرض الصافي (م) [أو الأضلاع للمضلع]</label><input type="text" id="tool-tie-w" value="0.3"></div>
      <div class="field"><label>الارتفاع/القطر الصافي (م)</label><input type="number" step="0.01" id="tool-tie-h" value="0.3"></div>
      <div class="field"><label>قطر السيخ (مم)</label><input type="number" id="tool-tie-dia" value="8"></div>
      <div class="field"><label>زاوية الخطاف</label>
        <select id="tool-tie-angle"><option value="90">90°</option><option value="135" selected>135°</option><option value="180">180°</option></select>
      </div>
      <div class="btn-row"><button type="button" class="btn btn-outline" id="btn-tool-tie">احسب طول الكانة</button></div>
      <div id="tool-tie-result"></div>

      <div class="field-group-title">أداة 3: طول التثبيت والتراكب</div>
      <div class="field"><label>قطر السيخ (مم)</label><input type="number" id="tool-dev-dia" value="16"></div>
      <div class="field"><label>مقاومة الخرسانة fc' (MPa)</label><input type="number" id="tool-dev-fc" value="25"></div>
      <div class="field"><label>الغطاء الخرساني (مم)</label><input type="number" id="tool-dev-cover" value="40"></div>
      <div class="field"><label>درجة الحديد</label>${steelGradeSelectHTML('tool-dev-grade')}</div>
      <div class="field"><label>موقع السيخ</label>
        <select id="tool-dev-location"><option value="other">عادي</option><option value="top">علوي (صب أكثر من 300مم تحته)</option></select>
      </div>
      <div class="field"><label>فئة التراكب</label>
        <select id="tool-dev-splice"><option value="B" selected>B</option><option value="A">A</option></select>
      </div>
      <div class="btn-row"><button type="button" class="btn btn-outline" id="btn-tool-dev">احسب التثبيت والتراكب</button></div>
      <div id="tool-dev-result"></div>
    </div>`,
};

let currentRebarSub = 'footing';
function renderRebarForm(sub) {
  currentRebarSub = sub;
  document.getElementById('rebar-forms').innerHTML = rebarForms[sub]();
  document.getElementById('results-rebar').innerHTML = '';
  document.getElementById('results-rebar').classList.remove('active');
  document.getElementById('btn-pdf-rebar').style.display = 'none';
  document.getElementById('btn-calc-rebar').style.display = (sub === 'tools') ? 'none' : 'inline-flex';

  if (sub === 'column') {
    const shapeSel = document.getElementById('rc-shape');
    shapeSel.addEventListener('change', () => {
      const circular = shapeSel.value === 'circular';
      document.getElementById('rc-width-field').style.display = circular ? 'none' : '';
      document.getElementById('rc-depth-field').style.display = circular ? 'none' : '';
      document.getElementById('rc-diameter-field').style.display = circular ? '' : 'none';
    });
  }

  if (sub === 'custom') {
    setupCustomRebarRows();
    document.getElementById('rcu-has-ties').addEventListener('change', (e) => {
      document.getElementById('rcu-ties-fields').style.display = e.target.value === 'yes' ? '' : 'none';
    });
    document.getElementById('rcu-tie-shape').addEventListener('change', (e) => {
      const isCircle = e.target.value === 'circular';
      document.getElementById('rcu-tie-w-field').style.display = isCircle ? 'none' : '';
      document.getElementById('rcu-tie-h-field').style.display = isCircle ? 'none' : '';
      document.getElementById('rcu-tie-d-field').style.display = isCircle ? '' : 'none';
    });
    document.getElementById('rcu-has-lap').addEventListener('change', (e) => {
      document.getElementById('rcu-lap-fields').style.display = e.target.value === 'yes' ? '' : 'none';
    });
  }

  if (sub === 'tools') {
    document.getElementById('btn-tool-hook').addEventListener('click', async () => {
      try {
        const data = await postJSON('/hook-length', {
          barDiameter_mm: getVal('tool-hook-dia'),
          hookAngle: parseInt(getStrVal('tool-hook-angle')),
          isTie: getStrVal('tool-hook-type') === 'tie',
        }, REBAR_API_BASE);
        document.getElementById('tool-hook-result').innerHTML = renderResultCards([
          { label: 'طول قوس الانحناء', value: data.arc_length_m, unit: 'م' },
          { label: 'الذيل المستقيم', value: data.straight_extension_m, unit: 'م' },
          { label: 'إجمالي طول الخطاف الإضافي', value: data.total_hook_length_m, unit: 'م' },
          { label: 'قطر الانحناء الداخلي', value: data.bend_diameter_mm, unit: 'مم' },
        ]);
      } catch (e) { document.getElementById('tool-hook-result').innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
    });

    document.getElementById('btn-tool-tie').addEventListener('click', async () => {
      try {
        const shapeType = getStrVal('tool-tie-shape');
        let params = { tieDiameter_mm: getVal('tool-tie-dia'), hookAngle: parseInt(getStrVal('tool-tie-angle')) };
        if (shapeType === 'circular') params.netDiameter_m = parseFloat(getStrVal('tool-tie-w'));
        else if (shapeType === 'polygonal') params.sides_m = getStrVal('tool-tie-w').split(',').map(s => parseFloat(s.trim()));
        else { params.netWidth_m = parseFloat(getStrVal('tool-tie-w')); params.netHeight_m = getVal('tool-tie-h'); }
        if (shapeType === 'square') params.netSide_m = parseFloat(getStrVal('tool-tie-w'));
        const data = await postJSON('/tie-shape', { shapeType, ...params }, REBAR_API_BASE);
        document.getElementById('tool-tie-result').innerHTML = renderTieShapeDetail(data);
      } catch (e) { document.getElementById('tool-tie-result').innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
    });

    document.getElementById('btn-tool-dev').addEventListener('click', async () => {
      try {
        const fy = (REBAR_REFERENCE.steel_grades[getStrVal('tool-dev-grade')] || {}).fy || 420;
        const dev = await postJSON('/development-length', {
          barDiameter_mm: getVal('tool-dev-dia'), fc_MPa: getVal('tool-dev-fc'), fy_MPa: fy,
          concreteCover_mm: getVal('tool-dev-cover'), barLocation: getStrVal('tool-dev-location'),
        }, REBAR_API_BASE);
        const lap = await postJSON('/lap-splice-length', {
          barDiameter_mm: getVal('tool-dev-dia'), fc_MPa: getVal('tool-dev-fc'), fy_MPa: fy,
          concreteCover_mm: getVal('tool-dev-cover'), barLocation: getStrVal('tool-dev-location'),
          spliceClass: getStrVal('tool-dev-splice'),
        }, REBAR_API_BASE);
        document.getElementById('tool-dev-result').innerHTML = renderLapDevelopment(lap);
      } catch (e) { document.getElementById('tool-dev-result').innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
    });
  }
}

function setupCustomRebarRows() {
  const wrap = document.getElementById('rcu-bars');
  let rowCount = 0;
  function addBarRow() {
    rowCount++;
    const row = el(`<div class="dynamic-row" data-row="${rowCount}">
      <input type="text" placeholder="الوصف" class="rcu-bar-desc" value="مجموعة ${rowCount}">
      <input type="number" placeholder="القطر (مم)" class="rcu-bar-dia" value="16">
      <input type="number" placeholder="الطول/سيخ (م)" step="0.01" class="rcu-bar-len" value="3.0">
      <input type="number" placeholder="العدد" class="rcu-bar-count" value="4">
      <button type="button" class="remove-row-btn">✕</button>
    </div>`);
    row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
    wrap.appendChild(row);
  }
  document.getElementById('rcu-add-bar').addEventListener('click', addBarRow);
  addBarRow(); addBarRow();
}

document.querySelectorAll('#rebar-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#rebar-subtabs .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderRebarForm(btn.dataset.sub);
  });
});

document.getElementById('btn-calc-rebar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-calc-rebar');
  const container = document.getElementById('results-rebar');
  setLoading(btn, true);
  container.classList.remove('active');
  document.getElementById('btn-pdf-rebar').style.display = 'none';

  try {
    let endpoint, body, resultHTML, weightKg = 0, costTotal = 0;

    if (currentRebarSub === 'footing') {
      const kind = getStrVal('rf-kind');
      endpoint = `/footings/${kind}`;
      const codeFields = readDesignCodeFields('rf');
      body = {
        length_m: getVal('rf-length'), width_m: getVal('rf-width'), depth_m: getVal('rf-depth'), thickness_m: getVal('rf-depth'),
        totalLength_m: getVal('rf-length'),
        mainBarDiameter_mm: getVal('rf-main-dia'), distributionBarDiameter_mm: getVal('rf-main-dia'),
        barSpacing_mm: getVal('rf-spacing'), concreteCover_mm: getVal('rf-cover'),
        wastePercent: (getVal('rf-waste') || 5) / 100, ...codeFields, pricing: readRebarPricing('rf'),
      };
      const data = await postJSON(endpoint, body, REBAR_API_BASE);
      const rc = data.reinforcement || (data.exterior_footing ? null : null);
      weightKg = rc ? rc.total_weight_kg : 0;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'حجم الخرسانة', value: data.volume_m3, unit: 'م³' },
          { label: 'وزن الحديد الإجمالي', value: weightKg, unit: 'كجم' },
        ])}
        ${rc ? renderRebarTable(rc, 'تفاصيل تسليح القاعدة') : ''}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'column') {
      const codeFields = readDesignCodeFields('rc');
      const shape = getStrVal('rc-shape');
      body = {
        shape, width_mm: getVal('rc-width'), depth_mm: getVal('rc-depth'), diameter_mm: getVal('rc-diameter'),
        height_m: getVal('rc-height'), mainBarDiameter_mm: getVal('rc-main-dia'), mainBarsCount: getVal('rc-main-count'),
        tieDiameter_mm: getVal('rc-tie-dia'), tieSpacing_mm: getVal('rc-tie-spacing'), tieShape: getStrVal('rc-tie-shape'),
        hookAngle: parseInt(getStrVal('rc-hook-angle')), concreteCover_mm: getVal('rc-cover'),
        wastePercent: (getVal('rc-waste') || 5) / 100, ...codeFields, pricing: readRebarPricing('rc'),
      };
      const data = await postJSON('/columns', body, REBAR_API_BASE);
      weightKg = data.reinforcement.total_steel_weight_kg;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'حجم الخرسانة', value: data.volume_m3, unit: 'م³' },
          { label: 'وزن الحديد الطولي', value: data.reinforcement.main_bars.total_weight_kg, unit: 'كجم' },
          { label: 'وزن الكانات', value: data.reinforcement.ties.total_weight_kg, unit: 'كجم' },
          { label: 'الوزن الإجمالي', value: weightKg, unit: 'كجم' },
          { label: 'نسبة التسليح', value: data.steel_ratio_percent, unit: '%' },
        ])}
        ${renderRebarTable(data.reinforcement.main_bars, 'التسليح الطولي')}
        ${renderRebarTable(data.reinforcement.ties, 'الكانات (حساب مبسط)')}
        ${renderTieShapeDetail(data.tie_shape_detail, 'الكانة من مكتبة الأشكال (دقيق)')}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'beam') {
      const codeFields = readDesignCodeFields('rb');
      body = {
        width_mm: getVal('rb-width'), height_mm: getVal('rb-height'), span_m: getVal('rb-span'),
        topBarDiameter_mm: getVal('rb-top-dia'), topBarsCount: getVal('rb-top-count'),
        bottomBarDiameter_mm: getVal('rb-bottom-dia'), bottomBarsCount: getVal('rb-bottom-count'),
        stirrupDiameter_mm: getVal('rb-stirrup-dia'), stirrupSpacing_mm: getVal('rb-stirrup-spacing'),
        concreteCover_mm: getVal('rb-cover'), wastePercent: (getVal('rb-waste') || 5) / 100,
        ...codeFields, pricing: readRebarPricing('rb'),
      };
      const data = await postJSON('/beams', body, REBAR_API_BASE);
      weightKg = data.reinforcement.total_steel_weight_kg;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'حجم الخرسانة', value: data.volume_m3, unit: 'م³' },
          { label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' },
          { label: 'نسبة التسليح', value: data.steel_ratio_percent, unit: '%' },
        ])}
        ${renderRebarTable(data.reinforcement.top_bars, 'التسليح العلوي')}
        ${renderRebarTable(data.reinforcement.bottom_bars, 'التسليح السفلي')}
        ${renderRebarTable(data.reinforcement.stirrups, 'الكانات (حساب مبسط)')}
        ${renderTieShapeDetail(data.stirrup_shape_detail, 'الكانة من مكتبة الأشكال (دقيق)')}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'slab') {
      const kind = getStrVal('rs-kind');
      const codeFields = readDesignCodeFields('rs');
      body = {
        length_m: getVal('rs-length'), width_m: getVal('rs-width'), thickness_mm: getVal('rs-thickness'),
        totalThickness_mm: getVal('rs-thickness'),
        mainBarDiameter_mm: getVal('rs-main-dia'), mainBarSpacing_mm: getVal('rs-main-spacing'),
        secondaryBarDiameter_mm: getVal('rs-sec-dia'), secondaryBarSpacing_mm: getVal('rs-sec-spacing'),
        concreteCover_mm: getVal('rs-cover'), wastePercent: (getVal('rs-waste') || 5) / 100,
        ...codeFields, pricing: readRebarPricing('rs'),
      };
      const data = await postJSON(`/slabs/${kind === 'hollow' ? 'hollow-block' : 'solid'}`, body, REBAR_API_BASE);
      weightKg = data.reinforcement.total_weight_kg;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'مساحة البلاطة', value: data.area_m2, unit: 'م²' },
          { label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' },
        ])}
        ${renderRebarTable(data.reinforcement, 'تفاصيل تسليح البلاطة')}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'wall') {
      const codeFields = readDesignCodeFields('rw');
      body = {
        length_m: getVal('rw-length'), height_m: getVal('rw-height'), thickness_mm: getVal('rw-thickness'),
        verticalBarDiameter_mm: getVal('rw-vert-dia'), verticalBarSpacing_mm: getVal('rw-vert-spacing'),
        horizontalBarDiameter_mm: getVal('rw-horiz-dia'), horizontalBarSpacing_mm: getVal('rw-horiz-spacing'),
        layers: getVal('rw-layers'), concreteCover_mm: getVal('rw-cover'),
        wastePercent: (getVal('rw-waste') || 5) / 100, ...codeFields, pricing: readRebarPricing('rw'),
      };
      const data = await postJSON('/walls', body, REBAR_API_BASE);
      weightKg = data.reinforcement.total_weight_kg;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'المساحة الصافية', value: data.net_area_m2, unit: 'م²' },
          { label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' },
        ])}
        ${renderRebarTable(data.reinforcement, 'تفاصيل تسليح الجدار')}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'staircase') {
      const codeFields = readDesignCodeFields('rst');
      body = {
        totalRiseHeight_m: getVal('rst-rise'), riserHeight_mm: getVal('rst-riser'), treadWidth_mm: getVal('rst-tread'),
        flightWidth_m: getVal('rst-width'), waistSlabThickness_mm: getVal('rst-thickness'),
        mainBarDiameter_mm: getVal('rst-main-dia'), barSpacing_mm: getVal('rst-spacing'),
        concreteCover_mm: getVal('rst-cover'), wastePercent: (getVal('rst-waste') || 5) / 100,
        ...codeFields, pricing: readRebarPricing('rst'),
      };
      const data = await postJSON('/staircases', body, REBAR_API_BASE);
      weightKg = data.total_steel_weight_kg || 0;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'حجم الخرسانة', value: data.total_concrete_volume_m3, unit: 'م³' },
          { label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' },
        ])}
        ${(data.reinforcement.flights_detail || []).map((r, i) => renderRebarTable(r, `تفاصيل تسليح المجرى ${i + 1}`)).join('')}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'tank') {
      const codeFields = readDesignCodeFields('rt');
      body = {
        tankShape: getStrVal('rt-shape'), length_m: getVal('rt-length'), width_m: getVal('rt-width'),
        diameter_m: getVal('rt-diameter'), waterHeight_m: getVal('rt-water-height'), freeboard_m: getVal('rt-freeboard'),
        baseThickness_mm: getVal('rt-base-thickness'), wallThickness_mm: getVal('rt-wall-thickness'), roofThickness_mm: getVal('rt-roof-thickness'),
        mainBarDiameter_mm: getVal('rt-main-dia'), barSpacing_mm: getVal('rt-spacing'),
        concreteCover_mm: getVal('rt-cover'), wastePercent: (getVal('rt-waste') || 5) / 100,
        ...codeFields, pricing: readRebarPricing('rt'),
      };
      const data = await postJSON('/tanks', body, REBAR_API_BASE);
      weightKg = data.reinforcement?.total_steel_weight_kg || 0;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([{ label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' }])}
        ${data.reinforcement?.base ? renderRebarTable(data.reinforcement.base, 'تسليح القاعدة') : ''}
        ${data.reinforcement?.walls ? renderRebarTable(data.reinforcement.walls, 'تسليح الجدران') : ''}
        ${data.reinforcement?.roof ? renderRebarTable(data.reinforcement.roof, 'تسليح السقف') : ''}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'pool') {
      const codeFields = readDesignCodeFields('rp');
      body = {
        poolShape: getStrVal('rp-shape'), length_m: getVal('rp-length'), width_m: getVal('rp-width'),
        diameter_m: getVal('rp-diameter'), shallowDepth_m: getVal('rp-shallow'), deepDepth_m: getVal('rp-deep'),
        wallThickness_mm: getVal('rp-wall-thickness'), floorThickness_mm: getVal('rp-floor-thickness'),
        mainBarDiameter_mm: getVal('rp-main-dia'), barSpacing_mm: getVal('rp-spacing'),
        concreteCover_mm: getVal('rp-cover'), wastePercent: (getVal('rp-waste') || 5) / 100,
        ...codeFields, pricing: readRebarPricing('rp'),
      };
      const data = await postJSON('/pools', body, REBAR_API_BASE);
      weightKg = data.reinforcement?.total_steel_weight_kg || 0;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([{ label: 'الوزن الإجمالي للحديد', value: weightKg, unit: 'كجم' }])}
        ${data.reinforcement?.floor ? renderRebarTable(data.reinforcement.floor, 'تسليح الأرضية') : ''}
        ${data.reinforcement?.walls ? renderRebarTable(data.reinforcement.walls, 'تسليح الجدران') : ''}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderDesignChecks(data.design_checks)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;

    } else if (currentRebarSub === 'custom') {
      const bars = Array.from(document.querySelectorAll('#rcu-bars .dynamic-row')).map(row => ({
        description: row.querySelector('.rcu-bar-desc').value,
        diameter: parseFloat(row.querySelector('.rcu-bar-dia').value),
        length_m: parseFloat(row.querySelector('.rcu-bar-len').value),
        count: parseInt(row.querySelector('.rcu-bar-count').value),
      }));
      const hasTies = getStrVal('rcu-has-ties') === 'yes';
      let ties = null, tiesCount = 0;
      if (hasTies) {
        const shapeType = getStrVal('rcu-tie-shape');
        const tieDiameter_mm = getVal('rcu-tie-dia');
        const hookAngle = parseInt(getStrVal('rcu-tie-hook'));
        let params = { tieDiameter_mm, hookAngle };
        if (shapeType === 'circular') params.netDiameter_m = getVal('rcu-tie-d');
        else if (shapeType === 'square') params.netSide_m = getVal('rcu-tie-w');
        else if (shapeType === 'polygonal') params.sides_m = getStrVal('rcu-tie-w').split(',').map(s => parseFloat(s.trim()));
        else { params.netWidth_m = getVal('rcu-tie-w'); params.netHeight_m = getVal('rcu-tie-h'); }
        ties = { shapeType, params };
        tiesCount = getVal('rcu-tie-count') || 0;
      }
      const hasLap = getStrVal('rcu-has-lap') === 'yes';
      let lapAnalysis = null;
      if (hasLap) {
        const fy = (REBAR_REFERENCE.steel_grades[getStrVal('rcu-lap-grade')] || {}).fy || 420;
        lapAnalysis = {
          barDiameter_mm: getVal('rcu-lap-dia'), fc_MPa: getVal('rcu-lap-fc'), fy_MPa: fy,
          concreteCover_mm: getVal('rcu-lap-cover'), spliceClass: getStrVal('rcu-lap-splice-class') || 'B',
        };
      }
      body = {
        elementName: getStrVal('rcu-name'), bars, wastePercent: (getVal('rcu-waste') || 5) / 100,
        steelGrade: getStrVal('rcu-grade'), ties, tiesCount, lapAnalysis, pricing: readRebarPricing('rcu'),
      };
      const data = await postJSON('/custom-element', body, REBAR_API_BASE);
      weightKg = data.total_weight_kg;
      costTotal = data.cost ? data.cost.cost_breakdown.grand_total : 0;
      resultHTML = `
        ${renderResultCards([
          { label: 'الوزن الإجمالي', value: weightKg, unit: 'كجم' },
          { label: 'الوزن بالطن', value: data.total_weight_ton, unit: 'طن' },
        ])}
        ${renderRebarTable(data.main_reinforcement, 'التسليح الرئيسي')}
        ${data.tie_shape_detail ? renderTieShapeDetail(data.tie_shape_detail) : ''}
        ${data.ties_reinforcement ? renderRebarTable(data.ties_reinforcement, 'وزن الكانات') : ''}
        ${renderLapDevelopment(data.lap_and_development)}
        ${renderCostBreakdown(data.cost)}`;
      lastInputs['rebar'] = body; lastResults['rebar'] = data;
    }

    container.innerHTML = resultHTML;
    container.classList.add('active');
    document.getElementById('btn-pdf-rebar').style.display = 'inline-block';
    logRebarOperation(currentRebarSub, weightKg, costTotal);
  } catch (e) {
    showError(container, e.message);
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('btn-pdf-rebar').addEventListener('click', () => openPdfModal('rebar', 'حاسبة حديد التسليح', REBAR_API_BASE));

// أول تحميل لنموذج القسم الثاني عند فتح لوحته لأول مرة
document.querySelector('[data-panel="rebar"]').addEventListener('click', () => {
  if (!document.getElementById('rebar-forms').innerHTML.trim()) {
    renderRebarForm('footing');
  }
}, { once: false });

// ---------- تهيئة أولية ----------
loadReferenceData();
loadRebarReferenceData();
