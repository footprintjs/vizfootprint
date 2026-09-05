/**
 * THE ONE READER of a prose record's refs off the wire.
 *
 * A ref is a span of a slot's text that points at ONE saved interaction — a
 * commit, a bookmark, or a saved picture, each by its id. The session judged it
 * at the describe door (`src/prose/README.md`); this reads what it landed and
 * judges NOTHING again: a row that is not a span plus exactly one target is
 * dropped, never invented, and nothing else is inspected.
 *
 * It lives in its own file because two consumers need it and a second copy is
 * the adapter's Law 3 in miniature: `sessionView` reads the refs the wire
 * serves for a slot AT THE CURSOR, and the story bridge reads the refs a
 * `describe` commit carried AT ITS OWN MOMENT. One rule, one implementation —
 * and a small module the story entry point can bundle without the adapter.
 */
import type { ProseRefView } from './types.js';

/** A slot's refs — a span plus exactly one target; anything else is dropped, never invented. */
export function mapProseRefs(raw: unknown): ProseRefView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = r as { span?: unknown; commit?: unknown; bookmark?: unknown; saved?: unknown; label?: unknown } | null;
    if (typeof x !== 'object' || x === null || !Array.isArray(x.span) || x.span.length !== 2 || !x.span.every((n) => typeof n === 'number')) return [];
    const commit = typeof x.commit === 'string' ? x.commit : undefined;
    const bookmark = typeof x.bookmark === 'string' ? x.bookmark : undefined;
    const saved = typeof x.saved === 'string' ? x.saved : undefined; // a saved selection by its id: a click applies its logic, never seeks
    if (Number(commit !== undefined) + Number(bookmark !== undefined) + Number(saved !== undefined) !== 1) return [];
    return [{ span: [x.span[0] as number, x.span[1] as number] as const, ...(commit !== undefined ? { commit } : {}), ...(bookmark !== undefined ? { bookmark } : {}), ...(saved !== undefined ? { saved } : {}), ...(typeof x.label === 'string' ? { label: x.label } : {}) }];
  });
}
