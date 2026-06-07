import { useEffect, useMemo, useState } from 'react';
import type { HistoryEntry } from '@alpha/shared-types';
import { FAVICON_FALLBACK_URL } from '@alpha/shared-types';
import { PanelChrome } from './PanelChrome';

export function HistoryOverlay() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    void window.alpha.tabs.getState().then((s) => setActiveTabId(s.activeTabId));
    void window.alpha.history.list().then(setItems);
    const unsub = window.alpha.history.onChanged(() => {
      void window.alpha.history.list().then(setItems);
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q),
    );
  }, [items, query]);

  function close() {
    void window.alpha.overlay.closePanel();
  }

  async function navigate(url: string) {
    if (!activeTabId) return;
    await window.alpha.tabs.navigate(activeTabId, url);
    close();
  }

  return (
    <PanelChrome title="История" onClose={close}>
      <div className="overlay-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск…"
          spellCheck={false}
        />
      </div>
      <ul className="overlay-list">
        {filtered.slice(0, 80).map((h) => (
          <li key={h.id}>
            <button type="button" className="overlay-list-item" onClick={() => void navigate(h.url)}>
              <img src={h.favicon ?? FAVICON_FALLBACK_URL} alt="" width={16} height={16} />
              <span className="overlay-list-item-text">
                <strong>{h.title}</strong>
                <small>{h.url}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </PanelChrome>
  );
}
