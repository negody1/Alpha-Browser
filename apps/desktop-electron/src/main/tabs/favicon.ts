/** Runtime favicon URLs for tab UI — never used for navigation. */
export function pickFaviconUrl(candidates: string[]): string | null {
  for (const raw of candidates) {
    const url = normalizeFaviconUrl(raw);
    if (url) {
      return url;
    }
  }
  return null;
}

export function normalizeFaviconUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed.length <= 1_000_000 ? trimmed : null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
