/**
 * `<LinkMatrix>` — the link graph as the table a customer edits (layer 4).
 *
 * Rows are sources by view and emission kind, columns are target views, a
 * cell is the response the target gives that source. Three looks, three
 * facts: a DEFAULT edge (the rule written out), a DECLARED edge (someone
 * chose it), a declared NONE (the link is off on purpose). A blank cell is a
 * SILENCE — no edge at all, which only happens under `linkDefault: 'none'` —
 * and is drawn as blank, never as a response. `self` is not a cell to edit.
 *
 * An `encoding` row is the source's channel BINDINGS: a `follow` cell means the
 * target's channels follow the source's (the pairs are shown beside it), and
 * there is no default rule for it — absent is a silence.
 *
 * Read-only by default. With `onChange`, every cell is a select and a change
 * is handed to the host as one edge — the host lands it as a `link` commit,
 * like any act (this component never talks to a session).
 *
 * Ships as its own entry point (`vizfootprint-ui/links`) so an app that never
 * edits links never bundles the editor.
 */
import type { LinkEdgeView, LinkGraphView } from '../adapter/types.js';

export type LinkResponse = LinkEdgeView['response'];
/** The responses a SELECTION edge may carry. */
export const LINK_RESPONSES: readonly LinkResponse[] = ['filter', 'highlight', 'navigate', 'mirror', 'none'];
/** The responses an ENCODING edge may carry: the target follows the source's binding, or does not, on purpose. */
export const ENCODING_RESPONSES: readonly LinkResponse[] = ['follow', 'none'];
export function responsesFor(kind: LinkEdgeView['kind']): readonly LinkResponse[] {
  return kind === 'encoding' ? ENCODING_RESPONSES : LINK_RESPONSES;
}

export interface LinkMatrixProps {
  readonly graph: LinkGraphView;
  /** viewId → display label. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Present when the host lets the person edit: called with the edge as it should be after the change. */
  readonly onChange?: (edge: { readonly source: string; readonly kind: LinkEdgeView['kind']; readonly target: string; readonly response: LinkResponse | null }) => void;
  readonly readOnly?: boolean;
  /** Hide views with NO voice at all from the rows (they still appear as targets). A view that only carries the `encoding` voice — one nobody can brush, whose bindings others may follow — keeps its row. Default true. */
  readonly hideSilentSources?: boolean;
  readonly className?: string;
}

/** The edge from (source, kind) into target, or undefined for a silence. */
export function edgeAt(graph: LinkGraphView, source: string, kind: LinkEdgeView['kind'], target: string): LinkEdgeView | undefined {
  return graph.edges.find((e) => e.source === source && e.kind === kind && e.target === target);
}

/** The words a cell shows and the fact it states. */
export function cellOf(edge: LinkEdgeView | undefined): { readonly text: string; readonly fact: 'default' | 'declared' | 'edited' | 'none' | 'silence' } {
  if (edge === undefined) return { text: '', fact: 'silence' };
  if (edge.response === 'none') return { text: 'none', fact: edge.origin === 'edited' ? 'edited' : 'none' };
  return { text: edge.response, fact: edge.origin };
}

export function LinkMatrix({ graph, labels = {}, onChange, readOnly = false, hideSilentSources = true, className }: LinkMatrixProps): JSX.Element {
  const name = (id: string): string => labels[id] ?? id;
  const sources = graph.views.filter((v) => !hideSilentSources || v.voice.length > 0);
  const editable = onChange !== undefined && !readOnly;
  return (
    <div className={`vzf vzf-linkmatrix${className ? ' ' + className : ''}`} data-vzf="link-matrix">
      <table className="vzf-linkmatrix-table" aria-label="link matrix: what each view's emission does to every other view">
        <thead>
          <tr>
            <th scope="col" className="vzf-linkmatrix-corner">source ↓ · target →</th>
            {graph.views.map((t) => (
              <th key={t.viewId} scope="col">
                {name(t.viewId)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.flatMap((s) =>
            s.voice.map((kind) => (
              <tr key={`${s.viewId}:${kind}`}>
                <th scope="row">
                  <span className="vzf-linkmatrix-view">{name(s.viewId)}</span> <span className="vzf-mono vzf-soft">{kind}</span>
                </th>
                {graph.views.map((t) => {
                  if (t.viewId === s.viewId) {
                    return (
                      <td key={t.viewId} className="vzf-linkmatrix-self" aria-label="self">
                        self
                      </td>
                    );
                  }
                  const edge = edgeAt(graph, s.viewId, kind, t.viewId);
                  const cell = cellOf(edge);
                  const label = `${name(s.viewId)} ${kind} → ${name(t.viewId)}`;
                  return (
                    <td key={t.viewId} className={`vzf-linkmatrix-cell vzf-linkmatrix-${cell.fact}`} data-edge={`${s.viewId}:${kind}→${t.viewId}`} data-fact={cell.fact}>
                      {editable ? (
                        <select
                          className="vzf-linkmatrix-select"
                          aria-label={label}
                          value={edge?.response ?? ''}
                          onChange={(e) => onChange({ source: s.viewId, kind, target: t.viewId, response: e.target.value === 'rule' ? null : (e.target.value as LinkResponse) })}
                        >
                          {cell.fact === 'silence' && <option value="">silence</option>}
                          {cell.fact === 'edited' && <option value="rule">{kind === 'encoding' ? 'back to the declaration' : 'back to the rule'}</option>}
                          {responsesFor(kind).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span title={edge?.label ?? label}>{cell.text}</span>
                      )}
                      {edge?.kind === 'encoding' && edge.channels !== undefined && edge.response === 'follow' ? (
                        <span className="vzf-linkmatrix-pairs vzf-mono vzf-soft" title="which channels follow: source channel → target channel">
                          {' '}
                          {edge.channels.map((c) => (c.from === c.to ? c.from : `${c.from}→${c.to}`)).join(', ') || 'no shared channel'}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            )),
          )}
        </tbody>
      </table>
      <div className="vzf-linkmatrix-legend" aria-hidden="true">
        <span className="vzf-linkmatrix-default">default rule</span>
        <span className="vzf-linkmatrix-declared">declared</span>
        <span className="vzf-linkmatrix-edited">edited here</span>
        <span className="vzf-linkmatrix-none">none (off on purpose)</span>
        <span className="vzf-linkmatrix-silence">blank = silence</span>
      </div>
    </div>
  );
}
