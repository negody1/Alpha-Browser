import { useEffect, useState, type ReactNode } from 'react';
import { Monitor, AppWindow } from 'lucide-react';
import type { ScreenSharePromptPayload } from '../overlay-types';

export function ScreenSharePopupOverlay({ payload }: { payload: ScreenSharePromptPayload }) {
  const { requestId, host, sources } = payload;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The popup window is reused across requests; reset the selection when a new
  // getDisplayMedia request (new requestId) reuses this view.
  useEffect(() => {
    setSelectedId(null);
  }, [requestId]);

  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');

  const share = () => {
    if (!selectedId) return;
    void window.alpha.screenShare.resolve(requestId, selectedId);
  };
  const cancel = () => {
    void window.alpha.screenShare.cancel(requestId);
  };

  return (
    <div className="overlay-popup-root" data-overlay-root="screenshare-popup">
      <div className="screenshare-pop" role="dialog" aria-label="Демонстрация экрана">
        <div className="screenshare-pop-head">
          <div className="screenshare-pop-title">Выберите, чем поделиться</div>
          {host && <div className="screenshare-pop-host">{host}</div>}
        </div>

        <div className="screenshare-pop-body">
          {screens.length > 0 && (
            <>
              <div className="screenshare-pop-section">Экраны</div>
              <div className="screenshare-pop-grid">
                {screens.map((s) => (
                  <SourceCard
                    key={s.id}
                    name={s.name}
                    thumbnail={s.thumbnail}
                    icon={<Monitor size={16} strokeWidth={1.75} />}
                    selected={selectedId === s.id}
                    onSelect={() => setSelectedId(s.id)}
                  />
                ))}
              </div>
            </>
          )}

          {windows.length > 0 && (
            <>
              <div className="screenshare-pop-section">Окна</div>
              <div className="screenshare-pop-grid">
                {windows.map((s) => (
                  <SourceCard
                    key={s.id}
                    name={s.name}
                    thumbnail={s.thumbnail}
                    icon={
                      s.appIcon ? (
                        <img src={s.appIcon} alt="" width={16} height={16} />
                      ) : (
                        <AppWindow size={16} strokeWidth={1.75} />
                      )
                    }
                    selected={selectedId === s.id}
                    onSelect={() => setSelectedId(s.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="screenshare-pop-actions">
          <button type="button" className="screenshare-pop-btn screenshare-pop-btn-cancel" onClick={cancel}>
            Отмена
          </button>
          <button
            type="button"
            className="screenshare-pop-btn screenshare-pop-btn-share"
            disabled={!selectedId}
            onClick={share}
          >
            Поделиться
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  name,
  thumbnail,
  icon,
  selected,
  onSelect,
}: {
  name: string;
  thumbnail: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`screenshare-card ${selected ? 'screenshare-card-selected' : ''}`}
      onClick={onSelect}
      title={name}
    >
      <div className="screenshare-card-thumb">
        {thumbnail ? <img src={thumbnail} alt="" /> : <div className="screenshare-card-thumb-empty" />}
      </div>
      <div className="screenshare-card-label">
        <span className="screenshare-card-icon">{icon}</span>
        <span className="screenshare-card-name">{name}</span>
      </div>
    </button>
  );
}
