// @vitest-environment jsdom
/**
 * VizTable — behavioral suite: sortable columns (asc/desc/none cycle,
 * aria-sort), row click -> point selection by id (click-again-clears, the
 * VizBar/VizMap gesture), DIM-not-hide crossfilter semantics (the VizScatter
 * pattern — see the file header's design-call comment), mono numeric cells,
 * keyboard access, the honest empty state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { VizTable, type TableRow } from './VizTable.js';

afterEach(cleanup);

const ROWS: TableRow[] = [
  { id: 'd01', category: 'Casual', price: 50, rating: 4 },
  { id: 'd02', category: 'Formal', price: 220, rating: 2 },
  { id: 'd03', category: 'Party', price: 90, rating: null },
];
const COLUMNS = ['category', 'price', 'rating'];

describe('VizTable — rendering + formatting', () => {
  it('renders one row per datum with the given columns, in order', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} />);
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('Casual');
    expect(rows[0]!.textContent).toContain('50');
  });

  it('numeric cells get the mono/tabular-nums class; non-numeric cells do not', () => {
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} />);
    const firstRow = container.querySelectorAll('tbody tr')[0]!;
    const cells = firstRow.querySelectorAll('td');
    expect(cells[0]!.className).toBe(''); // category — string
    expect(cells[1]!.className).toBe('vzf-mono'); // price — number
    expect(cells[2]!.className).toBe('vzf-mono'); // rating — number
  });

  it('a null cell renders an honest em-dash, never a blank', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} />);
    const row = screen.getByRole('row', { name: /row d03/ });
    expect(row.textContent).toContain('—');
  });

  it('the honest empty state renders when there are no rows, and no table at all', () => {
    render(<VizTable data={[]} columns={COLUMNS} />);
    expect(screen.getByRole('status').textContent).toBe('no rows to show');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('column headers use the labels override, falling back to the field name', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} labels={{ price: 'Price ($)' }} />);
    expect(screen.getByRole('columnheader', { name: /Price \(\$\)/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^sort by category/ })).toBeTruthy();
  });

  it('appends the className prop and applies width/height, defaulting when omitted', () => {
    const { container, rerender } = render(<VizTable data={ROWS} columns={COLUMNS} className="my-extra" />);
    const root = container.querySelector('[data-vzf-chart="table"]') as HTMLElement;
    expect(root.className).toBe('vzf-chart vzf-table-frame my-extra');
    expect(root.style.width).toBe('520px');
    expect(root.style.height).toBe('340px');

    rerender(<VizTable data={ROWS} columns={COLUMNS} width={640} height={280} />);
    const root2 = container.querySelector('[data-vzf-chart="table"]') as HTMLElement;
    expect(root2.className).toBe('vzf-chart vzf-table-frame');
    expect(root2.style.width).toBe('640px');
    expect(root2.style.height).toBe('280px');
  });

  it('embeds the viewId in the table\'s accessible name', () => {
    render(<VizTable viewId="dresses" data={ROWS} columns={COLUMNS} />);
    expect(screen.getByRole('table', { name: /view dresses/ })).toBeTruthy();
  });
});

describe('VizTable — row selection (point emission, click-again-clears)', () => {
  it('clicking a row emits a point selection on the default id field', () => {
    const onEmit = vi.fn();
    render(<VizTable data={ROWS} columns={COLUMNS} onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('row', { name: /row d02/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'd02', encoding: { kind: 'point', field: 'id' } });
  });

  it('clicking the ALREADY-selected row clears it (rawValue undefined)', () => {
    const onEmit = vi.fn();
    render(<VizTable data={ROWS} columns={COLUMNS} selected="d02" onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('row', { name: /row d02 selected/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: undefined, encoding: { kind: 'point', field: 'id' } });
  });

  it('a selected row carries aria-selected and the selection class', () => {
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} selected="d01" />);
    const row = container.querySelector('[aria-label="row d01 selected"]')!;
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.className).toContain('vzf-selected');
    const other = container.querySelector('[aria-label="row d02"]')!;
    expect(other.getAttribute('aria-selected')).toBe('false');
  });

  it('honours a custom idField', () => {
    const onEmit = vi.fn();
    const rows: TableRow[] = [{ sku: 'x1', name: 'Widget' }];
    render(<VizTable data={rows} columns={['name']} idField="sku" onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('row', { name: /row x1/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'x1', encoding: { kind: 'point', field: 'sku' } });
  });

  it('Enter on a focused row selects it; other keys are no-ops', () => {
    const onEmit = vi.fn();
    render(<VizTable data={ROWS} columns={COLUMNS} onEmit={onEmit} />);
    const row = screen.getByRole('row', { name: /row d01/ });
    const ok = fireEvent.keyDown(row, { key: 'a' });
    expect(onEmit).not.toHaveBeenCalled();
    expect(ok).toBe(true);
    const enterOk = fireEvent.keyDown(row, { key: 'Enter' });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'd01', encoding: { kind: 'point', field: 'id' } });
    expect(enterOk).toBe(false);
  });
});

describe('VizTable — sorting (asc -> desc -> none, aria-sort)', () => {
  it('cycles a numeric column asc -> desc -> none and updates aria-sort + row order', () => {
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} />);
    const priceHeader = screen.getByRole('columnheader', { name: /sort by price/ });
    const idsInOrder = (): string[] => Array.from(container.querySelectorAll('tbody tr')).map((r) => r.getAttribute('aria-label') ?? '');

    expect(priceHeader.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(priceHeader);
    expect(priceHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(idsInOrder()).toEqual(['row d01', 'row d03', 'row d02']); // 50, 90, 220

    fireEvent.click(priceHeader);
    expect(priceHeader.getAttribute('aria-sort')).toBe('descending');
    expect(idsInOrder()).toEqual(['row d02', 'row d03', 'row d01']); // 220, 90, 50

    fireEvent.click(priceHeader);
    expect(priceHeader.getAttribute('aria-sort')).toBe('none');
    expect(idsInOrder()).toEqual(['row d01', 'row d02', 'row d03']); // back to input order
  });

  it('sorts a string column via locale compare', () => {
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} />);
    fireEvent.click(screen.getByRole('columnheader', { name: /sort by category/ }));
    const first = container.querySelector('tbody tr td')!;
    expect(first.textContent).toBe('Casual'); // C < F < P
  });

  it('clicking a DIFFERENT column resets to ascending on the new column (only one column sorted at a time)', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} />);
    const priceHeader = screen.getByRole('columnheader', { name: /sort by price/ });
    const ratingHeader = screen.getByRole('columnheader', { name: /sort by rating/ });
    fireEvent.click(priceHeader);
    fireEvent.click(priceHeader); // now descending
    expect(priceHeader.getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(ratingHeader);
    expect(ratingHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(priceHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('shows the ascending/descending arrow glyph only on the actively sorted header', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} />);
    const priceHeader = screen.getByRole('columnheader', { name: /sort by price/ });
    const ratingHeader = screen.getByRole('columnheader', { name: /sort by rating/ });
    expect(priceHeader.querySelector('.vzf-sort-arrow')).toBeNull();
    fireEvent.click(priceHeader);
    expect(priceHeader.querySelector('.vzf-sort-arrow')?.textContent).toContain('▲');
    expect(ratingHeader.querySelector('.vzf-sort-arrow')).toBeNull();
    fireEvent.click(priceHeader);
    expect(priceHeader.querySelector('.vzf-sort-arrow')?.textContent).toContain('▼');
  });

  it('Enter and Space on a header sort; other keys are no-ops', () => {
    render(<VizTable data={ROWS} columns={COLUMNS} />);
    const priceHeader = screen.getByRole('columnheader', { name: /sort by price/ });
    const ignored = fireEvent.keyDown(priceHeader, { key: 'Tab' });
    expect(priceHeader.getAttribute('aria-sort')).toBe('none');
    expect(ignored).toBe(true);

    const enterOk = fireEvent.keyDown(priceHeader, { key: 'Enter' });
    expect(priceHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(enterOk).toBe(false);

    const spaceOk = fireEvent.keyDown(priceHeader, { key: ' ' });
    expect(priceHeader.getAttribute('aria-sort')).toBe('descending');
    expect(spaceOk).toBe(false);
  });
});

describe('VizTable — highlight (dim, never hide)', () => {
  it('dims rows failing the highlight predicate and reports how many match, without removing any row', () => {
    const highlight = (row: TableRow) => row['category'] === 'Casual';
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} highlight={highlight} />);
    expect(screen.getByRole('status').textContent).toBe('1 of 3 rows match the current selection');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3); // every row still present
    expect(rows[0]!.className).not.toContain('vzf-dim'); // Casual — kept
    expect(rows[1]!.className).toContain('vzf-dim'); // Formal — dimmed
    expect(rows[2]!.className).toContain('vzf-dim'); // Party — dimmed
  });

  it('omitting highlight shows no status line and dims nothing', () => {
    const { container } = render(<VizTable data={ROWS} columns={COLUMNS} />);
    expect(screen.queryByRole('status')).toBeNull();
    container.querySelectorAll('tbody tr').forEach((r) => expect(r.className).not.toContain('vzf-dim'));
  });
});
