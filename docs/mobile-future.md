# Alpha Browser — Mobile Future

> Architectural runway without MVP implementation.

## 1. Strategy

Mobile is **not** in MVP. Desktop Electron ships first. Shared TypeScript packages maximize reuse; platform shells differ.

```
packages/
  core-routing      → 100% shared logic
  core-adblock      → shared domain engine; hooks differ
  core-passwords    → interface + adapters per OS
  core-bookmarks    → shared
  core-history      → shared
  shared-types      → shared
  shared-ui         → React components (web + potential RN Web)

apps/
  desktop-electron  → MVP
  mobile-ios        → future (placeholder)
  mobile-android    → future (placeholder)
```

---

## 2. Desktop vs mobile responsibilities

| Concern | Desktop (Electron) | Mobile (future) |
|---------|-------------------|-----------------|
| Tab UI | WebContentsView | WKWebView / Android WebView |
| Routing | PAC + session.setProxy | System VPN/Proxy profile or local SOCKS |
| Adblock | webRequest | WKContentRuleList / WebView interceptor |
| Passwords | Win CredMan | Keychain / Keystore |
| Downloads | Electron API | Platform download manager |

---

## 3. Routing on mobile

- PAC may not apply to system WebView the same way.
- Options:
  - **On-device SOCKS** + loopback proxy (complex)
  - **Per-app VPN** (user-visible; marketing care)
  - **Split tunnel** via OS APIs (platform-specific)

`core-routing` resolver and rules JSON remain; **platform bridge** applies `ResolvedRoute`.

---

## 4. UI reuse

- Design tokens from `design-system.md` as JSON/CSS variables.
- `shared-ui` components written **headless-friendly** where possible (logic in hooks, styles swappable).
- Do not import Electron in `shared-ui`.

---

## 5. Sync (explicitly out of scope)

No cloud sync in MVP or initial mobile. If added later:

- E2E encrypted sync separate from routing server.
- Never sync via proxy server.

---

## 6. Repository conventions

- `import 'electron'` only under `apps/desktop-electron`.
- Packages use dependency injection for `StoragePort`, `NetworkPort`.

---

## 7. MVP actions for mobile readiness

1. Define `StoragePort`, `CredentialPort`, `ProxyPort` interfaces in `shared-types`.
2. Keep domain logic pure in `core-*`.
3. Document breaking changes in CHANGELOG when ports evolve.

---

## 8. Open questions

- O-M1: React Native vs native Swift/Kotlin shells?
- O-M2: iOS Network Extension entitlement timeline?
