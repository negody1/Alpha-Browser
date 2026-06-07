import { useEffect, useState } from 'react';
import { Camera, Mic, Bell, Check, Ban, Trash2, X } from 'lucide-react';
import type { PermissionCapability, PermissionSiteEntry } from '@alpha/shared-types';

type CapState = 'allow' | 'deny' | null;

const CAPS: { id: PermissionCapability; label: string; icon: typeof Camera }[] = [
  { id: 'camera', label: 'Камера', icon: Camera },
  { id: 'microphone', label: 'Микрофон', icon: Mic },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
];

function CapCell({
  state,
  label,
  onRemove,
}: {
  state: CapState;
  label: string;
  onRemove: () => void;
}) {
  if (state == null) {
    return (
      <td className="settings-perm-cell" aria-label={`${label}: не задано`}>
        <span className="settings-perm-none">—</span>
      </td>
    );
  }
  const allowed = state === 'allow';
  return (
    <td className="settings-perm-cell">
      <button
        type="button"
        className={`settings-perm-chip ${allowed ? 'is-allow' : 'is-deny'}`}
        title={`${label}: ${allowed ? 'разрешено' : 'запрещено'} — нажмите, чтобы сбросить`}
        aria-label={`Сбросить разрешение «${label}»`}
        onClick={onRemove}
      >
        {allowed ? <Check size={15} /> : <Ban size={15} />}
        <X size={13} className="settings-perm-chip-x" />
      </button>
    </td>
  );
}

export function SitePermissionsSection() {
  const [items, setItems] = useState<PermissionSiteEntry[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  function refresh() {
    void window.alpha.permission.list().then(setItems);
  }

  useEffect(() => {
    refresh();
    return window.alpha.permission.onChanged(refresh);
  }, []);

  return (
    <div className="settings-card">
      <div className="settings-perm-head">
        <p className="settings-muted">
          Сайты, которым вы разрешили или запретили доступ к камере, микрофону и уведомлениям.
          После сброса сайт сможет запросить разрешение повторно.
        </p>
        {items.length > 0 &&
          (confirmReset ? (
            <div className="settings-confirm">
              <button type="button" className="settings-btn" onClick={() => setConfirmReset(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="settings-btn settings-btn-danger"
                onClick={() =>
                  void window.alpha.permission.clearAll().then((list) => {
                    setItems(list);
                    setConfirmReset(false);
                  })
                }
              >
                Сбросить все
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="settings-btn settings-btn-danger-ghost"
              onClick={() => setConfirmReset(true)}
            >
              Сбросить все разрешения
            </button>
          ))}
      </div>

      {items.length === 0 ? (
        <p className="settings-muted settings-empty">Сайтам пока не выданы разрешения.</p>
      ) : (
        <table className="settings-perm-table">
          <thead>
            <tr>
              <th scope="col">Сайт</th>
              {CAPS.map((c) => (
                <th key={c.id} scope="col">
                  <span className="settings-perm-th">
                    <c.icon size={15} strokeWidth={1.75} />
                    {c.label}
                  </span>
                </th>
              ))}
              <th scope="col" className="settings-perm-actions-th">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.host}>
                <th scope="row" className="settings-perm-host">
                  {entry.host}
                </th>
                {CAPS.map((c) => (
                  <CapCell
                    key={c.id}
                    state={entry[c.id]}
                    label={c.label}
                    onRemove={() =>
                      void window.alpha.permission.remove(entry.host, c.id).then(setItems)
                    }
                  />
                ))}
                <td className="settings-perm-cell settings-perm-actions">
                  <button
                    type="button"
                    className="settings-icon-btn settings-icon-btn-danger"
                    title="Удалить все разрешения сайта"
                    aria-label={`Удалить все разрешения сайта ${entry.host}`}
                    onClick={() =>
                      void window.alpha.permission.removeSite(entry.host).then(setItems)
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
