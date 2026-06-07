#!/usr/bin/env node
/**
 * P0-D remote transport validation (standalone, Windows-dev friendly).
 *
 * Proves the REMOTE tunnel end-to-end without launching the Electron UI:
 *   1. Resolves the remote profile the SAME way the app does
 *      (env ALPHA_REMOTE_* → alpha-remote-profile.local.json → ALPHA_REMOTE_PROFILE).
 *   2. Spawns the delivered real sing-box with a VLESS+Reality config that
 *      mirrors SingBoxConfigBuilder.buildRemote().
 *   3. Measures egress IP DIRECT (no proxy) and PROXY (through sing-box SOCKS).
 *
 * PASS criteria:
 *   - DIRECT IP != PROXY IP   (traffic really leaves via the VPS)
 *   - PROXY IP == profile.server   (egress is the provisioned Reality endpoint)
 *
 * Run on Windows (where the .exe lives):
 *   pnpm proxy:validate-remote
 *   node scripts/proxy-remote-validate.mjs
 *
 * No secrets are printed. Exit codes: 0 = OK, non-zero = failure (reason printed).
 */
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const binName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const binPath = join(repoRoot, 'apps', 'desktop-electron', 'resources', 'bin', binName);

const EGRESS_HOST = 'api.ipify.org';

function log(...a) {
  console.log('[remote-validate]', ...a);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- profile resolution (mirrors remote-profile.ts) -------------------------

function env(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function coerce(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const server = typeof raw.server === 'string' ? raw.server.trim() : '';
  const uuid = typeof raw.uuid === 'string' ? raw.uuid.trim() : '';
  const publicKey = typeof raw.publicKey === 'string' ? raw.publicKey.trim() : '';
  const shortId = typeof raw.shortId === 'string' ? raw.shortId.trim() : '';
  const port = typeof raw.port === 'number' ? raw.port : Number(raw.port);
  const serverName = (typeof raw.serverName === 'string' && raw.serverName.trim()) || 'www.microsoft.com';
  const flow = (typeof raw.flow === 'string' && raw.flow.trim()) || 'xtls-rprx-vision';
  if (!server || !uuid || !publicKey || !Number.isInteger(port) || port <= 0) return null;
  return { server, port, uuid, publicKey, shortId, serverName, flow };
}

function resolveProfile() {
  const fromEnv = coerce({
    server: env('ALPHA_REMOTE_SERVER'),
    port: env('ALPHA_REMOTE_PORT'),
    uuid: env('ALPHA_REMOTE_UUID'),
    publicKey: env('ALPHA_REMOTE_PUBKEY'),
    shortId: env('ALPHA_REMOTE_SHORTID') ?? '',
    serverName: env('ALPHA_REMOTE_SNI'),
    flow: env('ALPHA_REMOTE_FLOW'),
  });
  if (fromEnv) return fromEnv;

  const candidates = [
    env('ALPHA_REMOTE_PROFILE'),
    join(repoRoot, 'apps', 'desktop-electron', 'alpha-remote-profile.local.json'),
    join(homedir(), '.config', 'alpha-browser', 'alpha-proxy', 'alpha-remote-profile.local.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const parsed = coerce(JSON.parse(readFileSync(p, 'utf8')));
        if (parsed) return parsed;
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

// ---- transport helpers ------------------------------------------------------

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function socksHandshake(port, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const s = net.createConnection({ host: '127.0.0.1', port });
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => finish(false));
    s.on('error', () => finish(false));
    s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00])));
    s.on('data', (d) => finish(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00));
  });
}

async function waitForReady(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    if (await socksHandshake(port, 600)) return true;
    await delay(150);
  }
  return false;
}

function parseHttpBody(raw) {
  const idx = raw.indexOf('\r\n\r\n');
  if (idx < 0) return raw.trim();
  let body = raw.slice(idx + 4);
  // de-chunk if needed (ipify is small; handle single chunk)
  if (/transfer-encoding:\s*chunked/i.test(raw.slice(0, idx))) {
    const nl = body.indexOf('\r\n');
    if (nl > 0) body = body.slice(nl + 2);
  }
  return body.trim();
}

