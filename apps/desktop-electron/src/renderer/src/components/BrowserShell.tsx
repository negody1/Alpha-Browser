import { useEffect, useRef } from 'react';
import { NTP_URL, SETTINGS_URL } from '@alpha/shared-types';
import { useBrowserSync } from '../hooks/useTabsSync';
import { useChromeStackHeightSync } from '../hooks/useChromeStackHeightSync';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';
import { NewTabPage } from '../pages/NewTabPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { DownloadsShelf } from './DownloadsShelf';
import { RoutingBanners } from './RoutingBanners';
import { Toolbar } from './Toolbar';
import { PasswordsPrompt } from './PasswordsPrompt';
import { UpdateModal } from './UpdateModal';
import { DebugOverlay } from '../debug/DebugOverlay';

export function BrowserShell() {
  useBrowserSync();
  const chromeStackRef = useRef<HTMLDivElement>(null);
  useChromeStackHeightSync(chromeStackRef);
  const activeTab = useBrowserStore(selectActiveTab);
  const showSettings =
    activeTab?.kind === 'internal' && activeTab.url === SETTINGS_URL;
  const showNtp =
    !showSettings && (!activeTab || activeTab.kind === 'ntp' || activeTab.url === NTP_URL);

  useEffect(() => {
    return window.alpha.shell.onOpenRoutingSettings(() => {
      void window.alpha.overlay.openPanel('routing-panel');
    });
  }, []);

  return (
    <div className="shell-root">
      <DebugOverlay />
      <Sidebar />
      <div className="shell-main">
        <div className="shell-chrome-stack" ref={chromeStackRef}>
          <TabBar />
          <Toolbar />
          <RoutingBanners />
          <PasswordsPrompt />
        </div>
        <div className="shell-content">
          {showSettings ? (
            <SettingsPage />
          ) : showNtp ? (
            <NewTabPage />
          ) : (
            <>
              <div className="shell-web-placeholder" aria-hidden />
              {activeTab?.isLoading && (
                <div className="shell-content-loading" aria-live="polite">
                  <div className="shell-content-loading-bar" />
                </div>
              )}
            </>
          )}
          {activeTab?.crashed && (
            <div className="shell-crash-banner">
              <p className="shell-crash-title">Эта вкладка завершилась с ошибкой</p>
              <p className="shell-crash-sub">Страница и её адрес сохранены — можно восстановить вкладку.</p>
              <div className="shell-crash-actions">
                <button type="button" className="shell-crash-primary" onClick={() => void window.alpha.tabs.recover(activeTab.id)}>
                  Восстановить вкладку
                </button>
                <button type="button" onClick={() => void window.alpha.tabs.reload(activeTab.id)}>Перезагрузить</button>
                <button type="button" onClick={() => void window.alpha.tabs.close(activeTab.id)}>Закрыть</button>
              </div>
            </div>
          )}
          {!activeTab?.crashed && activeTab?.unresponsive && (
            <div className="shell-crash-banner">
              <p className="shell-crash-title">Эта вкладка перестала отвечать</p>
              <p className="shell-crash-sub">Возможно, страница перегружена. Подождите или восстановите вкладку.</p>
              <div className="shell-crash-actions">
                <button type="button" className="shell-crash-primary" onClick={() => void window.alpha.tabs.recover(activeTab.id)}>
                  Восстановить вкладку
                </button>
                <button type="button" onClick={() => void window.alpha.tabs.close(activeTab.id)}>Закрыть</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <DownloadsShelf />
      <UpdateModal />
    </div>
  );
}
