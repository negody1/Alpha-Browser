import { FormEvent, useEffect, useState } from 'react';
import type { RouteMode } from '@alpha/shared-types';

/**
 * Routing controls without panel chrome, so they can be reused both as the
 * standalone routing panel (RoutingOverlay) and as a section inside Settings.
 */
export function RoutingSettingsContent() {
  const [defaultRoute, setDefaultRoute] = useState<RouteMode>('AUTO');
  const [rules, setRules] = useState<Array<{ domain: string; route: RouteMode }>>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newRoute, setNewRoute] = useState<RouteMode>('PROXY');

  useEffect(() => {
    void window.alpha.routing.getRules().then((r) => {
      setDefaultRoute(r.defaultRoute);
      setRules(r.rules);
    });
  }, []);

  async function saveDefaults(event: FormEvent) {
    event.preventDefault();
    // The Alpha Proxy endpoint is managed automatically by the activation flow;
    // no manual SOCKS endpoint entry is exposed to the user here (P5 cleanup).
    await window.alpha.routing.setDefaultRoute(defaultRoute);
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
