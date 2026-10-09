'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const crypto = require('crypto'), vm = require('vm');
const {execFileSync} = require('child_process');
const root = __dirname;
const manifest = require('./manifest.json');
const sourceManifest = fs.statSync(process.argv[2]).isDirectory() ? path.join(process.argv[2], 'manifest.json') : process.argv[2];
const exported = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
const baseline = JSON.parse(execFileSync('git',['show',`${process.argv[3] || 'HEAD'}:manifest.json`],{cwd:root,encoding:'utf8',maxBuffer:10<<20}));
const sourceNames = new Set(exported.clips.map(s=>s.portalName));
const files = new Set();
const zipNames = new Set();
let size = 0;
for (const s of manifest) {
  assert(!files.has(s.file), `Duplicate file ${s.file}`); files.add(s.file);
  const zipName = path.basename(s.file);
  assert(!zipNames.has(zipName), `ZIP filename collision ${zipName}`); zipNames.add(zipName);
  assert.equal(typeof s.loop,'boolean'); assert.equal(typeof s.silent,'boolean');
  assert.equal(typeof s.crash,'boolean'); assert.equal(typeof s.unreliable,'boolean');
  assert(Number.isFinite(s.dur) && s.dur>0);
  const b = fs.readFileSync(path.join(root,s.file)); size += b.length;
  if (s.source !== 'game') continue;
  const clips = exported.clips.filter(c=>c.portalName===s.name);
  const source = clips.find(c=>c.variantIndex===(clips.length>1 ? s.variant-1 : 0));
  assert(source,`Missing source ${s.file}`);
  const id = b.indexOf(Buffer.from([1,...Buffer.from('vorbis')]));
  assert(id>=0,`Vorbis identification ${s.file}`);
  assert.equal(b[id+11],source.channels,`Channels ${s.file}`);
  assert.equal(b.readUInt32LE(id+12),48000,`Sample rate ${s.file}`);
  let offset=0,lastGranule=0n;
  while (offset<b.length) {
    assert.equal(b.toString('ascii',offset,offset+4),'OggS');
    const granule = b.readBigUInt64LE(offset+6);
    if (granule !== 0xffffffffffffffffn) lastGranule=granule;
    const segments=b[offset+26]; let bytes=0;
    for (let i=0;i<segments;i++) bytes+=b[offset+27+i];
    offset+=27+segments+bytes;
  }
  assert(Math.abs(Number(lastGranule)/48000-source.duration)<2/48000,`Authored duration changed: ${s.file}`);
}
const onDisk = fs.readdirSync(path.join(root,'sounds'),{recursive:true}).filter(f=>f.endsWith('.ogg'));
assert.equal(onDisk.length,manifest.length,'Orphan audio files');
const oldTree = execFileSync('git',['ls-tree','-r',process.argv[3] || 'HEAD','--','sounds'],{cwd:root,encoding:'utf8',maxBuffer:10<<20});
const oldHashes = new Map(oldTree.trim().split('\n').map(l=>{const [info,file]=l.split('\t');return [file,info.split(' ')[2]];}));
let unchanged=0,flags=0;
for (const old of baseline) {
  const matches=manifest.filter(s=>s.name===old.name);
  assert(matches.length,`Lost sound ${old.name}`);
  if (old.vo) assert.deepEqual(matches[0],old,`VO manifest metadata changed: ${old.name}`);
  for (const s of matches) for (const k of ['silent','crash','unreliable','cat']) assert.equal(s[k],old[k],`Flag/category ${old.name}:${k}`);
  if (old.crash||old.silent||old.unreliable) flags++;
  if (old.vo || !sourceNames.has(old.name)) {
    const b=fs.readFileSync(path.join(root,old.file));
    const hash=crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
    assert.equal(hash,oldHashes.get(old.file),`Recording changed: ${old.file}`); unchanged++;
  }
}
assert.equal(manifest.filter(s=>s.source==='game').length,exported.clips.length);
console.log(JSON.stringify({sfxSounds:new Set(manifest.filter(s=>!s.vo).map(s=>s.name)).size,gameSounds:sourceNames.size,gameVariants:exported.clips.length,recordedSfx:manifest.filter(s=>s.source==='recorded').length,voFiles:manifest.filter(s=>s.vo).length,files:manifest.length,sizeBytes:size,sizeMB:size/1e6,sizeMiB:size/2**20,unchangedRecordings:unchanged,flaggedClipsPreserved:flags,multiVariantSfx:[...sourceNames].filter(n=>exported.clips.filter(s=>s.portalName===n).length>1).length},null,2));

