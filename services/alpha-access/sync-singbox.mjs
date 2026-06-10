// sync-singbox.mjs — reconcile sing-box VLESS users with the ACTIVE devices
// from Alpha Access. STAGED / GATED: dry-run by default; `--apply` writes the
// config + reloads. Intended to run ON THE SERVER (where it can read
// /etc/sing-box/config.json). NOT executed from this repo.
//
//   node sync-singbox.mjs                 # dry-run: show the diff, change nothing
//   node sync-singbox.mjs --apply         # write config + `sing-box check` + reload
//
// Env:
//   ALPHA_ACCESS_URL   base url of the running Alpha Access service
//   ALPHA_ADMIN_TOKEN  bearer token for /api/alpha/admin/singbox-users
//   SINGBOX_CONFIG     path to sing-box config.json (default /etc/sing-box/config.json)
//   SINGBOX_BIN        sing-box binary (default /usr/local/bin/sing-box)
//
// SAFETY: preserves every existing user whose `name` does NOT start with "dev:"
// (e.g. the base/admin user). Only "dev:"-named users are reconciled to the
// active set, so revoked devices are removed and the base user is never touched.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const URL_BASE = (process.env.ALPHA_ACCESS_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
const TOKEN = process.env.ALPHA_ADMIN_TOKEN || '';
const CONFIG = process.env.SINGBOX_CONFIG || '/etc/sing-box/config.json';
const BIN = process.env.SINGBOX_BIN || '/usr/local/bin/sing-box';

async function desiredUsers() {
  const res = await fetch(`${URL_BASE}/api/alpha/admin/singbox-users`, { headers: { authorization: 'Bearer ' + TOKEN } });
  if (!res.ok) throw new Error('admin endpoint ' + res.status);
  const j = await res.json();
  return j.users || [];
}

// Normalize a users[] array to the fields sync manages, order-independent, so
// two runs with the same logical set compare equal regardless of array order.
function normUsers(arr) {
  return [...arr]
    .map((u) => ({ uuid: u.uuid, flow: u.flow, name: u.name }))
    .sort((a, b) => String(`${a.name}|${a.uuid}`).localeCompare(String(`${b.name}|${b.uuid}`)));
}

function main(users) {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const inbound = (cfg.inbounds || []).find((i) => i.type === 'vless');
  if (!inbound) throw new Error('no vless inbound in ' + CONFIG);
  const existing = inbound.users || [];
  const preserved = existing.filter((u) => !String(u.name || '').startsWith('dev:'));
  const devUsers = users.map((u) => ({ uuid: u.uuid, flow: u.flow, name: u.name }));
  const next = [...preserved, ...devUsers];

  const before = existing.length;
  const after = next.length;
  // Change detection: compare the logical user set we WOULD write against what
  // is already in the config. No diff -> no backup, no write, no reload.
  const changed = JSON.stringify(normUsers(existing)) !== JSON.stringify(normUsers(next));
  console.log(
    `sing-box users: base/admin=${preserved.length}  device(active)=${devUsers.length}  total ${before} -> ${after}  changed=${changed}`,
  );

  if (!APPLY) {
    console.log(
      changed
        ? 'DRY-RUN: changes pending. Re-run with --apply on the server to write + reload.'
        : 'DRY-RUN: no changes detected; nothing to apply.',
    );
    return;
  }

  if (!changed) {
    // PRIORITY 1 FIX: the timer fires every 2 minutes; skipping unchanged runs
    // avoids hundreds of backup files/day and hundreds of needless sing-box
    // reloads/day on the VPS.
    console.log('no changes detected: sing-box users already in sync; skipping backup + reload.');
    return;
  }

  inbound.users = next;
  const backup = `${CONFIG}.bak-sync-${Date.now()}`;
  copyFileSync(CONFIG, backup);
  const tmp = `${CONFIG}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  // validate before swapping in
  execFileSync(BIN, ['check', '-c', tmp], { stdio: 'inherit' });
  writeFileSync(CONFIG, readFileSync(tmp, 'utf8'), 'utf8');
  execFileSync('systemctl', ['reload', 'sing-box'], { stdio: 'inherit' });
  console.log(`applied changes. backup at ${backup}`);
}

desiredUsers()
  .then(main)
  .catch((e) => {
    console.error('sync failed:', e.message);
    process.exit(1);
  });
