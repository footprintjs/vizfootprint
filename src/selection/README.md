# selection — the port is ours; the engine is somebody's

A session holds ONE selection: the clauses standing now, who put each there, and which chart each must not filter. For a long time that selection was a live Mosaic `Selection.crossfilter()` — and nothing read it. Filtering went through `session.activeFilters` → `provider.evaluate` → `src/data/predicate.ts`; no chart was a Mosaic client; the one Mosaic-derived byte anywhere was `CommitRecord.predicateSQL`, the `String()` of a clause's predicate. So this folder declares the selection in this package's own words — a **port** — and the Mosaic engine becomes an adapter behind `vizfootprint/mosaic`, the only door that imports the optional `@uwdata/*` peers. Nothing here imports them.

## 1. The port is OUR shape

`SelectionPort` is the whole surface: `clause(spec)` mints, `update(clause)` pushes, `clauses()` reads, `skip(client, clause)` answers cross-filter self-exclusion, `listen(fn)` subscribes, `native()` hands back the engine's own object when there is one. A clause is `CauseClause` — `{ kind, source, clients, value, predicateSQL, meta: { type, cause } }`, frozen at mint (the clause, its meta, its cause; `clients` is a projection a caller can mutate without steering the port) — and a problem is a typed `SelectionRejection` through one `reject()` funnel, never a bare `false`. The log, the session and every chart hold the port; none of them may know which engine answers it. A host chooses the engine once, at session birth: `createSession({ selection: mosaicSelection() })`, or `new CauseSelectionSession(port)`.

```ts
import { builtinSelection, isRejection } from 'vizfootprint/selection';

const port = builtinSelection();                               // no engine at all
const clause = port.clause({ kind: 'interval', source, field: 'amount', value: [10, 30], cause });
if (isRejection(clause)) throw new Error(clause.reason);      // 'unsupported-shape' | 'unknown-source'
port.update(clause);
port.clauses();                                                // [clause] — a frozen array of frozen clauses
```

## 2. One verdict per spec, whichever engine — and one byte

`judge.ts` decides a spec ONCE for every port: the cause gate (a malformed cause THROWS `CauseValidationError` — R12, not a shape problem), the identity gate over `source` **and every `clients` entry** (`unknown-source`), the shape verdict (`unsupported-shape`, an unknown kind included — and, for the one kind whose value is a QUESTION and an ANSWER in one object, a walk that records the ids but no `seed`/`derivation`/`hops`: the byte is made of the ids alone, so nothing downstream would notice until a bring-over re-asks the walk from a seed that was never there) and the byte. `CommitRecord.predicateSQL` is the one persisted engine-derived byte, and a log written by the built-in and by the Mosaic adapter must be byte-identical — so the judge renders **Mosaic's rules, oddities included**, through `mosaicDescriptorSQL` in `src/data/predicate.ts`, measured on `@uwdata/mosaic-core@0.28.1` and pinned in `src/data/predicate.test.ts` against the real factories for every kind × shape: a half-open pair renders `BETWEEN 150 AND NULL`, a string bound renders as a double-quoted *column reference*, a cleared clause renders `null` (the log spells it `String(null)`, once, for every engine). `resolvePredicateSQL` beside it is the honest SQL the engines execute and deliberately diverges on exactly those shapes; that is a different byte for a different job, and neither may drift toward the other. The adapter takes the verdict and builds only its native twin — the ports cannot disagree, because there is one judge.

```ts
const sqlOf = (spec: CauseClauseSpec): string | null => {
  const c = port.clause(spec);
  if (isRejection(c)) throw new Error(c.reason);
  return c.predicateSQL;
};
sqlOf({ kind: 'interval', source, field: 'amount', value: [150, null], cause });
// '("amount" BETWEEN 150 AND NULL)'   — what Mosaic emits, not what a database wants
sqlOf({ kind: 'interval', source, field: 'date', value: ['2026-04-01', '2026-04-30'], cause });
// '("date" BETWEEN "2026-04-01" AND "2026-04-30")'
sqlOf({ kind: 'interval', source, field: 'amount', value: null, cause });
// null — the log spells it String(null) → "null"
sqlOf({ kind: 'point', source, field: 'pValue', value: { id: 'a1', table: 'data' }, cause });
// '("pValue" IN ([object Object]))' — Mosaic's string coercion, the byte the analysis lane has always carried
port.clause({ kind: 'point', source, field: 'x', value: 1, cause, clients: ['bar'] as never });
// { ok: false, reason: 'unknown-source', … } — on the built-in AND on Mosaic
```

The only point value either engine refuses is one string coercion itself refuses (a Symbol); a plain object is a byte, not a refusal, because the real factory renders it.

## 3. Listeners are synchronous, and a throw propagates

`update()` resolves the clause list and then calls every listener, in order, before it returns. A listener that throws throws out of `update()`. The log's outbound step wraps `port.update` in the one try/catch that files a failed relay as a typed gap (`onSelectionUpdateFailed`); a port that swallowed or deferred the throw would turn that gap into silence.

