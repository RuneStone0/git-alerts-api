# GitAlerts brand assets

The mark is a security shield carrying an alert mark. It is drawn on a 64 x 64
grid (see `mark.svg`) so it stays legible at 16 px and holds up at 512 px.

| Surface | File | Notes |
| --- | --- | --- |
| Browser tab | `ui/public/favicon.svg` | self-contained blue artwork, plus `favicon.ico` (16/32/48) for legacy browsers |
| iOS home screen | `ui/public/apple-touch-icon.png` | 180 x 180, opaque brand background |
| PWA / Android | `ui/public/icons/icon-192.png`, `icon-512.png` | maskable-safe: the mark occupies 78% of the tile |
| Web manifest | `ui/public/manifest.webmanifest` | names the icons and the theme colour |
| Social preview | `ui/public/og-image.png` | 1200 x 630, referenced by the `og:` / `twitter:` tags |
| In-app mark | `ui/src/components/Logo.tsx` | inline SVG on the same grid, single fill using `currentColor` |

## Colours

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| brand 500 | `#3b82f6` | `#60a5fa` | the mark, accents |
| brand 600 | `#2563eb` | (gradient stop only) | favicon gradient, alert cut-out on the app tile |

The in-app mark uses `currentColor` with the alert cut out as a hole (a single
`evenodd` path), so it inherits whatever text colour the surrounding UI sets and
needs no dark-mode override.

## Source

`mark.svg` is the geometry of record. The favicon, app icons, social preview and
the React component are all generated from the same path, so a change here means
regenerating the raster set (`favicon.ico`, the PNG tiles, `og-image.png`).

Nothing in this set is derived from another product's artwork.
