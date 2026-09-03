/**
 * The def door for `data[t].source`, and the two builders over it: the sync
 * `buildDashboard` decodes an inline source and refuses a remote one; the
 * async `buildDashboardAsync` opens every source with the adapters the host
 * brought and keeps the provenance each adapter vouched for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboard, buildDashboardAsync, validateDashboardDef, DashboardDefError, inlineVersion } from './index.js';
import { fileSource } from '../source/file.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import type { DashboardDef, DataSourceDef, SourceAdapter } from './index.js';

const CSV = 'id,price,rating,category,region\n' + SAMPLE_ROWS.map((r) => `${String(r['id'])},${String(r['price'])},${String(r['rating'])},${String(r['category'])},${String(r['region'])}`).join('\n');

function withSource(source: DataSourceDef['source'], extra: Partial<DataSourceDef> = {}): DashboardDef {
  const def = makeDashboardDef();
  return { ...def, data: { data: { source, ...extra } as DataSourceDef } };
}

describe('the def door — data[t].source', () => {
  it('rows, csv and source are three ways to say the same thing; only one may be set, one must be', () => {
    const both = { ...makeDashboardDef(), data: { data: { rows: SAMPLE_ROWS, source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } } as unknown;
    expect(validateDashboardDef(both)).toContain('data["data"] must set only one of rows, csv, source');
    const none = { ...makeDashboardDef(), data: { data: {} } } as unknown;
    expect(validateDashboardDef(none)).toContain('data["data"] must set rows, csv, or source');
  });
  it('refuses a malformed source with the sentence for each bookmark', () => {
    const at = (source: unknown): string[] => validateDashboardDef({ ...makeDashboardDef(), data: { data: { source } } } as unknown);
    expect(at('rows')).toContain('data["data"].source must be an object { format, via, at?, options? }');
    expect(at({ format: 'xml', via: 'inline', at: '', extra: 1 })).toEqual(expect.arrayContaining(['data["data"].source.extra is not a source key', 'data["data"].source.format must be one of rows|csv|json']));
    expect(at({ format: 'csv', via: 'ftp', at: 'x' })).toContain('data["data"].source.via must be one of inline|file|http');
    expect(at({ format: 'csv', via: 'inline' })).toContain('data["data"].source.at must carry the payload when via is inline');
    expect(at({ format: 'csv', via: 'file' })).toContain('data["data"].source.at must be a path or URL string when via is file');
    expect(at({ format: 'csv', via: 'http', at: '' })).toContain('data["data"].source.at must be a path or URL string when via is http');
    expect(at({ format: 'csv', via: 'inline', at: 'a\n1', options: 3 })).toContain('data["data"].source.options, if present, must be an object');
    expect(at({ format: 'csv', via: 'inline', at: 'a\n1', options: { delimiter: ',' } })).toEqual([]);
  });
  it('an engine beside a source is refused rather than silently overridden', () => {
    const def = withSource({ format: 'rows', via: 'inline', at: SAMPLE_ROWS }, { engine: 'wasm' });
    expect(validateDashboardDef(def)).toContain('data["data"] sets engine "wasm" with a source; a source table is materialised in memory — remove the engine key');
    expect(validateDashboardDef(withSource({ format: 'rows', via: 'inline', at: SAMPLE_ROWS }, { engine: 'memory' }))).toEqual([]);
  });
});

describe('buildDashboard (sync) over a source', () => {
  it('decodes an inline CSV source into a memory table and records its provenance', () => {
    const dash = buildDashboard(withSource({ format: 'csv', via: 'inline', at: CSV }));
    expect(dash.engines).toEqual({ data: 'memory' });
    expect(dash.sources['data']).toMatchObject({ format: 'csv', via: 'inline', version: inlineVersion(CSV), rows: SAMPLE_ROWS.length });
    expect(dash.sources['data']!.at).toBeUndefined(); // the payload is never repeated
    expect(dash.notes).toEqual([]);
    expect(dash.createSession().defaultTable).toBe('data');
  });
  it('an inline rows source with a column layout builds the same table', async () => {
    const dash = buildDashboard(withSource({ format: 'rows', via: 'inline', at: SAMPLE_ROWS }, { layout: 'column' }));
    expect(dash.sources['data']!.rows).toBe(SAMPLE_ROWS.length);
    const overview = await dash.createSession().overview();
    expect(overview.views.length).toBeGreaterThan(0);
    expect(overview.columns['data']!.map((c) => c.field)).toContain('price');
  });
  it('a payload the format refuses is a build error with the format sentence', () => {
    expect(() => buildDashboard(withSource({ format: 'rows', via: 'inline', at: 'nope' }))).toThrow(DashboardDefError);
    expect(() => buildDashboard(withSource({ format: 'rows', via: 'inline', at: 'nope' }))).toThrow('data["data"].source: format rows needs a list of row objects');
  });
  it('a source that must be fetched cannot be built synchronously — it says so', () => {
    expect(() => buildDashboard(withSource({ format: 'csv', via: 'file', at: '/nowhere.csv' }))).toThrow('data["data"] declares a source via file — build it with buildDashboardAsync');
  });
  it('a table without a source has no provenance row; engine auto resolves to memory with a note', () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'auto' }));
    expect(dash.sources).toEqual({});
    expect(dash.engines.data).toBe('memory');
    expect(dash.notes).toEqual(['data["data"]: engine "auto" resolved to memory (the placeholder thresholds would have said "memory"; they are unmeasured — declare an engine to choose otherwise)']);
  });
});

describe('buildDashboardAsync — every source opened with the adapters the host brought', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vf-def-source-'));
    await writeFile(join(dir, 'data.csv'), CSV);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('opens a file CSV source and keeps what the file system vouched for', async () => {
    const at = join(dir, 'data.csv');
    const dash = await buildDashboardAsync(withSource({ format: 'csv', via: 'file', at }, { layout: 'column' }), { sources: [fileSource] });
    expect(dash.engines).toEqual({ data: 'memory' });
    expect(dash.sources['data']).toMatchObject({ format: 'csv', via: 'file', at, rows: SAMPLE_ROWS.length });
    expect(dash.sources['data']!.version).toMatch(/^mtime:.*;size:\d+$/);
    const overview = await dash.createSession().overview();
    expect(overview.columns['data']!.map((c) => c.field)).toContain('price');
  });
  it('the same def through both builders records the same provenance; an inline payload is never repeated', async () => {
    const def = withSource({ format: 'csv', via: 'inline', at: CSV });
    const sync = buildDashboard(def);
    const inline = await buildDashboardAsync(def);
    expect(inline.sources['data']!.version).toBe(sync.sources['data']!.version);
    expect(inline.sources['data']).toMatchObject({ via: 'inline', version: inlineVersion(CSV), rows: SAMPLE_ROWS.length });
    expect(inline.sources['data']!.at).toBeUndefined();
    const plain = await buildDashboardAsync(makeDashboardDef({ engine: 'auto' }));
    expect(plain.sources).toEqual({});
    expect(plain.notes).toHaveLength(1);
  });
  it('a missing adapter, a carrier refusal and a malformed def are refused as def problems', async () => {
    await expect(buildDashboardAsync(withSource({ format: 'csv', via: 'file', at: join(dir, 'data.csv') }))).rejects.toThrow(DashboardDefError);
    await expect(buildDashboardAsync(withSource({ format: 'csv', via: 'file', at: join(dir, 'data.csv') }))).rejects.toThrow('data["data"].source: table "data" declares a source via file, and no adapter for file was passed');
    await expect(buildDashboardAsync(withSource({ format: 'rows', via: 'inline', at: 'nope' }))).rejects.toThrow('data["data"].source: table "data" inline source: format rows needs a list of row objects');
    // a host's own carrier (the port is open): whatever it throws becomes the def's problem, even a bare string
    const flaky: SourceAdapter = { via: 'http', open: async () => { throw 'the door is closed'; } };
    await expect(buildDashboardAsync(withSource({ format: 'json', via: 'http', at: 'https://example.test/rows' }), { sources: [flaky] })).rejects.toThrow('data["data"].source: the door is closed');
    await expect(buildDashboardAsync({ ...makeDashboardDef(), data: { data: {} } } as unknown as DashboardDef)).rejects.toThrow(DashboardDefError);
  });
});
