// @vitest-environment jsdom
/**
 * The host-side bind guard: version handshake, transform ownership, and the
 * navigate capability guard — every refusal a TYPED gap, never silent.
 */
import { describe, it, expect, vi } from 'vitest';
import { bindRenderer } from './bind.js';
import {
  RENDERER_PROTOCOL_VERSION,
  protocolMajor,
  speaksSameMajor,
  type ContractGap,
  type Renderer,
  type RendererCallbacks,
  type RendererCapabilities,
  type RenderState,
  type HostHandshake,
} from './types.js';
import { emptySelection } from './selection.js';

const CAPS: RendererCapabilities = {
  canBrush: false,
  canPointSelect: true,
  canHighlight: false,
  canReencode: false,
  canPanZoom: false,
  emissionKinds: ['point'],
};

function callbacks(): RendererCallbacks {
  return { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() };
}

function state(): RenderState {
  return { rows: [], encodings: {}, selection: emptySelection(), hover: null, theme: {}, size: { width: 100, height: 80 } };
}

/** A minimal honest renderer for the guard tests — records its lifecycle. */
function fakeRenderer(overrides: { protocolVersion?: string; transforms?: readonly string[]; capabilities?: RendererCapabilities } = {}) {
  const log: string[] = [];
  let seenHandshake: HostHandshake | null = null;
  const renderer: Renderer = {
    mount(el, handshake) {
      seenHandshake = handshake;
      log.push('mount');
      return {
        hello: {
          protocolVersion: overrides.protocolVersion ?? RENDERER_PROTOCOL_VERSION,
          capabilities: overrides.capabilities ?? CAPS,
          ...(overrides.transforms !== undefined ? { transforms: overrides.transforms } : {}),
        },
        update: (s) => {
          void s;
          log.push('update');
          (el as HTMLElement).textContent = 'drawn';
        },
        unmount: () => {
          log.push('unmount');
          (el as HTMLElement).textContent = '';
        },
      };
    },
  };
  return { renderer, log, handshake: () => seenHandshake };
}

describe('protocol version helpers', () => {
  it('parses major.minor and refuses garbage', () => {
    expect(protocolMajor('1.0')).toBe(1);
    expect(protocolMajor('2.7')).toBe(2);
    expect(protocolMajor('nonsense')).toBeNull();
    expect(protocolMajor('1')).toBeNull();
  });
  it('same major = compatible; different major or garbage = not', () => {
    expect(speaksSameMajor('1.0', '1.3')).toBe(true);
    expect(speaksSameMajor('1.0', '2.0')).toBe(false);
    expect(speaksSameMajor('1.0', 'v1')).toBe(false);
  });
});

