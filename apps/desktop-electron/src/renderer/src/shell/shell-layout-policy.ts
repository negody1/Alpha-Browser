/**
 * Side panel open/close flags. Geometry (widths, WCV bounds) lives in CHROME_LAYOUT
 * + getWebContentBounds — this module only owns mutual-exclusion of panel flags.
 */

export interface SidePanelFlags {
  groupsPanelOpen: boolean;
  routingSettingsOpen: boolean;
  bookmarksPanelOpen: boolean;
  historyPanelOpen: boolean;
  downloadsPanelOpen: boolean;
}

export function closeAllSidePanels(): Pick<
  SidePanelFlags,
  | 'groupsPanelOpen'
  | 'routingSettingsOpen'
  | 'bookmarksPanelOpen'
  | 'historyPanelOpen'
  | 'downloadsPanelOpen'
> {
  return {
    groupsPanelOpen: false,
    routingSettingsOpen: false,
    bookmarksPanelOpen: false,
    historyPanelOpen: false,
    downloadsPanelOpen: false,
  };
}
