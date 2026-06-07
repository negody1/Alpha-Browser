import Store from 'electron-store';

interface AdblockData {
  version: 1;
  enabled: boolean;
  disabledDomains: string[];
  customRules: string[];
}

export class AdblockStore {
  private readonly store = new Store<AdblockData>({
    clearInvalidConfig: true,
    name: 'adblock',
    defaults: {
      version: 1,
      enabled: true,
      disabledDomains: [],
      customRules: [],
    },
  });

  isEnabled(): boolean {
    return this.store.get('enabled');
  }

  setEnabled(enabled: boolean): void {
    this.store.set('enabled', enabled);
  }

  listDisabledDomains(): string[] {
    return [...this.store.get('disabledDomains')];
  }

  setDomainDisabled(domain: string, disabled: boolean): void {
    const d = domain.trim().toLowerCase();
    const list = this.listDisabledDomains();
    const has = list.includes(d);
    const next = disabled ? (has ? list : [...list, d]) : list.filter((x) => x !== d);
    this.store.set('disabledDomains', next);
  }

  getCustomRules(): string[] {
    return [...this.store.get('customRules')];
  }

  setCustomRules(rules: string[]): void {
    this.store.set('customRules', rules.map((r) => String(r ?? '')).filter(Boolean).slice(0, 5000));
  }
}

