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
  await page.locator('#gameResults .card').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('#gameResults .feature-readout')].every(el=>el.textContent.includes('Loudness')));
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
  await page.goto(base+'/?gameFixture=1&section=game&sound=Weapons%2FImpact');await page.waitForSelector('#gameList .sound-link-focus');assert.equal(await page.locator('#gameList .card').count(),1);assert.equal(await page.locator('#gamePage').textContent(),'Page 2 of 2');assert.equal(await page.locator('.card.playing').count(),0);
  await page.route('**/notes/fixture/index/search.json',r=>r.fulfill({status:404,body:'Missing search index'}));
  await page.goto(base+'/?gameFixture=1&section=game&sound=Weapons%2FImpact');await page.waitForSelector('#gameList .sound-link-focus');assert.equal(await page.locator('#gamePage').textContent(),'Page 2 of 2','Map assets fallback must locate page');await page.unroute('**/notes/fixture/index/search.json');
  await page.route('**/notes/fixture/index/weapons.json',r=>{const data=JSON.parse(fs.readFileSync('notes/fixture/index/weapons.json'));for(const c of data.clips)delete c.f;return r.fulfill({json:data});});
  const fixtureIndex=page.waitForResponse(r=>r.url().endsWith('/notes/fixture/index/search.json'));
  await page.goto(base+'/?gameFixture=1&section=game');await fixtureIndex;await page.fill('#gameSearch','Fixture Rifle Shot');await page.waitForSelector('#gameResults .card');await page.locator('#gameResults .card').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#gameResults .feature-readout')?.textContent==='Measurements unavailable');assert((await page.locator('#gameResults .card-technical').textContent()).includes('48000Hz'),'Missing f fallback must follow metadata load');
  await checkRealLinks(browser);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
async function checkRealLinks(browser){
 const base='http://localhost:8000/', F=require('./sound-features-core.js');
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
 const portal=manifest.find(c=>!c.vo&&!c.crash&&!c.silent).name;
 const asset='common/sound/diegeticradio/channels/bp/bf03_diegeticradio_channels_bp_8_wave_01';
 async function open(url,selector){requests.length=0;await page.goto(url);await page.waitForSelector(selector);assert.equal(await page.locator('.card.playing').count(),0,'Link must not autoplay');assert(!requests.some(u=>u.includes('/audio/')),'Link fetched audio before play');console.log('Real data URL:',url);}
 try {
  const portalURL=F.soundLink(base,'portal',portal);
  await open(portalURL,'#grid .sound-link-focus');
  assert.equal(await page.locator('#grid .card').count(),1);assert.equal(await page.locator('#grid .card').getAttribute('data-name'),portal);
  assert.equal(await page.inputValue('#search'),'');
  await page.click('#grid [data-sound-link]');await page.waitForFunction(()=>document.getElementById('toast').textContent==='Link copied');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),portalURL);
  for(const id of ['VO_Objective_A', 'VO_MoveOut']) {
   // The manifest determines which non-flag event is available.
   const name=id==='VO_MoveOut'?'VO_'+manifest.find(c=>c.vo&&!c.flag).event:id;
   await open(F.soundLink(base,'portal',name),'#grid .sound-link-focus');assert.equal(await page.locator('#grid .card').count(),1);assert.equal(await page.locator('#grid [data-sound-link]').getAttribute('data-sound-link'),F.soundLink(base,'portal',name));
  }
  const gameURL=F.soundLink(base,'game',asset);
  await open(gameURL,'#gameList .sound-link-focus');assert(await page.locator('#gameLibrary').isVisible());assert.equal(await page.locator('#gameList .card').count(),1);assert.equal(await page.locator('#gameList .card-title').textContent(),'Diegeticradio Channels Bp 8');assert.equal(await page.inputValue('#gameSearch'),'');assert.equal(page.url(),gameURL);assert(!(await page.locator('#gameList .feature-readout').textContent()).includes('unavailable'));
  const box=await page.locator('#gameList .sound-link-focus').boundingBox();assert(box.y>=0&&box.y<1000,'Linked card did not scroll into view');
  await page.click('#gameList [data-sound-link]');await page.waitForFunction(()=>document.getElementById('toast').textContent==='Link copied');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),gameURL);
  assert.equal(await page.locator('#gameList .sound-link-focus').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.setViewportSize({width:390,height:844});assert(await page.locator('#gameList [data-sound-link]').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile overflow');await page.setViewportSize({width:1440,height:1000});
  await open(base+'?section=game&sound=missing-sound','#gameTree .chip');await page.waitForFunction(()=>document.getElementById('gameStatus').textContent==='That sound was not found');assert.equal(await page.locator('#gameList .card').count(),0);
  await open(base+'?sound=missing-sound','#grid .card');await page.waitForFunction(()=>document.getElementById('toast').textContent==='That sound was not found');assert(await page.locator('#grid .card').count()>1);
  const state={...F.empty(),query:portal};const oldURL=base+'?portalFilters='+encodeURIComponent(JSON.stringify(state));
  await open(oldURL,'#grid .card');assert.equal(await page.inputValue('#search'),portal);assert.equal(await page.locator('#grid .sound-link-focus').count(),0);
  const oldGameURL=base+'?section=game&gameFilters='+encodeURIComponent(JSON.stringify({...F.empty(),query:asset,context:{category:'common--sound--diegeticradio--channels--bp',page:0}}));
  await open(oldGameURL,'#gameList .card');assert.equal(await page.locator('#gameList .card').count(),1);assert.equal(await page.inputValue('#gameSearch'),asset);
  await open(gameURL,'#gameList .sound-link-focus');await page.fill('#gameSearch','Diegeticradio Channels Bp 8');assert(!new URL(page.url()).searchParams.has('sound'));assert.equal(await page.locator('.sound-link-focus').count(),0);await page.reload();await page.waitForSelector('#gameResults .card');assert.equal(await page.inputValue('#gameSearch'),'Diegeticradio Channels Bp 8');
  const indexLoaded=page.waitForResponse(r=>r.url().endsWith('/index/search.json'));
  await open(base+'?section=game','#gameTree .chip');await page.waitForFunction(()=>!document.getElementById('gameStatus').textContent.includes('Loading'));
  // Wait for the optional global index, then search the public data and expose results to the lazy loader.
  await indexLoaded;
  await page.fill('#gameSearch','Diegeticradio Channels Bp 8');await page.waitForSelector('#gameResults .card');await page.locator('#gameResults .card').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('#gameResults .feature-readout')].length===3&&[...document.querySelectorAll('#gameResults .feature-readout')].every(el=>el.textContent.includes('Loudness')));
  assert.equal(await page.locator('#gameResults .card').count(),3);assert((await page.locator('#gameResults .feature-readout').first().textContent()).includes('-22.99 LUFS'));assert(await page.locator('#gameResults [data-feature-tag="radio"]').count()>0);
  assert.deepEqual(errors,[]);console.log('Headless Edge real data: exact Portal and VO links, Bp 8 link, copy confirmation, mobile layout, both not-found sections, old filter link and lazy search measurements passed.');
 } finally {await context.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
