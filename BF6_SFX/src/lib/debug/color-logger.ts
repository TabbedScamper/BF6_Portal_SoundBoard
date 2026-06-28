/**
 * @purpose A scrolling event log where EACH LINE can have its own color (the base bf6-portal-utils Logger
 * paints every row in one fixed color). Used by the sound-capture console to colour-code events
 * (green = play, blue = navigate, yellow = queue, red = record, cyan = music, grey = info).
 *
 * How it works: Logger creates one UIText per 1-3 chars using its private `_textColor` at the moment a row
 * is filled, and scrolling only REPOSITIONS old rows (it never repaints them). So setting the colour right
 * before each log() makes that line keep its colour while later lines use a different one. We reach the
 * private field through a typed cast (it is a plain runtime property; `private` is compile-time only).
 *
 * Built on bf6-portal-utils Logger (per-character render). Keep logging event-driven, not per-tick.
 */
import { Logger } from "bf6-portal-utils/logger/index.ts";

/** The colour palette for log lines (BF-on-brand). r,g,b are 0-1; mirror UI.COLORS so callers need no import. */
export const LOG = {
  PLAY: mod.CreateVector(0.6784, 0.9922, 0.5255),   // BF green  -> audition / play
  NAV: mod.CreateVector(0.4392, 0.9216, 1.0),       // BF blue   -> navigation (next/prev/category/jump)
  QUEUE: mod.CreateVector(1.0, 0.9882, 0.6118),     // BF yellow -> queue add/remove
  REC: mod.CreateVector(1.0, 0.5137, 0.3804),       // BF red    -> recording lifecycle
  MUSIC: mod.CreateVector(0, 1, 1),                 // cyan      -> music / radio
  STOP: mod.CreateVector(1, 0, 0),                  // red       -> stop-all
  INFO: mod.CreateVector(0.8353, 0.9216, 0.9765),   // BF grey-1 -> system / info
  WARN: mod.CreateVector(1.0, 0.9882, 0.6118),      // yellow    -> warnings
  ERR: mod.CreateVector(1, 0, 0),                   // red       -> errors
};

export class ColorLogger extends Logger {
  /** Log one line in the given colour (defaults to INFO). Scrolling loggers (staticRows:false). */
  public logc(text: string, color: mod.Vector = LOG.INFO): this {
    (this as unknown as { _textColor: mod.Vector })._textColor = color;
    this.log(text);
    return this;
  }

  /** Write a FIXED row in the given colour (for static-row status bars). */
  public logcAt(text: string, rowIndex: number, color: mod.Vector = LOG.INFO): this {
    (this as unknown as { _textColor: mod.Vector })._textColor = color;
    this.log(text, rowIndex);
    return this;
  }
}
