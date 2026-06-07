# Alpha Browser — Security

> Phase 0. Defines Electron hardening, data boundaries, and threat model for MVP.

## 1. Threat model

### Assets to protect

- User passwords and credentials
- Browsing history, bookmarks (local privacy)
- Proxy credentials in routes config
- User machine integrity (no RCE from web pages)

### Threat actors

| Actor | Capability |
|-------|------------|
| Malicious website | JS in renderer/guest; network requests |
| Network attacker | MITM if routing misconfigured |
| Local malware | Read userData files; invoke OS APIs |
| Compromised server | Serve malicious PAC/config (if fetched) |
| Supply chain | npm/Electron vulnerabilities |

### Out of scope (MVP)

- Nation-state adversaries
- Full sandbox escape hardening beyond Electron defaults
- Hardware security module integration

---

## 2. Electron hardening checklist

### BrowserWindow (chrome renderer)

```typescript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  enableBlinkFeatures: '', // do not enable dangerous features
}
```

### WebContentsView (tab content)

- Same as above for guest pages (see `TabManager.createWebView`).
- **No** `nodeIntegration`, **no** `enableRemoteModule` (removed in modern Electron).
- `webviewTag: false` globally.
- `will-navigate` blocks non-`http(s)` URLs (e.g. `file://`).
- Address bar resolves URLs via main; only `http`/`https` loaded (Phase 2).
- Favicon URLs (`http`/`https`/`data:image/*`) are **display-only** in renderer; never used for navigation (Phase 3.5).

### Preload

- Only `contextBridge.exposeInMainWorld` with frozen API object.
- No direct `ipcRenderer` exposure of full channel list.
- Validate all arguments before `ipcRenderer.invoke`.

### Main process

- Disable `@electron/remote`.
- `app.enableSandbox()` where supported.
- `setPermissionRequestHandler` → default **deny**; allowlist camera/mic/notifications per-site if ever needed.
- `setWindowOpenHandler` → open in new tab with same security profile; block unexpected popups by default.

### Navigation

- `webContents.on('will-navigate')` — optional SSRF guard for internal schemes.
- `setWindowOpenHandler` controls `window.open`.
- External protocol handlers (`alpha://`, `file://`) registered only for known paths.

### CSP (chrome UI)

- Strict CSP on React bundle: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` (minimize unsafe-inline over time).

### DevTools

- Disabled in production builds (`devTools: !app.isPackaged`).

### Updates

- code signing for Windows (post-MVP release pipeline).
- `electron-updater` with signature verification when enabled.

---

## 3. IPC security

1. **Allowlist channels** — reject unknown `ipcMain.handle` registrations.
2. **Schema validation** — Zod schemas per channel (`apps/desktop-electron/src/main/ipc/schemas.ts`); max string lengths (URL, title). Phase 2: all `tabs:*` handlers validated.
3. **No arbitrary file paths** from renderer without validation and prefix check under userData.
4. **No password plaintext** in IPC event names or dev logging.
5. **Rate limit** sensitive operations (password save) if abuse suspected.

---

## 4. Data classification

| Class | Examples | Storage | Network |
|-------|----------|---------|---------|
| Secret | Passwords, proxy passwords | OS credential store | Never |
| Sensitive | History, bookmarks | Local DB/file | Never |
| Internal | routes.json, settings | Local JSON | Optional static fetch |
| Public | Blocklist, branding assets | Bundle / CDN | Read-only |

---

## 5. Password security

- Interface: `PasswordService` in `packages/core-passwords`.
- **Windows MVP**: `keytar` or `node-credstore` → Windows Credential Manager.
- **Forbidden**: JSON files, localStorage, sessionStorage, electron-store, IndexedDB for secrets.
- **Logging**: redact username/password in all loggers; structured logs use `[REDACTED]`.
- **Autofill**: user confirmation before save; no auto-save without prompt.
- **Renderer**: never receives full password list for all origins at once; scope per origin on demand.

### Placeholder adapter (dev only)

If WinCred unavailable in CI:

- In-memory store with loud `console.warn` and `isAvailable() === false` in production builds.
- Production build must fail packaging if `isAvailable()` false on Windows target.

---

## 6. Routing and proxy security

- PAC script generated locally in main; inline `pacScript` only (no remote PAC in MVP).
- Proxy endpoint validation rejects embedded credentials (`user:pass@`) and non-HTTP/SOCKS schemes.
- `routes.json` stores domain + route mode only — not full URLs, not request history.
- Session hints and temporary overrides are memory-only (cleared on quit).
- Renderer has no filesystem access to routes; all changes via Zod-validated IPC.
- **Do not** log PAC contents or full URLs with query strings in production.
- Routing applies only to `http://` / `https://` navigations.
- Proxy auth deferred; MVP endpoints are host:port without secrets in config.

