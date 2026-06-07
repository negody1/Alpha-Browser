# Alpha Browser — Navigation State (Phase 3.5)

> Foundation for Phase 4 routing UX. Session-only tab metadata.

## 1. TabSnapshot (renderer sync)

```typescript
TabSnapshot {
  id, kind, title, url,
  favicon: string | null,   // runtime only
  isActive, isLoading,
  canGoBack, canGoForward,
  crashed?, sessionGroupId
}
```

Updates pushed via `tabs:state-changed` IPC (full snapshot).

**Not persisted**: favicon, loading, history flags, titles in workspace JSON.

---

## 2. Main → renderer lifecycle

```
WebContentsView event
  → TabManager updates TabEntry
  → emitState()
  → chromeWebContents.send('tabs:state-changed')
  → preload onStateChanged
  → Zustand setFromMain
  → React re-render
```

### Events wired

| Event | Updates |
|-------|---------|
| `did-start-loading` | `isLoading=true`, clear favicon |
| `did-stop-loading` | `isLoading=false`, back/forward flags |
| `did-navigate` | `url`, navigation flags |
| `did-navigate-in-page` | `url` (SPA), navigation flags |
| `page-title-updated` | `title` |
| `page-favicon-updated` | `favicon` |
| `did-fail-load` | `loadFailed`, title error |
| `render-process-gone` | `crashed`, destroy view |

---

## 3. Favicon flow

1. Chromium fires `page-favicon-updated` with candidate URLs.
2. `pickFaviconUrl()` accepts `https?://` or `data:image/*` (display only).
3. Renderer `<img src={favicon}>` with `onError` → `/branding/favicon-fallback.png` (Alpha logo).
4. NTP tabs always use fallback logo.
5. Favicon cleared on `did-start-loading` until page provides a new one.

**Security**: favicon URLs are never passed to `loadURL` or navigation.

---

## 4. Loading UX

| Location | Behavior |
|----------|----------|
| Active tab | Spinner replaces favicon in tab strip |
| Toolbar | Spinner on stop button; accent line under toolbar |
| Content area | Thin top progress bar (2px, accent) |
| New web tab | `shell-tab-skeleton` dimmed title until title changes |

Stop → `tabs:stop`. Reload replaces spinner when idle.

---

## 5. Address bar sync

- Displays active tab `url` (not internal `alpha://`).
- Updates on `did-navigate` and `did-navigate-in-page` (SPA).
- While input is **focused**, URL is not overwritten (user can edit).
- On blur, resyncs from main state.

---

## 6. window.open

`setWindowOpenHandler` → `createTab(url)` with full `wireWebContents` (favicon/title/loading).

---

## 7. Assets

Visual source of truth: `assets/` (synced from branding package).

- `assets/branding/logo.png`, `favicon-fallback.png`, `app-icon.png`
- `assets/wallpapers/background.png`
- `assets/ui-reference/main-ui.png`

Copied to `apps/desktop-electron/resources/public/` for runtime.

---

## 8. Phase 4 readiness

Route badge will read `TabSnapshot.url` host + future `routeMode` without changing navigation pipeline.
