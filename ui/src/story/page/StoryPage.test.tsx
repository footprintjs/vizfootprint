// @vitest-environment jsdom
/**
 * THE PAGE — one file, three honest states, two lenses, and a door on every beat.
 *
 * Written from the reader's side, against a REAL dashboard and a real payload
 * planted in a real document, because the whole claim of the file is that it
 * boots from what is in it. The three states are asserted as states — a page
 * that offered a way in while it was still replaying, or that showed an empty
 * stage when the replay was refused, would be the one place in a library about
 * saying what you know that quietly implied something else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { buildDashboard } from 'vizfootprint/def';
import type { Dashboard } from 'vizfootprint/def';
import type { CommitRecord } from 'vizfootprint/log';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../../src/session/dashboard.fixture.js';
import { StoryPage } from './StoryPage.js';
import type { StoryLens } from './StoryPage.js';
import type { StoryPageSession } from './boot.js';
import { encodeStoryPayload, storyPayloadScript, type StoryPayload } from './payload.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;
const freshDashboard = (): Dashboard => buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });
const META = { builtAt: '2026-09-05', data: { via: 'inline' as const, label: '40 rows' } };

async function published(): Promise<StoryPayload<{ readonly rows: typeof SAMPLE_ROWS }>> {
  const session = freshDashboard().createSession();
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: { ...cause, intent: 'pick casual' } });
  session.bookmark('Start');
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { ...cause, intent: 'pick formal' } });
  session.bookmark('The middle');
  return {
    log: session.commits('anywhere') as readonly CommitRecord[],
    bookmarks: session.bookmarks().map((b) => ({ ...b })),
    saved: [],
    meta: META,
    data: { rows: SAMPLE_ROWS },
  };
}

/** Plant a payload in the document the way a single-file build does. */
async function plant<D>(payload: StoryPayload<D>): Promise<void> {
  const out = await encodeStoryPayload(payload);
  if (!out.ok) throw new Error(out.sentence);
  document.body.innerHTML = storyPayloadScript(out.text);
}

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

beforeEach(() => {
  FakeIO.all = [];
  (globalThis as Record<string, unknown>)['IntersectionObserver'] = FakeIO;
  (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
});

/**
 * The boot is genuinely asynchronous — the payload goes through a gzip stream,
 * which is not a microtask — so waiting one tick is not waiting. Wait for the
 * page to have LEFT the reading state, which is the only thing "settled" means.
 */
const settled = async (container: HTMLElement): Promise<void> => {
  await waitFor(() => {
    expect(container.querySelector('[data-vzf="story-page-reading"]')).toBeNull();
  });
};

/** The reader scrolled a beat past the viewport centre — storydeck's own signal. */
const goBeat = async (index: number): Promise<void> => {
  const io = FakeIO.all[FakeIO.all.length - 1]!;
  await act(async () => {
    io.cb([{ isIntersecting: true, target: io.els[index]! }]);
  });
};

const figure = (lens: StoryLens) => <div data-testid="figure">the charts, on path {String(lens.path)}</div>;
/** A stand-in cockpit: it says where it is standing, and it can seek — which is what a time strip does. */
const explore = (lens: StoryLens) => (
  <div data-testid="cockpit">
    the cockpit, on path {String(lens.path)}
    <button type="button" data-testid="rewind" onClick={() => void lens.view.seek(lens.view.getState().commits[0]!.id)}>
      rewind
    </button>
  </div>
);

const mount = (open: () => StoryPageSession = () => freshDashboard().createSession() as unknown as StoryPageSession) =>
  render(<StoryPage open={open} figure={figure} explore={explore} story={{ declared: { title: 'the dresses desk' } }} className="mine" />);

describe('StoryPage — three states, and only one of them is a story', () => {
  it('says it is replaying before it offers anything, and never an empty stage', async () => {
    await plant(await published());
    const { container } = mount();
    expect(container.querySelector('[data-vzf="story-page-reading"]')).not.toBeNull();
    expect(container.querySelector('[data-vzf="story-front"]')).toBeNull();
    await settled(container);
    expect(container.querySelector('[data-vzf="story-front"]')).not.toBeNull();
    expect(container.querySelector('.vzf-story-page.mine')).not.toBeNull();
  });

  it('shows the payload\'s own refusal and NO story when the page carries none', async () => {
    document.body.innerHTML = '';
    const { container } = mount();
    await settled(container);
    expect(container.querySelector('[data-vzf="story-page-refused"]')?.textContent).toContain('carries no story payload');
    expect(container.querySelector('[data-vzf="story-front"]')).toBeNull();
    expect(container.querySelector('.vzf-story-stage')).toBeNull();
  });

  it('mounts the story over the replayed session, with the front matter measured off the file', async () => {
    await plant(await published());
    const { container } = mount();
    await settled(container);
    const front = container.querySelector('[data-vzf="story-front-data"]')?.textContent ?? '';
    expect(front).toContain('This page carries its data — 40 rows');
    expect(front).toMatch(/Its payload is [\d.]+ (B|kB|MB) of this file/);
    expect(front).toMatch(/unpacked/);
    expect(front).toContain('2 acts replayed, 2 beats named');
    expect(front).toContain('Built 2026-09-05');
    expect(container.querySelectorAll('.scrolly-beat').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('figure')).toHaveLength(1); // ONE mount for the whole scroll
  });
});

describe('StoryPage — the door on every beat', () => {
  it('forks a NEW path at the beat the reader is on, and switches to the cockpit', async () => {
    await plant(await published());
    const { container } = mount();
    await settled(container);
    // ONE figure is pinned for the whole scroll, so there is ONE strip and ONE door — the door of
    // the beat the reader is standing on. Scroll to the second beat and it is that beat's door.
    await goBeat(1);
    const door = container.querySelector<HTMLButtonElement>('[data-vzf="story-explore"]')!;
    expect(door.title).toContain('The middle');
    await act(async () => {
      fireEvent.click(door);
    });
    expect(screen.queryByTestId('figure')).toBeNull();
    const cockpit = screen.getByTestId('cockpit').textContent ?? '';
    expect(cockpit).toContain('the cockpit, on path');
    expect(cockpit).not.toContain('null'); // a NAMED path, minted by the session
    expect(container.querySelector('[data-vzf="story-front-path"]')?.textContent).toContain('Your acts land on the path');
    // a seek back inside the cockpit stands off every named path, and the page says THAT instead
    await act(async () => {
      fireEvent.click(screen.getByTestId('rewind'));
    });
    expect(container.querySelector('[data-vzf="story-front-path"]')?.textContent).toContain('off any named path');
    // and back to the story: the beats are the beats that were published, and the path line goes away
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-vzf="story-lens-story"]')!);
    });
    expect(container.querySelector('[data-vzf="story-front-path"]')).toBeNull();
    expect(screen.getAllByTestId('figure')).toHaveLength(1);
  });

  it('a REFUSED fork prints the session\'s reason and leaves the reader in the story', async () => {
    await plant(await published());
    const real = freshDashboard().createSession() as unknown as StoryPageSession;
    const refusing = new Proxy(real, {
      get: (target, key: string) => {
        if (key === 'newPathAt') return () => ({ ok: false as const, gap: { code: 'guard-failed' as const, op: 'newPathAt' as const, detail: 'that name is taken', ts: 0, at: null } });
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as StoryPageSession;
    const { container } = mount(() => refusing);
    await settled(container);
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-vzf="story-explore"]')!);
    });
    expect(container.querySelector('[data-vzf="story-front-refusal"]')?.textContent).toBe('that name is taken');
    expect(screen.getAllByTestId('figure')).toHaveLength(1); // still the story
  });

  it('a refusal with no detail still says the code rather than nothing', async () => {
    await plant(await published());
    const real = freshDashboard().createSession() as unknown as StoryPageSession;
    const refusing = new Proxy(real, {
      get: (target, key: string) => {
        if (key === 'newPathAt') return () => ({ ok: false as const, gap: { code: 'guard-failed' as const, op: 'newPathAt' as const, ts: 0, at: null } });
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as StoryPageSession;
    const { container } = mount(() => refusing);
    await settled(container);
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('[data-vzf="story-explore"]')!);
    });
    expect(container.querySelector('[data-vzf="story-front-refusal"]')?.textContent).toBe('guard-failed');
  });
});

