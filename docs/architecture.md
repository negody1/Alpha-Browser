# Alpha Browser — Architecture

> Phase 0–1 document. Decisions: see [decisions.md](./decisions.md).  
> MVP platform: Windows desktop. Stack: Electron + Chromium + React + TypeScript + Vite.

## 1. Goals and non-goals

### Goals

- Full-featured **local** desktop browser with premium dark UI.
- **Smart routing** (DIRECT / PROXY / AUTO) decided on-device; server is only proxy/config/health endpoints.
- Session-scoped tabs (no restore after quit).
- Local bookmarks, history, downloads, adblock, passwords (Windows secure storage in MVP).

### Non-goals (MVP)

- Accounts, cloud sync, server-side rendering, server-side routing decisions per request.
- Mobile app (architecture only).
- Extension store, uBlock-level adblock, custom crypto vault for passwords.

---

## 2. High-level system diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER DEVICE (Windows MVP)                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Electron Main Process                           │  │
│  │  • Window lifecycle, native menus, downloads                        │  │
│  │  • Session / partition management                                   │  │
│  │  • PAC install + proxy apply (session.setProxy)                     │  │
│  │  • Adblock webRequest hooks                                         │  │
│  │  • IPC router (typed, validated)                                    │  │
│  │  • PasswordService (Win Credential Manager)                         │  │
│  │  • Local stores: routes.json, bookmarks, history, settings          │  │
│  └───────────────┬───────────────────────────────┬───────────────────┘  │
│                  │ preload (contextBridge)        │                       │
│  ┌───────────────▼───────────────────────────────▼───────────────────┐  │
│  │              Renderer (React + Zustand) — Chrome UI only           │  │
│  │  Sidebar │ Tab bar │ Address bar │ Route badge │ Settings │ NTP    │  │
│  └───────────────┬───────────────────────────────────────────────────┘  │
│                  │ layout bounds / tab switch IPC                       │
│  ┌───────────────▼───────────────────────────────────────────────────┐  │
│  │     WebContentsView (per tab) OR BrowserView (legacy fallback)     │  │
│  │     • Loads web pages (youtube.com, etc.)                          │  │
│  │     • Separate from React renderer (no nodeIntegration)            │  │
│  │     • Guest autofill injection via preload-guest (optional phase)  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Packages: core-routing, core-adblock, core-passwords, shared-types…   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          proxy traffic only (MVP)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SERVER (read-only audit in Phase 8; no MVP changes without approval)   │
│  • SOCKS/HTTP proxy endpoint(s)                                         │
│  • Optional static routes.json / PAC URL (infrequent fetch)             │
│  • Health endpoint                                                        │
│  • Existing WireGuard + Telegram proxy — MUST NOT be modified           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Process model

### 3.1 Main process

**Responsibilities**

| Area | Owner |
|------|--------|
| `BrowserWindow` + **native titlebar** (MVP) | Main |
| Tab → `WebContentsView` map | Main |
| Bounds sync when window resizes | Main |
| `session.fromPartition('persist:alpha')` | Main |
| PAC generation + `session.setProxy({ pacScript })` | Main |
| `webRequest.onBeforeRequest` adblock | Main |
| Downloads (`session.on('will-download')`) | Main |
| Permission handlers (default deny) | Main |
| Credential storage IPC | Main |
| File I/O for routes, bookmarks, history | Main |

**Does NOT**

- Render React UI (except devtools in dev).
- Expose `require`/`process` to web content.
- Log passwords, form fields, or full URLs with credentials.

### 3.2 Preload (UI shell)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where compatible.
- Exposes `window.alpha` API via `contextBridge.exposeInMainWorld`.
- All IPC payloads validated with Zod (or similar) on both sides.
- Minimal surface: tabs, navigation, routing, settings, bookmarks, history, downloads, passwords (metadata only in renderer).

### 3.3 Renderer (React)

- Single-page app for **browser chrome only** (sidebar, tab bar, toolbar) plus **NTP UI**.
- Zustand store syncs tab state from main via `tabs:state-changed` IPC events.
- Tailwind + design tokens from `design-system.md`.
- **NTP is NOT a WebContentsView** — it is React in the chrome window when `tab.kind === 'ntp'`.
- External sites render only in `WebContentsView` below the toolbar (see §3.6).

### 3.4 WebContentsView strategy (recommended)

**Decision: prefer `WebContentsView` (Electron 30+) over embedded `<webview>`.**

| Approach | Pros | Cons |
|----------|------|------|
| **WebContentsView** | Official direction; better layering; no webview tag quirks | Requires manual bounds; Electron version floor |
| BrowserView | Mature API | Deprecated path; harder multi-tab |
| `<webview>` | Easy prototype | Security footguns; discouraged |

**Tab model**

