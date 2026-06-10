import { FormEvent, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  DEFAULT_PROXY_KEY,
  type RouteMode,
  type ProxyDiagnosticsSnapshot,
} from '@alpha/shared-types';
import { useBrowserStore } from '../../store/tabsStore';
import { AlphaProxyOnboarding } from './AlphaProxyOnboarding';

const ROUTES: RouteMode[] = ['AUTO', 'DIRECT', 'PROXY'];

export function ProxySection() {
  const routing = useBrowserStore((s) => s.routing);
  const proxyState = useBrowserStore((s) => s.proxy);

  const [defaultRoute, setDefaultRoute] = useState<RouteMode>('AUTO');
  const [proxy, setProxy] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newRoute, setNewRoute] = useState<RouteMode>('PROXY');
  const [savedAt, setSavedAt] = useState(0);
  const [diag, setDiag] = useState<ProxyDiagnosticsSnapshot | null>(null);
  const [checking, setChecking] = useState(false);

  // PHASE 2: a missing remote profile means PROXY is unavailable but DIRECT
  // still works — surface that clearly instead of looking "broken".
  const missingProfile =
    proxyState.status === 'ERROR' && proxyState.errorReason === 'REMOTE_PROFILE_MISSING';

  useEffect(() => {
    setDefaultRoute(routing.defaultRoute);
    setProxy(routing.proxyEndpoints[DEFAULT_PROXY_KEY] ?? '');
  }, [routing.defaultRoute, routing.proxyEndpoints]);

  // PHASE 4: load cached diagnostics on open (no network unless user re-checks).
  useEffect(() => {
    void window.alpha.proxy.diagnostics().then(setDiag);
  }, []);

  async function runEgressCheck() {
    setChecking(true);
    try {
      setDiag(await window.alpha.proxy.checkEgress());
    } finally {
      setChecking(false);
    }
  }

  // NB: 'CONNECTED' here means the local transport (sing-box + SOCKS) started —
  // NOT that traffic actually egresses. Egress is a separate row below, so we
  // label this "Транспорт запущен" to avoid implying the proxy is fully ready.
  const statusLabel =
    proxyState.status === 'CONNECTED'
      ? 'Транспорт запущен'
      : proxyState.status === 'CONNECTING'
        ? 'Запуск транспорта…'
        : proxyState.status === 'RECONNECTING'
          ? 'Переподключение…'
          : proxyState.status === 'ERROR'
            ? proxyState.errorReason === 'BINARY_MISSING'
              ? 'Компонент Alpha Proxy не найден'
              : 'Ошибка'
            : 'Отключено';

  // User-facing label (technical runtime names stay in Advanced diagnostics).
  const runtimeLabel =
    proxyState.runtimeMode === 'SING_BOX_REMOTE'
      ? 'Alpha Proxy · Нидерланды'
      : 'Прямое соединение';

  async function saveDefaults(event: FormEvent) {
    event.preventDefault();
    await window.alpha.routing.setDefaultRoute(defaultRoute);
    if (proxy.trim()) {
      await window.alpha.routing.setProxyEndpoint(proxy.trim());
    }
    setSavedAt(Date.now());
    window.setTimeout(() => setSavedAt(0), 2000);
  }

  function addRule() {
    const domain = newDomain.trim();
    if (!domain) return;
    void window.alpha.routing.addRule(domain, newRoute);
    setNewDomain('');
  }

  return (
    <>
      {/* User-facing onboarding (email → activation code → connected). */}
      <AlphaProxyOnboarding />

      <details className="settings-advanced">
        <summary>Расширенная диагностика</summary>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <strong>Статус прокси</strong>
            <span className="settings-muted">{runtimeLabel}</span>
          </div>
          <span className={`settings-badge ${proxyState.status === 'CONNECTED' ? 'is-ok' : proxyState.status === 'ERROR' ? 'is-error' : ''}`}>
            {statusLabel}
          </span>
        </div>

        {missingProfile && (
          <div className="settings-notice settings-notice-warn">
            <strong>Alpha Proxy не подключён.</strong>
            <span className="settings-muted">
              Подключение настраивается в разделе выше (email и код активации).
            </span>
          </div>
        )}

        <form className="settings-form" onSubmit={(e) => void saveDefaults(e)}>
          <label className="settings-field">
            <span>Маршрут по умолчанию</span>
            <select value={defaultRoute} onChange={(e) => setDefaultRoute(e.target.value as RouteMode)}>
              {ROUTES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Основной прокси</span>
            <input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="SOCKS5 127.0.0.1:1080"
            />
          </label>
          <div className="settings-form-actions">
            <button type="submit" className="settings-btn settings-btn-primary">
              Сохранить
            </button>
            {savedAt > 0 && <span className="settings-saved">Сохранено</span>}
          </div>
        </form>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <strong>Диагностика соединения</strong>
          <button type="button" className="settings-btn" disabled={checking} onClick={() => void runEgressCheck()}>
            {checking ? 'Проверка…' : 'Проверить соединение'}
          </button>
        </div>
        {diag ? (
          <div className="settings-diag">
            <div className="settings-row">
              <span className="settings-muted">Локальный SOCKS</span>
              <span className={`settings-badge ${diag.egress?.localSocksOk ? 'is-ok' : 'is-error'}`}>
                {diag.egress?.localSocksOk ? 'OK' : '—'}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-muted">Выход через прокси (egress)</span>
              <span className={`settings-badge ${diag.egress?.remoteEgressOk ? 'is-ok' : 'is-error'}`}>
                {diag.egress?.remoteEgressOk ? 'OK' : '—'}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-muted">IP на выходе</span>
              <span>{diag.egress?.egressIp ?? '—'}</span>
            </div>
            {diag.egress?.expectedEgressIp && (
              <div className="settings-row">
                <span className="settings-muted">Ожидаемый IP</span>
                <span>{diag.egress.expectedEgressIp}</span>
              </div>
            )}
            {diag.egress?.error && (
              <div className="settings-row">
                <span className="settings-muted">Ошибка</span>
                <span className="settings-muted">{diag.egress.error}</span>
              </div>
            )}
            {diag.egress?.lastCheckedAt && (
              <p className="settings-muted settings-empty">
                Проверено: {new Date(diag.egress.lastCheckedAt).toLocaleTimeString('ru-RU')}
              </p>
            )}
          </div>
        ) : (
          <p className="settings-muted settings-empty">Нажмите «Проверить соединение».</p>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <strong>Правила для сайтов</strong>
          <span className="settings-muted">{routing.rules.length} правил</span>
        </div>

        <div className="settings-rule-add">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRule();
            }}
            placeholder="example.com"
          />
          <select value={newRoute} onChange={(e) => setNewRoute(e.target.value as RouteMode)}>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="button" className="settings-btn" onClick={addRule}>
            Добавить
          </button>
        </div>

        {routing.rules.length === 0 ? (
          <p className="settings-muted settings-empty">Правил пока нет</p>
        ) : (
          <ul className="settings-rule-list">
            {routing.rules.map((rule) => (
              <li key={rule.domain} className="settings-rule-row">
                <span className="settings-rule-domain">{rule.domain}</span>
                <select
                  value={rule.route}
                  onChange={(e) =>
                    void window.alpha.routing.updateRule(rule.domain, e.target.value as RouteMode)
                  }
                >
                  {ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-icon-btn"
                  title="Удалить правило"
                  aria-label={`Удалить правило для ${rule.domain}`}
                  onClick={() => void window.alpha.routing.deleteRule(rule.domain)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </details>
    </>
  );
}
