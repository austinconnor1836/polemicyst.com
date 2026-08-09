# polemicyst-graphic-render

A **decoupled, stateless, browserless** render service for the Polemicyst brand
graphic. Typesets pasted plain text into the fixed brand card (cream
1080×1350, Spectral serif, hairline-ruled body frame, `@polemicyst` footer) and
returns one or more PNG carousel pages.

It replaces the monolith's headless-Chromium (Puppeteer) renderer with the
industry-standard browserless stack:

- **[Satori](https://github.com/vercel/satori)** — HTML/CSS-subset → SVG
- **[@resvg/resvg-js](https://github.com/yisibl/resvg-js)** — SVG → PNG

No Chromium, no database, no S3, no auth coupling to the monolith. Fonts are
**embedded** (no runtime network fetch). Deploys free to any Node / Vercel /
Cloudflare serverless target.

## Endpoint

```
POST /render
Headers: x-render-secret: <RENDER_SECRET>   # enforced only if the env var is set
Body:    { "text": string, "showPageIndicator"?: boolean }

200 → { "images": string[] /* base64 PNG, one per page */, "pageCount": number, "fontSize": number }
400 → { "error": string }   # invalid input
401 → { "error": "Unauthorized" }
500 → { "error": string }   # render failure
```

`GET /health` → `{ "ok": true }`.

Each PNG is 1080×1350 supersampled at `DEVICE_SCALE_FACTOR` (2) → **2160×2700**.

## Architecture

| File                      | Role                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pagination.ts`       | **Pure**, unit-tested text→layout pipeline — ported verbatim from the monolith's `shared/util/polemicystGraphic.ts` (`parseInput`, `splitIntoSentences`, greedy `paginate`, `selectFontSizeAndPaginate`, brand constants). No browser, no Satori. |
| `src/template.ts`         | Brand CSS translated into Satori's supported subset (element trees).                                                                                                                                                                              |
| `src/fonts.ts`            | Loads the embedded TTF buffers from `assets/fonts/`.                                                                                                                                                                                              |
| `src/render.ts`           | Satori + resvg backend: DOM-free measurement + page rasterization.                                                                                                                                                                                |
| `src/handler.ts`          | Framework-agnostic `POST /render` handler (secret check, validation, base64 response).                                                                                                                                                            |
| `src/server.ts`           | Zero-dependency Node `http` entrypoint.                                                                                                                                                                                                           |
| `test/pagination.test.ts` | 20 unit tests for the pure pagination logic.                                                                                                                                                                                                      |
| `verify/`                 | Fidelity harness + side-by-side comparison PNGs vs. the Chromium ground truth.                                                                                                                                                                    |

### DOM-free pagination measurement

The monolith measured paragraph heights via `getBoundingClientRect()` in
headless Chromium. Here, each candidate paragraph is laid out at the frame
content width (780px) via a **width-only (auto-height) Satori pass**, and the
resulting SVG's `height` attribute is the rendered height. The greedy packing,
`---`/`===` explicit breaks, sentence-boundary fallback, and `MAX_PAGES=10`
uniform-shrink behaviour are the **same pure functions** as the browser version.

## Fidelity vs. Chromium

Verified locally against the Puppeteer reference renderer (`npm run verify`).
Page counts and per-page content matched exactly (1/1, 7/7, 3/3). The two
at-risk CSS effects both reproduce faithfully:

- **Scanline** (`repeating-linear-gradient` @ 1.5% black): Satori emits it
  natively as a `spreadMethod="repeat"` linear gradient — pixel period and
  intensity match Chromium.
- **`3px double` border**: Satori has no `border-style: double`, so it is
  reproduced as two stacked 1px solid lines with a 1px gap. At the 2× render
  scale this is a **pixel-identical** 2px-line / 2px-gap / 2px-line pattern
  (confirmed row-by-row against Chromium).

See `verify/out/*-compare.png` and `verify/out/footer-zoom-*.png`.

## Local usage

```bash
npm install
npm test          # pure pagination unit tests
npm run verify    # render 3 cases via Satori + Chromium, write side-by-side PNGs to verify/out/
npm run typecheck # tsc --noEmit gate
npm start         # start the http server on :8787 (PORT env to override)

curl -s localhost:8787/render \
  -H 'content-type: application/json' \
  -H "x-render-secret: $RENDER_SECRET" \
  -d '{"text":"First premise.\n\n---\n\nSecond premise."}' | jq '.pageCount'
```

Runs TypeScript directly via `tsx` (Node 20) — in dev and in production
(`npx tsx src/server.ts`). Imports carry explicit `.ts` extensions, so `tsc` is
a **typecheck gate** (`npm run typecheck`), not an emitter; Vercel/Cloudflare
compile the TS themselves at deploy time.

## Deploying free

- **Vercel** — add a Route Handler (`app/api/render/route.ts`) that reads the
  JSON body + `x-render-secret` header and calls `handleRender(...)` from
  `src/handler.ts`. `@resvg/resvg-js` runs on the Node runtime (not Edge). The
  font TTFs ship in the bundle.
- **Cloudflare Workers** — use `@resvg/resvg-wasm` + `satori` (both WASM-friendly)
  and adapt `handleRender` to the `fetch` handler; import the fonts as
  `ArrayBuffer`s. The pure `pagination.ts` and `template.ts` are unchanged.
- **Node / container** — `npm ci && npx tsx src/server.ts`. Tiny image, no
  Chromium.

Set `RENDER_SECRET` in the environment to enforce the shared-secret header.

## Fonts

Embedded under `assets/fonts/` (versioned assets, no runtime fetch):

- **Spectral** (OFL) — 400/500/600/800 + italic 400/600
- **Roboto Condensed** (OFL) — 400/700, static instances generated from the
  variable font via `fonttools varLib.instancer` (Google Fonts no longer ships
  static Roboto Condensed TTFs).
