import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

function importsHost(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let found = false;
  const inspect = node => {
    if (node && ts.isStringLiteralLike(node)) {
      const name = node.text.toLowerCase();
      if (name === 'agentfootprint' || name.startsWith('agentfootprint/')) found = true;
    }
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspect(node.moduleSpecifier);
    if (ts.isExternalModuleReference(node)) inspect(node.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) inspect(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) inspect(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Inspect the files extracted from the actual npm archive, never a dist sibling. */
export async function checkRoutingPackage(packageDir, files) {
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  const isHost = name => typeof name === 'string' && name.toLowerCase() === 'agentfootprint';
  const isHostAlias = spec => typeof spec === 'string' && /^npm:agentfootprint(?:@|$)/i.test(spec.trim());
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      assert(!isHost(name) && !isHostAlias(spec), `${section} must not require the host agent`);
    }
  }
  for (const field of ['bundleDependencies', 'bundledDependencies']) {
    // Boolean true bundles the runtime declarations already checked above.
    const names = manifest[field];
    assert(!Array.isArray(names) || !names.some(name => isHost(name) || isHostAlias(manifest.devDependencies?.[name])), `${field} must not bundle the host agent`);
  }
  for (const { path } of files) {
    if (/(^|\/)node_modules\//.test(path) && path.endsWith('/package.json')) {
      const bundled = JSON.parse(await readFile(join(packageDir, path), 'utf8'));
      assert(!isHost(bundled.name), `Packed ${path} must not bundle the host agent`);
    } else if (path.startsWith('dist/')) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!/agentfootprint/i.test(text), `Packed ${path} contains the host agent name`);
    } else if (path.startsWith('src/') && /\.[cm]?[jt]sx?$/.test(path)) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!importsHost(text, path), `Packed ${path} imports the host agent`);
    }
  }
}
