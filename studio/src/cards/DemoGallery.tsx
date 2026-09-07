/**
 * THE GALLERY — a row of cards, and the one question that narrows it.
 *
 * THE LAW IT FOLLOWS: **the picker's options are the cards' own chips.** There
 * is no list of filterable features in this file. `choicesOf` unions what the
 * cards minted and counts the surfaces behind each, so an option can never
 * outlive the demo that justified it, and every option narrows to at least one
 * card by construction.
 *
 * THE SECOND LAW: **the unit is a surface.** The count line says surfaces first
 * and demos second, because the CDC demo is two cards and a reader who asked for
 * a network view wants the ONE of them that has it. A gallery answering in demos
 * would send them to a page that cannot do the thing they asked for.
 *
 * The cards sit in an auto-fitting grid so two surfaces of one demo land SIDE BY
 * SIDE at any usable width — which is the whole argument of this feature: the
 * difference between them is only visible when they are next to each other.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { DemoCard } from './DemoCard.js';
import { choicesOf, demosFor, narrowRefusal, narrowTo } from './filter.js';
import type { DemoSurface } from './types.js';
import { T, deskTokenStyle, type DeskTokens } from '../desk/tokens.js';

export interface DemoGalleryProps {
  readonly surfaces: readonly DemoSurface[];
  /** The gallery's own title, if the page has not already given it one. */
  readonly heading?: string;
  /** The feature to open narrowed to — a deep link into one capability. */
  readonly initialChoice?: string;
  /** Told whenever the narrowing changes, for a host keeping it in a URL. */
  readonly onChoose?: (id: string | null) => void;
  readonly tokens?: DeskTokens;
}

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: T.gap,
  alignItems: 'start',
};

/**
 * A gallery of demo surfaces, narrowable to one feature.
 *
 * ```tsx
 * <DemoGallery surfaces={[cdcDesk, cdcStory]} heading="What the demos cover" />
 * ```
 */
export function DemoGallery(props: DemoGalleryProps): ReactNode {
  const { surfaces } = props;
  const [chosen, setChosen] = useState<string | null>(props.initialChoice ?? null);
  const choices = useMemo(() => choicesOf(surfaces), [surfaces]);
  const shown = narrowTo(surfaces, chosen);
  const refusal = narrowRefusal(surfaces, chosen);
  const choose = (id: string | null): void => {
    setChosen(id);
    props.onChoose?.(id);
  };
  return (
    <div style={{ ...deskTokenStyle(props.tokens), display: 'flex', flexDirection: 'column', gap: T.gap, fontSize: T.textLg, lineHeight: T.lineHeight }}>
      {props.heading === undefined ? null : <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>{props.heading}</h2>}
      <div style={{ display: 'flex', alignItems: 'center', gap: T.gap, flexWrap: 'wrap' }}>
        <label style={{ fontSize: T.textSm }}>
          carrying{' '}
          <select value={chosen ?? ''} onChange={(e) => choose(e.target.value === '' ? null : e.target.value)} style={{ font: 'inherit', fontSize: T.textSm }} aria-label="feature">
            <option value="">any feature</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.ground} · {choice.facet}: {choice.label} ({choice.surfaces})
              </option>
            ))}
          </select>
        </label>
        <span role="status" style={{ fontSize: T.textSm, opacity: 0.75 }}>
          {countLine(shown, surfaces)}
        </span>
        {chosen === null ? null : (
          <button type="button" onClick={() => choose(null)} style={{ font: 'inherit', fontSize: T.textSm, padding: '2px 8px', borderRadius: T.radius }}>
            show all
          </button>
        )}
      </div>
      {refusal === null ? null : (
        <p role="alert" style={{ margin: 0, fontSize: T.textSm, color: T.danger }}>
          {refusal}
        </p>
      )}
      <div style={grid}>
        {shown.map((surface) => (
          <DemoCard key={`${surface.demo}/${surface.surface}`} surface={surface} chosen={chosen} onChoose={choose} tokens={props.tokens} />
        ))}
      </div>
    </div>
  );
}

/** Surfaces first, demos second — the narrowing happened to surfaces, and the sentence must say so (law 2). */
function countLine(shown: readonly DemoSurface[], all: readonly DemoSurface[]): string {
  return `${shown.length} of ${all.length} surfaces · ${demosFor(shown).length} of ${demosFor(all).length} demos`;
}
