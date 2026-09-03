# `src/detach` — a reader never holds the object the system is still using

One law, one helper.

The FOLD derives what may responsibly be claimed now, and a LENS serves a
bounded view of that fold to a reader. If the reader is handed the very object
the session is still reading from, then the reader can change what the system
believes without a commit — and the whole claim of this library (everything on
screen is derived from the TRACE) is false.

So every read surface hands out something the system will not read back. There
are exactly two ways to do that, and each read surface picks one on cost:

| way | cost | use it when |
|---|---|---|
| `deepFreeze(x)` | no allocation; one-way door | the value is finished: the validated def (the MAP), a landed commit (the TRACE), the materialized link graph |
| `copyValue(x)`, or a plain spread | one allocation | the object is not yours to freeze — someone else still writes to it: a store's list, a ledger that grows, or a payload the CALLER handed in and is still using |

The second row is the one people forget, because detaching cuts both ways. A
frozen thing is safe to hand out; it is not safe to have taken. The commit log
copies the `value` a caller passes before it freezes the record, or landing a
commit would freeze the caller's own array under it.

`deepFreeze` walks plain objects and arrays only. Class instances and
functions are left untouched — a def carries author functions and live
analysis modules, and freezing those would break working dashboards. It also
STOPS at anything already frozen, which is what keeps re-freezing the link
graph cheap; that shortcut has exactly two documented exceptions in this repo.
Read the header of `deepFreeze.ts` before adding a third: it lists both, and
says what to do instead.
