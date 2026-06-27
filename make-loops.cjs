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
 * Originals are preserved in ../sound-split/clips/.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SB = __dirname;
const FFMPEG  = process.env.FFMPEG  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
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

function cut(file, tS, tE) {
  const tmp = path.join(SB, '.looptmp.ogg');
  const r = spawnSync(FFMPEG, ['-nostdin','-hide_banner','-loglevel','error','-y','-i',file,
    '-af', `atrim=${tS.toFixed(4)}:${tE.toFixed(4)},asetpts=PTS-STARTPTS`,
    '-vn','-ac','2','-c:a','libvorbis','-q:a','5', tmp], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('cut failed: ' + (r.stderr || ''));
  fs.renameSync(tmp, file);
}

function listLoops() {
  const out = [];
  const sounds = path.join(SB, 'sounds');
  for (const cat of fs.readdirSync(sounds)) {
    const dir = path.join(sounds, cat);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (/loop/i.test(f) && f.endsWith('.ogg')) out.push(path.join(dir, f));
  }
  return out;
}

let n = 0;
for (const f of listLoops()) {
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
