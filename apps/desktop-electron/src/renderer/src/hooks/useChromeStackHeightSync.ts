import { useEffect, type RefObject } from 'react';

/**
 * ZONE 1: measure chrome stack height and sync to main for WebContentsView y offset.
 * No popup-driven layout — only structural chrome rows.
 */
export function useChromeStackHeightSync(chromeStackRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = chromeStackRef.current;
    if (!el) return;

    const report = () => {
      const heightPx = Math.ceil(el.getBoundingClientRect().height);
      void window.alpha.shell.setChromeTopHeight(heightPx);
    };

    report();
    const observer = new ResizeObserver(() => report());
    observer.observe(el);
    return () => observer.disconnect();
  }, [chromeStackRef]);
}
