// @vitest-environment jsdom
/**
 * Coverage packet COV-app — closes `demo-agent/src/app.tsx` (0% -> 100%).
 *
 * `app.tsx` self-mounts on import: `main()` fetches `/data/dresses.csv`,
 * builds a `createSessionView(pollingSource(...))` store against the FLAGSHIP
 * `<VizCockpit>` (vizfootprint-ui), and `wireChatAndDebugger()` wires the
 * hand-rolled chat popup chrome (page.mjs's real ids) — the 🐛 debugger no
 * longer has its own modal chrome; it rides the cockpit's own "Analyst
 * debugger" report chip (`<DebugPanel>`, a `VizModal`-hosted iframe).
 * `window.__vizAgent` (set at the very end of `main()`, now also carrying the
 * React `root`) is the boot-complete signal these tests wait on. `main` is
 * additionally `export`ed (a source edit — see the report) so two branches
 * that are otherwise unobservable through the self-mount alone can be
 * exercised directly: the `#dashboard missing` throw, and (via
 * `__vizAgent.root.unmount()`) the ArrowLeft/ArrowRight `useEffect` cleanup.
 *
 * Harness (app.coverage.helpers.ts): `installDom()` rebuilds the real page
 * shell from `page.mjs`'s own `PAGE` markup; `FakeApi` is a small stateful
 * `/api/*` + `/data/dresses.csv` router stood in for `demo-agent/server.mjs`,
 * stubbed onto `globalThis.fetch` (app.tsx has no injectable fetch). Fake
 * timers run for the whole file — `wireChatAndDebugger`'s 2000ms idle poll
 * has no disposal path, so real timers would leak a live interval calling a
 * LATER test's fetch mock; fake timers make every timer inert until a test
 * explicitly advances it. Promise chains still resolve on their own via
 * `flush()` (repeated microtask turns) — fake timers only fake
 * setTimeout/setInterval, never the microtask queue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import {
  installDom,
  flush,
  FakeApi,
  fireEvent,
  deferred,
  STATE_A,
  STATE_B,
  STATE_VIEWING_PAST,
  STATE_NONNUMERIC_XY,
  STATE_EDGE_SELECTION,
  STATE_WITH_PATHS,
} from './app.coverage.helpers.js';

let api: FakeApi;

interface VizAgent {
  view: { refresh(): Promise<void>; dispose(): void };
  refresh(): Promise<void>;
  root: { unmount(): void };
}

function vizAgent(): VizAgent {
  const agent = (window as unknown as { __vizAgent?: unknown }).__vizAgent;
  if (!agent) throw new Error('window.__vizAgent missing — app.tsx did not finish booting');
  return agent as VizAgent;
}

beforeEach(() => {
  vi.useFakeTimers();
  installDom();
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetchImpl);
});

afterEach(() => {
  try {
    vizAgent().view.dispose();
  } catch {
    /* not booted in this test — fine */
  }
  document.body.innerHTML = '';
  delete (window as unknown as { __vizAgent?: unknown }).__vizAgent;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Import app.tsx fresh (triggers `void main()`) and wait for it to fully boot. */
async function boot(state: unknown = STATE_A): Promise<void> {
  api.state = state;
  await act(async () => {
    await import('./app.js');
    await flush();
  });
}

/** Flush a round of async work (fetch/json chains) triggered by an interaction. */
async function tick(): Promise<void> {
  await act(async () => {
    await flush();
  });
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('click(): target missing');
  await act(async () => {
    fireEvent.click(el);
    await flush();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  });
}

function cockpit(): Element {
  const el = document.querySelector('[data-vzf="cockpit"]');
  if (!el) throw new Error('cockpit root missing');
  return el;
}

/** Open a report chip's modal (id matches the chip's `data-report`) and return it. */
async function openReport(id: string): Promise<void> {
  await click(document.querySelector(`[data-report="${id}"]`));
}

function activitySteps(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.activity-step'));
}

