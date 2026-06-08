# Alpha Access (registration + activation-code + PER-DEVICE proxy credentials)

Self-contained Node service (no external deps). **Local/staged — not deployed.**

## Per-device revocable model
Each activated device gets its **own VLESS `uuid`** (the server profile file holds only
the *shared* Reality params — no uuid). Revoke marks the device revoked; **`sync-singbox.mjs`**
then removes that uuid from sing-box `inbounds[].users[]` and reloads, so the device — and any
**copied** profile — is rejected at the VPS. That is true per-device revocation (a shared profile
could not be revoked per user).

## Run locally
```bash
# 1) provide the server-side proxy profile (gitignored; real VLESS/Reality values)
cp services/alpha-access/alpha-proxy-profile.example.json \
   services/alpha-access/alpha-proxy-profile.local.json    # then edit with real values

# 2) start
ALPHA_ADMIN_TOKEN=$(openssl rand -hex 24) \
ALPHA_HASH_SALT=$(openssl rand -hex 16) \
node services/alpha-access/server.mjs
# -> http://127.0.0.1:8090   public /alpha   admin /admin/alpha
```

Env: `ALPHA_ACCESS_PORT` (8090), `ALPHA_ACCESS_HOST` (127.0.0.1), `ALPHA_ADMIN_TOKEN` (required for admin),
`ALPHA_PROFILE_FILE`, `ALPHA_DATA_FILE`, `ALPHA_HASH_SALT`.

## Test
```bash
node services/alpha-access/test.mjs   # full activation-code flow + security assertions
```

## API
- `GET  /alpha` — public registration page.
- `POST /api/alpha/register` `{email}` → `{status:"submitted"}` (rate-limited).
- `POST /api/alpha/device/activate` `{email,code,device_id,device_label?,app_version?}`
  → `{status:"connected", profile}` only for an **approved + unused code** bound to the device;
  otherwise `pending|invalid_code|code_used|denied|revoked` with **no profile**.
- `GET  /admin/alpha` — admin page (enter `ADMIN_TOKEN`).
- `GET/POST /api/admin/{list,approve,deny,revoke}` — `Authorization: Bearer ADMIN_TOKEN`.

## Security
Device id + activation code stored **hashed** (sha256+salt). Profile read from a server-only file,
returned once per code, **never logged**. Endpoints rate-limited. `/admin/*` requires the bearer token.
No profile for pending/denied/revoked/used.

## Deployment steps (DO NOT run without approval — touches production nginx)
1. Copy `services/alpha-access/` to the server; create `alpha-proxy-profile.local.json` (real values, `chmod 600`).
2. Run as a systemd service bound to `127.0.0.1:8090` with `ALPHA_ADMIN_TOKEN`/`ALPHA_HASH_SALT` from the service env.
3. In nginx `/etc/nginx/sites-available/site`, **inside the `3d.negody.ru` 443 server block, BEFORE the
   `return 301 https://3d-pechushka.ru` line**, add:
   ```nginx
   location /alpha        { proxy_pass http://127.0.0.1:8090; }
   location /api/alpha/   { proxy_pass http://127.0.0.1:8090; }
   location /admin/alpha  { proxy_pass http://127.0.0.1:8090; }  # also restrict by IP/auth
   ```
   Everything else keeps redirecting to 3d-pechushka.ru (unchanged).
4. `nginx -t && systemctl reload nginx`. Back up `site` first.
5. **Per-device sing-box sync** (the network-layer apply). After approvals/revokes run, on the server:
   ```bash
   ALPHA_ACCESS_URL=http://127.0.0.1:8090 ALPHA_ADMIN_TOKEN=… node sync-singbox.mjs            # dry-run
   ALPHA_ACCESS_URL=http://127.0.0.1:8090 ALPHA_ADMIN_TOKEN=… node sync-singbox.mjs --apply     # write + sing-box check + reload
   ```
   It preserves the existing base/admin user (any user whose `name` is not `dev:*`), reconciles only
   `dev:*` users to the active set, backs up the config, validates with `sing-box check`, then reloads.
   A systemd timer (e.g. every 30 s) keeps sing-box in sync with approvals/revocations.

## Server config change required (per-device)
The only server change is to `inbounds[0].users[]` in `/etc/sing-box/config.json`: device users
`{uuid, flow, name:"dev:…"}` are added/removed by `sync-singbox.mjs`. **Reality params
(`private_key`, `short_id`, `server_name`, `handshake`) and the base user are never touched.**
Reload is graceful (`ExecReload=kill -HUP`).

> The current `3d.negody.ru` block is a pure `return 301` to `3d-pechushka.ru`; the three `location`
> blocks above take precedence over the catch-all redirect, so existing behavior is preserved.
