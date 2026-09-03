// @vitest-environment jsdom
/**
 * The grid: it renders the window the engine answered, freezes the key the
 * WINDOW names, reaches its last row at any size, keeps a keyboard move until
 * the row it names arrives, sorts from the header when the engine can, and
 * refuses a row click on a positional table, a cell edit anywhere and a data
 * layer that threw — in words, in the status line, never silently.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Sheet, canvasMetrics, cellText, nextSort, rowAtScroll, scrollForRow, statusWords, POSITIONAL_REFUSAL, SHEET_BORDERS, SHEET_CANVAS_MAX, SHEET_ROW_HEIGHT, SHEET_STATUS_HEIGHT } from './index.js';
import type { SheetColumn, SheetData, SheetWindow, SheetWindowRequest } from './types.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The key is declared SECOND on purpose: the sheet must bring it to the front and freeze it. */
const FACETS: readonly SheetColumn[] = [
  { name: 'cases', type: 'number', role: 'measure' },
  { name: 'jurisdiction', type: 'string', role: 'identifier' },
];

/** The sheet's own geometry, so a test states the row it expects rather than a magic number. */
const HEIGHT = 200;
const BODY_HEIGHT = HEIGHT - SHEET_BORDERS - SHEET_ROW_HEIGHT - SHEET_STATUS_HEIGHT;
const metricsFor = (count: number, canvasMax = SHEET_CANVAS_MAX): ReturnType<typeof canvasMetrics> => canvasMetrics(count, SHEET_ROW_HEIGHT, BODY_HEIGHT, canvasMax);

interface FakeOptions {
  readonly count?: number;
  readonly facets?: readonly SheetColumn[];
  readonly positional?: boolean;
  readonly key?: string | null;
  readonly sort?: boolean;
  readonly refusal?: string;
  readonly reason?: 'engine' | 'unsupported-sort';
  readonly shortIds?: boolean;
  readonly columns?: readonly string[];
  readonly cursor?: string | null;
}

/** A data layer over a table that is generated, not held — the shape a real engine answers. */
function fakeData(options: FakeOptions = {}): { readonly data: SheetData; readonly asked: SheetWindowRequest[] } {
  const count = options.count ?? 8;
  const names = options.columns ?? ['cases', 'jurisdiction'];
  const asked: SheetWindowRequest[] = [];
  const positional = options.positional ?? false;
  const key = options.key === null ? undefined : (options.key ?? 'jurisdiction');
  return {
    asked,
    data: {
      capabilities: { sort: options.sort ?? true, countKnown: true, edit: false, ...(options.sort === false ? { refusal: 'the wasm engine cannot sort' } : {}) },
      columns: () => Promise.resolve(options.facets ?? FACETS),
      rows: (window: SheetWindowRequest) => {
        asked.push(window);
        if (options.refusal !== undefined) return Promise.resolve({ ok: false as const, reason: options.reason ?? ('engine' as const), rejected: options.refusal });
        const size = Math.max(0, Math.min(window.limit, count - window.offset));
        const rows = Array.from({ length: size }, (_, i) => ({ cases: window.offset + i, jurisdiction: `area-${String(window.offset + i)}`, note: (window.offset + i) % 2 === 0 ? null : 'seen' }));
        const rowIds = rows.map((r) => String(r.jurisdiction));
        return Promise.resolve({
          ok: true as const,
          columns: names,
          rows,
          rowIds: options.shortIds === true ? rowIds.slice(0, 1) : rowIds,
          positional,
          ...(positional || key === undefined ? {} : { key }),
          count,
          start: window.offset,
          version: 'v1',
          cursor: options.cursor === undefined ? 'c1' : options.cursor,
        });
      },
    },
  };
}

const cells = (container: HTMLElement): string[] => [...container.querySelectorAll('.vzf-sheet-rows .vzf-sheet-cell')].map((el) => el.textContent ?? '');
const readout = (container: HTMLElement): string => container.querySelector('.vzf-sheet-readout')?.textContent ?? '';
const said = (container: HTMLElement): string => container.querySelector('.vzf-sheet-said')?.textContent ?? '';
const bodyOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('.vzf-sheet-body')!;
const rowsIn = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.vzf-sheet-rows [role="row"]')];

