import { useMemo, useState } from 'react';
import { Folder, X, RotateCw, Play, AlertTriangle } from 'lucide-react';
import { useBrowserStore } from '../store/tabsStore';

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function statusText(status: string, canResume: boolean): string {
  if (status === 'downloading') return 'Загрузка…';
  if (status === 'paused') return 'Пауза';
  if (status === 'interrupted') return canResume ? 'Прервана · можно продолжить' : 'Прервана · можно скачать заново';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменено';
  if (status === 'completed') return 'Готово';
  return '';
}

export function DownloadsShelf() {
  const open = useBrowserStore((s) => s.downloadsShelfOpen);
  const setOpen = useBrowserStore((s) => s.setDownloadsShelfOpen);
  const downloads = useBrowserStore((s) => s.downloads);
  const [dangerConfirm, setDangerConfirm] = useState<{ id: string; filename: string } | null>(null);

  const recent = useMemo(() => downloads.slice(0, 3), [downloads]);
  const hasIssues = downloads.some((d) => d.status === 'failed' || d.status === 'interrupted');

  if (!open) return null;

  async function openFile(id: string, filename: string) {
    const isDanger = await window.alpha.downloads.isDangerous(id);
    if (isDanger) {
      setDangerConfirm({ id, filename });
      return;
    }
    await window.alpha.downloads.openFile(id);
  }

  return (
    <>
      <div className="downloads-shelf">
        <div className="downloads-shelf-header">
          <button
            type="button"
            className={`downloads-shelf-title ${hasIssues ? 'downloads-shelf-warn' : ''}`}
            onClick={() => {
              void window.alpha.overlay.openPanel('downloads-panel');
              setOpen(false);
            }}
            title="Открыть список загрузок"
          >
            Загрузки
            {hasIssues && <AlertTriangle size={14} />}
          </button>
          <button type="button" className="shell-icon-btn" aria-label="Закрыть" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="downloads-shelf-empty">Пока нет загрузок.</div>
        ) : (
          <ul className="downloads-shelf-list">
            {recent.map((d) => (
              <li key={d.id} className="downloads-shelf-item">
                <div className="downloads-shelf-meta">
                  <div className="downloads-shelf-name" title={d.filename}>
                    {d.filename}
                  </div>
                  <div className="downloads-shelf-sub">
                    {statusText(d.status, d.canResume)}
                    {d.totalBytes ? ` · ${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}` : ''}
                  </div>
                </div>

                <div className="downloads-shelf-actions">
                  {(d.status === 'downloading' || d.status === 'pending') && (
                    <button
                      type="button"
                      className="shell-icon-btn"
                      title="Отменить"
                      onClick={() => void window.alpha.downloads.cancel(d.id)}
                    >
                      <X size={16} />
                    </button>
                  )}
                  {d.status === 'interrupted' && d.canResume && (
                    <button
                      type="button"
                      className="shell-icon-btn"
                      title="Продолжить"
                      onClick={() => void window.alpha.downloads.resume(d.id)}
                    >
                      <Play size={16} />
                    </button>
                  )}
                  {(d.status === 'failed' || (d.status === 'interrupted' && !d.canResume)) && (
                    <button
                      type="button"
                      className="shell-icon-btn"
                      title="Повторить"
                      onClick={() => void window.alpha.downloads.retry(d.id)}
                    >
                      <RotateCw size={16} />
                    </button>
                  )}
                  {d.status === 'completed' && (
                    <button
                      type="button"
                      className="shell-icon-btn"
                      title="Открыть"
                      onClick={() => void openFile(d.id, d.filename)}
                    >
                      <span className="downloads-shelf-open">Открыть</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="shell-icon-btn"
                    title="Показать в папке"
                    onClick={() => void window.alpha.downloads.showInFolder(d.id)}
                    disabled={!d.savePath}
                  >
                    <Folder size={16} />
                  </button>
                </div>

                <div className="downloads-shelf-progress">
                  <div className="downloads-shelf-progress-bar" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dangerConfirm && (
        <div className="modal-overlay" onClick={() => setDangerConfirm(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Открыть файл?</h3>
            <p className="workspace-empty">
              Файл <strong>{dangerConfirm.filename}</strong> может быть опасным. Открыть только если вы доверяете источнику.
            </p>
            <div className="modal-actions">
              <button type="button" className="modal-btn" onClick={() => setDangerConfirm(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="modal-btn-primary"
                onClick={() => {
                  void window.alpha.downloads.openFile(dangerConfirm.id);
                  setDangerConfirm(null);
                }}
              >
                Открыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

