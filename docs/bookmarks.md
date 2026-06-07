## Alpha Browser — Bookmarks (Phase 5)

Local-first bookmarks with premium compact UX.

### Data model

- `BookmarkFolder`: `id`, `title`, `parentId`
- `Bookmark`: `id`, `title`, `url`, `favicon`, `createdAt`, `folderId`

### Storage

- Local only (electron-store): `bookmarks.json` in `userData`
- No cookies/auth state, no cloud/sync.

### Dedupe

- `upsertBookmark(url)` dedupes by exact URL.
- `updateBookmark()` merges if URL collides with another bookmark.

### UX

- Toolbar ⭐ toggles current page bookmark.
- Sidebar “Закладки” opens compact panel with search and quick delete.
- (Folders/edit popup: post-Phase 5B extension.)

