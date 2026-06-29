/**
 * @purpose Sound CAPTURE console: audition every RuntimeSpawn SFX + Music/Radio in-game, then RECORD them to
 * disk-splittable runs. One FLAT list of all "SFX_" sounds (Next/Prev walk everything; Category jumps sections).
 * Each play prints the FULL name to console (PortalLog) so the splitter can place clips by their logged game-time.
 *
 * UI: a single BF6-themed console panel (triple-tap interact to open) — big transport buttons (Prev/Play/Next),
 * category selector, a "set starting track" jump (also = crash-resume), a QUEUE you build while browsing to record
 * specific sounds, record controls, and one big red STOP-EVERYTHING. A colour-coded scrolling log (ColorLogger)
 * shows what's happening; a 2-row status bar shows live counts + the current selection. Buttons click (a UI sound)
 * unless we're recording (so clicks never bleed into a capture).
 *
 * Capture model: SpawnObject at a high/isolated point + PlaySound at default volume with a huge attenuation range
 * (full volume map-wide); a FixedCamera is moved there and viewed through so listener foley stays off-body. An
 * SFX_Alarm marker plays first as the audio-sync anchor; every sound logs gt= (absolute game-time) so the splitter
 * places it at anchor + (gt - markerGt) with no drift. A capture is just a LIST of catalog indices (all / category /
 * current-to-end / queue), so any subset records the same way.
 */
import { Events } from "bf6-portal-utils/events/index.ts";
import { PerformanceStats } from "bf6-portal-utils/performance-stats/index.ts";
import { UI } from "bf6-portal-utils/ui/index.ts";
import { UIContainer } from "bf6-portal-utils/ui/components/container/index.ts";
import { UIText } from "bf6-portal-utils/ui/components/text/index.ts";
import { UITextButton } from "bf6-portal-utils/ui/components/text-button/index.ts";
import { MultiClickDetector } from "bf6-portal-utils/multi-click-detector/index.ts";
import { Tlm, instrument, ColorLogger, LOG } from "./lib/debug/index.ts";

const SK = (): typeof mod.stringkeys.snd => mod.stringkeys.snd;

const SFX_AMPLITUDE = 3.0;       // browse volume (loud, so auditions are obvious)
const SFX_RANGE = 30;
const AUTO_STOP_TICKS = 150;     // ~5s: oneshots finish, loops get cut so they don't pile up
const CLICK_STOP_TICKS = 30;     // UI click sound self-cleans quickly
const START_CATEGORY = "UI";     // open on a reliably-audible category

// ---- RECORD / capture ----
const CAPTURE_AMPLITUDE = 1.0;   // DEFAULT volume (not the loud 3.0 used for browsing)
const CAPTURE_RANGE = 10000;     // huge attenuation range -> full volume across the map regardless of listener pos
// You CANNOT SpawnObject a camera (open feature request). Instead: place a FixedCamera anywhere in the Godot map,
// put its ObjId here; the capture MOVES it to the capture point (SetObjectTransform) and views through it. -1 = off.
const CAPTURE_CAMERA_ID = 200;
const CAP_ONESHOT_SEC = 9;        // seconds for a typical one-shot
const CAP_ONESHOT_LONG_SEC = 16;  // for categories with unusually long one-shots (building collapses)
const LONG_ONESHOT_CATS = ["Destruction"];
const CAP_LOOP_SEC = 16;          // seconds for a loop (full period for the loop-point matcher)
const CAP_GAP_SEC = 0.6;          // real-time silence gap between sounds
const CAP_VO_SEC = 5;             // slot per announcer VO line (lines are ~2-4s; letters-outer order spaces repeats)
const VO_REPS = 4;                // play each (event,flag) this many times to capture the random voice-actor variants
const MATCH_EXTEND_SEC = 20;      // every sound played pushes the match time limit this far ahead
const CAPTURE_POS = (): mod.Vector => M.CreateVector(0, 150, 0); // high & isolated; (0,0,0) is UNDERGROUND here

// ---- VO ANNOUNCER ----
// Two things make VO actually play (from the user's working TDM playVO + a creator's block mod):
//  1) SPAWN A FRESH SFX_VOModule carrier for EVERY PlayVO call — a new object has no cached previous flag, so the
//     flag is always correct (the cache bug only bites a REUSED carrier).
//  2) PLAY IT TO THE TESTER PLAYER (PlayVO 4th arg = player). Many lines are TEAM-RELATIVE (winning/losing,
//     objective friendly/enemy) and are SILENT when played global; scoping to the recorder makes them audible.
// Objective*/MCom*/CheckPoint*/Sector* (non-Generic) loop the flag Alpha..India to capture all 9 letter variants;
// the rest play once. No placed objectives/capture points needed.

// ---- vehicles (in-car RADIO) ----
const VEHICLE_SPAWNER_IDS: number[] = [];
const VEHICLES = ["Vector", "GolfCart", "Cheetah", "Quadbike", "DirtBike", "Marauder", "Couch", "Flyer60", "RHIB"];

const FALLBACK_SFX: string[] = [
  "SFX_UI_Deploy_Screen_ActionSuccess_OneShot2D",
  "SFX_UI_Gamemode_Shared_LeadChange_Positive_OneShot2D",
  "SFX_Soldier_Damage_Bullet_Headshot_OneShot2D",
  "SFX_Alarm",
  "SFX_Gadgets_C4_Activate_OneShot3D",
];

const MUSIC_PACKAGES = ["Radio", "Core", "BR", "Gauntlet"];
const MUSIC_EVENTS = [
  "Core_Stinger_Positive", "Core_Stinger_RankUp", "Core_Stinger_Negative",
  "Core_Deploy_Loop", "Core_PhaseBegin", "Core_EndOfRound_Loop", "Core_Stop",
  "BR_InsertionJump", "BR_WonRound_Loop", "BR_Stop",
  "Gauntlet_Deploy", "Gauntlet_WonOperation_Loop", "Gauntlet_Stop",
];
const MUSIC_STOP_EVENTS = ["Radio_Stop", "Core_Stop", "BR_Stop", "Gauntlet_Stop"];
const RADIO_CHANNELS = ["0 HipHop", "1 Rock", "2 BF-Themes", "3 Reggaeton", "4 Biome", "5 Classical", "6 Pop"];
const RADIO_TRACK_COUNTS = [17, 18, 10, 2, 18, 32, 15];

let M: typeof mod;
let con: SoundConsole | undefined;
let tester: mod.Player | undefined;
let tick = 0;

// ONE flat list of all SFX (Next/Prev walk this); catNames/catStart give category jump points.
interface SfxEntry { name: string; cat: string; }
const allSfx: SfxEntry[] = [];
const catNames: string[] = [];
const catStart: number[] = [];
let sfxIdx = 0;

interface Active { obj: mod.Object; stopTick: number; }
const active: Active[] = [];

// capture state — a capture is just an ordered LIST of catalog indices
let capturing = false;
let capList: number[] = [];
let capPtr = 0;
let capNextTime = 0;       // real match-time (seconds) to advance to the next sound
let capLastCat = "";
let capStartGt = 0;        // game-time the alarm marker played -> the audio-sync anchor
let capCurGt = 0;          // game-time the current sound started
let capturePos: mod.Vector | undefined;
let capLabel = "";         // human label for the active run (for the log/status)

// the QUEUE: catalog indices the user picked while browsing, recorded with REC QUEUE
const recQueue: number[] = [];

