import type { AlphaApi } from '../../preload/index';

declare global {
  interface Window {
    alpha: AlphaApi;
  }
}

export {};
