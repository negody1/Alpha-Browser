# Windows-native dev (recommended)

Alpha Browser is **Windows-first**. For UI polish (DPI, fonts, drag/drop, blur/transparency, WebContentsView bounds) you should run Electron **natively on Windows**, not inside WSL.

## Why WSL dev is not representative

- **Rendering differences**: WSLg can alter font smoothing, DPI scaling, blur/transparency and shadow composition.
- **Input/drag & drop**: pointer capture, drag events and performance can differ across the WSLg bridge.
- **Native modules**: `electron` and other deps are platform-specific; Linux `node_modules` cannot be reused by Windows Node.
- **Performance/watchers**: file watching across `\\wsl$` is slower and can be flaky.

## Recommended workflow

1) Keep a **Windows filesystem** checkout (example):

- `C:\Users\<you>\projects\alpha-browser`

2) Install:

- Node.js **20+**
- pnpm **9+** (via corepack or `npm i -g pnpm`)

3) Start dev:

```powershell
cd C:\Users\<you>\projects\alpha-browser
pnpm install
pnpm --filter @alpha/desktop-electron dev
```

## One-command / double-click launcher

From your Windows checkout:

- run `scripts\windows\alpha-dev.cmd`
- or run `scripts\windows\alpha-dev.ps1` in PowerShell

This script will:

- check `node`/`pnpm`
- run `pnpm install` on first run
- start `pnpm --filter @alpha/desktop-electron dev`

## If your repo is only in WSL

You can access it via `\\wsl$\Ubuntu\home\egor\projects\alpha-browser`, but this is **not recommended** for native dev:

- dependencies/platform mismatch
- slow watchers
- inconsistent UI feel

Instead, copy/clone the repo to Windows FS for daily UI work.

