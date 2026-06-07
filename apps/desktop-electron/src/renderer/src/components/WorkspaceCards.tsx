import { useState } from 'react';
import { Check, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { GROUP_COLOR_PALETTE } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';

function tabsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вкладка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} вкладки`;
  return `${n} вкладок`;
}

export function WorkspaceCards() {
  const sessionGroups = useBrowserStore((s) => s.sessionGroups);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(id: string, title: string) {
    setConfirmId(null);
    setEditId(id);
    setDraft(title);
  }

  function commitRename(id: string) {
    const title = draft.trim();
    if (title) {
      void window.alpha.sessionGroups.rename(id, title);
    }
    setEditId(null);
  }

  return (
    <section className="ntp-workspaces" aria-label="Группы вкладок">
      <div className="ntp-panels ntp-panels-single">
        <div className="ntp-panel" aria-label="Группы вкладок">
          <div className="ntp-panel-head">
            <span className="ntp-panel-icon" aria-hidden>
              <Layers size={17} strokeWidth={1.75} />
            </span>
            <h2 className="ntp-panel-title">Группы вкладок</h2>
          </div>

          <div className="ntp-groups-grid">
            {sessionGroups.map((group) => {
              const openCount = group.tabIds.length;
              const isOpen = openCount > 0;
              const count = isOpen ? openCount : group.urls.length;

              if (confirmId === group.id) {
                return (
                  <div
                    key={group.id}
                    className="ntp-group-card ntp-group-card-confirm"
                    role="dialog"
                  >
                    <p className="ntp-row-confirm-text">Удалить группу «{group.title}»?</p>
                    <div className="ntp-row-confirm-actions">
                      <button
                        type="button"
                        className="ntp-confirm-btn"
                        onClick={() => setConfirmId(null)}
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        className="ntp-confirm-btn ntp-confirm-btn-danger"
                        onClick={() => {
                          void window.alpha.sessionGroups.delete(group.id);
                          setConfirmId(null);
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                );
              }

              if (editId === group.id) {
                return (
                  <div key={group.id} className="ntp-group-card ntp-group-card-edit">
                    <input
                      className="ntp-row-edit-input"
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
                    <div className="ntp-row-colors">
                      {GROUP_COLOR_PALETTE.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`ntp-row-color${group.color === value ? ' ntp-row-color-active' : ''}`}
                          style={{ background: value }}
                          title={label}
                          aria-label={label}
                          onClick={() => void window.alpha.sessionGroups.setColor(group.id, value)}
                        />
                      ))}
                      <button
                        type="button"
                        className="ntp-row-edit-done"
                        title="Готово"
                        aria-label="Готово"
                        onClick={() => commitRename(group.id)}
                      >
                        <Check size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={group.id}
                  className={`ntp-group-card${isOpen ? ' ntp-group-card-open' : ''}`}
                >
                  <button
                    type="button"
                    className="ntp-group-hit"
                    title={isOpen ? `Перейти к «${group.title}»` : `Открыть «${group.title}»`}
                    onClick={() => void window.alpha.sessionGroups.open(group.id)}
                  >
                    <span className="ntp-group-head">
                      <span className="ntp-group-dot" style={{ background: group.color }} />
                      <span className="ntp-group-name">{group.title}</span>
                    </span>
                    <span className="ntp-group-meta">
                      {count > 0 ? tabsLabel(count) : 'пусто'}
                      {isOpen ? ' · открыта' : ''}
                    </span>
                  </button>
                  <div className="ntp-group-actions">
                    <button
                      type="button"
                      className="ntp-group-act"
                      title="Редактировать"
                      aria-label="Редактировать группу"
                      onClick={() => startEdit(group.id, group.title)}
                    >
                      <Pencil size={13} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className="ntp-group-act ntp-group-act-del"
                      title="Удалить группу"
                      aria-label="Удалить группу"
                      onClick={() => setConfirmId(group.id)}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              className="ntp-group-add"
              onClick={() => void window.alpha.sessionGroups.createWithNewTab()}
            >
              <Plus size={18} strokeWidth={2} aria-hidden />
              Создать группу
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
