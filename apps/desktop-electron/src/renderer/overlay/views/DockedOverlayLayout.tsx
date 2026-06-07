import type { ReactNode } from 'react';
import type { OverlayPanelPlacement } from '../overlay-types';

export function DockedOverlayLayout({
  children,
  placement = 'left',
}: {
  children: ReactNode;
  placement?: OverlayPanelPlacement;
}) {
  return (
    <div
      className={`overlay-docked-root overlay-docked-root--${placement}`}
      data-overlay-root="docked"
      data-overlay-placement={placement}
    >
      <div className="overlay-docked-panel">{children}</div>
    </div>
  );
}
