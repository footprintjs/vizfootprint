/**
 * ONE DEMO'S CARD — what this surface can do, what somebody did on it, and what
 * a person had to write down.
 *
 * THE LAW IT FOLLOWS: **the card draws; it never judges.** Every chip on it came
 * out of `chipsOf`, every sentence out of `unseenOf` or `walkReadoutOf`. Nothing
 * below decides what a demo covers — it decides where the answer goes on the
 * page.
 *
 * THE SECOND LAW: **name the surface, on every group.** A card is one SURFACE of
 * one demo, and the two surfaces of one demo differ: the CDC desk declares a
 * network view its story page has never heard of. So each group heading carries
 * the sentence that says which build or which trace vouched for the chips under
 * it, and each chip's own `title` carries it again — because a chip is liable to
 * be read on its own, in a filter's answer, far from this heading.
 *
 * THE THIRD LAW: **a silence is a sentence, never a missing chip.** The verbs a
 * log cannot see are printed in the open, in the reader's own words. A card that
 * simply had no `bookmark` chip would be read as "nobody bookmarked", which is
 * the one thing a commit log can never say.
 *
 * WHY IT WEARS THE DESK'S TOKENS: they are this package's look, not the desk's
 * private one, and a card is the second thing studio draws. The root writes them
 * itself so a card mounted OUTSIDE a desk still has colours — the same reason
 * `../desk/tokens.ts` puts the defaults in TypeScript rather than a stylesheet.
 */
import type { CSSProperties, ReactNode } from 'react';
import { chipsOf, groundSentenceOf, unseenOf, walkReadoutOf } from './chips.js';
import type { ChipGround, DemoSurface, FeatureChip } from './types.js';
import { T, deskTokenStyle, type DeskTokens } from '../desk/tokens.js';

/** The three grounds, in the order a card reads them: checked, walked, then somebody's word. */
const GROUNDS: readonly ChipGround[] = ['declares', 'walked', 'by hand'];

/** What each ground MEANS, in one line above its chips — the honesty the whole card rests on. */
const GROUND_MEANING: Readonly<Record<ChipGround, string>> = {
  declares: 'this build holds it, whether or not anybody used it',
  walked: 'a commit proves somebody did it',
  'by hand': 'nobody can derive this — it is written down, and only as true as its author',
};

export interface DemoCardProps {
  readonly surface: DemoSurface;
  /** The feature a gallery is narrowed to, so the chip that matched can say so. */
  readonly chosen?: string | null;
  /** Choosing a chip narrows the gallery; choosing the chosen one clears it. */
  readonly onChoose?: (id: string | null) => void;
  readonly tokens?: DeskTokens;
}

const root: CSSProperties = {
  border: `1px solid ${T.rule}`,
  borderRadius: T.radius,
  background: T.paper,
  padding: '14px 16px 16px',
  fontSize: T.textLg,
  lineHeight: T.lineHeight,
  display: 'flex',
  flexDirection: 'column',
  gap: T.gap,
  minWidth: 0,
};

/**
 * The card of one surface.
 *
 * ```tsx
 * <DemoCard surface={{ demo: 'CDC NNDSS', surface: 'desk', declares: defFeatures(dashboard), byHand: GESTURES }} />
 * ```
 */
export function DemoCard(props: DemoCardProps): ReactNode {
  const { surface } = props;
  const chips = chipsOf(surface);
  return (
    <article style={{ ...deskTokenStyle(props.tokens), ...root }} aria-label={`${surface.demo} / ${surface.surface}`}>
      <Head surface={surface} />
      {GROUNDS.map((ground) => (
        <Group
          key={ground}
          ground={ground}
          surface={surface}
          chips={chips.filter((chip) => chip.ground === ground)}
          chosen={props.chosen ?? null}
          onChoose={props.onChoose}
        />
      ))}
    </article>
  );
}

// ── The head: whose card this is, and which build it was read off ────────────

