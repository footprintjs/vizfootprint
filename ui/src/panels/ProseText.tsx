/**
 * `<ProseText>` — a slot's words with its REFS as small corner anchors: a span
 * of the text that points at a saved interaction (a commit, a tag, or a saved
 * selection). Hover shows the act (the host supplies the words per commit);
 * click asks the host to act on it (`onSeek` / `onBeat` / `onSaved`). The
 * component never talks to a session.
 *
 * A tag and a saved selection are named by their ID — `onBeat` and `onSaved`
 * are handed that id, never a name — and the anchor's words come from the
 * ref's own `label`: the name as it read when the link was made. So the id is
 * what the host is handed, and it is the host that resolves it (`applySaved`,
 * `seek`).
 *
 * SEEK-ONLY, AND MARKED AS SUCH: a commit or beat anchor carries
 * `data-vzf-seek`, the library's marker for "this control navigates, it never
 * acts". A surface that pauses acting (Present mode — see `VizCockpit`) leaves
 * marked controls alone, because going to a moment in the story is the whole
 * point of that mode. A saved-selection anchor APPLIES a selection, which is
 * an act, so it is deliberately unmarked.
 *
 * `markdown` turns on the two light marks a model actually writes. Marks and
 * ref spans are cut against ONE offset map, so a link INSIDE a pair of
 * asterisks still reads as bold and the asterisks still leave the screen; a
 * span always counts the characters exactly as the author wrote them, markers
 * and all. Off by default.
 */
import type { ProseRefView } from '../adapter/types.js';

export interface ProseTextProps {
  readonly text: string;
  readonly refs?: readonly ProseRefView[];
  /** Words for a commit's anchor (e.g. the commit's label and intent), by id. */
  readonly describeCommit?: (commitId: string) => string | undefined;
  readonly onSeek?: (commitId: string) => void;
  /** A ref to a saved selection, by its ID: APPLY the saved logic (an ordinary act) — never a seek. The host resolves the id. */
  readonly onSaved?: (savedId: string) => void;
  /** A ref to a tag, by its ID (`t1`, …) — never its name. The host resolves the id and goes to the moment. */
  readonly onBeat?: (beatId: string) => void;
  /** Read `**bold**` and `` `code` `` as formatting instead of literal characters. Off by default — nothing else is ever formatted. */
  readonly markdown?: boolean;
  readonly className?: string;
}

/** One run of the words as the reader sees them: as written, in bold, or as code. */
export interface Mark {
  readonly text: string;
  readonly kind: 'plain' | 'bold' | 'code';
}

/** A run of the ORIGINAL text — including `marker`, the `**` and `` ` `` characters themselves, which the reader never sees. */
export interface Run {
  readonly kind: Mark['kind'] | 'marker';
  /** Offsets into the original text: the same offsets a ref's span counts in. */
  readonly from: number;
  readonly to: number;
}

/**
 * The only two marks this renderer knows: `` `code` `` and `**bold**`.
 * LEFTMOST wins — whichever opens first claims its run; neither nests inside
 * the other, and an unmatched marker is just a character. `**` must hug its
 * words, so `2 ** 3 and 4 ** 5` stays arithmetic. The ONE-character bold is
 * tried FIRST, or `**5** cases and **9** more` would close on the last marker
 * and swallow the sentence between them. `***triple***` is not a form we know:
 * it reads as bold with the odd asterisks left on screen.
 */
