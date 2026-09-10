/**
 * DRAW — "declared === drawn". One Mermaid flowchart from the materialized
 * graph: a node per view with its voice, an edge per link labelled by its
 * response (default edges say so). Default edges can be left out of the
 * drawing when they would only say the one rule n² times.
 *
 * …and the law cuts the other way too: an edge the default rule DECLINED
 * (`./reach.ts` — its clause could never be judged where it lands) is drawn as
 * a note with its reason, so a reader who counts fewer edges than the rule
 * promises meets the reason on the map instead of guessing at it.
 */
import type { LinkGraph } from './types.js';

const safe = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_');

export function linksToMermaid(graph: LinkGraph, opts: { readonly defaults?: boolean } = {}): string {
  const lines = ['flowchart LR'];
  for (const v of graph.views) lines.push(`  ${safe(v.viewId)}["${v.viewId} · ${v.voice.length === 0 ? 'silent' : v.voice.join(', ')}"]`);
  for (const e of graph.edges) {
    if (e.origin === 'default' && opts.defaults === false) continue;
    const label = `${e.response}${e.origin === 'default' ? ' (default)' : ''} · ${e.kind}`;
    const arrow = e.response === 'none' ? `-. "${label}" .->` : `-- "${label}" -->`;
    lines.push(`  ${safe(e.source)} ${arrow} ${safe(e.target)}`);
  }
  if (opts.defaults === false && graph.default === 'crossfilter') lines.push(`  %% default rule: every view filters every other view, self excluded (edges not drawn)`);
  // WHY the declined edges are drawn as notes: "declared === drawn" cuts both
  // ways — a reader who counts the default's n² edges and finds fewer meets the
  // reason HERE, on the map, instead of guessing that somebody wrote `none`.
  for (const d of graph.declined ?? []) lines.push(`  %% no default ${d.kind} edge ${d.source} → ${d.target}: ${d.reason}`);
  return lines.join('\n');
}
