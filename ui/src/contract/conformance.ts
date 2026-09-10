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
 *   9. neighbourhood        — protocol 1.3: a renderer DECLARING the
 *                             neighbourhood emission kind drives the plan's
 *                             neighbourhoodGesture and must land exactly ONE
 *                             walk commit — both endpoint columns, the seed
 *                             INSIDE the walked set, and an addressable clause
 *                             at whichever address spoke (a node-link asks on
 *                             its EDGES layer); a renderer not declaring it
 *                             skips the arm honestly
 *  10. layers               — protocol 1.2: a renderer DECLARING `canLayer`
 *                             receives the plan's two-layer frame, draws it,
 *                             and a gesture on the SECOND layer speaks through
 *                             THAT layer's callback bundle and lands exactly
 *                             ONE commit whose viewId is the layer address
 *                             (`viewId~layerId`); a renderer not declaring it
 *                             skips the arm honestly
 *  11. navigate             — a canPanZoom renderer's navigate is recorded and
 *                             NON-FILTERING; a non-capable one lands the typed
 *                             `navigate-unsupported` gap and records nothing
 *  12. unmount              — the mount is left clean
 *
 * Steps run in order and STOP at the first failure (later steps depend on
 * earlier ones); the report carries every step's outcome in plain words.
 * All eight first-party renderers pass this kit (`conformance.test.tsx`) —
 * the heatmap exercising the cell arm — the reference claim is proven, not
 * asserted.
 */

