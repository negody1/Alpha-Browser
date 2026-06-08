// Local API test for Alpha Access (per-device, hardened). Spawns the server with
// the EXAMPLE base profile + a throwaway data file, runs the flow, and asserts:
//  - per-device unique VLESS uuid in the delivered profile
//  - NO email-approval enumeration oracle
//  - per-email attempt lockout
//  - revoke removes the device from the active sing-box user set
//  - no profile/secret in logs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-admin-token';
const dataFile = join(__dir, 'data', 'test-run.json');
if (existsSync(dataFile)) rmSync(dataFile);

const env = {
  ...process.env,
  ALPHA_ACCESS_PORT: String(PORT),
  ALPHA_ADMIN_TOKEN: TOKEN,
  ALPHA_PROFILE_FILE: join(__dir, 'alpha-proxy-profile.example.json'),
  ALPHA_DATA_FILE: dataFile,
  ALPHA_HASH_SALT: 'test-salt',
  ALPHA_MAX_ATTEMPTS: '5',
  ALPHA_ADMIN_USER: 'root',
  ALPHA_ADMIN_PASSWORD: 'init-pass-1',
};
const srv = spawn(process.execPath, [join(__dir, 'server.mjs')], { env });
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));
const sleep = (m) => new Promise((r) => setTimeout(r, m));
async function api(path, method = 'GET', body, admin = false) {
  const headers = { 'content-type': 'application/json' };
  if (admin) headers.authorization = 'Bearer ' + TOKEN;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
// cookie-aware client (session login flow). `cookie` carries the alpha_admin session.
async function capi(path, method = 'GET', body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = /alpha_admin=([^;]*)/.exec(setCookie);
  const token = m ? m[1] : null; // '' means cleared (logout)
  return { status: res.status, json: await res.json().catch(() => ({})), setCookie, sessionCookie: token != null ? `alpha_admin=${token}` : null };
}
let fails = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fails++;
}

// Spawn a SECOND server with no admin env to exercise the first-run wizard end-to-end.
async function testWizard() {
  const P = 8098;
  const B = `http://127.0.0.1:${P}`;
  const df = join(__dir, 'data', 'test-wizard.json');
  if (existsSync(df)) rmSync(df);
  const wsrv = spawn(process.execPath, [join(__dir, 'server.mjs')], {
    env: { ...process.env, ALPHA_ACCESS_PORT: String(P), ALPHA_ADMIN_TOKEN: 'wiz-token',
      ALPHA_PROFILE_FILE: join(__dir, 'alpha-proxy-profile.example.json'), ALPHA_DATA_FILE: df,
      ALPHA_HASH_SALT: 'wiz-salt', ALPHA_ADMIN_USER: '', ALPHA_ADMIN_PASSWORD: '' },
  });
  let wlog = '';
  wsrv.stdout.on('data', (d) => (wlog += d));
  wsrv.stderr.on('data', (d) => (wlog += d));
  const wapi = async (path, method = 'GET', body, cookie) => {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie') || '';
    const m = /alpha_admin=([^;]*)/.exec(sc);
    return { status: res.status, json: await res.json().catch(() => ({})), sessionCookie: m && m[1] ? `alpha_admin=${m[1]}` : null };
  };
  try {
    for (let i = 0; i < 30; i++) { try { if ((await wapi('/api/alpha/health')).json.ok) break; } catch {} await sleep(100); }
    const st = await wapi('/api/alpha/admin/setup-status');
    check('wizard: fresh server needs_setup=true', st.status === 200 && st.json.needs_setup === true);
    const noLogin = await wapi('/api/alpha/admin/login', 'POST', { user: 'x', password: 'y' });
    check('wizard: login impossible before setup -> 401', noLogin.status === 401);
    const mism = await wapi('/api/alpha/admin/setup', 'POST', { user: 'admin', password: 'longpass1', confirm: 'different1' });
    check('wizard: password mismatch rejected', mism.status === 400 && mism.json.error === 'password_mismatch');
    const weak = await wapi('/api/alpha/admin/setup', 'POST', { user: 'admin', password: 'short', confirm: 'short' });
    check('wizard: weak password rejected', weak.status === 400 && weak.json.error === 'weak_password');
    const ok = await wapi('/api/alpha/admin/setup', 'POST', { user: 'admin', password: 'StrongPass1', confirm: 'StrongPass1' });
    check('wizard: valid setup -> 200 + auto-login session', ok.status === 200 && !!ok.sessionCookie && ok.json.user === 'admin');
    const me = await wapi('/api/alpha/admin/me', 'GET', null, ok.sessionCookie);
    check('wizard: auto-login session authorizes /me', me.status === 200 && me.json.user === 'admin');
    const st2 = await wapi('/api/alpha/admin/setup-status');
    check('wizard: needs_setup=false after creation', st2.status === 200 && st2.json.needs_setup === false);
    const again = await wapi('/api/alpha/admin/setup', 'POST', { user: 'evil', password: 'StrongPass2', confirm: 'StrongPass2' });
    check('wizard: cannot re-run after creation -> 409', again.status === 409);
    const newlogin = await wapi('/api/alpha/admin/login', 'POST', { user: 'admin', password: 'StrongPass1' });
    check('wizard: created admin can log in', newlogin.status === 200 && !!newlogin.sessionCookie);
    check('wizard: no plaintext password in logs', !/StrongPass1|StrongPass2/i.test(wlog));
  } finally {
    wsrv.kill();
    await sleep(150);
    if (existsSync(df)) rmSync(df);
  }
}

