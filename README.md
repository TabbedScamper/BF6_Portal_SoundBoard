# BF6 Portal — SFX Library 🔊

A polished, Battlefield‑6‑themed soundboard for browsing, auditioning and downloading **Battlefield 6 Portal** sound effects, with a built‑in spatial (3D) preview that mirrors the in‑game `PlaySound` API.

**Live site:** https://tabbedscamper.github.io/BF6_Portal_SoundBoard/

## Features
- **SoundCloud‑style waveforms** on every clip (wavesurfer.js, lazy‑loaded).
- **Spotify‑style now‑playing dock** — play/pause, seek, volume, loop, download, and the spatial radar.
- **Seamless loops** — loop assets are cut at matched, zero‑crossing loop points (no fade) and played gaplessly via the Web Audio API.
- **Spatial preview (radar)** — for 3D sounds: you're the centre dot, click/drag to place the sound, set the attenuation‑range ring, and it generates the exact `mod.PlaySound(...)` call. 2D sounds play non‑positionally.
- **Search + filters** — by category and by type (3D / 2D / Loop), with live counts.
- **Download** — per‑sound, or zip by category / everything (client‑side, JSZip).
- **Click an asset name to copy** it for `mod.RuntimeSpawn_Common`.
- Fully responsive (phone → ultrawide).

## What code can actually control about BF6 audio
See [`SOUND-API.md`](SOUND-API.md) — researched from the SDK + the Portal Discord (esp. **Aryo / Post (Sound)**). Short version: `PlaySound(sound, amplitude [,location, attenuationRange] [,scope])` + `StopSound`. No pitch / reverb / pan / doppler.

## Adding more sounds
1. Drop split `.ogg` clips into `sounds/<Category>/`.
2. `bash gen-manifest.sh` to rebuild `manifest.json` (needs `ffprobe`).
3. For loop assets, `node make-loops.cjs` to bake seamless loop points (needs `ffmpeg`/`ffprobe`).

Must be served over http (GitHub Pages or a local server) — opening `index.html` as `file://` blocks the `fetch()` of the manifest/clips.

## Credits
Sounds are Battlefield 6 / EA DICE assets, surfaced for Portal modders. Sound tooling/API by **Aryo / Post (Sound)**.
