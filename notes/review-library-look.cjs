'use strict';
// Run against the worktree preview at localhost:8000. Uses the local headless Edge tools.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./browser-tools/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'feature-review');
const base='http://localhost:8000';
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 const notes=[],errors=[];
 try{
  for(const fixture of [false,true]){
   const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>localStorage.setItem('bf6sb.radarClosed','1'));
   await page.goto(base+(fixture?'/?soundFixture=1&gameFixture=1':'/'));
   await page.waitForSelector('#grid .sound-details');await page.waitForFunction(()=>document.querySelector('#loader').classList.contains('hide'));
   if(fixture)await page.fill('#search','electronic');else await page.click('#chips [data-cat="UI"]');
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1100});await page.locator('.library-switch').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-document.querySelector('#header').getBoundingClientRect().height-16));
    await page.screenshot({path:path.join(out,(fixture?'fixture':'real')+'-portal-'+width+'.png')});
    const portal=await metrics(page,'#grid');
    await page.locator('#grid').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-document.querySelector('#header').getBoundingClientRect().height-16));
    await page.mouse.move(0,0);await page.screenshot({path:path.join(out,(fixture?'fixture':'real')+'-portal-cards-'+width+'.png')});
    await page.click('#gameTab');await page.waitForSelector('#gameTree [data-category]');
    if(fixture){await page.click('#gameTree [data-category="weapons"]');}
    else {
     await page.click('#gameTree [data-category="common"]');
     for(const id of ['common--sound','common--sound--weapons','common--sound--weapons--handheld','common--sound--weapons--handheld--mp7'])await page.click('#gameChildren [data-category="'+id+'"]');
    }
    await page.waitForSelector('#gameList .sound-details');
    await page.locator('.library-switch').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-document.querySelector('#header').getBoundingClientRect().height-16));
    await page.screenshot({path:path.join(out,(fixture?'fixture':'real')+'-game-'+width+'.png')});
    const game=await metrics(page,'#gameList');
    await page.locator('#gameList').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-document.querySelector('#header').getBoundingClientRect().height-16));
    await page.mouse.move(0,0);await page.screenshot({path:path.join(out,(fixture?'fixture':'real')+'-game-cards-'+width+'.png')});
    assert.equal(game.columns,portal.columns);assert.equal(game.columns,width===1440?3:1);
    for(const key of ['cardWidth','titleFont','titleSize','waveHeight','playWidth','playRadius','gridGap','tagSize'])assert.equal(game[key],portal[key],key);
    assert(!await page.locator('#gameRetry').isVisible());assert.equal(await page.locator('#gameGlobal').count(),0);
    assert.equal(await page.locator('#gameLibrary .game-category-hero').count(),0);
    assert.equal(await page.locator('#gamePrev').isDisabled(),await page.locator('#gamePrevBottom').isDisabled());
    assert.equal(await page.locator('#gamePage').textContent(),await page.locator('#gamePageBottom').textContent());
    assert.equal(await page.locator('#gameList .card').first().evaluate(el=>getComputedStyle(el).contentVisibility),'auto');
    notes.push({fixture,width,portal,game,status:await page.locator('#gameStatus').textContent()});
    await page.click('#portalTab');
   }
   if(!fixture){
    // Play a real R2 clip through the shared dock, including a real waveform decode.
    await page.setViewportSize({width:1440,height:1100});await page.click('#gameTab');
    await page.locator('#gameList [data-play]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#gameList [data-play]').first().click();
    await page.waitForFunction(()=>active?.sound.library==='game'&&active.dur>0&&!active.loading);
    await page.click('#dockSpatial');assert(await page.locator('#spatial').isVisible());
    await page.screenshot({path:path.join(out,'real-game-player-radar.png')});await page.click('#spClose');
    notes.push({realPlayback:await page.locator('#dockTitle').textContent(),radarMode:await page.locator('#spMode').textContent()});
   }
   await page.close();
  }
  await fixtureRegression(browser,notes,errors);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(notes,null,2));
  console.log('Headless Edge: real R2 and fixture screenshots at 1440 and 390, shared component metrics, playback/RADAR, copy/download, URL state, deep chips/own folder, error-only Retry and 600-card scrolling passed.');
 }finally{await browser.close();}
}
async function metrics(page,grid){return page.locator(grid).evaluate(el=>{
 const card=el.querySelector('.card'),style=getComputedStyle(el),get=s=>getComputedStyle(card.querySelector(s)),rect=s=>card.querySelector(s).getBoundingClientRect();
 return {columns:style.gridTemplateColumns.split(' ').length,cardWidth:Math.round(card.getBoundingClientRect().width),gridGap:style.gap,titleFont:get('.card-title').fontFamily,titleSize:get('.card-title').fontSize,waveHeight:rect('.card-wave').height,playWidth:rect('.play-btn').width,playRadius:get('.play-btn').borderRadius,tagSize:get('.tag').fontSize};
});}
async function fixtureRegression(browser,notes,errors){
 const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('bf6sb.radarClosed','1'));
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'notes/fixture/index/weapons.json')));
 const longClip=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).find(c=>c.dur>8&&c.dur<20&&!c.vo);
 await page.route('**/notes/fixture/audio/shot-*.opus',r=>r.fulfill({body:fs.readFileSync(path.join(root,longClip.file)),contentType:'audio/ogg'}));
 await page.goto(base+'/?soundFixture=1&gameFixture=1');await page.waitForSelector('#grid .card');
 await page.click('#gameTab');await page.waitForSelector('#gameTree .chip');await page.click('#gameTree [data-category="weapons"]');await page.waitForSelector('#gameList .card');
 await page.locator('#gameList [data-play]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#gameList [data-play]').first().click();
 await page.waitForFunction(()=>active?.playing);const file=await page.evaluate(()=>active.sound.file);
 await page.locator('#gameList [data-play]').first().click();assert(await page.evaluate(()=>!active.playing));assert.equal(await page.evaluate(()=>active.sound.file),file);
 await page.locator('#gameList [data-play]').first().click();await page.waitForFunction(()=>active.playing);assert.equal(await page.evaluate(()=>active.sound.file),file);
 await page.locator('#gameList [data-next-variant]').click();await page.waitForFunction(()=>active?.playing&&active.sound.file.endsWith('shot-2.opus'));
 await page.waitForFunction(()=>active.ws?.getDuration()>1);
 await page.locator('#gameList .card-wave').first().click({position:{x:200,y:32}});
 await page.waitForFunction(()=>active.offset>2);assert((await page.evaluate(()=>active.sound.file)).endsWith('shot-2.opus'),'Waveform seek keeps selected variant');
 await page.locator('#gameList [data-play]').nth(1).click();
 await page.locator('#gameList .card-wave').first().click({position:{x:200,y:32}});
 await page.waitForFunction(()=>active?.sound.file.endsWith('shot-1.opus')&&active.playing);
 await page.locator('#gameList [data-next-variant]').click();await page.waitForFunction(()=>active?.sound.file.endsWith('shot-2.opus')&&active.playing);
 await page.click('#dockLoop');assert.equal(await page.locator('#dockLoop').getAttribute('aria-pressed'),'true');
 await page.click('#dockSpatial');assert(await page.locator('#spatial').isVisible());
 await page.locator('#radar').click({position:{x:180,y:150}});await page.waitForFunction(()=>active?.spatial&&active.panner);
 assert(await page.evaluate(()=>active.sound.library==='game'),'Radar drag uses the selected game sound');await page.click('#spClose');
 await page.locator('#gameList [data-copy]').first().click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Weapons/Rifle/Shot');
 for(const selector of ['#gameList [data-sfx-dl] >> nth=0','#gameDownload','#dockDl']){
  const wait=page.waitForEvent('download');await page.click(selector);assert.equal((await wait).suggestedFilename(),'Fixture Rifle Shot_v2.opus');
 }
 await page.click('#portalTab');assert(await page.evaluate(()=>!active||!active.playing));assert.equal(await page.locator('#dock').getAttribute('aria-hidden'),'true');
 await page.click('#gameTab');assert.equal(await page.locator('#dockTitle').textContent(),'Fixture Rifle Shot');assert(await page.evaluate(()=>!active.playing));
 await page.click('#gameNext');await page.waitForFunction(()=>document.querySelector('#gamePage').textContent==='Page 2 of 2');assert.equal(await page.locator('#dock').getAttribute('aria-hidden'),'true');
 await page.click('#gameFeatures [data-clear]');await page.fill('#gameSearch','impact');
 await page.locator('#gameResults').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-document.querySelector('#header').getBoundingClientRect().height-16));
 await page.waitForFunction(()=>document.querySelectorAll('#gameResults .tag-dur').length===2);
 assert(await page.locator('#gameResults').textContent().then(t=>t.includes('48000Hz')),'Search results acquire full clip metadata');
 await page.mouse.move(0,0);await page.evaluate(()=>document.querySelector('#toast').classList.remove('show'));
 await page.screenshot({path:path.join(out,'fixture-game-search-1440.png')});
 await page.locator('#gameResults [data-result]').filter({hasText:'Fixture Impact'}).locator('[data-play]').click();await page.waitForSelector('#gameList .card');
 const url=page.url();await page.reload();await page.waitForSelector('#gameList .card');assert.equal(page.url(),url);assert(await page.locator('#gameList').textContent().then(t=>t.includes('Fixture Impact')));
 await page.click('#gameFeatures [data-clear]');await page.click('#gameTree [data-category="vo"]');await page.waitForSelector('#gameLanguage [data-language="fr"]');await page.click('#gameLanguage [data-language="fr"]');
 await page.fill('#gameSearch','speech');await page.locator('#gameResults').evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForSelector('#gameResults .tag-vo');
 assert.equal(await page.locator('#gameResults .tag-vo').textContent(),'fr','Global name/tag search respects the selected language');await page.fill('#gameSearch','');
 assert.equal(await page.locator('#gameList .tag-vo').textContent(),'fr');assert.equal(await page.locator('#gameList [data-next-variant]').count(),0);
 await page.click('#portalTab');await page.click('#portalFeatures [data-clear]');await page.click('#gameTab');
 assert.equal(await page.locator('#gameLanguage [data-language="fr"]').getAttribute('aria-pressed'),'true');assert(await page.locator('#gameLanguage [data-language="fr"]').evaluate(el=>el.classList.contains('active')),'Portal type controls must not change Game language chips');
 await page.click('#gameLanguage [data-language="sfx"]');assert.equal(await page.locator('#gameList .card').count(),0);
 // Category branches, direct parent clips, and a large page without eager audio requests.
 const tree=JSON.parse(fs.readFileSync(path.join(root,'notes/fixture/index/tree.json')));tree[0].own=3;tree[0].children=[{id:'child',name:'Handheld',path:'Weapons/Handheld',own:600,count:600,children:[]}];
 const stress={category:'child',page:0,pages:1,clips:Array.from({length:600},(_,i)=>({...fixture.clips[0],name:'Stress '+i,assetPath:'Stress/'+i}))};
 await page.route('**/notes/fixture/index/tree.json',r=>r.fulfill({json:tree}));await page.route('**/notes/fixture/index/child.json',r=>r.fulfill({json:stress}));
 const requests=[];page.on('request',r=>requests.push(r.url()));await page.goto(base+'/?soundFixture=1&gameFixture=1&section=game');await page.waitForSelector('#gameTree [data-category="weapons"]');
 await page.click('#gameTree [data-category="weapons"]');assert.equal(await page.locator('#gameList .card').count(),0);assert(await page.locator('#gameChildren [data-own="weapons"]').isVisible());
 await page.click('#gameChildren [data-own="weapons"]');await page.waitForSelector('#gameList .card');assert.equal(await page.locator('#gameList .card').count(),2);
 await page.click('#gameChildren [data-category="child"]');await page.waitForFunction(()=>document.querySelectorAll('#gameList .card').length===600);
 assert.equal(requests.filter(u=>u.includes('/notes/fixture/audio/')).length,0,'Browsing never prefetches game audio');
 const ms=await page.locator('#gameList .card').last().evaluate(async el=>{const start=performance.now();el.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;});
 assert(ms<500,'600-card scroll exceeded 500 ms');assert(await page.locator('#gameList .card').last().isVisible());
 assert.equal(await page.locator('#gameBreadcrumb').textContent(),'Game Library/Weapons/Handheld');notes.push({stressCards:600,scrollMs:Math.round(ms)});
 await page.route('**/notes/fixture/index/child.json',r=>r.fulfill({status:503,body:'Fixture load error'}));await page.reload();await page.waitForSelector('#gameRetry');assert(await page.locator('#gameStatus').textContent().then(t=>t.includes('503')));
 await page.unroute('**/notes/fixture/index/child.json');await page.route('**/notes/fixture/index/child.json',r=>r.fulfill({json:stress}));await page.click('#gameRetry');await page.waitForSelector('#gameList .card');assert(!await page.locator('#gameRetry').isVisible());
 // A late decode must never restart playback after switching sections.
 let release;const gate=new Promise(r=>release=r);
 await page.route('**/notes/fixture/audio/shot-1.opus',async r=>{await gate;await r.fulfill({body:fs.readFileSync(path.join(root,longClip.file)),contentType:'audio/ogg'});});
 await page.locator('#gameList [data-play]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#gameList [data-play]').first().click();
 await page.waitForFunction(()=>active?.loading);await page.click('#portalTab');release();await page.waitForFunction(()=>bufCache.has('notes/fixture/audio/shot-1.opus'));
 assert(await page.evaluate(()=>!active||!active.playing),'Late audio must not play in the hidden section');
 await page.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
