/**
 * resourceFold.def.test.ts — VALUES NEVER RIDE THE OVERVIEW, and a fold's
 * answer is a value.
 *
 * The temptation this pins against is a real one: a head fold learns a nice
 * early accession — `PF00545.26`, known in the first second, before the data —
 * and the obvious place to show it is the provenance row that is already on
 * screen. That would put a COMPUTED VALUE on the record's facts wire, where
 * every other number has to come from an act.
 *
 * So the overview keeps carrying what it carried: the resource's declared tags,
 * its version, its SIZE and its state word (`../source/README.md`). A fold
 * answer reaches the host that asked for it, on its own channel and on the
 * read's own result — and a test asserts it appears nowhere in
 * `JSON.stringify(overview())` at any point in a fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { buildDashboardAsync } from './index.js';
import { foldResource, httpSource } from '../source/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { Dashboard } from './index.js';
import type { DashboardDef } from './types.js';
import type { FoldAnswer, ResourceFold, ResourceFoldResult } from '../source/index.js';

const DECODE = new TextDecoder();
const HEADER = '# STOCKHOLM 1.0\n#=GF AC   PF00545.26\n#=GF SQ   3982\n';
const SEQS = 'UniRef/1-9        ACDEFGHIK\nUniRef/2-9        ACDEFGHIL\n'.repeat(4);
const BODY = `${HEADER}${SEQS}//\n`;

/** The accession, out of the first 48 bytes — the value that must not reach the overview. */
const accession: ResourceFold<string, string | undefined> = {
  name: 'accession',
  at: 'head',
  headBytes: 48,
  start: () => '',
  take: (_seen, head) => DECODE.decode(head),
  finish: (text) => /#=GF AC\s+(\S+)/.exec(text)?.[1],
};

describe('a fold answer and the overview', () => {
  let server: Server;
  let base = '';
  let release: (() => void) | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if ((req.url ?? '/') === '/held') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write(HEADER);
        release = () => res.end(`${SEQS}//\n`);
        return;
      }
      res.writeHead(200, { etag: '"v1"', 'content-type': 'text/plain' });
      res.end(BODY);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const build = async (): Promise<Dashboard> =>
    buildDashboardAsync({ ...makeDashboardDef(), resources: { structure: { format: 'text', via: 'http', at: `${base}/whole` } } } as DashboardDef, { sources: [httpSource()] });

  it('NO FOLD OUTPUT ON THE OVERVIEW AT ANY POINT — before the read, inside it, and after it', async () => {
    const dashboard = await build();
    const session = dashboard.createSession();
    const before = JSON.stringify(await session.overview());
    // the row is really there, with the facts it always carried — this is not a vacuous check
    expect(before).toContain('"structure"');
    expect(before).toContain(`"bytes":${String(Buffer.byteLength(BODY))}`);
    expect(before).not.toContain('PF00545.26');

    // …now fold the SAME declared resource, over a body that is still arriving
    let told: FoldAnswer | undefined;
    let pending: Promise<ResourceFoldResult> | undefined;
    await new Promise<void>((resolve) => {
      pending = foldResource({ format: 'text', via: 'http', at: `${base}/held` }, 'structure', [accession], [httpSource()], {
        onFoldValue: (answer) => {
          told = answer;
          resolve();
        },
      });
    });
    // the answer is in the host's hands — the accession is known before the data is
    expect(told?.value).toBe('PF00545.26');
    const during = JSON.stringify(await session.overview());
    expect(during).not.toContain('PF00545.26');
    expect(during).not.toContain('accession');
    expect(during).not.toContain('residency');

    release!();
    const result = await pending!;
    expect(result.answers).toEqual({ accession: 'PF00545.26' });
    const after = JSON.stringify(await session.overview());
    expect(after).not.toContain('PF00545.26');
    // A FOLD READ IS NOT AN ACT: it lands no bytes, moves no version and touches no row, so
    // the overview is the same overview, key for key and byte for byte
    expect(after).toBe(before);
  });

  it('…and the bytes the dashboard HOLDS are untouched by a read that folded a different body', async () => {
    const dashboard = await build();
    const held = dashboard.resources.structure!;
    const result = await foldResource({ format: 'text', via: 'http', at: `${base}/whole` }, 'structure', [accession], [httpSource()]);
    expect(result.answers).toEqual({ accession: 'PF00545.26' });
    expect(result.residency).toBe('streamed');
    expect(dashboard.resources.structure).toEqual(held);
    expect(dashboard.resource('structure')).toMatchObject({ body: BODY });
    // …and no state word was written by a read the dashboard did not make
    expect(Object.keys(dashboard.resources.structure!)).toEqual(['format', 'via', 'at', 'version', 'retrievedAt', 'bytes']);
  });
});
