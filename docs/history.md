## Alpha Browser — History (Phase 5)

Local browsing history with grouping and privacy-oriented sanitization.

### Data model

`HistoryEntry`:
- `id`, `title`, `url`, `favicon`, `visitedAt`, `routeMode`

### Storage

- Local only (electron-store): `history.json` in `userData`
- No form data, no passwords, no server upload.

### Sanitization

Implemented in `@alpha/core-history`:
- Allow only `http(s)`
- Drop fragments
- Drop query if it looks sensitive (`token`, `code`, etc.) or too long

### Dedupe / throttle

- If the same URL is visited repeatedly within 30s, update the top entry instead of adding a new one.

### UX

- Sidebar “История” panel:
  - search
  - grouped: today / yesterday / older
  - delete item / clear
  - shows `routeMode` chip (routing-aware)

