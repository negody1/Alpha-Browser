# Alpha Browser — Groups and Workspaces

> Phase 3. Local session groups + persisted workspace templates.

## 1. Two concepts

| Concept | Lifetime | Storage | Restore on launch |
|---------|----------|---------|-------------------|
| **Session tabs** | Until app quit | Memory only | **No** |
| **Session groups** | Until app quit | Memory only | **No** |
| **Saved groups / workspaces** | Permanent | `saved-groups.json` | **No auto-open** — user opens manually |

### Session tabs

Current open tabs. Not written to disk. After restart the browser opens **one new NTP tab** only.

### Saved groups (workspaces)

Templates: `title`, `color`, `urls[]`. User opens from NTP cards or sidebar **Группы**. Opening creates a **new session group** and **new tabs** — does not close existing tabs.

---

## 2. Data models

```typescript
SavedGroup {
  id, title, color, urls[], createdAt, updatedAt
}

SessionGroup {
  id, title, color, collapsed, tabIds[], sourceSavedGroupId?
}

TabSnapshot {
  ...
  sessionGroupId?: string | null
}
```

---

## 3. Open workspace (MVP behavior)

1. If a session group with `sourceSavedGroupId === workspace.id` already exists → **switch** to its first tab and expand.
2. Else create session group, open each valid `http(s)` URL in a new tab, link `sourceSavedGroupId`.
3. Invalid URLs skipped; empty workspace → no-op + empty state in UI.
4. Load failure on one tab → `did-fail-load` / catch; other tabs still open.

---

## 4. Storage

**File**: `%APPDATA%/Alpha Browser/saved-groups.json` (via `electron-store`, name `saved-groups`)

**Not stored**: open tabs, active tab, session groups, collapse state, crash flags.

**Validation** (`@alpha/core-groups`):

- URLs: `http`/`https` only
- Dedupe normalized URLs
- No `file://`

---

## 5. IPC

### Saved groups

- `savedGroups:list|create|update|delete|addUrl|removeUrl|open`
- Event: `saved-groups:changed`

### Session groups

- `sessionGroups:create|rename|toggleCollapsed|addTab|removeTab|ungroup|saveAsWorkspace`

All payloads validated with Zod in main.

---

## 6. UI surfaces

- **NTP**: workspace cards (Open / Edit / Create)
- **Sidebar**: Folder icon → groups panel
- **Tab bar**: grouped tabs, collapsed group chip, color top border

---

## 7. Why tabs are not auto-restored

Product requirement: no session restore, no cloud. Workspaces are intentional user actions, not implicit state recovery. Reduces surprise and avoids restoring sensitive URLs without consent.

---

## 8. Phase 4+ (out of scope)

- Per-tab `routeMode` in saved groups
- Drag-and-drop tab reorder
- Workspace folders / nesting