describe('boot — rich fixture (STATE_A): renders every "has value" branch', () => {
  beforeEach(async () => {
    await boot(STATE_A);
  });

  it('mounts the React cockpit from vizfootprint-ui', () => {
    expect(document.querySelector('.vzf-cockpit-root')).toBeTruthy();
    expect(cockpit().getAttribute('data-readonly')).toBe('false');
  });

  it('the status readout reports selection count, mock provider, and no viewingPast suffix', () => {
    // price∈[40,250] AND category==='Casual' -> r1(50), r2(65) only
    expect(screen.getByText('2 of 7 rows selected · provider: scripted mock')).toBeTruthy();
  });

  it('scatter reads xField/yField off state.encodings (non-default values) and dims by the OTHER view\'s clause', () => {
    expect(screen.getByText(/Scatter — drag to brush rating/)).toBeTruthy();
    const dots = document.querySelectorAll('circle.vzf-dot');
    expect(dots).toHaveLength(7);
    // scatter's OWN clause is excluded (crossfilter self-exclusion) — only bar's
    // category==='Casual' point clause dims the scatter: 5 of 7 rows dimmed.
    expect(document.querySelectorAll('circle.vzf-dim')).toHaveLength(5);
  });

  it('bar counts reflect the OTHER view\'s clause (scatter\'s price interval), and the active point selection is highlighted', () => {
    expect(screen.getByText(/Bar — click a category/)).toBeTruthy();
    const formal = screen.getByRole('button', { name: 'select Formal (2)' });
    expect(formal).toBeTruthy();
    expect(screen.getByRole('button', { name: 'select Summer (0)' })).toBeTruthy(); // 300 is outside [40,250]
    const casualBtn = screen.getByRole('button', { name: /select Casual/ });
    expect(casualBtn.getAttribute('aria-pressed')).toBe('true'); // barSelected 'Casual' ternary TRUE arm
  });

  it('the time-travel bar reads the same commit/branch/checkpoint state; the branch-map and commit-log chips carry it into their report modals', async () => {
    expect(screen.getByText(/1 branch\b/)).toBeTruthy();
    expect(document.querySelector('[data-report="branches"] .vzf-report-badge')?.textContent).toBe('1');
    expect(document.querySelector('[data-report="commits"] .vzf-report-badge')?.textContent).toBe('2');

    await openReport('branches');
    const branchDialog = screen.getByRole('dialog');
    expect(document.querySelectorAll('[data-vzf="branch-map"] [data-commit]')).toHaveLength(2);
    expect(within(branchDialog).getByText('Branch map')).toBeTruthy(); // the modal title (the chip's own title)
    await click(within(branchDialog).getByRole('button', { name: 'Close' }));

    await openReport('commits');
    const commitDialog = screen.getByRole('dialog');
    expect(document.querySelectorAll('[data-vzf="commit-log"] [data-commit]')).toHaveLength(2);
    expect(within(commitDialog).getByText('Commit log')).toBeTruthy();
  });

  it('the analyses report chip badges the ready count; its modal shows a "run" button and a blocked taxonomy code', async () => {
    expect(document.querySelector('[data-report="analyses"] .vzf-report-badge')?.textContent).toBe('1'); // 1 of 2 ready
    await openReport('analyses');
    expect(screen.getByRole('button', { name: 'run' })).toBeTruthy();
    expect(screen.getByText(/blocked: not-enough-rows \(price\)/)).toBeTruthy();
  });

  it('the gaps report chip badges the filed gap count; its modal shows the gap row', async () => {
    expect(document.querySelector('[data-report="gaps"] .vzf-report-badge')?.textContent).toBe('1');
    await openReport('gaps');
    expect(document.querySelector('[data-gap="E_NO_COLUMN"]')).toBeTruthy();
  });

  it('the FDR ledger report chip opens a modal that renders the ledger', async () => {
    await openReport('ledger');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('FDR ledger')).toBeTruthy(); // the modal title
    expect(document.querySelector('[data-vzf="fdr-ledger"]')).toBeTruthy();
  });

  it('the chat popup starts closed with the fab visible, the sys greeting, and 5 suggestion chips', () => {
    expect((document.getElementById('chatpanel') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('fab') as HTMLElement).hidden).toBe(false);
    expect(screen.getByText(/Brush the scatter or click a bar/)).toBeTruthy();
    expect(document.querySelectorAll('.suggest button')).toHaveLength(5);
  });

  it('window.__vizAgent exposes the live view + a working refresh()', async () => {
    const agent = vizAgent();
    expect(agent.view).toBeTruthy();
    const before = api.callsTo('/api/state').length;
    await act(async () => {
      await agent.refresh();
      await flush();
    });
    expect(api.callsTo('/api/state').length).toBeGreaterThan(before);
  });
});

