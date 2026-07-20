/**
 * Conformance kit v0 (RP-1) — internal CI, no badges. `runConformance` mounts
 * ANY renderer implementing the contract against a REAL scripted session (the
 * gallery-smoke discipline: a live `InteractionSession` behind a
 * `SessionView`, never a mock of the loop) and walks the FULL loop in order:
 *
 *   1. version-guard        — an incompatible-major host is REFUSED with the
 *                             typed `protocol-version-mismatch` gap
 *   2. transform-ownership  — the hello declares NO internal transforms
 *   3. handshake            — the real bind succeeds; capabilities are sane
 *   4. renders              — update(RenderState) draws into the mount
 *   5. gesture-emits        — the plan's gesture produces R3 emissions, only
 *                             of the DECLARED kinds
 *   6. commit-lands         — the emission landed a commit with its ORIGIN in
 *                             the cause (viewId · actor · intent)
 *   7. crossfilter-returns  — the view's own clause is now ADDRESSABLE in the
 *                             derived selection and the renderer visibly
 *                             re-rendered under the new state
 *   8. cell                 — D30 (protocol 1.1): a renderer DECLARING the
 *                             cell emission kind drives the plan's cellGesture
 *                             and must land exactly ONE compound cell commit
 *                             (both fields, addressable clause); a renderer
 *                             not declaring it skips the arm honestly
 *   9. navigate             — a canPanZoom renderer's navigate is recorded and
 *                             NON-FILTERING; a non-capable one lands the typed
 *                             `navigate-unsupported` gap and records nothing
 *  10. unmount              — the mount is left clean
 *
 * Steps run in order and STOP at the first failure (later steps depend on
 * earlier ones); the report carries every step's outcome in plain words.
 * All eight first-party renderers pass this kit (`conformance.test.tsx`) —
 * the heatmap exercising the cell arm — the reference claim is proven, not
 * asserted.
 */

import { bindRenderer, type BoundRenderer } from './bind.js';
import { selectionForView } from './selection.js';
import {
  RENDERER_PROTOCOL_VERSION,
  protocolMajor,
  type ChartEmission,
  type ContractGap,
  type NavigateViewState,
  type Renderer,
  type RendererCallbacks,
  type RenderState,
} from './types.js';
import type { SessionView } from '../adapter/sessionView.js';
import type { SessionViewState } from '../adapter/types.js';

export type ConformanceStepName =
  | 'version-guard'
  | 'transform-ownership'
  | 'handshake'
  | 'renders'
  | 'gesture-emits'
  | 'commit-lands'
  | 'crossfilter-returns'
  | 'cell'
  | 'navigate'
  | 'unmount';

