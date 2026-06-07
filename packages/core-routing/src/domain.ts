/** Normalize hostname to registrable domain key (MVP: simple eTLD+1 heuristic). */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  if (!host) {
    return '';
  }

  host = host.replace(/^\.+/, '').replace(/\.+$/, '');

  try {
    if (host.includes('://')) {
      host = new URL(host).hostname;
    }
  } catch {
    /* use as host */
  }

  host = host.split(':')[0];

  if (host.startsWith('www.')) {
    host = host.slice(4);
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }

  const twoPartTlds = new Set(['co.uk', 'com.br', 'co.jp', 'com.au', 'org.uk']);
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (parts.length >= 3 && twoPartTlds.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}
