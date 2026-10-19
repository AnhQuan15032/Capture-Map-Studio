import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// Exercise the actual capture entry point, not just individual tile/canvas helpers.
const captureCode = html.slice(html.indexOf('    async function runParallelPool('), html.indexOf("    $('desktop-btn-capture').addEventListener"));

function harness({ equi = false, format = 'jpeg', mask = 'all', encoder = 'ok', failure } = {}) {
  const canvases = [], encodes = [], downloads = [], snapshots = [], toasts = [], errors = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const dims = equi ? { outW: 512, outH: 256 } : { outW: 1444, outH: 812 };
  const vf = { ...dims, srcZoom: 8, x0: 0, y0: 0, x1: 256, y1: 256, world: equi, equi };
  class FakeCanvas {
    width = 0; height = 0; draws = [];
    getContext() {
      return { fillRect() {}, drawImage: (...args) => this.draws.push(args) };
    }
    toBlob(callback, mimeType, quality) {
      encodes.push({ canvas: this, w: this.width, h: this.height, mimeType, quality });
      if (failure) throw failure;
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
    captureLabelText: () => 'Capture',
    addSnapshot: (...args) => snapshots.push(args),
    isUniformBlank: () => false,
    loadLandData: async () => ({}),
    buildLandMask: () => new FakeCanvas(),
    window: { d3: { geoMercator() {} } }, d3: { geoMercator() {} },
    latToY: (lat, zoom, size) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * size * 2 ** zoom,
  });
  function $(id) { return element(id); }
  vm.runInContext(`let isCapturing = false, prefetchToken = 0, prefetchTimer = null;
    const TILE_SIZE = 256, MAX_LAT = 85.05112878;
    let currentSourceKey = 'nasa_night', currentScale = 2, currentRatio = '16:9';
    let currentFormat = ${JSON.stringify(format)}, maskMode = ${JSON.stringify(mask)}, maskDetail = '110m', oceanColor = '#123456';
    let useProxy = true, proxyProbePromise = null, activeProxyIdx = 0;
    const PROXY_BUILDERS = [u => u], TILE_SOURCES = { nasa_night: { corsSafe: true } };
    ${captureCode}`, context);
  return { canvases, encodes, downloads, snapshots, toasts, errors, elements, run: code => vm.runInContext(code, context) };
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
