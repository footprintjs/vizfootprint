/**
 * THE DESK'S CONTRACT — what a host hands over, and what it gets back.
 *
 * One law governs every line of this file, and it is the adapter's law one step
 * further out (`vizfootprint/ui/src/adapter/README.md`, law 1):
 *
 *   **the desk PROJECTS; the host DERIVES.**
 *
 * A fact the session already holds — which field a channel is bound to, which
 * clause reaches a view through the link graph, a view's words and whether they
 * went stale, the paths, the log, the tables — the desk reads off the session
 * view and never recomputes. A fact about the HOST'S OWN ROWS — how many cells
 * carry each value, what a week sums to, which areas reported nothing — the
 * desk never touches. It does not have the rows and does not want them: a
 * dashboard shell that summed on the host's behalf would be a second
 * implementation of the host's own question, and the one on screen would be the
 * one nobody tested.
 *
 * That is why {@link DeskProps.charts} is a function and not a list. The desk
 * hands the host a {@link DeskProjection} — everything the session knows — and
 * the host hands back the cells, having done its own arithmetic over its own
 * rows with the projection's answers as the inputs.
 */
import type { ReactNode } from 'react';
import type {
  ChartSize,
  CockpitMenuItem,
  CockpitReport,
  ColumnView,
  FitView,
  ProseStatusView,
  RenderSelection,
  SessionView,
  SessionViewState,
  SheetColumn,
  SheetData,
} from 'vizfootprint-ui';
import type { DeskTokens } from './tokens.js';

// ── what the desk hands the host ───────────────────────────────────────────

/**
 * The session, projected — everything a cell needs to draw itself honestly, and
 * nothing the host would have to re-derive.
 *
 * Handed to {@link DeskProps.charts}, to every aside tab and to every host
 * report, so all three read the SAME answers as the desk's own furniture.
 */
export interface DeskProjection {
  /** The whole adapter state at the cursor — the escape hatch, when a field below does not answer it. */
  readonly state: SessionViewState;
  /** The session view itself: every act a host cell lands (`emit`, `reencode`, `seek`) goes through it. */
  readonly view: SessionView;
  /**
   * WHICH FIELD A VIEW'S CHANNEL ENCODES, at the cursor — the session's answer,
   * never a constant written at build time. Both halves of a chart must read
   * through this: the aggregation that makes the marks AND the field the chart
   * names on its axis. An axis that changed while the marks did not is a lie.
   */
  bound(viewId: string, channel: string, fallback: string): string;
  /**
   * The clause-addressable selection as it reaches `self` THROUGH THE LINK
   * GRAPH — the only honest way to ask what a view is showing. Reading
   * `state.selections` directly reads a clause the person may have switched
   * off, and the log then says the link is off while the view moves anyway.
   * Pass `null` for the whole-dashboard truth.
   */
  selFor(self: string | null): RenderSelection;
  /** The encoding plane's verdicts for a view — the picker greys with the session's own sentences. */
  fitsOf(viewId: string): Readonly<Record<string, readonly FitView[]>> | undefined;
  /** What each view SHOWS: followed channels laid over its own (`effectiveEncodings`, else `encodings`). */
  readonly shown: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The default table's columns — what a picker may offer. */
  readonly columns: readonly ColumnView[];
  /** The def's label for a view, else its id. */
  label(viewId: string): string;
  /** A view's words at the cursor, drawn with their author and their staleness — shown, never hidden. */
  words(viewId: string): ReactNode;
  /** A view's prose slots at the cursor, unrendered — for a host that draws its own. */
  proseOf(viewId: string): readonly ProseStatusView[];
  /** The accessible name a view's prose declares (`altShort`), or undefined — the chart then names itself. */
  altShort(viewId: string): string | undefined;
  /** True in Present mode: nothing may be authored. */
  readonly readOnly: boolean;
  /** Say something went wrong, in the words the host was given — shown in the desk's notice line. `null` clears it. */
  say(sentence: string | null): void;
  /** Open the aside on a tab (a host's menu item reaching a host's own panel). */
  openAside(tabId: string): void;
  /** Open the editor on one chart — what the ✎ on a cell does. */
  editChart(viewId: string): void;
  /** Seek to a named beat by its bookmark id (or, for words written before ids, its label). */
  seekBookmark(ref: string): void;
  /** Apply a saved picture by its store id — judged first, and its refusal is printed. */
  applyPicture(savedId: string): void;
  /** Save the live selections (or one view's) as a named picture. */
  savePicture(name: string, what?: { readonly viewId: string }): void;
  /** The words a commit anchor shows on hover — the same sentence everywhere. */
  describeCommit(commitId: string): string | undefined;
}

