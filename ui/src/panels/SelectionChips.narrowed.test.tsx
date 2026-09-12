// @vitest-environment jsdom
/**
 * THE VOICE: a chip whose selection carries `narrowedFor` says, beneath its
 * words, one line per consumer it filtered nothing on — the consumer's
 * declared label or its address, and the session's reason quoted verbatim.
 * Nothing is rendered when the key is absent, so every chip without it is the
 * chip it always was.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { SelectionChips, chipWords, narrowedWords } from './SelectionChips.js';
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';

afterEach(cleanup);

const reason = (table: string) => `table "${table}" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows`;
const brush: SelectionView = {
  viewId: 'radius~bins',
  field: 'radii',
  kind: 'interval',
  value: [1, 5],
  // a labelled view, and an unlabelled layer address — the two spellings of "who"
  narrowedFor: { planets_sheet: { column: 'radii', reason: reason('planets'), label: 'Planets' }, 'net~edges': { column: 'radii', reason: reason('edges') } },
};
const plain: SelectionView = { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' };

describe('SelectionChips — a clause that filtered nothing says so, per consumer, beneath its words', () => {
  it('the sentence: `filtered nothing on <label ?? address> · <reason>`, the reason quoted verbatim', () => {
    expect(narrowedWords('planets_sheet', brush.narrowedFor!['planets_sheet']!)).toBe(`filtered nothing on Planets · ${reason('planets')}`);
    expect(narrowedWords('net~edges', brush.narrowedFor!['net~edges']!)).toBe(`filtered nothing on net~edges · ${reason('edges')}`);
  });

  it('one `role="note"` line per consumer, in the wire\'s order, inside the chip and after its words; the words themselves unchanged', () => {
    const { container } = render(<SelectionChips selections={[brush, plain]} labels={{ 'radius~bins': 'Radius' }} />);
    const chip = container.querySelector('.vzf-selchip[data-view="radius~bins"]')!;
    const notes = chip.querySelectorAll('[role="note"].vzf-selchip-narrowed');
    expect([...notes].map((n) => [n.getAttribute('data-consumer'), n.textContent])).toEqual([
      ['planets_sheet', `filtered nothing on Planets · ${reason('planets')}`],
      ['net~edges', `filtered nothing on net~edges · ${reason('edges')}`],
    ]);
    // beneath the words: the words come first, and they are `chipWords` exactly (the demo's agent reads them as `onScreen`)
    expect(chip.querySelector('.vzf-selchip-words')!.textContent).toBe(chipWords(brush));
    expect(chip.querySelector('.vzf-selchip-words')!.compareDocumentPosition(notes[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chipWords(brush)).toBe('radii 1 – 5');
  });

  it('a chip without the key renders NO note — byte-identical to before the key existed', () => {
    const { container } = render(<SelectionChips selections={[plain]} />);
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(0);
    expect(container.querySelector('.vzf-selchip-narrowed')).toBeNull();
    expect(screen.getByText('category = Formal')).toBeTruthy();
  });

  it('a KEPT chip (a cleared source an edge still `leave`s in force) carries its notes the same way', () => {
    const links: LinkGraphView = {
      default: 'crossfilter',
      views: [{ viewId: 'radius~bins', voice: ['interval'] }, { viewId: 'planets_sheet', voice: [] }],
      edges: [{ id: 'radius~bins:interval→planets_sheet', source: 'radius~bins', kind: 'interval', target: 'planets_sheet', response: 'filter', origin: 'declared', onClear: 'leave' }],
    };
    const cleared: ClearedSelectionView[] = [{ ...brush, clearedBy: 's2', narrowedFor: { planets_sheet: brush.narrowedFor!['planets_sheet']! } }];
    const { container } = render(<SelectionChips selections={[]} cleared={cleared} links={links} />);
    const kept = container.querySelector('.vzf-selchip-kept')!;
    expect(kept.querySelectorAll('[role="note"].vzf-selchip-narrowed')).toHaveLength(1);
    expect(kept.querySelector('[role="note"]')!.textContent).toBe(`filtered nothing on Planets · ${reason('planets')}`);
  });

  it('the class is styled in the caption register — the tick\'s own ink, mono — and the chip wraps only when it has a note', () => {
    const css = readFileSync(process.cwd().endsWith('/ui') ? 'src/styles.css' : 'ui/src/styles.css', 'utf8');
    const rule = /\.vzf-selchip-narrowed \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('color: var(--vzf-ink-soft)');
    expect(rule).toContain('font-family: var(--vzf-font-mono)');
    expect(css).toContain('.vzf-selchip:has(.vzf-selchip-narrowed)');
  });

  it('the note is a SIBLING of the clear/flip/save controls, not inside one — clicking it fires no handler', () => {
    const onClear = vi.fn();
    const onSetPolarity = vi.fn();
    const onSave = vi.fn();
    const { container } = render(<SelectionChips selections={[{ ...brush, commitId: 'c1' }]} labels={{ 'radius~bins': 'Radius' }} onClear={onClear} onSetPolarity={onSetPolarity} onSave={onSave} />);
    const note = container.querySelector('[role="note"].vzf-selchip-narrowed')!;
    // not nested inside any button this chip renders (clear/save; `radii` is an interval, not flippable)
    expect(note.closest('button')).toBeNull();
    fireEvent.click(note);
    expect(onClear).not.toHaveBeenCalled();
    expect(onSetPolarity).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
