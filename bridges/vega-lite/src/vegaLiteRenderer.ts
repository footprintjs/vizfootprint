/**
 * `vegaLiteRenderer(spec, opts)` — a consumer Vega-Lite spec, mounted as a
 * contract {@link Renderer} (RP-1, ui/src/contract): the ONE first-party
 * bridge the renderer-protocol panel mandated (D27 §2).
 *
 * How the pieces land:
 *   - the SPEC GATE runs at the factory (specGate.ts): unsupported-in-v1
 *     specs THROW a typed {@link VegaLiteSpecError}; transform-carrying specs
 *     return a renderer whose hello DECLARES the transforms, so the host's
 *     `bindRenderer` refuses with the contract's typed `transforms-not-owned`
 *     gap — the bridge never lies about a spec it cannot honestly serve.
 *   - CAPABILITIES are read off the spec (capabilities.ts — the derivation
 *     table lives there).
 *   - `mount` is synchronous: the spec was compiled ONCE at the factory;
 *     mount parses it into a fresh vega View (svg renderer) inside a
 *     bridge-owned frame div. Vega paints asynchronously (its render phase
 *     settles on microtasks after `view.run()`), but the dataflow itself —
 *     data, signals, listeners — evaluates synchronously inside `update()`.
 *   - `update(state)` pushes host rows into the named `vzf_rows` data source
 *     as a FULL REPLACE (one changeset: remove-all + insert) — host rows
 *     arrive as a fresh, already-crossfiltered/aggregated array each frame
 *     with no stable-key contract, so an identity diff cannot match rows
 *     across host recomputes; one changeset = one dataflow pulse. A
 *     rows-reference + keep-signature guard skips the push when nothing
 *     changed. Each inserted row is a SHALLOW COPY (vega tags tuples
 *     in-place; host rows are borrowed and never mutated) stamped with
 *     `__vzfKeep` — the host selection fold (self-excluded per
 *     `selfClauseId`), which drives the bridge-injected opacity encode. The
 *     clause PREDICATES are host-built (`selectionForView`); the bridge only
 *     folds them (parity with ui's `keepPredicate` is pinned by test).
 *   - OUTBOUND, the four verbs: interval brushes ride the SYNTHESIZED
 *     completion signal (completion.ts — one honest emission per completed
 *     gesture; vega-lite#5341 has no native one); point selections emit
 *     immediately (a click is discrete); `bind:'scales'` pan/zoom rides its
 *     own completion synthesizer into `navigate` (non-filtering by design);
 *     `reencodeRequest` is never called (canReencode: false in v1). Signal
 *     echoes caused by `update()` itself are suppressed (the `applying`
 *     flag), and value-unchanged flushes are skipped — no phantom commits.
 */

