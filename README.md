# Capture Map Studio

Static Leaflet map capture studio with Vietnamese and English UI.

## Pinned world maps

The source picker keeps these maps above the independently scrolling provider list:

- **Satellite World Map** — EOX Sentinel-2 Cloudless 2016: a label-free satellite mosaic with dark oceans, chosen as an interactive alternative to the supplied dark satellite reference. Uses the published Web Mercator `s2cloudless_3857` layer, native zoom up to 14. This is the default source. The 2016 imagery is licensed CC BY 4.0; retain EOX/Copernicus attribution when redistributing captures.
- **Natural Earth / Physical World Map** — Natural Earth II shaded relief from OpenFreeMap (`natural_earth/ne2sr`), chosen for the supplied reference's pale land colors and blue ocean relief, rather than EOX terrain. Native zoom up to 6; closer views are upscaled. The Natural Earth data is public domain.

The original **Esri World Imagery** remains a separate, unpinned option. The supplied screenshots are visual references only, not georeferenced assets; these interactive alternatives are not guaranteed to be pixel-identical. Exports respect each source's native zoom limit rather than requesting unavailable tiles.

Source references:
- EOX layer identifiers and licensing: https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
- Natural Earth tile source and zoom metadata: https://tiles.openfreemap.org/styles/liberty

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
