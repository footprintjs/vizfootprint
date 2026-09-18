// @vitest-environment jsdom
/**
 * A MARK A READER IS MEANT TO PRESS MUST BE REACHABLE — and a target is not the
 * same thing as a mark.
 *
 * THE MEASURED DEFECT: on a real page a reader could not hit anything. The
 * cross-chain bar chart drew 185 bars across a 940px pane — about 5px each —
 * and a browser driver refused to click one, reporting the target as not
 * stable. The library offered a host nothing at all: no minimum mark width, no
 * hit area, no band floor. `bandWidth` clamps at zero and divides by
 * `max(1, count)`, so a slot simply got smaller until nobody could press it.
 *
 * Three parts, and the third is the one that keeps it honest:
 *
 *   1. A TAP ON A BAND SELECTS ITS SLOT (`VizLine` · `tapSlot`). It used to
 *      RELEASE the match, which left a 5px slot reachable by nothing but a
 *      drag. The clause is the bar's, byte for byte (`clickEmission` against
 *      the view's own live set), and the RELEASE stays reachable where every
 *      other chart puts it: click the selected slot again and it clears.
 *   2. A TARGET IS NEVER SMALLER THAN A FINGER (`pointerTargetWidth`,
 *      `MIN_POINTER_TARGET` = 24, WCAG 2.2 SC 2.5.8 Target Size (Minimum),
 *      Level AA). Each pressable bar gets a TRANSPARENT target over its whole
 *      slot column and the bar is drawn exactly as the data says — a hit area
 *      is not a mark.
 *   3. WHEN THE TARGETS WOULD OVERLAP THEY CANNOT ALL BE HONOURED. The target
 *      is `min(the minimum, the slot)`, because a press that landed on a
 *      NEIGHBOUR would select the wrong residue — worse than a press that
 *      misses — and when the slot is under the minimum the chart SAYS SO
 *      (`crowdedMarksNote`), derived from the measured slot width, in the same
 *      register it says a value is not drawn.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';

// mirrors charts.test.tsx's PointerEvent polyfill (jsdom ships none)
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }
});

import { VizBar } from './VizBar.js';
import { VizLine } from './VizLine.js';
import { MIN_POINTER_TARGET, pointerTargetWidth, crowdedMarksNote, slotAt } from '../primitives/scales.js';
import { selectionForView } from '../contract/selection.js';

afterEach(cleanup);

/* ── the two charts' margin boxes, written out HERE rather than imported: a test that reads the
      chart's own constant cannot notice the chart changing it. These are the numbers this packet
      found in the source, and the drawn geometry below is pinned against arithmetic built on them. ── */
const BAR = { l: 38, r: 14, t: 20, b: 48 };
const LINE = { l: 52, r: 18, t: 18, b: 44 };

/** A bar chart's slot width at this width and band count — the pre-packet arithmetic, spelled out. */
const barSlot = (width: number, count: number): number => (width - BAR.l - BAR.r) / count;
/** The centre of bar slot `index` — where its tick stands and its target is centred. */
const barCentre = (width: number, count: number, index: number): number => BAR.l + barSlot(width, count) * index + barSlot(width, count) / 2;
/** A band line's slot width, and the centre of slot `index` — the SAME arithmetic the dots are drawn by. */
const lineSlot = (width: number, count: number): number => (width - LINE.l - LINE.r) / count;
const lineCentre = (width: number, count: number, index: number): number => LINE.l + lineSlot(width, count) * index + lineSlot(width, count) / 2;

const BAND3 = [
  { category: 'Formal', count: 4 },
  { category: 'Casual', count: 9 },
  { category: 'Party', count: 2 },
];
/** The same three slots as line points (the band brush suite's own shape). */
const LINE3 = BAND3.map((d) => ({ category: d.category, value: d.count }));

/** A view's own live clause, through the contract's own read door. */
const sel = (value: unknown, viewId = 'v', field = 'shelf', kind: 'match' | 'point' = 'match') => selectionForView([{ viewId, field, kind, value }], viewId);

/** Press and release at one pixel — the brush's sub-4px TAP arm. */
const tap = (container: HTMLElement, clientX: number, selector = 'svg.vzf-line'): void => {
  const svg = container.querySelector(selector)!;
  fireEvent.pointerDown(svg, { clientX, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX, pointerId: 1 });
};

