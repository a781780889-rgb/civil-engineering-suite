// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (DMS) — الإشعارات
// ============================================================

const DMS_NOTIF_API = '/api/dms/notifications';

function dmsNotifFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_NOTIF_API}${pathStr}`;
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

function dmsNotifSeverityColor(severity) {
  switch (severity) {
    case 'danger': return '#c0392b';
    case 'warning': return '#c98a2c';
    case 'success': return '#2e7d4f';
    default: return '#4a7ab5';
  }
}

function dmsNotifTimeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

// ===================== جرس الإشعارات في الشريط العلوي =====================

let dmsNotifBellPollInterval = null;

async function dmsNotifRefreshBadge() {
  try {
    const res = await dmsNotifFetch('/unread-count');
    const count = res.data?.unread_count || 0;
    const badge = document.getElementById('dms-bell-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) {
    // صامت: لا نزعج المستخدم بخطأ عابر في الخلفية
  }
}

async function dmsNotifRenderBellList() {
  const list = document.getElementById('dms-bell-list');
  if (!list) return;
  list.innerHTML = 'جارِ التحميل...';
  try {
    const res = await dmsNotifFetch('/feed', { query: { pageSize: 8, page: 1 } });
    const items = res.data || [];
    if (!items.length) {
      list.innerHTML = '<div class="dms-bell-empty">لا توجد إشعارات حالياً</div>';
      return;
    }
    list.innerHTML = items.map((n) => `
      <div class="dms-bell-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}">
        <span class="dms-bell-dot" style="background:${dmsNotifSeverityColor(n.severity)}"></span>
        <div class="dms-bell-body">
          <div class="dms-bell-msg">${n.message}</div>
          <div class="dms-bell-time">${dmsNotifTimeAgo(n.created_at)}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.dms-bell-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        try {
          await dmsNotifFetch('/mark-read', { method: 'POST', body: { id } });
          el.classList.remove('unread');
          dmsNotifRefreshBadge();
        } catch (e) { /* تجاهل */ }
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="dms-bell-empty" style="color:#c0392b">${e.message}</div>`;
  }
}

function dmsNotifInitBell() {
  const btn = document.getElementById('dms-bell-btn');
  const dropdown = document.getElementById('dms-bell-dropdown');
  const wrap = document.getElementById('dms-bell-wrap');
  const markAllBtn = document.getElementById('dms-bell-mark-all');
  const viewAllLink = document.getElementById('dms-bell-view-all');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) dmsNotifRenderBellList();
  });

  document.addEventListener('click', (e) => {
    if (wrap && !wrap.contains(e.target)) dropdown.style.display = 'none';
  });

  if (markAllBtn) {
    markAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await dmsNotifFetch('/mark-all-read', { method: 'POST' });
        await dmsNotifRenderBellList();
        await dmsNotifRefreshBadge();
      } catch (err) { /* تجاهل */ }
    });
  }

  if (viewAllLink) {
    viewAllLink.addEventListener('click', (e) => {
      e.preventDefault();
      dropdown.style.display = 'none';
      const navItem = document.querySelector('.nav-item[data-panel="dms-notifications"]');
      if (navItem) navItem.click();
    });
  }

  dmsNotifRefreshBadge();
  // تحديث دوري للعداد كل 60 ثانية دون إزعاج المستخدم بأي إشعار متصفح
  dmsNotifBellPollInterval = setInterval(dmsNotifRefreshBadge, 60000);
}

// ===================== صفحة الإشعارات الكاملة =====================

let dmsNotifCurrentPage = 1;

function dmsNotifStatusLabel(readAt) {
  return readAt
    ? '<span style="color:#2e7d4f">مقروء</span>'
    : '<span style="color:#c0392b;font-weight:600">غير مقروء</span>';
}

async function dmsNotifLoadPage(page = 1) {
  dmsNotifCurrentPage = page;
  const tbody = document.getElementById('dms-notif-tbody');
  const pagination = document.getElementById('dms-notif-pagination');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">جارِ التحميل...</td></tr>';

  const projectId = document.getElementById('dms-notif-filter-project')?.value.trim() || null;
  const unreadOnly = document.getElementById('dms-notif-unread-only')?.checked || false;

  try {
    const res = await dmsNotifFetch('/feed', {
      query: { projectId, unreadOnly: unreadOnly ? 'true' : '', page, pageSize: 20 },
    });
    const items = res.data || [];
    const p = res.pagination || { total: items.length, page: 1, totalPages: 1 };

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7">لا توجد إشعارات مطابقة</td></tr>';
    } else {
      tbody.innerHTML = items.map((n) => `
        <tr>
          <td><span style="color:${dmsNotifSeverityColor(n.severity)}">${n.type_label || n.type}</span></td>
          <td>${n.message}</td>
          <td>${n.document_id || '-'}</td>
          <td>${n.project_id || '-'}</td>
          <td>${new Date(n.created_at).toLocaleString('ar-EG')}</td>
          <td>${dmsNotifStatusLabel(n.read_at)}</td>
          <td>${n.read_at ? '' : `<button class="btn btn-sm dms-notif-mark-row" data-id="${n.id}">تعليم كمقروء</button>`}</td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.dms-notif-mark-row').forEach((btnEl) => {
        btnEl.addEventListener('click', async () => {
          try {
            await dmsNotifFetch('/mark-read', { method: 'POST', body: { id: btnEl.getAttribute('data-id') } });
            await dmsNotifLoadPage(dmsNotifCurrentPage);
            await dmsNotifRefreshBadge();
          } catch (e) { alert(e.message); }
        });
      });
    }

    if (pagination) {
      const totalPages = p.totalPages || 1;
      let html = '';
      for (let i = 1; i <= totalPages; i += 1) {
        html += `<button class="btn btn-sm ${i === p.page ? 'btn-primary' : ''}" data-page="${i}">${i}</button>`;
      }
      pagination.innerHTML = html;
      pagination.querySelectorAll('button[data-page]').forEach((b) => {
        b.addEventListener('click', () => dmsNotifLoadPage(Number(b.getAttribute('data-page'))));
      });
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#c0392b">${e.message}</td></tr>`;
  }
}

