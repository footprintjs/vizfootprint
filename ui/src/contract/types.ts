/**
 * The Renderer Contract — vizfootprint-ui's framework-agnostic renderer
 * protocol (RP-1). ANY charting stack (the first-party SVG charts, a canvas
 * renderer, a wrapped external library) can join the coordinated,
 * cause-tagged dashboard by implementing ONE small surface:
 *
 *   host                                renderer
 *   ──────────────────────────────────  ─────────────────────────────────────
 *   renderer.mount(el, handshake)  ───▶ returns { hello, update, unmount }
 *                                        hello = the protocol version it
 *                                        speaks + honest capabilities +
 *                                        declared internal transforms
 *   bindRenderer() guards the hello ──▶ version mismatch / declared
 *                                        transforms → typed gap, NO bind
 *   update(RenderState)            ───▶ rows + encodings + clause-addressable
 *                                        selection + hover + theme + size
 *   (outbound, exactly FOUR verbs) ◀─── emit · hover · reencodeRequest ·
 *                                        navigate
 *
 * The four outbound callbacks are the ONLY way a renderer talks back. A
 * renderer never builds a clause (R3 — `emit` carries a plain DATA-space
 * emission), never aggregates its own data (the host owns every
 * bin/aggregate/decimate — see `transforms` on {@link RendererHello}), and
 * never files state changes for gestures it did not declare (a
 * `canPanZoom: false` renderer that receives a zoom gesture files nothing;
 * a HOST asking to navigate a non-capable view lands a typed gap instead).
 *
 * VERSIONING POLICY: `RENDERER_PROTOCOL_VERSION` is `major.minor`. Two sides
 * bind iff they speak the SAME MAJOR; a minor difference is compatible (minor
 * revisions only ADD optional fields). A major mismatch refuses to bind with
 * a `protocol-version-mismatch` gap — honest, never silent.
 */

import type { ChartEmission } from '../../../src/mosaic/index.js';

/**
 * The protocol version this build of vizfootprint-ui speaks. 1.1 ADDED the
 * optional `'cell'` emission kind (D30 — a compound two-field selection, one
 * gesture = one commit) and the conformance kit's optional cell arm; a 1.0
 * renderer never declares or emits cells, so the minor stays compatible
 * (same-major binds; minors only add).
 */
export const RENDERER_PROTOCOL_VERSION = '1.1';

export type { ChartEmission };

/**
 * The three emission kinds the R3 rail carries. `'cell'` (D30, protocol 1.1)
 * is the compound two-field selection — a heatmap cell ("price 100–150 AND
 * category Formal") emitted as ONE emission and landed as ONE commit.
 */
export type EmissionKind = 'point' | 'interval' | 'cell';

/**
 * What a renderer can honestly do — declared once at mount, never guessed.
 * The host consults these before driving an interaction; asking for an
 * undeclared one lands a typed gap instead of a silent no-op.
 */
export interface RendererCapabilities {
  /** Can drag out an interval selection (a brush). */
  readonly canBrush: boolean;
  /** Can click-select a point value. */
  readonly canPointSelect: boolean;
  /** Can visually dim/highlight rows under the crossfilter selection. */
  readonly canHighlight: boolean;
  /** Can surface a re-encode affordance (asks the host via `reencodeRequest`). */
  readonly canReencode: boolean;
  /** Can pan/zoom its viewport (records via `navigate` — never a data claim). */
  readonly canPanZoom: boolean;
  /** Can reorder its marks (e.g. a sortable table). Optional — absent = false. */
  readonly canRearrange?: boolean;
  /** Which R3 emission kinds this renderer produces. */
  readonly emissionKinds: readonly EmissionKind[];
}

/**
 * A pan/zoom view state, per channel: the visible DATA-space domain (numeric
 * or ISO-date-string bounds — never pixels). Recorded through the `navigate`
 * dispatch verb as INERT intent data; deliberately non-filtering.
 */
export type NavigateViewState = Readonly<
  Record<string, readonly [number, number] | readonly [string, string]>
>;

/**
 * The four outbound callbacks — the renderer's ENTIRE voice. Anything a
 * renderer wants to say rides one of these; there is no fifth channel.
 */
export interface RendererCallbacks {
  /** A selection gesture, as the unchanged R3 emission (DATA space, no clause). */
  emit(emission: ChartEmission): void;
  /** Ephemeral hover keys (row ids), or null when the pointer leaves. Never committed. */
  hover(keys: readonly string[] | null): void;
  /** Ask the host to re-encode a visual channel — the HOST owns the picker + the verb. */
  reencodeRequest(channel: string): void;
  /** Record a pan/zoom view state (the `navigate` verb — non-filtering by design). */
  navigate(viewState: NavigateViewState): void;
}

