// ============================================================
// Civil Engineering Suite — Frontend Logic
// القسم الحادي عشر: نظام إدارة المستندات (DMS) — النسخ الاحتياطي والاستعادة
// ============================================================

const DMS_BACKUP_API = '/api/dms/backup';

function dmsBkFetch(pathStr, { method = 'GET', body = null, query = null } = {}) {
  let url = `${DMS_BACKUP_API}${pathStr}`;
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

function dmsBkFormatSize(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** يُستدعى لعرض لوحة النسخ الاحتياطي والاستعادة داخل حاوية معيّنة في صفحة إدارة المستندات */
async function dmsBkRenderPanel(containerId) {
  const host = document.getElementById(containerId);
  if (!host) return;

  host.innerHTML = `
    <div class="calc-card">
      <h4>إنشاء نسخة احتياطية جديدة</h4>
      <div class="toolbar" style="flex-wrap:wrap">
        <input type="text" id="dms-bk-label" placeholder="تسمية النسخة (اختياري)" style="min-width:200px" />
        <label style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="dms-bk-include-files" checked />
          تضمين ملفات المستندات الفعلية (نسخة كاملة)
        </label>
        <button class="btn btn-primary btn-sm" id="dms-bk-btn-create">إنشاء نسخة احتياطية</button>
      </div>
      <div id="dms-bk-create-result" style="margin-top:8px"></div>

      <h4 style="margin-top:18px">النسخ الاحتياطية المتوفرة</h4>
      <div id="dms-bk-list">جارِ التحميل...</div>

      <h4 style="margin-top:18px">سجل عمليات النسخ/الاستعادة</h4>
      <div id="dms-bk-log">جارِ التحميل...</div>
    </div>
  `;

  document.getElementById('dms-bk-btn-create').addEventListener('click', dmsBkCreateBackup);
  await dmsBkLoadList();
  await dmsBkLoadLog();
}

async function dmsBkCreateBackup() {
  const out = document.getElementById('dms-bk-create-result');
  const label = document.getElementById('dms-bk-label').value.trim() || null;
  const includeFiles = document.getElementById('dms-bk-include-files').checked;
  out.innerHTML = '<div class="result-card">جارِ إنشاء النسخة الاحتياطية...</div>';
  try {
    const res = await dmsBkFetch('', { method: 'POST', body: { label, includeFiles } });
    out.innerHTML = `<div class="result-card" style="color:#2e7d32">تم إنشاء النسخة الاحتياطية بنجاح: ${res.data.fileName} (${dmsBkFormatSize(res.data.compressedSizeBytes)}، ${res.data.filesCount} ملف مرفق)</div>`;
    document.getElementById('dms-bk-label').value = '';
    await dmsBkLoadList();
    await dmsBkLoadLog();
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsBkLoadList() {
  const host = document.getElementById('dms-bk-list');
  if (!host) return;
  host.innerHTML = 'جارِ التحميل...';
  try {
    const { data } = await dmsBkFetch('');
    if (!data.length) {
      host.innerHTML = '<div class="result-card">لا توجد نسخ احتياطية بعد</div>';
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>الملف</th><th>التسمية</th><th>النوع</th><th>الحجم</th><th>التاريخ</th><th>موقع ثانوي</th><th></th></tr></thead>
        <tbody>
          ${data.map((b) => `
            <tr>
              <td>${b.fileName}</td>
              <td>${b.label || '-'}</td>
              <td>${b.includeFiles ? 'كاملة (بيانات + ملفات)' : 'بيانات وصفية فقط'}</td>
              <td>${dmsBkFormatSize(b.sizeBytes)}</td>
              <td>${new Date(b.created_at).toLocaleString('ar-SA')}</td>
              <td>${b.hasSecondaryCopy ? '✔️' : '—'}</td>
              <td>
                <button class="btn btn-sm" data-dms-bk-verify="${b.fileName}">تحقق من السلامة</button>
                <button class="btn btn-sm" data-dms-bk-restore="${b.fileName}">استعادة</button>
                <button class="btn btn-sm" data-dms-bk-delete="${b.fileName}" style="color:#c0392b">حذف</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div id="dms-bk-action-result" style="margin-top:8px"></div>
    `;

    host.querySelectorAll('[data-dms-bk-verify]').forEach((btn) => {
      btn.addEventListener('click', () => dmsBkVerify(btn.dataset.dmsBkVerify));
    });
    host.querySelectorAll('[data-dms-bk-restore]').forEach((btn) => {
      btn.addEventListener('click', () => dmsBkRestore(btn.dataset.dmsBkRestore));
    });
    host.querySelectorAll('[data-dms-bk-delete]').forEach((btn) => {
      btn.addEventListener('click', () => dmsBkDelete(btn.dataset.dmsBkDelete));
    });
  } catch (e) {
    host.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsBkVerify(fileName) {
  const out = document.getElementById('dms-bk-action-result');
  out.innerHTML = '<div class="result-card">جارِ التحقق من سلامة النسخة...</div>';
  try {
    const res = await dmsBkFetch('/verify', { method: 'POST', body: { fileName } });
    const v = res.data;
    out.innerHTML = v.valid
      ? `<div class="result-card" style="color:#2e7d32">النسخة سليمة ✔️ — ${v.checkedFiles} ملف تم التحقق منها، حجم قاعدة البيانات: ${dmsBkFormatSize(v.dbSizeBytes)}</div>`
      : `<div class="result-card" style="color:#c0392b">النسخة غير سليمة ✖️ — ${v.reason}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsBkRestore(fileName) {
  const out = document.getElementById('dms-bk-action-result');
  if (!confirm(`سيتم استبدال بيانات وملفات إدارة المستندات الحالية بمحتوى النسخة "${fileName}". سيتم أخذ نسخة أمان تلقائية للحالة الحالية قبل الاستبدال. هل تريد المتابعة؟`)) return;
  out.innerHTML = '<div class="result-card">جارِ الاستعادة...</div>';
  try {
    const res = await dmsBkFetch('/restore', { method: 'POST', body: { fileName } });
    out.innerHTML = `<div class="result-card" style="color:#2e7d32">تمت الاستعادة بنجاح من ${res.data.restoredFrom} (${res.data.restoredFilesCount} ملف). نسخة الأمان التلقائية: ${res.data.autoSafetyBackupFileName || '-'}</div>`;
    await dmsBkLoadList();
    await dmsBkLoadLog();
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsBkDelete(fileName) {
  const out = document.getElementById('dms-bk-action-result');
  if (!confirm(`هل تريد حذف النسخة الاحتياطية "${fileName}" نهائياً؟`)) return;
  try {
    await dmsBkFetch('/delete', { method: 'POST', body: { fileName } });
    await dmsBkLoadList();
    await dmsBkLoadLog();
  } catch (e) {
    out.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

async function dmsBkLoadLog() {
  const host = document.getElementById('dms-bk-log');
  if (!host) return;
  try {
    const { data } = await dmsBkFetch('/log', { query: { limit: 30 } });
    if (!data.length) { host.innerHTML = '<div class="result-card">لا توجد عمليات مسجّلة بعد</div>'; return; }
    const actionLabels = { backup_create: 'إنشاء نسخة', backup_restore: 'استعادة', backup_delete: 'حذف نسخة' };
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>العملية</th><th>الملف</th><th>بواسطة</th><th>التاريخ</th></tr></thead>
        <tbody>
          ${data.map((e) => `
            <tr>
              <td>${actionLabels[e.action] || e.action}</td>
              <td>${e.fileName || '-'}</td>
              <td>${e.actor || '-'}</td>
              <td>${new Date(e.created_at).toLocaleString('ar-SA')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    host.innerHTML = `<div class="result-card" style="color:#c0392b">${e.message}</div>`;
  }
}

// يُفعَّل مرة واحدة عند دخول تبويب "النسخ الاحتياطي والاستعادة" (نفس نمط ربط nav-item
// المستخدَم في بقية وحدات DMS الأمامية)
document.addEventListener('DOMContentLoaded', () => {
  const navItem = document.querySelector('.nav-item[data-panel="dms-backup"]');
  if (navItem) {
    let loaded = false;
    navItem.addEventListener('click', () => {
      if (!loaded) { loaded = true; dmsBkRenderPanel('dms-backup-panel-host'); }
    });
  }
});
