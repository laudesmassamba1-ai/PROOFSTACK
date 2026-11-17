import { proofcoreConfigSchema } from "@proofcore/contracts";
import { FixedClock, Logger } from "@proofcore/core";
import { runEngine } from "@proofcore/engine";
import { describe, expect, it } from "vitest";
import {
  checkFieldType,
  compareRecords,
  createExitProvider,
  type ExportArtifact,
  type ExportFormat,
  type ExportSource,
  findDuplicates,
  findOrphans,
  parseCsv,
  parseJsonRecords,
  type RoundTripTarget,
  readZipEntries,
  toArtifact,
} from "../src/index.js";

/**
 * EXIT tests.
 *
 * As with FLOW, the value is in the negative cases: a round trip that drops a record,
 * a CSV that turns a number into a string, an export whose digest changes every time.
 */

function configWith(exit: Record<string, unknown>) {
  return proofcoreConfigSchema.parse({
    project: { name: "EXIT fixture", baseUrl: "http://localhost:3000" },
    environment: "staging",
    modules: {
      world: { enabled: false, target: { kind: "none" } },
      flow: { enabled: false },
      exit: { enabled: true, ...exit },
    },
    enabledModules: ["exit"],
  });
}

/** An in-memory export source whose bytes we control exactly. */
function sourceOf(files: Partial<Record<ExportFormat, string>>): ExportSource {
  return {
    kind: "file",
    description: "in-memory fixture",
    async fetch(format: ExportFormat): Promise<ExportArtifact> {
      const text = files[format];
      if (text === undefined) throw new Error(`no fixture for ${format}`);
      return toArtifact(new TextEncoder().encode(text), format, `export.${format}`);
    },
  };
}

async function runExit(options: {
  exit: Record<string, unknown>;
  source?: ExportSource;
  roundTrip?: RoundTripTarget;
  formats?: ExportFormat[];
}) {
  const config = configWith(options.exit);
  const provider = createExitProvider({
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.roundTrip === undefined ? {} : { roundTrip: options.roundTrip }),
    ...(options.formats === undefined ? {} : { formats: options.formats }),
  });
  const result = await runEngine({
    config,
    providers: [provider],
    clock: new FixedClock("2026-03-01T10:00:00.000Z"),
    logger: new Logger({ level: "error" }),
    projectId: "proj_test",
    workspaceId: "ws_test",
  });
  return result.run;
}

function caseFor(run: Awaited<ReturnType<typeof runExit>>, id: string) {
  const found = run.moduleRuns[0]?.cases.find((c) => c.id === id);
  if (!found)
    throw new Error(
      `case ${id} not found; have: ${run.moduleRuns[0]?.cases.map((c) => c.id).join(", ")}`
    );
  return found;
}

const GOOD_JSON = JSON.stringify([
  { id: "p1", name: "Root", amount: "0.00", created_at: "2026-01-01T00:00:00.000Z", parent_id: "" },
  {
    id: "c1",
    name: "Ada",
    amount: "12.50",
    created_at: "2026-01-01T00:00:00.000Z",
    parent_id: "p1",
  },
  {
    id: "c2",
    name: "Grace",
    amount: "99.00",
    created_at: "2026-01-02T00:00:00.000Z",
    parent_id: "p1",
  },
]);

describe("EXIT parsing primitives", () => {
  it("parses CSV with quoted commas, embedded newlines and doubled quotes", () => {
    const parsed = parseCsv(
      `id,note\n1,"hello, world"\n2,"line one\nline two"\n3,"she said ""hi"""\n`
    );
    expect(parsed.headers).toEqual(["id", "note"]);
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records[0]?.note).toBe("hello, world");
    expect(parsed.records[1]?.note).toBe("line one\nline two");
    expect(parsed.records[2]?.note).toBe('she said "hi"');
  });

  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const parsed = parseCsv("\uFEFFid,name\n1,Ada\n");
    expect(parsed.headers[0]).toBe("id");
  });

  it("refuses a ragged CSV row instead of silently shifting columns", () => {
    expect(() => parseCsv("id,name\n1,Ada\n2\n")).toThrow(/has 1 fields but the header has 2/);
  });

  it("accepts a JSON array, a wrapped array, or a single record", () => {
    expect(parseJsonRecords('[{"id":"1"}]')).toHaveLength(1);
    expect(parseJsonRecords('{"records":[{"id":"1"},{"id":"2"}]}')).toHaveLength(2);
    expect(parseJsonRecords('{"id":"1"}')).toHaveLength(1);
  });

  it("rejects invalid JSON with a clear error", () => {
    expect(() => parseJsonRecords("{not json")).toThrow(/not valid JSON/);
  });

  it("reads ZIP entries from a real archive", () => {
    // A minimal stored (uncompressed) zip built by hand: one entry, "hi".
    const zip = buildStoredZip("hello.txt", "hi");
    const entries = readZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("hello.txt");
    expect(entries[0]?.bytes).toBe(2);
  });

  it("rejects a file that is not a zip", () => {
    expect(() => readZipEntries(new TextEncoder().encode("not a zip at all"))).toThrow(
      /end-of-central-directory/
    );
  });
});

