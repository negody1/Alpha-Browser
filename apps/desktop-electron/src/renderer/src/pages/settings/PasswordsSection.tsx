import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Eye, EyeOff, Copy, Pencil, Trash2, Check, X } from 'lucide-react';
import type { PasswordEntryMetadata } from '@alpha/shared-types';

type SortMode = 'site' | 'recent';

const REVEAL_MS = 10_000;

function hostLabel(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin.replace(/^https?:\/\//, '');
  }
}

function initial(origin: string): string {
  const h = hostLabel(origin).replace(/^www\./, '');
  return (h[0] ?? '?').toUpperCase();
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export function PasswordsSection() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [items, setItems] = useState<PasswordEntryMetadata[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('site');

  function refresh() {
    void window.alpha.passwords.isAvailable().then(setAvailable);
    void window.alpha.passwords.listMetadata().then(setItems);
  }

  useEffect(() => {
    refresh();
    return window.alpha.passwords.onChanged(refresh);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (e) => hostLabel(e.origin).toLowerCase().includes(q) || e.username.toLowerCase().includes(q),
        )
      : items;
    const sorted = [...filtered];
    if (sort === 'site') {
      sorted.sort((a, b) => hostLabel(a.origin).localeCompare(hostLabel(b.origin)) || a.username.localeCompare(b.username));
    } else {
      sorted.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    return sorted;
  }, [items, query, sort]);

  if (available === false) {
    return (
      <div className="settings-card settings-pw-unavailable">
        <strong>Сохранение паролей недоступно</strong>
        <p className="settings-muted">
          Хранилище секретов операционной системы недоступно на этом устройстве, поэтому
          пароли не сохраняются и не могут быть показаны.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="settings-pw-tools">
        <label className="settings-search settings-search-inline">
          <Search size={16} strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            placeholder="Поиск по сайту или логину"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="settings-segment" role="group" aria-label="Сортировка">
          <button
            type="button"
            className={sort === 'site' ? 'is-active' : ''}
            onClick={() => setSort('site')}
          >
            По сайту
          </button>
          <button
            type="button"
            className={sort === 'recent' ? 'is-active' : ''}
            onClick={() => setSort('recent')}
          >
            Недавние
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="settings-muted settings-empty">Сохранённых паролей пока нет.</p>
      ) : visible.length === 0 ? (
        <p className="settings-muted settings-empty">Ничего не найдено.</p>
      ) : (
        <ul className="settings-pw-list">
          {visible.map((e) => (
            <PasswordRow key={e.id} entry={e} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PasswordRow({ entry, onChanged }: { entry: PasswordEntryMetadata; onChanged: () => void }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState<'login' | 'password' | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  function flashCopied(kind: 'login' | 'password') {
    setCopied(kind);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  async function ensureSecret(): Promise<string | null> {
    if (revealed != null) return revealed;
    return window.alpha.passwords.reveal(entry.id);
  }

  async function toggleReveal() {
    if (revealed != null) {
      setRevealed(null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    const secret = await window.alpha.passwords.reveal(entry.id);
    if (secret == null) return;
    setRevealed(secret);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
  }

  async function copyLogin() {
    if (!entry.username) return;
    try {
      await navigator.clipboard.writeText(entry.username);
      flashCopied('login');
    } catch {
      // ignore clipboard failures
    }
  }

  async function copyPassword() {
    const secret = await ensureSecret();
    if (secret == null) return;
    try {
      await navigator.clipboard.writeText(secret);
      flashCopied('password');
    } catch {
      // ignore
    }
  }

  if (editing) {
    return (
      <li className="settings-pw-item">
        <PasswordEditor
          entry={entry}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setRevealed(null);
            onChanged();
          }}
        />
      </li>
    );
  }

  return (
    <li className="settings-pw-item">
      <div className="settings-pw-avatar" aria-hidden>
        {initial(entry.origin)}
      </div>
      <div className="settings-pw-main">
        <strong className="settings-pw-host">{hostLabel(entry.origin)}</strong>
        <div className="settings-pw-sub">
          <span className="settings-pw-username">{entry.username || '(без логина)'}</span>
          <span className="settings-pw-secret">
            {revealed != null ? revealed : '••••••••••'}
          </span>
        </div>
        {formatDate(entry.updatedAt) && (
          <span className="settings-muted settings-pw-date">Изменён {formatDate(entry.updatedAt)}</span>
        )}
      </div>

      <div className="settings-pw-actions">
        <button
          type="button"
          className="settings-icon-btn"
          title={entry.username ? 'Скопировать логин' : 'Логин отсутствует'}
          aria-label="Скопировать логин"
          disabled={!entry.username}
          onClick={() => void copyLogin()}
        >
          {copied === 'login' ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button
          type="button"
          className="settings-icon-btn"
          title={revealed != null ? 'Скрыть пароль' : 'Показать пароль'}
          aria-label={revealed != null ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => void toggleReveal()}
        >
          {revealed != null ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          className="settings-icon-btn"
          title="Скопировать пароль"
          aria-label="Скопировать пароль"
          onClick={() => void copyPassword()}
        >
          {copied === 'password' ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button
          type="button"
          className="settings-icon-btn"
          title="Изменить"
          aria-label="Изменить"
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} />
        </button>
        {confirmDelete ? (
          <div className="settings-confirm">
            <button type="button" className="settings-icon-btn" title="Отмена" onClick={() => setConfirmDelete(false)}>
              <X size={16} />
            </button>
            <button
              type="button"
              className="settings-icon-btn settings-icon-btn-danger"
              title="Подтвердить удаление"
              onClick={() =>
                void window.alpha.passwords.delete(entry.id).then(() => {
                  setConfirmDelete(false);
                  onChanged();
                })
              }
            >
              <Check size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="settings-icon-btn settings-icon-btn-danger"
            title="Удалить"
            aria-label="Удалить"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

function PasswordEditor({
  entry,
  onCancel,
  onSaved,
}: {
  entry: PasswordEntryMetadata;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(entry.username);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const payload: { username?: string; password?: string } = {};
    if (username.trim() !== entry.username) payload.username = username.trim();
    if (password.length > 0) payload.password = password;
    if (payload.username == null && payload.password == null) {
      onCancel();
      return;
    }
    setSaving(true);
    const ok = await window.alpha.passwords.update(entry.id, payload);
    setSaving(false);
    if (ok) onSaved();
  }

  return (
    <div className="settings-pw-editor">
      <div className="settings-pw-editor-head">{hostLabel(entry.origin)}</div>
      <label className="settings-field">
        <span>Логин</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин" />
      </label>
      <label className="settings-field">
        <span>Новый пароль</span>
        <div className="settings-pw-input">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Оставьте пустым, чтобы не менять"
          />
          <button
            type="button"
            className="settings-icon-btn"
            title={showPw ? 'Скрыть' : 'Показать'}
            onClick={() => setShowPw((v) => !v)}
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>
      <div className="settings-pw-editor-actions">
        <button type="button" className="settings-btn" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
        <button type="button" className="settings-btn settings-btn-primary" onClick={() => void save()} disabled={saving}>
          Сохранить
        </button>
      </div>
    </div>
  );
}
