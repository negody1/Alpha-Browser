import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import {
  createSavedGroupDraft,
  normalizeUrlList,
  touchSavedGroup,
} from '@alpha/core-groups';
import type { SavedGroup } from '@alpha/shared-types';
import { GROUP_COLOR_PRESETS } from '@alpha/shared-types';

interface SavedGroupsData {
  version: 1;
  groups: SavedGroup[];
}

export class SavedGroupsStore {
  private readonly store = new Store<SavedGroupsData>({
    clearInvalidConfig: true,
    name: 'saved-groups',
    defaults: {
      version: 1,
      groups: [],
    },
  });

  list(): SavedGroup[] {
    return [...this.store.get('groups')];
  }

  getById(id: string): SavedGroup | undefined {
    return this.list().find((g) => g.id === id);
  }

  create(payload: { title: string; color: string; urls?: string[] }): SavedGroup {
    const group = createSavedGroupDraft(payload, randomUUID());
    const groups = this.list();
    groups.push(group);
    this.store.set('groups', groups);
    return group;
  }

  update(
    id: string,
    patch: { title?: string; color?: string; urls?: string[] },
  ): SavedGroup | null {
    const groups = this.list();
    const index = groups.findIndex((g) => g.id === id);
    if (index < 0) {
      return null;
    }
    const updated = touchSavedGroup(groups[index], patch);
    groups[index] = updated;
    this.store.set('groups', groups);
    return updated;
  }

  delete(id: string): boolean {
    const groups = this.list().filter((g) => g.id !== id);
    if (groups.length === this.list().length) {
      return false;
    }
    this.store.set('groups', groups);
    return true;
  }

  addUrl(id: string, url: string): SavedGroup | null {
    const group = this.getById(id);
    if (!group) {
      return null;
    }
    const urls = normalizeUrlList([...group.urls, url]);
    return this.update(id, { urls });
  }

  removeUrl(id: string, url: string): SavedGroup | null {
    const group = this.getById(id);
    if (!group) {
      return null;
    }
    const normalized = normalizeUrlList([url])[0];
    const urls = group.urls.filter((u) => u !== normalized);
    return this.update(id, { urls });
  }

  defaultColor(index: number): string {
    return GROUP_COLOR_PRESETS[index % GROUP_COLOR_PRESETS.length];
  }
}
