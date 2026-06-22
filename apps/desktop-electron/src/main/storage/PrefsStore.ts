import Store from 'electron-store';

interface Data {
  closeConfirmDisabled?: boolean;
}

/** Miscellaneous lightweight app preferences (not routing/proxy/activation). */
export class PrefsStore {
  private readonly store = new Store<Data>({ name: 'app-prefs' });

  getCloseConfirmDisabled(): boolean {
    return this.store.get('closeConfirmDisabled') ?? false;
  }

  setCloseConfirmDisabled(v: boolean): void {
    this.store.set('closeConfirmDisabled', v);
  }
}
