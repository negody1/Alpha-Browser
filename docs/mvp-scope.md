# Alpha Browser — MVP Scope

> Single source of truth for what ships in v0.1 MVP.

## 1. Product summary

**Alpha Browser** — Windows desktop browser with premium dark UI and local smart routing (DIRECT / PROXY / AUTO). Not a VPN client. Not a remote browser. No accounts.

---

## 2. Platform

| Item | MVP |
|------|-----|
| OS | Windows 10/11 x64 |
| macOS / Linux | Not supported (stubs only for passwords) |
| Mobile | Not shipped |

---

## 3. Feature checklist

| # | Feature | Status target |
|---|---------|---------------|
| 1 | App launch | Phase 1 |
| 2 | Alpha New Tab Page | Phase 1–2 (chrome UI) |
| 3 | Navigate URL / search | Phase 2 |
| 3.5 | Navigation state, favicons, loading UX | Phase 3.5 |
| 4 | Tabs create/close/switch | Phase 2 |
| 5 | Session groups + saved workspaces | Phase 3 |
| 6 | Tabs NOT restored after quit | Phase 2–3 |
| 7 | Bookmarks add/list/delete | Phase 5 |
| 8 | History list + clear | Phase 5 |
| 9 | Downloads + downloads screen | Phase 5 |
| 10 | Routing AUTO/DIRECT/PROXY | Phase 4 ✓ |
| 11 | routes.json + PAC | Phase 4 ✓ |
| 12 | Route badge + popup | Phase 4 ✓ |
| 13 | Remember domain rule | Phase 4 ✓ |
| 14 | Temp route override | Phase 4 ✓ |
| 15 | Adblock domain blocklist | Phase 6 ✓ |
| 16 | Adblock toggle + counter | Phase 6 ✓ |
| 17 | PasswordService + Win storage | Phase 7 |
| 18 | Autofill architecture + save prompt | Phase 7 |
| 19 | Settings screens | Phases 4–7 |
| 20 | Server audit (read-only) | Phase 8 |

---

## 4. Explicit exclusions

- User accounts, registration, login to Alpha
- Cloud sync (bookmarks, tabs, passwords)
- Session restore / reopen tabs after restart
- Extension store
- Full uBlock / cosmetic adblock
- Custom encrypted password vault (use OS store)
- Server-side browsing or rendering
- Server-side per-request routing
- Storing user data on server
- Mobile apps
- Modifying WireGuard / TG proxy without approval
- Deploy/restart/prune on server

---

## 5. Data retention

| Data | Persists after quit? |
|------|----------------------|
| Open tabs | **No** |
| Session groups | **No** |
| Saved workspaces (`saved-groups.json`) | **Yes** |
| Bookmarks | Yes (local) |
| History | Yes (local) |
| Passwords | Yes (OS store) |
| routes.json | Yes |
| Settings | Yes |
| Adblock counter | Session only (reset OK) |

---

## 6. Server role in MVP

- Optional proxy endpoint (user-configured)
- Optional static config URL
- Health check
- **No** user data collection

---

## 7. Quality bar for release

- [ ] App installs and launches on clean Windows VM
- [ ] Can browse HTTPS sites
- [ ] Routing PROXY/DIRECT verified with test proxy
- [ ] Passwords absent from JSON/localStorage
- [ ] `pnpm audit` no critical unfixed
- [ ] Electron security checklist (see security.md)
- [ ] Existing server TG/WG untouched (audit report signed)

---

## 8. Success metrics (internal)

- Cold start < 3s on mid-range PC
- Tab switch < 100ms perceived
- PAC regen < 50ms for 100 rules
- Zero password leaks in logs (manual QA)

---

## 9. Post-MVP backlog (prioritized)

1. macOS/Linux password adapters
2. Per-tab routing partitions
3. EasyList domain subscription
4. Auto-update + code signing
5. Private browsing mode
6. Import bookmarks from Chrome

---

## 10. Document map

| Doc | Topic |
|-----|-------|
| architecture.md | System design |
| security.md | Hardening |
| routing.md | PAC and rules |
| passwords.md | Credential storage |
| adblock.md | Blocking |
| mobile-future.md | Mobile runway |
| server-audit-plan.md | Server read-only audit |
| design-system.md | UI tokens |
| groups.md | Session vs saved groups |
| navigation.md | Tab sync, favicons, loading |
