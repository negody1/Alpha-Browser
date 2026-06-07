import { useMemo, useState } from 'react';
import { Clock, Search, Trash2, X } from 'lucide-react';
import { FAVICON_FALLBACK_URL } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';

function bucketLabel(date: Date): 'today' | 'yesterday' | 'older' {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const t = date.getTime();
  if (t >= startToday) return 'today';
  if (t >= startYesterday) return 'yesterday';
  return 'older';
}

const LABELS: Record<'today' | 'yesterday' | 'older', string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  older: 'Ранее',
};

export function HistoryPanel({ embedded = false }: { embedded?: boolean }) {
  const open = useBrowserStore((s) => s.historyPanelOpen);
  const setOpen = useBrowserStore((s) => s.setHistoryPanelOpen);
  const items = useBrowserStore((s) => s.history);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q));

    const groups: Record<'today' | 'yesterday' | 'older', typeof filtered> = {
      today: [],
      yesterday: [],
      older: [],
    };

    for (const h of filtered) {
      const d = new Date(h.visitedAt);
      const b = bucketLabel(d);
      groups[b].push(h);
    }
    return groups;
  }, [items, query]);

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
    <aside className="side-panel" aria-label="История">
      <header className="side-panel-header">
        <div className="side-panel-title">
          <Clock size={16} />
          <h2>История</h2>
        </div>
        <button type="button" className="shell-icon-btn" aria-label="Закрыть" onClick={closePanel}>
          <X size={18} />
        </button>
      </header>

      <div className="side-panel-search">
        <Search size={16} className="side-panel-search-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск истории"
          spellCheck={false}
        />
        <button
          type="button"
          className="shell-icon-btn"
          title="Очистить историю"
          onClick={() => void window.alpha.history.clear()}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="side-panel-empty">История пока пустая.</p>
      ) : (
        <div className="side-panel-groups">
          {(Object.keys(grouped) as Array<keyof typeof grouped>).map((k) => {
            const arr = grouped[k];
            if (arr.length === 0) return null;
            return (
              <section key={k} className="side-panel-group">
                <h3 className="side-panel-group-title">{LABELS[k]}</h3>
                <ul className="side-panel-list">
                  {arr.map((h) => (
                    <li key={h.id}>
                      <div
                        className="side-panel-item"
                        role="button"
                        tabIndex={0}
                        onClick={() => void navigate(h.url)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void navigate(h.url);
                          }
                        }}
                      >
                        <img
                          className="side-panel-favicon"
                          src={h.favicon ?? FAVICON_FALLBACK_URL}
                          alt=""
                          width={16}
                          height={16}
                          onError={(e) => ((e.target as HTMLImageElement).src = FAVICON_FALLBACK_URL)}
                        />
                        <span className="side-panel-item-text">
                          <strong>{h.title}</strong>
                          <small>{h.url}</small>
                        </span>
                        <span className="side-panel-chip">{h.routeMode}</span>
                        <button
                          type="button"
                          className="workspace-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void window.alpha.history.delete(h.id);
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}