import { compile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';
import { changeset, parse, View, type Spec } from 'vega';
import type { Renderer, RenderRow, RenderSelection } from 'vizfootprint-ui';
import { validateVegaLiteSpec, VegaLiteSpecError, type GatedSpec } from './specGate.js';
import { deriveCapabilities } from './capabilities.js';
import { createGestureCompletion, type GestureCompletion } from './completion.js';
import { intervalRawValue, navigateViewState, pointRawValue, type DateFormat } from './emission.js';

/**
 * The renderer-contract version this bridge was WRITTEN AGAINST (its hello).
 * Deliberately a local constant, not an import of the installed ui's value —
 * a bridge speaks the protocol it was built for; the host's bind guard is
 * what compares the two (the versioning policy in ui/src/contract/types.ts).
 */
export const VEGA_LITE_BRIDGE_PROTOCOL = '1.0';

/** The bridge-owned named data source host rows land in. */
export const VEGA_LITE_DATA_NAME = 'vzf_rows';

/** The bridge-stamped keep flag the injected opacity encode reads. */
export const VEGA_LITE_KEEP_FIELD = '__vzfKeep';

/** The dimmed-mark opacity under the non-self clauses (mirrors the first-party charts). */
const DIM_OPACITY = 0.25;

/** The placeholder size the spec compiles at; the first `update()` sets the real one. */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 220;

export interface VegaLiteRendererOptions {
  /** The completion synthesizer's debounce fallback window, ms. Default 250. */
  readonly debounceMs?: number;
  /** How temporal bounds are written onto the host wire (see emission.ts). Default 'date'. */
  readonly dateFormat?: DateFormat;
  /** Receive the live vega View at mount — the tooling/test seam (tooltips, programmatic drives). */
  readonly onView?: (view: View) => void;
}

/**
 * Fold the clause-addressable selection into one keep-predicate, skipping the
 * consuming view's own clause (crossfilter self-exclusion — "dim under
 * everyone's brush but my own"). The predicates themselves are HOST-built;
 * this fold's parity with ui's `keepPredicate` is pinned by test.
 */
export function foldKeep(selection: RenderSelection): (row: RenderRow) => boolean {
  const predicates: ((row: RenderRow) => boolean)[] = [];
  for (const [viewId, clause] of selection.clauses) {
    if (viewId === selection.selfClauseId) continue;
    predicates.push(clause.predicate);
  }
  if (predicates.length === 0) return () => true;
  if (selection.resolve === 'union') return (row) => predicates.some((p) => p(row));
  return (row) => predicates.every((p) => p(row));
}

/** The embeddable spec: host-named data, transparent background, the injected keep-opacity encode. */
function embeddableSpec(gated: GatedSpec): TopLevelSpec {
  const src = gated.spec as unknown as Record<string, unknown>;
  return {
    ...src,
    data: { name: VEGA_LITE_DATA_NAME },
    background: 'transparent',
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    autosize: { type: 'fit', contains: 'padding' },
    encoding: {
      ...(src['encoding'] as Record<string, unknown>),
      opacity: {
        condition: { test: `datum.${VEGA_LITE_KEEP_FIELD}`, value: 1 },
        value: DIM_OPACITY,
      },
    },
  } as unknown as TopLevelSpec;
}

/**
 * The transforms path (specGate.ts header, path 1): a renderer that mounts
 * only far enough to DECLARE the spec's internal transforms in its hello —
 * `bindRenderer` refuses it with the typed `transforms-not-owned` gap. Its
 * `update` throws (a caller that bypasses the bind guard gets honesty, not a
 * silent no-op).
 */
function transformsDeclaringRenderer(gated: GatedSpec): Renderer {
  return {
    mount() {
      return {
        hello: {
          protocolVersion: VEGA_LITE_BRIDGE_PROTOCOL,
          capabilities: {
            canBrush: false,
            canPointSelect: false,
            canHighlight: false,
            canReencode: false,
            canPanZoom: false,
            emissionKinds: [],
          },
          transforms: gated.internalTransforms,
        },
        update() {
          throw new VegaLiteSpecError([
            {
              code: 'unsupported-in-bridge-v1',
              detail:
                `this spec declares internal data transforms (${gated.internalTransforms.join(', ')}) — ` +
                'the host owns aggregation/decimation; bindRenderer refuses this hello, so update() must never be driven',
            },
          ]);
        },
        unmount() {
          // nothing was mounted — the hello alone carried the refusal
        },
      };
    },
  };
}

export function vegaLiteRenderer(spec: TopLevelSpec, options: VegaLiteRendererOptions = {}): Renderer {
  const result = validateVegaLiteSpec(spec);
  if (!result.ok) throw new VegaLiteSpecError(result.issues);
  const gated = result.gated;
  if (gated.internalTransforms.length > 0) return transformsDeclaringRenderer(gated);

  const capabilities = deriveCapabilities(gated);
  const compiled = compile(embeddableSpec(gated)).spec as Spec; // compiled ONCE; parsed fresh per mount
  const debounceMs = options.debounceMs ?? 250;
  const dateFormat: DateFormat = options.dateFormat ?? 'date';

  return {
    mount(el, handshake) {
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      if (win === null) {
        throw new Error(
          'vega-lite bridge: the mount element must live in a window-attached document — the synthesized gesture completion listens for pointer-up there',
        );
      }

      const frame = doc.createElement('div');
      frame.className = 'vzf vzf-vega';
      frame.setAttribute('data-vzf', 'vega-lite');
      frame.style.width = '100%';
      frame.style.height = '100%';
      el.appendChild(frame);

      const view = new View(parse(compiled), { renderer: 'svg', container: frame });
      options.onView?.(view);

      let disposed = false;
      /** True while update() applies host state — suppresses signal echoes (no phantom gestures). */
      let applying = false;
      const completions: GestureCompletion[] = [];
      let lastIntervalKey: string | undefined;
      let lastPointKey: string | undefined;
      let lastNavigateKey: string | undefined;

      if (gated.brush !== null) {
        const brush = gated.brush;
        let latest: unknown = null;
        const completion = createGestureCompletion({
          debounceMs,
          win,
          flush() {
            const raw = intervalRawValue(latest, brush.field, brush.temporal, dateFormat);
            const key = JSON.stringify(raw);
            if (raw === null && lastIntervalKey === undefined) return; // nothing to clear yet
            if (key === lastIntervalKey) return; // value unchanged — no phantom re-commit
            lastIntervalKey = key;
            handshake.callbacks.emit({ rawValue: raw, encoding: { kind: 'interval', field: brush.field } });
          },
        });
        completions.push(completion);
        view.addSignalListener(brush.param, (_name, value) => {
          if (applying) return;
          latest = value;
          completion.noteUpdate();
        });
      }

      if (gated.point !== null) {
        const point = gated.point;
        view.addSignalListener(point.param, (_name, value) => {
          if (applying) return;
          const raw = pointRawValue(value, point.field);
          const key = JSON.stringify(raw);
          if (raw === null && lastPointKey === undefined) return; // init noise, not a clear
          if (key === lastPointKey) return;
          lastPointKey = key;
          handshake.callbacks.emit({ rawValue: raw, encoding: { kind: 'point', field: point.field } });
        });
      }

      if (gated.navigate !== null) {
        const navigate = gated.navigate;
        let latest: unknown = null;
        const completion = createGestureCompletion({
          debounceMs,
          win,
          flush() {
            const viewState = navigateViewState(latest, navigate.channels, dateFormat);
            if (viewState === null) return;
            const key = JSON.stringify(viewState);
            if (key === lastNavigateKey) return;
            lastNavigateKey = key;
            handshake.callbacks.navigate(viewState);
          },
        });
        completions.push(completion);
        view.addSignalListener(navigate.param, (_name, value) => {
          if (applying) return;
          latest = value;
          completion.noteUpdate();
        });
      }

      let lastRows: readonly RenderRow[] | null = null;
      let lastKeepSignature = '';
      let lastWidth = DEFAULT_WIDTH;
      let lastHeight = DEFAULT_HEIGHT;

      return {
        hello: {
          protocolVersion: VEGA_LITE_BRIDGE_PROTOCOL,
          capabilities,
          transforms: [], // the gate proved it — the host owns every transform
        },
        update(state) {
          if (disposed) {
            throw new Error('vega-lite bridge: update() after unmount');
          }
          applying = true;
          try {
            for (const [token, value] of Object.entries(state.theme)) {
              frame.style.setProperty(token, value);
            }
            if (state.size.width !== lastWidth || state.size.height !== lastHeight) {
              lastWidth = state.size.width;
              lastHeight = state.size.height;
              view.width(lastWidth).height(lastHeight);
            }
            const keep = foldKeep(state.selection);
            const flags = state.rows.map((row) => keep(row));
            const keepSignature = flags.map((f) => (f ? '1' : '0')).join('');
            if (state.rows !== lastRows || keepSignature !== lastKeepSignature) {
              lastRows = state.rows;
              lastKeepSignature = keepSignature;
              view.change(
                VEGA_LITE_DATA_NAME,
                changeset()
                  .remove(() => true)
                  .insert(state.rows.map((row, i) => ({ ...row, [VEGA_LITE_KEEP_FIELD]: flags[i] === true }))),
              );
            }
            view.run(); // dataflow evaluates synchronously; the svg paint settles on microtasks
          } finally {
            applying = false;
          }
        },
        unmount() {
          if (disposed) return; // idempotent — a second unmount is a no-op, not a crash
          disposed = true;
          for (const completion of completions) completion.dispose();
          view.finalize(); // detaches vega's own listeners; does NOT clear the container
          frame.remove();
        },
      };
    },
  };
}
