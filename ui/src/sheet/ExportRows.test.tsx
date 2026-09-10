// @vitest-environment jsdom
/**
 * Copy and export are READS. Nothing here asserts a commit, because the door
 * lands none — what it asserts instead is that the sentence says what will
 * leave BEFORE anything leaves, and that what left carries its address.
 *
 * The four things this file owns are the four things pinned: which format is
 * chosen, whether a walk is in flight, where the files go, and the last
 * sentence said. The walk, the quoting, the ceiling and the receipt are the
 * library's, pinned in `src/session/export.test.ts`.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import {
  ExportRows,
  clipboardRefusal,
  downloadFiles,
  sheetAsk,
  writeClipboard,
  EXPORT_ROWS_HINT,
  EXPORT_ROWS_READING,
  NO_CLIPBOARD,
  type ExportFile,
} from './index.js';
import type { SheetData, SheetRefusal, SheetWindow, SheetWindowRequest } from './types.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A port over `count` rows: one column, one number per row, a version and a cursor. */
function fakePort(
  count: number,
  over: { readonly refuse?: SheetRefusal; readonly throwOn?: number; readonly version?: string | null } = {},
): { readonly data: SheetData; readonly asked: SheetWindowRequest[] } {
  const asked: SheetWindowRequest[] = [];
  return {
    asked,
    data: {
      capabilities: { sort: true, countKnown: true, edit: false },
      columns: () => Promise.resolve([{ name: 'n', type: 'number' as const }]),
      rows: (window: SheetWindowRequest): Promise<SheetWindow | SheetRefusal> => {
        asked.push(window);
        // the probe is call 0; a refusal or a throw is aimed at a WALK page, so it starts at 1
        if (over.throwOn === asked.length) return Promise.reject(new Error('the socket closed'));
        if (over.refuse !== undefined && asked.length > 1) return Promise.resolve(over.refuse);
        const rows = Array.from({ length: Math.max(0, Math.min(window.limit, count - window.offset)) }, (_, i) => ({ n: window.offset + i }));
        return Promise.resolve({
          ok: true,
          columns: ['n'],
          rows,
          rowIds: rows.map((r) => String(r.n)),
          positional: true,
          count,
          start: window.offset,
          version: over.version === undefined ? '12' : over.version,
          cursor: 's7',
          clauses: [],
        });
      },
    },
  };
}

const offer = (container: HTMLElement): string => (container.querySelector('[data-vzf="export-offer"]') as HTMLElement).textContent ?? '';
const said = (container: HTMLElement): string => (container.querySelector('.vzf-export-said') as HTMLElement).textContent ?? '';
const press = (container: HTMLElement, which: 'download' | 'copy'): void => {
  fireEvent.click(container.querySelector(`[data-vzf="export-${which}"]`) as HTMLButtonElement);
};