describe('boot — activity strip: every summarizeValue/summarizeArgs/summarizeResult branch', () => {
  beforeEach(async () => {
    await boot(STATE_A);
    // the boot-time `void getChatState().then(...)` is fire-and-forget — give it
    // the same generous flush the rest of main() already got.
    await tick();
  });

  it('renders one .activity-step per activity entry, in order', () => {
    expect(activitySteps()).toHaveLength(12);
  });

  it('step 1: no result (undefined) -> empty result text, empty args -> "(no args)"', () => {
    const s = activitySteps()[0]!;
    expect(within(s).getByText('whats_here')).toBeTruthy();
    expect(s.querySelector('.args')!.textContent).toBe('(no args)');
    expect(s.querySelector('.result')!.textContent).toBe('');
  });

  it('step 2: an array arg value, an undefined arg dropped, ok:false with a gap', () => {
    const s = activitySteps()[1]!;
    // every STRING arg value is quoted by summarizeValue; only the array's own
    // numeric elements are printed bare.
    expect(s.querySelector('.args')!.textContent).toBe('verb="filter" viewId="scatter" field="price" range=[10,20]');
    expect(s.querySelector('.result')!.textContent).toBe('gap=E_BAD');
  });

  it('step 3: a quoted short-string arg, ok:false with a reason (no gap)', () => {
    const s = activitySteps()[2]!;
    expect(s.querySelector('.args')!.textContent).toBe('verb="select" value="Casual"');
    expect(s.querySelector('.result')!.textContent).toBe('ok=false reason=no active view');
  });

  it('step 4: ok:false with neither gap nor reason', () => {
    const s = activitySteps()[3]!;
    expect(s.querySelector('.result')!.textContent).toBe('ok=false');
  });

  it('step 5: the whats_here shape WITH an fdr.tests count', () => {
    const s = activitySteps()[4]!;
    expect(s.querySelector('.result')!.textContent).toBe('views=2 selections=1 tests=5 gaps=2');
  });

  it('step 6: the whats_here shape with NO fdr at all (tests defaults to 0)', () => {
    const s = activitySteps()[5]!;
    expect(s.querySelector('.result')!.textContent).toBe('views=0 selections=0 tests=0 gaps=0');
  });

  it('step 7: a verb result with a `reencoded` summary, no commit/analysis', () => {
    const s = activitySteps()[6]!;
    expect(s.querySelector('.result')!.textContent).toBe('verb=reencode reencoded=scatter.x→rating');
  });

  it('step 8: a verb result with a `commit` summary (non-integer value -> toFixed(3))', () => {
    const s = activitySteps()[7]!;
    expect(s.querySelector('.result')!.textContent).toBe('verb=filter commit=#c9 price=123.456');
  });

  it('step 9: a verb result with an `analysis` + `fdrStep` summary', () => {
    const s = activitySteps()[8]!;
    expect(s.querySelector('.result')!.textContent).toBe('verb=analyze analysis=correlation kind=stat p=0.0310 discovery=true');
  });

  it('step 10: a long string arg value gets truncated; analysis WITHOUT fdrStep omits the p= suffix', () => {
    const s = activitySteps()[9]!;
    expect(s.querySelector('.args')!.textContent).toBe(`verb="analyze" analysisId="${'x'.repeat(25)}…"`);
    expect(s.querySelector('.result')!.textContent).toBe(`verb=analyze analysis=${'x'.repeat(40)} kind=stat`);
  });

  it('step 11: a boolean + a null arg value, and the tiers/slice fallback text', () => {
    const s = activitySteps()[10]!;
    expect(s.querySelector('.args')!.textContent).toBe('target="cluster_id" extraFlag=true noneVal=null');
    expect(s.querySelector('.result')!.textContent).toBe('why → cross-tier slice');
  });

  it('step 12: the final "ok=true" fallback when nothing else matches', () => {
    const s = activitySteps()[11]!;
    expect(s.querySelector('.result')!.textContent).toBe('ok=true');
  });
});

describe('boot — default/fallback fixture (STATE_B): every "??" and ternary-false branch', () => {
  beforeEach(async () => {
    await boot(STATE_B);
  });

  it('xField/yField default to price/rating when state.encodings has nothing for scatter', () => {
    expect(screen.getByText(/Scatter — drag to brush price/)).toBeTruthy();
  });

  it('columns falls back to [] when the defaultTable has none — the x-axis picker shows the empty state', async () => {
    const xAxis = screen.getByRole('button', { name: /Encode the x axis/ });
    await click(xAxis);
    expect(screen.getByText('no columns available yet')).toBeTruthy();
  });

  it('provider reads "live Claude" (mode !== \'mock\') and the viewingPast suffix is appended', () => {
    // no selections at all -> every row passes -> 7 of 7
    expect(screen.getByText(/7 of 7 rows selected · provider: live Claude/)).toBeTruthy();
    expect(screen.getByText(/viewing the past \(cursor behind head\)/)).toBeTruthy();
  });

  it('with no bar point selection, the bar has no highlighted category', () => {
    expect(document.querySelectorAll('.vzf-barrect.vzf-selected')).toHaveLength(0);
  });
});

describe('scatterData numeric fallback: a non-numeric xField/yField renders 0 without crashing', () => {
  it('renders all 7 dots when the agent has reencoded BOTH axes onto a string column', async () => {
    await boot(STATE_NONNUMERIC_XY);
    expect(screen.getByText(/Scatter — drag to brush category/)).toBeTruthy();
    expect(document.querySelectorAll('circle.vzf-dot')).toHaveLength(7);
  });
});

describe('edge selection: a bar-viewId selection that is NOT kind:point', () => {
  it('barSelected stays undefined (the && short-circuits on kind, not viewId)', async () => {
    await boot(STATE_EDGE_SELECTION);
    expect(document.querySelectorAll('.vzf-barrect.vzf-selected')).toHaveLength(0);
  });
});

