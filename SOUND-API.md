# BF6 Portal — what code can control about audio

Researched from the SDK (`PortalSDK/code/types/mod/index.d.ts`) + Discord corpus (esp. **Aryo / Post (Sound)**, who builds the Portal sound tools). This drives the soundboard's "Spatial Preview / Options" panel — the goal is a faithful in-game preview that also emits the exact `PlaySound` call.

## The whole controllable surface (that's it)
`PlaySound(sound, amplitude [, location, attenuationRange] [, team|squad|player])`

- **amplitude** — a gain MULTIPLIER, not a 0–100 volume. Aryo: *"It's attenuation, not volume … a multiplier … I forgot to clamp it for PlaySound, so you could … make someone go deaf by setting it to 50."* Unity ≈ `1.0`. 2D examples use larger values; negative just inverts phase (sounds the same). **Not clampable mid-play.**
- **location** (`Vector`) — only for 3D sounds. The SFX object must be spawned and played at the same spot.
- **attenuationRange** — roughly the distance at which the sound becomes silent. Aryo: *"how far away you have to go for it to become silent, but it's approximate because the exact attenuation is different per-sound."* **Not linear; the curve varies per asset.** Default is small (~1); use ~100 for far reach.
- **scope** — last arg picks who hears it: omit = everyone, or `team` / `squad` / `player`.
- **StopSound(sound[, scope])** — stop a (usually looping) sound.
- `SetSoundAmplitude(...)` only takes effect BEFORE `PlaySound` — there is **no runtime fade**.

## NOT possible via script (confirmed)
Pitch / repitch, reverb, EQ / low-pass / occlusion, stereo panning width, doppler, and changing amplitude or range after `PlaySound`. Crossfades must be done by spawning multiple SFX objects.

## 2D vs 3D vs loop (naming convention, not flags)
- `*_OneShot2D` / `*_OneShot3D` — play once. 2D = non-positional (UI/global); 3D = positional, needs location+range.
- `*_SimpleLoop2D` / `*_SimpleLoop3D` — loop until `StopSound`.

## Voice-over / announcer (separate system)
`PlayVO(voObject, event, flag [, team|squad|player])` — the match announcer. `voObject` = a spawned
`SFX_VOModule_OneShot2D` (the single VOModule sound is just this carrier; `GetVO` is useless). `event` =
`VoiceOverEvents2D` (61 game-action callouts: objective captured/contested/lost, MCOM arm/defuse, round
start/sudden-death/switch-sides, progress winning/losing, time 120/60/30/overtime, sector taken, vehicle spawns,
EOM victory/defeat, …). `flag` = `VoiceOverFlags` Alpha–India (the objective letter spoken; round/time/progress
events ignore it). Quirks: historically always said "Alpha" (patched 1.1.3.0), a few Generic events are silent,
Hotel/India support only some events. The harness "Record VO announcers" mode PlayVO's all 61 events so they land
on the board as the **Announcer** category (clips named `VO_<Event>`).

## Music (separate system)
`LoadMusic(pkg)` → `PlayMusic(evt[,scope])` / `SetMusicParam(param,val[,scope])` → `UnloadMusic(pkg)`. Params include `*_Amplitude` (default ~0, must set), `Core_Urgency` (0–3), and the Radio_* queue. Per-scope is buggy (often applies globally); per-squad most reliable. Don't update every tick.

## How the soundboard approximates this
- **Amplitude slider** = the `amplitude` arg (preview gain = master × amplitude; capped for ears, true value shown in the code snippet).
- **Radar** = the `location`: player (listener) at center; click/drag places the sound; angle + distance map to a Web Audio `PannerNode` (HRTF). North = forward.
- **Range ring** = `attenuationRange`: the outer circle radius in metres; preview uses a `linear` distance model (silent at the ring). Labeled approximate, since in-game falloff differs per sound.
- **Scope dropdown** only changes the generated code (preview is always local).
- The panel emits a copy-paste `mod.PlaySound(...)` line for the current settings.
