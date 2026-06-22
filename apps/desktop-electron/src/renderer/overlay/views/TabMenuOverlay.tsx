import { GROUP_COLOR_PRESETS } from '@alpha/shared-types';
import type { TabMenuPayload } from '../overlay-types';

async function closePopup() {
  await window.alpha.overlay.closePopup();
}

export function TabMenuOverlay({ payload }: { payload: TabMenuPayload }) {
  const { tabId, tabKind, inGroup, otherGroups, hasGroups, groups } = payload;

  return (
    <div className="overlay-popup-root" data-overlay-root="tab-menu">
      <div className="alpha-overlay-menu" role="menu">
        <button
          type="button"
          className="alpha-overlay-menu-item"
          onClick={() => void window.alpha.tabs.close(tabId).then(closePopup)}
        >
          Закрыть
        </button>
        <button
          type="button"
          className="alpha-overlay-menu-item"
          onClick={() => void window.alpha.tabs.closeOthers(tabId).then(closePopup)}
        >
          Закрыть другие
        </button>
        <button
          type="button"
          className="alpha-overlay-menu-item"
          onClick={() => void window.alpha.tabs.closeToRight(tabId).then(closePopup)}
        >
          Закрыть вкладки справа
        </button>
        <div className="alpha-overlay-menu-sep" />
        <button
          type="button"
          className="alpha-overlay-menu-item"
          disabled={tabKind !== 'web'}
          onClick={() => void window.alpha.tabs.duplicate(tabId).then(closePopup)}
        >
          Дублировать
        </button>
        <div className="alpha-overlay-menu-sep" />
        {inGroup ? (
          <>
            <button
              type="button"
              className="alpha-overlay-menu-item"
              onClick={() => void window.alpha.sessionGroups.removeTab(tabId).then(closePopup)}
            >
              Удалить из группы
            </button>
            {otherGroups.length > 0 && (
              <>
                <div className="alpha-overlay-menu-label">Переместить в группу</div>
                {otherGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="alpha-overlay-menu-item"
                    onClick={() =>
                      void window.alpha.sessionGroups.addTab(g.id, tabId).then(async () => {
                        if (g.collapsed) await window.alpha.sessionGroups.toggleCollapsed(g.id);
                        await closePopup();
                      })
                    }
                  >
                    {g.title}
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="alpha-overlay-menu-item"
              onClick={() =>
                void window.alpha.sessionGroups
                  .create({
                    title: 'Группа',
                    color: GROUP_COLOR_PRESETS[groups.length % GROUP_COLOR_PRESETS.length],
                    tabIds: [tabId],
                  })
                  .then(closePopup)
              }
            >
              Добавить вкладку в новую группу
            </button>
            {hasGroups && (
              <>
                <div className="alpha-overlay-menu-label">Добавить в группу</div>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="alpha-overlay-menu-item"
                    onClick={() =>
                      void window.alpha.sessionGroups.addTab(g.id, tabId).then(async () => {
                        if (g.collapsed) await window.alpha.sessionGroups.toggleCollapsed(g.id);
                        await closePopup();
                      })
                    }
                  >
                    {g.title}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
