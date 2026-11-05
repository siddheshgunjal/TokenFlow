# TokenFlow Brand Guidelines

## Scope

Applies to the desktop UI, website, README, release assets, and social previews.

- Tokens in `tailwind.config.ts` are the implementation source of truth.
- Update this file and `tailwind.config.ts` together.

---

## Logo

- **Primary mark**: 3D teal `F` mark, transparent background
- **Source asset**: `src/assets/logo-mark.png` (512px, transparent)
- **Web UI usage**: `<img src="src/assets/logo-mark.png" alt="TokenFlow" />`
- **Sidebar size**: 36px (`h-9 w-9` at 16px CSS scale)
- **Widget header size**: 24px
- **Clear space**: at least 25% of mark height on all sides
- **Minimum size**: 24px for the full 3D mark; at 16–32px, use simplified silhouette variant
- **Do not**: recolor, rotate, crop, outline, add effects, or place over busy imagery
- **alt text**: empty when adjacent live text already says "TokenFlow"; otherwise `alt="TokenFlow"`

## Wordmark

- **Label**: live text only: `TokenFlow`
- **Family**: Inter, weight 700
- **Tracking**: `tracking-tight`
- **Sizes**:
  - Sidebar: 16px (`text-base font-bold`)
  - Widget header: 12px (`text-xs font-bold`)
  - README heading: 24px, bold
- **Do not**: use wordmark image, SVG text outlines, letter-spacing hacks, or small mark replacing a letter

## Tagline

- **Copy**: `LOCAL | SECURE | OPEN-SOURCE`
- **Size**: 12px, 600, uppercase, `tracking-[0.16em]`, `text-muted`
- **Usage**: Sidebar shows `LOCAL ANALYTICS` with full tagline in `title` attribute; full tagline in README, `BRANDING.md`, and About/brand surfaces
- **Do not**: use as replacement for functional descriptions such as "Ollama + DeepSeek usage"

## Website usage

- Favicon and touch-icon expectations.
- Open Graph / social preview image requirements.
- Dark-only presentation.
- Link to `website/README.md` for placement rules.

## Color Palette

| Token | Hex | Role |
| --- | --- | --- |
| `canvas` | `#070B14` | App background, deepest navy |
| `panel` | `#0D1420` | Cards, sidebar surface |
| `panel-strong` | `#16202F` | Raised controls, hover surfaces |
| `ink` | `#E8EDF4` | Default body text (off-white) |
| `muted` | `#8C9AAE` | Secondary text, labels |
| `accent` | `#00D4C0` | Primary brand cyan, CTAs, active nav |
| `accent-strong` | `#00A896` | Secondary brand teal, cached/tertiary data |
| `accent-hover` | `#2BE3D3` | Primary button hover |
| `accent-blue` | `#2F6BFF` | Core Blue: output series, DeepSeek, links |
| `success` | `#22C55E` | Proxy online, saved, healthy |
| `warning` | `#F5A623` | Streaks, restart notices, caution |
| `danger` | `#EF4444` | Offline, errors, destructive actions |
| `data-cyan` | `#4DE8D8` | Monospace data emphasis on dark |
| `data-amber` | `#FBBF24` | Monospace data emphasis on dark |

**Rules**:
- Do not use violet, fuchsia, purple, indigo, sky, teal, cyan, emerald, green, lime, rose, or amber Tailwind palette utilities
- Prefer `ink`, `muted`, and white/near-white alpha values for text and hairlines
- Put all chromatic decisions behind the token names above
- For SVG strokes/fills in charts, prefer `currentColor` plus a Tailwind text-color class
- Keep white-on-dark contrast at or above WCAG AA for body text
- Primary cyan buttons use `text-canvas` (dark navy), never white text

## Typography

- **Sans family**: `Inter`, `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, `sans-serif`
- **Mono family**: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `monospace`
- **Type scale** (px):

| Role | Size / line-height | Weight | Family | Where |
| --- | --- | --- | --- | --- |
| Brand headline | `64px / 1.05` | 700 | Sans | Brand/marketing surfaces only |
| Page title | `24px / 1.2` | 600 | Sans | Page header (`text-2xl font-semibold`) |
| Body | `16px / 1.5` | 400 | Sans | Empty states, long-form copy |
| UI | `14px / 1.4` | 400–500 | Sans | Nav, buttons, inputs, tables |
| Micro / eyebrow | `12px / 1.3` | 500–600, uppercase | Sans | Metadata, labels; tracking `0.14em–0.18em` |
| Data | `14px / 1.2` | 400 | Mono | Table values, axes, secondary metrics |
| Data emphasis | `20px / 1.1` | 700 | Mono | Primary stat values, balances, month totals |

**Rules**:
- No text below 12px anywhere
- Use `text-sm` (14px) as the default UI size
- Card/section titles: `text-sm font-semibold` (14px)
- All numeric metrics use `font-mono tabular-nums`
- Use `tracking-tight` on large numbers and the wordmark
- Use `tracking-[0.16em]` on uppercase micro labels
- Do not add new font files or `@font-face` blocks

## Data-Visualization Mapping

| Series / state | Token | Hex |
| --- | --- | --- |
| New input | `accent` | `#00D4C0` |
| Output | `accent-blue` | `#2F6BFF` |
| Cached | `accent-strong` | `#00A896` |
| Context / prompt | `warning` | `#F5A623` |
| Balance trend | `accent-blue` | `#2F6BFF` |
| Positive / online | `success` | `#22C55E` |
| Negative / error | `danger` | `#EF4444` |

