import { useEffect, useState } from 'react';
import {
  isOverlayPanelKind,
  parseOverlayPayload,
  type AdblockMenuPayload,
  type GroupMenuPayload,
  type OmniboxPopupPayload,
  type PermissionPromptPayload,
  type ScreenSharePromptPayload,
  type OverlayKind,
  type OverlayPanelPlacement,
  type OverlayStateMessage,
  type RouteMenuPayload,
  type TabMenuPayload,
} from './overlay-types';
import { DockedOverlayLayout } from './views/DockedOverlayLayout';
import { GroupsOverlay } from './views/GroupsOverlay';
import { BookmarksOverlay } from './views/BookmarksOverlay';
import { HistoryOverlay } from './views/HistoryOverlay';
import { RoutingOverlay } from './views/RoutingOverlay';
import { DownloadsOverlay } from './views/DownloadsOverlay';
import { RoutePopupOverlay } from './views/RoutePopupOverlay';
import { AdblockPopupOverlay } from './views/AdblockPopupOverlay';
import { TabMenuOverlay } from './views/TabMenuOverlay';
import { GroupMenuOverlay } from './views/GroupMenuOverlay';
import { OmniboxPopupOverlay } from './views/OmniboxPopupOverlay';
import { PermissionPopupOverlay } from './views/PermissionPopupOverlay';
import { ScreenSharePopupOverlay } from './views/ScreenSharePopupOverlay';

function readInitialState(): OverlayStateMessage {
  const params = new URLSearchParams(window.location.search);
  const kind = (params.get('kind') ?? 'groups-panel') as OverlayKind;
  const raw = params.get('payload');
  return { kind, payload: raw ? parseOverlayPayload(raw) : null };
}

export function OverlayRoot() {
  const [state, setState] = useState<OverlayStateMessage>(readInitialState);

  useEffect(() => {
    return window.alpha.overlay.onSetState((next) => {
      setState({
        kind: next.kind as OverlayKind,
        payload: next.payload ?? null,
        placement: next.placement,
      });
    });
  }, []);

  const { kind, payload } = state;

  const panelPlacement: OverlayPanelPlacement =
    state.placement ?? (kind === 'downloads-panel' ? 'right' : 'left');

  if (isOverlayPanelKind(kind)) {
    return (
      <DockedOverlayLayout placement={panelPlacement}>
        {kind === 'groups-panel' && <GroupsOverlay />}
        {kind === 'bookmarks-panel' && <BookmarksOverlay />}
        {kind === 'history-panel' && <HistoryOverlay />}
        {kind === 'routing-panel' && <RoutingOverlay />}
        {kind === 'downloads-panel' && <DownloadsOverlay />}
      </DockedOverlayLayout>
    );
  }

  if (kind === 'route-popup') {
    const p = parseOverlayPayload<RouteMenuPayload>(payload);
    if (!p) return null;
    if (p.domain === '_warmup') return <div data-overlay-root="route-popup" />;
    return <RoutePopupOverlay payload={p} />;
  }

  if (kind === 'adblock-popup') {
    const p = parseOverlayPayload<AdblockMenuPayload>(payload);
    if (!p) return null;
    return <AdblockPopupOverlay payload={p} />;
  }

  if (kind === 'tab-menu') {
    const p = parseOverlayPayload<TabMenuPayload>(payload);
    if (!p) return null;
    return <TabMenuOverlay payload={p} />;
  }

  if (kind === 'group-menu') {
    const p = parseOverlayPayload<GroupMenuPayload>(payload);
    if (!p) return null;
    return <GroupMenuOverlay payload={p} />;
  }

  if (kind === 'omnibox-popup') {
    const p = parseOverlayPayload<OmniboxPopupPayload>(payload);
    if (!p) return null;
    return <OmniboxPopupOverlay payload={p} />;
  }

  if (kind === 'permission-popup') {
    const p = parseOverlayPayload<PermissionPromptPayload>(payload);
    if (!p) return null;
    return <PermissionPopupOverlay payload={p} />;
  }

  if (kind === 'screenshare-popup') {
    const p = parseOverlayPayload<ScreenSharePromptPayload>(payload);
    if (!p) return null;
    return <ScreenSharePopupOverlay payload={p} />;
  }

  return (
    <div data-overlay-root="unknown" style={{ padding: 8, color: '#f88', fontSize: 12 }}>
      Unknown overlay kind: {kind}
    </div>
  );
}
