'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./game-library-core.js');
const root = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'notes/fixture/index', file), 'utf8'));
async function main() {
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
  const context = { fs, path, root, manifest, vm, assert, console, process };
  vm.runInNewContext('// Load the complete application' + harness, context);
}
async function checkUI(missingSearch) {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { hidden: id === 'gameLibrary', disabled: id === 'gameGlobal', value: id === 'gameVolume' ? '0.8' : '', checked: false, scrollTop: 0, clientHeight: 520, style: {}, dataset: {}, innerHTML: '', textContent: '',
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} },
        setAttribute() {}, appendChild() {}, querySelectorAll: () => [] });
    }
    return elements.get(id);
  }
  const requests = [], players = [], auditionLocks = new Map();
  let delayVO = false, releaseVO;
  const context = {
    window: { BF6UI: { audition: (owner, busy) => auditionLocks.set(owner, busy) }, GameLibraryCore: C, SB_CONFIG: { gameLibrary: { baseUrl: 'r2', fixtureBaseUrl: 'notes/fixture', useFixture: false } } },
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => el('searchClass') },
    location: { hostname: 'localhost', search: '?gameFixture=1' }, URLSearchParams, AbortController,
    requestAnimationFrame: fn => fn(), engPause() {}, render() {}, toast() {}, console,
    fetch: async url => {
      requests.push(url);
      const file = url.split('/').pop();
      if (delayVO && file === 'vo.json') await new Promise(resolve => { releaseVO = resolve; });
      const missing = missingSearch && file === 'search.json';
      return { ok: !missing, status: missing ? 404 : 200, json: async () => read(file), text: async () => JSON.stringify(read(file)) };
    },
    WaveSurfer: { create: options => { const player = { options, handlers: {}, plays: 0, setVolume() {}, getMediaElement: () => ({}), on(name, fn) { this.handlers[name] = fn; }, pause() {}, destroy() {}, playPause: async () => {}, async play() { this.plays++; } }; players.push(player); return player; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'game-library.js'), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  el('gameTab').onclick(); await settle();
  assert.equal(el('portalSection').hidden, true);
  assert(requests.every(url => url.startsWith('notes/fixture/')));
  assert.equal(requests.filter(url => /weapons/.test(url)).length, 0, 'No category prefetch');
  assert.equal(el('gameGlobal').disabled, missingSearch);
  if (missingSearch) assert.match(el('gameSearchHelp').textContent, /unavailable/);
  el('gameTree').onclick({ target: { closest: () => ({ dataset: { category: 'weapons' } }) } }); await settle();
  assert.equal(el('gamePage').textContent, 'Page 1 / 2');
  assert.equal(el('gamePrev').disabled, true); assert.equal(el('gameNext').disabled, false);
  const clickPlay = () => el('gameList').onclick({ target: { closest: selector => selector === '[data-group]' ? { dataset: { group: '0' } } : selector === '[data-game-play]' ? {} : null } });
  clickPlay(); clickPlay(); clickPlay();
  assert.equal(auditionLocks.get('game'), true, 'Mute UI cues while loading an audition');
  players.at(-1).handlers.pause(); assert.equal(auditionLocks.get('game'), false);
  players.at(-1).handlers.play(); assert.equal(auditionLocks.get('game'), true);
  players.at(-1).handlers.finish(); assert.equal(auditionLocks.get('game'), false);
  players.at(-1).handlers.play();
  assert.deepEqual(players.map(p => p.options.url.split('/').pop()), ['shot-1.opus', 'shot-2.opus', 'shot-1.opus']);
  el('gameNext').onclick(); await settle();
  assert.equal(el('gamePage').textContent, 'Page 2 / 2'); assert.equal(el('gameNext').disabled, true);
  assert.equal(el('gamePlayer').hidden, true, 'Page change releases player');
  assert.equal(auditionLocks.get('game'), false, 'Page change releases cue mute');
  el('gamePrev').onclick(); await settle();
  assert.equal(requests.filter(url => url.endsWith('/weapons.json')).length, 1, 'UI reuses cached page');
  el('gameSearch').value = 'missing'; el('gameSearch').oninput(); assert.equal(el('gameList').style.height, '0px');
  if (!missingSearch) {
    el('gameGlobal').checked = true; el('gameSearch').value = 'impact'; el('gameGlobal').onchange();
    assert.match(el('gameResults').innerHTML, /Fixture Impact/);
    el('gameResults').onclick({ target: { closest: () => ({ dataset: { result: '0' } }) } }); await settle();
    assert.equal(el('gamePage').textContent, 'Page 2 / 2');
    assert.equal(el('gameSearch').value, 'Fixture Impact');
  }
  delayVO = true;
  el('gameTree').onclick({ target: { closest: () => ({ dataset: { category: 'vo' } }) } });
  el('gameTree').onclick({ target: { closest: () => ({ dataset: { category: 'weapons' } }) } }); await settle();
  releaseVO(); await settle();
  assert.equal(el('gamePage').textContent, 'Page 1 / 2', 'Late category response must not replace the current page');
  el('gameSearch').value = ''; el('gameSearch').oninput();
  clickPlay();
  const pendingPlayer = players.at(-1);
  el('portalTab').onclick(); assert.equal(el('portalSection').hidden, false);
  pendingPlayer.handlers.ready(); await settle();
  assert.equal(pendingPlayer.plays, 0, 'Late ready must not start hidden playback');
  assert.equal(auditionLocks.get('game'), false, 'Section switch releases pending cue mute');
  console.log('Headless Game Library UI: lazy load, paging/cache, variant player, section switch, ' + (missingSearch ? 'missing global index fallback' : 'global result navigation') + ' passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
