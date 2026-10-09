'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

function soundHarness(saved, reduced = false, blockedStorage = false) {
  const events = {}, classes = new Set(), voices = [], attributes = {};
  let now = 0, stored = saved, motionChange;
  const toggle = { addEventListener: (name, fn) => events['toggle:' + name] = fn, setAttribute: (name, value) => attributes[name] = value };
  const media = { matches: reduced, addEventListener: (_, fn) => motionChange = fn };
  const window = { matchMedia: () => media };
  const document = { getElementById: () => toggle, documentElement: { classList: { toggle: (name, yes) => yes ? classes.add(name) : classes.delete(name) } }, addEventListener: (name, fn) => events[name] = fn };
  class Audio {
    constructor(url) { this.url = url; this.events = {}; this.currentTime = 1; voices.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const context = { window, document, Audio, performance: { now: () => now }, localStorage: {
    getItem() { if (blockedStorage) throw Error('denied'); return stored; },
    setItem(_, value) { if (blockedStorage) throw Error('denied'); stored = value; }
  } };
  vm.runInNewContext(fs.readFileSync('ui-experience.js', 'utf8'), context);
  const element = selectors => ({ matches: query => selectors.some(s => query.split(', ').includes(s)), closest() { return this; }, contains: () => false });
  function event(name, selectors = ['button'], trusted = true) { now += 150; events[name]({ target: element(selectors), isTrusted: trusted }); }
  return { window, events, voices, attributes, classes, event, toggle, stored: () => stored,
    motion(yes) { media.matches = yes; motionChange(); } };
}

function checkSounds() {
  const h = soundHarness(null);
  assert.equal(h.attributes['aria-pressed'], 'false'); assert.equal(h.voices.length, 0);
  h.event('pointerover'); h.event('click'); assert.equal(h.voices.length, 0, 'Default silence');
  h.events['toggle:click'](); assert.equal(h.stored(), 'on');
  assert.equal(h.voices[0].volume, 0.12); assert.match(h.voices[0].url, /toggle_on/);
  h.event('click', ['#gameTab']); assert.match(h.voices.at(-1).url, /tab_switch/);
  h.window.BF6UI.audition('portal', true);
  assert(h.voices.every(v => v.paused && v.currentTime === 0), 'Audition stops cues already in flight');
  const count = h.voices.length;
  h.event('pointerover'); h.event('click'); h.event('input', ['input[type="range"]']);
  assert.equal(h.voices.length, count, 'No cues over Portal playback/loading');
  h.window.BF6UI.audition('game', true); h.window.BF6UI.audition('portal', false);
  h.event('click'); assert.equal(h.voices.length, count, 'Separate engine locks');
  h.window.BF6UI.audition('game', false); h.event('click'); assert.equal(h.voices.length, count + 1);
  h.event('click', ['.play-btn']); h.event('click', ['#gamePause']);
  h.event('click', ['button'], false); assert.equal(h.voices.length, count + 1, 'No playback or synthetic click cues');
  h.events['toggle:click'](); assert.equal(h.stored(), 'off'); assert.equal(h.attributes['aria-pressed'], 'false');
  const remembered = soundHarness('on', true);
  assert.equal(remembered.voices.length, 0, 'Remembered opt-in never autoplays');
  assert(remembered.classes.has('reduced-motion')); assert(remembered.window.BF6UI.reducedMotion);
  remembered.event('click'); assert.equal(remembered.voices.length, 1, 'Reduced motion allows opted-in sounds');
  remembered.motion(false); assert(!remembered.classes.has('reduced-motion'));
  const denied = soundHarness(null, false, true); denied.events['toggle:click']();
  assert.equal(denied.attributes['aria-pressed'], 'true', 'Storage failure does not disable the control');
  console.log('UI sounds: default off, persisted opt-in, no autoplay, quiet gain, both audition locks, active cue stop, trusted input and dynamic reduced motion passed.');
}

async function checkAssets() {
  const files = new Set(['index.html', 'manifest.json', 'BF6_SFX.json']);
  const sources = ['index.html', 'style.css', 'site-look.css', 'app.js', 'game-library.js', 'ui-experience.js'];
  for (const name of sources) {
    files.add(name);
    const source = fs.readFileSync(name, 'utf8');
    for (const match of source.matchAll(/(?:src|href)="([^"]+)"|url\(['"]?([^)'"\s]+)|['"]((?:assets|fonts)\/[^'"]+\.(?:wav|webp|svg|ttf))['"]/g)) {
      if (match[1] && !name.endsWith('.html')) continue;
      const value = (match[1] || match[2] || match[3]).split('?')[0];
      if (!/^(?:https?:|data:|#|%23)/.test(value) && !value.includes('${')) files.add(value);
    }
  }
  for (const cue of ['hover', 'select', 'back', 'tab_switch', 'toggle_on', 'toggle_off', 'slider_tick']) files.add('assets/ui/' + cue + '.wav');
  for (const clip of JSON.parse(fs.readFileSync('manifest.json', 'utf8'))) files.add(clip.file);
  const fixture = 'notes/fixture';
  function visit(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=dir+'/'+item.name;
      if(item.isDirectory()){visit(file);continue;}
      files.add(file);
      if(file.endsWith('.json')) {
        const data=JSON.parse(fs.readFileSync(file,'utf8'));
        for(const clip of Array.isArray(data.clips)?data.clips:[]) if(clip.file)files.add(fixture+'/audio/'+clip.file);
      }
    }
  }
  visit(fixture+'/index'); visit('notes/feature-fixture');
  for(const file of ['sound-map.mjs','sound-features-core.js','sound-features-ui.js'])files.add(file);
  const root = path.resolve('.');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Length', fs.statSync(file).size);
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const queue = [...files];
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (queue.length) {
        const file = queue.pop();
        const response = await fetch(base + '/' + file.split('/').map(encodeURIComponent).join('/'), { method: 'HEAD' });
        assert.equal(response.status, 200, file); assert(Number(response.headers.get('content-length')) > 0, file);
      }
    }));
    for (const file of files) if (!file.startsWith('sounds/')) {
      const response = await fetch(base + '/' + file.split('/').map(encodeURIComponent).join('/'));
      assert.equal(response.status, 200, file); assert.equal((await response.arrayBuffer()).byteLength, fs.statSync(file).size);
    }
    console.log('Local HTTP: HEAD passed for all ' + files.size + ' referenced assets; GET passed for site, art, cues, fonts and fixtures.');
  } finally { await new Promise(resolve => server.close(resolve)); }
}

checkSounds();
checkAssets().catch(error => { console.error(error); process.exitCode = 1; });
