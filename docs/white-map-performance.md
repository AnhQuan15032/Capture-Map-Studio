# White-map capture optimization

## Changes

- Paint black coastline paths straight onto a white canvas; no intermediate full-resolution mask or solid-land canvas.
- Reuse that **one export canvas** sequentially for the two transparent PNG layers, awaiting each encoder before clearing/redrawing it. Ocean erasure and land fill use the same paths and even-odd lake holes.
- Keep **one geometry entry**, keyed by GeoJSON identity, dimensions, projection, zoom and exact geographic bounds. Repeated exports reuse compiled paths; the cache retains no output bitmap.
- Clip Mercator vector paths to the output rectangle while preserving its existing automatic polar clip, world offsets and world seam.
- Render equirectangular coastlines natively, not by drawing thousands of one-pixel rows from a Mercator bitmap. The center longitude and arbitrary output dimensions are respected. Rows outside the previous ±85.05112878° domain remain transparent. Native projection also avoids the old intermediate bitmap's vertical distortion/blur; equirectangular exports are **not pixel-identical** to the old resampling implementation.
- Deduplicate concurrent coastline fetch/parse requests from preview and capture. Failed loads remain retryable. No imagery prefetch/warmup starts while white mode is selected; pending mask previews do not render during a capture.
- Validate white-map canvas allocation and always free the canvas/unlock capture, including missing data, unavailable libraries, and null/thrown encoders. Error details are HTML-escaped.

### Memory

The main full-size export backing-store count goes from **three to one** for single and dual white exports. At 4096×4096, nominal RGBA storage is 192 MiB versus 64 MiB: **67% less export-canvas storage**. This is allocation arithmetic, **not measured peak process memory**; preview canvases, compiled paths, encoders, browser/GPU copies and downloaded blobs require additional memory. Browser canvas limits still apply. No dimension caps were added, and no coastline detail was reduced.

### A measured optimization, not an assumed one

Direct `d3.geoPath(projection).context(new Path2D())` was tested and rejected: the many JS/native method calls made first-time 10m path generation substantially slower in this browser. The implementation retains D3's buffered SVG generation/native `Path2D` parsing and caches the compiled result instead.

## Measurements

Headless Chromium **153.0.8010.0**, Linux sandbox, 2026-11-03. Natural Earth 50m (`world-atlas@2`) and original 10m GeoJSON. All timings include drawing **and completed PNG encoding**, but exclude coastline download/JSON decoding, UI, history and download handling. Four runs per case/mode, discard the first, report the median of three; geometry-cold runs clear the vector cache each time. These are local browser measurements, not universal speed guarantees.

| Detail / projection | Output | Previous pipeline | New, geometry cold | New, cached geometry |
| --- | --- | ---: | ---: | ---: |
| 50m Mercator | 4096×4096 | 2005 ms | 1142 ms | 811 ms |
| 50m equirectangular | 4096×2048 | 1239 ms | 484 ms | 427 ms |
| 10m Mercator | 4096×4096 | 3651 ms | 2035 ms | 1252 ms |
| 10m equirectangular | 4096×2048 | 2585 ms | 1406 ms | 843 ms |

In these cases the first render+encode was **1.8–2.6× faster**, with repeated identical exports **2.5–3.1× faster**. PNG sizes and antialiasing can differ slightly after vector clipping, and equirectangular rendering is now native; this is not a byte-for-byte PNG comparison.

## Validation

- `npm test`: **63 tests** including actual production single/dual entry points with mocked DOM/canvas/tiles, all white projections/formats, one-canvas allocation, repeated geometry reuse/cache invalidation, even-odd fill usage, missing data/libraries, rejected canvases, null/thrown encoders, second-layer failure, deduplicated loading/retry and skipped imagery prefetch.
- Real Chromium pixel checks: synthetic lake holes, opaque land/ocean and complementary transparent layers; shifted Natural Earth Russia/Alaska positions; custom 4096×1000 native equirectangular output. Mercator comparison against the previous compositor covers the shifted world, a dateline-crossing viewport and multiple wrapped worlds; fewer than 0.1% of pixels differ by more than eight intensity levels (clipped coastline antialiasing).
- Full-page Chromium with actual page libraries, intercepted coastline fixtures and mocked imagery: clicked the real Capture button for 1444×812 PNG/JPEG, 1024×1024 world PNG, 1024×512 equirectangular PNG and custom 1600×700 10m equirectangular PNG. Clicked Dual Export and verified two decoded 1024×512 PNGs; no page exceptions. This does not test live provider availability.

### Repeat the renderer regression and benchmark

From the repository root, install optional browser dependencies outside the application dependency tree:

```sh
npm install --prefix .cache/white-map-check --no-audit --no-fund \
  playwright-core @sparticuz/chromium d3@7 topojson-client@3 world-atlas@2 \
  leaflet@1.9.4 lucide@0.469.0 @tailwindcss/browser@4
# Original, unmodified Natural Earth 10m land fixture (~10 MB):
gh api -H 'Accept: application/vnd.github.raw+json' \
  repos/nvkelso/natural-earth-vector/contents/geojson/ne_10m_land.geojson \
  > .cache/white-map-check/land-10m.json
node scripts/check-white-capture-browser.mjs
node scripts/benchmark-white-map.mjs
```

`WHITE_MAP_BROWSER_DEPS` overrides the dependency/fixture directory; `CHROMIUM_EXECUTABLE_PATH` selects an existing compatible browser. On minimal Linux images missing NSS/NSPR, provide Chromium's runtime libraries or use the package's documented Lambda runtime setup. The sandbox run used the package's bundled `al2023/lib` via `LD_LIBRARY_PATH`. Results are saved to `results.json` in the ignored dependency directory. The script is optional, does not change normal `npm test` or deployment dependencies, and is not part of the published static assets.
