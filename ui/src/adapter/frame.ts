/**
 * THE DOOR FOR A FRAME'S SCALES — `frameFor(session, request)` answers
 * `RenderState.frame`: per channel, the resolution the def declared and, where
 * it is shared, the actual domain over the layers' values.
 *
 * The law (this folder's README, Law 3): a host that would need a helper the
 * library should have given it gets a DOOR. A host drawing layers on one frame
 * must not fold its own axis — a domain computed beside the rows, by different
 * code, from a different read, is exactly how an axis comes to disagree with
 * the marks under it. So the host asks here, at every update, and gets numbers
 * folded from the same rows it is about to draw.
 *
 * WHAT THIS DOOR OWNS (the two things `frameDomains` is owed and cannot see):
 *
 *   1. WHICH ROWS. `basis: 'rows'` reads the rows this frame DRAWS — the
 *      layer's own window, through `layerRowsFor`, so every clause reaching the
 *      layer narrows the axis with the marks. `basis: 'table'` reads the table
 *      as it stands at the cursor with NOBODY's clause (`viewQuery({ viewId:
 *      null })`), so a filter elsewhere repaints the marks and leaves the axis
 *      where it was — vgplot's `Fixed`. Both are the session's one row door.
 *   2. SILENCES ARE BLANKED HERE, before anything is folded — PER COLUMN,
 *      because silence belongs to a column and not to the row
 *      (`silenceOfDecl` / `TableSilence`, `vizfootprint/data`). A cell whose
 *      governing state column does not report a value never enters a domain,
 *      and "unavailable" on an axis reads as a low number. The test is the
 *      library's own (`silenceTestOf`) — never restated: `present` reports a
 *      value, so does any state the table declared as one that `carries` a
 *      number, and everything else is silence. A column no entry governs — a
 *      STATE column included, since it speaks for itself — reads as it is.
 *
 * In-process only, like `layerRowsFor` and `sessionSheetData`: a polled host
 * needs its own endpoint for this, and that is the server's door to grow.
 *
 * First customers: a layered host filling `RenderState.frame`, the frame
 * renderer's own host wiring, the gallery page.
 */

import type { ChannelResolution, ResolvedChannel, FrameLayer, ChannelValues } from 'vizfootprint/def';
import { frameDomains, layerAddress, resolutionFor } from 'vizfootprint/def';
import type { AbsenceDecl } from 'vizfootprint/def';
import type { ColumnType, Row, TableSilence } from 'vizfootprint/data';
import { silenceOfDecl, silenceOfNothing, silenceTestOf } from 'vizfootprint/data';
import type { ViewQuery, ViewQueryResult } from 'vizfootprint/session';
import { layerRowsFor, type LayerRowsSessionLike } from './layerRows.js';

/** The one session door this reads, both ways round — structural, so a wrapper or a fake serves as well as a live session. */
export interface FrameSessionLike extends LayerRowsSessionLike {
  viewQuery(query?: ViewQuery): Promise<ViewQueryResult> | ViewQueryResult;
}

/**
 * One layer as the frame door needs it: its id, ITS table, its mark, and the
 * channel→field map. WHY the same `encodings` shape the renderer gets: the host
 * already builds it for `RenderLayer.encodings`, and a second spelling of which
 * field is on which channel is the one that goes stale.
 */
export interface FrameLayerRef {
  readonly layerId: string;
  readonly table: string;
  /** The layer's mark (`'bar'`, `'line'`, …) — read for ONE thing: the zero default (`zeroPolicyFor`). */
  readonly chartKind?: string;
  readonly encodings: Readonly<Record<string, string>>;
}

/** One column as this door needs it — a subset of the store's own `ColumnView`, so `SessionViewState.columns` is passed straight in. */
export interface FrameColumn {
  readonly field: string;
  readonly type: string;
  /** Present when this is one of the table's declared state columns: the vocabulary IT speaks. */
  readonly absence?: readonly string[];
}

export interface FrameRequest {
  /** The view the frame belongs to. Each layer's ADDRESS is minted from it (`layerAddress`), never spelled by the host. */
  readonly viewId: string;
  /** The layers in DECLARATION order (first = bottom, the paint order). */
  readonly layers: readonly FrameLayerRef[];
  /** The declared resolutions (`ViewEncodingDecl.frame`). Absent = every channel takes the shared/union/table/merged default. */
  readonly frame?: Readonly<Record<string, ChannelResolution>>;
  /** Per table, its columns — `SessionViewState.columns`. The column TYPE decides which scale a channel folds as. */
  readonly columns: Readonly<Record<string, readonly FrameColumn[]>>;
  /**
   * Per table, its declared absence vocabulary — one entry or a LIST, the def's
   * own shape — when the def declared one that `carries` a value in some state
   * or that `governs` named columns. Absent for a table: the vocabulary is read
   * off `columns` instead, which carries the state columns and their words but
   * neither `carries` nor `governs` — so a table that declares either passes it
   * here or its carrying rows are read as silences and its state columns are
   * read as speaking for every other column.
   */
  readonly absence?: Readonly<Record<string, AbsenceDecl | readonly AbsenceDecl[]>>;
  /** How many rows each read asks for. Default {@link FRAME_ROW_LIMIT}. */
  readonly limit?: number;
}

