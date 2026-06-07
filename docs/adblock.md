# Alpha Browser — AdBlock (Phase 6)

Lightweight, browser-native network blocking in **main** process. No uBlock clone, no cosmetic filtering.

## 1. Goals / non-goals

### Goals

- Block requests in network layer (`webRequest`) with minimal overhead.
- Compact UX: quick toggle + per-tab counter.
- Routing-aware coexistence: must not break PAC/proxy/downloads.

### Non-goals (MVP)

- Full ABP/uBlock syntax parsing.
- Cosmetic filters / DOM hiding / injections.
- Remote subscriptions auto-update.

---

## 2. Filter model (Alpha-specific)

Supported rules (plain text). The separator may be `:` or `=` (the parser is
tolerant of `contains=` style typos):

- `domain:example.com` — block domain + subdomains
- `host:ads.example.com` — block host + its subdomains
- `contains:/ads/` — URL substring match (lowercased)

Comments:
- `# ...` or `// ...`

Bundled list:
- canonical source: `packages/core-adblock/assets/default-ads.txt`
- MVP scope: well-known ad networks (`domain:`) + analytics endpoints of
  otherwise-legit sites scoped with `host:` (e.g. `host:mc.yandex.ru`,
  `host:connect.facebook.net`) so the parent site (`yandex.ru`, `facebook.com`)
  is never taken down. No cosmetic / ABP filtering.

User rules:
- stored locally (same format), applied after bundled list

### Filter loading (dev vs packaged)

`AdblockService.reloadRules()` tries candidate paths and uses the first that
exists, so the list never silently disappears in production:

1. Packaged: `<process.resourcesPath>/adblock/default-ads.txt` — shipped via
   `electron-builder.yml` `extraResources` (`from: ../../packages/core-adblock/assets`).
2. Dev: workspace path relative to `apps/desktop-electron/out/main`.

If no list is found a warning is logged and the engine stays near-empty (custom
rules only).

---

## 3. `@alpha/core-adblock`

Key pieces:

- `AdblockEngine` — in-memory matcher: Sets for domains/hosts + `urlContains[]`
- small decision cache (host/type/url prefix) to reduce per-request overhead
- never blocks `mainFrame` by default to reduce “site doesn’t open” failures

---

## 4. Electron integration (main only)

`webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] })` is attached
to **every Route Partition session** (P1): both `DIRECT` (`defaultSession`) and
`PROXY` (`persist:alpha-proxy`). Registration is idempotent per session. A given
request fires `onBeforeRequest` in exactly one session, so counters are never
double-counted across partitions, and blocking works identically on DIRECT and
PROXY tabs (interception happens before egress to the SOCKS/Reality tunnel).

Priority:

1. **site disable override**
2. **global enabled**
3. default enabled

Counters:
- global blocked total (`blockedTotal`) — lifetime, monotonic
- per-tab blocked count (`blockedByTabId`), mapped by `webContentsId → tabId`.
  The key is the **stable `tabId`**, so a tab's counter survives a DIRECT↔PROXY
  migration (which creates a new `WebContentsView`/`webContentsId`).
- on tab close, `TabManager.closeTab` calls `resetCountersForTab(tabId)` so
  closed tabs do not leak entries in `blockedByTabId`. `blockedTotal` is kept.

---

## 5. Downloads / routing interaction

- Adblock runs before request; PAC/routing remains unchanged.
- Downloads are handled in main (`will-download`) and should keep working through DIRECT/PROXY/AUTO.
- Current MVP engine avoids blocking `mainFrame` by default.

---

## 6. UI / UX

Quick controls live in **route popup**:

- **AdBlock**
  - “Включён”
  - “Отключить на сайте” (toggle)
  - “Выключить полностью” (global toggle)

Per-tab counter is shown in the popup.

---

## 7. Performance strategy

- O(1) set checks for domains/hosts.
- substring checks only for small `urlContains` list.
- small cache to avoid repeated work on hot hosts.

---

## 8. Manual checks

- DIRECT tab: blocked counter increases on ad-heavy sites (e.g. requests to
  `doubleclick.net` / `google-analytics.com` are cancelled).
- PROXY tab: same blocking works on a tab living in `persist:alpha-proxy`.
- Migrate a tab DIRECT→PROXY: the per-tab counter is preserved (not reset to 0,
  no stale value tied to the old `webContentsId`).
- Close a tab: its entry disappears from `blockedByTabId`; `blockedTotal` stays.
- “Отключить на сайте” unbreaks a site quickly.
- Downloads shelf still works; downloads through PROXY still work.

