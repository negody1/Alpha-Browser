#!/usr/bin/env bash
#
# deploy.sh — guarded one-shot deploy of Alpha Access onto the VPS for 3d.negody.ru.
#
#   RUN THIS ON THE SERVER (as root), from inside a copy of services/alpha-access/.
#   It is NOT run from CI and NOT from the developer machine.
#
#   ./deploy.sh                # dry-run (default): inspect + print plan, change NOTHING
#   ./deploy.sh --dry-run      # same as above, explicit
#   ./deploy.sh --apply        # perform the deploy (backup-first, fail-fast, auto-rollback nginx)
#
# Design rules (enforced below):
#   * backup-first: every mutating phase is preceded by a timestamped backup
#   * fail-fast: `set -Eeuo pipefail` + ERR trap; any failure stops and points at the backup
#   * no secret output: salts/tokens are generated ON THE SERVER straight into a 0640 file,
#     never echoed; the base proxy profile is validated by KEY NAME only, never printed
#   * non-destructive: no `rm -rf`, no docker, no prune, no reboot, no full-server restart;
#     only Alpha Access files, its systemd units, its nginx locations, and sing-box user sync
#   * idempotent: re-running --apply detects existing state and skips/updates safely
#
# What the operator MUST place on the server BEFORE --apply:
#   /var/lib/alpha-access/alpha-proxy-profile.local.json   (real VLESS/Reality base profile)
#   See "PHASE 4" output / README.md for the exact shape. The script never creates it.
#
# Optional environment overrides:
#   ALPHA_NGINX_VHOST=/etc/nginx/sites-available/3d.negody.ru   # if auto-detect is ambiguous
#   ALPHA_SKIP_SYNC_TIMER=1                                      # deploy service but not the timer

set -Eeuo pipefail

# ── constants ──────────────────────────────────────────────────────────────
APP_USER="alpha"
APP_GROUP="alpha"
APP_DIR="/opt/alpha-access"
LIB_DIR="/var/lib/alpha-access"
DATA_DIR="${LIB_DIR}/data"
PROFILE="${LIB_DIR}/alpha-proxy-profile.local.json"
ENV_FILE="/etc/alpha-access.env"
SB_CONFIG="${SINGBOX_CONFIG:-/etc/sing-box/config.json}"
NGINX_SNIPPET_DIR="/etc/nginx/snippets"
NGINX_LOC_SNIPPET="${NGINX_SNIPPET_DIR}/alpha-access.conf"
NGINX_HDR_SNIPPET="${NGINX_SNIPPET_DIR}/alpha-proxy-headers.conf"
DOMAIN="3d.negody.ru"
PORT="8090"

TS="$(date +%Y%m%d-%H%M%S)"
BK_ROOT="/root/alpha-deploy-backups"
BK="${BK_ROOT}/${TS}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY=1   # default dry-run

# ── output helpers (no colors that could hide in logs; no secret values) ─────
log()  { printf '   %s\n' "$*"; }
ok()   { printf '   [OK]   %s\n' "$*"; }
warn() { printf '   [WARN] %s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }
die()  { printf '\n[FAIL] %s\n' "$*" >&2; rollback_hint; exit 1; }

rollback_hint() {
  cat >&2 <<HINT

------------------------------------------------------------------
ROLLBACK (run manually; backups are under ${BK} if --apply reached backup phase):
  systemctl disable --now alpha-sync.timer 2>/dev/null || true
  systemctl disable --now alpha-access 2>/dev/null || true
  # nginx: restore the vhost + remove snippets, then reload
  [ -f "${BK}/nginx-vhost.bak" ] && cp -a "${BK}/nginx-vhost.bak" "\$ALPHA_VHOST_PATH"
  rm -f ${NGINX_LOC_SNIPPET} ${NGINX_HDR_SNIPPET}
  nginx -t && systemctl reload nginx
  # sing-box: restore the pre-deploy config if the sync timer changed it
  ls -t ${SB_CONFIG}.bak-sync-* 2>/dev/null | head -1   # newest sync backup
  [ -f "${BK}/sing-box-config.json" ] && cp -a "${BK}/sing-box-config.json" "${SB_CONFIG}" && systemctl reload sing-box
  # data (only if you need to revert the store):
  [ -f "${BK}/alpha-access-lib.tar.gz" ] && tar xzf "${BK}/alpha-access-lib.tar.gz" -C /
------------------------------------------------------------------
HINT
}

trap 'die "aborted at line ${LINENO} (command: ${BASH_COMMAND})"' ERR

# ── arg parsing ──────────────────────────────────────────────────────────────
for a in "$@"; do
  case "$a" in
    --apply)   DRY=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $a (use --dry-run or --apply)" ;;
  esac