// VO announcer capture (PlayVO of every VoiceOverEvents2D)
let voCapturing = false;
let voPlay = 0;       // running play counter
let voTotalPlays = 0; // total plays this run
let voList: { name: string; val: number }[] = [];          // ALL 61 announcer events
let voActive: { name: string; val: number }[] = [];        // the subset being recorded this run (current group)
// The play-plan, ordered LETTERS-OUTER / EVENTS-INNER: pass A plays one letter of every event, then pass B, etc.
// This spaces each event's repeats ~(events x gap) apart so they clear the ~30s announcer cooldown that drops
// rapid repeats of the SAME event (seen: ObjectiveCaptured A-I back-to-back only let A/D/G through). Matches the
// creator's working loop. Non-flag9 events (Generic/broadcast) appear once, in pass A only.
let voPlan: { name: string; val: number; li: number; v: number }[] = [];
let voStep = 0;
let voCarriers: mod.Object[] = []; // 9 VO carriers (one per flag), spawned ONCE at OnGameModeStarted (see spawnVoPool)
// VO GROUPS — pick a subset to record instead of all 61. "Objective"/"MCom" are the proven-working set.
const VO_GROUPS: { key: string; test: (n: string) => boolean }[] = [
  { key: "All", test: (): boolean => true },
  { key: "Objective", test: (n): boolean => /^Objective/.test(n) },
  { key: "MCom", test: (n): boolean => /^MCom/.test(n) },
  { key: "CheckPoint", test: (n): boolean => /^CheckPoint/.test(n) },
  { key: "Sector", test: (n): boolean => /^Sector/.test(n) },
  { key: "Broadcast", test: (n): boolean => !/^(Objective|MCom|CheckPoint|Sector)/.test(n) },
];
let voGroupIdx = 0;
function voGroupList(): { name: string; val: number }[] { buildVoList(); return voList.filter((e) => VO_GROUPS[voGroupIdx].test(e.name)); }
function voGroupCount(): number { let n = 0; for (const e of voGroupList()) n += isFlag9(e.name) ? VO_FLAGS.length : 1; return n; }
function stepVoGroup(d: number): void {
  voGroupIdx = ((voGroupIdx + d) % VO_GROUPS.length + VO_GROUPS.length) % VO_GROUPS.length;
  if (con) con.logc("VO group: " + VO_GROUPS[voGroupIdx].key + " (" + voGroupList().length + " events / " + voGroupCount() + " plays)", LOG.NAV);
}

let musicEvtIdx = 0;
let radioChannel = 0;
let radioTrack = 0;
let vehTypeIdx = 0;
const loadedPackages: Set<string> = new Set();

// a short UI sound played on button presses (resolved out of the live catalog)
let clickSnd: string | undefined;

const SV = (): typeof mod.SoldierStateVector => mod.SoldierStateVector;
const SB = (): typeof mod.SoldierStateBool => mod.SoldierStateBool;
const r1 = (n: number): number => Math.round(n * 10) / 10;

function cur(): SfxEntry | undefined { return allSfx[sfxIdx]; }
function curCatIndex(): number { const c = cur(); return c ? catNames.indexOf(c.cat) : 0; }
function catCount(i: number): number { return (i + 1 < catStart.length ? catStart[i + 1] : allSfx.length) - catStart[i]; }
function catEndOf(ci: number): number { return (ci + 1 < catStart.length ? catStart[ci + 1] : allSfx.length) - 1; }
/** Short display name: drop the "SFX_<cat>_" prefix. Full name still goes to console.log. */
function shortName(e: SfxEntry | undefined): string {
  if (!e) return "-";
  const pre = "SFX_" + e.cat + "_";
  return e.name.indexOf(pre) === 0 ? e.name.substring(pre.length) : e.name.replace("SFX_", "");
}
function tags(name: string): string {
  let t = name.indexOf("3D") >= 0 ? " 3D" : (name.indexOf("2D") >= 0 ? " 2D" : "");
  if (isLoop(name)) t += " LOOP";
  return t;
}

function buildCatalog(): void {
  let names: string[] = [];
  try {
    const keys = Object.keys(mod.RuntimeSpawn_Common as unknown as Record<string, unknown>);
    names = keys.filter((k): boolean => k.indexOf("SFX_") === 0);
  } catch (e) { Tlm.event("err", { where: "Object.keys", msg: ("" + e).slice(0, 60) }); }
  let usedFallback = false;
  if (names.length === 0) { names = FALLBACK_SFX.slice(); usedFallback = true; }
  const byCat: Map<string, string[]> = new Map();
  for (const n of names) {
    const parts = n.split("_");
    const cat = parts.length > 1 ? parts[1] : "Other";
    let arr = byCat.get(cat);
    if (!arr) { arr = []; byCat.set(cat, arr); }
    arr.push(n);
  }
  const sortedCats = Array.from(byCat.keys()).sort();
  allSfx.length = 0; catNames.length = 0; catStart.length = 0;
  for (const cat of sortedCats) {
    const items = byCat.get(cat) as string[];
    items.sort();
    catStart.push(allSfx.length);
    catNames.push(cat);
    for (const n of items) allSfx.push({ name: n, cat });
  }
  const sc = catNames.indexOf(START_CATEGORY);
  sfxIdx = sc >= 0 ? catStart[sc] : 0;
  resolveClickSound();
  console.log("[SND] catalog: " + allSfx.length + " SFX in " + catNames.length + " categories" + (usedFallback ? " (FALLBACK)" : ""));
  for (let i = 0; i < catNames.length; i++) console.log("[SND]   " + catNames[i] + ": " + catCount(i));
}

/** Pick a crisp UI sound for button clicks (navigate/hover, else select/confirm, else any UI 2D). */
function resolveClickSound(): void {
  const wants = (subs: string[]): string | undefined => {
    for (const e of allSfx) {
      if (e.cat !== "UI") continue;
      const lo = e.name.toLowerCase();
      for (const s of subs) if (lo.indexOf(s) >= 0) return e.name;
    }
    return undefined;
  };
  clickSnd = wants(["navigate", "rollover", "hover", "move"]) ?? wants(["select", "confirm", "button"]) ??
    (() => { for (const e of allSfx) if (e.cat === "UI" && e.name.indexOf("2D") >= 0) return e.name; return undefined; })();
}

function playerPos(): mod.Vector {
  if (tester && M.IsPlayerValid(tester)) { try { return M.GetSoldierState(tester, SV().GetPosition); } catch (e) { /* */ } }
  return M.CreateVector(0, 0, 0);
}

function stopAllSfx(): void {
  for (const a of active) {
    try { M.StopSound(a.obj as unknown as mod.SFX); } catch (e) { /* */ }
    try { M.UnspawnObject(a.obj); } catch (e) { /* */ }
  }
  active.length = 0;
}

/** A brief UI click sound — only when NOT recording, and it does NOT stop the audition that's playing. */
function uiClick(): void {
  if (capturing || voCapturing || !clickSnd || !M) return;
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[clickSnd];
  if (val === undefined) return;
  try {
    const pos = playerPos();
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, 1.0, pos, 50);
    active.push({ obj: sfx, stopTick: tick + CLICK_STOP_TICKS });
  } catch (e) { /* */ }
}