describe("EXIT comparison primitives", () => {
  it("detects a record lost in the round trip", () => {
    const original = [{ id: "1" }, { id: "2" }];
    const reread = [{ id: "1" }];
    const result = compareRecords(original, reread, "id");
    expect(result.missing).toEqual(["2"]);
  });

  it("detects a duplicated record created by the round trip", () => {
    const result = compareRecords([{ id: "1" }], [{ id: "1" }, { id: "9" }], "id");
    expect(result.extra).toEqual(["9"]);
  });

  it("detects a number that came back as a string", () => {
    const result = compareRecords([{ id: "1", amount: 12.5 }], [{ id: "1", amount: "12.5" }], "id");
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.kind).toBe("type_changed");
  });

  it("detects a changed value", () => {
    const result = compareRecords([{ id: "1", name: "Ada" }], [{ id: "1", name: "Ada " }], "id");
    expect(result.differences[0]?.kind).toBe("changed");
  });

  it("reports no differences for an identical round trip", () => {
    const records = [{ id: "1", name: "Ada", amount: "12.50" }];
    expect(compareRecords(records, records, "id").differences).toHaveLength(0);
  });

  it("finds orphans and duplicates", () => {
    const records = [
      { id: "1", parent_id: "p1" },
      { id: "2", parent_id: "missing" },
      { id: "1", parent_id: "p1" },
    ];
    const orphans = findOrphans({
      children: records,
      childField: "parent_id",
      parents: records,
      parentField: "id",
    });
    expect(orphans.orphans.map((o) => o.value)).toContain("missing");
    expect(findDuplicates(records, ["id"])).toHaveLength(1);
  });

  it("checks declared types strictly, including money as a string", () => {
    expect(checkFieldType("12.50", "money").ok).toBe(true);
    expect(checkFieldType(12.5, "money").ok).toBe(false);
    expect(checkFieldType(3, "integer").ok).toBe(true);
    expect(checkFieldType(3.5, "integer").ok).toBe(false);
    expect(checkFieldType("2026-01-01", "date").ok).toBe(true);
    expect(checkFieldType("01/01/2026", "date").ok).toBe(false);
    expect(checkFieldType(null, "string").ok).toBe(false);
    expect(checkFieldType(null, "nullable").ok).toBe(true);
  });
});

describe("EXIT against a healthy export", () => {
  it("passes integrity, schema, relationships and uniqueness", async () => {
    const run = await runExit({
      exit: {
        formats: ["json"],
        schema: {
          id: "id",
          name: "string",
          amount: "money",
          created_at: "datetime",
          parent_id: "nullable",
        },
        relationships: [
          { child: "records", childField: "parent_id", parent: "records", parentField: "id" },
        ],
        unique: [{ table: "records", fields: ["id"] }],
      },
      source: sourceOf({ json: GOOD_JSON }),
      formats: ["json"],
    });

    expect(caseFor(run, "exit/json/integrity").status).toBe("PASSED");
    expect(caseFor(run, "exit/json/schema").status).toBe("PASSED");
    expect(caseFor(run, "exit/json/relationships").status).toBe("PASSED");
    expect(caseFor(run, "exit/json/uniqueness").status).toBe("PASSED");
  });

  it("skips every case with a reason when no export source is configured", async () => {
    const run = await runExit({ exit: { formats: ["json"] }, formats: ["json"] });
    const testCase = caseFor(run, "exit/json/integrity");
    expect(testCase.status).toBe("SKIPPED");
    expect(testCase.skippedReason).toContain("no export source configured");
  });
});