const MARKS = /`([^`\n]+)`|\*\*([^\s*]|[^\s*][^\n]*?[^\s*])\*\*/g;

/** Every run of the text in order, with the offsets it occupies — the ONE map that marks and ref spans are both cut against. */
export function runs(text: string): readonly Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const m of text.matchAll(MARKS)) {
    if (m.index > at) out.push({ kind: 'plain', from: at, to: m.index });
    const width = m[1] !== undefined ? 1 : 2; // one backtick, or two asterisks
    const end = m.index + m[0].length;
    out.push({ kind: 'marker', from: m.index, to: m.index + width });
    out.push({ kind: m[1] !== undefined ? 'code' : 'bold', from: m.index + width, to: end - width });
    out.push({ kind: 'marker', from: end - width, to: end });
    at = end;
  }
  if (at < text.length) out.push({ kind: 'plain', from: at, to: text.length });
  return out;
}

/** One stretch of the text as the reader sees it: the runs it covers, with the marker characters dropped. */
function cut(text: string, map: readonly Run[], from: number, to: number): readonly Mark[] {
  const out: Mark[] = [];
  for (const run of map) {
    if (run.kind === 'marker') continue;
    const a = Math.max(run.from, from);
    const b = Math.min(run.to, to);
    if (a < b) out.push({ text: text.slice(a, b), kind: run.kind });
  }
  return out;
}

/** The whole text cut into its marks — what a reader sees when nothing else claims the words. */
export function marks(text: string): readonly Mark[] {
  return cut(text, runs(text), 0, text.length);
}

/** The text cut into plain and referenced pieces, in order, with the offsets each covers; overlapping or out-of-range refs are skipped, never guessed. */
export function pieces(text: string, refs: readonly ProseRefView[] = []): readonly { readonly text: string; readonly ref?: ProseRefView; readonly index: number; readonly from: number; readonly to: number }[] {
  const sorted = [...refs].map((ref, index) => ({ ref, index })).filter(({ ref }) => ref.span[0] >= 0 && ref.span[0] < ref.span[1] && ref.span[1] <= text.length).sort((a, b) => a.ref.span[0] - b.ref.span[0]);
  const out: { text: string; ref?: ProseRefView; index: number; from: number; to: number }[] = [];
  let at = 0;
  for (const { ref, index } of sorted) {
    if (ref.span[0] < at) continue; // overlaps the previous ref — skipped
    if (ref.span[0] > at) out.push({ text: text.slice(at, ref.span[0]), index: -1, from: at, to: ref.span[0] });
    out.push({ text: text.slice(ref.span[0], ref.span[1]), ref, index, from: ref.span[0], to: ref.span[1] });
    at = ref.span[1];
  }
  if (at < text.length) out.push({ text: text.slice(at), index: -1, from: at, to: text.length });
  return out;
}

export function ProseText({ text, refs = [], describeCommit, onSeek, onBeat, onSaved, markdown = false, className }: ProseTextProps): JSX.Element {
  let n = 0;
  const map = markdown ? runs(text) : null;
  /** The words of one piece: cut by the marks when the caller asked for them, the characters themselves when it did not. */
  const marked = (from: number, to: number): JSX.Element | string =>
    map === null ? (
      text.slice(from, to)
    ) : (
      <>
        {cut(text, map, from, to).map((mark, i) => (mark.kind === 'plain' ? <span key={i}>{mark.text}</span> : mark.kind === 'bold' ? <strong key={i}>{mark.text}</strong> : <code key={i}>{mark.text}</code>))}
      </>
    );
  return (
    <span className={`vzf-prosetext${className ? ' ' + className : ''}`} data-vzf="prose-text">
      {pieces(text, refs).map((piece, i) => {
        if (piece.ref === undefined) return <span key={i}>{marked(piece.from, piece.to)}</span>;
        const ref = piece.ref;
        n += 1;
        // the words a reader recognises are the ref's own label; the id is the fallback, and all a click ever carries
        const named = ref.label ?? ref.saved ?? ref.beat ?? '';
        const target = ref.commit !== undefined ? `commit #${ref.commit}` : ref.saved !== undefined ? `saved selection "${named}"` : `beat "${named}"`;
        const words = ref.commit !== undefined ? describeCommit?.(ref.commit) : undefined;
        const title = ref.label ?? (words !== undefined ? `${target}: ${words}` : target);
        const go = (): void => {
          if (ref.commit !== undefined) onSeek?.(ref.commit);
          else if (ref.saved !== undefined) onSaved?.(ref.saved);
          else if (ref.beat !== undefined) onBeat?.(ref.beat);
        };
        // A commit or a beat anchor only ever GOES somewhere — it is navigation,
        // and a surface that has paused ACTING (Present mode, `VizCockpit`'s
        // read-only) must leave it working: walking the story is what that mode
        // is for. A SAVED-selection anchor is not navigation — it applies the
        // saved logic, an ordinary act — so it carries no such promise and
        // pauses with everything else.
        const seekOnly = ref.commit !== undefined || ref.beat !== undefined;
        return (
          <span key={i} className="vzf-prosetext-ref" data-ref-commit={ref.commit} data-ref-beat={ref.beat} data-ref-saved={ref.saved}>
            {marked(piece.from, piece.to)}
            <button type="button" className="vzf-prosetext-anchor" data-vzf-seek={seekOnly ? '' : undefined} title={title} aria-label={`go to ${target}`} onClick={go}>
              {n}
            </button>
          </span>
        );
      })}
    </span>
  );
}
