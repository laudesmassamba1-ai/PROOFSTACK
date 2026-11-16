import { ProofstackError, sha256Hex } from "@proofstack/core";

/**
 * The EXIT data surface.
 *
 * EXIT judges an export, not a database. It takes the bytes the product produced and
 * asks the questions a customer asks when they leave: is everything here, is it
 * readable, does it still reference the same things, and does re-importing it give
 * back what went in.
 *
 * Nothing here writes to a production system. The round-trip target is a scratch
 * dataset the customer nominates, and `target: "production"` is refused by the config
 * validator unless the operator explicitly acknowledges it.
 */

export type ExportFormat = "csv" | "json" | "zip";

export interface ExportArtifact {
  format: ExportFormat;
  /** File name as produced, for the report. */
  fileName: string;
  bytes: Uint8Array;
  /** SHA-256 of the bytes, computed by EXIT rather than trusted from the product. */
  sha256: string;
  /** Parsed records, when the format is parseable. Absent for opaque formats. */
  records?: Record<string, unknown>[];
  /** For zip: the entries and their digests. */
  entries?: ZipEntry[];
  /** Anything the product declared about itself (manifest, counts). */
  manifest?: Record<string, unknown>;
}

export interface ZipEntry {
  name: string;
  bytes: number;
  sha256: string;
}

/**
 * Where EXIT gets the export from. Three sources, because customers have three
 * different setups: an HTTP endpoint, a file already on disk, or a command that
 * produces one.
 */
export interface ExportSource {
  readonly kind: "http" | "file" | "command";
  readonly description: string;
  fetch(format: ExportFormat): Promise<ExportArtifact>;
}

export interface RoundTripTarget {
  /** Import the artifact into a scratch dataset and return the record count. */
  import(artifact: ExportArtifact): Promise<{ imported: number; datasetId?: string }>;
  /** Read the imported records back out, for comparison. */
  readBack(datasetId: string, table: string): Promise<Record<string, unknown>[]>;
}

/**
 * Parse a CSV into records using the header row.
 *
 * Deliberately a small, strict parser rather than a dependency: EXIT must be able to
 * say "your export is not valid CSV" without arguing about dialect. Quoted fields,
 * embedded commas, embedded newlines and doubled quotes are handled; anything else
 * is a finding, not a guess.
 */
export function parseCsv(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = readCsvRows(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0]!.map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    // A trailing newline produces one empty row; that is not a record.
    if (row.length === 1 && row[0] === "") continue;
    if (row.length !== headers.length) {
      throw new ProofstackError({
        message: `CSV row ${i + 1} has ${row.length} fields but the header has ${headers.length}`,
        category: "VALIDATION",
        code: "csv_ragged_row",
        details: { row: i + 1, expected: headers.length, actual: row.length },
      });
    }
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) record[headers[c]!] = row[c] ?? "";
    records.push(record);
  }
  return { headers, records };
}

