# BF6 Portal — SFX Library 🔊

A polished, Battlefield‑6‑themed soundboard for browsing, auditioning and downloading **Battlefield 6 Portal** sound effects, with a built‑in spatial (3D) preview that mirrors the in‑game `PlaySound` API.

**Live site:** https://tabbedscamper.github.io/BF6_Portal_SoundBoard/

The library now uses **real game audio with all variants**: **934 SFX sounds / 5,950 authored variants** from the lossless decoded game export, encoded as Ogg Vorbis at quality 3, preserving channels and using 48 kHz. Six source clips at 44.1/96 kHz are resampled to 48 kHz. **Three SFX sounds** without exported audio keep their original recordings (marked **recorded**): `SFX_Destruction_Structural_Metal_GasStation_OneShot3D`, `SFX_UI_MenuNavigation_Haptics_ResetpackageLoading_OneShot2D` and `SFX_UI_MenuNavigation_Haptics_Shared_Select_OneShot2D`. The remaining SDK name, `SFX_VOModule_OneShot2D`, is a PlayVO carrier with no standalone clip and remains excluded.

There are **937 SFX sounds**, plus **143 announcer event/flag names in 578 unchanged VO recordings**, for **6,531 audio files**. **455 SFX cards** have several authored variants. Announcer cards retain their existing event/flag grouping. Crash, silent and unreliable flags describe observed Portal behaviour and are preserved by name, even when a real audio preview is now available.

The source export grew during this upgrade from 915 sounds / 5,683 variants to 934 sounds / 5,950 variants; the library includes the completed additions. Total `sounds/` size: **255,325,883 bytes (255.3 MB / 243.5 MiB)**. All exported clips use quality 3; no size-driven quality reduction was needed.

## Features
- **SoundCloud‑style waveforms** on every clip (wavesurfer.js, lazy‑loaded).
- **Spotify‑style now‑playing dock** — play/pause, seek, volume, loop, download, and the spatial radar.
- **Gapless loops** — real game loops retain their complete authored sample range and play gaplessly via the Web Audio API. Original recorded loops retain their existing matched loop points.
- **All SFX variants** — multi-variant cards show the count and cycle to a different variant per play click; card/dock downloads give the current variant and ZIP downloads include every variant. Single-variant cards keep the existing layout.
- **Spatial preview (radar)** — for 3D sounds: you're the centre dot, click/drag to place the sound, set the attenuation‑range ring, and it generates the exact `mod.PlaySound(...)` call. 2D sounds play non‑positionally.
- **Search + filters** — by category and by type (3D / 2D / Loop), with live counts.
- **Download** — per‑sound, or zip by category / everything (client‑side, JSZip).
- **Click an asset name to copy** it for `mod.RuntimeSpawn_Common`.
- Fully responsive (phone → ultrawide).

## What code can actually control about BF6 audio
See [`SOUND-API.md`](SOUND-API.md) — researched from the SDK + the Portal Discord (esp. **Aryo / Post (Sound)**). Short version: `PlaySound(sound, amplitude [,location, attenuationRange] [,scope])` + `StopSound`. No pitch / reverb / pan / doppler.

## Adding more sounds
1. Drop split `.ogg` clips into `sounds/<Category>/`.
2. `bash gen-manifest.sh` (or `node gen-manifest.cjs`) to rebuild `manifest.json` (needs Node and `ffprobe` for new files). SFX variants use `<idx>_<PortalName>_v<n>.ogg`; the manifest keeps the base Portal name. `sound-metadata.json` preserves behaviour flags, category and audio provenance by name. Use `--probe-all` with the Node generator to refresh every duration after editing audio files.
3. `node make-loops.cjs` checks sample seams from a selection of game loops without trimming them (needs `ffmpeg`/`ffprobe`). Add `--source=<export-directory>` to compare the first/last samples and decoder frame counts with the WAV originals. FFmpeg's native Vorbis decoder can omit an initial overlap block; `check-audio.cjs` separately checks every Ogg's authored duration using its final granule. Only `--trim-recorded` explicitly enables the legacy matcher for recorded loops; it never trims game audio. Refresh durations after any trimming.

To reimport a lossless export: `node import-audio.cjs <export-directory>`, then regenerate the manifest and run the loop checks. The source is read only; output is confined to this worktree. Set `FFMPEG` / `FFPROBE` to executable paths if they are not on PATH. Encoding uses `libvorbis -q:a 3`, retains all source channels (including multichannel assets), and does not normalize or trim. Listening is still needed to assess authored loop seams, multichannel browser playback/downmixing and preview levels.

`node check-audio.cjs <export-directory-or-manifest> <baseline-git-ref>` validates every file, Vorbis channel/sample-rate headers, authored duration, preserved flags and recording hashes, and exercises manifest loading and variant cycling with a minimal DOM. Use the pre-import commit as the baseline. The importer saves an ignored `audio.tmp.source.json` snapshot for validation when the external export is still changing.

Upgrade validation passed against baseline `d8804b4c1ceba483f4d6ddfeea9709e0cd011c65`: all 6,531 manifest entries exist; all 5,950 game variants preserve source channels, 48 kHz output and authored Ogg duration; 581 retained recordings and all VO manifest metadata are unchanged. Headless checks cover variant cycling/wrap, current downloads, complete all/category ZIP contents, markers and counts. A local Python HTTP server returned 200 for the page, manifest and 17 sampled clips across every category, recorded fallbacks and variants.

All **1,188 game loop variants** retain their authored range. First/last samples were checked for 19 clips against their source WAVs. Some source seams have substantial jumps (for example `WelcomeSign` v6 and `Riot_CrowdRumble` v91); listen for clicks, including other `PigeonTowerCreak` variants, before treating every authored loop as perceptually seamless. Also audition 3/4/6-channel playback/downmixing and levels in target browsers. The original recording boost applies only to recorded audio; game previews use native level through the existing limiter. No browser screenshots were taken.

Must be served over http (GitHub Pages or a local server) — opening `index.html` as `file://` blocks the `fetch()` of the manifest/clips.

## Credits
Sounds are Battlefield 6 / EA DICE assets, surfaced for Portal modders. Sound tooling/API by **Aryo / Post (Sound)**.

Real SFX audio comes from the **BF6 Modding SDK audio export**, decoded losslessly before the site's Vorbis encoding. Original in-game SFX and PlayVO recordings were captured using **BF6_SFX** by **TabbedScamper**.
