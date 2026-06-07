import { ipcRenderer } from 'electron';

type FieldType = 'username' | 'password';

function nowMs() {
  return Date.now();
}

function safeOrigin(): string | null {
  try {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return location.origin;
  } catch {
    return null;
  }
}

function hashFormSignature(signature: string): string {
  // djb2 (good enough for signature bucketing; not security-sensitive)
  let h = 5381;
  for (let i = 0; i < signature.length; i++) h = (h * 33) ^ signature.charCodeAt(i);
  return `f_${(h >>> 0).toString(16)}`;
}

function isTextLike(input: HTMLInputElement) {
  const t = (input.getAttribute('type') || 'text').toLowerCase();
  return t === 'text' || t === 'email' || t === 'tel' || t === 'search' || t === 'url';
}

function isPasswordInput(el: Element | null): el is HTMLInputElement {
  return !!el && el instanceof HTMLInputElement && (el.getAttribute('type') || '').toLowerCase() === 'password';
}

function findUsernameCandidate(form: HTMLFormElement, passwordInput: HTMLInputElement): HTMLInputElement | null {
  const inputs = Array.from(form.querySelectorAll('input')).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement,
  );
  const idx = inputs.indexOf(passwordInput);
  const before = idx >= 0 ? inputs.slice(0, idx) : inputs;

  // Prefer explicit email/username fields
  const byAutocomplete = before.find((i) => {
    const ac = (i.getAttribute('autocomplete') || '').toLowerCase();
    return ac === 'username' || ac === 'email';
  });
  if (byAutocomplete) return byAutocomplete;

  const email = before.find((i) => (i.getAttribute('type') || '').toLowerCase() === 'email');
  if (email) return email;

  const textLike = [...before].reverse().find((i) => isTextLike(i));
  return textLike ?? null;
}

function buildFormSignature(form: HTMLFormElement, passwordInput: HTMLInputElement): string {
  const action = (form.getAttribute('action') || '').slice(0, 256);
  const pwName = (passwordInput.getAttribute('name') || passwordInput.id || '').slice(0, 128);
  const uname = findUsernameCandidate(form, passwordInput);
  const uName = (uname?.getAttribute('name') || uname?.id || '').slice(0, 128);
  return `${location.origin}|${action}|${uName}|${pwName}`;
}

let lastSubmitBySig = new Map<string, number>();

function shouldRateLimit(sig: string): boolean {
  const last = lastSubmitBySig.get(sig) ?? 0;
  const t = nowMs();
  if (t - last < 15_000) return true;
  lastSubmitBySig.set(sig, t);
  if (lastSubmitBySig.size > 200) {
    // drop old entries
    lastSubmitBySig = new Map([...lastSubmitBySig.entries()].slice(-100));
  }
  return false;
}

function reportLoginSubmitted(form: HTMLFormElement, passwordInput: HTMLInputElement) {
  const origin = safeOrigin();
  if (!origin) return;

  const usernameInput = findUsernameCandidate(form, passwordInput);
  const username = (usernameInput?.value || '').trim().slice(0, 512);
  const password = (passwordInput.value || '').slice(0, 2048);
  if (!password) return;

  const sig = hashFormSignature(buildFormSignature(form, passwordInput));
  if (shouldRateLimit(sig)) return;

  ipcRenderer.send('guest:loginSubmitted', {
    origin,
    username,
    password,
    formSig: sig,
    ts: nowMs(),
  });
}

function currentFocusedFieldType(): FieldType | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement)) return null;
  const t = (el.getAttribute('type') || 'text').toLowerCase();
  if (t === 'password') return 'password';
  if (isTextLike(el) || t === 'email') return 'username';
  return null;
}

function findPasswordInForm(form: HTMLFormElement | null): HTMLInputElement | null {
  if (!form) return null;
  const pw = form.querySelector('input[type="password"]');
  return isPasswordInput(pw) ? pw : null;
}

function tryReportFrom(form: HTMLFormElement | null): void {
  const pw = findPasswordInForm(form);
  if (!form || !pw) return;
  reportLoginSubmitted(form, pw);
}

// ----------------------------------------------------------------------------
// CREDENTIAL DETECTOR
// Attached FIRST and resiliently: nothing below (e.g. the suggestions overlay,
// which touches the DOM before it is parsed) may prevent these listeners from
// being registered. We cover several submission paths because sites differ:
//   - native form submit (document + window, capture)
//   - click on a submit button / default-submit <button>
//   - Enter inside a field belonging to a login form
//   - unload fallback (pagehide/beforeunload) for programmatic form.submit()
//     or JS navigations that never fire a `submit` event.
// We never call preventDefault, never block login, never log passwords.
// ----------------------------------------------------------------------------

// Remember the last login form whose password field was touched, so the unload
// fallback can flush credentials even when no submit/click event reaches us.
let lastPasswordForm: HTMLFormElement | null = null;

function onSubmitEvent(e: Event): void {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  tryReportFrom(form);
}

