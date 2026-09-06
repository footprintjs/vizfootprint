// @vitest-environment jsdom
/**
 * THE WORDS PLANE, DRAWN.
 *
 * Two rules are on trial here and both are the library's: a STALE slot is shown
 * rather than hidden or rewritten, and WHO WROTE IT rides with it. A surface
 * that dropped the stale ones would be deciding on the reader's behalf that the
 * words no longer count — which is the one decision this whole library exists to
 * take away from surfaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProseStatusView } from 'vizfootprint-ui';
import { DashboardSummary, ProseLines, authorTitle } from './prose.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const slot = (over: Partial<ProseStatusView> = {}): ProseStatusView => ({
  slot: 'caption',
  text: 'poetry outsells atlases',
  status: 'current',
  changed: [],
  author: { kind: 'human', by: 'ana' },
  levels: [],
  ...over,
});

describe('a view’s words', () => {
  it('draws nothing at all when a view has none, and nothing when all it has is alt text', () => {
    const { rerender, container } = render(<ProseLines lines={[]} anchors={{}} />);
    expect(container.textContent).toBe('');
    rerender(<ProseLines lines={[slot({ slot: 'altShort' }), slot({ slot: 'altLong' })]} anchors={{}} />);
    // alt text is the chart's ACCESSIBLE name — it goes to assistive tech through
    // the chart, and printing it here would say everything twice
    expect(container.textContent).toBe('');
  });

  it('shows a stale slot, says what moved, and colours it — never hides or rewrites it', () => {
    render(<ProseLines lines={[slot({ status: 'stale', changed: ['filters', 'encodings'] })]} anchors={{}} />);
    expect(screen.getByText(/stale · filters, encodings moved/)).toBeTruthy();
    const line = screen.getByText(/stale · filters, encodings moved/).closest('div')!;
    expect(line.getAttribute('title')).toBe('stale — moved: filters, encodings');
  });

  it('marks a derived slot as derived, and an agent’s words as the analyst’s', () => {
    render(
      <ProseLines
        lines={[slot({ slot: 'title', status: 'derived', author: { kind: 'derived' } }), slot({ author: { kind: 'agent', model: 'a-model' } })]}
        anchors={{}}
      />,
    );
    expect(screen.getByText('derived')).toBeTruthy();
    expect(screen.getByText('by the analyst')).toBeTruthy();
  });

  it('puts the author on the record, in the tooltip', () => {
    expect(authorTitle(slot())).toBe('human · ana');
    expect(authorTitle(slot({ author: { kind: 'agent', model: 'a-model' } }))).toBe('agent · a-model');
    expect(authorTitle(slot({ author: { kind: 'derived' } }))).toBe('derived');
  });
});

describe('the dashboard summary', () => {
  const accept = vi.fn();
  const decline = vi.fn();
  const props = { readOnly: false, anchors: {}, onAccept: accept, onDecline: decline };

  it('is absent when there is neither a caption nor a draft — an empty label is furniture', () => {
    const { container } = render(<DashboardSummary dashboard={undefined} {...props} />);
    expect(container.textContent).toBe('');
  });

  it('draws the caption with its staleness and its author', () => {
    render(<DashboardSummary dashboard={{ prose: [slot({ status: 'stale', changed: ['filters'], author: { kind: 'agent' } })], proposals: [] }} {...props} />);
    expect(screen.getByText(/poetry outsells atlases/)).toBeTruthy();
    expect(screen.getByText(/stale · filters moved/)).toBeTruthy();
    expect(screen.getByText('by the analyst')).toBeTruthy();
  });

  it('shows an OPEN draft beside it, and lands the person’s answer', () => {
    render(
      <DashboardSummary
        dashboard={{
          prose: [],
          proposals: [
            { slot: 'caption', proposal: 'c9', text: 'a better line', status: 'open', author: { kind: 'agent' }, levels: [], changed: [] } as never,
            { slot: 'title', proposal: 'c8', text: 'not this slot', status: 'open', author: { kind: 'agent' }, levels: [], changed: [] } as never,
            { slot: 'caption', proposal: 'c7', text: 'already answered', status: 'accepted', author: { kind: 'agent' }, levels: [], changed: [] } as never,
          ],
        }}
        {...props}
      />,
    );
    expect(screen.getByText('a better line')).toBeTruthy();
    expect(screen.queryByText('not this slot')).toBeNull(); // another slot's draft is another slot's business
    expect(screen.queryByText('already answered')).toBeNull(); // a draft already answered is not on the table

    fireEvent.click(screen.getByRole('button', { name: 'accept' }));
    expect(accept).toHaveBeenCalledWith('c9');

    vi.spyOn(window, 'prompt').mockReturnValue('it says more than it knows');
    fireEvent.click(screen.getByRole('button', { name: 'decline' }));
    expect(decline).toHaveBeenCalledWith('c9', 'it says more than it knows');
  });

  it('a decline with no reason is not a decline — the reason stays on the record, so it is required', () => {
    render(<DashboardSummary dashboard={{ prose: [], proposals: [{ slot: 'caption', proposal: 'c9', text: 'a better line', status: 'open', author: { kind: 'agent' }, levels: [], changed: [] } as never] }} {...props} />);
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'decline' }));
    expect(decline).not.toHaveBeenCalledWith('c9', null);
  });

  it('in Present mode the draft is still SHOWN and the two doors are closed', () => {
    render(<DashboardSummary dashboard={{ prose: [], proposals: [{ slot: 'caption', proposal: 'c9', text: 'a better line', status: 'open', author: { kind: 'agent' }, levels: [], changed: [] } as never] }} {...props} readOnly />);
    expect(screen.getByText('a better line')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'accept' })).toBeNull();
  });
});
