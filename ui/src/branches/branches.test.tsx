// @vitest-environment jsdom
/**
 * The BR-2 branching family, behaviorally: the BranchPill's three honest
 * states, the PathsModal's switch/rename/new-path loop (and its present-mode
 * pause), the CompareModal's plain-language two-column diff (incl. the honest
 * identical / rejected / no-common-start arms), and the ForkToast's
 * "only NEW auto-forks toast" journal-watching rules.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { BranchPill } from './BranchPill.js';
import { PathsModal } from './PathsModal.js';
import { CompareModal } from './CompareModal.js';
import { ForkToast } from './ForkToast.js';
import type { CompareView, PathsView, PathEventView } from '../adapter/types.js';
import { emptyPaths } from '../adapter/types.js';

afterEach(cleanup);

const TWO_PATHS: PathsView = {
  current: 'main',
  detachedAt: null,
  list: [
    { name: 'main', tip: '3', steps: 3, lastTs: 2, active: true },
    { name: 'premium', tip: '5', steps: 2, lastTs: 4, active: false },
  ],
  events: [
    { type: 'create', name: 'main', at: '1', auto: true, ts: 0 },
    { type: 'create', name: 'premium', at: '5', auto: true, ts: 1 },
  ],
};

// ── BranchPill ──────────────────────────────────────────────────────────────────

describe('BranchPill — the three honest states', () => {
  it('on a named path: violet ⎇ chip with the path name; click opens (fires onClick)', () => {
    const onClick = vi.fn();
    const { container } = render(<BranchPill paths={TWO_PATHS} onClick={onClick} className="extra" />);
    const pill = container.querySelector('[data-vzf="branch-pill"]')!;
    expect(pill.getAttribute('data-state')).toBe('on-path');
    expect(pill.textContent).toContain('main');
    expect(pill.getAttribute('title')).toContain('click to see all paths');
    expect(pill.classList.contains('extra')).toBe(true);
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('detached: the amber "viewing past" state names the commit and the auto-fork rule', () => {
    const { container } = render(<BranchPill paths={{ ...TWO_PATHS, current: null, detachedAt: '2' }} />);
    const pill = container.querySelector('[data-vzf="branch-pill"]')!;
    expect(pill.getAttribute('data-state')).toBe('viewing-past');
    expect(pill.textContent).toContain('viewing past');
    expect(pill.getAttribute('title')).toContain('#2');
    expect(pill.getAttribute('title')).toContain('starts a new path automatically');
    fireEvent.click(pill); // no onClick — must not crash
  });

  it('before any commit: the quiet empty state', () => {
    const { container } = render(<BranchPill paths={emptyPaths()} />);
    const pill = container.querySelector('[data-vzf="branch-pill"]')!;
    expect(pill.getAttribute('data-state')).toBe('empty');
    expect(pill.textContent).toContain('no paths yet');
    expect(pill.getAttribute('title')).toBe('Your first step starts the main path');
  });
});

// ── PathsModal ──────────────────────────────────────────────────────────────────

describe('PathsModal', () => {
  it('closed → renders nothing', () => {
    const { container } = render(<PathsModal open={false} onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    expect(container.querySelector('[data-vzf-modal="paths"]')).toBeNull();
  });

  it('lists paths current-first (then most recent activity), with steps + tip + current marker', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    const rows = [...container.querySelectorAll('[data-path]')].map((r) => r.getAttribute('data-path'));
    expect(rows).toEqual(['main', 'premium']); // active first despite premium's later lastTs
    const main = container.querySelector('[data-path="main"]')!;
    expect(main.querySelector('.vzf-path-current')?.textContent).toBe('● current');
    expect(main.querySelector('.vzf-path-meta')?.textContent).toContain('3 steps');
    expect(main.querySelector('.vzf-path-meta')?.textContent).toContain('#3');
    // the active row's switch is honestly disabled with the reason
    const mainBtn = main.querySelector('[data-vzf="path-switch"]') as HTMLButtonElement;
    expect(mainBtn.disabled).toBe(true);
    expect(mainBtn.title).toBe('you are on this path');
  });

  it('ties among non-current paths break by most recent activity first', () => {
    const three: PathsView = {
      ...TWO_PATHS,
      list: [
        { name: 'older', tip: '7', steps: 2, lastTs: 1, active: false },
        { name: 'main', tip: '3', steps: 3, lastTs: 2, active: true },
        { name: 'newer', tip: '9', steps: 2, lastTs: 8, active: false },
      ],
    };
    const { container } = render(<PathsModal open onClose={() => {}} paths={three} cursor="3" />);
    const rows = [...container.querySelectorAll('[data-path]')].map((r) => r.getAttribute('data-path'));
    expect(rows).toEqual(['main', 'newer', 'older']);
  });

  it('a singular path pluralizes honestly (1 step)', () => {
    const one: PathsView = { ...TWO_PATHS, list: [{ name: 'main', tip: '1', steps: 1, lastTs: 0, active: true }] };
    const { container } = render(<PathsModal open onClose={() => {}} paths={one} cursor="1" />);
    expect(container.querySelector('.vzf-path-meta')?.textContent).toContain('1 step ·');
  });

  it('clicking another path switches and closes (the intent is complete)', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<PathsModal open onClose={onClose} paths={TWO_PATHS} cursor="3" onSwitch={onSwitch} />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-switch"]')!);
    expect(onSwitch).toHaveBeenCalledWith('premium');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switching with no onSwitch wired still closes without crashing', () => {
    const onClose = vi.fn();
    const { container } = render(<PathsModal open onClose={onClose} paths={TWO_PATHS} cursor="3" />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-switch"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('inline rename: ✎ → autofocused field, Enter saves the trimmed new name', () => {
    const onRename = vi.fn();
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" onRename={onRename} />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    const input = container.querySelector('.vzf-path-rename-input') as HTMLInputElement;
    expect(input.value).toBe('premium'); // seeded with the old name
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  premium-end  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('premium', 'premium-end');
    expect(container.querySelector('.vzf-path-rename-input')).toBeNull(); // field folded away
  });

  it('rename honesty: an unchanged or empty name never fires onRename', () => {
    const onRename = vi.fn();
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" onRename={onRename} />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    let input = container.querySelector('.vzf-path-rename-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' }); // unchanged
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    input = container.querySelector('.vzf-path-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input); // blur also commits — but an empty name is a no-op
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rename without an onRename handler folds away quietly on Enter', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    const input = container.querySelector('.vzf-path-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('.vzf-path-rename-input')).toBeNull();
  });

  it('Escape in the rename field cancels the rename but keeps the modal open', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<PathsModal open onClose={onClose} paths={TWO_PATHS} cursor="3" onRename={onRename} />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    fireEvent.keyDown(container.querySelector('.vzf-path-rename-input')!, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); // stopPropagation kept the modal alive
    expect(container.querySelector('.vzf-path-rename-input')).toBeNull();
  });

  it('any other key in the rename field just types (neither saves nor cancels)', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    fireEvent.keyDown(container.querySelector('.vzf-path-rename-input')!, { key: 'a' });
    expect(container.querySelector('.vzf-path-rename-input')).not.toBeNull();
  });

  it('reopening the modal resets any in-flight rename', () => {
    const { container, rerender } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-rename"]')!);
    expect(container.querySelector('.vzf-path-rename-input')).not.toBeNull();
    rerender(<PathsModal open={false} onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    rerender(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" />);
    expect(container.querySelector('.vzf-path-rename-input')).toBeNull();
  });

  it('"New path from here" uses the cursor, fires, and closes; no cursor → disabled with the reason', () => {
    const onNewPath = vi.fn();
    const onClose = vi.fn();
    const { container, rerender } = render(
      <PathsModal open onClose={onClose} paths={TWO_PATHS} cursor="2" onNewPath={onNewPath} />,
    );
    const btn = container.querySelector('[data-vzf="path-new"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('(#2)');
    fireEvent.click(btn);
    expect(onNewPath).toHaveBeenCalledWith('2');
    expect(onClose).toHaveBeenCalled();

    rerender(<PathsModal open onClose={onClose} paths={TWO_PATHS} cursor={null} onNewPath={onNewPath} />);
    const disabled = container.querySelector('[data-vzf="path-new"]') as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.title).toContain('no steps yet');
  });

  it('"New path from here" without a handler still closes quietly', () => {
    const onClose = vi.fn();
    const { container } = render(<PathsModal open onClose={onClose} paths={TWO_PATHS} cursor="2" />);
    fireEvent.click(container.querySelector('[data-vzf="path-new"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('detached: the amber banner explains that acting starts a new path', () => {
    const detached: PathsView = { ...TWO_PATHS, current: null, detachedAt: '2' };
    const { container } = render(<PathsModal open onClose={() => {}} paths={detached} cursor="2" />);
    expect(container.querySelector('.vzf-past-banner')?.textContent).toContain('#2');
  });

  it('present mode (readOnly): viewing only — no rename, no new-path, switching paused with the reason', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={TWO_PATHS} cursor="3" readOnly />);
    expect(container.querySelector('.vzf-paths-note')?.textContent).toContain('Present mode');
    expect(container.querySelector('[data-vzf="path-rename"]')).toBeNull();
    expect(container.querySelector('[data-vzf="path-new"]')).toBeNull();
    const premium = container.querySelector('[data-path="premium"] [data-vzf="path-switch"]') as HTMLButtonElement;
    expect(premium.disabled).toBe(true);
    expect(premium.title).toBe('Present mode — switching is paused');
  });

  it('no named paths yet → the honest empty line', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={emptyPaths()} cursor={null} />);
    expect(container.querySelector('.vzf-empty')?.textContent).toContain('No named paths yet');
  });
});

// ── CompareModal ────────────────────────────────────────────────────────────────

const DIFF_OK: CompareView = {
  ok: true,
  a: { ref: 'premium', tip: '5', rows: 4 },
  b: { ref: 'main', tip: '3', rows: null },
  ancestor: '1',
  changed: [{ key: 'selection|scatter', kind: 'selection', label: 'scatter', a: 'price between 120 and 220', b: 'price between 30 and 210' }],
  onlyA: [{ key: 'analysis|correlation', kind: 'analysis', label: 'correlation', detail: 'test ran (p = 0.004)' }],
  onlyB: [],
};

describe('CompareModal', () => {
  it('closed → renders nothing and never calls onCompare', () => {
    const onCompare = vi.fn();
    const { container } = render(<CompareModal open={false} onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    expect(container.querySelector('[data-vzf-modal="compare"]')).toBeNull();
    expect(onCompare).not.toHaveBeenCalled();
  });

  it('seeds A = the other path, B = the current path, runs the compare, and renders the two-column diff', async () => {
    const onCompare = vi.fn(async () => DIFF_OK);
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    expect((container.querySelector('[data-vzf="compare-a"]') as HTMLSelectElement).value).toBe('premium');
    expect((container.querySelector('[data-vzf="compare-b"]') as HTMLSelectElement).value).toBe('main');
    await act(async () => {}); // let the compare promise land
    expect(onCompare).toHaveBeenCalledWith('premium', 'main');
    // common-ancestor line on top
    expect(container.querySelector('[data-vzf="compare-ancestor"]')?.textContent).toContain('#1');
    // per-side headers: row count, honest when unavailable
    const colA = container.querySelector('[data-side="a"]')!;
    const colB = container.querySelector('[data-side="b"]')!;
    expect(colA.querySelector('.vzf-compare-rows')?.textContent).toBe('4 rows selected');
    expect(colB.querySelector('.vzf-compare-rows')?.textContent).toBe('row count unavailable');
    // a CHANGED key shows on both sides wearing ≠ with its own per-side words
    expect(colA.querySelector('.vzf-diff-changed')?.textContent).toContain('price between 120 and 220');
    expect(colB.querySelector('.vzf-diff-changed')?.textContent).toContain('price between 30 and 210');
    // an only-A key shows only there; side B is honestly empty beyond the change
    expect(colA.textContent).toContain('correlation');
    expect(colB.textContent).not.toContain('correlation');
  });

  it('one side with nothing unique says so', async () => {
    const onCompare = vi.fn(async (): Promise<CompareView> => ({ ...DIFF_OK, changed: [], onlyA: [{ key: 'k', kind: 'encoding', label: 'scatter', detail: 'x axis shows price' }] }));
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    await act(async () => {});
    expect(container.querySelector('[data-side="b"]')?.textContent).toContain('nothing unique on this side');
    expect(container.querySelector('[data-side="a"]')?.textContent).toContain('axes');
  });

  it('an empty diff is the honest "identical since #ancestor"', async () => {
    const onCompare = vi.fn(async (): Promise<CompareView> => ({ ...DIFF_OK, changed: [], onlyA: [], onlyB: [] }));
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    await act(async () => {});
    expect(container.querySelector('[data-vzf="compare-identical"]')?.textContent).toContain('identical');
    expect(container.querySelector('[data-vzf="compare-identical"]')?.textContent).toContain('#1');
  });

  it('disjoint roots: no common start, and identical-without-ancestor omits the since', async () => {
    const onCompare = vi.fn(async (): Promise<CompareView> => ({ ...DIFF_OK, ancestor: null, changed: [], onlyA: [], onlyB: [] }));
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    await act(async () => {});
    expect(container.querySelector('[data-vzf="compare-ancestor"]')?.textContent).toBe('these positions share no common start');
    expect(container.querySelector('[data-vzf="compare-identical"]')?.textContent).not.toContain('since');
  });

  it('a rejected compare surfaces its reason — never a silent empty diff', async () => {
    const onCompare = vi.fn(async (): Promise<CompareView> => ({ ok: false, reason: 'unknown path or commit id(s): zz' }));
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    await act(async () => {});
    expect(container.querySelector('.vzf-gap-detail')?.textContent).toContain('unknown path');
  });

  it('pre-picked refs win the seeding; a commit id gets a "step #id" option and no duplicate tip', async () => {
    const onCompare = vi.fn(async (): Promise<CompareView> => ({ ...DIFF_OK, a: { ref: '4', tip: '4', rows: 2 } }));
    const { container } = render(
      <CompareModal open onClose={() => {}} paths={TWO_PATHS} initialA="4" initialB="main" onCompare={onCompare} />,
    );
    const a = container.querySelector('[data-vzf="compare-a"]') as HTMLSelectElement;
    expect(a.value).toBe('4');
    expect([...a.options].map((o) => o.textContent)).toContain('step #4');
    await act(async () => {});
    expect(onCompare).toHaveBeenCalledWith('4', 'main');
    // a commit-id side already reads "step #4" — the tip is not repeated beside it
    const headA = container.querySelector('[data-side="a"] .vzf-compare-head')!;
    expect(headA.querySelector('.vzf-compare-ref')?.textContent).toBe('step #4');
    expect(headA.querySelector('.vzf-mono')).toBeNull();
    // a named side still shows its tip id
    expect(container.querySelector('[data-side="b"] .vzf-compare-head .vzf-mono')?.textContent).toBe('#3');
  });

  it('changing either select re-runs the compare with the new refs', async () => {
    const onCompare = vi.fn(async () => DIFF_OK);
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    await act(async () => {});
    fireEvent.change(container.querySelector('[data-vzf="compare-a"]')!, { target: { value: 'main' } });
    await act(async () => {});
    expect(onCompare).toHaveBeenLastCalledWith('main', 'main');
    fireEvent.change(container.querySelector('[data-vzf="compare-b"]')!, { target: { value: 'premium' } });
    await act(async () => {});
    expect(onCompare).toHaveBeenLastCalledWith('main', 'premium');
  });

  it('with no paths and no pre-picks there is nothing to compare — it stays honestly pending', () => {
    const onCompare = vi.fn();
    const { container } = render(<CompareModal open onClose={() => {}} paths={emptyPaths()} onCompare={onCompare} />);
    expect(onCompare).not.toHaveBeenCalled();
    expect(container.querySelector('.vzf-empty')?.textContent).toBe('comparing…');
  });

  it('a compare landing after the refs changed is discarded (no stale result)', async () => {
    let release: ((v: CompareView) => void) | null = null;
    const first = new Promise<CompareView>((resolve) => {
      release = resolve;
    });
    const onCompare = vi
      .fn<(a: string, b: string) => Promise<CompareView>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(DIFF_OK);
    const { container } = render(<CompareModal open onClose={() => {}} paths={TWO_PATHS} onCompare={onCompare} />);
    // change A while the FIRST compare is still in flight → its cleanup cancels it
    fireEvent.change(container.querySelector('[data-vzf="compare-a"]')!, { target: { value: 'main' } });
    await act(async () => {
      release!({ ok: false, reason: 'stale — must never render' });
    });
    await act(async () => {});
    expect(container.textContent).not.toContain('stale — must never render');
    expect(container.querySelector('[data-vzf="compare-ancestor"]')?.textContent).toContain('#1'); // the second (fresh) result rendered
  });

  it('fallback seeding: current=null but a list flag still names the current side', () => {
    const flagged: PathsView = { ...TWO_PATHS, current: null };
    const onCompare = vi.fn(async () => DIFF_OK);
    const { container } = render(<CompareModal open onClose={() => {}} paths={flagged} onCompare={onCompare} />);
    expect((container.querySelector('[data-vzf="compare-b"]') as HTMLSelectElement).value).toBe('main');
  });

  it('fallback seeding: a single path compares with itself rather than a blank', () => {
    const single: PathsView = { ...TWO_PATHS, list: [TWO_PATHS.list[0]!] };
    const onCompare = vi.fn(async () => DIFF_OK);
    const { container } = render(<CompareModal open onClose={() => {}} paths={single} onCompare={onCompare} />);
    expect((container.querySelector('[data-vzf="compare-a"]') as HTMLSelectElement).value).toBe('main');
    expect((container.querySelector('[data-vzf="compare-b"]') as HTMLSelectElement).value).toBe('main');
  });
});

// ── ForkToast ───────────────────────────────────────────────────────────────────

const birth: PathEventView = { type: 'create', name: 'main', at: '1', auto: true, ts: 0 };
const fork = (name: string, ts: number): PathEventView => ({ type: 'create', name, at: 'x', auto: true, ts });

describe('ForkToast', () => {
  it('renders nothing until a NEW auto-fork lands in the journal', () => {
    const { container } = render(<ForkToast events={[birth]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
  });

  it('journal entries that existed at mount never toast (no replay on reload)', () => {
    const { container } = render(<ForkToast events={[birth, fork('premium', 1)]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
  });

  it('a fresh auto-fork toasts with the path name and the reassurance', () => {
    const { container, rerender } = render(<ForkToast events={[birth]} />);
    rerender(<ForkToast events={[birth, fork('premium', 1)]} />);
    const toast = container.querySelector('[data-vzf="fork-toast"]')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('Forked a new path');
    expect(toast.textContent).toContain('premium');
    expect(toast.textContent).toContain('safe in Paths');
  });

  it('the very FIRST ref creation (the default path being born) is not a fork', () => {
    const { container, rerender } = render(<ForkToast events={[]} />);
    rerender(<ForkToast events={[birth]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
  });

  it('a user-named path (auto:false) never toasts; a later real fork still does', () => {
    const named: PathEventView = { type: 'create', name: 'my-idea', at: '2', auto: false, ts: 1 };
    const { container, rerender } = render(<ForkToast events={[birth]} />);
    rerender(<ForkToast events={[birth, named]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
    rerender(<ForkToast events={[birth, named, fork('premium', 2)]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).not.toBeNull();
  });

  it('several fresh forks at once → the LATEST one shows', () => {
    const { container, rerender } = render(<ForkToast events={[birth]} />);
    rerender(<ForkToast events={[birth, fork('one', 1), fork('two', 2)]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')?.textContent).toContain('two');
  });

  it('an out-of-order journal ts (defensive wire) still baselines on the true maximum', () => {
    // ts 0 arrives AFTER ts 2 — the reduce must keep the max, not the last
    const { container, rerender } = render(
      <ForkToast events={[fork('early-high', 2), { type: 'advance', name: 'main', at: '2', ts: 0 }]} />,
    );
    rerender(<ForkToast events={[fork('early-high', 2), { type: 'advance', name: 'main', at: '2', ts: 0 }, fork('fresh', 3)]} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')?.textContent).toContain('fresh');
  });

  it('non-create journal entries (advance/switch/rename) are ignored', () => {
    const { container, rerender } = render(<ForkToast events={[birth]} />);
    rerender(
      <ForkToast
        events={[
          birth,
          { type: 'advance', name: 'main', at: '2', ts: 1 },
          { type: 'switch', to: 'main', at: '2', ts: 2 },
          { type: 'rename', from: 'main', to: 'trunk', ts: 3 },
        ]}
      />,
    );
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
  });

  it('auto-hides after autoHideMs (and cleans its timer)', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<ForkToast events={[birth]} autoHideMs={1000} />);
      rerender(<ForkToast events={[birth, fork('premium', 1)]} autoHideMs={1000} />);
      expect(container.querySelector('[data-vzf="fork-toast"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('autoHideMs 0 disables the auto-hide (it stays until dismissed)', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<ForkToast events={[birth]} autoHideMs={0} />);
      rerender(<ForkToast events={[birth, fork('premium', 1)]} autoHideMs={0} />);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(container.querySelector('[data-vzf="fork-toast"]')).not.toBeNull();
      fireEvent.click(container.querySelector('[data-vzf="fork-toast-dismiss"]')!);
      expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"See paths" opens the modal (caller callback) and dismisses; hidden when not wired', () => {
    const onOpenPaths = vi.fn();
    const { container, rerender } = render(<ForkToast events={[birth]} onOpenPaths={onOpenPaths} />);
    rerender(<ForkToast events={[birth, fork('premium', 1)]} onOpenPaths={onOpenPaths} />);
    fireEvent.click(container.querySelector('[data-vzf="fork-toast-paths"]')!);
    expect(onOpenPaths).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();

    const bare = render(<ForkToast events={[birth]} />);
    bare.rerender(<ForkToast events={[birth, fork('two', 9)]} />);
    expect(bare.container.querySelector('[data-vzf="fork-toast-paths"]')).toBeNull();
    expect(screen.getAllByLabelText('dismiss').length).toBeGreaterThan(0);
  });
});
