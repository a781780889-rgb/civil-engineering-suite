/**
 * القسم السادس - نظام إدارة الأعمال (Business Management System)
 * الجزء الرابع (4/4) - الوحدة الأولى: الصلاحيات والأمان (RBAC + 2FA + تشفير + Audit + نسخ احتياطي)
 * ==============================================================================================
 * التخزين: ملفات JSON على القرص (نفس نمط الأجزاء السابقة)
 *   - backend/data/biz_users.json            (المستخدمون + كلمات المرور المُجزّأة + 2FA)
 *   - backend/data/biz_roles.json             (الأدوار وصلاحياتها لكل وحدة)
 *   - backend/data/biz_sessions.json          (جلسات الدخول النشطة - توكنات)
 *   - backend/data/global_audit_log.json      (سجل تدقيق موحّد لكل عمليات المنصة، وليس فقط CRM)
 *   - backend/data/backups/                   (النسخ الاحتياطية المولّدة فعلياً)
 * بدون تبعيات خارجية (crypto من مكتبة Node القياسية فقط).
 *
 * تنفيذ حقيقي وليس شكلياً:
 *  - كلمات المرور: تُخزَّن كـ scrypt hash + salt عشوائي لكل مستخدم (crypto.scryptSync)،
 *    لا تُخزَّن أبداً كنص صريح، والمقارنة تتم عبر crypto.timingSafeEqual لمنع Timing Attacks.
 *  - التوثيق الثنائي (2FA): تطبيق حقيقي لخوارزمية TOTP (RFC 6238) بدون أي مكتبة خارجية -
 *    توليد secret عشوائي (Base32) + حساب أكواد 6 أرقام بصلاحية 30 ثانية عبر HMAC-SHA1،
 *    مع نافذة تسامح ±1 خطوة زمنية للتعامل مع فروقات الساعة.
 *  - التشفير: تشفير AES-256-GCM حقيقي (crypto.createCipheriv) للحقول الحسّاسة
 *    (مثل أرقام الهوية أو الحسابات البنكية) عبر encryptField/decryptField، بمفتاح مشتق
 *    من متغير بيئة BIZ_ENCRYPTION_KEY (أو مفتاح افتراضي يُنشأ ويُخزَّن محلياً عند أول تشغيل
 *    لضمان عمل النظام فوراً دون إعداد يدوي، معه تحذير واضح في السجلات لتغييره في الإنتاج).
 *  - الصلاحيات (RBAC): كل دور له خريطة صلاحيات حقيقية {module: [actions]} يتم التحقق منها
 *    فعلياً عبر can(userId, module, action) قبل تنفيذ أي عملية حساسة - وليس مجرد قائمة نصية.
 *  - سجل التدقيق العام (Global Audit Log): نقطة تسجيل مركزية واحدة recordGlobalAudit()
 *    تُستخدَم من قِبل middleware في السيرفر لتسجيل كل طلب API فعلي (من/إلى/نتيجة)، بالإضافة
 *    إلى قدرتها على استيعاب سجلات الوحدات الأخرى (CRM/العقود/المخازن...) في نفس المصدر
 *    الموحّد بدل بقائها متناثرة كسجلات منفصلة لكل وحدة.
 *  - النسخ الاحتياطي والاستعادة: createBackup() تُنشئ فعلياً أرشيف JSON واحد يضم كل ملفات
 *    backend/data الحالية بمخرجات قابلة للاستعادة عبر restoreBackup()، مع جدولة تلقائية
 *    اختيارية (scheduleAutoBackup) تُنفَّذ عبر setInterval حقيقي عند تشغيل الخادم.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const USERS_FILE = path.join(DATA_DIR, 'biz_users.json');
const ROLES_FILE = path.join(DATA_DIR, 'biz_roles.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'biz_sessions.json');
const GLOBAL_AUDIT_FILE = path.join(DATA_DIR, 'global_audit_log.json');
const KEY_FILE = path.join(DATA_DIR, '.encryption_key');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`تعذّرت قراءة ملف البيانات (${path.basename(file)}): ${e.message}`);
  }
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowISO() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ==================================================================================
// ===================== سجل التدقيق العام الموحّد (Global Audit Log) =============
// ==================================================================================

function recordGlobalAudit({ userId = null, username = null, module: mod, action, target_id = null, summary = '', ip = null, success = true }) {
  const log = readJSON(GLOBAL_AUDIT_FILE, []);
  log.push({
    id: newId('GAUD'),
    at: nowISO(),
    userId,
    username,
    module: mod,
    action,
    target_id,
    summary,
    ip,
    success,
  });
  // حد أعلى لمنع تضخّم الملف بلا حدود، مع إبقاء آخر 50000 عملية
  if (log.length > 50000) log.splice(0, log.length - 50000);
  writeJSON(GLOBAL_AUDIT_FILE, log);
  return log[log.length - 1];
}

function getGlobalAuditLog({ module: mod = null, userId = null, action = null, from = null, to = null, page = 1, pageSize = 100 } = {}) {
  let log = readJSON(GLOBAL_AUDIT_FILE, []);
  if (mod) log = log.filter(e => e.module === mod);
  if (userId) log = log.filter(e => e.userId === userId);
  if (action) log = log.filter(e => e.action === action);
  if (from) log = log.filter(e => new Date(e.at) >= new Date(from));
  if (to) log = log.filter(e => new Date(e.at) <= new Date(to));
  log = log.slice().sort((a, b) => new Date(b.at) - new Date(a.at));

  const total = log.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 100);
  const start = (p - 1) * ps;

  return {
    success: true,
    data: log.slice(start, start + ps),
    pagination: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 },
  };
}

// ==================================================================================
// ============================ التشفير (AES-256-GCM) =============================
// ==================================================================================

function getEncryptionKey() {
  if (process.env.BIZ_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.BIZ_ENCRYPTION_KEY).digest();
  }
  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), 'utf8');
  // eslint-disable-next-line no-console
  console.warn('⚠️  لم يُضبط BIZ_ENCRYPTION_KEY كمتغير بيئة؛ تم توليد مفتاح تشفير محلي تلقائياً في backend/data/.encryption_key. يُنصح بضبط المتغير يدوياً في بيئة الإنتاج.');
  return key;
}

function encryptField(plainText) {
  if (plainText === null || plainText === undefined) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptField(payload) {
  if (!payload) return null;
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('صيغة البيانات المشفّرة غير صحيحة');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

// ==================================================================================
// ============================ كلمات المرور (scrypt) =============================
// ==================================================================================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const original = Buffer.from(hash, 'hex');
  if (candidate.length !== original.length) return false;
  return crypto.timingSafeEqual(candidate, original);
}

// ==================================================================================
// ==================== التوثيق الثنائي TOTP (RFC 6238 - تطبيق ذاتي) ===============
// ==================================================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.substring(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const lastChunk = bits.substring(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit، مطابق لتوصية RFC 6238
}

function computeTotpCode(secretBase32, timeStepSeconds = 30, digits = 6, counterOverride = null) {
  const key = base32Decode(secretBase32);
  const counter = counterOverride !== null ? counterOverride : Math.floor(Date.now() / 1000 / timeStepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, '0');
}

function verifyTotpCode(secretBase32, code, { windowSteps = 1, timeStepSeconds = 30 } = {}) {
  const currentCounter = Math.floor(Date.now() / 1000 / timeStepSeconds);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    if (computeTotpCode(secretBase32, timeStepSeconds, 6, currentCounter + w) === String(code)) return true;
  }
  return false;
}

function buildTotpOtpAuthUrl(secretBase32, { accountName, issuer = 'CivilEngineeringSuite' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ==================================================================================
// ============================ الأدوار والصلاحيات (RBAC) ==========================
// ==================================================================================

// أدوار افتراضية مطابقة لمتطلبات القسم السادس بالضبط
const DEFAULT_ROLES = {
  system_admin: {
    label: 'مدير النظام',
    permissions: { '*': ['*'] },
  },
  ceo: {
    label: 'المدير التنفيذي',
    permissions: {
      dashboard: ['view'], clients: ['view', 'create', 'update', 'delete'], suppliers: ['view', 'create', 'update', 'delete'],
      contracts: ['view', 'create', 'update', 'delete'], invoices: ['view', 'create', 'update'], purchasing: ['view', 'create', 'update'],
      warehouse: ['view'], hr: ['view', 'create', 'update'], meetings: ['view', 'create', 'update'], tasks: ['view', 'create', 'update'],
      assets: ['view'], quality: ['view'], safety: ['view'], documents: ['view', 'create'], reports: ['view', 'export'], ai: ['use'],
    },
  },
  cfo: {
    label: 'المدير المالي',
    permissions: {
      dashboard: ['view'], contracts: ['view'], invoices: ['view', 'create', 'update'], purchasing: ['view'],
      reports: ['view', 'export'], ai: ['use'], documents: ['view'],
    },
  },
  project_manager: {
    label: 'مدير المشاريع',
    permissions: {
      dashboard: ['view'], contracts: ['view'], tasks: ['view', 'create', 'update', 'delete'], meetings: ['view', 'create', 'update'],
      quality: ['view', 'create'], safety: ['view', 'create'], documents: ['view', 'create'], reports: ['view', 'export'],
    },
  },
  hr_manager: {
    label: 'مدير الموارد البشرية',
    permissions: { hr: ['view', 'create', 'update', 'delete'], documents: ['view', 'create'], reports: ['view', 'export'] },
  },
  purchasing_manager: {
    label: 'مدير المشتريات',
    permissions: {
      suppliers: ['view', 'create', 'update'], purchasing: ['view', 'create', 'update', 'delete'],
      warehouse: ['view'], reports: ['view', 'export'],
    },
  },
  warehouse_manager: {
    label: 'مدير المخازن',
    permissions: { warehouse: ['view', 'create', 'update', 'delete'], reports: ['view', 'export'] },
  },
  accountant: {
    label: 'المحاسب',
    permissions: { invoices: ['view', 'create', 'update'], contracts: ['view'], reports: ['view', 'export'] },
  },
  engineer: {
    label: 'المهندس',
    permissions: {
      tasks: ['view', 'update'], quality: ['view', 'create'], safety: ['view', 'create'], documents: ['view', 'create'], reports: ['view'],
    },
  },
  supervisor: {
    label: 'المشرف',
    permissions: { tasks: ['view', 'update'], safety: ['view', 'create'], quality: ['view', 'create'], reports: ['view'] },
  },
  client_viewer: {
    label: 'العميل (عرض فقط)',
    permissions: { dashboard: ['view'], contracts: ['view'], invoices: ['view'], reports: ['view'], equipment: ['view'] },
  },

  // ----- أدوار القسم السابع: إدارة المعدات (Equipment & Assets Management) -----
  equipment_manager: {
    label: 'مدير المعدات',
    permissions: {
      equipment: ['view', 'create', 'update', 'delete', 'manage'],
      dashboard: ['view'], reports: ['view', 'export'], ai: ['use'],
    },
  },
  site_engineer: {
    label: 'مهندس الموقع',
    permissions: { equipment: ['view', 'create', 'update'], dashboard: ['view'], reports: ['view'] },
  },
  maintenance_officer: {
    label: 'مسؤول الصيانة',
    permissions: { equipment: ['view', 'update', 'maintenance'], dashboard: ['view'], reports: ['view'] },
  },
  warehouse_keeper: {
    label: 'أمين المخزن',
    permissions: { equipment: ['view', 'spare_parts'], warehouse: ['view', 'create', 'update'], dashboard: ['view'] },
  },
  equipment_operator: {
    label: 'المشغل',
    permissions: { equipment: ['view', 'operate'] },
  },
};

function ensureRolesSeeded() {
  const existing = readJSON(ROLES_FILE, null);
  if (!existing) {
    writeJSON(ROLES_FILE, DEFAULT_ROLES);
    return DEFAULT_ROLES;
  }
  return existing;
}

function listRoles() {
  const roles = ensureRolesSeeded();
  return { success: true, data: Object.entries(roles).map(([key, r]) => ({ key, ...r })) };
}

function getRole(key) {
  const roles = ensureRolesSeeded();
  if (!roles[key]) throw new Error(`الدور غير موجود: ${key}`);
  return roles[key];
}

function upsertRole(key, { label, permissions }) {
  if (!key || !String(key).trim()) throw new Error('معرّف الدور (key) مطلوب');
  const roles = ensureRolesSeeded();
  roles[key] = { label: label || roles[key]?.label || key, permissions: permissions || roles[key]?.permissions || {} };
  writeJSON(ROLES_FILE, roles);
  recordGlobalAudit({ module: 'security_roles', action: roles[key] ? 'upsert' : 'create', target_id: key, summary: `تحديث دور: ${key}` });
  return { success: true, data: { key, ...roles[key] } };
}

function deleteRole(key) {
  const roles = ensureRolesSeeded();
  if (!roles[key]) throw new Error('الدور غير موجود');
  if (key === 'system_admin') throw new Error('لا يمكن حذف دور مدير النظام');
  const users = readJSON(USERS_FILE, { users: [] });
  const inUse = users.users.some(u => u.role === key);
  if (inUse) throw new Error('لا يمكن حذف دور مُسنَد حالياً لمستخدمين. أعد إسناد المستخدمين أولاً.');
  delete roles[key];
  writeJSON(ROLES_FILE, roles);
  recordGlobalAudit({ module: 'security_roles', action: 'delete', target_id: key, summary: `حذف دور: ${key}` });
  return { success: true, data: { deleted: key } };
}

function roleCan(roleKey, mod, action) {
  const roles = ensureRolesSeeded();
  const role = roles[roleKey];
  if (!role) return false;
  const perms = role.permissions || {};
  if (perms['*'] && (perms['*'].includes('*') || perms['*'].includes(action))) return true;
  const modulePerms = perms[mod];
  if (!modulePerms) return false;
  return modulePerms.includes('*') || modulePerms.includes(action);
}

// ==================================================================================
// ================================ المستخدمون =====================================
// ==================================================================================

function defaultUsersDB() { return { users: [] }; }

function validateUserPayload(body, { partial = false } = {}) {
  if (!partial) {
    if (!body || !body.username || !String(body.username).trim()) throw new Error('اسم المستخدم (username) مطلوب');
    if (!body.password || String(body.password).length < 8) throw new Error('كلمة المرور مطلوبة ويجب ألا تقل عن 8 أحرف');
    if (!body.role) throw new Error('الدور (role) مطلوب');
  }
  if (body.role) {
    const roles = ensureRolesSeeded();
    if (!roles[body.role]) throw new Error(`الدور غير معروف: ${body.role}`);
  }
}

function createUser(body) {
  validateUserPayload(body);
  const db = readJSON(USERS_FILE, defaultUsersDB());
  if (db.users.some(u => u.username === body.username)) throw new Error('اسم المستخدم مستخدَم بالفعل');

  const user = {
    id: newId('USR'),
    username: String(body.username).trim(),
    full_name: body.full_name || '',
    email: body.email || null,
    role: body.role,
    password_hash: hashPassword(body.password),
    is_active: true,
    two_factor: { enabled: false, secret: null },
    created_at: nowISO(),
    updated_at: nowISO(),
    last_login_at: null,
  };
  db.users.push(user);
  writeJSON(USERS_FILE, db);
  recordGlobalAudit({ module: 'security_users', action: 'create', target_id: user.id, summary: `إنشاء مستخدم: ${user.username} (${user.role})` });

  const { password_hash, two_factor, ...safe } = user;
  return { success: true, data: safe };
}

function listUsers() {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  return {
    success: true,
    data: db.users.map(({ password_hash, two_factor, ...safe }) => ({ ...safe, two_factor_enabled: Boolean(two_factor?.enabled) })),
  };
}

function getUserSafe(id) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const user = db.users.find(u => u.id === id);
  if (!user) throw new Error('المستخدم غير موجود');
  const { password_hash, two_factor, ...safe } = user;
  return { success: true, data: { ...safe, two_factor_enabled: Boolean(two_factor?.enabled) } };
}

function updateUser(id, body) {
  validateUserPayload(body, { partial: true });
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('المستخدم غير موجود');

  const user = db.users[idx];
  if (body.full_name !== undefined) user.full_name = body.full_name;
  if (body.email !== undefined) user.email = body.email;
  if (body.role !== undefined) user.role = body.role;
  if (body.is_active !== undefined) user.is_active = Boolean(body.is_active);
  if (body.password) user.password_hash = hashPassword(body.password);
  user.updated_at = nowISO();

  db.users[idx] = user;
  writeJSON(USERS_FILE, db);
  recordGlobalAudit({ module: 'security_users', action: 'update', target_id: id, summary: `تعديل مستخدم: ${user.username}` });

  const { password_hash, two_factor, ...safe } = user;
  return { success: true, data: safe };
}

function deleteUser(id) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('المستخدم غير موجود');
  if (db.users[idx].role === 'system_admin' && db.users.filter(u => u.role === 'system_admin').length <= 1) {
    throw new Error('لا يمكن حذف آخر مدير نظام في المنصة');
  }
  const [removed] = db.users.splice(idx, 1);
  writeJSON(USERS_FILE, db);
  recordGlobalAudit({ module: 'security_users', action: 'delete', target_id: id, summary: `حذف مستخدم: ${removed.username}` });
  return { success: true, data: { deleted: id } };
}

// ------- تسجيل الدخول + الجلسات -------

function defaultSessionsDB() { return { sessions: [] }; }

function login({ username, password, totpCode = null, ip = null }) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const user = db.users.find(u => u.username === username);
  if (!user || !user.is_active) {
    recordGlobalAudit({ username, module: 'security_auth', action: 'login_failed', summary: 'مستخدم غير موجود أو غير مُفعّل', ip, success: false });
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!verifyPassword(password, user.password_hash)) {
    recordGlobalAudit({ userId: user.id, username, module: 'security_auth', action: 'login_failed', summary: 'كلمة مرور خاطئة', ip, success: false });
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (user.two_factor?.enabled) {
    if (!totpCode) {
      return { success: true, data: { requires_2fa: true, userId: user.id } };
    }
    if (!verifyTotpCode(user.two_factor.secret, totpCode)) {
      recordGlobalAudit({ userId: user.id, username, module: 'security_auth', action: 'login_2fa_failed', ip, success: false });
      throw new Error('رمز التحقق الثنائي غير صحيح');
    }
  }

  const sessionsDB = readJSON(SESSIONS_FILE, defaultSessionsDB());
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    created_at: nowISO(),
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // صلاحية 12 ساعة
    ip,
  };
  sessionsDB.sessions.push(session);
  writeJSON(SESSIONS_FILE, sessionsDB);

  user.last_login_at = nowISO();
  writeJSON(USERS_FILE, db);

  recordGlobalAudit({ userId: user.id, username, module: 'security_auth', action: 'login_success', ip });

  return { success: true, data: { token, role: user.role, username: user.username, userId: user.id, expires_at: session.expires_at } };
}

function logout(token) {
  const db = readJSON(SESSIONS_FILE, defaultSessionsDB());
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.token !== token);
  writeJSON(SESSIONS_FILE, db);
  if (db.sessions.length < before) {
    recordGlobalAudit({ module: 'security_auth', action: 'logout', summary: 'تسجيل خروج' });
  }
  return { success: true, data: { loggedOut: before !== db.sessions.length } };
}

function getSessionUser(token) {
  if (!token) return null;
  const db = readJSON(SESSIONS_FILE, defaultSessionsDB());
  const session = db.sessions.find(s => s.token === token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

function can(token, mod, action) {
  const session = getSessionUser(token);
  if (!session) return false;
  return roleCan(session.role, mod, action);
}

// ------- التوثيق الثنائي: تفعيل/تعطيل -------

function start2FAEnrollment(userId) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('المستخدم غير موجود');
  const secret = generateTotpSecret();
  user.two_factor = { enabled: false, secret, pending: true };
  writeJSON(USERS_FILE, db);
  return {
    success: true,
    data: { secret, otpauth_url: buildTotpOtpAuthUrl(secret, { accountName: user.username }) },
  };
}

function confirm2FAEnrollment(userId, code) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const user = db.users.find(u => u.id === userId);
  if (!user || !user.two_factor?.secret) throw new Error('لم يبدأ إعداد التوثيق الثنائي لهذا المستخدم');
  if (!verifyTotpCode(user.two_factor.secret, code)) throw new Error('رمز التحقق غير صحيح');
  user.two_factor.enabled = true;
  user.two_factor.pending = false;
  writeJSON(USERS_FILE, db);
  recordGlobalAudit({ userId, username: user.username, module: 'security_auth', action: '2fa_enabled' });
  return { success: true, data: { enabled: true } };
}

function disable2FA(userId) {
  const db = readJSON(USERS_FILE, defaultUsersDB());
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('المستخدم غير موجود');
  user.two_factor = { enabled: false, secret: null };
  writeJSON(USERS_FILE, db);
  recordGlobalAudit({ userId, username: user.username, module: 'security_auth', action: '2fa_disabled' });
  return { success: true, data: { enabled: false } };
}

// ==================================================================================
// ==================== النسخ الاحتياطي والاستعادة (Backup / Restore) =============
// ==================================================================================

function createBackup({ label = null } = {}) {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => {
    const full = path.join(DATA_DIR, f);
    return fs.statSync(full).isFile() && f.endsWith('.json');
  });

  const snapshot = { created_at: nowISO(), label: label || null, files: {} };
  for (const f of files) {
    snapshot.files[f] = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
  }

  const fileName = `backup-${Date.now()}.json`;
  const outputPath = path.join(BACKUPS_DIR, fileName);
  fs.writeFileSync(outputPath, JSON.stringify(snapshot), 'utf8');

  recordGlobalAudit({ module: 'security_backup', action: 'create', target_id: fileName, summary: `نسخة احتياطية تضم ${files.length} ملف بيانات` });

  return { success: true, data: { fileName, path: outputPath, filesCount: files.length, created_at: snapshot.created_at } };
}

function listBackups() {
  ensureDataDir();
  const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json'));
  const data = files.map(f => {
    const full = path.join(BACKUPS_DIR, f);
    const stat = fs.statSync(full);
    return { fileName: f, size: stat.size, created_at: stat.mtime.toISOString() };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, data };
}

function restoreBackup(fileName) {
  const full = path.join(BACKUPS_DIR, fileName);
  if (!full.startsWith(BACKUPS_DIR) || !fs.existsSync(full)) throw new Error('ملف النسخة الاحتياطية غير موجود');
  const snapshot = JSON.parse(fs.readFileSync(full, 'utf8'));

  // نسخ احتياطية للحالة الحالية قبل الاستبدال (أمان إضافي ضد الاستعادة الخاطئة)
  createBackup({ label: 'auto-before-restore' });

  for (const [name, content] of Object.entries(snapshot.files)) {
    fs.writeFileSync(path.join(DATA_DIR, name), content, 'utf8');
  }

  recordGlobalAudit({ module: 'security_backup', action: 'restore', target_id: fileName, summary: `استعادة ${Object.keys(snapshot.files).length} ملف من ${fileName}` });

  return { success: true, data: { restoredFiles: Object.keys(snapshot.files), from: fileName } };
}

let autoBackupInterval = null;

function scheduleAutoBackup({ intervalHours = 24 } = {}) {
  if (autoBackupInterval) clearInterval(autoBackupInterval);
  autoBackupInterval = setInterval(() => {
    try {
      createBackup({ label: 'auto-scheduled' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('فشلت النسخة الاحتياطية التلقائية:', e.message);
    }
  }, intervalHours * 60 * 60 * 1000);
  if (typeof autoBackupInterval.unref === 'function') autoBackupInterval.unref();
  return { success: true, data: { scheduled: true, intervalHours } };
}

// ==================================================================================
// ====================== إنشاء مدير نظام افتراضي عند أول تشغيل ====================
// ==================================================================================

function ensureDefaultAdmin() {
  ensureRolesSeeded();
  const db = readJSON(USERS_FILE, defaultUsersDB());
  if (db.users.length === 0) {
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const admin = {
      id: newId('USR'),
      username: 'admin',
      full_name: 'مدير النظام الافتراضي',
      email: null,
      role: 'system_admin',
      password_hash: hashPassword(tempPassword),
      is_active: true,
      two_factor: { enabled: false, secret: null },
      created_at: nowISO(),
      updated_at: nowISO(),
      last_login_at: null,
    };
    db.users.push(admin);
    writeJSON(USERS_FILE, db);
    // eslint-disable-next-line no-console
    console.warn(`⚠️  تم إنشاء مستخدم مدير نظام افتراضي: admin / ${tempPassword} — يجب تغيير كلمة المرور فوراً بعد أول دخول.`);
    return { created: true, username: 'admin', tempPassword };
  }
  return { created: false };
}

module.exports = {
  // تدقيق عام
  recordGlobalAudit,
  getGlobalAuditLog,
  // تشفير
  encryptField,
  decryptField,
  // كلمات مرور
  hashPassword,
  verifyPassword,
  // 2FA
  generateTotpSecret,
  verifyTotpCode,
  buildTotpOtpAuthUrl,
  start2FAEnrollment,
  confirm2FAEnrollment,
  disable2FA,
  // أدوار
  listRoles,
  getRole,
  upsertRole,
  deleteRole,
  roleCan,
  // مستخدمون
  createUser,
  listUsers,
  getUserSafe,
  updateUser,
  deleteUser,
  // جلسات
  login,
  logout,
  getSessionUser,
  can,
  // نسخ احتياطي
  createBackup,
  listBackups,
  restoreBackup,
  scheduleAutoBackup,
  // تهيئة أولية
  ensureDefaultAdmin,
};
