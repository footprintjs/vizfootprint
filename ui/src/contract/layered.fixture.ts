/**
 * A tiny `canLayer` renderer — pure DOM, no framework — and the host-side
 * frame for the network fixture. The contract's layers arm is proven on
 * this, the way the navigate arm is proven on the synthetic stub: a
 * renderer that draws every layer it is pushed and speaks each layer's
 * gesture through THAT layer's callback bundle. Its knobs are the hostile
 * bestiary's: where a layer button speaks, whether layers are drawn at all,
 * and which field a layer emits on.
 */
import { selectionForView } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type Renderer, type RendererCallbacks, type RendererCapabilities, type RenderLayer, type RenderState } from './types.js';
import type { SessionViewState } from '../adapter/types.js';
import { EDGES, NODES } from '../adapter/network.fixture.js';

export interface LayeredRendererOptions {
  /** Default true — the honest declaration. `false` declares nothing and still draws layers if pushed (the flag half of the law). */
  readonly canLayer?: boolean;
  /** Where a LAYER button speaks: its own bundle (honest) or the view's callbacks — the lie the kit must catch. */
  readonly speakThrough?: 'bundle' | 'view';
  /** Draw no layer at all (the frame is accepted and half-drawn — what `verify` catches). */
  readonly drawLayers?: boolean;
  /** Override the field a layer emits on (a ghost field the session refuses). */
  readonly emitField?: Readonly<Record<string, string>>;
  /**
   * Protocol 1.3: declare and speak the WALK. The button asks on the EDGES
   * layer's own bundle — where a walk's clause belongs, since it reads that
   * table's two endpoint columns — and `then` emits a second, ordinary point
   * right after it, which is how the kit's descriptor arm is reached (a
   * refused walk shadowed by a commit that did land).
   */
  readonly walk?: {
    readonly field: string;
    readonly seed: unknown;
    readonly layerId?: string;
    /** `'view'` asks through the VIEW's own callbacks — a plain view that walks, where the view IS the table the clause names. */
    readonly through?: 'view';
    readonly then?: { readonly field: string; readonly value: unknown };
  };
  /** The field the VIEW's own probe emits on. Default `size` — a nodes column, which is what `net` reads by default. */
  readonly viewField?: string;
}

/** The field a layer's gesture emits on: the first bound field of its encodings (a fixture layer always binds one), unless overridden. */
function fieldOf(layer: RenderLayer, options: LayeredRendererOptions): string {
  return options.emitField?.[layer.layerId] ?? Object.values(layer.encodings)[0]!;
}

/** The view's own gesture: the first node's size — `net` is judged against the default table, the nodes. */
const VIEW_FIELD = 'size';

export function layeredRenderer(options: LayeredRendererOptions = {}): Renderer {
  const capabilities: RendererCapabilities = {
    canBrush: false,
    canPointSelect: true,
    canHighlight: false,
    canReencode: false,
    canPanZoom: false,
    emissionKinds: options.walk === undefined ? ['point'] : ['point', 'neighbourhood'],
    ...(options.canLayer === false ? {} : { canLayer: true }),
  };
  return {
    mount(el, handshake) {
      const host = el as HTMLElement;
      const bundleFor = (layerId: string): RendererCallbacks | undefined =>
        options.speakThrough === 'view' ? handshake.callbacks : handshake.layers?.[layerId];
      return {
        hello: { protocolVersion: RENDERER_PROTOCOL_VERSION, capabilities },
        update(state: RenderState) {
          host.textContent = '';
          const probe = document.createElement('button');
          probe.className = 'probe';
          probe.textContent = `rows ${state.rows.length} · clauses ${state.selection.clauses.size}`;
          const viewField = options.viewField ?? VIEW_FIELD;
          probe.addEventListener('click', () => handshake.callbacks.emit({ rawValue: state.rows[0]![viewField], encoding: { kind: 'point', field: viewField } }));
          host.appendChild(probe);
          const walk = options.walk;
          if (walk !== undefined) {
            const ask = document.createElement('button');
            ask.className = 'walk';
            ask.textContent = `walk from ${String(walk.seed)}`;
            ask.addEventListener('click', () => {
              const voice = walk.through === 'view' ? handshake.callbacks : bundleFor(walk.layerId ?? 'edges');
              voice?.emit({ rawValue: walk.seed, encoding: { kind: 'neighbourhood', field: walk.field } });
              if (walk.then !== undefined) voice?.emit({ rawValue: walk.then.value, encoding: { kind: 'point', field: walk.then.field } });
            });
            host.appendChild(ask);
          }
          if (options.drawLayers === false) return;
          for (const layer of state.layers ?? []) {
            const box = document.createElement('div');
            box.className = 'layer';
            box.dataset['layer'] = layer.layerId;
            box.dataset['table'] = layer.table;
            layer.rows.forEach((row, i) => {
              const mark = document.createElement('button');
              mark.dataset['layer'] = layer.layerId;
              mark.dataset['row'] = String(i);
              mark.textContent = String(row[fieldOf(layer, options)]);
              mark.addEventListener('click', () => {
                const f = fieldOf(layer, options);
                bundleFor(layer.layerId)?.emit({ rawValue: row[f], encoding: { kind: 'point', field: f } });
              });
              box.appendChild(mark);
            });
            host.appendChild(box);
          }
        },
        unmount() {
          host.textContent = '';
        },
      };
    },
  };
}

export const SIZE = { width: 400, height: 300 };

/** The host's frame for `net`: the view's rows are the nodes; edges under nodes as two layers, each over its own table. The view binds no channel of its own (x and y are the layout's), so its fold is empty. */
export function networkState(st: SessionViewState, layers: readonly RenderLayer[] = networkLayers()): RenderState {
  return {
    rows: NODES,
    encodings: {},
    selection: selectionForView(st.selections, 'net'),
    hover: null,
    theme: {},
    size: SIZE,
    layers,
  };
}

/** Draw order, first = bottom: the edges lie under the nodes. The kit gestures on the SECOND — the nodes. */
export function networkLayers(): RenderLayer[] {
  return [
    { layerId: 'edges', table: 'edges', rows: EDGES, encodings: { size: 'weight' } },
    { layerId: 'nodes', table: 'nodes', rows: NODES, encodings: { color: 'group' } },
  ];
}

/** Ask the walk (protocol 1.3) — the stub's alt-click. */
export function clickWalk(el: HTMLElement): void {
  (el.querySelector('button.walk') as HTMLElement).click();
}

/** Click a layer's first mark. */
export function clickMark(layerId: string) {
  return (el: HTMLElement): void => {
    (el.querySelector(`button[data-layer="${layerId}"][data-row="0"]`) as HTMLElement).click();
  };
}
