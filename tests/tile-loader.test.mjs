import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const engine = html.slice(html.indexOf('    function loadImg('), html.indexOf('    /** Liệt kê mọi tile'));
const prefetch = html.slice(html.indexOf('    async function loadTileLight('), html.indexOf('    async function prefetchViewfinder('));
const tile = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default//GoogleMapsCompatible_Level8/3/4/2.jpg';

function harness({ fetchImage = () => true, imageAllowed = () => false, proxy = true, bitmap = true } = {}) {
  const requests = [];
  const images = [];
  const bitmaps = [];
  class FakeImage {
    set src(value) {
      this._src = value;
      if (!value) return;
      images.push({ url: value, cors: this.crossOrigin });
      queueMicrotask(() => {
        if (value.startsWith('blob:') || imageAllowed(value, this.crossOrigin)) this.onload();
        else this.onerror();
      });
    }
    get src() { return this._src; }
  }
  const createImageBitmap = async () => {
    const bmp = { close() { this.closed = true; } };
    bitmaps.push(bmp);
    return bmp;
  };
  const context = vm.createContext({
    Image: FakeImage, URL, AbortController, setTimeout, clearTimeout,
    window: bitmap ? { createImageBitmap } : {}, createImageBitmap,
    performance, buildTileUrl: () => tile, currentSourceKey: 'nasa_night',
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (!fetchImage(url)) throw new TypeError('CORS blocked');
      return new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } });
    },
  });
  vm.runInContext(`const tileCache = new Map(); const CACHE_LIMIT = 2; let useProxy = ${proxy};\n${engine}\n${prefetch}`, context);
  return { run: code => vm.runInContext(code, context), requests, images, bitmaps };
}

test('NASA night: a supposedly CORS-safe tile retries via same-origin relay after CORS failure', async () => {
  const h = harness({ fetchImage: url => url.startsWith('/api/tiles?') });
  const result = await h.run(`loadTileFast(${JSON.stringify(tile)}, true)`);
  assert.ok(result.data);
  assert.equal(result.tainted, false);
  assert.equal(h.requests[1].url, `/api/tiles?url=${encodeURIComponent(tile)}`);
  assert.ok(h.images.every(img => img.cors === 'anonymous'));
  assert.equal(h.requests.length, 2);
});

test('unsafe providers prefer same-origin relay when proxy is enabled', async () => {
  const h = harness();
  assert.ok((await h.run(`loadTileFast(${JSON.stringify(tile)}, false)`)).data);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.startsWith('/api/tiles?'));
});

test('all transports failing returns a missing tile, never a non-CORS image', async () => {
  const h = harness({ fetchImage: () => false });
  const result = await h.run(`loadTileFast(${JSON.stringify(tile)}, true)`);
  assert.equal(result.data, null);
  assert.equal(h.requests.length, 5); // Direct + first-party relay + 3 public fallbacks.
  assert.ok(h.images.every(img => img.cors === 'anonymous'));
});

test('proxy off does not contact relays or bypass canvas security', async () => {
  for (const corsSafe of [false, true]) {
    const h = harness({ proxy: false, fetchImage: () => false });
    assert.equal((await h.run(`loadTileFast(${JSON.stringify(tile)}, ${corsSafe})`)).data, null);
    assert.equal(h.requests.length, 1);
    assert.ok(h.requests.every(r => r.url === tile));
    assert.ok(h.images.every(img => img.cors === 'anonymous'));
  }
});

test('static-only hosting falls back from unavailable local relay to a public CORS relay', async () => {
  const h = harness({ fetchImage: url => url.startsWith('https://images.weserv.nl/') });
  assert.ok((await h.run(`loadTileFast(${JSON.stringify(tile)}, false)`)).data);
  assert.ok(h.requests[0].url.startsWith('/api/tiles?'));
  assert.ok(h.requests[1].url.startsWith('https://images.weserv.nl/'));
});

test('prefetch and repeat captures reuse decoded images without clearing their source', async () => {
  const h = harness({ fetchImage: () => false, imageAllowed: () => true });
  const first = await h.run(`loadTileLight(${JSON.stringify(tile)}, true)`);
  const second = await h.run(`loadTileFast(${JSON.stringify(tile)}, true)`);
  assert.equal(first.data, second.data);
  assert.equal(second.cached, true);
  assert.equal(second.data.src, tile);
  assert.equal(h.requests.length, 1);
  assert.doesNotMatch(html, /data\.src\s*=\s*['"]['"]/);
});

test('blob image fallback remains usable on browsers without createImageBitmap', async () => {
  const h = harness({ bitmap: false });
  const result = await h.run(`loadTileFast(${JSON.stringify(tile)}, true)`);
  assert.ok(result.data.src.startsWith('blob:'));
  assert.equal(result.tainted, false);
  // Revoke the temporary object URL created by the production decoder.
  h.run('tileCache.forEach(entry => entry.close())');
});

test('the LRU owns decoded bitmap lifetime', async () => {
  const h = harness();
  await h.run(`loadTileFast(${JSON.stringify(tile)}, true)`);
  await h.run(`loadTileFast(${JSON.stringify(tile + '?a')}, true)`);
  await h.run(`loadTileFast(${JSON.stringify(tile + '?b')}, true)`);
  assert.equal(h.bitmaps[0].closed, true);
  assert.equal(h.bitmaps[1].closed, undefined);
});

test('relay probe prefers local relay and closes its temporary decoded sample', async () => {
  const h = harness();
  assert.equal(await h.run('ensureFastProxy()'), true);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].url.startsWith('/api/tiles?'));
  assert.equal(h.bitmaps[0].closed, true);
});
