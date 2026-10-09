'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright'));}catch(_){({chromium}=require('./notes/browser-tools/node_modules/playwright'));}
const root=__dirname;
async function main(){
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const target=fs.existsSync(file)&&fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;if(!fs.existsSync(target)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.ogg':'audio/ogg'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],requests=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('request',r=>requests.push(r.url()));
  await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(()=>{window.WaveSurfer={create:()=>({on(){},setVolume(){},getDuration(){return 1;},setTime(){},getMediaElement(){return {};},destroy(){},pause(){},play:async()=>{},playPause:async()=>{}})};});
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/?soundFixture=1&gameFixture=1');await page.waitForSelector('#grid .sound-details');
  assert(!requests.some(u=>u.includes('map.json')||u.includes('map.bin')||u.includes('sound-map.mjs')),'Map eagerly loaded');
  await page.fill('#search','electronic');assert(await page.locator('#grid .card').count()>0);assert(await page.locator('#grid .sound-details').first().textContent().then(s=>s.includes('A4')));
  await page.click('#portalFeatures summary');await page.check('#portalFeatures [data-pitched]');await page.locator('#portalFeatures [data-range="attack"][data-end="1"]').evaluate(el=>{el.value='20';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert(await page.locator('#grid .card').count()>0);const share=page.url();assert(share.includes('portalFilters'));
  await page.click('#grid [data-similar] >> nth=0');await page.waitForSelector('#portalFeatures [data-neighbour]');assert(!requests.some(u=>u.includes('/index/similar/')));
  await page.click('#portalFeatures [data-map]');await page.waitForSelector('#portalFeatures canvas');assert(requests.some(u=>u.includes('sound-map.mjs')));assert(!requests.some(u=>u.includes('/index/map.bin')));
  await page.click('#portalFeatures [data-clear]');await page.click('#portalFeatures [data-feature-tag="metal"]');assert(await page.locator('#grid .card').count()>0);
  await page.reload();await page.waitForSelector('#grid .sound-details');assert(await page.locator('#portalFeatures .feature-active').textContent().then(s=>s.includes('metal')));
  await page.click('#gameTab');await page.waitForSelector('#gameTree [data-category="weapons"]');await page.click('#gameTree [data-category="weapons"]');await page.waitForSelector('#gameList .sound-details').catch(async e=>{console.error(await page.locator('#gameStatus').textContent());console.error(await page.locator('#gameList').innerHTML());throw e;});
  await page.fill('#gameSearch','clank');assert.equal(await page.locator('#gameResults .card').count(),3);await page.click('#gameResults [data-feature-tag="mechanical"]');assert.equal(await page.locator('#gameResults .card').count(),1);assert(await page.locator('#gameResults').textContent().then(s=>s.includes('Fixture Reload')));
  console.log('Browser: Portal filters, share reload and lazy map passed.');
  await page.click('#gameFeatures [data-clear]');await page.fill('#gameSearch','metallic');assert.equal(await page.locator('#gameResults [data-result]').count(),3);
  await page.locator('#gameResults [data-result] [data-play]').last().click();await page.waitForFunction(()=>document.getElementById('gamePage').textContent==='Page 2 of 2');
  assert(await page.locator('#spatial').isVisible(),'Game clip opens the shared RADAR');await page.click('#spClose');await page.locator('#gameList [data-similar]').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.click('#gameList [data-similar]');await page.waitForSelector('#gameFeatures [data-neighbour]');assert.equal(await page.locator('#gameFeatures [data-neighbour]').count(),3);
  await page.locator('#gameFeatures [data-neighbour]').first().click();await page.waitForFunction(()=>document.getElementById('gamePage').textContent==='Page 1 of 2');assert(await page.locator('#dockTitle').textContent().then(s=>s.includes('Rifle')));
  console.log('Browser: Game filters, global search and similar playback passed.');
  await page.click('#gameFeatures [data-map]');await page.waitForSelector('#gameFeatures canvas');assert(requests.some(u=>u.includes('/index/map.bin')));
  const canvas=page.locator('#gameFeatures canvas');await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();await page.mouse.move(r.x+1,r.y+1);await page.mouse.down();await page.mouse.move(r.x+r.width-1,r.y+r.height-1);await page.mouse.up();assert(await page.locator('#gameFeatures .map-selection').textContent().then(s=>s.includes('4 selected')));
  assert(await page.locator('#portalFeatures .feature-active').textContent().then(s=>s.includes('metal')),'Game cleared Portal state');
  fs.mkdirSync('notes/feature-review',{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'notes/feature-review/game-desktop.png',fullPage:true});await page.click('#portalTab');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'notes/feature-review/portal-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'notes/feature-review/portal-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  const count=16000,packed=Buffer.alloc(count*8);for(let i=0;i<count;i++){packed.writeUInt16LE(Math.round((i%160)/159*65535),i*8);packed.writeUInt16LE(Math.round(Math.floor(i/160)/99*65535),i*8+2);packed.writeUInt16LE(i%4,i*8+4);}
  await page.route('**/stress/index/map.json',r=>r.fulfill({json:{count,categories:['a','b','c','d'],assets:Array.from({length:count},(_,i)=>'stress/'+i)}}));
  await page.route('**/stress/index/map.bin',r=>r.fulfill({body:packed,contentType:'application/octet-stream'}));
  const stressResult=await page.evaluate(async()=>{const M=await import('./sound-map.mjs'),host=document.createElement('section');document.body.appendChild(host);host.style.width='1000px';let checked=0,start=0;const map=await M.open(host,{section:'game',base:'/stress/',prepare:()=>{checked=0;start=performance.now();},matches:()=>{checked++;return checked%2===0;},open:()=>{}});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const result={points:map.points.length,checked,frameMs:Math.round(performance.now()-start)};host.remove();return result;});
  assert.equal(stressResult.points,16000);assert.equal(stressResult.checked,16000);console.log('Browser map stress:',stressResult);
  // Missing optional production files must leave the library usable.
  for(const file of ['portal-features.json','tags.json','portal-map.json'])await page.route(base+'/'+file,r=>r.fulfill({status:404,body:'Missing optional fixture'}));
  await page.goto(base+'/');await page.waitForSelector('#grid .sound-details');assert(await page.locator('#grid .sound-details').first().textContent().then(s=>s.includes('unavailable')));await page.click('#portalFeatures [data-map]');await page.waitForFunction(()=>document.querySelector('#portalFeatures .sound-map').textContent.includes('unavailable'));assert.deepEqual(errors,[]);
  console.log('Headless Edge: fixture filters, synonyms, share reload, section isolation, similar navigation/playback, lazy maps, box selection, mobile render and missing-file fallback passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
