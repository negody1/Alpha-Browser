import { useEffect, useState } from 'react';
import { FAVICON_FALLBACK_URL, NTP_URL } from '@alpha/shared-types';

interface TabFaviconProps {
  kind: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
  size?: number;
}

export function TabFavicon({ kind, url, favicon, isLoading, size = 16 }: TabFaviconProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [favicon]);

  if (kind === 'ntp' || url === NTP_URL) {
    return (
      <img
        src={FAVICON_FALLBACK_URL}
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
