/* BF6 Portal SFX Library — soundboard logic
   - lazy SoundCloud-style waveforms (wavesurfer.js), one player active at a time
   - Spotify-style now-playing dock, seamless loop for loop assets
   - search + category filter, click-to-copy asset names, single/zip downloads (JSZip) */
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let SOUNDS = [];
let curCat = 'All';
let curType = 'all';
let curTerm = '';
let active = null;          // { ws, card, sound }
let loopOn = false;
let volume = 0.8;
const wsByFile = new Map(); // file -> wavesurfer (lazy)
// spatial / PlaySound-options state (mirrors the in-game API: amplitude, location, attenuationRange, scope)
let ampParam = 1.0;         // the in-game `amplitude` arg (preview gain multiplier)
let attenRange = 40;        // the in-game `attenuationRange` (radar ring, metres)
let spScope = '';           // '', 'player', 'squad', 'team'
let spSound = null;         // sound shown in the spatial panel
let spPx = 0, spPy = -60;   // sound position on the radar, pixels from centre (top = forward)
let spWorld = { x: 0, z: -10, dist: 10, ang: 0 }; // derived world offset for the panner
// the authoritative SFX set for the current Portal SDK (RuntimeSpawn_Common enum, verified from index.d.ts)
const SDK_VERSION = '1.3.2.0';
const SDK_CATS = { UI: 331, Soldier: 200, Levels: 138, Gadgets: 103, Destruction: 68, GameModes: 61, Projectiles: 31, Gamemodes: 4, VOModule: 1, Alarm: 1 };
const SDK_TOTAL = Object.values(SDK_CATS).reduce((a, b) => a + b, 0); // 938