// Load the complete application with a minimal DOM and audio engine; no browser or analytics requests.
function element() {
  const children=new Map();
  return {dataset:{},style:{},hidden:true,textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){},toggle(){}},
    addEventListener(){},setAttribute(){},appendChild(){},querySelector(s){if(!children.has(s)) children.set(s,element());return children.get(s);},
    querySelectorAll(){return [];},getContext(){return {};},click(){}};
}
const document=element(); document.createElement=element; document.body=element(); document.head=element();
const audioNode=()=>({threshold:{},knee:{},ratio:{},attack:{},release:{},gain:{},connect(){return this;},start(){},stop(){}});
class AudioContext {state='running'; currentTime=0; destination={}; createDynamicsCompressor(){return audioNode();} createGain(){return audioNode();} createBufferSource(){return audioNode();} async decodeAudioData(){return {duration:1};}}
let archived=[];
class JSZip {constructor(){archived=[];} file(name){archived.push(name);} async generateAsync(){return {};}}
const context=vm.createContext({document,window:{AudioContext,BF6UI:{reducedMotion:true,audition(){}}},console,Map,Set,CSS:{escape:s=>s},fetch:async()=>({json:async()=>manifest,arrayBuffer:async()=>new ArrayBuffer(0)}),
  JSZip,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
  WaveSurfer:{create:()=>({setVolume(){},on(){},getDuration(){return 1;},setTime(){}})},
  setTimeout(){},clearTimeout(){},addEventListener(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},IntersectionObserver:class {observe(){} disconnect(){}},navigator:{clipboard:{writeText:async()=>{}}}});
async function checkApp() {
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/init\(\);\s*$/,'globalThis.ready = init();');
  vm.runInContext(app,context); await context.ready;
  vm.runInContext(`
    const reducedCount = { dataset: { count: '123' }, textContent: '' };
    animateCounts({ querySelectorAll: () => [reducedCount] });
    if (reducedCount.textContent !== '123') throw new Error('Reduced motion count must resolve immediately');
    if (SOUNDS.length !== ${manifest.length}) throw new Error('Manifest did not load');
    if (CARDS.filter(c=>!c.vo).length !== 937) throw new Error('SFX grouping count');
    globalThis.multi = CARDS.find(c=>!c.vo && c.takes.length>1);
    globalThis.testCard = document.createElement('article');
    testCard.dataset={name:multi.name,file:multi.file};
    playFromCard(testCard);
    if (active.sound.file!==multi.takes[0].file) throw new Error('First variant');
    playFromCard(testCard);
    if (active.sound.file!==multi.takes[1].file) throw new Error('Next variant');
    if (testCard.querySelector('[data-sfx-dl]').href!==active.sound.file) throw new Error('Card download');
    if (document.querySelector('#dockDl').href!==active.sound.file) throw new Error('Dock download');
    for (let i=2;i<=multi.takes.length;i++) playFromCard(testCard);
    if (active.sound.file!==multi.takes[0].file) throw new Error('Cycle wrap');
    render();
    if (multi.file!==active.sound.file) throw new Error('Selection lost during render');
    if (!cardHTML(multi,0).includes(multi.takes.length+' variants')) throw new Error('Variant badge');
    const single=CARDS.find(c=>!c.vo && c.takes.length===1 && c.source==='game');
    if (cardHTML(single,0).includes(' variants')) throw new Error('Single variant appearance');
    const recorded=CARDS.find(c=>c.source==='recorded');
    if (!cardHTML(recorded,0).includes('>recorded<')) throw new Error('Recorded marker');
    buildAbout();
    globalThis.zipCheck=zipDownload(SOUNDS,'test-all.zip');
  `,context);
  await context.zipCheck;
  assert.equal(archived.length,manifest.length,'All ZIP omitted variants');
  assert.equal(new Set(archived).size,manifest.length,'All ZIP overwrote variants');
  vm.runInContext("globalThis.categoryCheck=zipDownload(SOUNDS.filter(s=>s.cat==='Crash Sounds'),'test-category.zip')",context);
  await context.categoryCheck;
  assert.equal(archived.length,manifest.filter(s=>s.cat==='Crash Sounds').length,'Category ZIP omitted variants');
  vm.runInContext(`globalThis.playbackCheck = (async () => {
    engPause();
    let mute = false, release;
    window.BF6UI.audition = (owner, busy) => { if (owner === 'portal') mute = busy; };
    const originalBuffer = getBuffer;
    getBuffer = () => new Promise(resolve => { release = resolve; });
    active = { sound: multi.takes[0], spatial: false, playing: false };
    const pending = engPlay(0);
    if (!mute) throw new Error('Portal load must mute UI cues');
    engPause(); release({ duration: 1 }); await pending;
    if (active.src || mute) throw new Error('Cancelled decode started audio or retained cue mute');
    getBuffer = async () => ({ duration: 1 });
    await engPlay(0);
    if (!mute) throw new Error('Portal playback must mute UI cues');
    active.src.onended();
    if (mute) throw new Error('Portal end must release cue mute');
    await engPlay(0); engPause();
    if (mute) throw new Error('Portal pause must release cue mute');
    getBuffer = originalBuffer;
  })()`, context);
  await context.playbackCheck;
  console.log('Headless app: manifest load, SFX grouping, variant cycling/wrap, card/dock/all/category downloads, render persistence, markers and coverage passed.');
}
checkApp().catch(e=>{console.error(e);process.exitCode=1;});