describe('dashboard interactions — chart emit + reencode', () => {
  beforeEach(async () => {
    await boot(STATE_A);
  });

  it('a bar click dispatches a point select on the clicked category', async () => {
    await click(screen.getByRole('button', { name: 'select Formal (2)' }));
    const post = api.callsTo('/api/dispatch').at(-1);
    expect(post?.body).toMatchObject({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'select category' });
  });

  it('a horizontal scatter brush dispatches an interval filter on the CURRENT xField', async () => {
    const svg = document.querySelector('svg.vzf-scatter')!;
    await act(async () => {
      fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
      fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
      await flush();
    });
    const post = api.callsTo('/api/dispatch').at(-1);
    expect(post?.body).toMatchObject({ verb: 'filter', viewId: 'scatter', field: 'rating', intent: 'brush rating' });
  });

  it('picking a column in the scatter x-axis picker dispatches a reencode', async () => {
    await click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    await click(within(dialog).getByRole('button', { name: /^price/ }));
    const post = api.callsTo('/api/dispatch').at(-1);
    expect(post?.body).toMatchObject({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'price' });
  });

  it('picking a column in the bar category-axis picker dispatches a reencode', async () => {
    await click(screen.getByRole('button', { name: /Encode the category axis/ }));
    const dialog = screen.getByRole('dialog');
    await click(within(dialog).getByRole('button', { name: /^rating/ }));
    const post = api.callsTo('/api/dispatch').at(-1);
    expect(post?.body).toMatchObject({ verb: 'reencode', viewId: 'bar', channel: 'category', field: 'rating' });
  });
});

describe('dashboard interactions — time travel', () => {
  it('seeking from the branch map, the commit log, and the timeline all fire view.seek()', async () => {
    await boot(STATE_A);
    await openReport('branches'); // both live inside their report-chip modals now
    // BR-3: the branch map now wires onNewPath/onBringOver/onUndo/onCompare, so
    // a node click opens the context menu instead of seeking directly — go
    // through its "Jump here" item (see the dedicated BR-3 describe block below
    // for the other menu items).
    await click(document.querySelector('[data-vzf="branch-map"] [data-commit="c1"]'));
    await click(document.querySelector('[data-ctx="jump"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c1' });

    await openReport('commits'); // switches the SAME modal's content — no close needed first
    await click(document.querySelector('[data-vzf="commit-log"] [data-commit="c2"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c2' });

    await click(document.querySelector('.vzf-timeline [data-commit="c1"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c1' });
  });

  it('step back seeks to the cursor\'s parent', async () => {
    await boot(STATE_A); // cursor=c2 (parent c1) -> back enabled, forward disabled (at head)
    await click(document.querySelector('button[data-step="back"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c1' });
  });

  it('step forward and "return to now" both fire when the cursor sits behind head', async () => {
    await boot(STATE_VIEWING_PAST); // cursor=c1, head=c2
    await click(document.querySelector('button[data-step="forward"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c2' });

    await click(document.querySelector('[data-vzf="return-now"]'));
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c2' });
  });

  it('naming a checkpoint through the ⚑ modal dispatches the checkpoint verb', async () => {
    await boot(STATE_A);
    await click(screen.getByRole('button', { name: /Checkpoint/ }));
    const input = screen.getByLabelText('checkpoint name');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'my beat' } });
      await flush();
    });
    await click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(api.callsTo('/api/checkpoint').at(-1)?.body).toMatchObject({ label: 'my beat' });
  });

  it('toggling Present/Explore flips the dashboard\'s readOnly flag', async () => {
    await boot(STATE_A);
    expect(cockpit().getAttribute('data-readonly')).toBe('false');
    await click(screen.getByRole('tab', { name: 'Present' }));
    expect(cockpit().getAttribute('data-readonly')).toBe('true');
    await click(screen.getByRole('tab', { name: 'Explore' }));
    expect(cockpit().getAttribute('data-readonly')).toBe('false');
  });
});

describe('dashboard interactions — readiness', () => {
  it('clicking "run" on a ready analysis dispatches analyze with the default intent', async () => {
    await boot(STATE_A);
    await openReport('analyses'); // ReadinessPanel now lives inside its report-chip modal
    await click(screen.getByRole('button', { name: 'run' }));
    const post = api.callsTo('/api/dispatch').at(-1);
    expect(post?.body).toMatchObject({ verb: 'analyze', analysisId: 'correlation', intent: 'analyze correlation' });
  });
});

