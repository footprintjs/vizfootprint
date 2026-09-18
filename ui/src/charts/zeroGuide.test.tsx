// @vitest-environment jsdom
/**
 * ZERO IS A PLACE ON THE AXIS (law 12) — the PICTURE's half: the charts that
 * draw the guide, the charts that draw none, the verdict against the domain
 * each chart actually drew on, and the refusal in words for an axis with no
 * zero on it.
 *
 * Four laws, pinned here rather than once per chart:
 *
 *   1. DECLARED, NEVER AUTOMATIC. No `zeroGuide` key, no line — and the markup
 *      is byte-identical to the chart before the key existed, even when the
 *      domain runs straight through zero. A guide that appeared by itself would
 *      draw the same view differently at two cursors with nothing in the record
 *      saying why.
 *   2. NAMED FOR ZERO, NOT THE CENTRE. The line stands where the SCALE crosses
 *      zero, which is the middle of −180…180 and the edge of 0…226 — never the
 *      middle of the domain it was given.
 *   3. REFUSED, NEVER SHRUGGED OFF. An axis with no zero on it gets no line and
 *      one sentence, in the plot and in the accessible name, quoting the axis it
 *      was asked of and the channel it was asked on.
 *   4. A TICK LABEL NEEDS ROOM; A LINE AT ZERO NEEDS ONE PIXEL. `axes={false}`
 *      suppresses ticks and labels and NOT the guide, because that flag is a
 *      DENSITY decision at the chart's door (no room for tick labels at
 *      282×171) and not a claim that the chart has no axis. On a signed scale
 *      the zero line is what the marks are read against — a dot above it and a
 *      dot below it mean categorically different things — so dropping it
 *      removes the ability to read the SIGN rather than some chrome.
 *
 *      THIS REVERSES THE RULE THIS FILE FIRST PINNED, which was "a layer that
 *      draws no axis draws no zero line for it either". It was tidy and it was
 *      wrong for the case that matters, measured on a real page: a pane at
 *      282×171 with 181 dots, no ticks and no crosshair, so the reader lost the
 *      only thing saying where the origin was at exactly the size where the
 *      tick labels were unreadable anyway. Who ELSE might draw it is decided
 *      where that is known — a frame drawing the merged guide does not ASK its
 *      layers (`layerDomain`, `../contract/renderers.tsx`), so the stack still
 *      gets exactly one line. What did NOT change: every refusal. A domain
 *      without zero and a logarithmic axis are refused exactly as before, at
 *      any density.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import { VizScatter } from './VizScatter.js';
import { VizLine } from './VizLine.js';
import { VizFrame, type VizFrameLayer, type FrameLayerDraw } from './VizFrame.js';
import { zeroGuideFor, zeroGuideNotes } from '../primitives/zeroGuide.js';

afterEach(cleanup);

/** Every zero guide drawn, as `x1/y1/x2/y2` — a guide that was not drawn shows up as a missing entry. */
const guidesOf = (c: Element): string[] => Array.from(c.querySelectorAll('line.vzf-zero')).map((l) => ['x1', 'y1', 'x2', 'y2'].map((a) => l.getAttribute(a) ?? '').join('/'));
/** The sentences the picture carries for a guide it could not draw. */
const notesOf = (c: Element): string[] => Array.from(c.querySelectorAll('text.vzf-zero-note')).map((t) => t.textContent ?? '');
const nameOf = (c: Element): string => c.querySelector('svg')!.getAttribute('aria-label') ?? '';

/** φ against ψ: the Ramachandran figure that asked for this, both angles signed and running −180…180. */
const RAMA = [
  { id: 'r1', x: -60, y: -45 },
  { id: 'r2', x: -120, y: 130 },
  { id: 'r3', x: 55, y: 45 },
];
const ANGLES = { x: [-180, 180] as const, y: [-180, 180] as const };

