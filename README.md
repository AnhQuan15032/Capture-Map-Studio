# Capture Map Studio

Leaflet map capture studio with Vietnamese and English UI and a restricted Cloudflare tile relay for origin-clean exports.

## Map sources

All sources appear in the normal searchable provider list. **Esri World Imagery** is the default. The added Satellite World Map and Natural Earth / Physical World Map presets and the pinned section have been removed. Original providers, including NASA Blue Marble, City Lights, Bing, Google, and Esri, remain available.

The export/CORS fixes, adjustable world seam, custom dimensions and optional GPU safety settings are unchanged. Provider-native tile limits still determine available source detail, regardless of output pixel dimensions. Natural Earth coastline data remains in use for land/ocean masks; it is not a pinned basemap.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run dev
```

Wrangler serves the app on `0.0.0.0:8787`. External libraries, fonts, imagery, and coastline data still load from their existing public services; the app is not offline-capable.

## Cloudflare Workers Builds

Connect this repository in **Cloudflare → Workers & Pages → Create → Import a repository** and use:

| Setting | Value |
| --- | --- |
| Root directory | repository root |
| Build command | `npm run build` |
| Deploy command (production) | `npx wrangler deploy` |
| Preview deploy command | `npx wrangler preview` |
| Node.js version | `22` or newer |

`wrangler.jsonc` configures a Worker named `capture-map-studio`, publishing `dist/` as its `ASSETS` binding. `src/worker.js` handles `/api/tiles` before static assets. The static build copies only `index.html`; development files and Git metadata are not published. No application secrets are required.

Wrangler also runs `npm run build` automatically via the `build.command` configuration, so deployments still generate `dist/` if the dashboard build command is left empty. If you set the dashboard build command too, the small static copy runs twice; this is harmless.

The top-level `previews: {}` block enables the beta `wrangler preview` command used by Cloudflare preview builds. Assets and build settings remain at the top level and are shared by production and preview deployments.

For an authenticated local Cloudflare deployment, run `npm run deploy`; for a Preview deployment, run `npm run preview`.

### Fixing “missing a previews block” in build logs

Use the updated `wrangler.jsonc` from this branch and retry the build. In Cloudflare build settings, use `npx wrangler deploy` for production and `npx wrangler preview` only for Preview deployments. Both commands now build assets automatically. Repository changes cannot update the commands stored in your Cloudflare dashboard.

### Cloudflare Pages alternative

The static output can be deployed through Pages using build command `npm run build` and output directory `dist` (no deploy command), but this does **not** deploy the tile relay. On static-only hosting, export depends on provider CORS support or an available public CORS proxy. Use the configured Workers deployment for the first-party relay. `wrangler.jsonc` targets Workers, not the Pages CLI.

The configuration is deployment-ready; adding it to the repository does **not** deploy to a Cloudflare account automatically.


## Canvas/CORS export fix

A provider flag is only a hint: even NASA or EOX may return an image without usable browser CORS headers. The old loader then loaded a non-CORS `<img>`, tainting the export canvas even though the preview worked.

The export loader now accepts only CORS-readable fetched images or anonymous-CORS images. If a direct load fails and the proxy toggle is enabled (the default), **every provider** can retry through the same-origin `/api/tiles?url=…` relay. Public CORS services remain fallbacks for static-only hosting and custom providers not covered by the relay. Export and prefetch use the same safe loader, and cached image sources are no longer cleared after drawing. Failed transports produce missing-tile errors, never unsafe images drawn into a download canvas.

The relay allows only built-in tile hosts and tile-shaped paths; custom URLs cannot make it fetch arbitrary servers. It permits HTTPS GET only, rejects redirects and non-raster responses, forwards no user credentials, enforces a 12-second upstream timeout and a 5 MiB image limit, and caches successful images. Provider failures are not converted into successful image responses. This is a CORS transport fix, not a bypass for provider authentication, availability, or usage terms.

Deploy the **Worker**, not just `dist/index.html`, and leave the proxy toggle enabled when a provider blocks direct CORS loads. A browser preview by itself does not establish that image export is allowed.

## Full-capture export regression

The main capture path previously called `finalCv.toBlob()` without ever assigning `finalCv`. That threw a `ReferenceError` before encoding even a small image; the catch block incorrectly reported a CORS or device-memory problem. Regular captures now explicitly export the assembled canvas, with a separate reprojected canvas for equirectangular output. Encoding is awaited before download/snapshot handling and canvas cleanup. Runtime errors retain their actual diagnostic details; a null encoder result is not labeled as proof of exhausted device memory.

`tests/capture.test.mjs` runs the production capture entry point through encoding and download with mocked DOM/tiles, covering 1444×812 JPEG/PNG, repeated captures, land-only PNG, equirectangular output, null encoding, and distinct runtime/security errors. A full-page Chromium check also exercised the actual Capture button and decoded the resulting JPEG/PNG downloads at 1444×812, plus 512×512 and 512×256 world modes. That browser check used a mocked NASA upstream and real local copies of the page's libraries, not live upstream tile services.

## World seam and uncapped requested dimensions

Full-world square and equirectangular exports now default to **11.5°E** at the center, placing the edge at **168.5°W** in the Bering Strait. Mainland Russia east of the international date line appears at the right rather than wrapping onto the left. Adjust **World center longitude** in Capture Area to change the seam (0 restores the conventional ±180° edge). This setting applies only to full-world exports; viewport captures still follow the map you pan manually. Source tile requests wrap to valid tile columns while their drawing positions and land masks use the same unwrapped geographic bounds, including both partial edge columns.

The app's old 16,384/32,768-pixel limits are removed when GPU safety is off, which is now the default. Custom dimensions have no fixed maximum and are honored in viewport, world, and equirectangular modes. With custom dimensions enabled, use equal width/height for square output or twice the height for 2:1 output. Provider-native tile limits still apply to source detail; requesting more output pixels does not create new satellite detail. GPU safety can still be enabled explicitly to opt into conservative app caps.

**This is not infinite canvas support.** Inputs must be finite, representable integers, and browser dimension/area limits, memory, file size and provider availability still apply. A single enormous image can fail or crash the tab. Requests rejected during canvas allocation are reported explicitly instead of being silently resized. Export beyond actual browser canvas limits would require a separate tiled/streaming output format, which is not implemented here.

Validation: 41 automated tests pass, including shifted tile wrapping, Russian/Alaskan mainland placement, and uncapped 65,536×32,768 geometry in all three capture modes. A Chromium full-page check with mocked upstream images verified shifted 512×512 and 512×256 downloads and an actual 20,000×64 PNG download. The larger 65,536×32,768 canvas was **not** allocated or exported during testing.

## Faster white-map exports

White-map captures now render directly into one export canvas, including native equirectangular output. Dual PNG export reuses the same canvas sequentially. A bounded vector-path cache accelerates repeat captures without retaining large raster buffers; coastline loading is shared between preview and export. Original coastline detail, lake holes, world shifts, PNG/JPEG support and custom dimensions remain available.

Local Chromium measurements showed **1.8–2.6× faster first render+PNG encoding** and **2.5–3.1× faster repeats** for tested 4K 50m/10m cases. Full-size export-canvas allocation drops from three buffers to one (67% less nominal RGBA storage, not a peak-RAM guarantee). Native equirectangular rendering removes the old bitmap-resampling distortion, so those pixels need not exactly match previous exports. See [implementation, measurements and validation](docs/white-map-performance.md).
