/**
 * `<ProseText>` — a slot's words with its REFS as small corner anchors: a span
 * of the text that points at a saved interaction (a commit, or a beat by its
 * label). Hover shows the act (the host supplies the words per commit);
 * click asks the host to go there (`onSeek` / `onBeat`). The component never
 * talks to a session.
 */
import type { ProseRefView } from '../adapter/types.js';

export interface ProseTextProps {
  readonly text: string;
  readonly refs?: readonly ProseRefView[];
  /** Words for a commit's anchor (e.g. the commit's label and intent), by id. */
  readonly describeCommit?: (commitId: string) => string | undefined;
  readonly onSeek?: (commitId: string) => void;
  readonly onBeat?: (label: string) => void;
  readonly className?: string;
}

/** The text cut into plain and referenced pieces, in order; overlapping or out-of-range refs are skipped, never guessed. */
export function pieces(text: string, refs: readonly ProseRefView[] = []): readonly { readonly text: string; readonly ref?: ProseRefView; readonly index: number }[] {
  const sorted = [...refs].map((ref, index) => ({ ref, index })).filter(({ ref }) => ref.span[0] >= 0 && ref.span[0] < ref.span[1] && ref.span[1] <= text.length).sort((a, b) => a.ref.span[0] - b.ref.span[0]);
  const out: { text: string; ref?: ProseRefView; index: number }[] = [];
  let at = 0;
  for (const { ref, index } of sorted) {
    if (ref.span[0] < at) continue; // overlaps the previous ref — skipped
    if (ref.span[0] > at) out.push({ text: text.slice(at, ref.span[0]), index: -1 });
    out.push({ text: text.slice(ref.span[0], ref.span[1]), ref, index });
    at = ref.span[1];
  }
  if (at < text.length) out.push({ text: text.slice(at), index: -1 });
  return out;
}

export function ProseText({ text, refs = [], describeCommit, onSeek, onBeat, className }: ProseTextProps): JSX.Element {
  let n = 0;
  return (
    <span className={`vzf-prosetext${className ? ' ' + className : ''}`} data-vzf="prose-text">
      {pieces(text, refs).map((piece, i) => {
        if (piece.ref === undefined) return <span key={i}>{piece.text}</span>;
        const ref = piece.ref;
        n += 1;
        const target = ref.commit !== undefined ? `commit #${ref.commit}` : `beat "${ref.beat ?? ''}"`;
        const words = ref.commit !== undefined ? describeCommit?.(ref.commit) : undefined;
        const title = ref.label ?? (words !== undefined ? `${target}: ${words}` : target);
        const go = (): void => {
          if (ref.commit !== undefined) onSeek?.(ref.commit);
          else if (ref.beat !== undefined) onBeat?.(ref.beat);
        };
        return (
          <span key={i} className="vzf-prosetext-ref" data-ref-commit={ref.commit} data-ref-beat={ref.beat}>
            {piece.text}
            <button type="button" className="vzf-prosetext-anchor" title={title} aria-label={`go to ${target}`} onClick={go}>
              {n}
            </button>
          </span>
        );
      })}
    </span>
  );
}
