import { useMemo, useState } from 'react';
import { Plus, Search, Star, X } from 'lucide-react';
import { FAVICON_FALLBACK_URL } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';

export function BookmarksPanel({ embedded = false }: { embedded?: boolean }) {
  const open = useBrowserStore((s) => s.bookmarksPanelOpen);
  const setOpen = useBrowserStore((s) => s.setBookmarksPanelOpen);
  const bookmarks = useBrowserStore((s) => s.bookmarks);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q),
    );
  }, [bookmarks, query]);

  if (!open && !embedded) return null;

  function closePanel() {
    if (embedded) {
      void window.alpha.overlay.closePanel();
      return;
    }
    setOpen(false);
  }

  async function navigate(url: string) {
    if (!activeTabId) return;
    await window.alpha.tabs.navigate(activeTabId, url);
    closePanel();
  }

  return (
    <aside className="side-panel" aria-label="Закладки">
      <header className="side-panel-header">
        <div className="side-panel-title">
          <Star size={16} />
          <h2>Закладки</h2>
        </div>
        <button type="button" className="shell-icon-btn" aria-label="Закрыть" onClick={() => closePanel()}>
          <X size={18} />
        </button>
      </header>

      <div className="side-panel-search">
        <Search size={16} className="side-panel-search-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск закладок"
          spellCheck={false}
        />
        <button type="button" className="shell-icon-btn" disabled title="Скоро">
          <Plus size={16} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="side-panel-empty">Пока нет закладок.</p>
      ) : (
        <ul className="side-panel-list">
          {filtered.map((b) => (
            <li key={b.id}>
              <div
                className="side-panel-item"
                role="button"
                tabIndex={0}
                onClick={() => void navigate(b.url)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void navigate(b.url);
                  }
                }}
              >
                <img
                  className="side-panel-favicon"
                  src={b.favicon ?? FAVICON_FALLBACK_URL}
                  alt=""
                  width={16}
                  height={16}
                  onError={(e) => ((e.target as HTMLImageElement).src = FAVICON_FALLBACK_URL)}
                />
                <span className="side-panel-item-text">
                  <strong>{b.title}</strong>
                  <small>{b.url}</small>
                </span>
                <button
                  type="button"
                  className="workspace-link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void window.alpha.bookmarks.delete(b.id);
                  }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

