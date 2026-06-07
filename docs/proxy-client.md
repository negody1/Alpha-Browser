## Alpha Browser — Embedded Proxy Client (Phase 4.9–4.10)

Goal: local-only integration of an embedded proxy runtime that exposes **loopback SOCKS5** for the routing/PAC engine.

### Non-goals (this phase)
- No VPS deploy, no server changes.
- No nginx/systemd/firewall changes.
- No OS-wide proxy settings.
- No user-imported JSON/subscriptions.

---

### Future VPS integration note (multi-IP)

The Alpha proxy server may have multiple public IPs. **Preferred public/egress IP for Alpha proxy is `185.192.246.197`.**

Avoid defaulting to `5.129.214.182` due to known VPN/proxy traffic issues, unless explicitly approved during server phase planning/audit.

---

### Architecture overview

- **Renderer**: shows simple connection status only. No raw configs, no secrets.
- **Main**:
  - `ProxyClientService` manages lifecycle and exposes **local SOCKS5** on `127.0.0.1:<port>`.
  - `SingBoxConfigBuilder` generates runtime config in `userData/alpha-proxy/runtime/`.
  - `RoutingService` generates PAC and applies it to Electron session using `SOCKS5 127.0.0.1:<port>`.
  - `TabManager` includes proxy snapshot in `BrowserStateSnapshot` so UI updates automatically.

---

### Proxy client lifecycle

States:
- `DISCONNECTED`
- `CONNECTING`
- `CONNECTED`
- `RECONNECTING`
- `ERROR`

Guarantees:
- No detached processes in MVP (managed lifecycle).
- Graceful shutdown with timeout → kill if needed.
- Restart throttling (backoff + budget) to prevent infinite loops.

---

### Local SOCKS strategy

- **Loopback-only**: bind **only** to `127.0.0.1` (never `0.0.0.0`).
- **Ports**:
  - prefer `1080`
  - fallback range `10810-10899` if busy
- On port change: update stored proxy endpoint and regenerate PAC.

---

### Embedded binary support (scaffold)

Windows-first paths:
- Dev: `apps/desktop-electron/resources/bin/sing-box.exe` (optional)
- Packaged: `resources/bin/sing-box.exe`

Runtime modes:
- `IN_PROCESS_TEST` — in-process SOCKS5 server (no binary required)
- `SING_BOX_LOCAL_TEST` — spawn `sing-box` with local SOCKS inbound + `direct` outbound
- `SING_BOX_REMOTE` — spawn `sing-box` with local SOCKS inbound + VLESS/Reality outbound to the VPS (P0-D, see below)

Selection:
- Default: `IN_PROCESS_TEST`
- To enable local sing-box in dev: set `ALPHA_PROXY_RUNTIME=SING_BOX_LOCAL_TEST`
- To enable the remote tunnel in dev: set `ALPHA_PROXY_RUNTIME=SING_BOX_REMOTE` (requires a remote profile, see below)

If the binary is missing in `SING_BOX_LOCAL_TEST`, Alpha must not crash and shows error reason `BINARY_MISSING` (“Компонент прокси не найден” / “sing-box не найден”).

---

### Runtime config generation

Generated under:
- `userData/alpha-proxy/runtime/`

Files:
- `sing-box.local-test.json` (Phase 4.10 local test)
- `sing-box.remote-scaffold.json` (future placeholder)

Renderer has no access to this directory or raw JSON.

---

### Health checks

Local-only:
- TCP connect to `127.0.0.1:<port>` with short timeout.
- No remote health pings in this phase.

---

### Logging rules

Allowed:
- lifecycle transitions, timestamps, sanitized errors

Forbidden:
- URLs, query params, request bodies, cookies

---

### Security notes

- Proxy endpoint is loopback-only; exposure is limited to local machine.
- Renderer cannot read proxy configs or secrets.
- No server-side request logs in MVP design.

---

### Manual checks (Phase 4.10)

- **Binary missing**: with `ALPHA_PROXY_RUNTIME=SING_BOX_LOCAL_TEST` and no binary → app runs, status `ERROR`, reason `BINARY_MISSING`.
- **Config build**: generated inbound is always `127.0.0.1` and uses selected port; never `0.0.0.0`.
- **Port fallback**: if `1080` is busy → use `10810-10899`.
- **Lifecycle**: start → stop → restart; no zombie processes; restart throttling prevents infinite loops.

---

## P0-D — Remote transport (VLESS + Reality)

