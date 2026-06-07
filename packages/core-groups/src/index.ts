import type { SavedGroup } from '@alpha/shared-types';

const HTTP_URL = /^https?:\/\//i;

export function isPersistableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) {
    return false;
  }
  if (!HTTP_URL.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Dedupe, trim, drop invalid URLs. */
export function normalizeUrlList(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (!isPersistableUrl(trimmed)) {
      continue;
    }
    const normalized = new URL(trimmed).toString();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function createSavedGroupDraft(
  partial: Pick<SavedGroup, 'title' | 'color'> & { urls?: string[] },
  id: string,
  now = new Date().toISOString(),
): SavedGroup {
  return {
    id,
    title: partial.title.trim() || 'Без названия',
    color: partial.color,
    urls: normalizeUrlList(partial.urls ?? []),
    createdAt: now,
    updatedAt: now,
  };
}

export function touchSavedGroup(
  group: SavedGroup,
  patch: Partial<Pick<SavedGroup, 'title' | 'color' | 'urls'>>,
): SavedGroup {
  const now = new Date().toISOString();
  return {
    ...group,
    title: patch.title !== undefined ? patch.title.trim() || 'Без названия' : group.title,
    color: patch.color ?? group.color,
    urls: patch.urls !== undefined ? normalizeUrlList(patch.urls) : group.urls,
    updatedAt: now,
  };
}
