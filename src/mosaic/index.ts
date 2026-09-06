/**
 * vizfootprint/mosaic — the Mosaic ADAPTER door.
 *
 * Why a door of its own (PACKAGING.md, Law 3): this is the ONLY entry that
 * imports the optional `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` peers.
 * Everything engine-free — the port, the clause, the source registry, the
 * chart emission contract, the typed `SelectionPortError` — lives behind
 * `vizfootprint/selection`; nothing is re-exported from there (Law 2: a door
 * carries what an importer asked for, and no importer has asked).
 */
export { MosaicRegisteredSource, causeOf, mosaicSelection } from './mosaicSelection.js';
export type { MosaicSelectionOptions, MosaicSelectionPort } from './mosaicSelection.js';
