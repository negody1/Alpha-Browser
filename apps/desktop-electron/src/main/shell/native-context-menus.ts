/** ZONE 1 native menus for tab/group — never React ContextMenu over content. */
import { Menu, dialog, type BrowserWindow, type WebContents } from 'electron';
import { GROUP_COLOR_PALETTE, GROUP_COLOR_PRESETS } from '@alpha/shared-types';
import type { TabManager } from '../tabs/TabManager';

function buildColorSubmenu(
  manager: TabManager,
  groupId: string,
): Electron.MenuItemConstructorOptions[] {
  return GROUP_COLOR_PALETTE.map(({ value, label }) => ({
    label,
    click: () => {
      manager.setSessionGroupColor(groupId, value);
    },
  }));
}

function buildMoveToGroupSubmenu(
  manager: TabManager,
  tabId: string,
  groups: Array<{ id: string; title: string; collapsed: boolean }>,
): Electron.MenuItemConstructorOptions[] {
  return groups.map((g) => ({
    label: g.title,
    click: () => {
      manager.addTabToSessionGroup(g.id, tabId);
      if (g.collapsed) manager.toggleSessionGroupCollapsed(g.id);
    },
  }));
}

export function showTabNativeContextMenu(
  window: BrowserWindow,
  manager: TabManager,
  tabId: string,
  x: number,
  y: number,
): void {
  const state = manager.getState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const sessionGroups = state.sessionGroups;
  const inGroup = !!tab.sessionGroupId;
  const otherGroups = sessionGroups.filter((g) => g.id !== tab.sessionGroupId);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Дублировать',
      enabled: tab.kind === 'web',
      click: () => {
        manager.duplicateTab(tabId);
      },
    },
  ];

  if (inGroup) {
    template.push({
      label: 'Удалить из группы',
      click: () => {
        manager.removeTabFromSessionGroup(tabId);
      },
    });
    if (otherGroups.length > 0) {
      template.push({
        label: 'Переместить в другую группу вкладок',
        submenu: buildMoveToGroupSubmenu(manager, tabId, otherGroups),
      });
    }
  } else {
    template.push({
      label: 'Добавить вкладку в новую группу',
      click: () => {
        manager.createSessionGroup({
          title: 'Группа',
          color: GROUP_COLOR_PRESETS[sessionGroups.length % GROUP_COLOR_PRESETS.length],
          tabIds: [tabId],
        });
      },
    });
    if (sessionGroups.length > 0) {
      template.push({
        label: 'Добавить в группу вкладок',
        submenu: buildMoveToGroupSubmenu(manager, tabId, sessionGroups),
      });
    }
  }

  Menu.buildFromTemplate(template).popup({ window, x, y });
}

export function showGroupNativeContextMenu(
  window: BrowserWindow,
  manager: TabManager,
  chromeWebContents: WebContents,
  groupId: string,
  x: number,
  y: number,
): void {
  const state = manager.getState();
  const group = state.sessionGroups.find((g) => g.id === groupId);
  if (!group) return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: group.collapsed ? 'Развернуть' : 'Свернуть',
      click: () => {
        manager.toggleSessionGroupCollapsed(groupId);
      },
    },
    {
      label: 'Переименовать',
      click: () => {
        chromeWebContents.send('shell:start-group-rename', { groupId });
      },
    },
    {
      label: 'Цвет',
      submenu: buildColorSubmenu(manager, groupId),
    },
    {
      label: 'Разгруппировать',
      click: () => {
        manager.ungroupSessionGroup(groupId);
      },
    },
    { type: 'separator' },
    {
      label: 'Закрыть группу',
      enabled: group.tabIds.length > 0,
      click: () => {
        const result = dialog.showMessageBoxSync(window, {
          type: 'warning',
          buttons: ['Отмена', 'Закрыть'],
          defaultId: 0,
          cancelId: 0,
          message: 'Закрыть группу и все вкладки внутри?',
        });
        if (result === 1) {
          manager.closeSessionGroup(groupId);
        }
      },
    },
  ];

  Menu.buildFromTemplate(template).popup({ window, x, y });
}