async function dmsNotifLoadSummary() {
  const host = document.getElementById('dms-notif-summary');
  if (!host) return;
  try {
    const projectId = document.getElementById('dms-notif-filter-project')?.value.trim() || null;
    const res = await dmsNotifFetch('/summary', { query: { projectId } });
    const s = res.data;
    host.innerHTML = `
      إجمالي الإشعارات: <strong>${s.total_notifications}</strong> &nbsp;|&nbsp;
      قارب على الانتهاء: <strong style="color:#c98a2c">${s.expiring_soon}</strong> &nbsp;|&nbsp;
      منتهي: <strong style="color:#c0392b">${s.expired}</strong> &nbsp;|&nbsp;
      مراجعات معلّقة: <strong style="color:#4a7ab5">${s.pending_reviews}</strong>
    `;
  } catch (e) {
    host.innerHTML = `<span style="color:#c0392b">${e.message}</span>`;
  }
}

function dmsNotifInitPanel() {
  const refreshBtn = document.getElementById('dms-notif-btn-refresh');
  const markAllBtn = document.getElementById('dms-notif-btn-mark-all');
  const checkExpiryBtn = document.getElementById('dms-notif-btn-check-expiry');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      dmsNotifLoadPage(1);
      dmsNotifLoadSummary();
    });
  }
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      try {
        const projectId = document.getElementById('dms-notif-filter-project')?.value.trim() || null;
        await dmsNotifFetch('/mark-all-read', { method: 'POST', body: { projectId } });
        await dmsNotifLoadPage(dmsNotifCurrentPage);
        await dmsNotifLoadSummary();
        await dmsNotifRefreshBadge();
      } catch (e) { alert(e.message); }
    });
  }
  if (checkExpiryBtn) {
    checkExpiryBtn.addEventListener('click', async () => {
      try {
        const res = await dmsNotifFetch('/check-expiry', { method: 'POST' });
        alert(`تم فحص ${res.data.checked} مستند بحثاً عن مستندات منتهية أو قاربت على الانتهاء`);
        await dmsNotifLoadPage(dmsNotifCurrentPage);
        await dmsNotifLoadSummary();
        await dmsNotifRefreshBadge();
      } catch (e) { alert(e.message); }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  dmsNotifInitBell();

  const navItem = document.querySelector('.nav-item[data-panel="dms-notifications"]');
  if (navItem) {
    let loaded = false;
    navItem.addEventListener('click', () => {
      if (!loaded) {
        loaded = true;
        dmsNotifInitPanel();
      }
      dmsNotifLoadPage(1);
      dmsNotifLoadSummary();
    });
  }
});