/** HTTPS GET https://host/ tunnelled through a local SOCKS5 endpoint. Resolves the body. */
function egressThroughSocks(socksPort, host, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let stage = 0;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { raw.destroy(); } catch {}
      resolve({ ok, detail });
    };
    const raw = net.createConnection({ host: '127.0.0.1', port: socksPort });
    raw.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    raw.on('error', (e) => finish(false, 'socket: ' + e.message));
    raw.on('connect', () => raw.write(Buffer.from([0x05, 0x01, 0x00])));
    raw.on('data', (d) => {
      if (stage === 0) {
        if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) return finish(false, 'handshake rejected');
        stage = 1;
        const hb = Buffer.from(host, 'utf8');
        const pb = Buffer.alloc(2);
        pb.writeUInt16BE(443, 0);
        raw.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb]));
        return;
      }
      if (stage === 1) {
        if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) return finish(false, 'CONNECT rep=' + (d[1] ?? '?'));
        stage = 2;
        raw.removeAllListeners('data');
        const tlsSock = tls.connect({ socket: raw, servername: host }, () => {
          tlsSock.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: alpha-remote-validate\r\nConnection: close\r\n\r\n`);
        });
        let buf = '';
        tlsSock.setTimeout(timeoutMs, () => finish(false, 'tls timeout'));
        tlsSock.on('error', (e) => finish(false, 'tls: ' + e.message));
        tlsSock.on('data', (c) => { buf += c.toString('latin1'); });
        tlsSock.on('end', () => finish(true, parseHttpBody(buf)));
      }
    });
  });
}

/** HTTPS GET https://host/ directly (no proxy). Resolves the body. */
function egressDirect(host, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get({ host, path: '/', headers: { 'User-Agent': 'alpha-remote-validate' } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ ok: true, detail: buf.trim() }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, detail: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });
}

function isIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

// ---- main -------------------------------------------------------------------

async function main() {
  log('binary:', binPath);
  if (!existsSync(binPath)) {
    log('FAIL: sing-box binary not found. Run `pnpm run proxy:fetch-bin` first.');
    process.exit(1);
  }

  const profile = resolveProfile();
  if (!profile) {
    log('FAIL: no remote profile. Set ALPHA_REMOTE_* env vars or create');
    log('      apps/desktop-electron/alpha-remote-profile.local.json');
    log('      (copy alpha-remote-profile.example.json as a starting point).');
    process.exit(2);
  }

  // Safe diagnostics (no uuid / no keys).
  log('runtimeMode : SING_BOX_REMOTE');
  log('remoteServer:', profile.server);
  log('remotePort  :', profile.port);
  log('sni / flow  :', profile.serverName, '/', profile.flow);

  const port = await pickFreePort();
  log('localSocks  : 127.0.0.1:' + port);

  const dir = mkdtempSync(join(tmpdir(), 'alpha-remote-validate-'));
  const cfgPath = join(dir, 'sing-box.remote.json');
  // Mirrors SingBoxConfigBuilder.buildRemote().
  const cfg = {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: port }],
    outbounds: [
      {
        type: 'vless',
        tag: 'proxy',
        server: profile.server,
        server_port: profile.port,
        uuid: profile.uuid,
        flow: profile.flow,
        packet_encoding: 'xudp',
        tls: {
          enabled: true,
          server_name: profile.serverName,
          utls: { enabled: true, fingerprint: 'chrome' },
          reality: { enabled: true, public_key: profile.publicKey, short_id: profile.shortId },
        },
      },
      { type: 'direct', tag: 'direct' },
    ],
    route: { final: 'proxy' },
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

  const child = spawn(binPath, ['run', '-c', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const logs = [];
  const cap = (c) => logs.push(String(c).trim());
  child.stdout?.on('data', cap);
  child.stderr?.on('data', cap);

  let exitCode = 1;
  const cleanup = () => {
    try { child.kill(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  try {
    const ready = await waitForReady(port, child, 8000);
    if (!ready) {
      log('FAIL: sing-box did not expose a working SOCKS endpoint.');
      if (logs.length) log('sing-box output:\n' + logs.join('\n'));
      exitCode = 3;
      return;
    }

    const direct = await egressDirect(EGRESS_HOST, 10000);
    const proxy = await egressThroughSocks(port, EGRESS_HOST, 15000);
    const directIp = isIp(direct.detail) ? direct.detail : null;
    const proxyIp = isIp(proxy.detail) ? proxy.detail : null;

    log('DIRECT IP   :', directIp ?? `(failed: ${direct.detail})`);
    log('PROXY  IP   :', proxyIp ?? `(failed: ${proxy.detail})`);

    if (!directIp || !proxyIp) {
      log('FAIL: could not measure both egress IPs.');
      if (logs.length) log('sing-box output:\n' + logs.join('\n'));
      exitCode = 4;
      return;
    }

    const distinct = directIp !== proxyIp;
    const egressMatches = proxyIp === profile.server;
    log('egress test : DIRECT != PROXY =', distinct, '| PROXY == server =', egressMatches);

    if (distinct && egressMatches) {
      log('REMOTE TRANSPORT VALIDATION PASSED.');
      exitCode = 0;
    } else {
      log('FAIL: egress did not match expectations.');
      exitCode = 5;
    }
  } finally {
    cleanup();
    await delay(100);
    process.exit(exitCode);
  }
}

main().catch((e) => {
  console.error('[remote-validate] unexpected error:', e);
  process.exit(1);
});
