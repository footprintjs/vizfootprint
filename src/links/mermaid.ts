/**
 * DRAW — "declared === drawn". One Mermaid flowchart from the materialized
 * graph: a node per view with its voice, an edge per link labelled by its
 * response (default edges say so). Default edges can be left out of the
 * drawing when they would only say the one rule n² times.
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
  return lines.join('\n');
}
