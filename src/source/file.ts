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
import { SourceRefusal } from './types.js';
import type { SourceAdapter, SourceDecl } from './types.js';

/** What the file system vouches for: modification time and size. */
function versionOf(info: { readonly mtime: Date; readonly size: number }): string {
  return `mtime:${info.mtime.toISOString()};size:${String(info.size)}`;
}

function pathOf(at: unknown, table: string): string {
  if (typeof at !== 'string' || at.length === 0) throw new SourceRefusal('malformed', `table "${table}" file source: \`at\` must be a path or a file URL`, table, 'file');
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
        let text: string;
        let info: Awaited<ReturnType<typeof stat>>;
        try {
          if (options?.sinceVersion !== undefined) {
            // a conditional read: the file system's own version (mtime;size) decides without moving the bytes
            const now = await stat(path);
            const version = versionOf(now);
            if (version === options.sinceVersion) return { unchanged: true, version };
          }
          text = await readFile(path, { encoding: 'utf8', ...(options?.signal ? { signal: options.signal } : {}) });
          info = await stat(path);
        } catch (e) {
          // the caller's signal → cancelled; anything the file system refuses → unavailable, with its own code
          if (options?.signal?.aborted) throw new SourceRefusal('cancelled', `${where}: cancelled — the read was aborted`, table, 'file');
          /* v8 ignore next -- node's fs errors always carry a code; the message arm is for a foreign thrower */
          const code = (e as { code?: string }).code ?? (e as Error).message;
          throw new SourceRefusal('unavailable', `${where}: unavailable — ${code}`, table, 'file');
        }
        let payload: unknown = text;
        if (decl.format === 'rows') {
          // `rows` over a file is a JSON list; the JSON door is the same one `json` uses, with the same sentence
          try {
            payload = JSON.parse(text);
          } catch {
            throw new SourceRefusal('malformed', `${where}: format rows needs a JSON list of row objects, and the file is not JSON`, table, 'file');
          }
        }
        const rows = decodeRows(decl.format, payload, decl.options);
        if ('rejected' in rows) throw new SourceRefusal('malformed', `${where}: ${rows.rejected}`, table, 'file');
        return { rows, version: versionOf(info), retrievedAt: new Date().toISOString() };
      },
      close: async () => {},
    };
  },
};