/* ---------- helpers ---------- */
const is3D = (name) => /3D$/i.test(name);
function pretty(name) {
  let s = name.replace(/^SFX_/, '');
  s = s.replace(/_(OneShot|SimpleLoop|Loop|Simple)?_?(2D|3D)$/i, '');
  s = s.replace(/_(OneShot|SimpleLoop|Loop)$/i, '');
  s = s.replace(/^(Projectiles|UI|Soldier|Levels|Gadgets|Destruction|GameModes|Gamemodes|VOModule|Alarm)_/i, '');
  s = s.replace(/_(Flybys|FlyBys|Flyby|FlyBy)_/gi, ' ');
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s || name;
}
// format a time; for sub-second clips (dur < 1) show decimals like "0.50s" instead of "0:00".
// `dur` is the clip length that decides the style (defaults to the value itself).
function fmt(t, dur) {
  if (!isFinite(t) || t < 0) t = 0;
  if ((dur === undefined ? t : dur) < 1) return t.toFixed(2) + 's';
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- load ---------- */
async function init() {
  try {
    SOUNDS = await (await fetch('manifest.json', { cache: 'no-cache' })).json();
  } catch (e) {
    $('#grid').innerHTML = '<div class="empty">Could not load manifest.json. Serve this folder over http (GitHub Pages or a local server), not file://.</div>';
    hideLoader(); return;
  }
  buildStats();
  buildChips();
  buildTypeFilter();
  render();
  initAnalytics();
  hideLoader();
}
function hideLoader() { setTimeout(() => $('#loader').classList.add('hide'), 350); }

function buildStats() {
  const cats = new Set(SOUNDS.map(s => s.cat));
  const loops = SOUNDS.filter(s => s.loop).length;
  const n3 = SOUNDS.filter(s => is3D(s.name)).length;
  const n2 = SOUNDS.length - n3;
  const stat = (n, l) => `<div class="stat"><b data-count="${n}">0</b><span>${l}</span></div>`;
  $('#headerStats').innerHTML =
    stat(SOUNDS.length, 'sounds') + stat(cats.size, 'categories') +
    stat(n2, '2D') + stat(n3, '3D') + stat(loops, 'loops');
  animateCounts($('#headerStats'));
}
// eased count-up for any [data-count] numbers (SEC-style)
function animateCounts(root) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const target = +el.dataset.count, dur = 1100;
    const ease = t => 1 - Math.pow(1 - t, 3);
    let t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(target * ease(p)).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function catList() {
  const m = new Map();
  SOUNDS.forEach(s => m.set(s.cat, (m.get(s.cat) || 0) + 1));
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
function buildChips() {
  const chips = $('#chips');
  const all = `<button class="chip active" data-cat="All">All <span class="cnt">${SOUNDS.length}</span></button>`;
  const rest = catList().map(([c, n]) => `<button class="chip" data-cat="${c}">${c} <span class="cnt">${n}</span></button>`).join('');
  chips.innerHTML = all + rest;
  $$('.chip', chips).forEach(ch => ch.addEventListener('click', () => {
    curCat = ch.dataset.cat;
    $$('.chip', chips).forEach(c => c.classList.toggle('active', c === ch));
    render();
  }));
}
function buildTypeFilter() {
  const n3 = SOUNDS.filter(s => is3D(s.name)).length;
  const n2 = SOUNDS.length - n3;
  const nl = SOUNDS.filter(s => s.loop).length;
  const counts = { all: SOUNDS.length, '3d': n3, '2d': n2, loop: nl };
  $$('.tpill').forEach(b => {
    const t = b.dataset.type;
    b.innerHTML = b.textContent.trim().split(' ')[0] + ' <span class="cnt">' + (counts[t] ?? 0) + '</span>';
    b.addEventListener('click', () => {
      curType = t;
      $$('.tpill').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
  });
}

/* ---------- render grid ---------- */
// sort rank: working sounds first, then silent ("didn't play"), then game-crashers last.
function sortRank(s) { return s.crash ? 2 : (s.silent ? 1 : 0); }
function filtered() {
  return SOUNDS.filter(s => {
    if (curCat !== 'All' && s.cat !== curCat) return false;
    if (curType === '3d' && !is3D(s.name)) return false;
    if (curType === '2d' && is3D(s.name)) return false;
    if (curType === 'loop' && !s.loop) return false;
    if (curTerm && !(s.name.toLowerCase().includes(curTerm) || pretty(s.name).toLowerCase().includes(curTerm))) return false;
    return true;
  }).sort((a, b) => sortRank(a) - sortRank(b)); // Array.sort is stable -> keeps category/name order within each rank
}
function render() {
  const grid = $('#grid');
  const list = filtered();
  $('#empty').hidden = list.length > 0;
  $('#emptyTerm').textContent = curTerm;
  grid.innerHTML = list.map((s, i) => cardHTML(s, i)).join('');
  $$('.card', grid).forEach(card => wireCard(card));
  observeWaves();
  // re-link the currently playing sound to its fresh card (if still visible)
  if (active) {
    const c = cardFor(active.sound.file);
    if (c) { ensureWave(c); active.card = c; active.ws = wsByFile.get(active.sound.file); setPlayingUI(c, active.playing); }
  }
}
function cardHTML(s, i) {
  const title = pretty(s.name);
  const dimTag = is3D(s.name) ? '<span class="tag tag-3d">3D</span>' : '<span class="tag tag-2d">2D</span>';
  const loopTag = s.loop ? '<span class="tag tag-loop">Loop</span>' : '';
  const crashTag = s.crash ? '<span class="tag tag-crash" title="Crashes the game when played in Portal — audio here is whatever was captured right before the crash">crash</span>' : '';
  // "warn" = anything that doesn't reliably work in-game: no audio (silent) OR fires randomly (unreliable VO).
  const warn = !s.crash && (s.silent || s.unreliable);
  const warnLabel = s.silent ? 'DID NOT PLAY IN-GAME' : 'UNRELIABLE &middot; MAY NOT PLAY';
  const warnTitle = s.silent ? 'No audio when played in-game (silent / conditional asset)'
    : 'Announcer voice-over: fires randomly / often silent on the live build (engine bug) — may not play in your mod';
  const warnTag = warn ? `<span class="tag tag-unreliable" title="${warnTitle}">${s.silent ? 'no audio' : 'unreliable'}</span>` : '';
  const cls = s.crash ? ' card--crash' : (warn ? ' card--warn' : '');
  const banner = s.crash ? '<div class="caution caution--crash"><span>&#9888; CRASHES THE GAME</span></div>'
    : (warn ? `<div class="caution caution--warn"><span>&#9888; ${warnLabel}</span></div>` : '');
  return `
  <article class="card${cls}" data-file="${s.file}" data-name="${s.name}" data-cat="${s.cat}" data-loop="${s.loop}" style="animation-delay:${Math.min(i * 18, 360)}ms">
    ${banner}
    <div class="card-head">
      <div class="card-title">${title}</div>
      <div class="card-tags">${dimTag}${loopTag}${crashTag}${warnTag}<span class="tag tag-dur">${fmt(s.dur, s.dur)}</span></div>
    </div>
    <div class="card-wave" data-wave>
      <div class="ph"><i style="height:10px"></i><i style="height:24px"></i><i style="height:16px"></i><i style="height:32px"></i><i style="height:12px"></i><i style="height:26px"></i><i style="height:18px"></i></div>
    </div>
    <div class="card-foot">
      <button class="play-btn" data-play aria-label="Play">
        <svg class="ico-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        <svg class="ico-pause" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>
      </button>
      <div class="asset">
        <code data-copy title="Click to copy asset name">${s.name}</code>
        <span class="hint">click name to copy</span>
      </div>
      <a class="icon-btn" href="${s.file}" download="${s.name}.ogg" title="Download .ogg" aria-label="Download">
        <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
    </div>
  </article>`;
}

/* ---------- waveform (lazy, persistent host-div pool so re-renders don't destroy players) ---------- */
let io;
const hostByFile = new Map();  // file -> our container <div> (holds the wavesurfer); survives grid rebuilds
function observeWaves() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting) { ensureWave(en.target.closest('.card')); io.unobserve(en.target); } });
  }, { rootMargin: '200px' });
  $$('.card-wave', $('#grid')).forEach(w => io.observe(w));
}
function ensureWave(card) {
  const file = card.dataset.file;
  const cont = $('.card-wave', card);
  let host = hostByFile.get(file);
  if (host) { if (host.parentElement !== cont) { cont.innerHTML = ''; cont.appendChild(host); } return wsByFile.get(file); }
  cont.innerHTML = '';
  host = document.createElement('div'); host.style.width = '100%';
  cont.appendChild(host);
  const ws = WaveSurfer.create({
    container: host, url: file, height: 64,
    waveColor: 'rgba(255,255,255,.18)', progressColor: '#ff6b1a',
    barWidth: 2, barGap: 1, barRadius: 2, cursorWidth: 0, normalize: true,
  });
  ws.setVolume(volume);
  hostByFile.set(file, host);
  wsByFile.set(file, ws);
  ws._file = file;
  // wavesurfer is DISPLAY-ONLY; playback goes through the Web Audio engine (gapless loops).
  ws.on('interaction', (t) => { const c = cardFor(file) || card; if (!active || active.sound.file !== file) playFromCard(c); else { const wd = active.ws.getDuration() || active.dur; engSeek((t / wd) * active.dur); } });
  return ws;
}
function cardFor(file) { return $(`.card[data-file="${CSS.escape(file)}"]`); }
/* ---------- Web Audio playback engine (sample-accurate gapless loops; clips pre-matched to seamless points) ---------- */
const AC = new (window.AudioContext || window.webkitAudioContext)();
const bufCache = new Map(); // file -> AudioBuffer
async function getBuffer(file) {
  if (bufCache.has(file)) return bufCache.get(file);
  const ab = await (await fetch(file)).arrayBuffer();
  const buf = await AC.decodeAudioData(ab);
  bufCache.set(file, buf);
  return buf;
}
function engStop() { // stop current source, keep selection
  if (active && active.src) { active._manualStop = true; try { active.src.onended = null; active.src.stop(); } catch (e) {} active.src = null; }
  if (active) cancelAnimationFrame(active.raf);
}
function engCurTime() {
  if (!active) return 0;
  if (!active.playing) return active.offset || 0;
  let t = active.offset + (AC.currentTime - active.startedAt);
  if (active.src && active.src.loop && active.dur) t = t % active.dur;
  return t;
}
function setWaveProgress(t, full) {  // map engine time -> wavesurfer cursor by FRACTION (durations can differ slightly)
  if (!active || !active.ws) return;
  const wd = active.ws.getDuration();
  if (wd > 0 && active.dur > 0) {
    const frac = full ? 1 : Math.max(0, Math.min(1, t / active.dur));
    try { active.ws.setTime(frac >= 1 ? wd - 0.001 : frac * wd); } catch (e) {}
  }
}
function engTick() {
  if (!active || !active.playing) return;
  const t = engCurTime();
  updateDockTime(t, active.dur);
  setWaveProgress(t);
  active.raf = requestAnimationFrame(engTick);
}
async function engPlay(fromOffset) {
  if (AC.state === 'suspended') { try { await AC.resume(); } catch (e) {} }
  const sound = active.sound;
  const buf = await getBuffer(sound.file);
  if (!active || active.sound !== sound) return; // selection changed while decoding
  engStop();
  const src = AC.createBufferSource(); src.buffer = buf; src.loop = loopOn;
  const gain = AC.createGain(); gain.gain.value = volume * ampParam;
  if (active.spatial) {                       // 3D: route through a positional panner (radar)
    const p = AC.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'linear';
    p.refDistance = 1; p.rolloffFactor = 1; p.maxDistance = Math.max(2, attenRange);
    p.positionX.value = spWorld.x; p.positionY.value = 0; p.positionZ.value = spWorld.z;
    active.panner = p; src.connect(p); p.connect(gain).connect(AC.destination);
  } else { active.panner = null; src.connect(gain).connect(AC.destination); }
  const off = (((fromOffset || 0) % buf.duration) + buf.duration) % buf.duration;
  active.src = src; active.gain = gain; active.dur = buf.duration;
  active.offset = off; active.startedAt = AC.currentTime; active.playing = true; active._manualStop = false;
  src.onended = () => { if (active && active.src === src && !active._manualStop) { active.playing = false; active.offset = 0; cancelAnimationFrame(active.raf); setPlayingUI(cardFor(sound.file), false); updateDockTime(active.dur, active.dur); setWaveProgress(0, true); } };
  src.start(0, off);
  setPlayingUI(cardFor(sound.file), true);
  engTick();
}
function engPause() { if (!active || !active.playing) return; active.offset = engCurTime(); active.playing = false; engStop(); setPlayingUI(cardFor(active.sound.file), false); }
function engSeek(t) { if (!active) return; if (active.playing) engPlay(t); else { active.offset = t; updateDockTime(t, active.dur); setWaveProgress(t); } }
function applyLoop() { if (active && active.src) active.src.loop = loopOn; }
function applyGain() { if (active && active.gain) active.gain.gain.value = volume * ampParam; }

