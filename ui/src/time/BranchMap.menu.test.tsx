// @vitest-environment jsdom
/**
 * BR-2's BranchMap upgrade: named lane labels from the paths state, and the
 * per-commit GLASS CONTEXT MENU (Jump here · New path here · Bring this step
 * over · Undo this step · Compare with current) with disabled-with-reason
 * honesty. Also: the menu is strictly opt-in — with no menu handlers the old
 * click-to-seek behavior is untouched — and the TimeTravelBar's new `pathPill`
 * slot renders beside the Explore/Present toggle.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { BranchMap, undoBlockReason } from './BranchMap.js';
import { TimeTravelBar } from './TimeTravelBar.js';
import { BranchPill } from '../branches/BranchPill.js';
import { emptyPaths } from '../adapter/types.js';
import type { PathView } from '../adapter/types.js';

afterEach(cleanup);

// r → a → b (head, main's tip); a → c (premium's tip). Plus analysis/test/note commits on main.
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent' } },
    { id: 'b', parent: 'a', viewId: 'analysis:corr', kind: 'point', field: 'pValue', value: 0.01, cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
  ],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);

const PATHS: readonly PathView[] = [
  { name: 'main', tip: 'b', steps: 3, lastTs: 2, active: true },
  { name: 'premium', tip: 'c', steps: 3, lastTs: 3, active: false },
  { name: 'stale', tip: 'zz', steps: 1, lastTs: 9, active: false }, // tip not in the drawn commits
];

describe('undoBlockReason — the honest not-undoable rules (mirrors src/branches planUndo)', () => {
  const base = S.commits.find((c) => c.id === 'r')!;
  it('an analysis or test cannot be un-run; a note has no prior state; a probe can be undone', () => {
    expect(undoBlockReason({ ...base, label: 'analysis' })).toContain('never refunds alpha');
    expect(undoBlockReason({ ...base, label: 'test' })).toContain('never refunds alpha');
    expect(undoBlockReason({ ...base, label: 'note' })).toContain('no earlier state');
    expect(undoBlockReason({ ...base, label: 'price' })).toBeNull();
  });
});

describe('BranchMap — named lane labels', () => {
  it('draws each path name at its tip lane, violet on the current path, and skips unknown tips', () => {
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" paths={PATHS} />);
    const labels = [...container.querySelectorAll('.vzf-bm-lane-label')];
    expect(labels.map((l) => l.getAttribute('data-lane-label'))).toEqual(['main', 'premium']); // 'stale' filtered
    const main = container.querySelector('[data-lane-label="main"]')!;
    const premium = container.querySelector('[data-lane-label="premium"]')!;
    expect(main.classList.contains('vzf-active')).toBe(true);
    expect(premium.classList.contains('vzf-active')).toBe(false);
    // labels sit at their tip's lane row: main on lane 0 (active, top), premium below
    expect(Number(main.getAttribute('y'))).toBeLessThan(Number(premium.getAttribute('y')));
  });

  it('without paths the map draws exactly as before (no labels, no extra width)', () => {
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" />);
    expect(container.querySelectorAll('.vzf-bm-lane-label')).toHaveLength(0);
  });
});

describe('BranchMap — the per-commit glass context menu (opt-in)', () => {
  function renderWithMenu(overrides: Partial<Parameters<typeof BranchMap>[0]> = {}) {
    const handlers = { onSeek: vi.fn(), onNewPath: vi.fn(), onBringOver: vi.fn(), onUndo: vi.fn(), onCompare: vi.fn() };
    const utils = render(<BranchMap commits={S.commits} cursor="b" head="b" paths={PATHS} {...handlers} {...overrides} />);
    return { ...utils, handlers };
  }

  it('with NO menu handlers a node click still seeks directly (pre-BR-2 behavior intact)', () => {
    const onSeek = vi.fn();
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" onSeek={onSeek} />);
    const node = container.querySelector('[data-commit="a"]')!;
    expect(node.getAttribute('aria-label')).toContain('seek to');
    expect(node.getAttribute('aria-haspopup')).toBeNull();
    fireEvent.click(node);
    expect(onSeek).toHaveBeenCalledWith('a');
    expect(container.querySelector('[data-vzf="ctx-menu"]')).toBeNull();
  });

  it('clicking a node opens the menu (head: id + label + actor badge) and focuses the first item', () => {
    const { container } = renderWithMenu();
    const node = container.querySelector('[data-commit="a"]')!;
    expect(node.getAttribute('aria-haspopup')).toBe('menu');
    expect(node.getAttribute('aria-label')).toContain('actions for');
    fireEvent.click(node);
    const menu = container.querySelector('[data-vzf="ctx-menu"]')!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.querySelector('.vzf-ctx-head')?.textContent).toContain('#a');
    expect(menu.querySelector('.vzf-ctx-head .vzf-badge')?.textContent).toBe('agent');
    expect(document.activeElement).toBe(menu.querySelector('button:not([disabled])'));
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('data-ctx'))).toEqual([
      'jump',
      'new-path',
      'bring-over',
      'undo',
      'compare',
    ]);
  });

  it('keyboard: Enter (or Space) on a node opens the menu too', () => {
    const { container } = renderWithMenu();
    fireEvent.keyDown(container.querySelector('[data-commit="a"]')!, { key: 'Enter' });
    expect(container.querySelector('[data-vzf="ctx-menu"]')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('[data-vzf="ctx-menu"]')!, { key: 'Escape' });
    expect(container.querySelector('[data-vzf="ctx-menu"]')).toBeNull();
    fireEvent.keyDown(container.querySelector('[data-commit="a"]')!, { key: ' ' });
    expect(container.querySelector('[data-vzf="ctx-menu"]')).not.toBeNull();
    // any other key is inert on both the node and the menu
    fireEvent.keyDown(container.querySelector('[data-vzf="ctx-menu"]')!, { key: 'x' });
    expect(container.querySelector('[data-vzf="ctx-menu"]')).not.toBeNull();
  });

  it('each action routes through its handler and closes the menu', () => {
    const { container, handlers } = renderWithMenu();
    const openAndPick = (commit: string, ctx: string): void => {
      fireEvent.click(container.querySelector(`[data-commit="${commit}"]`)!);
      fireEvent.click(container.querySelector(`[data-ctx="${ctx}"]`)!);
      expect(container.querySelector('[data-vzf="ctx-menu"]')).toBeNull();
    };
    openAndPick('a', 'jump');
    expect(handlers.onSeek).toHaveBeenCalledWith('a');
    openAndPick('a', 'new-path');
    expect(handlers.onNewPath).toHaveBeenCalledWith('a');
    openAndPick('c', 'bring-over');
    expect(handlers.onBringOver).toHaveBeenCalledWith('c');
    openAndPick('a', 'undo');
    expect(handlers.onUndo).toHaveBeenCalledWith('a');
    openAndPick('c', 'compare');
    expect(handlers.onCompare).toHaveBeenCalledWith('c');
  });

  it('disabled-with-reason: jump/bring-over at the cursor, undo on an analysis commit', () => {
    const { container } = renderWithMenu();
    fireEvent.click(container.querySelector('[data-commit="b"]')!); // b IS the cursor and a test commit
    const jump = container.querySelector('[data-ctx="jump"]') as HTMLButtonElement;
    const bring = container.querySelector('[data-ctx="bring-over"]') as HTMLButtonElement;
    const undo = container.querySelector('[data-ctx="undo"]') as HTMLButtonElement;
    expect(jump.disabled).toBe(true);
    expect(jump.title).toBe('you are already here');
    expect(bring.disabled).toBe(true);
    expect(bring.title).toBe('this step is already where you are');
    expect(undo.disabled).toBe(true);
    expect(undo.title).toContain('never refunds alpha');
    expect(undo.querySelector('.vzf-ctx-reason')?.textContent).toContain('never refunds alpha');
    // the first ENABLED item took focus instead
    expect(document.activeElement).toBe(container.querySelector('[data-ctx="new-path"]'));
  });

  it('a partial handler set shows only its items (e.g. compare-only, no seek)', () => {
    const onCompare = vi.fn();
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" onCompare={onCompare} />);
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    expect([...container.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('data-ctx'))).toEqual(['compare']);
  });

  it('the complementary partial set (new-path only) hides compare and the rest', () => {
    const onNewPath = vi.fn();
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" onNewPath={onNewPath} />);
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    expect([...container.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('data-ctx'))).toEqual(['new-path']);
  });

  it('the click-away shield and Escape both close without acting', () => {
    const { container, handlers } = renderWithMenu();
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    fireEvent.click(container.querySelector('[data-vzf="ctx-shield"]')!);
    expect(container.querySelector('[data-vzf="ctx-menu"]')).toBeNull();
    expect(handlers.onSeek).not.toHaveBeenCalled();
    expect(handlers.onNewPath).not.toHaveBeenCalled();
  });
});

describe('TimeTravelBar — the pathPill slot (BR-2 cockpit integration)', () => {
  it('renders the pill beside the Explore/Present toggle', () => {
    const { container } = render(
      <TimeTravelBar
        compact
        commits={S.commits}
        cursor="b"
        head="b"
        pathPill={<BranchPill paths={{ ...emptyPaths(), current: 'main', list: [{ name: 'main', tip: 'b', steps: 3, lastTs: 2, active: true }] }} />}
      />,
    );
    const side = container.querySelector('.vzf-timebar-side')!;
    expect(side.querySelector('[data-vzf="branch-pill"]')).not.toBeNull();
    expect(side.querySelector('.vzf-mode-toggle')).not.toBeNull();
  });
});