**Guidance**:
- Heatmap `LEVEL_STYLES` built from tokens with increasing opacity/brightness
- Level 4 cells: bright token background; text to `text-canvas` for contrast
- Chart area gradients: `currentColor` with `stopOpacity`; no raw hex values
- No violet/purple gradients
- Keep existing chart geometry and behavior; only colors and type change

## Icons

- **All icons are transparent everywhere** — no background tile, no rounded-square mask, no glow, no drop shadow
- **Source artwork**: `src-tauri/icons/tokenflow_logo_full_alpha.png` (RGBA, 1100 × 1100)
- **Generation command**: `npm run icons` (`python3 scripts/generate_icons.py`)
- **Output sizes and variants**:

  | Output | Size(s) | Variant |
  | --- | --- | --- |
  | `src-tauri/icons/icon.png` | 1024 | Full-color |
  | `src-tauri/icons/32x32.png` | 32 | Silhouette |
  | `src-tauri/icons/128x128.png` | 128 | Full-color |
  | `src-tauri/icons/128x128@2x.png` | 256 | Full-color |
  | `src-tauri/icons/256x256.png` | 256 | Full-color |
  | `src-tauri/icons/512x512.png` | 512 | Full-color |
  | `src-tauri/icons/icon.ico` | 16, 24, 32, 48, 64, 128, 256 | Silhouette ≤32; full ≥48 |
  | `src-tauri/icons/icon.icns` | 16, 32, 64, 128, 256, 512, 1024 | Silhouette ≤32; full ≥64 |
  | Windows Store logos | 30, 44, 50, 71, 89, 107, 142, 150, 284, 310 | Silhouette ≤44; full ≥50 |
  | `src-tauri/icons/tray-64.png` | 64 | Full-color |
  | `src-tauri/icons/tray-128.png` | 128 | Full-color |
  | `src/assets/logo-mark.png` | 512 | Full-color |
  | `public/favicon-16.png` | 16 | Website asset to be generated → `website/public/` |
  | `public/favicon-32.png` | 32 | Website asset to be generated → `website/public/` |
  | `public/favicon-192.png` | 192 | Website asset to be generated → `website/public/` |
  | `public/favicon-512.png` | 512 | Website asset to be generated → `website/public/` |
  | `public/apple-touch-icon.png` | 180 | Website asset to be generated → `website/public/` |

- **Acceptance checks**:
  - Every generated PNG is `RGBA`
  - Alpha minimum is `0` (transparent corners)
  - No opaque background rectangle in any icon
  - The 16/32px variants are visually legible as an `F`
  - The tray icon reads on both light and dark panels

## Implementation Do's and Don'ts

### Do

- Use semantic Tailwind color tokens (`canvas`, `panel`, `accent`, etc.)
- Apply `currentColor` with `stopOpacity` for chart gradients
- Use `font-mono tabular-nums` for all numeric data
- Keep `color-scheme: dark` only
- Generate icons with `npm run icons`
- Use `text-muted` and `text-ink` for secondary/primary text
- Keep layout structure unchanged (sidebar/header/dashboard/settings/widget)

### Don't

- Use violet, fuchsia, purple, indigo, sky, teal, cyan, emerald, green, lime, or rose Tailwind utilities
- Add text below 12px anywhere
- Create or use a wordmark image/SVG lockup
- Add icon background tiles, rounded-square masks, or glows
- Add Geist or Fontsource font packages
- Recolor or modify the logo mark
- Change application behavior, API calls, or settings semantics

## Version

- **Change control**

- Token changes must be made in `tailwind.config.ts` first, then mirrored
  here.
- Icon changes must be regenerated with `npm run icons`.
- Last reviewed: 2026-11-05.

Do not claim a generated date if the content is not regenerated.