describe('BR-3 — named paths: BranchPill/PathsModal/ForkToast/CompareModal, and the branch-map context menu', () => {
  it('the branch pill opens PathsModal; closing it (Escape) closes it again', async () => {
    await boot(STATE_WITH_PATHS);
    expect(screen.queryByRole('dialog', { name: /Paths/ })).toBeNull();
    await click(document.querySelector('[data-vzf="branch-pill"]'));
    expect(document.querySelector('[data-vzf-modal="paths"] [role="dialog"]')).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.querySelector('[data-vzf-modal="paths"] [role="dialog"]')!, { key: 'Escape' });
      await flush();
    });
    expect(document.querySelector('[data-vzf-modal="paths"]')).toBeNull();
  });

  it('PathsModal: switching to the non-active path posts the switch action', async () => {
    await boot(STATE_WITH_PATHS);
    await click(document.querySelector('[data-vzf="branch-pill"]'));
    await click(document.querySelector('[data-path="side-quest"] [data-vzf="path-switch"]'));
    expect(api.callsTo('/api/paths').at(-1)?.body).toMatchObject({ action: 'switch', name: 'side-quest' });
  });

  it('PathsModal: renaming a path posts the rename action with from/to', async () => {
    await boot(STATE_WITH_PATHS);
    await click(document.querySelector('[data-vzf="branch-pill"]'));
    await click(document.querySelector('[data-path="side-quest"] [data-vzf="path-rename"]'));
    const input = document.querySelector('.vzf-path-rename-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'renamed-quest' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await flush();
    });
    expect(api.callsTo('/api/paths').at(-1)?.body).toMatchObject({ action: 'rename', from: 'side-quest', to: 'renamed-quest' });
  });

  it('PathsModal: "New path from here" posts the new action at the cursor', async () => {
    await boot(STATE_WITH_PATHS); // cursor === 'c2'
    await click(document.querySelector('[data-vzf="branch-pill"]'));
    await click(document.querySelector('[data-vzf="path-new"]'));
    expect(api.callsTo('/api/paths').at(-1)?.body).toMatchObject({ action: 'new', commitId: 'c2' });
  });

  it('branch-map context menu: new path / bring over / undo / compare all fire through the adapter', async () => {
    await boot(STATE_WITH_PATHS);
    await openReport('branches');

    await click(document.querySelector('[data-vzf="branch-map"] [data-commit="c1"]'));
    await click(document.querySelector('[data-ctx="new-path"]'));
    expect(api.callsTo('/api/paths').at(-1)?.body).toMatchObject({ action: 'new', commitId: 'c1' });

    await click(document.querySelector('[data-vzf="branch-map"] [data-commit="c1"]'));
    await click(document.querySelector('[data-ctx="bring-over"]'));
    expect(api.callsTo('/api/bring-over').at(-1)?.body).toMatchObject({ commitId: 'c1' });

    await click(document.querySelector('[data-vzf="branch-map"] [data-commit="c1"]'));
    await click(document.querySelector('[data-ctx="undo"]'));
    expect(api.callsTo('/api/undo').at(-1)?.body).toMatchObject({ commitId: 'c1' });

    await click(document.querySelector('[data-vzf="branch-map"] [data-commit="c1"]'));
    await click(document.querySelector('[data-ctx="compare"]'));
    // CompareModal opened, seeded with A = the clicked commit; its own effect
    // fires the (read-only) compare through the SAME adapter action app.tsx wires.
    expect(document.querySelector('[data-vzf-modal="compare"] [role="dialog"]')).toBeTruthy();
    expect((document.querySelector('[data-vzf="compare-a"]') as HTMLSelectElement).value).toBe('c1');
    expect(api.callsTo('/api/compare').at(-1)?.body).toEqual({ a: 'c1', b: 'main' });

    // …and its ✕ really closes it (the app's onClose wiring for CompareModal)
    await click(document.querySelector('[data-vzf-modal="compare"] button[aria-label="Close"]'));
    expect(document.querySelector('[data-vzf-modal="compare"]')).toBeNull();
  });

  it('ForkToast: an auto-fork journal entry that arrives AFTER mount toasts; "See paths" opens PathsModal', async () => {
    await boot(STATE_WITH_PATHS); // one create event already at mount — never toasts on its own
    expect(document.querySelector('[data-vzf="fork-toast"]')).toBeNull();

    api.state = {
      ...STATE_WITH_PATHS,
      paths: {
        ...STATE_WITH_PATHS.paths,
        events: [...STATE_WITH_PATHS.paths.events, { type: 'create', name: 'forked-branch', at: 'c1', auto: true, ts: 3000 }],
      },
    };
    await advance(900); // the dashboard's own poll interval picks up the new journal entry

    const toast = document.querySelector('[data-vzf="fork-toast"]');
    expect(toast).toBeTruthy();
    expect(toast!.textContent).toContain('forked-branch');

    await click(document.querySelector('[data-vzf="fork-toast-paths"]'));
    expect(document.querySelector('[data-vzf-modal="paths"] [role="dialog"]')).toBeTruthy();
  });
});

