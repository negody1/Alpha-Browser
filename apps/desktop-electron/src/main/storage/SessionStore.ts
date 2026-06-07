import Store from 'electron-store';

export interface PersistedGroup {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  /** Remembered web-tab URLs so the group can be reopened later. */
  urls: string[];
}

interface SessionData {
  version: 1;
  groups: PersistedGroup[];
}

/**
 * Persists tab groups (as menu entries) so they survive a restart — Chrome-like
 * "saved tab groups". Only group metadata + their remembered URLs are stored;
 * tabs are NOT auto-reopened on launch. Groups stay dormant in the menus until
 * the user clicks to reopen them.
 */
export class SessionStore {
  private readonly store = new Store<SessionData>({
    clearInvalidConfig: true,
    name: 'session',
    defaults: {
      version: 1,
      groups: [],
    },
  });

  loadGroups(): PersistedGroup[] {
    return [...this.store.get('groups')];
  }

  saveGroups(groups: PersistedGroup[]): void {
    this.store.set('groups', groups);
  }

  clear(): void {
    this.store.set('groups', []);
  }
}
