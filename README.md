# Alpha Browser

Desktop browser with local smart routing (DIRECT / PROXY / AUTO). Windows MVP.

## Status

| Phase | Status |
|-------|--------|
| 0 — Architecture docs | Complete |
| 1 — Skeleton | Complete |
| 2 — Browser shell | Complete |
| 3 — Groups / workspaces | Complete |
| 3.5 — Navigation & favicons | Complete |
| 4–8 | Pending |

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Routing](docs/routing.md)
- [Passwords](docs/passwords.md)
- [Adblock](docs/adblock.md)
- [Mobile future](docs/mobile-future.md)
- [Server audit plan](docs/server-audit-plan.md)
- [MVP scope](docs/mvp-scope.md)
- [Design system](docs/design-system.md)

## Assets

- `assets/branding/logo.png`
- `assets/wallpapers/background.png`
- `assets/ui-reference/main-ui.png`

## Development

```bash
cd alpha-browser
pnpm install
pnpm dev
```

## Stack

Electron · Chromium · React · TypeScript · Vite · Zustand · Tailwind · lucide-react

## Decisions

See [docs/decisions.md](docs/decisions.md).
