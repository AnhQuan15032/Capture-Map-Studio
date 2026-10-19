# Capture Map Studio

Leaflet map capture studio with Vietnamese and English UI and a restricted Cloudflare tile relay for origin-clean exports.

## Pinned world maps

The source picker keeps these maps above the independently scrolling provider list:

- **Satellite World Map** — NASA Blue Marble with shaded relief **and bathymetry**, replacing the Sentinel-2 mosaic whose land colors did not match the reference. Native zoom up to 8. The WMTS template uses the static (empty) time segment, `EPSG3857_500m` tile matrix and `.jpeg` extension. This is the default source; the existing NASA Blue Marble entry points to the same corrected endpoint.
- **Natural Earth / Physical World Map** — EOX Terrain, an ocean-inclusive physical basemap using Natural Earth and OpenStreetMap data. This replaces the OpenFreeMap `ne2sr` land-only relief layer that displayed white oceans. Uses the published Web Mercator `terrain_3857` layer (not the obsolete `ne_terrain2` URL). This global-relief preset intentionally caps source tile requests at zoom 8; this is an application cap, not a claim about EOX's maximum service zoom. Closer views upscale these tiles.

The original **Esri World Imagery** remains a separate, unpinned option. The supplied screenshots are visual references only, not georeferenced assets; the interactive alternatives are not guaranteed to be pixel-identical. A NASA Blue Marble sample tile was inspected during development, but the EOX layer has not been visually verified against the reference in this sandbox. The physical layer is EOX's rendered terrain, not the exact original Natural Earth raster.

Source references:
- NASA Blue Marble relief/bathymetry tile dataset and sample: https://github.com/freetiler/nasa-bluemarble
- NASA GIBS WMTS example: https://egghead.io/lessons/react-change-the-map-tile-service-of-a-react-leaflet-tilelayer-basemap-to-nasa-gibs-blue-marble
- EOX layer identifiers: https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
- EOX data sources and attribution requirements: https://maps.eox.at/#data

Both are searchable and use the existing preview, prefetch, and image-export pipeline. Provider attribution is shown on the map. Check each provider's terms before redistributing imagery.

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