export interface ConformanceStep {
  readonly step: ConformanceStepName;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ConformanceReport {
  /** True iff every step passed. */
  readonly ok: boolean;
  readonly steps: readonly ConformanceStep[];
  /** Every contract gap filed during the run (typed, never dropped). */
  readonly gaps: readonly ContractGap[];
  /** Every R3 emission the renderer produced. */
  readonly emissions: readonly ChartEmission[];
  /** Every reencodeRequest channel the renderer asked for. */
  readonly reencodeRequests: readonly string[];
  /** Every hover the renderer surfaced (ephemeral — never committed). */
  readonly hovers: readonly (readonly string[] | null)[];
}

export interface ConformancePlan {
  readonly renderer: Renderer;
  /** The session view id this renderer is bound as (must be declared for commits to land). */
  readonly viewId: string;
  /** The mount container. */
  readonly el: HTMLElement;
  /** The host store over a REAL scripted session. */
  readonly view: SessionView;
  /** HOST-owned state shaping for this view: rows (crossfiltered/aggregated), encodings, selection, size. */
  buildState(state: SessionViewState): RenderState;
  /** Drive the renderer-specific SELECTING gesture on the mounted DOM (a clearing gesture fails step 7 by design). */
  gesture(el: HTMLElement): void | Promise<void>;
  /**
   * D30: drive a CELL-selecting gesture on a DIFFERENT cell than `gesture`
   * touched (clicking the same cell again would CLEAR it). REQUIRED when the
   * renderer declares the 'cell' emission kind; ignored otherwise.
   */
  cellGesture?(el: HTMLElement): void | Promise<void>;
  /** Prove the post-crossfilter re-render is visible. Default: the mount's DOM changed since before the gesture. */
  verifyUpdate?(el: HTMLElement): boolean;
  /** The view state for the navigate step. Default `{ x: [0, 1] }`. */
  readonly navigateState?: NavigateViewState;
  /** The actor expected on the landed commit's cause. Default `'user'` (the store's default principal). */
  readonly expectedActor?: string;
}

/** A step's typed failure — carries the plain-words reason into the report. */
class StepFailed extends Error {}

/** Assert one step condition; the failure detail lands in the report verbatim. */
function check(cond: boolean, okDetail: string, failDetail: string): string {
  if (!cond) throw new StepFailed(failDetail);
  return okDetail;
}

/** A plain-words descriptor fragment (single shared branch point). */
function flag(cond: boolean, yes: string, no: string): string {
  return cond ? yes : no;
}

export async function runConformance(plan: ConformancePlan): Promise<ConformanceReport> {
  const { renderer, viewId, el, view } = plan;
  const originIntent = `conformance: ${viewId} gesture`;
  const expectedActor = plan.expectedActor ?? 'user';

  const gaps: ContractGap[] = [];
  const emissions: ChartEmission[] = [];
  const reencodeRequests: string[] = [];
  const hovers: (readonly string[] | null)[] = [];
  const navigations: NavigateViewState[] = [];
  const pending: Promise<void>[] = [];

  const callbacks: RendererCallbacks = {
    emit: (emission) => {
      emissions.push(emission);
      pending.push(view.emit(viewId, emission, originIntent));
    },
    hover: (keys) => {
      hovers.push(keys);
    },
    reencodeRequest: (channel) => {
      reencodeRequests.push(channel);
    },
    navigate: (viewState) => {
      navigations.push(viewState);
      pending.push(view.navigate(viewId, viewState));
    },
  };
  const settle = async (): Promise<void> => {
    await Promise.all(pending);
    // drain the renderer's own scheduler too: a framework may flush gesture
    // state on a macrotask (React's scheduler does), not a microtask — two
    // timer turns let that work land before the kit inspects the DOM
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  // populated by 'handshake'; every later step runs after it (stop-on-failure)
  let bound: BoundRenderer | undefined;
  let htmlBeforeGesture = '';
  let commitsBefore = 0;

  const steps: { name: ConformanceStepName; run(): Promise<string> | string }[] = [
    {
      name: 'version-guard',
      run() {
        // an incompatible-major host must be REFUSED — honest, never silent.
        // RENDERER_PROTOCOL_VERSION is this module's own well-formed constant.
        const alienMajor = (protocolMajor(RENDERER_PROTOCOL_VERSION) as number) + 1;
        const probe = bindRenderer(renderer, document.createElement('div'), {
          viewId,
          callbacks,
          hostProtocolVersion: `${alienMajor}.0`,
        });
        if (probe.ok) {
          probe.view.unmount(); // never leave the stray probe behind
          throw new StepFailed(`the renderer BOUND a ${alienMajor}.0 host — an incompatible major must be refused`);
        }
        return check(
          probe.gap.code === 'protocol-version-mismatch',
          `a ${alienMajor}.0 host was refused with the typed protocol-version-mismatch gap`,
          `refused, but with the wrong gap: ${probe.gap.code}`,
        );
      },
    },
    {
      name: 'transform-ownership',
      run() {
        // read the hello directly — the host owns ALL aggregation/decimation
        const probe = renderer.mount(document.createElement('div'), {
          protocolVersion: RENDERER_PROTOCOL_VERSION,
          viewId,
          callbacks,
        });
        const declared = probe.hello.transforms ?? [];
        probe.unmount();
        return check(
          declared.length === 0,
          'the renderer declares no internal data transforms',
          `the renderer declares internal transforms (${declared.join(', ')}) — the host owns aggregation/decimation`,
        );
      },
    },
    {
      name: 'handshake',
      run() {
        const res = bindRenderer(renderer, el, { viewId, callbacks, onGap: (g) => gaps.push(g) });
        if (!res.ok) throw new StepFailed(`the bind was refused: ${res.gap.detail}`);
        bound = res.view;
        const caps = bound.capabilities;
        const invalid = caps.emissionKinds.filter((k) => k !== 'point' && k !== 'interval' && k !== 'cell');
        const kinds = flag(
          caps.emissionKinds.length === 0,
          'none declared',
          flag(invalid.length === 0, 'valid', `undeclared kind(s): ${invalid.join(',')}`),
        );
        return check(
          kinds === 'valid',
          `bound; speaks ${bound.protocolVersion}; emits ${caps.emissionKinds.join('+')}`,
          `capabilities are not sane — emissionKinds: ${kinds}`,
        );
      },
    },
    {
      name: 'renders',
      run() {
        bound!.update(plan.buildState(view.getState()));
        return check(
          el.childElementCount > 0,
          'update(RenderState) drew into the mount',
          'update(RenderState) left the mount empty',
        );
      },
    },
    {
      name: 'gesture-emits',
      async run() {
        htmlBeforeGesture = el.innerHTML;
        commitsBefore = view.getState().commits.length;
        await plan.gesture(el);
        await settle();
        const kinds = flag(
          emissions.length > 0,
          flag(
            emissions.every((e) => bound!.capabilities.emissionKinds.includes(e.encoding.kind)),
            'declared',
            'undeclared',
          ),
          'none',
        );
        return check(
          kinds === 'declared',
          `the gesture emitted ${emissions.length} R3 emission(s), all of declared kinds`,
          `expected emissions of the declared kinds only — got: ${kinds}`,
        );
      },
    },
    {
      name: 'commit-lands',
      run() {
        const st = view.getState();
        if (st.commits.length <= commitsBefore) {
          throw new StepFailed('the emission never landed a commit in the session log');
        }
        const landed = st.commits[st.commits.length - 1]!;
        const origin = `${landed.viewId} · ${landed.actor} · ${String(landed.intent)}`;
        return check(
          origin === `${viewId} · ${expectedActor} · ${originIntent}`,
          `commit #${landed.id} carries its origin in the cause (${origin})`,
          `the landed commit's origin is wrong: ${origin}`,
        );
      },
    },
    {
      name: 'crossfilter-returns',
      async run() {
        await settle(); // the gesture's own render must have landed before the DOM comparison
        const st = view.getState();
        const selection = selectionForView(st.selections, viewId);
        bound!.update(plan.buildState(st));
        const updated = flag(
          plan.verifyUpdate ? plan.verifyUpdate(el) : el.innerHTML !== htmlBeforeGesture,
          'renderer-updated',
          'renderer-static',
        );
        const descriptor = `${flag(selection.clauses.has(viewId), 'self-addressable', 'self-missing')} · ${updated}`;
        return check(
          descriptor === 'self-addressable · renderer-updated',
          `the view's own clause is addressable in the derived selection (${selection.clauses.size} clause(s)) and the renderer re-rendered`,
          `the crossfilter loop did not visibly return: ${descriptor}`,
        );
      },
    },
    {
      name: 'cell',
      async run() {
        // D30 (protocol 1.1): the compound-cell arm — exercised only by
        // renderers that DECLARE the cell emission kind; everyone else skips
        // honestly (the declared-capability rule, not a silent pass).
        if (!bound!.capabilities.emissionKinds.includes('cell')) {
          return 'the renderer declares no cell emissions — the cell arm is honestly skipped';
        }
        if (!plan.cellGesture) {
          throw new StepFailed('the renderer declares the cell emission kind but the plan provides no cellGesture to drive');
        }
        const emissionsBefore = emissions.length;
        const commitsBeforeCell = view.getState().commits.length;
        await plan.cellGesture(el);
        await settle();
        const cellEmissions = emissions.slice(emissionsBefore).filter((e) => e.encoding.kind === 'cell');
        if (cellEmissions.length === 0) {
          throw new StepFailed('the cell gesture produced no cell emission');
        }
        const st = view.getState();
        const landedCount = st.commits.length - commitsBeforeCell;
        if (landedCount !== 1) {
          // the D30 ruling is exactly ONE commit per cell gesture — zero means
          // the session refused it (e.g. a ghost field), two means it split
          throw new StepFailed(`the cell gesture landed ${landedCount} commit(s) — the D30 ruling is exactly ONE`);
        }
        const landed = st.commits[st.commits.length - 1]!; // landedCount === 1 ⇒ a last commit exists
        const selection = selectionForView(st.selections, viewId);
        const own = selection.clauses.get(viewId);
        const descriptor = [
          flag(landed.kind === 'cell', 'cell-kind', `kind:${landed.kind}`),
          flag((landed.fields?.length ?? 0) === 2, 'both-fields', 'fields-missing'),
          flag(own?.kind === 'cell', 'self-addressable', 'self-missing'),
        ].join(' · ');
        return check(
          descriptor === 'cell-kind · both-fields · self-addressable',
          // `?? []`: check() builds BOTH detail strings before deciding, and on
          // the failure path a non-cell commit carries no pair to name
          `the cell gesture landed ONE compound cell commit (${(landed.fields ?? []).join(' AND ')}) and its clause is addressable`,
          `the cell arm misbehaved: ${descriptor}`,
        );
      },
    },
    {
      name: 'navigate',
      async run() {
        const navState = plan.navigateState ?? { x: [0, 1] };
        if (bound!.capabilities.canPanZoom) {
          const selectionsBefore = JSON.stringify(view.getState().selections);
          const commitsBeforeNav = view.getState().commits.length;
          const sessionGapsBefore = view.getState().gaps.length;
          const outcome = bound!.navigate(navState);
          await settle();
          const st = view.getState();
          const descriptor = [
            flag(outcome.ok, 'accepted', 'refused'),
            flag(navigations.length > 0, 'recorded', 'unrecorded'),
            flag(JSON.stringify(st.selections) === selectionsBefore, 'non-filtering', 'FILTERED'),
            flag(st.commits.length === commitsBeforeNav, 'no-commit', 'committed'),
            flag(st.gaps.length === sessionGapsBefore, 'no-gap', 'gap-filed'),
          ].join(' · ');
          return check(
            descriptor === 'accepted · recorded · non-filtering · no-commit · no-gap',
            'navigate was recorded and is deliberately non-filtering (no selection change, no commit, no gap)',
            `navigate on a canPanZoom view misbehaved: ${descriptor}`,
          );
        }
        const contractGapsBefore = gaps.length;
        const outcome = bound!.navigate(navState);
        const newCodes = gaps.slice(contractGapsBefore).map((g) => g.code);
        const descriptor = [
          flag(!outcome.ok, 'refused', 'accepted'),
          flag(newCodes.includes('navigate-unsupported'), 'typed-gap-filed', `gaps: ${newCodes.join(',')}`),
          flag(navigations.length === 0, 'nothing-recorded', 'recorded'),
        ].join(' · ');
        return check(
          descriptor === 'refused · typed-gap-filed · nothing-recorded',
          'a host-driven navigate on this non-capable view landed the typed navigate-unsupported gap and recorded nothing',
          `navigate on a canPanZoom:false view misbehaved: ${descriptor}`,
        );
      },
    },
    {
      name: 'unmount',
      run() {
        bound!.unmount();
        return check(
          el.childElementCount === 0,
          'unmount left the mount clean',
          `unmount left ${el.childElementCount} child(ren) behind`,
        );
      },
    },
  ];

  const results: ConformanceStep[] = [];
  for (const step of steps) {
    try {
      const detail = await step.run();
      results.push({ step: step.name, ok: true, detail });
    } catch (err) {
      const detail = flag(err instanceof StepFailed, (err as Error).message, `threw: ${String(err)}`);
      results.push({ step: step.name, ok: false, detail });
      break; // later steps depend on this one — stop, report honestly
    }
  }

  return {
    ok: results.every((s) => s.ok),
    steps: results,
    gaps,
    emissions,
    reencodeRequests,
    hovers,
  };
}