document.addEventListener('submit', onSubmitEvent, true);
window.addEventListener('submit', onSubmitEvent, true);

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    tryReportFrom(el.form);
  },
  true,
);

document.addEventListener(
  'click',
  (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest('button, input[type="submit"], input[type="image"]');
    if (!btn) return;
    // A <button> defaults to type="submit"; only treat submit-like triggers.
    const btnType = (btn.getAttribute('type') || (btn.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    if (btnType !== 'submit' && btnType !== 'image') return;
    const form = (btn as HTMLButtonElement | HTMLInputElement).form;
    tryReportFrom(form);
  },
  true,
);

// Track password-field edits to feed the unload fallback.
document.addEventListener(
  'input',
  (e) => {
    const el = e.target;
    if (isPasswordInput(el instanceof Element ? el : null) && el instanceof HTMLInputElement && el.form) {
      lastPasswordForm = el.form;
    }
  },
  true,
);

function flushPendingOnUnload(): void {
  const pw = findPasswordInForm(lastPasswordForm);
  if (!lastPasswordForm || !pw || !pw.value) return;
  reportLoginSubmitted(lastPasswordForm, pw);
}

window.addEventListener('pagehide', () => flushPendingOnUnload(), true);
window.addEventListener('beforeunload', () => flushPendingOnUnload(), true);

// ----------------------------------------------------------------------------
// SUGGESTIONS UI (deferred + guarded)
// DOM creation is deferred until the document is ready and wrapped in try/catch
// so it can never abort module evaluation before the detector above is attached.
// ----------------------------------------------------------------------------
let overlay: HTMLDivElement | null = null;
let box: HTMLDivElement | null = null;

function ensureOverlay(): boolean {
  if (overlay && box) return true;
  const host = document.body || document.documentElement;
  if (!host) return false;
  try {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.zIndex = '2147483647';
    el.style.left = '0';
    el.style.top = '0';
    el.style.display = 'none';
    const shadow = el.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .box{min-width:220px;max-width:360px;background:#0f1116;border:1px solid rgba(255,255,255,.10);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);padding:6px;backdrop-filter: blur(8px);}
        .row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;color:#e6e8ee;font: 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;cursor:pointer;}
        .row:hover{background:rgba(255,255,255,.06);}
        .muted{color:rgba(255,255,255,.55);font-size:12px;padding:8px 10px;}
      </style>
      <div class="box" id="box"></div>
    `;
    const b = shadow.getElementById('box') as HTMLDivElement | null;
    host.appendChild(el);
    overlay = el;
    box = b;
    return !!box;
  } catch {
    return false;
  }
}

function hideOverlay() {
  if (!overlay || !box) return;
  overlay.style.display = 'none';
  box.innerHTML = '';
}

function showOverlayAt(input: HTMLInputElement, usernames: string[]) {
  // Never render an empty/"no logins" popup over the page — only show when there
  // is at least one saved credential for this origin.
  if (usernames.length === 0) {
    hideOverlay();
    return;
  }
  if (!ensureOverlay() || !overlay || !box) return;
  const rect = input.getBoundingClientRect();
  overlay.style.left = `${Math.max(8, Math.min(window.innerWidth - 380, rect.left))}px`;
  overlay.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
  overlay.style.display = 'block';
  box.innerHTML = '';
  for (const u of usernames.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.textContent = u;
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => {
      const origin = safeOrigin();
      if (!origin) return;
      void ipcRenderer.invoke('guest:fillForUsername', { origin, username: u }).then((payload) => {
        if (!payload) return;
        input.value = payload.username;
        // try find password field in same form
        const form = input.form;
        const pw = (form?.querySelector('input[type="password"]') as HTMLInputElement | null) ?? null;
        if (pw) pw.value = payload.password;
        hideOverlay();
      });
    });
    box.appendChild(row);
  }
}

async function maybeShowSuggestions(input: HTMLInputElement) {
  const origin = safeOrigin();
  if (!origin) return;
  const type = (input.getAttribute('type') || 'text').toLowerCase();
  if (type !== 'password' && !isTextLike(input) && type !== 'email') return;
  const usernames = (await ipcRenderer.invoke('guest:getUsernamesForOrigin', { origin })) as string[] | null;
  if (!usernames || usernames.length === 0) {
    hideOverlay();
    return;
  }
  showOverlayAt(input, usernames);
}

document.addEventListener(
  'focusin',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const ft = currentFocusedFieldType();
    if (!ft) return;
    ipcRenderer.send('guest:fieldFocus', { origin: safeOrigin(), fieldType: ft, ts: nowMs() });
    void maybeShowSuggestions(el);
  },
  true,
);

document.addEventListener('scroll', () => hideOverlay(), true);
window.addEventListener('resize', () => hideOverlay());
document.addEventListener('mousedown', (e) => {
  if (overlay && !overlay.contains(e.target as Node)) hideOverlay();
});

