# Portal Announcer Voice-Overs (`PlayVO`) — what works, what doesn't

Hard-won notes on getting `mod.PlayVO(...)` announcer lines to actually play in a BF6 Portal experience. Most of
this is undocumented and several behaviours are engine bugs, so this is empirical — verified in-game.

## The working recipe (copy this)

```ts
// 1) Spawn the VO carriers ONCE, at game start (NOT right before you play them).
const VO_FLAGS = [
  mod.VoiceOverFlags.Alpha, mod.VoiceOverFlags.Bravo, mod.VoiceOverFlags.Charlie,
  mod.VoiceOverFlags.Delta, mod.VoiceOverFlags.Echo,  mod.VoiceOverFlags.Foxtrot,
  mod.VoiceOverFlags.Golf,  mod.VoiceOverFlags.Hotel, mod.VoiceOverFlags.India,
];
let carriers: mod.Object[] = [];

export function OnGameModeStarted(): void {
  for (let i = 0; i < VO_FLAGS.length; i++) {
    carriers.push(mod.SpawnObject(
      mod.RuntimeSpawn_Common.SFX_VOModule_OneShot2D,
      mod.CreateVector(0, 0, 0), mod.CreateVector(0, 0, 0), mod.CreateVector(0, 0, 0)));
  }
}

// 2) Play GLOBAL (no target) for objective/MCom; carrier[i] is permanently paired with flag[i].
function playObjectiveVO(event: mod.VoiceOverEvents2D, flagIndex: number): void {
  mod.PlayVO(carriers[flagIndex], event, VO_FLAGS[flagIndex]);   // 3 args = global
}
```

## The rules (each one cost a debugging session)

1. **The listener is the player's SOLDIER, not the camera.** A `FixedCamera` (or `Free` camera) **silences all
   VO** for that player — VO is heard by an embodied soldier. Use `FirstPerson` or `ThirdPerson`. (Positional
   `PlaySound` SFX *do* play through a `FixedCamera`; only `PlayVO` follows the soldier.) There is **no way to play
   VO "at" a camera** — `PlayVO`'s target only accepts `Player | Squad | Team`, never a camera.

2. **Play objective/MCom lines GLOBAL — no target.** The 3-arg form `PlayVO(carrier, event, flag)` works. Passing
   a **Player** target *silences* objective lines. Only **team-relative** lines need a target (see #6).

3. **The carrier must be spawned on an EARLIER frame than the `PlayVO` call.** Spawning the `SFX_VOModule` and
   calling `PlayVO` on it in the *same tick* produces no audio — the object isn't initialized yet. Spawn the pool
   at `OnGameModeStarted`.

4. **Pair each carrier with one flag for its whole life.** There's a flag-cache bug: a reused carrier can replay
   the flag from the *previous* `PlayVO` call. If `carrier[i]` only ever plays `flag[i]`, the flag is always
   consistent, so the bug never bites. (`carrier[0]`→Alpha, `carrier[1]`→Bravo, …)

5. **A flag item is ALWAYS required**, even for flag-less lines ("60 seconds remaining"). Pass `Alpha` as a dummy.
   An empty/null flag throws.

6. **Team-relative lines need a TEAM target.** Names containing Winning/Losing/Friendly/Enemy/Attacker/Defender
   render from a team's perspective and are silent played global. Pass the team:
   `PlayVO(carrier, event, flag, mod.GetTeam(player))`. Note `mod.GetTeam(1)` (by id) can be **invalid** depending
   on the gamemode and will throw — use the player's own team, `mod.GetTeam(player)`.

7. **There is a ~30-second per-event cooldown.** Repeating the *same* event within ~30s makes the game drop all but
   roughly every third call. If you need many flags of one event, **interleave events** (play one flag of every
   event, then the next flag) so no single event repeats inside the window.

8. **Lines have multiple random voice-actor variants.** Each `PlayVO` of the same (event, flag) may pick a
   different take. Trigger a few times if you want them all.

## What does NOT work (engine-side, not your code)

- **`*Generic` objective variants** (`ObjectiveCapturedGeneric`, `ObjectiveCapturedEnemyGeneric`, …) are silent.
- **`ObjectiveCapturing`** always says "Alpha" regardless of the flag.
- **Most broadcast lines** (`RoundStart*`, `Time*`, `Progress*`, `Global*`, `FirstSpawn*`, `Vehicle*Spawn`) only
  fire at the *real* match moment (clock threshold, score change, deploy). Force-playing them out of context is
  mostly silent. A few context-free callouts do play.
- The announcer also sometimes plays the **wrong** event/flag — a known, unfixed bug.

## Reliably-working set

The objective/MCom families play correctly with the recipe above (each across flags Alpha–India = on-screen A–I):
`ObjectiveCaptured`, `ObjectiveCapturedEnemy`, `ObjectiveContested`, `ObjectiveLocated`, `ObjectiveLockdownEnemy`,
`ObjectiveLockdownFriendly`, `ObjectiveLost`, `ObjectiveNeutralised`, and the `MCom*` arm/defuse/destroyed lines.
