# mosaic — the adapter door

`src/selection` declares the selection **port** in this package's own words, judges every spec once, and answers the port with a built-in that needs no engine. This folder answers the same port with the real engine: `mosaicSelection()` stands every clause on a live `@uwdata/mosaic-core` `Selection`, built by Mosaic's own factories from the shared verdict. It exists for a host that already runs Mosaic — a coordinator, real `MosaicClient` views, interactors of its own on the same `Selection` — and wants the log's cause-tagged clauses on the bus those views answer to. Nothing above the port knows which engine it is holding, and a log written through this adapter is byte-identical to one written through the built-in (`src/selection/README.md`, law 2).

## 1. This is the ONLY importer of the optional peers

`@uwdata/mosaic-core` and `@uwdata/mosaic-sql` are optional `peerDependencies`. `src/mosaic/mosaicSelection.ts` is the one module in the package that imports them; every other door — `vizfootprint/selection` included — stays engine-free, so a consumer that never calls `mosaicSelection()` never loads them. The adapter tests run against the real package (a dev dependency) and pin that no other file under `src/` imports it. The door exports the adapter alone; everything that belongs to the port is imported from `vizfootprint/selection`.

```ts
import { buildDashboard } from 'vizfootprint';
import { mosaicSelection } from 'vizfootprint/mosaic';   // loads the peers — only here

const port = mosaicSelection();                           // a fresh Selection.crossfilter()
const session = buildDashboard(def).createSession({ selection: port });   // every dispatched clause lands on it
// or, below the session: new CauseSelectionSession(port); replayLog(records, undefined, port)
```

## 2. The clause is Mosaic's; the port's clause is a projection beside it

`clause(spec)` takes the shared judge's verdict (`src/selection/judge.ts` — the cause, the identities, the byte) and builds the real Mosaic clause (`clausePoint` / `clauseInterval`, the cell's `and`, the match's `or`/`not`/`literal`) with the cause laid on its `meta` — Mosaic's pre-aggregation reads metadata by known fields only and never rejects an extra key — then projects it to OUR frozen `CauseClause`. `predicateSQL` is `String(clause.predicate)` off the native object (`null` when cleared), checked against the judge's byte at mint: the byte law is enforced in the code, not only in a test. The native clause and the projection are tied by identity in two `WeakMap`s; `update(clause)` pushes the native twin, and a clause minted by another port throws a typed `SelectionPortError` out of `update()` (operation `'update'`) or `skip()` (operation `'skip'`) — never a silent no-op, and the same throw the built-in makes.

```ts
const clause = port.clause({ kind: 'interval', source, field: 'amount', value: [150, null], cause });
if (!isRejection(clause)) {
  clause.predicateSQL;                         // '("amount" BETWEEN 150 AND NULL)' — the engine's own byte
  port.update(clause);                         // Selection.update(the real Mosaic clause)
  port.native().selection.clauses.length;      // 1
  causeOf(port.native().selection.active!);    // the cause, read back off the native clause
}
```

## 3. One client per source, ever — the host's own, or the port's wrapper

Mosaic types a clause's `clients` as `Set<MosaicClient>` and compares them by identity (`skip` is `cross && clause.clients.has(client)`). The client Mosaic must see is the REAL one the coordinator queries for: a host whose views are `MosaicClient`s names them through `clientFor`, consulted once per source and memoized, so `Selection.predicate(plot, true)` self-excludes the plot's own brush. For a source the host does not view itself the port mints ONE `MosaicRegisteredSource extends MosaicClient` wrapper, kept in a per-port `WeakMap`. `port.client(source)` is the only way to get either; a second wrapper minted by hand is a second identity, and `Selection.skip` would silently answer false for it. The native clause's `source` stays the registry object itself, so a host that pushes its own clauses with that source replaces ours by identity.

