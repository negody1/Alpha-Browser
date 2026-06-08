import { useEffect, useState } from 'react';
import { FAVICON_FALLBACK_URL, NTP_URL } from '@alpha/shared-types';

interface TabFaviconProps {
  kind: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
  size?: number;
}

// Canonical Alpha mark for internal pages (new tab, settings, any alpha:// page).
// Relative path resolves correctly in dev (http) AND packaged file://
// (out/renderer/branding/app-logo.png) — never the broken-image placeholder.
const ALPHA_INTERNAL_ICON = 'branding/app-logo.png';

function isInternalPage(kind: string, url: string): boolean {
  return kind === 'ntp' || kind === 'internal' || url === NTP_URL || url.startsWith('alpha://');
}

export function TabFavicon({ kind, url, favicon, isLoading, size = 16 }: TabFaviconProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [favicon]);

  // All internal Alpha pages always show the Alpha branding icon.
  if (isInternalPage(kind, url)) {
    return (
      <img
        src={ALPHA_INTERNAL_ICON}
        alt=""
        className="tab-favicon"
        width={size}
        height={size}
        draggable={false}
      />
    );
  }

  const src = !broken && favicon ? favicon : FAVICON_FALLBACK_URL;

  return (
    <span className={`tab-favicon-wrap ${isLoading ? 'tab-favicon-loading' : ''}`}>
      <img
        src={src}
        alt=""
        className="tab-favicon"
        width={size}
        height={size}
        draggable={false}
        onError={() => setBroken(true)}
      />
    </span>
  );
}
