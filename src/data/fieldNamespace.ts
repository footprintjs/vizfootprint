/**
 * A field address compiled for the native string-column port. This is only
 * metadata: no rows, engine, session, transport or authorization is created.
 * The host supplies an immutable dataset snapshot identity and uses the issued
 * native names in its backing schema, rows, clauses and declared mappings.
 */
export interface QualifiedFieldReference {
  /** Opaque immutable snapshot identity, including the host's version/basis. */
  readonly datasetRef: string;
  readonly table: string;
  readonly field: string;
}

export interface FieldBinding {
  readonly field: string;
  readonly nativeField: string;
  readonly reference: QualifiedFieldReference;
}

export interface FieldNamespaceOptions {
  readonly datasetRef: string;
  readonly table: string;
  readonly fields: readonly string[];
}

export interface FieldNamespace {
  readonly bindings: readonly FieldBinding[];
  /** A declared original field. Throws rather than inventing a new binding. */
  field(name: string): FieldBinding;
  /** Exact membership in this declaration; never decodes an arbitrary token. */
  resolve(nativeField: string): FieldBinding;
}

export type FieldNamespaceErrorCode = 'invalid-input' | 'unknown-field' | 'unknown-native-field';
export class FieldNamespaceError extends Error {
  readonly code: FieldNamespaceErrorCode;
  constructor(code: FieldNamespaceErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FieldNamespaceError';
    this.code = code;
  }
}

/** Hosts must reserve this prefix against unqualified backing-column names. */
export const FIELD_NAMESPACE_PREFIX = '__vzf_field_v1_';

const MAX_COMPONENT_CHARACTERS = 512;
const MAX_FIELDS = 256;
const KEYS = new Set(['datasetRef', 'table', 'fields']);

function component(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_COMPONENT_CHARACTERS) {
    throw new FieldNamespaceError('invalid-input', `${name} must be a non-empty string of at most ${MAX_COMPONENT_CHARACTERS} UTF-16 code units`);
  }
  return value; // opaque identity: no trimming, case folding or Unicode normalization
}

/**
 * Lowercase ASCII prevents even a case-insensitive SQL identifier comparison
 * from merging two addresses. Four hex digits per UTF-16 code unit preserve
 * every string exactly; UTF-8 conversion would replace unpaired surrogates.
 */
function nativeAddress(datasetRef: string, table: string, field: string): string {
  const tuple = JSON.stringify([datasetRef, table, field]);
  const units = new Array<string>(tuple.length);
  for (let index = 0; index < tuple.length; index++) units[index] = tuple.charCodeAt(index).toString(16).padStart(4, '0');
  return FIELD_NAMESPACE_PREFIX + units.join('');
}

/**
 * Compiles at most 256 declared fields in O(total metadata characters), with
 * O(1) membership lookups. Components are bounded at 512 UTF-16 code units.
 *
 * A JSON tuple encodes boundaries and escapes without a lossy hash or delimiter
 * collision. Fixed-width UTF-16 hex then protects against case-insensitive SQL
 * identifier comparison. SQL callers still use the existing quoteIdent door.
 * Equal complete tuples intentionally produce equal addresses across rebuilds.
 * Matching addresses do not prove the host's data, access rights or freshness.
 */
export function createFieldNamespace(options: FieldNamespaceOptions): FieldNamespace {
  if (typeof options !== 'object' || options === null || Array.isArray(options)
    || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !KEYS.has(key))) {
    throw new FieldNamespaceError('invalid-input', 'expected { datasetRef, table, fields }');
  }
  const datasetRef = component(options.datasetRef, 'datasetRef');
  const table = component(options.table, 'table');
  if (!Array.isArray(options.fields) || options.fields.length > MAX_FIELDS) {
    throw new FieldNamespaceError('invalid-input', `fields must be an array of at most ${MAX_FIELDS} declared names`);
  }
  const fields: string[] = [];
  const names = new Set<string>();
  // Validate every declaration before compiling one, including array holes.
  for (let index = 0; index < options.fields.length; index++) {
    const field = component(options.fields[index], `fields[${index}]`);
    if (names.has(field)) throw new FieldNamespaceError('invalid-input', 'fields contains a duplicate name');
    names.add(field);
    fields.push(field);
  }
  const byField = new Map<string, FieldBinding>();
  const byNative = new Map<string, FieldBinding>();
  const bindings = Object.freeze(fields.map(field => {
    const reference = Object.freeze({ datasetRef, table, field });
    const binding = Object.freeze({ field, reference, nativeField: nativeAddress(datasetRef, table, field) });
    byField.set(field, binding);
    byNative.set(binding.nativeField, binding);
    return binding;
  }));
  return Object.freeze({
    bindings,
    field(name: string): FieldBinding {
      const binding = byField.get(name);
      if (binding === undefined) throw new FieldNamespaceError('unknown-field', 'field is not declared in this namespace');
      return binding;
    },
    resolve(nativeField: string): FieldBinding {
      const binding = byNative.get(nativeField);
      if (binding === undefined) throw new FieldNamespaceError('unknown-native-field', 'native field is not declared in this namespace');
      return binding;
    },
  });
}
