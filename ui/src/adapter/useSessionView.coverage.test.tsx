// @vitest-environment jsdom
//
// useSessionView is a thin useSyncExternalStore binding — no branches of its
// own, but 0% covered because nothing renders it. Mount a real store built
// from a poll source (mirroring sessionView.test.ts's fakeFetch pattern) and
// prove the returned state is live: the initial synchronous snapshot, then a
// re-render once the store notifies, then a clean unmount.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { createSessionView, pollingSource, type SessionView, type RawPollState } from './sessionView.js';
import { useSessionView } from './useSessionView.js';

afterEach(cleanup);

const RAW: RawPollState = {
  records: [{ id: '1', parent: null, viewId: 'scatter', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user' } }],
  cursor: '1',
  head: '1',
};

function fakeFetch() {
  const impl = vi.fn(async () => ({ ok: true, json: async () => RAW }) as unknown as Response);
  return impl as unknown as typeof fetch;
}

function Probe({ view }: { view: SessionView }) {
  const state = useSessionView(view);
  return (
    <div>
      <span data-testid="commit-count">{state.commits.length}</span>
      <span data-testid="cursor">{state.cursor ?? 'none'}</span>
    </div>
  );
}

describe('useSessionView', () => {
  it('renders the initial synchronous snapshot, then re-renders once the store notifies', async () => {
    const view = createSessionView(pollingSource({ fetchImpl: fakeFetch() }));
    const { getByTestId } = render(<Probe view={view} />);
    // the store's construction-time refresh() is still pending (fire-and-forget) —
    // the FIRST render must see the synchronous empty snapshot, proving the hook
    // reads getState() directly rather than waiting on anything
    expect(getByTestId('commit-count').textContent).toBe('0');
    expect(getByTestId('cursor').textContent).toBe('none');

    await act(async () => {
      await view.refresh();
    });

    expect(getByTestId('commit-count').textContent).toBe('1');
    expect(getByTestId('cursor').textContent).toBe('1');
    view.dispose();
  });

  it('stops re-rendering after unmount (the subscription is torn down)', async () => {
    const view = createSessionView(pollingSource({ fetchImpl: fakeFetch() }));
    const { getByTestId, unmount } = render(<Probe view={view} />);
    await act(async () => {
      await view.refresh();
    });
    expect(getByTestId('commit-count').textContent).toBe('1');

    unmount();
    // a notify AFTER unmount must not throw and must not touch unmounted DOM —
    // the only observable proof available post-unmount is that this resolves cleanly
    await expect(view.refresh()).resolves.toBeUndefined();
    view.dispose();
  });

  it('reads getServerSnapshot during a server-rendered pass (the 3rd useSyncExternalStore argument)', () => {
    const view = createSessionView(pollingSource({ fetchImpl: fakeFetch() }));
    // renderToString never subscribes/commits — useSyncExternalStore falls back
    // to the getServerSnapshot arg, which the hook wires to the SAME view.getState()
    const html = renderToString(<Probe view={view} />);
    expect(html).toContain('commit-count');
    expect(html).toContain('>0<'); // the pre-refresh, synchronous empty snapshot
    view.dispose();
  });
});
