import { X } from 'lucide-react';
import { useBrowserStore } from '../store/tabsStore';

function tabsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вкладка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} вкладки`;
  return `${n} вкладок`;
}

export function GroupsPanel({ embedded = false }: { embedded?: boolean }) {
  const open = useBrowserStore((s) => s.groupsPanelOpen);
  const setOpen = useBrowserStore((s) => s.setGroupsPanelOpen);
  const sessionGroups = useBrowserStore((s) => s.sessionGroups);
  const savedGroups = useBrowserStore((s) => s.savedGroups);

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

  function openSessionGroup(tabIds: string[]) {
    const firstTabId = tabIds[0];
    if (firstTabId) {
      void window.alpha.tabs.switch(firstTabId);
      closePanel();
    }
  }

  return (
    <aside className="groups-panel" aria-label="Группы вкладок">
      <header className="groups-panel-header">
        <h2>Группы вкладок</h2>
        <button type="button" className="shell-icon-btn" aria-label="Закрыть" onClick={closePanel}>
          <X size={18} />
        </button>
      </header>

      <div className="groups-panel-body">
        {sessionGroups.length > 0 ? (
          <ul className="groups-panel-list">
            {sessionGroups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="groups-panel-item"
                  onClick={() => openSessionGroup(group.tabIds)}
                >
                  <span className="groups-panel-dot" style={{ background: group.color }} />
                  <span className="groups-panel-item-text">
                    <strong>{group.title}</strong>
                    <small>{tabsLabel(group.tabIds.length)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="groups-panel-hint">
            Пока нет групп. Создайте группу: новая вкладка внутри группы, без ввода URL.
          </p>
        )}

        <div className="groups-panel-actions">
          <button
            type="button"
            className="workspace-btn workspace-btn-primary"
            onClick={() => void window.alpha.sessionGroups.createWithNewTab()}
          >
            Создать группу вкладок
          </button>
        </div>

        {savedGroups.length > 0 && (
          <>
            <h3 className="groups-panel-subtitle">Сохранённые наборы сайтов</h3>
            <ul className="groups-panel-list">
              {savedGroups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="groups-panel-item"
                    onClick={() => void window.alpha.savedGroups.open(g.id)}
                  >
                    <span className="groups-panel-dot" style={{ background: g.color }} />
                    <span className="groups-panel-item-text">
                      <strong>{g.title}</strong>
                      <small>{g.urls.length} сайтов</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
