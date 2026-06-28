/**
 * @purpose In-mod telemetry emitter — structured console.log lines the external tailer parses.
 *
 * A sandboxed Portal mod's only output channel is console.log -> PortalLog.txt (when "Host Locally").
 * Pairs with ../../../../PortalSDK/_DevTools/debug-bridge/tail_portal_log.py. Keep [TLM] throttled.
 */

type Val = number | string | boolean;

function fmt(obj: Record<string, Val>): string {
  const parts: string[] = [];
  for (const k in obj) {
    const v = obj[k];
    parts.push(typeof v === "string" && /\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`);
  }
  return parts.join(" ");
}

export const Tlm = {
  /** Periodic numeric sample, e.g. Tlm.sample({ tickMs, zCount, retargetMs }). Throttle this. */
  sample(fields: Record<string, Val>): void {
    console.log("[TLM] " + fmt(fields));
  },

  /** Discrete event, e.g. Tlm.event("hitRegistered", { rayId, dist, ms }). */
  event(name: string, fields: Record<string, Val> = {}): void {
    console.log("[EVT] " + fmt({ name, ...fields }));
  },

  /** Debug-tunable parameter state (mirror Debug Console values here). */
  param(name: string, val: number, min: number, max: number, step: number): void {
    console.log(`[PARAM] name=${name} val=${val} min=${min} max=${max} step=${step}`);
  },
};

/**
 * Fixed-cadence throttle so per-tick code can emit without flooding the log.
 * Inject a "now in seconds" supplier (e.g. mod.GetMatchTimeElapsed()) to stay engine-agnostic.
 *   const t = new Throttle(0.25);                  // 4 Hz
 *   if (t.ready(now)) Tlm.sample({ ... });
 */
export class Throttle {
  private next = 0;
  constructor(private periodSec: number) {}
  ready(nowSec: number): boolean {
    if (nowSec >= this.next) {
      this.next = nowSec + this.periodSec;
      return true;
    }
    return false;
  }
}
