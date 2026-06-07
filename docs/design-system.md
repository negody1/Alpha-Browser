# Alpha Browser — Design System

> Premium dark UI. Do not invent a new visual language — follow provided assets.

## 1. Reference assets

| Asset | Path |
|-------|------|
| Logo | `assets/branding/logo.png` |
| NTP background | `assets/wallpapers/background.png` |
| UI reference | `assets/ui-reference/main-ui.png` |

---

## 2. Color tokens

```css
:root {
  --color-bg: #0E1116;
  --color-surface: #161B22;
  --color-surface-hover: #1D2530;
  --color-accent: #7A4DFF;
  --color-accent-soft: #9B6CFF;
  --color-success: #31D67B;
  --color-warning: #FFB648;
  --color-error: #FF5C5C;
  --color-text-primary: #F5F7FA;
  --color-text-secondary: #97A3B6;
  --color-border: rgba(255, 255, 255, 0.08);
}
```

### Usage

| Token | Use |
|-------|-----|
| bg | Window background, chrome base |
| surface | Sidebar, tab bar, inputs |
| surface-hover | Hover rows, tab hover |
| accent | Active tab indicator, primary buttons, logo glow |
| accent-soft | Gradients, focus rings |
| success | Proxy online indicator |
| warning | Caution states |
| error | Route ERROR badge, destructive confirm |
| text-primary | Headings, URLs |
| text-secondary | Labels, descriptions |
| border | Dividers, input outlines |

---

## 3. Typography

- **UI font**: `Inter`, `Segoe UI`, system-ui fallback
- **Monospace** (URLs): `JetBrains Mono`, `Consolas`

| Scale | Size | Weight |
|-------|------|--------|
| Title | 20–24px | 600 |
| Body | 14px | 400 |
| Caption | 12px | 400 |
| Tab label | 13px | 500 |

---

## 4. Spacing and radius

- Base unit: **4px**
- Component padding: 12–16px
- **Border radius**: 12px default, 18px large cards (NTP search, modals)
- Sidebar width: **56px** icon-only (expand post-MVP)

---

## 5. Motion

- Duration: **150–250ms**
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`
- Tab switch: opacity + subtle translate (optional)
- Popup: fade + scale from 0.98

---

## 6. Shadows

```css
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.25);
--shadow-md: 0 8px 24px rgba(0, 0, 0, 0.35);
--shadow-glow-accent: 0 0 24px rgba(122, 77, 255, 0.35);
```

Use glow sparingly (logo, active accent elements).

---

## 7. Layout regions

```
┌──────────────────────────────────────────────────────────┐
│ Tab bar (surface, active tab: accent top border 2px)      │
├────┬─────────────────────────────────────────────────────┤
│ S  │ Toolbar: nav │ address bar │ route badge │ ★ │ ⋮   │
│ i  ├─────────────────────────────────────────────────────┤
│ d  │                                                     │
│ e  │              Web content / NTP                      │
│ b  │                                                     │
│ a  │                                                     │
│ r  │                                                     │
└────┴─────────────────────────────────────────────────────┘
```

### Chrome heights (approximate)

- Tab bar: 42px
- Toolbar: 50px
- Sidebar: full height, 56px width
- Tab: 36px height, 14px horizontal padding, 8px gap (icon + title)

---

## 8. Components

### Address bar

- Background: surface
- Radius: 14px
- Left: lock icon (secure), right: route badge
- Focus: accent-soft ring 1px

### Route badge

- Pill shape, 12px radius
- Variants: AUTO (secondary text), DIRECT (neutral), PROXY (accent border), ERROR (error color)

### Sidebar icons

- lucide-react, 20px stroke 1.5
- Inactive: text-secondary
- Active: accent + subtle surface-hover background

### Buttons

- Primary: accent fill, white text
- Secondary: surface border
- Ghost: transparent hover surface-hover

### Settings

- Left nav list, selected item accent bg at 15% opacity
- Toggles: accent when on

### New Tab Page

- Full bleed `background.png` with dark overlay `linear-gradient(rgba(14,17,22,0.4), rgba(14,17,22,0.85))`
- Centered logo + "ALPHA" wordmark
- Search bar: wide, 18px radius, surface at 80% opacity + backdrop blur
- Quick links: favicon circles 48px

---

## 9. Icons

- Library: **lucide-react**
- No mixed icon packs in MVP

---

## 10. Window frame

- **MVP**: native OS titlebar (`frame: true`) — see [decisions.md](./decisions.md) D6
- **Deferred**: custom frameless chrome + `titleBarOverlay` (Windows 11)

---

## 11. Accessibility (baseline)

- Focus visible on all interactive elements
- Contrast ratio ≥ 4.5:1 for body text
- Keyboard: Ctrl+T tab, Ctrl+L focus address bar

---

## 12. Implementation

- Tailwind: extend `theme.colors` with tokens above, OR CSS Modules importing `tokens.css`.
- No light theme in MVP.

---

## 13. Do not

- Cyberpunk neon grids
- Admin-dashboard dense tables in chrome
- Gradients everywhere
- New color palette without approval