/** Every drawn bar as `x/y/width/height`, and every hit target as `x/y/width/height`. */
const boxes = (container: Element, selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((r) => `${r.getAttribute('x') ?? ''}/${r.getAttribute('y') ?? ''}/${r.getAttribute('width') ?? ''}/${r.getAttribute('height') ?? ''}`);

// ───────────────────────────────────────────────────────────────────────────────
// 1 · A TAP ON A BAND SELECTS ITS SLOT
// ───────────────────────────────────────────────────────────────────────────────

describe('a tap on a band selects its slot (VizLine · tapSlot)', () => {
  it('THE SLOT UNDER THE POINTER: a tap lands the slot it is inside, whichever slot that is', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={LINE3} width={520} dateField="shelf" onEmit={onEmit} />);
    // slots of 150 from x=52: 52..202 · 202..352 · 352..502
    tap(container, 100);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Formal', encoding: { kind: 'point', field: 'shelf' } });
    onEmit.mockClear();
    tap(container, 300);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Casual', encoding: { kind: 'point', field: 'shelf' } });
    onEmit.mockClear();
    tap(container, 480);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Party', encoding: { kind: 'point', field: 'shelf' } });
  });

  it('THE CLAUSE IS THE BAR’S, byte-identical — the same law the band brush keeps for a drag', () => {
    const fromLine = vi.fn();
    const line = render(<VizLine data={LINE3} width={520} dateField="shelf" onEmit={fromLine} />);
    tap(line.container, 300);
    cleanup();
    // the bar's own plain click on the same slot of the same band
    const fromBar = vi.fn();
    const bar = render(<VizBar data={BAND3} field="shelf" width={520} onEmit={fromBar} />);
    fireEvent.click([...bar.container.querySelectorAll('rect.vzf-barrect')][1]!);
    expect(JSON.stringify(fromLine.mock.calls[0]![0])).toBe(JSON.stringify(fromBar.mock.calls[0]![0]));
  });

  it('POLARITY INSIDE AN EXCLUDE SET: a tap on a member REMOVES it and the set stays an exclude — never a flip', () => {
    const excluded = sel({ values: ['Party', 'Casual'], exclude: true }, 'line');
    const fromLine = vi.fn();
    const line = render(<VizLine viewId="line" data={LINE3} width={520} dateField="shelf" selection={excluded} onEmit={fromLine} />);
    tap(line.container, 480); // 'Party'
    expect(fromLine.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Casual'], exclude: true }, encoding: { kind: 'match', field: 'shelf' } });
    cleanup();
    // and byte-identical to the bar's own click in the very same state
    const fromBar = vi.fn();
    const bar = render(<VizBar viewId="line" data={BAND3} field="shelf" width={520} selection={excluded} onEmit={fromBar} />);
    fireEvent.click([...bar.container.querySelectorAll('rect.vzf-barrect')][2]!);
    expect(JSON.stringify(fromLine.mock.calls[0]![0])).toBe(JSON.stringify(fromBar.mock.calls[0]![0]));
  });

  it('THE RELEASE IS STILL REACHABLE, by the gesture every other chart puts it on: tap the SELECTED slot again and it clears', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine viewId="line" data={LINE3} width={520} dateField="shelf" selection={sel({ values: ['Casual'] }, 'line')} onEmit={onEmit} />);
    tap(container, 300); // the one kept slot, tapped again
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: null, encoding: { kind: 'point', field: 'shelf' } });
    // …the very clause `VizBar`'s own second click lands (click-again-clears, `clickEmission`)
    cleanup();
    const fromBar = vi.fn();
    const bar = render(<VizBar viewId="line" data={BAND3} field="shelf" width={520} selection={sel({ values: ['Casual'] }, 'line')} onEmit={fromBar} />);
    fireEvent.click([...bar.container.querySelectorAll('rect.vzf-barrect')][1]!);
    expect(JSON.stringify(fromBar.mock.calls[0]![0])).toBe(JSON.stringify(onEmit.mock.calls[0]![0]));
  });

  it('A BAND WITH NO SLOT AT ALL: nothing was pressed, so nothing is emitted — never a fabricated clause', () => {
    const onEmit = vi.fn();
    // a frame declared the band EMPTY and this layer has no point to name one
    const { container } = render(<VizLine data={[]} width={520} dateField="shelf" domain={{ categories: [] }} onEmit={onEmit} />);
    tap(container, 300);
    expect(onEmit).not.toHaveBeenCalled();
    expect(slotAt(LINE.l, 520 - LINE.r, 0, 300)).toBe(-1);
  });

  it('A RUN IS UNTOUCHED: a dated line’s tap still RELEASES its interval, and its markup gains nothing', () => {
    const onEmit = vi.fn();
    const dated = [
      { date: '2026-04-01', value: 1 },
      { date: '2026-04-08', value: 2 },
    ];
    const { container } = render(<VizLine data={dated} width={520} onEmit={onEmit} />);
    tap(container, 300);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: null, encoding: { kind: 'interval', field: 'date' } });
    // no target, no sentence: a run's x is a continuum with no slots to crowd
    expect(container.innerHTML).not.toContain('vzf-mark-hit');
    expect(container.querySelector('text.vzf-crowded-note')).toBeNull();
    expect(container.querySelector('svg.vzf-line')!.getAttribute('aria-label')).toBe('value over date');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 2 · A TARGET IS NEVER SMALLER THAN A FINGER — and never a mark