describe('ExportRows — the sentence before the click', () => {
  it('says how many rows, in what format, and where they read — before anything leaves', async () => {
    const { data, asked } = fakePort(2431);
    const { container } = render(<ExportRows data={data} table="cells" />);
    expect(offer(container)).toBe(EXPORT_ROWS_READING);
    await waitFor(() =>
      expect(offer(container)).toBe('Download 2,431 rows as CSV, as they read at version 12 — with the receipt that names the cursor'),
    );
    // the count came from ONE probe window, the smallest every door answers
    expect(asked).toEqual([{ offset: 0, limit: 1 }]);
    expect(container.querySelector('.vzf-export-hint')?.textContent).toBe(EXPORT_ROWS_HINT);
    expect(said(container)).toBe('');
  });

  it('the offer is ANNOUNCED, not only shown: it starts in the DOM and is replaced in a live region', async () => {
    const { data } = fakePort(4);
    const { container } = render(<ExportRows data={data} table="cells" />);
    const sentence = container.querySelector('[data-vzf="export-offer"]') as HTMLElement;
    // the sentence a person reads BEFORE the click changes after mount — by the count,
    // or by the port's refusal — so a reader who is not watching still hears the answer
    expect(sentence.getAttribute('role')).toBe('status');
    expect(sentence.getAttribute('aria-live')).toBe('polite');
    expect(sentence.textContent).toBe(EXPORT_ROWS_READING);
    // and the sentence for what LEFT is its own live region, as `AddColumn`'s is
    const after = container.querySelector('.vzf-export-said') as HTMLElement;
    expect([after.getAttribute('role'), after.getAttribute('aria-live')]).toEqual(['status', 'polite']);
    await waitFor(() => expect(offer(container)).toContain('4 rows'));
  });

  it('follows the format choice, and names the cursor instead of a version when the table has none', async () => {
    const { data } = fakePort(3, { version: null });
    const { container } = render(<ExportRows data={data} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('as they read at this cursor'));
    fireEvent.change(container.querySelector('.vzf-export-format') as HTMLSelectElement, { target: { value: 'tsv' } });
    expect(offer(container)).toBe('Download 3 rows as TSV, as they read at this cursor — with the receipt that names the cursor');
  });

  it('says the ceiling out loud when it bites — the first N of the count, never a silent N', async () => {
    const { data } = fakePort(1_285_614);
    const { container } = render(<ExportRows data={data} table="cells" rowCeiling={200_000} />);
    await waitFor(() => expect(offer(container)).toContain('the first 200,000 of 1,285,614 rows'));
  });

  it('a port that refuses the probe leaves the refusal on screen and both doors shut', async () => {
    const { data } = fakePort(5, { refuse: { ok: false, reason: 'unknown-table', rejected: 'no table "cells" here' } });
    // the probe is call 1, so aim the refusal at it by refusing everything
    const always: SheetData = { ...data, rows: () => Promise.resolve({ ok: false, reason: 'unknown-table', rejected: 'no table "cells" here' }) };
    const { container } = render(<ExportRows data={always} table="cells" />);
    await waitFor(() => expect(offer(container)).toBe('no table "cells" here'));
    expect((container.querySelector('[data-vzf="export-download"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-vzf="export-copy"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a probe that lands after the form is gone is dropped, not set on a component nobody is looking at', async () => {
    const { data } = fakePort(4);
    const view = render(<ExportRows data={data} table="cells" />);
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[data-vzf="export-rows"]')).toBeNull();
  });
});

describe('ExportRows — download', () => {
  it('delivers two files: the rows, and the receipt whose cursor names where they were read', async () => {
    const { data, asked } = fakePort(7);
    const delivered: ExportFile[][] = [];
    const { container } = render(
      <ExportRows data={data} table="cells" viewId="sheet" columns={['n']} sort={[{ field: 'n', dir: 'desc' }]} onDeliver={(files) => delivered.push([...files])} />,
    );
    await waitFor(() => expect(offer(container)).toContain('7 rows'));
    press(container, 'download');
    await waitFor(() => expect(said(container)).toBe('downloaded cells.csv and cells.receipt.json (7 rows)'));

    const [body, receipt] = delivered[0] ?? [];
    expect(body?.name).toBe('cells.csv');
    expect(body?.type).toBe('text/csv;charset=utf-8');
    expect(body?.text.split('\n')).toEqual(['n', '0', '1', '2', '3', '4', '5', '6']);
    expect(receipt?.name).toBe('cells.receipt.json');
    expect(receipt?.type).toBe('application/json');
    const read = JSON.parse(receipt?.text ?? '{}') as Record<string, unknown>;
    expect(read).toMatchObject({
      kind: 'vizfootprint-export',
      table: 'cells',
      viewId: 'sheet',
      version: '12',
      cursor: 's7',
      sort: [{ field: 'n', dir: 'desc' }],
      columns: ['n'],
      count: 7,
      exported: { start: 0, rows: 7 },
      truncated: false,
      clauses: [],
    });
    // the walk asked through the SAME port, carrying the view, the projection and the order
    expect(asked[1]).toMatchObject({ viewId: 'sheet', columns: ['n'], sort: [{ field: 'n', dir: 'desc' }], offset: 0 });
  });

  it('a walk in flight says nothing about the LAST walk — the delivered sentence is cleared when the next one starts', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { data, asked } = fakePort(2);
    let slowly = false;
    const slow: SheetData = { ...data, rows: async (window) => { if (slowly) await gate; return data.rows(window); } };
    const { container } = render(<ExportRows data={slow} table="cells" onDeliver={() => undefined} />);
    await waitFor(() => expect(offer(container)).toContain('2 rows'));
    press(container, 'download');
    await waitFor(() => expect(said(container)).toBe('downloaded cells.csv and cells.receipt.json (2 rows)'));

    slowly = true;
    press(container, 'copy'); // a second walk: the first one's sentence is no longer the truth
    await waitFor(() => expect(said(container)).toBe(''));
    release();
    await waitFor(() => expect(said(container)).toContain('the browser refused the clipboard'));
    expect(asked.length).toBeGreaterThan(2);
  });

  it('a refused page refuses the whole export, in the port’s own words — and no file is delivered', async () => {
    const { data } = fakePort(9, { refuse: { ok: false, reason: 'engine', rejected: 'the engine gave up' } });
    const delivered: ExportFile[][] = [];
    const { container } = render(<ExportRows data={data} table="cells" onDeliver={(files) => delivered.push([...files])} />);
    await waitFor(() => expect(offer(container)).toContain('9 rows'));
    press(container, 'download');
    await waitFor(() => expect(said(container)).toBe('the engine gave up'));
    expect(container.querySelector('.vzf-export-refused')).not.toBeNull();
    expect(delivered).toEqual([]);
  });

  it('a port that THROWS mid-walk is a refusal with what it threw, never a form frozen on a rejected promise', async () => {
    const { data } = fakePort(5, { throwOn: 2 });
    const { container } = render(<ExportRows data={data} table="cells" onDeliver={() => undefined} />);
    await waitFor(() => expect(offer(container)).toContain('5 rows'));
    press(container, 'download');
    await waitFor(() => expect(said(container)).toBe('the data layer threw: the socket closed'));
  });

  it('shows the walk in flight, and will not send a second one while it runs', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { data, asked } = fakePort(3);
    const slow: SheetData = {
      ...data,
      rows: async (window) => {
        if (asked.length > 0) await gate; // the probe rides through; the walk waits
        return data.rows(window);
      },
    };
    const { container } = render(<ExportRows data={slow} table="cells" onDeliver={() => undefined} />);
    await waitFor(() => expect(offer(container)).toContain('3 rows'));
    press(container, 'download');
    await waitFor(() => expect(container.querySelector('[data-vzf="export-download"]')?.textContent).toBe('downloading…'));
    expect((container.querySelector('[data-vzf="export-copy"]') as HTMLButtonElement).disabled).toBe(true);
    press(container, 'download'); // pressed again mid-flight: the button is disabled, so nothing new is asked
    release();
    await waitFor(() => expect(said(container)).toContain('downloaded cells.csv'));
  });
});

describe('ExportRows — copy', () => {
  it('copies TSV whatever the download format is, and says how many rows went', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } });
    const { data } = fakePort(3);
    const { container } = render(<ExportRows data={data} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('3 rows'));
    press(container, 'copy');
    await waitFor(() => expect(said(container)).toBe('copied 3 rows as TSV'));
    expect(written).toEqual(['n\n0\n1\n2']);
    expect(container.querySelector('.vzf-export-refused')).toBeNull();
  });

  it('shows the copy in flight', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    const { data, asked } = fakePort(2);
    const slow: SheetData = { ...data, rows: async (window) => { if (asked.length > 0) await gate; return data.rows(window); } };
    const { container } = render(<ExportRows data={slow} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('2 rows'));
    press(container, 'copy');
    await waitFor(() => expect(container.querySelector('[data-vzf="export-copy"]')?.textContent).toBe('copying…'));
    release();
    await waitFor(() => expect(said(container)).toBe('copied 2 rows as TSV'));
  });

  it('a browser that REFUSES the clipboard says so in the browser’s own words', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('document is not focused')) } });
    const { data } = fakePort(3);
    const { container } = render(<ExportRows data={data} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('3 rows'));
    press(container, 'copy');
    await waitFor(() => expect(said(container)).toBe('the browser refused the clipboard: document is not focused'));
  });

  it('a clipboard that rejects with something that is not an Error is still said in words', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors -- a browser may reject with anything
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject('the permission prompt closed') } });
    const { data } = fakePort(1);
    const { container } = render(<ExportRows data={data} table="cells" className="beside-the-grid" />);
    await waitFor(() => expect(offer(container)).toContain('Download 1 row as CSV'));
    // the host's class rides along with the library's own
    expect(container.querySelector('[data-vzf="export-rows"]')?.className).toBe('vzf vzf-export beside-the-grid');
    press(container, 'copy');
    await waitFor(() => expect(said(container)).toBe('the browser refused the clipboard: the permission prompt closed'));
  });

  it('a page with NO clipboard is the same sentence — a clipboard is the user’s, not the page’s', async () => {
    const { data } = fakePort(3); // jsdom has a navigator and no clipboard on it
    const { container } = render(<ExportRows data={data} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('3 rows'));
    press(container, 'copy');
    await waitFor(() => expect(said(container)).toBe(clipboardRefusal(NO_CLIPBOARD)));
  });

  it('a refused page refuses the copy too — the clipboard is never handed half a table', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    const { data } = fakePort(9, { refuse: { ok: false, reason: 'version-moved', rejected: 'table "cells" was refreshed while the window was read — ask again' } });
    const { container } = render(<ExportRows data={data} table="cells" />);
    await waitFor(() => expect(offer(container)).toContain('9 rows'));
    press(container, 'copy');
    await waitFor(() => expect(said(container)).toContain('was refreshed while the window was read'));
  });
});

