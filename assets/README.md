# Alpha Browser — Visual assets

Source of truth for branding (do not invent new styles).

## Source files (from `Desktop/браузер/` or chat upload)

Canonical copies live in this folder. When you add new exports from Desktop, overwrite these files and re-run the copy command below.

## Expected files (final, source of truth)

These files may be named in Russian (keep them as-is):

- `фон.png`
- `Логотип.png`
- `Логотип для поисковой страницы.png`
- `референс.png` (reference only)

After updating assets, copy to runtime (do not edit images in code):

```bash
cp "assets/Логотип для поисковой страницы.png" apps/desktop-electron/resources/public/branding/logo-ntp.png
cp "assets/Логотип.png" apps/desktop-electron/resources/public/branding/app-logo.png
cp "assets/Логотип.png" apps/desktop-electron/resources/public/branding/favicon-fallback.png
cp "assets/фон.png" apps/desktop-electron/resources/public/wallpapers/background.png
```
