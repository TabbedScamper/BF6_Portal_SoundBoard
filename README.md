# BF6 Portal SFX Library V2.00

A Battlefield 6 soundboard with **Portal Sounds** and the full **Game Library**.

**Live site:** https://tabbedscamper.github.io/BF6_Portal_SoundBoard/

**Portal Sounds** contains the **937 sounds** Portal's `mod.PlaySound` can play. **934** use real game audio with all **5,950 authored variants**, encoded as Ogg Vorbis from the lossless decoded export. Channels are preserved and output is 48 kHz. The three sounds without exported audio keep their original recordings and show a **recorded** marker: `SFX_Destruction_Structural_Metal_GasStation_OneShot3D`, `SFX_UI_MenuNavigation_Haptics_ResetpackageLoading_OneShot2D` and `SFX_UI_MenuNavigation_Haptics_Shared_Select_OneShot2D`. The silent `SFX_VOModule_OneShot2D` carrier is excluded from this list.

Announcer `PlayVO` lines use the retained recordings: **143 event/flag names in 578 clips**, grouped into announcer cards. Together with the SFX, Portal Sounds has **6,531 audio files**. Crash, silent and unreliable flags describe observed Portal behaviour, even when game audio is available to preview.

**Game Library** contains every sound in the game: **287,216 clips across 14,637 sounds**, about **195 hours**. Categories follow the game's own folders. Audio streams from **Cloudflare R2**.

## Playback and downloads

- Portal cards load waveforms on demand. The dock provides play/pause, seeking, volume, looping, download and **RADAR**.
- Multi-variant sounds cycle on each new play. **Try another variant** selects the next variant on Portal cards. Game Library uses **Play next variant**. Downloads save the current variant; Portal category and full-library ZIPs include every variant.
- Game loops keep their full authored sample range and repeat through the Web Audio API. Retained recorded loops use their existing matched loop points.
- **RADAR** opens the spatial panel. Drag the 3D source around the listener, then adjust attenuation range, amplitude and scope. Generated TypeScript spawns the sound and calls `mod.PlaySound`. Coordinates are relative to the listener; add the player's world position in your script. 2D sounds have no positional attenuation. Scope only changes the code; browser playback stays local. The preview uses approximate falloff.
- Portal search and filters cover category and 2D, 3D or loop type. Click an asset name to copy it for `mod.RuntimeSpawn_Common`.
- UI sounds default to OFF and remember your choice. Cues pause during clip playback. Reduced motion disables transitions and smooth scrolling; library totals display immediately.

See [SOUND-API.md](SOUND-API.md) for the Portal audio API and generated code.

## Adding more sounds
1. Drop split `.ogg` clips into `sounds/<Category>/`.
2. `bash gen-manifest.sh` (or `node gen-manifest.cjs`) to rebuild `manifest.json` (needs Node and `ffprobe` for new files). SFX variants use `<idx>_<PortalName>_v<n>.ogg`; the manifest keeps the base Portal name. `sound-metadata.json` preserves behaviour flags, category and audio provenance by name. Use `--probe-all` with the Node generator to refresh every duration after editing audio files.
3. `node make-loops.cjs` checks sample seams from a selection of game loops without trimming them (needs `ffmpeg`/`ffprobe`). Add `--source=<export-directory>` to compare the first/last samples and decoder frame counts with the WAV originals. FFmpeg's native Vorbis decoder can omit an initial overlap block; `check-audio.cjs` separately checks every Ogg's authored duration using its final granule. Only `--trim-recorded` explicitly enables the legacy matcher for recorded loops; it never trims game audio. Refresh durations after any trimming.

To reimport a lossless export: `node import-audio.cjs <export-directory>`, then regenerate the manifest and run the loop checks. The source is read only; output is confined to this worktree. Set `FFMPEG` / `FFPROBE` to executable paths if they are not on PATH. Encoding uses `libvorbis -q:a 3`, retains all source channels (including multichannel assets), and does not normalize or trim. Listening is still needed to assess authored loop seams, multichannel browser playback/downmixing and preview levels.

`node check-audio.cjs <export-directory-or-manifest> <baseline-git-ref>` validates every file, Vorbis channel/sample-rate headers, authored duration, preserved flags and recording hashes, and exercises manifest loading and variant cycling with a minimal DOM. Use the pre-import commit as the baseline. The importer saves an ignored `audio.tmp.source.json` snapshot for validation when the external export is still changing.

Upgrade validation passed against baseline `d8804b4c1ceba483f4d6ddfeea9709e0cd011c65`: all 6,531 manifest entries exist; all 5,950 game variants preserve source channels, 48 kHz output and authored Ogg duration; 581 retained recordings and all VO manifest metadata are unchanged. Headless checks cover variant cycling/wrap, current downloads, complete all/category ZIP contents, markers and counts. A local Python HTTP server returned 200 for the page, manifest and 17 sampled clips across every category, recorded fallbacks and variants.