// ── what the host hands the desk ───────────────────────────────────────────

/**
 * One chart cell. The host owns the mark and the caption; the desk owns the
 * frame, the layout, the ✎, the ✕ and where the cell is mounted — which is why
 * there is no `active`/`onClear`/`onEdit` here. Those are the desk's, derived
 * from the session, and a host that set them by hand would be back to two
 * answers about what is selected.
 */
export interface DeskChart {
  readonly id: string;
  /**
   * The address this cell's marks actually SELECT under, when it is not the
   * cell's own id — a layered chart's marks belong to a LAYER, so a node-link
   * registered as `net` lands its clause at `net~nodes`. The desk's ✕ pill and
   * its clear both follow this address; without it the one cell whose clause is
   * filtering the whole dashboard is the one cell with no way to clear it.
   * Default: `id`.
   */
  readonly clauseId?: string;
  /** Relative width on the flow band (default 1). */
  readonly weight?: number;
  /** The line under the chart. */
  readonly caption?: ReactNode;
  /** Draw it at the measured size the frame gives. */
  readonly render: (size: ChartSize) => ReactNode;
}

/**
 * The cells, built from the projection.
 *
 * **Called once, unconditionally, from the desk's own body** — so it MAY use
 * hooks, and for anything the size of a real table it SHOULD: the aggregation
 * behind a cell runs on every poll otherwise. (`useMemo` over the rows and the
 * selection slices is what the NNDSS desk does; see its `web/src/cells.tsx`.)
 */
export type DeskCharts = (desk: DeskProjection) => readonly DeskChart[];

/** One tab in the desk's side drawer, beside the editor the desk always has. */
export interface DeskAsideTab {
  /** Addressable: `desk.openAside(id)` from a menu item opens it. */
  readonly id: string;
  /** The tab's own button. */
  readonly label: ReactNode;
  /** The drawer's heading while this tab is showing. Defaults to the label when it is a string. */
  readonly title?: string;
  readonly render: (desk: DeskProjection) => ReactNode;
}

/** One silence: an absence value, how many cells carry it, and where. */
export interface DeskSilence {
  /** The absence value, in the vocabulary the def declared. */
  readonly state: string;
  readonly total: number;
  /** Areas, each with what it was silent about — the host decides how many to name. */
  readonly areas: readonly (readonly [string, readonly string[]])[];
}

/**
 * The silences panel. The GROUPS are the host's arithmetic over its own rows;
 * the panel, its shape and its badge are the desk's.
 */
export interface DeskSilences {
  readonly groups: readonly DeskSilence[];
  /** The host's own words about its own vocabulary — what each silence MEANS in this data. */
  readonly heading?: ReactNode;
  /** The colour a silence is kept in — the absence vocabulary's palette, which is the host's. */
  readonly colorOf?: (state: string) => string;
}

/** One chart an agent proposed, and what the session made of it. */
export interface DeskProposal {
  readonly id: string;
  readonly claim: string;
  readonly admitted: boolean;
  /** A refusal's typed code and its sentence — shown, because the refusal is the point. */
  readonly code?: string;
  readonly detail?: string;
}

/** The proposals panel: the rows are the host's door, the panel is the desk's. */
export interface DeskProposals {
  readonly rows: readonly DeskProposal[];
  readonly heading?: ReactNode;
  /**
   * Ask for proposals. Absent = the panel reads and never asks.
   *
   * A proposal lands commits on the session, so the desk refreshes once this
   * settles rather than waiting for the next poll — a host act that CHANGED the
   * log should be visible in the log immediately, and the host should not have
   * to reach for the view to make that true.
   */
  readonly onPropose?: () => void | Promise<void>;
  readonly proposeLabel?: string;
}

