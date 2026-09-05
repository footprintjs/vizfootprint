// @vitest-environment jsdom
/**
 * THE STAGE — a story's beats over ONE live session.
 *
 * Written from the reader's side: what scrolling does to the session, what a
 * citation does, what the stage says when the SESSION refuses a beat (its
 * sentence, carried — never one written here), and what a gesture on the figure
 * is guaranteed not to do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { mapPollState } from '../../adapter/sessionView.js';
import type { RawPollState } from '../../adapter/sessionView.js';
import type { SessionViewState } from '../../adapter/types.js';
import { toStory } from '../toStory.js';
import type { StoryPost } from '../toStory.js';
import { StoryStage } from './StoryStage.js';

const rec = (id: string, parent: string | null, viewId: string, field: string, value: unknown, intent?: string): RawPollState['records'][number] =>
  ({ id, parent, viewId, kind: 'point', field, value, cause: { requestedBy: 'user', ...(intent !== undefined ? { intent } : {}) } }) as RawPollState['records'][number];

const caption = (refs: readonly unknown[]): RawPollState['records'][number] =>
  rec('6', '5', 'prose:dashboard', 'caption', { text: 'Formal leads, as it did in the spike week.', author: { kind: 'agent' }, refs }, 'summarise');

// main: 1 · 2 → 3 (bookmark b1 "Start" at 2) → 4 · 5 · 6 (the caption that cites) → 7 (bookmark b2 "Formal" at 6)
//       → 8 → 9 (bookmark b3 "End" at 8).   side: 20 forks off 1 — another path entirely.
const RAW = (refs: readonly unknown[]): RawPollState => ({
  defaultTable: 'data',
  records: [
    rec('1', null, 'bar', 'category', 'Casual', 'pick casual'),
    rec('2', '1', 'bar', 'colour', 'blue', 'pick blue'),
    rec('3', '2', 'bookmark:0', '__bookmark__', 'Start'),
    rec('4', '3', 'bar', 'category', 'Formal', 'pick formal'),
    rec('5', '4', 'scatter', 'price', [10, 20], 'brush the top'),
    caption(refs),
    rec('7', '6', 'bookmark:1', '__bookmark__', 'Formal'),
    rec('8', '7', 'map', 'region', 'West', 'colour the map'),
    rec('9', '8', 'bookmark:2', '__bookmark__', 'End'),
    rec('20', '1', 'bar', 'category', 'Sport', 'elsewhere'),
  ],
  bookmarks: [
    { id: 'b1', label: 'Start', commitId: '3', at: '2', ts: 1 },
    { id: 'b2', label: 'Formal', commitId: '7', at: '6', ts: 6 },
    { id: 'b3', label: 'End', commitId: '9', at: '8', ts: 8 },
  ],
  saved: [{ id: 'p1', name: 'coastal', conditions: [], by: 'user', at: '2026-09-01T00:00:00Z' } as never],
  head: '9',
  paths: { current: 'main', detachedAt: null, list: [{ name: 'main', tip: '9', steps: 9, lastTs: 9, active: true }] },
});

/** "Formal" cites the act that made it true; "the spike week" cites the first bookmark. */
const CITES = [
  { span: [0, 6], commit: '4', label: 'Formal' },
  { span: [27, 41], bookmark: 'b1', label: 'the spike week' },
];

const stateOf = (refs: readonly unknown[] = CITES): SessionViewState => mapPollState(RAW(refs));
const postOf = (refs: readonly unknown[] = CITES): StoryPost => toStory(stateOf(refs), { declared: { title: 'Catalogue desk' } });

/**
 * A session narrowed to what the stage uses. `lost` are commits it no longer
 * holds — and it REFUSES them the way the real session does (judged, nothing
 * moved, its own sentence), because that answer is the only judgement the stage
 * has.
 */
