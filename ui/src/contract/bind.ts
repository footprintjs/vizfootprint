/**
 * `bindRenderer` — the HOST-side guard of the renderer contract. It performs
 * the mount handshake and refuses to bind, with a typed gap, when the hello
 * breaks a contract rule:
 *
 *   1. VERSION: the two sides must speak the same protocol MAJOR
 *      (`protocol-version-mismatch` — see the policy in types.ts).
 *   2. TRANSFORM OWNERSHIP: a renderer/spec declaring internal data
 *      transforms (bin/aggregate/…) is rejected (`transforms-not-owned`) —
 *      the host owns ALL aggregation/decimation; rows arrive prepared.
 *
 * A successful bind returns a {@link BoundRenderer}: `update`/`unmount` pass
 * through, and `navigate` adds the host-driving guard — asking a
 * `canPanZoom: false` view to navigate files a typed `navigate-unsupported`
 * gap instead of silently no-oping (and never reaches the recording rail).
 * Every gap is BOTH returned to the caller and offered to `onGap` (so an app
 * can surface contract gaps beside the session's own in `<GapsPanel>`).
 *
 * WHY `canPanZoom`, `canLayer` AND `canBringIntoView` ARE THE ONLY CAPABILITIES
 * GUARDED HERE. A guard belongs where the HOST drives an act that would
 * otherwise vanish: `navigate` is the one verb a host can push INTO a view,
 * so a non-capable
 * view has to refuse out loud or the request is lost with no trace. The
 * rest need no guard, and adding one would be theatre: `canBrush` /
 * `canPointSelect` describe gestures the USER makes, and those ride `emit`,
 * which the session records whether or not the flag was set; `canHighlight`
 * and `canReencode` describe what a renderer does with state the host
 * pushes, where absence is visible on screen rather than silent. `canLayer`
 * (protocol 1.2) is the second guard, and it is the inbound twin of the
 * first: a host that pushes `RenderState.layers` at a renderer that cannot
 * draw them would otherwise get ONE table drawn and no word about the
 * other — absence that is NOT visible, because the frame looks complete.
 * So `update` refuses the whole frame with a typed `layers-unsupported` gap
 * rather than draw half of it. `canBringIntoView` (protocol 1.11) is the
 * third, and it is the `canLayer` reason applied to an ACT rather than to a
 * frame: a host asks a 3D view to bring the selected residue where the reader
 * can see it, the view cannot, and the rows are still recoloured — so the
 * dashboard looks complete while the reader hunts a mark behind the molecule.
 * That absence is not visible either, so the ask is refused BY NAME
 * (`bring-into-view-unsupported`), and a renderer that declared the capability
 * and wired no method is named separately (`bring-into-view-undelivered`) —
 * the opposite diagnosis deserves its own word. The flags remain declarations
 * a host READS, and exactly three of them are enforced. A new capability
 * earns a guard here only if a host-driven request could otherwise go
 * unrecorded, or a pushed
 * frame could be drawn as a lie — see this folder's README.md.
 *
 * LAYER BUNDLES (1.2): a host that binds layers passes their ids and ONE
 * wiring function; this file mints the address of each (`viewId~layerId`,
 * through `vizfootprint/def`'s `layerAddress` — the marker's only owner) and
 * hands the renderer a callback bundle per layer on the handshake. A
 * renderer never spells an address; it speaks through the bundle it was
 * given, and the commit lands where the bundle was bound.
 *
 * RESOURCES (1.10): a host that declared resources passes the bytes it took out
 * of `Dashboard.resource(name)`, and they ride the handshake untouched. There
 * is no guard for them, by the rule above: a renderer that ignores an offered
 * resource records nothing and hides nothing.
 */

import { layerAddress } from 'vizfootprint/def';
import {
  RENDERER_PROTOCOL_VERSION,
  speaksSameMajor,
  type ContractGap,
  type HostHandshake,
  type MountedRenderer,
  type NavigateViewState,
  type Renderer,
  type RendererCallbacks,
  type RendererCapabilities,
  type RenderResource,
  type RenderState,
} from './types.js';

/**
 * Protocol 1.2: the layers a host binds under one view — their ids, and how
 * the host wires the four verbs for ONE address (the same wiring it did for
 * `callbacks`, with the layer address where the viewId went). `bindRenderer`
 * calls `callbacksFor` once per id with the minted address.
 */
export interface LayerBindings {
  readonly layerIds: readonly string[];
  callbacksFor(address: string): RendererCallbacks;
}

