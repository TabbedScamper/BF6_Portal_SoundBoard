'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./game-library-core.js');
const root = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'notes/fixture/index', file), 'utf8'));
async function main() {
  await require('./test-sound-features.cjs')();
  const tree = C.tree(read('tree.json'));
  assert.equal(tree.length, 2);
  assert.equal(C.tree([{ ...tree[0], children: [tree[1]] }])[0].children.length, 1);
  assert.throws(() => C.tree([tree[0], tree[0]]));
  assert.throws(() => C.page({ clips: [], page: '0', pages: 2 }));
  const page = C.page(read('weapons.json'));
  assert.equal(C.groups(page.clips).length, 2);
  const takes = C.groups(page.clips)[0].takes;
  let next = 0;
  for (const variant of [1, 2, 1]) { const result = C.cycle(takes, next); assert.equal(result.clip.variant, variant); next = result.next; }
  assert.equal(C.groups(page.clips, 'RIFLE')[0].takes.length, 2);
  assert.equal(C.groups(page.clips, 'weapons/rifle/reload').length, 1);
  assert.equal(C.groups(page.clips, 'missing').length, 0);
  assert.equal(C.groups(read('vo.json').clips, '', 'fr')[0].takes[0].lang, 'fr');
  assert.equal(C.groups(read('vo.json').clips, '', 'de').length, 0);
  const index = C.searchIndex(read('search.json'));
  assert.equal(C.search(index, 'IMPACT')[0].page, 1);
  assert.equal(C.search(index, '').length, 0);
  assert.equal(C.search(Array(150).fill(index[0]), 'fixture').length, 100);
  assert.equal(C.searchIndex({ entries: index }).length, 4);
  assert.throws(() => C.searchIndex({}));
  assert.equal(C.pagePath('weapons', 0), 'index/weapons.json');
  assert.equal(C.pagePath('weapons', 1), 'index/weapons.1.json');
  assert.equal(C.pagePath('vo', 1, 1), 'index/vo.json');
  assert.equal(C.pagePath('vo', 2, 1), 'index/vo.2.json');
  assert.equal(C.relativePath('VO/hello world.opus'), 'VO/hello%20world.opus');
  for (const bad of ['../clip.opus', 'https://host/clip.opus', '/clip.opus', 'a\\b', 'a?x']) assert.throws(() => C.relativePath(bad));
  assert.deepEqual(C.windowRange(10000, 26000, 520), { start: 98, end: 104 });
  assert.deepEqual(C.windowRange(2, 26000, 520), { start: 2, end: 2 });
  let calls = 0;
  const store = new C.PageStore(async url => { calls++; return { ok: true, text: async () => JSON.stringify(read(url.split('/').pop())) }; }, 'fixture', 2);
  await store.load(C.pagePath('weapons', 0)); await store.load(C.pagePath('weapons', 1));
  await store.load(C.pagePath('weapons', 0)); assert.equal(calls, 2);
  assert([...store.cache.values()].every(value => typeof value === 'string'), 'Cache must not retain parsed clip arrays');
  await store.load(C.pagePath('vo', 0)); assert.equal(store.cache.size, 2);
  await store.load(C.pagePath('weapons', 1)); assert.equal(calls, 4);
  await assert.rejects(new C.PageStore(async () => ({ ok: false, status: 404 }), 'x').load('missing'));
  for (const file of ['weapons.json', 'weapons.1.json', 'vo.json']) for (const c of read(file).clips) {
    const buf = fs.readFileSync(path.join(root, 'notes/fixture/audio', c.file));
    assert.equal(buf.length, c.bytes); assert.equal(buf.subarray(0, 4).toString(), 'OggS'); assert(buf.includes(Buffer.from('OpusHead')));
  }
  console.log('Game Library core: parsing, nested tree, paging (zero/one based), cache eviction, name search, language filter, variant cycling, virtualization and Opus fixture passed.');
  await checkUI(false);
  await checkUI(true);
  // Reuse the existing Portal regression harness without requiring an external source export.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const harness = fs.readFileSync(path.join(root, 'check-audio.cjs'), 'utf8').split('// Load the complete application')[1];
  assert(harness, 'Existing Portal harness missing');
  const context = { fs, path, root, manifest, vm, assert, console, process, URL, URLSearchParams };
  vm.runInNewContext('// Load the complete application' + harness, context);
}
async function checkUI(missingSearch) {
  const F=require('./sound-features-core.js'),elements=new Map(),requests=[],plays=[];
  let delayVO=false,releaseVO,selectedFile=null,paused=false,section='portal';
  function el(id) {
    if(!elements.has(id))elements.set(id,{hidden:id==='gameLibrary',disabled:false,value:'',style:{},dataset:{},innerHTML:'',textContent:'',
      classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll:()=>[],
      querySelector:()=>({dataset:{},scrollIntoView(){}}),focus(){}});
    return elements.get(id);
  }
  const player={card:s=>'<article class="card">'+s.name+'</article>',isCurrent:file=>selectedFile===file,canToggle:file=>selectedFile===file,
    attach(){},play(sound,card,another){if(!another&&selectedFile===sound.file){paused=!paused;return;}selectedFile=sound.file;paused=false;plays.push(sound);},
    release(){selectedFile=null;},section(){paused=true;}};
  class Panel {
    constructor(section,host,change){this.state=F.empty();this.change=change;this.vocab={tags:[],synonyms:{}};}
    data(vocab){this.vocab=vocab||this.vocab;}refresh(){}commit(){this.change();}
  }
  const context={window:{GameLibraryCore:C,SoundFeatures:F,SoundFeaturePanel:Panel,LibraryPlayer:player,
      addEventListener(){},SB_CONFIG:{gameLibrary:{baseUrl:'r2',fixtureBaseUrl:'notes/fixture'}}},
    document:{getElementById:el},location:{hostname:'localhost',search:'?gameFixture=1',href:'http://localhost/?gameFixture=1'},
    history:{replaceState(){}},URL,URLSearchParams,AbortController,console,
    fetch:async url=>{requests.push(url);const file=url.split('/').pop();if(delayVO&&file==='vo.json')await new Promise(r=>releaseVO=r);
      const missing=(missingSearch&&file==='search.json')||['tags.json','facets.json'].includes(file);
      return {ok:!missing,status:missing?404:200,json:async()=>read(file),text:async()=>JSON.stringify(read(file))};}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'game-library.js'),'utf8'),context);
  const settle=()=>new Promise(r=>setImmediate(r));
  const category=id=>el('gameTree').onclick({target:{closest:()=>({dataset:{category:id}})}});
  const click=selector=>el('gameList').onclick({target:{closest:s=>s==='[data-group],[data-result]'?{dataset:{group:'0'}}:(s===selector||(selector==='[data-next-variant]'&&s==='[data-play],[data-next-variant]'))?{}:null}});
  el('gameTab').onclick();await settle();
  assert.equal(el('portalSection').hidden,true);assert(requests.every(u=>u.startsWith('notes/fixture/')));
  assert.equal(requests.filter(u=>/weapons/.test(u)).length,0,'No category prefetch');
  assert(el('gameRetry').hidden,'Retry is hidden after successful initialization');
  if(missingSearch)assert.match(el('gameStatus').textContent,/unavailable/);
  category('weapons');await settle();
  assert.equal(el('gamePage').textContent,'Page 1 of 2');assert.equal(el('gamePageBottom').textContent,'Page 1 of 2');
  assert(el('gamePrev').disabled);assert(!el('gameNext').disabled);
  click('[data-play],[data-next-variant]');click('[data-next-variant]');click('[data-next-variant]');
  assert.deepEqual(plays.map(p=>p.file.split('/').pop()),['shot-1.opus','shot-2.opus','shot-1.opus']);
  assert.equal(plays[0].library,'game');assert.equal(plays[0].assetPath,'Weapons/Rifle/Shot');
  click('[data-play],[data-next-variant]');assert(paused,'Play toggles pause without changing variant');
  el('gameNextBottom').onclick();await settle();assert.equal(el('gamePage').textContent,'Page 2 of 2');assert(el('gameNextBottom').disabled);
  assert.equal(selectedFile,null,'Page change releases the shared player');
  el('gamePrev').onclick();await settle();assert.equal(requests.filter(u=>u.endsWith('/weapons.json')).length,1,'UI reuses cached page');
  el('gameSearch').value='missing';el('gameSearch').oninput();assert.equal((missingSearch?el('gameList'):el('gameResults')).innerHTML,'');
  if(!missingSearch) {
    el('gameSearch').value='impact';el('gameSearch').oninput();assert.match(el('gameResults').innerHTML,/Fixture Impact/);
    el('gameResults').onclick({target:{closest:s=>s==='[data-group],[data-result]'?{dataset:{result:'0'}}:s==='[data-play],[data-next-variant]'?{}:null}});await settle();
    assert.equal(el('gamePage').textContent,'Page 2 of 2');assert(plays.at(-1).name.includes('Impact'));
  }
  delayVO=true;category('vo');category('weapons');await settle();releaseVO();await settle();
  assert.equal(el('gamePage').textContent,'Page 1 of 2','Late response must not replace current page');
  click('[data-play],[data-next-variant]');el('portalTab').onclick();assert.equal(el('portalSection').hidden,false);assert(paused,'Section switch pauses shared playback');
  console.log('Game UI: lazy pages, bounded page reuse, automatic index search/fallback, both pagers, variant/pause controls, section switching and stale response cancellation passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
