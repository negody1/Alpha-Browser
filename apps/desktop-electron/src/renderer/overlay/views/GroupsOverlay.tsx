import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { GROUP_COLOR_PALETTE, type SessionGroup } from '@alpha/shared-types';
import { PanelChrome } from './PanelChrome';

function tabsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вкладка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} вкладки`;
  return `${n} вкладок`;
}

export function GroupsOverlay() {
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const load = () =>
      void window.alpha.tabs.getState().then((s) => setSessionGroups(s.sessionGroups));
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  function close() {
    void window.alpha.overlay.closePanel();
  }

  function openGroup(groupId: string) {
    void window.alpha.sessionGroups.open(groupId).then(close);
  }

  function startEdit(id: string, title: string) {
    setConfirmId(null);
    setEditId(id);
    setDraft(title);
  }

  function commitRename(id: string) {
    const title = draft.trim();
    if (title) {
      void window.alpha.sessionGroups.rename(id, title).then((s) => setSessionGroups(s.sessionGroups));
    }
    setEditId(null);
  }

  function setColor(id: string, value: string) {
    void window.alpha.sessionGroups.setColor(id, value).then((s) => setSessionGroups(s.sessionGroups));
  }

  return (
    <PanelChrome title="Группы вкладок" onClose={close}>
      {sessionGroups.length > 0 ? (
        <ul className="overlay-groups">
          {sessionGroups.map((group) => {
            const openCount = group.tabIds.length;
            const isOpen = openCount > 0;
            const count = isOpen ? openCount : group.urls.length;

            if (confirmId === group.id) {
              return (
                <li key={group.id} className="overlay-group-confirm">
                  <span className="overlay-group-confirm-text">Удалить «{group.title}»?</span>
                  <div className="overlay-group-confirm-actions">
                    <button
                      type="button"
                      className="overlay-mini-btn"
                      onClick={() => setConfirmId(null)}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="overlay-mini-btn overlay-mini-btn-danger"
                      onClick={() => {
                        void window.alpha.sessionGroups
                          .delete(group.id)
                          .then((s) => setSessionGroups(s.sessionGroups));
                        setConfirmId(null);
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            }

            if (editId === group.id) {
              return (
                <li key={group.id} className="overlay-group-edit">
                  <input
                    className="overlay-group-edit-input"
                    value={draft}
                    maxLength={40}
                    autoFocus
                    spellCheck={false}
                    placeholder="Название группы"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(group.id);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                  />
                  <div className="overlay-group-colors">
                    {GROUP_COLOR_PALETTE.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`overlay-group-color${group.color === value ? ' overlay-group-color-active' : ''}`}
                        style={{ background: value }}
                        title={label}
                        aria-label={label}
                        onClick={() => setColor(group.id, value)}
                      />
                    ))}
                    <button
                      type="button"
                      className="overlay-group-edit-done"
                      title="Готово"
                      aria-label="Готово"
                      onClick={() => commitRename(group.id)}
                    >
                      <Check size={15} strokeWidth={2} />
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li key={group.id} className="overlay-group-row">
                <button
                  type="button"
                  className="overlay-group-hit"
                  title={isOpen ? `Перейти к «${group.title}»` : `Открыть «${group.title}»`}
                  onClick={() => openGroup(group.id)}
                >
                  <span className="overlay-dot" style={{ background: group.color }} />
                  <span className="overlay-group-text">
                    <strong>{group.title}</strong>
                    <small>
                      {count > 0 ? tabsLabel(count) : 'пусто'}
                      {isOpen ? ' · открыта' : ''}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="overlay-group-icon"
                  title="Редактировать"
                  aria-label="Редактировать группу"
                  onClick={() => startEdit(group.id, group.title)}
                >
                  <Pencil size={15} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="overlay-group-del"
                  title="Удалить группу"
                  aria-label="Удалить группу"
                  onClick={() => setConfirmId(group.id)}
                >
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="overlay-hint">
          Пока нет групп. Создайте группу — она сохранится и останется здесь после перезапуска.
        </p>
      )}

      <button
        type="button"
        className="overlay-btn overlay-btn-primary overlay-btn-block"
        onClick={() => {
          void window.alpha.sessionGroups.createWithNewTab().then(close);
        }}
      >
        <Plus size={16} strokeWidth={2} aria-hidden />
        Создать группу
      </button>
    </PanelChrome>
  );
}
