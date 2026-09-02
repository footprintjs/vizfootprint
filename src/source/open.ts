/** Open a declared source with the adapters a host brought; `inline` is always known. */
import { inlineSource } from './inline.js';
import { SourceRefusal } from './types.js';
import type { SourceAdapter, SourceDecl, SourceHandle } from './types.js';

export async function openSource(decl: SourceDecl, table: string, adapters: readonly SourceAdapter[] = []): Promise<SourceHandle> {
  const adapter = decl.via === 'inline' ? inlineSource : adapters.find((a) => a.via === decl.via);
  if (adapter === undefined) {
    throw new SourceRefusal('no-adapter', `table "${table}" declares a source via ${decl.via}, and no adapter for ${decl.via} was passed — import the ${decl.via} carrier (the library's source/${decl.via} module) and pass it in \`sources\``, table, decl.via);
  }
  return adapter.open(decl, { table });
}
