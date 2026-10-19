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
  vm.runInContext(`${sources}\nlet providerSearch = ''; let currentSourceKey = 'satellite_world';\n${picker}\n${tileBuilder}`, context);
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
  assert.ok(pinned.indexOf('data-source="satellite_world"') < pinned.indexOf('data-source="natural_earth"'));
  assert.doesNotMatch(elements['provider-buttons'].innerHTML, /data-source="(?:satellite_world|natural_earth)"/);
  assert.match(pinned, /aria-pressed="true"/);
  assert.match(elements['provider-buttons'].innerHTML, /Esri World Imagery/);
  assert.ok(html.indexOf('id="pinned-provider-buttons"') < html.indexOf('id="provider-buttons"'));
  assert.equal(elements['provider-count'].textContent, '23 src');
});

test('search includes pinned providers and preserves counts after switching layers', () => {
  const { elements, run } = harness();
  run("providerSearch = 'physical'; renderProviderButtons(); applyTileLayer('natural_earth')");
  assert.match(elements['pinned-provider-buttons'].innerHTML, /Physical World Map/);
  assert.doesNotMatch(elements['pinned-provider-buttons'].innerHTML, /Satellite World Map/);
  assert.equal(elements['provider-buttons'].innerHTML, '');
  assert.equal(elements['provider-count'].textContent, '1/23 src');
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
  assert.match(layers[0].opts.attribution, /OpenStreetMap.*Natural Earth.*EOX/);
  assert.equal(elements['hud-source'].textContent, 'Natural Earth / Physical World Map');
  assert.equal(run("buildTileUrl('natural_earth', 3, 4, 2)"), 'https://tiles.maps.eox.at/wmts/1.0.0/terrain_3857/default/g/3/2/4.jpg');
  assert.equal(run("buildTileUrl('esri', 3, 4, 2)"), 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4');
});

test('both languages include pinned labels and source descriptions', () => {
  for (const key of ['srcPinned', 'srcSubSatelliteWorld', 'srcSubNaturalEarth']) {
    assert.equal([...script.matchAll(new RegExp(`${key}:`, 'g'))].length, 2);
  }
});

test('pinned satellite uses NASA relief and bathymetry, not Sentinel-2 or Esri', () => {
  const { elements, layers, run } = harness();
  run("applyTileLayer('satellite_world')");
  assert.equal(layers[0].opts.maxNativeZoom, 8);
  assert.match(layers[0].url, /BlueMarble_ShadedRelief_Bathymetry/);
  assert.match(layers[0].opts.attribution, /NASA Blue Marble/);
  assert.equal(elements['hud-source'].textContent, 'Satellite World Map');
  assert.equal(run("buildTileUrl('satellite_world', 3, 4, 2)"), 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default//EPSG3857_500m/3/2/4.jpeg');
  assert.notEqual(run('TILE_SOURCES.satellite_world.url'), run('TILE_SOURCES.esri.url'));
  assert.match(html, /let currentSourceKey = 'satellite_world'/);
});

test('world presets do not regress to land-only relief or Sentinel-2', () => {
  const { run } = harness();
  assert.doesNotMatch(run('TILE_SOURCES.natural_earth.url'), /ne2sr|ne_terrain2/);
  assert.doesNotMatch(run('TILE_SOURCES.satellite_world.url'), /s2cloudless|World_Imagery/);
  assert.equal(run('TILE_SOURCES.nasa_blue.url'), run('TILE_SOURCES.satellite_world.url'));
  assert.equal(run('TILE_SOURCES.natural_earth.maxZoom'), 8);
});
