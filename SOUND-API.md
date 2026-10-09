# BF6 Portal audio API and soundboard V2.00

Based on the SDK (`PortalSDK/code/types/mod/index.d.ts`) and Battlefield Portal Hub research by **Aryo / Post (Sound)**.

## Libraries

**Portal Sounds** lists the 937 sounds `mod.PlaySound` can play. 934 use real game audio with all 5,950 authored variants; three retain their original recordings. Announcer `PlayVO` lines use recordings and appear separately. The silent `SFX_VOModule_OneShot2D` carrier has no standalone clip.

**Game Library** contains every sound in the game: 287,216 clips across 14,637 sounds, about 195 hours. Categories follow the game's own folders and audio streams from Cloudflare R2. A Game Library clip is only available through Portal's `PlaySound` if it has a matching Portal asset name.

Audio is from **Battlefield 6 / © EA & DICE**, used for reference and modding.

## PlaySound

`PlaySound(sound, amplitude [, location, attenuationRange] [, team|squad|player])`

- **sound** is a spawned SFX object from `mod.RuntimeSpawn_Common`.
- **amplitude** is a gain multiplier. `1.0` is unity gain. It is not a percentage and cannot be changed during playback.
- **location** is a vector for 3D sounds. Spawn and play the object at the same position.
- **attenuationRange** approximates the distance at which the sound becomes silent. The game's attenuation curve varies by asset.
- **scope** chooses who hears the sound: omit it for everyone, or pass a team, squad or player.
- `StopSound(sound[, scope])` stops playback, including loops.
- `SetSoundAmplitude(...)` takes effect before `PlaySound`; it does not provide a runtime fade.

Portal scripts do not expose pitch, reverb, EQ, occlusion, stereo width or doppler controls for these sounds. Amplitude and range cannot be changed after `PlaySound` starts. Multiple spawned objects are needed for overlapping playback.

## Sound types and variants

`*_OneShot2D` and `*_OneShot3D` play once. 2D sounds are non-positional; 3D sounds use location and attenuation range. `*_SimpleLoop2D` and `*_SimpleLoop3D` repeat until `StopSound`.

The site cycles authored variants on each new play. Portal cards also have a **Try another variant** button. Game Library uses **Play next variant**. This is a browser audition control; the generated Portal call does not select a specific exported variant. Card and dock downloads save the current variant. Portal ZIPs contain every variant.

Game loops retain the full authored sample range and repeat through Web Audio. Retained recorded loops keep their existing matched loop points. An authored loop can still have an audible seam.

## Announcer

`PlayVO(voObject, event, flag [, team|squad|player])`

Spawn `SFX_VOModule_OneShot2D` as the carrier. Events come from `VoiceOverEvents2D` and flags from `VoiceOverFlags` (Alpha through India). Round, time and progress events ignore objective flags. Announcer cards group retained recordings by event and flag. Silent placeholders and unreliable warnings reflect behaviour observed during testing.

## Music

`LoadMusic(pkg)`, `PlayMusic(evt[,scope])`, `SetMusicParam(param,val[,scope])` and `UnloadMusic(pkg)` use a separate system. Parameters include music amplitude, `Core_Urgency` (0 to 3) and the Radio queue. Research found inconsistent scope behaviour; per-squad scope was the most reliable. Avoid updating music parameters every tick.

## RADAR and generated TypeScript

The dock's **RADAR** button opens the spatial panel. The centre dot is the listener. Drag the source dot to change angle and distance. The outer ring represents attenuation range in metres. The preview uses a Web Audio HRTF panner with linear falloff, so it approximates the game's asset-specific attenuation.

Amplitude controls preview gain and the generated amplitude argument. Master volume only affects browser playback. Scope only affects generated code.

For 3D sounds, the panel emits a relative position vector, `mod.SpawnObject` and `mod.PlaySound` with position, range and optional scope. Add the player's world position to the relative vector before using it in your script. For 2D sounds, the panel emits a spawn position and a non-positional `mod.PlaySound` call. Define the selected `player`, `squad` or `team` variable in your script. Copy the code with the panel's copy button. Use `mod.StopSound(sfx)` to stop a loop.
