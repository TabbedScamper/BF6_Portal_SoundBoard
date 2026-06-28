/**
 * @purpose Native-call instrumentation — count every mod.* call by category and emit per-window
 * telemetry, so we can SEE call volume vs zombie count (the #1 thing that lagged the old mod).
 *
 * Usage (bring in instrument + calls from this module, then):
 *   const M = instrument(mod);        // use M.* instead of mod.* everywhere in hot paths
 *   // ... gameplay calls M.AISetTarget(...), M.GetObjectPosition(...), etc.
 *   // once per second from OngoingGlobal:
 *   calls.flush(zombieCount, tickMs);
 *
 * Overhead: one Proxy get (cached) + one counter bump per call — fine for debug. For a release
 * build use raw `mod` (e.g. `const M = DEBUG ? instrument(mod) : mod;`) so instrumentation is zero-cost.
 *
 * VERIFY IN-GAME: QuickJS Proxy/Reflect support. If unavailable, fall back to thin manual wrappers
 * around the hot functions (AISetTarget/AIMoveToBehavior/RayCast/GetObjectPosition).
 */
import { Tlm } from "./telemetry.ts";

export type CallCategory = "ai" | "raycast" | "query" | "mutate" | "ui" | "other";

function categorize(name: string): CallCategory {
  if (name === "RayCast" || name.indexOf("RayCast") !== -1) return "raycast";
  if (name.indexOf("AI") === 0 || name === "SetAiInput" || name.indexOf("SpawnAI") === 0) return "ai";
  if (name.indexOf("UI") !== -1) return "ui";
  if (/^(Get|All|Is|Has|Distance|Closest|Farthest|Compare|Count|Angle|Dot|Cross)/.test(name)) return "query";
  if (/^(Set|Add|Move|Rotate|Orbit|Spawn|Unspawn|Deal|Kill|Heal|Teleport|Force|Enable|Display|Play|Stop|Resupply|Deploy|Undeploy|Send|Remove|Delete)/.test(name)) return "mutate";
  return "other";
}

class CallCounter {
  enabled = true;
  private total = 0;
  private byCat: Record<string, number> = {};
  private byFn: Record<string, number> = {};

  bump(name: string): void {
    if (!this.enabled) return;
    this.total++;
    const c = categorize(name);
    this.byCat[c] = (this.byCat[c] || 0) + 1;
    this.byFn[name] = (this.byFn[name] || 0) + 1;
  }

  /** Top-N most-called functions this window (for finding the worst offenders). */
  top(n: number): Array<[string, number]> {
    return Object.entries(this.byFn).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  totalCalls(): number {
    return this.total;
  }

  reset(): void {
    this.total = 0;
    this.byCat = {};
    this.byFn = {};
  }

  /** Emit a window summary as [TLM] (normalized per zombie) and reset the window. */
  flush(zombieCount: number, tickMs?: number): void {
    const c = this.byCat;
    const fields: Record<string, number> = {
      calls: this.total,
      callsPerZ: zombieCount > 0 ? Math.round((this.total / zombieCount) * 100) / 100 : 0,
      ai: c.ai || 0,
      raycast: c.raycast || 0,
      query: c.query || 0,
      mutate: c.mutate || 0,
      ui: c.ui || 0,
      zCount: zombieCount,
    };
    if (tickMs !== undefined) fields.tickMs = Math.round(tickMs * 100) / 100;
    Tlm.sample(fields);
    this.reset();
  }
}

/** Shared singleton counter for an experience. */
export const calls = new CallCounter();

/**
 * Wrap a mod-like namespace so every function call increments `calls`. Wrappers are memoized per
 * key, so repeated access to the same function is cheap. Pass-through for non-function members.
 */
export function instrument<T extends object>(ns: T): T {
  const cache = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(ns, {
    get(target, prop, receiver): unknown {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function" || typeof prop !== "string") return v;
      let w = cache.get(prop);
      if (!w) {
        const name = prop;
        const fn = v as (...args: unknown[]) => unknown;
        w = (...args: unknown[]): unknown => {
          calls.bump(name);
          return fn.apply(target, args);
        };
        cache.set(prop, w);
      }
      return w;
    },
  }) as T;
}
