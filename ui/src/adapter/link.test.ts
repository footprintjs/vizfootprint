import { describe, it, expect, vi } from 'vitest';
import { createSessionView, pollingSource, type RawPollState } from './sessionView.js';

/** Layer 4 — the adapter's `link` door: one edge in, one dispatch out; null = back to the rule. */
const RAW: RawPollState = { records: [], defaultTable: 'data', views: [], activeSelections: [], columns: { data: [] }, cursor: null, head: null };

describe('link — the matrix editor\'s one door', () => {
  function fetchOf() {
    const posts: Record<string, unknown>[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => RAW } as unknown as Response;
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, posts };
  }
  it('posts the link verb with the edge; a mapping rides along only when given; a null response says back to the rule', async () => {
    const { impl, posts } = fetchOf();
    const view = createSessionView(pollingSource({ fetchImpl: impl }));
    await view.refresh();
    await view.link({ source: 'map', kind: 'point', target: 'bar', response: 'highlight' });
    await view.link({ source: 'map', kind: 'point', target: 'table', response: 'mirror', mapping: [{ from: 'region', to: 'area' }] }, 'same state');
    await view.link({ source: 'map', kind: 'point', target: 'bar', response: null });
    expect(posts).toEqual([
      { verb: 'link', source: 'map', kind: 'point', target: 'bar', response: 'highlight', intent: 'map point → bar: highlight' },
      { verb: 'link', source: 'map', kind: 'point', target: 'table', response: 'mirror', mapping: [{ from: 'region', to: 'area' }], intent: 'same state' },
      { verb: 'link', source: 'map', kind: 'point', target: 'bar', response: null, intent: 'map point → bar: back to the rule' },
    ]);
    view.dispose();
  });
});
