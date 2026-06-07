# resources/bin

Runtime proxy binary delivery directory.

`sing-box.exe` is delivered here by `scripts/windows/fetch-sing-box.ps1` and is
**not** committed to git (see the root `.gitignore`). Only this README is tracked,
so the directory exists for both dev and packaging.

## Path resolution

- **Dev:** `ProxyClientService.resolveSingBoxPath()` resolves to this folder via
  `app.getAppPath()/resources/bin/sing-box.exe`.
- **Packaged:** `electron-builder` copies this folder to
  `process.resourcesPath/bin` via `extraResources` (kept outside the `asar`
  archive so it stays executable).

## Install / update the binary

From the repository root:

```
pnpm run proxy:fetch-bin     # download pinned version, verify SHA256, place sing-box.exe
pnpm run proxy:verify-bin    # run `sing-box version` (smoke check, no proxy start)
```

The pinned version and checksum live in
`scripts/windows/sing-box.manifest.json`.