/* ---------- playback ---------- */
function wireCard(card) {
  $('[data-play]', card).addEventListener('click', () => playFromCard(card));
  $('[data-copy]', card).addEventListener('click', () => {
    navigator.clipboard.writeText(card.dataset.name).then(() => toast('Copied: ' + card.dataset.name)).catch(() => toast('Copy failed'));
  });
}
function playFromCard(card) {
  ensureWave(card);
  const file = card.dataset.file;
  const ws = wsByFile.get(file);
  const sound = SOUNDS.find(s => s.file === file);
  if (active && active.sound.file === file) { if (active.playing) engPause(); else engPlay(active.offset || 0); return; }
  engStop();
  active = { sound, ws, card, offset: 0, playing: false, dur: sound.dur, spatial: false };
  loopOn = !!sound.loop;
  reflectLoop();
  setDock(sound);
  engPlay(0);
}
function setPlayingUI(card, playing) {
  $$('.card.playing').forEach(c => { if (c !== card) c.classList.remove('playing'); });
  if (card) card.classList.toggle('playing', playing);
  $('#dock').classList.toggle('playing', !!(playing && active && active.sound && card && active.sound.file === card.dataset.file));
}

/* ---------- dock ---------- */
function setDock(sound) {
  const dock = $('#dock'); dock.classList.add('show'); dock.setAttribute('aria-hidden', 'false');
  $('#dockTitle').textContent = pretty(sound.name);
  $('#dockSub').textContent = sound.cat + (sound.loop ? ' · loop' : '') + ' · ' + sound.name;
  $('#dockDur').textContent = fmt(sound.dur, sound.dur);
  $('#dockCur').textContent = fmt(0, sound.dur);
  const dl = $('#dockDl'); dl.href = sound.file; dl.download = sound.name + '.ogg';
  // build/refresh seek bar
  const w = $('#dockWave');
  w.innerHTML = '<div class="pgwrap"><div class="pgfill"></div></div>';
  $('.pgwrap', w).addEventListener('click', (e) => {
    if (!active) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    engSeek(ratio * (active.dur || sound.dur));
  });
}
function updateDockTime(t, dur) {
  $('#dockCur').textContent = fmt(t, dur);
  const fill = $('#dockWave .pgfill');
  if (fill && dur) fill.style.width = (100 * t / dur) + '%';
}
function reflectLoop() { $('#dockLoop').classList.toggle('on', loopOn); $('#dockLoop').setAttribute('aria-pressed', loopOn); }