describe('VizScatter — the figure that asked: a guide on x, on y, and on both', () => {
  it('draws one line per declared channel, at the scale’s zero, spanning the plot box', () => {
    const both = render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { x: true, y: true } }} />);
    // x(0) = 52 + 0.5 * (502 - 52) = 277 — the plot's mid-line here, because THIS domain is symmetric
    // y(0) = 296 + 0.5 * (18 - 296) = 157
    expect(guidesOf(both.container)).toEqual(['277/18/277/296', '52/157/502/157']);
    // no tick and no label of its own: the labelled axes stay on the edges, where they are readable
    expect(both.container.querySelectorAll('line.vzf-zero + text')).toHaveLength(0);
    cleanup();
    // ONE DECLARATION ANSWERED TWICE, not two features: each channel asked for on its own
    expect(guidesOf(render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { x: true } }} />).container)).toEqual(['277/18/277/296']);
    cleanup();
    expect(guidesOf(render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { y: true } }} />).container)).toEqual(['52/157/502/157']);
  });

  it('NAMED FOR ZERO AND NOT FOR THE CENTRE — the line moves with the scale’s zero, never to the middle of the domain', () => {
    // an ASYMMETRIC signed domain: zero is nowhere near the middle, and the guide is at zero
    const { container } = render(<VizScatter data={RAMA} domain={{ x: [-50, 150], zeroGuide: { x: true } }} />);
    // x(0) = 52 + (50 / 200) * 450 = 164.5 — a centre line would have been at 277
    expect(guidesOf(container)).toEqual(['164.5/18/164.5/296']);
  });

  it('A DOMAIN THAT TOUCHES ZERO AT AN END IS INSIDE IT — decided, and pinned', () => {
    // a solvent-accessible area runs 0…226: zero is the EDGE, and the guide is drawn there, coincident with
    // the axis line, which is exactly where zero is. The other reading would make the two zero keys
    // contradict each other — `zero: true` extends an all-positive domain to [0, hi] so the axis REACHES
    // zero, and a guide that refused the end it was handed would refuse its own sibling's work.
    const low = render(<VizScatter data={[{ id: 'a', x: 40, y: 12 }]} domain={{ y: [0, 226], zeroGuide: { y: true } }} />);
    expect(guidesOf(low.container)).toEqual(['52/296/502/296']); // y(0) = the baseline
    expect(notesOf(low.container)).toEqual([]);
    cleanup();
    const high = render(<VizScatter data={[{ id: 'a', x: 40, y: -12 }]} domain={{ y: [-226, 0], zeroGuide: { y: true } }} />);
    expect(guidesOf(high.container)).toEqual(['52/18/502/18']); // y(0) = the ceiling
    expect(notesOf(high.container)).toEqual([]);
  });

  it('AN AXIS WITH NO ZERO ON IT IS REFUSED BY NAME — all-positive and all-negative, on each channel, in one sentence', () => {
    const positive = render(<VizScatter data={[{ id: 'a', x: 20, y: 20 }]} domain={{ x: [12, 48], y: [12, 48], zeroGuide: { x: true, y: true } }} />);
    expect(guidesOf(positive.container)).toEqual([]);
    expect(notesOf(positive.container)).toEqual([
      'x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
      'y was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
    ]);
    // the same sentence reaches a reader who cannot see the plot
    expect(nameOf(positive.container)).toBe(
      'scatter of y against x — x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw — y was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
    );
    cleanup();
    const negative = render(<VizScatter data={[{ id: 'a', x: -20, y: -20 }]} domain={{ x: [-48, -12], y: [-48, -12], zeroGuide: { x: true, y: true } }} />);
    expect(guidesOf(negative.container)).toEqual([]);
    expect(notesOf(negative.container)).toEqual([
      'x was asked for a zero guide, but its axis runs [-48, -12] — zero is not a place on it, so there is no line to draw',
      'y was asked for a zero guide, but its axis runs [-48, -12] — zero is not a place on it, so there is no line to draw',
    ]);
  });

  it('the refusal quotes THE AXIS IT DREW ON — the chart’s own padded extent when no frame handed it a domain', () => {
    // no `domain.x`: the chart folds its own extent and pads it by 5, so the axis runs [7, 105] and that is
    // the span the sentence has to quote — the reason the CHART owns this verdict and no door upstream can
    const { container } = render(<VizScatter data={[{ id: 'a', x: 12, y: 3 }, { id: 'b', x: 100, y: 4 }]} domain={{ zeroGuide: { x: true } }} />);
    expect(notesOf(container)).toEqual(['x was asked for a zero guide, but its axis runs [7, 105] — zero is not a place on it, so there is no line to draw']);
  });

  it('A LOGARITHMIC AXIS HAS NO ZERO AT ALL — refused in the logarithm’s own existing vocabulary, not a new sentence about a domain', () => {
    const { container } = render(<VizScatter data={[{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 100, y: 100 }]} domain={{ x: [1, 100], transform: { x: 'log' }, zeroGuide: { x: true } }} />);
    expect(guidesOf(container)).toEqual([]);
    // the def door says the identical clause of a declared `zeroGuide` beside `transform: 'log'`
    expect(notesOf(container)).toEqual(['x was asked for a zero guide, and a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly']);
  });

  it('DECLARED, NEVER AUTOMATIC: a domain straight through zero draws NO guide unless one was asked for, byte for byte', () => {
    const plain = render(<VizScatter data={RAMA} domain={ANGLES} />).container.innerHTML;
    cleanup();
    // the same chart with the key absent from the object entirely, and with an explicit `false`
    expect(render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: {} }} />).container.innerHTML).toBe(plain);
    cleanup();
    expect(render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { x: false, y: false } }} />).container.innerHTML).toBe(plain);
    cleanup();
    // …and a chart with no `domain` prop at all is the chart that existed before any of this
    const bare = render(<VizScatter data={RAMA} />).container.innerHTML;
    expect(bare).not.toContain('vzf-zero');
  });

  it('A LINE AT ZERO NEEDS ONE PIXEL — `axes: false` suppresses the TICKS and the LABELS, never the guide', () => {
    const dense = render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { x: true, y: true } }} axes={false} />);
    // both guides, at the same pixels the fully-labelled chart drew them at
    expect(guidesOf(dense.container)).toEqual(['277/18/277/296', '52/157/502/157']);
    // …and that is ALL the axis furniture: no axis line, no tick, no tick label, no axis label
    expect(dense.container.querySelectorAll('line.vzf-axis')).toHaveLength(0);
    expect(dense.container.querySelectorAll('text.vzf-tick')).toHaveLength(0);
    expect(dense.container.querySelectorAll('.vzf-axis-label')).toHaveLength(0);
    cleanup();
    // `axes: 'y'` — the same answer: what a chart draws its axes for has nothing to do with what it was
    // asked to draw at zero
    expect(guidesOf(render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { x: true, y: true } }} axes="y" />).container)).toEqual(['277/18/277/296', '52/157/502/157']);
    cleanup();
    // AND THE TWO RULES ARE NOT ONE RULE: the guide survives the density flag, and it is STILL refused
    // where zero is not on the axis — at that density, in the same words, on both axes
    const hidden = render(<VizScatter data={RAMA} domain={{ x: [12, 48], y: [12, 48], zeroGuide: { x: true, y: true } }} axes={false} />);
    expect(guidesOf(hidden.container)).toEqual([]);
    expect(notesOf(hidden.container)).toEqual([
      'x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
      'y was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
    ]);
  });

  it('the guide is FURNITURE: its own class and its own token, never the mark’s ink', () => {
    const { container } = render(<VizScatter data={RAMA} domain={{ ...ANGLES, zeroGuide: { y: true } }} colorOf={() => '#ff0000'} />);
    const guide = container.querySelector('line.vzf-zero')!;
    // no inline stroke and no scale hue: the stylesheet owns the ink through one token of its own
    expect(guide.getAttribute('stroke')).toBeNull();
    expect(guide.getAttribute('style')).toBeNull();
    expect(guide.getAttribute('class')).toBe('vzf-zero');
    // the stylesheet, read from either suite's own working directory (the `SelectionChips` precedent)
    const css = readFileSync(process.cwd().endsWith('/ui') ? 'src/styles.css' : 'ui/src/styles.css', 'utf8');
    expect(css).toContain('--vzf-zero:');
    expect(css).toMatch(/\.vzf-zero \{\n\s+stroke: var\(--vzf-zero\);/);
    // and it does NOT fall back to the scale hue the way an axis line does — a hue names marks, not furniture
    expect(css).not.toMatch(/\.vzf-zero \{[^}]*--vzf-scale-hue/);
    expect(css).toContain('.vzf-zero-note {');
  });
});

