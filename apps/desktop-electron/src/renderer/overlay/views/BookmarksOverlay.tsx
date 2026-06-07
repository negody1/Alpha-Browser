import { useEffect, useMemo, useState } from 'react';
import type { Bookmark } from '@alpha/shared-types';
import { FAVICON_FALLBACK_URL } from '@alpha/shared-types';
import { PanelChrome } from './PanelChrome';

export function BookmarksOverlay() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState('');
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    void window.alpha.tabs.getState().then((s) => setActiveTabId(s.activeTabId));
    void window.alpha.bookmarks.list().then(({ bookmarks: b }) => setBookmarks(b));
    const unsub = window.alpha.bookmarks.onChanged(() => {
      void window.alpha.bookmarks.list().then(({ bookmarks: b }) => setBookmarks(b));
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q),
    );
  }, [bookmarks, query]);

  function close() {
    void window.alpha.overlay.closePanel();
  }

  async function navigate(url: string) {
    if (!activeTabId) return;
    await window.alpha.tabs.navigate(activeTabId, url);
    close();
  }

  return (
    <PanelChrome title="Закладки" onClose={close}>
      <div className="overlay-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск…"
          spellCheck={false}
        />
      </div>
      <ul className="overlay-list">
        {filtered.map((b) => (
          <li key={b.id}>
            <button type="button" className="overlay-list-item" onClick={() => void navigate(b.url)}>
              <img src={b.favicon ?? FAVICON_FALLBACK_URL} alt="" width={16} height={16} />
              <span className="overlay-list-item-text">
                <strong>{b.title}</strong>
                <small>{b.url}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </PanelChrome>
  );
}