/**
 * The window each read opens. A domain is a fold over every row, so this is
 * deliberately far larger than a sheet page — and it is still a WINDOW, named
 * here rather than left to a default a reader cannot see.
 */
export const FRAME_ROW_LIMIT = 100000;

/** The column types a provider reports; anything else a wire may hold reads as `unknown`, which folds to no domain rather than a guessed one. */
const COLUMN_TYPES: readonly ColumnType[] = ['number', 'string', 'boolean', 'date', 'unknown'];

/**
 * `RenderState.frame` for one view's layers, folded at this cursor. An empty
 * answer means nothing could be folded (no layers, no bindings, or every cell
 * absent) — push it only when it holds something:
 *
 * ```ts
 * const frame = await frameFor(session, { viewId, layers, frame: view.frame, columns });
 * // each RenderLayer carries the fold at ITS address (protocol 1.8) — one call per layer, the
 * // same `selectionForView` the frame's own `selection` is folded with, at the layer's address
 * const renderLayers = layers.map((layer) => ({
 *   ...layer,
 *   rows: rowsOf(layer),
 *   selection: selectionForView(state.selections, layerAddress(viewId, layer.layerId), 'intersect', state.links, state.cleared),
 * }));
 * bound.view.update({ ...state, layers: renderLayers, ...(Object.keys(frame).length > 0 ? { frame } : {}) });
 * ```
 *
 * There is no helper for the per-layer fold beside this door on purpose: it is
 * the one-argument difference (`layerAddress(viewId, layerId)` for `viewId`)
 * from the call every host already makes for a view, and a second spelling of
 * "fold the selections for this address" is the copy nobody tests when the
 * fold moves (`../contract/README.md`, Law 7).
 *
 * A read the session REFUSES (an unknown table, a moved version) contributes no
 * values, so the channel it fed carries no domain rather than a stale one.
 *
 * KNOWN GAP, named rather than hidden: this is one read per layer per basis,
 * and the port has no way to ask N questions as one. A refresh that lands
 * between two of them folds one frame over two table versions — the domain
 * would be a whisker wide of the marks until the next update, which pushes a
 * frame folded whole. Each answer carries the `version` it was read at, so the
 * day the port can ask atomically, this door is where that goes.
 *
 * NOTHING FOR THIS DOOR TO DECIDE ABOUT THE AXIS'S CURVE (protocol 1.6). The
 * fold's answer is RETURNED VERBATIM — the whole `ResolvedChannel` record, not
 * a copy this door rebuilds field by field — so `transform` (which curve) and
 * `excluded` (how many cells a logarithm could not place) ride through with no
 * code here at all. That is deliberate and worth stating: `transform` is a
 * DECLARATION the def already owns and `frameDomains` already echoes, and
 * `excluded` is a fact only the fold can count, since only it sees the cells.
 * A door that re-derived either would be a second owner of the axis. `zeroGuide`
 * (law 12 — zero is a place on the axis) rides through on exactly the same
 * terms, for exactly the same reason: it is a DECLARATION the def owns and the
 * fold echoes, and the one question left — is zero actually ON the axis — needs
 * the domain that was DRAWN ON, which this door does not have either (a chart
 * with no frame draws its own extent). The CHART answers that one. What this
 * door owns stays exactly what its header says: which rows to read, and which
 * cells are absences (dropped BEFORE the fold, which is why `excluded` counts
 * only what a logarithm cannot place and never a silence).
 */
export async function frameFor(session: FrameSessionLike, request: FrameRequest): Promise<Readonly<Record<string, ResolvedChannel>>> {
  const layers = await Promise.all(request.layers.map((layer) => valuesOf(session, request, layer, layerAddress(request.viewId, layer.layerId))));
  return frameDomains(layers, request.frame);
}

/**
 * A view with NO layers, as the frame door needs it: the view is the one thing
 * drawn, so it carries what a layer would (its table, its mark, its channel →
 * field map) under its own id.
 */
