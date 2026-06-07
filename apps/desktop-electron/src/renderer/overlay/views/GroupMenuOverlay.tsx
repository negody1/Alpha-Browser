import { GROUP_COLOR_PALETTE } from '@alpha/shared-types';
import type { GroupMenuPayload } from '../overlay-types';

async function closePopup() {
  await window.alpha.overlay.closePopup();
}

export function GroupMenuOverlay({ payload }: { payload: GroupMenuPayload }) {
  const { groupId, tabCount, groupColor } = payload;

  return (
    <div className="overlay-popup-root" data-overlay-root="group-menu">
      <div className="alpha-overlay-menu" role="menu">
        <button
          type="button"
          className="alpha-overlay-menu-item"
          onClick={async () => {
            await closePopup();
            await window.alpha.shell.requestGroupRename(groupId);
          }}
        >
          Переименовать
        </button>
        <div className="alpha-overlay-menu-label">Цвет</div>
        <div className="alpha-overlay-color-row">
          {GROUP_COLOR_PALETTE.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`alpha-overlay-color-swatch ${groupColor === value ? 'alpha-overlay-color-swatch-active' : ''}`}
              style={{ background: value }}
              title={label}
              aria-label={label}
              onClick={() => void window.alpha.sessionGroups.setColor(groupId, value).then(closePopup)}
            />
          ))}
        </div>
        <div className="alpha-overlay-menu-sep" />
        <button
          type="button"
          className="alpha-overlay-menu-item"
          onClick={() => void window.alpha.sessionGroups.ungroup(groupId).then(closePopup)}
        >
          Разгруппировать
        </button>
        <button
          type="button"
          className="alpha-overlay-menu-item alpha-overlay-menu-item-danger"
          disabled={tabCount === 0}
          onClick={() => void window.alpha.overlay.confirmCloseGroup(groupId).then(closePopup)}
        >
          Закрыть группу
        </button>
      </div>
    </div>
  );
}