try {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await api('/api/alpha/health')).json.ok) break;
    } catch {}
    await sleep(100);
  }

  const A = 'Alice@Example.com';
  const B = 'bob.unapproved@example.com';

  await api('/api/alpha/register', 'POST', { email: A });
  await api('/api/alpha/register', 'POST', { email: B });

  // status poll (no code) before approval -> pending (no leak)
  const poll = await api('/api/alpha/device/activate', 'POST', { email: A, device_id: 'd1' });
  check('poll(no code) -> pending', poll.json.status === 'pending');

  // approve A
  const appr = await api('/api/alpha/admin/approve', 'POST', { email: A }, true);
  const code1 = appr.json.activation_code;
  check('approve -> code + ttl', !!code1 && appr.json.ttl_minutes > 0);

  // ENUMERATION: wrong code on APPROVED A and any code on UNAPPROVED B -> identical
  const wrongA = await api('/api/alpha/device/activate', 'POST', { email: A, code: 'WRON-GGGG', device_id: 'd1' });
  const anyB = await api('/api/alpha/device/activate', 'POST', { email: B, code: 'WRON-GGGG', device_id: 'dB' });
  check('no enumeration oracle (approved wrong == unapproved)', wrongA.json.status === 'invalid_code' && anyB.json.status === 'invalid_code', `(${wrongA.json.status}/${anyB.json.status})`);

  // device 1 activates -> per-device uuid U1
  const ok1 = await api('/api/alpha/device/activate', 'POST', { email: A, code: code1, device_id: 'd1', device_label: 'PC1' });
  const U1 = ok1.json.profile?.uuid;
  check('device1 -> connected + profile', ok1.json.status === 'connected' && UUID_RE.test(U1 || ''));
  check('per-device uuid is NOT the shared placeholder', U1 !== '00000000-0000-0000-0000-000000000000');

  // re-approve -> new code -> device 2 -> DIFFERENT uuid U2
  const appr2 = await api('/api/alpha/admin/approve', 'POST', { email: A }, true);
  const ok2 = await api('/api/alpha/device/activate', 'POST', { email: A, code: appr2.json.activation_code, device_id: 'd2', device_label: 'PC2' });
  const U2 = ok2.json.profile?.uuid;
  check('device2 -> different per-device uuid', UUID_RE.test(U2 || '') && U2 !== U1, `(U1!=U2)`);

  // active sing-box user set has both uuids
  const su = await api('/api/alpha/admin/singbox-users', 'GET', null, true);
  const uuids = (su.json.users || []).map((u) => u.uuid);
  check('singbox-users lists 2 active devices', uuids.length === 2 && uuids.includes(U1) && uuids.includes(U2));

  // revoke A -> devices revoked, removed from active set
  await api('/api/alpha/admin/revoke', 'POST', { email: A }, true);
  const afterRev = await api('/api/alpha/device/activate', 'POST', { email: A, device_id: 'd1' });
  check('revoked device -> revoked (no profile)', afterRev.json.status === 'revoked' && !afterRev.json.profile);
  const su2 = await api('/api/alpha/admin/singbox-users', 'GET', null, true);
  check('revoke removes uuids from sing-box active set', (su2.json.users || []).length === 0);

  // per-email lockout: 5 wrong attempts then a CORRECT code is still rejected
  const C = 'carol@example.com';
  await api('/api/alpha/register', 'POST', { email: C });
  const apprC = await api('/api/alpha/admin/approve', 'POST', { email: C }, true);
  for (let i = 0; i < 5; i++) await api('/api/alpha/device/activate', 'POST', { email: C, code: 'BADD-CODE', device_id: 'dC' });
  const listC = await api('/api/alpha/admin/list', 'GET', null, true);
  const recC = listC.json.requests.find((r) => r.email_normalized === 'carol@example.com');
  check('lockout: attempts counted + locked_until set', recC && recC.attempts >= 5 && recC.locked_until > 0);
  const lockedTry = await api('/api/alpha/device/activate', 'POST', { email: C, code: apprC.json.activation_code, device_id: 'dC' });
  check('lockout: correct code rejected while locked', lockedTry.json.status === 'invalid_code' && !lockedTry.json.profile);

  // ---- ADMIN AUTH (login/password sessions) ----
  // admin routes blocked without any auth (no cookie, no bearer)
  const noAuth = await api('/api/alpha/admin/list', 'GET');
  check('admin route blocked without auth -> 401', noAuth.status === 401);

  // login fail (wrong password) -> 401, no session cookie
  const badLogin = await capi('/api/alpha/admin/login', 'POST', { user: 'root', password: 'nope' });
  check('login fail -> 401 + no session', badLogin.status === 401 && !badLogin.sessionCookie);

  // login success (bootstrap admin from env) -> 200 + httpOnly session cookie
  const okLogin = await capi('/api/alpha/admin/login', 'POST', { user: 'root', password: 'init-pass-1' });
  let cookie = okLogin.sessionCookie;
  check('login success -> 200 + httpOnly session cookie', okLogin.status === 200 && !!cookie && /HttpOnly/i.test(okLogin.setCookie) && /SameSite=Lax/i.test(okLogin.setCookie));

  // session cookie authorizes admin routes + /me returns user (never the hash)
  const me = await capi('/api/alpha/admin/me', 'GET', null, cookie);
  check('session /me -> user, no secret', me.status === 200 && me.json.user === 'root' && !me.json.hash && !me.json.salt);
  const listCookie = await capi('/api/alpha/admin/list', 'GET', null, cookie);
  check('session cookie authorizes admin list', listCookie.status === 200 && Array.isArray(listCookie.json.requests));

  // password change: wrong current rejected; correct accepted
  const badChange = await capi('/api/alpha/admin/change-credentials', 'POST', { current_password: 'WRONG', new_password: 'second-pass-2' }, cookie);
  check('change-creds wrong current -> rejected', badChange.status !== 200);
  const okChange = await capi('/api/alpha/admin/change-credentials', 'POST', { current_password: 'init-pass-1', new_password: 'second-pass-2' }, cookie);
  check('change-creds correct -> 200', okChange.status === 200);

  // old password no longer works; new password works
  const oldPw = await capi('/api/alpha/admin/login', 'POST', { user: 'root', password: 'init-pass-1' });
  check('old password invalid after change -> 401', oldPw.status === 401);
  const newPw = await capi('/api/alpha/admin/login', 'POST', { user: 'root', password: 'second-pass-2' });
  check('new password valid after change -> 200', newPw.status === 200 && !!newPw.sessionCookie);
  cookie = newPw.sessionCookie;

  // logout invalidates the session
  const out = await capi('/api/alpha/admin/logout', 'POST', null, cookie);
  check('logout -> 200 + cookie cleared', out.status === 200);
  const meAfter = await capi('/api/alpha/admin/me', 'GET', null, cookie);
  check('session invalid after logout -> 401', meAfter.status === 401);

  // ---- FIRST-RUN WIZARD: locked when an admin already exists (env-bootstrapped here) ----
  const stLocked = await capi('/api/alpha/admin/setup-status');
  check('setup-status: needs_setup=false when admin exists', stLocked.status === 200 && stLocked.json.needs_setup === false);
  const setupLocked = await capi('/api/alpha/admin/setup', 'POST', { user: 'intruder', password: 'whatever12', confirm: 'whatever12' });
  check('setup wizard locked after admin exists -> 409', setupLocked.status === 409 && setupLocked.json.error === 'already_initialized');

  // ---- FIRST-RUN WIZARD happy path: a fresh server with NO admin env ----
  await testWizard();

  check('no admin password hash/salt in server logs', !/init-pass-1|second-pass-2|scrypt|"hash"|"salt"/i.test(log));

  check('no profile/secret fields in server logs', !/uuid|publicKey|REALITY|xtls-rprx/i.test(log));
} finally {
  srv.kill();
  await sleep(150);
  if (existsSync(dataFile)) rmSync(dataFile);
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
