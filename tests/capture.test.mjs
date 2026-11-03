import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// Exercise the actual capture entry point, not just individual tile/canvas helpers.
const worldBoundsCode = html.slice(html.indexOf('    function worldPixelBounds('), html.indexOf('    /** Số tile bao phủ'));
const captureCode = html.slice(html.indexOf('    async function runParallelPool('), html.indexOf("    $('desktop-btn-capture').addEventListener"));

const dualCode = html.slice(html.indexOf('    async function executeDualCapture()'), html.indexOf("    $('btn-dual-export').addEventListener"));
const projectionCode = html.slice(html.indexOf('    function mercatorProjection('), html.indexOf('    /** Path2D đất liền'));
const offsetsCode = html.slice(html.indexOf('    function antimeridianOffsets('), html.indexOf('    function worldPixelBounds('));

function harness({ world = false, noData = false, missingD3 = false, failAt = 1, equi = false, format = 'jpeg', mask = 'all', encoder = 'ok', failure, rejectCanvas = false } = {}) {
  const canvases = [], encodes = [], downloads = [], snapshots = [], toasts = [], errors = [];
  const elements = new Map();
  let pathBuilds = 0;
  const projection = () => {
    const p = {};
    for (const name of ['rotate', 'scale', 'translate', 'precision', 'clipExtent']) p[name] = () => p;
    return p;
  };
  const fakeD3 = { geoMercator: projection, geoEquirectangular: projection, geoPath() {
    const path = () => { pathBuilds++; return 'M0,0Z'; }; path.context = () => path; return path;
  } };
  const land = noData ? null : {};

  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const dims = equi ? { outW: 512, outH: 256 } : { outW: 1444, outH: 812 };
  const vf = { ...dims, srcZoom: 8, x0: 0, y0: 0, x1: 256, y1: 256, world: world || equi, equi };
  class FakeCanvas {
    width = 0; height = 0; draws = [];
    fills = [];
    ctx = {
      globalCompositeOperation: 'source-over', fillStyle: '',
      fillRect() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {}, scale() {},
      save() {}, restore() { this.globalCompositeOperation = 'source-over'; },
      fill: (path, rule) => this.fills.push({ rule, op: this.ctx.globalCompositeOperation }),
      drawImage: (...args) => this.draws.push(args),
    };
    getContext() { return rejectCanvas ? null : this.ctx; }
    toBlob(callback, mimeType, quality) {
      encodes.push({ canvas: this, w: this.width, h: this.height, mimeType, quality, fills: [...this.fills] });
      if (failure && encodes.length === failAt) throw failure;
      queueMicrotask(() => callback(encoder === 'null' ? null : new Blob(['pixels'], { type: mimeType })));
    }
  }
  const context = vm.createContext({
    $, // Defined below, function declarations are hoisted.
    drawer: element('drawer'), performance, clearTimeout() {},
    setTimeout(fn, delay) { if (delay < 100) queueMicrotask(fn); return 0; },
    console: { error: (...args) => errors.push(args) },
    document: { createElement: tag => {
      if (tag === 'canvas') { const cv = new FakeCanvas(); canvases.push(cv); return cv; }
      if (tag === 'a') { const a = { click: () => downloads.push({ href: a.href, name: a.download }) }; return a; }
      throw new Error('Unexpected element: ' + tag);
    } },
    URL: { createObjectURL: () => 'blob:capture' },
    t: (key, vars) => key + (vars ? ':' + JSON.stringify(vars) : ''),
    showToast: (message, kind) => toasts.push({ message, kind }),
    updateViewfinder: () => vf,
    pixelBoundsAt: () => ({ minPixX: 0, maxPixX: 256, minPixY: 0, maxPixY: 256 }),
    enumerateTileUrls: () => [{ tx: 0, ty: 0, url: 'https://tiles.example/night.jpg' }],
    loadTileFast: async () => ({ data: { width: 256, height: 256 }, tainted: false, cached: false }),
    captureLabelText: () => 'Capture', scheduleMaskPreview() {},
    addSnapshot: (...args) => snapshots.push(args),
    isUniformBlank: () => false,
    loadLandData: async () => land,
    buildLandMask: () => new FakeCanvas(),
    window: { d3: missingD3 ? null : fakeD3 }, d3: fakeD3, Path2D: class {},
    latToY: (lat, zoom, size) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * size * 2 ** zoom,
  });
  function $(id) { return element(id); }
  vm.runInContext(`let isCapturing = false, prefetchToken = 0, prefetchTimer = null, worldCenterLng = 11.5;
    ${worldBoundsCode}
    const TILE_SIZE = 256, MAX_LAT = 85.05112878;
    let currentSourceKey = 'nasa_night', currentScale = 2, currentRatio = '16:9';
    let currentFormat = ${JSON.stringify(format)}, maskMode = ${JSON.stringify(mask)}, maskDetail = '110m', oceanColor = '#123456';
    let useProxy = true, proxyProbePromise = null, activeProxyIdx = 0;
    const PROXY_BUILDERS = [u => u], TILE_SOURCES = { nasa_night: { corsSafe: true } };
    ${projectionCode}
    ${offsetsCode}
    ${captureCode}
    ${dualCode}`, context);
  return { get pathBuilds() { return pathBuilds; }, canvases, encodes, downloads, snapshots, toasts, errors, elements, run: code => vm.runInContext(code, context) };
}

