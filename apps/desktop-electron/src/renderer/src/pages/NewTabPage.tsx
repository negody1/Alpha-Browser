import { FormEvent, useRef, useState, type KeyboardEvent } from 'react';
import { Search, Clock, Globe, AppWindow, ArrowRight } from 'lucide-react';
import type { OmniboxSuggestion } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';
import { useOmnibox } from '../hooks/useOmnibox';
import { WorkspaceCards } from '../components/WorkspaceCards';
import { QuickLinks } from '../components/QuickLinks';

/** Pick a small leading glyph per suggestion kind (visual parity with the omnibox). */
function SuggestionIcon({ kind }: { kind: OmniboxSuggestion['kind'] }) {
  if (kind === 'history') return <Clock size={16} strokeWidth={1.75} aria-hidden />;
  if (kind === 'open-tab') return <AppWindow size={16} strokeWidth={1.75} aria-hidden />;
  if (kind === 'search') return <Search size={16} strokeWidth={1.75} aria-hidden />;
  return <Globe size={16} strokeWidth={1.75} aria-hidden />;
}

export function NewTabPage() {
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // PHASE 3: the NTP search reuses the SAME omnibox engine as the toolbar
  // (history / open tabs / shortcuts / search-or-URL). No second system.
  const suggestions = useOmnibox(query, focused);
  const open = focused && suggestions.length > 0;

  async function navigate(input: string) {
    if (!activeTabId || !input.trim()) return;
    await window.alpha.tabs.navigate(activeTabId, input);
  }

  function activate(s: OmniboxSuggestion) {
    if (!activeTabId) return;
    if (s.kind === 'open-tab' && s.tabId) {
      void window.alpha.tabs.switch(s.tabId);
    } else {
      // P0: search → navigate by the exact query text (fresh, correct search URL);
      // url/history → exact URL. Never a query-less Google.
      const target = s.kind === 'search' ? (s.title?.trim() || s.url) : (s.url || s.title);
      if (!target || !target.trim()) return;
      void window.alpha.tabs.navigate(activeTabId, target);
    }
    setSelectedIndex(-1);
    inputRef.current?.blur();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      activate(suggestions[selectedIndex]);
      return;
    }
    await navigate(query);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setSelectedIndex((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setSelectedIndex((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Escape') {
      setSelectedIndex(-1);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="ntp-root">
      <div className="ntp-backdrop" aria-hidden />
      <main className="ntp-content">
        <div className="ntp-stage">
          <header className="ntp-hero">
            <img
              src="branding/logo-ntp.png"
              alt="Alpha"
              className="ntp-logo"
              width={300}
              height={104}
            />
            <form className="ntp-search" onSubmit={(e) => void handleSubmit(e)}>
              <Search className="ntp-search-icon" size={22} strokeWidth={1.75} aria-hidden />
              <input
                ref={inputRef}
                type="text"
                className="ntp-search-input"
                placeholder="Поиск или адрес сайта"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(-1);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  // Defer so a suggestion click registers before the list unmounts.
                  setTimeout(() => setFocused(false), 120);
                }}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoComplete="off"
              />
              {open && (
                <ul className="ntp-suggestions" role="listbox">
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.kind}:${s.url}:${i}`}
                      role="option"
                      aria-selected={i === selectedIndex}
                      className={`ntp-suggestion ${i === selectedIndex ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIndex(i)}
                      onMouseDown={(e) => {
                        // Prevent input blur from firing before the click.
                        e.preventDefault();
                        activate(s);
                      }}
                    >
                      <span className="ntp-suggestion-icon">
                        <SuggestionIcon kind={s.kind} />
                      </span>
                      <span className="ntp-suggestion-title">{s.title}</span>
                      {s.host && <span className="ntp-suggestion-host">{s.host}</span>}
                      <ArrowRight className="ntp-suggestion-go" size={14} strokeWidth={1.75} aria-hidden />
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </header>

          <QuickLinks onNavigate={navigate} />
          <WorkspaceCards />
        </div>
      </main>
    </div>
  );
}