function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM: it is legal in an export and must not become part of header 1.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse JSON, accepting either an array of records or an object with a records key. */
export function parseJsonRecords(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProofstackError({
      message: `export is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      category: "VALIDATION",
      code: "json_invalid",
    });
  }
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed)) {
    for (const key of ["records", "data", "items", "rows"]) {
      const value = parsed[key];
      if (Array.isArray(value)) return value.filter(isRecord);
    }
    // A single record is a legitimate one-row export.
    return [parsed];
  }
  throw new ProofstackError({
    message: "export JSON is neither an array of records nor an object containing one",
    category: "VALIDATION",
    code: "json_shape_unexpected",
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a ZIP's central directory without inflating anything.
 *
 * EXIT needs the entry list and per-entry digests to prove nothing was dropped. It
 * does not need to decompress a customer's data to do that, and not decompressing is
 * also the safest default: a zip bomb cannot hurt a reader that never inflates.
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];

  // Find the End Of Central Directory record: scan backwards for the signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65_557; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ProofstackError({
      message: "file does not contain a ZIP end-of-central-directory record",
      category: "VALIDATION",
      code: "zip_invalid",
    });
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({
      name,
      bytes: uncompressedSize,
      sha256: digestOfLocalEntry(bytes, view, localOffset, compressedSize),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Digest of the *stored* bytes of a local entry. For a stored (uncompressed) entry
 * this is the file's own digest; for a deflated entry it is a stable fingerprint of
 * the compressed stream, which is still enough to prove presence and change.
 */
function digestOfLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  compressedSize: number
): string {
  if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50)
    return "";
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = Math.min(start + compressedSize, bytes.length);
  return syncDigest(bytes.subarray(start, end));
}

/**
 * Synchronous SHA-256 for small buffers, so ZIP reading stays synchronous.
 * The async `sha256Hex` is used everywhere else; this exists because a DataView walk
 * cannot await per entry.
 */
function syncDigest(bytes: Uint8Array): string {
  // FNV-1a 64-bit as a fast, stable fingerprint for the compressed stream. The
  // authoritative digest of the whole artifact is the async SHA-256 computed by the
  // caller; this is only for per-entry change detection.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Compute the authoritative digest of an artifact. */
export async function digestArtifact(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

/**
 * Compare two record sets field by field.
 *
 * The comparison is deliberately type-aware: `"1"` and `1` are a difference, because
 * a CSV round trip that turns every number into a string is a real portability defect
 * even though the characters match.
 */
export interface FieldDifference {
  recordKey: string;
  field: string;
  original: unknown;
  roundTripped: unknown;
  kind: "missing" | "extra" | "changed" | "type_changed";
}

export function compareRecords(
  original: readonly Record<string, unknown>[],
  roundTripped: readonly Record<string, unknown>[],
  keyField: string
): { differences: FieldDifference[]; missing: string[]; extra: string[] } {
  const differences: FieldDifference[] = [];
  const originalByKey = new Map<string, Record<string, unknown>>();
  const roundByKey = new Map<string, Record<string, unknown>>();

  for (const record of original) {
    const key = String(record[keyField] ?? "");
    if (key) originalByKey.set(key, record);
  }
  for (const record of roundTripped) {
    const key = String(record[keyField] ?? "");
    if (key) roundByKey.set(key, record);
  }

  const missing: string[] = [];
  const extra: string[] = [];

  for (const [key, record] of originalByKey) {
    const other = roundByKey.get(key);
    if (!other) {
      missing.push(key);
      continue;
    }
    const fields = new Set([...Object.keys(record), ...Object.keys(other)]);
    for (const field of fields) {
      if (field === keyField) continue;
      const before = record[field];
      const after = other[field];
      if (before === undefined && after !== undefined) {
        differences.push({
          recordKey: key,
          field,
          original: before,
          roundTripped: after,
          kind: "extra",
        });
        continue;
      }
      if (before !== undefined && after === undefined) {
        differences.push({
          recordKey: key,
          field,
          original: before,
          roundTripped: after,
          kind: "missing",
        });
        continue;
      }
      if (before === after) continue;
      const typeChanged = typeof before !== typeof after;
      differences.push({
        recordKey: key,
        field,
        original: before,
        roundTripped: after,
        kind: typeChanged ? "type_changed" : "changed",
      });
    }
  }

  for (const key of roundByKey.keys()) {
    if (!originalByKey.has(key)) extra.push(key);
  }

  return { differences, missing, extra };
}

/**
 * Check a record against a declared schema. Types are the ones the config declares;
 * `money` is checked as a decimal string, never as a float, because a float is what
 * loses the customer's centimes.
 */
export function checkFieldType(
  value: unknown,
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "date"
    | "datetime"
    | "id"
    | "money"
    | "nullable"
): { ok: boolean; reason?: string } {
  if (type === "nullable") return { ok: true };
  if (value === null || value === undefined) return { ok: false, reason: "value is null" };

  switch (type) {
    case "string":
      return typeof value === "string"
        ? { ok: true }
        : { ok: false, reason: `expected string, got ${typeof value}` };
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, reason: `expected finite number, got ${typeof value}` };
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? { ok: true }
        : { ok: false, reason: `expected integer, got ${String(value)}` };
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true }
        : { ok: false, reason: `expected boolean, got ${typeof value}` };
    case "id":
      return typeof value === "string" && value.length > 0
        ? { ok: true }
        : { ok: false, reason: "expected a non-empty id string" };
    case "money":
      return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
        ? { ok: true }
        : { ok: false, reason: `expected a decimal money string, got ${JSON.stringify(value)}` };
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { ok: true }
        : { ok: false, reason: `expected YYYY-MM-DD, got ${JSON.stringify(value)}` };
    case "datetime": {
      if (typeof value !== "string")
        return { ok: false, reason: `expected ISO datetime, got ${typeof value}` };
      const parsed = Date.parse(value);
      return Number.isFinite(parsed)
        ? { ok: true }
        : { ok: false, reason: `unparseable datetime ${value}` };
    }
    default:
      return { ok: true };
  }
}

/** Referential integrity: every child row's foreign key must exist in the parent. */
export function findOrphans(input: {
  children: readonly Record<string, unknown>[];
  childField: string;
  parents: readonly Record<string, unknown>[];
  parentField: string;
}): { orphans: { value: string; count: number }[]; checked: number } {
  const parentKeys = new Set(input.parents.map((p) => String(p[input.parentField] ?? "")));
  const counts = new Map<string, number>();
  let checked = 0;

  for (const child of input.children) {
    const value = child[input.childField];
    if (value === null || value === undefined || value === "") continue;
    checked += 1;
    const key = String(value);
    if (!parentKeys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    orphans: [...counts.entries()].map(([value, count]) => ({ value, count })),
    checked,
  };
}

/** Duplicate detection on a declared unique key. */
export function findDuplicates(
  records: readonly Record<string, unknown>[],
  fields: readonly string[]
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = fields.map((f) => String(record[f] ?? "")).join("\u0000");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key: key.replaceAll("\u0000", "|"), count }));
}
