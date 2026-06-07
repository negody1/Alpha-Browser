# Alpha Browser — Confirmed Decisions

> Locked by product owner. Update only with explicit approval.

| ID | Decision | Value |
|----|----------|-------|
| O-R1 | AUTO fail-open base | **DIRECT first** |
| O-R1a | AUTO fallback | If DIRECT fails → **PROXY**; cache per host for **session**; optionally suggest save rule |
| O-R2 | Per-tab routing | **Postponed** after MVP |
| D1 | Tab content host | **WebContentsView** |
| D2 | Monorepo | **pnpm workspaces** |
| D3 | Styling | **Tailwind** + design tokens |
| D4 | Local persistence (MVP) | **JSON / electron-store** for bookmarks, history, settings, routes — **SQLite postponed** |
| D5 | Default search | **Google** (`https://www.google.com/search?q=`) |
| D6 | Window chrome | **Native titlebar** in MVP; custom frameless **deferred** |
| D7 | Default proxy placeholder | `SOCKS5 127.0.0.1:1080` |
| O-P1 | Password storage | **`SecretStorageProvider` abstraction first**; no hard keytar spread across app |
| D8 | Product name / CredMan | **Alpha Browser** |
| D9 | Server audit | **Phase 8 only** after approval |

## AUTO algorithm (normative)

For host `H` when effective mode is `AUTO` and no explicit rule/temp override:

1. If session cache has result for `H` → use cached `DIRECT` or `PROXY`.
2. Else attempt **DIRECT** (connectivity probe / navigation outcome — implementation in Phase 4).
3. If DIRECT fails within timeout → use **PROXY** (`PROXY_MAIN`).
4. Cache result in **session memory only** (cleared on app quit).
5. Optionally prompt: “Save PROXY rule for `H`?” (user confirms).

Explicit domain rules always beat AUTO heuristic.

## Storage layout (MVP)

```
%APPDATA%/Alpha Browser/
  routes.json
  bookmarks.json
  history.json
  settings.json
```

Passwords: **never** in above files — `SecretStorageProvider` only.
