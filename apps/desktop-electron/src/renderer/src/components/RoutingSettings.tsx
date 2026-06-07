import { FormEvent, useEffect, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { DEFAULT_PROXY_KEY, type RouteMode } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';

/**
 * ZONE 1 side panel — not a modal. Shares horizontal reserve with other panels.
 */
export function RoutingSettings({ embedded = false }: { embedded?: boolean }) {
  const open = useBrowserStore((s) => s.routingSettingsOpen);
  const setOpen = useBrowserStore((s) => s.setRoutingSettingsOpen);
  const routing = useBrowserStore((s) => s.routing);
  const proxyState = useBrowserStore((s) => s.proxy);
  const runtimeLabel =
    proxyState.runtimeMode === 'SING_BOX_LOCAL_TEST'
      ? 'sing-box локальный'
      : proxyState.runtimeMode === 'SING_BOX_REMOTE'
        ? 'sing-box удалённый'
        : 'Тестовый локальный';

  const statusLabel =
    proxyState.status === 'CONNECTED'
      ? 'Подключено'
      : proxyState.status === 'CONNECTING'
        ? 'Подключение…'
        : proxyState.status === 'RECONNECTING'
          ? 'Переподключение…'
          : proxyState.status === 'ERROR'
            ? proxyState.errorReason === 'BINARY_MISSING'
              ? 'sing-box не найден'
              : 'Ошибка'
            : 'Отключено';

  const [defaultRoute, setDefaultRoute] = useState<RouteMode>('AUTO');
  const [proxy, setProxy] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newRoute, setNewRoute] = useState<RouteMode>('PROXY');

  useEffect(() => {
    if (open) {
      setDefaultRoute(routing.defaultRoute);
      setProxy(routing.proxyEndpoints[DEFAULT_PROXY_KEY] ?? '');
    }
  }, [open, routing]);

  if (!open && !embedded) {
    return null;
  }

  function closePanel() {
    if (embedded) {
      void window.alpha.overlay.closePanel();
      return;
    }
    setOpen(false);
  }

  async function saveDefaults(event: FormEvent) {
    event.preventDefault();
    await window.alpha.routing.setDefaultRoute(defaultRoute);
    if (proxy.trim()) {
      await window.alpha.routing.setProxyEndpoint(proxy.trim());
    }
  }

  return (
    <aside className="side-panel side-panel-scroll" aria-label="Маршрутизация">
      <header className="side-panel-header">
        <div className="side-panel-title">
          <Settings size={16} />
          <h2>Маршрутизация</h2>
        </div>
        <button type="button" className="shell-icon-btn" aria-label="Закрыть" onClick={closePanel}>
          <X size={18} />
        </button>
      </header>

      <div className="side-panel-body">
        <p className="route-popup-domain">
          Прокси: {runtimeLabel} · {statusLabel}
        </p>

        <form className="routing-settings-form" onSubmit={(e) => void saveDefaults(e)}>
          <label className="modal-field">
            <span>Маршрут по умолчанию</span>
            <select
              value={defaultRoute}
              onChange={(e) => setDefaultRoute(e.target.value as RouteMode)}
            >
              <option value="AUTO">AUTO</option>
              <option value="DIRECT">DIRECT</option>
              <option value="PROXY">PROXY</option>
            </select>
          </label>
          <label className="modal-field">
            <span>Основной прокси</span>
            <input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="SOCKS5 127.0.0.1:1080"
            />
          </label>
          <button type="submit" className="workspace-btn workspace-btn-primary">
            Сохранить
          </button>
        </form>

        <section className="routing-rules">
          <h4>Правила для сайтов</h4>
          <ul className="routing-rules-list">
            {routing.rules.map((rule) => (
              <li key={rule.domain} className="routing-rule-row">
                <span>{rule.domain}</span>
                <select
                  value={rule.route}
                  onChange={(e) =>
                    void window.alpha.routing.updateRule(rule.domain, e.target.value as RouteMode)
                  }
                >
                  <option value="AUTO">AUTO</option>
                  <option value="DIRECT">DIRECT</option>
                  <option value="PROXY">PROXY</option>
                </select>
                <button
                  type="button"
                  className="workspace-link-btn"
                  onClick={() => void window.alpha.routing.deleteRule(rule.domain)}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
          <div className="routing-rule-add">
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
            />
            <select value={newRoute} onChange={(e) => setNewRoute(e.target.value as RouteMode)}>
              <option value="PROXY">PROXY</option>
              <option value="DIRECT">DIRECT</option>
              <option value="AUTO">AUTO</option>
            </select>
            <button
              type="button"
              className="workspace-btn"
              onClick={() => {
                if (newDomain.trim()) {
                  void window.alpha.routing.addRule(newDomain.trim(), newRoute);
                  setNewDomain('');
                }
              }}
            >
              Добавить
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
