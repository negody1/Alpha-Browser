import type { AdblockMenuPayload } from '../overlay-types';

async function closePopup() {
  await window.alpha.overlay.closePopup();
}

export function AdblockPopupOverlay({ payload }: { payload: AdblockMenuPayload }) {
  const { domain, hasDomain, adblockOn, siteDisabled, blockedOnTab, blockedTotal, hasAdblock } =
    payload;

  return (
    <div className="overlay-popup-root" data-overlay-root="adblock-popup">
      <div className="alpha-overlay-menu" role="menu">
        <div className="alpha-overlay-menu-label">
          Заблокировано: {blockedOnTab} на вкладке · {blockedTotal} всего
        </div>
        <button
          type="button"
          className="alpha-overlay-menu-item"
          disabled={!hasAdblock}
          onClick={() => {
            if (!hasAdblock) return;
            void window.alpha.adblock.setEnabled(true).then(closePopup);
          }}
        >
          {adblockOn ? 'AdBlock: включён глобально' : 'AdBlock: включить глобально'}
        </button>
        <button
          type="button"
          className="alpha-overlay-menu-item"
          disabled={!hasAdblock}
          onClick={() => {
            if (!hasAdblock) return;
            void window.alpha.adblock.setEnabled(false).then(closePopup);
          }}
        >
          AdBlock: выключить глобально
        </button>
        <div className="alpha-overlay-menu-sep" />
        <button
          type="button"
          className="alpha-overlay-menu-item"
          disabled={!hasAdblock || !hasDomain}
          onClick={() => {
            if (!hasAdblock || !domain) return;
            void window.alpha.adblock.setEnabled(true).then(() =>
              window.alpha.adblock.setSiteDisabled(domain, !siteDisabled).then(closePopup),
            );
          }}
        >
          {adblockOn && !siteDisabled
            ? 'AdBlock: выкл. на этом сайте'
            : 'AdBlock: вкл. на этом сайте'}
        </button>
      </div>
    </div>
  );
}
