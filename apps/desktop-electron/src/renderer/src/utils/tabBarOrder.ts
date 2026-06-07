import type { SessionGroup, TabSnapshot } from '@alpha/shared-types';

export type TabBarItem =
  | { type: 'tab'; tab: TabSnapshot }
  | { type: 'group-header'; group: SessionGroup }
  | { type: 'group-collapsed'; group: SessionGroup };

function resolveGroupTabIds(group: SessionGroup, tabs: TabSnapshot[]): string[] {
  const fromGroup = group.tabIds.filter((id) => tabs.some((t) => t.id === id));
  if (fromGroup.length > 0) return fromGroup;
  return tabs.filter((t) => t.sessionGroupId === group.id).map((t) => t.id);
}

export function buildTabBarItems(
  tabs: TabSnapshot[],
  sessionGroups: SessionGroup[],
): TabBarItem[] {
  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const groupedTabIds = new Set<string>();
  const items: TabBarItem[] = [];

  for (const group of sessionGroups) {
    const memberIds = resolveGroupTabIds(group, tabs);
    for (const tabId of memberIds) {
      groupedTabIds.add(tabId);
    }

    const groupWithIds = { ...group, tabIds: memberIds };

    if (group.collapsed) {
      if (memberIds.length > 0) {
        items.push({ type: 'group-collapsed', group: groupWithIds });
      }
      continue;
    }

    if (memberIds.length > 0) {
      items.push({ type: 'group-header', group: groupWithIds });
    }

    for (const tabId of memberIds) {
      const tab = tabById.get(tabId);
      if (tab) {
        items.push({ type: 'tab', tab });
      }
    }
  }

  for (const tab of tabs) {
    if (!groupedTabIds.has(tab.id)) {
      items.push({ type: 'tab', tab });
    }
  }

  return items;
}
