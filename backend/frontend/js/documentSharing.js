// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (DMS) — مشاركة المستندات
// (روابط آمنة خارجية + مشاركة داخلية بالمستخدم/الدور)
// ============================================================

const DMS_SHARE_API = '/api/dms/share';

function dmsShFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_SHARE_API}${pathStr}`;
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

const DMS_SHARE_PERMISSION_LABELS = { view: 'قراءة فقط', download: 'قراءة وتنزيل', edit: 'قراءة وتعديل' };

function dmsShAbsoluteShareUrl(token) {
  return `${window.location.origin}/share/${token}`;
}

function dmsShLinkStateBadge(link) {
  if (link.is_revoked) return '<span class="dms-badge dms-badge-danger">ملغى</span>';
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return '<span class="dms-badge dms-badge-warning">منتهي</span>';
  }
  if (link.max_opens && link.open_count >= link.max_opens) {
    return '<span class="dms-badge dms-badge-warning">تجاوز حد الفتحات</span>';
  }
  return '<span class="dms-badge dms-badge-success">فعّال</span>';
}

// ============================================================
// لوحة المشاركة الخاصة بمستند واحد (تُضاف داخل dmsViewDocument)
// ============================================================

/** يُضاف داخل لوحة تفاصيل المستند (dmsViewDocument) لعرض/إنشاء روابط ومشاركات هذا المستند فقط */
async function dmsShRenderDocumentPanel(docId) {
  const host = document.getElementById('dms-doc-share-panel');
  if (!host) return;

  host.innerHTML = `
    <div class="calc-card" style="padding:0;border:none">
      <h5 style="margin-top:0">إنشاء رابط مشاركة آمن (خارجي)</h5>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <select id="dms-sh-link-perm">
          <option value="view">قراءة فقط</option>
          <option value="download">قراءة وتنزيل</option>
          <option value="edit">قراءة وتعديل</option>
        </select>
        <input type="password" id="dms-sh-link-password" placeholder="كلمة مرور (اختياري)" style="min-width:160px" />
        <input type="datetime-local" id="dms-sh-link-expires" title="تاريخ انتهاء الرابط (اختياري)" />
        <input type="number" id="dms-sh-link-max-opens" placeholder="حد الفتحات (اختياري)" min="1" style="width:150px" />
        <input type="text" id="dms-sh-link-note" placeholder="ملاحظة (اختياري)" style="min-width:160px" />
        <button class="btn btn-primary btn-sm" id="dms-sh-btn-create-link">إنشاء رابط</button>
      </div>
      <div id="dms-sh-create-link-result" style="margin-top:8px"></div>

      <h5 style="margin-top:16px">روابط المشاركة الخارجية لهذا المستند</h5>
      <div id="dms-sh-links-list">جارِ التحميل...</div>

      <h5 style="margin-top:18px">مشاركة داخلية (بمستخدم أو دور محدد)</h5>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <select id="dms-sh-internal-type">
          <option value="user">مستخدم</option>
          <option value="role">دور</option>
        </select>
        <input type="text" id="dms-sh-internal-grantee" placeholder="اسم المستخدم أو الدور" style="min-width:160px" />
        <select id="dms-sh-internal-perm">
          <option value="view">قراءة فقط</option>
          <option value="download">قراءة وتنزيل</option>
          <option value="edit">قراءة وتعديل</option>
        </select>
        <input type="datetime-local" id="dms-sh-internal-expires" title="تاريخ انتهاء الصلاحية (اختياري)" />
        <button class="btn btn-primary btn-sm" id="dms-sh-btn-create-internal">منح صلاحية</button>
      </div>
      <div id="dms-sh-create-internal-result" style="margin-top:8px"></div>

      <h5 style="margin-top:16px">المشاركات الداخلية لهذا المستند</h5>
      <div id="dms-sh-internal-list">جارِ التحميل...</div>
    </div>
  `;

  document.getElementById('dms-sh-btn-create-link').addEventListener('click', () => dmsShCreateLink(docId));
  document.getElementById('dms-sh-btn-create-internal').addEventListener('click', () => dmsShCreateInternal(docId));

  await dmsShLoadLinksForDocument(docId);
  await dmsShLoadInternalForDocument(docId);
}

async function dmsShCreateLink(docId) {
  const out = document.getElementById('dms-sh-create-link-result');
  const permission = document.getElementById('dms-sh-link-perm').value;
  const password = document.getElementById('dms-sh-link-password').value || null;
  const expiresRaw = document.getElementById('dms-sh-link-expires').value || null;
  const maxOpensRaw = document.getElementById('dms-sh-link-max-opens').value || null;
  const note = document.getElementById('dms-sh-link-note').value || null;

  out.innerHTML = '<div class="result-card">جارِ إنشاء الرابط...</div>';
  try {
    const res = await dmsShFetch('/links', {
      method: 'POST',
      body: {
        document_id: docId,
        permission,
        password,
        expires_at: expiresRaw ? new Date(expiresRaw).toISOString() : null,
        max_opens: maxOpensRaw ? parseInt(maxOpensRaw, 10) : null,
        note,
      },
    });
    const url = dmsShAbsoluteShareUrl(res.data.token);
    out.innerHTML = `
      <div class="result-card" style="color:#2e7d32">
        تم إنشاء الرابط بنجاح.
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" readonly value="${url}" style="min-width:280px" id="dms-sh-new-link-url" />
          <button class="btn btn-sm" id="dms-sh-btn-copy-link">نسخ الرابط</button>
        </div>
      </div>`;
    document.getElementById('dms-sh-btn-copy-link').addEventListener('click', () => {
      const input = document.getElementById('dms-sh-new-link-url');
      input.select();
      navigator.clipboard?.writeText(input.value).catch(() => document.execCommand('copy'));
    });
    document.getElementById('dms-sh-link-password').value = '';
    document.getElementById('dms-sh-link-note').value = '';
    await dmsShLoadLinksForDocument(docId);
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsShLoadLinksForDocument(docId) {
  const host = document.getElementById('dms-sh-links-list');
  if (!host) return;
  host.innerHTML = 'جارِ التحميل...';
  try {
    const { data } = await dmsShFetch('/links', { query: { document_id: docId } });
    if (!data.length) { host.innerHTML = '<div class="result-card">لا توجد روابط مشاركة لهذا المستند بعد</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>الصلاحية</th><th>كلمة مرور</th><th>الحالة</th><th>مرات الفتح</th><th>الانتهاء</th><th>أُنشئ بواسطة</th><th></th></tr></thead>
        <tbody>
          ${data.map((l) => `
            <tr>
              <td>${DMS_SHARE_PERMISSION_LABELS[l.permission] || l.permission}</td>
              <td>${l.has_password ? '🔒 نعم' : '—'}</td>
              <td>${dmsShLinkStateBadge(l)}</td>
              <td>${l.open_count}${l.max_opens ? ` / ${l.max_opens}` : ''}</td>
              <td>${l.expires_at ? new Date(l.expires_at).toLocaleString('ar-SA') : 'بلا انتهاء'}</td>
              <td>${l.created_by || '-'}</td>
              <td>
                <button class="btn btn-sm" data-dms-sh-copy="${l.token}">نسخ الرابط</button>
                <button class="btn btn-sm" data-dms-sh-log="${l.id}">سجل الوصول</button>
                ${!l.is_revoked ? `<button class="btn btn-sm" data-dms-sh-revoke="${l.id}" style="color:#c0392b">إلغاء</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div id="dms-sh-link-log-view" style="margin-top:8px"></div>
    `;
    host.querySelectorAll('[data-dms-sh-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = dmsShAbsoluteShareUrl(btn.dataset.dmsShCopy);
        navigator.clipboard?.writeText(url).then(() => {
          btn.textContent = 'تم النسخ ✔️';
          setTimeout(() => { btn.textContent = 'نسخ الرابط'; }, 1500);
        }).catch(() => alert(url));
      });
    });
    host.querySelectorAll('[data-dms-sh-revoke]').forEach((btn) => {
      btn.addEventListener('click', () => dmsShRevokeLink(btn.dataset.dmsShRevoke, docId));
    });
    host.querySelectorAll('[data-dms-sh-log]').forEach((btn) => {
      btn.addEventListener('click', () => dmsShShowLinkLog(btn.dataset.dmsShLog));
    });
  } catch (e) {
    host.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsShShowLinkLog(linkId) {
  const out = document.getElementById('dms-sh-link-log-view');
  if (!out) return;
  out.innerHTML = '<div class="result-card">جارِ التحميل...</div>';
  try {
    const { data } = await dmsShFetch('/links/get', { query: { id: linkId } });
    const rows = (data.access_log || []).slice().reverse();
    out.innerHTML = !rows.length ? '<div class="result-card">لم يُفتح هذا الرابط بعد</div>' : `
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>عنوان IP</th><th>النتيجة</th><th>السبب</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${new Date(r.at).toLocaleString('ar-SA')}</td>
              <td>${r.ip || '-'}</td>
              <td>${r.success ? '<span class="dms-badge dms-badge-success">نجاح</span>' : '<span class="dms-badge dms-badge-danger">فشل</span>'}</td>
              <td>${r.reason || '-'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsShRevokeLink(linkId, docId) {
  if (!confirm('هل تريد إلغاء رابط المشاركة هذا؟ لن يكون قابلاً للفتح بعد الإلغاء.')) return;
  try {
    await dmsShFetch('/links/revoke', { method: 'POST', body: { id: linkId } });
    await dmsShLoadLinksForDocument(docId);
  } catch (e) {
    alert(`تعذّر الإلغاء: ${e.message}`);
  }
}

async function dmsShCreateInternal(docId) {
  const out = document.getElementById('dms-sh-create-internal-result');
  const grantee_type = document.getElementById('dms-sh-internal-type').value;
  const grantee = document.getElementById('dms-sh-internal-grantee').value.trim();
  const permission = document.getElementById('dms-sh-internal-perm').value;
  const expiresRaw = document.getElementById('dms-sh-internal-expires').value || null;

  if (!grantee) { out.innerHTML = '<div class="result-card" style="color:#c0392b">أدخل اسم المستخدم أو الدور</div>'; return; }

  out.innerHTML = '<div class="result-card">جارِ منح الصلاحية...</div>';
  try {
    await dmsShFetch('/internal', {
      method: 'POST',
      body: {
        document_id: docId,
        grantee_type,
        grantee,
        permission,
        expires_at: expiresRaw ? new Date(expiresRaw).toISOString() : null,
      },
    });
    out.innerHTML = '<div class="result-card" style="color:#2e7d32">تم منح الصلاحية بنجاح</div>';
    document.getElementById('dms-sh-internal-grantee').value = '';
    await dmsShLoadInternalForDocument(docId);
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsShLoadInternalForDocument(docId) {
  const host = document.getElementById('dms-sh-internal-list');
  if (!host) return;
  host.innerHTML = 'جارِ التحميل...';
  try {
    const { data } = await dmsShFetch('/internal', { query: { document_id: docId } });
    if (!data.length) { host.innerHTML = '<div class="result-card">لا توجد مشاركات داخلية لهذا المستند بعد</div>'; return; }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>النوع</th><th>المستفيد</th><th>الصلاحية</th><th>الحالة</th><th>الانتهاء</th><th>بواسطة</th><th></th></tr></thead>
        <tbody>
          ${data.map((s) => {
            const revoked = !!s.revoked_at;
            const expired = s.expires_at && new Date(s.expires_at).getTime() < Date.now();
            const stateBadge = revoked
              ? '<span class="dms-badge dms-badge-danger">ملغاة</span>'
              : expired
                ? '<span class="dms-badge dms-badge-warning">منتهية</span>'
                : '<span class="dms-badge dms-badge-success">فعّالة</span>';
            return `
            <tr>
              <td>${s.grantee_type === 'role' ? 'دور' : 'مستخدم'}</td>
              <td>${s.grantee}</td>
              <td>${DMS_SHARE_PERMISSION_LABELS[s.permission] || s.permission}</td>
              <td>${stateBadge}</td>
              <td>${s.expires_at ? new Date(s.expires_at).toLocaleString('ar-SA') : 'بلا انتهاء'}</td>
              <td>${s.granted_by || '-'}</td>
              <td>${!revoked ? `<button class="btn btn-sm" data-dms-sh-revoke-internal="${s.id}" style="color:#c0392b">إلغاء</button>` : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
    host.querySelectorAll('[data-dms-sh-revoke-internal]').forEach((btn) => {
      btn.addEventListener('click', () => dmsShRevokeInternal(btn.dataset.dmsShRevokeInternal, docId));
    });
  } catch (e) {
    host.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsShRevokeInternal(shareId, docId) {
  if (!confirm('هل تريد إلغاء هذه المشاركة الداخلية؟')) return;
  try {
    await dmsShFetch('/internal/revoke', { method: 'POST', body: { id: shareId } });
    await dmsShLoadInternalForDocument(docId);
  } catch (e) {
    alert(`تعذّر الإلغاء: ${e.message}`);
  }
}

// ============================================================
// لوحة عامة مستقلة: كل روابط ومشاركات المستندات في المشروع/النظام
// ============================================================

/** يُستدعى لعرض لوحة إدارة المشاركات العامة داخل حاوية معيّنة (تبويب مستقل في القسم الحادي عشر) */
async function dmsShRenderGlobalPanel(containerId) {
  const host = document.getElementById(containerId);
  if (!host) return;

  host.innerHTML = `
    <div class="calc-card">
      <h4>ملخص المشاركات</h4>
      <div class="result-cards" id="dms-sh-summary-cards"></div>

      <h4 style="margin-top:18px">فلترة</h4>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <input type="text" id="dms-sh-g-project" placeholder="فلترة حسب المشروع (اختياري) PRJ-..." />
        <button class="btn btn-primary btn-sm" id="dms-sh-g-btn-refresh">تحديث</button>
      </div>

      <h4 style="margin-top:18px">جميع روابط المشاركة الخارجية</h4>
      <div id="dms-sh-g-links-list">جارِ التحميل...</div>

      <h4 style="margin-top:18px">جميع المشاركات الداخلية</h4>
      <div id="dms-sh-g-internal-list">جارِ التحميل...</div>
    </div>
  `;

  document.getElementById('dms-sh-g-btn-refresh').addEventListener('click', () => dmsShLoadGlobalPanel());
  await dmsShLoadGlobalPanel();
}

async function dmsShLoadGlobalPanel() {
  const projectId = document.getElementById('dms-sh-g-project')?.value.trim() || null;

  const summaryHost = document.getElementById('dms-sh-summary-cards');
  const linksHost = document.getElementById('dms-sh-g-links-list');
  const internalHost = document.getElementById('dms-sh-g-internal-list');
  if (!summaryHost || !linksHost || !internalHost) return;

  summaryHost.innerHTML = '<div class="result-card">جارِ التحميل...</div>';
  linksHost.innerHTML = 'جارِ التحميل...';
  internalHost.innerHTML = 'جارِ التحميل...';

  try {
    const { data: summary } = await dmsShFetch('/summary', { query: { projectId } });
    const card = (val, label) => `<div class="result-card"><div class="label">${label}</div><div class="value">${val}</div></div>`;
    summaryHost.innerHTML = [
      card(summary.total_share_links, 'إجمالي الروابط'),
      card(summary.active_share_links, 'روابط فعّالة'),
      card(summary.revoked_share_links, 'روابط ملغاة'),
      card(summary.expired_share_links, 'روابط منتهية'),
      card(summary.password_protected_links, 'محمية بكلمة مرور'),
      card(summary.total_link_opens, 'إجمالي مرات الفتح'),
      card(summary.total_internal_shares, 'المشاركات الداخلية'),
      card(summary.active_internal_shares, 'مشاركات داخلية فعّالة'),
    ].join('');
  } catch (e) {
    summaryHost.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }

  try {
    const { data } = await dmsShFetch('/links', { query: { projectId } });
    linksHost.innerHTML = !data.length ? '<div class="result-card">لا توجد روابط مشاركة بعد</div>' : `
      <table class="data-table">
        <thead><tr><th>المستند</th><th>الصلاحية</th><th>الحالة</th><th>مرات الفتح</th><th>الانتهاء</th><th>أُنشئ بواسطة</th><th></th></tr></thead>
        <tbody>
          ${data.map((l) => `
            <tr>
              <td><a href="#" data-dms-sh-open-doc="${l.document_id}">${l.document_id}</a></td>
              <td>${DMS_SHARE_PERMISSION_LABELS[l.permission] || l.permission}</td>
              <td>${dmsShLinkStateBadge(l)}</td>
              <td>${l.open_count}${l.max_opens ? ` / ${l.max_opens}` : ''}</td>
              <td>${l.expires_at ? new Date(l.expires_at).toLocaleString('ar-SA') : 'بلا انتهاء'}</td>
              <td>${l.created_by || '-'}</td>
              <td>${!l.is_revoked ? `<button class="btn btn-sm" data-dms-sh-g-revoke="${l.id}" style="color:#c0392b">إلغاء</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    linksHost.querySelectorAll('[data-dms-sh-open-doc]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        document.querySelector('.nav-item[data-panel="dms-documents"]')?.click();
        setTimeout(() => dmsViewDocument(a.dataset.dmsShOpenDoc), 150);
      });
    });
    linksHost.querySelectorAll('[data-dms-sh-g-revoke]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('هل تريد إلغاء رابط المشاركة هذا؟')) return;
        try {
          await dmsShFetch('/links/revoke', { method: 'POST', body: { id: btn.dataset.dmsShGRevoke } });
          await dmsShLoadGlobalPanel();
        } catch (e) { alert(`تعذّر الإلغاء: ${e.message}`); }
      });
    });
  } catch (e) {
    linksHost.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }

  try {
    const { data } = await dmsShFetch('/internal', { query: { projectId } });
    internalHost.innerHTML = !data.length ? '<div class="result-card">لا توجد مشاركات داخلية بعد</div>' : `
      <table class="data-table">
        <thead><tr><th>المستند</th><th>النوع</th><th>المستفيد</th><th>الصلاحية</th><th>الانتهاء</th><th>بواسطة</th><th></th></tr></thead>
        <tbody>
          ${data.map((s) => `
            <tr>
              <td><a href="#" data-dms-sh-open-doc2="${s.document_id}">${s.document_id}</a></td>
              <td>${s.grantee_type === 'role' ? 'دور' : 'مستخدم'}</td>
              <td>${s.grantee}</td>
              <td>${DMS_SHARE_PERMISSION_LABELS[s.permission] || s.permission}</td>
              <td>${s.expires_at ? new Date(s.expires_at).toLocaleString('ar-SA') : 'بلا انتهاء'}</td>
              <td>${s.granted_by || '-'}</td>
              <td>${!s.revoked_at ? `<button class="btn btn-sm" data-dms-sh-g-revoke-internal="${s.id}" style="color:#c0392b">إلغاء</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    internalHost.querySelectorAll('[data-dms-sh-open-doc2]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        document.querySelector('.nav-item[data-panel="dms-documents"]')?.click();
        setTimeout(() => dmsViewDocument(a.dataset.dmsShOpenDoc2), 150);
      });
    });
    internalHost.querySelectorAll('[data-dms-sh-g-revoke-internal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('هل تريد إلغاء هذه المشاركة الداخلية؟')) return;
        try {
          await dmsShFetch('/internal/revoke', { method: 'POST', body: { id: btn.dataset.dmsShGRevokeInternal } });
          await dmsShLoadGlobalPanel();
        } catch (e) { alert(`تعذّر الإلغاء: ${e.message}`); }
      });
    });
  } catch (e) {
    internalHost.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

// يُفعَّل مرة واحدة عند دخول تبويب "المشاركة" (نفس نمط ربط nav-item المستخدَم في بقية وحدات DMS الأمامية)
document.addEventListener('DOMContentLoaded', () => {
  const navItem = document.querySelector('.nav-item[data-panel="dms-sharing"]');
  if (navItem) {
    let loaded = false;
    navItem.addEventListener('click', () => {
      if (!loaded) { loaded = true; dmsShRenderGlobalPanel('dms-sharing-panel-host'); }
    });
  }
});
