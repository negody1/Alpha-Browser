import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Bookmark, BookmarkFolder } from '@alpha/shared-types';

interface BookmarksData {
  version: 1;
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
}

export class BookmarksStore {
  private readonly store = new Store<BookmarksData>({
    clearInvalidConfig: true,
    name: 'bookmarks',
    defaults: {
      version: 1,
      bookmarks: [],
      folders: [],
    },
  });

  listBookmarks(): Bookmark[] {
    return [...this.store.get('bookmarks')];
  }

  listFolders(): BookmarkFolder[] {
    return [...this.store.get('folders')];
  }

  upsertBookmark(input: {
    url: string;
    title: string;
    favicon?: string | null;
    folderId?: string | null;
  }): Bookmark {
    const url = input.url.trim();
    const now = new Date().toISOString();
    const bookmarks = this.listBookmarks();
    const existingIndex = bookmarks.findIndex((b) => b.url === url);

    if (existingIndex >= 0) {
      const updated: Bookmark = {
        ...bookmarks[existingIndex],
        title: input.title.trim() || bookmarks[existingIndex].title,
        favicon: input.favicon ?? bookmarks[existingIndex].favicon ?? null,
        folderId: input.folderId ?? bookmarks[existingIndex].folderId ?? null,
      };
      bookmarks[existingIndex] = updated;
      this.store.set('bookmarks', bookmarks);
      return updated;
    }

    const created: Bookmark = {
      id: randomUUID(),
      url,
      title: input.title.trim() || url,
      favicon: input.favicon ?? null,
      createdAt: now,
      folderId: input.folderId ?? null,
    };
    bookmarks.unshift(created);
    this.store.set('bookmarks', bookmarks);
    return created;
  }

  updateBookmark(
    id: string,
    patch: { title?: string; url?: string; favicon?: string | null; folderId?: string | null },
  ): Bookmark | null {
    const bookmarks = this.listBookmarks();
    const index = bookmarks.findIndex((b) => b.id === id);
    if (index < 0) {
      return null;
    }

    const nextUrl = patch.url ? patch.url.trim() : bookmarks[index].url;

    // URL dedupe on update: if another bookmark already uses that URL, merge into it and delete current
    const collision = bookmarks.find((b) => b.url === nextUrl && b.id !== id);
    if (collision) {
      const merged: Bookmark = {
        ...collision,
        title: patch.title?.trim() || collision.title,
        favicon: patch.favicon ?? collision.favicon ?? null,
        folderId: patch.folderId ?? collision.folderId ?? null,
      };
      const filtered = bookmarks.filter((b) => b.id !== id && b.id !== collision.id);
      filtered.unshift(merged);
      this.store.set('bookmarks', filtered);
      return merged;
    }

    const updated: Bookmark = {
      ...bookmarks[index],
      title: patch.title?.trim() ?? bookmarks[index].title,
      url: nextUrl,
      favicon: patch.favicon ?? bookmarks[index].favicon ?? null,
      folderId: patch.folderId ?? bookmarks[index].folderId ?? null,
    };

    bookmarks[index] = updated;
    this.store.set('bookmarks', bookmarks);
    return updated;
  }

  deleteBookmark(id: string): boolean {
    const bookmarks = this.listBookmarks();
    const next = bookmarks.filter((b) => b.id !== id);
    if (next.length === bookmarks.length) {
      return false;
    }
    this.store.set('bookmarks', next);
    return true;
  }

  createFolder(payload: { title: string; parentId?: string | null }): BookmarkFolder {
    const folder: BookmarkFolder = {
      id: randomUUID(),
      title: payload.title.trim() || 'Папка',
      parentId: payload.parentId ?? null,
    };
    const folders = this.listFolders();
    folders.push(folder);
    this.store.set('folders', folders);
    return folder;
  }

  updateFolder(id: string, patch: { title?: string; parentId?: string | null }): BookmarkFolder | null {
    const folders = this.listFolders();
    const index = folders.findIndex((f) => f.id === id);
    if (index < 0) {
      return null;
    }
    const updated: BookmarkFolder = {
      ...folders[index],
      title: patch.title?.trim() ?? folders[index].title,
      parentId: patch.parentId ?? folders[index].parentId,
    };
    folders[index] = updated;
    this.store.set('folders', folders);
    return updated;
  }

  deleteFolder(id: string): boolean {
    const folders = this.listFolders();
    const nextFolders = folders.filter((f) => f.id !== id);
    if (nextFolders.length === folders.length) {
      return false;
    }
    // move bookmarks out of folder (keep them)
    const bookmarks = this.listBookmarks().map((b) => (b.folderId === id ? { ...b, folderId: null } : b));
    this.store.set('folders', nextFolders);
    this.store.set('bookmarks', bookmarks);
    return true;
  }
}

