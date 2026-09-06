/**
 * THE DELTA CONFORMANCE LAW — the previous full answer, with the `since`
 * answer applied over it, IS the current full answer.
 *
 * A delta is a claim about an answer nobody sent. If it cannot be proven equal
 * to the answer it stands for, it is a lie that reads exactly like the truth:
 * the reader's picture of the dashboard drifts one act at a time, and every
 * sentence they write about it is confident and slightly wrong.
 *
 * So this file is the same shape as `src/session/conformance.test.ts`, one
 * tier up. That one proves the FOLD a walk builds equals the fold a replay
 * rebuilds; this one proves the ANSWER a reader assembles from deltas equals
 * the answer the port would have served in full — over the same twelve-act
 * walk, act by act, and BYTE for byte rather than merely deep-equal, because a
 * reader hands its copy on to a model that reads bytes.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools, applySurfaceDelta } from './index.js';
import type { DashboardDef, VizToolsPort } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const LAYOUT = 'layout:dashboard';
const user = (intent: string): Record<string, unknown> => ({ intent });

/** The conformance fixture's def, plus a heatmap that honestly emits cells so the walk can use every selection kind. */
function walkDef(): DashboardDef {
  const base = makeDashboardDef();
  return {
    ...base,
    actors: { ...base.actors, heatmap: { actor: 'user', label: 'Price × category heatmap' } },
    capabilities: [...(base.capabilities ?? []), { viewId: 'heatmap', canProbe: true, encodings: ['cell'] }],
  };
}

const here = async (p: VizToolsPort, args?: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await p.call('viz.whats_here', args)) as Record<string, unknown>;

interface Step {
  /** What the walker did to get here. */
  readonly act: string;
  /** The whole answer at this position. */
  readonly full: Record<string, unknown>;
  /** The same position, asked for as a delta from the one before. */
  readonly delta: Record<string, unknown>;
}

/**
 * The same twelve acts the fold conformance test walks — a point select, an
 * interval filter, a match select, a cell select, a clear, a re-encode, a link
 * edit, an analysis, prose, a layout move, a fork with a sibling, and a travel
 * back — each captured twice: once in full, and once as the delta a reader who
 * held the previous answer would have been served.
 */
async function walk(p: VizToolsPort): Promise<Step[]> {
  const steps: Step[] = [];
  let previousAsOf = ((await here(p))['asOf']) as string;

  const capture = async (act: string): Promise<void> => {
    // the delta FIRST, from the position the reader was standing at
    const delta = await here(p, { since: previousAsOf });
    const full = await here(p);
    previousAsOf = full['asOf'] as string;
    steps.push({ act, full, delta });
  };
  const landed = async (act: string, args: Record<string, unknown>): Promise<string> => {
    const res = (await p.call('viz.dispatch', args)) as { ok: boolean; commit?: { id: string } };
    expect({ act, ok: res.ok }).toEqual({ act, ok: true });
    await capture(act);
    return res.commit?.id ?? '';
  };

  const first = await landed('a point select', { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', ...user('pick Casual') });
  await landed('an interval filter', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], ...user('the mid band') });
  await landed('a match select', { verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], ...user('two categories') });
  await landed('a cell select', { verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: [[100, 150], 'Formal'], ...user('one cell') });
  await landed('a clear', { verb: 'filter', viewId: 'scatter', field: 'price', range: null, ...user('clear the band') });
  await landed('a re-encode', { verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', ...user('colour by category') });
  await landed('a link edit', { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'none', ...user('mute bar → scatter') });
  await landed('an analysis', { verb: 'analyze', analysisId: 'correlation', ...user('is price related to rating?') });
  await landed('prose', { verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'Rating by price', author: { kind: 'human', by: 'sanjay' } }, ...user('retitle') });
  await landed('a layout move', { verb: 'navigate', viewId: LAYOUT, field: 'preset', value: 'grid', ...user('layout = grid') });
  // a fork back to the first act, then a sibling on the new lineage — a branching history, not a line
  expect(((await p.call('viz.fork', { fromCommitId: first, ...user('try another reading') })) as { ok: boolean }).ok).toBe(true);
  await landed('a sibling off the fork', { verb: 'select', viewId: 'bar', field: 'category', value: 'Summer', ...user('Summer instead') });
  // and a travel back to a moment on the original lineage
  expect(((await p.call('viz.fork', { fromCommitId: first, ...user('back to the first pick') })) as { ok: boolean }).ok).toBe(true);
  await capture('travel back');

  return steps;
}

describe('conformance: a delta applied to the previous answer IS the current answer', () => {
  it('holds at every one of the twelve acts, byte for byte', async () => {
    const p = vizAsTools(buildDashboard(walkDef()).createSession({ as: 'agent' }));
    const steps = await walk(p);
    expect(steps.length).toBe(12);

    let held = steps[0]!.full;
    for (const [index, step] of steps.entries()) {
      if (index > 0) {
        const applied = applySurfaceDelta(held, step.delta);
        expect({ at: index, act: step.act, ok: applied.ok }).toEqual({ at: index, act: step.act, ok: true });
        expect({ at: index, act: step.act, answer: JSON.stringify(applied.ok && applied.answer) })
          .toEqual({ at: index, act: step.act, answer: JSON.stringify(step.full) });
      }
      held = step.full;
    }
  });

  it('every delta is a REAL delta — the port proved each one rather than falling back to the whole answer', async () => {
    const p = vizAsTools(buildDashboard(walkDef()).createSession({ as: 'agent' }));
    for (const step of (await walk(p)).slice(1)) {
      expect({ act: step.act, since: step.delta['since'] }).toMatchObject({ act: step.act, since: { served: 'delta' } });
      // …and every one of them is smaller than the answer it stands for
      expect({ act: step.act, smaller: JSON.stringify(step.delta).length < JSON.stringify(step.full).length })
        .toEqual({ act: step.act, smaller: true });
    }
  });

  it('a reader who only ever asks for deltas ends up holding exactly what one full call would have served', async () => {
    const p = vizAsTools(buildDashboard(walkDef()).createSession({ as: 'agent' }));
    const steps = await walk(p);
    // start from the first full answer and never ask for another
    let held = steps[0]!.full;
    for (const step of steps.slice(1)) {
      const applied = applySurfaceDelta(held, step.delta);
      held = applied.ok ? applied.answer : held;
    }
    expect(JSON.stringify(held)).toBe(JSON.stringify(steps[steps.length - 1]!.full));
  });
});