for (const format of ['jpeg', 'png']) {
  test(`full 1444×812 NASA night ${format} capture reaches download and releases the capture lock`, async () => {
    const h = harness({ format });
    await h.run('executeCapture()');
    assert.equal(h.encodes.length, 1);
    assert.deepEqual([h.encodes[0].w, h.encodes[0].h], [1444, 812]);
    assert.equal(h.encodes[0].mimeType, 'image/' + format);
    assert.equal(h.downloads.length, 1);
    assert.match(h.downloads[0].name, /nasa_night.*1444x812\.(?:jpg|png)$/);
    assert.equal(h.snapshots.length, 1);
    assert.equal(h.run('isCapturing'), false);
    assert.equal(h.toasts.some(t => t.kind === 'error'), false);
    await h.run('executeCapture()');
    assert.equal(h.downloads.length, 2);
  });
}

test('full equirectangular capture encodes the reprojected canvas, not an undefined variable', async () => {
  const h = harness({ equi: true, format: 'png' });
  await h.run('executeCapture()');
  assert.equal(h.downloads.length, 1);
  assert.equal(h.encodes[0].canvas, h.canvases[1]);
  assert.deepEqual([h.encodes[0].w, h.encodes[0].h], [512, 256]);
  assert.ok(h.canvases[1].draws.length > 200);
});

test('land-only capture forces PNG and downloads the masked canvas', async () => {
  const h = harness({ mask: 'land', format: 'jpeg' });
  await h.run('executeCapture()');
  assert.equal(h.encodes.length, 1);
  assert.equal(h.encodes[0].mimeType, 'image/png');
  assert.equal(h.downloads.length, 1);
});

test('an encoder returning null is reported as encoding failure, not a device-memory diagnosis', async () => {
  const h = harness({ encoder: 'null' });
  await h.run('executeCapture()');
  assert.equal(h.downloads.length, 0);
  assert.ok(h.toasts.some(t => t.message.startsWith('toastNoBlob')));
  assert.equal(h.run('isCapturing'), false);
  assert.equal(h.elements.get('speed-indicator').textContent, 'finExport');
});

test('a runtime programming error reports its real detail, not memory or CORS', async () => {
  const h = harness({ failure: new ReferenceError('missing <canvas>') });
  await h.run('executeCapture()');
  assert.equal(h.downloads.length, 0);
  const error = h.toasts.find(t => t.kind === 'error');
  assert.match(error.message, /toastExportError.*ReferenceError.*missing &lt;canvas&gt;/);
  assert.equal(h.elements.get('speed-indicator').textContent, 'finExport');
  assert.equal(h.run('isCapturing'), false);
  assert.equal(h.errors.length, 1);
});

test('a genuine canvas SecurityError is still identified as CORS', async () => {
  const failure = new Error('tainted canvas'); failure.name = 'SecurityError';
  const h = harness({ failure });
  await h.run('executeCapture()');
  assert.ok(h.toasts.some(t => t.message.startsWith('toastCanvasBlock')));
  assert.equal(h.elements.get('speed-indicator').textContent, 'finCors');
  assert.equal(h.run('isCapturing'), false);
});

test('a browser-rejected canvas reports the requested size without leaving capture locked', async () => {
  const h = harness({ rejectCanvas: true });
  await h.run('executeCapture()');
  assert.equal(h.encodes.length, 0);
  assert.equal(h.downloads.length, 0);
  assert.ok(h.toasts.some(t => /toastCanvasSize.*1444.*812/.test(t.message)));
  assert.equal(h.run('isCapturing'), false);
});