// ───────────────────────────────────────────────────────────────────────────────

describe('a target is never smaller than a finger, and a hit area is NOT a mark (VizBar)', () => {
  it('THE MINIMUM comes from a published guideline, not from a number we liked', () => {
    // WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA: 24 by 24 CSS pixels
    expect(MIN_POINTER_TARGET).toBe(24);
    const src = readFileSync(process.cwd().endsWith('/ui') ? 'src/primitives/scales.ts' : 'ui/src/primitives/scales.ts', 'utf8');
    expect(src).toContain('WCAG 2.2 Success Criterion 2.5.8');
    expect(src).toContain('https://www.w3.org/TR/WCAG22/#target-size-minimum');
  });

  it('PRESENT OVER EACH PRESSABLE MARK, and TRANSPARENT: it paints nothing and the stylesheet says so', () => {
    const { container } = render(<VizBar data={BAND3} field="shelf" width={360} height={340} />);
    const hits = [...container.querySelectorAll('rect.vzf-mark-hit')];
    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      // a RECT, because that is what a stacked frame's pointer law delivers a press to
      // (`.vzf-frame-layer.vzf-frame-over :where(rect, circle, path, line, text)`, styles.css)
      expect(hit.tagName.toLowerCase()).toBe('rect');
      expect(hit.getAttribute('class')).toBe('vzf-mark-hit');
      expect(hit.getAttribute('fill')).toBeNull();
      expect(hit.getAttribute('stroke')).toBeNull();
      expect(hit.getAttribute('style')).toBeNull();
      // the MARK is the button; the target is where a pointer may press it, and AT never meets it twice
      expect(hit.getAttribute('aria-hidden')).toBe('true');
      expect(hit.getAttribute('role')).toBeNull();
      expect(hit.getAttribute('tabindex')).toBeNull();
    }
    expect(screen.getAllByRole('button', { name: /^select / })).toHaveLength(3);
    // one target per mark, and the target is the FIRST thing in its slot's group — drawn UNDER the bar,
    // so the drawing keeps its own hover, its own tooltip and its own outline
    for (const hit of hits) expect(hit.parentElement!.firstElementChild).toBe(hit);
    const css = readFileSync(process.cwd().endsWith('/ui') ? 'src/styles.css' : 'ui/src/styles.css', 'utf8');
    expect(css).toMatch(/\.vzf-mark-hit \{\n\s+fill: transparent;/);
    // …and the value label above a bar is furniture: a press on the number reaches the target under it
    expect(css).toMatch(/\.vzf-barval \{[^}]*pointer-events: none;/);
    // the library's own two precedents, unchanged by this packet — this is the third such column
    expect(css).toContain('.vzf-hist-hit {');
    expect(css).toContain('.vzf-box-hit {');
  });

  it('THE TARGET IS THE WHOLE SLOT COLUMN — full plot height, centred on the slot, so a sub-pixel bar is pressable', () => {
    const plot = 340 - BAR.t - BAR.b;
    const { container } = render(<VizBar data={BAND3} field="shelf" width={360} height={340} />);
    expect(boxes(container, 'rect.vzf-mark-hit')).toEqual([0, 1, 2].map((i) => `${String(barCentre(360, 3, i) - MIN_POINTER_TARGET / 2)}/${String(BAR.t)}/${String(MIN_POINTER_TARGET)}/${String(plot)}`));
    cleanup();
    // A BAR OF 2 IN A CHART OF 900 is 0.6px of drawn height: the other half of the reachability defect,
    // and the reason the target is the COLUMN and not the rect
    const lopsided = [
      { category: 'Formal', count: 2 },
      { category: 'Casual', count: 900 },
    ];
    const tall = render(<VizBar data={lopsided} field="shelf" width={360} height={340} />);
    expect(Number([...tall.container.querySelectorAll('rect.vzf-barrect')][0]!.getAttribute('height'))).toBeLessThan(1);
    expect(Number([...tall.container.querySelectorAll('rect.vzf-mark-hit')][0]!.getAttribute('height'))).toBe(plot);
  });

  it('A PRESS ANYWHERE IN THE TARGET LANDS THE MARK’S SELECTION — plain, additive, and as a drag-run’s start', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizBar viewId="bar" data={BAND3} field="shelf" width={360} onEmit={onEmit} />);
    const hits = [...container.querySelectorAll('rect.vzf-mark-hit')];
    fireEvent.click(hits[1]!);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Casual', encoding: { kind: 'point', field: 'shelf' } });
    // shift/⌘/ctrl through the target is the SET gesture, exactly as through the bar
    onEmit.mockClear();
    fireEvent.click(hits[2]!, { shiftKey: true });
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Party'] }, encoding: { kind: 'match', field: 'shelf' } });
    // and a drag-run may START in the empty air above a short bar — the target's own pointerdown
    onEmit.mockClear();
    fireEvent.pointerDown(hits[0]!, { clientX: 60, pointerId: 1 });
    const svg = container.querySelector('svg.vzf-bar')!;
    fireEvent.pointerMove(svg, { clientX: 200, pointerId: 1 }); // inside the second slot (141..243)
    fireEvent.pointerUp(svg, { clientX: 200, pointerId: 1 });
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Formal', 'Casual'] }, encoding: { kind: 'match', field: 'shelf' } });
  });

  it('AN EMPTY BAND GETS NO TARGET: no mark, nothing to press', () => {
    // the frame's band order names a fourth slot this layer has no row for
    const { container } = render(<VizBar data={BAND3} field="shelf" width={520} domain={{ categories: ['Formal', 'Casual', 'Party', 'Work'] }} />);
    expect(container.querySelectorAll('text.vzf-tick')).toHaveLength(4);
    expect(container.querySelectorAll('rect.vzf-barrect')).toHaveLength(3);
    expect(container.querySelectorAll('rect.vzf-mark-hit')).toHaveLength(3);
  });

  it('THE DRAWING IS UNCHANGED — the bar’s own geometry is what the data says, target or no target', () => {
    const { container } = render(<VizBar data={BAND3} field="shelf" width={360} height={340} />);
    const slot = barSlot(360, 3);
    const plot = 340 - BAR.t - BAR.b;
    const axisY = 340 - BAR.b;
    // x = slot start + 12% · width = 76% of the slot · height = count/max · plot — the pre-packet arithmetic
    expect(boxes(container, 'rect.vzf-barrect')).toEqual(
      BAND3.map((d, i) => {
        const h = (d.count / 9) * plot;
        return `${String(BAR.l + slot * i + slot * 0.12)}/${String(axisY - h)}/${String(slot * 0.76)}/${String(h)}`;
      }),
    );
    // …and a band line's dots keep their radius and their slot centre
    const line = render(<VizLine data={LINE3} width={520} dateField="shelf" />);
    expect([...line.container.querySelectorAll('circle.vzf-line-dot')].map((c) => `${c.getAttribute('cx') ?? ''}/${c.getAttribute('r') ?? ''}`)).toEqual([0, 1, 2].map((i) => `${String(lineCentre(520, 3, i))}/3.5`));
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 3 · WHEN THE TARGETS WOULD OVERLAP THEY CANNOT ALL BE HONOURED
// ───────────────────────────────────────────────────────────────────────────────

describe('when the targets would overlap they cannot all be honoured — the slot bounds them, and the chart says so', () => {
  /** The sentence, verbatim, for a slot of this width. */
  const SENTENCE = (px: number): string => `the marks are closer together than a pointer can separate: each slot is ${String(px)}px wide where a pointer target needs 24px, so a press may land on a neighbouring mark`;

  it('THE WORDS, verbatim, and derived from the MEASURED SLOT — never from the row count', () => {
    expect(crowdedMarksNote(4.8)).toBe(' — ' + SENTENCE(4.8));
    // rounded to a tenth, the way this library's tick labels are; the same 185 marks in a wide pane say nothing
    expect(crowdedMarksNote(4.702702702702703)).toBe(' — ' + SENTENCE(4.7));
    expect(crowdedMarksNote(60)).toBe('');
  });

  it('THE BOUNDARY, decided and pinned: a slot of EXACTLY the minimum is not crowded, and the target is the whole minimum', () => {
    expect(pointerTargetWidth(MIN_POINTER_TARGET)).toBe(MIN_POINTER_TARGET);
    expect(crowdedMarksNote(MIN_POINTER_TARGET)).toBe('');
    // …and one tenth under it is
    expect(pointerTargetWidth(23.9)).toBe(23.9);
    expect(crowdedMarksNote(23.9)).toBe(' — ' + SENTENCE(23.9));
    // drawn: ten bands in 292px are exactly 24 each — the floor honoured in full, nothing confessed
    const data = Array.from({ length: 10 }, (_, i) => ({ category: `c${String(i)}`, count: i + 1 }));
    const { container } = render(<VizBar data={data} field="shelf" width={292} height={340} />);
    expect(barSlot(292, 10)).toBe(24);
    for (const hit of container.querySelectorAll('rect.vzf-mark-hit')) expect(hit.getAttribute('width')).toBe('24');
    expect(container.querySelector('text.vzf-crowded-note')).toBeNull();
    expect(container.querySelector('svg.vzf-bar')!.getAttribute('aria-label')).toBe('count by shelf');
  });

  it('WIDE SLOTS take the minimum and say nothing: a target bigger than a finger is not a virtue', () => {
    const { container } = render(<VizBar data={BAND3} field="shelf" width={360} height={340} />);
    expect(barSlot(360, 3)).toBeGreaterThan(MIN_POINTER_TARGET);
    for (const hit of container.querySelectorAll('rect.vzf-mark-hit')) expect(hit.getAttribute('width')).toBe('24');
    expect(container.querySelector('text.vzf-crowded-note')).toBeNull();
    expect(container.querySelector('svg.vzf-bar')!.getAttribute('aria-label')).toBe('count by shelf');
  });

  it('NARROW SLOTS get SLOT-WIDTH targets — disjoint, because a press that landed on a NEIGHBOUR would select the wrong mark', () => {
    const data = Array.from({ length: 40 }, (_, i) => ({ category: `c${String(i)}`, count: i + 1 }));
    const { container } = render(<VizBar data={data} field="shelf" width={360} height={340} />);
    const slot = barSlot(360, 40); // 7.7
    expect(slot).toBeLessThan(MIN_POINTER_TARGET);
    const hits = [...container.querySelectorAll('rect.vzf-mark-hit')];
    for (const hit of hits) expect(Number(hit.getAttribute('width'))).toBe(slot);
    // they TILE the axis and never overlap: each target begins exactly where the last one ended
    for (let i = 1; i < hits.length; i++) {
      const prevRight = Number(hits[i - 1]!.getAttribute('x')) + Number(hits[i - 1]!.getAttribute('width'));
      expect(Number(hits[i]!.getAttribute('x'))).toBeCloseTo(prevRight, 10);
    }
  });

  it('AND THE CHART SAYS SO — the sentence in the picture and in the accessible name, in the register of the excluded note', () => {
    const data = Array.from({ length: 40 }, (_, i) => ({ category: `c${String(i)}`, count: i + 1 }));
    const { container } = render(<VizBar data={data} field="shelf" width={360} height={340} />);
    const slot = Math.round(barSlot(360, 40) * 10) / 10; // 7.7
    expect(container.querySelector('text.vzf-crowded-note')!.textContent).toBe(SENTENCE(slot));
    expect(container.querySelector('svg.vzf-bar')!.getAttribute('aria-label')).toBe('count by shelf — ' + SENTENCE(slot));
    // the same faint mono the excluded note wears — the same kind of fact, said the same way
    const css = readFileSync(process.cwd().endsWith('/ui') ? 'src/styles.css' : 'ui/src/styles.css', 'utf8');
    expect(css).toMatch(/\.vzf-crowded-note \{\n\s+fill: var\(--vzf-ink-faint\);\n\s+font-family: var\(--vzf-font-mono\);/);
  });

  it('A BAND LINE says it too, beside its own excluded note and never over it', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ category: `c${String(i)}`, value: i }));
    const bare = render(<VizLine data={data} width={300} height={300} dateField="shelf" />);
    const slot = Math.round(lineSlot(300, 30) * 10) / 10; // 7.7
    expect(bare.container.querySelector('text.vzf-crowded-note')!.textContent).toBe(SENTENCE(slot));
    expect(bare.container.querySelector('svg.vzf-line')!.getAttribute('aria-label')).toBe('value over shelf — ' + SENTENCE(slot));
    const alone = bare.container.querySelector('text.vzf-crowded-note')!.getAttribute('y');
    cleanup();
    // c0 carries a 0, which a logarithmic value axis has no place for: both facts, both said, one above the other
    const both = render(<VizLine data={data} width={300} height={300} dateField="shelf" domain={{ transform: { y: 'log' } }} />);
    expect(both.container.querySelector('text.vzf-excluded-note')!.textContent).toContain('1 value is not drawn');
    expect(Number(both.container.querySelector('text.vzf-crowded-note')!.getAttribute('y'))).toBe(Number(alone) - 11);
  });

  it('A WIDE BAND LINE says nothing at all — and neither does a chart with no band', () => {
    const wide = render(<VizLine data={LINE3} width={520} height={300} dateField="shelf" />);
    expect(lineSlot(520, 3)).toBeGreaterThan(MIN_POINTER_TARGET);
    expect(wide.container.querySelector('text.vzf-crowded-note')).toBeNull();
    expect(wide.container.querySelector('svg.vzf-line')!.getAttribute('aria-label')).toBe('value over shelf');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// THE DESK'S OWN CASE — the regression pin
// ───────────────────────────────────────────────────────────────────────────────

describe('the desk’s own case: 185 marks across a 940px pane, about 5px each', () => {
  const NAMES = Array.from({ length: 185 }, (_, i) => `r${String(i + 1)}`);

  it('A BAR: a press lands the right slot, the target is the slot, and the sentence is there', () => {
    const onEmit = vi.fn();
    const data = NAMES.map((category, i) => ({ category, count: i + 1 }));
    const { container } = render(<VizBar data={data} field="residue" width={940} height={340} onEmit={onEmit} />);
    expect(barSlot(940, 185)).toBe(4.8);
    const hits = [...container.querySelectorAll('rect.vzf-mark-hit')];
    expect(hits).toHaveLength(185);
    expect(hits[100]!.getAttribute('width')).toBe('4.8');
    // a press in slot 100's target lands slot 100's residue and no neighbour's
    fireEvent.click(hits[100]!);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'r101', encoding: { kind: 'point', field: 'residue' } });
    expect(container.querySelector('text.vzf-crowded-note')!.textContent).toBe(
      'the marks are closer together than a pointer can separate: each slot is 4.8px wide where a pointer target needs 24px, so a press may land on a neighbouring mark',
    );
  });

  it('A BAND LINE: a single tap lands the right residue — what a browser driver could not do at all', () => {
    const onEmit = vi.fn();
    const data = NAMES.map((category, i) => ({ category, value: i }));
    const { container } = render(<VizLine data={data} width={940} height={340} dateField="residue" onEmit={onEmit} />);
    expect(lineSlot(940, 185)).toBeLessThan(5);
    tap(container, lineCentre(940, 185, 100));
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'r101', encoding: { kind: 'point', field: 'residue' } });
    expect(container.querySelector('text.vzf-crowded-note')!.textContent).toBe(
      'the marks are closer together than a pointer can separate: each slot is 4.7px wide where a pointer target needs 24px, so a press may land on a neighbouring mark',
    );
  });
});
