# `src/log` — the TRACE

The MAP is what could happen. The WALKER moves through it. **This folder is the
TRACE: the append-only record of what happened and why.** The FOLD is derived
from it, and a LENS serves a bounded view of that fold to a reader.

Everything this library claims rests on one property of this folder: *the trace
is tamper-evident*. If a commit — or the cause on a commit — can be edited
after the fact, then "the dashboard explains itself" is not a claim about
reality, it is a claim about whatever the last person to touch the array felt
like. So this folder is written defensively, and the three laws below are why
each piece of it looks the way it does.

---

## Law 1 — the trace is append-only, and it is enforced, not promised

An hour before this was written, all three of these worked:

```ts
const s = dashboard.createSession();
s.log.records.push(forgedCommit);        // ① the log grew by a commit nobody made
record.cause.intent = 'REWRITTEN';       // ② the record of WHY, rewritten after the fact
deserializeLog('[{"anything":"at all"}]'); // ③ any shape at all came back in as history
```

None of them work now. Each was closed at a different depth, because each was
open at a different depth.

### ① The records live privately; readers get a frozen view

`CauseSelectionSession` keeps its records in `#records` — a real private field,
not a `private` annotation a cast can walk around. `commit()` is the only
writer and it only ever pushes.

`records` is a **getter** that returns a frozen array:

```ts
const s = new CauseSelectionSession();
s.commit({ id: 'c1', parent: null, viewId: 'scatter', actorMeta: { actor: 'user' },
           kind: 'interval', field: 'price', value: [10, 90],
           cause: { requestedBy: 'user', computedBy: 'user', intent: 'brushed the mid band' } });

s.records.push(forged);   // TypeError: Cannot add property 1, object is not extensible
s.records.length = 0;     // TypeError
s.records[0] = forged;    // TypeError
s.records.length;         // 1 — unchanged
```

**Why an array and not an iterator.** Every reader in this repo asks the log
questions an array answers directly: `.find`, `.map`, `.length`, index access,
and being passed straight to a function typed `readonly CommitRecord[]` (the
fold, `causalChain`, `why`, the FDR stream, the UI adapter). A frozen array is
already unpushable, unspliceable and unassignable, so an iterator would buy no
safety at all — it would just cost every one of those call sites a spread back
into an array. The frozen array is the cheaper spelling of the same guarantee.

**The snapshot is detached, on purpose.** A reader holding `records` across a
later `commit()` keeps seeing the log as it was when it asked. That is what a
fold wants — a fold is a claim about a moment. Ask again to see the moment
after. Cost: one array copy on the first read after each commit, then free until
the next commit; the records inside are shared, which is safe because each one
is frozen.

### ② The freeze is deep, because the shallow one left the cause writable

`Object.freeze(record)` is one level. `record.cause` is a different object, and
it was not frozen — so the field that says *why* was the one field anybody could
rewrite. The freeze now reaches the cause, the value, the field pair, the client
ids, the actor meta and the data versions:

```ts
Object.isFrozen(record.cause);         // true
record.cause.intent = 'REWRITTEN';     // TypeError
delete record.cause.intent;            // TypeError
(record.value as number[]).push(999);  // TypeError
```

**How deep, exactly, and why that depth.** `deepFreeze` (see
[`src/detach`](../detach/README.md)) walks plain objects and arrays only. A
class instance or a function inside a record is left alone — a `value` that is a
live object is not protected, and that is stated rather than hidden. Every value
this library itself commits is plain JSON, which is the whole of the wire
contract (`CommitRecord.value`: *must be JSON-serializable*).

**Detaching cuts both ways.** The record never **aliases** what the caller
passed: `value`, `clientViewIds`, `fields` and `data` are all copied into the
record before it is frozen. `value` is the one that matters most and is easiest
to miss — a multi-select hands in the array the UI is still holding, and
without the copy, landing the commit would freeze the caller's own array under
it:

```ts
const values = ['Formal', 'Party'];
await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values, cause });

values.push('Casual');                 // fine — still the caller's array
session.log.records[0].value.values;   // ['Formal', 'Party'] — history did not move
```

**Both doors, not just the record.** A commit lands in two places at once: the
record that joins the trace, and the clause the live selection stands on. They
are built from the SAME copy. If only the record were copied, a caller filling
its array afterwards would still be editing the selection that had already
landed — a change to what the dashboard is showing, with no commit behind it,
which is the exact thing this folder exists to make impossible.

**And in that ORDER.** `commit()` runs in two phases: everything that can throw
(the cause gate, the registry lookups, the clause, the data stamp,
`predicateSQL`, the deep freeze) happens while nothing has moved; then the
record is pushed. The selection update comes LAST, because it is the one
OUTBOUND step — it relays to downstream selections and emits to every listener a
host attached, which is third-party code running after the commit is already
history. It cannot un-land that commit: a session installs
`onSelectionUpdateFailed` and files the failure as a gap; with no hook installed
the error is rethrown, never swallowed. The full law, and why the two halves are
ordered this way, is in
[`src/session/README.md`](../session/README.md) — "an act either fully happens,
or it does not happen at all".

### ③ `parseCommitLog` — the door back in

`deserializeLog` used to check `Array.isArray` and hand the result back cast as
history. It now runs `parseCommitLog`, which judges five things in order and
stops at the **first bad record**, so the refusal is a sentence about one commit
rather than a wall of text:

