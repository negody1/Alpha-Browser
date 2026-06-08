// Alpha Access — registration + activation-code + PER-DEVICE proxy credentials.
//
// Self-contained: Node built-in `http` + atomic JSON store. NO external deps.
// LOCAL/STAGED ONLY — not deployed here.
//
// PER-DEVICE MODEL (revocable):
//  - The server profile file holds the SHARED Reality params (server/port/
//    publicKey/shortId/serverName/flow) — NO uuid.
//  - On activation each device gets its OWN VLESS `uuid`. The returned profile =
//    shared params + that per-device uuid.
//  - Revoke marks the device revoked; `sync-singbox.mjs` then removes that uuid
//    from sing-box `inbounds[].users[]` + reloads → the device (and any COPIED
//    profile) is rejected at the VPS. That is real per-device revocation.
//
// SECURITY:
//  - device id + activation code stored HASHED (sha256+salt), never raw.
//  - per-device uuid stored server-side; never logged.
//  - activation responses do NOT reveal whether an email is approved
//    (no enumeration oracle).
//  - activation codes expire (TTL) and lock out after repeated failures.
//  - /admin/* requires bearer ADMIN_TOKEN.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CFG = {
  port: Number(process.env.ALPHA_ACCESS_PORT || 8090),
  host: process.env.ALPHA_ACCESS_HOST || '127.0.0.1',
  adminToken: process.env.ALPHA_ADMIN_TOKEN || '',
  dataFile: process.env.ALPHA_DATA_FILE || join(__dir, 'data', 'alpha-access.json'),
  profileFile: process.env.ALPHA_PROFILE_FILE || join(__dir, 'alpha-proxy-profile.local.json'),
  salt: process.env.ALPHA_HASH_SALT || 'change-me-in-production',
  codeTtlMin: Number(process.env.ALPHA_CODE_TTL_MIN || 1440), // 24h
  maxAttempts: Number(process.env.ALPHA_MAX_ATTEMPTS || 5),
  lockMin: Number(process.env.ALPHA_LOCK_MIN || 15),
  adminUser: process.env.ALPHA_ADMIN_USER || '',
  adminPassword: process.env.ALPHA_ADMIN_PASSWORD || '',
  sessionHours: Number(process.env.ALPHA_SESSION_HOURS || 12),
};

// ── atomic JSON store ──
function loadDB() {
  try {
    if (existsSync(CFG.dataFile)) return JSON.parse(readFileSync(CFG.dataFile, 'utf8'));
  } catch {
    /* fresh */
  }
  return { requests: [], devices: [] };
}
function saveDB(db) {
  mkdirSync(dirname(CFG.dataFile), { recursive: true });
  const tmp = CFG.dataFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  renameSync(tmp, CFG.dataFile);
}
let DB = loadDB();