function fakeSession(lost: readonly string[] = []) {
  const commits = stateOf().commits.filter((c) => !lost.includes(c.id)).map((c) => ({ id: c.id }));
  const seek = vi.fn((commitId: string) => (commits.some((c) => c.id === commitId) ? { ok: true as const } : { ok: false as const, sentence: `no commit "${commitId}" to seek to` }));
  return { seek, getState: () => ({ commits }) };
}

// ── jsdom has none of the scroll machinery storydeck's lens is built on ──
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
const scrolled = vi.fn();

beforeEach(() => {
  FakeIO.all = [];
  scrolled.mockClear();
  (globalThis as Record<string, unknown>)['IntersectionObserver'] = FakeIO;
  (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = scrolled;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
});

/** The reader scrolled a beat past the viewport centre (and the seek's answer came back). */
const goBeat = async (index: number): Promise<void> => {
  const io = FakeIO.all[FakeIO.all.length - 1]!;
  await act(async () => {
    io.cb([{ isIntersecting: true, target: io.els[index]! }]);
  });
};
/** Let the pending answers settle (a seek is asynchronous, even when its source is not). */
const settle = async (): Promise<void> => {
  await act(async () => undefined);
};
const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const charts = <div data-testid="charts">the dashboard</div>;

const mount = async (post: StoryPost, session: ReturnType<typeof fakeSession>, dwellMs?: number) => {
  const rendered = render(
    <StoryStage post={post} session={session} {...(dwellMs === undefined ? {} : { dwellMs })}>
      {charts}
    </StoryStage>,
  );
  await settle();
  return rendered;
};

describe('StoryStage — the beats move the session', () => {
  it('mounts one live figure over the scroll lens and lands on the first beat', async () => {
    const session = fakeSession();
    const { container } = render(
      <StoryStage post={postOf()} session={session} className="mine">
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(container.querySelector('.vzf-story-stage.mine')).not.toBeNull();
    expect(container.querySelectorAll('.scrolly-beat')).toHaveLength(3); // one bookmark, one beat
    expect(container.querySelectorAll('[data-testid="charts"]')).toHaveLength(1); // ONE mount, not one per beat
    expect(container.querySelector('.scrolly-stage .vzf-story-charts')).not.toBeNull();
    expect(session.seek.mock.calls.flat()).toEqual(['2']); // the first bookmark's position — a jump, not a replay
  });

  it('replays a forward step through each act in order, holding each for the dwell', async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    await mount(postOf(), session, 100);
    await goBeat(1);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '4']); // the first act lands at once
    await tick(100);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '4', '5']);
    await tick(100);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '4', '5', '6']); // ending on the position the bookmark names
    await tick(1000);
    expect(session.seek).toHaveBeenCalledTimes(4); // and then it stops
  });

  it('goes back, and jumps, in ONE seek — a story runs one way', async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    await mount(postOf(), session, 100);
    await goBeat(2); // a jump of two
    expect(session.seek.mock.calls.flat()).toEqual(['2', '8']);
    await goBeat(1); // backwards
    expect(session.seek.mock.calls.flat()).toEqual(['2', '8', '6']);
    await tick(1000);
    expect(session.seek).toHaveBeenCalledTimes(3);
  });

  it('a replay in flight is dropped the moment the reader moves on', async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    await mount(postOf(), session, 100);
    await goBeat(1); // starts replaying 4 → 5 → 6
    await goBeat(0); // the reader scrolled back before it finished
    await tick(1000);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '4', '2']); // no '5', no '6'
  });

  it('a dwell of zero lands on the beat and replays nothing', async () => {
    const session = fakeSession();
    await mount(postOf(), session, 0);
    await goBeat(1);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '6']);
  });
});

