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
 */

import {
  RENDERER_PROTOCOL_VERSION,
  speaksSameMajor,
  type ContractGap,
  type MountedRenderer,
  type NavigateViewState,
  type Renderer,
  type RendererCallbacks,
  type RendererCapabilities,
  type RenderState,
} from './types.js';

export interface BindOptions {
  readonly viewId: string;
  /** The four outbound verbs, host-wired (e.g. via a SessionView). */
  readonly callbacks: RendererCallbacks;
  /** The version the host speaks. Default: this build's own. */
  readonly hostProtocolVersion?: string;
  /** Observe every contract gap this bind (or its bound handle) files. */
  readonly onGap?: (gap: ContractGap) => void;
}

/** The outcome of a host-driven `navigate` on a bound view. */
export type NavigateOutcome = { readonly ok: true } | { readonly ok: false; readonly gap: ContractGap };

/** A successfully bound renderer — the host's handle on the view. */
export interface BoundRenderer {
  readonly viewId: string;
  /** The renderer's declared capabilities (from its hello). */
  readonly capabilities: RendererCapabilities;
  /** The protocol version the renderer speaks. */
  readonly protocolVersion: string;
  update(state: RenderState): void;
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

  const mounted: MountedRenderer = renderer.mount(el, {
    protocolVersion: hostVersion,
    viewId: options.viewId,
    callbacks: options.callbacks,
  });

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
      update: (state) => mounted.update(state),
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
