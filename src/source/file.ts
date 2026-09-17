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
import { resourceSnapshotOf, resourceWhere, type ResourceBody } from './resource.js';
import { ResourceRefusal, SourceRefusal } from './types.js';
import type { ResourceDecl, ResourceSnapshot, SnapshotOptions, SourceAdapter, SourceDecl, SourceUnchanged } from './types.js';

/** What the file system vouches for: modification time and size. */
function versionOf(info: { readonly mtime: Date; readonly size: number }): string {
  return `mtime:${info.mtime.toISOString()};size:${String(info.size)}`;
}

/** The locator, resolved — a path as given, a `file:` URL turned into one. `undefined` when the declaration carries neither. */
function resolvePath(at: unknown): string | undefined {
  if (typeof at !== 'string' || at.length === 0) return undefined;
  return at.startsWith('file:') ? fileURLToPath(at) : at;
}

function pathOf(at: unknown, table: string): string {
  const path = resolvePath(at);
  if (path === undefined) throw new SourceRefusal('malformed', `table "${table}" file source: \`at\` must be a path or a file URL`, table, 'file');
  return path;
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
  async openResource(decl: ResourceDecl, { resource }) {
    const resolved = resolvePath(decl.at);
    if (resolved === undefined) throw new ResourceRefusal('malformed', `${resourceWhere(resource, 'file')}: \`at\` must be a path or a file URL`, resource, 'file');
    // named once, here, with the refusal already thrown: a HOISTED `snapshot` below cannot carry
    // the narrowing (it could be called before the guard ran), so the narrow type is the declaration's
    const path: string = resolved;
    const where = resourceWhere(resource, 'file', path);
    // the two signatures are `ResourceHandle.snapshot`'s own (`./types.js`): only a CONDITIONAL read may answer `unchanged`
    async function snapshot(options?: SnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
    async function snapshot(options: SnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
    async function snapshot(options?: SnapshotOptions): Promise<ResourceSnapshot | SourceUnchanged> {
      let landed: ResourceBody;
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        if (options?.sinceVersion !== undefined) {
          // the same conditional read the rows get: the file system's own version decides without moving the bytes
          const now = await stat(path);
          const version = versionOf(now);
          if (version === options.sinceVersion) return { unchanged: true, version };
        }
        const signal = options?.signal ? { signal: options.signal } : {};
        // `readFile` with no encoding answers a Buffer, which IS a `Uint8Array` — passed
        // through rather than copied: a structure file is exactly the size a second copy hurts at
        landed = decl.format === 'bytes' ? { format: 'bytes', body: await readFile(path, signal) } : { format: 'text', body: await readFile(path, { encoding: 'utf8', ...signal }) };
        info = await stat(path); // after the bytes, so the version never describes bytes that were not returned
      } catch (e) {
        if (options?.signal?.aborted) throw new ResourceRefusal('cancelled', `${where}: cancelled — the read was aborted`, resource, 'file');
        /* v8 ignore next -- node's fs errors always carry a code; the message arm is for a foreign thrower — the SAME sentence and the same reason as the rows door above (`fileSource.open`), deliberately not a fourth way to say it */
        const code = (e as { code?: string }).code ?? (e as Error).message;
        throw new ResourceRefusal('unavailable', `${where}: unavailable — ${code}`, resource, 'file');
      }
      // …and NOTHING else: no decode, no columns to judge, no landing to compare with a declaration
      return resourceSnapshotOf(landed, versionOf(info), new Date().toISOString());
    }
    return { capabilities: { live: false, pushdown: false }, snapshot, close: async () => {} };
  },
};