All **1,188 game loop variants** retain their authored range. First/last samples were checked for 19 clips against their source WAVs. Some source seams have substantial jumps (for example `WelcomeSign` v6 and `Riot_CrowdRumble` v91); listen for clicks, including other `PigeonTowerCreak` variants, before treating every authored loop as perceptually seamless. Also audition 3/4/6-channel playback/downmixing and levels in target browsers. The original recording boost applies only to recorded audio; game previews use native level through the existing limiter. No browser screenshots were taken.

Must be served over http (GitHub Pages or a local server): opening `index.html` as `file://` blocks the `fetch()` of the manifest/clips.

## Game Library

Use the **Portal Sounds / Game Library** switch to browse the collection. Portal Sounds uses its local manifest and audio. Game Library has a separate player; switching sections pauses the other player.

The full collection's index and Opus audio live on Cloudflare R2 at **https://pub-1da528aa57f643bc9e8c257d3ab2d853.r2.dev**, configured in `config.js` under `gameLibrary.baseUrl`. The game export is not included in GitHub Pages. CORS must allow GET/HEAD from `https://tabbedscamper.github.io` and `http://localhost:8000`. No R2 credentials belong in the site config.

Select a category in the tree to fetch its first page. Counts and durations come from the tree metadata. Previous/Next fetch exactly one page on demand; there is no background clip-page prefetch. The browser keeps only the current parsed page, with a four-page LRU cache of serialized JSON. Long lists render a small window of fixed-height cards. Each sound groups the variants **on that page**, cycles them on successive play clicks, and downloads the selected variant through a blob (so cross-origin downloads save a file). The single waveform/player is created on play and released when changing pages. Language filtering applies to the loaded page; SFX have no language. A Portal badge shows the PlaySound name and opens its matching Portal card.

Search normally matches names, asset paths and Portal names on the loaded page. Optional global name search uses `index/search.json`; a missing or incompatible index disables only that feature. Global results (maximum 100 per query) link to category pages rather than loading their audio. The supported small search-index format is an array of `{name, category, page?, assetPath?, id?}` records, where `category` is the tree category ID and `page` uses the export's numbering. `{sounds:[...]}` and `{entries:[...]}` wrappers are also accepted. Omit `page` to open the category's first page. Search records should identify the page containing the sound.

The exporter is developed separately. To rebuild and upload, run that exporter against the decoded game assets into a staging directory with this layout:

```text
index/tree.json                 [{id,name,path,count,seconds,children:[...]}]
index/<category id>.json         {category,page,pages,clips:[...]}
index/<category id>.<page>.json   subsequent pages in the same format
index/search.json               optional small name/category/page lookup
audio/<path>.opus               referenced by clip.file relative to audio/
```

Each clip contains `{id,name,assetPath,variant,duration,channels,rate,codec,portalName,loop,file,bytes,lang}`. Use `null` for absent Portal names, loop metadata and language. The unsuffixed category file is the first page; its `page` value establishes zero-based or one-based numbering, and `pages` is the total page count. Keep all variants for a sound on one page where practical; otherwise cards intentionally show the current page's subset. Keep category IDs and audio paths stable across exports.

Verify every referenced file and page in staging, then upload the **contents** of `audio/` and `index/` to the same prefixes in the R2 bucket behind the configured public URL, using your authenticated R2/S3 upload tool or the Cloudflare dashboard. Upload audio first, category pages next, and publish `tree.json` and the optional search index last so they advertise available objects. Set JSON objects to `application/json` and Opus objects to `audio/ogg`. Check GET/HEAD access and the configured CORS origins after uploading; refresh cached indexes if replacing existing keys. The exporter and authenticated uploader are not shipped here, and this UI change does not upload the full game export.

For a small offline fixture, from this worktree:

```powershell
node make-game-fixture.cjs
node test-game-library.cjs
python -m http.server 8000
```

Visit `http://localhost:8000/?gameFixture=1` and select **Game Library**, or set `gameLibrary.useFixture: true` in `config.js` for local testing. Fixture overrides apply only on local hosts. The fixture has two categories, two Weapons pages, English/French language entries, a Portal link, a search index, and six 0.12-second synthetic Opus tones. It is not sampled game audio. Its generator defaults to `C:\Tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe`; set `FFMPEG` to override. To try the missing-search fallback locally, temporarily rename the fixture's `index/search.json` and reload, then restore it.

Headless Node checks cover index validation, nested categories, zero/one-based paging, cache eviction, search, language filtering, variant cycling/wrap, virtualization bounds, fixture Opus headers, UI paging/player/switch behavior, late-response cancellation and missing global-index fallback. They also reuse the existing Portal headless regression harness for manifest grouping, current card/dock downloads, all/category ZIP contents and preserved markers. Validation passed, including local Python HTTP GET/HEAD checks for 16 site/index/audio resources. No browser screenshots are used; real-browser listening and waveform rendering remain manual checks.

## Credits
Sounds are Battlefield 6 / EA DICE assets, surfaced for Portal modders. Sound tooling/API by **Aryo / Post (Sound)**.