describe('VizLine — a signed value over time, and an x that has no zero', () => {
  const POINTS = [
    { date: '2026-01-04', value: -8 },
    { date: '2026-01-11', value: 3 },
    { date: '2026-01-18', value: 6 },
  ];

  it('draws the guide on the VALUE axis — the sign is the reading of a difference, a log ratio or a z-score', () => {
    const { container } = render(<VizLine data={POINTS} domain={{ y: [-10, 10], zeroGuide: { y: true } }} />);
    // y(0) = 296 + 0.5 * (18 - 296) = 157, edge to edge across the plot
    expect(guidesOf(container)).toEqual(['52/157/502/157']);
  });

  it('its X takes NONE, and the prop is not quietly honoured there either — a run of dates has no zero a sign is read from', () => {
    const asked = render(<VizLine data={POINTS} domain={{ y: [-10, 10], zeroGuide: { x: true } }} />);
    expect(guidesOf(asked.container)).toEqual([]);
    expect(notesOf(asked.container)).toEqual([]); // the def door refuses a line's x by name; the chart has no axis to refuse it against
    cleanup();
    // a BAND line — its x is a list of categories — is the same answer
    const band = render(<VizLine data={[{ category: 'Casual', value: -2 }, { category: 'Formal', value: 5 }]} domain={{ y: [-10, 10], zeroGuide: { x: true, y: true } }} />);
    expect(guidesOf(band.container)).toEqual(['52/157/502/157']);
  });

  it('refuses an axis with no zero on it, and a logarithmic one, in the same two sentences every chart says', () => {
    const positive = render(<VizLine data={[{ date: '2026-01-04', value: 12 }, { date: '2026-01-11', value: 48 }]} domain={{ y: [12, 48], zeroGuide: { y: true } }} />);
    expect(notesOf(positive.container)).toEqual(['y was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw']);
    expect(nameOf(positive.container)).toContain(' — y was asked for a zero guide, but its axis runs [12, 48]');
    cleanup();
    const log = render(<VizLine data={[{ date: '2026-01-04', value: 10 }, { date: '2026-01-11', value: 1000 }]} domain={{ y: [10, 1000], transform: { y: 'log' }, zeroGuide: { y: true } }} />);
    expect(guidesOf(log.container)).toEqual([]);
    expect(notesOf(log.container)).toEqual(['y was asked for a zero guide, and a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly']);
  });

  it('DECLARED, NEVER AUTOMATIC — and byte-identical without the key, over a domain that crosses zero', () => {
    const plain = render(<VizLine data={POINTS} domain={{ y: [-10, 10] }} />).container.innerHTML;
    cleanup();
    expect(render(<VizLine data={POINTS} domain={{ y: [-10, 10], zeroGuide: { y: false } }} />).container.innerHTML).toBe(plain);
    cleanup();
    // …and `axes: false` is a DENSITY choice, so the guide survives it here exactly as it does on a
    // scatter — the ticks and the labels are what that flag suppresses (law 4 above)
    const dense = render(<VizLine data={POINTS} domain={{ y: [-10, 10], zeroGuide: { y: true } }} axes={false} />);
    expect(guidesOf(dense.container)).toEqual(['52/157/502/157']);
    expect(dense.container.querySelectorAll('text.vzf-tick')).toHaveLength(0);
  });
});

