/**
 * The saved-picture DOORS over a polled server: naming, renaming and applying
 * all POST to `/api/saved` and read the SESSION's own answer back. Naming lands
 * no commit — it is not a dispatch — and a refusal comes back as the sentence
 * the session gave, never a fabricated one.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, pollingSource, type RawPollState } from './sessionView.js';

const RAW: RawPollState = {
  records: [],
  defaultTable: 'data',
  views: [],
  activeSelections: [{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', commitId: 's1' }],
  columns: { data: [] },
  cursor: null,
  head: null,
  saved: [{ id: 'p1', name: 'Formal wear', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }], by: 'user', at: '2026-01-01T00:00:00.000Z' }],
};

function fetchOf(answer: unknown = { ok: true }) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
    posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return { ok: true, json: async () => answer } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, posts };
}

describe('the saved-picture doors over a poll source', () => {
  it('naming posts the whole live picture by default (one view when asked); a blank name never reaches the wire', async () => {
    const { impl, posts } = fetchOf({ ok: true, saved: { id: 'p2', name: 'coastal' } });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.saveSelection('  coastal ')).toEqual({ ok: true });
    expect(await view.saveSelection('one view', { viewId: 'bar' })).toEqual({ ok: true });
    expect(await view.saveSelection('   ')).toEqual({ ok: false, sentence: 'a saved selection needs a name' });
    expect(posts.map((p) => [p.url, p.body])).toEqual([
      ['/api/saved', { action: 'save', name: 'coastal', source: { live: 'all' } }],
      ['/api/saved', { action: 'save', name: 'one view', source: { viewId: 'bar' } }],
    ]);
    view.dispose();
  });

  it('a refusal comes back as the sentence the session gave', async () => {
    const { impl } = fetchOf({ ok: false, rejected: '"coastal" is already saved — rename or forget it first' });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.saveSelection('coastal')).toEqual({ ok: false, sentence: '"coastal" is already saved — rename or forget it first' });
    view.dispose();
  });

  it('renaming and applying address the picture by its ID, and the wire carries its NAME (the library keys by name)', async () => {
    const { impl, posts } = fetchOf({ ok: true, name: 'Formal wear', applied: [{ id: 'c1' }], cleared: [{ id: 'c0' }], refused: [] });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.renameSaved('p1', 'coastal');
    const applied = await view.applySaved('p1', { mode: 'layer' });
    expect(applied).toEqual({ ok: true, name: 'Formal wear', applied: 1, cleared: 1, refused: [] });
    expect(posts.map((p) => p.body)).toEqual([
      { action: 'rename', from: 'Formal wear', to: 'coastal' },
      { action: 'apply', name: 'Formal wear', mode: 'layer' },
    ]);
    view.dispose();
  });

  it('a picture the state does not hold is refused here, before the wire', async () => {
    const { impl, posts } = fetchOf();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.applySaved('p9')).toEqual({ ok: false, sentence: 'no saved selection "p9" is on screen — it may have been forgotten' });
    expect(await view.renameSaved('p9', 'x')).toEqual({ ok: false, sentence: 'no saved selection "p9" is on screen — it may have been forgotten' });
    expect(await view.renameSaved('p1', '  ')).toEqual({ ok: false, sentence: 'a saved selection needs a name' });
    expect(posts).toEqual([]);
    view.dispose();
  });

  it('an unreachable door answers honestly — never a fabricated success, never a fabricated reason', async () => {
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.applySaved('p1')).toEqual({ ok: false, sentence: 'the saved-selection door answered 503' });
    view.dispose();
  });

  it('a door that says only "ok" is believed about the OUTCOME and quiet about the detail', async () => {
    // The session's own answer names the picture and lists what landed, what was
    // cleared and what could not land. A server is free to send less. When it
    // does, the cockpit reports an apply that happened with nothing to show —
    // never a fabricated count, and never a refusal it was not given.
    const { impl } = fetchOf({ ok: true });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.applySaved('p1')).toEqual({ ok: true, name: 'Formal wear', applied: 0, cleared: 0, refused: [] });
    view.dispose();
  });

  it('a door that cannot be REACHED at all says so too — a throw is not a refusal with no words', async () => {
    // The 503 above is the door answering. This is the door not being there:
    // the network itself throws, so there is no status to quote. A fabricated
    // "refused" would be worse than either, because it would name a decision
    // nobody made.
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.applySaved('p1')).toEqual({ ok: false, sentence: 'could not reach the saved-selection door' });
    expect(await view.saveSelection('coastal')).toEqual({ ok: false, sentence: 'could not reach the saved-selection door' });
    view.dispose();
  });

  it('a door that refuses with no words says SO, rather than inventing a reason', async () => {
    const { impl } = fetchOf({ ok: false });
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(await view.applySaved('p1')).toEqual({ ok: false, sentence: 'the apply was refused and the session gave no reason' });
    view.dispose();
  });
});
