/**
 * THE DOOR OUT — parse, build, open, and the two ways it may refuse.
 *
 * Against the real library, because the whole value of this door is that the
 * sentences a person reads at the end of the wizard are the sentences the
 * library itself would have raised.
 */
import { describe, it, expect } from 'vitest';
import { DashboardDefError } from 'vizfootprint/def';
import { openDesk, buildRefusals } from './open.js';
import { assembleDef } from './steps.js';
import { salesDraft } from './make.fixture.js';

describe('openDesk', () => {
  it('opens a live desk from a made definition, with its plan already read', () => {
    const opened = openDesk(assembleDef(salesDraft()));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.desk.plan.rows).toHaveLength(6);
    expect(opened.desk.plan.columns).toEqual(['region', 'quarter', 'sales', 'report_state']);
    expect(opened.desk.plan.views.map((v) => `${v.id}:${v.chartKind}`)).toEqual(['regions:bar', 'quarters:line']);
    expect(opened.desk.session.commits('anywhere')).toEqual([]);
    expect(opened.desk.def).toEqual(assembleDef(salesDraft()));
    opened.desk.view.dispose();
  });

  it('refuses a definition the PARSE door will not narrow, in the parser\'s sentences', () => {
    const opened = openDesk({ data: {}, actors: {} });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals.join('\n')).toContain('data');
  });

  it('is where a def the STEPS could not judge is judged — an analysis missing an option', () => {
    const opened = openDesk(assembleDef(salesDraft({ analysis: { id: 'the analysis', decl: { builtin: 'groupBy', by: 'region' } as never } })));
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals.join('\n')).toContain('measure');
  });

  it('refuses a definition the BUILD door throws on, in the build door\'s sentences', () => {
    const def = { ...assembleDef(salesDraft()), data: { data: { source: { format: 'csv' as const, via: 'http' as const, at: 'https://example.test/rows.csv' } } } };
    const opened = openDesk(def);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.refusals[0]).toContain('build it with buildDashboardAsync');
  });
});

describe('buildRefusals — a thrown refusal, as sentences', () => {
  it('takes the list a DashboardDefError was raised with, not its joined message', () => {
    expect(buildRefusals(new DashboardDefError(['one thing', 'another']))).toEqual(['one thing', 'another']);
  });

  it('says anything else in its own words rather than swallowing it', () => {
    expect(buildRefusals(new Error('the engine would not load'))).toEqual(['the engine would not load']);
    expect(buildRefusals('no rows')).toEqual(['no rows']);
  });
});
