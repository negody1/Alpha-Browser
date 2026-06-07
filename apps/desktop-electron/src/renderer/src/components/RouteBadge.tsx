import { Globe } from 'lucide-react';
import { selectActiveTab, useBrowserStore } from '../store/tabsStore';

const SOURCE_LABEL: Record<string, string> = {
  default: 'Авто',
  'saved-rule': 'Правило сайта',
  'session-hint': 'Сессия',
  'temporary-override': 'Временно',
  fallback: 'После ошибки',
};

export function RouteBadge() {
  const activeTab = useBrowserStore(selectActiveTab);
  const rules = useBrowserStore((s) => s.routing.rules);

  // P1: the badge reflects the per-tab routing intent (source of truth for
  // transport), with the effective session shown in the tooltip.
  const routeClass = activeTab?.routeClass ?? 'AUTO';
  const partition = activeTab?.partition ?? 'DIRECT';
  const source = activeTab?.routeSource ?? 'default';
  const isError = activeTab?.routeMode === 'ERROR';
  const mode = routeClass;

  // P2-A.3 Route Memory: is the active tab's route saved for its domain?
  const domain = activeTab?.domain ?? null;
  const remembered = domain
    ? (rules.find((r) => r.domain === domain && r.route !== 'AUTO')?.route ?? null)
    : null;
  const memoryNote =
    routeClass === 'AUTO'
      ? SOURCE_LABEL[source] ?? source
      : remembered === routeClass
        ? 'Запомнено для сайта'
        : 'Только для этой вкладки';

  return (
    <button
      type="button"
      className={`route-badge ${isError ? 'route-badge-error' : ''}`}
      title={`${routeClass} → ${partition}\n${memoryNote}`}
      onClick={(e) => {
        console.log('[alpha][toolbar] route click', {
          x: e.clientX,
          y: e.clientY,
          domain: activeTab?.domain ?? null,
        });
        void window.alpha.shell.showRouteMenu(e.clientX, e.clientY);
      }}
    >
      <Globe size={12} strokeWidth={2} aria-hidden />
      <span>{mode}</span>
    </button>
  );
}
