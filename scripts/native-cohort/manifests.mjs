import assert from 'node:assert/strict';
import { dirname } from 'node:path';

export const manifestPaths = Object.freeze([
  'package.json', 'ui/package.json', 'studio/package.json', 'bridges/vega-lite/package.json',
]);
export const workspacePaths = Object.freeze(manifestPaths.slice(1).map(path => dirname(path)));

export function requireWorkspaceDeclarations(manifest) {
  assert(Array.isArray(manifest.workspaces), 'literal workspace declarations required');
  assert.deepEqual([...manifest.workspaces].sort(), [...workspacePaths].sort(), 'unsupported workspace declarations');
}
