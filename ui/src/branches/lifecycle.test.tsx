// @vitest-environment jsdom
/**
 * TL-1 (UI tier) — the trail lifecycle in the components and the adapter:
 *
 *   1. PathsModal: an Archive button per row with an INLINE confirm that states
 *      the honesty line verbatim; the last visible path cannot be archived; a
 *      "show archived (n)" toggle reveals greyed rows with Restore; Present mode
 *      pauses all of it;
 *   2. DiscardModal: the confirm copy states "Hidden, not erased — the
 *      statistics remember." verbatim, and only the confirm button acts;
 *   3. AdoptToast: reports applied / skipped / conflicts, lists WHY on demand,
 *      and shows a refusal's reason instead of a fake success;
 *   4. BranchMap: archived lanes carry no label until revealed (their STEPS are
 *      always drawn), and the menu's two new items disable WITH the reason;
 *   5. the ADAPTER: all four actions route to the session (or POST to the
 *      documented endpoint), and `summarizeAdopt` maps an answer honestly;
 *   6. PARITY: the UI's honesty line is byte-identical to the agent's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PathsModal } from './PathsModal.js';
import { DiscardModal } from './DiscardModal.js';
import { AdoptToast } from './AdoptToast.js';
import { ForkToast } from './ForkToast.js';
import { BranchMap } from '../time/BranchMap.js';
import { createSessionView, pollingSource, mapPollState, summarizeAdopt, type RawPollState } from '../adapter/sessionView.js';
import { HIDDEN_NOT_ERASED, type AdoptSummaryView, type PathEventView, type PathsView, type PathView } from '../adapter/types.js';
import { HIDDEN_NOT_ERASED as SRC_HIDDEN_NOT_ERASED } from 'vizfootprint/agent';

afterEach(cleanup);

const PATHS: PathsView = {
  current: 'main',
  detachedAt: null,
  list: [
    { name: 'main', tip: 'b', steps: 3, lastTs: 2, active: true },
    { name: 'premium', tip: 'c', steps: 3, lastTs: 3, active: false },
  ],
  archivedList: [
    { name: 'dead-end', tip: 'z', steps: 2, lastTs: 1, active: false, archived: true },
    // a one-step archived lane — the reveal must read in the singular
    { name: 'false-start', tip: 'y', steps: 1, lastTs: 0, active: false, archived: true },
  ],
  events: [],
};

const ONE_PATH: PathsView = { ...PATHS, list: [PATHS.list[0]!], archivedList: [] };

describe('TL-1 PathsModal — archive with an inline confirm, restore behind a reveal', () => {
  it('the Archive button asks first, states the honesty line, and only "Archive" acts', () => {
    const onArchive = vi.fn();
    const { container } = render(
      <PathsModal open onClose={() => {}} paths={PATHS} cursor="b" onArchive={onArchive} onRestore={() => {}} />,
    );
    const row = container.querySelector('[data-path="premium"]')!;
    fireEvent.click(row.querySelector('[data-vzf="path-archive"]')!);
    expect(onArchive).not.toHaveBeenCalled(); // one click never hides a line of work

    const confirm = container.querySelector('[data-vzf="path-archive-confirm"]')!;
    expect(confirm.textContent).toContain(HIDDEN_NOT_ERASED);
    fireEvent.click(confirm.querySelector('[data-vzf="path-archive-no"]')!);
    expect(onArchive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-vzf="path-archive-confirm"]')).toBeNull();

    fireEvent.click(row.querySelector('[data-vzf="path-archive"]')!);
    fireEvent.click(container.querySelector('[data-vzf="path-archive-yes"]')!);
    expect(onArchive).toHaveBeenCalledWith('premium');
  });

  it('the LAST visible path cannot be archived — disabled WITH the reason', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={ONE_PATH} cursor="b" onArchive={() => {}} />);
    const btn = container.querySelector('[data-vzf="path-archive"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('only path');
  });

  it('archived rows hide behind a "show archived (n)" toggle, greyed, with Restore', () => {
    const onRestore = vi.fn();
    const { container } = render(
      <PathsModal open onClose={() => {}} paths={PATHS} cursor="b" onArchive={() => {}} onRestore={onRestore} />,
    );
    expect(container.querySelector('[data-path="dead-end"]')).toBeNull(); // hidden by default
    const toggle = container.querySelector('[data-vzf="paths-archived-toggle"]')!;
    expect(toggle.textContent).toContain('show archived (2)');

    fireEvent.click(toggle);
    expect(container.querySelector('[data-path="false-start"]')!.textContent).toContain('1 step ·');
    const row = container.querySelector('[data-path="dead-end"]')!;
    expect(row.classList.contains('vzf-archived')).toBe(true);
    expect(row.getAttribute('data-archived')).toBe('true');
    expect(row.querySelector('[data-vzf="path-switch"]')).toBeNull(); // archived is not switchable — restore first
    expect(container.querySelector('[data-vzf="paths-archived"]')!.textContent).toContain(HIDDEN_NOT_ERASED);
    fireEvent.click(row.querySelector('[data-vzf="path-restore"]')!);
    expect(onRestore).toHaveBeenCalledWith('dead-end');

    fireEvent.click(toggle); // collapses again
    expect(container.querySelector('[data-path="dead-end"]')).toBeNull();
  });

  it('Present mode pauses archive and restore (visible, honestly disabled)', () => {
    const { container } = render(
      <PathsModal open readOnly onClose={() => {}} paths={PATHS} cursor="b" onArchive={() => {}} onRestore={() => {}} />,
    );
    const archive = container.querySelector('[data-vzf="path-archive"]') as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    expect(archive.title).toContain('Present mode');
    fireEvent.click(container.querySelector('[data-vzf="paths-archived-toggle"]')!);
    const restore = container.querySelector('[data-vzf="path-restore"]') as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.title).toContain('Present mode');
  });

  it('a session with nothing archived shows no toggle at all; the archive button is opt-in', () => {
    const { container } = render(<PathsModal open onClose={() => {}} paths={{ ...PATHS, archivedList: [] }} cursor="b" />);
    expect(container.querySelector('[data-vzf="paths-archived-toggle"]')).toBeNull();
    expect(container.querySelector('[data-vzf="path-archive"]')).toBeNull(); // no onArchive handler → no button
  });

  it('a pending confirm resets when the modal is reopened (never a stale question)', () => {
    const { container, rerender } = render(
      <PathsModal open onClose={() => {}} paths={PATHS} cursor="b" onArchive={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-path="premium"] [data-vzf="path-archive"]')!);
    expect(container.querySelector('[data-vzf="path-archive-confirm"]')).not.toBeNull();
    rerender(<PathsModal open={false} onClose={() => {}} paths={PATHS} cursor="b" onArchive={() => {}} />);
    rerender(<PathsModal open onClose={() => {}} paths={PATHS} cursor="b" onArchive={() => {}} />);
    expect(container.querySelector('[data-vzf="path-archive-confirm"]')).toBeNull();
  });
});

describe('TL-1 DiscardModal — the confirm states exactly what happens', () => {
  it('renders nothing without a commit; with one, states the honesty line verbatim', () => {
    const { container } = render(<DiscardModal commitId={null} onClose={() => {}} onConfirm={() => {}} />);
    expect(container.querySelector('[data-vzf="discard-body"]')).toBeNull();

    cleanup();
    render(<DiscardModal commitId="a" stepsAfter={2} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(HIDDEN_NOT_ERASED)).toBeTruthy();
    expect(document.querySelector('[data-vzf="discard-body"]')!.textContent).toContain('2 steps after this one');
    expect(document.querySelector('[data-vzf="discard-body"]')!.textContent).toContain('never refunded');
  });

  it('Keep-everything closes without acting; Discard confirms once and closes', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<DiscardModal commitId="a" onClose={onClose} onConfirm={onConfirm} />);
    // an unknown step count stays honest: no fabricated number
    expect(document.querySelector('[data-vzf="discard-body"]')!.textContent).toContain('Everything after this step');
    fireEvent.click(document.querySelector('[data-vzf="discard-cancel"]')!);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector('[data-vzf="discard-confirm"]')!);
    expect(onConfirm).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('one step reads in the singular', () => {
    render(<DiscardModal commitId="a" stepsAfter={1} onClose={() => {}} onConfirm={() => {}} />);
    expect(document.querySelector('[data-vzf="discard-body"]')!.textContent).toContain('1 step after this one');
  });
});

describe('TL-1 AdoptToast — counts, reasons, and honest refusals', () => {
  const OK: AdoptSummaryView = { ok: true, path: 'premium', applied: 2, skipped: 1, conflicts: 1, skippedReasons: ['a chart is proposed, not replayed'] };

  it('reports what landed, what was skipped, and what overlapped; "Why skipped?" lists the reasons', () => {
    const { container } = render(<AdoptToast summary={OK} onDismiss={() => {}} autoHideMs={0} />);
    const text = container.querySelector('[data-vzf="adopt-toast"]')!.textContent!;
    expect(text).toContain('Adopted');
    expect(text).toContain('2 steps landed here');
    expect(text).toContain('1 skipped');
    expect(text).toContain('overlapped what you had already done');
    expect(text).toContain('That path is untouched.');

    expect(container.querySelector('[data-vzf="adopt-toast-reasons"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-vzf="adopt-toast-why"]')!);
    expect(container.querySelector('[data-vzf="adopt-toast-reasons"]')!.textContent).toContain('proposed, not replayed');
  });

  it('a clean run says only what happened (no skip button, singular step)', () => {
    const { container } = render(
      <AdoptToast summary={{ ok: true, path: 'premium', applied: 1, skipped: 0, conflicts: 0, skippedReasons: [] }} onDismiss={() => {}} autoHideMs={0} />,
    );
    expect(container.querySelector('[data-vzf="adopt-toast"]')!.textContent).toContain('1 step landed here');
    expect(container.querySelector('[data-vzf="adopt-toast-why"]')).toBeNull();
  });

  it('a refusal shows its REASON, never a fake success', () => {
    const { container } = render(
      <AdoptToast
        summary={{ ok: false, path: 'main', applied: 0, skipped: 0, conflicts: 0, skippedReasons: [], reason: 'that is the path you are on' }}
        onDismiss={() => {}}
        autoHideMs={0}
      />,
    );
    const toast = container.querySelector('[data-vzf="adopt-toast"]')!;
    expect(toast.getAttribute('data-ok')).toBe('false');
    expect(toast.textContent).toContain('Could not adopt');
    expect(toast.textContent).toContain('that is the path you are on');
  });

  it('renders nothing without a run; dismiss and auto-hide both call back once', () => {
    const { container } = render(<AdoptToast summary={null} onDismiss={() => {}} />);
    expect(container.querySelector('[data-vzf="adopt-toast"]')).toBeNull();

    cleanup();
    const onDismiss = vi.fn();
    const { container: c2 } = render(<AdoptToast summary={OK} onDismiss={onDismiss} autoHideMs={0} />);
    fireEvent.click(c2.querySelector('[data-vzf="adopt-toast-dismiss"]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    cleanup();
    vi.useFakeTimers();
    const onHide = vi.fn();
    render(<AdoptToast summary={OK} onDismiss={onHide} autoHideMs={500} />);
    act(() => void vi.advanceTimersByTime(600));
    expect(onHide).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// r → a → b (main's tip, head); a → c (premium's tip); a → z (the archived lane's tip)
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user' } },
    { id: 'b', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [10, 20], cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
    { id: 'z', parent: 'a', viewId: 'bar', kind: 'point', field: 'category', value: 'Party', cause: { requestedBy: 'user' } },
  ],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);
const VISIBLE: readonly PathView[] = [
  { name: 'main', tip: 'b', steps: 3, lastTs: 2, active: true },
  { name: 'premium', tip: 'c', steps: 3, lastTs: 3, active: false },
];
const ARCHIVED: readonly PathView[] = [{ name: 'dead-end', tip: 'z', steps: 3, lastTs: 4, active: false, archived: true }];

describe('TL-1 BranchMap — archived lanes hidden by default, the two new menu items', () => {
  it('an archived lane has NO label until revealed — but its step is always drawn', () => {
    const { container } = render(
      <BranchMap commits={S.commits} cursor="b" head="b" paths={VISIBLE} archivedPaths={ARCHIVED} />,
    );
    expect([...container.querySelectorAll('.vzf-bm-lane-label')].map((l) => l.getAttribute('data-lane-label'))).toEqual([
      'main',
      'premium',
    ]);
    expect(container.querySelector('[data-commit="z"]')).not.toBeNull(); // the record is never erased

    cleanup();
    const { container: shown } = render(
      <BranchMap commits={S.commits} cursor="b" head="b" paths={VISIBLE} archivedPaths={ARCHIVED} showArchived />,
    );
    const label = shown.querySelector('[data-lane-label="dead-end"]')!;
    expect(label.getAttribute('data-archived')).toBe('true');
    expect(label.classList.contains('vzf-archived')).toBe(true);
    expect(label.textContent).toContain('🗄');
  });

  it('"Discard from here…" only ASKS, and is disabled with the reason off-path or at the end', () => {
    const onDiscardFrom = vi.fn();
    const { container } = render(
      <BranchMap commits={S.commits} cursor="b" head="b" paths={VISIBLE} onSeek={() => {}} onDiscardFrom={onDiscardFrom} />,
    );
    // a step behind the head on YOUR line: enabled, and it only calls back
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    const item = container.querySelector('[data-ctx="discard-from"]') as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onDiscardFrom).toHaveBeenCalledWith('a');

    // the head itself: nothing after it
    fireEvent.click(container.querySelector('[data-commit="b"]')!);
    const atHead = container.querySelector('[data-ctx="discard-from"]') as HTMLButtonElement;
    expect(atHead.disabled).toBe(true);
    expect(atHead.title).toContain('already ends here');

    // another lane's step: not yours to discard
    fireEvent.click(container.querySelector('[data-vzf="ctx-shield"]')!);
    fireEvent.click(container.querySelector('[data-commit="c"]')!);
    const offPath = container.querySelector('[data-ctx="discard-from"]') as HTMLButtonElement;
    expect(offPath.disabled).toBe(true);
    expect(offPath.title).toContain('only your own future is discardable');
  });

  it('"Discard from here…" is disabled WITH the reason when the lane you stand on is archived', () => {
    // you just archived the path you were on: HEAD detached onto its tip, so the
    // lane is hidden and frozen — nothing on it is discardable until restored.
    const detached: readonly PathView[] = [{ name: 'premium', tip: 'c', steps: 3, lastTs: 3, active: false }];
    const archivedHead: readonly PathView[] = [{ name: 'main', tip: 'b', steps: 3, lastTs: 2, active: false, archived: true }];
    const { container } = render(
      <BranchMap
        commits={S.commits}
        cursor="b"
        head="b"
        paths={detached}
        archivedPaths={archivedHead}
        onSeek={() => {}}
        onDiscardFrom={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    const item = container.querySelector('[data-ctx="discard-from"]') as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe('this line of work is archived — restore it first');
    // …and the same step IS discardable once that lane is visible again
    cleanup();
    const { container: live } = render(
      <BranchMap commits={S.commits} cursor="b" head="b" paths={VISIBLE} onSeek={() => {}} onDiscardFrom={() => {}} />,
    );
    fireEvent.click(live.querySelector('[data-commit="a"]')!);
    expect((live.querySelector('[data-ctx="discard-from"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Adopt this path" appears on another path\'s TIP, and never on your own', () => {
    const onAdoptPath = vi.fn();
    const { container } = render(
      <BranchMap
        commits={S.commits}
        cursor="b"
        head="b"
        paths={VISIBLE}
        archivedPaths={ARCHIVED}
        showArchived
        onSeek={() => {}}
        onAdoptPath={onAdoptPath}
      />,
    );
    fireEvent.click(container.querySelector('[data-commit="a"]')!); // a mid-path step is no path's tip
    expect(container.querySelector('[data-ctx="adopt-path"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-vzf="ctx-shield"]')!);
    fireEvent.click(container.querySelector('[data-commit="c"]')!);
    const item = container.querySelector('[data-ctx="adopt-path"]') as HTMLButtonElement;
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onAdoptPath).toHaveBeenCalledWith('premium');

    fireEvent.click(container.querySelector('[data-commit="b"]')!); // your own tip
    const own = container.querySelector('[data-ctx="adopt-path"]') as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect(own.title).toContain('already on');

    // a revealed ARCHIVED tip is adoptable too — hidden is not gone — and says so
    fireEvent.click(container.querySelector('[data-vzf="ctx-shield"]')!);
    fireEvent.click(container.querySelector('[data-commit="z"]')!);
    expect((container.querySelector('[data-ctx="adopt-path"]') as HTMLButtonElement).textContent).toContain('(archived)');
  });

  it('while DETACHED, adopting the lane you left is still offered (no active path to compare against)', () => {
    const detachedPaths: readonly PathView[] = VISIBLE.map((p) => ({ ...p, active: false }));
    const { container } = render(
      <BranchMap commits={S.commits} cursor="a" head="b" paths={detachedPaths} onSeek={() => {}} onAdoptPath={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-commit="b"]')!);
    expect((container.querySelector('[data-ctx="adopt-path"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('TL-1 adapter — the four actions over both sources', () => {
  const state = (paths: RawPollState['paths']): RawPollState => ({ ...RAW, paths });

  function pollView(onPost: (url: string, body: unknown) => unknown) {
    const calls: { url: string; body?: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      const body = init?.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ url, body });
      const payload = init?.body === undefined ? state({ current: 'main', list: [...VISIBLE], archivedList: [...VISIBLE, ...ARCHIVED] }) : onPost(url, body);
      return { ok: true, json: async () => payload } as unknown as Response;
    }) as unknown as typeof fetch;
    return { view: createSessionView(pollingSource({ fetchImpl })), calls };
  }

  it('the poll source POSTs every lifecycle action to the ONE documented paths endpoint', async () => {
    const { view, calls } = pollView(() => ({ ok: true, path: 'premium', applied: 1, skipped: 0, conflicts: [], steps: [{ applied: true }] }));
    await view.refresh();
    await view.archivePath('dead-end');
    await view.restorePath('dead-end');
    await view.discardFromHere('a');
    await view.discardFromHere();
    const summary = await view.adoptPath('premium');

    const posts = calls.filter((c) => c.body !== undefined).map((c) => ({ url: c.url, body: c.body }));
    expect(posts).toEqual([
      { url: '/api/paths', body: { action: 'archive', name: 'dead-end' } },
      { url: '/api/paths', body: { action: 'restore', name: 'dead-end' } },
      { url: '/api/paths', body: { action: 'discard', commitId: 'a' } },
      { url: '/api/paths', body: { action: 'discard' } }, // omitted = from the cursor
      { url: '/api/paths', body: { action: 'adopt', name: 'premium' } },
    ]);
    expect(summary).toEqual({ ok: true, path: 'premium', applied: 1, skipped: 0, conflicts: 0, skippedReasons: [] });
    view.dispose();
  });

  it('the poll state maps the archived rows (and filters the visible ones back out)', async () => {
    const { view } = pollView(() => ({ ok: true }));
    await view.refresh();
    const paths = view.getState().paths;
    expect(paths.list.map((p) => p.name)).toEqual(['main', 'premium']);
    expect(paths.archivedList).toEqual([{ name: 'dead-end', tip: 'z', steps: 3, lastTs: 4, active: false, archived: true }]);
    view.dispose();
  });

  it('an unreachable / refusing paths endpoint answers honestly, never a fake adopt', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const offline = createSessionView(pollingSource({ fetchImpl: failing }));
    expect(await offline.adoptPath('premium')).toMatchObject({ ok: false, reason: 'could not reach the paths endpoint' });
    offline.dispose();

    const s500 = (async (_u: string, init?: { body?: string }) =>
      ({ ok: init?.body === undefined, status: 500, json: async () => RAW }) as unknown as Response) as unknown as typeof fetch;
    const refused = createSessionView(pollingSource({ fetchImpl: s500 }));
    expect(await refused.adoptPath('premium')).toMatchObject({ ok: false, reason: 'the paths endpoint answered 500' });
    refused.dispose();
  });

  it('summarizeAdopt keeps a session GAP detail as the reason, and defaults honestly', () => {
    expect(summarizeAdopt('x', { ok: false, gap: { detail: 'no path named "x"' } })).toMatchObject({
      ok: false,
      reason: 'no path named "x"',
    });
    expect(summarizeAdopt('x', { ok: false })).toMatchObject({ reason: 'the adopt was refused' });
    // a bare ok with nothing else reads as zeros, never as invented counts
    expect(summarizeAdopt('x', { ok: true })).toEqual({
      ok: true,
      path: 'x',
      applied: 0,
      skipped: 0,
      conflicts: 0,
      skippedReasons: [],
    });
    expect(summarizeAdopt('x', { ok: true, steps: [{ applied: false }] }).skippedReasons).toEqual(['skipped']);
  });
});

describe('TL-1 ForkToast — a discard\'s parked path is not a fork', () => {
  it('the auto-created "kept" ref of a discard never toasts, while a real fork still does', async () => {
    vi.useFakeTimers();
    const mounted: PathEventView[] = [{ type: 'create', name: 'main', at: 'r', auto: true, ts: 0 }];
    const { container, rerender } = render(<ForkToast events={mounted} />);
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();

    // a DISCARD arrives: create(kept) + archive(kept) + discard — no fork happened
    const afterDiscard: PathEventView[] = [
      ...mounted,
      { type: 'create', name: 'discarded-bar-click', at: 'b', auto: true, ts: 1 },
      { type: 'archive', name: 'discarded-bar-click', at: 'b', by: 'user', ts: 2 },
      { type: 'discard', name: 'main', from: 'b', to: 'a', kept: 'discarded-bar-click', by: 'user', ts: 3 },
    ];
    await act(async () => void rerender(<ForkToast events={afterDiscard} />));
    expect(container.querySelector('[data-vzf="fork-toast"]')).toBeNull();

    // a REAL branch-on-act still announces itself
    await act(async () =>
      void rerender(<ForkToast events={[...afterDiscard, { type: 'create', name: 'premium', at: 'c', auto: true, ts: 4 }]} />),
    );
    expect(container.querySelector('[data-vzf="fork-toast"]')!.textContent).toContain('premium');
    vi.useRealTimers();
  });
});

describe('TL-1 parity — the human and the model are told the same truth', () => {
  it('the UI honesty line is byte-identical to the agent surface\'s', () => {
    expect(HIDDEN_NOT_ERASED).toBe(SRC_HIDDEN_NOT_ERASED);
  });
});
