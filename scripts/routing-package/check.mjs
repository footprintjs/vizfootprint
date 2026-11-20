import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Inspect the files extracted from the actual npm archive, never a dist sibling. */
export async function checkRoutingPackage(packageDir, files) {
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    assert(!Object.hasOwn(manifest[section] ?? {}, 'agentfootprint'), `${section} must not require the host agent`);
  }
  for (const { path } of files) {
    if (path.startsWith('dist/')) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!/agentfootprint/i.test(text), `Packed ${path} contains the host agent name`);
    } else if (path.startsWith('src/') && path.endsWith('.ts')) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]agentfootprint(?:\/|['"])/i.test(text), `Packed ${path} imports the host agent`);
    }
  }
}