1. One `WebContents` per tab, hosted in `WebContentsView` attached to main window `contentView`.
2. React renderer runs in a **separate** hidden or overlay `WebContents` for chrome, OR chrome is drawn in the same window with views stacked below the top chrome region.
3. **Recommended layout**: dedicated chrome `BrowserWindow` child area implemented as fixed pixel heights; `WebContentsView` instances positioned below tab bar + toolbar.

**Lifecycle**

- Create view on tab open; destroy on tab close.
- Switch tab = show/hide views (`setVisible`) + focus correct `webContents`.
- No persistence: on `before-quit`, do not save tab URLs.

### 3.5 Guest page preload (Phase 7+)

- Separate minimal preload for login forms: detect fields, show autofill UI overlay from main.
- Never expose Node to guest pages.

### 3.6 TabManager (Phase 2 — implemented)

**Location**: `apps/desktop-electron/src/main/tabs/TabManager.ts`

| Concern | Behavior |
|---------|----------|
| Tab types | `ntp` (no view) / `web` (`WebContentsView`) |
| Create | Default `ntp`; optional URL creates `web` + loads |
| Switch | `setVisible(true)` on active web view only |
| Close | `removeChildView` + `webContents.close()` |
| Navigate | NTP + URL → promotes tab to `web`, creates view |
| Layout | `getWebContentBounds()` — right of sidebar, below tab+toolbar |
| Crash | `render-process-gone` → destroy view, `crashed` flag, banner in renderer |
| Persistence | **None** — one NTP tab created in constructor; not restored after quit |

**Why NTP is separate from web content**

- NTP uses bundled React, assets, and search UX — no remote HTML in chrome `webContents`.
- Loading sites via `loadURL` on the chrome window (Phase 1 anti-pattern) mixed privileges and broke layout.
- `WebContentsView` isolates untrusted content with sandboxed guest `webContents`.

**IPC** (Zod-validated): `tabs:create|close|switch|navigate|getState|goBack|goForward|reload|stop`

### 3.7 Navigation state (Phase 3.5)

See [navigation.md](./navigation.md). Tab metadata (title, url, favicon, loading, history) flows main → renderer via `tabs:state-changed`. Favicons are session-only.

---

## 4. Session and profile model

```
persist:alpha-default     → default browsing profile (MVP: single profile)
persist:alpha-private     → reserved (future private mode)
```

- **Cookies / cache**: Chromium default under Electron userData.
- **Routing**: same session gets PAC; partition isolates storage if we add profiles later.
- **Downloads**: default path from settings in userData (JSON settings OK; not for passwords).

---

## 5. Internal URL scheme

| URL | Purpose |
|-----|---------|
| `alpha://newtab` | New Tab Page |
| `alpha://settings` | Settings (may be renderer-only route) |
| `alpha://downloads` | Downloads manager |
| `alpha://history` | History |
| `alpha://bookmarks` | Bookmarks |

Registered via `protocol.handle` in main process; loads bundled HTML or redirects to renderer route.

---

## 6. Monorepo layout

See project tree in repository root `README.md` (created Phase 1). Packages are **framework-agnostic TypeScript** where possible; Electron bindings live in `apps/desktop-electron`.

```
apps/desktop-electron     → Electron app, IPC, views
packages/shared-types     → RouteMode, IPC contracts
packages/core-routing     → resolver, PAC generator
packages/core-adblock     → blocklist, domain matcher
packages/core-passwords   → PasswordService + adapters
packages/core-bookmarks   → CRUD + storage interface
packages/core-history     → visit log
packages/core-downloads   → types + helpers
packages/shared-ui        → React components (Sidebar, RouteBadge, …)
```

---

## 6.1 Dev runtime (Windows-first)

Alpha is **Windows-first**. For UI polish (DPI/fonts, blur/transparency, drag & drop, WebContentsView bounds) run Electron **natively on Windows**.

Docs:

- `docs/windows-dev.md`
- `docs/dev-runtime.md`

---

## 7. IPC design

**Channels** (prefix `alpha:`):

- `tabs:*`, `nav:*`, `routing:*`, `settings:*`, `bookmarks:*`, `history:*`, `downloads:*`, `passwords:*`, `adblock:*`

**Rules**

1. Request/response via `ipcMain.handle` / `invoke`.
2. Events via `webContents.send` for tab updates, download progress, route changes.
3. JSON schema validation on every invoke args.
4. Password IPC returns never include plaintext in logs; renderer receives masked prompts only.

---

## 8. State and storage model

| Data | Storage | Encrypted |
|------|---------|-----------|
| routes.json | `%APPDATA%/Alpha Browser/routes.json` | No (no secrets) |
| settings.json | userData | No |
| bookmarks | `bookmarks.json` (electron-store) | No |
| history | `history.json` (electron-store) | No |
| saved groups | `saved-groups.json` (electron-store) | No |
| passwords | Windows Credential Manager | Yes (OS) |
| session tabs | Memory only | — |
| blocklist | Bundled + optional user update file | No |