1. **shape** — every required field present and correctly typed, no key we do
   not know, and the `cause` validated through the existing `parseCause`;
2. **no duplicate ids** — a parent chain is only navigable while an id names one
   commit;
3. **every parent present** — a dangling parent is a history with a hole in it,
   and the fold would silently stop there;
4. **no cycles** — a parent chain must terminate at a root;
5. **rebuilt data-only** and deeply frozen — nothing smuggled through JSON (an
   extra property, a `__proto__` own key, a getter) survives the door.

```ts
deserializeLog('[{"anything":"at all"}]');
// CommitLogParseError: invalid commit log: commit #0 (no id): unknown key
//   "anything"; id must be a non-empty string; missing parent (use null for a
//   root commit); viewId must be a non-empty string; actorMeta must be an
//   object; …                      ← one sentence, naming the record once

parseCommitLog([{ ...good, id: 'c2', ts: 'soon' }, ...more]);
// { ok: false, problems: ['commit #1 "c2": ts must be a finite number'] }

parseCommitLog([a, b]);   // a.parent === 'b', b.parent === 'a'
// { ok: false, problems: ['commit #0 "a": its parent chain loops back to "a" —
//   a commit cannot be its own ancestor'] }
```

`parseCommitLog` never throws (it returns the problems, like `parseCause`);
`deserializeLog` is the throwing twin and raises `CommitLogParseError`, which
carries `problems` for a caller that wants the list rather than the sentence.

One deliberate exception: **`value` may be absent**. JSON has no `undefined`, so
a commit whose value was `undefined` comes back with the key gone. Any type is
legal in that slot — the value is inert data.

---

## Law 2 — a commit id is unique per DASHBOARD, not per session

The old comment on `CommitRecord.id` promised uniqueness "within a log", and the
counter lived on the session. Two sessions opened on one `buildDashboard` both
minted `s1`, `s2`, `s3` — and because **bookmarks and saved pictures live in a
dashboard-level store**, a bookmark made in session A was visible in session B
and seeking it there silently landed on B's *different* `s1`. The same name
meant one act in A and another in B, with no error anywhere.

The counter now lives on the dashboard runtime, beside the other shared stores:

```ts
const dash = await buildDashboard(def);
const a = dash.createSession();
const b = dash.createSession();

await a.dispatch(...);   // s1
await b.dispatch(...);   // s2  — never s1 again
await a.dispatch(...);   // s3

a.log.records.map(r => r.id);   // ['s1', 's3']   ← gaps, and that is correct
b.log.records.map(r => r.id);   // ['s2']
```

**A session's own log therefore has gaps in its numbering.** Nothing reads an id
as a position — order is carried by `ts` and by the parent chain — so a gap
costs nothing, and it is the visible sign that the identity is dashboard-wide.

What depends on this: bookmarks (`b1` → commit `s3`) and saved pictures both
name commit ids and both live beside the log at dashboard level, so they are
read by every session on that dashboard. Anything that joins a name to a moment
across sessions is only sound because ids do not collide.

The counter mints ids for a dashboard **runtime**, so two separate
`buildDashboard` calls — two different dashboards — do start again at `s1`. That
is the same scope as the bookmark and picture stores, which is exactly the scope
that needs to agree.

**A number a restored record already points at is spent.** The persistence
doors would otherwise reopen the same hole one step along: a host puts back a
bookmark on `s7` from last week into a FRESH dashboard whose counter starts at
0, and that dashboard cheerfully mints `s7` again — so the bookmark starts
resolving to a real but WRONG act. Restoring therefore raises the counter past
every commit id the record names (a bookmark's moment, a picture's `from`
list), exactly as restoring a `p7` already raised the picture counter:

```ts
const dash = buildDashboard(def);
dash.restoreBookmarks([{ name: 'from last week', commitId: 's7', by: 'user', at: … }]);

const s = dash.createSession();
await s.dispatch(…);
s.log.records[0].id;   // 's8' — never s1…s7
```

**Is `(sessionId, commitId)` needed instead?** No — not for anything this
library does. A compound key would only earn its cost if logs minted by
*different dashboard runtimes* were merged into one history, and nothing does
that: the stores that join names to moments are per dashboard, and the two
doors that carry records between runtimes (`restoreSaved`, `restoreBookmarks`)
now raise the counter rather than risk a collision. A compound key would also
have to be threaded through the wire shape, the parent chain, every ref, every
`#s1` prose ref and every parser — a large change to buy something a counter
already guarantees. If a future feature really does merge two dashboards'
logs, that is the moment to revisit it, and this note is the place it should
start.

---

## Law 3 — replay is a mode, not a rewrite

`replayLog` rebuilds a log into a FRESH selection and a FRESH registry. It adds
`cause.replayed = true` and touches nothing else: `requestedBy` and `computedBy`
survive verbatim, and so does `correlationId` (an address, not provenance). This
is R2, and `causeHistogram` exists to prove it — it counts
`requestedBy>computedBy` pairs and deliberately ignores `replayed` and `intent`,
so a histogram is invariant across a replay.

The conformance law that binds this folder to the session fold — *folding as you
walk equals folding a replay* — is written up beside its test, in
[`src/session/README.md`](../session/README.md).
