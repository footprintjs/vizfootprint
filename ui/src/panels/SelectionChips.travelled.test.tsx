// @vitest-environment jsdom
/**
 * THE VOICE, for a clause that TRAVELLED: a chip whose selection carries
 * `travelled` says, beneath its words, one line per consumer it reached
 * through a declared relation — the consumer's declared label or its address,
 * the relation's declared label or its spelling, and the size of the set the
 * pick became. Nothing is rendered when the key is absent, so every chip
 * without it is the chip it always was (`SelectionChips.narrowed.test.tsx`
 * pins that half; this file pins the twin).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { SelectionChips, chipWords, travelledWords } from './SelectionChips.js';
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';

afterEach(cleanup);

const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const LABEL = 'where the composite took its accepted radius from';
const pick: SelectionView = {
  viewId: 'mass_radius~planets',
  field: 'pl_name',
  kind: 'match',
  value: { values: ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'] },
  travelled: {
    // a labelled relation to a labelled consumer, and an unlabelled relation to an unlabelled layer address — the two spellings of each name
    'by_year~references': { clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] }, via: { path: [RADIUS_REF], label: LABEL, rows: 3 }, label: 'Discoveries by year' },
    'refs~sheet': { clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] }, via: { path: [RADIUS_REF], rows: 3 } },
  },
};
const plain: SelectionView = { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' };

describe('SelectionChips — a clause that travelled a relation says so, per consumer, beneath its words', () => {
  it('the sentence: `reached <label ?? address> through <relation label ?? relation> · N <far> values`', () => {
    expect(travelledWords('by_year~references', pick.travelled!['by_year~references']!)).toBe(`reached Discoveries by year through ${LABEL} · 2 ref values`);
    expect(travelledWords('refs~sheet', pick.travelled!['refs~sheet']!)).toBe('reached refs~sheet through planets.radius_ref → references.ref · 2 ref values');
  });

  it('one `role="note"` line per consumer, in the wire\'s order, inside the chip and after its words; the words themselves unchanged', () => {
    const { container } = render(<SelectionChips selections={[pick, plain]} labels={{ 'mass_radius~planets': 'Mass–radius' }} />);
    const chip = container.querySelector('.vzf-selchip[data-view="mass_radius~planets"]')!;
    const notes = chip.querySelectorAll('[role="note"].vzf-selchip-travelled');
    expect([...notes].map((n) => [n.getAttribute('data-consumer'), n.textContent])).toEqual([
      ['by_year~references', `reached Discoveries by year through ${LABEL} · 2 ref values`],
      ['refs~sheet', 'reached refs~sheet through planets.radius_ref → references.ref · 2 ref values'],
    ]);
    expect(chip.querySelector('.vzf-selchip-words')!.textContent).toBe(chipWords(pick));
    expect(chip.querySelector('.vzf-selchip-words')!.compareDocumentPosition(notes[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chipWords(pick)).toBe('pl_name in {Kepler-22b, TRAPPIST-1e, HD 209458 b}');
    expect(chip.querySelectorAll('.vzf-selchip-narrowed')).toHaveLength(0); // it travelled, so it was judged: no narrowed line
  });

  it('a chip without the key renders NO travelled note — byte-identical to before the key existed', () => {
    const { container } = render(<SelectionChips selections={[plain]} />);
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(0);
    expect(container.querySelector('.vzf-selchip-travelled')).toBeNull();
  });

  it('a KEPT chip (a cleared source an edge still `leave`s in force) carries its travelled notes the same way', () => {
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [{ viewId: 'mass_radius~planets', voice: ['match'] }, { viewId: 'by_year~references', voice: [] }],
      edges: [{ id: 'mass_radius~planets:match→by_year~references', source: 'mass_radius~planets', kind: 'match', target: 'by_year~references', response: 'filter', origin: 'declared', onClear: 'leave', via: [RADIUS_REF] }],
    };
    const cleared: ClearedSelectionView[] = [{ ...pick, clearedBy: 's2', travelled: { 'by_year~references': pick.travelled!['by_year~references']! } }];
    const { container } = render(<SelectionChips selections={[]} cleared={cleared} links={links} />);
    const kept = container.querySelector('.vzf-selchip-kept')!;
    expect(kept.querySelectorAll('[role="note"].vzf-selchip-travelled')).toHaveLength(1);
    expect(kept.querySelector('[role="note"]')!.textContent).toBe(`reached Discoveries by year through ${LABEL} · 2 ref values`);
  });

  it('the class is styled in the caption register beside `.vzf-selchip-narrowed`, and the chip wraps when it has such a line', () => {
    const css = readFileSync(process.cwd().endsWith('/ui') ? 'src/styles.css' : 'ui/src/styles.css', 'utf8');
    const rule = /\.vzf-selchip-travelled \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('color: var(--vzf-ink-soft)');
    expect(rule).toContain('font-family: var(--vzf-font-mono)');
    expect(css).toContain('.vzf-selchip:has(.vzf-selchip-travelled)');
  });

  it('the note is a SIBLING of the clear/flip/save controls, not inside one — clicking it fires no handler', () => {
    const onClear = vi.fn();
    const onSetPolarity = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<SelectionChips selections={[{ ...pick, commitId: 'c1' }]} onClear={onClear} onSetPolarity={onSetPolarity} onSave={onSave} />);
    const note = container.querySelector('[role="note"].vzf-selchip-travelled')!;
    expect(note.closest('button')).toBeNull();
    fireEvent.click(note);
    expect(onClear).not.toHaveBeenCalled();
    expect(onSetPolarity).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
