import { selectActiveTab, useBrowserStore } from '../store/tabsStore';

export function RoutingBanners() {
  const routing = useBrowserStore((s) => s.routing);
  const activeTab = useBrowserStore(selectActiveTab);
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  const rememberDomain = routing.pendingRememberDomain;
  const reloadTabId = routing.pendingReloadTabId;

  if (activeTab?.routeMode === 'ERROR' && activeTab.domain) {
    return (
      <div className="routing-banner routing-banner-error">
        <p>Прокси недоступен. Попробуйте открыть напрямую.</p>
        <button
          type="button"
          className="workspace-btn workspace-btn-primary"
          onClick={() => void window.alpha.routing.openDirectFallback(activeTab.domain!)}
        >
          Открыть напрямую
        </button>
      </div>
    );
  }

  return (
    <>
      {rememberDomain && (
        <div className="routing-banner">
          <p>Сайт лучше работает через прокси. Запомнить?</p>
          <div className="routing-banner-actions">
            <button
              type="button"
              className="workspace-btn workspace-btn-primary"
              onClick={() =>
                void window.alpha.routing.saveCurrentRouteAsRule(rememberDomain, 'PROXY')
              }
            >
              Запомнить
            </button>
            <button
              type="button"
              className="workspace-btn"
              onClick={() => void window.alpha.routing.dismissRemember()}
            >
              Не сейчас
            </button>
          </div>
        </div>
      )}
      {reloadTabId && activeTabId && (
        <div className="routing-banner">
          <p>Маршрут изменён. Перезагрузить страницу?</p>
          <div className="routing-banner-actions">
            <button
              type="button"
              className="workspace-btn workspace-btn-primary"
              onClick={() => void window.alpha.routing.confirmReload(reloadTabId)}
            >
              Перезагрузить
            </button>
            <button
              type="button"
              className="workspace-btn"
              onClick={() => void window.alpha.routing.dismissReload()}
            >
              Позже
            </button>
          </div>
        </div>
      )}
    </>
  );
}
