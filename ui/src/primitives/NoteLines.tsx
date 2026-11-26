/**
 * THE LINES OF WORDS A CHART PUTS IN ITS OWN PICTURE: one sentence per line,
 * stacked from a corner of the margin. Render only: the sentences are made by
 * their one owner (`outsideNotes`, `./scales.ts`) and the look is the class's
 * (`styles.css`), so this part holds no wording and no colour.
 *
 * WHY IN THE PICTURE: the accessible name already carries the sentence for a
 * screen reader, and a sighted reader meets it only here. A mark drawn past
 * the plot's edge is invisible, so the sentence is the only thing that says it
 * is there.
 *
 * ```tsx
 * <NoteLines className="vzf-outside-note" notes={outside} x={PAD.l} y={PAD.t - 6} />
 * ```
 */
export interface NoteLinesProps {
  /** The class every line wears; it names the register (`vzf-outside-note`). */
  readonly className: string;
  /** One sentence per line, in order. None draws nothing. */
  readonly notes: readonly string[];
  /** Where the first line starts. */
  readonly x: number;
  readonly y: number;
  /** The distance from one line to the next; negative stacks upward. Absent = 11. */
  readonly step?: number;
}

export function NoteLines({ className, notes, x, y, step = 11 }: NoteLinesProps): JSX.Element {
  return (
    <>
      {notes.map((note, i) => (
        <text key={i} className={className} x={x} y={y + i * step} textAnchor="start">
          {note}
        </text>
      ))}
    </>
  );
}