`SING_BOX_REMOTE` turns the shared loopback SOCKS5 endpoint into a real tunnel:
the one `sing-box` process keeps a single SOCKS inbound, but its outbound is now a
`vless` outbound that connects to the provisioned VPS using **Reality** (uTLS
ClientHello mimicry + Reality handshake). All traffic sent to the SOCKS endpoint
egresses on the VPS.

### How it works

```
PROXY tab (persist:alpha-proxy session)
   → SOCKS5 127.0.0.1:<port>            (one shared sing-box)
      → vless + reality outbound        (uTLS chrome fingerprint, flow xtls-rprx-vision, xudp)
         → VPS                          (egress = remote server IP)
```

- `SingBoxConfigBuilder.buildRemote()` generates the config under
  `userData/alpha-proxy/runtime/sing-box.remote.json`.
- `ProxyClientService` selects the mode from `ALPHA_PROXY_RUNTIME=SING_BOX_REMOTE`,
  reads the remote profile, spawns the binary, waits for SOCKS readiness, and runs
  the same lifecycle/healthcheck guards as the local modes.
- The Reality **private key never exists on the client**; only the public
  `public_key` / `short_id` are used.

### Why one shared sing-box (not one per tab)

`sing-box` is a relatively heavy native process. Running one per tab would multiply
memory/handle usage and startup latency, and would not improve isolation. Instead a
single process exposes one loopback SOCKS5 endpoint, and **per-tab routing is done at
the Electron session layer**, not at the transport layer.

### Why per-tab routing is done via partitions

`SessionRegistry` owns two Electron sessions:
- `DIRECT` = `session.defaultSession`, pinned to `mode: 'direct'`.
- `PROXY`  = `persist:alpha-proxy`, pointed at the shared SOCKS endpoint.

Each tab carries a `routeClass` / `partition` and is attached to the matching
session, so a DIRECT tab and a PROXY tab for the same domain can run side by side with
different egress IPs. The transport (`sing-box`) is shared; the *decision* about which
tab uses it is per-session. This is what makes "two tabs, two IPs" possible without
two proxy processes.

### Remote profile — security model

No real credentials live in source. The profile is resolved at runtime in this order:

1. **Environment variables** (highest priority):
   `ALPHA_REMOTE_SERVER`, `ALPHA_REMOTE_PORT`, `ALPHA_REMOTE_UUID`,
   `ALPHA_REMOTE_PUBKEY`, `ALPHA_REMOTE_SHORTID`, `ALPHA_REMOTE_SNI`, `ALPHA_REMOTE_FLOW`.
2. **A git-ignored local file**, first match wins:
   - `$ALPHA_REMOTE_PROFILE` (explicit path), or
   - `userData/alpha-proxy/alpha-remote-profile.local.json`, or
   - `<appPath>/alpha-remote-profile.local.json` (dev convenience —
     `apps/desktop-electron/alpha-remote-profile.local.json`).

If neither yields a complete profile, the remote transport stays **disabled**:
`ProxyClientService` reports status `ERROR` with reason `REMOTE_PROFILE_MISSING`
instead of starting.

Committed to the repo:
- `apps/desktop-electron/alpha-remote-profile.example.json` — **template with
  placeholder values only**.

Git-ignored (never committed):
- `**/alpha-remote-profile.local.json` — the real `server` + `uuid` (auth secret).

Setup for a dev machine:

```bash
cp apps/desktop-electron/alpha-remote-profile.example.json \
   apps/desktop-electron/alpha-remote-profile.local.json
# then edit the .local.json with real values (or use ALPHA_REMOTE_* env vars)
```

### Validate DIRECT vs PROXY

A standalone script proves the tunnel without booting the UI:

```bash
pnpm proxy:validate-remote
# or: node scripts/proxy-remote-validate.mjs
```

It resolves the same profile, spawns `sing-box` with the `buildRemote()` config, and
measures egress IP both directly and through the SOCKS endpoint. **PASS** requires:
- `DIRECT IP != PROXY IP`, and
- `PROXY IP == profile.server`.

Output is safe diagnostics only — `runtimeMode`, `status`, local SOCKS port, remote
server, remote port, SNI/flow, and the egress test result. **No UUID, no keys.**

### Safe diagnostics

`ProxyClientService.getDiagnostics()` exposes only non-sensitive fields
(`remoteServer`, `remotePort`, runtime mode, status, local socks). The UUID and
Reality keys are never logged or surfaced to the renderer.

### Current limitations

- Manual per-tab routing only: `AUTO` route class, route memory, and route affinity
  are intentionally **not** implemented yet.
- Single remote profile (no multi-profile / subscription import).
- No automatic in-app egress assertion yet; egress is verified via the script above.
- Reality params are static per profile; rotation requires editing the profile.

