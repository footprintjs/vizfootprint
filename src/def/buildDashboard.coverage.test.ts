/**
 * `buildDashboard` (D24 engine routing + FDR stepper factory) — coverage
 * packet for the arms not already exercised by `buildDashboard.test.ts`'s
 * behavioral suite: the csv data-source path (`rowsInputOf`/`statsOf`'s csv
 * arms), `layout` pass-through, the `wasm` typed-stub route, and both FDR
 * procedures' optional-field pass-through (LORD++'s w0/gamma, alpha-investing's
 * w0/omega — including the "left unset" arm of each).
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from './buildDashboard.js';
import type { DashboardDef } from './types.js';
import { lordGamma } from '../fdr/index.js';

/** A minimal valid def (one table `t`, one actor `v`) with overrides spliced on top. */
function baseDef(overrides: Record<string, unknown> = {}): DashboardDef {
  return {
    data: { t: { rows: [{ id: 1, price: 10 }] } },
    actors: { v: { actor: 'user' } },
    ...overrides,
  } as unknown as DashboardDef;
}

describe('buildDashboard — D24 data-source arms', () => {
  it('resolves a csv-sourced table through the memory engine (rowsInputOf csv arm + statsOf csv line-count)', async () => {
    const csv = 'id,price\n1,10\n2,20\n3,30\n';
    const dash = buildDashboard(baseDef({ data: { t: { csv } } }));
    expect(dash.engines).toEqual({ t: 'memory' });

    const session = dash.createSession();
    const rows = await session.selectedRows('t');
    // parseCSVTyped sniffs numeric columns — real CSV parsing, not a stub.
    expect(rows).toEqual([
      { id: 1, price: 10 },
      { id: 2, price: 20 },
      { id: 3, price: 30 },
    ]);
  });

  it('routes a column-layout memory table (source.layout pass-through) to identical query results', async () => {
    const rows = [
      { id: 1, price: 10 },
      { id: 2, price: 20 },
    ];
    const dash = buildDashboard(baseDef({ data: { t: { rows, layout: 'column' } } }));
    expect(dash.engines).toEqual({ t: 'memory' });

    const session = dash.createSession();
    expect(await session.selectedRows('t')).toEqual(rows);
  });

  it('routes an explicit wasm engine to its typed stub (every read honestly rejects, never fakes rows)', async () => {
    const dash = buildDashboard(baseDef({ data: { t: { rows: [{ id: 1 }], engine: 'wasm' } } }), {
      availableEngines: ['memory', 'wasm'],
    });
    expect(dash.engines).toEqual({ t: 'wasm' });

    const session = dash.createSession();
    // wasmProvider.evaluate() always rejects 'not-implemented' — selectedRows
    // is a best-effort projection that yields [] on a backend rejection.
    expect(await session.selectedRows('t')).toEqual([]);
  });
});

describe('buildDashboard — FDR stepper factory (both procedures, optional-field pass-through)', () => {
  it('builds a LORD++ stepper with w0 and gamma both set', () => {
    const dash = buildDashboard(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05, w0: 0.02, gamma: lordGamma } }));
    expect(dash.def.fdr).toEqual({ procedure: 'LORD++', alpha: 0.05, w0: 0.02, gamma: lordGamma });
    // Session construction calls runtime.makeFdrStepper() synchronously — this
    // is what actually invokes the createLordPlusPlus({ w0, gamma }) arm.
    const session = dash.createSession();
    expect(session.ledger()).toEqual([]);
  });

  it('builds a LORD++ stepper with w0/gamma left unset (defaults)', () => {
    const dash = buildDashboard(baseDef({ fdr: { procedure: 'LORD++', alpha: 0.05 } }));
    const session = dash.createSession();
    expect(session.ledger()).toEqual([]);
  });

  it('builds an alpha-investing stepper with w0 and omega both set', () => {
    const dash = buildDashboard(
      baseDef({ fdr: { procedure: 'alpha-investing', alpha: 0.05, w0: 0.02, omega: 0.5 } }),
    );
    expect(dash.def.fdr).toEqual({ procedure: 'alpha-investing', alpha: 0.05, w0: 0.02, omega: 0.5 });
    const session = dash.createSession();
    expect(session.ledger()).toEqual([]);
  });

  it('builds an alpha-investing stepper with w0/omega left unset (defaults)', () => {
    const dash = buildDashboard(baseDef({ fdr: { procedure: 'alpha-investing', alpha: 0.05 } }));
    const session = dash.createSession();
    expect(session.ledger()).toEqual([]);
  });
});
