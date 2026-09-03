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
 * CAPABILITY HONESTY — the law this file is reviewed against (written up
 * with its worked example in `README.md`, beside this file): a flag is
 * `true` only when the BOUND renderer actually delivers that behaviour
 * THROUGH the contract. Not what the wrapped chart could do if a host wired
 * it by hand — what `update()` on this mount visibly does. A flag nothing
 * honours is worse than a missing one, because it invites a host (or a
 * user) to believe an act was carried, or recorded, when it was not.
 *
 * VERSIONING POLICY: `RENDERER_PROTOCOL_VERSION` is `major.minor`. Two sides
 * bind iff they speak the SAME MAJOR; a minor difference is compatible (minor
 * revisions only ADD optional fields). A major mismatch refuses to bind with
 * a `protocol-version-mismatch` gap — honest, never silent.
 */

import type { ChartEmission } from 'vizfootprint/mosaic';

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
export type EmissionKind = 'point' | 'interval' | 'cell' | 'match';

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
  /**
   * Can visually mark the rows under the crossfilter selection: a ROW chart
   * DIMS the rows a non-self clause excludes (scatter, table); an AGGREGATE
   * chart draws the bright SHARE of each mark (the bar's inner overlay),
   * since it has no rows on screen to dim. True only when THIS bound
   * renderer does it — an aggregate chart needs the share as a second
   * host-computed number on the row, so its factory derives the flag from
   * the option that names that field (see `barRenderer`).
   */
  readonly canHighlight: boolean;
  /** Can surface a re-encode affordance (asks the host via `reencodeRequest`). */
  readonly canReencode: boolean;
  /** Can pan/zoom its viewport (records via `navigate` — never a data claim). */
  readonly canPanZoom: boolean;
  // There is deliberately NO `canRearrange`. It was declared here and NOTHING
  // honoured it: the table sorts its own rows in local state, `RendererCallbacks`
  // has no rearrange verb, and `bindRenderer` never guarded it — so a user
  // visibly reordered a table and the record never heard about it, which is the
  // one thing this library exists to prevent. It is removed rather than left
  // standing, because a flag that lies is worse than a contract that is narrow.
  // Re-adding it takes four things, in this order: (1) a dispatch verb that
  // RECORDS an arrangement — the library already has the shape, `navigate` with
  // the `layout:${scope}` identity, which lands one cause-tagged commit carrying
  // plain `field`/`value` strings and is restored by time travel; (2) a FIFTH
  // outbound callback carrying the new order (today's four are the renderer's
  // entire voice, so this is a protocol MAJOR decision, not a minor add);
  // (3) a `bindRenderer` guard so a host-driven rearrange on a non-capable view
  // files a typed gap the way `navigate` does; (4) a conformance step proving
  // the reorder lands a commit. Squeezing an order through today's `navigate`
  // callback is NOT the shortcut it looks like: its payload is typed as
  // DATA-space domains and the host records it as a viewport move, so a sort
  // would enter the trace under another act's name — a second lie, on the
  // record this time. Until all four exist, a renderer that reorders says so in
  // its own docs (see `tableRenderer`) and claims no capability. The removal
  // did NOT bump `RENDERER_PROTOCOL_VERSION`: no code ever read the flag, and
  // a third-party hello still carrying the key binds byte-identically (the
  // guards read version, transforms and emissionKinds — never this).
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
  /**
   * Ephemeral hover keys (row ids), or null when the pointer leaves. NEVER
   * committed — this is the one verb on the rail that records nothing, and
   * that is exactly why there is deliberately no `canHover` capability. A
   * capability earns its place when the HOST must refuse an act honestly:
   * a `navigate` on a non-capable view files a typed gap because otherwise
   * a visible act would go unrecorded. Nothing goes unrecorded when a
   * renderer simply never hovers, so there is nothing to guard and nothing
   * for a host to branch on — a host pushes `RenderState.hover` to everyone
   * and a renderer without a hover concept ignores it.
   *
   * No first-party renderer speaks it today (all eight are silent here).
   * The channel stays because it is the protocol's only home for a renderer
   * that HAS a hover concept — a crosshair a host wants to coordinate — and
   * the conformance kit collects whatever a renderer says on it, proving
   * the hover reaches the host and never reaches the trace.
   */
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
  /**
   * Layer 4: what THIS consumer does with the clause, read off the link graph's
   * edge from the clause's source view into the consumer — `filter` drops rows,
   * `highlight` dims them, `mirror` outlines the value, `navigate` moves the
   * viewport. Absent = the legacy rule (every clause filters) or the consumer's
   * own clause. A `none` edge or an absent edge never yields a clause at all.
   */
  readonly response?: 'filter' | 'highlight' | 'navigate' | 'mirror';
  /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
  readonly field: string;
  /** For kind:'cell': the two-sided pair `[x side, y side]` (each side a value or [lo, hi]); for kind:'match': `{ values, exclude? }` or null. */
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
  /**
   * The host's coordinated hover (row ids), or null. Transient by nature: it
   * comes from a pointer, never from the trace, and it never lands a commit —
   * so a renderer must draw it as decoration and never let it change what it
   * emits. No first-party renderer reads it today; see `RendererCallbacks.hover`
   * for why it carries no capability flag.
   */
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
