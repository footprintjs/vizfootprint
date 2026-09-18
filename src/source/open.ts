/** Open a declared source with the adapters a host brought; `inline` is always known. */
import { inlineSource } from './inline.js';
import { resourceWhere } from './resource.js';
import { ResourceRefusal, SourceRefusal } from './types.js';
import type { DeclaredFold } from './fold/types.js';
import type { ResourceDecl, ResourceFoldOptions, ResourceFoldResult, ResourceHandle, SourceAdapter, SourceDecl, SourceHandle } from './types.js';

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

/**
 * …and the door for a read that FOLDS instead of landing: the same adapters,
 * the same `via` vocabulary, asked for computations over the bytes rather than
 * the bytes (`./fold/README.md`).
 *
 * A THIRD way to have no carrier, and it is a different fact from the other
 * two: the host passed a carrier for this via, and it carries resources, and
 * its transport hands back a whole body — so it has no `fold` to offer and says
 * that rather than quietly landing 169 MB nobody asked for.
 *
 * The handle is closed on the way out however the read went, exactly as the
 * build door closes the one it opened (`../def/buildDashboard.ts` ·
 * `readResource`).
 */
export async function foldResource(
  decl: ResourceDecl,
  resource: string,
  folds: readonly DeclaredFold[],
  adapters: readonly SourceAdapter[] = [],
  options: ResourceFoldOptions = {},
): Promise<ResourceFoldResult> {
  const handle = await openResource(decl, resource, adapters);
  const fold = handle.fold;
  if (fold === undefined) {
    throw new ResourceRefusal(
      'no-adapter',
      `${resourceWhere(resource, decl.via)}: the ${decl.via} adapter this host passed hands back a body it already holds whole — it declares no \`fold\`, and a fold attaches to bytes as they arrive`,
      resource,
      decl.via,
    );
  }
  try {
    return await fold.call(handle, folds, options);
  } finally {
    await handle.close();
  }
}