Real SFX audio comes from the **BF6 Modding SDK audio export**, decoded losslessly before the site's Vorbis encoding. The three retained SFX recordings and announcer PlayVO recordings are by **TabbedScamper**.

## Battlefield UI presentation

The archive now uses the decoded front-end palette, hard corners, focus plates, layered readability scrims, local Battlefield fonts, loading-screen art and opt-in game UI sounds. Both library sections retain their playback, downloads and browsing behavior. The existing Bf6Revival control panel supplied the icon masking approach and decoded cues. This is an archive adapted to the game's visual language; it does not claim to reproduce the complete retail UI.

Reference: `BF6_Frostbite_Research/systems/FRONTEND_UI_1TO1_RECONSTRUCTION.md` sections 4 to 6, `UI_INDEX.md`, and `data/ui_color_palette.tsv`. Linear palette values are already transferred to sRGB: neutral/focus `#BFCAD1`, economy `#FFBD44`, positive `#8EED6C`, progression bonus `#59BFF8`, negative `#FB694D`. Hover uses its own 0.08 layer; selection uses 0.27. Screen width remains responsive; hero sizes are limited by viewport height rather than stretching a 1920×1080 canvas.

Motion is limited to control state changes using the decoded 250 ms linear timing, the dock and radar panel slide, and playback/download progress. Cards and content panels have no entrance animation. Loading indicators are plain static bars. Reduced motion disables CSS animation, transitions and smooth scrolling. Library totals display immediately.

**UI sounds** in the header default to OFF, remember the explicit choice under localStorage key `bf6-ui-sounds`, and play at volume 0.12 only following user interaction. Remembering ON does not play anything on load. Hover/slider cues are throttled, cue polyphony is bounded at four, and both audition engines stop existing cues and suppress new cues while loading/playing clips. Turning sounds off immediately stops cues; reduced motion leaves sounds opt-in. Failed or unavailable audio does not block controls. Section changes cancel pending Portal playback and prevent a late Game Library ready event from starting hidden playback.

All new visual/audio assets below are **Battlefield 6 / © EA & DICE** assets, used for reference and modding presentation, like the existing audio and fonts. The SVG is copied from Bf6Revival's local Portal mirror; seven WAVs are unchanged decoded files from its control panel. Existing `fonts/` assets are reused; no new font payloads were added.

| Added asset | Bytes | Source / purpose |
|---|---:|---|
| `assets/art/limestone.webp` | 175,726 | `common/ui/assets/images/loadingscreen/t_ui_limestone_01_loadingscreen`; backdrop, archive hero and default category header |
| `assets/art/tungsten.webp` | 97,846 | `common/ui/assets/images/loadingscreen/t_ui_tungsten_01_loadingscreen`; matching level category header |
| `assets/art/aftermath.webp` | 153,422 | `common/ui/assets/images/loadingscreen/t_ui_aftermath_01_loadingscreen`; matching level category header |
| `assets/ui/effects.svg` | 848 | `control-panel/portal/toolbox-actions-effects.svg`; header mark |
| `assets/ui/hover.wav` | 14,608 | `control-panel/sounds/hover.wav`; pointer hover |
| `assets/ui/select.wav` | 45,768 | `control-panel/sounds/select.wav`; control activation |
| `assets/ui/back.wav` | 54,832 | `control-panel/sounds/back.wav`; close/back |
| `assets/ui/tab_switch.wav` | 12,300 | `control-panel/sounds/tab_switch.wav`; library tabs |
| `assets/ui/toggle_on.wav` | 76,628 | `control-panel/sounds/toggle_on.wav`; enable |
| `assets/ui/toggle_off.wav` | 45,644 | `control-panel/sounds/toggle_off.wav`; checkbox disable |
| `assets/ui/slider_tick.wav` | 7,460 | `control-panel/sounds/slider_tick.wav`; slider changes |

Total added images including SVG: **427,842 bytes (0.428 MB)**; all added art and cues: **685,082 bytes (0.685 MB)**. The three 2560×1080 BC7 sRGB textures were exported read-only with bfreader `texture export`, decoded with `texture dds2png`, then resized to 1600×676 and encoded with ffmpeg `-c:v libwebp -quality 78`. Tungsten/Aftermath headers are selected by their identifier in the category path/name; other categories use the Limestone art.

Validation from this worktree:

```powershell
node test-game-library.cjs
node test-look.cjs
node --check app.js
node --check game-library.js
node --check ui-experience.js
```

The first command includes the existing Portal regression harness. Checks cover immediate totals under reduced motion, the sound toggle and persistence, no autoplay, playback mute lifecycle, and an ephemeral localhost HTTP server checking every referenced local asset (including all 6,531 Portal clips). No game process, EA service, browser screenshot or game-install write is needed.

Human review: listen to cue loudness on your speakers/headphones; check clip start/stop, loops and cue suppression in both sections; inspect actual WaveSurfer rendering and radar labels; try a narrow phone viewport and an ultrawide display; switch the OS reduced-motion preference while the site is open. Use `/?gameFixture=1` on localhost for offline Game Library checks; live category names and CDN availability can be checked against the R2 export.