for (const [area, options] of Object.entries({ viewport: {}, world: { world: true }, equi: { equi: true } })) {
  for (const format of ['png', 'jpeg']) {
    test(`white ${area} ${format} export uses just one raster canvas and downloads the requested dimensions`, async () => {
      const h = harness({ ...options, mask: 'blank', format });
      await h.run('executeCapture()');
      assert.equal(h.canvases.length, 1);
      assert.equal(h.encodes.length, 1);
      assert.deepEqual([h.encodes[0].w, h.encodes[0].h], options.equi ? [512, 256] : [1444, 812]);
      assert.equal(h.downloads.length, 1);
      assert.equal(h.encodes[0].mimeType, `image/${format}`);
      assert.equal(h.encodes[0].fills.every(f => f.rule === 'evenodd'), true);
      assert.equal(h.canvases[0].draws.length, 0, 'no intermediate masks or scanline resampling');
      assert.equal(h.canvases[0].width, 0, 'backing store released after encoding');
      assert.equal(h.run('isCapturing'), false);
      assert.equal(h.errors.length, 0);
      const compiled = h.pathBuilds;
      await h.run('executeCapture()');
      assert.equal(h.pathBuilds, compiled, 'repeat capture reuses vector geometry');
    });
  }
  test(`white ${area} dual export sequentially encodes two complementary PNGs on the same canvas`, async () => {
    const h = harness({ ...options, mask: 'blank' });
    await h.run('executeDualCapture()');
    assert.equal(h.canvases.length, 1);
    assert.equal(h.encodes.length, 2);
    assert.equal(h.encodes[0].canvas, h.encodes[1].canvas);
    assert.equal(h.encodes.every(e => e.mimeType === 'image/png'), true);
    assert.equal(h.encodes[0].fills[0].op, 'destination-out');
    assert.equal(h.encodes[1].fills.at(-1).op, 'source-over', 'no stale erase operation on land layer');
    assert.equal(h.downloads.length, 2);
    assert.match(h.downloads[0].name, /fileOcean\.png$/);
    assert.match(h.downloads[1].name, /fileLand\.png$/);
    assert.equal(h.run('isCapturing'), false);
    assert.equal(h.errors.length, 0);
  });
}

for (const entry of ['executeCapture()', 'executeDualCapture()']) {
  for (const [name, options, message] of [
    ['unavailable data', { noData: true }, 'toastDualNoData'],
    ['missing D3', { missingD3: true }, 'toastDualNoD3'],
    ['rejected canvas', { rejectCanvas: true }, 'toastCanvasSize'],
    ['null encoder', { encoder: 'null' }, 'toastNoBlob'],
    ['thrown encoder', { failure: new Error('<encoder broke>') }, '&lt;encoder broke&gt;'],
  ]) {
    test(`white ${entry}: ${name} reports the real error and always unlocks capture`, async () => {
      const h = harness({ mask: 'blank', ...options });
      await h.run(entry);
      assert.equal(h.run('isCapturing'), false);
      assert.equal(h.canvases.every(cv => cv.width === 0 && cv.height === 0), true);
      assert.equal(h.toasts.some(t => t.kind === 'error' && t.message.includes(message)), true);
      assert.equal(h.downloads.length, 0);
    });
  }
}

test('white dual export cleans up even if the second encoder throws', async () => {
  const h = harness({ mask: 'blank', failAt: 2, failure: new Error('second layer failed') });
  await h.run('executeDualCapture()');
  assert.equal(h.downloads.length, 1);
  assert.equal(h.run('isCapturing'), false);
  assert.equal(h.canvases[0].width, 0);
  assert.equal(h.toasts.some(t => t.message.includes('second layer failed')), true);
  assert.equal(h.toasts.some(t => t.message.includes('toastDualDone')), false);
});

test('white path cache is replaced when bounds, dimensions, projection or source geometry change', () => {
  const h = harness({ mask: 'blank' });
  h.run(`const geo = {}, bounds = {minPixX: 0, maxPixX: 256, minPixY: 0, maxPixY: 256};
    const frame = {outW: 500, outH: 500, srcZoom: 0, equi: false};
    whiteMapGeometry(geo, frame, bounds);`);
  const initial = h.pathBuilds;
  h.run('whiteMapGeometry(geo, frame, bounds)');
  assert.equal(h.pathBuilds, initial);
  for (const update of ['bounds.minPixY++', 'frame.outW++', 'frame.equi = true']) {
    const before = h.pathBuilds;
    h.run(`${update}; whiteMapGeometry(geo, frame, bounds)`);
    assert.ok(h.pathBuilds > before);
  }
  const before = h.pathBuilds;
  h.run('whiteMapGeometry({}, frame, bounds)');
  assert.ok(h.pathBuilds > before);
});