```ts
const seen: number[] = [];
port.listen((clauses) => seen.push(clauses.length));
port.update(clause);            // seen === [1], already, on return
port.listen(() => { throw new Error('chart broke'); });
port.update(clause);            // throws 'chart broke' — the clause is standing anyway
```

## 4. One object per source id, ever

A clause names its origin by OBJECT IDENTITY — `resolve` drops clauses whose `source` is the same object, `skip` asks `clients.has(client)`. Identity cannot be serialized, so `SourceRegistry` restores it by reconstruction: the same id returns the same `RegisteredSource` within one registry, a conflicting re-registration (actor, label **or `does`**) throws, and a fresh registry rebuilds fresh objects for the same ids (the replay contract). The rebuilt meta carries `does` too: the record stamps `source.meta`, and the log's wire parser accepts `does` back in, so a registry that dropped it would write records its own reader could never have produced. `RegisteredSource` is a plain class — the port owns the identity law, not the engine; an adapter that needs its engine's client type wraps a source once, never mints a second identity.

```ts
const registry = new SourceRegistry();
const a = registry.register('bar', { actor: 'user', label: 'Category bar', does: 'filters by category' });
registry.register('bar', { actor: 'user', label: 'Category bar', does: 'filters by category' }) === a;   // true — same object
registry.register('bar', { actor: 'agent' });                                                            // throws SourceRegistryError
```

## 5. A clause a port did not mint is a typed throw, on every engine

`update()` and `skip()` accept only clauses THIS port minted; a clause from another port (or a hand-built object) throws `SelectionPortError`, whose `rejection` names the act (`operation: 'update' | 'skip'`) and the reason (`unknown-source`). The built-in keeps a port-private set per clause and the Mosaic adapter keeps its native twin, and both answer the misuse the same way — a session that works on one engine must not break the day a host hands in the other. Through the log this rides the listener law: the outbound try/catch files it as a gap.

```ts
const stranger = builtinSelection().clause(spec) as CauseClause;
port.update(stranger);   // throws SelectionPortError — rejection { engine, operation: 'update', reason: 'unknown-source' }
port.skip(a, stranger);  // throws SelectionPortError — operation: 'skip'
```

## 6. The built-in invents nothing without a caller

`builtinSelection()` transcribes the two Mosaic rules a caller in this repo actually relies on — crossfilter `resolve` (drop the same source, push only with a predicate) and `skip` — and stops. No `reset`, no single-mode, no `remove`; `native()` is an honest rejection, because there is no live engine selection to hand back. The `ok` arm is `NativeSelection` — `{ ok: true, selection }` — which an adapter narrows to its engine's type.

```ts
port.native();
// { ok: false, engine: 'builtin', operation: 'native', reason: 'no-live-selection', detail: '…' }
port.capabilities;   // { liveSelection: false, canSkip: true }
```

## 7. A chart never builds a clause

A chart emits `{ rawValue, encoding }` — a value already in DATA space by its own scale, and the field + kind it maps to — and nothing else can ride along. `causeClauseSpecFromEmission` is the one translation to a spec; `causeClauseFromEmission` mints it on the port that will stand it, which is why the port is a parameter and never defaulted: a clause minted on a fresh built-in and pushed onto the session's Mosaic port would be a clause its engine never saw (law 5 makes that loud).

```ts
const emission: ChartEmission = { rawValue: [10, 20], encoding: { kind: 'interval', field: 'amount' } };
const clause = causeClauseFromEmission(emission, { source, cause }, session.log.port);
```

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the data: `SelectionEngine`, `RegisteredSource` + `SourceRegistry` (the identity law), `CauseClause`, `CauseClauseSpec`, `SelectionCapabilities`, `SelectionRejection` + `reject()`, `isRejection` (re-exported from `src/data` — one guard for the package), `SelectionPortError`, `NativeSelection`, `SelectionPort` |
| `judge.ts` | the one verdict per spec: cause gate, identity gate over source + clients, shape verdict, the byte (`mosaicDescriptorSQL`); `rejectionOf(engine, error)` — the one catch every port's door uses. Not on the barrel |
| `builtinSelection.ts` | the engine-free port: Mosaic's `resolve`/`skip` transcribed, a port-private client set per clause |
| `emission.ts` | the chart contract: `ChartEmission` + encodings, `causeClauseSpecFromEmission`, `causeClauseFromEmission(emission, ctx, port)` |
| `index.ts` | the `vizfootprint/selection` door |
| `../data/predicate.ts` | `mosaicDescriptorSQL` — the byte law's renderer, beside the honest `resolvePredicateSQL` it must not become |
| `../mosaic/` | the Mosaic ADAPTER door — the only importer of `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` |
| `../session/types.ts` | `SessionOptions.selection` — where a host hands a session its port |