describe('StoryPage — the page a host does not dress', () => {
  it('needs no class of its own, and takes the dwell the host names', async () => {
    await plant(await published());
    const { container } = render(<StoryPage open={() => freshDashboard().createSession() as unknown as StoryPageSession} figure={figure} explore={explore} dwellMs={0} />);
    await settled(container);
    expect(container.querySelector('.vzf-story-page')?.className).toBe('vzf vzf-story-page');
    expect(container.querySelector('.vzf-story-stage')).not.toBeNull();
  });

  it('a page taken off the screen while it is still replaying puts nothing back on it', async () => {
    await plant(await published());
    const { container, unmount } = mount();
    expect(container.querySelector('[data-vzf="story-page-reading"]')).not.toBeNull();
    unmount(); // the boot is still in flight
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector('[data-vzf="story-front"]')).toBeNull();
  });
});

describe('StoryPage — the front matter says what this file is', () => {
  it('says where the data is FETCHED from, and prints the host\'s notes and the restore\'s refusals', async () => {
    const payload = await published();
    const { data: _dropped, ...fetched } = payload;
    await plant({
      ...fetched,
      bookmarks: [...payload.bookmarks, { id: 'b9', name: 'from another desk', commitId: 'nowhere', by: 'user', at: '2026-09-05' }],
      meta: { builtAt: '2026-09-05', data: { via: 'http', at: 'https://example.test/rows.csv' }, notes: ['the desk did not vouch for who named these beats'] },
    });
    const { container } = mount();
    await settled(container);
    const front = container.querySelector('[data-vzf="story-front-data"]')?.textContent ?? '';
    expect(front).toContain('This page fetches its data from https://example.test/rows.csv.');
    expect(front).not.toContain('in this file');
    expect(container.querySelector('.vzf-story-front-note')?.textContent).toContain('did not vouch');
    expect(container.querySelector('.vzf-story-front-refused')?.textContent).toContain('no commit "nowhere" in the log');
  });

  it('says only that it fetches, when the payload does not say from where', async () => {
    const payload = await published();
    const { data: _dropped, ...fetched } = payload;
    await plant({ ...fetched, meta: { builtAt: '2026-09-05', data: { via: 'http' } } });
    const { container } = mount();
    await settled(container);
    expect(container.querySelector('[data-vzf="story-front-data"]')?.textContent).toContain('where the definition says');
  });

  it('a story with no beats yet says so, and names no path nobody is standing on', async () => {
    await plant({ log: [], bookmarks: [], saved: [], meta: META });
    const { container } = mount();
    await settled(container);
    expect(container.querySelector('[data-vzf="story-front-path"]')).toBeNull();
    expect(container.querySelector('.vzf-story-empty')).not.toBeNull();
    expect(container.querySelector('[data-vzf="story-front-data"]')?.textContent).toContain('0 acts replayed, 0 beats named');
  });
});
