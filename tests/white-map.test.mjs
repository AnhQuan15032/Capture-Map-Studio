import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const loader = html.slice(html.indexOf('    const landPending = '), html.indexOf('    /* ---------- MASK'));

function landHarness({ fail = false, topo = false } = {}) {
  let fetches = 0, decodes = 0;
  const requests = [];
  const geo = { type: 'FeatureCollection', features: [] };
  const context = vm.createContext({
    Map, $: () => ({}), t: k => k, maskStatusLabel: () => 'ready', maskMode: 'blank',
    window: { topojson: {} },
    topojson: { feature() { decodes++; return geo; } },
    fetch: url => {
      fetches++;
      return new Promise(resolve => requests.push(() => resolve({
        ok: !fail,
        json: async () => topo ? { type: 'Topology', objects: { land: {} } } : geo,
      })));
    },
  });
  vm.runInContext(loader, context);
  return { requests, geo, get fetches() { return fetches; }, get decodes() { return decodes; },
    run: s => vm.runInContext(s, context) };
}

for (const topo of [true, false]) {
  test(`preview and export share a single in-flight ${topo ? 'TopoJSON' : 'GeoJSON'} fetch/parse`, async () => {
    const h = landHarness({ topo });
    const first = h.run("loadLandData('50m')"), second = h.run("loadLandData('50m')");
    assert.equal(h.fetches, 1);
    h.requests.shift()();
    assert.equal(await first, h.geo); assert.equal(await second, h.geo);
    assert.equal(h.decodes, topo ? 1 : 0);
    assert.equal(h.run('landPending.size'), 0);
    assert.equal(await h.run("loadLandData('50m')"), h.geo);
    assert.equal(h.fetches, 1);
  });
}

test('failed coastline loads are deduplicated but remain retryable', async () => {
  const h = landHarness({ fail: true });
  const first = h.run("loadLandData('50m')"), second = h.run("loadLandData('50m')");
  h.requests.shift()();
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(h.run('landPending.size'), 0);
  const retry = h.run("loadLandData('50m')");
  assert.equal(h.fetches, 2);
  h.requests.shift()();
  assert.equal(await retry, null);
});

test('white mode does not start imagery prefetch or connection warmup', async () => {
  const code = html.slice(html.indexOf('    function schedulePrefetch('), html.indexOf("    map.on('moveend zoomend', () => schedulePrefetch(220))"));
  const unexpected = () => { throw new Error('White mode should not touch imagery'); };
  const context = vm.createContext({
    clearTimeout() {}, setTimeout: unexpected, updateViewfinder: unexpected,
    loadTileFast: unexpected, ensureFastProxy: unexpected,
    TILE_SOURCES: new Proxy({}, { get: unexpected }),
  });
  vm.runInContext(`let maskMode = 'blank', isCapturing = false, captureArea = 'viewport';
    let prefetchTimer = null, prefetchToken = 0, currentSourceKey = 'esri'; ${code}`, context);
  vm.runInContext('schedulePrefetch(); warmupConnection()', context);
  await vm.runInContext('prefetchViewfinder(0)', context);
});
