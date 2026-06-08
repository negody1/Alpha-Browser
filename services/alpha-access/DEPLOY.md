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
ALPHA_HASH_SALT=<openssl rand -hex 32>
ALPHA_ADMIN_TOKEN=<openssl rand -hex 32>     # used ONLY by sync-singbox automation
# Bootstrap admin (consumed once, on first start, only if no admin exists yet):
ALPHA_ADMIN_USER=<choose>
ALPHA_ADMIN_PASSWORD=<choose a strong one-time password>
ALPHA_SESSION_HOURS=12
```

> After first start, change the admin password in the UI (`/admin/alpha` → Настройки).
> The bootstrap password is consumed only when the store has no admin; rotating
> `ALPHA_ADMIN_PASSWORD` afterward has no effect (by design — change it in-app).
> The password is stored only as a salted scrypt hash; it is never logged or returned.

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

## 5. nginx — reverse-proxy the public paths to 127.0.0.1:8090

Add inside the existing `server { server_name 3d.negody.ru; ... }` (HTTPS) block.
Paths are namespaced 1:1 so they never collide with the existing site:

```nginx
# public landing + registration
location = /alpha            { proxy_pass http://127.0.0.1:8090; }
location = /alpha/register   { proxy_pass http://127.0.0.1:8090; }
# admin UI (login-gated; httpOnly cookie session)
location = /admin/alpha      { proxy_pass http://127.0.0.1:8090; }
# JSON API (register / device activate / admin)
location ^~ /api/alpha/      { proxy_pass http://127.0.0.1:8090; }

# shared proxy headers (define once, reference above or inline):
#   proxy_set_header Host              $host;
#   proxy_set_header X-Real-IP         $remote_addr;
#   proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
#   proxy_set_header X-Forwarded-Proto $scheme;     # enables Secure cookie flag
#   proxy_http_version 1.1;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The service reads `X-Forwarded-For` for rate-limiting and sets the session cookie
`Secure` when `X-Forwarded-Proto=https`.

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

## 8. Smoke test (after go-live)

1. `https://3d.negody.ru/admin/alpha` → login form → log in with bootstrap creds.
2. Настройки → change password → re-login with new password (old one rejected).
3. `https://3d.negody.ru/alpha/register` with a test email → row appears pending.
4. Approve in admin → copy one-time code.
5. Activate in the desktop client → device shows `active`, egress works.
6. Revoke in admin → within one timer tick the device's `dev:` user is gone,
   client gets a clear "access revoked" message, profile deleted locally.

## 9. Rollback

- **Service:** `sudo systemctl stop alpha-access` (nginx still serves the rest of the
  site; `/alpha*` returns 502 until restarted). Revert code by reinstalling the
  previous `server.mjs`; `git checkout <prev>` in a checkout, copy file, restart.
- **nginx:** remove the four `location` blocks, `nginx -t && systemctl reload nginx`.
- **sing-box:** `sudo systemctl stop alpha-sync.timer`, then restore the latest
  `config.json.bak-sync-*` and `systemctl reload sing-box`.
- **Data:** restore the latest `/root/alpha-backups/*.tgz`.
