/**
 * WHAT AN ACT LEFT ON THE TRACE — one reader, in the library.
 *
 * A tool result is a plain data object, and the acts among the nine tools do
 * not all leave the same kind of mark: `dispatch` hands back the COMMIT
 * record, `declare_analysis` puts it one level down under `analysis`,
 * `propose_chart` names the moment by id alone (its commit's VALUE is the
 * spec, and the served answer never echoes a spec back — see the clause on
 * leanness in this folder's README), and `bookmark` lands NO commit at all: it
 * mints a store record, which is what a citation points at.
 *
 * Four shapes for one question, so every consumer that wanted to answer *"what
 * id did this act land"* wrote the walk itself. The demo wrote it twice, in
 * one file, and the two copies had already drifted — one gated on `ok === true`
 * and the other did not, so a refusal could be matched as the act that landed
 * a commit. That is what this module exists to stop: **the walk lives once,
 * here, where the shapes it reads are minted.**
 */
import type { VizToolResult } from './vizAsTools.js';

/**
 * Where an act's mark is: the COMMIT it landed, or the BOOKMARK it named.
 * Exactly one of the two — a bookmark lands no commit (bookmarking is a store
 * record beside the log, never a step on it), so the two can never both be the
 * answer, and the type says so rather than leaving a reader to check.
 */
export type VizLanded =
  | { readonly commit: string; readonly bookmark?: undefined }
  | { readonly commit?: undefined; readonly bookmark: string };

/**
 * What a tool result left behind, or `undefined` when it left nothing.
 *
 * A REFUSAL leaves nothing, and is treated as such before any shape is read —
 * a result that says `ok: false` is never mined for an id. (A refusal carries
 * no commit today, so this is belt and braces; it is written down because the
 * copy that omitted the check was the copy that could go wrong.)
 *
 * ```ts
 * whatLanded(await port.call('viz.dispatch', { verb: 'select', … }));  // { commit: 's7' }
 * whatLanded(await port.call('viz.bookmark', { label: 'the spike' }));  // { bookmark: 'b1' }
 * whatLanded(await port.call('viz.propose_chart', { … }));              // { commit: 's9' }
 * whatLanded({ ok: false, verb: 'select', intent: 'explore', gap: … }); // undefined
 * ```
 */
export function whatLanded(result: VizToolResult | undefined): VizLanded | undefined {
  if (result === undefined || result['ok'] !== true) return undefined;
  const commit = (result['commit'] as { readonly id?: unknown } | undefined)?.id;
  if (typeof commit === 'string') return { commit };
  // `propose_chart` names the moment by id alone — the record would echo the spec
  if (typeof result['commitId'] === 'string') return { commit: result['commitId'] };
  const analysis = (result['analysis'] as { readonly commit?: { readonly id?: unknown } } | undefined)?.commit?.id;
  if (typeof analysis === 'string') return { commit: analysis };
  // a bookmark lands no commit: the store record IS what a citation points at
  const bookmark = (result['bookmark'] as { readonly id?: unknown } | undefined)?.id;
  if (typeof bookmark === 'string') return { bookmark };
  return undefined;
}