describe('VizFrame — a merged guide draws the stack’s zero, because it draws the stack’s axis', () => {
  /** A stand-in layer: it draws nothing and reports the domain the frame handed it. */
  const fake = (layerId: string, kind: VizFrameLayer['kind']): VizFrameLayer => ({
    layerId,
    kind,
    render: (draw: FrameLayerDraw) => <svg className="vzf-chart" data-domain={JSON.stringify(draw.domain)} />,
  });

  it('draws one guide for the stack on each axis it was given — the frame’s existing `guide: "merged"` law, not a second one', () => {
    const { container } = render(
      <VizFrame
        layers={[fake('a', 'point'), fake('b', 'line')]}
        x={{ scale: 'quantitative', label: 'phi' }}
        y={{ scale: 'quantitative', label: 'psi' }}
        domain={{ x: [-180, 180], y: [-180, 180], zeroGuide: { x: true, y: true } }}
      />,
    );
    expect(guidesOf(container)).toHaveLength(2);
    // both stand inside the frame's ONE plot box, and both are in the guide's own svg rather than a layer's
    expect(container.querySelectorAll('.vzf-frame-guide line.vzf-zero')).toHaveLength(2);
    // every layer still receives the ask (its own scale may be its own — `axes: 'y'`), which is what makes
    // the answer one object shared by reference rather than two answers for one channel
    expect(Array.from(container.querySelectorAll('[data-domain]')).map((el) => JSON.parse(el.getAttribute('data-domain') ?? '{}')['zeroGuide'])).toEqual([{ x: true, y: true }, { x: true, y: true }]);
  });

  it('refuses an axis with no zero on it in words, in the plot and in its accessible label', () => {
    const { container } = render(
      <VizFrame layers={[fake('a', 'point')]} x={{ scale: 'quantitative' }} y={{ scale: 'quantitative' }} domain={{ x: [12, 48], y: [-180, 180], zeroGuide: { x: true, y: true } }} />,
    );
    expect(notesOf(container)).toEqual(['x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw']);
    expect(guidesOf(container)).toHaveLength(1); // y still drawn: one refusal never suppresses the other axis
    expect(container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(
      '1 layers on one frame — x was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw',
    );
  });

  it('an axis the frame does NOT draw carries no zero of its own — a band, a date, an axis it was never given, or a guide it does not own', () => {
    const asked = { zeroGuide: { x: true, y: true } } as const;
    // a CATEGORICAL axis has no zero at all; a TEMPORAL one has no zero a sign is read from
    const band = render(<VizFrame layers={[fake('a', 'bar')]} x={{ scale: 'categorical' }} domain={{ categories: ['Casual'], ...asked }} />);
    expect(guidesOf(band.container).concat(notesOf(band.container))).toEqual([]);
    cleanup();
    const dated = render(<VizFrame layers={[fake('a', 'line')]} x={{ scale: 'temporal' }} domain={{ x: [0, 1], ...asked }} />);
    expect(guidesOf(dated.container).concat(notesOf(dated.container))).toEqual([]);
    cleanup();
    // an axis with a scale but NO SPAN is no axis: nothing folded, nothing to place a zero on
    const spanless = render(<VizFrame layers={[fake('a', 'point')]} x={{ scale: 'quantitative' }} y={{ scale: 'quantitative' }} domain={asked} />);
    expect(guidesOf(spanless.container).concat(notesOf(spanless.container))).toEqual([]);
    cleanup();
    const infinite = render(<VizFrame layers={[fake('a', 'point')]} x={{ scale: 'quantitative' }} domain={{ x: [Number.NaN, 4], ...asked }} />);
    expect(guidesOf(infinite.container)).toEqual([]);
    cleanup();
    // a SINGLE layer under a per-layer guide draws its own axes, so the frame draws no guide — and no zero
    const perLayer = render(<VizFrame layers={[fake('a', 'point')]} guide="per-layer" x={{ scale: 'quantitative' }} domain={{ x: [-1, 1], ...asked }} />);
    expect(guidesOf(perLayer.container)).toEqual([]);
    expect(perLayer.container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('1 layers on one frame');
  });

  it('byte-identical with no zero guide asked, over a domain that crosses zero', () => {
    // the FRAME's own furniture is the guide svg; the `domain` object itself rides through to every layer by
    // reference (which is why the stand-in above can print it), so this compares what the frame DRAWS
    const drawn = (domain: Parameters<typeof VizFrame>[0]['domain']): string =>
      render(<VizFrame layers={[fake('a', 'point')]} x={{ scale: 'quantitative' }} y={{ scale: 'quantitative' }} domain={domain} />).container.querySelector('.vzf-frame-guide')!.innerHTML;
    const plain = drawn({ x: [-1, 1], y: [-1, 1] });
    cleanup();
    expect(drawn({ x: [-1, 1], y: [-1, 1], zeroGuide: {} })).toBe(plain);
    cleanup();
    expect(drawn({ x: [-1, 1], y: [-1, 1], zeroGuide: { x: false, y: false } })).toBe(plain);
    expect(plain).not.toContain('vzf-zero');
  });
});

describe('zeroGuideFor — the one owner of the verdict and the words', () => {
  const place = (value: number): number => value * 2;

  it('answers NOTHING where nothing was asked, so a picture with no guide is the picture that always was', () => {
    expect(zeroGuideFor({ channel: 'y', asked: undefined, domain: [-1, 1], place })).toBeUndefined();
    expect(zeroGuideFor({ channel: 'y', asked: false, domain: [-1, 1], place })).toBeUndefined();
    expect(zeroGuideNotes(undefined, undefined)).toEqual([]);
  });

  it('places zero through the caller’s own scale, and never asks the scale for a value it has no place for', () => {
    expect(zeroGuideFor({ channel: 'y', asked: true, domain: [-1, 1], place })).toEqual({ at: 0 });
    // a LOG axis is refused FIRST, before `place` is ever called — `logScale` would have no answer for 0
    const exploding = (): number => {
      throw new Error('a logarithmic scale must never be asked to place 0');
    };
    expect(zeroGuideFor({ channel: 'x', asked: true, domain: [1, 100], transform: 'log', place: exploding })).toEqual({
      refused: 'x was asked for a zero guide, and a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly',
    });
  });

  it('spells a bound to a hundredth, so a padded extent reads as a number rather than a float’s tail', () => {
    expect(zeroGuideFor({ channel: 'y', asked: true, domain: [0.10000000000000009, 3.3333333333], place })).toEqual({
      refused: 'y was asked for a zero guide, but its axis runs [0.1, 3.33] — zero is not a place on it, so there is no line to draw',
    });
  });

  it('collects the sentences in the order they were asked, and only the refusals', () => {
    const drawn = zeroGuideFor({ channel: 'x', asked: true, domain: [-1, 1], place });
    const refused = zeroGuideFor({ channel: 'y', asked: true, domain: [4, 8], place });
    expect(zeroGuideNotes(drawn, refused, undefined)).toEqual(['y was asked for a zero guide, but its axis runs [4, 8] — zero is not a place on it, so there is no line to draw']);
  });
});
