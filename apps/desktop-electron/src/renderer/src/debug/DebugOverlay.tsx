import { useCallback, useEffect, useState } from 'react';
import type { NavDebugEntry, AdblockDebugStatus } from '@alpha/shared-types';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';

/**
 * In-app debug overlay (toggle: Ctrl+Shift+D). Shows the navigation trace (so the
 * exact handler that opens a bad target is visible) and AdBlock cosmetic/network
 * status. A Copy button puts everything on the clipboard so the user can send the
 * log without ever opening a terminal.
 */
export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [nav, setNav] = useState<NavDebugEntry[]>([]);
  const [adblock, setAdblock] = useState<AdblockDebugStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const activeTab = useBrowserStore(selectActiveTab);
  const activeUrl = activeTab?.url;

  useEffect(() => {
    // Primary: the main-process menu accelerator (works even when a web page has
    // focus). Fallback: a renderer keydown for when the shell itself is focused.
    const offToggle = window.alpha.debug.onToggle(() => setOpen((v) => !v));
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      offToggle();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [log, status] = await Promise.all([
        window.alpha.debug.navLog(),
        window.alpha.debug.adblockStatus(activeUrl),
      ]);
      setNav(log);
      setAdblock(status);
    } catch {
      /* ignore */
    }
  }, [activeUrl]);

  useEffect(() => {
    // Hide/show the native page view so this shell-DOM panel is actually visible
    // above a loaded web page.
    void window.alpha.debug.setOverlayOpen(open);
    if (!open) return;
    void refresh();
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [open, refresh]);

  const copyAll = useCallback(async () => {
    const payload = {
      capturedAt: new Date().toISOString(),
      activeUrl,
      adblock,
      navigations: nav,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [activeUrl, adblock, nav]);

  if (!open) return null;

  return (
    <div className="alpha-debug-overlay">
      <div className="alpha-debug-head">
        <strong>Alpha Debug</strong>
        <span className="alpha-debug-hint">Ctrl+Shift+D — закрыть</span>
        <button onClick={() => void copyAll()}>{copied ? 'Скопировано ✓' : 'Копировать лог'}</button>
        <button onClick={() => void window.alpha.debug.navClear().then(refresh)}>Очистить</button>
      </div>

      <div className="alpha-debug-section">
        <div className="alpha-debug-title">AdBlock</div>
        {adblock ? (
          <ul className="alpha-debug-kv">
            <li>engine: <b>{adblock.engine}</b></li>
            <li>cosmetic enabled: <b className={adblock.cosmeticEnabled ? 'ok' : 'bad'}>{String(adblock.cosmeticEnabled)}</b></li>
            <li>network blocked (total): <b>{adblock.networkBlockedTotal}</b></li>
            <li>cosmetic CSS applied (main): <b className={adblock.cssAppliedCount > 0 ? 'ok' : 'bad'}>{adblock.cssAppliedCount}</b> ({adblock.cssBytesTotal} bytes)</li>
            <li>cosmetic inject calls (preload): <b className={adblock.cosmeticInjectCount > 0 ? 'ok' : 'bad'}>{adblock.cosmeticInjectCount}</b></li>
            <li>site: <b>{adblock.siteHost ?? '—'}</b> ({adblock.siteEnabled ? 'on' : 'OFF'}{adblock.globalEnabled ? '' : ', global OFF'})</li>
            <li>
              cosmetic rules for site:{' '}
              {adblock.cosmeticForSite
                ? <b>{adblock.cosmeticForSite.selectors} selectors / {adblock.cosmeticForSite.scriptlets} scriptlets / {adblock.cosmeticForSite.extended} ext</b>
                : <b>—</b>}
            </li>
          </ul>
        ) : (
          <div className="alpha-debug-empty">нет данных</div>
        )}
      </div>

      <div className="alpha-debug-section">
        <div className="alpha-debug-title">Навигации (последние) — handler → target</div>
        {nav.length === 0 ? (
          <div className="alpha-debug-empty">пока пусто — выполни поиск из Home</div>
        ) : (
          <ul className="alpha-debug-nav">
            {nav.map((e, i) => (
              <li key={i} className={e.isQuerylessGoogle ? 'bad-row' : ''}>
                <div>
                  <span className="alpha-debug-src">{e.source}</span>{' / '}
                  <span>{e.handler}</span>{' / kind:'}{e.suggestionKind}
                  {e.guard !== 'none' && <span className="alpha-debug-guard"> [guard:{e.guard}]</span>}
                </div>
                <div>in: <code>{e.rawInput}</code></div>
                <div>→ <code className={e.isQuerylessGoogle ? 'bad' : 'ok'}>{e.finalTarget}</code></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
