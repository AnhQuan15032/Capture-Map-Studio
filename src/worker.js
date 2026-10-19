// Restricted tile relay: never accept arbitrary hosts, paths, credentials or redirects.
// Browser-facing callers use /api/tiles, so upstream CORS headers are not needed.
const MAX_TILE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const XYZ = String.raw`\d{1,2}/\d{1,10}/\d{1,10}`;
const TILE_ROUTES = [
  [/^gibs\.earthdata\.nasa\.gov$/, new RegExp(String.raw`^/wmts/epsg3857/best/(?:BlueMarble_ShadedRelief_Bathymetry|VIIRS_SNPP_CorrectedReflectance_TrueColor|VIIRS_CityLights_2012)/default/(?:\d{4}-\d{2}-\d{2})?/(?:EPSG3857_500m|GoogleMapsCompatible_Level[89])/${XYZ}\.(?:jpeg|jpg|png)$`)],
  [/^tiles\.maps\.eox\.at$/, new RegExp(String.raw`^/wmts/1\.0\.0/(?:terrain_3857|s2cloudless_3857)/default/g/${XYZ}\.jpg$`)],
  [/^server\.arcgisonline\.com$/, new RegExp(String.raw`^/ArcGIS/rest/services/(?:World_Imagery|World_Topo_Map|World_Street_Map|NatGeo_World_Map|Canvas/World_Dark_Gray_Base|Canvas/World_Light_Gray_Base)/MapServer/tile/${XYZ}$`, 'i')],
  [/^fly\.maptiles\.arcgis\.com$/, new RegExp(String.raw`^/arcgis/rest/services/World_Imagery_Firefly/MapServer/tile/${XYZ}$`, 'i')],
  [/^basemap\.nationalmap\.gov$/, new RegExp(String.raw`^/arcgis/rest/services/(?:USGSImageryOnly|USGSImageryTopo)/MapServer/tile/${XYZ}$`, 'i')],
  [/^a\.basemaps\.cartocdn\.com$/, new RegExp(String.raw`^/(?:dark_all|light_all)/${XYZ}\.png$`)],
  [/^tile\.opentopomap\.org$/, new RegExp(String.raw`^/${XYZ}\.png$`)],
  [/^tile\.openstreetmap\.org$/, new RegExp(String.raw`^/${XYZ}\.png$`)],
];

export function isAllowedTileUrl(value) {
  if (!value || value.length > 2048) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  if (TILE_ROUTES.some(([host, path]) => host.test(url.hostname) && path.test(url.pathname))) {
    return !url.search;
  }
  if (/^mt[0-3]\.google\.com$/.test(url.hostname) && url.pathname === '/vt') {
    const p = url.searchParams;
    return [...p.keys()].every(k => ['lyrs', 'x', 'y', 'z'].includes(k)) &&
      /^(?:y|s|m|p)$/.test(p.get('lyrs') || '') &&
      ['x', 'y', 'z'].every(k => /^\d{1,10}$/.test(p.get(k) || ''));
  }
  if (/^ecn\.t[0-3]\.tiles\.virtualearth\.net$/.test(url.hostname) && /^\/tiles\/a[0-3]{1,22}\.jpeg$/.test(url.pathname)) {
    return [...url.searchParams.keys()].every(k => ['g', 'n'].includes(k)) &&
      /^\d{1,10}$/.test(url.searchParams.get('g') || '') && url.searchParams.get('n') === 'z';
  }
  return false;
}

function failure(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function relayTile(request, fetchUpstream = fetch) {
  if (request.method !== 'GET') return failure(405, 'GET required');
  const target = new URL(request.url).searchParams.get('url');
  if (!isAllowedTileUrl(target)) return failure(403, 'Unsupported tile URL');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    // No browser cookies, authorization headers or referrer are forwarded.
    const upstream = await fetchUpstream(target, {
      method: 'GET', redirect: 'manual', signal: ctl.signal,
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/avif' },
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    // Never follow a redirect to a non-allowlisted destination (or an auth page).
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return failure(upstream.status === 404 ? 404 : 502, 'Tile provider failed');
    }
    const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) {
      await upstream.body?.cancel();
      return failure(502, 'Tile provider did not return a supported image');
    }
    if (Number(upstream.headers.get('Content-Length')) > MAX_TILE_BYTES) {
      await upstream.body?.cancel();
      return failure(502, 'Tile exceeds size limit');
    }
    // Bound streamed responses too; Content-Length may be absent or misleading.
    const reader = upstream.body?.getReader();
    if (!reader) return failure(502, 'Empty tile');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TILE_BYTES) {
        await reader.cancel();
        return failure(502, 'Tile exceeds size limit');
      }
      chunks.push(value);
    }
    if (!size) return failure(502, 'Empty tile');
    return new Response(new Blob(chunks, { type }), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return failure(ctl.signal.aborted ? 504 : 502, 'Tile provider unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/tiles') return relayTile(request);
    if (pathname.startsWith('/api/')) return failure(404, 'Not found');
    return env.ASSETS.fetch(request);
  },
};