function playSfx(e: SfxEntry): void {
  if (!M || !tester) return;
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[e.name];
  if (val === undefined) { if (con) con.logc("INVALID " + shortName(e), LOG.ERR); return; }
  stopAllSfx();
  try {
    // In the booth we play at the camera/listener point with a huge range so auditions are always audible no matter
    // where the soldier actually auto-spawned; otherwise (camera off) play at the soldier with the normal range.
    const pos = capturePos ?? playerPos();
    const range = capturePos ? CAPTURE_RANGE : SFX_RANGE;
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, SFX_AMPLITUDE, pos, range);
    active.push({ obj: sfx, stopTick: tick + AUTO_STOP_TICKS });
    console.log("[SND] " + (sfxIdx + 1) + "/" + allSfx.length + "  " + e.name); // FULL name to copy
    if (con) con.logc("> " + shortName(e) + tags(e.name), LOG.PLAY);
    extendMatch();
  } catch (err) { if (con) con.logc("ERROR " + shortName(e), LOG.ERR); }
}

function playCurrent(): void { const e = cur(); if (e) playSfx(e); }
function stepSfx(d: number): void {
  if (allSfx.length === 0) return;
  sfxIdx = ((sfxIdx + d) % allSfx.length + allSfx.length) % allSfx.length;
  playCurrent();
}
/** Shift the current index WITHOUT playing — for "set starting track" / crash-resume. */
function jump(d: number): void {
  if (allSfx.length === 0) return;
  sfxIdx = ((sfxIdx + d) % allSfx.length + allSfx.length) % allSfx.length;
  if (con) con.logc("-> track " + (sfxIdx + 1) + "/" + allSfx.length + "  " + shortName(cur()), LOG.NAV);
}
function stepCat(d: number): void {
  if (catNames.length === 0) return;
  const ci = ((curCatIndex() + d) % catNames.length + catNames.length) % catNames.length;
  sfxIdx = catStart[ci];
  if (con) con.logc("== " + catNames[ci] + " (" + catCount(ci) + ") ==", LOG.NAV);
}

// ---- queue ----
function queueToggle(): void {
  const p = recQueue.indexOf(sfxIdx);
  if (p >= 0) { recQueue.splice(p, 1); if (con) con.logc("queue remove " + shortName(cur()) + "  (" + recQueue.length + ")", LOG.QUEUE); }
  else { recQueue.push(sfxIdx); if (con) con.logc("queue add " + shortName(cur()) + "  (" + recQueue.length + ")", LOG.QUEUE); }
}
function queueCat(): void {
  const ci = curCatIndex();
  const s = catStart[ci];
  const e = (ci + 1 < catStart.length ? catStart[ci + 1] : allSfx.length) - 1;
  let n = 0;
  for (let i = s; i <= e; i++) if (recQueue.indexOf(i) < 0) { recQueue.push(i); n++; }
  if (con) con.logc("queue add " + catNames[ci] + "  (+" + n + ", total " + recQueue.length + ")", LOG.QUEUE);
}
function queueClear(): void { recQueue.length = 0; if (con) con.logc("queue cleared", LOG.QUEUE); }

// ---- music ----
function curSquad(): mod.Squad | undefined {
  if (!tester) return undefined;
  try { return M.GetSquad(tester); } catch (e) { return undefined; }
}
function setMP(name: string, val: number): void {
  const p = (mod.MusicParams as unknown as Record<string, number>)[name];
  if (p === undefined) return;
  const sq = curSquad();
  try { if (sq) M.SetMusicParam(p as unknown as mod.MusicParams, val, sq); else M.SetMusicParam(p as unknown as mod.MusicParams, val); } catch (e) { /* */ }
}
function playME(name: string): void {
  const ev = (mod.MusicEvents as unknown as Record<string, number>)[name];
  if (ev === undefined) return;
  const sq = curSquad();
  try { if (sq) M.PlayMusic(ev as unknown as mod.MusicEvents, sq); else M.PlayMusic(ev as unknown as mod.MusicEvents); } catch (e) { /* */ }
}
function playMusicEvent(): void {
  const evt = MUSIC_EVENTS[musicEvtIdx % MUSIC_EVENTS.length];
  playME(evt);
  console.log("[SND] PlayMusic " + evt);
  if (con) con.logc("music " + evt, LOG.MUSIC);
  musicEvtIdx = (musicEvtIdx + 1) % MUSIC_EVENTS.length;
}
function radioPlayTrack(): void {
  setMP("Radio_Amplitude", 2.0);
  setMP("Radio_Channel", radioChannel);
  if (radioChannel === 4) setMP("Radio_Biome", 0);
  setMP("Radio_ContinueQueueOnTrackEnd", 1);
  setMP("Radio_LoopQueuedTracks", 1);
  playME("Radio_ClearQueue");
  setMP("Radio_QueueTrackNumber", radioTrack);
  playME("Radio_Play");
  console.log("[SND] Radio ch" + radioChannel + " track " + radioTrack);
  if (con) con.logc("RADIO " + RADIO_CHANNELS[radioChannel] + " trk " + radioTrack, LOG.MUSIC);
  radioTrack = (radioTrack + 1) % RADIO_TRACK_COUNTS[radioChannel];
}
function radioChannelNext(): void {
  radioChannel = (radioChannel + 1) % RADIO_CHANNELS.length;
  radioTrack = 0;
  setMP("Radio_Channel", radioChannel);
  if (con) con.logc("radio ch: " + RADIO_CHANNELS[radioChannel], LOG.MUSIC);
}

function stopEverything(): void {
  stopAllSfx();
  for (const evt of MUSIC_STOP_EVENTS) playME(evt);
  capturing = false; voCapturing = false;
  // VO carrier pool persists (reused across runs, must outlive any single REC) — not unspawned here
  if (con) con.show(); else assertBooth(); // stay in the booth + reopen the panel; never strand the operator
  console.log("[SND] STOP EVERYTHING");
  if (con) con.logc("** STOP EVERYTHING **", LOG.STOP);
}

// ---- RECORD / capture ----
function isLoop(name: string): boolean { return name.indexOf("Loop") >= 0; }
function gt3(t: number): string { return ("" + (Math.round(t * 1000) / 1000)); }
/** Push the match time limit out so a long recording can't end mid-sweep. */
function extendMatch(): void {
  if (!M) return;
  try {
    const limit = M.GetRoundTime();
    const now = M.GetMatchTimeElapsed();
    const base = limit > now ? limit : now;
    M.SetGameModeTimeLimit(base + MATCH_EXTEND_SEC);
  } catch (e) { /* */ }
}

