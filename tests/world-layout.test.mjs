import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const boundsCode = html.slice(html.indexOf('    function worldPixelBounds('), html.indexOf('    /** Số tile bao phủ'));
const enumerateCode = html.slice(html.indexOf('    function enumerateTileUrls('), html.indexOf('    async function runParallelPool('));
const viewCode = html.slice(html.indexOf('    function getCanvasCaps('), html.indexOf("    map.on('move zoom resize'"));
const sizeCode = html.slice(html.indexOf('    function setCustomSize('), html.indexOf("    $('custom-w').addEventListener"));

function harness() {
  const elements = new Map();
  const context = vm.createContext({
    $: id => {
      if (!elements.has(id)) elements.set(id, { clientWidth: 1280, clientHeight: 900, style: {}, classList: { add() {}, remove() {}, toggle() {} } });
      return elements.get(id);
    },
    t: key => key,
    window: { innerWidth: 1280 }, navigator: { userAgent: 'Desktop', deviceMemory: 8 },
    map: { getCenter: () => ({ lat: 0, lng: 11.5 }), getZoom: () => 2 },
    countTiles: () => 16, captureLabelText: () => 'Capture',
    buildTileUrl: (key, z, x, y) => `${z}/${x}/${y}`,
  });
  vm.runInContext(`const TILE_SIZE = 256; let worldCenterLng = 11.5, safetyLimitOn = false;
    let currentSourceKey = 'satellite_world', captureArea = 'world', currentRatio = '16:9', currentScale = 2;
    let customResOn = false, customW = 3840, customH = 2160, isCapturing = false;
    const turboMode = true, MAX_TILES_TURBO = 999999, MAX_TILES = 999999, tileCache = new Map();
    const TILE_SOURCES = { satellite_world: { maxZoom: 8 } };
    ${boundsCode}\n${enumerateCode}\n${viewCode}\n${sizeCode}`, context);
  return code => vm.runInContext(code, context);
}

test('world seam is 168.5°W, keeping Russia east of the dateline at the right edge', () => {
  const run = harness();
  const b = run('worldPixelBounds(4)');
  const size = 256 * 16;
  assert.ok(Math.abs(b.minPixX / size * 360 - 180 - (-168.5)) < 1e-10);
  assert.equal(b.maxPixX - b.minPixX, size);
  // Uelen, mainland Russia, is east of the old -180° seam but belongs at the right.
  let x = (-169.81 + 180) / 360 * size;
  if (x < b.minPixX) x += size;
  assert.ok((x - b.minPixX) / size > 0.99);
  // Cape Prince of Wales, mainland Alaska, remains at the left.
  const alaskaX = (-168.09 + 180) / 360 * size;
  assert.ok(alaskaX >= b.minPixX && (alaskaX - b.minPixX) / size < 0.01);
});

test('shifted world tiles cover both partial edges while wrapping only request coordinates', () => {
  const run = harness();
  const tasks = run('enumerateTileUrls({ world: true, srcZoom: 4 })');
  assert.equal(tasks.length, 17 * 16);
  const row = tasks.filter(task => task.ty === 0);
  assert.equal(row[0].tx, 0);
  assert.equal(row.at(-1).tx, 16);
  assert.equal(row.at(-1).url, '4/0/0');
  const negative = run('worldCenterLng = -45; enumerateTileUrls({ world: true, srcZoom: 4 })');
  assert.equal(negative[0].tx, -2);
  assert.equal(negative[0].url, '4/14/0');
});

test('default caps are unbounded by the app, while optional GPU safety still works', () => {
  const run = harness();
  assert.equal(run('getCanvasCaps().maxDim'), Infinity);
  assert.equal(run('getCanvasCaps().maxArea'), Infinity);
  assert.ok(run('safetyLimitOn = true; getCanvasCaps().maxDim') < Infinity);
  assert.match(html, /let safetyLimitOn = false/);
  assert.doesNotMatch(html, /id="safety-check" checked/);
});

for (const area of ['viewport', 'world', 'equi']) {
  test(`custom 65536×32768 dimensions are not silently capped in ${area} mode`, () => {
    const run = harness();
    run(`captureArea = '${area}'; customResOn = true; setCustomSize(65536, 32768)`);
    const vf = run('updateViewfinder()');
    assert.equal(vf.outW, 65536);
    assert.equal(vf.outH, 32768);
    assert.equal(vf.clamped, false);
    assert.ok(vf.srcZoom <= 8);
    run('safetyLimitOn = true');
    assert.equal(run('updateViewfinder().clamped'), true);
  });
}

test('custom size fields have no fixed maximum but reject non-finite or imprecise inputs', () => {
  const run = harness();
  run('setCustomSize(100000, 50000)');
  assert.equal(run('customW'), 100000);
  run('setCustomSize(Infinity, 50000); setCustomSize(NaN, 100); setCustomSize(1e30, 100)');
  assert.equal(run('customW'), 100000);
  assert.doesNotMatch(html, /id="custom-[wh]"[^>]*max=/);
});
