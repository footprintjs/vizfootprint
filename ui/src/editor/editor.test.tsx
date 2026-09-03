// @vitest-environment jsdom
/**
 * The editor entry: the drawer is a side panel that closes on Escape; the
 * chart editor lands every edit through the host — words as describe (with
 * the analyst's basis kept when a person edits its draft), channels as
 * reencode (refused columns greyed, a followed channel locked), links as link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChartEditor, EditorDrawer, EDITOR_SLOTS, editedRecord } from './index.js';
import type { LinkGraphView, ViewView } from '../adapter/types.js';

afterEach(cleanup);

const view: ViewView = {
  viewId: 'weeks',
  actor: 'user',
  selectionKinds: ['point'],
  canProbe: true,
  mounted: true,
  encoding: { x: 't', y: 'cases' },
  fits: {
    x: [{ field: 't', ok: true }, { field: 'cases', ok: true }, { field: 'kind', ok: false, because: '"kind" is string; the x channel of a line needs a number or a date' }],
    y: [{ field: 'cases', ok: true }, { field: 'kind', ok: false, because: 'no' }],
    color: [{ field: 'kind', ok: true }],
  },
  effective: { bindings: { x: 't', y: 'cases', color: 'kind' }, followed: { color: { edge: 'trend:encoding→weeks', from: 'trend', sourceChannel: 'color' } }, refused: { y: { edge: 'trend:encoding→weeks', field: 'value', sentence: 'not here' } } },
  prose: [
    { slot: 'title', text: 'Cases per week', status: 'current', changed: [], author: { kind: 'human', by: 'ana' }, levels: [] },
    { slot: 'caption', text: 'Cases fell in August.', status: 'stale', changed: ['filters'], author: { kind: 'agent', model: 'm' }, levels: ['trend'], basis: { filters: {} } },
    { slot: 'howToRead', text: 'a line with t on x, cases on y', status: 'derived', changed: [], author: { kind: 'derived' }, levels: [] },
  ],
};
const links: LinkGraphView = {
  default: 'crossfilter',
  views: [{ viewId: 'weeks', voice: ['point', 'encoding'], channels: ['x', 'y', 'color'] }, { viewId: 'trend', voice: ['point', 'encoding'], channels: ['x', 'y', 'color'] }],
  edges: [
    { id: 'weeks:point→trend', source: 'weeks', kind: 'point', target: 'trend', response: 'filter', origin: 'default' },
    { id: 'trend:encoding→weeks', source: 'trend', kind: 'encoding', target: 'weeks', response: 'follow', origin: 'edited', channels: [{ from: 'color', to: 'color' }] },
    { id: 'trend:point→map', source: 'trend', kind: 'point', target: 'map', response: 'filter', origin: 'default' },
  ],
};

describe('EditorDrawer', () => {
  it('renders as a side panel, closes on its button and on Escape, renders nothing when closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(<EditorDrawer open title="Edit weeks" onClose={onClose}>hello</EditorDrawer>);
    expect(screen.getByRole('complementary', { name: 'Edit weeks' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<EditorDrawer open={false} title="Edit weeks" onClose={onClose}>hello</EditorDrawer>);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('ChartEditor', () => {
  it('words: save lands a describe with the person as author; editing the analyst\'s draft keeps its basis; derived reads only; back to the declaration sends null', () => {
    const onDescribe = vi.fn();
    render(<ChartEditor view={view} links={links} by="ana" onDescribe={onDescribe} />);
    expect(EDITOR_SLOTS).toHaveLength(5);
    const title = screen.getByLabelText(/title/) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: 'Reported cases per week' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(onDescribe).toHaveBeenCalledWith('weeks', 'title', { text: 'Reported cases per week', author: { kind: 'human', by: 'ana' } });
    const caption = screen.getByLabelText(/caption/) as HTMLTextAreaElement;
    fireEvent.change(caption, { target: { value: 'Cases fell in August, then rose.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!);
    expect(onDescribe).toHaveBeenLastCalledWith('weeks', 'caption', { text: 'Cases fell in August, then rose.', author: { kind: 'humanEdited', by: 'ana', model: 'm' }, levels: ['trend'], basis: { filters: {} } });
    expect(screen.getByText('a line with t on x, cases on y')).toBeTruthy();
    expect(screen.queryByLabelText(/howToRead/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'back to the declaration' })[0]!);
    expect(onDescribe).toHaveBeenLastCalledWith('weeks', 'title', null);
    // an untouched or emptied draft cannot be saved
    const alt = screen.getByLabelText(/altShort/) as HTMLTextAreaElement;
    fireEvent.change(alt, { target: { value: '   ' } });
    const saves = screen.getAllByRole('button', { name: 'Save' });
    expect((saves[2] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/stale · filters moved/)).toBeTruthy();
  });
  it('channels: a pick lands a reencode, refused columns are greyed with the sentence, a followed channel is locked, a refused follow is named', () => {
    const onReencode = vi.fn();
    render(<ChartEditor view={view} links={links} onReencode={onReencode} />);
    const x = screen.getByRole('combobox', { name: 'x channel' }) as HTMLSelectElement;
    const kind = [...x.options].find((o) => o.value === 'kind')!;
    expect(kind.disabled).toBe(true);
    expect(kind.textContent).toContain('needs a number or a date');
    fireEvent.change(x, { target: { value: 'cases' } });
    expect(onReencode).toHaveBeenCalledWith('weeks', 'x', 'cases');
    fireEvent.change(x, { target: { value: 't' } }); // the current field: not an act
    expect(onReencode).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('combobox', { name: 'color channel' }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/follows trend\.color/)).toBeTruthy();
    expect(screen.getByText(/refused to follow "value"/)).toBeTruthy();
  });
  it('links: only this chart\'s edges, with the responses their kind allows; an edited encoding edge offers back to the declaration', () => {
    const onLink = vi.fn();
    render(<ChartEditor view={view} links={links} labels={{ trend: 'Trend' }} onLink={onLink} />);
    expect(screen.queryByRole('combobox', { name: 'trend point → map' })).toBeNull();
    const enc = screen.getByRole('combobox', { name: 'trend encoding → weeks' }) as HTMLSelectElement;
    expect([...enc.options].map((o) => o.value)).toEqual(['rule', 'follow', 'none']);
    expect([...enc.options][0]!.textContent).toBe('back to the declaration');
    fireEvent.change(enc, { target: { value: 'none' } });
    expect(onLink).toHaveBeenCalledWith({ source: 'trend', kind: 'encoding', target: 'weeks', response: 'none' });
    fireEvent.change(enc, { target: { value: 'rule' } });
    expect(onLink).toHaveBeenLastCalledWith({ source: 'trend', kind: 'encoding', target: 'weeks', response: null });
    const sel = screen.getByRole('combobox', { name: 'weeks point → trend' }) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['filter', 'highlight', 'navigate', 'mirror', 'none']);
    expect(screen.getAllByText(/Trend/).length).toBeGreaterThan(0);
  });
  it('read-only, no handlers, no surface: everything reads and nothing acts', () => {
    const bare: ViewView = { viewId: 'table', actor: 'user', selectionKinds: ['point'], canProbe: true, mounted: true, encoding: {} };
    render(<ChartEditor view={bare} readOnly />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByLabelText(/title/) as HTMLTextAreaElement).readOnly).toBe(true);
    cleanup();
    // a view with a binding but no verdicts still lists the channel with its current field
    render(<ChartEditor view={{ ...bare, encoding: { x: 'a' } }} onReencode={vi.fn()} />);
    const x = screen.getByRole('combobox', { name: 'x channel' }) as HTMLSelectElement;
    expect([...x.options].map((o) => o.value)).toEqual(['a']);
  });
  it('editedRecord: a fresh slot by a person; an agent draft edited keeps model, levels and basis', () => {
    expect(editedRecord('t', undefined)).toEqual({ text: 't', author: { kind: 'human' } });
    expect(editedRecord('t', { slot: 'caption', text: 'x', status: 'current', changed: [], author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { columns: ['a'] } }, 'ana')).toEqual({ text: 't', author: { kind: 'humanEdited', by: 'ana', model: 'm' }, levels: ['statistic'], basis: { columns: ['a'] } });
  });
});

describe('the editor\'s remaining looks', () => {
  it('a refusal without a sentence says so; a pair that renames shows both ends; an edited selection edge offers the rule; the analyst\'s current words say so; classNames ride', () => {
    const v: ViewView = {
      ...view,
      effective: undefined,
      fits: { x: [{ field: 't', ok: true }, { field: 'kind', ok: false }] },
      prose: [
        { slot: 'caption', text: 'By the analyst.', status: 'current', changed: [], author: { kind: 'agent', model: 'm' }, levels: [] },
        { slot: 'altShort', text: 'Edited.', status: 'current', changed: [], author: { kind: 'humanEdited', by: 'ana' }, levels: [] },
      ],
    };
    const l: LinkGraphView = {
      default: 'crossfilter',
      views: [],
      edges: [
        { id: 'weeks:point→trend', source: 'weeks', kind: 'point', target: 'trend', response: 'highlight', origin: 'edited' },
        { id: 'trend:encoding→weeks', source: 'trend', kind: 'encoding', target: 'weeks', response: 'follow', origin: 'declared', channels: [{ from: 'x', to: 'y' }] },
        { id: 'map:encoding→weeks', source: 'map', kind: 'encoding', target: 'weeks', response: 'none', origin: 'declared', channels: [] },
      ],
    };
    const { container } = render(<ChartEditor view={v} links={l} className="mine" onReencode={vi.fn()} onLink={vi.fn()} />);
    expect(container.querySelector('.vzf-editor.mine')).toBeTruthy();
    const x = screen.getByRole('combobox', { name: 'x channel' }) as HTMLSelectElement;
    expect([...x.options].find((o) => o.value === 'kind')!.textContent).toContain('does not fit');
    expect(screen.getByText(/\(x→y\)/)).toBeTruthy();
    expect(screen.getByText(/no shared channel/)).toBeTruthy();
    const sel = screen.getByRole('combobox', { name: 'weeks point → trend' }) as HTMLSelectElement;
    expect([...sel.options][0]!.textContent).toBe('back to the rule');
    expect(screen.getByText('by the analyst')).toBeTruthy();
    expect(screen.getByText('humanEdited')).toBeTruthy();
    cleanup();
    render(<EditorDrawer open title="t" onClose={vi.fn()} className="mine" width={200}>x</EditorDrawer>);
    expect(document.querySelector('.vzf-drawer.mine')).toBeTruthy();
  });
});

describe('unbound channels', () => {
  it('an unbound channel with verdicts offers (unbound) first; one with no verdicts and no binding lists nothing', () => {
    const v: ViewView = { viewId: 'v', actor: 'user', selectionKinds: [], canProbe: true, mounted: true, encoding: {}, fits: { x: [{ field: 'a', ok: true }], y: [] } };
    render(<ChartEditor view={v} onReencode={vi.fn()} />);
    const x = screen.getByRole('combobox', { name: 'x channel' }) as HTMLSelectElement;
    expect([...x.options].map((o) => o.value)).toEqual(['', 'a']);
    const y = screen.getByRole('combobox', { name: 'y channel' }) as HTMLSelectElement;
    expect([...y.options].map((o) => o.value)).toEqual(['']);
  });
});

describe('proposals in the editor', () => {
  it('an open proposal offers Accept and Decline (with a reason); accepted and declined ones read only', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const v: ViewView = {
      ...view,
      proposals: [
        { slot: 'caption', proposal: 'p1', text: 'Cases fell after week 30.', status: 'open', author: { kind: 'agent', model: 'm' }, levels: ['trend'], by: 'agent' },
        { slot: 'title', proposal: 'p0', text: 'Old', status: 'declined', author: { kind: 'agent' }, levels: [], reason: 'too vague' },
        { slot: 'altShort', proposal: 'p2', text: 'Taken', status: 'accepted', author: { kind: 'human' }, levels: [] },
        { slot: 'altLong', proposal: 'p3', text: 'Quiet', status: 'declined', author: { kind: 'humanEdited' }, levels: [] },
      ],
    };
    render(<ChartEditor view={v} onAccept={onAccept} onDecline={onDecline} />);
    expect(screen.getByText('Cases fell after week 30.')).toBeTruthy();
    expect(screen.getByText(/declined — too vague/)).toBeTruthy();
    expect(screen.getByText(/proposed by humanEdited/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledWith('weeks', 'caption', 'p1');
    const decline = screen.getByRole('button', { name: 'Decline' }) as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('reason to decline caption'), { target: { value: 'reporting delay' } });
    fireEvent.click(decline);
    expect(onDecline).toHaveBeenCalledWith('weeks', 'caption', 'p1', 'reporting delay');
    cleanup();
    render(<ChartEditor view={v} readOnly onAccept={onAccept} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    cleanup();
    render(<ChartEditor view={v} onAccept={onAccept} />);
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    cleanup();
    render(<ChartEditor view={v} onDecline={onDecline} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });
});
