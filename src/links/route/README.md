# Routing boundary

`../route.ts` is the public wiring and preserves `routeNodes`. This sealed folder
owns Viz's routing data types and boundary checks; it contains no scoring or
winner policy. The consumer supplies both callbacks and the declared policy.

- `types.ts`: the required port and the evidence that an act may carry.
- `input.ts`: capture configuration, node data and callback receivers before I/O.
- `scores.ts`: bounded cardinality/ID/numeric validation and declaration order.
- `decision.ts`: project returned evidence and candidate references without
  deciding a floor, tie, winner or menu rule.

Callback inputs are copies. Returned evidence is projected into owned data.
Malformed callbacks become the existing empty unmatched answer; missing port
configuration throws an error naming the required input. Non-finite numbers
remain raw evidence for the consumer's decision. There is no default scorer,
wait timer, retry or history reconstruction.
