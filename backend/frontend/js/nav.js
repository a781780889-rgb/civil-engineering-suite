// ============================================================
// Civil Engineering Suite — Home / Section Navigation Layer
// يبني صفحة رئيسية بالأقسام فقط، وصفحة تفصيلية لكل قسم،
// بدون أي تعديل على منطق الحاسبات الأصلي في app.js
// ============================================================

(function () {
  const SECTION_ICONS = {
    s1: '◇', s2: '⛓', s4: '▦', s5: '⏱', s7: '⚙', s8: '🦺'
  };

  function buildSections() {
    const titles = Array.from(document.querySelectorAll('.sidebar-title[data-section]'));
    return titles.map((titleEl, idx) => {
      const sectionId = titleEl.dataset.section;
      const nextTitle = titles[idx + 1] || null;
      const items = [];
      let node = titleEl.nextElementSibling;
      while (node && node !== nextTitle) {
        if (node.classList && node.classList.contains('nav-item')) {
          node.dataset.section = sectionId; // وسم كل عنصر بقسمه
          items.push(node);
        }
        node = node.nextElementSibling;
      }
      return {
        id: sectionId,
        title: titleEl.textContent.trim(),
        items,
      };
    });
  }

  const SECTIONS = buildSections();

  function showView(viewName) {
    document.getElementById('home-view').classList.toggle('active', viewName === 'home');
    document.getElementById('section-view').classList.toggle('active', viewName === 'section');
    document.getElementById('app-layout').classList.toggle('active', viewName === 'app');
  }

  function renderHome() {
    const grid = document.getElementById('home-grid');
    grid.innerHTML = SECTIONS.map(sec => `
      <div class="home-card" data-section="${sec.id}">
        <div class="home-card-icon">${SECTION_ICONS[sec.id] || '◆'}</div>
        <h3>${sec.title}</h3>
        <div class="home-card-count">${sec.items.length} عنصر</div>
      </div>
    `).join('');

    grid.querySelectorAll('.home-card').forEach(card => {
      card.addEventListener('click', () => openSection(card.dataset.section));
    });
  }

  function openSection(sectionId) {
    const sec = SECTIONS.find(s => s.id === sectionId);
    if (!sec) return;

    document.getElementById('section-view-title').textContent = sec.title;
    const grid = document.getElementById('section-grid');
    grid.innerHTML = sec.items.map(item => {
      const icon = item.querySelector('.nav-icon');
      const label = item.textContent.trim();
      return `
        <div class="section-item-card" data-panel="${item.dataset.panel}">
          <span class="nav-icon">${icon ? icon.textContent : '•'}</span>
          <span class="label">${label}</span>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.section-item-card').forEach(card => {
      card.addEventListener('click', () => openPanel(card.dataset.panel));
    });

    showView('section');
  }

  function openPanel(panelId) {
    // فعّل نفس آلية app.js الأصلية عبر محاكاة الضغط على nav-item المطابق
    const navItem = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
    if (navItem) navItem.click();
    showView('app');
  }

  function goHome() {
    showView('home');
  }

  document.getElementById('btn-back-home').addEventListener('click', goHome);
  document.getElementById('btn-back-home-2').addEventListener('click', goHome);

  renderHome();
  showView('home');
})();
