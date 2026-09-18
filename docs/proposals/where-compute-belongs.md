# Where compute belongs: a declaration, not a preference

A proposal. Companion to [`data-arrival.md`](./data-arrival.md), which answers the other half — how a source that takes time stays honest.

## The principle, first, because it is easy to get backwards

**If a computation cannot honestly run in the browser, it belongs on a server. Do not force it.**

The goal is not to minimise the server. The goal is to **know which side each computation belongs on, and to support both properly** — so a consumer pays for backend compute when it is genuinely required and not out of habit. A library that contorts a binary into WebAssembly to win an argument has traded correctness for a slogan; a library that assumes a server for everything has charged its consumer for a decision nobody examined.

Both mistakes come from the same place: nobody wrote down where each computation *can* run.

## The evidence that this is worth declaring

One real consumer, one pipeline, measured rather than estimated. Five of its six stages run entirely in the browser:

| stage | runs | cost to the host |
|---|---|---|
| coordinate parse | browser | none |
| solvent-accessible surface area (Shrake–Rupley) | browser | none |
| non-covalent interaction engine | browser | none |
| backbone torsions | browser | none |
| per-residue conservation, over a cited 283-sequence curated alignment | browser | none |

Two are irreducible, and for reasons that can be stated:

| must be server | because | can the need move? |
|---|---|---|
| a model's recommendation | a key cannot live on a static page | **no** |
| `hmmalign` placement | it is a binary | **no** — but its data already did: the family HMM is 11,752 bytes and answers a browser directly |

And the case that makes the argument: **conservation looked like it needed a server and did not.** It was written off as requiring a sequence-database search no browser can reach. For a protein in a known family there is no search — the curated alignment exists, is versioned, and answers a browser. The assumption, not the requirement, was going to cost a backend.

That is the pattern this proposal exists to break, in both directions.

## Three questions, currently conflated

### 1 · Where it CAN run — a fact, declared and checkable

`browser-only` (it needs a canvas or a DOM) · `either` · `server-only` (it needs a binary, a key, a database, or a network peer no browser can reach).

This is a property of the computation, not an opinion about deployment, so the library can hold an author to it.

### 2 · Where it SHOULD run — the consumer's choice, at configuration time

For everything declared `either`. This is where the cost decision lives, and it is made once, in the open, rather than implied by an import.

### 3 · Where it DID run — on the record

Because the two are not the same number. A placement by `hmmalign` and a placement by pairwise alignment to a family consensus give different columns, and a consumer comparing two entries must be able to tell which produced which. So the commit records the strategy, exactly as it records which version of a source it was true of.

This is already proven in practice: one consumer ships both arms of a placement port, runs the weaker one, and says so in four places from one owner — the card's figures, the stage's own line, the note, and the act's honesty record.

### And the door

**An impossible pairing is refused at configuration time, by name.** *You asked for this in the browser and it needs a key.* That is a build-time error a consumer finds before deploying, not a runtime surprise a user finds instead.

## The part a consumer can put in a spreadsheet

Once every computation declares where it *can* run, **the server floor can be read off the configuration rather than estimated.**

> Two of eighteen computations force a server. Everything else is declared `either` and configured `browser`. Here is what that costs.

That is a number a buyer can act on, and it falls out of a declaration the library needs anyway. Nobody ships this.

## What a browser will and will not tell you about its own limits

If a strategy is going to be chosen on capability, the capability has to be knowable. Measured in a real browser on a 32 GB machine:

```
navigator.deviceMemory                 32   GiB   rounded + capped; Chrome only
performance.memory.jsHeapSizeLimit      3.76 GB   the number that actually binds
measureUserAgentSpecificMemory()       ABSENT     the STANDARD one
crossOriginIsolated                    false      which is why it is absent
navigator.hardwareConcurrency          18 cores
navigator.storage.estimate().quota      8   GiB   disk, not RAM
navigator.connection.downlink          10 Mbps    → 169 MB ≈ 2¼ minutes
```

Read that carefully, because the obvious signal is the misleading one:

- **`deviceMemory` reported 32 GiB while the JS heap is capped at 3.76 GB** — off by nearly ten times. Reasoning from it would be confidently wrong.
- The number that binds is **non-standard and Chrome-only**.
- The **standard** replacement is absent, because it requires cross-origin isolation — which a static site served from a host whose headers you do not control **cannot grant**. On that deployment target the correct API is unavailable by construction.
- The **reliable** signals are the ones nobody reaches for first: **storage quota** (widely supported, and it says a 169 MB body can be cached comfortably) and **downlink** (which makes that body a two-minute transfer — often the binding constraint, not memory).

So the design move the measurements actually point to is **caching keyed by the version already read out of the source's own header**, not memory budgeting.

### The rule that has to govern any capability probe

**A probe may inform a REFUSAL or a DECLARED fallback, and either way it lands on the record. It may never silently change what a number means.**

If a library reads a memory figure and quietly takes a 283-sequence alignment instead of a 3,982-sequence one, the same page yields a different score on two machines with nothing saying why. *Your laptop had 4 GB* is not an acceptable unstated reason for a different answer. Two honest uses:

1. **refuse before starting, with the number** — which the size guard already does; or
2. **choose among declared alternatives and record which and why** — then two machines give two answers and both are comparable, because each says what it is over.

**And an absent probe is not a small budget.** Two of the three major engines report none of the memory APIs. *Refuse on evidence, never on ignorance* applies exactly: if you cannot measure, you attempt and handle failure, or you take the declared default. Degrading because you could not see is the worst of both.

## Two honesties, or the argument does not survive scrutiny

**Browser compute is not free — it is the user's device.** The cost moves off the host's ledger and onto their battery, their cores, and a heap smaller than their RAM by an order of magnitude. And onto their connection: a 169 MB body is two minutes at the rate measured above, which is what `saveData` exists to signal. Claiming "zero cost" without saying that is the first thing a sceptical reader will take apart.

**And a browser-computed number is self-reported, where a server-computed one can be attested.** You cannot prove what ran on somebody else's machine. For a library whose whole claim is provenance that is a real tension — and it is precisely why question 3 matters. The record says where a number was computed, so the difference is visible rather than assumed away.

## What this deliberately does not add

**A runtime that silently relocates work.** Automatic placement would decide the most consequential question on a page — what a number means — without telling anyone. The declaration is the feature; the scheduler is the thing to refuse.

Also out: compiling server-only tools into the browser to avoid the declaration; any capability probe that changes a result rather than a refusal; and a cost model that counts host spend while ignoring the user's device.

## Order

1. **`can-run` as a declaration**, with the configuration-time refusal for an impossible pairing. The rest depends on it.
2. **`did-run` on the record**, generalised from the one consumer that already does it by hand.
3. **`should-run` in configuration**, with the server floor readable from it.
4. **Capability probes** — last, as the fallback for a computation that genuinely must hold something whole, and bound by the rule above.
