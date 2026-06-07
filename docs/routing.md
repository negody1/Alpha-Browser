# Alpha Browser — Routing (Phase 4)

> Local routing engine, PAC generation, AUTO fallback, and UI. **No server involvement.**

## 1. Route modes

| Mode | Behavior |
|------|----------|
| `AUTO` | PAC uses DIRECT by default; session hint or fallback may send domain to PROXY |
| `DIRECT` | Always DIRECT for matching hosts in PAC |
| `PROXY` | Always PROXY for matching hosts in PAC |
| `ERROR` | Badge only: PROXY requested but endpoint unreachable |

## 2. Precedence (highest first)

1. **Temporary override** — user choice in route popup (session only, not persisted).
2. **Saved domain rule** — `routes.json` / electron-store `routes`.
3. **Session hint** — after AUTO network failure → successful PROXY reload (cleared on quit).
4. **Default route** — `defaultRoute` (MVP default: `AUTO` → effective DIRECT until hint).

Manual DIRECT/PROXY in popup overrides AUTO for that domain for the session.

## 3. AUTO fallback flow

1. New site loads with **DIRECT** (no PAC entry until hint/rule/override).
2. Main-frame `did-fail-load` with retryable Chromium error:
   - `ERR_CONNECTION_TIMED_OUT`, `ERR_CONNECTION_RESET`, `ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`, `ERR_TUNNEL_CONNECTION_FAILED`, etc.
3. If route allows AUTO fallback (not manual DIRECT rule/override, not already on PROXY):
   - Set **session hint** `domain → PROXY`
   - Regenerate PAC, reload tab (max **one** attempt per `tabId:domain`)
4. On success → banner: «Сайт лучше работает через прокси. Запомнить?»
5. User confirms → `routing:saveCurrentRouteAsRule` → persistent rule in store.

**No infinite retry:** `navFallbackKeys` in `TabManager` blocks second AUTO fallback for same tab+domain.

## 4. Storage

**Path (Windows):** `%APPDATA%/Alpha Browser/routes.json` (via `electron-store`, name `routes`).

```json
{
  "version": 1,
  "defaultRoute": "AUTO",
  "proxyEndpoints": {
    "PROXY_MAIN": "SOCKS5 127.0.0.1:1080"
  },
  "rules": [
    {
      "domain": "example.com",
      "route": "PROXY",
      "createdAt": "2026-05-27T12:00:00.000Z",
      "updatedAt": "2026-05-27T12:00:00.000Z"
    }
  ]
}
```

- Domains only (no full URLs, no query strings).
- Session hints and temporary overrides are **memory only**.
- Rules are **never** sent to a server.

## 5. Package `@alpha/core-routing`

| API | Role |
|-----|------|
| `normalizeDomain` | Strip protocol/www; eTLD+1 for matching |
| `matchDomainRule` | Longest domain rule win |
| `resolveRouteForUrl` / `resolveRouteForHost` | Precedence + ERROR if proxy down |
| `generatePacScript` | Inline PAC for `session.setProxy` |
| `validateProxyEndpoint` | HTTP/SOCKS formats; reject embedded credentials |
| `isRetryableNetworkError` | AUTO fallback gate |

## 6. PAC (session-level)

- Generated in main process from rules + session hints + temporary overrides.
- Applied: `session.defaultSession.setProxy({ mode: 'pac_script', pacScript })`.
- **Limitation:** one PAC per Electron session → **all tabs share the same proxy map**. Per-tab routing needs partitions (post-MVP).
- Regenerated on: rule change, proxy endpoint change, hint/override change, startup.
- No per-request IPC from PAC; no server-side PAC in MVP.

Default PAC tail: `return "DIRECT"` for hosts without explicit entries (AUTO direct-first).

## 7. Main process

- `RoutesStore` — persisted config.
- `RoutingService` — hints, overrides, PAC apply, proxy TCP probe.
- `TabManager` — `did-fail-load` fallback, tab snapshots with `routeMode` / `routeSource` / `domain`.

## 8. IPC (Zod-validated)

`routing:getState`, `getRules`, `setDefaultRoute`, `setProxyEndpoint`, `addRule`, `updateRule`, `deleteRule`, `setTemporaryOverride`, `clearTemporaryOverride`, `saveCurrentRouteAsRule`, `reloadPac`, `confirmReload`, `dismissRemember`, `dismissReload`, `openDirectFallback`.

Renderer uses `window.alpha.routing.*` only (no filesystem access).

## 9. UI

- **Route badge** (toolbar): AUTO / DIRECT / PROXY / ERROR; click → popup.
- **Route popup:** mode per site, «Запомнить для сайта», link to settings.
- **Banners:** remember PROXY; reload after route change; ERROR → «Открыть напрямую».
- **Routing settings** (sidebar): default route, proxy endpoint, rules table.

## 10. Security

- No proxy URLs with embedded `user:pass@`.
- No logging full URLs with query params.
- Routing only for `http://` / `https://` (see navigation policy).
- Proxy auth deferred.

## 11. Testing

- Unit: `packages/core-routing/src/index.test.ts` (vitest).
- Manual: AUTO direct-first, saved PROXY rule, override, badge on tab switch, invalid proxy rejected, no fallback loop.

## 12. Known limitations

| Item | Note |
|------|------|
| Shared PAC | All tabs same proxy map until partitions |
| Session hints | Lost on quit |
| AUTO probe | Reactive (on load failure), not pre-probe |
| Proxy health | TCP connect to host:port only |
