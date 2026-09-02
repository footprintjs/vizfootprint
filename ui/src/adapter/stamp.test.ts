/**
 * The in-process adapter path carries a commit's data stamp: a session over a
 * table with a declared source lands stamped commits, and the view shows them.
 */
import { describe, it, expect } from 'vitest';
import { createSessionView, sessionSource } from './sessionView.js';
import { buildDashboard } from '../../../src/def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../src/session/dashboard.fixture.js';

describe('the data stamp on the in-process path', () => {
  it('a commit over a source-declared table carries the version it was true of; the view maps it and marks nothing moved', async () => {
    const dash = buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });
    const session = dash.createSession();
    await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { requestedBy: 'user', computedBy: 'user' } });
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    const [commit] = view.getState().commits;
    expect(commit?.data).toEqual({ data: dash.sources['data']!.version });
    expect(commit?.dataMoved).toBe(false);
    view.dispose();
  });
});
