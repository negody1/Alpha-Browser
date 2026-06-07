# Dev runtime overview

Alpha Browser is a monorepo (pnpm workspaces) with an Electron app:

- **Main process**: `apps/desktop-electron/src/main/*`
- **Preload (chrome UI)**: `apps/desktop-electron/src/preload/index.ts`
- **Guest preload (tabs)**: `apps/desktop-electron/src/preload-guest/index.ts`
- **Renderer (chrome UI)**: `apps/desktop-electron/src/renderer/src/*`

## Two environments

### Windows-native (recommended)

Use Windows Node + pnpm so Electron runs natively and matches the real user runtime:

- accurate DPI/font rendering
- accurate transparency/blur/shadows
- accurate drag & drop / input latency

See `docs/windows-dev.md`.

### WSL dev (supported, but not ideal for UI polish)

WSL is ok for:

- typecheck/build
- core logic iteration
- quick scripts

But it can diverge from Windows UI behavior and performance.

## Path & preload notes

- Preloads are built to:
  - `apps/desktop-electron/out/preload/index.js` (chrome)
  - `apps/desktop-electron/out/preload/guest.js` (tabs)
- Tab `WebContentsView` uses `preload: join(__dirname, '../preload/guest.js')`.
- Static public assets (branding/wallpapers) live in:
  - `apps/desktop-electron/resources/public/*`

