import { FormEvent, useEffect, useState } from 'react';
import { DEFAULT_PROXY_KEY, type RouteMode } from '@alpha/shared-types';

/**
 * Routing controls without panel chrome, so they can be reused both as the
 * standalone routing panel (RoutingOverlay) and as a section inside Settings.
 */
export function RoutingSettingsContent() {
  const [defaultRoute, setDefaultRoute] = useState<RouteMode>('AUTO');
  const [proxy, setProxy] = useState('');
  const [rules, setRules] = useState<Array<{ domain: string; route: RouteMode }>>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newRoute, setNewRoute] = useState<RouteMode>('PROXY');

  useEffect(() => {
    void window.alpha.routing.getRules().then((r) => {
      setDefaultRoute(r.defaultRoute);
      setProxy(r.proxyEndpoints[DEFAULT_PROXY_KEY] ?? '');
      setRules(r.rules);
    });
  }, []);

  async function saveDefaults(event: FormEvent) {
    event.preventDefault();
    await window.alpha.routing.setDefaultRoute(defaultRoute);
    if (proxy.trim()) {
      await window.alpha.routing.setProxyEndpoint(proxy.trim());
    }
    const r = await window.alpha.routing.getRules();
    setRules(r.rules);
  }

  return (
    <>
      <form onSubmit={(e) => void saveDefaults(e)}>
        <label className="overlay-field">
          <span>Маршрут по умолчанию</span>
          <select value={defaultRoute} onChange={(e) => setDefaultRoute(e.target.value as RouteMode)}>
            <option value="AUTO">AUTO</option>
            <option value="DIRECT">DIRECT</option>
            <option value="PROXY">PROXY</option>
          </select>
        </label>
        <label className="overlay-field">
          <span>Основной прокси</span>
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="SOCKS5 127.0.0.1:1080" />
        </label>
        <button type="submit" className="overlay-btn overlay-btn-primary">
          Сохранить
        </button>
      </form>

      <h3 className="overlay-subtitle">Правила для сайтов</h3>
      {rules.map((rule) => (
        <div key={rule.domain} className="overlay-rule-row">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {rule.domain}
          </span>
          <select
            value={rule.route}
            onChange={(e) =>
              void window.alpha.routing.updateRule(rule.domain, e.target.value as RouteMode).then(async () => {
                const r = await window.alpha.routing.getRules();
                setRules(r.rules);
              })
            }
          >
            <option value="AUTO">AUTO</option>
            <option value="DIRECT">DIRECT</option>
            <option value="PROXY">PROXY</option>
          </select>
          <button
            type="button"
            className="overlay-btn"
            onClick={() =>
              void window.alpha.routing.deleteRule(rule.domain).then(async () => {
                const r = await window.alpha.routing.getRules();
                setRules(r.rules);
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <div className="overlay-rule-row" style={{ marginTop: 8 }}>
        <input
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="example.com"
          style={{ flex: 1, minWidth: 0 }}
        />
        <select value={newRoute} onChange={(e) => setNewRoute(e.target.value as RouteMode)}>
          <option value="PROXY">PROXY</option>
          <option value="DIRECT">DIRECT</option>
          <option value="AUTO">AUTO</option>
        </select>
        <button
          type="button"
          className="overlay-btn"
          onClick={() => {
            if (!newDomain.trim()) return;
            void window.alpha.routing.addRule(newDomain.trim(), newRoute).then(async () => {
              setNewDomain('');
              const r = await window.alpha.routing.getRules();
              setRules(r.rules);
            });
          }}
        >
          +
        </button>
      </div>
    </>
  );
}
