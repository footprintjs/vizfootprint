# via bench — 1cc5b13+dirty, node v22.16.0, 2026-09-12T15:30:38.643Z

## Dispatch latency (ms): the same gesture with the relation declared (the clause travels) and without (nothing travels)

| engine | rows | arm | median | spread | n |
|---|---|---|---|---|---|
| memory | — | control: 40 ms block | 40.0 | max 40.0 | 3 |
| memory | 20,598 planets | dispatch, no relation (100 planets picked) | 0.2 | max 0.4 | 7 |
| memory | 20,598 planets | dispatch, travels (1 planets picked) | 0.5 | max 1.7 | 7 |
| memory | 20,598 planets | dispatch, travels (100 planets picked) | 2.1 | max 2.2 | 7 |
| memory | 20,598 planets | dispatch, travels (1,000 planets picked) | 16.6 | max 16.7 | 7 |
| memory | 20,598 planets | dispatch, travels (10,000 planets picked) | 184.7 | max 209.8 | 7 |
| memory | 20,598 planets | dispatch, travels (brush over every planet) | 1.5 | max 4.2 | 7 |
| wasm | 20,598 planets | dispatch, no relation (100 planets picked) | 0.2 | max 0.2 | 7 |
| wasm | 20,598 planets | dispatch, travels (1 planets picked) | 2.1 | max 2.2 | 7 |
| wasm | 20,598 planets | dispatch, travels (100 planets picked) | 3.2 | max 3.3 | 7 |
| wasm | 20,598 planets | dispatch, travels (1,000 planets picked) | 9.1 | max 10.1 | 7 |
| wasm | 20,598 planets | dispatch, travels (10,000 planets picked) | 62.4 | max 62.8 | 7 |
| wasm | 20,598 planets | dispatch, travels (brush over every planet) | 14.2 | max 14.6 | 7 |
| memory | 1,000,000 cells | dispatch, no relation (one disease picked) | 0.1 | max 0.5 | 3 |
| memory | 1,000,000 cells | dispatch, travels (one disease picked) | 26.3 | max 27.2 | 3 |
| wasm | 1,000,000 cells | dispatch, no relation (one disease picked) | 0.1 | max 0.2 | 3 |
| wasm | 1,000,000 cells | dispatch, travels (one disease picked) | 20.3 | max 21.5 | 3 |

## The set on the wire: `JSON.stringify(activeSelections[0].travelled).length`

| engine | rows | arm | far values | bytes |
|---|---|---|---|---|
| memory | 20,598 planets | dispatch, travels (1 planets picked) | 1 | 294 |
| memory | 20,598 planets | dispatch, travels (100 planets picked) | 97 | 1,305 |
| memory | 20,598 planets | dispatch, travels (1,000 planets picked) | 791 | 8,560 |
| memory | 20,598 planets | dispatch, travels (10,000 planets picked) | 1,989 | 21,064 |
| memory | 20,598 planets | dispatch, travels (brush over every planet) | 2,000 | 21,179 |
| wasm | 20,598 planets | dispatch, travels (1 planets picked) | 1 | 294 |
| wasm | 20,598 planets | dispatch, travels (100 planets picked) | 97 | 1,305 |
| wasm | 20,598 planets | dispatch, travels (1,000 planets picked) | 791 | 8,560 |
| wasm | 20,598 planets | dispatch, travels (10,000 planets picked) | 1,989 | 21,064 |
| wasm | 20,598 planets | dispatch, travels (brush over every planet) | 2,000 | 21,179 |
| memory | 1,000,000 cells | dispatch, travels (one disease picked) | 70 | 969 |
| wasm | 1,000,000 cells | dispatch, travels (one disease picked) | 70 | 969 |

