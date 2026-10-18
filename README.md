# Capture Map Studio

Satellite Capture Studio: export very high-resolution satellite and world-map images with a live viewfinder.
The app is one static page (`public/index.html`) that uses Leaflet. You can deploy it to **Cloudflare**.

## 📌 Pinned map sources

These two sources are always shown first in the source list:

| Source | Tiles | Max native zoom | Notes |
|---|---|---|---|
| **Satellite World Map** | EOX Sentinel-2 cloudless 2024 | z14 (~10 m/px) | Cloud-free global satellite mosaic. CC BY-NC-SA 4.0 (non-commercial). Commercial use: https://cloudless.eox.at |
| **Natural Earth / Physical World Map** | Esri `World_Physical_Map` | z8 | Natural Earth physical relief map (US National Park Service) |

To pin another source, add `pinned: true` to its entry in `TILE_SOURCES`.

## Development

```bash
npm install
npm run build     # public/ -> dist/
npm run dev       # build + wrangler dev on http://localhost:8787
```

## Deploy to Cloudflare

### Option A: Workers (Static Assets), recommended
Settings are in `wrangler.jsonc` (assets directory: `./dist`).

```bash
npx wrangler login
npm run deploy
```

To deploy from Git with Cloudflare **Workers Builds** (Dashboard → Workers & Pages → Create → Import a repository):
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`

### Option B: Cloudflare Pages
Dashboard → Workers & Pages → Create → Pages → Connect to Git:
- **Framework preset:** None
- **Build command:** `npm run build`
- **Build output directory:** `dist`

You can also deploy from the CLI: `npm run deploy:pages`.

`public/_headers` sets the security and cache headers. Both Workers Static Assets and Pages apply it.
