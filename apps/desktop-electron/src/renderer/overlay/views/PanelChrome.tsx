import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function PanelChrome({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay-panel">
      <header className="overlay-panel-header">
        <h2>{title}</h2>
        <button type="button" className="overlay-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="overlay-panel-body">{children}</div>
    </div>
  );
}