```ts
const port = mosaicSelection(host, { clientFor: (source) => views.get(source.viewId) });   // the coordinator's clients
port.client(scatter) === views.get('scatter');                    // true — Mosaic compares against the real plot
host.predicate(views.get('scatter'), true);                       // [] — not filtered by its own brush
port.client(a) === port.client(a);                                // true — the wrapper, when the host has no view
port.native().selection.skip(new MosaicRegisteredSource(a), native);   // false — a second identity, never do this
```

## 4. One port per `Selection`, ever

`mosaicSelection(selection)` is idempotent per engine object, the same law the registry keeps per id: a second call on the same `Selection` returns the port already standing on it (same clients, same clauses), and a call carrying a *different* `clientFor` throws `SelectionPortError` (`operation: 'port'`, `reason: 'port-conflict'`). Two ports on one `Selection` would be two wrapper identities, and the second could not read what the first stood.

```ts
const p1 = mosaicSelection(host);
mosaicSelection(host) === p1;                                     // true
mosaicSelection(host, { clientFor: other });                      // throws SelectionPortError — port-conflict
```

## 5. `native()` is for a host that drives the engine directly; foreign clauses are omitted, never denied

The built-in port answers `native()` with a typed rejection; this one answers `{ ok: true, selection }` with the live `Selection`. That is the adapter's reason to exist: a coordinator connects clients to it, a bench pushes transient clauses onto it at 60 Hz and commits once at gesture end, `remove(source)` and `reset()` are Mosaic's own. A `Selection` is a shared bus — a host's own interactors push clauses with sources this port can never replace — so `clauses()` returns only what came through the port (a raw clause has no cause and no registry identity), and `foreign()` is the counter that keeps the omission honest: every native clause standing that this port did not mint. Nothing throws, nothing is silently dropped, and `capabilities.canSkip` is read off the engine (`false` on an intersect/union/single `Selection`, where Mosaic's own `skip` is off).

```ts
const { selection } = port.native();
selection.update(clauseInterval('amount', [lo, hi], { source, clients }));   // transient, engine-only
port.clauses();                                                             // ours only
port.foreign();                                                             // [that transient clause]
log.commit({ ...gestureEnd });                                              // the ONE commit replaces it (same source)
mosaicSelection(Selection.intersect()).capabilities.canSkip;                // false — and skip() answers false
```

## 6. Port listeners are the port's; Mosaic's dispatcher is the engine's

`listen(fn)` keeps the port's own listener set and calls it synchronously inside `update()`, after the engine took the clause — a throw propagates out of `update()`, the same listener law the built-in keeps and the one the log's outbound try/catch relies on to file a failed relay as a typed gap. It is deliberately NOT `Selection.addEventListener`: Mosaic's dispatcher calls callbacks synchronously only while no earlier emit of the same tick is still settling; a second update in one tick is queued to a microtask, where a throw never reaches `update()`. A host that wants Mosaic's queueing attaches to `native().selection` directly and gets Mosaic's law.

```ts
const stop = port.listen((clauses) => redraw(clauses));
port.update(clause);          // redraw ran, already, on return — on the second commit of a tick too
stop();
port.native().selection.addEventListener('value', mosaicClientRefresh);   // the engine's dispatcher, the engine's law
```

## Where the code lives

| file | one job |
|---|---|
| `mosaicSelection.ts` | the adapter: `MosaicRegisteredSource` (the wrapper), `mosaicSelection(selection?, { clientFor? })`, `MosaicSelectionPort` (`native().selection`, `client`, `foreign`), `causeOf(native)` |
| `mosaicSelection.test.ts` | the adapter against the REAL package: byte parity, identity, `clientFor`, the idempotent door, foreign clauses, `canSkip`, listeners, refusals, the session door |
| `index.ts` | the `vizfootprint/mosaic` door — the adapter alone |
| `../selection/judge.ts` | the one verdict per spec both ports mint from |
| `../selection/` | the port, the clause, the registry, the built-in, `SelectionPortError`, the chart emission contract |
| `../session/types.ts` | `SessionOptions.selection` — the consumer path: `createSession({ selection: mosaicSelection() })` |