function Head(props: { readonly surface: DemoSurface }): ReactNode {
  const { surface } = props;
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: T.gapSm, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{surface.demo}</h3>
        <span style={{ fontSize: T.textSm, opacity: 0.75 }}>· {surface.surface}</span>
        {/* the revision IS the card's basis: two cards of one demo carry two of them, which is the whole point */}
        <code style={{ fontFamily: T.mono, fontSize: T.textXs, opacity: 0.6 }}>{surface.declares.revision}</code>
      </div>
      {surface.blurb === undefined ? null : <p style={{ margin: 0, fontSize: T.textMd, opacity: 0.85 }}>{surface.blurb}</p>}
      {surface.href === undefined ? null : (
        <a href={surface.href} style={{ fontSize: T.textSm }}>
          open this surface
        </a>
      )}
    </header>
  );
}

// ── One ground: its heading, its chips, and what it may not claim ────────────

function Group(props: {
  readonly ground: ChipGround;
  readonly surface: DemoSurface;
  readonly chips: readonly FeatureChip[];
  readonly chosen: string | null;
  readonly onChoose?: (id: string | null) => void;
}): ReactNode {
  const { ground, surface, chips } = props;
  const notes = groundNotesOf(ground, surface);
  // a heading over nothing is furniture — a host that wrote no gesture notes gets no "by hand" group
  if (chips.length === 0 && notes.length === 0) return null;
  return (
    <section aria-label={`${ground} — ${surface.demo} / ${surface.surface}`} style={{ display: 'flex', flexDirection: 'column', gap: T.gapSm }}>
      <h4 style={{ margin: 0, fontSize: T.textXs, letterSpacing: '.07em', textTransform: 'uppercase', opacity: 0.7 }}>
        {ground} <span style={{ textTransform: 'none', letterSpacing: 0, opacity: 0.85 }}>— {GROUND_MEANING[ground]}</span>
      </h4>
      {/* the surface, again, under every group: a fact whose origin is one scroll away is a fact somebody will misattribute */}
      <p style={{ margin: 0, fontSize: T.textXs, opacity: 0.6, fontFamily: T.mono }}>{groundSentenceOf(ground, surface)}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: T.gapSm }}>
        {chips.map((chip) => (
          <Chip key={chip.id} chip={chip} chosen={props.chosen === chip.id} onChoose={props.onChoose} />
        ))}
      </div>
      {notes.map((note) => (
        <p key={note} style={{ margin: 0, fontSize: T.textXs, opacity: 0.8 }}>
          {note}
        </p>
      ))}
    </section>
  );
}

/**
 * The sentences a ground says instead of chips.
 *
 * `walked` is the only ground with any: the counted facts of the walk, and then
 * the verbs this trace is structurally blind to — in `logFeatures`' own words,
 * so the card and the reader never disagree about a silence.
 */
function groundNotesOf(ground: ChipGround, surface: DemoSurface): readonly string[] {
  if (ground !== 'walked') return [];
  const walked = surface.walked;
  if (walked === undefined) return ['no trace has been captured for this surface — nothing here says what anybody did'];
  return [...walkReadoutOf(walked), ...unseenOf(walked).map((note) => `${note.verb}: cannot be seen in a log — ${note.why}`)];
}

// ── One chip ──────────────────────────────────────────────────────────────────

const chipStyle = (chosen: boolean): CSSProperties => ({
  font: 'inherit',
  fontSize: T.textSm,
  padding: '2px 8px',
  borderRadius: 999,
  cursor: 'pointer',
  border: `1px solid ${chosen ? T.ok : T.rule}`,
  background: chosen ? T.tabOn : T.paper,
  color: 'inherit',
});

function Chip(props: { readonly chip: FeatureChip; readonly chosen: boolean; readonly onChoose?: (id: string | null) => void }): ReactNode {
  const { chip, chosen } = props;
  return (
    <button
      type="button"
      aria-pressed={chosen}
      title={chip.title}
      style={chipStyle(chosen)}
      onClick={() => props.onChoose?.(chosen ? null : chip.id)}
    >
      <span style={{ opacity: 0.55, fontSize: T.textXs }}>{chip.facet}</span> {chip.label}
    </button>
  );
}
