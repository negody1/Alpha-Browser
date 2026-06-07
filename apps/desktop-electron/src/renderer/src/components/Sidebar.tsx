import { useEffect } from 'react';
import { Folder, Home, Settings, Star, Clock } from 'lucide-react';
import { SETTINGS_URL } from '@alpha/shared-types';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';

export function Sidebar() {
  const groupsPanelOpen = useBrowserStore((s) => s.groupsPanelOpen);
  const bookmarksPanelOpen = useBrowserStore((s) => s.bookmarksPanelOpen);
  const historyPanelOpen = useBrowserStore((s) => s.historyPanelOpen);
  const activeTab = useBrowserStore(selectActiveTab);
  const settingsActive = activeTab?.kind === 'internal' && activeTab.url === SETTINGS_URL;

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.shell-sidebar')) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    return window.alpha.shell.onOverlayState((state) => {
      useBrowserStore.setState({
        groupsPanelOpen: state.openPanel === 'groups-panel',
        bookmarksPanelOpen: state.openPanel === 'bookmarks-panel',
        historyPanelOpen: state.openPanel === 'history-panel',
        routingSettingsOpen: state.openPanel === 'routing-panel',
        downloadsPanelOpen: state.openPanel === 'downloads-panel',
      });
    });
  }, []);

  function toggleOverlayPanel(
    kind: 'groups-panel' | 'bookmarks-panel' | 'history-panel',
  ) {
    void window.alpha.overlay.togglePanel(kind);
  }

  return (
    <aside className="shell-sidebar" aria-label="Навигация">
      <div className="shell-sidebar-logo">
        <img src="branding/app-logo.png" alt="Alpha" width={32} height={32} />
      </div>
      <nav className="shell-sidebar-nav">
        <SidebarButton
          icon={Home}
          label="Главная"
          active={false}
          onClick={() => {
            void window.alpha.overlay.closePanel();
            const tabs = useBrowserStore.getState().tabs;
            const ntp = tabs.find((t) => t.kind === 'ntp');
            if (ntp) {
              void window.alpha.tabs.switch(ntp.id);
            } else {
              void window.alpha.tabs.create();
            }
          }}
        />
        <SidebarButton
          icon={Folder}
          label="Группы вкладок"
          active={groupsPanelOpen}
          onClick={() => toggleOverlayPanel('groups-panel')}
        />
        <SidebarButton
          icon={Star}
          label="Закладки"
          active={bookmarksPanelOpen}
          onClick={() => toggleOverlayPanel('bookmarks-panel')}
        />
        <SidebarButton
          icon={Clock}
          label="История"
          active={historyPanelOpen}
          onClick={() => toggleOverlayPanel('history-panel')}
        />
        <SidebarButton
          icon={Settings}
          label="Настройки"
          active={settingsActive}
          onClick={() => {
            void window.alpha.overlay.closePanel();
            void window.alpha.tabs.openSettings();
          }}
        />
      </nav>
    </aside>
  );
}

function SidebarButton({
  icon: Icon,
  label,
  disabled,
  active,
  tone,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  disabled?: boolean;
  active?: boolean;
  tone?: 'default' | 'active' | 'warn';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`shell-sidebar-btn ${active === true ? 'shell-sidebar-btn-active' : ''} ${tone === 'warn' ? 'shell-sidebar-btn-warn' : tone === 'active' ? 'shell-sidebar-btn-dot' : ''}`}
      data-active={active === true ? 'true' : undefined}
      title={label}
      aria-label={label}
      aria-current={active === true ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.75} />
    </button>
  );
}
