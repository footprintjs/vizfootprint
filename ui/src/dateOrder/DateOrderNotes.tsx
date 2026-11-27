/** Date-order words only: the feature model/door supplies the layout and sentences. */
import type { DateOrderLayout } from './model.js';

export function DateOrderNotes({ layout, left, top }: { readonly layout: DateOrderLayout; readonly left: number; readonly top: number }): JSX.Element {
  let line = 0;
  return <g className="vzf-date-order-notes" pointerEvents="none">
    {layout.notes.map((lines, i) => <text className="vzf-date-order-note" key={i}>{lines.map((part, j) => <tspan key={j} x={left} y={top + (++line) * 12}>{part}</tspan>)}</text>)}
  </g>;
}
export function DateOrderRefusal({ words }: { readonly words: readonly string[] }): JSX.Element {
  return <div className="vzf-date-order-refusal" role="note">{words.map((word, i) => <p key={i}>{word}</p>)}<p>Enlarge this chart to leave room for its date-order notes and plot.</p></div>;
}
