# Alpha Access — Production Deploy Plan (`3d.negody.ru`)

> **STATUS: PLAN ONLY. DO NOT EXECUTE AS PART OF THE RELEASE PASS.**
> This documents the exact steps to bring Alpha Access live behind the existing
> nginx on the VPS. No step here is run from the repo. Run on the server, as root,
> reviewing each command. The backend is a zero-dependency Node `http` service that
> binds **127.0.0.1:8090** only — nginx terminates TLS and reverse-proxies.

---

## 0. Prerequisites (already on the VPS)

- nginx serving `3d.negody.ru` over HTTPS (Let's Encrypt).
- Node ≥ 18 (`node -v`).
- sing-box running under systemd with the VLESS+Reality inbound (port 2087).
- The base/admin VLESS user already present in `/etc/sing-box/config.json`
  (its `name` does **not** start with `dev:`, so the sync never touches it).

---

## 1. Directories & ownership

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin alpha || true
sudo mkdir -p /opt/alpha-access            # application code (read-only to service)
sudo mkdir -p /var/lib/alpha-access        # runtime state: data store + real profile
sudo chown -R alpha:alpha /opt/alpha-access /var/lib/alpha-access
sudo chmod 750 /var/lib/alpha-access
```

Copy the service code (NOT the repo, NOT data/, NOT any *.local.json):

```bash
sudo install -o alpha -g alpha -m 0644 server.mjs sync-singbox.mjs /opt/alpha-access/
sudo cp -r public /opt/alpha-access/ && sudo chown -R alpha:alpha /opt/alpha-access/public
```

## 2. Real proxy profile (server-side secret)

The real VLESS/Reality base profile lives **only** on the server, never in git:

```bash
sudoedit /var/lib/alpha-access/alpha-proxy-profile.local.json   # paste real Reality params
sudo chown alpha:alpha /var/lib/alpha-access/alpha-proxy-profile.local.json
sudo chmod 600 /var/lib/alpha-access/alpha-proxy-profile.local.json
```

The runtime data store (`data/`, hashed device-ids/codes, admin hash) is created by the
service under `ALPHA_DATA_FILE` with mode 600. Path set below.

## 3. Secrets / environment

```bash
sudo install -o alpha -g alpha -m 0600 /dev/null /etc/alpha-access.env
sudoedit /etc/alpha-access.env
```

```ini
ALPHA_ACCESS_PORT=8090
ALPHA_PROFILE_FILE=/var/lib/alpha-access/alpha-proxy-profile.local.json
ALPHA_DATA_FILE=/var/lib/alpha-access/data/store.json
# Strong, unique values — generate with: openssl rand -hex 32
ALPHA_HASH_SALT=<openssl rand -hex 32>        # REQUIRED: default 'change-me-in-production' must be replaced
ALPHA_ADMIN_TOKEN=<openssl rand -hex 32>      # REQUIRED: used ONLY by sync-singbox automation
ALPHA_SESSION_HOURS=12
ALPHA_CODE_TTL_MIN=1440
ALPHA_MAX_ATTEMPTS=5
ALPHA_LOCK_MIN=15
# NOTE: ALPHA_ADMIN_USER / ALPHA_ADMIN_PASSWORD are NO LONGER NEEDED.
# The admin is created through the first-run web wizard (see below). Leaving them
# unset is the recommended production path — no admin password ever lives in the
# env file or shell history.
```

### Admin creation — first-run wizard (no env password)

On first start, the store has no admin. Opening `https://3d.negody.ru/admin/alpha`
shows a **first-run setup wizard** (login + password + confirm). Submitting it:
- creates the admin (salted scrypt hash, server-side validation: user ≥ 3, password ≥ 8, confirm match),
- auto-logs you in,
- **permanently disables the wizard** — `GET /api/alpha/admin/setup-status` returns
  `needs_setup:false` and `POST /api/alpha/admin/setup` returns `409 already_initialized`
  forever after. The wizard cannot be re-triggered without deleting the admin record.

> The password is stored only as a salted scrypt hash; never logged, never returned.
> Change it later in the UI (`/admin/alpha` → «Настройки»), which also invalidates
> all active sessions.
>
> **Optional legacy path:** if you DO set `ALPHA_ADMIN_USER` + `ALPHA_ADMIN_PASSWORD`,
> the admin is bootstrapped from them on first start and the wizard is skipped. This
> is supported but discouraged (password ends up in the env file). Prefer the wizard.
>
> **Password recovery:** stop the service, remove the `"admin"` key from
> `/var/lib/alpha-access/data/store.json` (activation data is preserved), restart —
> the wizard re-appears at `/admin/alpha`.

## 4. systemd service

`/etc/systemd/system/alpha-access.service`:

```ini
[Unit]
Description=Alpha Access activation service
After=network.target

[Service]
Type=simple
User=alpha
Group=alpha
EnvironmentFile=/etc/alpha-access.env
WorkingDirectory=/opt/alpha-access
ExecStart=/usr/bin/node /opt/alpha-access/server.mjs
Restart=on-failure
RestartSec=2
# hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/alpha-access

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alpha-access
curl -s http://127.0.0.1:8090/api/alpha/health   # -> {"ok":true}
```

## 5. nginx — serve `/alpha*` locally, keep redirecting everything else

**Current state:** the `3d.negody.ru` HTTPS vhost is a catch-all
`return 301 https://3d-pechushka.ru$request_uri;` (verified: every path → 301).
The fix is to move that redirect from the **server** level into a `location / {}`
block, then add higher-priority `location` blocks for the Alpha paths. nginx match
precedence guarantees `location =` (exact) and `location ^~` (prefix) win over the
`location /` fallback, so only `/alpha*` reaches the service — the rest still redirects.

### Exact diff for the `3d.negody.ru` server block

```diff
  server {
      listen 443 ssl;
      listen [::]:443 ssl;
      server_name 3d.negody.ru;

      ssl_certificate     /etc/letsencrypt/live/3d.negody.ru/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/3d.negody.ru/privkey.pem;

-     # OLD: whole domain redirected to pechushka
-     return 301 https://3d-pechushka.ru$request_uri;
+     # Alpha Access — served locally. These come BEFORE the catch-all and win by
+     # nginx precedence (exact `=` and prefix `^~` beat the `location /` fallback).
+     location = /alpha          { proxy_pass http://127.0.0.1:8090; include /etc/nginx/snippets/alpha-proxy.conf; }
+     location = /alpha/register { proxy_pass http://127.0.0.1:8090; include /etc/nginx/snippets/alpha-proxy.conf; }
+     location = /admin/alpha    { proxy_pass http://127.0.0.1:8090; include /etc/nginx/snippets/alpha-proxy.conf; }
+     location ^~ /api/alpha/    { proxy_pass http://127.0.0.1:8090; include /etc/nginx/snippets/alpha-proxy.conf; }
+
+     # Everything else still redirects to pechushka (unchanged behaviour).
+     location / {
+         return 301 https://3d-pechushka.ru$request_uri;
+     }
  }
```

### Shared proxy snippet — `/etc/nginx/snippets/alpha-proxy.conf`

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;   # service uses this for rate-limit
proxy_set_header X-Forwarded-Proto $scheme;                       # enables Secure cookie flag on HTTPS
proxy_http_version 1.1;
proxy_read_timeout 30s;
```

### Apply (you run this — NOT part of this prep)

```bash
sudo nginx -t && sudo systemctl reload nginx
# verify: /admin/alpha must NOT 301, root MUST still 301:
curl -sI https://3d.negody.ru/admin/alpha | head -1   # expect 200
curl -sI https://3d.negody.ru/            | head -1   # expect 301 -> 3d-pechushka.ru
```

## 6. sing-box user reconciliation (timer)

`sync-singbox.mjs` mints/removes only `dev:`-named VLESS users to match the ACTIVE
device set; it preserves the base/admin user. Validate dry-run first:

```bash
cd /opt/alpha-access
ALPHA_ACCESS_URL=http://127.0.0.1:8090 ALPHA_ADMIN_TOKEN=<token> node sync-singbox.mjs   # dry-run
```

`/etc/systemd/system/alpha-sync.service`:
```ini
[Unit]
Description=Reconcile sing-box users with Alpha Access active devices
After=alpha-access.service sing-box.service
[Service]
Type=oneshot
EnvironmentFile=/etc/alpha-access.env
Environment=ALPHA_ACCESS_URL=http://127.0.0.1:8090
Environment=SINGBOX_CONFIG=/etc/sing-box/config.json
ExecStart=/usr/bin/node /opt/alpha-access/sync-singbox.mjs --apply
```

`/etc/systemd/system/alpha-sync.timer`:
```ini
[Unit]
Description=Run alpha-sync every 2 minutes
[Timer]
OnBootSec=60
OnUnitActiveSec=120
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now alpha-sync.timer
```

`--apply` backs up the config (`config.json.bak-sync-<ts>`), runs `sing-box check`
on a temp copy, swaps it in only if valid, then `systemctl reload sing-box`
(graceful `kill -HUP`, no dropped connections).

## 7. Backup

```bash
# nightly: data store + the real profile (cron or systemd timer)
tar czf /root/alpha-backups/alpha-$(date +%F).tgz \
  /var/lib/alpha-access/data /var/lib/alpha-access/alpha-proxy-profile.local.json
# sing-box config is auto-backed-up by each --apply run; also keep a manual copy.
```

## 8. Smoke test plan (run after go-live)

Each step: **Expected** = pass condition; **FAIL** = stop and roll back.

| # | Step | Expected | FAIL if |
|---|------|----------|---------|
| 1 | Open `https://3d.negody.ru/alpha` | 200, landing/registration page renders (not the pechushka redirect) | 301 to pechushka, 404, or 502 |
| 2 | Submit a test email on `/alpha/register` | `{ok:true}`; row appears `pending` in admin | 4xx/5xx, or no row created |
| 3 | First open of `/admin/alpha` | First-run **wizard** shown (login+password+confirm) | login form shown with no admin, or 301/404 |
| 3a | Create admin via wizard | Auto-logged in, admin table visible; reopening `/admin/alpha` now shows **login**, wizard gone | wizard still appears, or `POST /setup` succeeds twice |
| 4 | Approve the test request | Status → `approved`; one-time code shown once | no code, or code shown repeatedly |
| 5 | Code issuance | Code is single-use, TTL = `ALPHA_CODE_TTL_MIN` min | code reusable, or no expiry |
| 6 | Activate in the desktop browser (Settings → Alpha Proxy) | Device → `active`; profile written to `userData/alpha-proxy/…`; no dev/debug text | error, crash, or raw error string shown to user |
| 7 | Profile delivery | Per-device unique VLESS uuid in profile (not the placeholder) | shared/placeholder uuid, or empty profile |
| 8 | Start proxy (open a PROXY tab) | sing-box starts; page loads through the tunnel | tunnel fails, page hangs, or falls back to DIRECT silently |
| 9 | Egress IP check (visit an IP-echo site in a PROXY tab) | IP = the **VPS (NL)** address, not the local ISP | IP is the local/ISP address |
| 10 | Restart the browser, reopen a PROXY tab | Proxy still works without re-activation (profile persisted) | requires re-activation, or profile lost |
| 11 | `systemctl restart alpha-access` (server) | Admin re-login required (sessions are in-memory by design); activation data intact; client unaffected | activation/device data lost, or store corrupted |
| 12 | `systemctl reload sing-box` (or wait one `alpha-sync` tick) | Existing tunnels survive (graceful `kill -HUP`); active users unchanged | active connections dropped, or users wiped |
| 13 | Revoke the test user in admin | Within one sync tick (≤2 min) the device's `dev:` user is removed from sing-box; client shows a clear "access revoked" message; local profile deleted | user lingers in sing-box, or no client message |
| 14 | Re-test egress in a PROXY tab after revoke | Proxy **no longer works** (tunnel rejected); user prompted to re-activate | revoked device still reaches egress |

> Steps 6–14 require the real desktop client + the live profile on the VPS, so they
> can only be validated **after** deploy — they are the gating set for promoting the
> status from DEPLOYMENT TESTING to PRODUCTION.

## 9. Rollback

- **Service:** `sudo systemctl stop alpha-access` (nginx still serves the rest of the
  site; `/alpha*` returns 502 until restarted). Revert code by reinstalling the
  previous `server.mjs`; `git checkout <prev>` in a checkout, copy file, restart.
- **nginx:** revert the server block to the original server-level
  `return 301 https://3d-pechushka.ru$request_uri;` (remove the four Alpha
  `location` blocks and the `location / {}` wrapper), then
  `nginx -t && systemctl reload nginx`. Domain returns to full redirect.
- **sing-box:** `sudo systemctl stop alpha-sync.timer`, then restore the latest
  `config.json.bak-sync-*` and `systemctl reload sing-box`.
- **Data:** restore the latest `/root/alpha-backups/*.tgz`.
