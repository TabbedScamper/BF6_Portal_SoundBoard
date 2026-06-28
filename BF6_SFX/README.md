# BF6_SFX — sound-capture harness

The in-game Portal tool that captured every sound on the **BF6 Portal Soundboard**. It auditions and records
the whole `RuntimeSpawn_Common` SFX catalog (plus music/radio and announcer voice-overs) so they can be split
into per-sound clips. Structured as a self-contained single-experience Portal project.

```
BF6_SFX/
  src/
    index.ts            # the harness (wiring + the in-game console UI)
    strings.json        # button/HUD labels
    lib/debug/          # small reusable debug kit (colour log, telemetry, perf HUD, …)
  levels/BF6_SFX.tscn           # the Godot capture level (open in the BF6 Portal Godot project)
  spatials/BF6_SFX.spatial.json # exported level data (regenerate from the .tscn via Godot)
  dist/                 # built, upload-ready script + strings (bundle.ts / bundle.strings.json)
```

## Build

```bash
npm install
npm run build      # -> dist/bundle.ts + dist/bundle.strings.json
npm run typecheck
```

Upload `dist/bundle.ts` as the experience script and `dist/bundle.strings.json` as its strings, and use the
`BF6_SFX` level (open `levels/BF6_SFX.tscn` in the BF6 Portal Godot project, **Export Current Level**, upload).

## The capture level (objects placed in `BF6_SFX.tscn`)

| ObjId | Object | Purpose |
|------:|--------|---------|
| 200 | FixedCamera | the "booth" — capture point the listener views through (off-body, no idle foley) |
| 300–304 | CapturePoint A–E | referents so `Objective*` announcer VO has something to speak about |
| 310, 311 | MCOM | referents for `MCom*` announcer VO |
| 320 | Sector | wraps the capture points + MCOMs (sector/checkpoint VO context) |

> Edited the `.tscn`? Re-run **Export Current Level** in Godot to regenerate `spatials/BF6_SFX.spatial.json`
> (it is a build artifact — do not hand-edit it).

## How sounds are grabbed (and how we know we have them all)

- **Catalog = source of truth.** At runtime the harness reads every `SFX_*` entry out of the `RuntimeSpawn_Common`
  enum (the SDK's full asset list for the current Portal version), groups them by category, and walks the flat list.
  Coverage is therefore complete by construction for that SDK version.
- **Recording.** Pick *Record category / from-here / queue / all*. The harness deploys you into the booth, plays an
  `SFX_Alarm` **marker** as an audio-sync anchor, then plays each sound at a fixed game-time, logging one line per
  sound: `[CAP] <n>/<total> gt=<sec> dt=<sec> [<cat>] <name>`. Record the game audio (OBS) alongside.
- **Splitting.** The companion `tools/sound-split` splitter reads that log and the recording, detects audible onsets,
  and places each clip at `anchor + dt` (drift-free), flagging silent slots. `tools/soundboard` then loop-matches
  and builds the site manifest.

## Notes

- The announcer **voice-over** lines are unreliable on the live build (engine plays the wrong/no line at random —
  a known, still-open issue) — only a handful actually broadcast. They are captured best-effort and flagged on the site.
- Music/radio is **not** captured here: radio is licensed third-party music (copyright), so it is intentionally left
  off the public soundboard.