$('#dockPlay').addEventListener('click', () => { if (!active) return; if (active.playing) engPause(); else engPlay(active.offset || 0); });
$('#dockLoop').addEventListener('click', () => { loopOn = !loopOn; reflectLoop(); applyLoop(); toast(loopOn ? 'Loop on' : 'Loop off'); });
$('#dockSpatial').addEventListener('click', () => { if (active && active.sound) openSpatial(active.sound); else toast('Play a sound first'); });
$('#vol').addEventListener('input', (e) => { volume = +e.target.value; applyGain(); });

/* ---------- visitor counters (GoatCounter total/history + Firebase live "online now") ---------- */
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function initAnalytics() {
  const cfg = window.SB_CONFIG || {};
  const hasGC = !!cfg.goatcounter, hasFB = !!(cfg.firebase && cfg.firebase.databaseURL);
  if (!hasGC && !hasFB) return;                 // nothing configured -> keep the chip hidden
  $('#siteStat').hidden = false;
  if (!hasFB) { $('#ssOnlineWrap').hidden = true; $('#ssSep').hidden = true; }
  if (!hasGC) { $('#ssTotalWrap').hidden = true; $('#ssSep').hidden = true; }

  // GoatCounter: send the pageview + read the public total counter
  if (hasGC) {
    const code = cfg.goatcounter;
    const s = document.createElement('script');
    s.async = true; s.src = '//gc.zgo.at/count.js';
    s.setAttribute('data-goatcounter', `https://${code}.goatcounter.com/count`);
    document.body.appendChild(s);
    fetch(`https://${code}.goatcounter.com/counter/TOTAL.json`)
      .then(r => r.json()).then(d => { if (d && d.count != null) $('#ssTotal').textContent = ('' + d.count).trim(); })
      .catch(() => { $('#ssTotalWrap').hidden = true; });
  }

  // Firebase Realtime DB presence: each open tab adds a node that auto-removes on disconnect; count = online now
  if (hasFB) {
    loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
      .then(() => loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js'))
      .then(() => {
        firebase.initializeApp(cfg.firebase);
        const db = firebase.database();
        const ref = db.ref('online');
        const me = ref.push();
        const conn = db.ref('.info/connected');
        conn.on('value', (s) => { if (s.val()) { me.onDisconnect().remove(); me.set(true); } });
        ref.on('value', (snap) => { $('#ssOnline').textContent = snap.numChildren() || 1; });
      })
      .catch(() => { $('#ssOnlineWrap').hidden = true; $('#ssSep').hidden = true; });
  }
}

/* ---------- about / coverage ---------- */
function buildAbout() {
  $('#sdkVer').textContent = SDK_VERSION;
  $('#sdkTotal').textContent = SDK_TOTAL;
  $('#sdkCats').textContent = Object.keys(SDK_CATS).length;
  const cap = {}; SOUNDS.forEach(s => cap[s.cat] = (cap[s.cat] || 0) + 1);
  const rows = ['<div class="cov-row head"><span>Category</span><span>captured / SDK</span><span>coverage</span></div>'];
  let capTotal = 0;
  Object.keys(SDK_CATS).sort((a, b) => SDK_CATS[b] - SDK_CATS[a]).forEach(c => {
    const got = cap[c] || 0, tot = SDK_CATS[c]; capTotal += Math.min(got, tot);
    const pct = Math.min(100, Math.round(100 * got / tot)), done = got >= tot ? ' done' : '';
    rows.push(`<div class="cov-row"><span class="cov-cat">${c}</span><span class="cov-num">${got} / ${tot}</span><span class="cov-bar${done}"><i style="width:${pct}%"></i></span></div>`);
  });
  const tp = Math.round(100 * capTotal / SDK_TOTAL);
  rows.push(`<div class="cov-row total"><span class="cov-cat">All</span><span class="cov-num">${capTotal} / ${SDK_TOTAL}</span><span class="cov-bar${capTotal >= SDK_TOTAL ? ' done' : ''}"><i style="width:${tp}%"></i></span></div>`);
  $('#coverage').innerHTML = rows.join('');
}
$('#aboutBtn').addEventListener('click', () => { buildAbout(); $('#aboutOverlay').hidden = false; });
$('#aboutClose').addEventListener('click', () => { $('#aboutOverlay').hidden = true; });
$('#aboutOverlay').addEventListener('click', (e) => { if (e.target.id === 'aboutOverlay') $('#aboutOverlay').hidden = true; });
$('#creditsBtn').addEventListener('click', () => { $('#creditsOverlay').hidden = false; });
$('#creditsClose').addEventListener('click', () => { $('#creditsOverlay').hidden = true; });
$('#creditsOverlay').addEventListener('click', (e) => { if (e.target.id === 'creditsOverlay') $('#creditsOverlay').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#aboutOverlay').hidden = true; $('#creditsOverlay').hidden = true; } });

/* ---------- search ---------- */
const search = $('#search');
search.addEventListener('input', () => {
  curTerm = search.value.trim().toLowerCase();
  $('.search').classList.toggle('has-text', !!curTerm);
  render();
});
$('#searchClear').addEventListener('click', () => { search.value = ''; curTerm = ''; $('.search').classList.remove('has-text'); render(); search.focus(); });

/* ---------- header shrink ---------- */
addEventListener('scroll', () => $('#header').classList.toggle('small', scrollY > 20));

/* ---------- downloads (zip) ---------- */
async function zipDownload(list, zipName) {
  if (!list.length) { toast('Nothing to download'); return; }
  const ov = $('#dlOverlay'); ov.hidden = false;
  const bar = $('#dlBar'); const label = $('#dlLabel');
  const zip = new JSZip();
  let done = 0;
  for (const s of list) {
    label.textContent = 'Fetching ' + (done + 1) + ' / ' + list.length;
    try {
      const buf = await (await fetch(s.file)).arrayBuffer();
      zip.file(s.file.split('/').pop(), buf);
    } catch (e) { /* skip missing */ }
    done++; bar.style.width = (100 * done / list.length) + '%';
  }
  label.textContent = 'Compressing…';
  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => { bar.style.width = meta.percent + '%'; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = zipName; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  ov.hidden = true; bar.style.width = '0';
  toast('Downloaded ' + zipName);
}
$('#dlAll').addEventListener('click', () => zipDownload(SOUNDS, 'BF6_Portal_SFX_ALL.zip'));
$('#dlCat').addEventListener('click', () => {
  const list = curCat === 'All' ? SOUNDS : SOUNDS.filter(s => s.cat === curCat);
  zipDownload(list, 'BF6_Portal_SFX_' + curCat + '.zip');
});

/* ---------- spatial preview panel + radar ---------- */
const radar = $('#radar');
const RCTX = radar.getContext('2d');
const RC = 170, RR = 150;   // centre, radius (canvas 340)

function recomputeWorld() {
  const len = Math.hypot(spPx, spPy) || 1e-6;
  const px = Math.min(len, RR) * (spPx / len), py = Math.min(len, RR) * (spPy / len);
  spPx = px; spPy = py;
  spWorld.dist = (Math.min(len, RR) / RR) * attenRange;
  spWorld.ang = Math.atan2(px, -py);                 // 0 = forward (up)
  const u = Math.hypot(px, py) || 1e-6;
  spWorld.x = (px / u) * spWorld.dist;               // +X right
  spWorld.z = (py / u) * spWorld.dist;               // -Z forward (py<0 = up = forward)
}
function drawRadar() {
  const d3 = spSound && is3D(spSound.name);
  radar.classList.toggle('is2d', !d3);
  RCTX.clearRect(0, 0, 340, 340);
  // rings
  for (let i = 1; i <= 4; i++) {
    const r = RR * i / 4;
    RCTX.beginPath(); RCTX.arc(RC, RC, r, 0, Math.PI * 2);
    RCTX.strokeStyle = i === 4 ? 'rgba(255,107,26,.6)' : 'rgba(255,255,255,.10)';
    RCTX.lineWidth = i === 4 ? 2 : 1; RCTX.stroke();
  }
  // axes
  RCTX.strokeStyle = 'rgba(255,255,255,.06)'; RCTX.lineWidth = 1;
  RCTX.beginPath(); RCTX.moveTo(RC - RR, RC); RCTX.lineTo(RC + RR, RC); RCTX.moveTo(RC, RC - RR); RCTX.lineTo(RC, RC + RR); RCTX.stroke();
  // forward label
  RCTX.fillStyle = 'rgba(170,176,190,.6)'; RCTX.font = '10px Inter, sans-serif'; RCTX.textAlign = 'center';
  RCTX.fillText('FRONT', RC, RC - RR + 14); RCTX.fillText('BACK', RC, RC + RR - 8);
  if (d3) {
    const sx = RC + spPx, sy = RC + spPy;
    RCTX.strokeStyle = 'rgba(255,255,255,.25)'; RCTX.lineWidth = 2;
    RCTX.beginPath(); RCTX.moveTo(RC, RC); RCTX.lineTo(sx, sy); RCTX.stroke();
    RCTX.beginPath(); RCTX.arc(sx, sy, 8, 0, Math.PI * 2);     // 3D source = cool blue (matches 3D badge)
    RCTX.fillStyle = '#3aa0ff'; RCTX.shadowColor = '#3aa0ff'; RCTX.shadowBlur = 12; RCTX.fill(); RCTX.shadowBlur = 0;
  }
  // player (you) = BF6 orange
  RCTX.beginPath(); RCTX.arc(RC, RC, 7, 0, Math.PI * 2);
  RCTX.fillStyle = '#ff6b1a'; RCTX.shadowColor = '#ff6b1a'; RCTX.shadowBlur = 14; RCTX.fill(); RCTX.shadowBlur = 0;
}
function refreshSpatialReadout() {
  recomputeWorld();
  $('#distVal').textContent = Math.round(spWorld.dist) + ' m';
  $('#rangeVal').textContent = attenRange + ' m';
  $('#ampVal').textContent = ampParam.toFixed(1) + '×';
  $('#spCode').textContent = genCode();
  drawRadar();
}
function genCode() {
  if (!spSound) return '';
  const N = 'mod.RuntimeSpawn_Common.' + spSound.name;
  const sc = spScope ? ', ' + spScope : '';
  if (is3D(spSound.name)) {
    const x = spWorld.x.toFixed(1), z = spWorld.z.toFixed(1);
    return [
      '// position is RELATIVE to the listener — add the player’s world pos in-game',
      'const pos = mod.CreateVector(' + x + ', 0, ' + z + ')',
      'const sfx = mod.SpawnObject(' + N + ', pos, mod.CreateVector(0,0,0), mod.CreateVector(1,1,1))',
      'mod.PlaySound(sfx, ' + ampParam.toFixed(1) + ', pos, ' + attenRange + sc + ')',
    ].join('\n');
  }
  return [
    'const sfx = mod.SpawnObject(' + N + ', pos, mod.CreateVector(0,0,0), mod.CreateVector(1,1,1))',
    'mod.PlaySound(sfx, ' + ampParam.toFixed(1) + sc + ')',
  ].join('\n');
}
function openSpatial(sound) {
  if (!sound) return;
  spSound = sound;
  $('#spatial').hidden = false;
  $('#spName').textContent = pretty(sound.name);
  $('#spMode').textContent = (is3D(sound.name) ? '3D positional' : '2D (non-positional)') + (sound.loop ? ' · loop' : '') + ' · ' + sound.name;
  refreshSpatialReadout();
}
function radarSet(e) {
  if (!spSound || !is3D(spSound.name)) return;
  const r = radar.getBoundingClientRect();
  const scale = 340 / r.width;
  spPx = (e.clientX - r.left) * scale - RC;
  spPy = (e.clientY - r.top) * scale - RC;
  refreshSpatialReadout();
  if (active && active.spatial && active.panner) { active.panner.positionX.value = spWorld.x; active.panner.positionZ.value = spWorld.z; }
  else playSpatial();
}
function playSpatial() {
  if (!spSound) return;
  engStop();
  const ws = wsByFile.get(spSound.file);
  active = { sound: spSound, ws, card: cardFor(spSound.file), offset: 0, playing: false, dur: spSound.dur, spatial: is3D(spSound.name) };
  loopOn = !!spSound.loop; reflectLoop();
  setDock(spSound);
  engPlay(0);
}
let radarDown = false;
radar.addEventListener('pointerdown', (e) => { radarDown = true; radar.setPointerCapture(e.pointerId); radarSet(e); });
radar.addEventListener('pointermove', (e) => { if (radarDown) radarSet(e); });
radar.addEventListener('pointerup', () => { radarDown = false; });
$('#rangeSlider').addEventListener('input', (e) => { attenRange = +e.target.value; refreshSpatialReadout(); if (active && active.panner) active.panner.maxDistance = Math.max(2, attenRange); });
$('#ampSlider').addEventListener('input', (e) => { ampParam = +e.target.value; refreshSpatialReadout(); applyGain(); });
$('#scopeSel').addEventListener('change', (e) => { spScope = e.target.value; $('#spCode').textContent = genCode(); });
$('#spPlay').addEventListener('click', playSpatial);
$('#spClose').addEventListener('click', () => { $('#spatial').hidden = true; });
$('#spCopy').addEventListener('click', () => navigator.clipboard.writeText(genCode()).then(() => toast('Code copied')).catch(() => toast('Copy failed')));

init();
