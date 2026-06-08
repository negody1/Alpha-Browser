import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { UpdateNotice } from '@alpha/shared-types';

/**
 * PHASE 6 — passive "new version available" dialog (notify only, à la Bambu
 * Studio). On mount it runs one check and also listens for the startup push.
 * It never downloads or installs anything; the only action opens the GitHub
 * release page in the user's default browser.
 */
export function UpdateModal() {
  const [info, setInfo] = useState<UpdateNotice | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.alpha.updates.check().then((res) => {
      if (alive && res?.available) setInfo(res);
    });
    const off = window.alpha.updates.onAvailable((res) => {
      if (res?.available) setInfo(res);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!info || !info.available || dismissed) return null;

  return (
    <div className="update-modal-backdrop" role="dialog" aria-modal="true" aria-label="Обновление Alpha">
      <div className="update-modal">
        <header className="update-modal-head">
          <h2>Доступна новая версия Alpha</h2>
          <button
            type="button"
            className="update-modal-close"
            aria-label="Закрыть"
            onClick={() => setDismissed(true)}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className="update-modal-versions">
          <span>Текущая версия: <strong>{info.currentVersion}</strong></span>
          <span>Новая версия: <strong>{info.latestVersion}</strong></span>
        </div>

        {info.notes && (
          <div className="update-modal-notes">
            <div className="update-modal-notes-label">Что нового</div>
            <pre className="update-modal-notes-body">{info.notes}</pre>
          </div>
        )}

        <footer className="update-modal-actions">
          <button type="button" className="update-modal-btn-ghost" onClick={() => setDismissed(true)}>
            Позже
          </button>
          <button
            type="button"
            className="update-modal-btn-primary"
            // "Download" = open the GitHub release page in the user's browser.
            // No auto-download / auto-install (explicit product decision).
            onClick={() => {
              void window.alpha.updates.openReleasePage(info.releaseUrl ?? undefined);
              setDismissed(true);
            }}
          >
            <Download size={16} strokeWidth={1.9} />
            Скачать обновление
          </button>
        </footer>
      </div>
    </div>
  );
}
