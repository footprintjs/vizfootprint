// @vitest-environment jsdom
/**
 * THE STAGE, END TO END — a real dashboard, a real session, a real chart on the
 * stage, and the story told from that session's own bookmarks.
 *
 * Two claims are only worth anything against a real log, so they are pinned
 * here rather than against a fake:
 *
 *   • a beat MOVES the session — the cursor lands where the story says it does;
 *   • a reader's brush on the stage lands NO COMMIT. The read-only guarantee is
 *     a claim about the trace, so the assertion is about the trace: the log did
 *     not grow, and the same gesture on the same chart outside the stage does
 *     grow it (otherwise the test would pass on a chart that never worked).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { buildDashboard } from 'vizfootprint/def';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../../src/session/dashboard.fixture.js';
import { createSessionView, sessionSource } from '../../adapter/sessionView.js';
import { VizScatter } from '../../charts/VizScatter.js';
import { toStory } from '../toStory.js';
import { StoryStage } from './StoryStage.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

class FakeIO {
  static all: FakeIO[] = [];
  els: Element[] = [];
  constructor(readonly cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
    FakeIO.all.push(this);
  }
  observe(el: Element): void {
    this.els.push(el);
  }
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as Record<string, unknown>)['IntersectionObserver'] = FakeIO;
(globalThis as Record<string, unknown>)['ResizeObserver'] = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A desk with two named beats on it: pick a category, name it; brush the prices, name that. */
async function deskWithAStory() {
  const dash = buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });
  const session = dash.createSession();
  const view = createSessionView(sessionSource(session), { as: 'user' });
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: { ...cause, intent: 'pick casual' } });
  session.bookmark('Start');
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { ...cause, intent: 'pick formal' } });
  await session.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: { ...cause, intent: 'brush the middle' } });
  session.bookmark('The middle');
  await view.refresh();
  return { session, view, post: toStory(view.getState()) };
}

const POINTS = SAMPLE_ROWS.slice(0, 12).map((r) => ({ id: r['id'] as string, x: r['price'] as number, y: r['rating'] as number }));

/** The same chart the cockpit mounts, bound to the same session and its own declared view. */
const chart = (view: Awaited<ReturnType<typeof deskWithAStory>>['view']) => (
  <VizScatter viewId="scatter" data={POINTS} xField="price" yField="rating" onEmit={(e) => void view.emit('scatter', e, 'brush the stage')} />
);

const brush = (svg: Element): void => {
  fireEvent.pointerDown(svg, { clientX: 60, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
};

describe('the stage over a real session', () => {
  it('tells the session\'s own bookmarks, and a beat moves the cursor to the position it names', async () => {
    const { session, view, post } = await deskWithAStory();
    expect(post.bookmarks.map((b) => b.label)).toEqual(['Start', 'The middle']);
    const { container } = render(
      <StoryStage post={post} session={view} dwellMs={0}>
        {chart(view)}
      </StoryStage>,
    );
    await act(async () => undefined); // the mount's seek, and the refresh it triggers
    expect(session.cursor()).toBe(post.bookmarks[0]!.at);

    const io = FakeIO.all[FakeIO.all.length - 1]!;
    await act(async () => io.cb([{ isIntersecting: true, target: io.els[1]! }]));
    expect(session.cursor()).toBe(post.bookmarks[1]!.at);
    view.dispose();
  });

  it('a brush on the stage lands NO COMMIT — the same gesture on the same chart outside it does', async () => {
    const { session, view, post } = await deskWithAStory();
    const before = session.commits('anywhere').length;

    const staged = render(
      <StoryStage post={post} session={view} dwellMs={0}>
        {chart(view)}
      </StoryStage>,
    );
    await act(async () => undefined);
    brush(staged.container.querySelector('.vzf-story-charts svg')!);
    await act(async () => undefined);
    expect(session.commits('anywhere').length).toBe(before); // the reader browsed; the story is unchanged
    cleanup();

    // the control: the chart is not inert, the STAGE is
    const loose = render(chart(view));
    brush(loose.container.querySelector('svg')!);
    await act(async () => undefined);
    expect(session.commits('anywhere').length).toBe(before + 1);
    view.dispose();
  });
});