export interface ViewFrameRequest extends Omit<FrameRequest, 'layers' | 'frame'> {
  /** The view's table. */
  readonly table: string;
  /** The view's mark (`'bar'`, `'line'`, …) — read for the zero default, as a layer's is. */
  readonly chartKind?: string;
  /** Channel → field, the map the renderer gets as `RenderState.encodings`. */
  readonly encodings: Readonly<Record<string, string>>;
  /**
   * What the definition DECLARED about this view's axes (`ViewEncodingDecl.frame`
   * on a view with no layers: the curve, a zero line, bounds, reaching zero,
   * which rows). Only the channels named here are folded.
   */
  readonly frame?: Readonly<Record<string, ChannelResolution>>;
}

/**
 * `RenderState.frame` for a view with NO layers: the axes its definition
 * declared something about, folded at this cursor, and nothing else.
 *
 * WHY THIS DOOR EXISTS. A definition may declare axis settings on a plain view
 * (a logarithmic curve, a zero line, bounds, that the axis reaches zero, which
 * rows it is measured over), and the single-mark renderers honour whatever the
 * frame holds for a channel they bind (`../contract/README.md`, "A view drawn
 * alone is a stack of one"). But `frameFor` folds LAYERS, and with none it
 * answers `{}`: the declaration never reached the renderer.
 *
 * ```ts
 * const frame = await viewFrameFor(session, { viewId, table, chartKind, encodings, frame: view.frame, columns });
 * bound.view.update({ ...state, ...(Object.keys(frame).length > 0 ? { frame } : {}) });
 * ```
 *
 * ONLY WHAT WAS DECLARED IS FOLDED, and this is the point of a second door
 * rather than `frameFor` with one layer. `frameFor` folds every channel a layer
 * binds, declared or not, because layers on one frame need one scale. A view
 * alone needs none: an axis nobody declared anything about is drawn on the
 * chart's own extent, with its own margin, and an entry on the frame would
 * take that away (the renderer draws a channel WITH an entry on the folded
 * span). So a channel is folded only if the definition named it AND the view
 * binds it. No declaration, or none on a bound channel: `{}`, and no read.
 *
 * WHICH ROWS. As for a layer: `basis: 'rows'` reads the rows this view draws,
 * at the view's own address, so the axis narrows with its marks; `basis:
 * 'table'` (the default) reads the table with nobody's clause. Silences are
 * dropped per column before the fold, by the same code a layer's are.
 */
export async function viewFrameFor(session: FrameSessionLike, request: ViewFrameRequest): Promise<Readonly<Record<string, ResolvedChannel>>> {
  const declared = request.frame ?? {};
  const encodings = Object.fromEntries(Object.entries(request.encodings).filter(([channel]) => declared[channel] !== undefined));
  if (Object.keys(encodings).length === 0) return {};
  const self: FrameLayerRef = { layerId: request.viewId, table: request.table, ...(request.chartKind !== undefined ? { chartKind: request.chartKind } : {}), encodings };
  // the view's own address is its id: there is no layer under it to name
  return frameDomains([await valuesOf(session, request, self, request.viewId)], declared);
}

/** What a fold reads off a request, whichever door it came through: the declared resolutions, the columns, the silences, the window. */
type FoldRequest = Pick<FrameRequest, 'frame' | 'columns' | 'absence' | 'limit'>;

/**
 * One layer's channels, each folded from the rows ITS basis asked for (`address`
 * is where those rows are read: the layer's, or a plain view's own id).
 *
 * WHY the walk is per BASIS and not per channel: the rows are the same for
 * every channel folded on the same basis, so a read per channel would ask the
 * engine one question five times — and a basis nothing asks for is never read
 * at all. An INDEPENDENT channel asks for nothing: it has no domain, so its
 * values would be read and thrown away. It still enters the frame, with no
 * values, because the fold answers `mode: 'independent'` for it and that is
 * what tells a renderer who draws the guide.
 */
async function valuesOf(session: FrameSessionLike, request: FoldRequest, layer: FrameLayerRef, address: string): Promise<FrameLayer> {
  const columns = request.columns[layer.table] ?? [];
  const bound = Object.entries(layer.encodings);
  // ONE reading of this table's silences, spent by every channel of the layer (`cellsFor`).
  const silence = silenceFor(request, layer.table);
  const channels: Record<string, ChannelValues> = {};
  for (const [channel, field] of bound.filter(([channel]) => basisOf(request.frame, channel) === undefined)) {
    channels[channel] = { type: typeOf(columns, field), values: [] };
  }
  for (const basis of bases(bound.map(([channel]) => basisOf(request.frame, channel)))) {
    const rows = await readFor(session, request, layer, address, basis);
    for (const [channel, field] of bound.filter(([channel]) => basisOf(request.frame, channel) === basis)) {
      channels[channel] = { type: typeOf(columns, field), values: cellsFor(rows, field, silence) };
    }
  }
  return { layerId: layer.layerId, ...(layer.chartKind !== undefined ? { chartKind: layer.chartKind } : {}), channels };
}