describe('keyboard step-nav mirror', () => {
  beforeEach(async () => {
    await boot(STATE_A); // cursor=c2: ArrowLeft has a target, ArrowRight does not (at head)
  });

  it('ArrowLeft steps back when nothing is focused', async () => {
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      await flush();
    });
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c1' });
  });

  it('ArrowRight is a no-op at the head (stepForwardTarget is null) but does not throw', async () => {
    const before = api.callsTo('/api/seek').length;
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowRight' });
      await flush();
    });
    expect(api.callsTo('/api/seek').length).toBe(before);
  });

  it('a non-arrow key is ignored', async () => {
    const before = api.callsTo('/api/seek').length;
    await act(async () => {
      fireEvent.keyDown(document, { key: 'a' });
      await flush();
    });
    expect(api.callsTo('/api/seek').length).toBe(before);
  });

  it('ArrowLeft while the checkpoint modal\'s name <input> is focused is swallowed (never steps)', async () => {
    await click(screen.getByRole('button', { name: /Checkpoint/ }));
    const input = screen.getByLabelText('checkpoint name') as HTMLInputElement;
    expect(document.activeElement).toBe(input); // the modal autofocuses it
    const before = api.callsTo('/api/seek').length;
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      await flush();
    });
    expect(api.callsTo('/api/seek').length).toBe(before);
  });

  it('ArrowLeft still steps back when the focused element is an SVG node (not an HTMLElement)', async () => {
    // the scatter's axis-label <g> is a focusable SVGElement — SVGElement is
    // NOT an instanceof HTMLElement, exercising that ternary's false arm.
    const axisGroup = document.querySelector('.vzf-axis-group') as unknown as { focus(): void };
    axisGroup.focus();
    expect(document.activeElement instanceof HTMLElement).toBe(false);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      await flush();
    });
    expect(api.callsTo('/api/seek').at(-1)?.body).toMatchObject({ commitId: 'c1' });
  });
});

describe('chat popup — open/close', () => {
  beforeEach(async () => {
    await boot(STATE_A);
  });

  it('the fab opens the panel and, after its 40ms delay, focuses the composer', async () => {
    await click(document.getElementById('fab'));
    expect((document.getElementById('chatpanel') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('fab') as HTMLElement).hidden).toBe(true);
    await advance(40);
    const input = document.querySelector('.composer input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('chatclose closes the panel and restores the fab', async () => {
    await click(document.getElementById('fab'));
    await click(document.getElementById('chatclose'));
    expect((document.getElementById('chatpanel') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('fab') as HTMLElement).hidden).toBe(false);
  });
});

describe('chat popup — sending', () => {
  beforeEach(async () => {
    await boot(STATE_A);
  });

  it('clicking a suggestion (not disabled) sends it, posts /api/chat, and appends both bubbles', async () => {
    api.chatQueue.push({ text: 'reply one' });
    const suggestion = document.querySelectorAll('.suggest button')[0] as HTMLButtonElement;
    const text = suggestion.textContent!;
    await click(suggestion);
    expect(api.callsTo('/api/chat').at(-1)?.body).toMatchObject({ message: text });
    // the suggestion button itself carries the SAME text permanently, so scope
    // the "you" bubble lookup to the transcript rather than a global getByText.
    const transcript = document.querySelector<HTMLElement>('.transcript')!;
    expect(within(transcript).getByText(text, { selector: '.bubble.you' })).toBeTruthy();
    expect(within(transcript).getByText('reply one')).toBeTruthy();
    expect(within(transcript).getByText('🐛 See the thinking')).toBeTruthy();
  });

  it('clicking a second suggestion while a send is in flight is guarded (sendBtn.disabled)', async () => {
    const chat = deferred<{ text?: string; error?: string }>();
    api.chatQueue.push(chat.promise);
    const suggestions = document.querySelectorAll('.suggest button');
    await click(suggestions[0] as HTMLButtonElement); // starts the in-flight send (not resolved yet)
    const chatCallsBefore = api.callsTo('/api/chat').length;
    await click(suggestions[1] as HTMLButtonElement); // guarded: sendBtn.disabled is true
    expect(api.callsTo('/api/chat').length).toBe(chatCallsBefore); // no second POST fired
    chat.resolve({ text: 'ok' });
    await tick();
  });

  it('Send is a no-op on an empty (or whitespace-only) message', async () => {
    const input = document.querySelector('.composer input') as HTMLInputElement;
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '   ' } });
      await flush();
    });
    await click(sendBtn);
    expect(api.callsTo('/api/chat')).toHaveLength(0);
    expect(sendBtn.disabled).toBe(false);
  });

  it('pressing Enter in the composer sends; any other key does not', async () => {
    const input = document.querySelector('.composer input') as HTMLInputElement;
    api.chatQueue.push({ text: 'enter reply' });
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hello there' } });
      fireEvent.keyDown(input, { key: 'a' }); // not Enter -> ignored
      await flush();
    });
    expect(api.callsTo('/api/chat')).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await flush();
    });
    expect(api.callsTo('/api/chat').at(-1)?.body).toMatchObject({ message: 'hello there' });
    expect(screen.getByText('enter reply')).toBeTruthy();
  });

  it('an {error} reply (no text) renders the error as the analyst bubble', async () => {
    api.chatQueue.push({ error: 'boom' });
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    const input = document.querySelector('.composer input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'will fail' } });
      await flush();
    });
    await click(sendBtn);
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('a network failure (post() returns null) renders the honest fallback line', async () => {
    api.chatQueue.push('reject');
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    const input = document.querySelector('.composer input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'will 500' } });
      await flush();
    });
    await click(sendBtn);
    expect(screen.getByText('The analyst did not reply.')).toBeTruthy();
  });

  it('while a send is in flight, the 400ms live interval ticks (extra /api/state polls) until it resolves', async () => {
    const chat = deferred<{ text?: string; error?: string }>();
    api.chatQueue.push(chat.promise);
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    const input = document.querySelector('.composer input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'slow one' } });
      await flush();
    });
    await click(sendBtn);
    expect(sendBtn.disabled).toBe(true);
    const before = api.callsTo('/api/state').length;
    await advance(400); // one live-poll tick while still pending
    expect(api.callsTo('/api/state').length).toBeGreaterThan(before);
    chat.resolve({ text: 'finally' });
    await tick();
    expect(sendBtn.disabled).toBe(false);
    expect(screen.getByText('finally')).toBeTruthy();
  });
});

