import { FormEvent, useRef, useState, type KeyboardEvent } from 'react';
import { Search, Clock, Globe, AppWindow, ArrowRight } from 'lucide-react';
import type { OmniboxSuggestion } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';
import { useOmnibox } from '../hooks/useOmnibox';
import { WorkspaceCards } from '../components/WorkspaceCards';
import { QuickLinks } from '../components/QuickLinks';
import { activateSuggestion } from '../lib/activateSuggestion';

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
    await window.alpha.tabs.navigate(activeTabId, input, { source: 'home', handler: 'NewTabPage.navigate' });
  }

  // Single shared activation path (search → query, url/history → url, tab → switch).
  function activate(s: OmniboxSuggestion) {
    activateSuggestion(s, {
      source: 'home',
      activeTabId,
      navigate: (tabId, input, meta) => void window.alpha.tabs.navigate(tabId, input, meta),
      switchTab: (tabId) => void window.alpha.tabs.switch(tabId),
    });
    setSelectedIndex(-1);
    inputRef.current?.blur();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Enter shares the exact same activation path as a click.
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
