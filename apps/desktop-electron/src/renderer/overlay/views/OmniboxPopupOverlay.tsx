import type { MouseEvent } from 'react';
import { Clock, Globe, Search, SquareStack, Star } from 'lucide-react';
import {
  FAVICON_FALLBACK_URL,
  type OmniboxSuggestion,
  type OmniboxSuggestionKind,
} from '@alpha/shared-types';
import type { OmniboxPopupPayload } from '../overlay-types';

function KindIcon({ kind }: { kind: OmniboxSuggestionKind }) {
  switch (kind) {
    case 'open-tab':
      return <SquareStack size={16} strokeWidth={1.75} />;
    case 'history':
      return <Clock size={16} strokeWidth={1.75} />;
    case 'shortcut':
      return <Star size={16} strokeWidth={1.75} />;
    case 'search':
      return <Search size={16} strokeWidth={1.75} />;
    default:
      return <Globe size={16} strokeWidth={1.75} />;
  }
}

function subtitle(s: OmniboxSuggestion): string {
  if (s.kind === 'search') return 'Поиск';
  return s.host ?? s.url;
}

export function OmniboxPopupOverlay({ payload }: { payload: OmniboxPopupPayload }) {
  const { suggestions, selectedIndex } = payload;

  return (
    <div className="overlay-popup-root" data-overlay-root="omnibox-popup">
      <div className="omnibox-pop" role="listbox">
        {suggestions.map((s, i) => (
          <button
            key={`${s.kind}:${s.url}:${i}`}
            type="button"
            role="option"
            aria-selected={i === selectedIndex}
            className={`omnibox-pop-item ${i === selectedIndex ? 'omnibox-pop-item-active' : ''}`}
            // Non-focusable window + mousedown keeps the toolbar input focused.
            onMouseDown={(e: MouseEvent) => {
              e.preventDefault();
              void window.alpha.omnibox.overlayPick(i);
            }}
            onMouseEnter={() => void window.alpha.omnibox.overlayHover(i)}
          >
            <span className="omnibox-pop-icon">
              {s.favicon ? (
                <img
                  src={s.favicon}
                  alt=""
                  width={16}
                  height={16}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = FAVICON_FALLBACK_URL;
                  }}
                />
              ) : (
                <KindIcon kind={s.kind} />
              )}
            </span>
            <span className="omnibox-pop-text">
              <span className="omnibox-pop-title">{s.title}</span>
              <span className="omnibox-pop-sub">{subtitle(s)}</span>
            </span>
            {s.kind === 'open-tab' && <span className="omnibox-pop-badge">Открытая вкладка</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