describe('StoryStage — the session judges, the stage carries the answer', () => {
  it('shows the SESSION\'s own refusal for a beat it cannot reach — the stage checks nothing first', async () => {
    const session = fakeSession(['6']);
    await mount(postOf(), session, 0);
    await goBeat(1);
    // asked, refused, and the words are the session's — not a sentence written in the stage
    expect(session.seek.mock.calls.flat()).toEqual(['2', '6']);
    expect(screen.getByText('no commit "6" to seek to')).toBeTruthy();
  });

  it('shows a refusal under a beat that cites nothing, with no strip above it', async () => {
    const session = fakeSession(['2']);
    const { container } = await mount(postOf(), session, 0);
    expect(screen.getByText('no commit "2" to seek to')).toBeTruthy();
    expect(container.querySelector('.vzf-story-cites')).toBeNull();
  });

  it('leaves a lost WAYPOINT out of the plan rather than asking for it — a plan is not a judgement', async () => {
    vi.useFakeTimers();
    const session = fakeSession(['5']);
    await mount(postOf(), session, 100);
    await goBeat(1);
    await tick(1000);
    expect(session.seek.mock.calls.flat()).toEqual(['2', '4', '6']);
    expect(screen.queryByText(/no commit/)).toBeNull(); // and it says nothing about the one it skipped
  });

  it('refuses a beat whose section the story does not tell — a fact about the POST, so the stage says it', async () => {
    const post = postOf();
    const session = fakeSession();
    await mount({ ...post, bookmarks: post.bookmarks.slice(0, 1) }, session, 0);
    await goBeat(1);
    expect(screen.getByText(/the story does not tell/)).toBeTruthy();
    expect(session.seek.mock.calls.flat()).toEqual(['2']); // nothing was asked for
  });

  it('clears the refusal once a beat it can honour comes back', async () => {
    const session = fakeSession(['6']);
    await mount(postOf(), session, 0);
    await goBeat(1);
    expect(screen.queryByText(/no commit/)).not.toBeNull();
    await goBeat(2);
    expect(screen.queryByText(/no commit/)).toBeNull();
  });

  it('says so when the seek never reached the session at all', async () => {
    const session = { getState: () => ({ commits: [{ id: '2' }] }), seek: vi.fn(() => Promise.reject(new Error('offline'))) };
    render(
      <StoryStage post={postOf()} session={session}>
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(screen.getByText('the seek did not reach the session')).toBeTruthy();
  });

  it('never lets an older move\'s answer write over a newer one', async () => {
    const pending: { resolve: (o: unknown) => void; reject: (e: unknown) => void }[] = [];
    const session = {
      getState: () => ({ commits: stateOf().commits.map((c) => ({ id: c.id })) }),
      seek: vi.fn(() => new Promise<unknown>((resolve, reject) => pending.push({ resolve, reject }))),
    };
    render(
      <StoryStage post={postOf()} session={session as never} dwellMs={0}>
        {charts}
      </StoryStage>,
    );
    await goBeat(1); // move 2, while move 1 is still in flight
    await act(async () => pending[0]!.resolve({ ok: false, sentence: 'stale refusal' }));
    expect(screen.queryByText('stale refusal')).toBeNull();
    await goBeat(2); // move 3, while move 2 is still in flight
    await act(async () => {
      pending[1]!.reject(new Error('stale failure'));
    });
    expect(screen.queryByText('the seek did not reach the session')).toBeNull();
    await act(async () => pending[2]!.resolve({ ok: true })); // and the current one still lands
  });
});

describe('StoryStage — the citation strip', () => {
  const atSecondBeat = async (post = postOf(), lost: readonly string[] = []) => {
    const session = fakeSession(lost);
    const rendered = await mount(post, session, 0);
    await goBeat(1);
    session.seek.mockClear();
    return { session, ...rendered };
  };

  it('shows what this beat\'s words REST ON, numbered and named — never the words, which are in the flow', async () => {
    const { container } = await atSecondBeat();
    expect(container.querySelector('.vzf-story-cites-lead')?.textContent).toBe('this beat cites:');
    const cites = container.querySelectorAll('.vzf-story-cite');
    expect([...cites].map((c) => c.textContent)).toEqual(['1Formal', '2the spike week']);
    expect(cites[0]!.getAttribute('title')).toBe('go to where "Formal" stands in this story');
    // the sentence itself is nowhere under the figure — it is in the narrative, once
    expect(container.querySelector('.vzf-story-caption')?.textContent).not.toContain('Formal leads, as it did');
  });

  it('a beat that cites nothing shows nothing under the figure', async () => {
    const { container } = await mount(postOf(), fakeSession(), 0);
    expect(container.querySelector('.vzf-story-caption')).toBeNull();
  });

  it('a citation inside this beat seeks the act it names and leaves the reader where they are', async () => {
    const { container, session } = await atSecondBeat();
    await act(async () => fireEvent.click(container.querySelectorAll('.vzf-story-anchor')[0]!));
    expect(session.seek.mock.calls.flat()).toEqual(['4']);
    expect(scrolled).toHaveBeenCalled();
  });

  it('a citation in another section takes the narrative with it, and the arrival does not seek on top of it', async () => {
    const { container, session } = await atSecondBeat();
    await act(async () => fireEvent.click(container.querySelectorAll('.vzf-story-anchor')[1]!)); // "the spike week" → bookmark 1
    expect(session.seek.mock.calls.flat()).toEqual(['2']);
    await goBeat(0); // the scroll the click asked for arrives
    expect(session.seek).toHaveBeenCalledTimes(1); // the citation already settled that beat
    await goBeat(1);
    await goBeat(0); // an ordinary arrival at the same beat still moves
    expect(session.seek).toHaveBeenCalledTimes(3);
  });

  it('still seeks on a page that cannot scroll — a story that moved is not a story that did not', async () => {
    delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
    const { container, session } = await atSecondBeat();
    await act(async () => fireEvent.click(container.querySelectorAll('.vzf-story-anchor')[1]!));
    expect(session.seek.mock.calls.flat()).toEqual(['2']);
  });

  it('carries the session\'s refusal when a citation names a commit it no longer holds', async () => {
    const { container, session } = await atSecondBeat(postOf(), ['4']);
    await act(async () => fireEvent.click(container.querySelectorAll('.vzf-story-anchor')[0]!));
    expect(session.seek.mock.calls.flat()).toEqual(['4']);
    expect(screen.getByText('no commit "4" to seek to')).toBeTruthy();
  });

  it('refuses a citation that points at a section this post does not carry', async () => {
    const post = postOf();
    const ghosted = {
      ...post,
      sections: post.sections.map((s) => (s.refs === undefined ? s : { ...s, refs: s.refs.map((r) => ({ ...r, at: { section: 'ghost' } })) })),
    };
    const { container, session } = await atSecondBeat(ghosted);
    await act(async () => fireEvent.click(container.querySelectorAll('.vzf-story-anchor')[0]!));
    expect(screen.getByText(/is cited at a part of this story that is not here/)).toBeTruthy();
    expect(session.seek).not.toHaveBeenCalled();
  });

  it('names a citation that stands at no moment and gives it NO anchor — a saved picture is logic, not a step', async () => {
    const { container } = await atSecondBeat(postOf([{ span: [0, 6], saved: 'p1', label: 'Formal' }]));
    expect(container.querySelectorAll('.vzf-story-anchor')).toHaveLength(0);
    expect(container.querySelector('.vzf-story-cite-nowhere')?.textContent).toBe('1Formal');
  });

  it('joins what it could not show to the strip as one quiet line, and links none of it', async () => {
    const { container } = await atSecondBeat(postOf([{ span: [0, 6], commit: '20', label: 'the detour' }]));
    expect(container.querySelector('.vzf-story-dropped')?.textContent).toBe('cited and not shown — "the detour" (20) is on another path');
    expect(container.querySelector('.vzf-story-dropped a, .vzf-story-dropped button')).toBeNull();
    expect(container.querySelector('.vzf-story-cites')).toBeNull(); // nothing landed, so nothing is anchored
  });
});

describe('StoryStage — a reader browses, and authors nothing', () => {
  it('swallows a pointer, a click and an activation key before the chart under it sees one', async () => {
    const gesture = vi.fn();
    const session = fakeSession();
    const { container } = render(
      <StoryStage post={postOf()} session={session}>
        <svg data-testid="chart" tabIndex={0} onPointerDown={gesture} onMouseDown={gesture} onClick={gesture} onKeyDown={gesture} />
      </StoryStage>,
    );
    await settle();
    const chart = container.querySelector('[data-testid="chart"]')!;
    fireEvent.pointerDown(chart, { clientX: 100, pointerId: 1 });
    fireEvent.mouseDown(chart, { clientX: 100 });
    fireEvent.click(chart);
    fireEvent.keyDown(chart, { key: 'Enter' });
    fireEvent.keyDown(chart, { key: ' ' });
    expect(gesture).not.toHaveBeenCalled();
    expect(container.querySelector('[data-readonly="true"]')).not.toBeNull();
  });

  it('leaves the keys that only NAVIGATE alone — a paused stage is not a keyboard trap', async () => {
    const gesture = vi.fn();
    render(
      <StoryStage post={postOf()} session={fakeSession()}>
        <svg data-testid="chart" tabIndex={0} onKeyDown={gesture} />
      </StoryStage>,
    );
    await settle();
    fireEvent.keyDown(screen.getByTestId('chart'), { key: 'Tab' });
    fireEvent.keyDown(screen.getByTestId('chart'), { key: 'Escape' });
    expect(gesture).toHaveBeenCalledTimes(2);
  });
});

describe('StoryStage — a story with no beats', () => {
  const empty = (): StoryPost => toStory(mapPollState({ defaultTable: 'data', records: [], bookmarks: [], head: null }));

  it('says so, rather than drawing an empty grid', async () => {
    const { container } = render(
      <StoryStage post={empty()} session={fakeSession()} className="mine">
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(container.querySelector('.scrolly')).toBeNull();
    expect(container.querySelector('.vzf-story-stage.mine')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('No bookmarks named on this lineage yet');
  });

  it('lets the host say it in its own words', async () => {
    render(
      <StoryStage post={empty()} session={fakeSession()} emptyNote={<span>name a bookmark first</span>}>
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(screen.getByRole('status').textContent).toBe('name a bookmark first');
  });
});

describe('StoryStage — the door on a beat', () => {
  it('draws the host\'s door for the beat the reader is on, OUTSIDE the read-only guard', async () => {
    const gesture = vi.fn();
    const opened = vi.fn();
    const session = fakeSession();
    const { container } = render(
      <StoryStage post={postOf()} session={session} beatDoor={(bookmark) => <button type="button" data-testid="door" onClick={() => opened(bookmark.label)}>explore from {bookmark.label}</button>}>
        <svg data-testid="chart" onClick={gesture} />
      </StoryStage>,
    );
    await settle();
    expect(screen.getByTestId('door').textContent).toBe('explore from Start');
    await goBeat(1);
    expect(screen.getByTestId('door').textContent).toBe('explore from Formal');
    // the guard is on the CHARTS; a door is not a gesture on the charts, so it lands
    fireEvent.click(screen.getByTestId('chart'));
    fireEvent.click(screen.getByTestId('door'));
    expect(gesture).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledWith('Formal');
  });

  it('offers NO door on a beat whose bookmark this story does not carry — never a broken one', async () => {
    const post = postOf();
    const short: StoryPost = { ...post, bookmarks: post.bookmarks.slice(0, 1) };
    const { container } = render(
      <StoryStage post={short} session={fakeSession()} beatDoor={() => <button type="button" data-testid="door" />}>
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(screen.getAllByTestId('door')).toHaveLength(1); // the first beat has its bookmark
    await goBeat(1);
    expect(screen.queryByTestId('door')).toBeNull();
    expect(container.querySelector('.vzf-story-refusal')?.textContent).toContain('the story does not tell');
  });

  it('shows no strip at all when there is nothing to say and no door to offer', async () => {
    const { container } = render(
      <StoryStage post={postOf([])} session={fakeSession()}>
        {charts}
      </StoryStage>,
    );
    await settle();
    expect(container.querySelector('.vzf-story-caption')).toBeNull();
  });
});
