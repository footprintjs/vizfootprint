// @vitest-environment jsdom
/**
 * THE BOOT — a payload becomes a session, or nothing at all.
 *
 * Against a REAL dashboard and a real log, because every claim here is about
 * the library's own doors: the order the three restores happen in, what a
 * refused replay leaves behind (nothing), and what a refused RECORD leaves
 * behind (a sentence, and the rest of the story).
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from 'vizfootprint/def';
import type { Dashboard } from 'vizfootprint/def';
import type { CommitRecord } from 'vizfootprint/log';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../../src/session/dashboard.fixture.js';
import { bootStory, type StoryPageSession } from './boot.js';
import type { StoryPayload } from './payload.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

const freshDashboard = (): Dashboard => buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });

const meta = { builtAt: '2026-09-05T00:00:00.000Z', data: { via: 'inline' as const, label: '40 rows' } };

/**
 * A desk with a story on it, exported the way a build would export it: the
 * commits, the bookmark records and the saved pictures, all whole.
 */
async function published(): Promise<StoryPayload<{ readonly rows: typeof SAMPLE_ROWS }>> {
  const session = freshDashboard().createSession();
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', cause: { ...cause, intent: 'pick casual' } });
  session.saveSelection('the casual picture', { live: 'all' }, 'user');
  session.bookmark('Start');
  await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { ...cause, intent: 'pick formal' } });
  await session.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], cause: { ...cause, intent: 'brush the middle' } });
  session.bookmark('The middle');
  return {
    log: session.commits('anywhere') as readonly CommitRecord[],
    bookmarks: session.bookmarks().map((b) => ({ ...b })),
    saved: session.saved().map((s) => ({ ...s })),
    meta,
    data: { rows: SAMPLE_ROWS },
  };
}

const open = () => freshDashboard().createSession() as unknown as StoryPageSession;

describe('bootStory — the payload becomes a desk with a story on it', () => {
  it('restores the pictures, replays the log, restores the bookmarks, and tells the story', async () => {
    const payload = await published();
    const boot = await bootStory(payload, open, { story: { declared: { title: 'the dresses desk' } }, payloadBytes: 4096 });
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    expect(boot.front.landed).toBe(payload.log.length);
    expect(boot.front.bookmarks).toBe(2);
    expect(boot.front.refused).toEqual([]);
    expect(boot.front.payload).toBe('4.0 kB');
    expect(boot.front.size).toMatch(/kB$/);
    expect(boot.front.builtAt).toBe(meta.builtAt);
    expect(boot.post.sections.map((s) => s.heading)).toEqual(['Start', 'The middle']);
    // the ids came back, which is what makes a citation that names one still resolve
    expect(boot.view.getState().bookmarks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(boot.view.getState().saved.map((s) => s.name)).toEqual(['the casual picture']);
    // and the session is where the walk left it
    expect(boot.view.getState().cursor).toBe(payload.log[payload.log.length - 1]?.id);
  });

  it('says no size at all when the page carries no data, and takes a payload that saved no pictures', async () => {
    const payload = await published();
    const { data: _dropped, saved: _none, ...noData } = payload;
    const boot = await bootStory(noData, open, { payloadBytes: 1024 });
    expect(boot.ok && boot.front.size).toBeUndefined();
    expect(boot.ok && boot.front.payload).toBe('1.0 kB');
  });

  it('carries the host\'s own notes through to the front matter', async () => {
    const payload = await published();
    const boot = await bootStory({ ...payload, meta: { ...meta, notes: ['the desk did not vouch for who named these beats'] } }, open, { payloadBytes: 1024 });
    expect(boot.ok && boot.front.notes).toEqual(['the desk did not vouch for who named these beats']);
  });
});

describe('bootStory — all-or-nothing', () => {
  it('a REFUSED replay leaves no session and no story, in the session\'s own words', async () => {
    const payload = await published();
    // a session that already holds commits: a replay is a beginning, not a merge
    const used = freshDashboard().createSession();
    await used.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause });
    const boot = await bootStory(payload, () => used as unknown as StoryPageSession, { payloadBytes: 1024 });
    expect(boot.ok).toBe(false);
    if (boot.ok) return;
    expect(boot.sentence).toContain('a replay is a beginning, not a merge');
  });

  it('a replay refused with no detail still says the code rather than nothing', async () => {
    const payload = await published();
    const stub = {
      restoreSaved: () => ({ restored: [], refused: [], reidentified: [] }),
      replay: () => Promise.resolve({ ok: false as const, gap: { code: 'guard-failed' as const, op: 'replay' as const, ts: 0, at: null } }),
    };
    const boot = await bootStory(payload, () => stub as unknown as StoryPageSession, { payloadBytes: 1024 });
    expect(boot.ok).toBe(false);
    if (!boot.ok) expect(boot.sentence).toContain('guard-failed');
  });

  it('a door that throws is a refusal, not a crash', async () => {
    const payload = await published();
    const boot = await bootStory(
      payload,
      () => {
        throw new Error('the snapshot did not decode');
      },
      { payloadBytes: 1024 },
    );
    expect(boot.ok).toBe(false);
    if (!boot.ok) expect(boot.sentence).toContain('the snapshot did not decode');
  });

  it('a door that throws something that is not an Error still says what it said', async () => {
    const payload = await published();
    const boot = await bootStory(payload, () => {
      throw 'no rows'; // eslint-disable-line @typescript-eslint/only-throw-error
    }, { payloadBytes: 1024 });
    expect(boot.ok && 'x').toBe(false);
    if (!boot.ok) expect(boot.sentence).toContain('no rows');
  });
});

describe('bootStory — a record that could not come back is NAMED', () => {
  it('names the bookmark and the picture the restore refused, and tells the rest of the story', async () => {
    const payload = await published();
    const boot = await bootStory(
      {
        ...payload,
        bookmarks: [...payload.bookmarks, { id: 'b9', name: 'from another desk', commitId: 'nowhere', by: 'user', at: meta.builtAt }],
        saved: [...(payload.saved ?? []), { id: 'p9', name: 'nothing at all', conditions: [], by: 'user', at: meta.builtAt }],
      },
      open,
      { payloadBytes: 1024 },
    );
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    expect(boot.front.refused).toEqual([
      'the picture “nothing at all” did not come back: a saved selection needs at least one condition',
      'the bookmark “from another desk” did not come back: no commit "nowhere" in the log',
    ]);
    expect(boot.front.bookmarks).toBe(2); // the two that DID come back are the story's beats
    expect(boot.post.sections).toHaveLength(2);
  });
});
