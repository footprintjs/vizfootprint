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
 * WHY `canPanZoom` AND `canLayer` ARE THE ONLY CAPABILITIES GUARDED HERE. A
 * guard belongs where the HOST drives an act that would otherwise vanish:
 * `navigate` is the one verb a host can push INTO a view, so a non-capable
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
 * rather than draw half of it. The flags remain declarations a host READS,
 * and exactly two of them are enforced. A new capability earns a guard here
 * only if a host-driven request could otherwise go unrecorded, or a pushed
 * frame could be drawn as a lie — see this folder's README.md.
 *
 * LAYER BUNDLES (1.2): a host that binds layers passes their ids and ONE
 * wiring function; this file mints the address of each (`viewId~layerId`,
 * through `vizfootprint/def`'s `layerAddress` — the marker's only owner) and
 * hands the renderer a callback bundle per layer on the handshake. A
 * renderer never spells an address; it speaks through the bundle it was
 * given, and the commit lands where the bundle was bound.
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
}

/** The outcome of a host-driven `navigate` on a bound view. */
export type NavigateOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

/** The outcome of a host push: drawn, or refused with the typed gap (1.2 — a layered frame at a renderer that cannot layer). */
export type UpdateOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

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
  const base = { protocolVersion: hostVersion, viewId: options.viewId, callbacks: options.callbacks };
  return options.layers === undefined ? base : { ...base, layers: layerBundlesOf(options.viewId, options.layers) };
}

/** One bundle per layer, keyed by layerId, each wired by the host to the minted address. */
function layerBundlesOf(viewId: string, layers: LayerBindings): Readonly<Record<string, RendererCallbacks>> {
  const bundles: Record<string, RendererCallbacks> = {};
  for (const layerId of layers.layerIds) bundles[layerId] = layers.callbacksFor(layerAddress(viewId, layerId));
  return bundles;
}