export interface BindOptions {
  readonly viewId: string;
  /** The four outbound verbs, host-wired (e.g. via a SessionView). */
  readonly callbacks: RendererCallbacks;
  /** The version the host speaks. Default: this build's own. */
  readonly hostProtocolVersion?: string;
  /** Observe every contract gap this bind (or its bound handle) files. */
  readonly onGap?: (gap: ContractGap) => void;
  /** Protocol 1.2: the view's layers. Absent = a plain view; the handshake then carries no `layers` key at all. */
  readonly layers?: LayerBindings;
  /**
   * Protocol 1.10: the declared RESOURCES this host offers this view — the
   * bytes a `Dashboard.resource(name)` handed it, keyed by the declared name.
   * Absent = the handshake carries no `resources` key at all (a 1.9 host's,
   * byte for byte).
   *
   * NO GUARD, on the stated rule (this file's header): a guard belongs where a
   * host-driven act would otherwise vanish, and a renderer that ignores an
   * offered resource records nothing and hides nothing — the geometry is simply
   * not drawn, which is visible on screen.
   */
  readonly resources?: Readonly<Record<string, RenderResource>>;
}

/** The outcome of a host-driven `navigate` on a bound view. */
export type NavigateOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

/** The outcome of a host push: drawn, or refused with the typed gap (1.2 — a layered frame at a renderer that cannot layer). */
export type UpdateOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

/**
 * PROTOCOL 1.11 — the outcome of a host-driven framing ask.
 *
 * `{ ok: true }` says THE CALL REACHED THE RENDERER and it did not throw. It
 * does NOT say the camera moved: nothing on this side of the boundary can see a
 * camera, and a renderer asked for rows it does not hold is REQUIRED not to move
 * (see {@link MountedRenderer.bringIntoView}). Saying less than it knows is the
 * point — an outcome that implied a camera move would be the same class of lie
 * a capability flag is.
 */
export type BringIntoViewOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

/** A successfully bound renderer — the host's handle on the view. */
export interface BoundRenderer {
  readonly viewId: string;
  /** The renderer's declared capabilities (from its hello). */
  readonly capabilities: RendererCapabilities;
  /** The protocol version the renderer speaks. */
  readonly protocolVersion: string;
  /**
   * Push one frame. A plain frame always reaches the renderer; a frame
   * carrying `layers` reaches only a `canLayer` renderer — at any other it
   * files a typed `layers-unsupported` gap and NOTHING of it is drawn (a
   * half-drawn frame would read as a whole one).
   *
   * Answers the outcome (1.2), the way `navigate` beside it always has. HOST
   * side only: the RENDERER's `update(state): void` is untouched, and the gap
   * still reaches `onGap`. A hand-authored `BoundRenderer` double must return
   * `{ ok: true }` — the one source change 1.2 asks of a host.
   */
  update(state: RenderState): UpdateOutcome;
  /**
   * HOST-driven navigation (e.g. an agent asks "zoom the scatter to x 0–100").
   * Guarded by the declared capability: a capable view records it through the
   * SAME `navigate` callback rail its own gestures use; a non-capable view
   * files a typed gap and nothing is recorded.
   */
  navigate(viewState: NavigateViewState): NavigateOutcome;
  /**
   * PROTOCOL 1.11 — HOST-driven framing: bring these rows where the reader can
   * see them. An EVENT, so it is a call and not a field on the frame; the whole
   * argument is on {@link MountedRenderer.bringIntoView}, together with what `[]`
   * means, what unknown keys mean, and what a renderer does when asked twice.
   *
   * IT RECORDS NOTHING, and the proof is structural rather than a promise: this
   * method reaches no outbound callback. `navigate` beside it calls
   * `options.callbacks.navigate` — that is the recording rail, and a reader's own
   * orbit belongs on it. A framing caused by a clause does not, because the
   * clause is already on the record.
   *
   * Guarded twice, both by Law 1: a view that declares no `canBringIntoView`
   * files `bring-into-view-unsupported`, and one that declares it while
   * shipping no method files `bring-into-view-undelivered`.
   */
  bringIntoView(keys: readonly string[]): BringIntoViewOutcome;
  unmount(): void;
}

export type BindResult =
  | { readonly ok: true; readonly view: BoundRenderer }
  | { readonly ok: false; readonly gap: ContractGap };

