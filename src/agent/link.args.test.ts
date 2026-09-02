/**
 * The agent's door for layer 4 policies and for why over words: `link` carries
 * `onClear` and `fold` (refused with a sentence when malformed); `why` accepts
 * `{ viewId, slot }`.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const port = () => vizAsTools(buildDashboard({ ...makeDashboardDef(), grains: [{ viewId: 'bar', keys: ['category'] }, { viewId: 'scatter', keys: [] }], prose: [{ viewId: 'scatter', slots: { title: { text: 'T', author: { kind: 'human' } } } }] }).createSession());

describe('link: onClear + fold', () => {
  it('malformed values are refused before dispatch; well-formed ones land on the edge', async () => {
    const p = port();
    const badClear = await p.call('viz.dispatch', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', onClear: 'forget' });
    expect(JSON.stringify(badClear)).toContain('link.onClear, if given, must be leave | showAll | excludeAll');
    const badFold = await p.call('viz.dispatch', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', fold: '' });
    expect(JSON.stringify(badFold)).toContain('link.fold, if given, must be a non-empty sentence');
    const crossing = await p.call('viz.dispatch', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' });
    expect(JSON.stringify(crossing)).toContain('must state its fold');
    const ok = await p.call('viz.dispatch', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', onClear: 'excludeAll', fold: 'every row of the lit category' });
    expect(JSON.stringify(ok)).toContain('"onClear":"excludeAll"');
    expect(JSON.stringify(ok)).toContain('every row of the lit category');
  });
});

describe('why: a view\'s words', () => {
  it('{ viewId, slot } is a prose target; a bad slot is not', async () => {
    const p = port();
    const declared = await p.call('viz.why', { target: { viewId: 'scatter', slot: 'title' } });
    expect(JSON.stringify(declared)).toContain('declared-in-def');
    const bad = await p.call('viz.why', { target: { viewId: 'scatter', slot: 'footnote' } });
    expect(JSON.stringify(bad)).toContain('{ viewId, slot }');
  });
});
