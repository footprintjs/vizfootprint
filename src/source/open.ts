/** Open a declared source with the adapters a host brought; `inline` is always known. */
import { inlineSource } from './inline.js';
import { resourceWhere } from './resource.js';
import { ResourceRefusal, SourceRefusal } from './types.js';
import type { ResourceDecl, ResourceHandle, SourceAdapter, SourceDecl, SourceHandle } from './types.js';

export async function openSource(decl: SourceDecl, table: string, adapters: readonly SourceAdapter[] = []): Promise<SourceHandle> {
  const adapter = decl.via === 'inline' ? inlineSource : adapters.find((a) => a.via === decl.via);
  if (adapter === undefined) {
    throw new SourceRefusal('no-adapter', `table "${table}" declares a source via ${decl.via}, and no adapter for ${decl.via} was passed — import the ${decl.via} carrier (the library's source/${decl.via} module) and pass it in \`sources\``, table, decl.via);
  }
  return adapter.open(decl, { table });
}

/**
 * The same door for a RESOURCE — the same `via` vocabulary and the same
 * adapters, asked for bytes.
 *
 * TWO ways to have no carrier, and they are different facts, so they are
 * different sentences under one reason (`no-adapter`): the host passed no
 * adapter for this via at all, or it passed one that carries TABLES only
 * (`SourceAdapter.openResource` is optional, so a carrier written before
 * resources existed is still valid). Neither is ever answered with rows.
 */
export async function openResource(decl: ResourceDecl, resource: string, adapters: readonly SourceAdapter[] = []): Promise<ResourceHandle> {
  const adapter = decl.via === 'inline' ? inlineSource : adapters.find((a) => a.via === decl.via);
  const where = resourceWhere(resource, decl.via);
  if (adapter === undefined) {
    throw new ResourceRefusal('no-adapter', `${where}: no adapter for ${decl.via} was passed — import the ${decl.via} carrier (the library's source/${decl.via} module) and pass it in \`sources\``, resource, decl.via);
  }
  if (adapter.openResource === undefined) {
    throw new ResourceRefusal('no-adapter', `${where}: the ${decl.via} adapter this host passed carries tables only — it declares no \`openResource\`, and a resource is never read as rows`, resource, decl.via);
  }
  return adapter.openResource(decl, { resource });
}
