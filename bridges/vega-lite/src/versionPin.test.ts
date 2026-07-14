/**
 * The version-pinning discipline (README.md; docs/proposals/renderer-protocol.md
 * §"Decision": "keep the conformance kit as internal CI machinery, pinned to
 * exact framework versions and re-run on every upstream bump"). This bridge
 * pins `vega`/`vega-lite` to EXACT versions in package.json (no `^`) so an
 * upstream release never silently changes what v1 honestly supports — an
 * upgrade is a deliberate edit to package.json, re-verified against the spec
 * gate and the conformance loop, never a transitive drift.
 *
 * This test is the enforcement: it reads the INSTALLED package versions (what
 * actually resolved into node_modules) and asserts they equal the pin this
 * bridge's own package.json declares. A `^`/`~` range creeping back into
 * package.json, or an installed version drifting from the pin (a stale lock,
 * a manual npm install bypassing the pin), fails loud here instead of surfacing
 * as a silent behavior change downstream.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);

const ownPkg = require('../package.json') as {
  readonly dependencies: Readonly<Record<string, string>>;
};

/**
 * The installed version of `name`, read off ITS OWN package.json — walked up
 * from the resolved entry file rather than `require(\`${name}/package.json\`)`,
 * because neither vega nor vega-lite's `exports` map exposes the
 * `./package.json` subpath (a bare require of it is `ERR_PACKAGE_PATH_NOT_EXPORTED`).
 */
function installedVersion(name: string): string {
  let dir = dirname(require.resolve(name));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === name && typeof pkg.version === 'string') return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`installedVersion: could not locate ${name}'s own package.json`);
    dir = parent;
  }
}

describe('version pin — vega/vega-lite are EXACT-pinned, and the installed versions match', () => {
  it.each(['vega', 'vega-lite'] as const)('package.json pins %s to an exact version (no ^ / ~ / range)', (name) => {
    const pin = ownPkg.dependencies[name];
    expect(pin, `${name} must be a declared dependency`).toBeDefined();
    expect(pin, `${name}'s pin must be an exact semver — no ^, ~, x, or range operators`).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it.each(['vega', 'vega-lite'] as const)('the INSTALLED %s version equals the pin', (name) => {
    const pin = ownPkg.dependencies[name];
    const installed = installedVersion(name);
    expect(
      installed,
      `installed ${name}@${installed} must match the pinned ${name}@${String(pin)} — an upstream bump must be a deliberate package.json edit`,
    ).toBe(pin);
  });
});
