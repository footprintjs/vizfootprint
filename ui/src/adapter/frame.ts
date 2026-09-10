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
 *   2. ABSENCE ROWS ARE DROPPED HERE, before anything is folded. A table's
 *      declared absence column says a cell is a SILENCE, and "unavailable" on
 *      an axis reads as a low number. The test is the library's own
 *      (`silenceTestOf`, `vizfootprint/data`) — never restated: `present`
 *      reports a value, so does any state the table declared as one that
 *      `carries` a number, and everything else is silence.
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
import type { ColumnType, Row } from 'vizfootprint/data';
import { silenceTestOf } from 'vizfootprint/data';
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
  /** Present when this is the table's declared absence column: the vocabulary it speaks. */
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
   * Per table, its declared absence vocabulary, when the def declared one that
   * `carries` a value in some state. Absent for a table: the vocabulary is read
   * off `columns` instead, which cannot carry `carries` — so a table that
   * declares one passes it here or its carrying rows are read as silences.
   */
  readonly absence?: Readonly<Record<string, AbsenceDecl>>;
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
 * bound.view.update({ ...state, layers: renderLayers, ...(Object.keys(frame).length > 0 ? { frame } : {}) });
 * ```
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
 */
export async function frameFor(session: FrameSessionLike, request: FrameRequest): Promise<Readonly<Record<string, ResolvedChannel>>> {
  const layers = await Promise.all(request.layers.map((layer) => valuesOf(session, request, layer)));
  return frameDomains(layers, request.frame);
}

/**
 * One layer's channels, each folded from the rows ITS basis asked for.
 *
 * WHY the walk is per BASIS and not per channel: the rows are the same for
 * every channel folded on the same basis, so a read per channel would ask the
 * engine one question five times — and a basis nothing asks for is never read
 * at all. An INDEPENDENT channel asks for nothing: it has no domain, so its
 * values would be read and thrown away. It still enters the frame, with no
 * values, because the fold answers `mode: 'independent'` for it and that is
 * what tells a renderer who draws the guide.
 */
async function valuesOf(session: FrameSessionLike, request: FrameRequest, layer: FrameLayerRef): Promise<FrameLayer> {
  const columns = request.columns[layer.table] ?? [];
  const bound = Object.entries(layer.encodings);
  const channels: Record<string, ChannelValues> = {};
  for (const [channel, field] of bound.filter(([channel]) => basisOf(request.frame, channel) === undefined)) {
    channels[channel] = { type: typeOf(columns, field), values: [] };
  }
  for (const basis of bases(bound.map(([channel]) => basisOf(request.frame, channel)))) {
    const rows = await readFor(session, request, layer, basis);
    for (const [channel, field] of bound.filter(([channel]) => basisOf(request.frame, channel) === basis)) {
      channels[channel] = { type: typeOf(columns, field), values: rows.map((row) => row[field]) };
    }
  }
  return { layerId: layer.layerId, ...(layer.chartKind !== undefined ? { chartKind: layer.chartKind } : {}), channels };
}

/** The reads to make: each basis once, and never the nothing an independent channel asks for. */
function bases(asked: readonly ('table' | 'rows' | undefined)[]): ReadonlySet<'table' | 'rows'> {
  return new Set(asked.filter((basis): basis is 'table' | 'rows' => basis !== undefined));
}

/** One read of one layer, on one basis, with the silences already dropped. A refused read is no rows — never stale ones. */
async function readFor(session: FrameSessionLike, request: FrameRequest, layer: FrameLayerRef, basis: 'table' | 'rows'): Promise<readonly Row[]> {
  const limit = request.limit ?? FRAME_ROW_LIMIT;
  // 'rows' = the rows this frame draws, through the ONE door for a layer's rows (it owns the address→table rule).
  // 'table' = nobody's clause, so the axis does not move with a filter elsewhere. The layer already names its
  // table, so there is no address to resolve and no second resolver to introduce.
  const answer = basis === 'rows' ? await layerRowsFor(session, layerAddress(request.viewId, layer.layerId), { limit }) : await session.viewQuery({ viewId: null, table: layer.table, limit });
  return answer.ok ? present(answer.rows, request, layer.table) : [];
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

/** The rows that REPORTED a value — a silence never enters a domain, because "unavailable" on an axis reads as a low number. */
function present(rows: readonly Row[], request: FrameRequest, table: string): readonly Row[] {
  const declared = request.absence?.[table] ?? absenceOf(request.columns[table]);
  if (declared === undefined) return rows; // a table with no absence vocabulary has no silences to drop
  const silent = silenceTestOf(declared);
  return rows.filter((row) => !silent(row[declared.field]));
}

/** The table's absence vocabulary as the columns projection carries it — the column that speaks one IS the absence column. */
function absenceOf(columns: readonly FrameColumn[] | undefined): AbsenceDecl | undefined {
  const column = columns?.find((c) => c.absence !== undefined && c.absence.length > 0);
  return column === undefined ? undefined : { field: column.field, states: column.absence! };
}

/** The declared type of one column, or `unknown` where the table lists none — an unknown type folds to no domain rather than a guessed one. */
function typeOf(columns: readonly FrameColumn[], field: string): ColumnType {
  const type = columns.find((c) => c.field === field)?.type;
  return COLUMN_TYPES.includes(type as ColumnType) ? (type as ColumnType) : 'unknown';
}
