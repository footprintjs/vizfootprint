# via bench — 5173859+dirty, node v22.16.0, 2026-09-16T15:29:45.599Z

## Dispatch latency (ms): the same gesture with the relation declared (the clause travels) and without (nothing travels)

| engine | rows | arm | median | spread | n |
|---|---|---|---|---|---|
| memory | — | control: 40 ms block | 40.0 | max 40.0 | 3 |
| memory | 20,598 planets | dispatch, no relation (100 planets picked) | 0.2 | max 0.2 | 7 |
| memory | 20,598 planets | dispatch, travels (1 planets picked) | 0.6 | max 1.9 | 7 |
| memory | 20,598 planets | dispatch, travels (100 planets picked) | 0.6 | max 0.7 | 7 |
| memory | 20,598 planets | dispatch, travels (1,000 planets picked) | 1.0 | max 1.1 | 7 |
| memory | 20,598 planets | dispatch, travels (10,000 planets picked) | 3.8 | max 4.2 | 7 |
| memory | 20,598 planets | dispatch, travels (brush over every planet) | 1.3 | max 2.6 | 7 |
| wasm | 20,598 planets | dispatch, no relation (100 planets picked) | 0.1 | max 0.2 | 7 |
| wasm | 20,598 planets | dispatch, travels (1 planets picked) | 1.7 | max 1.9 | 7 |
| wasm | 20,598 planets | dispatch, travels (100 planets picked) | 3.2 | max 3.3 | 7 |
| wasm | 20,598 planets | dispatch, travels (1,000 planets picked) | 8.7 | max 9.3 | 7 |
| wasm | 20,598 planets | dispatch, travels (10,000 planets picked) | 61.0 | max 62.2 | 7 |
| wasm | 20,598 planets | dispatch, travels (brush over every planet) | 13.4 | max 13.9 | 7 |
| memory | 1,000,000 cells | dispatch, no relation (one disease picked) | 0.1 | max 0.2 | 3 |
| memory | 1,000,000 cells | dispatch, travels (one disease picked) | 24.7 | max 24.7 | 3 |
| wasm | 1,000,000 cells | dispatch, no relation (one disease picked) | 0.1 | max 0.2 | 3 |
| wasm | 1,000,000 cells | dispatch, travels (one disease picked) | 18.2 | max 18.5 | 3 |

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