/**
 * The Data tab — the Sources view and the Sheet, in one workbook.
 *
 * The desk derives the Sheet's COLUMNS from `state.columns[table]` (the session
 * holds them, so the desk projects them) and hands them to `sheet`, which is the
 * host's because only the host knows where its rows come from: a window
 * endpoint, an in-process session, a file.
 */
export interface DeskData {
  /** The table the Sheet shows. */
  readonly table: string;
  /**
   * Build the sheet's data port over the columns the desk derived. Called only
   * when the schema changes — a new adapter every poll would be a new question
   * every second.
   */
  readonly sheet: (columns: readonly SheetColumn[]) => SheetData;
  /** The data checks, when the host has a door for them (`lintData`). */
  readonly checks?: readonly string[];
  /** A checks door that refused, said in words rather than shown as "not asked yet". */
  readonly checksError?: string;
  /** Re-read the sources. Absent = the Sources view reads and never refreshes. */
  readonly onRefresh?: (tables?: readonly string[]) => void;
  readonly refreshing?: boolean;
}

/** The Story tab — the named beats along the head's lineage, told over the live desk. */
export interface DeskStory {
  /**
   * The def's DECLARED words, the fallback for a beat no `describe` reached.
   * Never the live caption: that would misdate every earlier bookmark.
   */
  readonly declared?: { readonly title?: string; readonly caption?: string };
  readonly author?: string;
  /** Which cells the pinned figure shows, in order. A name that is not a cell is refused in a sentence. */
  readonly figure?: readonly string[];
  /** What to say when this lineage has no beats yet. */
  readonly emptyNote?: string;
  /** The date the post is told as of. Defaults to today. */
  readonly date?: string;
}

/** The desk's props. Everything but `view` and `charts` is optional; each absent slot removes its own furniture. */
export interface DeskProps {
  /**
   * The session view — the desk never creates one of its own.
   *
   * Pass a **live view** and the host owns its lifetime (the story page does:
   * the page made the session). Pass a **factory** and the desk creates it on
   * mount and disposes it on unmount — which is what a `front` slot needs, so
   * the session's reads do not run behind a landing page nobody has left yet.
   */
  readonly view: SessionView | (() => SessionView);
  readonly charts: DeskCharts;
  /** The landing page. Given one, the desk shows it and mounts nothing else until the reader goes in. */
  readonly front?: (enter: () => void) => ReactNode;
  /**
   * The report chips. The desk hands you the ones it owns — silences,
   * proposals, the commit log, the paths, the data workbook, the story, each
   * present only when its own input is — and you return the strip you want.
   * `(desk, own) => [myGrammarPanel, ...own]` is the shape of it. Omitted = the
   * desk's own, in the desk's order.
   *
   * A combinator rather than a list appended at one end, for two reasons: the
   * ORDER of a chip strip is a design decision and belongs to whoever drew the
   * dashboard, and a host that drops one of the desk's panels should have to do
   * it out loud rather than by leaving a flag off.
   */
  readonly reports?: (desk: DeskProjection, own: readonly CockpitReport[]) => readonly CockpitReport[];
  /** The ☰ menu, the same way: the desk's own acts in, the host's list out. */
  readonly menu?: (desk: DeskProjection, own: readonly CockpitMenuItem[]) => readonly CockpitMenuItem[];
  /** Aside tabs of the host's own, drawn before the desk's editor tab. */
  readonly aside?: readonly DeskAsideTab[];
  readonly silences?: DeskSilences;
  readonly proposals?: DeskProposals;
  readonly data?: DeskData;
  readonly story?: DeskStory;
  /** Something the HOST's own doors said went wrong — drawn in the desk's notice line beside the desk's own. */
  readonly notice?: string | null;
  /**
   * Start fresh: clear every commit and begin again. The desk asks first and
   * then clears what it owns (the drawer, the unsaved notes) and refreshes;
   * this is the host's half — the reset door, and its own state. Absent = no
   * such menu item.
   */
  readonly onReset?: () => void | Promise<void>;
  /** The left of the status strip. Defaults to the window readout — a screenshot then carries the size it was taken at. */
  readonly status?: ReactNode;
  /** Restyle without forking. See `tokens.ts` for the whole list. */
  readonly tokens?: DeskTokens;
  /** The desk's own class, beside `vzf`/`vzfs` — for a host that wants to scope CSS at it. */
  readonly className?: string;
}
