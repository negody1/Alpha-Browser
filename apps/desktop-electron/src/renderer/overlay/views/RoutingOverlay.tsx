import { PanelChrome } from './PanelChrome';
import { RoutingSettingsContent } from './RoutingSettingsContent';

export function RoutingOverlay() {
  function close() {
    void window.alpha.overlay.closePanel();
  }

  return (
    <PanelChrome title="Маршрутизация" onClose={close}>
      <RoutingSettingsContent />
    </PanelChrome>
  );
}
