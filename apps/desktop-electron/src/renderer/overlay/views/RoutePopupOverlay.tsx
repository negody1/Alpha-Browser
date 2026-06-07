import type { RouteMode } from '@alpha/shared-types';
import type { RouteMenuPayload } from '../overlay-types';

async function closePopup() {
  await window.alpha.overlay.closePopup();
}

export function RoutePopupOverlay({ payload }: { payload: RouteMenuPayload }) {
  const { domain, hasDomain, current, remembered } = payload;

  async function setMode(mode: RouteMode) {
    // P1: route the *active tab* (per-tab partition), not a per-domain PAC rule.
    // The single shared sing-box transport backs the PROXY session.
    // P2-A: choosing DIRECT/PROXY also remembers it for this domain; AUTO forgets.
    await window.alpha.tabs.setRoute(mode);
    await closePopup();
  }

  async function forget() {
    if (!domain) return;
    // P2-A.3: drop the saved rule for this domain. The current tab keeps its
    // routeClass; new tabs of this domain go back to AUTO → DIRECT.
    await window.alpha.routing.deleteRule(domain);
    await closePopup();
  }

  async function openSettings() {
    await closePopup();
    await window.alpha.overlay.openPanel('routing-panel');
  }

  function itemClass(mode: string) {
    return `alpha-overlay-menu-item ${current === mode ? 'alpha-overlay-menu-item-checked' : ''}`;
  }

  const memoryLabel = !hasDomain
    ? null
    : remembered === 'PROXY'
      ? 'PROXY запомнен для сайта'
      : remembered === 'DIRECT'
        ? 'DIRECT запомнен для сайта'
        : 'Нет правила для сайта';

  return (
    <div className="overlay-popup-root" data-overlay-root="route-popup">
      <div className="alpha-overlay-menu" role="menu">
        {!hasDomain && (
          <div className="alpha-overlay-menu-label">Нет активного сайта</div>
        )}
        {memoryLabel && <div className="alpha-overlay-menu-label">{memoryLabel}</div>}
        <button
          type="button"
          className={itemClass('AUTO')}
          disabled={!hasDomain}
          onClick={() => void setMode('AUTO')}
        >
          Авто
        </button>
        <button
          type="button"
          className={itemClass('DIRECT')}
          disabled={!hasDomain}
          onClick={() => void setMode('DIRECT')}
        >
          Напрямую
        </button>
        <button
          type="button"
          className={itemClass('PROXY')}
          disabled={!hasDomain}
          onClick={() => void setMode('PROXY')}
        >
          Через прокси
        </button>
        <div className="alpha-overlay-menu-sep" />
        <button
          type="button"
          className="alpha-overlay-menu-item"
          disabled={!hasDomain || !remembered}
          onClick={() => void forget()}
        >
          Забыть для этого сайта
        </button>
        <div className="alpha-overlay-menu-sep" />
        <button type="button" className="alpha-overlay-menu-item" onClick={() => void openSettings()}>
          Настройки маршрутизации…
        </button>
      </div>
    </div>
  );
}