describe('chat popup — 🐛 debugger (the cockpit\'s "Analyst debugger" report chip/modal — no separate hand-rolled modal anymore)', () => {
  async function openDebuggerViaReply(): Promise<void> {
    api.chatQueue.push({ text: 'reply' });
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    const input = document.querySelector('.composer input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'go' } });
      await flush();
    });
    await click(sendBtn);
    await click(screen.getByText('🐛 See the thinking'));
  }

  function debugBackdrop(): HTMLElement | null {
    return document.querySelector('[data-vzf-modal="report-debug"]');
  }

  beforeEach(async () => {
    await boot(STATE_A);
  });

  it('the "See the thinking" button opens the SAME debug chip as the status strip, with a cache-busted iframe src; the ✕ button closes it', async () => {
    await openDebuggerViaReply();
    const backdrop = debugBackdrop();
    expect(backdrop).toBeTruthy();
    const frame = backdrop!.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.src).toContain('/debug?embed=1&t=');
    expect(frame.title).toBe('Analyst reasoning');

    await click(within(backdrop!).getByRole('button', { name: 'Close' }));
    expect(debugBackdrop()).toBeNull(); // VizModal unmounts its content on close
  });

  it('the same chip lives on the status strip — clicking it directly opens the identical modal', async () => {
    await click(document.querySelector('[data-report="debug"]'));
    expect(debugBackdrop()).toBeTruthy();
  });

  it('closes on a backdrop mousedown but NOT on one bubbling from inside the dialog', async () => {
    await openDebuggerViaReply();
    const backdrop = debugBackdrop()!;
    const dialog = backdrop.querySelector('[role="dialog"]') as HTMLElement;

    await act(async () => {
      fireEvent.mouseDown(dialog); // inside the dialog -> must stay open
      await flush();
    });
    expect(debugBackdrop()).toBeTruthy();

    await act(async () => {
      fireEvent.mouseDown(backdrop); // the backdrop itself -> closes
      await flush();
    });
    expect(debugBackdrop()).toBeNull();
  });

  it('Escape (fired on the dialog) closes it; reopening gives a FRESH cache-busted src', async () => {
    await openDebuggerViaReply();
    const firstSrc = (debugBackdrop()!.querySelector('iframe') as HTMLIFrameElement).src;
    const dialog = debugBackdrop()!.querySelector('[role="dialog"]') as HTMLElement;

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await flush();
    });
    expect(debugBackdrop()).toBeNull();

    // reopening remounts <DebugPanel> — its lazy useState re-runs Date.now()
    await advance(2); // guarantee a distinct millisecond from the first open
    await click(document.querySelector('[data-report="debug"]'));
    const secondSrc = (debugBackdrop()!.querySelector('iframe') as HTMLIFrameElement).src;
    expect(secondSrc).not.toBe(firstSrc);
  });
});

