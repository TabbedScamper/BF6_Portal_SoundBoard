/* Make loop clips seamlessly loopable WITHOUT a fade, by finding two matching points.
 *
 * These loops are noise-like TEXTURES (whooshes / trails) whose raw waveform never repeats, so you cannot match
 * the waveform sample-for-sample. What you CAN match is the amplitude ENVELOPE (the "fluctuation"): the captured
 * clip contains the asset's loop repeating with some period, so the envelope leading into the right end point E
 * matches the envelope leading into the start S. Snap E to an upward zero-crossing (amplitude ~0, slope rising)
 * so the instantaneous seam is click-free. Noise->noise at a matching level + zero-crossing is perceptually
 * seamless with NO fade. Cut [S,E].
 *
 * Usage:  FFMPEG=... FFPROBE=... node make-loops.cjs     (processes soundboard/sounds/<cat>/*Loop*.ogg in place)
 * Game audio already contains the authored period: preserve its full sample range.
 * Default runs audit a sample of game-loop seams without modifying any files.
 * --trim-recorded explicitly enables the legacy capture matcher for recorded loops only.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SB = __dirname;
const FFMPEG  = process.env.FFMPEG  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const manifest = JSON.parse(fs.readFileSync(path.join(SB, 'manifest.json'), 'utf8'));
const trimRecorded = process.argv.includes('--trim-recorded');
const sourceDir = process.argv.find(a => a.startsWith('--source='))?.slice('--source='.length);
const sourceClips = sourceDir ? JSON.parse(fs.readFileSync(path.join(sourceDir,'manifest.json'),'utf8')).clips : [];
// sounds that loop by BEHAVIOUR but lack a "Loop" suffix in their name (observed as a long continuous capture)
const FORCE_LOOP = ['SFX_Alarm', 'Switchblade_Engine_Propellar'];
const isLoopName = (f) => /loop/i.test(f) || FORCE_LOOP.some(n => f.includes(n));
const SR = 16000;                       // analysis sample rate (mono)
const ENV_WIN = Math.round(0.030 * SR); // RMS window for the envelope (~30ms)
const EW = Math.round(0.30 * SR);       // envelope-match window leading into the seam (~300ms)
const ATTACK   = Math.round(0.20 * SR);
const MIN_LOOP = Math.round(2.5 * SR);
const GUARD    = Math.round(0.12 * SR);
const STEP     = Math.max(1, Math.round(0.005 * SR)); // 5ms coarse step
const ZWIN     = Math.round(0.006 * SR); // snap window for the up-zero-crossing (~6ms)

function decodeMono(file) {
  const r = spawnSync(FFMPEG, ['-nostdin','-hide_banner','-loglevel','error','-i',file,'-ac','1','-ar',String(SR),'-f','f32le','-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) throw new Error('decode failed: ' + (r.stderr || ''));
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
const isUpZero = (x, i) => i >= 0 && i + 1 < x.length && x[i] <= 0 && x[i + 1] > 0;
function upZeroAtOrAfter(x, i) { for (let k = i; k < x.length - 1; k++) if (isUpZero(x, k)) return k; return i; }
function snapUpZero(x, i) {              // nearest up-zero-crossing within +-ZWIN of i (else i)
  for (let d = 0; d <= ZWIN; d++) { if (isUpZero(x, i + d)) return i + d; if (isUpZero(x, i - d)) return i - d; }
  return i;
}
// envelope: smoothed RMS via prefix sums of x^2
function envelope(x) {
  const P = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) P[i + 1] = P[i] + x[i] * x[i];
  const env = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) { const b = Math.min(x.length, i + ENV_WIN); env[i] = Math.sqrt((P[b] - P[i]) / (b - i)); }
  return env;
}
function ssdEnv(env, aStart, bStart) { let s = 0; for (let k = 0; k < EW; k++) { const d = env[aStart + k] - env[bStart + k]; s += d * d; } return s; }

function findLoop(x) {
  const env = envelope(x);
  let S = upZeroAtOrAfter(x, ATTACK);
  if (S - EW < 0) S = upZeroAtOrAfter(x, ATTACK + EW);
  const aStart = S - EW;                                 // envelope window leading into S
  let bestE = -1, bestScore = Infinity;
  for (let E = S + MIN_LOOP; E < x.length - GUARD; E += STEP) {
    const s = ssdEnv(env, aStart, E - EW);               // env leading into E vs into S
    if (s < bestScore) { bestScore = s; bestE = E; }
  }
  if (bestE < 0) return null;
  const E = snapUpZero(x, bestE);                         // click-free instantaneous seam
  let meanEnv = 0; for (let k = 0; k < EW; k++) meanEnv += env[aStart + k]; meanEnv = meanEnv / EW || 1e-6;
  const matchRms = Math.sqrt(ssdEnv(env, aStart, E - EW) / EW);
  return { S, E, quality: 1 - Math.min(1, matchRms / meanEnv) };  // 1.0 = envelope matches perfectly
}

function sleep(ms) { const t = Date.now() + ms; while (Date.now() < t) { /* spin: Dropbox lock is brief */ } }
function cut(file, tS, tE) {
  const tmp = path.join(SB, '.looptmp.ogg');
  const r = spawnSync(FFMPEG, ['-nostdin','-hide_banner','-loglevel','error','-y','-i',file,
    '-af', `atrim=${tS.toFixed(4)}:${tE.toFixed(4)},asetpts=PTS-STARTPTS`,
    '-vn','-c:a','libvorbis','-q:a','3', tmp], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('cut failed: ' + (r.stderr || ''));
  // retry the overwrite — Dropbox/AV can briefly lock the target (EPERM on rename)
  for (let i = 0; i < 10; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) { if (i === 9) { try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); return; } catch (e2) { throw e2; } } sleep(300); }
  }
}

