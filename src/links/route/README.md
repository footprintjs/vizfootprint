# Routing boundary

`../route.ts` is the public wiring and preserves `routeNodes`. This sealed folder
owns Viz's routing data types and boundary checks; it contains no scoring or
winner policy. The consumer supplies both callbacks and the declared policy.

- `types.ts`: the required port and the evidence that an act may carry.
- `input.ts`: capture configuration, node data and callback receivers before I/O.
- `scores.ts`: sync-array capture, bounded cardinality/ID/numeric validation and
  declaration order, with async delivery through the shared observer.
- `decision.ts`: delegate delivery and project its evidence and candidate
  references without deciding a floor, tie, winner or menu rule.
- `delivery.ts`: the one receiver-bound observer; copy inside delivery and accept
  only its first settlement for either callback.

Callback inputs are copies. Returned evidence is projected into owned data.
Callable `then` is the async protocol and is captured once. Synchronous evidence
is copied before yielding (score arrays ignore unrelated `then` fields); async
evidence is copied inside its delivery handler, before acknowledging it. Native
Promise resolution does not freeze its value before actual observer delivery.
Only the first fulfillment, rejection or throw settles
that observation, and a rejected decision never becomes an unhandled rejection.
Malformed callbacks become the existing empty unmatched answer; missing port
configuration throws an error naming the required input. Non-finite numbers
remain raw evidence for the consumer's decision. There is no default scorer,
wait timer, retry or history reconstruction.
