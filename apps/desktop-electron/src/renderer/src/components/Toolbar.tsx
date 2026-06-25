import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
  Star,
} from 'lucide-react';
import { FAVICON_FALLBACK_URL, type OmniboxSuggestion } from '@alpha/shared-types';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';
import { useOmnibox } from '../hooks/useOmnibox';
import { activateSuggestion as runActivation } from '../lib/activateSuggestion';
import { RouteBadge } from './RouteBadge';
import { tabAddressValue } from './TabBar';

export function Toolbar() {
  const activeTab = useBrowserStore(selectActiveTab);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const bookmarks = useBrowserStore((s) => s.bookmarks);
  const downloads = useBrowserStore((s) => s.downloads);
  const adblock = useBrowserStore((s) => s.adblock);
  const activeTabBlocked = activeTab?.id ? adblock.blockedByTabId[activeTab.id] ?? 0 : 0;
  const [draft, setDraft] = useState('');
  const [addressFocused, setAddressFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const lastSyncedUrl = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addressBarRef = useRef<HTMLDivElement>(null);
  // Chrome-like address bar: the first focus selects the whole URL; the mouseup
  // that accompanies that focusing click must not collapse the selection. A
  // later click (already focused) positions the caret normally.
  const selectAllOnNextMouseUp = useRef(false);

  const suggestions = useOmnibox(draft, addressFocused && !dismissed);
  const omniboxOpen = addressFocused && !dismissed && suggestions.length > 0;

  // Inline autocomplete: take the tail from the first suggestion that offers one,
  // only while the user is typing (no list row selected). Accepted via Tab / →.
  const inlineSuffix =
    omniboxOpen && selectedIndex === -1
      ? (suggestions.find((s) => s.inlineCompletion)?.inlineCompletion ?? '')
      : '';

  // P2-C.2 (Variant A): render suggestions in a dedicated always-above overlay
  // window positioned under the address bar. The page WebContentsView is NEVER
  // hidden — it stays fully visible under the dropdown.
  useEffect(() => {
    if (!omniboxOpen) {
      void window.alpha.omnibox.overlayHide();
      return;
    }
    const el = addressBarRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.alpha.omnibox.overlaySync({
      suggestions,
      selectedIndex,
      anchor: { x: r.left, y: r.bottom, width: r.width },
    });
  }, [omniboxOpen, suggestions, selectedIndex]);

  // Hide the overlay if the toolbar unmounts while open.
  useEffect(() => () => void window.alpha.omnibox.overlayHide(), []);

  // Ctrl/Cmd+L and F6 focus the address bar and select all (browser convention).
  // Works while the chrome renderer has focus (NTP, toolbar). Guest-page focus is
  // captured by the WebContentsView and is out of scope here.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const isFocusOmnibox = ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) || e.key === 'F6';
      if (!isFocusOmnibox) return;
      e.preventDefault();
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mouse interactions happen in the overlay window; route them back here so all
  // selection/activation logic stays single-sourced in the toolbar.
  const pickRef = useRef<(index: number) => void>(() => {});
  pickRef.current = (index: number) => {
    const s = suggestions[index];
    if (s) activateSuggestion(s);
  };
  useEffect(() => {
    const offPicked = window.alpha.omnibox.onPicked((i) => pickRef.current(i));
    const offHovered = window.alpha.omnibox.onHovered((i) => setSelectedIndex(i));
    return () => {
      offPicked();
      offHovered();
    };
  }, []);

  // Keep the selection in range as the suggestion set changes.
  useEffect(() => {
    if (selectedIndex >= suggestions.length) setSelectedIndex(-1);
  }, [suggestions.length, selectedIndex]);

  useEffect(() => {
    if (!activeTab || addressFocused) {
      return;
    }
    const next = tabAddressValue(activeTab.url, activeTab.kind);
    if (next !== lastSyncedUrl.current) {
      lastSyncedUrl.current = next;
      setDraft(next);
    }
  }, [activeTab?.id, activeTab?.url, activeTab?.kind, addressFocused]);

  useEffect(() => {
    if (!activeTab) {
      lastSyncedUrl.current = '';
      setDraft('');
    }
  }, [activeTab?.id]);

  function closeOmnibox() {
    setDismissed(true);
    setSelectedIndex(-1);
  }

  // Single shared activation path — identical to Home/NTP, so click and Enter in
  // the toolbar behave exactly like everywhere else (search → query, never url).
  function activateSuggestion(s: OmniboxSuggestion) {
    runActivation(s, {
      source: 'toolbar',
      activeTabId,
      navigate: (tabId, input, meta) => void window.alpha.tabs.navigate(tabId, input, meta),
      switchTab: (tabId) => void window.alpha.tabs.switch(tabId),
    });
    closeOmnibox();
    inputRef.current?.blur();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      activateSuggestion(suggestions[selectedIndex]);
      return;
    }
    if (!activeTabId || !draft.trim()) {
      return;
    }
    await window.alpha.tabs.navigate(activeTabId, draft, { source: 'toolbar', handler: 'Toolbar.submitRaw' });
    closeOmnibox();
    inputRef.current?.blur();
  }

  function acceptInline() {
    if (!inlineSuffix) return false;
    setDraft((prev) => prev + inlineSuffix);
    setSelectedIndex(-1);
    return true;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setDismissed(false);
      setSelectedIndex((i) => Math.min(suggestions.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setSelectedIndex((i) => Math.max(-1, i - 1));
      return;
    }
    if (event.key === 'Escape') {
      if (omniboxOpen) {
        event.preventDefault();
        closeOmnibox();
      }
      return;
    }
    if (event.key === 'Tab' && inlineSuffix) {
      event.preventDefault();
      acceptInline();
      return;
    }
    if (event.key === 'ArrowRight' && inlineSuffix) {
      const el = event.currentTarget;
      const atEnd = el.selectionStart === el.value.length && el.selectionStart === el.selectionEnd;
      if (atEnd) {
        event.preventDefault();
        acceptInline();
      }
    }
  }

  const isWeb = activeTab?.kind === 'web';
  const isLoading = activeTab?.isLoading ?? false;
  const isBookmarked = !!(activeTab?.url && bookmarks.some((b) => b.url === activeTab.url));
  const hasActiveDownload = downloads.some((d) => d.status === 'downloading' || d.status === 'pending');
  const hasWarnDownload = downloads.some((d) => d.status === 'failed' || d.status === 'interrupted');

  return (
    <div className={`shell-toolbar ${isLoading && isWeb ? 'shell-toolbar-loading' : ''}`}>
      <div className="shell-nav-buttons">
        <IconButton
          label="Назад"
          disabled={!isWeb || !activeTab?.canGoBack}
          onClick={() => void window.alpha.tabs.goBack()}
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Вперёд"
          disabled={!isWeb || !activeTab?.canGoForward}
          onClick={() => void window.alpha.tabs.goForward()}
        >
          <ArrowRight size={18} strokeWidth={1.75} />
        </IconButton>
        {isLoading && isWeb ? (
          <IconButton
            label="Остановить"
            className="shell-icon-btn-loading"
            onClick={() => void window.alpha.tabs.stop()}
          >
            <Loader2 size={18} strokeWidth={1.75} className="spin-slow" />
          </IconButton>
        ) : (
          <IconButton
            label="Обновить"
            disabled={!isWeb}
            onClick={() => void window.alpha.tabs.reload()}
          >
            <RefreshCw size={18} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>

      <form className="shell-address-form" onSubmit={(e) => void handleSubmit(e)}>
        <div
          ref={addressBarRef}
          className={`shell-address-bar ${isLoading && isWeb ? 'shell-address-bar-loading' : ''}`}
        >
          {isWeb ? (
            isLoading ? (
              <Loader2 size={16} className="shell-address-lock spin-slow" aria-hidden />
            ) : (
              <img
                src={activeTab?.favicon ?? FAVICON_FALLBACK_URL}
                alt=""
                className="shell-address-favicon"
                width={16}
                height={16}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = FAVICON_FALLBACK_URL;
                }}
              />
            )
          ) : (
            <Lock size={16} strokeWidth={1.75} className="shell-address-lock shell-address-lock-muted" />
          )}
          <div className="omnibox-input-wrap">
            <input
              ref={inputRef}
              type="text"
              className="shell-address-input"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDismissed(false);
                setSelectedIndex(-1);
              }}
              onFocus={(e) => {
                setAddressFocused(true);
                setDismissed(false);
                // First focus (typically a click) selects the whole URL, like
                // Chrome/Edge. The accompanying mouseup is neutralized below so
                // it doesn't collapse the selection.
                selectAllOnNextMouseUp.current = true;
                e.currentTarget.select();
              }}
              onMouseUp={(e) => {
                if (selectAllOnNextMouseUp.current) {
                  // Keep the focus-time select-all; a later click positions the caret.
                  e.preventDefault();
                  selectAllOnNextMouseUp.current = false;
                }
              }}
              onBlur={() => {
                setAddressFocused(false);
                selectAllOnNextMouseUp.current = false;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Введите запрос или адрес сайта"
              spellCheck={false}
              autoComplete="off"
            />
            {inlineSuffix && (
              <div className="omnibox-ghost" aria-hidden>
                <span className="omnibox-ghost-pad">{draft}</span>
                <span className="omnibox-ghost-suffix">{inlineSuffix}</span>
              </div>
            )}
          </div>
          <RouteBadge />
        </div>
      </form>

      <div className="shell-toolbar-actions">
        <IconButton
          label={`AdBlock (${activeTabBlocked})`}
          className={adblock.enabled ? undefined : 'shell-icon-btn-active'}
          onClick={(e) => {
            void window.alpha.shell.showAdblockMenu(e.clientX, e.clientY);
          }}
        >
          <Shield size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Загрузки"
          className={
            hasWarnDownload
              ? 'shell-icon-btn-warn'
              : hasActiveDownload
                ? 'shell-icon-btn-active'
                : undefined
          }
          onClick={() => {
            void window.alpha.overlay.openPanel('downloads-panel');
          }}
        >
          <Download size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label={isBookmarked ? 'Убрать из закладок' : 'Добавить в закладки'}
          disabled={!isWeb || !activeTab}
          className={isBookmarked ? 'shell-icon-btn-active' : undefined}
          onClick={() => {
            if (!activeTab) return;
            if (isBookmarked) {
              const bm = bookmarks.find((b) => b.url === activeTab.url);
              if (bm) void window.alpha.bookmarks.delete(bm.id);
            } else {
              void window.alpha.bookmarks.upsert({
                url: activeTab.url,
                title: activeTab.title || activeTab.url,
                favicon: activeTab.favicon,
              });
            }
          }}
        >
          <Star
            size={18}
            strokeWidth={1.75}
            fill={isBookmarked ? 'currentColor' : 'none'}
          />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  disabled,
  className,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  className?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`shell-icon-btn ${className ?? ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