export function bindRenderer(renderer: Renderer, el: Element, options: BindOptions): BindResult {
  const hostVersion = options.hostProtocolVersion ?? RENDERER_PROTOCOL_VERSION;
  const file = (gap: ContractGap): ContractGap => {
    options.onGap?.(gap);
    return gap;
  };

  const mounted: MountedRenderer = renderer.mount(el, handshakeOf(hostVersion, options));

  if (!speaksSameMajor(hostVersion, mounted.hello.protocolVersion)) {
    mounted.unmount(); // refusal to bind — never leave a half-mounted view behind
    return {
      ok: false,
      gap: file({
        code: 'protocol-version-mismatch',
        op: 'bind',
        detail: `renderer speaks protocol ${mounted.hello.protocolVersion}, host speaks ${hostVersion} — same major required`,
        target: options.viewId,
      }),
    };
  }

  const transforms = mounted.hello.transforms ?? [];
  if (transforms.length > 0) {
    mounted.unmount();
    return {
      ok: false,
      gap: file({
        code: 'transforms-not-owned',
        op: 'bind',
        detail: `renderer declares internal data transforms (${transforms.join(', ')}) — the host owns all aggregation/decimation`,
        target: options.viewId,
      }),
    };
  }

  const capabilities = mounted.hello.capabilities;
  return {
    ok: true,
    view: {
      viewId: options.viewId,
      capabilities,
      protocolVersion: mounted.hello.protocolVersion,
      update(state) {
        const layerCount = state.layers?.length ?? 0;
        // WHY `> 0` and not "the key is present": an empty list carries no
        // table the renderer would fail to draw — refusing it would file a gap
        // about nothing
        if (layerCount > 0 && capabilities.canLayer !== true) {
          return {
            ok: false,
            gap: file({
              code: 'layers-unsupported',
              op: 'update',
              detail: `view "${options.viewId}" declares no canLayer — the frame carried ${layerCount} layer(s) and was not drawn`,
              target: options.viewId,
            }),
          };
        }
        mounted.update(state);
        return { ok: true };
      },
      navigate(viewState) {
        if (!capabilities.canPanZoom) {
          return {
            ok: false,
            gap: file({
              code: 'navigate-unsupported',
              op: 'navigate',
              detail: `view "${options.viewId}" declares canPanZoom: false — the navigate request was not recorded`,
              target: options.viewId,
            }),
          };
        }
        options.callbacks.navigate(viewState);
        return { ok: true };
      },
      bringIntoView(keys) {
        // 1.11, guard one: the host asked for something this renderer never
        // promised. A silent no-op was the alternative and is refused on this
        // file's own rule — the absence is NOT visible, because the rows were
        // still recoloured and the frame looks complete, so the reader is left
        // hunting a mark behind the molecule with nothing saying why. The
        // `canLayer` reason, applied to an act instead of a frame.
        if (capabilities.canBringIntoView !== true) {
          return {
            ok: false,
            gap: file({
              code: 'bring-into-view-unsupported',
              op: 'bringIntoView',
              detail: `view "${options.viewId}" declares no canBringIntoView — the request to bring ${keys.length} row(s) into view was not carried`,
              target: options.viewId,
            }),
          };
        }
        // guard two: it DECLARED the capability and wired nothing. Law 1 — a
        // flag nothing honours is worse than a missing one, so the lie is named
        // here rather than swallowed by an optional-call shrug
        if (typeof mounted.bringIntoView !== 'function') {
          return {
            ok: false,
            gap: file({
              code: 'bring-into-view-undelivered',
              op: 'bringIntoView',
              detail: `view "${options.viewId}" declares canBringIntoView: true and its mount ships no bringIntoView method — the capability was declared and not delivered`,
              target: options.viewId,
            }),
          };
        }
        // NOTHING IS RECORDED HERE, and there is nothing to record WITH: no
        // outbound callback is reachable from this branch. The clause that
        // caused this framing is already on the trace.
        mounted.bringIntoView(keys);
        return { ok: true };
      },
      unmount: () => mounted.unmount(),
    },
  };
}

// ── the handshake ─────────────────────────────────────────────────────────────

/**
 * What the host says at mount. The `layers` key exists only when layers were
 * bound — a plain view's handshake is byte-identical to a 1.1 host's.
 */
function handshakeOf(hostVersion: string, options: BindOptions): HostHandshake {
  return {
    protocolVersion: hostVersion,
    viewId: options.viewId,
    callbacks: options.callbacks,
    ...(options.layers !== undefined ? { layers: layerBundlesOf(options.viewId, options.layers) } : {}),
    // 1.10: OFFERED as the host handed them in — a resource's bytes are not copied here,
    // because the snapshot is already the carrier's own answer and a copy of a structure
    // file per mount is the most expensive possible way to say nothing new
    ...(options.resources !== undefined ? { resources: options.resources } : {}),
  };
}

/** One bundle per layer, keyed by layerId, each wired by the host to the minted address. */
function layerBundlesOf(viewId: string, layers: LayerBindings): Readonly<Record<string, RendererCallbacks>> {
  const bundles: Record<string, RendererCallbacks> = {};
  for (const layerId of layers.layerIds) bundles[layerId] = layers.callbacksFor(layerAddress(viewId, layerId));
  return bundles;
}
