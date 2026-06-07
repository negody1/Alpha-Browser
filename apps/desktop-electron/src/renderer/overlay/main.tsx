import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayRoot } from './OverlayRoot';
import './overlay-tokens.css';
import './overlay.css';

// eslint-disable-next-line no-console
console.log('[alpha][overlay] boot', location.href);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayRoot />
  </StrictMode>,
);
