## Alpha Browser — Downloads (Phase 5B)

Chrome-like downloads shelf + local downloads list.

### Data model

`DownloadItemSnapshot`:
- `id`, `url`, `filename`
- `mimeType`
- `totalBytes`, `receivedBytes`, `progress`
- `status`: `pending | downloading | paused | interrupted | completed | failed | cancelled`
- `canResume`
- `savePath`
- `startedAt`, `completedAt`
- `error`
- `routeMode`, `domain` (routing-aware)

### Storage

- Local only (electron-store): `downloads.json` in `userData`
- Entries can be removed from list without deleting the physical file.

### Electron integration

- Uses `session.defaultSession.on('will-download')` in main.
- Main selects safe save path, updates progress, and emits `downloads:changed`.

### Resume / retry behavior

- If Electron reports `item.canResume()` and state is `interrupted` → UI shows **“Продолжить”** → calls `resume()`.
- If resume isn’t available → UI shows **“Повторить”** (new download from same URL).

### Shelf UX

- Auto-opens on download start.
- Shows last few items, live progress, and quick actions.
- Full “Загрузки” panel for list/search/clear completed.

### Security restrictions

- No auto-open, no auto-run.
- Renderer has no filesystem access; open file/folder is main-only via IPC.
- Filename sanitization + path traversal prevention (basename + illegal char replace).
- Dangerous extensions (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.scr`, `.jar`) require a UI confirmation before opening.

### Routing/PAC integration

- Downloads use the same Electron session and PAC routing as page traffic (DIRECT/PROXY/AUTO).
- Snapshot stores `routeMode` at start for diagnostics/UI.

