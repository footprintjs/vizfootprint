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
import { ColumnsStep, DataStep, ViewsStep } from './panels.js';
import { MAKE_PROPOSALS, MEASURED_BREAKS_ROWS, MEASURED_FINE_ROWS, emptyDraft } from './steps.js';
import type { MakeColumn, MakeDraft } from './types.js';
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

/** The step-three panel with nothing but drawing to do — every callback a no-op. */
function views(draft: MakeDraft, analysisKind = ''): void {
  render(
    <ViewsStep
      draft={draft}
      analysisKind={analysisKind}
      analysisOptions={{}}
      onView={() => undefined}
      onAdd={() => undefined}
      onRemove={() => undefined}
      onAnalysis={() => undefined}
      onWords={() => undefined}
      onTake={() => undefined}
    />,
  );
}

describe('the formula picker, over a table a host handed in', () => {
  it('names the columns a formula may read, and says so when the host handed in none', () => {
    views({ ...emptyDraft(), columns: [{ name: 'n', type: 'number', role: 'measure' }] }, 'formula');
    expect(document.querySelector('[data-vzf="make-formula-columns"]')?.textContent).toContain('The columns it may read: n.');
    cleanup();
    // a draft with no columns at all: not reachable by pasting a CSV, reachable
    // by a host building its own draft — so it is drawn, and drawn honestly
    views(emptyDraft(), 'formula');
    expect(document.querySelector('[data-vzf="make-formula-columns"]')?.textContent).toBe('this table has no columns yet');
  });
});

describe('the offer, over a table a host handed in', () => {
  it('says plainly when nothing this wizard can draw fits the columns yet', () => {
    views({ ...emptyDraft(), columns: [{ name: 'n', type: 'number', role: 'measure' }] });
    expect(document.querySelectorAll('[data-vzf="make-proposal"]')).toHaveLength(0);
    expect(document.querySelector('[data-vzf="make-no-proposals"]')?.textContent).toContain('nothing this wizard can draw fits these columns yet');
  });

  it('offers a few and says what it did not offer — the candidates it capped, and the ones past the limit', () => {
    const columns: MakeColumn[] = [
      ...['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, type: 'string' as const, role: 'dimension' as const })),
      ...['n1', 'n2'].map((name) => ({ name, type: 'number' as const, role: 'measure' as const })),
      { name: 'when', type: 'date' as const, role: 'dimension' as const },
    ];
    views({ ...emptyDraft(), columns });
    expect(document.querySelectorAll('[data-vzf="make-proposal"]')).toHaveLength(MAKE_PROPOSALS);
    const said = [...document.querySelectorAll('[data-vzf="make-not-enumerated"]')].map((p) => p.textContent ?? '');
    expect(said).toHaveLength(2);
    expect(said[0]).toContain('the category of a bar had 5 columns that fit, and only the first 4');
    expect(said[1]).toContain('proposals were found and the first 6 came back');
  });
});