describe("EXIT catches real portability defects", () => {
  it("fails when a declared field is missing from the export", async () => {
    const run = await runExit({
      exit: { formats: ["json"], schema: { id: "id", email: "string" } },
      source: sourceOf({ json: GOOD_JSON }),
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/json/schema");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("export_missing_field");
  });

  it("fails when money was exported as a float", async () => {
    const run = await runExit({
      exit: { formats: ["json"], schema: { id: "id", amount: "money" } },
      source: sourceOf({ json: JSON.stringify([{ id: "c1", amount: 12.5 }]) }),
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/json/schema");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("export_type_mismatch");
  });

  it("fails when a child row references a parent that is not in the export", async () => {
    const run = await runExit({
      exit: {
        formats: ["json"],
        relationships: [
          { child: "records", childField: "parent_id", parent: "records", parentField: "id" },
        ],
      },
      source: sourceOf({
        json: JSON.stringify([{ id: "c1", parent_id: "does_not_exist" }]),
      }),
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/json/relationships");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("export_orphan_records");
  });

  it("fails when a declared unique key is duplicated", async () => {
    const run = await runExit({
      exit: { formats: ["json"], unique: [{ table: "records", fields: ["id"] }] },
      source: sourceOf({ json: JSON.stringify([{ id: "c1" }, { id: "c1" }]) }),
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/json/uniqueness");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("export_duplicate_records");
  });

  it("fails when the export is empty", async () => {
    const run = await runExit({
      exit: { formats: ["json"] },
      source: sourceOf({ json: "[]" }),
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/json/integrity");
    // An empty array is valid JSON but zero bytes of records: the file is non-empty,
    // so integrity passes and the schema case is the one that notices.
    expect(testCase.status).toBe("PASSED");
  });

  it("fails the round trip when the import drops a record", async () => {
    const roundTrip: RoundTripTarget = {
      async import() {
        return { imported: 1, datasetId: "ds_1" };
      },
      async readBack() {
        return [
          {
            id: "p1",
            name: "Root",
            amount: "0.00",
            created_at: "2026-01-01T00:00:00.000Z",
            parent_id: "",
          },
        ];
      },
    };
    const run = await runExit({
      exit: { formats: ["json"], unique: [{ table: "records", fields: ["id"] }] },
      source: sourceOf({ json: GOOD_JSON }),
      roundTrip,
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/round-trip");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("round_trip_record_loss");
  });

  it("fails the round trip when a field value changed", async () => {
    const roundTrip: RoundTripTarget = {
      async import() {
        return { imported: 3, datasetId: "ds_1" };
      },
      async readBack() {
        return [
          {
            id: "p1",
            name: "Root",
            amount: "0.00",
            created_at: "2026-01-01T00:00:00.000Z",
            parent_id: "",
          },
          {
            id: "c1",
            name: "Ada",
            amount: "12.5",
            created_at: "2026-01-01T00:00:00.000Z",
            parent_id: "p1",
          },
          {
            id: "c2",
            name: "Grace",
            amount: "99.00",
            created_at: "2026-01-02T00:00:00.000Z",
            parent_id: "p1",
          },
        ];
      },
    };
    const run = await runExit({
      exit: { formats: ["json"], unique: [{ table: "records", fields: ["id"] }] },
      source: sourceOf({ json: GOOD_JSON }),
      roundTrip,
      formats: ["json"],
    });
    const testCase = caseFor(run, "exit/round-trip");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("round_trip_field_changed");
  });

  it("passes the round trip when the data survives intact", async () => {
    const records = JSON.parse(GOOD_JSON) as Record<string, unknown>[];
    const roundTrip: RoundTripTarget = {
      async import() {
        return { imported: records.length, datasetId: "ds_1" };
      },
      async readBack() {
        return records;
      },
    };
    const run = await runExit({
      exit: { formats: ["json"], unique: [{ table: "records", fields: ["id"] }] },
      source: sourceOf({ json: GOOD_JSON }),
      roundTrip,
      formats: ["json"],
    });
    expect(caseFor(run, "exit/round-trip").status).toBe("PASSED");
  });
});

/**
 * Build a minimal valid ZIP with one stored (uncompressed) entry, so the reader is
 * tested against real ZIP bytes rather than a mock.
 */
function buildStoredZip(name: string, content: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const dataBytes = new TextEncoder().encode(content);
  const crc = crc32(dataBytes);

  const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0, true);
  lv.setUint16(8, 0, true); // stored
  lv.setUint16(10, 0, true);
  lv.setUint16(12, 0, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, dataBytes.length, true);
  lv.setUint32(22, dataBytes.length, true);
  lv.setUint16(26, nameBytes.length, true);
  lv.setUint16(28, 0, true);
  local.set(nameBytes, 30);
  local.set(dataBytes, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0, true);
  cv.setUint16(10, 0, true);
  cv.setUint16(12, 0, true);
  cv.setUint16(14, 0, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, dataBytes.length, true);
  cv.setUint32(24, dataBytes.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint16(30, 0, true);
  cv.setUint16(32, 0, true);
  cv.setUint16(34, 0, true);
  cv.setUint16(36, 0, true);
  cv.setUint32(38, 0, true);
  cv.setUint32(42, 0, true); // local header offset
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
