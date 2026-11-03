import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker, { isAllowedTileUrl, relayTile } from '../src/worker.js';

const tile = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default//GoogleMapsCompatible_Level8/3/4/2.jpg';
const request = (url = tile, method = 'GET') => new Request(`https://studio.example/api/tiles?url=${encodeURIComponent(url)}`, { method });

test('every built-in provider uses a permitted tile route', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sources = vm.runInNewContext(html.slice(html.indexOf('const TILE_SOURCES ='), html.indexOf('let providerSearch =')) + '\nTILE_SOURCES', { gibsRecentDate: '2026-10-12' });
  for (const [key, src] of Object.entries(sources)) {
    const url = src.url.replace('{z}', '3').replace('{x}', '4').replace('{y}', '2').replace('{s}', '0').replace('{q}', '0123').replace('{time}', '2026-10-12');
    assert.equal(isAllowedTileUrl(url), true, key);
  }
});

test('relay rejects SSRF, arbitrary paths, credentials and non-HTTPS requests without fetching', async () => {
  for (const url of [
    'http://127.0.0.1/admin', 'https://localhost/secret', 'https://169.254.169.254/',
    'https://evil.example/tile.png', 'http://gibs.earthdata.nasa.gov/tile.png',
    'https://gibs.earthdata.nasa.gov.evil.example/tiles',
    'https://user:password@gibs.earthdata.nasa.gov/tiles',
    'https://gibs.earthdata.nasa.gov:8443/tiles',
    'https://gibs.earthdata.nasa.gov/admin', tile + '?redirect=https://localhost/', tile + '#fragment',
    'https://mt0.google.com/vt?lyrs=s&x=1&y=1&z=1&url=https://localhost/',
  ]) {
    const response = await relayTile(request(url), () => { throw new Error('Must not fetch'); });
    assert.equal(response.status, 403, url);
  }
});

test('relay makes tiles readable without forwarding caller cookies or upstream headers', async () => {
  let options;
  const response = await relayTile(request(), async (url, opts) => {
    assert.equal(url, tile);
    options = opts;
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'secret=yes' } });
  });
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Cookie, undefined);
});

test('redirects, provider errors, HTML and SVG are rejected rather than proxied to the canvas', async () => {
  for (const upstream of [
    new Response(null, { status: 302, headers: { Location: 'https://localhost/secret' } }),
    new Response('unavailable', { status: 503 }),
    new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
  ]) {
    const response = await relayTile(request(), async () => upstream);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('provider 404s and network failure are returned as errors, not image success', async () => {
  assert.equal((await relayTile(request(), async () => new Response(null, { status: 404 }))).status, 404);
  assert.equal((await relayTile(request(), async () => { throw new Error('network'); })).status, 502);
});

test('relay enforces byte limits with and without Content-Length', async () => {
  const max = 5 * 1024 * 1024;
  const declared = new Response('small', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(max + 1) } });
  assert.equal((await relayTile(request(), async () => declared)).status, 502);
  const streamed = new Response(new Uint8Array(max + 1), { headers: { 'Content-Type': 'image/png' } });
  assert.equal((await relayTile(request(), async () => streamed)).status, 502);
  const empty = new Response(null, { headers: { 'Content-Type': 'image/png' } });
  assert.equal((await relayTile(request(), async () => empty)).status, 502);
});

test('API only allows GET, unknown API routes are 404, static requests reach the assets binding', async () => {
  assert.equal((await relayTile(request(tile, 'POST'))).status, 405);
  assert.equal((await worker.fetch(new Request('https://studio.example/api/unknown'), {})).status, 404);
  const home = await worker.fetch(new Request('https://studio.example/'), {
    ASSETS: { fetch: async () => new Response('studio') },
  });
  assert.equal(await home.text(), 'studio');
});
