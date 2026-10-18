# Capture Map Studio

Static Leaflet map capture studio with Vietnamese and English UI.

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

`wrangler.jsonc` configures a static-assets-only Worker named `capture-map-studio`, publishing `dist/`. The build copies only `index.html`; development files and Git metadata are not published. No Worker code or application secrets are required.

Wrangler also runs `npm run build` automatically via the `build.command` configuration, so deployments still generate `dist/` if the dashboard build command is left empty. If you set the dashboard build command too, the small static copy runs twice; this is harmless.

The top-level `previews: {}` block enables the beta `wrangler preview` command used by Cloudflare preview builds. Assets and build settings remain at the top level and are shared by production and preview deployments.

For an authenticated local Cloudflare deployment, run `npm run deploy`; for a Preview deployment, run `npm run preview`.

### Fixing “missing a previews block” in build logs

Use the updated `wrangler.jsonc` from this branch and retry the build. In Cloudflare build settings, use `npx wrangler deploy` for production and `npx wrangler preview` only for Preview deployments. Both commands now build assets automatically. Repository changes cannot update the commands stored in your Cloudflare dashboard.

### Cloudflare Pages alternative

The same output can be deployed through Pages using build command `npm run build` and output directory `dist` (no deploy command). `wrangler.jsonc` targets Workers, not the Pages CLI.

The configuration is deployment-ready; adding it to the repository does **not** deploy to a Cloudflare account automatically.