describe('the pure rules', () => {
  it('the two ranges: what can be scrolled maps onto what can be shown, and BOTH ends are exact', () => {
    const small = canvasMetrics(1000, 28, 560, SHEET_CANVAS_MAX);
    expect(small).toEqual({ canvasHeight: 28_000, scrollMax: 27_440, visibleRows: 20, maxFirst: 980 });
    for (const count of [1_000_000, 5_000_000]) {
      const m = canvasMetrics(count, 28, 560, SHEET_CANVAS_MAX);
      expect(m.canvasHeight).toBe(SHEET_CANVAS_MAX); // both are past what a browser will lay out
      expect(m.maxFirst).toBe(count - 20);
      // the LAST screenful is reachable: the browser's own maximum scroll lands on the last first-row
      expect(rowAtScroll(m.scrollMax, m)).toBe(m.maxFirst);
      expect(rowAtScroll(0, m)).toBe(0);
      expect(scrollForRow(m.maxFirst, m)).toBe(m.scrollMax);
      expect(scrollForRow(0, m)).toBe(0);
      // and the round trip is exact wherever it is taken
      for (const row of [0, 1, 12_345, Math.floor(m.maxFirst / 2), m.maxFirst - 1, m.maxFirst]) expect(rowAtScroll(scrollForRow(row, m), m)).toBe(row);
      // asking past the ends is clamped, never extrapolated
      expect(rowAtScroll(m.scrollMax * 2, m)).toBe(m.maxFirst);
      expect(rowAtScroll(-100, m)).toBe(0);
      expect(scrollForRow(count + 99, m)).toBe(m.scrollMax);
      expect(scrollForRow(-4, m)).toBe(0);
    }
  });

  it('a table that fits its box has nothing to scroll and one first row', () => {
    const m = canvasMetrics(4, 28, 560, SHEET_CANVAS_MAX);
    expect(m).toEqual({ canvasHeight: 112, scrollMax: 0, visibleRows: 20, maxFirst: 0 });
    expect(rowAtScroll(999, m)).toBe(0);
    expect(scrollForRow(3, m)).toBe(0);
    expect(canvasMetrics(0, 28, 10, SHEET_CANVAS_MAX).visibleRows).toBe(1); // a box shorter than a row still shows one
  });

  it('the sort toggle walks none → ascending → descending → none, one column at a time', () => {
    expect(nextSort(undefined, 'cases')).toEqual([{ field: 'cases', dir: 'asc' }]);
    expect(nextSort([{ field: 'cases', dir: 'asc' }], 'cases')).toEqual([{ field: 'cases', dir: 'desc' }]);
    expect(nextSort([{ field: 'cases', dir: 'desc' }], 'cases')).toBeUndefined();
    expect(nextSort([{ field: 'cases', dir: 'desc' }], 'jurisdiction')).toEqual([{ field: 'jurisdiction', dir: 'asc' }]);
  });

  it('an absent cell is blank — never the word "null", never a zero', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(0)).toBe('0');
    expect(cellText('measles')).toBe('measles');
  });

  it('the readout says which rows, of how many, at what version and in what order — and never a range past the count', () => {
    expect(statusWords(null, undefined)).toBe('reading the first window…');
    const win: SheetWindow = { ok: true, columns: ['a'], rows: [{ a: 1 }, { a: 2 }], rowIds: ['1', '2'], positional: false, count: 90_300, start: 100, version: 'v1', cursor: 'c1' };
    expect(statusWords(win, undefined)).toBe('rows 101–102 of 90,300 · version v1');
    expect(statusWords(win, [{ field: 'cases', dir: 'asc' }])).toContain('sorted by cases ↑');
    expect(statusWords(win, [{ field: 'cases', dir: 'desc' }])).toContain('sorted by cases ↓');
    expect(statusWords({ ...win, version: null }, undefined)).toContain('no data version');
    expect(statusWords({ ...win, rows: [], rowIds: [], start: 0 }, undefined)).toBe('rows 0–0 of 90,300 · version v1');
    // a window that overhangs its own count (a table that shrank under it) is clamped, never overstated
    expect(statusWords({ ...win, count: 101 }, undefined)).toBe('rows 101–101 of 101 · version v1');
  });
});

