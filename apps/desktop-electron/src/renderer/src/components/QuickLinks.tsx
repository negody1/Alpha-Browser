import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ShortcutLink } from '@alpha/shared-types';
import { useBrowserStore } from '../store/tabsStore';

function hostnameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

function faviconUrlFor(link: ShortcutLink): string | null {
  if (link.iconUrl) return link.iconUrl;
  const host = hostnameFromUrl(link.url);
  if (!host) return null;
  // Lightweight, favicon-first; falls back to initials if it fails.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? '').toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? '').toUpperCase();
  return (a + b).slice(0, 2) || '•';
}

export function QuickLinks({ onNavigate }: { onNavigate: (url: string) => Promise<void> }) {
  const shortcuts = useBrowserStore((s) => s.shortcuts);
  const [editing, setEditing] = useState<ShortcutLink | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const ordered = useMemo(() => shortcuts.slice(0, 12).sort((a, b) => a.order - b.order), [shortcuts]);

  async function saveDraft() {
    const title = draftTitle.trim();
    let url = draftUrl.trim();
    if (!title || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`; // accept "github.com"
    // Favicon resolves automatically; any existing custom icon is preserved.
    await window.alpha.shortcuts.upsert({ id: editing?.id, title, url, iconUrl: editing?.iconUrl ?? null });
    setEditing(null);
  }

  async function addShortcut() {
    setEditing({ id: '', title: '', url: '', iconUrl: null, order: 0, createdAt: '', updatedAt: '' });
    setDraftTitle('');
    setDraftUrl('');
  }

  async function removeShortcut(id: string) {
    await window.alpha.shortcuts.remove(id);
  }

  function startEdit(link: ShortcutLink) {
    setEditing(link);
    setDraftTitle(link.title);
    setDraftUrl(link.url);
  }

  function onDropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((l) => l.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    void window.alpha.shortcuts.reorder(ids);
  }

  return (
    <section className="ntp-section ntp-shortcuts" aria-label="Быстрые ссылки">
      <h2 className="ntp-section-title ntp-section-title-compact">Быстрые ссылки</h2>
      <div className="ntp-shortcuts-grid">
        {ordered.map((link) => {
          const fav = faviconUrlFor(link);
          const isBroken = broken[link.id];
          return (
            <div
              key={link.id}
              className={`ntp-shortcut ${dragId === link.id ? 'ntp-shortcut-dragging' : ''}`}
              draggable
              onDragStart={() => setDragId(link.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropOn(link.id)}
            >
              <button
                type="button"
                className="ntp-shortcut-hit"
                title={link.url}
                onClick={() => void onNavigate(link.url)}
              >
                <span className="ntp-shortcut-icon">
                  {fav && !isBroken ? (
                    <img
                      src={fav}
                      alt=""
                      width={38}
                      height={38}
                      draggable={false}
                      onError={() => setBroken((b) => ({ ...b, [link.id]: true }))}
                    />
                  ) : (
                    <span className="ntp-shortcut-initials">{initials(link.title)}</span>
                  )}
                </span>
                <span className="ntp-shortcut-label">{link.title}</span>
              </button>

              <div className="ntp-shortcut-actions" aria-hidden={false}>
                <button
                  type="button"
                  className="ntp-shortcut-action"
                  title="Редактировать"
                  onClick={() => startEdit(link)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="ntp-shortcut-action ntp-shortcut-action-danger"
                  title="Удалить"
                  onClick={() => void removeShortcut(link.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="ntp-shortcut ntp-shortcut-add"
          onClick={() => void addShortcut()}
          title="Добавить сайт"
        >
          <span className="ntp-shortcut-icon">
            <Plus size={24} strokeWidth={2} />
          </span>
          <span className="ntp-shortcut-label">Добавить сайт</span>
        </button>
      </div>

      {editing !== null && (
        <div className="ntp-shortcuts-editor" role="dialog" aria-label="Редактирование ссылки">
          <div className="ntp-shortcuts-editor-row">
            <label>
              <span>Название</span>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Напр. GitHub"
              />
            </label>
            <label>
              <span>URL</span>
              <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="github.com" />
            </label>
          </div>
          <p className="ntp-shortcuts-editor-hint">Иконку сайта браузер подберёт автоматически.</p>
          <div className="ntp-shortcuts-editor-actions">
            <button type="button" className="ntp-shortcuts-editor-btn primary" onClick={() => void saveDraft()}>
              Сохранить
            </button>
            <button type="button" className="ntp-shortcuts-editor-btn" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

