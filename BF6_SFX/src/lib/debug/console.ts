/**
 * @purpose Debug Console — registry of live-tunable params, mirrored to telemetry.
 *
 * The value-tuning core of the debug loop: define a knob (min/max/step/value), read it in gameplay
 * code, adjust it live in-game, and every change is emitted as a [PARAM] line so the external tailer
 * sees the current value. The on-screen overlay + input bindings are built later (research-gated) on
 * top of this registry — see ../../../../PortalSDK/_Research/guides/ui-events-audio-vfx.md.
 */
import { Tlm } from "./telemetry.ts";

export interface TunableSpec {
  min: number;
  max: number;
  step: number;
  value: number;
}

export class DebugConsole {
  private params = new Map<string, TunableSpec>();

  /** Register a tunable knob and emit its initial state. */
  define(name: string, spec: TunableSpec): void {
    this.params.set(name, { ...spec });
    Tlm.param(name, spec.value, spec.min, spec.max, spec.step);
  }

  /** Current value of a knob (throws if undefined — fail loud during dev). */
  get(name: string): number {
    const p = this.params.get(name);
    if (!p) throw new Error("unknown debug param: " + name);
    return p.value;
  }

  /** Set a clamped value and emit the new [PARAM] state. */
  set(name: string, value: number): void {
    const p = this.params.get(name);
    if (!p) throw new Error("unknown debug param: " + name);
    p.value = Math.max(p.min, Math.min(p.max, value));
    Tlm.param(name, p.value, p.min, p.max, p.step);
  }

  /** Nudge a knob by ±1 step (for the eventual up/down input bindings). */
  adjust(name: string, dir: 1 | -1): void {
    const p = this.params.get(name);
    if (!p) return;
    this.set(name, p.value + dir * p.step);
  }

  names(): string[] {
    return [...this.params.keys()];
  }

  // TODO(research-gated): on-screen overlay (AddUIContainer + cached AddUIText rows refreshed from
  // OngoingGlobal) and input binding (OnPlayerUIButtonEvent / key detection) to select + adjust knobs
  // live. Read _Research/guides/ui-events-audio-vfx.md (§ live debug overlay) before building.
}

/** Shared singleton console for an experience. */
export const debug = new DebugConsole();
