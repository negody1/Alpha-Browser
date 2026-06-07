import { Bell, Camera, Mic } from 'lucide-react';
import type { PermissionCapability } from '@alpha/shared-types';
import type { PermissionPromptPayload } from '../overlay-types';

const CAPABILITY_META: Record<
  PermissionCapability,
  { label: string; icon: typeof Camera }
> = {
  camera: { label: 'Камеру', icon: Camera },
  microphone: { label: 'Микрофон', icon: Mic },
  notifications: { label: 'Уведомления', icon: Bell },
};

export function PermissionPopupOverlay({ payload }: { payload: PermissionPromptPayload }) {
  const { requestId, host, capabilities } = payload;

  const decide = (allow: boolean) => {
    void window.alpha.permission.resolve(requestId, allow);
  };

  return (
    <div className="overlay-popup-root" data-overlay-root="permission-popup">
      <div className="permission-pop" role="dialog" aria-label="Запрос разрешения">
        <div className="permission-pop-host">{host}</div>
        <div className="permission-pop-label">Запрашивает доступ:</div>
        <ul className="permission-pop-caps">
          {capabilities.map((cap) => {
            const meta = CAPABILITY_META[cap];
            const Icon = meta.icon;
            return (
              <li key={cap} className="permission-pop-cap">
                <Icon size={16} strokeWidth={1.75} />
                <span>{meta.label}</span>
              </li>
            );
          })}
        </ul>
        <div className="permission-pop-actions">
          <button
            type="button"
            className="permission-pop-btn permission-pop-btn-deny"
            onClick={() => decide(false)}
          >
            Запретить
          </button>
          <button
            type="button"
            className="permission-pop-btn permission-pop-btn-allow"
            onClick={() => decide(true)}
          >
            Разрешить
          </button>
        </div>
      </div>
    </div>
  );
}