describe('<Sheet> — the window on screen', () => {
  it('renders the window the engine answered, with the key the WINDOW named brought to the front, and each column\'s type and role', async () => {
    const { data, asked } = fakeData({ count: 8 });
    const { container } = render(<Sheet data={data} table="cells" viewId="sheet" height={HEIGHT} version="v1" cursor="c1" className="x" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    expect(container.querySelector('.vzf-sheet')!.classList.contains('x')).toBe(true);
    const heads = [...container.querySelectorAll('[role="columnheader"]')].map((el) => el.getAttribute('data-column'));
    expect(heads).toEqual(['jurisdiction', 'cases']); // the key is frozen first, whatever order the engine listed
    expect(container.querySelector('[data-column="jurisdiction"] .vzf-sheet-type')!.textContent).toBe('string');
    expect(container.querySelector('[data-column="jurisdiction"] .vzf-sheet-role')!.textContent).toBe('identifier');
    expect(container.querySelector('[data-column="cases"] .vzf-sheet-role')!.textContent).toBe('measure');
    expect(cells(container).slice(0, 4)).toEqual(['area-0', '0', 'area-1', '1']);
    expect(container.querySelector('[data-row="0"] [data-column="cases"]')!.classList.contains('vzf-sheet-num')).toBe(true);
    expect(container.querySelector('[data-row="0"] [data-column="jurisdiction"]')!.classList.contains('vzf-sheet-num')).toBe(false);
    expect(container.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe('9'); // 8 rows + the header
    expect(readout(container)).toContain('rows 1–8 of 8 · version v1');
    // the readout is not announced (it changes on every scroll); the refusals are
    expect(container.querySelector('.vzf-sheet-readout')!.getAttribute('aria-live')).toBe('off');
    expect(container.querySelector('.vzf-sheet-said')!.getAttribute('role')).toBe('status');
    expect(container.querySelector('.vzf-sheet-said')!.getAttribute('aria-live')).toBe('polite');
    expect(asked).toHaveLength(1); // one question, one window
    expect(asked[0]).toMatchObject({ offset: 0, viewId: 'sheet' });
  });

  it('a plain dimension gets no role badge — a badge is for a role that changes what a column IS', async () => {
    const { data } = fakeData({ count: 2, facets: [{ name: 'cases', type: 'number', role: 'dimension' }, { name: 'jurisdiction', type: 'string' }] });
    const { container } = render(<Sheet data={data} height={HEIGHT} />);
    await waitFor(() => expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(2));
    expect(container.querySelector('.vzf-sheet-role')).toBeNull();
  });

  it('scrolling asks for the next window once, and the same window again is served from the block already held', async () => {
    const { data, asked } = fakeData({ count: 90_300 });
    const { container } = render(<Sheet data={data} table="cells" viewId="sheet" height={HEIGHT} version="v1" cursor="c1" blockRows={100} maxBlocks={4} />);
    await waitFor(() => expect(asked).toHaveLength(1));
    const m = metricsFor(90_300);
    const body = bodyOf(container);
    fireEvent.scroll(body, { target: { scrollTop: scrollForRow(30, m) } });
    await waitFor(() => expect(readout(container)).toContain('rows 31–'));
    expect(asked).toHaveLength(1); // still inside block 0
    fireEvent.scroll(body, { target: { scrollTop: scrollForRow(300, m) } });
    await waitFor(() => expect(readout(container)).toContain('rows 301–'));
    expect(asked).toHaveLength(2);
    fireEvent.scroll(body, { target: { scrollTop: scrollForRow(30, m) } });
    await waitFor(() => expect(readout(container)).toContain('rows 31–'));
    expect(asked).toHaveLength(2); // back where the block still is
    expect(container.querySelector('.vzf-sheet-canvas')!.getAttribute('style')).toContain(`height: ${String(m.canvasHeight)}px`);
  });

  it('a million rows get a CAPPED canvas AND a reachable last row — the bottom of the scroll is the bottom of the table', async () => {
    const { data } = fakeData({ count: 1_000_000 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(readout(container)).toContain('of 1,000,000'));
    const m = metricsFor(1_000_000);
    expect(container.querySelector('.vzf-sheet-canvas')!.getAttribute('style')).toContain(`height: ${String(SHEET_CANVAS_MAX)}px`);
    fireEvent.scroll(bodyOf(container), { target: { scrollTop: m.scrollMax } });
    await waitFor(() => expect(container.querySelector('[data-row="999999"]')).not.toBeNull());
    expect(readout(container)).toContain('rows 999,996–1,000,000 of 1,000,000');
    // the rows layer stops inside the canvas: nothing invents scrollable space below the last row
    const layerTop = m.scrollMax;
    expect(rowsIn(container)).toHaveLength(m.visibleRows);
    expect(layerTop + rowsIn(container).length * SHEET_ROW_HEIGHT).toBeLessThanOrEqual(m.canvasHeight);
  });

  it('a table below the cap reaches its last row too, and the mid-scroll layer may use the room it has', async () => {
    const { data } = fakeData({ count: 400 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(readout(container)).toContain('of 400'));
    const m = metricsFor(400);
    fireEvent.scroll(bodyOf(container), { target: { scrollTop: m.scrollMax } });
    await waitFor(() => expect(container.querySelector('[data-row="399"]')).not.toBeNull());
    expect(rowsIn(container)).toHaveLength(m.visibleRows);
    fireEvent.scroll(bodyOf(container), { target: { scrollTop: scrollForRow(100, m) } });
    await waitFor(() => expect(readout(container)).toContain('rows 101–'));
    expect(rowsIn(container).length).toBeGreaterThan(m.visibleRows); // room to spare: the overscan is drawn
  });

  it('a refused window keeps the rows already on screen — with the version they were read at — and says the sentence', async () => {
    let refusal: string | null = null;
    const base = fakeData({ count: 8 }).data;
    const data: SheetData = { ...base, rows: (w) => (refusal === null ? base.rows(w) : Promise.resolve({ ok: false, reason: 'engine', rejected: refusal })) };
    const { container, rerender } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    refusal = 'the memory engine could not read this window';
    rerender(<Sheet data={data} height={HEIGHT} version="v1" cursor="c2" />);
    await waitFor(() => expect(said(container)).toContain('could not read this window'));
    expect(rowsIn(container)).toHaveLength(8); // the old rows stay, labelled with their version
    expect(readout(container)).toContain('version v1');
  });

  it('a window the scroll already left behind is dropped, never painted over the newer one', async () => {
    let release: ((w: SheetWindow) => void) | null = null;
    let calls = 0;
    const answer = (count: number, id: string): SheetWindow => ({ ok: true, columns: ['cases', 'jurisdiction'], rows: [{ cases: 1, jurisdiction: id }], rowIds: [id], positional: false, key: 'jurisdiction', count, start: 0, version: 'v1', cursor: 'c1' });
    const slow: SheetData = {
      capabilities: { sort: true, countKnown: true, edit: false },
      columns: () => Promise.resolve(FACETS),
      rows: () => {
        calls += 1;
        return calls === 1 ? new Promise<SheetWindow>((resolve) => { release = resolve; }) : Promise.resolve(answer(500, 'later'));
      },
    };
    const { container, rerender } = render(<Sheet data={slow} height={HEIGHT} viewId="a" />);
    await waitFor(() => expect(release).not.toBeNull());
    rerender(<Sheet data={slow} height={HEIGHT} viewId="b" />); // the question moved on before the first answer came back
    await waitFor(() => expect(readout(container)).toContain('rows 1–1 of 500'));
    release!(answer(5, 'stale'));
    await new Promise((r) => setTimeout(r, 0));
    expect(readout(container)).toContain('of 500'); // the late answer never lands
    expect(said(container)).toBe(''); // and it is not something to tell a person about
  });

  it('a host one poll behind is NOT refused: the answer applies, and the caught-up prop is a cache hit', async () => {
    const { data, asked } = fakeData({ count: 8, cursor: 'c2' }); // the engine is already at c2
    const { container, rerender } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    expect(said(container)).toBe(''); // no refusal for a prop that is one poll behind
    rerender(<Sheet data={data} height={HEIGHT} version="v1" cursor="c2" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    expect(asked).toHaveLength(1); // the blocks already wear c2: nothing to ask
  });

  it('a wire that named fewer rows than it sent still renders every row', async () => {
    const { data } = fakeData({ count: 4, shortIds: true });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(4));
  });

  it('a column the facets never mentioned is shown as an unknown type rather than left out', async () => {
    const { data } = fakeData({ count: 2, key: null, columns: ['cases', 'jurisdiction', 'note'], facets: [{ name: 'cases', type: 'number' }] });
    const { container } = render(<Sheet data={data} height={HEIGHT} />);
    await waitFor(() => expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(3));
    const heads = [...container.querySelectorAll('[role="columnheader"]')].map((el) => `${el.getAttribute('data-column')!}:${el.querySelector('.vzf-sheet-type')!.textContent!}`);
    expect(heads).toEqual(['cases:number', 'jurisdiction:unknown', 'note:unknown']); // no key named → the engine's first column leads
    expect(cells(container)[2]).toBe(''); // a null cell is blank
  });

  it('the header is carried sideways with the rows — a wide table\'s names stay over their own columns', async () => {
    const { data } = fakeData({ count: 40 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    fireEvent.scroll(bodyOf(container), { target: { scrollLeft: 240, scrollTop: 0 } });
    expect(container.querySelector<HTMLElement>('.vzf-sheet-head')!.scrollLeft).toBe(240);
  });

  it('measures the box it was given when the host names no height, and follows it as it changes', async () => {
    const observers: { readonly cb: () => void; disconnected: boolean }[] = [];
    class FakeResizeObserver {
      constructor(private readonly cb: () => void) {
        observers.push({ cb, disconnected: false });
      }
      observe(): void {
        /* the fake calls back by hand */
      }
      disconnect(): void {
        observers[observers.length - 1]!.disconnected = true;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let boxHeight = HEIGHT;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: boxHeight, width: 600, top: 0, left: 0, right: 600, bottom: boxHeight, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    const { data } = fakeData({ count: 400 });
    const { container, unmount } = render(<Sheet data={data} version="v1" cursor="c1" />);
    await waitFor(() => expect(bodyOf(container).getAttribute('style')).toContain(`height: ${String(BODY_HEIGHT)}px`));
    boxHeight = 400;
    observers[0]!.cb();
    await waitFor(() => expect(bodyOf(container).getAttribute('style')).toContain(`height: ${String(400 - SHEET_BORDERS - SHEET_ROW_HEIGHT - SHEET_STATUS_HEIGHT)}px`));
    unmount();
    expect(observers[0]!.disconnected).toBe(true);
  });

  it('a host without a ResizeObserver keeps the first measurement rather than showing nothing', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: HEIGHT, width: 600, top: 0, left: 0, right: 600, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const { data } = fakeData({ count: 400 });
    const { container } = render(<Sheet data={data} version="v1" cursor="c1" />);
    await waitFor(() => expect(bodyOf(container).getAttribute('style')).toContain(`height: ${String(BODY_HEIGHT)}px`));
  });
});

describe('<Sheet> — when the data layer breaks', () => {
  it('a schema that throws is said in words, not swallowed', async () => {
    const { data } = fakeData({ count: 4 });
    const broken: SheetData = { ...data, columns: () => Promise.reject(new Error('no schema here')) };
    const { container } = render(<Sheet data={broken} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(said(container)).toContain('the columns could not be read: no schema here'));
  });

  it('a schema that throws something that is not an Error still says what it was', async () => {
    const { data } = fakeData({ count: 4 });
    const odd: SheetData = { ...data, columns: () => Promise.reject('the worker went away') }; // eslint-disable-line prefer-promise-reject-errors -- a data layer may reject with anything
    const { container } = render(<Sheet data={odd} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(said(container)).toContain('the columns could not be read: the worker went away'));
  });

  it('a break that lands after the sheet is gone is dropped — neither door writes to a component nobody is looking at', async () => {
    let breakSchema: ((why: unknown) => void) | null = null;
    let breakRows: ((why: unknown) => void) | null = null;
    const { data } = fakeData({ count: 4 });
    const slow: SheetData = {
      ...data,
      columns: () => new Promise((_resolve, reject) => { breakSchema = reject; }),
      rows: () => new Promise((_resolve, reject) => { breakRows = reject; }),
    };
    const { unmount } = render(<Sheet data={slow} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(breakRows).not.toBeNull());
    unmount();
    breakSchema!(new Error('too late'));
    breakRows!(new Error('too late'));
    await new Promise((r) => setTimeout(r, 0)); // no warning, no state on an unmounted sheet
  });

  it('a window layer that THROWS is said in words — the grid never freezes on a rejected promise', async () => {
    const { data } = fakeData({ count: 4 });
    const broken: SheetData = {
      ...data,
      rows: () => {
        throw new Error('kaboom');
      },
    };
    const { container } = render(<Sheet data={broken} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(said(container)).toContain('the data layer threw: kaboom'));
    const odd: SheetData = { ...data, rows: () => Promise.reject('gone') }; // eslint-disable-line prefer-promise-reject-errors -- a data layer may reject with anything
    const second = render(<Sheet data={odd} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(said(second.container)).toContain('the data layer threw: gone'));
  });
});

describe('<Sheet> — sorting', () => {
  it('the header toggle walks none → ↑ → ↓ → none and each turn is one new window', async () => {
    const { data, asked } = fakeData({ count: 8 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(asked).toHaveLength(1));
    const button = container.querySelector('[data-column="cases"] button')!;
    expect(button.getAttribute('aria-label')).toBe('sort by cases');
    fireEvent.click(button);
    await waitFor(() => expect(readout(container)).toContain('sorted by cases ↑'));
    expect(container.querySelector('[data-column="cases"]')!.getAttribute('aria-sort')).toBe('ascending');
    expect(asked[1]!.sort).toEqual([{ field: 'cases', dir: 'asc' }]);
    fireEvent.click(container.querySelector('[data-column="cases"] button')!);
    await waitFor(() => expect(readout(container)).toContain('sorted by cases ↓'));
    expect(container.querySelector('[data-column="cases"]')!.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(container.querySelector('[data-column="cases"] button')!);
    await waitFor(() => expect(readout(container)).not.toContain('sorted by'));
    expect(container.querySelector('[data-column="cases"]')!.getAttribute('aria-sort')).toBe('none');
  });

  it('an engine that REFUSES a sort takes the sort back AND is remembered — the explanation never flashes and vanishes', async () => {
    const base = fakeData({ count: 8 });
    // this door serves unsorted windows happily and refuses every sorted one
    const data: SheetData = { ...base.data, rows: (w) => (w.sort === undefined ? base.data.rows(w) : Promise.resolve({ ok: false, reason: 'unsupported-sort', rejected: 'the wasm engine cannot sort. Ask for this window without a sort' })) };
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    fireEvent.click(container.querySelector('[data-column="cases"] button')!);
    await waitFor(() => expect(said(container)).toContain('cannot sort'));
    // the sort is taken back, so the next window is a good one — and the sentence survives it
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    expect(said(container)).toContain('the wasm engine cannot sort');
    expect(readout(container)).not.toContain('sorted by');
    expect(container.querySelector('[data-column="cases"]')!.getAttribute('aria-sort')).toBe('none');
    // and from now on there is no toggle at all: the header carries the reason instead
    expect(container.querySelector('[role="columnheader"] button')).toBeNull();
    expect(container.querySelector('.vzf-sheet-cannot')!.textContent).toBe('the wasm engine cannot sort. Ask for this window without a sort');
  });

  it('an engine that cannot sort at all gets no toggle — the header carries its refusal as readable text', async () => {
    const { data, asked } = fakeData({ count: 4, sort: false });
    const { container } = render(<Sheet data={data} height={HEIGHT} />);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(container.querySelector('[role="columnheader"] button')).toBeNull();
    expect(container.querySelector('.vzf-sheet-cannot')!.textContent).toBe('the wasm engine cannot sort');
    // the header takes a second line for the sentence, out of the sheet's own height
    expect(bodyOf(container).getAttribute('style')).toContain(`height: ${String(HEIGHT - SHEET_BORDERS - SHEET_ROW_HEIGHT * 2 - SHEET_STATUS_HEIGHT)}px`);
  });

  it('a port that says it cannot sort without saying why still says something', async () => {
    const { data } = fakeData({ count: 2 });
    const mute: SheetData = { ...data, capabilities: { sort: false, countKnown: true, edit: false } };
    const { container } = render(<Sheet data={mute} height={HEIGHT} />);
    await waitFor(() => expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(2));
    expect(container.querySelector('.vzf-sheet-cannot')!.textContent).toBe('this engine cannot sort');
  });
});

describe('<Sheet> — the keyboard', () => {
  it('the arrows, Home/End and the page keys move the focused cell, and the scroll follows it', async () => {
    const { data } = fakeData({ count: 500 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    const grid = container.querySelector('[role="grid"]')!;
    const focused = (): string => {
      const cell = container.querySelector('[data-vzf-focused="true"]');
      return `${cell?.closest('[role="row"]')?.getAttribute('data-row') ?? '?'}:${cell?.getAttribute('data-column') ?? '?'}`;
    };
    expect(focused()).toBe('0:jurisdiction');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(focused()).toBe('1:jurisdiction');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(focused()).toBe('1:cases');
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(focused()).toBe('1:jurisdiction');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(focused()).toBe('1:cases');
    expect(document.activeElement!.getAttribute('data-column')).toBe('cases'); // the DOM focus follows the grid's
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(focused()).toBe('0:jurisdiction');
    fireEvent.keyDown(grid, { key: 'ArrowUp' }); // never before the first row
    expect(focused()).toBe('0:jurisdiction');
    fireEvent.keyDown(grid, { key: 'PageDown' }); // a page down inside the window: the scroll does not move
    expect(focused()).toBe('4:jurisdiction');
    expect(readout(container)).toContain('rows 1–');
    fireEvent.keyDown(grid, { key: 'PageDown' }); // past the last visible row: the scroll follows
    await waitFor(() => expect(readout(container)).toContain('rows 5–'));
    fireEvent.keyDown(grid, { key: 'PageUp' });
    fireEvent.keyDown(grid, { key: 'PageUp' });
    await waitFor(() => expect(readout(container)).toContain('rows 1–'));
    fireEvent.keyDown(grid, { key: 'Escape' }); // a key the grid does not own is left alone
    expect(focused()).toBe('0:jurisdiction');
  });

  it('a move onto a row the window does not hold KEEPS the intent until that row arrives, then takes the focus', async () => {
    let release: (() => void) | null = null;
    const base = fakeData({ count: 500 });
    let slow = false;
    const data: SheetData = {
      ...base.data,
      rows: (w) =>
        slow
          ? new Promise((resolve) => {
              release = () => resolve(base.data.rows(w));
            })
          : base.data.rows(w),
    };
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" blockRows={8} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    slow = true;
    const grid = container.querySelector('[role="grid"]')!;
    for (let i = 0; i < 8; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(release).not.toBeNull());
    expect(container.querySelector('[data-vzf-focused="true"]')).toBeNull(); // the target row is not held yet
    release!();
    await waitFor(() => expect(container.querySelector('[data-vzf-focused="true"]')).not.toBeNull());
    const cell = container.querySelector('[data-vzf-focused="true"]')!;
    expect(document.activeElement).toBe(cell); // the intent was kept, not consumed on the render that could not honour it
    expect(cell.closest('[role="row"]')!.getAttribute('data-row')).toBe('32');
  });
});

describe('<Sheet> — a keyboard move never outlives its own ask', () => {
  it('a refused window ends the move: a later window holding that row does NOT steal the focus', async () => {
    const base = fakeData({ count: 500 });
    let mode: 'ok' | 'refuse' = 'ok';
    const data: SheetData = { ...base.data, rows: (w) => (mode === 'ok' ? base.data.rows(w) : Promise.resolve({ ok: false, reason: 'engine', rejected: 'the door is down' })) };
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const { container, rerender } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" blockRows={8} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    mode = 'refuse';
    const grid = container.querySelector('[role="grid"]')!;
    for (let i = 0; i < 8; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(said(container)).toContain('the door is down'));
    outside.focus();
    expect(document.activeElement).toBe(outside);
    mode = 'ok'; // the door comes back and a later poll brings the very rows the move named
    rerender(<Sheet data={data} height={HEIGHT} version="v1" cursor="c2" blockRows={8} />);
    await waitFor(() => expect(container.querySelector('[data-row="32"]')).not.toBeNull());
    expect(document.activeElement).toBe(outside); // the move died with its own ask
    outside.remove();
  });

  it('a pointer press elsewhere ends the move: the box a person clicked into keeps the focus', async () => {
    let release: (() => void) | null = null;
    const base = fakeData({ count: 500 });
    let slow = false;
    const data: SheetData = { ...base.data, rows: (w) => (slow ? new Promise((resolve) => { release = () => resolve(base.data.rows(w)); }) : base.data.rows(w)) };
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" blockRows={8} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    slow = true;
    const grid = container.querySelector('[role="grid"]')!;
    for (let i = 0; i < 8; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.pointerDown(outside); // the person goes to type somewhere else
    outside.focus();
    release!();
    await waitFor(() => expect(container.querySelector('[data-row="32"]')).not.toBeNull());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('focus LEAVING the grid ends the move; focus moving inside it does not', async () => {
    let release: (() => void) | null = null;
    const base = fakeData({ count: 500 });
    let slow = false;
    const data: SheetData = { ...base.data, rows: (w) => (slow ? new Promise((resolve) => { release = () => resolve(base.data.rows(w)); }) : base.data.rows(w)) };
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" blockRows={8} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    const grid = container.querySelector('[role="grid"]')!;
    slow = true;
    for (let i = 0; i < 8; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(release).not.toBeNull());
    // a focusout that names nothing (a row scrolled out of the DOM) and one that names a cell INSIDE keep the move
    fireEvent.focusOut(grid, { relatedTarget: null });
    fireEvent.focusOut(grid, { relatedTarget: container.querySelector('[role="gridcell"]') });
    release!();
    await waitFor(() => expect(container.querySelector('[data-row="32"]')).not.toBeNull());
    expect(document.activeElement).toBe(container.querySelector('[data-vzf-focused="true"]'));
    // now leave the grid for real while another move waits
    slow = true;
    release = null;
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.focusOut(grid, { relatedTarget: outside });
    outside.focus();
    release!();
    await waitFor(() => expect(container.querySelector('[data-row="48"]')).not.toBeNull());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a newer ask supersedes a move that has not landed yet', async () => {
    let release: (() => void) | null = null;
    const base = fakeData({ count: 500 });
    let slow = false;
    const data: SheetData = { ...base.data, rows: (w) => (slow ? new Promise((resolve) => { release = () => resolve(base.data.rows(w)); }) : base.data.rows(w)) };
    const { container, rerender } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" blockRows={8} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    slow = true;
    const grid = container.querySelector('[role="grid"]')!;
    for (let i = 0; i < 8; i++) fireEvent.keyDown(grid, { key: 'PageDown' });
    await waitFor(() => expect(release).not.toBeNull());
    rerender(<Sheet data={data} height={HEIGHT} version="v1" cursor="c2" blockRows={8} />); // a poll moves the cursor: a NEW ask
    release!();
    await waitFor(() => expect(container.querySelector('[data-row="32"]')).not.toBeNull());
    const target = container.querySelector('[data-vzf-focused="true"]');
    expect(target).not.toBeNull(); // the cell is on screen…
    expect(document.activeElement).not.toBe(target); // …but the move belonged to the ask that was superseded
  });
});

describe('<Sheet> — the doors and the refusals', () => {
  it('a row click emits a point on the declared key column, and the second click of a double-click does not', async () => {
    const onSelect = vi.fn();
    const { data } = fakeData({ count: 8 });
    const { container } = render(<Sheet data={data} height={HEIGHT} onSelect={onSelect} version="v1" cursor="c1" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    const row = container.querySelector('[data-row="2"]')!;
    fireEvent.click(row, { detail: 1 });
    expect(onSelect).toHaveBeenCalledWith('jurisdiction', 'area-2');
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(row, { detail: 2 }); // the second click of a double-click: the first one already selected
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(container.querySelector('[data-row="2"] [data-column="cases"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(said(container)).toContain('cases is a source column — the sheet is read-only in this version; annotate the row instead');
  });

  it('marks the row the session\'s own clause holds', async () => {
    const { data } = fakeData({ count: 8 });
    const { container } = render(<Sheet data={data} height={HEIGHT} version="v1" cursor="c1" selectedRowId="area-3" />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(8));
    expect(container.querySelector('[data-row="3"]')!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-row="3"]')!.classList.contains('vzf-sheet-picked')).toBe(true);
    expect(container.querySelector('[data-row="2"]')!.getAttribute('aria-selected')).toBe('false');
  });

  it('a POSITIONAL table refuses the click in words — never silently', async () => {
    const onSelect = vi.fn();
    const { data } = fakeData({ count: 4, positional: true, facets: [{ name: 'cases', type: 'number' }, { name: 'jurisdiction', type: 'string' }] });
    const { container } = render(<Sheet data={data} height={HEIGHT} onSelect={onSelect} />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(4));
    fireEvent.click(container.querySelector('[data-row="1"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(said(container)).toContain(POSITIONAL_REFUSAL);
  });

  it('a data layer that says a table is keyed but names no key says so rather than guessing a column', async () => {
    const onSelect = vi.fn();
    const { data } = fakeData({ count: 4, key: null, facets: [{ name: 'cases', type: 'number' }] });
    const { container } = render(<Sheet data={data} height={HEIGHT} onSelect={onSelect} />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(4));
    fireEvent.click(container.querySelector('[data-row="0"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(said(container)).toContain('the key column was not stated to the sheet');
  });

  it('Present mode and a host with no select door both close it — the rows stay', async () => {
    const onSelect = vi.fn();
    const { data } = fakeData({ count: 4 });
    const { container, rerender } = render(<Sheet data={data} height={HEIGHT} onSelect={onSelect} readOnly />);
    await waitFor(() => expect(rowsIn(container)).toHaveLength(4));
    expect(container.querySelector('.vzf-sheet-pickable')).toBeNull();
    fireEvent.click(container.querySelector('[data-row="0"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<Sheet data={data} height={HEIGHT} />);
    await waitFor(() => expect(container.querySelector('.vzf-sheet-pickable')).toBeNull());
  });

  it('a host that names the columns asks for those, and nothing else', async () => {
    const { data, asked } = fakeData({ count: 4, columns: ['cases'], key: null });
    const { container } = render(<Sheet data={data} height={HEIGHT} columns={['cases']} version="v1" cursor="c1" />);
    await waitFor(() => expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(1));
    expect(asked[0]!.columns).toEqual(['cases']);
  });

  it('a schema that lands after the sheet is gone is dropped, not set on a component nobody is looking at', async () => {
    let release: ((cols: readonly SheetColumn[]) => void) | null = null;
    const { data } = fakeData({ count: 2 });
    const slowSchema: SheetData = { ...data, columns: () => new Promise((resolve) => { release = resolve; }) };
    const { unmount } = render(<Sheet data={slowSchema} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(release).not.toBeNull());
    unmount();
    release!(FACETS);
    await new Promise((r) => setTimeout(r, 0)); // no warning, no state on an unmounted sheet
  });

  it('a window that lands after the sheet is gone is dropped too', async () => {
    let release: ((w: SheetWindow) => void) | null = null;
    const { data } = fakeData({ count: 2 });
    const slow: SheetData = { ...data, rows: () => new Promise((resolve) => { release = resolve; }) };
    const { unmount } = render(<Sheet data={slow} height={HEIGHT} version="v1" cursor="c1" />);
    await waitFor(() => expect(release).not.toBeNull());
    unmount();
    release!({ ok: true, columns: ['cases'], rows: [], rowIds: [], positional: true, count: 0, start: 0, version: 'v1', cursor: 'c1' });
    await new Promise((r) => setTimeout(r, 0));
  });

  it('a sheet given almost no height still keeps one row and its readout', async () => {
    const { data } = fakeData({ count: 4, facets: [] });
    const { container } = render(<Sheet data={data} height={10} rowHeight={SHEET_ROW_HEIGHT} canvasMax={5000} />);
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0));
    expect(bodyOf(container).getAttribute('style')).toContain('height: 28px');
  });
});
