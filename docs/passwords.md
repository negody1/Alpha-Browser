# Alpha Browser — Passwords and Autofill

> Secure local credential storage and autofill architecture.

## 1. Principles

1. Passwords never leave the device.
2. No plain-text storage in app-owned files.
3. User must confirm save operations.
4. Autofill can be disabled in settings.
5. Platform-specific adapters behind one interface.

---

## 2. PasswordService interface

```typescript
export interface Credential {
  id: string;
  origin: string;       // eTLD+1 or origin URL
  username: string;
  password: string;     // only in main process memory
  createdAt: number;
  updatedAt: number;
}

export interface PasswordService {
  isAvailable(): Promise<boolean>;
  saveCredential(
    origin: string,
    username: string,
    password: string,
  ): Promise<void>;
  getCredentialsForOrigin(origin: string): Promise<Credential[]>;
  updateCredential(
    id: string,
    payload: Partial<Pick<Credential, 'username' | 'password'>>,
  ): Promise<void>;
  deleteCredential(id: string): Promise<void>;
}
```

Package: `packages/core-passwords`

---

## 3. SecretStorageProvider (confirmed — O-P1)

**Do not spread `keytar` or OS APIs across the app.** All secret IO goes through one abstraction:

```typescript
export interface SecretStorageProvider {
  isAvailable(): Promise<boolean>;
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}
```

`PasswordService` depends only on `SecretStorageProvider`.

| Platform | MVP | Implementation |
|----------|-----|----------------|
| Windows | **Yes** | `WindowsSecretStorageProvider` (Credential Manager via keytar or equivalent — **only in this file**) |
| macOS | Stub | `KeychainSecretStorageProvider` |
| Linux | Stub | `LibsecretSecretStorageProvider` |

Service name: **`Alpha Browser`**. Account key: `{origin}|{username}`.

Metadata index (usernames per origin, no passwords): `bookmarks.json` sibling or separate `credentials-index.json` with **no password fields**.

Metadata index (non-secret): optional SQLite table of `{id, origin, username}` without password — password only in CredMan.

### Stub adapter (development)

```typescript
class UnsafeDevAdapter implements PasswordService {
  // in-memory Map — only when ALPHA_ALLOW_INSECURE_PASSWORDS=1
}
```

Never enabled in packaged production builds.

---

## 4. IPC API (main only)

| Channel | Returns |
|---------|---------|
| `passwords:isAvailable` | boolean |
| `passwords:getForOrigin` | `{ id, username }[]` masked |
| `passwords:save` | void (requires username, password from prompt) |
| `passwords:delete` | void |
| `passwords:fill` | sends fill command to guest webContents |

Renderer never stores passwords in Zustand persist.

---

## 5. Autofill architecture

```
┌──────────────── Guest page ────────────────┐
│  <form> username/password inputs            │
└──────────────────┬─────────────────────────┘
                   │ DOM signals (guest preload)
                   ▼
┌──────────── Main ──────────────────────────┐
│  FormDetector → AutofillController          │
│  → query PasswordService by origin          │
│  → show native/popup UI (confirm fill)      │
└──────────────────┬─────────────────────────┘
                   │
┌──────────────────▼─────────────────────────┐
│  Chrome UI overlay / small popup near field │
└────────────────────────────────────────────┘
```

### Login form detection (MVP)

Heuristics in guest preload:

- `input[type=password]` present
- nearby `input[type=text|email]` or `autocomplete=username`
- form `action` HTTP(S)

### Save prompt flow

1. Detect form submit or navigation after successful login (heuristic: password field cleared + 200 navigation).
2. Main shows "Save password?" dialog.
3. On confirm → `saveCredential`.
4. On deny → discard captured values from memory.

### Autofill flow

1. Focus on username field → IPC → list accounts (usernames only).
2. User picks → main injects via `webContents.executeJavaScript` in isolated world OR `input` event simulation (prefer trusted fill API if added).

### Settings

- Toggle: Offer to save passwords
- Toggle: Autofill sign-in info
- Button: Manage passwords → opens settings list (usernames + delete; reveal requires re-auth post-MVP)

---

## 6. Security controls

- Clear clipboard after password copy (if copy added).
- No password in `webContents.capturePage` or screenshots metadata.
- Disable save on `http://` except localhost (warn user).
- Rate limit save attempts.

---

## 7. Migration

- No import in MVP.
- Future: CSV import via one-time wizard into CredMan.

---

## 8. Testing

- Unit: adapter mock.
- Integration: Windows CI agent with CredMan (or skip on Linux CI).
- Manual: login to test site, save, restart app, autofill.

---

## 9. Open questions

- O-P1: `keytar` vs `safeStorage` + SQLite metadata?
- O-P2: Windows Hello re-auth for reveal?
- O-P3: Passkeys / WebAuthn scope (post-MVP)?
