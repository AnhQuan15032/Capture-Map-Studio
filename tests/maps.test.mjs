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
  const elements = Object.fromEntries(['provider-buttons', 'provider-count', 'hud-source'].map(id => [id, { innerHTML: '', textContent: '', style: {} }]));
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

test('deleted map presets and pinned section are absent, with Esri as the default', () => {
  const { elements, run } = harness();
  run('renderProviderButtons()');
  const list = elements['provider-buttons'].innerHTML;
  assert.doesNotMatch(list, /Satellite World Map|Natural Earth \/ Physical World Map/);
  assert.match(list, /Esri World Imagery/);
  assert.match(list, /NASA Blue Marble/);
  assert.match(list, /NASA City Lights/);
  assert.match(list, /data-source="esri" aria-pressed="true"/);
  assert.equal(elements['provider-count'].textContent, '21 src');
  assert.equal(run('TILE_SOURCES.satellite_world'), undefined);
  assert.equal(run('TILE_SOURCES.natural_earth'), undefined);
  assert.doesNotMatch(html, /pinned-provider-buttons|srcPinned|srcSubSatelliteWorld|srcSubNaturalEarth/);
  assert.match(html, /let currentSourceKey = 'esri'/);
});

test('provider search and counts still work after switching layers and clearing search', () => {
  const { elements, run } = harness();
  run("providerSearch = 'NASA Blue Marble'; renderProviderButtons(); applyTileLayer('nasa_blue')");
  assert.match(elements['provider-buttons'].innerHTML, /NASA Blue Marble/);
  assert.doesNotMatch(elements['provider-buttons'].innerHTML, /Esri World Imagery/);
  assert.equal(elements['provider-count'].textContent, '1/21 src');
  run("providerSearch = 'not-a-map'; renderProviderButtons()");
  assert.match(elements['provider-buttons'].innerHTML, /No provider/);
  run("providerSearch = ''; renderProviderButtons()");
  assert.equal(elements['provider-count'].textContent, '21 src');
});

test('original Esri and NASA preview and export sources remain available', () => {
  const { elements, layers, run } = harness();
  run("applyTileLayer('esri')");
  assert.equal(layers[0].opts.maxNativeZoom, 22);
  assert.match(layers[0].opts.attribution, /Esri/);
  assert.equal(elements['hud-source'].textContent, 'Esri World Imagery');
  assert.equal(run("buildTileUrl('esri', 3, 4, 2)"), 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4');
  assert.equal(run("buildTileUrl('nasa_blue', 3, 4, 2)"), 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default//EPSG3857_500m/3/2/4.jpeg');
});
