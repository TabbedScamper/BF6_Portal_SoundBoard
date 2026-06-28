/**
 * @purpose Reusable in-game DEBUG MENU (the primary driver for our test/limits harnesses).
 * Triple-tap interact (deluca MultiClickDetector) opens a sectioned menu; pick a section -> its test
 * actions; a live readout panel (Logger) shows metrics. Built on bf6-portal-utils UI components
 * (blur panel + BF palette = pretty). Drill-down model (section list <-> section actions) keeps the
 * layout single-column and robust. See _Research/guides/portal-ui-guide.md.
 *
 * Requires the bf6-portal-utils EVENTS model: the experience uses the `Events` module (which provides the
 * native On* entrypoints) and SUBSCRIBES; it must NOT define its own On* handlers. The UI components +
 * MultiClickDetector subscribe to button/input events through that bus automatically.
 * (Note: avoid the words i-m-p-o-r-t / e-x-p-o-r-t in comments — the bundler strips comment lines that look
 *  like module statements, which can delete a comment's closing marker. See DECISIONS.md.)
 *
 * Labels are mod.Message (predefined strings.json keys). Readout text is arbitrary (Logger renders it).
 */
import { Logger } from "bf6-portal-utils/logger/index.ts";
import { UIContainer } from "bf6-portal-utils/ui/components/container/index.ts";
import { UITextButton } from "bf6-portal-utils/ui/components/text-button/index.ts";
import { UI } from "bf6-portal-utils/ui/index.ts";
import { MultiClickDetector } from "bf6-portal-utils/multi-click-detector/index.ts";

export interface MenuAction {
  label: mod.Message;
  onClick: (player: mod.Player) => void;
}
export interface MenuSection {
  label: mod.Message;
  actions: MenuAction[];
  /** Called each tick while this section is the active/open one; return readout rows for the panel. */
  readout?: () => string[];
}

const ROW_H = 26;
const W = 340;

export class DebugMenu {
  private readonly player: mod.Player;
  private readonly logger: Logger;
  private readonly root: UIContainer;
  private readonly listPage: UIContainer; // the section chooser
  private readonly sectionPages: UIContainer[] = [];
  private readonly sections: MenuSection[] = [];

  public constructor(player: mod.Player, openLabel: mod.Message, closeLabel: mod.Message, backLabel: mod.Message) {
    this.player = player;

    // Event log ONLY (action results / errors), appended on demand. NOT a per-tick readout:
    // Logger.log() deletes+rebuilds a row and spawns a UIText per 1-3 chars, so rewriting it every
    // tick lagged the whole UI. Dynamic (append+scroll) rows; live metrics go to console.log instead.
    this.logger = new Logger(player, {
      staticRows: false,
      truncate: true,
      visible: true,
      anchor: mod.UIAnchor.TopRight,
      width: 460,
      height: 380,
      textColor: UI.COLORS.BF_GREEN_BRIGHT,
      bgAlpha: 0.8,
      bgFill: mod.UIBgFill.Blur,
    });

    this.root = new UIContainer({
      receiver: player,
      width: W + 20,
      height: 460,
      anchor: mod.UIAnchor.Center,
      bgColor: UI.COLORS.BLACK,
      bgFill: mod.UIBgFill.Blur,
      bgAlpha: 0.85,
      visible: false,
      uiInputModeWhenVisible: true,
    });

    // gradient accent header
    new UIContainer({
      receiver: player,
      parent: this.root,
      x: 0,
      y: 0,
      width: W + 20,
      height: 6,
      anchor: mod.UIAnchor.TopCenter,
      bgColor: UI.COLORS.BF_RED_BRIGHT,
      bgFill: mod.UIBgFill.GradientLeft,
      bgAlpha: 1,
    });

    // section-chooser page (buttons added in addSection)
    this.listPage = new UIContainer({
      receiver: player,
      parent: this.root,
      x: 0,
      y: 14,
      width: W,
      height: 420,
      anchor: mod.UIAnchor.TopCenter,
      bgFill: mod.UIBgFill.None,
      bgColor: UI.COLORS.BLACK,
      bgAlpha: 0,
      visible: true,
    });

    // shared Close button (bottom)
    new UITextButton({
      receiver: player,
      parent: this.root,
      x: 0,
      y: 0,
      width: W,
      height: 24,
      anchor: mod.UIAnchor.BottomCenter,
      bgColor: UI.COLORS.GREY_25,
      baseColor: UI.COLORS.BLACK,
      message: closeLabel,
      textSize: 16,
      textColor: UI.COLORS.BF_RED_BRIGHT,
      onClickUp: (): void => this.close(),
    });

    this.backLabel = backLabel;
    void openLabel; // reserved for a future header label

    // triple-tap interact opens the menu
    new MultiClickDetector(player, (): void => this.show());
  }

