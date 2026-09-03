/**
 * Surface-bench CLI — `node bench/surface/run.mjs [outDir] [--tokens]`
 * Bundles surface-entry.ts with esbuild (platform node, the same trick
 * bench/step0 and bench/x4 use), runs it in a child node, and writes
 * `surface-results.json` + `surface-table.md` to outDir (default: this folder).
 *
 * `--tokens` sets SURFACE_TOKENS=1, which turns on the OPTIONAL real
 * token-counting pass in the child (Anthropic's count_tokens endpoint). Without
 * it — or without `@anthropic-ai/sdk` and a key in the environment — the bench
 * reports BYTES only and says so in one line. No key is ever read from a file
 * or written into an output.
 *
 * `@anthropic-ai/sdk` is marked external so the bundle builds whether or not it
 * is installed; the child's dynamic import is what decides.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const wantTokens = args.includes('--tokens');
const outDir = args.find((a) => !a.startsWith('--')) ?? here;
mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, 'surface-bench.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'surface-entry.ts')],
  bundle: true,
  outfile: bundle,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: 'inline',
  external: ['@anthropic-ai/sdk'],
});

const child = spawnSync(process.execPath, [bundle], {
  env: { ...process.env, ...(wantTokens ? { SURFACE_TOKENS: '1' } : {}) },
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 256 * 1024 * 1024,
});
if (child.status !== 0) {
  console.error(`bench exited ${child.status}`);
  process.exit(child.status ?? 1);
}
const json = JSON.parse(child.stdout.toString());
writeFileSync(path.join(outDir, 'surface-results.json'), JSON.stringify(json, null, 1));
// the bundle is a build artefact, regenerated every run — kept only when the child failed, so a failure stays debuggable
rmSync(bundle, { force: true });

// ── the table ────────────────────────────────────────────────────────────────
const n = (x) => x.toLocaleString('en-US');
const out = [];
const shapeOf = (name) => json.shapes.find((s) => s.shape === name);
const label = (s) => `${s.shape} (${s.declaredViews} views · ${s.tableColumns} cols · ${s.materializedEdges} edges · ${s.declaredAnalyses} analyses · ${s.spec.proseSlots} prose slots)`;

out.push(`node ${json.node} · ${json.platform} · ${json.generatedAt}`);
out.push('');
out.push(`**Unit: UTF-8 bytes.** ${json.tokens.counted ? `Tokens counted with ${json.tokens.model}.` : `Tokens NOT counted (${json.tokens.reason}).`}`);
out.push('');

out.push('### 1 · menu — the fixed cost paid every turn');
out.push('');
out.push(`Whole menu: **${n(json.menu.bytes)} bytes**, ${json.menu.toolCount} tools. Byte-stability: **${json.menu.stability.ok ? 'HOLDS' : 'BROKEN'}** — ${json.menu.stability.note}`);
out.push('');
out.push('| tool | shape | bytes | of which description | of which schema |');
out.push('|---|---|---:|---:|---:|');
for (const t of json.menu.tools) {
  out.push(`| \`${t.name}\` | any (shape-independent) | ${n(t.bytes)} | ${n(t.descriptionBytes)} | ${n(t.schemaBytes)} |`);
}
out.push(`| **total** | any (shape-independent) | **${n(json.menu.bytes)}** | | |`);
out.push('');

out.push('### 2 · whats_here — the per-call answer');
out.push('');
out.push('| shape | views | table cols | link edges | analyses | prose slots | whats_here bytes | × the menu |');
out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const s of json.shapes) {
  out.push(
    `| ${s.shape} | ${s.declaredViews} | ${s.tableColumns} | ${s.materializedEdges} | ${s.declaredAnalyses} | ${s.spec.proseSlots} | ${n(s.whatsHereBytes)} | ${(s.whatsHereBytes / json.menu.bytes).toFixed(2)}× |`,
  );
}
out.push('');

out.push('### 3 · composition — where the answer\'s bytes go');
out.push('');
const keys = [...new Set(json.shapes.flatMap((s) => s.composition.map((c) => c.key)))];
const realistic = shapeOf('realistic');
keys.sort((a, b) => {
  const ba = realistic.composition.find((c) => c.key === a)?.bytes ?? 0;
  const bb = realistic.composition.find((c) => c.key === b)?.bytes ?? 0;
  return bb - ba;
});
out.push(`| key | ${json.shapes.map((s) => `${s.shape} bytes (share)`).join(' | ')} |`);
out.push(`|---|${json.shapes.map(() => '---:').join('|')}|`);
for (const k of keys) {
  const cells = json.shapes.map((s) => {
    const c = s.composition.find((x) => x.key === k);
    return c ? `${n(c.bytes)} (${c.share}%)` : '—';
  });
  out.push(`| \`${k}\` | ${cells.join(' | ')} |`);
}
out.push(`| **total** | ${json.shapes.map((s) => `**${n(s.whatsHereBytes)}**`).join(' | ')} |`);
out.push('');
out.push(`Split checks out: unattributed residual (braces + commas beyond what the split counts) = ${json.shapes.map((s) => `${s.shape} ${s.compositionResidual}`).join(', ')}.`);
out.push('');

out.push('#### 3b · inside `views` and `links` — the two keys that carry the answer');
out.push('');
out.push(`| container | sub-key | ${json.shapes.map((s) => `${s.shape} bytes (share of that container)`).join(' | ')} |`);
out.push(`|---|---|${json.shapes.map(() => '---:').join('|')}|`);
for (const [container, field] of [['views', 'viewsBreakdown'], ['links', 'linksBreakdown']]) {
  const sub = [...new Set(json.shapes.flatMap((s) => s[field].map((c) => c.key)))];
  sub.sort((a, b) => (realistic[field].find((c) => c.key === b)?.bytes ?? 0) - (realistic[field].find((c) => c.key === a)?.bytes ?? 0));
  for (const k of sub) {
    const cells = json.shapes.map((s) => {
      const c = s[field].find((x) => x.key === k);
      return c ? `${n(c.bytes)} (${c.share}%)` : '—';
    });
    out.push(`| \`${container}\` | \`${k}\` | ${cells.join(' | ')} |`);
  }
}
out.push('');

out.push('### 4 · churn — one ordinary act, then the same question again');
out.push('');
out.push('| shape | act | before bytes | after bytes | unchanged (deep) | unchanged (top-level keys) | biggest changed key |');
out.push('|---|---|---:|---:|---:|---:|---|');
for (const c of json.churn) {
  const s = shapeOf(c.shape);
  const top = c.changedKeys[0];
  out.push(
    `| ${c.shape} (${s.declaredViews}v/${s.tableColumns}c/${s.materializedEdges}e) | ${c.act} | ${n(c.beforeBytes)} | ${n(c.afterBytes)} | ${c.deepStablePct}% | ${c.topLevelStablePct}% | \`${top ? top.key : '—'}\`${top ? ` (${n(top.beforeBytes)} B)` : ''} |`,
  );
}
out.push('');

out.push('### 5 · floor — the smallest answer that still supports a first correct act');
out.push('');
out.push('| shape | full answer | floor (strict) | floor share | floor (shared column list) | shared share | verbs alone |');
out.push('|---|---:|---:|---:|---:|---:|---:|');
for (const s of json.shapes) {
  out.push(
    `| ${label(s)} | ${n(s.whatsHereBytes)} | ${n(s.floor.strict)} | ${s.floor.strictPct}% | ${n(s.floor.shared)} | ${s.floor.sharedPct}% | ${n(s.floor.verbs)} |`,
  );
}
out.push('');

if (json.tokens.counted) {
  out.push('### 6 · tokens — the optional pass (real endpoint, never estimated)');
  out.push('');
  out.push(`| what | shape | bytes | tokens (${json.tokens.model}) | bytes/token |`);
  out.push('|---|---|---:|---:|---:|');
  for (const r of json.tokens.rows) {
    const m = /^whats_here (\w+)$/.exec(r.what);
    const s = m ? shapeOf(m[1]) : null;
    out.push(`| ${r.what} | ${s ? `${s.declaredViews}v/${s.tableColumns}c/${s.materializedEdges}e` : 'shape-independent'} | ${n(r.bytes)} | ${n(r.tokens)} | ${r.bytesPerToken} |`);
  }
  out.push('');
  out.push(`> ${json.tokens.note}`);
} else {
  out.push('### 6 · tokens');
  out.push('');
  out.push(`Tokens were **not counted**: ${json.tokens.reason}. Every number above is bytes. Do not convert.`);
}
out.push('');

const table = out.join('\n');
writeFileSync(path.join(outDir, 'surface-table.md'), `${table}\n`);
console.log(table);
