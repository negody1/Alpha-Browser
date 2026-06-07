import React from 'react';
import { ChevronDown, ChevronRight, Layers, Loader2, Plus, Volume2, VolumeX, X } from 'lucide-react';
import { useBrowserStore } from '../store/tabsStore';
import { buildTabBarItems } from '../utils/tabBarOrder';
import { TabFavicon } from './TabFavicon';

export function TabBar() {
  const tabs = useBrowserStore((s) => s.tabs);
  const sessionGroups = useBrowserStore((s) => s.sessionGroups);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const items = buildTabBarItems(tabs, sessionGroups);
  const [dragTabId, setDragTabId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<null | { tabId: string; side: 'before' | 'after' }>(
    null,
  );
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [draftGroupTitle, setDraftGroupTitle] = React.useState('');

  React.useEffect(() => {
    return window.alpha.shell.onStartGroupRename((groupId) => {
      const group = sessionGroups.find((g) => g.id === groupId);
      if (!group) return;
      setEditingGroupId(groupId);
      setDraftGroupTitle(group.title);
    });
  }, [sessionGroups]);

  function onGroupChipClick(group: { id: string; collapsed: boolean }) {
    void window.alpha.sessionGroups.toggleCollapsed(group.id);
  }

  function openGroupContextMenu(e: React.MouseEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    void window.alpha.shell.showGroupContextMenu(groupId, e.clientX, e.clientY);
  }

  function openTabContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    void window.alpha.shell.showTabContextMenu(tabId, e.clientX, e.clientY);
  }

  function orderedTabIdsFromItems() {
    return items.filter((i) => i.type === 'tab').map((i: any) => i.tab.id) as string[];
  }

  function findTab(tabId: string) {
    return tabs.find((t) => t.id === tabId) ?? null;
  }

  function saveGroupTitle(groupId: string) {
    const next = draftGroupTitle.trim().slice(0, 40);
    setEditingGroupId(null);
    if (!next) return;
    void window.alpha.sessionGroups.rename(groupId, next);
  }

  return (
    <div className="shell-tab-bar" role="tablist" aria-label="Вкладки">
      <div
        className="shell-tab-strip"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const el = e.target as Element | null;
          if (el?.closest('.shell-tab') || el?.closest('.shell-group-chip')) return;
          if (!dragTabId) return;
          const t = findTab(dragTabId);
          if (t?.sessionGroupId) void window.alpha.sessionGroups.removeTab(t.id);
          setDragTabId(null);
          setDropTarget(null);
        }}
      >
        {items.map((item) => {
          if (item.type === 'group-collapsed') {
            const group = item.group;
            const activeInGroup = group.tabIds.includes(activeTabId);
            return (
              <div
                key={`group-${group.id}`}
                className={`shell-tab shell-tab-group ${activeInGroup ? 'shell-tab-active' : ''}`}
                style={{ borderTopColor: group.color }}
                onClick={() => onGroupChipClick(group)}
                onContextMenu={(e) => openGroupContextMenu(e, group.id)}
                title={`${group.title} · ${group.tabIds.length} вкладки`}
              >
                <Layers size={14} style={{ color: group.color }} />
                <span className="shell-tab-title">
                  {group.title} · {group.tabIds.length}
                </span>
                <ChevronRight size={14} />
              </div>
            );
          }

          if (item.type === 'group-header') {
            const group = item.group;
            const activeInGroup = group.tabIds.includes(activeTabId);
            return (
              <div
                key={`group-header-${group.id}`}
                className={`shell-group-chip ${activeInGroup ? 'shell-group-chip-active' : ''}`}
                style={{ borderColor: group.color }}
                onClick={() => onGroupChipClick(group)}
                onDoubleClick={() => {
                  setEditingGroupId(group.id);
                  setDraftGroupTitle(group.title);
                }}
                onContextMenu={(e) => openGroupContextMenu(e, group.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragTabId) {
                    void window.alpha.sessionGroups.addTab(group.id, dragTabId);
                    setDragTabId(null);
                  }
                }}
                title={`${group.title} · ${group.tabIds.length} вкладки`}
              >
                <span className="shell-group-chip-dot" style={{ background: group.color }} />
                {editingGroupId === group.id ? (
                  <input
                    className="shell-group-chip-input"
                    value={draftGroupTitle}
                    maxLength={40}
                    autoFocus
                    spellCheck={false}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftGroupTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveGroupTitle(group.id);
                      if (e.key === 'Escape') setEditingGroupId(null);
                    }}
                    onBlur={() => saveGroupTitle(group.id)}
                  />
                ) : (
                  <span className="shell-group-chip-title">{group.title}</span>
                )}
                <span className="shell-group-count">{group.tabIds.length}</span>
                <ChevronDown size={14} aria-hidden />
              </div>
            );
          }

          const tab = item.tab;
          const group = sessionGroups.find((g) => g.id === tab.sessionGroupId);
          const isActive = tab.id === activeTabId;
          const showSpinner = isActive && tab.isLoading;
          const isSkeleton = tab.kind === 'web' && tab.isLoading && tab.title === tab.url;
          const isDrop = dropTarget?.tabId === tab.id;

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`shell-tab ${group ? 'shell-tab-in-group' : ''} ${isActive ? 'shell-tab-active' : ''} ${isSkeleton ? 'shell-tab-skeleton' : ''} ${isDrop ? `shell-tab-drop-${dropTarget?.side}` : ''}`}
              onClick={() => void window.alpha.tabs.switch(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void window.alpha.tabs.close(tab.id);
                }
              }}
              draggable
              onDragStart={() => setDragTabId(tab.id)}
              onDragEnd={() => {
                setDragTabId(null);
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                setDropTarget({ tabId: tab.id, side });
              }}
              onDragLeave={() => {
                setDropTarget((cur) => (cur?.tabId === tab.id ? null : cur));
              }}
              onDrop={() => {
                if (!dragTabId || dragTabId === tab.id) return;
                const ids = orderedTabIdsFromItems();
                const from = ids.indexOf(dragTabId);
                const to = ids.indexOf(tab.id);
                if (from < 0 || to < 0) return;
                const dragged = findTab(dragTabId);
                const targetGroupId = tab.sessionGroupId ?? null;
                const draggedGroupId = dragged?.sessionGroupId ?? null;
                if (dragged) {
                  if (targetGroupId && draggedGroupId !== targetGroupId) {
                    void window.alpha.sessionGroups.addTab(targetGroupId, dragged.id);
                  }
                  if (!targetGroupId && draggedGroupId) {
                    void window.alpha.sessionGroups.removeTab(dragged.id);
                  }
                  if (targetGroupId) {
                    const g = sessionGroups.find((x) => x.id === targetGroupId);
                    if (g) {
                      const gIds = g.tabIds.filter((id) => id !== dragged.id);
                      const at = gIds.indexOf(tab.id);
                      if (at >= 0) {
                        const side = dropTarget?.tabId === tab.id ? dropTarget.side : 'before';
                        gIds.splice(side === 'after' ? at + 1 : at, 0, dragged.id);
                      }
                      void window.alpha.sessionGroups.reorderTabs(targetGroupId, gIds);
                    }
                  }
                }
                ids.splice(from, 1);
                const side = dropTarget?.tabId === tab.id ? dropTarget.side : 'before';
                ids.splice(side === 'after' ? to + 1 : to, 0, dragTabId);
                void window.alpha.tabs.reorder(ids);
                setDropTarget(null);
              }}
              onContextMenu={(e) => openTabContextMenu(e, tab.id)}
            >
              {showSpinner ? (
                <Loader2 size={14} className="shell-tab-spinner" aria-hidden />
              ) : (
                <TabFavicon
                  kind={tab.kind}
                  url={tab.url}
                  favicon={tab.favicon}
                  isLoading={tab.isLoading}
                />
              )}
              <span className="shell-tab-title">
                {tab.crashed ? '⚠ ' : ''}
                {tab.kind === 'ntp' ? 'Новая вкладка' : tab.title || tab.url}
              </span>
              {(tab.audible || tab.muted) && (
                <button
                  type="button"
                  className="shell-tab-audio"
                  aria-label={tab.muted ? 'Включить звук' : 'Отключить звук'}
                  title={tab.muted ? 'Включить звук' : 'Отключить звук'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void window.alpha.tabs.setMuted(!tab.muted, tab.id);
                  }}
                >
                  {tab.muted ? <VolumeX size={13} strokeWidth={2} /> : <Volume2 size={13} strokeWidth={2} />}
                </button>
              )}
              <button
                type="button"
                className={`shell-tab-close ${isActive ? 'shell-tab-close-active' : ''}`}
                aria-label="Закрыть вкладку"
                onClick={(e) => {
                  e.stopPropagation();
                  void window.alpha.tabs.close(tab.id);
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="shell-tab-new"
          aria-label="Новая вкладка"
          onClick={() => void window.alpha.tabs.create()}
        >
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function tabAddressValue(url: string, kind: string): string {
  if (kind === 'ntp' || url.startsWith('alpha://')) {
    return '';
  }
  return url;
}