  private readonly backLabel: mod.Message;

  /** Register a section: a chooser button + a hidden page holding its action buttons (+ Back). */
  public addSection(section: MenuSection): void {
    const idx = this.sections.length;
    this.sections.push(section);

    // chooser button on the list page
    new UITextButton({
      receiver: this.player,
      parent: this.listPage,
      x: 0,
      y: idx * ROW_H,
      width: W,
      height: ROW_H - 2,
      anchor: mod.UIAnchor.TopCenter,
      bgColor: UI.COLORS.GREY_25,
      baseColor: UI.COLORS.BLACK,
      message: section.label,
      textSize: 18,
      textColor: UI.COLORS.BF_GREEN_BRIGHT,
      onClickUp: (): void => this.openSectionPage(idx),
    });

    // the section's page (hidden until opened)
    const page = new UIContainer({
      receiver: this.player,
      parent: this.root,
      x: 0,
      y: 14,
      width: W,
      height: 420,
      anchor: mod.UIAnchor.TopCenter,
      bgFill: mod.UIBgFill.None,
      bgColor: UI.COLORS.BLACK,
      bgAlpha: 0,
      visible: false,
    });
    this.sectionPages.push(page);

    // action buttons
    section.actions.forEach((action, i) => {
      new UITextButton({
        receiver: this.player,
        parent: page,
        x: 0,
        y: i * ROW_H,
        width: W,
        height: ROW_H - 2,
        anchor: mod.UIAnchor.TopCenter,
        bgColor: UI.COLORS.GREY_25,
        baseColor: UI.COLORS.BLACK,
        message: action.label,
        textSize: 16,
        textColor: UI.COLORS.WHITE,
        onClickUp: (p: mod.Player): void => this.runAction(idx, action, p),
      });
    });

    // Back button at the bottom of the page
    new UITextButton({
      receiver: this.player,
      parent: page,
      x: 0,
      y: (section.actions.length + 1) * ROW_H,
      width: W,
      height: ROW_H - 2,
      anchor: mod.UIAnchor.TopCenter,
      bgColor: UI.COLORS.GREY_25,
      baseColor: UI.COLORS.BLACK,
      message: this.backLabel,
      textSize: 16,
      textColor: UI.COLORS.BF_RED_BRIGHT,
      onClickUp: (): void => this.openList(),
    });
  }

  private openSectionPage(idx: number): void {
    this.listPage.visible = false;
    this.sectionPages.forEach((p, i) => (p.visible = i === idx));
    this.reportSection(idx); // show current state once on entry
  }

  /** Run an action, then append its section's resulting state to the event log (a "big action report"). */
  private runAction(idx: number, action: MenuAction, p: mod.Player): void {
    action.onClick(p);
    this.reportSection(idx);
  }

  /** Append the section's current readout snapshot to the Logger (one-shot, on action/entry only). */
  private reportSection(idx: number): void {
    const sec = this.sections[idx];
    if (sec.readout) for (const t of sec.readout()) this.logger.log(t);
  }

  /** Append an arbitrary event line (e.g. success/error report) to the Logger. */
  public report(text: string): void {
    this.logger.log(text);
  }

  private openList(): void {
    this.sectionPages.forEach((p) => (p.visible = false));
    this.listPage.visible = true;
  }

  public show(): void {
    this.openList();
    this.root.visible = true;
    mod.EnableUIInputMode(true, this.player);
  }

  public close(): void {
    this.root.visible = false;
    mod.EnableUIInputMode(false, this.player);
  }
}
