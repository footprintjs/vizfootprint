// @vitest-environment jsdom
/**
 * THE DASHBOARD PAGE — one file, one lens, three honest states.
 *
 * Written from the reader's side against a REAL dashboard and a real payload
 * planted in a real document, for the reason the story page's suite is: the
 * whole claim of the file is that it boots from what is IN it. What is proven
 * here is the pair of differences from its sibling — one lens, and a page that
 * is honest rather than broken when nobody has named a moment yet — plus the
 * two states that must never show a desk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, waitFor } from '@testing-library/react';
import { buildDashboard } from 'vizfootprint/def';
import type { Dashboard } from 'vizfootprint/def';
import type { CommitRecord } from 'vizfootprint/log';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../../src/session/dashboard.fixture.js';
import { DashboardPage } from './DashboardPage.js';
import type { PageLens, StoryPageSession } from './boot.js';
import { encodeStoryPayload, storyPayloadScript, type StoryPayload } from './payload.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;
const freshDashboard = (): Dashboard => buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });
const META = { builtAt: '2026-09-05', data: { via: 'inline' as const, label: '40 rows' } };

/** A desk published with two acts on it and NOTHING named — the wizard's case. */
async function published(extra: Partial<StoryPayload<{ readonly rows: typeof SAMPLE_ROWS }>> = {}): Promise<StoryPayload<{ readonly rows: typeof SAMPLE_ROWS }>> {
  const session = freshDashboard().createSession();
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: { ...cause, intent: 'pick casual' } });
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { ...cause, intent: 'pick formal' } });
  return { log: session.commits('anywhere') as readonly CommitRecord[], bookmarks: [], saved: [], meta: META, data: { rows: SAMPLE_ROWS }, ...extra };
}

/** Plant a payload in the document the way a single-file build — or a wizard publishing itself — does. */
async function plant<D>(payload: StoryPayload<D>): Promise<void> {
  const out = await encodeStoryPayload(payload);
  if (!out.ok) throw new Error(out.sentence);
  document.body.innerHTML = storyPayloadScript(out.text);
}

const open = (): StoryPageSession => freshDashboard().createSession() as unknown as StoryPageSession;

/** The host's lens: the one thing this page does not know how to draw. */
const desk = (lens: PageLens): JSX.Element => (
  <div data-testid="desk" data-commits={lens.view.getState().commits.length}>
    {String(lens.session.commits('anywhere').length)} on the session
  </div>
);

beforeEach(() => {
  (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const settled = async (container: HTMLElement): Promise<void> => {
  await waitFor(() => {
    expect(container.querySelector('[data-vzf="dashboard-page-reading"]')).toBeNull();
  });
};

describe('the three states', () => {
  it('says it is replaying before it says anything else, and offers no desk while it does', async () => {
    await plant(await published());
    const { container } = render(<DashboardPage open={open} desk={desk} />);
    expect(container.querySelector('[data-vzf="dashboard-page-reading"]')?.textContent).toContain('Replaying this page');
    expect(container.querySelector('[data-testid="desk"]')).toBeNull();
    expect(container.querySelector('[data-vzf="dashboard-front"]')).toBeNull();
    await settled(container);
  });

  it('a page carrying no payload shows the sentence and NO desk', async () => {
    document.body.innerHTML = '';
    const { container } = render(<DashboardPage open={open} desk={desk} />);
    await settled(container);
    expect(container.querySelector('[data-vzf="dashboard-page-refused"]')?.textContent).toContain('carries no story payload');
    expect(container.querySelector('[data-testid="desk"]')).toBeNull();
  });

  it('a page taken off the screen while it is still replaying puts nothing back on it', async () => {
    await plant(await published());
    const { container, unmount } = render(<DashboardPage open={open} desk={desk} />);
    expect(container.querySelector('[data-vzf="dashboard-page-reading"]')).not.toBeNull();
    unmount(); // the boot is still in flight
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector('[data-vzf="dashboard-front"]')).toBeNull();
  });

  it('a boot the session refused shows the session\'s own words and NO desk', async () => {
    await plant(await published());
    const { container } = render(
      <DashboardPage
        open={() => {
          throw new Error('the definition did not build');
        }}
        desk={desk}
      />,
    );
    await settled(container);
    expect(container.querySelector('[data-vzf="dashboard-page-refused"]')?.textContent).toContain('the definition did not build');
    expect(container.querySelector('[data-testid="desk"]')).toBeNull();
  });
});

describe('the desk, and what the page says above it', () => {
  it('replays the acts, mounts the ONE lens over the same session, and says what the file carries', async () => {
    await plant(await published());
    const { container } = render(<DashboardPage open={open} desk={desk} className="mine" />);
    await settled(container);

    const cell = container.querySelector('[data-testid="desk"]');
    expect(cell?.getAttribute('data-commits')).toBe('2');
    expect(cell?.textContent).toContain('2 on the session');
    // one lens: there is no toggle and no path line, because there is no door to fork one
    expect(container.querySelector('[data-vzf="story-lens-explore"]')).toBeNull();
    expect(container.querySelector('[data-vzf="story-front-path"]')).toBeNull();
    expect(container.querySelector('.vzf-story-page.mine')).not.toBeNull();

    const front = container.querySelector('[data-vzf="dashboard-front-data"]')?.textContent ?? '';
    expect(front).toContain('This page carries its data — 40 rows');
    // NOTHING named, and that is honest rather than an empty story
    expect(front).toContain('2 acts replayed, 0 bookmarks named');
    expect(front).toContain('Built 2026-09-05');
    // no title was published with it, so the page names nobody's dashboard
    expect(container.querySelector('.vzf-story-front-title')).toBeNull();
  });

  it('prints the title the page was PUBLISHED with, the host\'s notes, and every record a restore refused', async () => {
    const payload = await published();
    await plant({
      ...payload,
      bookmarks: [{ id: 'b9', name: 'from another desk', commitId: 'nowhere', by: 'user', at: '2026-09-05T00:00:00.000Z' }],
      meta: { ...META, title: 'the dresses desk', notes: ['the rows were re-typed by hand'] },
    });
    const { container } = render(<DashboardPage open={open} desk={desk} />);
    await settled(container);

    expect(container.querySelector('.vzf-story-front-title')?.textContent).toBe('the dresses desk');
    expect(container.querySelector('.vzf-story-front-note')?.textContent).toBe('the rows were re-typed by hand');
    expect(container.querySelector('.vzf-story-front-refused')?.textContent).toContain('no commit "nowhere" in the log');
    // the beat that could not come back is not a beat; the desk is still drawn
    expect(container.querySelector('[data-testid="desk"]')).not.toBeNull();
  });
});
