/**
 * Saving a live selection under a name = a note on its commit, through the
 * ordinary dispatch door; nothing live, or an empty name, posts nothing.
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
};

function fetchOf() {
  const posts: Record<string, unknown>[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
    posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, posts };
}

describe('saveSelection', () => {
  it('posts one annotate naming the selection commit; a view with nothing live, or a blank name, posts nothing', async () => {
    const { impl, posts } = fetchOf();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    expect(view.getState().selections[0]?.commitId).toBe('s1');
    await view.saveSelection('bar', '  Formal wear ');
    await view.saveSelection('map', 'nothing live here');
    await view.saveSelection('bar', '   ');
    expect(posts).toEqual([{ verb: 'annotate', target: 's1', note: 'Formal wear', intent: 'save Formal wear' }]);
    view.dispose();
  });
});