describe('chat reset', () => {
  it('posts /api/reset, clears the transcript to the fresh-session line, and refreshes the dashboard', async () => {
    await boot(STATE_A);
    api.chatQueue.push({ text: 'ignored' });
    // give the transcript some content first, so we can prove reset clears it
    const suggestion = document.querySelectorAll('.suggest button')[0] as HTMLButtonElement;
    await click(suggestion);
    expect(document.querySelectorAll('.transcript .bubble.you').length).toBeGreaterThan(0);

    const stateCallsBefore = api.callsTo('/api/state').length;
    await click(document.getElementById('chatreset'));
    expect(api.resetCalls).toBe(1);
    expect(api.calls.find((c) => c.url === '/api/reset')?.body).toEqual({});
    expect(document.querySelectorAll('.transcript .bubble.you')).toHaveLength(0);
    expect(screen.getByText('✨ Fresh session — chat and shared log cleared. Ask away!')).toBeTruthy();
    expect(api.callsTo('/api/state').length).toBeGreaterThan(stateCallsBefore);
  });
});

describe('idle poll (2000ms): turnActive/activity-length branches + getChatState failure branches', () => {
  it('turnActive + empty activity -> "analyst is thinking…"; turnActive + activity -> "analyst is working…"', async () => {
    await boot(STATE_A); // boots turnActive:false -> working stays '' at boot
    const working = document.querySelector('.working') as HTMLElement;
    expect(working.textContent).toBe('');

    api.state = { ...STATE_A, turnActive: true, activity: [] };
    await advance(2000);
    expect(working.textContent).toBe('analyst is thinking…');

    api.state = { ...STATE_A, turnActive: true, activity: [STATE_A.activity[0]] };
    await advance(2000);
    expect(working.textContent).toBe('analyst is working…');
  });

  it('a thrown /api/state and a not-ok /api/state during the idle poll both leave the strip untouched', async () => {
    await boot(STATE_A);
    // stop the dashboard's OWN 900ms /api/state poll so the fail-plan below is
    // deterministically consumed by getChatState()'s idle poll, not a race
    // against sessionView's independent refresh cycle.
    vizAgent().view.dispose();
    api.state = { ...STATE_A, turnActive: true, activity: [STATE_A.activity[0]] };
    await advance(2000);
    const working = document.querySelector('.working') as HTMLElement;
    const stepsBefore = activitySteps().length;
    expect(working.textContent).toBe('analyst is working…');

    api.stateFailMode = 'throw';
    await advance(2000);
    expect(working.textContent).toBe('analyst is working…'); // unchanged — getChatState() returned null
    expect(activitySteps().length).toBe(stepsBefore);

    api.stateFailMode = 'notok';
    await advance(2000);
    expect(working.textContent).toBe('analyst is working…'); // unchanged again
    expect(activitySteps().length).toBe(stepsBefore);
  });
});

describe('sendMessage\'s finally block: the SECOND of its two /api/state calls (getChatState) can fail independently of the first (view.refresh())', () => {
  it('a failed final getChatState() leaves the activity strip on its last good snapshot (no crash)', async () => {
    await boot(STATE_A); // boots with the 12-entry STATE_A.activity strip
    expect(activitySteps()).toHaveLength(12);

    const chat = deferred<{ text?: string; error?: string }>();
    api.chatQueue.push(chat.promise);
    const sendBtn = document.querySelector('.composer .btn') as HTMLButtonElement;
    const input = document.querySelector('.composer input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'go' } });
      await flush();
    });
    await click(sendBtn); // in flight — nothing resolves yet

    // if the finally block's OWN getChatState() succeeded, the strip would
    // flip to this (now-empty) activity list — used below to prove it did NOT.
    api.state = { ...STATE_A, turnActive: false, activity: [] };
    // skip=1: let `await view.refresh()` (the finally block's FIRST /api/state
    // call) succeed normally, and fail only the SECOND — `await getChatState()`.
    api.stateFailPlan = { mode: 'throw', skip: 1 };
    chat.resolve({ text: 'done' });
    await tick();

    expect(screen.getByText('done')).toBeTruthy(); // the try block completed fine
    expect(activitySteps()).toHaveLength(12); // untouched — the final getChatState() returned null
  });
});

describe('main() — the #dashboard contract, and the keyboard-mirror cleanup on unmount', () => {
  it('throws a clear, honest error when #dashboard is missing from the page', async () => {
    await boot(STATE_A); // the normal auto-mount succeeds once, proving the happy path first
    expect(document.querySelector('.vzf-cockpit-root')).toBeTruthy();
    document.getElementById('dashboard')!.remove();
    // re-importing the ALREADY-CACHED module returns the same module object
    // (no vi.resetModules() in this test) — it does not re-trigger `void main()`.
    const mod = (await import('./app.js')) as unknown as { main: () => Promise<void> };
    await expect(mod.main()).rejects.toThrow('demo-agent: #dashboard missing');
  });

  it('unmounting the dashboard root removes the ArrowLeft/ArrowRight keydown listener (the useEffect cleanup)', async () => {
    await boot(STATE_A);
    const before = api.callsTo('/api/seek').length;
    await act(async () => {
      vizAgent().root.unmount();
      await flush();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      await flush();
    });
    expect(api.callsTo('/api/seek').length).toBe(before); // listener torn down -> no seek fired
  });
});
