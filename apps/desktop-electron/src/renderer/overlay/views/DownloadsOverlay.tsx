import { useEffect, useState } from 'react';
import type { DownloadItemSnapshot } from '@alpha/shared-types';
import { PanelChrome } from './PanelChrome';

export function DownloadsOverlay() {
  const [items, setItems] = useState<DownloadItemSnapshot[]>([]);

  useEffect(() => {
    void window.alpha.downloads.list().then(setItems);
    return window.alpha.downloads.onChanged(() => {
      void window.alpha.downloads.list().then(setItems);
    });
  }, []);

  function close() {
    void window.alpha.overlay.closePanel();
  }

  return (
    <PanelChrome title="Загрузки" onClose={close}>
      {items.length === 0 ? (
        <p className="overlay-hint">Загрузок пока нет.</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              className="overlay-btn"
              onClick={() => void window.alpha.downloads.clearCompleted()}
            >
              Очистить завершённые
            </button>
          </div>
          <ul className="overlay-list">
            {items.map((d) => (
              <li key={d.id}>
                <div className="overlay-list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="overlay-list-item-text">
                      <strong>{d.filename}</strong>
                      <small>{d.status}</small>
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {d.savePath && (
                        <button
                          type="button"
                          className="overlay-btn"
                          title="Показать в папке"
                          onClick={() => void window.alpha.downloads.showInFolder(d.id)}
                        >
                          📁
                        </button>
                      )}
                      <button
                        type="button"
                        className="overlay-btn"
                        title="Убрать"
                        onClick={() => void window.alpha.downloads.remove(d.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      height: 3,
                      marginTop: 6,
                      borderRadius: 2,
                      background: 'rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round(d.progress * 100)}%`,
                        background: 'var(--overlay-accent)',
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelChrome>
  );
}
