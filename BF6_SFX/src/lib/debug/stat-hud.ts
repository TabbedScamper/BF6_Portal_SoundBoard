/**
 * @purpose ONLINE-SAFE telemetry HUD. console.log -> PortalLog.txt only works on LOCAL host; during
 * online/server play the script runs server-side and nothing reaches the local log, so the log-tail
 * goes dark. This renders metrics on-screen instead (UI is client-rendered, so it shows online too):
 * the player reads it live and can screenshot it to read the exact values.
 *
 * Cheap by design (the bf6-portal-utils Logger lagged because it deletes+rebuilds a UIText per char every
 * call). Here a FIXED set of UIText rows is created ONCE; updates are a single SetUITextLabel per row via
 * mod.Message. mod.Message renders a raw number natively and a format string takes up to 3 "{}" items, so
 * each row shows up to 3 live numbers with one native call -- call set() at ~1 Hz, never per tick.
 */
import { UIContainer } from "bf6-portal-utils/ui/components/container/index.ts";
import { UIText } from "bf6-portal-utils/ui/components/text/index.ts";
import { UI } from "bf6-portal-utils/ui/index.ts";

export interface StatHudOptions {
  width?: number;
  anchor?: mod.UIAnchor;
  textColor?: mod.Vector;
}

const ROW_H = 22;

export class StatHud {
  private readonly rows: UIText[] = [];

  public constructor(player: mod.Player, rowCount: number, opts?: StatHudOptions) {
    const width = opts?.width ?? 360;
    const panel = new UIContainer({
      receiver: player,
      width,
      height: rowCount * ROW_H + 12,
      anchor: opts?.anchor ?? mod.UIAnchor.TopLeft,
      bgColor: UI.COLORS.BLACK,
      bgFill: mod.UIBgFill.Blur,
      bgAlpha: 0.8,
      visible: true,
    });
    for (let i = 0; i < rowCount; i++) {
      this.rows.push(
        new UIText({
          receiver: player,
          parent: panel,
          x: 8,
          y: 6 + i * ROW_H,
          width: width - 16,
          height: ROW_H - 2,
          anchor: mod.UIAnchor.TopLeft,
          message: mod.Message(" "),
          textSize: 18,
          textColor: opts?.textColor ?? UI.COLORS.BF_GREEN_BRIGHT,
          textAnchor: mod.UIAnchor.CenterLeft,
        })
      );
    }
  }

  /** Update one row (single native SetUITextLabel). Build `message` with a "{}"-format mod.Message. */
  public set(row: number, message: mod.Message): void {
    const r = this.rows[row];
    if (r) r.message = message;
  }
}