/** The reads to make: each basis once, and never the nothing an independent channel asks for. */
function bases(asked: readonly ('table' | 'rows' | undefined)[]): ReadonlySet<'table' | 'rows'> {
  return new Set(asked.filter((basis): basis is 'table' | 'rows' => basis !== undefined));
}

/**
 * One read of one layer, on one basis. A refused read is no rows — never stale
 * ones. The silences are dropped per COLUMN afterwards ({@link cellsFor}), not
 * here: this door has no field to judge a row by, and a row silent in one
 * column still reports the others.
 */
async function readFor(session: FrameSessionLike, request: FoldRequest, layer: FrameLayerRef, address: string, basis: 'table' | 'rows'): Promise<readonly Row[]> {
  const limit = request.limit ?? FRAME_ROW_LIMIT;
  // 'rows' = the rows this frame draws, through the ONE door for a layer's rows (it owns the address→table rule).
  // 'table' = nobody's clause, so the axis does not move with a filter elsewhere. The layer already names its
  // table, so there is no address to resolve and no second resolver to introduce.
  const answer = basis === 'rows' ? await layerRowsFor(session, address, { limit }) : await session.viewQuery({ viewId: null, table: layer.table, limit });
  return answer.ok ? answer.rows : [];
}

/**
 * Which rows a channel's domain is folded over — or `undefined` where there is
 * no domain to fold. The DEFAULT is not decided here: `resolutionFor`
 * (`vizfootprint/def`) is the one owner of it, so this door and the fold can
 * never disagree about what an undeclared channel meant. An INDEPENDENT
 * channel is the `undefined`: each layer keeps its own scale, so there is
 * nothing to read rows for.
 */
function basisOf(frame: Readonly<Record<string, ChannelResolution>> | undefined, channel: string): 'table' | 'rows' | undefined {
  const resolution = resolutionFor(channel, frame);
  return resolution.mode === 'shared' ? resolution.basis : undefined;
}

/**
 * The table's reading of its own silences: the DECLARATION when the host passed
 * one, otherwise whatever the columns projection carries.
 *
 * The projection knows which columns speak a vocabulary but not what any of
 * them `governs`, so a table read that way is read the way it always was: each
 * state column speaks for every other column. That is why a def with `governs`
 * or `carries` passes its declaration here.
 */
function silenceFor(request: FoldRequest, table: string): TableSilence {
  const declared = request.absence?.[table] ?? declsOf(request.columns[table]);
  return declared === undefined ? silenceOfNothing() : silenceOfDecl(declared);
}

/** Every state column the columns projection carries, as bare declarations — the columns that speak a vocabulary ARE the state columns. */
function declsOf(columns: readonly FrameColumn[] | undefined): readonly AbsenceDecl[] | undefined {
  const speaking = (columns ?? []).filter((c) => c.absence !== undefined && c.absence.length > 0);
  return speaking.length === 0 ? undefined : speaking.map((c) => ({ field: c.field, states: c.absence! }));
}

/**
 * The cells of ONE field for the domain fold, with that column's silences
 * dropped — because "unavailable" on an axis reads as a low number.
 *
 * Per column, and only the column's OWN governing state column decides: a row
 * whose radius was never taken still lends its period to the period axis. A
 * column nothing governs (a state column, or one outside every `governs`) reads
 * as it is. Dropping the cell and blanking it are the same thing to all three
 * folds — `frameDomains` skips a non-number for a quantitative domain, an
 * unreadable date for a temporal one and `null` for a categorical one — and
 * dropping says what is meant.
 */
function cellsFor(rows: readonly Row[], field: string, silence: TableSilence): readonly unknown[] {
  const governing = silence.silenceFor(field);
  if (governing === undefined) return rows.map((row) => row[field]);
  const silent = silenceTestOf(governing);
  return rows.filter((row) => !silent(row[governing.state])).map((row) => row[field]);
}

/** The declared type of one column, or `unknown` where the table lists none — an unknown type folds to no domain rather than a guessed one. */
function typeOf(columns: readonly FrameColumn[], field: string): ColumnType {
  const type = columns.find((c) => c.field === field)?.type;
  return COLUMN_TYPES.includes(type as ColumnType) ? (type as ColumnType) : 'unknown';
}
