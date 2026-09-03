/**
 * The mention world is built from what the SERVER sent, and a server is not the
 * store. The library's own store cannot hold two pictures under one name — it
 * refuses a duplicate at save, at rename and at restore — so a session source
 * can never produce this. A POLL source can: `/api/state` is a wire, and a wire
 * carries whatever the other end put on it.
 *
 * So the first-wins guard in `mentionWorldOf` is not dead code guarding an
 * impossible state; it is the adapter refusing to let a malformed answer decide
 * which picture a person's words point at. First row wins, which is the same one
 * the picker offers for `@[name]`, so what someone sees and what they get agree.
 */
import { describe, it, expect } from 'vitest';
import { createSessionView, pollingSource, type RawPollState } from '../adapter/sessionView.js';
import { mentionWorldOf } from './linkables.js';

const picture = (id: string, name: string) => ({
  id,
  name,
  conditions: [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }],
  by: 'user' as const,
  at: '2026-01-01T00:00:00.000Z',
});

const RAW: RawPollState = {
  records: [],
  defaultTable: 'data',
  views: [],
  activeSelections: [],
  columns: { data: [] },
  cursor: null,
  head: null,
  // two pictures, one name — only a wire can say this
  saved: [picture('p1', 'coastal'), picture('p2', 'coastal')],
};

describe('mentionWorldOf over a wire that repeats a name', () => {
  it('resolves the name to the FIRST picture, and never to the second', async () => {
    const impl = (async () => ({ ok: true, json: async () => RAW })) as unknown as typeof fetch;
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();

    const world = mentionWorldOf(view.getState());
    expect(world.saved.get('coastal')).toBe('p1');
    expect(world.saved.size).toBe(1);
    view.dispose();
  });
});
