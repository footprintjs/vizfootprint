// Inert USTAR bytes for the existing inspector; no npm, build or package execution.
import { gzipSync } from 'node:zlib';

export const SOURCE = { head: '1'.repeat(40), tree: '2'.repeat(40) };
export const TESTED = { head: '3'.repeat(40), tree: SOURCE.tree };
export const manifest = { name: 'footprint-storydeck', version: '0.13.3', type: 'module',
  scripts: { prepack: 'throw-if-executed' } };
export const profile = { archive: ['dist/', 'plugin/', 'site/public/deck-stage.js', '*.d.ts', '*.css', 'CHANGELOG.md'] };

export function fixtureFiles(changes = {}) {
  return Object.fromEntries(Object.entries({
    'package/package.json': JSON.stringify(manifest),
    'package/README.md': 'Readme', 'package/LICENSE': 'MIT', 'package/CHANGELOG.md': 'Changes',
    'package/dist/index.js': 'globalThis.__storydeckPackageExecuted = true;',
    'package/plugin/index.js': 'export const plugin = true;',
    'package/site/public/deck-stage.js': 'browser-only fixture',
    'package/index.d.ts': 'export declare const value: boolean;',
    'package/storydeck.css': ':root {color: black}', ...changes,
  }).map(([name, text]) => [name, Buffer.from(text)]));
}

export function archive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const [name, bytes, type = '0'] = entry;
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0' + '00', 257);
    const checksum = [...header].reduce((a, b) => a + b, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
