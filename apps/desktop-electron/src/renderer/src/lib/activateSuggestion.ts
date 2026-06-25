import type { OmniboxSuggestion, OmniboxSource } from '@alpha/shared-types';

/**
 * THE single source of truth for "what does activating this suggestion do".
 *
 * Every omnibox-style UI — the toolbar address bar, the Home/New-Tab search, and
 * both Enter and mouse-click within each — MUST route through activateSuggestion()
 * so there is exactly one behavior. No UI is allowed to navigate `s.url` for a
 * search suggestion (that is what opened google.com/webhp).
 */

export type SuggestionAction =
  | { action: 'switch'; tabId: string }
  | { action: 'navigate'; target: string }
  | { action: 'none' };

/**
 * Pure mapping suggestion → action. Exhaustive over OmniboxSuggestionKind:
 *  - open-tab            → switch to the tab
 *  - search              → navigate by the raw QUERY (never the resolved url)
 *  - history / url / shortcut → navigate to the exact url (fallback: title)
 *  - empty/unusable      → none
 * A search with an empty query yields `none`, so a query-less Google is
 * impossible unless the user literally typed a google.com url (kind 'url').
 */
export function resolveSuggestionTarget(s: OmniboxSuggestion): SuggestionAction {
  if (s.kind === 'open-tab' && s.tabId) {
    return { action: 'switch', tabId: s.tabId };
  }
  if (s.kind === 'search') {
    const query = (s.query ?? s.title ?? '').trim();
    return query ? { action: 'navigate', target: query } : { action: 'none' };
  }
  // history / url / shortcut → exact destination.
  const target = (s.url ?? s.title ?? '').trim();
  return target ? { action: 'navigate', target } : { action: 'none' };
}

export interface ActivationContext {
  source: OmniboxSource;
  activeTabId: string | null;
  navigate: (tabId: string, input: string, meta: { source: OmniboxSource; suggestionKind: string }) => void;
  switchTab: (tabId: string) => void;
}

/** Execute the resolved action. Returns the action taken (for callers/tests). */
export function activateSuggestion(s: OmniboxSuggestion, ctx: ActivationContext): SuggestionAction {
  const decision = resolveSuggestionTarget(s);
  if (decision.action === 'switch') {
    ctx.switchTab(decision.tabId);
  } else if (decision.action === 'navigate') {
    if (!ctx.activeTabId) return { action: 'none' };
    ctx.navigate(ctx.activeTabId, decision.target, { source: ctx.source, suggestionKind: s.kind });
  }
  return decision;
}