import { layerAddress } from 'vizfootprint/def';
import { bindRenderer, type BoundRenderer } from './bind.js';
import { selectionForView, selfSelectedNeighbourhood } from './selection.js';
import {
  RENDERER_PROTOCOL_VERSION,
  isEmissionKind,
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
  | 'match'
  | 'neighbourhood'
  | 'layers'
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

/**
 * Protocol 1.2: what the layers arm needs from the host. REQUIRED when the
 * renderer declares `canLayer`; ignored otherwise. `buildState` must then
 * carry `layers` — at least TWO, so the arm can prove a gesture on the second
 * lands under the second's address and not the first's, or the view's.
 */
export interface ConformanceLayersPlan {
  /** The layer ids, in the order `buildState` lays them; the kit gestures on the SECOND. */
  readonly layerIds: readonly string[];
  /** Drive a SELECTING gesture on the second layer's marks. */
  gesture(el: HTMLElement): void | Promise<void>;
  /** Prove both layers are on screen. Default: the mount is not empty after the layered frame. */
  verify?(el: HTMLElement): boolean;
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
  /**
   * SET-1: drive a MANY-values gesture (a shift-click on a second mark, a drag
   * across a run) after `gesture` selected one. REQUIRED when the renderer
   * declares the 'match' emission kind; ignored otherwise.
   */
  matchGesture?(el: HTMLElement): void | Promise<void>;
  /**
   * Protocol 1.3: drive a WALK gesture (a node's alt-click). REQUIRED when the
   * renderer declares the 'neighbourhood' emission kind; ignored otherwise.
   * Drive it on a node no earlier step walked — asking for the walk already in
   * force CLEARS it, and a cleared walk lands no set to check.
   *
   * The arm judges the COMMIT, whichever walk it was: a 1.4 renderer may say
   * which one (`encoding.walk` — two hops of ego, a path, a component) and a
   * 1.3 one says nothing and gets the one-hop ego walk. Both land one commit
   * whose recorded set contains its seed, which is what is checked.
   */
  neighbourhoodGesture?(el: HTMLElement): void | Promise<void>;
  /** Prove the post-crossfilter re-render is visible. Default: the mount's DOM changed since before the gesture. */
  verifyUpdate?(el: HTMLElement): boolean;
  /** Protocol 1.2: the layers arm. REQUIRED when the renderer declares `canLayer`; ignored otherwise. */
  readonly layers?: ConformanceLayersPlan;
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
  /** 1.2: which ADDRESS each layer emission was spoken through — the bundle that spoke is the proof of which layer gestured. */
  const layerEmissions: { readonly address: string; readonly emission: ChartEmission }[] = [];

  /** The four verbs wired to ONE address — the view's, or a layer's (the same wiring, so a layer is a view to the session). */
  const callbacksFor = (address: string): RendererCallbacks => ({
    emit: (emission) => {
      emissions.push(emission);
      if (address !== viewId) layerEmissions.push({ address, emission });
      pending.push(view.emit(address, emission, `conformance: ${address} gesture`));
    },
    hover: (keys) => {
      hovers.push(keys);
    },
    reencodeRequest: (channel) => {
      reencodeRequests.push(channel);
    },
    navigate: (viewState) => {
      navigations.push(viewState);
      pending.push(view.navigate(address, viewState));
    },
  });
  const callbacks = callbacksFor(viewId);
  // bound at the handshake whenever the plan names layers — a renderer that
  // declares canLayer must be handed its bundles at mount, not after
  const layerBindings = plan.layers === undefined ? {} : { layers: { layerIds: plan.layers.layerIds, callbacksFor } };
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
        const res = bindRenderer(renderer, el, { viewId, callbacks, onGap: (g) => gaps.push(g), ...layerBindings });
        if (!res.ok) throw new StepFailed(`the bind was refused: ${res.gap.detail}`);
        bound = res.view;
        const caps = bound.capabilities;
        const invalid = caps.emissionKinds.filter((k) => !isEmissionKind(k));
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
      name: 'match',
      async run() {
        // SET-1: the many-values arm — exercised only by renderers that DECLARE
        // the match emission kind; everyone else skips honestly (the
        // declared-capability rule, not a silent pass).
        if (!bound!.capabilities.emissionKinds.includes('match')) {
          return 'the renderer declares no match emissions — the match arm is honestly skipped';
        }
        if (!plan.matchGesture) {
          throw new StepFailed('the renderer declares the match emission kind but the plan provides no matchGesture to drive');
        }
        const emissionsBefore = emissions.length;
        const commitsBefore = view.getState().commits.length;
        await plan.matchGesture(el);
        await settle();
        const matchEmissions = emissions.slice(emissionsBefore).filter((e) => e.encoding.kind === 'match');
        if (matchEmissions.length === 0) {
          throw new StepFailed('the match gesture produced no match emission');
        }
        const st = view.getState();
        const landedCount = st.commits.length - commitsBefore;
        if (landedCount !== 1) {
          throw new StepFailed(`the match gesture landed ${landedCount} commit(s) — one gesture is exactly ONE`);
        }
        const landed = st.commits[st.commits.length - 1]!;
        const own = selectionForView(st.selections, viewId).clauses.get(viewId);
        const body = landed.value as { readonly values?: readonly unknown[] } | null;
        const descriptor = [
          flag(landed.kind === 'match', 'match-kind', `kind:${landed.kind}`),
          flag((body?.values?.length ?? 0) >= 2, 'many-values', 'not-many'),
          flag(own?.kind === 'match', 'self-addressable', 'self-missing'),
        ].join(' · ');
        return check(
          descriptor === 'match-kind · many-values · self-addressable',
          `the match gesture landed ONE match commit over ${String(body?.values?.length ?? 0)} values and its clause is addressable`,
          `the match arm misbehaved: ${descriptor}`,
        );
      },
    },
    {
      name: 'neighbourhood',
      async run() {
        // protocol 1.3: the WALK arm — exercised only by renderers that DECLARE
        // the neighbourhood emission kind; everyone else skips honestly (the
        // declared-capability rule, not a silent pass).
        if (!bound!.capabilities.emissionKinds.includes('neighbourhood')) {
          return 'the renderer declares no neighbourhood emissions — the walk arm is honestly skipped';
        }
        if (!plan.neighbourhoodGesture) {
          throw new StepFailed('the renderer declares the neighbourhood emission kind but the plan provides no neighbourhoodGesture to drive');
        }
        const emissionsBefore = emissions.length;
        const spokenBefore = layerEmissions.length;
        const commitsBeforeWalk = view.getState().commits.length;
        await plan.neighbourhoodGesture(el);
        await settle();
        const walks = emissions.slice(emissionsBefore).filter((e) => e.encoding.kind === 'neighbourhood');
        if (walks.length === 0) {
          throw new StepFailed('the walk gesture produced no neighbourhood emission');
        }
        const st = view.getState();
        const landedCount = st.commits.length - commitsBeforeWalk;
        if (landedCount !== 1) {
          throw new StepFailed(`the walk gesture landed ${landedCount} commit(s) — one gesture on one node is exactly ONE`);
        }
        const landed = st.commits[st.commits.length - 1]!;
        // WHICH ADDRESS asked: a node-link's walk is a clause over the EDGES
        // table, so it is spoken through that layer's bundle and lands under
        // that layer's address — a plain view speaks through its own.
        const spoke = layerEmissions.slice(spokenBefore).filter((e) => e.emission.encoding.kind === 'neighbourhood');
        const address = spoke.length === 0 ? viewId : spoke[spoke.length - 1]!.address;
        const sel = selectionForView(st.selections, address);
        const own = sel.clauses.get(address);
        // read back through the contract's OWN reader, so the arm proves the
        // door a renderer draws the ego net with — not a second reading of the
        // same bytes that could agree with the commit while the door does not
        const walked = selfSelectedNeighbourhood(sel);
        const found = walked === null ? 0 : walked.ids.length - 1; // the recorded set includes the seed
        const descriptor = [
          flag(landed.kind === 'neighbourhood', 'walk-kind', `kind:${landed.kind}`),
          flag((landed.fields?.length ?? 0) === 2, 'both-endpoints', 'endpoints-missing'),
          flag(walked !== null && walked.ids.includes(walked.seed), 'seed-in-set', 'seed-not-in-set'),
          flag(landed.viewId === address, 'asked-address', `viewId:${landed.viewId}`),
          flag(own?.kind === 'neighbourhood', 'self-addressable', 'self-missing'),
        ].join(' · ');
        return check(
          descriptor === 'walk-kind · both-endpoints · seed-in-set · asked-address · self-addressable',
          `the walk gesture landed ONE commit under ${address}: the seed and the ${found} node(s) it touches, and its clause is addressable`,
          `the walk arm misbehaved: ${descriptor}`,
        );
      },
    },
    {
      name: 'layers',
      async run() {
        // protocol 1.2: the one-frame-many-tables arm — exercised only by
        // renderers that DECLARE canLayer; everyone else skips honestly
        if (bound!.capabilities.canLayer !== true) {
          return 'the renderer declares no canLayer — the layers arm is honestly skipped';
        }
        const layersPlan = plan.layers;
        if (!layersPlan) {
          throw new StepFailed('the renderer declares canLayer but the plan provides no layers to push');
        }
        const frame = plan.buildState(view.getState());
        const pushed = frame.layers ?? [];
        if (pushed.length < 2 || layersPlan.layerIds.length < 2) {
          throw new StepFailed(`the layers arm needs TWO layers on the frame and in the plan — got ${pushed.length} on the frame, ${layersPlan.layerIds.length} in the plan`);
        }
        bound!.update(frame); // never refused here: the arm runs only under canLayer, the guard's own condition
        const drawn = layersPlan.verify ? layersPlan.verify(el) : el.childElementCount > 0;
        if (!drawn) throw new StepFailed('the layered frame left nothing of both layers on screen');
        // the SECOND layer: a commit under its address proves the gesture went
        // through ITS bundle and not the first's, nor the view's
        const second = layerAddress(viewId, layersPlan.layerIds[1]!);
        const emissionsBefore = layerEmissions.length;
        const commitsBeforeLayers = view.getState().commits.length;
        await layersPlan.gesture(el);
        await settle();
        const spoke = layerEmissions.slice(emissionsBefore);
        if (spoke.length === 0) {
          throw new StepFailed('the layer gesture spoke through no layer bundle (a layer gesture through the view\'s own callbacks lands under the view)');
        }
        const st = view.getState();
        const landedCount = st.commits.length - commitsBeforeLayers;
        if (landedCount !== 1) {
          throw new StepFailed(`the layer gesture landed ${landedCount} commit(s) — one gesture on one layer is exactly ONE`);
        }
        const landed = st.commits[st.commits.length - 1]!;
        const descriptor = [
          flag(spoke.every((e) => e.address === second), 'second-bundle', `bundle:${spoke.map((e) => e.address).join(',')}`),
          flag(landed.viewId === second, 'layer-address', `viewId:${landed.viewId}`),
        ].join(' · ');
        return check(
          descriptor === 'second-bundle · layer-address',
          `both layers drawn; the gesture on "${layersPlan.layerIds[1]}" spoke through its bundle and landed ONE commit under ${second}`,
          `the layers arm misbehaved: ${descriptor}`,
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
