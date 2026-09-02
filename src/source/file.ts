/**
 * The file carrier — a path or a file URL read by THIS process (node). Its
 * own module, imported only by a host that has files: the core never loads
 * `node:fs`. The version is what the file system vouches for: modification
 * time and size, taken AFTER the bytes so it never describes bytes that were
 * not returned.
 */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodeRows } from './decode.js';
import type { SourceAdapter, SourceDecl } from './types.js';

function pathOf(at: unknown, table: string): string {
  if (typeof at !== 'string' || at.length === 0) throw new Error(`table "${table}" file source: \`at\` must be a path or a file URL`);
  return at.startsWith('file:') ? fileURLToPath(at) : at;
}

export const fileSource: SourceAdapter = {
  via: 'file',
  async open(decl: SourceDecl, { table }) {
    const path = pathOf(decl.at, table);
    const where = `table "${table}" file source ${path}`;
    return {
      capabilities: { live: false, pushdown: false },
      snapshot: async (options) => {
        const text = await readFile(path, { encoding: 'utf8', ...(options?.signal ? { signal: options.signal } : {}) });
        const info = await stat(path);
        let payload: unknown = text;
        if (decl.format === 'rows') {
          // `rows` over a file is a JSON list; the JSON door is the same one `json` uses, with the same sentence
          try {
            payload = JSON.parse(text);
          } catch {
            throw new Error(`${where}: format rows needs a JSON list of row objects, and the file is not JSON`);
          }
        }
        const rows = decodeRows(decl.format, payload, decl.options);
        if ('rejected' in rows) throw new Error(`${where}: ${rows.rejected}`);
        return { rows, version: `mtime:${info.mtime.toISOString()};size:${String(info.size)}`, retrievedAt: new Date().toISOString() };
      },
      close: async () => {},
    };
  },
};