function capturePlay(e: SfxEntry): void {
  const val = (mod.RuntimeSpawn_Common as unknown as Record<string, number>)[e.name];
  if (val === undefined) { console.log("[CAP] INVALID " + e.name); return; }
  stopAllSfx();
  try {
    const pos = capturePos ?? playerPos();
    const sfx = M.SpawnObject(val as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(sfx as unknown as mod.SFX, CAPTURE_AMPLITUDE, pos, CAPTURE_RANGE);
    active.push({ obj: sfx, stopTick: tick + 999999 });
    extendMatch();
  } catch (err) { console.log("[CAP] ERROR " + e.name + ": " + ("" + err).slice(0, 40)); }
}

/** Build the index list for the chosen mode and start a run. */
function startCapture(mode: "all" | "cat" | "from" | "queue"): void {
  if (allSfx.length === 0) return;
  let list: number[] = [];
  let label = "";
  if (mode === "all") { for (let i = 0; i < allSfx.length; i++) list.push(i); label = "ALL " + allSfx.length; }
  else if (mode === "cat") { const ci = curCatIndex(); for (let i = catStart[ci]; i <= catEndOf(ci); i++) list.push(i); label = catNames[ci] + " " + list.length; }
  else if (mode === "from") { const end = catEndOf(curCatIndex()); for (let i = sfxIdx; i <= end; i++) list.push(i); label = catNames[curCatIndex()] + " from #" + (sfxIdx - catStart[curCatIndex()] + 1); }
  else { list = recQueue.slice(); label = "QUEUE " + list.length; }
  if (list.length === 0) { if (con) con.logc("nothing to record: " + label, LOG.WARN); return; }
  capList = list; capPtr = 0; capLabel = label;
  beginCaptureRun();
}

/** Put the operator in the capture BOOTH: point the map-placed FixedCamera at the isolated capture point and view
 *  through it, so the audio listener is off-body (idle foley stays far away). Sets capturePos as the listener anchor.
 *  Called on spawn, whenever the panel is shown, and after a recording ends — the operator is never stranded. */
function assertBooth(): void {
  if (!M || !tester) return;
  capturePos = CAPTURE_POS();
  if (CAPTURE_CAMERA_ID < 0) return; // no FixedCamera placed -> sounds just play at the soldier (still audible)
  try {
    const cam = M.GetFixedCamera(CAPTURE_CAMERA_ID);
    M.SetObjectTransform(cam as unknown as mod.Object, M.CreateTransform(capturePos, M.CreateVector(0, 0, 0)));
    M.SetCameraTypeForPlayer(tester, mod.Cameras.Fixed, CAPTURE_CAMERA_ID);
  } catch (e) { console.log("[CAP] camera err " + ("" + e).slice(0, 50)); }
}

/** Play the SFX_Alarm audio-sync marker at the booth point (start of every capture run). */
function playMarker(): void {
  const pos = capturePos ?? CAPTURE_POS();
  const markVal = (mod.RuntimeSpawn_Common as unknown as Record<string, number>).SFX_Alarm;
  if (markVal === undefined) return;
  try {
    const m = M.SpawnObject(markVal as unknown as mod.RuntimeSpawn_Common, pos, M.CreateVector(0, 0, 0), M.CreateVector(1, 1, 1)) as unknown as mod.Object;
    M.PlaySound(m as unknown as mod.SFX, CAPTURE_AMPLITUDE, pos, CAPTURE_RANGE);
    active.push({ obj: m, stopTick: tick + 25 });
  } catch (e) { /* */ }
}

function beginCaptureRun(): void {
  capturing = true;
  capLastCat = "";
  if (con) con.close(); // close the panel so UI-input mode doesn't block the capture view
  assertBooth();        // ensure the FixedCamera is at the capture point and we're viewing through it
  capStartGt = M.GetMatchTimeElapsed(); // ANCHOR: the alarm marker's game-time == its audio onset in the recording
  capNextTime = capStartGt + 1.0;       // ~1s real lead-in before the first sound
  capCurGt = capStartGt;
  playMarker();
  console.log("[CAP] MARKER SFX_Alarm gt=" + gt3(capStartGt) + "  (audio-sync anchor)");
  extendMatch();
  console.log("[CAP] ===== RECORDING START (marker=SFX_Alarm) " + capList.length + " sounds [" + capLabel + "] =====");
  if (con) con.logc("REC " + capLabel + " - start OBS now", LOG.REC);
}

function stopCapture(): void {
  capturing = false;
  stopAllSfx();
  if (con) con.show(); else assertBooth(); // back to the booth + reopen the panel (never strand the operator)
  console.log("[CAP] ===== RECORDING STOPPED =====");
  if (con) con.logc("recording stopped", LOG.REC);
}

function captureTick(): void {
  const now = M.GetMatchTimeElapsed();
  if (!capturing || now < capNextTime) return;
  if (capPtr >= capList.length) { stopCapture(); return; }
  const gi = capList[capPtr];
  const e = allSfx[gi];
  if (e.cat !== capLastCat) { capLastCat = e.cat; console.log("[CAP] === CATEGORY " + e.cat + " ==="); }
  // gt= is the absolute game-time the sound starts -> the splitter places it at anchor + (gt - capStartGt). No drift.
  console.log("[CAP] " + (gi + 1) + "/" + allSfx.length + " gt=" + gt3(now) + " dt=" + gt3(now - capStartGt) + " [" + e.cat + "] " + e.name + (isLoop(e.name) ? " (LOOP)" : ""));
  capCurGt = now;
  if (con) con.logc("rec " + (capPtr + 1) + "/" + capList.length + " " + shortName(e) + tags(e.name), LOG.REC);
  capturePlay(e);
  const slotSec = isLoop(e.name) ? CAP_LOOP_SEC : (LONG_ONESHOT_CATS.indexOf(e.cat) >= 0 ? CAP_ONESHOT_LONG_SEC : CAP_ONESHOT_SEC);
  capNextTime = now + slotSec + CAP_GAP_SEC;
  capPtr++;
}

// ---- VO announcer capture ----
// The bundler INLINES VoiceOverEvents2D member access (const-enum style): only STATIC references resolve, so every
// event is listed by name here (same pattern the official mods + vip_escort_script use).
function buildVoList(): void {
  if (voList.length > 0) return;
  const add = (name: string, val: mod.VoiceOverEvents2D): void => { voList.push({ name, val: val as unknown as number }); };
  // Ordered by how reliably they BROADCAST (2026 Discord: the announcer VO is buggy/random, no context fixes it).
  // TIER 1 -- broadcast state lines that play with no live objective (record these; most are audible):
  add("GlobalAircraftAvailable", mod.VoiceOverEvents2D.GlobalAircraftAvailable); // confirmed audible
  add("GlobalEOMVictory", mod.VoiceOverEvents2D.GlobalEOMVictory);               // confirmed audible
  add("GlobalEOMDefeat", mod.VoiceOverEvents2D.GlobalEOMDefeat);                 // confirmed audible
  add("GlobalAirstrikeWarning", mod.VoiceOverEvents2D.GlobalAirstrikeWarning);
  add("GlobalOutOfBounds", mod.VoiceOverEvents2D.GlobalOutOfBounds);
  add("FirstSpawn", mod.VoiceOverEvents2D.FirstSpawn);
  add("FirstSpawnDefender", mod.VoiceOverEvents2D.FirstSpawnDefender);
  add("PlayerCountFriendlyLow", mod.VoiceOverEvents2D.PlayerCountFriendlyLow);
  add("PlayerCountEnemyLow", mod.VoiceOverEvents2D.PlayerCountEnemyLow);
  add("VehicleArmoredSpawn", mod.VoiceOverEvents2D.VehicleArmoredSpawn);
  add("VehicleTankSpawn", mod.VoiceOverEvents2D.VehicleTankSpawn);
  add("RoundStartGeneric", mod.VoiceOverEvents2D.RoundStartGeneric);
  add("RoundEndFriendlyKills", mod.VoiceOverEvents2D.RoundEndFriendlyKills);
  add("RoundEndEnemyKills", mod.VoiceOverEvents2D.RoundEndEnemyKills);
  add("RoundEndFriendlyCapture", mod.VoiceOverEvents2D.RoundEndFriendlyCapture);
  add("RoundEndEnemyCapture", mod.VoiceOverEvents2D.RoundEndEnemyCapture);
  add("RoundLastRound", mod.VoiceOverEvents2D.RoundLastRound);
  add("RoundSuddenDeath", mod.VoiceOverEvents2D.RoundSuddenDeath);
  add("RoundSwitchSides", mod.VoiceOverEvents2D.RoundSwitchSides);
  add("Time120Left", mod.VoiceOverEvents2D.Time120Left);
  add("Time60Left", mod.VoiceOverEvents2D.Time60Left);
  add("Time30Left", mod.VoiceOverEvents2D.Time30Left);
  add("TimeLow", mod.VoiceOverEvents2D.TimeLow);
  add("TimeOvertime", mod.VoiceOverEvents2D.TimeOvertime);
  add("ProgressEarlyWinning", mod.VoiceOverEvents2D.ProgressEarlyWinning);
  add("ProgressEarlyLosing", mod.VoiceOverEvents2D.ProgressEarlyLosing);
  add("ProgressMidWinning", mod.VoiceOverEvents2D.ProgressMidWinning);
  add("ProgressMidLosing", mod.VoiceOverEvents2D.ProgressMidLosing);
  add("ProgressLateWinning", mod.VoiceOverEvents2D.ProgressLateWinning);
  add("ProgressLateLosing", mod.VoiceOverEvents2D.ProgressLateLosing);
  // TIER 2 -- objective family: buggy (engine caches/randomises the flag), needs the placed CapturePoints/MCOMs:
  add("ObjectiveCaptured", mod.VoiceOverEvents2D.ObjectiveCaptured);
  add("ObjectiveCapturedGeneric", mod.VoiceOverEvents2D.ObjectiveCapturedGeneric);
  add("ObjectiveCapturedEnemy", mod.VoiceOverEvents2D.ObjectiveCapturedEnemy);
  add("ObjectiveCapturedEnemyGeneric", mod.VoiceOverEvents2D.ObjectiveCapturedEnemyGeneric);
  add("ObjectiveCapturing", mod.VoiceOverEvents2D.ObjectiveCapturing);
  add("ObjectiveContested", mod.VoiceOverEvents2D.ObjectiveContested);
  add("ObjectiveLocated", mod.VoiceOverEvents2D.ObjectiveLocated);
  add("ObjectiveLockdownFriendly", mod.VoiceOverEvents2D.ObjectiveLockdownFriendly);
  add("ObjectiveLockdownEnemy", mod.VoiceOverEvents2D.ObjectiveLockdownEnemy);
  add("ObjectiveLost", mod.VoiceOverEvents2D.ObjectiveLost);
  add("ObjectiveNeutralised", mod.VoiceOverEvents2D.ObjectiveNeutralised);
  add("ObjectiveTerritoryTaken", mod.VoiceOverEvents2D.ObjectiveTerritoryTaken);
  add("ObjectiveTerritoryTakenGeneric", mod.VoiceOverEvents2D.ObjectiveTerritoryTakenGeneric);
  add("ObjectiveTerritoryLost", mod.VoiceOverEvents2D.ObjectiveTerritoryLost);
  add("ObjectiveTerritoryLostGeneric", mod.VoiceOverEvents2D.ObjectiveTerritoryLostGeneric);
  add("MComArmFriendly", mod.VoiceOverEvents2D.MComArmFriendly);
  add("MComArmEnemy", mod.VoiceOverEvents2D.MComArmEnemy);
  add("MComDefuseFriendly", mod.VoiceOverEvents2D.MComDefuseFriendly);
  add("MComDefuseEnemy", mod.VoiceOverEvents2D.MComDefuseEnemy);
  add("MComDestroyedFriendly", mod.VoiceOverEvents2D.MComDestroyedFriendly);
  add("MComDestroyedEnemy", mod.VoiceOverEvents2D.MComDestroyedEnemy);
  add("MComDestroyedOneLeftFriendly", mod.VoiceOverEvents2D.MComDestroyedOneLeftFriendly);
  add("MComDestroyedOneLeftEnemy", mod.VoiceOverEvents2D.MComDestroyedOneLeftEnemy);
  // TIER 3 -- need a LIVE Breakthrough advance/retreat flow; effectively always silent in a sandbox (grouped last):
  add("CheckPointFriendly", mod.VoiceOverEvents2D.CheckPointFriendly);
  add("CheckPointFriendlyAnother", mod.VoiceOverEvents2D.CheckPointFriendlyAnother);
  add("CheckPointEnemy", mod.VoiceOverEvents2D.CheckPointEnemy);
  add("CheckPointEnemyAnother", mod.VoiceOverEvents2D.CheckPointEnemyAnother);
  add("CheckPointMovingToLastFriendly", mod.VoiceOverEvents2D.CheckPointMovingToLastFriendly);
  add("CheckPointMovingToLastEnemy", mod.VoiceOverEvents2D.CheckPointMovingToLastEnemy);
  add("SectorTakenAttacker", mod.VoiceOverEvents2D.SectorTakenAttacker);
  add("SectorTakenDefender", mod.VoiceOverEvents2D.SectorTakenDefender);
  console.log("[VO] " + voList.length + " announcer events (first val=" + (voList.length ? voList[0].val : "?") + ")");
}
// 9 flags Alpha..India + their letters; one dedicated VO carrier per flag is spawned per run.
const VO_FLAGS: mod.VoiceOverFlags[] = [
  mod.VoiceOverFlags.Alpha, mod.VoiceOverFlags.Bravo, mod.VoiceOverFlags.Charlie, mod.VoiceOverFlags.Delta,
  mod.VoiceOverFlags.Echo, mod.VoiceOverFlags.Foxtrot, mod.VoiceOverFlags.Golf, mod.VoiceOverFlags.Hotel, mod.VoiceOverFlags.India,
];
const VO_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
/** Objective/MCom (and experimentally CheckPoint/SectorTaken) speak an objective LETTER -> capture all 9 (A-I).
 *  "Generic" variants have no letter. CheckPoint/Sector are unproven (creator only did Objective+MCom) but harmless
 *  to try — they sit last in the run, so silent ones are easy to skip. */
function isFlag9(name: string): boolean { return /^(Objective|MCom|CheckPoint|SectorTaken)/.test(name) && name.indexOf("Generic") < 0; }
/** Team-relative lines (winning/losing/friendly/enemy/attacker/defender) need a TEAM target so the engine knows
 *  whose perspective to render; everything else is targeted at the player (audible at the camera). */
function isTeamRel(name: string): boolean { return /(Winning|Losing|Friendly|Enemy|Attacker|Defender|Attacking|Defending|Kills|Capture)/i.test(name); }
/** Spawn the 9 VO carriers ONCE at OnGameModeStarted (one per flag A..I), like the.postminimalist + the creator.
 *  CRITICAL: a VO carrier must be spawned on an EARLIER frame than the PlayVO call — spawning + playing in the
 *  same tick produces NO audio (the object isn't initialized yet). This was the silent-objective bug. Idempotent. */
function spawnVoPool(): void {
  if (!M || voCarriers.length >= VO_FLAGS.length) return;
  const voVal = (mod.RuntimeSpawn_Common as unknown as Record<string, number>).SFX_VOModule_OneShot2D;
  for (let i = voCarriers.length; i < VO_FLAGS.length; i++) {
    try { voCarriers.push(M.SpawnObject(voVal as unknown as mod.RuntimeSpawn_Common, M.CreateVector(0, 0, 0), M.CreateVector(0, 0, 0), M.CreateVector(0, 0, 0)) as unknown as mod.Object); } catch (e) { /* */ }
  }
}
/** Play one VO using the PRE-SPAWNED carrier for flag index `li` (never spawn-and-play same tick).
 *  target = undefined => GLOBAL (3-arg, proven for objective/MCom/broadcast); team-relative lines pass a TEAM. */
function playVoOne(val: number, flag: mod.VoiceOverFlags, li: number, target: unknown): void {
  const carrier = voCarriers[li] ?? voCarriers[0];
  try {
    if (carrier && target) M.PlayVO(carrier as unknown as mod.VO, val as unknown as mod.VoiceOverEvents2D, flag, target as mod.Player);
    else if (carrier) M.PlayVO(carrier as unknown as mod.VO, val as unknown as mod.VoiceOverEvents2D, flag);
  } catch (err) { /* logged by caller */ }
}

function startVoCapture(): void {
  voActive = voGroupList(); // only the selected group (default "All")
  if (voActive.length === 0) { if (con) con.logc("no VO events in group " + VO_GROUPS[voGroupIdx].key, LOG.WARN); return; }
  // Build the play-plan. Outer = variant rep (1..VO_REPS) so each (event,flag) is captured VO_REPS times to grab
  // the random voice-actor variants; within each rep, LETTERS-OUTER / EVENTS-INNER (pass A = one letter of every
  // event, then pass B, ...) so the same event never repeats within the ~30s announcer cooldown.
  voPlan = [];
  for (let rep = 1; rep <= VO_REPS; rep++) {
    for (let L = 0; L < VO_FLAGS.length; L++) {
      for (const e of voActive) {
        const f9 = isFlag9(e.name);
        if (!f9 && L > 0) continue; // non-flag9 events have no letter -> one per rep, in pass A only
        voPlan.push({ name: e.name, val: e.val, li: f9 ? L : 0, v: rep });
      }
    }
  }
  capturing = false; voCapturing = true; voStep = 0; voPlay = 0; capLastCat = "";
  voTotalPlays = voPlan.length;
  if (con) con.close();
  // VO ONLY: stay a LIVE SOLDIER (FirstPerson), NOT the FixedCamera. The FixedCamera silences PlayVO — the VO
  // listener is the player's soldier (proven: votest as a soldier plays all 17; harness on the booth cam is
  // silent). There's no visual to frame for VO anyway. Marker + listener move to the soldier's position.
  try { if (tester) M.SetCameraTypeForPlayer(tester, mod.Cameras.FirstPerson); } catch (e) { /* */ }
  capturePos = playerPos();
  spawnVoPool();        // ensure carriers exist (normally spawned at OnGameModeStarted, well before this REC)
  capStartGt = M.GetMatchTimeElapsed();
  capNextTime = capStartGt + 1.0;
  capCurGt = capStartGt;
  playMarker();
  console.log("[CAP] MARKER SFX_Alarm gt=" + gt3(capStartGt) + "  (audio-sync anchor)");
  extendMatch();
  console.log("[CAP] ===== RECORDING START (VO group " + VO_GROUPS[voGroupIdx].key + ") " + voTotalPlays + " plays / " + voActive.length + " events =====");
  if (con) con.logc("REC " + VO_GROUPS[voGroupIdx].key + " " + voTotalPlays + " VO lines - start OBS now", LOG.REC);
}
function voCaptureTick(): void {
  const now = M.GetMatchTimeElapsed();
  if (!voCapturing || now < capNextTime) return;
  if (voStep >= voPlan.length) { stopVoCapture(); return; }
  const p = voPlan[voStep];
  const f9 = isFlag9(p.name);
  if (capLastCat !== "Announcer") { capLastCat = "Announcer"; console.log("[CAP] === CATEGORY Announcer ==="); }
  // name encodes event + flag-letter + variant: VO_<event>_<A..I>_v<n>  (non-flag9: VO_<event>_v<n>)
  const nm = (f9 ? ("VO_" + p.name + "_" + VO_LETTERS[p.li]) : ("VO_" + p.name)) + "_v" + p.v;
  voPlay++;
  console.log("[CAP] " + voPlay + "/" + voTotalPlays + " gt=" + gt3(now) + " dt=" + gt3(now - capStartGt) + " [Announcer] " + nm);
  capCurGt = now;
  if (con) con.logc("rec VO " + voPlay + "/" + voTotalPlays + " " + (f9 ? p.name + " " + VO_LETTERS[p.li] : p.name) + " v" + p.v, LOG.REC);
  // target: GLOBAL (no target) by default — the two PROVEN working examples (the.postminimalist + the creator's
  // script) play objective/MCom VO global with 3 args; a player target silences them. Only team-relative lines
  // (winning/losing/friendly/enemy/...) get a TEAM target (TDM-proven) so the engine renders the right perspective.
  let voTarget: unknown = undefined;
  if (tester && isTeamRel(p.name)) { try { voTarget = M.GetTeam(tester); } catch (err) { voTarget = undefined; } }
  playVoOne(p.val, VO_FLAGS[p.li], p.li, voTarget);
  extendMatch();
  capNextTime = now + CAP_VO_SEC + CAP_GAP_SEC;
  voStep++;
}
function stopVoCapture(): void {
  voCapturing = false;
  stopAllSfx();
  // VO carrier pool persists (reused across runs, must outlive any single REC) — not unspawned here
  assertBooth();                 // restore the FixedCamera booth (VO put us on FirstPerson)
  if (con) con.show(); // reopen the panel
  console.log("[CAP] ===== RECORDING STOPPED =====");
  if (con) con.logc("VO recording stopped", LOG.REC);
}

// ---- vehicles ----
function spawnVehicles(): void {
  if (VEHICLE_SPAWNER_IDS.length === 0) { if (con) con.logc("set VEHICLE_SPAWNER_IDS first", LOG.WARN); return; }
  const typeName = VEHICLES[vehTypeIdx % VEHICLES.length];
  const tv = (mod.VehicleList as unknown as Record<string, number>)[typeName];
  let n = 0;
  for (const id of VEHICLE_SPAWNER_IDS) {
    try {
      const sp = M.GetVehicleSpawner(id);
      if (!sp) continue;
      if (tv !== undefined) M.SetVehicleSpawnerVehicleType(sp, tv as unknown as mod.VehicleList);
      M.ForceVehicleSpawnerSpawn(sp);
      n++;
    } catch (e) { /* */ }
  }
  if (con) con.logc("spawned " + typeName + " x" + n, LOG.INFO);
}

// ====================================================================================================
// SoundConsole — the BF6-themed control panel (built on bf6-portal-utils UI components + ColorLogger).
//
// HOW TO MODIFY (for other users):
//  - Buttons are declared as data in the constructor: this.row([{ label, color, on, help }, ...]). Each row is a
//    set of equal-width buttons. To add a button, add another { } to a row (≤4 per row reads best) or add a new
//    this.row([...]). `label` is a strings.json key under snd.btn (the visible text); `color` is the text colour;
//    `on` is what it does; `help` is the one-line explanation shown in-game in the HELP bar when you hover it.
//  - Every button shows its `help` text in the bottom HELP bar on hover (onFocusIn) — so the panel is
//    self-documenting in-game. Keep help to one sentence: what it does + how it behaves.
//  - Colours use UI.COLORS (BF palette). Log line colours use LOG.* (see color-logger.ts).
//  - Layout is anchored to the panel CENTRE so it scales with the safe area. The status bar + colour-coded log
//    sit OUTSIDE the panel (top-right) so they stay visible while recording, even with the panel hidden.
// ====================================================================================================
const PANEL_W = 740;
const PANEL_H = 560;
const HEAD_H = 46;
const PAD = 16;
const ROW_H = 38;
const GAP = 8;
const HELP_Y = 394; // y (inside the content region) where the in-game HELP bar sits, below all the buttons

interface BtnDef { label: string; color: mod.Vector; on: () => void; help: string; }

// palette
const C_PANEL = UI.COLORS.BF_GREY_4;
const C_HEAD = UI.COLORS.BF_RED_BRIGHT;
const C_BTN = UI.COLORS.BF_GREY_3;
const C_HOVER = UI.COLORS.BF_GREY_2;
const C_PRESS = UI.COLORS.BF_BLUE_DARK;
const T_NAV = UI.COLORS.BF_BLUE_BRIGHT;
const T_PLAY = UI.COLORS.BF_GREEN_BRIGHT;
const T_QUEUE = UI.COLORS.BF_YELLOW_BRIGHT;
const T_REC = UI.COLORS.BF_RED_BRIGHT;
const T_MUSIC = UI.COLORS.CYAN;
const T_INFO = UI.COLORS.BF_GREY_1;

class SoundConsole {
  private readonly player: mod.Player;
  private readonly root: UIContainer;
  private readonly content: UIContainer;
  private readonly log: ColorLogger;
  private readonly status: ColorLogger;
  private readonly help: UIText; // bottom HELP bar: shows each button's explanation (strings.json) on hover
  private y = 0; // running layout cursor inside content
  private lastS0 = "";
  private lastS1 = "";
  private lastHelp = "";

  public constructor(player: mod.Player) {
    this.player = player;

    // always-visible colour-coded event log (top-right)
    this.log = new ColorLogger(player, {
      staticRows: false, truncate: true, visible: true,
      anchor: mod.UIAnchor.TopRight, x: 16, y: 92, width: 470, height: 540,
      bgColor: C_PANEL, bgAlpha: 0.78, bgFill: mod.UIBgFill.Blur,
    });
    // always-visible 2-row status bar (top-right, above the log): row0 selection, row1 counts/REC
    this.status = new ColorLogger(player, {
      staticRows: true, truncate: true, visible: true,
      anchor: mod.UIAnchor.TopRight, x: 16, y: 16, width: 470, height: 64,
      bgColor: C_PANEL, bgAlpha: 0.85, bgFill: mod.UIBgFill.Blur,
    });

    // the panel (hidden until triple-tap)
    this.root = new UIContainer({
      receiver: player, width: PANEL_W, height: PANEL_H, anchor: mod.UIAnchor.Center,
      bgColor: C_PANEL, bgFill: mod.UIBgFill.Blur, bgAlpha: 0.9,
      visible: false, uiInputModeWhenVisible: true,
    });
    // header gradient + title
    new UIContainer({
      receiver: player, parent: this.root, x: 0, y: 0, width: PANEL_W, height: HEAD_H,
      anchor: mod.UIAnchor.TopCenter, bgColor: C_HEAD, bgFill: mod.UIBgFill.GradientLeft, bgAlpha: 1,
    });
    new UIText({
      receiver: player, parent: this.root, x: PAD, y: 0, width: PANEL_W - PAD * 2, height: HEAD_H,
      anchor: mod.UIAnchor.TopLeft, textAnchor: mod.UIAnchor.CenterLeft, textSize: 24,
      textColor: UI.COLORS.BLACK, message: mod.Message(SK().title),
    });
    // content region below the header
    this.content = new UIContainer({
      receiver: player, parent: this.root, x: 0, y: HEAD_H + 6, width: PANEL_W, height: PANEL_H - HEAD_H - 6,
      anchor: mod.UIAnchor.TopCenter, bgFill: mod.UIBgFill.None, bgAlpha: 0,
    });
    // bottom HELP bar: a frosted panel + a text line that every button updates (via strings.json) on hover
    new UIContainer({
      receiver: player, parent: this.content, x: PAD, y: HELP_Y, width: PANEL_W - PAD * 2, height: 96,
      anchor: mod.UIAnchor.TopLeft, bgColor: UI.COLORS.BF_BLUE_DARK, bgAlpha: 0.6, bgFill: mod.UIBgFill.Blur,
    });
    this.help = new UIText({
      receiver: player, parent: this.content, x: PAD + 12, y: HELP_Y + 10, width: PANEL_W - PAD * 2 - 24, height: 76,
      anchor: mod.UIAnchor.TopLeft, textAnchor: mod.UIAnchor.TopLeft, textSize: 16,
      textColor: UI.COLORS.BF_GREY_1, message: mod.Message(SK().help.idle),
    });

    const b = SK().btn;
    const h = SK().help;
    // ---- TRANSPORT: audition sounds ----
    this.row([
      { label: b.prev, color: T_NAV, on: (): void => stepSfx(-1), help: h.prev },
      { label: b.play, color: T_PLAY, on: playCurrent, help: h.play },
      { label: b.next, color: T_NAV, on: (): void => stepSfx(1), help: h.next },
      { label: b.qToggle, color: T_QUEUE, on: queueToggle, help: h.qToggle },
    ]);
    // ---- CATEGORY + QUEUE management ----
    this.row([
      { label: b.catPrev, color: T_NAV, on: (): void => stepCat(-1), help: h.catPrev },
      { label: b.catNext, color: T_NAV, on: (): void => stepCat(1), help: h.catNext },
      { label: b.qCat, color: T_QUEUE, on: queueCat, help: h.qCat },
      { label: b.qClear, color: T_QUEUE, on: queueClear, help: h.qClear },
    ]);
    // ---- SET STARTING TRACK (silent jump; also crash-resume) ----
    this.row([
      { label: b.jM10, color: T_NAV, on: (): void => jump(-10), help: h.jM10 },
      { label: b.jM1, color: T_NAV, on: (): void => jump(-1), help: h.jM1 },
      { label: b.jP1, color: T_NAV, on: (): void => jump(1), help: h.jP1 },
      { label: b.jP10, color: T_NAV, on: (): void => jump(10), help: h.jP10 },
    ]);
    this.gap(6);
    // ---- RECORD controls ----
    this.row([
      { label: b.recCat, color: T_REC, on: (): void => startCapture("cat"), help: h.recCat },
      { label: b.recFrom, color: T_REC, on: (): void => startCapture("from"), help: h.recFrom },
      { label: b.recQueue, color: T_REC, on: (): void => startCapture("queue"), help: h.recQueue },
    ]);
    this.row([
      { label: b.recAll, color: T_REC, on: (): void => startCapture("all"), help: h.recAll },
      { label: b.recStop, color: T_REC, on: (): void => { stopCapture(); stopVoCapture(); }, help: h.recStop },
    ]);
    // ---- VO group: pick a subset (Objective/MCom = proven) then REC VO GROUP ----
    this.row([
      { label: b.voGrpPrev, color: T_NAV, on: (): void => stepVoGroup(-1), help: h.voGrp },
      { label: b.voGrpNext, color: T_NAV, on: (): void => stepVoGroup(1), help: h.voGrp },
      { label: b.recVO, color: T_REC, on: startVoCapture, help: h.recVO },
    ]);
    this.gap(6);
    // ---- MUSIC / RADIO ----
    this.row([
      { label: b.radio, color: T_MUSIC, on: radioPlayTrack, help: h.radio },
      { label: b.radioCh, color: T_MUSIC, on: radioChannelNext, help: h.radioCh },
      { label: b.musEvt, color: T_MUSIC, on: playMusicEvent, help: h.musEvt },
    ]);
    this.gap(10);
    this.bigBtn(52, SK().btn.stopAll, 22, UI.COLORS.BF_RED_BRIGHT, UI.COLORS.BF_RED_DARK, UI.COLORS.RED, (): void => stopEverything(), h.stopAll);
    this.bigBtn(28, SK().btn.close, 16, T_INFO, C_BTN, C_PRESS, (): void => this.close(), h.close);

    new MultiClickDetector(player, (): void => this.toggle());
    this.showHelp(h.idle);
    this.status.logcAt("triple-tap INTERACT to hide / show this panel", 0, T_INFO);
  }

  /** One row of equal-width buttons. */
  private row(items: BtnDef[]): void {
    const n = items.length;
    const cw = (PANEL_W - PAD * 2 - GAP * (n - 1)) / n;
    items.forEach((it, i) => this.mkBtn(PAD + i * (cw + GAP), this.y, cw, ROW_H, it));
    this.y += ROW_H + GAP;
  }
  private gap(amount: number): void { this.y += amount; }

  /** A full-width button (STOP EVERYTHING / HIDE) with its own colours + hover help. */
  private bigBtn(height: number, label: string, textSize: number, textColor: mod.Vector, base: mod.Vector, hot: mod.Vector, on: () => void, help: string): void {
    const w = PANEL_W - PAD * 2;
    const btn = new UITextButton({
      receiver: this.player, parent: this.content, x: PAD, y: this.y, width: w, height,
      anchor: mod.UIAnchor.TopLeft, bgColor: base, baseColor: base,
      message: mod.Message(label), textSize, textColor,
      onClickUp: (): void => { uiClick(); on(); },
    });
    btn.focusedColor = hot; btn.pressedColor = hot;
    btn.onFocusIn = (): void => this.showHelp(help);
    this.y += height + GAP;
  }

  private mkBtn(x: number, y: number, w: number, h: number, def: BtnDef): void {
    const btn = new UITextButton({
      receiver: this.player, parent: this.content, x, y, width: w, height: h,
      anchor: mod.UIAnchor.TopLeft, bgColor: C_BTN, baseColor: C_BTN,
      message: mod.Message(def.label), textSize: 17, textColor: def.color,
      onClickUp: (): void => { uiClick(); def.on(); },
    });
    btn.focusedColor = C_HOVER; btn.pressedColor = C_PRESS;
    btn.onFocusIn = (): void => this.showHelp(def.help); // self-documenting: explain the button in-game on hover
  }

  /** Show a button's explanation (strings.json key) in the bottom HELP bar (only when it changed). */
  private showHelp(key: string): void {
    if (key === this.lastHelp) return;
    this.lastHelp = key;
    this.help.message = mod.Message(key);
  }

  public logc(text: string, color?: mod.Vector): void { this.log.logc(text, color); }

  /** Refresh the persistent status bar (called ~2 Hz). Only rewrites a row when its text changed. */
  public refresh(rate: number): void {
    const e = cur();
    const s0 = e ? "[" + e.cat + "] " + shortName(e) + tags(e.name) : "-";
    let s1: string;
    let c1: mod.Vector;
    if (capturing) { s1 = "REC " + capPtr + "/" + capList.length + "  gt " + Math.round(capCurGt - capStartGt) + "s  [" + capLabel + "]"; c1 = T_REC; }
    else if (voCapturing) { s1 = "REC VO " + voPlay + "/" + voTotalPlays + "  gt " + Math.round(capCurGt - capStartGt) + "s"; c1 = T_REC; }
    else { s1 = "sfx " + (sfxIdx + 1) + "/" + allSfx.length + "   cat " + (curCatIndex() + 1) + "/" + catNames.length + "   VO grp: " + VO_GROUPS[voGroupIdx].key + "   q " + recQueue.length; c1 = T_INFO; }
    if (s0 !== this.lastS0) { this.lastS0 = s0; this.status.logcAt(s0, 0, capturing || voCapturing ? T_REC : T_PLAY); }
    if (s1 !== this.lastS1) { this.lastS1 = s1; this.status.logcAt(s1, 1, c1); }
  }

  public toggle(): void { if (this.root.visible) this.close(); else this.show(); }
  // show() re-asserts the booth camera every time, so reopening the panel can never leave the operator stranded.
  public show(): void { assertBooth(); this.root.visible = true; mod.EnableUIInputMode(true, this.player); uiClick(); }
  public close(): void { this.root.visible = false; mod.EnableUIInputMode(false, this.player); }
}

// ---- setup ----
/** Build the catalog + console once (first deploy). */
function ensureConsole(player: mod.Player): void {
  if (con) return;
  buildCatalog();
  con = new SoundConsole(player);
  con.logc("catalog: " + allSfx.length + " SFX in " + catNames.length + " categories", T_INFO);
  con.logc("auto-deployed to the capture booth - hover any button for help", T_INFO);
  Tlm.event("harnessReady", { stage: "sound-console", total: allSfx.length });
}
/** Run on EVERY (auto)deploy: build once, put the operator in the booth with the panel open. */
function enterBooth(player: mod.Player): void {
  tester = player;
  // NOTE: do NOT SetTeam here — GetTeam(1) returns an INVALID team in this gamemode and SetTeam throws
  // ("team input being invalid", seen in PortalLog). The player is already auto-assigned to a valid team on
  // deploy; team-relative VO lines use M.GetTeam(tester) (that valid team) as the target in voCaptureTick.
  ensureConsole(player);
  assertBooth();
  if (con) con.show();
}

// ---- wiring ----
Events.OnGameModeStarted.subscribe((): void => {
  M = instrument(mod);
  console.log("[TLM] harness-sound OnGameModeStarted");
  // AUTO-DEPLOY: skip the deploy screen so the operator spawns straight into the booth (official pattern, as in
  // the BumperCars / AcePursuit example mods). OnPlayerDeployed then puts them on the camera with the panel open.
  try { M.SetSpawnMode(mod.SpawnModes.AutoSpawn); } catch (e) { /* */ }
  spawnVoPool(); // spawn the 9 VO carriers NOW (game start) so they're initialized long before any PlayVO
  for (const pkg of MUSIC_PACKAGES) {
    const v = (mod.MusicPackages as unknown as Record<string, number>)[pkg];
    if (v !== undefined) {
      try {
        M.LoadMusic(v as unknown as mod.MusicPackages);
        loadedPackages.add(pkg);
        const ap = (mod.MusicParams as unknown as Record<string, number>)[pkg + "_Amplitude"];
        if (ap !== undefined) M.SetMusicParam(ap as unknown as mod.MusicParams, 2.0);
      } catch (e) { /* */ }
    }
  }
  console.log("[SND] preloaded music: " + Array.from(loadedPackages).join(", "));
});
Events.OnPlayerDeployed.subscribe((player: mod.Player): void => {
  if (!M) return;
  try {
    if (M.GetSoldierState(player, SB().IsAISoldier)) return;
    enterBooth(player); // every (auto)deploy re-asserts the booth camera + reopens the panel
  } catch (e) { Tlm.event("err", { where: "OnPlayerDeployed", msg: ("" + e).slice(0, 80) }); }
});
Events.OngoingGlobal.subscribe((): void => {
  if (!M || !con) return;
  try {
    tick++;
    if (active.length > 0) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (tick >= active[i].stopTick) {
          try { M.StopSound(active[i].obj as unknown as mod.SFX); } catch (e) { /* */ }
          try { M.UnspawnObject(active[i].obj); } catch (e) { /* */ }
          active.splice(i, 1);
        }
      }
    }
    if (capturing) captureTick();
    else if (voCapturing) voCaptureTick();
    if (tick % 15 === 0) con.refresh(r1(PerformanceStats.getSpotTickRate()));
  } catch (e) { Tlm.event("err", { where: "OngoingGlobal", tick: tick, msg: ("" + e).slice(0, 80) }); }
});
