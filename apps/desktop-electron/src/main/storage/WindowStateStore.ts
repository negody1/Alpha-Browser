import Store from 'electron-store';

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

interface Data {
  window?: WindowState;
}

/**
 * Persists the main window geometry so the browser reopens where it was.
 * First launch (no saved state) → start maximized, like Chrome/Edge.
 */
export class WindowStateStore {
  private readonly store = new Store<Data>({ name: 'window-state' });

  get(): WindowState | null {
    return this.store.get('window') ?? null;
  }

  set(state: WindowState): void {
    this.store.set('window', state);
  }
}