---

## 6.1 Embedded proxy client security (Phase 4.9)

- Local proxy endpoint must bind **only** to `127.0.0.1` (never `0.0.0.0`).
- No OS-wide proxy settings changes.
- No proxy configs/secrets in renderer; only high-level connection status.
- Logs must never include URLs, query params, request bodies, cookies.
- Embedded binaries (e.g. sing-box) must be shipped as app resources and updated intentionally (no auto-download in MVP).

---

## 6.2 sing-box runtime integration (Phase 4.10)

- Generated sing-box config lives under `userData/alpha-proxy/runtime/` and is never accessible from renderer.
- MVP forbids auto-downloading proxy binaries at runtime (supply chain + trust boundary).
- sing-box logs must not contain browsing data; keep minimal/sanitized diagnostics only.

---

## 6.3 Bookmarks / history / downloads security (Phase 5)

- Bookmarks and history are stored locally only; never sent to server.
- History sanitization must avoid leaking sensitive query params (tokens/codes).
- Downloads are managed in **main**:
  - renderer never receives filesystem capabilities
  - never auto-open or auto-run downloaded files
  - sanitize filenames, prevent path traversal, safe overwrite naming
  - dangerous extensions require explicit user confirmation before opening

---

## 6.4 Adblock security (Phase 6)

- Adblock runs **only in main** via `webRequest`; renderer receives only state/counters.
- No remote code execution, no JS injection, no `eval`, no cosmetic DOM filtering in MVP.
- Local-only filter lists and overrides; no telemetry of blocked URLs.

## 7. Server interaction boundaries

- Client must not send: history, tabs, passwords, bookmarks, full URL lists.
- Allowed server roles: proxy relay, health check, optional signed config blob.
- Phase 8 audit: read-only; no `.env`, no firewall changes.

---

## 8. Adblock security

- Blocklist is static domains; no remote `eval`.
- `webRequest` cancel only; no injection into page context for MVP.

---

## 9. Dependency hygiene

- `pnpm audit` in CI.
- Pin Electron major version.
- Minimal dependencies in preload (zero if possible).
- Review native modules (keytar) for supply chain.

---

## 10. Incident response (local product)

- No telemetry with browsing content in MVP.
- Optional crash dumps without URLs (future, opt-in).

---

## 11. Compliance notes

- Product is **not a VPN**; marketing and UI must say "routing" / "proxy", not "VPN replacement".
- User rules stored locally; GDPR export/delete = local clear history/bookmarks/passwords APIs.

---

## 12. Security review gates

| Gate | When |
|------|------|
| S1 | Before Phase 1 merge — Electron defaults verified |
| S2 | Before Phase 4 — PAC/proxy reviewed |
| S3 | Before Phase 7 — password adapter pen-test checklist |
| S4 | Before public release — external security pass |

---

## 13. Open questions

1. Use `safeStorage` API vs keytar for Windows?
2. Encrypt routes.json proxy passwords at rest?
3. Certificate pinning for config endpoint?
