// @vitest-environment jsdom
/**
 * THE STEP PANELS, ON THEIR OWN.
 *
 * `Make.test.tsx` drives them the way a person does, through the wizard. This
 * file mounts two of them directly, for the cases a person cannot reach from a
 * pasted CSV but a HOST can reach by handing the panel its own reading: a
 * column of dates (a CSV sniffs an ISO string as a string, so only rows carry
 * dates), a distinct count that hit its cap, a table past the ninety thousand
 * the engine is measured at, and a declaration being taken back to "not said".
 *
 * They are reachable because `MakeReading` is a shape a host may build — the
 * whole point of the pure exports — so they are drawn, and drawn correctly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColumnsStep, DataStep } from './panels.js';
import { MEASURED_BREAKS_ROWS, MEASURED_FINE_ROWS, emptyDraft } from './steps.js';
import type { MakeReading } from './types.js';

afterEach(cleanup);

const dated: MakeReading = {
  rows: MEASURED_FINE_ROWS + 1,
  columns: [
    { name: 'when', type: 'date', sample: [new Date('2026-01-01T00:00:00.000Z')], distinct: 1000, distinctCapped: true, extent: [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-06-01T00:00:00.000Z')] },
    { name: 'n', type: 'number', sample: [1], distinct: 1, distinctCapped: false },
  ],
};

describe('the description a HOST supplied', () => {
  it('draws dates as days, says when a distinct count is only the cap, and colours a table past the ceiling', () => {
    render(<DataStep draft={emptyDraft()} reading={dated} onCsv={() => undefined} onRead={() => undefined} />);
    const table = document.querySelector('[data-vzf="make-description"]');
    expect(table?.textContent).toContain('2026-01-01 … 2026-06-01');
    expect(table?.textContent).toContain('1000 or more — the count stops at the cap');
    // past ninety thousand: the verdict is drawn in the stale colour, not the ok one
    const verdict = document.querySelector('[data-vzf="make-ceiling-verdict"]') as HTMLElement;
    expect(verdict.textContent).toContain('Gestures will be slower');
    expect(verdict.style.color).toBe('var(--vzfs-stale)');
  });

  it('says what a file past a MILLION rows will cost, in the same place', () => {
    render(<DataStep draft={emptyDraft()} reading={{ ...dated, rows: MEASURED_BREAKS_ROWS }} onCsv={() => undefined} onRead={() => undefined} />);
    expect(document.querySelector('[data-vzf="make-ceiling-verdict"]')?.textContent).toContain('at or past the million');
  });

  it('a file input that hands back NO file list at all changes nothing', () => {
    let read: string | null = null;
    render(<DataStep draft={emptyDraft()} reading={null} onCsv={(t) => (read = t)} onRead={() => undefined} />);
    const input = screen.getByLabelText(/choose a file/) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: null });
    fireEvent.change(input);
    expect(read).toBeNull();
  });
});

describe('taking a declaration back', () => {
  it('sets a type and a scale back to "not said" rather than to an empty string', () => {
    const patches: { readonly name: string; readonly patch: Record<string, unknown> }[] = [];
    const draft = { ...emptyDraft(), columns: [{ name: 'when', type: 'date' as const, role: 'dimension' as const, scale: 'continuous' as const }, { name: 'n' }] };
    render(<ColumnsStep draft={draft} sniffed={{ when: 'string', n: 'unknown' }} absenceField="" absenceStates="" onColumn={(name, patch) => patches.push({ name, patch: patch as Record<string, unknown> })} onAbsence={() => undefined} />);

    // a column nobody has typed shows "— as it reads —", and choosing it back says nothing rather than ''
    expect((screen.getByLabelText('n is a') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('when is a'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('the scale of when'), { target: { value: '' } });
    expect(patches).toEqual([
      { name: 'when', patch: { type: undefined } },
      { name: 'when', patch: { scale: undefined } },
    ]);
  });
});