**Prohibited for passwords**: plain JSON, localStorage, electron-store, server upload.

---

## 9. Routing integration (summary)

Detailed in `routing.md` (Phase 4 implemented).

- `@alpha/core-routing`: resolver, PAC generator, proxy validation.
- `RoutesStore` (electron-store `routes`) + `RoutingService` (session hints, temp overrides).
- `TabManager`: `did-fail-load` AUTO → PROXY fallback (one retry per tab+domain).
- `session.defaultSession.setProxy({ pacScript })` — **shared across all tabs** (MVP limitation).
- Renderer: route badge, popup, settings via `routing:*` IPC only.
- No server calls for routing decisions.

---

## 9.1 Embedded proxy client (Phase 4.9)

Detailed in `proxy-client.md`.

- `ProxyClientService` runs in **main** and exposes a **loopback-only SOCKS5** endpoint.
- Routing/PAC always uses `SOCKS5 127.0.0.1:<port>` (transport hidden behind the local endpoint).
- Browser state includes proxy connection snapshot for UI (`CONNECTED/CONNECTING/ERROR/...`).
- No OS-wide proxy, no user-imported configs.

---

## 9.2 sing-box runtime integration (Phase 4.10)

- Runtime modes: `IN_PROCESS_TEST` and `SING_BOX_LOCAL_TEST` (remote mode scaffold only).
- `SingBoxConfigBuilder` writes runtime config into `userData/alpha-proxy/runtime/`.
- `ProxyClientService` spawns `sing-box` if present; if missing → `ERROR` with reason `BINARY_MISSING` (no crash).

## 10. Adblock integration (summary)

See `adblock.md`. Main process cancels requests to blocked domains via `webRequest`.

---

## 10.2 Adblock (Phase 6)

- `@alpha/core-adblock`: lightweight matcher (domain/host/contains), no ABP syntax.
- Main `AdblockService`: `webRequest.onBeforeRequest` cancel + per-tab counters.
- UI: compact toggles in route popup (site override + global) and blocked counter.

## 10.1 Browser core (Phase 5)

- Bookmarks: local store + IPC + compact panel + toolbar ⭐ (`docs/bookmarks.md`)
- History: local store + sanitization/dedupe + compact panel (`docs/history.md`)
- Downloads: `will-download` lifecycle + shelf/panel (`docs/downloads.md`)

## 11. Password and autofill (summary)

See `passwords.md`. `PasswordService` in main; platform adapters behind interface.

---

## 12. Server model (summary)

See `server-audit-plan.md`. MVP client works offline with local `routes.json` and user-configured proxy endpoint.

---

## 13. Mobile future (summary)

See `mobile-future.md`. Shared packages compile for future React Native / native shell; Electron-specific code quarantined in app.

---

## 14. Security baseline

See `security.md`. Threat model: untrusted web content, malicious extensions (none in MVP), local malware reading password store.

---

## 15. Build and tooling

- **pnpm workspaces** + Turborepo (optional) for monorepo.
- **electron-vite** or custom Vite dual config (main/preload/renderer).
- TypeScript project references from apps to packages.
- ESLint + Prettier; electron-builder for Windows MSI/NSIS (Phase 1+).

---

## 16. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| WebContentsView API churn | Pin Electron LTS; abstraction `TabContentHost` |
| PAC + HTTPS CONNECT | Test SOCKS5; document limitations |
| AUTO detection false positives | User override + remember rule; conservative default |
| Win credential API complexity | Ship adapter early; feature flag |
| TG proxy conflict on server | Phase 8 read-only audit before any bind |
| Performance (many tabs) | Lazy create views; suspend background tabs (post-MVP) |

---

## 17. Open questions

1. **AUTO algorithm**: passive (curated list + latency) vs active probe? Legal/UX implications of probing blocked sites?
2. **Single vs split window chrome**: overlay React vs native title bar on Windows 11?
3. **Search engine default**: Google / DuckDuckGo / regional?
4. **SQLite vs JSON** for bookmarks/history in MVP?
5. **Electron minimum version** (30+ for WebContentsView)?
6. **Proxy auth**: embed in PAC or session login handler?
7. **Separate browser-only proxy port** on server — needs audit approval.

---

## 18. Phase mapping

| Phase | Deliverable |
|-------|-------------|
| 0 | This doc set |
| 1 | Monorepo + NTP window |
| 2 | Shell + navigation |
| 3 | Session groups + saved workspaces |
| 4 | Routing + PAC |
| 5 | Bookmarks/history/downloads |
| 6 | Adblock |
| 7 | Passwords/autofill |
| 8 | Server audit plan execution (read-only) |

---

## 19. Decision log

See [decisions.md](./decisions.md) for locked decisions (O-R1, D1–D9, O-P1).
