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
  for (const section of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    assert(!Object.hasOwn(manifest[section] ?? {}, 'agentfootprint'), `${section} must not require the host agent`);
  }
  for (const { path } of files) {
    if (path.startsWith('dist/')) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!/agentfootprint/i.test(text), `Packed ${path} contains the host agent name`);
    } else if (path.startsWith('src/') && /\.[cm]?[jt]sx?$/.test(path)) {
      const text = await readFile(join(packageDir, path), 'utf8');
      assert(!importsHost(text, path), `Packed ${path} imports the host agent`);
    }
  }
}
