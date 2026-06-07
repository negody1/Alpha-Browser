# Alpha Browser — Server Read-Only Audit Plan

> Phase 8. **No changes without explicit approval.**  
> Goal: understand existing infrastructure and safe integration points for browser proxy.

## 1. Audit principles

| Rule | Detail |
|------|--------|
| Read-only | Inspect configs, logs, listening ports — no edits |
| No secrets | Do not read `.env`, private keys, WG conf with keys |
| No restarts | No systemctl, docker restart, prune, deploy |
| No firewall | No iptables/nftables/ufw changes |
| Document only | Output is report + recommendations |
| Approval gate | Any change ticket required before implementation |

---

## 2. Preconditions

- [ ] Written approval from project owner for SSH read access
- [ ] Dedicated read-only audit user (preferred) OR owner-supervised session
- [ ] Time window agreed (low-traffic period)
- [ ] Rollback contact identified

---

## 3. Audit checklist

### 3.0 Multi-IP requirement (Alpha proxy)

**Known constraint**: server has multiple public IPs. For Alpha proxy, the preferred public/egress IP is:

- **Preferred**: `185.192.246.197`
- **Avoid defaulting to**: `5.129.214.182` (known VPN/proxy traffic issues) **unless explicitly approved**

During audit (read-only), verify:

```bash
ip addr
ip route
ip rule
ss -tulpn
```

Deliverable: explain how to bind/listen and how to ensure **egress source IP** uses `185.192.246.197` for Alpha proxy, without impacting WireGuard/TG proxy.

### 3.1 Network listeners

```bash
# READ-ONLY — examples, run only with approval
ss -tulpn
```

Document:

- WireGuard interface and port
- Telegram proxy process and port
- Any existing HTTP/SOCKS proxies
- Public vs bind-localhost addresses

### 3.2 Process map

```bash
ps aux | grep -E 'wireguard|wg|telegram|mtproto|socks|dante|3proxy|nginx|haproxy'
```

- PIDs, binary paths, systemd units (read unit files without editing)

### 3.3 Docker (if used)

```bash
docker ps
docker inspect <container>  # no restart
```

- Container port mappings
- Networks overlapping with proposed browser proxy

### 3.4 WireGuard

- Interface names (`wg show`) — **no private keys**
- Allowed IPs and peers (redact keys in report)
- Confirm: browser proxy must **not** modify WG config

### 3.5 Telegram proxy

- Which port/protocol (MTProto, SOCKS, HTTP)
- Expected clients (only TG app vs general)
- Risk: sharing same SOCKS port with browser traffic

### 3.6 Resource limits

- CPU/RAM baseline under normal load
- Estimate incremental load from browser users (connections per user)

### 3.7 Firewall (read-only)

```bash
# distribution-specific, read-only
iptables-save
# or nft list ruleset
```

- Document what is exposed to internet

### 3.8 Logs (sanitized)

- Sample proxy access log format (no user credentials)
- Rotation policy

---

## 4. Key questions to answer

1. Is there a **dedicated SOCKS/HTTP port** for browser use separate from TG?
2. Can browser use `127.0.0.1:PORT` on server via SSH tunnel, or must it be public?
3. Max concurrent connections supported?
4. Does adding browser traffic violate TG proxy ToS or capacity?
5. Authentication method for browser proxy (user/pass, IP allowlist)?
6. Health check endpoint already exists?
7. Static config URL feasible for `routes.json` template?

---

## 5. Risk matrix (template)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TG proxy saturation | Medium | High | Separate port/instance |
| WG misconfiguration | Low | Critical | No WG changes in MVP |
| Open proxy abuse | Medium | High | Auth + firewall allowlist |
| Legal/compliance | — | — | Owner review |

---

## 6. Recommended integration patterns (post-audit options)

**Option A — Local client proxy only**

- User runs `routes.json` with `SOCKS5 127.0.0.1:1080` on PC (SSH -D or local forward).
- Server audit minimal.

**Option B — Dedicated server SOCKS for Alpha**

- New service on **new port**, bind localhost or VPN-only.
- Requires approval + new systemd unit.

**Option C — Config CDN only**

- Server serves static `routes-template.json` over HTTPS.
- No proxy on server.

---

## 7. Deliverables

1. `docs/server-audit-report.md` (created after audit, redacted)
2. Updated proxy endpoint recommendation for default `routes.json`
3. List of approved vs deferred server changes

---

## 8. Explicitly forbidden during audit

- Reading `.env`, `*.pem`, private keys
- `systemctl restart|stop|start`
- `docker restart|prune|rm`
- Editing any config file
- `wg set` / modifying peers
- Opening new firewall holes

---

## 9. Approval template

```
Change request: ___________________
Requested by: ___________________
Scope: ___________________
Rollback plan: ___________________
Approved by: ___________________  Date: __________
```

---

## 10. MVP default until audit completes

- Ship with **user-configured** proxy in `routes.json`.
- Default `127.0.0.1:1080` documented as placeholder.
- No automatic server discovery.