// ── admin auth (password + sessions) ──
// Password: scrypt(password, per-admin random salt). Never logged / returned.
function hashPassword(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}
function setAdmin(user, password) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  DB.admin = { user: String(user).trim(), salt: saltHex, hash: hashPassword(password, saltHex), updated_at: new Date().toISOString() };
  saveDB(DB);
}
function verifyAdmin(user, password) {
  const a = DB.admin;
  if (!a || String(user).trim() !== a.user) return false;
  const want = Buffer.from(a.hash, 'hex');
  const got = Buffer.from(hashPassword(password, a.salt), 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// Bootstrap: create the admin from env ONLY if none exists yet.
if (!DB.admin && CFG.adminUser && CFG.adminPassword) {
  setAdmin(CFG.adminUser, CFG.adminPassword);
  console.log('[alpha-access] bootstrap admin created from env');
}

// In-memory sessions (lost on restart -> admin re-logs in; no tokens on disk).
const sessions = new Map();
function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, expires: Date.now() + CFG.sessionHours * 3600_000 });
  return token;
}
function sessionUser(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  return s.user;
}
function parseCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function setSessionCookie(req, res, token) {
  const https = String(req.headers['x-forwarded-proto'] || '').includes('https');
  const attrs = [
    `alpha_admin=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${CFG.sessionHours * 3600}`,
  ];
  if (https) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'alpha_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

// ── helpers ──
const now = () => new Date().toISOString();
const ms = () => Date.now();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const sha = (v) => crypto.createHash('sha256').update(CFG.salt + ':' + String(v)).digest('hex');
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const genId = () => crypto.randomUUID();
function genCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += a[crypto.randomInt(a.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
/** Shared Reality params (NO uuid). Never logged. */
function readBaseProfile() {
  if (!existsSync(CFG.profileFile)) return null;
  try {
    const p = JSON.parse(readFileSync(CFG.profileFile, 'utf8'));
    const { uuid, _comment, ...base } = p; // strip any uuid / comment
    return base;
  } catch {
    return null;
  }
}
const flowOf = () => {
  const b = readBaseProfile();
  return (b && b.flow) || 'xtls-rprx-vision';
};

// ── rate limiting (per ip+route) ──
const buckets = new Map();
function rateLimited(ip, route, maxPerMin = 10) {
  const key = ip + '|' + route;
  const t = ms();
  const b = buckets.get(key) || { count: 0, reset: t + 60_000 };
  if (t > b.reset) {
    b.count = 0;
    b.reset = t + 60_000;
  }
  b.count += 1;
  buckets.set(key, b);
  return b.count > maxPerMin;
}

// ── http plumbing ──
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 64_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}
const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
function requireAdmin(req) {
  // Admin UI uses the session cookie; automation (sync-singbox) uses the bearer token.
  if (sessionUser(parseCookie(req, 'alpha_admin'))) return true;
  const h = String(req.headers['authorization'] || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!CFG.adminToken || !tok || tok.length !== CFG.adminToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(CFG.adminToken));
}

async function handleLogin(req, res, ip) {
  if (rateLimited(ip, 'login', 10)) return send(res, 429, { error: 'rate_limited' });
  const body = await readBody(req);
  if (!body || !verifyAdmin(body.user, body.password)) return send(res, 401, { error: 'invalid_credentials' });
  setSessionCookie(req, res, newSession(DB.admin.user));
  return send(res, 200, { ok: true, user: DB.admin.user });
}
function handleLogout(req, res) {
  const t = parseCookie(req, 'alpha_admin');
  if (t) sessions.delete(t);
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
}
function handleMe(req, res) {
  const user = sessionUser(parseCookie(req, 'alpha_admin'));
  if (!user) return send(res, 401, { error: 'unauthorized' });
  return send(res, 200, { user });
}
async function handleChangeCreds(req, res) {
  const user = sessionUser(parseCookie(req, 'alpha_admin'));
  if (!user) return send(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  if (!body || !verifyAdmin(DB.admin.user, body.current_password)) return send(res, 403, { error: 'wrong_current_password' });
  const newUser = String(body.new_user || DB.admin.user).trim();
  const newPass = body.new_password ? String(body.new_password) : String(body.current_password);
  if (!newUser || newPass.length < 6) return send(res, 400, { error: 'weak_credentials' });
  setAdmin(newUser, newPass);
  sessions.clear(); // invalidate all sessions -> force re-login with new creds
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
}

// ── handlers ──
async function handleRegister(req, res, ip) {
  if (rateLimited(ip, 'register', 8)) return send(res, 429, { error: 'rate_limited' });
  const body = await readBody(req);
  const email = normEmail(body?.email);
  if (!body || !isEmail(email)) return send(res, 400, { error: 'invalid_email' });
  let r = DB.requests.find((x) => x.email_normalized === email);
  if (!r) {
    r = {
      id: genId(),
      email_normalized: email,
      status: 'pending',
      created_at: now(),
      updated_at: now(),
      approved_at: null,
      approved_by: null,
      notes: '',
      code_hash: null,
      code_issued_at: null,
      code_used: false,
      attempts: 0,
      locked_until: 0,
    };
    DB.requests.push(r);
    saveDB(DB);
  }
  return send(res, 200, { status: 'submitted' }); // uniform — no enumeration
}

function activeProfileForDevice(dev) {
  const base = readBaseProfile();
  if (!base || !dev.vless_uuid) return null;
  return { ...base, uuid: dev.vless_uuid }; // per-device credential
}

async function handleActivate(req, res, ip) {
  if (rateLimited(ip, 'activate', 12)) return send(res, 429, { error: 'rate_limited' });
  const body = await readBody(req);
  const email = normEmail(body?.email);
  const code = String(body?.code || '').trim().toUpperCase();
  const deviceId = String(body?.device_id || '').trim();
  if (!body || !isEmail(email) || !deviceId) return send(res, 400, { error: 'invalid_request' });

  const devHash = sha(deviceId);
  const dev = DB.devices.find((d) => d.email_normalized === email && d.device_id_hash === devHash);
  const r = DB.requests.find((x) => x.email_normalized === email);

  // Known devices learn their real state (so the client can clear on revoke).
  if (dev) {
    if (dev.status === 'revoked' || (r && (r.status === 'revoked' || r.status === 'denied'))) {
      return send(res, 200, { status: 'revoked' });
    }
    if (dev.status === 'active' && r && r.status === 'approved') {
      dev.last_seen_at = now();
      dev.last_ip = ip;
      dev.app_version = String(body.app_version || dev.app_version || '');
      saveDB(DB);
      const profile = activeProfileForDevice(dev);
      if (!profile) return send(res, 503, { status: 'approved', error: 'profile_unavailable' });
      return send(res, 200, { status: 'connected', profile });
    }
  }

  // No code provided → this is a status poll for an unknown/not-yet-active
  // device. Always "pending" — reveals nothing about approval.
  if (!code) return send(res, 200, { status: 'pending' });

  // Code provided → activation attempt. Every failure returns the SAME
  // generic 'invalid_code' (no approved-vs-unapproved oracle), and counts
  // toward a per-email lockout.
  const fail = () => {
    if (r) {
      r.attempts = (r.attempts || 0) + 1;
      if (r.attempts >= CFG.maxAttempts) r.locked_until = ms() + CFG.lockMin * 60_000;
      r.updated_at = now();
      saveDB(DB);
    }
    return send(res, 200, { status: 'invalid_code' });
  };
  if (r && r.locked_until && ms() < r.locked_until) return fail();
  if (!r || r.status !== 'approved' || !r.code_hash || r.code_used) return fail();
  if (r.code_issued_at && ms() - Date.parse(r.code_issued_at) > CFG.codeTtlMin * 60_000) return fail();
  if (sha(code) !== r.code_hash) return fail();

  // Valid → mint a per-device uuid, bind, return profile once.
  const base = readBaseProfile();
  if (!base) return send(res, 503, { status: 'approved', error: 'profile_unavailable' });
  r.code_used = true;
  r.attempts = 0;
  r.updated_at = now();
  const newDev = {
    id: genId(),
    email_normalized: email,
    device_id_hash: devHash,
    device_label: String(body.device_label || '').slice(0, 80),
    vless_uuid: crypto.randomUUID(),
    status: 'active',
    created_at: now(),
    last_seen_at: now(),
    last_ip: ip,
    app_version: String(body.app_version || ''),
  };
  DB.devices.push(newDev);
  saveDB(DB);
  return send(res, 200, { status: 'connected', profile: { ...base, uuid: newDev.vless_uuid } });
}

async function handleAdmin(req, res, path) {
  if (!requireAdmin(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && path === '/api/alpha/admin/list') {
    return send(res, 200, {
      requests: DB.requests.map(({ code_hash, ...r }) => ({ ...r, has_code: !!code_hash })),
      // never expose vless_uuid in the list view
      devices: DB.devices.map(({ vless_uuid, ...d }) => ({ ...d })),
    });
  }
  // Desired sing-box users for ACTIVE devices (consumed by sync-singbox.mjs).
  if (req.method === 'GET' && path === '/api/alpha/admin/singbox-users') {
    const flow = flowOf();
    const users = DB.devices
      .filter((d) => d.status === 'active')
      .map((d) => ({ uuid: d.vless_uuid, flow, name: 'dev:' + d.id.slice(0, 8) }));
    return send(res, 200, { users });
  }

  const body = await readBody(req);
  const r = DB.requests.find((x) => x.id === body?.id || x.email_normalized === normEmail(body?.email));
  if (req.method === 'POST' && path === '/api/alpha/admin/approve') {
    if (!r) return send(res, 404, { error: 'not_found' });
    const code = genCode();
    r.status = 'approved';
    r.code_hash = sha(code);
    r.code_issued_at = now();
    r.code_used = false;
    r.attempts = 0;
    r.locked_until = 0;
    r.approved_at = now();
    r.approved_by = 'admin';
    r.updated_at = now();
    saveDB(DB);
    return send(res, 200, { ok: true, activation_code: code, ttl_minutes: CFG.codeTtlMin });
  }
  if (req.method === 'POST' && path === '/api/alpha/admin/deny') {
    if (!r) return send(res, 404, { error: 'not_found' });
    r.status = 'denied';
    r.code_hash = null;
    r.updated_at = now();
    saveDB(DB);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/alpha/admin/revoke') {
    if (r) {
      r.status = 'revoked';
      r.code_hash = null;
      r.updated_at = now();
    }
    const targetEmail = r ? r.email_normalized : normEmail(body?.email);
    for (const d of DB.devices) if (d.email_normalized === targetEmail) d.status = 'revoked';
    saveDB(DB);
    return send(res, 200, { ok: true, note: 'run sync-singbox to apply at the VPS' });
  }
  return send(res, 404, { error: 'not_found' });
}

function serveStatic(res, name, type) {
  const p = join(__dir, 'public', name);
  if (!existsSync(p)) return send(res, 404, { error: 'not_found' });
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(p));
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const ip = clientIp(req);
  try {
    if (req.method === 'GET' && (path === '/alpha' || path === '/alpha/' || path === '/alpha/register')) return serveStatic(res, 'alpha.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && (path === '/admin/alpha' || path === '/admin/alpha/')) return serveStatic(res, 'admin.html', 'text/html; charset=utf-8');
    if (req.method === 'POST' && path === '/api/alpha/register') return handleRegister(req, res, ip);
    if (req.method === 'POST' && path === '/api/alpha/device/activate') return handleActivate(req, res, ip);
    if (req.method === 'POST' && path === '/api/alpha/admin/login') return handleLogin(req, res, ip);
    if (req.method === 'POST' && path === '/api/alpha/admin/logout') return handleLogout(req, res);
    if (req.method === 'GET' && path === '/api/alpha/admin/me') return handleMe(req, res);
    if (req.method === 'POST' && path === '/api/alpha/admin/change-credentials') return handleChangeCreds(req, res);
    if (path.startsWith('/api/alpha/admin/')) return handleAdmin(req, res, path);
    if (req.method === 'GET' && path === '/api/alpha/health') return send(res, 200, { ok: true });
    return send(res, 404, { error: 'not_found' });
  } catch {
    return send(res, 500, { error: 'server_error' });
  }
});

if (!CFG.adminToken) console.warn('[alpha-access] WARNING: ALPHA_ADMIN_TOKEN empty — admin endpoints reject all.');
server.listen(CFG.port, CFG.host, () =>
  console.log(`[alpha-access] http://${CFG.host}:${CFG.port}  base-profile ${existsSync(CFG.profileFile) ? 'present' : 'MISSING'}`),
);