describe('writeClipboard and downloadFiles — the two deliveries', () => {
  it('a page with no navigator at all throws the same sentence as one with no clipboard', async () => {
    vi.stubGlobal('navigator', undefined);
    await expect(writeClipboard('x')).rejects.toThrow(NO_CLIPBOARD);
  });

  it('writes through a clipboard when the page has one', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } } });
    await writeClipboard('rows');
    expect(written).toEqual(['rows']);
  });

  it('saves each file through an anchor the browser treats as a download', () => {
    const made: string[] = [];
    const revoked: string[] = [];
    const clicked: { name: string; href: string }[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        made.push(blob.type);
        return `blob:${String(made.length)}`;
      },
      revokeObjectURL: (href: string) => revoked.push(href),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement): void {
      clicked.push({ name: this.download, href: this.getAttribute('href') ?? '' });
    };
    try {
      downloadFiles([
        { name: 'cells.csv', type: 'text/csv', text: 'n\n1' },
        { name: 'cells.receipt.json', type: 'application/json', text: '{}' },
      ]);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(made).toEqual(['text/csv', 'application/json']);
    expect(clicked).toEqual([
      { name: 'cells.csv', href: 'blob:1' },
      { name: 'cells.receipt.json', href: 'blob:2' },
    ]);
    expect(revoked).toEqual(['blob:1', 'blob:2']); // the anchor is gone and so is the url
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('delivers nothing where there is nothing to click — no document, and no object urls — and pretends nothing either way', () => {
    const files: readonly ExportFile[] = [{ name: 'a.csv', type: 'text/csv', text: 'n' }];
    // a page with no object urls (stubbed rather than assumed: whether the test
    // environment has `URL.createObjectURL` is the environment's business, and this
    // guard is about a page that does not)
    vi.stubGlobal('URL', {});
    expect(() => downloadFiles(files)).not.toThrow();
    // and no DOM at all — a server render, where there is no anchor to click
    vi.stubGlobal('document', undefined);
    expect(() => downloadFiles(files)).not.toThrow();
  });

  it('the default delivery is the browser’s: a download with no `onDeliver` given asks the page to save', async () => {
    const made: string[] = [];
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { made.push(b.type); return 'blob:x'; }, revokeObjectURL: () => undefined });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(): void { /* a click that saves nothing in jsdom */ };
    try {
      const { data } = fakePort(2);
      const { container } = render(<ExportRows data={data} table="cells" />);
      await waitFor(() => expect(offer(container)).toContain('2 rows'));
      press(container, 'download');
      await waitFor(() => expect(said(container)).toBe('downloaded cells.csv and cells.receipt.json (2 rows)'));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(made).toEqual(['text/csv;charset=utf-8', 'application/json']);
  });
});

describe('sheetAsk — the port as the library’s walk asks for it', () => {
  it('hands the window through, turns a refusal into the walk’s shape, and a throw into a sentence', async () => {
    const { data, asked } = fakePort(4);
    const answer = await sheetAsk(data, { viewId: 'sheet' })(1, 2);
    expect(answer.ok && [answer.count, answer.rows]).toEqual([4, [{ n: 1 }, { n: 2 }]]);
    expect(asked[0]).toEqual({ viewId: 'sheet', offset: 1, limit: 2 });

    const refusing: SheetData = { ...data, rows: () => Promise.resolve({ ok: false, reason: 'no-columns', rejected: 'this table has no columns here' }) };
    expect(await sheetAsk(refusing, {})(0, 1)).toEqual({ ok: false, reason: 'no-columns', rejected: 'this table has no columns here' });

    const throwing: SheetData = { ...data, rows: () => Promise.reject('the tab went away') }; // eslint-disable-line prefer-promise-reject-errors -- a port may reject with anything
    expect(await sheetAsk(throwing, {})(0, 1)).toEqual({ ok: false, reason: 'unreachable', rejected: 'the data layer threw: the tab went away' });
  });
});
