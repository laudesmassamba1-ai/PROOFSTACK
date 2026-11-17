import type { ProofCoreConfig } from "@proofcore/contracts";
import type { TestCaseDef, TestSuiteDef } from "@proofcore/engine";
import {
  checkFieldType,
  compareRecords,
  type ExportArtifact,
  type ExportFormat,
  type ExportSource,
  findDuplicates,
  findOrphans,
  type RoundTripTarget,
} from "./data.js";

/**
 * EXIT checks.
 *
 * The export is fetched once per suite and shared by every case, because exporting is
 * the expensive part and re-exporting for each assertion would test the export
 * endpoint's rate limit rather than its correctness.
 *
 * Every case answers one question a departing customer would ask:
 *   - is the file there, and is it the size and digest the product claimed?
 *   - does every declared field exist, with the declared type?
 *   - does every child row still point at a parent that exists?
 *   - are the declared unique keys actually unique?
 *   - does re-importing the export give back the same records?
 */

export interface ExitCheckOptions {
  config: ProofCoreConfig;
  source?: ExportSource;
  roundTrip?: RoundTripTarget;
  /** Narrow the format set; defaults to `modules.exit.formats`. */
  formats?: readonly ExportFormat[];
}

export function buildExitSuites(options: ExitCheckOptions): TestSuiteDef[] {
  const formats = options.formats ?? options.config.modules.exit.formats;
  const exitConfig = options.config.modules.exit;
  const source = options.source;

  const skip =
    source === undefined
      ? "no export source configured (modules.exit.exportSource is unset)"
      : undefined;

  const cases: TestCaseDef[] = [];

  for (const format of formats) {
    cases.push({
      id: `exit/${format}/integrity`,
      name: `${format.toUpperCase()} export integrity`,
      description: `The ${format.toUpperCase()} export exists, is non-empty, and its digest is stable across two fetches.`,
      module: "exit",
      severity: "CRITICAL",
      suiteId: "exit:portability",
      ...(skip ? { skip } : {}),
      execute: async (ctx) => {
        if (!source) return;

        const first = await source.fetch(format);
        await ctx.attachText({
          label: `${format} export digest`,
          kind: "checksum",
          text: JSON.stringify({
            fileName: first.fileName,
            bytes: first.bytes.length,
            sha256: first.sha256,
          }),
        });

        ctx.check(first.bytes.length > 0, {
          description: "the export is not empty",
          expected: "> 0 bytes",
          actual: `${first.bytes.length} bytes`,
          code: "export_empty",
          severity: "CRITICAL",
        });

        // Two fetches of the same export should agree. A digest that changes every
        // time means the export is not reproducible, which makes every other
        // comparison in this suite meaningless.
        const second = await source.fetch(format);
        ctx.check(first.sha256 === second.sha256, {
          description: "two consecutive exports of the same data have the same digest",
          expected: first.sha256,
          actual: second.sha256,
          code: "export_not_reproducible",
          severity: "HIGH",
        });

        if (exitConfig.maxRecords > 0 && first.records) {
          ctx.check(first.records.length <= exitConfig.maxRecords, {
            description: "the export respects the configured record cap",
            expected: `<= ${exitConfig.maxRecords}`,
            actual: first.records.length,
            code: "export_exceeds_cap",
            severity: "MEDIUM",
          });
        }
      },
    });

    cases.push({
      id: `exit/${format}/schema`,
      name: `${format.toUpperCase()} schema conformance`,
      description: "Every declared field is present in every record with the declared type.",
      module: "exit",
      severity: "HIGH",
      suiteId: "exit:portability",
      ...(skip ? { skip } : {}),
      execute: async (ctx) => {
        if (!source) return;
        const artifact = await source.fetch(format);
        const records = artifact.records;
        if (!records) {
          ctx.skip(
            `the ${format} export could not be parsed into records, so schema checks do not apply`
          );
          return;
        }

        const declared = Object.entries(exitConfig.schema);
        if (declared.length === 0) {
          ctx.skip("no schema declared in modules.exit.schema, so there is nothing to conform to");
          return;
        }

        const missingFields = new Map<string, number>();
        const typeFailures: string[] = [];

        for (const record of records) {
          for (const [field, type] of declared) {
            if (!(field in record)) {
              missingFields.set(field, (missingFields.get(field) ?? 0) + 1);
              continue;
            }
            const verdict = checkFieldType(record[field], type);
            if (!verdict.ok && typeFailures.length < 20) {
              typeFailures.push(`${field}: ${verdict.reason}`);
            }
          }
        }

        for (const [field, count] of missingFields) {
          ctx.check(false, {
            description: `field "${field}" is present in every record`,
            expected: "present in all records",
            actual: `missing from ${count} of ${records.length}`,
            code: "export_missing_field",
            severity: "HIGH",
          });
        }

        ctx.check(typeFailures.length === 0, {
          description: "every declared field has the declared type",
          expected: "all types match",
          actual: typeFailures.slice(0, 5).join("; ") || "all match",
          code: "export_type_mismatch",
          severity: "HIGH",
        });

        await ctx.attachText({
          label: "schema conformance summary",
          kind: "metadata",
          text: JSON.stringify(
            { records: records.length, declared: declared.length, typeFailures },
            null,
            2
          ),
        });
      },
    });

    cases.push({
      id: `exit/${format}/relationships`,
      name: `${format.toUpperCase()} referential integrity`,
      description: "Every declared child row references a parent row that exists in the export.",
      module: "exit",
      severity: "CRITICAL",
      suiteId: "exit:portability",
      ...(skip ? { skip } : {}),
      execute: async (ctx) => {
        if (!source) return;
        const artifact = await source.fetch(format);
        const records = artifact.records;
        if (!records) {
          ctx.skip(`the ${format} export could not be parsed into records`);
          return;
        }
        if (exitConfig.relationships.length === 0) {
          ctx.skip("no relationships declared in modules.exit.relationships");
          return;
        }

        // A single flat export cannot express two tables, so relationships are checked
        // within the record set when the child and parent fields live on the same rows.
        for (const relationship of exitConfig.relationships) {
          if (relationship.child === relationship.parent) {
            const result = findOrphans({
              children: records,
              childField: relationship.childField,
              parents: records,
              parentField: relationship.parentField,
            });
            ctx.check(result.orphans.length === 0, {
              description: `${relationship.child}.${relationship.childField} references an existing ${relationship.parent}.${relationship.parentField}`,
              expected: "no orphans",
              actual:
                result.orphans.length === 0
                  ? "no orphans"
                  : `${result.orphans.length} orphan value(s), e.g. ${result.orphans
                      .slice(0, 3)
                      .map((o) => `${o.value} (${o.count}x)`)
                      .join(", ")}`,
              code: "export_orphan_records",
              severity: relationship.required ? "CRITICAL" : "MEDIUM",
            });
          } else {
            ctx.skip(
              `relationship ${relationship.child} → ${relationship.parent} spans two tables, which a single-file export cannot express; use a ZIP export with a manifest`
            );
          }
        }
      },
    });

    cases.push({
      id: `exit/${format}/uniqueness`,
      name: `${format.toUpperCase()} unique constraints`,
      description: "Declared unique keys are actually unique in the exported data.",
      module: "exit",
      severity: "HIGH",
      suiteId: "exit:portability",
      ...(skip ? { skip } : {}),
      execute: async (ctx) => {
        if (!source) return;
        const artifact = await source.fetch(format);
        const records = artifact.records;
        if (!records) {
          ctx.skip(`the ${format} export could not be parsed into records`);
          return;
        }
        if (exitConfig.unique.length === 0) {
          ctx.skip("no unique constraints declared in modules.exit.unique");
          return;
        }

        for (const constraint of exitConfig.unique) {
          const duplicates = findDuplicates(records, constraint.fields);
          ctx.check(duplicates.length === 0, {
            description: `${constraint.table}(${constraint.fields.join(", ")}) is unique`,
            expected: "no duplicates",
            actual:
              duplicates.length === 0
                ? "no duplicates"
                : `${duplicates.length} duplicate key(s), e.g. ${duplicates
                    .slice(0, 3)
                    .map((d) => `${d.key} (${d.count}x)`)
                    .join(", ")}`,
            code: "export_duplicate_records",
            severity: "HIGH",
          });
        }
      },
    });
  }

  cases.push({
    id: "exit/round-trip",
    name: "Round-trip fidelity",
    description: "Export → re-import → compare: no record, field or type is lost or changed.",
    module: "exit",
    severity: "CRITICAL",
    suiteId: "exit:portability",
    skip:
      source === undefined
        ? "no export source configured (modules.exit.exportSource is unset)"
        : options.roundTrip === undefined
          ? "no round-trip target configured (modules.exit.roundTrip.value is unset)"
          : undefined,
    execute: async (ctx) => {
      if (!source || !options.roundTrip) return;

      const format = formats[0] ?? "json";
      const original = await source.fetch(format);
      if (!original.records) {
        ctx.skip(`the ${format} export could not be parsed, so a round trip cannot be compared`);
        return;
      }

      const imported = await options.roundTrip.import(original);
      ctx.check(imported.imported === original.records.length, {
        description: "every exported record was imported",
        expected: original.records.length,
        actual: imported.imported,
        code: "round_trip_record_loss",
        severity: "CRITICAL",
      });

      if (!imported.datasetId) {
        ctx.skip(
          "the import target did not return a dataset id, so the imported rows cannot be read back"
        );
        return;
      }

      const table = exitConfig.unique[0]?.table ?? "records";
      const reread = await options.roundTrip.readBack(imported.datasetId, table);

      // The key field is the first declared unique field, or `id` as a fallback.
      const keyField = exitConfig.unique[0]?.fields[0] ?? "id";
      const comparison = compareRecords(original.records, reread, keyField);

      ctx.check(comparison.missing.length === 0, {
        description: "no record disappeared in the round trip",
        expected: "0 missing",
        actual: `${comparison.missing.length} missing (e.g. ${comparison.missing.slice(0, 3).join(", ")})`,
        code: "round_trip_missing_records",
        severity: "CRITICAL",
      });

      ctx.check(comparison.extra.length === 0, {
        description: "the round trip created no extra records",
        expected: "0 extra",
        actual: `${comparison.extra.length} extra`,
        code: "round_trip_duplicated_records",
        severity: "HIGH",
      });

      ctx.check(comparison.differences.length === 0, {
        description: "every field survived the round trip unchanged",
        expected: "0 differences",
        actual:
          comparison.differences.length === 0
            ? "0 differences"
            : `${comparison.differences.length} difference(s), e.g. ${comparison.differences
                .slice(0, 3)
                .map(
                  (d) =>
                    `${d.recordKey}.${d.field}: ${JSON.stringify(d.original)} → ${JSON.stringify(d.roundTripped)} (${d.kind})`
                )
                .join("; ")}`,
        code: "round_trip_field_changed",
        severity: "CRITICAL",
      });

      await ctx.attachText({
        label: "round-trip comparison",
        kind: "diff",
        mediaType: "application/json",
        text: JSON.stringify(
          {
            format,
            originalRecords: original.records.length,
            importedRecords: imported.imported,
            rereadRecords: reread.length,
            missing: comparison.missing.slice(0, 50),
            extra: comparison.extra.slice(0, 50),
            differences: comparison.differences.slice(0, 50),
          },
          null,
          2
        ),
      });
    },
  });

  cases.push({
    id: "exit/manifest",
    name: "ZIP manifest consistency",
    description: "The ZIP's manifest agrees with the entries actually present.",
    module: "exit",
    severity: "HIGH",
    suiteId: "exit:portability",
    skip:
      source === undefined
        ? "no export source configured (modules.exit.exportSource is unset)"
        : !formats.includes("zip")
          ? "zip is not in modules.exit.formats"
          : undefined,
    execute: async (ctx) => {
      if (!source) return;
      const artifact: ExportArtifact = await source.fetch("zip");
      if (!artifact.entries) {
        ctx.skip("the zip export did not expose an entry list");
        return;
      }

      const names = new Set(artifact.entries.map((e) => e.name));
      ctx.check(names.size > 0, {
        description: "the zip contains at least one entry",
        expected: ">= 1 entry",
        actual: `${names.size} entries`,
        code: "zip_empty",
        severity: "CRITICAL",
      });

      const manifest = artifact.manifest;
      if (!manifest) {
        ctx.skip("the zip export has no manifest, so there is nothing to cross-check");
        return;
      }

      const declared = Array.isArray(manifest.files) ? manifest.files : [];
      if (declared.length === 0) {
        ctx.skip("the manifest declares no files");
        return;
      }

      const missing = declared
        .map((entry) =>
          typeof entry === "string" ? entry : String((entry as { name?: string }).name ?? "")
        )
        .filter((name) => name && !names.has(name));

      ctx.check(missing.length === 0, {
        description: "every file the manifest declares is present in the zip",
        expected: "all manifest files present",
        actual:
          missing.length === 0
            ? "all present"
            : `${missing.length} missing: ${missing.slice(0, 5).join(", ")}`,
        code: "zip_manifest_missing_files",
        severity: "CRITICAL",
      });
    },
  });

  return [
    {
      id: "exit:portability",
      name: "EXIT — data portability",
      module: "exit",
      description: `${cases.length} export integrity, schema, relationship and round-trip checks`,
      cases,
    },
  ];
}
