import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const sources = script.slice(script.indexOf('const TILE_SOURCES ='), script.indexOf("let providerSearch ="));
const picker = script.slice(script.indexOf('function providerCountLabel('), script.indexOf('/* ============================================================\n     * 2.'));
const tileBuilder = script.slice(script.indexOf('function buildTileUrl('), script.indexOf('/** Biên pixel'));

function harness() {
  const elements = Object.fromEntries(['provider-buttons', 'pinned-provider-buttons', 'provider-count', 'hud-source'].map(id => [id, { innerHTML: '', textContent: '', style: {} }]));
  const layers = [];
  const context = vm.createContext({
    gibsRecentDate: '2026-10-11',
    $: id => elements[id],
    t: key => key,
    document: { querySelectorAll: () => [] },
    window: {},
    loadCustomProvider() {},
    map: { removeLayer() {} },
    L: { tileLayer: (url, opts) => { const layer = { url, opts, addTo() {} }; layers.push(layer); return layer; } },
  });
  vm.runInContext(`${sources}\nlet providerSearch = ''; let currentSourceKey = 'esri';\n${picker}\n${tileBuilder}`, context);
  return { elements, layers, run: code => vm.runInContext(code, context) };
}

test('all inline application JavaScript parses', () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test('world maps are pinned above the scrolling list, with no duplicates', () => {
  const { elements, run } = harness();
  run('renderProviderButtons()');
  const pinned = elements['pinned-provider-buttons'].innerHTML;
  assert.match(pinned, /Satellite World Map/);
  assert.match(pinned, /Natural Earth \/ Physical World Map/);
  assert.ok(pinned.indexOf('data-source="esri"') < pinned.indexOf('data-source="natural_earth"'));
  assert.doesNotMatch(elements['provider-buttons'].innerHTML, /data-source="(?:esri|natural_earth)"/);
  assert.match(pinned, /aria-pressed="true"/);
  assert.ok(html.indexOf('id="pinned-provider-buttons"') < html.indexOf('id="provider-buttons"'));
  assert.equal(elements['provider-count'].textContent, '22 src');
});

test('search includes pinned providers and preserves counts after switching layers', () => {
  const { elements, run } = harness();
  run("providerSearch = 'physical'; renderProviderButtons(); applyTileLayer('natural_earth')");
  assert.match(elements['pinned-provider-buttons'].innerHTML, /Physical World Map/);
  assert.doesNotMatch(elements['pinned-provider-buttons'].innerHTML, /Satellite World Map/);
  assert.equal(elements['provider-buttons'].innerHTML, '');
  assert.equal(elements['provider-count'].textContent, '1/22 src');
  run("providerSearch = 'not-a-map'; renderProviderButtons()");
  assert.equal(elements['pinned-provider-buttons'].style.display, 'none');
  assert.match(elements['provider-buttons'].innerHTML, /No provider/);
  run("providerSearch = ''; renderProviderButtons()");
  assert.equal(elements['pinned-provider-buttons'].style.display, '');
});

test('Natural Earth preview and export use the same XYZ source, zoom cap and attribution', () => {
  const { elements, layers, run } = harness();
  run("applyTileLayer('natural_earth')");
  assert.equal(layers[0].opts.maxNativeZoom, 8);
  assert.match(layers[0].opts.attribution, /EOX.*Natural Earth/);
  assert.equal(elements['hud-source'].textContent, 'Natural Earth / Physical World Map');
  assert.equal(run("buildTileUrl('natural_earth', 3, 4, 2)"), 'https://tiles.maps.eox.at/wmts/1.0.0/ne_terrain2/default/g/3/2/4.jpg');
  assert.equal(run("buildTileUrl('esri', 3, 4, 2)"), 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4');
});

test('both languages include pinned labels and source descriptions', () => {
  for (const key of ['srcPinned', 'srcSubSatelliteWorld', 'srcSubNaturalEarth']) {
    assert.equal([...script.matchAll(new RegExp(`${key}:`, 'g'))].length, 2);
  }
});
