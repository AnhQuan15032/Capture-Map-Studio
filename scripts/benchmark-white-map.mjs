// Optional real-browser regression + PNG benchmark; see docs/white-map-performance.md.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import assert from 'node:assert/strict';
const deps = resolve(process.env.WHITE_MAP_BROWSER_DEPS || '.cache/white-map-check');
const require = createRequire(join(deps, 'package.json'));
const { chromium: playwright } = require('playwright-core');
const chromiumModule = require('@sparticuz/chromium');
const chromium = chromiumModule.default || chromiumModule;
const browser = await playwright.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(),
  args: chromium.args, headless: true,
});
const page = await browser.newPage();
const html = await readFile('index.html', 'utf8');
const slice = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
try {
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: join(dirname(require.resolve('d3')), '../dist/d3.min.js') });
  await page.addScriptTag({ path: require.resolve('topojson-client') });
  await page.addScriptTag({ content: `const TILE_SIZE = 256, MAX_LAT = 85.05112878;
    ${slice('    function antimeridianOffsets(', '    function worldPixelBounds(')}
    ${slice('    function mercatorProjection(', '    /** Tile "trắng đồng nhất"')}
    ${slice('    // One bounded vector cache,', '    async function executeWhiteCapture(')}
    const latToY = (lat,z) => (1 - Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2*256*2**z;
    function surface(w,h) {const c=document.createElement('canvas'); c.width=w;c.height=h;return c;}
    function baseline(geo,vf,pb) {
      const c=surface(vf.outW,vf.outH), ctx=c.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
      const mask=buildLandMask(geo,c.width,c.height,vf.srcZoom,pb.minPixX,pb.minPixY,
        c.width/(pb.maxPixX-pb.minPixX),c.height/(pb.maxPixY-pb.minPixY));
      const land=surface(c.width,c.height),l=land.getContext('2d');
      l.fillStyle='#000';l.fillRect(0,0,c.width,c.height);
      l.globalCompositeOperation='destination-in';l.drawImage(mask,0,0);
      ctx.drawImage(land,0,0);mask.width=mask.height=land.width=land.height=0;
      if(!vf.equi)return c;
      const eq=surface(c.width,c.height),e=eq.getContext('2d');
      for(let y=0;y<eq.height;y++) {
        const lat=90-y/eq.height*180;if(lat>MAX_LAT||lat<-MAX_LAT)continue;
        const mercY=latToY(lat,vf.srcZoom)*c.height/(256*2**vf.srcZoom);
        e.drawImage(c,0,Math.max(0,mercY-.5),c.width,1,0,y,eq.width,1);
      }
      c.width=c.height=0;return eq;
    }
    function optimized(geo,vf,pb) {const c=surface(vf.outW,vf.outH);paintWhiteMap(c,whiteMapGeometry(geo,vf,pb),'map');return c;}
    function sample(c,x,y) {return [...c.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data];}
    async function encode(c) {return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b.size):reject(new Error('Null blob')),'image/png'));}
  ` });
  const land50 = JSON.parse(await readFile(require.resolve('world-atlas/land-50m.json'), 'utf8'));
  await page.evaluate(data => window.land50=topojson.feature(data,data.objects.land),land50);
  const land10 = JSON.parse(await readFile(join(deps,'land-10m.json'),'utf8'));
  await page.evaluate(data=>window.land10=data,land10);
  const correctness=await page.evaluate(async()=>{
    const rect = (x0,y0,x1,y1) => [[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]];
    const geo={type:'Polygon',coordinates:[rect(-20,-20,20,20),rect(-5,-5,5,5).reverse()]};
    const pb={minPixX:0,maxPixX:256,minPixY:0,maxPixY:256};
    const checks=[];
    for(const equi of [false,true]) {
      const vf={outW:512,outH:equi?256:512,srcZoom:0,equi};
      const c=optimized(geo,vf,pb), y=vf.outH/2;
      checks.push({equi,lake:sample(c,256,y),land:sample(c,280,y),sea:sample(c,100,y),polar:sample(c,100,0)});
      const geometry=whiteMapGeometry(geo,vf,pb);
      paintWhiteMap(c,geometry,'land'); const a=sample(c,280,y), b=sample(c,256,y);
      paintWhiteMap(c,geometry,'ocean'); checks.at(-1).dual={land:a,lake:b,ocean:sample(c,100,y),landErased:sample(c,280,y),lakeOpaque:sample(c,256,y)};
      c.width=c.height=0;
    }
    // Real coastline comparison: no raster reprojection in the Mercator path.
    const vf={outW:1024,outH:1024,srcZoom:1,equi:false};
    const variants=[{minPixX:512*11.5/360,maxPixX:512*(1+11.5/360),minPixY:0,maxPixY:512},
      {minPixX:510,maxPixX:546,minPixY:100,maxPixY:136},
      {minPixX:-550,maxPixX:550,minPixY:0,maxPixY:512}];
    const comparisons=[];
    for (const bounds of variants) {
      const old=baseline(land50,vf,bounds),next=optimized(land50,vf,bounds);
      const a=old.getContext('2d').getImageData(0,0,1024,1024).data,b=next.getContext('2d').getImageData(0,0,1024,1024).data;
      let different=0,substantial=0,max=0;
      for(let i=0;i<a.length;i+=4) {const d=Math.abs(a[i]-b[i]);if(d)different++;if(d>8)substantial++;max=Math.max(max,d);}
      comparisons.push({bounds,different,substantial,max});old.width=old.height=next.width=next.height=0;
    }
    // Native equi: shifted Russia on the right, Alaska on the left; arbitrary size.
    const frame={outW:4096,outH:1000,srcZoom:1,equi:true};
    const bounds=variants[0], c=optimized(land50,frame,bounds);
    const point=(lon,lat)=>{const x=((lon-11.5+180+360)%360)/360*4096,y=(90-lat)/180*1000;return {x,y,pixel:sample(c,x,y)}};
    const placements={russia:point(170,65),alaska:point(-150,65),pacific:point(-130,0),greenland:point(-42,75)};
    const pngSize=await encode(c);c.width=c.height=0;
    return {checks,comparisons,placements,pngSize};
  });
  console.log(JSON.stringify({correctness},null,2));
  for(const c of correctness.checks) {
    assert.deepEqual(c.lake,[255,255,255,255]); assert.deepEqual(c.land,[0,0,0,255]);
    assert.deepEqual(c.sea,[255,255,255,255]);assert.deepEqual(c.dual.land,[0,0,0,255]);
    assert.equal(c.dual.lake[3],0);assert.equal(c.dual.landErased[3],0);
    assert.deepEqual(c.dual.lakeOpaque,[255,255,255,255]);assert.deepEqual(c.dual.ocean,[255,255,255,255]);
    assert.equal(c.polar[3],c.equi?0:255);
  }
  for(const c of correctness.comparisons) assert.ok(c.substantial<1024*1024*.001,`Mercator coast difference too large: ${JSON.stringify(c)}`);
  assert.deepEqual(correctness.placements.russia.pixel,[0,0,0,255]);
  assert.deepEqual(correctness.placements.alaska.pixel,[0,0,0,255]);
  assert.deepEqual(correctness.placements.greenland.pixel,[0,0,0,255]);
  assert.deepEqual(correctness.placements.pacific.pixel,[255,255,255,255]);
  const results=await page.evaluate(async()=>{
    const output=[];
    const pb={minPixX:256*11.5/360,maxPixX:256*(1+11.5/360),minPixY:0,maxPixY:256};
    for(const detail of ['50','10']) for(const equi of [false,true]) {
      const vf={outW:4096,outH:equi?2048:4096,srcZoom:0,equi},geo=window['land'+detail];
      const rows=[];
      for(const mode of ['baseline','cold','warm']) for(let run=0;run<4;run++) {
        if(mode==='cold')whiteGeometryCache=null;
        const t=performance.now(), c=mode==='baseline'?baseline(geo,vf,pb):optimized(geo,vf,pb),render=performance.now()-t;
        const bytes=await encode(c),total=performance.now()-t;
        c.width=c.height=0;
        if(run) rows.push({mode,render,total,bytes});
      }
      const med=key=>{const s=rows.filter(x=>x.mode===key);const median=k=>s.map(x=>x[k]).sort((a,b)=>a-b)[1];return {renderMs:median('render'),totalMs:median('total'),pngBytes:median('bytes')};};
      output.push({detail:detail+'m',projection:equi?'equirectangular':'mercator',dimensions:[vf.outW,vf.outH],baseline:med('baseline'),cold:med('cold'),warm:med('warm')});
    }
    return output;
  });
  console.log(JSON.stringify({browser:await browser.version(),results},null,2));
  await writeFile(join(deps, 'results.json'),JSON.stringify({correctness,browser:await browser.version(),results},null,2));
} finally {await browser.close();}
