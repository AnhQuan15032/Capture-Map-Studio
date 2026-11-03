// Optional full-page export regression with intercepted local browser fixtures.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const deps=resolve(process.env.WHITE_MAP_BROWSER_DEPS || '.cache/white-map-check');
const require=createRequire(join(deps,'package.json'));
const {chromium:pw}=require('playwright-core');
const chromiumModule=require('@sparticuz/chromium');
const chromium=chromiumModule.default || chromiumModule;
const root=join(deps,'node_modules')+'/';
const browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(),args:chromium.args,headless:true});
try {
const page=await browser.newPage({viewport:{width:1444,height:900},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const files={
 '@tailwindcss/browser':root+'@tailwindcss/browser/dist/index.global.js',
 'leaflet@1.9.4/dist/leaflet.css':root+'leaflet/dist/leaflet.css',
 'leaflet@1.9.4/dist/leaflet.js':root+'leaflet/dist/leaflet.js',
 'lucide@0.469.0':root+'lucide/dist/umd/lucide.min.js',
 'topojson-client@3':root+'topojson-client/dist/topojson-client.min.js',
 'd3-array@3':root+'d3-array/dist/d3-array.min.js',
 'd3-geo@3':root+'d3-geo/dist/d3-geo.min.js',
 'land-50m.json':root+'world-atlas/land-50m.json',
 'land-110m.json':root+'world-atlas/land-110m.json',
 'ne_10m_land.geojson':join(deps,'land-10m.json'),
};
await page.route('**/*',async route=>{
 const u=route.request().url();
 if(u==='https://capture.test/') return route.fulfill({contentType:'text/html',body:await readFile('index.html')});
 for(const [key,path] of Object.entries(files))if(u.includes(key))return route.fulfill({body:await readFile(path),contentType:path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/javascript',headers:{'access-control-allow-origin':'*'}});
 if(u.includes('fonts.google'))return route.fulfill({body:'',contentType:'text/css'});
 return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/y1cAAAAASUVORK5CYII=','base64'),headers:{'access-control-allow-origin':'*'}});
});
await page.goto('https://capture.test/');
await page.waitForFunction(()=>typeof executeCapture==='function');
console.log('boot',errors);
for (const [area,format,w,h,detail] of [['viewport','png',1444,812,'50m'],['viewport','jpeg',1444,812,'50m'],['world','png',1024,1024,'110m'],['equi','png',1024,512,'50m'],['equi','png',1600,700,'10m']]) {
 await page.evaluate(({area,format,w,h,detail})=>{customResOn=true;customW=w;customH=h;currentFormat=format;maskDetail=detail;setCaptureArea(area);setMaskMode('blank');updateViewfinder();},{area,format,w,h,detail});
 const done=page.waitForEvent('download');
 await page.locator('#desktop-btn-capture').click({force:true});
 const download=await done;
 const pixels=await readFile(await download.path());
 const dimensions=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)]));return [image.width,image.height];},[...pixels]);
 assert.deepEqual(dimensions,[w,h]);
 if(format==='png')assert.deepEqual([pixels.readUInt32BE(16),pixels.readUInt32BE(20)],[w,h]);
 else assert.equal(pixels.readUInt16BE(0),0xffd8);
 await page.waitForFunction(()=>!isCapturing);
 console.log('download',download.suggestedFilename(),pixels.length);
}
await page.evaluate(()=>{customW=1024;customH=512;setCaptureArea('equi');maskDetail='50m';updateViewfinder();});
let downloads=[];page.on('download',d=>downloads.push(d));
await page.locator('#btn-dual-export').click({force:true});
await page.waitForFunction(()=>!isCapturing);
assert.equal(downloads.length,2);
for(const d of downloads) {
 const p=await readFile(await d.path());
 const dimensions=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)]));return [image.width,image.height];},[...p]);
 assert.deepEqual(dimensions,[1024,512]);
 console.log('dual',d.suggestedFilename(),p.length);
}
assert.deepEqual(errors,[]);
console.log('Full-page white capture checks PASS');
} finally {await browser.close();}
