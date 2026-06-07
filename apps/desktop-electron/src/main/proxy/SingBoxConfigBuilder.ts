import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { RemoteProfile } from './remote-profile';

export type ProxyRuntimeMode = 'IN_PROCESS_TEST' | 'SING_BOX_LOCAL_TEST' | 'SING_BOX_REMOTE';

export interface SingBoxBuildResult {
  configPath: string;
  configJson: unknown;
}

function runtimeDir(): string {
  return join(app.getPath('userData'), 'alpha-proxy', 'runtime');
}

function assertLoopback(host: string) {
  if (host !== '127.0.0.1') {
    throw new Error('SOCKS must be loopback-only');
  }
}

export class SingBoxConfigBuilder {
  /**
   * P0-C transport config.
   *
   * Generates a minimal, valid sing-box 1.11 configuration with a single
   * loopback SOCKS inbound and a direct outbound. This is the *transport layer*
   * only: outbound is `direct`, so traffic is not yet tunnelled to a remote
   * server (that arrives with VLESS/Reality in a later phase).
   *
   * Deliberately minimal and schema-stable:
   * - no deprecated inbound `sniff`/`udp_fragment` fields (moved to route
   *   actions in sing-box 1.11+, omitted here to avoid schema warnings);
   * - `log.level: 'warn'` so runtime errors are surfaced for diagnostics while
   *   staying quiet otherwise.
   */
  static async buildLocalTest(params: { host: '127.0.0.1'; port: number }): Promise<SingBoxBuildResult> {
    assertLoopback(params.host);
    const dir = runtimeDir();
    await mkdir(dir, { recursive: true });

    const json = {
      log: {
        level: 'warn',
        timestamp: true,
      },
      inbounds: [
        {
          type: 'socks',
          tag: 'socks-in',
          listen: params.host,
          listen_port: params.port,
        },
      ],
      outbounds: [
        {
          type: 'direct',
          tag: 'direct',
        },
      ],
      route: {
        auto_detect_interface: true,
        final: 'direct',
      },
    };

    const configPath = join(dir, 'sing-box.local-test.json');
    await writeFile(configPath, JSON.stringify(json, null, 2), { encoding: 'utf8' });
    return { configPath, configJson: json };
  }

  /**
   * P0-D remote transport config (VLESS + Reality).
   *
   * Single loopback SOCKS inbound → one `vless` outbound that tunnels to the
   * provisioned VPS Reality endpoint. All inbound traffic is routed to the
   * proxy outbound (`route.final = 'proxy'`); egress happens on the VPS.
   *
   * sing-box 1.11.15 schema:
   * - outbound `tls.reality.{public_key, short_id}` (client side — never the
   *   server's private key);
   * - `tls.utls.{enabled, fingerprint:'chrome'}` for ClientHello mimicry;
   * - `flow` at the outbound level (`xtls-rprx-vision`);
   * - `packet_encoding: 'xudp'` so UDP/QUIC (HTTP/3) works through the tunnel.
   */
  static async buildRemote(params: {
    host: '127.0.0.1';
    port: number;
    profile: RemoteProfile;
  }): Promise<SingBoxBuildResult> {
    assertLoopback(params.host);
    const dir = runtimeDir();
    await mkdir(dir, { recursive: true });

    const { profile } = params;
    const json = {
      log: {
        level: 'warn',
        timestamp: true,
      },
      inbounds: [
        {
          type: 'socks',
          tag: 'socks-in',
          listen: params.host,
          listen_port: params.port,
        },
      ],
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
            utls: {
              enabled: true,
              fingerprint: 'chrome',
            },
            reality: {
              enabled: true,
              public_key: profile.publicKey,
              short_id: profile.shortId,
            },
          },
        },
        {
          type: 'direct',
          tag: 'direct',
        },
      ],
      route: {
        final: 'proxy',
      },
    };

    const configPath = join(dir, 'sing-box.remote.json');
    await writeFile(configPath, JSON.stringify(json, null, 2), { encoding: 'utf8' });
    return { configPath, configJson: json };
  }

  /**
   * Future scaffold only. Not enabled by default.
   * Intentionally does not include any remote credentials in Phase 4.10.
   */
  static async buildRemoteScaffold(params: { host: '127.0.0.1'; port: number }): Promise<SingBoxBuildResult> {
    assertLoopback(params.host);
    const dir = runtimeDir();
    await mkdir(dir, { recursive: true });

    const json = {
      log: { disabled: true },
      inbounds: [
        {
          type: 'socks',
          tag: 'socks-in',
          listen: params.host,
          listen_port: params.port,
        },
      ],
      outbounds: [
        {
          type: 'direct',
          tag: 'direct',
        },
        {
          type: 'block',
          tag: 'remote-placeholder',
        },
      ],
      route: {
        final: 'direct',
      },
    };

    const configPath = join(dir, 'sing-box.remote-scaffold.json');
    await writeFile(configPath, JSON.stringify(json, null, 2), { encoding: 'utf8' });
    return { configPath, configJson: json };
  }
}