describe('bindRenderer', () => {
  it('binds an honest same-major renderer and hands the handshake through (viewId + host version + the four callbacks)', () => {
    const { renderer, handshake } = fakeRenderer();
    const el = document.createElement('div');
    const cbs = callbacks();
    const res = bindRenderer(renderer, el, { viewId: 'scatter', callbacks: cbs });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.view.viewId).toBe('scatter');
    expect(res.view.protocolVersion).toBe(RENDERER_PROTOCOL_VERSION);
    expect(res.view.capabilities).toEqual(CAPS);
    expect(handshake()!.viewId).toBe('scatter');
    expect(handshake()!.protocolVersion).toBe(RENDERER_PROTOCOL_VERSION);
    expect(handshake()!.callbacks).toBe(cbs);
    // update/unmount pass through to the mounted renderer
    res.view.update(state());
    expect(el.textContent).toBe('drawn');
    res.view.unmount();
    expect(el.textContent).toBe('');
  });

  it('a minor difference still binds (same-major policy)', () => {
    const { renderer } = fakeRenderer({ protocolVersion: '1.9' });
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() });
    expect(res.ok).toBe(true);
  });

  it('a MAJOR mismatch refuses to bind: typed gap, onGap notified, renderer unmounted', () => {
    const { renderer, log } = fakeRenderer({ protocolVersion: '2.0' });
    const gaps: ContractGap[] = [];
    const res = bindRenderer(renderer, document.createElement('div'), {
      viewId: 'scatter',
      callbacks: callbacks(),
      onGap: (g) => gaps.push(g),
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.gap.code).toBe('protocol-version-mismatch');
    expect(res.gap.op).toBe('bind');
    expect(res.gap.target).toBe('scatter');
    expect(res.gap.detail).toContain('2.0');
    expect(res.gap.detail).toContain(RENDERER_PROTOCOL_VERSION);
    expect(gaps).toEqual([res.gap]);
    expect(log).toEqual(['mount', 'unmount']); // never left half-mounted
  });

  it('an unparseable renderer version refuses to bind the same way', () => {
    const { renderer } = fakeRenderer({ protocolVersion: 'latest' });
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.gap.code).toBe('protocol-version-mismatch');
  });

  it('a renderer declaring internal transforms is rejected at bind: transforms-not-owned', () => {
    const { renderer, log } = fakeRenderer({ transforms: ['bin', 'aggregate'] });
    const gaps: ContractGap[] = [];
    const res = bindRenderer(renderer, document.createElement('div'), {
      viewId: 'bar',
      callbacks: callbacks(),
      onGap: (g) => gaps.push(g),
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.gap.code).toBe('transforms-not-owned');
    expect(res.gap.detail).toContain('bin, aggregate');
    expect(res.gap.detail).toContain('host owns');
    expect(gaps).toHaveLength(1);
    expect(log).toEqual(['mount', 'unmount']);
  });

  it('an EMPTY transforms declaration binds (declaring none is the honest default)', () => {
    const { renderer } = fakeRenderer({ transforms: [] });
    expect(bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() }).ok).toBe(true);
  });

  it('host-driven navigate on a canPanZoom view rides the SAME navigate callback rail', () => {
    const { renderer } = fakeRenderer({ capabilities: { ...CAPS, canPanZoom: true } });
    const cbs = callbacks();
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'zoomy', callbacks: cbs });
    if (!res.ok) throw new Error('bind failed');
    const outcome = res.view.navigate({ x: [0, 100] });
    expect(outcome.ok).toBe(true);
    expect(cbs.navigate).toHaveBeenCalledWith({ x: [0, 100] });
  });

  it('host-driven navigate on a NON-capable view files navigate-unsupported and records nothing', () => {
    const { renderer } = fakeRenderer(); // canPanZoom: false
    const cbs = callbacks();
    const gaps: ContractGap[] = [];
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'bar', callbacks: cbs, onGap: (g) => gaps.push(g) });
    if (!res.ok) throw new Error('bind failed');
    const outcome = res.view.navigate({ x: [0, 1] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.gap.code).toBe('navigate-unsupported');
    expect(outcome.gap.op).toBe('navigate');
    expect(outcome.gap.target).toBe('bar');
    expect(cbs.navigate).not.toHaveBeenCalled();
    expect(gaps).toEqual([outcome.gap]);
  });

  // ── protocol 1.2: layer bundles on the handshake, and the layers-unsupported guard ──

  it('a plain bind carries NO layers key on the handshake, and a plain update answers ok (byte-identical to 1.1)', () => {
    const { renderer, handshake } = fakeRenderer();
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() });
    if (!res.ok) throw new Error('bind failed');
    expect('layers' in handshake()!).toBe(false);
    expect(Object.keys(handshake()!)).toEqual(['protocolVersion', 'viewId', 'callbacks']);
    expect(res.view.update(state())).toEqual({ ok: true });
  });

  it('bound layers become ONE callback bundle per layerId, each wired by the host to the MINTED address', () => {
    const { renderer, handshake } = fakeRenderer({ capabilities: { ...CAPS, canLayer: true } });
    const wired: string[] = [];
    const emitted: string[] = [];
    const res = bindRenderer(renderer, document.createElement('div'), {
      viewId: 'net',
      callbacks: callbacks(),
      layers: {
        layerIds: ['edges', 'nodes'],
        callbacksFor: (address) => {
          wired.push(address);
          return { ...callbacks(), emit: () => emitted.push(address) };
        },
      },
    });
    expect(res.ok).toBe(true);
    expect(wired).toEqual(['net~edges', 'net~nodes']); // minted by bind, through the library's one owner of the marker
    const layers = handshake()!.layers!;
    expect(Object.keys(layers)).toEqual(['edges', 'nodes']);
    layers['nodes']!.emit({ rawValue: 'flu', encoding: { kind: 'point', field: 'id' } });
    expect(emitted).toEqual(['net~nodes']); // which bundle spoke IS which layer spoke
  });

  it('a layered frame pushed at a renderer without canLayer is REFUSED: typed layers-unsupported gap, onGap notified, nothing drawn', () => {
    const { renderer, log } = fakeRenderer(); // CAPS declares no canLayer
    const gaps: ContractGap[] = [];
    const el = document.createElement('div');
    const res = bindRenderer(renderer, el, { viewId: 'net', callbacks: callbacks(), onGap: (g) => gaps.push(g) });
    if (!res.ok) throw new Error('bind failed');
    const layered: RenderState = { ...state(), layers: [{ layerId: 'edges', table: 'edges', rows: [], encodings: {} }, { layerId: 'nodes', table: 'nodes', rows: [], encodings: {} }] };
    const outcome = res.view.update(layered);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.gap).toEqual({
      code: 'layers-unsupported',
      op: 'update',
      detail: 'view "net" declares no canLayer — the frame carried 2 layer(s) and was not drawn',
      target: 'net',
    });
    expect(gaps).toEqual([outcome.gap]);
    expect(log).toEqual(['mount']); // update never reached the renderer — no half-drawn frame
    expect(el.textContent).toBe('');
  });

  it('an EMPTY layers list carries nothing to refuse — it is forwarded like a plain frame', () => {
    const { renderer, log } = fakeRenderer();
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() });
    if (!res.ok) throw new Error('bind failed');
    expect(res.view.update({ ...state(), layers: [] })).toEqual({ ok: true });
    expect(log).toEqual(['mount', 'update']);
  });

  it('a canLayer renderer receives the layered frame whole', () => {
    const { renderer, log } = fakeRenderer({ capabilities: { ...CAPS, canLayer: true } });
    const res = bindRenderer(renderer, document.createElement('div'), { viewId: 'v', callbacks: callbacks() });
    if (!res.ok) throw new Error('bind failed');
    expect(res.view.update({ ...state(), layers: [{ layerId: 'a', table: 't', rows: [], encodings: {} }] })).toEqual({ ok: true });
    expect(log).toEqual(['mount', 'update']);
  });

  it('a custom hostProtocolVersion drives the handshake (the conformance kit uses this)', () => {
    const { renderer, handshake } = fakeRenderer();
    const res = bindRenderer(renderer, document.createElement('div'), {
      viewId: 'v',
      callbacks: callbacks(),
      hostProtocolVersion: '99.0',
    });
    expect(res.ok).toBe(false); // a 99.x host cannot bind a 1.0 renderer — majors differ
    expect(handshake()!.protocolVersion).toBe('99.0');
  });
});