/** What the host says at mount: the version it speaks, the view identity, the four callbacks. */
export interface HostHandshake {
  readonly protocolVersion: string;
  readonly viewId: string;
  readonly callbacks: RendererCallbacks;
}

/**
 * What the renderer answers at mount (the LSP-style hello): the protocol
 * version IT speaks, its honest capabilities, and any internal data
 * transforms it declares. `transforms` MUST be empty/absent — the host owns
 * all aggregation/decimation; a renderer declaring `['bin']` or
 * `['aggregate']` is rejected at bind with a `transforms-not-owned` gap.
 */
export interface RendererHello {
  readonly protocolVersion: string;
  readonly capabilities: RendererCapabilities;
  readonly transforms?: readonly string[];
}

/** One row as the contract sees it — a plain record; values are borrowed, never mutated. */
export type RenderRow = Readonly<Record<string, unknown>>;

/**
 * One view's live clause in the crossfilter, addressable by its source view:
 * what kind, which field, the DATA-space value, and a ready predicate that
 * evaluates a row under it (mirrors `src/data`'s `matchesClause` semantics —
 * pinned by a parity test).
 */
export interface SelectionClauseView {
  readonly kind: EmissionKind;
  /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
  readonly field: string;
  /** For kind:'cell': the two-sided pair `[x side, y side]` (each side a value or [lo, hi]). */
  readonly value: unknown;
  /** kind:'cell' only — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
  readonly predicate: (row: RenderRow) => boolean;
}

/**
 * The clause-addressable selection (RP-1) — REPLACES the old flat
 * keep-predicate. Keyed by source viewId so a renderer can implement "dim
 * under everyone's brush but my own" without side channels: skip the
 * `selfClauseId` entry, fold the rest under `resolve`.
 */
export interface RenderSelection {
  /** sourceViewId → its live clause. One clause per view (the session's own rule). */
  readonly clauses: ReadonlyMap<string, SelectionClauseView>;
  /** How multiple clauses combine. Crossfilter is 'intersect' (AND). */
  readonly resolve: 'union' | 'intersect';
  /** The consuming view's viewId (its own `clauses` key), or null for a whole-dashboard fold with nothing to exclude. */
  readonly selfClauseId: string | null;
}

/**
 * Everything a renderer needs to draw one frame — pushed by the host via
 * `update()`. `rows` arrive already crossfiltered/decimated/aggregated by
 * the host (the transform-ownership rule); `encodings` is the channel→field
 * fold at the cursor; `selection` is clause-addressable (above); `hover` is
 * ephemeral; `theme` is a resolved `--vzf-*` token map; `size` is the
 * measured box the renderer must fill.
 */
export interface RenderState {
  readonly rows: readonly RenderRow[];
  readonly encodings: Readonly<Record<string, string>>;
  readonly selection: RenderSelection;
  readonly hover: readonly string[] | null;
  readonly theme: Readonly<Record<string, string>>;
  readonly size: { readonly width: number; readonly height: number };
}

/** The mounted half a renderer returns: its hello plus the two lifecycle verbs. */
export interface MountedRenderer {
  readonly hello: RendererHello;
  /** Draw (or redraw) under the given state. Must be safe to call repeatedly. */
  update(state: RenderState): void;
  /** Tear down everything mount created. */
  unmount(): void;
}

/** The whole renderer contract: one factory method. */
export interface Renderer {
  mount(el: Element, handshake: HostHandshake): MountedRenderer;
}

// ── typed gaps at the contract boundary (the D14 discipline, host-side) ───────

/** The contract's gap taxonomy — every refused bind/drive is filed, never dropped. */
export type ContractGapKind =
  | 'protocol-version-mismatch'
  | 'transforms-not-owned'
  | 'navigate-unsupported';

/**
 * One unmet contract request. Shape-compatible with the adapter's `GapView`
 * (code/op/detail/target), so a consumer can pipe contract gaps straight into
 * `<GapsPanel>` beside the session's own.
 */
export interface ContractGap {
  readonly code: ContractGapKind;
  readonly op: 'bind' | 'navigate';
  /** Human-facing detail. INERT — never parsed, never dispatched on. */
  readonly detail: string;
  /** The viewId the request named. */
  readonly target?: string;
}

/** The major component of a `major.minor` protocol version, or null when unparseable. */
export function protocolMajor(version: string): number | null {
  const m = /^(\d+)\.\d+$/.exec(version);
  return m ? Number(m[1]) : null;
}

/** Same-major = compatible (see the versioning policy in the file header). */
export function speaksSameMajor(a: string, b: string): boolean {
  const ma = protocolMajor(a);
  const mb = protocolMajor(b);
  return ma !== null && mb !== null && ma === mb;
}
