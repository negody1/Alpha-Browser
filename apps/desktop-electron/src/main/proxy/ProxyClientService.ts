import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import type {
  ProxyClientSnapshot,
  ProxyConnectionStatus,
  ProxyEgressDiagnostics,
  ProxyErrorReason,
  ProxyRuntimeMode,
} from '@alpha/shared-types';
import { Socks5Server } from './Socks5Server';
import { SingBoxConfigBuilder } from './SingBoxConfigBuilder';
import { describeRemoteProfile, getRemoteProfile, type RemoteProfile } from './remote-profile';

type ProxyClientEvents = {
  state: (state: ProxyClientSnapshot) => void;
};

function nowIso() {
  return new Date().toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TransportSmokeResult {
  runtimeMode: ProxyRuntimeMode;
  socksPort: number | null;
  /** sing-box (or in-process) endpoint is alive. */
  processAlive: boolean;
  /** Local SOCKS answers a SOCKS5 greeting. */
  socksResponds: boolean;
  /** A full SOCKS5 CONNECT to `target` succeeded (best-effort, needs network). */
  connectProbe: boolean;
  target: { host: string; port: number };
}

export interface ProxyDiagnostics {
  runtimeMode: ProxyRuntimeMode;
  status: ProxyConnectionStatus;
  socksPort: number | null;
  pid: number | null;
  processAlive: boolean;
  restartAttempt: number;
  /** Remote VPS host (SING_BOX_REMOTE only); null otherwise. No secrets. */
  remoteServer: string | null;
  /** Remote VPS port (SING_BOX_REMOTE only); null otherwise. */
  remotePort: number | null;
  logsTail: string[];
  /** PHASE 4: last end-to-end egress probe (null until first run). */
  egress: ProxyEgressDiagnostics | null;
}

export interface ProxyClientServiceOptions {
  preferredPort?: number;
  fallbackPortRange?: { start: number; end: number };
  /** Force runtime mode (otherwise uses env-based selection). */
  runtimeMode?: ProxyRuntimeMode;
}

/**
 * Local transport layer (P0-C).
 *
 * Provides a single, shared, loopback-only SOCKS5 endpoint that the browser can
 * use as a transport. There is exactly one transport per app instance — never
 * one per tab. Modes:
 * - SING_BOX_LOCAL_TEST: spawns the real `sing-box` binary (socks inbound +
 *   direct outbound) and exposes its loopback SOCKS port.
 * - IN_PROCESS_TEST: a built-in SOCKS5 server (no binary) for lifecycle tests.
 * - SING_BOX_REMOTE (P0-D): spawns `sing-box` with a socks inbound and a
 *   VLESS+Reality outbound to the provisioned VPS. Egress happens on the VPS,
 *   so the same loopback SOCKS endpoint now carries tunnelled traffic. Shares
 *   the LOCAL_TEST lifecycle (spawn / readiness / healthcheck / reconnect).
 *
 * IMPORTANT (architecture): this service only produces a transport endpoint
 * (`getState().localSocks`). It does NOT decide per-tab routing. Today the
 * endpoint is wired into the global PAC/defaultSession purely as a transport
 * smoke-test; true per-tab routing arrives in P1 via Route Partitions, which
 * will attach this same single endpoint to a dedicated PROXY session.
 */
export class ProxyClientService extends EventEmitter {
  private status: ProxyConnectionStatus = 'DISCONNECTED';
  private runtimeMode: ProxyRuntimeMode;
  private errorReason: ProxyErrorReason | null = null;
  private lastError: string | null = null;
  private lastChangedAt = nowIso();

  private socksServer: Socks5Server | null = null;
  private socksPort: number | null = null;

  private child: ChildProcess | null = null;
  /** Active remote profile (SING_BOX_REMOTE only); non-secret bits used in diagnostics. */
  private remoteProfile: RemoteProfile | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempt = 0;
  private restartWindow: number[] = [];
  /** PHASE 4: cached end-to-end egress probe + throttle timestamp. */
  private lastEgress: ProxyEgressDiagnostics | null = null;
  private lastEgressAtMs = 0;

  private readonly preferredPort: number;
  private readonly range: { start: number; end: number };

  constructor(options: ProxyClientServiceOptions = {}) {
    super();
    this.preferredPort = options.preferredPort ?? 1080;
    this.range = options.fallbackPortRange ?? { start: 10810, end: 10899 };
    this.runtimeMode = options.runtimeMode ?? this.pickRuntimeModeFromEnv();
  }

  getState(): ProxyClientSnapshot {
    return {
      status: this.status,
      runtimeMode: this.runtimeMode,
      localSocksEndpoint: this.socksPort ? `SOCKS5 127.0.0.1:${this.socksPort}` : null,
      localSocks: this.socksPort ? { host: '127.0.0.1', port: this.socksPort } : null,
      errorReason: this.errorReason,
      lastError: this.lastError,
      lastChangedAt: this.lastChangedAt,
      restartAttempt: this.restartAttempt,
    };
  }

  getLocalSocksEndpoint(): string | null {
    return this.getState().localSocksEndpoint;
  }

  async start(): Promise<ProxyClientSnapshot> {
    if (this.status === 'CONNECTED' || this.status === 'CONNECTING' || this.status === 'RECONNECTING') {
      return this.getState();
    }

    this.setStatus('CONNECTING', null, null);

    // reset error details on start attempt
    this.errorReason = null;
    this.lastError = null;

    if (this.runtimeMode === 'IN_PROCESS_TEST') {
      // Local in-process SOCKS server (no binary required)
      const port = await this.bindSocksLoopbackInProcess();
      this.socksPort = port;
    } else if (
      this.runtimeMode === 'SING_BOX_LOCAL_TEST' ||
      this.runtimeMode === 'SING_BOX_REMOTE'
    ) {
      // Real sing-box runtime: a single loopback SOCKS inbound. The outbound is
      // either `direct` (LOCAL_TEST) or `vless`+Reality to the VPS (REMOTE).
      if (!this.canSpawnSingBox()) {
        this.setStatus('ERROR', 'Компонент прокси не найден', 'BINARY_MISSING');
        return this.getState();
      }

      const port = await this.pickFreePort();
      this.socksPort = port;

      let configPath = '';
      try {
        if (this.runtimeMode === 'SING_BOX_REMOTE') {
          const profile = getRemoteProfile();
          if (!profile) {
            // No credentials in env or the local ignored profile file.
            this.socksPort = null;
            this.remoteProfile = null;
            this.setStatus(
              'ERROR',
              'Remote-профиль не настроен (env ALPHA_REMOTE_* или alpha-remote-profile.local.json)',
              'REMOTE_PROFILE_MISSING',
            );
            return this.getState();
          }
          this.remoteProfile = profile;
          console.log('[alpha][proxy] starting SING_BOX_REMOTE transport', {
            ...describeRemoteProfile(profile),
            localSocksPort: port,
          });
          const built = await SingBoxConfigBuilder.buildRemote({ host: '127.0.0.1', port, profile });
          configPath = built.configPath;
        } else {
          this.remoteProfile = null;
          const built = await SingBoxConfigBuilder.buildLocalTest({ host: '127.0.0.1', port });
          configPath = built.configPath;
        }
      } catch (e) {
        this.setStatus('ERROR', 'Не удалось подготовить конфигурацию прокси', 'CONFIG_WRITE_FAILED');
        return this.getState();
      }

      try {
        this.spawnSingBox(configPath);
      } catch {
        this.setStatus('ERROR', 'Не удалось запустить компонент прокси', 'UNKNOWN');
        return this.getState();
      }

      // Wait until the real sing-box process has bound the loopback SOCKS port
      // and answers a SOCKS5 greeting. This replaces "assume started" with an
      // active readiness probe and distinguishes an early process crash from a
      // port that never came up.
      const ready = await this.waitForSocksReady(port, 7000);
      if (!ready) {
        if (!this.isChildAlive()) {
          this.setStatus('ERROR', 'Компонент прокси завершился при запуске', 'PROCESS_EXITED');
        } else {
          this.setStatus('ERROR', 'Прокси не вышел в готовность (SOCKS)', 'HEALTHCHECK_FAILED');
        }
        await this.stopChild();
        return this.getState();
      }
    } else {
      this.setStatus('ERROR', 'Неизвестный режим прокси', 'UNKNOWN');
      return this.getState();
    }

    const ok = await this.healthcheck();
    if (!ok) {
      // If sing-box died quickly, map to process exit
      if (this.runtimeMode !== 'IN_PROCESS_TEST' && !this.child) {
        this.setStatus('ERROR', 'Компонент прокси завершился', 'PROCESS_EXITED');
      } else {
        this.setStatus('ERROR', 'Прокси недоступен (healthcheck)', 'HEALTHCHECK_FAILED');
      }
      return this.getState();
    }

    this.setStatus('CONNECTED', null, null);
    return this.getState();
  }

  async stop(): Promise<ProxyClientSnapshot> {
    this.clearRestartTimer();
    this.restartAttempt = 0;
    this.restartWindow = [];

    await this.stopChild();
    await this.stopSocks();

    this.setStatus('DISCONNECTED', null, null);
    return this.getState();
  }

  async restart(): Promise<ProxyClientSnapshot> {
    await this.stop();
    return this.start();
  }

  /**
   * Liveness check for the transport.
   * - For a real sing-box process: the child must still be alive.
   * - For any mode: the local SOCKS endpoint must answer a SOCKS5 greeting
   *   (not merely accept a TCP connection).
   */
  async healthcheck(): Promise<boolean> {
    if (!this.socksPort) {
      return false;
    }
    if (this.runtimeMode !== 'IN_PROCESS_TEST' && !this.isChildAlive()) {
      return false;
    }
    return this.socksHandshake('127.0.0.1', this.socksPort, 800);
  }

  /**
   * Deeper, on-demand transport diagnostics for validation/smoke-tests.
   * Does NOT affect routing or browser behavior. The connect probe is
   * best-effort (requires outbound connectivity) and never throws.
   */
  async runTransportSmokeTest(
    target: { host: string; port: number } = { host: 'example.com', port: 80 },
  ): Promise<TransportSmokeResult> {
    const port = this.socksPort;
    const processAlive = this.runtimeMode === 'IN_PROCESS_TEST' ? true : this.isChildAlive();
    const socksResponds = port ? await this.socksHandshake('127.0.0.1', port, 1000) : false;
    const connectProbe = port ? await this.socksConnectProbe(port, target.host, target.port, 5000) : false;
    return {
      runtimeMode: this.runtimeMode,
      socksPort: port,
      processAlive,
      socksResponds,
      connectProbe,
      target,
    };
  }

  /** Sanitized diagnostics snapshot (no URLs, no uuid, no keys). */
  getDiagnostics(): ProxyDiagnostics {
    return {
      runtimeMode: this.runtimeMode,
      status: this.status,
      socksPort: this.socksPort,
      pid: this.child?.pid ?? null,
      processAlive: this.runtimeMode === 'IN_PROCESS_TEST' ? this.socksPort != null : this.isChildAlive(),
      restartAttempt: this.restartAttempt,
      remoteServer: this.remoteProfile?.server ?? null,
      remotePort: this.remoteProfile?.port ?? null,
      logsTail: this.logRing.slice(-50),
      egress: this.lastEgress,
    };
  }

  /** Last cached egress probe (no network). */
  getEgressDiagnostics(): ProxyEgressDiagnostics | null {
    return this.lastEgress;
  }

  /**
   * PHASE 4: end-to-end egress check. Verifies the local SOCKS greeting AND a
   * full HTTP request through the tunnel, returning the observed egress IP.
   * Throttled to once per 15s unless `force`. Never throws; best-effort.
   */
  async checkEgress(force = false): Promise<ProxyEgressDiagnostics> {
    const now = Date.now();
    if (!force && this.lastEgress && now - this.lastEgressAtMs < 15_000) {
      return this.lastEgress;
    }
    this.lastEgressAtMs = now;

    const port = this.socksPort;
    const expectedEgressIp = this.remoteProfile?.server ?? null;
    const localSocksOk = port ? await this.socksHandshake('127.0.0.1', port, 1200) : false;

    let egressIp: string | null = null;
    let remoteEgressOk = false;
    let error: string | null = null;

    if (!port) {
      error = 'no-socks-port';
    } else if (!localSocksOk) {
      error = 'local-socks-down';
    } else {
      const r = await this.httpEgressProbe(port, 'api.ipify.org', 8000);
      egressIp = r.ip;
      remoteEgressOk = r.ok;
      error = r.error;
    }

    this.lastEgress = {
      localSocksOk,
      remoteEgressOk,
      egressIp,
      expectedEgressIp,
      lastCheckedAt: nowIso(),
      error,
    };
    return this.lastEgress;
  }

  /**
   * Minimal HTTP-over-SOCKS5 GET to a plaintext endpoint (no TLS), used only to
   * read back the egress IP. Loopback SOCKS → tunnel → endpoint. Best-effort.
   */
  private httpEgressProbe(
    port: number,
    host: string,
    timeoutMs: number,
  ): Promise<{ ip: string | null; ok: boolean; error: string | null }> {
    return new Promise((resolve) => {
      let done = false;
      let stage = 0;
      let buf = Buffer.alloc(0);
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = (ip: string | null, ok: boolean, error: string | null) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ ip, ok, error });
      };
      socket.setTimeout(timeoutMs, () => finish(null, false, 'timeout'));
      socket.on('error', (e) => finish(null, false, String(e?.message ?? e)));
      socket.on('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
      socket.on('data', (d) => {
        if (stage === 0) {
          if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) {
            return finish(null, false, 'socks-greeting');
          }
          stage = 1;
          const hostBuf = Buffer.from(host, 'utf8');
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(80, 0);
          socket.write(
            Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]),
          );
          return;
        }
        if (stage === 1) {
          if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) {
            return finish(null, false, 'socks-connect');
          }
          stage = 2;
          socket.write(
            Buffer.from(
              `GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Alpha-Browser\r\nAccept: text/plain\r\nConnection: close\r\n\r\n`,
            ),
          );
          return;
        }
        // stage 2: accumulate the HTTP response body.
        buf = Buffer.concat([buf, d]);
      });
      socket.on('end', () => {
        const text = buf.toString('utf8');
        const sep = text.indexOf('\r\n\r\n');
        const body = sep >= 0 ? text.slice(sep + 4).trim() : '';
        const m = body.match(/(\d{1,3}\.){3}\d{1,3}/);
        finish(m ? m[0] : null, !!m, m ? null : 'no-egress-ip');
      });
    });
  }

  // ── PHASE 3: orphan-process protection (PID file + verified reclaim) ──

  private pidFilePath(): string {
    return join(app.getPath('userData'), 'alpha-proxy', 'sing-box.pid');
  }

  private writePidFile(pid: number): void {
    try {
      const p = this.pidFilePath();
      mkdirSync(join(app.getPath('userData'), 'alpha-proxy'), { recursive: true });
      writeFileSync(p, JSON.stringify({ pid, startedAt: nowIso() }), 'utf8');
    } catch {
      // best effort
    }
  }

  private clearPidFile(): void {
    try {
      const p = this.pidFilePath();
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best effort
    }
  }

  /**
   * Confirm a PID currently belongs to an Alpha-owned sing-box image. We NEVER
   * kill by name; this only verifies that the exact recorded PID is still a
   * sing-box process (guards against PID reuse) before reclaiming it.
   */
  private isAlphaSingBoxPid(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      if (process.platform === 'win32') {
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          timeout: 3000,
          windowsHide: true,
        }).toString();
        return /sing-box/i.test(out);
      }
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
        timeout: 3000,
      }).toString();
      return /sing-box/i.test(out);
    } catch {
      return false;
    }
  }

  /**
   * PHASE 3: at startup, reclaim a sing-box left running by a previous Alpha
   * instance that crashed before cleanup. Only the exact PID recorded in our
   * pidfile is touched, and only after verifying it is still a sing-box image —
   * other users' sing-box processes are never affected.
   */
  reclaimOrphanedProcess(): void {
    let pid: number | null = null;
    try {
      const p = this.pidFilePath();
      if (!existsSync(p)) return;
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { pid?: unknown };
      pid = typeof raw.pid === 'number' ? raw.pid : null;
    } catch {
      this.clearPidFile();
      return;
    }
    if (pid && this.isAlphaSingBoxPid(pid)) {
      try {
        process.kill(pid);
        console.log('[alpha][proxy] reclaimed orphaned sing-box', { pid });
      } catch {
        // already gone / not permitted
      }
    }
    this.clearPidFile();
  }

  private isChildAlive(): boolean {
    return (
      !!this.child &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      !this.child.killed
    );
  }

  private async waitForSocksReady(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.runtimeMode !== 'IN_PROCESS_TEST' && !this.isChildAlive()) {
        return false;
      }
      if (await this.socksHandshake('127.0.0.1', port, 600)) {
        return true;
      }
      await delay(150);
    }
    return false;
  }

  /** SOCKS5 no-auth greeting probe: expects server reply 0x05 0x00. */
  private socksHandshake(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const socket = net.createConnection({ host, port });
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.on('error', () => finish(false));
      socket.on('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
      socket.on('data', (d) => finish(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00));
    });
  }

  /**
   * Best-effort full SOCKS5 CONNECT through the local endpoint to verify the
   * tunnel can reach a target. Returns true only if the server replies with a
   * success status (0x00). Used by diagnostics, never by routing.
   */
  private socksConnectProbe(
    port: number,
    targetHost: string,
    targetPort: number,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      let stage = 0;
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.on('error', () => finish(false));
      socket.on('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
      socket.on('data', (d) => {
        if (stage === 0) {
          if (!(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00)) {
            return finish(false);
          }
          stage = 1;
          const hostBuf = Buffer.from(targetHost, 'utf8');
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(targetPort, 0);
          const req = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
            portBuf,
          ]);
          socket.write(req);
          return;
        }
        // stage 1: CONNECT reply -> VER, REP, ...
        finish(d.length >= 2 && d[0] === 0x05 && d[1] === 0x00);
      });
    });
  }

  /** Called when the embedded process crashes / disconnects. */
  async handleUnexpectedDisconnect(reason: string): Promise<void> {
    // Only auto-recover from a previously healthy connection. Failures during
    // the initial start are handled inline by start() and must not trigger a
    // background reconnect storm.
    if (this.status !== 'CONNECTED' && this.status !== 'RECONNECTING') {
      return;
    }
    this.setStatus('RECONNECTING', reason, 'PROCESS_EXITED');
    await this.scheduleRestart(reason);
  }

  // --- internals ---

  private setStatus(status: ProxyConnectionStatus, err: string | null, reason: ProxyErrorReason | null) {
    this.status = status;
    this.lastError = err;
    this.errorReason = reason;
    this.lastChangedAt = nowIso();
    this.emit('state', this.getState());
  }

  private async bindSocksLoopbackInProcess(): Promise<number> {
    // try preferred port
    try {
      await this.startMockSocks(this.preferredPort);
      return this.preferredPort;
    } catch {
      // fallback range
    }

    for (let port = this.range.start; port <= this.range.end; port++) {
      try {
        await this.startMockSocks(port);
        return port;
      } catch {
        // try next
      }
    }

    throw new Error('No available local SOCKS port');
  }

  private async startMockSocks(port: number): Promise<void> {
    await this.stopSocks();
    this.socksServer = new Socks5Server({ host: '127.0.0.1', port });
    await this.socksServer.listen();
  }

  private async stopSocks(): Promise<void> {
    if (!this.socksServer) {
      return;
    }
    const srv = this.socksServer;
    this.socksServer = null;
    await srv.close();
  }

  private canSpawnSingBox(): boolean {
    return existsSync(this.resolveSingBoxPath());
  }

  private pickRuntimeModeFromEnv(): ProxyRuntimeMode {
    const raw = String(process.env.ALPHA_PROXY_RUNTIME ?? '').trim().toUpperCase();
    // An explicit override always wins (dev overrides, tests, troubleshooting).
    if (raw === 'IN_PROCESS_TEST') return 'IN_PROCESS_TEST';
    if (raw === 'SING_BOX_LOCAL_TEST') return 'SING_BOX_LOCAL_TEST';
    if (raw === 'SING_BOX_REMOTE') return 'SING_BOX_REMOTE';
    // No override: a packaged/installed build MUST use the real remote transport
    // (Netherlands routing) with zero configuration — no env vars, no flags.
    // Development keeps the in-process mock unless start-alpha.bat sets REMOTE.
    let packaged = false;
    try {
      packaged = app.isPackaged;
    } catch {
      packaged = false;
    }
    return packaged ? 'SING_BOX_REMOTE' : 'IN_PROCESS_TEST';
  }

  private async pickFreePort(): Promise<number> {
    const ports: number[] = [this.preferredPort];
    for (let p = this.range.start; p <= this.range.end; p++) ports.push(p);

    for (const port of ports) {
      const ok = await this.isPortFree('127.0.0.1', port);
      if (ok) return port;
    }
    this.setStatus('ERROR', 'Не удалось выбрать локальный порт для прокси', 'PORT_BIND_FAILED');
    throw new Error('No available port');
  }

  private async isPortFree(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen({ host, port }, () => {
        srv.close(() => resolve(true));
      });
    });
  }

  resolveSingBoxPath(): string {
    // MVP Windows-first:
    // - dev: allow placing binary under apps/desktop-electron/resources/bin/
    // - prod: resources/bin/ inside packaged app
    const binName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
    if (app.isPackaged) {
      return join(process.resourcesPath, 'bin', binName);
    }
    return join(app.getAppPath(), 'resources', 'bin', binName);
  }

  // P0-C: spawn the real sing-box process as the local transport.
  // One process, one shared loopback SOCKS endpoint (never per-tab).
  private spawnSingBox(configPath: string): void {
    const bin = this.resolveSingBoxPath();
    this.child = spawn(bin, ['run', '-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // PHASE 3: record the PID so a crashed Alpha can reclaim this exact process
    // on next launch (verified by image name; never a kill-by-name).
    if (this.child.pid) this.writePidFile(this.child.pid);

    // Ring-buffer of sanitized logs (dev-only diagnostics).
    const pushLine = (chunk: unknown) => {
      const text = String(chunk ?? '').slice(0, 4000);
      // Do not attempt to parse URLs; keep minimal.
      this.pushLog(text);
    };

    this.child.stdout?.on('data', pushLine);
    this.child.stderr?.on('data', pushLine);
    this.child.on('exit', (code, signal) => {
      this.child = null;
      this.clearPidFile();
      void this.handleUnexpectedDisconnect(`sing-box exited (${code ?? 'null'}/${signal ?? 'null'})`);
    });
  }

  private readonly logRing: string[] = [];
  private pushLog(line: string) {
    // Prevent unbounded memory usage.
    this.logRing.push(`[${nowIso()}] ${line}`.trim());
    if (this.logRing.length > 200) {
      this.logRing.splice(0, this.logRing.length - 200);
    }
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.clearPidFile();
    if (!child || child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 2500);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private async scheduleRestart(reason: string): Promise<void> {
    // throttle: max 10 restarts per 10 minutes
    const now = Date.now();
    this.restartWindow = this.restartWindow.filter((t) => now - t < 10 * 60 * 1000);
    if (this.restartWindow.length >= 10) {
      this.setStatus('ERROR', 'Прокси не удаётся восстановить', 'RESTART_BUDGET_EXCEEDED');
      return;
    }

    this.restartAttempt += 1;
    this.restartWindow.push(now);

    const base = Math.min(60000, 500 * 2 ** Math.min(10, this.restartAttempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;

    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((e) => {
        this.setStatus('ERROR', `Restart failed: ${String(e?.message ?? e)}`, 'UNKNOWN');
      });
    }, delay);
  }

  // typing
  override on<E extends keyof ProxyClientEvents>(event: E, listener: ProxyClientEvents[E]): this {
    return super.on(event, listener);
  }
}

