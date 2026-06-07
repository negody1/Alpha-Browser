import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { ShortcutLink } from '@alpha/shared-types';

interface ShortcutsData {
  version: 1;
  links: ShortcutLink[];
}

const DEFAULTS: Array<Pick<ShortcutLink, 'title' | 'url' | 'iconUrl' | 'order'>> = [
  { title: 'Google', url: 'https://www.google.com', iconUrl: null, order: 0 },
  { title: 'YouTube', url: 'https://www.youtube.com', iconUrl: null, order: 1 },
  { title: 'GitHub', url: 'https://github.com', iconUrl: null, order: 2 },
  { title: 'Telegram', url: 'https://web.telegram.org', iconUrl: null, order: 3 },
  { title: 'Reddit', url: 'https://www.reddit.com', iconUrl: null, order: 4 },
];

export class ShortcutsStore {
  private readonly store = new Store<ShortcutsData>({
    clearInvalidConfig: true,
    name: 'shortcuts',
    defaults: {
      version: 1,
      links: DEFAULTS.map((d) => ({
        id: randomUUID(),
        title: d.title,
        url: d.url,
        iconUrl: d.iconUrl,
        order: d.order,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    },
  });

  list(): ShortcutLink[] {
    // Back-compat: migrate older shape (label -> title, missing order/iconUrl).
    const raw: any[] = this.store.get('links') as any;
    const migrated: ShortcutLink[] = raw.map((l: any, idx: number) => ({
      id: String(l.id),
      title: String(l.title ?? l.label ?? 'Ссылка'),
      url: String(l.url ?? ''),
      iconUrl: l.iconUrl ?? null,
      order: typeof l.order === 'number' ? l.order : idx,
      createdAt: String(l.createdAt ?? new Date().toISOString()),
      updatedAt: String(l.updatedAt ?? new Date().toISOString()),
    }));
    return migrated.sort((a, b) => a.order - b.order);
  }

  upsert(payload: { id?: string; title: string; url: string; iconUrl?: string | null }): ShortcutLink | null {
    const title = payload.title.trim().slice(0, 48);
    const url = payload.url.trim().slice(0, 2048);
    const iconUrl = payload.iconUrl?.trim() ? payload.iconUrl.trim().slice(0, 2048) : null;
    if (!title || !url) return null;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (iconUrl) {
      try {
        const iu = new URL(iconUrl);
        if (iu.protocol !== 'http:' && iu.protocol !== 'https:') return null;
      } catch {
        return null;
      }
    }

    const links = this.list();
    const now = new Date().toISOString();

    if (payload.id) {
      const idx = links.findIndex((l) => l.id === payload.id);
      if (idx >= 0) {
        const next: ShortcutLink = {
          ...links[idx],
          title,
          url: parsed.toString(),
          iconUrl,
          updatedAt: now,
        };
        links[idx] = next;
        this.store.set('links', links);
        return next;
      }
    }

    const next: ShortcutLink = {
      id: randomUUID(),
      title,
      url: parsed.toString(),
      iconUrl,
      order: links.length,
      createdAt: now,
      updatedAt: now,
    };
    links.unshift(next);
    if (links.length > 24) links.length = 24;
    // normalize order
    const normalized = links.map((l, i) => ({ ...l, order: i }));
    this.store.set('links', normalized);
    return normalized[0]!;
  }

  remove(id: string): boolean {
    const links = this.list();
    const next = links.filter((l) => l.id !== id);
    if (next.length === links.length) return false;
    this.store.set(
      'links',
      next.map((l, i) => ({ ...l, order: i })),
    );
    return true;
  }

  reorder(ids: string[]): ShortcutLink[] {
    const current = this.list();
    const byId = new Map(current.map((l) => [l.id, l] as const));
    const next: ShortcutLink[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (item) next.push(item);
    }
    // keep any missing items at end
    for (const l of current) {
      if (!ids.includes(l.id)) next.push(l);
    }
    const normalized = next.map((l, i) => ({ ...l, order: i }));
    this.store.set('links', normalized);
    return normalized;
  }
}

