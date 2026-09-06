/**
 * The vizfootprint/selection door — what it exports, and what it never
 * imports. The second half is the door's reason to exist (PACKAGING.md,
 * Law 3): everything reachable through it is engine-free, so a consumer that
 * holds only a clause type or the built-in port never loads `@uwdata/*`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('vizfootprint/selection barrel', () => {
  it('exports the port, the identity law, the rejection funnel and the emission translation — and no raw clause factory', async () => {
    const barrel = await import('./index.js');
    expect(Object.keys(barrel).sort()).toEqual(
      [
        'RegisteredSource',
        'SelectionPortError',
        'SourceRegistry',
        'SourceRegistryError',
        'builtinSelection',
        'causeClauseFromEmission',
        'causeClauseSpecFromEmission',
        'isRejection',
        'reject',
      ].sort(),
    );
  });

  it('no file in src/selection imports @uwdata — the engine lives behind vizfootprint/mosaic', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const sources = readdirSync(here).filter((f) => f.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      // an IMPORT of the peer — a comment may cite the measured version, an import may not
      expect(/from\s+['"]@uwdata\//.test(readFileSync(`${here}${file}`, 'utf8')), file).toBe(false);
    }
  });
});