done
if [ "${DRY}" -eq 1 ]; then section "MODE: DRY-RUN (nothing will be changed)"; else section "MODE: APPLY"; fi

# ── helper: detect the nginx vhost file for the domain ───────────────────────
detect_vhost() {
  if [ -n "${ALPHA_NGINX_VHOST:-}" ]; then echo "${ALPHA_NGINX_VHOST}"; return 0; fi
  # prefer enabled sites; fall back to a full scan
  local hit
  hit="$(grep -rlE "server_name[^;]*\b${DOMAIN//./\\.}\b" /etc/nginx 2>/dev/null | head -1 || true)"
  echo "${hit}"
}

# Count server-level pechushka redirects inside server blocks whose server_name matches
# DOMAIN. HTTP (:80) + HTTPS (:443) => 2 is normal; only >1 redirect *within the same*
# server block is ambiguous.
count_domain_server_level_redirs() {
  local file="$1"
  awk -v dom="${DOMAIN}" '
    BEGIN { depth=0; in_srv=0; is_dom=0; in_loc=0; n=0; err=0; r301=0 }
    {
      if (match($0, /^[ \t]*server[ \t]*\{/) && depth == 0) {
        in_srv=1; is_dom=0; in_loc=0; r301=0
      }
      if (in_srv && $0 ~ ("server_name[^;]*" dom)) is_dom=1
      if (in_srv && is_dom && $0 ~ /^[ \t]*location[ \t]/) in_loc=1
      if (in_srv && is_dom && !in_loc && $0 ~ /return[ \t]+301[^;]*3d-pechushka\.ru/) {
        r301++
        if (r301 > 1) err=1
        if (r301 == 1) n++
      }
      o=gsub(/\{/, "&", $0); c=gsub(/\}/, "&", $0)
      depth += o - c
      if (in_srv && depth == 0) { in_srv=0; is_dom=0; in_loc=0; r301=0 }
    }
    END { if (err) exit 2; print n }
  ' "${file}"
}

# Patch each server block for DOMAIN: insert alpha snippet + wrap server-level pechushka
# redirect in `location / { ... }`. Supports separate HTTP and HTTPS blocks (count=2).
# Exit 2 if any DOMAIN server block has >1 server-level pechushka redirect.
patch_vhost_for_alpha() {
  local src="$1" dst="$2"
  awk -v inc="include ${NGINX_LOC_SNIPPET};" -v dom="${DOMAIN}" '
    BEGIN { depth=0; in_srv=0; is_dom=0; in_loc=0; r301=0; inc_done=0; err=0 }
    {
      line=$0
      if (match(line, /^[ \t]*server[ \t]*\{/) && depth == 0) {
        in_srv=1; is_dom=0; in_loc=0; r301=0; inc_done=0
      }
      if (in_srv && line ~ ("server_name[^;]*" dom)) is_dom=1
      if (in_srv && is_dom && line ~ /^[ \t]*location[ \t]/) {
        if (!inc_done && index(line, "alpha-access.conf") == 0) {
          match(line, /^[ \t]*/); print substr(line, 1, RLENGTH) inc
          inc_done=1
        }
        in_loc=1
      }
      if (in_srv && is_dom && !in_loc && line ~ /return[ \t]+301[^;]*3d-pechushka\.ru/) {
        r301++
        if (r301 > 1) { err=1; print line; next }
        if (!inc_done) {
          match(line, /^[ \t]*/); print substr(line, 1, RLENGTH) inc
          inc_done=1
        }
        match(line, /^[ \t]*/); ind=substr(line, 1, RLENGTH)
        stmt=line; sub(/^[ \t]*/, "", stmt)
        print ind "location / { " stmt " }"
        o=gsub(/\{/, "&", line); c=gsub(/\}/, "&", line)
        depth += o - c
        if (in_srv && depth == 0) { in_srv=0; is_dom=0; in_loc=0; r301=0; inc_done=0 }
        next
      }
      print line
      o=gsub(/\{/, "&", line); c=gsub(/\}/, "&", line)
      depth += o - c
      if (in_srv && depth == 0) { in_srv=0; is_dom=0; in_loc=0; r301=0; inc_done=0 }
    }
    END { exit (err ? 2 : 0) }
  ' "${src}" > "${dst}"
}


# =============================================================================
# PHASE 1 — PREFLIGHT (read-only, runs in BOTH modes)
# =============================================================================
section "PHASE 1 — preflight (read-only)"
PF_FAIL=0
chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else warn "$1 — NOT satisfied"; PF_FAIL=1; fi; }

if [ "$(id -u)" -eq 0 ]; then ok "running as root"; else warn "NOT root — re-run with sudo"; PF_FAIL=1; fi
chk "node present"        'command -v node'
chk "nginx present"       'command -v nginx'
chk "systemd present"     'command -v systemctl'
if command -v sing-box >/dev/null 2>&1 || [ -x /usr/local/bin/sing-box ]; then ok "sing-box present"; else warn "sing-box not found (sync timer will be skipped)"; fi
if systemctl is-active --quiet nginx; then ok "nginx active"; else warn "nginx not active"; PF_FAIL=1; fi
if systemctl is-active --quiet sing-box; then ok "sing-box active"; else warn "sing-box not active (sync timer will be skipped)"; fi

if [ -f "${SB_CONFIG}" ]; then
  ok "sing-box config exists: ${SB_CONFIG}"
  # report users[] presence WITHOUT printing uuid/private_key/short_id
  if node -e 'const c=require(process.argv[1]);const i=(c.inbounds||[]).find(x=>x.type==="vless");process.exit(i&&Array.isArray(i.users)?0:1)' "${SB_CONFIG}" 2>/dev/null; then
    USER_COUNT="$(node -e 'const c=require(process.argv[1]);const i=(c.inbounds||[]).find(x=>x.type==="vless");console.log((i.users||[]).length)' "${SB_CONFIG}" 2>/dev/null || echo '?')"
    ok "vless inbound has users[] (count=${USER_COUNT}; values not shown)"
  else
    warn "no vless inbound users[] found in sing-box config"
  fi
else
  warn "sing-box config not found at ${SB_CONFIG}"
fi

VHOST="$(detect_vhost || true)"
if [ -n "${VHOST}" ] && [ -f "${VHOST}" ]; then
  ok "nginx vhost for ${DOMAIN}: ${VHOST}"
  if grep -qE "return[[:space:]]+301[^;]*3d-pechushka\.ru" "${VHOST}"; then
    if ! DOMAIN_REDIRECT_BLOCKS="$(count_domain_server_level_redirs "${VHOST}" 2>/tmp/alpha-nginx-redir.err)"; then
      warn "multiple server-level pechushka redirects inside one ${DOMAIN} server block (ambiguous)"
    elif [ "${DOMAIN_REDIRECT_BLOCKS}" -ge 1 ] 2>/dev/null; then
      ok "pechushka redirect in ${DOMAIN} server block(s): ${DOMAIN_REDIRECT_BLOCKS} (HTTP+HTTPS = 2 is OK)"
    else
      warn "pechushka redirect present in file but not in a ${DOMAIN} server block — manual nginx review may be needed"
    fi
  else
    warn "no 'return 301 ...3d-pechushka.ru' directive found in vhost (manual nginx review may be needed)"
  fi
  if grep -q "snippets/alpha-access.conf" "${VHOST}"; then ok "alpha locations already included (idempotent re-run)"; fi
else
  warn "could not auto-detect a vhost containing 'server_name ${DOMAIN}' — set ALPHA_NGINX_VHOST=/path before --apply"
  PF_FAIL=1
fi

# planned changes summary
section "PLAN — what --apply WOULD do"
log "backup    -> ${BK}/ (nginx vhost+full tree, sing-box config, existing ${APP_DIR}, existing ${LIB_DIR})"
log "user      -> create system user/group '${APP_USER}' if missing"
log "dirs      -> ${APP_DIR} (root:${APP_GROUP} 750), ${LIB_DIR} (${APP_USER}:${APP_GROUP} 750), ${DATA_DIR} (750)"
log "copy      -> server.mjs, sync-singbox.mjs, public/, README.md, DEPLOY.md  ->  ${APP_DIR}"
log "exclude   -> test.mjs, *.local.json, data/, node_modules, .git, release, out, *.exe, .env"
log "profile   -> require ${PROFILE} (validated by key-name; chmod 600 ${APP_USER}:${APP_GROUP})"
log "env       -> ${ENV_FILE} (root:${APP_GROUP} 640; ALPHA_HASH_SALT + ALPHA_ADMIN_TOKEN generated on-box; no admin login/password)"
log "systemd   -> alpha-access.service, alpha-sync.service, alpha-sync.timer"
log "nginx     -> snippets ${NGINX_LOC_SNIPPET} + ${NGINX_HDR_SNIPPET}; vhost: per-${DOMAIN} server block, wrap pechushka redirect(s) in location / and add alpha include (HTTP+HTTPS OK)"
log "validate  -> systemctl health + curl /api/alpha/health + curl alpha paths (200) + '/' (301)"

if [ "${PF_FAIL}" -ne 0 ] && [ "${DRY}" -eq 0 ]; then
  die "preflight has unmet requirements (see [WARN] above). Fix them, then re-run --apply."
fi
if [ "${DRY}" -eq 1 ]; then
  section "DRY-RUN COMPLETE — no changes made. Re-run with --apply to deploy."
  trap - ERR
  exit 0
fi

# =============================================================================
# APPLY MODE
# =============================================================================

# ── PHASE 2 — backups ────────────────────────────────────────────────────────
section "PHASE 2 — backups -> ${BK}"
mkdir -p "${BK}"
[ -n "${VHOST}" ] && cp -a "${VHOST}" "${BK}/nginx-vhost.bak"
tar czf "${BK}/nginx-etc.tar.gz" -C / etc/nginx
[ -f "${SB_CONFIG}" ] && cp -a "${SB_CONFIG}" "${BK}/sing-box-config.json"
[ -d "${APP_DIR}" ] && tar czf "${BK}/alpha-access-opt.tar.gz" -C / "${APP_DIR#/}"
[ -d "${LIB_DIR}" ] && tar czf "${BK}/alpha-access-lib.tar.gz" -C / "${LIB_DIR#/}"
[ -s "${BK}/nginx-etc.tar.gz" ] || die "backup verification failed: ${BK}/nginx-etc.tar.gz is empty"
ok "backups created and verified under ${BK}"
# expose the vhost path for the rollback hint
export ALPHA_VHOST_PATH="${VHOST}"

# ── PHASE 3 — user + directories ─────────────────────────────────────────────
section "PHASE 3 — user + directories"
if ! getent group "${APP_GROUP}" >/dev/null; then groupadd --system "${APP_GROUP}"; ok "group ${APP_GROUP} created"; else ok "group ${APP_GROUP} exists"; fi
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${APP_GROUP}" --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
  ok "user ${APP_USER} created"
else ok "user ${APP_USER} exists"; fi
mkdir -p "${APP_DIR}" "${LIB_DIR}" "${DATA_DIR}"
chown root:"${APP_GROUP}" "${APP_DIR}";        chmod 750 "${APP_DIR}"
chown "${APP_USER}:${APP_GROUP}" "${LIB_DIR}"; chmod 750 "${LIB_DIR}"
chown "${APP_USER}:${APP_GROUP}" "${DATA_DIR}";chmod 750 "${DATA_DIR}"
ok "directories ready with correct ownership/permissions"

# ── PHASE 4 — copy code (named files only; never the excluded set) ───────────
section "PHASE 4 — deploy code from ${SCRIPT_DIR}"
for f in server.mjs sync-singbox.mjs; do
  [ -f "${SCRIPT_DIR}/${f}" ] || die "missing source file: ${SCRIPT_DIR}/${f}"
  install -o root -g "${APP_GROUP}" -m 0644 "${SCRIPT_DIR}/${f}" "${APP_DIR}/${f}"
done
[ -d "${SCRIPT_DIR}/public" ] || die "missing source dir: ${SCRIPT_DIR}/public"
rm -rf "${APP_DIR}/public.new"
mkdir -p "${APP_DIR}/public.new"
# copy only regular files from public/ (html/css/js/png), no symlinks/dotfiles
find "${SCRIPT_DIR}/public" -maxdepth 1 -type f -exec install -o root -g "${APP_GROUP}" -m 0644 {} "${APP_DIR}/public.new/" \;
rm -rf "${APP_DIR}/public"; mv "${APP_DIR}/public.new" "${APP_DIR}/public"
for f in README.md DEPLOY.md; do
  [ -f "${SCRIPT_DIR}/${f}" ] && install -o root -g "${APP_GROUP}" -m 0644 "${SCRIPT_DIR}/${f}" "${APP_DIR}/${f}" || true
done
ok "code deployed to ${APP_DIR} (test.mjs / *.local.json / data / node_modules NOT copied)"

# ── PHASE 5 — base proxy profile (NEVER created or printed by this script) ───
section "PHASE 5 — base proxy profile"
if [ ! -f "${PROFILE}" ]; then
  cat >&2 <<MSG
[FAIL] Base proxy profile is missing:
         ${PROFILE}

  This file holds the real VLESS/Reality connection parameters and is created by
  YOU on the server (never by this script, never committed). Required top-level
  keys: server, port, publicKey, shortId, serverName  (flow optional; no per-device
  uuid — the backend injects that). Then:

         chown ${APP_USER}:${APP_GROUP} ${PROFILE}
         chmod 600 ${PROFILE}

  Place it and re-run ./deploy.sh --apply.
MSG
  die "base profile required before the service can start"
fi
# validate JSON + required keys WITHOUT printing any value
if ! node -e '
  const fs=require("fs"); let o;
  try{ o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }catch(e){ console.error("INVALID_JSON"); process.exit(2); }
  const req=["server","port","publicKey","shortId","serverName"];
  const missing=req.filter(k=>!(k in o)||o[k]===null||o[k]==="");
  if(missing.length){ console.error("MISSING_KEYS:"+missing.join(",")); process.exit(3); }
  // Base profile must NOT carry a device uuid — backend injects per-device uuid on activation.
  if ("uuid" in o && o.uuid !== null && o.uuid !== "") {
    console.error("UNEXPECTED_KEY:uuid");
    process.exit(4);
  }
  process.exit(0);
' "${PROFILE}"; then
  die "base profile failed validation (invalid JSON, missing required keys, or unexpected uuid — values were not shown)"
fi
chown "${APP_USER}:${APP_GROUP}" "${PROFILE}"; chmod 600 "${PROFILE}"
ok "base profile present, valid, chmod 600 ${APP_USER}:${APP_GROUP} (contents not shown)"

# ── PHASE 6 — env file (secrets generated on-box, never echoed) ──────────────
section "PHASE 6 — environment file"
if [ -f "${ENV_FILE}" ]; then
  ok "env file already exists — leaving secrets intact: ${ENV_FILE}"
else
  command -v openssl >/dev/null 2>&1 || die "openssl required to generate secrets"
  umask 077
  tmp_env="$(mktemp)"
  {
    printf 'ALPHA_ACCESS_PORT=%s\n' "${PORT}"
    printf 'ALPHA_PROFILE_FILE=%s\n' "${PROFILE}"
    printf 'ALPHA_DATA_FILE=%s\n' "${DATA_DIR}/store.json"
    printf 'ALPHA_HASH_SALT=%s\n' "$(openssl rand -hex 32)"
    printf 'ALPHA_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)"
    printf 'ALPHA_SESSION_HOURS=12\n'
    printf 'ALPHA_CODE_TTL_MIN=1440\n'
  } > "${tmp_env}"
  install -o root -g "${APP_GROUP}" -m 0640 "${tmp_env}" "${ENV_FILE}"
  rm -f "${tmp_env}"
  ok "env file created (root:${APP_GROUP} 640; secret values generated on-box, not printed)"
fi
log "note: admin login/password are NOT in env — created via the first-run wizard at /admin/alpha"

# ── PHASE 7 — systemd units ──────────────────────────────────────────────────
section "PHASE 7 — systemd units"
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/alpha-access.service <<UNIT
[Unit]
Description=Alpha Access activation service
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server.mjs
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${LIB_DIR}

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/alpha-sync.service <<UNIT
[Unit]
Description=Reconcile sing-box users with Alpha Access active devices
After=alpha-access.service sing-box.service
Requires=alpha-access.service

[Service]
Type=oneshot
EnvironmentFile=${ENV_FILE}
Environment=ALPHA_ACCESS_URL=http://127.0.0.1:${PORT}
Environment=SINGBOX_CONFIG=${SB_CONFIG}
ExecStart=${NODE_BIN} ${APP_DIR}/sync-singbox.mjs --apply
UNIT

cat > /etc/systemd/system/alpha-sync.timer <<UNIT
[Unit]
Description=Run alpha-sync every 2 minutes

[Timer]
OnBootSec=60
OnUnitActiveSec=120
AccuracySec=15

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now alpha-access
ok "alpha-access enabled and started"

# health gate
HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/alpha/health" >/dev/null 2>&1; then HEALTH_OK=1; break; fi
  sleep 1
done
[ "${HEALTH_OK}" -eq 1 ] || die "alpha-access health check failed on 127.0.0.1:${PORT} (see: journalctl -u alpha-access)"
ok "health check passed: 127.0.0.1:${PORT}/api/alpha/health"
# confirm no secret leaked into the journal
if journalctl -u alpha-access -n 50 --no-pager 2>/dev/null | grep -qiE 'uuid|publicKey|privateKey|reality|ALPHA_HASH_SALT|ALPHA_ADMIN_TOKEN'; then
  warn "potential sensitive token in service logs — review journalctl -u alpha-access"
else
  ok "no secret-looking fields in recent service logs"
fi

# ── PHASE 8 — nginx (backup-first, validate, auto-rollback on failure) ───────
section "PHASE 8 — nginx routing for ${DOMAIN}"
[ -n "${VHOST}" ] && [ -f "${VHOST}" ] || die "nginx vhost not found; set ALPHA_NGINX_VHOST and re-run"
mkdir -p "${NGINX_SNIPPET_DIR}"

# proxy header snippet
cat > "${NGINX_HDR_SNIPPET}" <<'HDR'
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_read_timeout 30s;
HDR

# alpha location blocks
cat > "${NGINX_LOC_SNIPPET}" <<LOC
# Managed by Alpha Access deploy.sh — reverse-proxy the alpha paths to the local
# service. Everything else falls through to the redirect (location /) in the vhost.
location = /alpha          { proxy_pass http://127.0.0.1:${PORT}; include ${NGINX_HDR_SNIPPET}; }
location = /alpha/register { proxy_pass http://127.0.0.1:${PORT}; include ${NGINX_HDR_SNIPPET}; }
location = /admin/alpha    { proxy_pass http://127.0.0.1:${PORT}; include ${NGINX_HDR_SNIPPET}; }
location ^~ /api/alpha/    { proxy_pass http://127.0.0.1:${PORT}; include ${NGINX_HDR_SNIPPET}; }
LOC
ok "nginx snippets written"

if grep -q "snippets/alpha-access.conf" "${VHOST}"; then
  ok "vhost already references alpha-access.conf — skipping vhost edit (idempotent)"
else
  TMP_VHOST="$(mktemp)"
  if ! patch_vhost_for_alpha "${VHOST}" "${TMP_VHOST}"; then
    rm -f "${TMP_VHOST}"
    die "ambiguous nginx layout: more than one server-level pechushka redirect inside a single ${DOMAIN} server block. Edit manually per DEPLOY.md §5, then re-run."
  fi
  grep -q "snippets/alpha-access.conf" "${TMP_VHOST}" || {
    rm -f "${TMP_VHOST}"
    die "vhost transform produced no alpha include — aborting without writing"
  }
  install -o root -g root -m 0644 "${TMP_VHOST}" "${VHOST}"
  rm -f "${TMP_VHOST}"
  ok "vhost updated: ${VHOST} (per-server-block transform; HTTP+HTTPS redirects supported)"
fi

# validate; auto-restore on failure
if nginx -t 2>/tmp/alpha-nginx-t.log; then
  ok "nginx -t passed"
  systemctl reload nginx
  ok "nginx reloaded"
else
  warn "nginx -t FAILED — restoring vhost from backup and removing snippets"
  cp -a "${BK}/nginx-vhost.bak" "${VHOST}"
  rm -f "${NGINX_LOC_SNIPPET}" "${NGINX_HDR_SNIPPET}"
  nginx -t && systemctl reload nginx || true
  die "nginx config invalid (see /tmp/alpha-nginx-t.log). vhost restored; no routing change applied."
fi

# external validation (best-effort; non-fatal warnings)
section "PHASE 8 — route validation"
codeof() { curl -s -o /dev/null -w '%{http_code}' -I "$1" 2>/dev/null || echo "000"; }
for p in /alpha /admin/alpha /api/alpha/health; do
  c="$(codeof "https://${DOMAIN}${p}")"
  if [ "${c}" = "200" ]; then ok "https://${DOMAIN}${p} -> ${c}"; else warn "https://${DOMAIN}${p} -> ${c} (expected 200)"; fi
done
rc="$(codeof "https://${DOMAIN}/")"
if [ "${rc}" = "301" ]; then ok "https://${DOMAIN}/ -> 301 (redirect preserved)"; else warn "https://${DOMAIN}/ -> ${rc} (expected 301 to 3d-pechushka.ru)"; fi

# ── PHASE 9 — sing-box user sync (dry-run gate, then enable timer) ───────────
section "PHASE 9 — sing-box user sync"
if [ "${ALPHA_SKIP_SYNC_TIMER:-0}" = "1" ]; then
  warn "ALPHA_SKIP_SYNC_TIMER=1 — skipping sync timer (enable later with: systemctl enable --now alpha-sync.timer)"
elif ! { command -v sing-box >/dev/null 2>&1 || [ -x /usr/local/bin/sing-box ]; }; then
  warn "sing-box not installed — skipping sync timer"
elif ! systemctl is-active --quiet sing-box; then
  warn "sing-box not active — skipping sync timer (start sing-box, then: systemctl enable --now alpha-sync.timer)"
else
  log "sync DRY-RUN (no changes; reads admin endpoint over localhost):"
  # Source the env (for ALPHA_ADMIN_TOKEN) in a subshell, then run the dry-run.
  # shellcheck source=/dev/null
  if ( set -a; . "${ENV_FILE}"; set +a;
       ALPHA_ACCESS_URL="http://127.0.0.1:${PORT}" SINGBOX_CONFIG="${SB_CONFIG}" \
       node "${APP_DIR}/sync-singbox.mjs" ); then
    ok "sync dry-run completed (preserves non-dev users; no config written)"
    systemctl enable --now alpha-sync.timer
    if systemctl is-active --quiet alpha-sync.timer; then ok "alpha-sync.timer active (reconciles every 2 min)"; else warn "alpha-sync.timer not active"; fi
    if systemctl is-active --quiet sing-box; then ok "sing-box still active"; else warn "sing-box not active after sync setup"; fi
  else
    warn "sync dry-run failed — NOT enabling the timer. Investigate, then: systemctl enable --now alpha-sync.timer"
  fi
fi

# ── PHASE 10/11 — manual steps (cannot be automated here) ────────────────────
section "NEXT (manual): first-run admin + smoke test"
cat <<NEXT
   1) Open  https://${DOMAIN}/admin/alpha  -> first-run WIZARD -> create admin login/password.
      (Choose a strong password; it is stored only as a salted scrypt hash.)
   2) Smoke test (see ${APP_DIR}/DEPLOY.md section 8, 14 steps):
      register -> approve -> activate in Alpha Browser -> egress IP = VPS (NL)
      -> revoke -> within ~2 min proxy stops working for that device.
NEXT

# ── final summary ─────────────────────────────────────────────────────────────
section "DEPLOY COMPLETE (service + nginx + sync)"
log "backups:        ${BK}"
log "service:        $(systemctl is-active alpha-access 2>/dev/null || echo unknown)  (127.0.0.1:${PORT})"
log "sync timer:     $(systemctl is-active alpha-sync.timer 2>/dev/null || echo 'not enabled')"
log "admin wizard:   https://${DOMAIN}/admin/alpha  (create credentials now)"
rollback_hint
trap - ERR
exit 0
