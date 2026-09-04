/**
 * What a view SHOWS, as opposed to what it was told — the encoding kind of link
 * edge, read through the graph and never landed.
 *
 * A view's own bindings are a fold of its `reencode` commits. Its EFFECTIVE
 * bindings are those with every followed channel laid over them, and a follow
 * is a READING: it is judged by the target's own rules, it is never coerced,
 * and a refused one leaves the view's own binding standing with the sentence
 * beside it. Nothing here files a gap or lands a commit — this is the lint door
 * running continuously, not an act.
 *
 * The whole computation is a function of the views, the graph, the facets and
 * each view's own fold, so it lives here, apart from the session that memoizes
 * it. The MEMO stays behind, deliberately: a cache key is state, and state is
 * the session's. What moved is the algorithm, which had grown to be the longest
 * single piece of reasoning in `session.ts` while depending on nothing the
 * session holds.
 *
 * **The one thing to know before changing it: the ONE-HOP LAW.** A follow reads
 * the source view's OWN fold — never a binding the source is itself following.
 * That is what lets two views point at each other without a cycle, and it is
 * why the `others` a follow is judged against are the RAW effective bindings
 * (own plus every candidate, refused ones included) rather than the judged
 * ones: judging B against judged C against judged B is the fixed point the law
 * exists to avoid. If you find yourself wanting a second hop, you are asking
 * for a solver, and this is not one.
 */
import { deepFreeze } from '../detach/index.js';
import { ENCODING_KIND, edgesInto, type LinkGraph } from '../links/index.js';
import { fitsFor, validateBindings, type Bindings, type EncodingPorts, type EncodingRules, type Fit } from '../encoding/index.js';
import type { ViewDecl, ViewEncodingDecl } from '../def/types.js';
import type { ColumnFacet, EffectiveEncoding } from './types.js';

/**
 * Every view's EFFECTIVE encoding under the link graph. Two passes: (1) each
 * view's own fold plus the channels it follows, ONE HOP (see the header); where
 * two edges reach one channel, graph order decides — last wins; (2) each
 * followed channel judged by the TARGET's own rules through the one validator,
 * against the other views' effective bindings.
 *
 * `ownBindings` is the caller's fold of a view's own `reencode` commits — the
 * one thing here the session actually owns, passed in rather than reached for.
 */
export function computeEffectiveEncodings(input: {
  readonly views: ReadonlyMap<string, ViewDecl>;
  readonly graph: LinkGraph;
  readonly facets: readonly ColumnFacet[];
  readonly ownBindings: (viewId: string) => Bindings;
  readonly rules: EncodingRules;
  readonly ports: EncodingPorts;
}): ReadonlyMap<string, EffectiveEncoding> {
  const { views, graph, facets, ownBindings, rules, ports } = input;
  type Candidate = { readonly field: string; readonly edge: string; readonly from: string; readonly sourceChannel: string };
  const raw = new Map<string, { readonly own: Bindings; readonly byChannel: ReadonlyMap<string, Candidate> }>();
  for (const [viewId, view] of views) {
    if (view.encoding === undefined) continue;
    const byChannel = new Map<string, Candidate>();
    for (const edge of edgesInto(graph, viewId)) {
      if (edge.kind !== ENCODING_KIND || edge.response !== 'follow') continue;
      const sourceOwn = ownBindings(edge.source); // one hop: the source's OWN fold
      for (const pair of edge.channels!) { // an encoding edge is always written out with its pairs (materialize)
        const field = sourceOwn[pair.from];
        if (field !== undefined) byChannel.set(pair.to, { field, edge: edge.id, from: edge.source, sourceChannel: pair.from });
      }
    }
    raw.set(viewId, { own: ownBindings(viewId), byChannel });
  }
  // The other views a follow is judged against are their RAW effective bindings (own + every candidate,
  // refused ones included), not their judged ones: judging B against judged C against judged B would be the
  // fixed point the one-hop law exists to avoid. The dispatch door (`bindingsOfOthers`) reads the judged map.
  const rawAll = new Map([...raw].map(([id, r]) => [id, { ...r.own, ...Object.fromEntries([...r.byChannel].map(([ch, c]) => [ch, c.field])) } as Bindings] as const));
  const out = new Map<string, EffectiveEncoding>();
  for (const [viewId, r] of raw) {
    const others: Record<string, Bindings> = {};
    for (const [id, b] of rawAll) if (id !== viewId) others[id] = b;
    const bindings: Record<string, string> = { ...r.own };
    const followed: Record<string, { edge: string; from: string; sourceChannel: string }> = {};
    const refused: Record<string, { edge: string; field: string; sentence: string }> = {};
    for (const [channel, c] of r.byChannel) {
      const problems = validateBindings({ view: views.get(viewId)!.encoding!, bindings: { ...bindings, [channel]: c.field }, facets, others, rules, ports, changed: [channel] });
      // a follow is a READING, not an act: it is never coerced — a follow that would need a coercer is refused with the sentence
      if (problems.length > 0) {
        refused[channel] = { edge: c.edge, field: c.field, sentence: problems.map((p) => p.explained ?? p.sentence).join('; ') };
      } else {
        bindings[channel] = c.field;
        followed[channel] = { edge: c.edge, from: c.from, sourceChannel: c.sourceChannel };
      }
    }
    // each entry is handed out through `overview().views[].effective`, so it
    // is frozen where it is BUILT: a memo is a cached object, and a cached
    // object handed to a reader is exactly the leak the detach sweep is about.
    // It is rebuilt whole whenever the memo key changes, never written into.
    out.set(viewId, deepFreeze({ bindings, followed, refused }));
  }
  return out;
}

/** The sentence a view's own rebind of a FOLLOWED channel is refused with — the edge owns the channel. */
export function followSentence(viewId: string, channel: string, f: { readonly edge: string; readonly from: string }): string {
  return `view "${viewId}"'s ${channel} follows "${f.from}" (edge ${f.edge}) — change the edge, or set it to none`;
}

/**
 * One view's per-channel verdicts, with its FOLLOWED channels overwritten: a
 * followed channel is the edge's to change, so every column on it comes back
 * refused with the sentence that names the edge. Frozen where it is built, for
 * the reason above — `overview().views[].fits` hands it straight to a reader.
 */
export function fitsWithFollows(input: {
  readonly viewId: string;
  readonly view: ViewEncodingDecl;
  readonly bindings: Bindings;
  readonly facets: readonly ColumnFacet[];
  readonly others: Record<string, Bindings>;
  readonly rules: EncodingRules;
  readonly ports: EncodingPorts;
  readonly followed: EffectiveEncoding['followed'];
}): Readonly<Record<string, readonly Fit[]>> {
  const { viewId, view, bindings, facets, others, rules, ports, followed } = input;
  const judged = fitsFor({ view, bindings, facets, others, rules, ports });
  const fits: Record<string, readonly Fit[]> = { ...judged };
  for (const [channel, f] of Object.entries(followed)) {
    // a followed channel is one the view declares (the pair was validated), so it has verdicts to overwrite
    fits[channel] = judged[channel]!.map((fit) => ({ field: fit.field, ok: false, because: followSentence(viewId, channel, f) }));
  }
  return deepFreeze(fits);
}