function listLoops() {
  const only = process.argv.slice(2).find(a => !a.startsWith('--'));
  return manifest.filter(s => s.loop && (!only || s.file.split('/')[1].toLowerCase() === only.toLowerCase()));
}

const loops = listLoops();
const gameLoops = loops.filter(s => s.source === 'game');
// Spread checks across categories/durations; inspect native channels at 48 kHz, without downmixing.
const samples = gameLoops.filter((s, i) => i % Math.max(1, Math.floor(gameLoops.length / 12)) === 0).slice(0, 12);
for (const s of gameLoops) {
  if (!samples.some(x=>x.cat===s.cat)) samples.push(s);
}
const pigeon = gameLoops.find(s=>s.name.includes('PigeonTowerCreak'));
if (pigeon && !samples.includes(pigeon)) samples.push(pigeon);
for (const s of samples) {
  const f = path.join(SB, s.file);
  const probe = spawnSync(FFPROBE, ['-v','error','-show_entries','stream=channels,sample_rate','-of','json',f], {encoding:'utf8'});
  if (probe.status !== 0) throw new Error('probe failed: ' + f);
  const {channels, sample_rate} = JSON.parse(probe.stdout).streams[0];
  if (Number(sample_rate) !== 48000) throw new Error('Expected 48 kHz: ' + f);
  const decoded = spawnSync(FFMPEG, ['-nostdin','-v','error','-i',f,'-f','f32le','-'], {maxBuffer:1<<30});
  if (decoded.status !== 0) throw new Error('decode failed: ' + f);
  const b = decoded.stdout;
  const frames = b.length / (4 * channels);
  let seam = 0, peak = 0;
  for (let ch=0; ch<channels; ch++) seam = Math.max(seam, Math.abs(b.readFloatLE(ch*4)-b.readFloatLE(b.length-channels*4+ch*4)));
  for (let i=0; i<b.length; i+=4) peak = Math.max(peak, Math.abs(b.readFloatLE(i)));
  let sourceSeam = '';
  if (sourceDir) {
    const clips = sourceClips.filter(c=>c.portalName===s.name);
    const c = clips.find(c=>c.variantIndex===(clips.length>1 ? s.variant-1 : 0));
    if (!c) throw new Error('Missing source variant: ' + s.file);
    const wav = spawnSync(FFMPEG, ['-nostdin','-v','error','-i',path.join(sourceDir,c.file),'-ar','48000','-f','f32le','-'], {maxBuffer:1<<30});
    if (wav.status !== 0) throw new Error('Source decode failed: ' + c.file);
    const w = wav.stdout;
    // FFmpeg's native Vorbis decoder can omit the initial overlap block; the Ogg
    // final granule is the authored length, independently checked by check-audio.cjs.
    const sourceFrames = w.length / (channels*4);
    const decoderDelta = sourceFrames-frames;
    if (Math.abs(decoderDelta)>1024) throw new Error('Unexpected decoder length difference: ' + s.file);
    let delta = 0;
    for (let ch=0;ch<channels;ch++) delta = Math.max(delta,Math.abs(w.readFloatLE(ch*4)-w.readFloatLE(w.length-channels*4+ch*4)));
    sourceSeam = `, source delta=${delta.toFixed(6)}, source frames=${sourceFrames}, decoder difference=${decoderDelta}`;
  }
  console.log(`preserved ${frames} frames, ${channels}ch; first/last max delta=${seam.toFixed(6)}${sourceSeam}, peak=${peak.toFixed(6)} ${s.file}`);
}
console.log(`Preserved ${gameLoops.length} game loop variants and ${loops.length-gameLoops.length} recorded loops. Seam measurements need listening to assess clicks.`);
let n = 0;
for (const s of trimRecorded ? loops.filter(s => s.source !== 'game') : []) {
  const f = path.join(SB, s.file);
  try {
    const x = decodeMono(f);
    const r = findLoop(x);
    if (!r) { console.log('skip (no match): ' + path.basename(f)); continue; }
    const tS = r.S / SR, tE = r.E / SR;
    cut(f, tS, tE);
    console.log(`loop  [${tS.toFixed(2)}s .. ${tE.toFixed(2)}s] = ${(tE - tS).toFixed(2)}s  match=${(r.quality * 100).toFixed(1)}%  ${path.basename(f)}`);
    n++;
  } catch (e) { console.log('ERR ' + path.basename(f) + ': ' + e.message.slice(0, 80)); }
}
console.log(`--- loop-matched ${n} clip(s) (no fade) ---`);
