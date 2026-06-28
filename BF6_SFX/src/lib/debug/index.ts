/** @purpose Debug kit barrel — telemetry emitter, live-tunable Debug Console, call instrumentation. */
export { Tlm, Throttle } from "./telemetry.ts";
export { DebugConsole, debug } from "./console.ts";
export type { TunableSpec } from "./console.ts";
export { instrument, calls } from "./callcount.ts";
export type { CallCategory } from "./callcount.ts";
export { StatHud } from "./stat-hud.ts";
export type { StatHudOptions } from "./stat-hud.ts";
export { ColorLogger, LOG } from "./color-logger.ts";
