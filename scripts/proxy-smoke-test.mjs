#!/usr/bin/env node
/**
 * P0-C transport smoke-test (standalone).
 *
 * Proves the TRANSPORT layer end-to-end, without launching the Electron UI:
 *   1. Alpha can start the delivered real sing-box binary.
 *   2. sing-box binds a single shared loopback SOCKS5 endpoint.
 *   3. A page can be fetched THROUGH that SOCKS endpoint.
 *
 * The sing-box config here mirrors SingBoxConfigBuilder.buildLocalTest()
 * (single socks inbound + direct outbound). Outbound is `direct` — this is a
 * transport proof, NOT per-tab routing and NOT a remote tunnel.
 *
 * Run on Windows (where the .exe lives):
 *   node scripts/proxy-smoke-test.mjs
 *
 * Exit codes: 0 = transport OK, non-zero = failure (reason printed).
 */
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const binName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const binPath = join(repoRoot, 'apps', 'desktop-electron', 'resources', 'bin', binName);

const TARGET_HOST = 'example.com';
const TARGET_PORT = 80;

function log(...a) {
  console.log('[proxy-smoke]', ...a);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Full SOCKS5 CONNECT to target, send a minimal HTTP request, expect an HTTP reply. */
function fetchThroughSocks(port, host, targetPort, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let stage = 0;
    let buf = Buffer.alloc(0);
    const s = net.createConnection({ host: '127.0.0.1', port });
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve({ ok, detail });
    };
    s.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    s.on('error', (e) => finish(false, 'socket error: ' + e.message));
    s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00])));
    s.on('data', (d) => {
      if (stage === 0) {
        if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) return finish(false, 'no-auth handshake rejected');
        stage = 1;
        const hb = Buffer.from(host, 'utf8');
        const pb = Buffer.alloc(2);
        pb.writeUInt16BE(targetPort, 0);
        s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb]));
        return;
      }
      if (stage === 1) {
        if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) return finish(false, 'CONNECT failed, rep=' + (d[1] ?? '?'));
        stage = 2;
        s.write(Buffer.from(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: alpha-proxy-smoke\r\nConnection: close\r\n\r\n`));
        return;
      }
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 12) {
        const head = buf.subarray(0, 12).toString('latin1');
        finish(head.startsWith('HTTP/'), 'response head: ' + head.replace(/\r?\n/g, ' '));
      }
    });
  });
}

async function main() {
  log('binary:', binPath);
  if (!existsSync(binPath)) {
    log('FAIL: sing-box binary not found. Run `pnpm run proxy:fetch-bin` first.');
    process.exit(1);
  }

  const port = await pickFreePort();
  log('chosen loopback SOCKS port:', port);

  const dir = mkdtempSync(join(tmpdir(), 'alpha-proxy-smoke-'));
  const cfgPath = join(dir, 'sing-box.local-test.json');
  // Mirrors SingBoxConfigBuilder.buildLocalTest().
  const cfg = {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: port }],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { auto_detect_interface: true, final: 'direct' },
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  log('config written:', cfgPath);

  const child = spawn(binPath, ['run', '-c', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const logs = [];
  const cap = (c) => logs.push(String(c).trim());
  child.stdout?.on('data', cap);
  child.stderr?.on('data', cap);

  let exitCode = 'failed';
  const cleanup = () => {
    try { child.kill(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  try {
    log('starting sing-box…');
    const ready = await waitForReady(port, child, 8000);
    if (!ready) {
      log('FAIL: sing-box did not expose a working SOCKS endpoint.');
      if (logs.length) log('sing-box output:\n' + logs.join('\n'));
      exitCode = 2;
      return;
    }
    log('OK (1/2): sing-box is alive and SOCKS5 endpoint answers the handshake.');

    log(`fetching http://${TARGET_HOST}:${TARGET_PORT}/ through SOCKS…`);
    const { ok, detail } = await fetchThroughSocks(port, TARGET_HOST, TARGET_PORT, 10000);
    if (!ok) {
      log('FAIL: could not fetch a page through SOCKS:', detail);
      if (logs.length) log('sing-box output:\n' + logs.join('\n'));
      exitCode = 3;
      return;
    }
    log('OK (2/2): page fetched through SOCKS —', detail);
    log('TRANSPORT SMOKE-TEST PASSED.');
    exitCode = 0;
  } finally {
    cleanup();
    // give the child a moment to die before the process exits
    await delay(100);
    process.exit(exitCode === 0 ? 0 : Number(exitCode) || 1);
  }
}

main().catch((e) => {
  console.error('[proxy-smoke] unexpected error:', e);
  process.exit(1);
});
