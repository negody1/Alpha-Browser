import { useMemo, useState } from 'react';
import { Download, Folder, Search, Trash2, RotateCw, Play, X } from 'lucide-react';
import { useBrowserStore } from '../store/tabsStore';

function bucketLabel(date: Date): 'recent' | 'older' {
  const now = Date.now();
  const t = date.getTime();
  if (now - t < 3 * 24 * 60 * 60 * 1000) return 'recent';
  return 'older';
}

const LABELS: Record<'recent' | 'older', string> = {
  recent: 'Недавние',
  older: 'Ранее',
};

export function DownloadsPanel() {
  const open = useBrowserStore((s) => s.downloadsPanelOpen);
  const setOpen = useBrowserStore((s) => s.setDownloadsPanelOpen);
  const setShelfOpen = useBrowserStore((s) => s.setDownloadsShelfOpen);
  const items = useBrowserStore((s) => s.downloads);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((d) => d.filename.toLowerCase().includes(q) || d.url.toLowerCase().includes(q));

    const groups: Record<'recent' | 'older', typeof filtered> = { recent: [], older: [] };
    for (const d of filtered) {
      const dt = new Date(d.startedAt);
      groups[bucketLabel(dt)].push(d);
    }
    return groups;
  }, [items, query]);

  if (!open) return null;

  return (
    <aside className="side-panel" aria-label="Загрузки">
      <header className="side-panel-header">
        <div className="side-panel-title">
          <Download size={16} />
          <h2>Загрузки</h2>
        </div>
        <button
          type="button"
          className="shell-icon-btn"
          aria-label="Закрыть"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X size={18} />
        </button>
      </header>

      <div className="side-panel-search">
        <Search size={16} className="side-panel-search-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск загрузок"
          spellCheck={false}
        />
        <button
          type="button"
          className="shell-icon-btn"
          title="Очистить завершённые"
          onClick={() => void window.alpha.downloads.clearCompleted()}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="side-panel-empty">Пока нет загрузок.</p>
      ) : (
        <div className="side-panel-groups">
          {(Object.keys(grouped) as Array<keyof typeof grouped>).map((k) => {
            const arr = grouped[k];
            if (arr.length === 0) return null;
            return (
              <section key={k} className="side-panel-group">
                <h3 className="side-panel-group-title">{LABELS[k]}</h3>
                <ul className="side-panel-list">
                  {arr.map((d) => (
                    <li key={d.id}>
                      <div className="downloads-row">
                        <button
                          type="button"
                          className="side-panel-item downloads-row-main"
                          onClick={() => {
                            setShelfOpen(true);
                          }}
                        >
                          <span className="downloads-row-name" title={d.filename}>
                            <strong>{d.filename}</strong>
                            <small>{d.url}</small>
                          </span>
                          <span className="side-panel-chip">{d.status}</span>
                        </button>
                        <div className="downloads-row-actions">
                          {d.status === 'interrupted' && d.canResume && (
                            <button type="button" className="shell-icon-btn" title="Продолжить" onClick={() => void window.alpha.downloads.resume(d.id)}>
                              <Play size={16} />
                            </button>
                          )}
                          {(d.status === 'failed' || (d.status === 'interrupted' && !d.canResume)) && (
                            <button type="button" className="shell-icon-btn" title="Повторить" onClick={() => void window.alpha.downloads.retry(d.id)}>
                              <RotateCw size={16} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="shell-icon-btn"
                            title="Показать в папке"
                            disabled={!d.savePath}
                            onClick={() => void window.alpha.downloads.showInFolder(d.id)}
                          >
                            <Folder size={16} />
                          </button>
                          <button type="button" className="shell-icon-btn" title="Убрать из списка" onClick={() => void window.alpha.downloads.remove(d.id)}>
                            <X size={16} />
                          </button>
                        </div>
                        <div className="downloads-row-progress">
                          <div className="downloads-row-progress-bar" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                        </div>
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

