import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CHROME_LAYOUT } from '@alpha/shared-types';
import App from './App';
import './styles/globals.css';

// Shell geometry has a single source of truth (CHROME_LAYOUT). CSS must not hardcode
// these values — inject them as custom properties before first paint.
const rootStyle = document.documentElement.style;
rootStyle.setProperty('--sidebar-width', `${CHROME_LAYOUT.sidebarWidth}px`);
rootStyle.setProperty('--tab-bar-height', `${CHROME_LAYOUT.tabBarHeight}px`);
rootStyle.setProperty('--toolbar-height', `${CHROME_LAYOUT.toolbarHeight}px`);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
