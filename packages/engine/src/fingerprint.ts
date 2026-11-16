import { sha256Hex } from "@proofstack/core";

/**
 * Finding identity across runs.
 *
 * Without a stable fingerprint, a recurring defect looks like N new problems and a
 * fixed one looks like a vanished problem. The key deliberately excludes the run id,
 * timestamps and messages that contain volatile data.
 */
export interface FingerprintInput {
  module: string;
  testCaseId: string;
  field?: string;
  profile?: string;
  code?: string;
  /** Normalized detail text: volatile numbers are masked before hashing. */
  detail: string;
}

export function normalizeDetail(detail: string): string {
  return detail
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<instant>")
    .replace(/\b\d+(\.\d+)?\b/g, "<num>")
    .toLowerCase();
}

export async function fingerprintFinding(input: FingerprintInput): Promise<string> {
  const key = [
    input.module,
    input.testCaseId,
    input.field ?? "",
    input.profile ?? "",
    input.code ?? "",
    normalizeDetail(input.detail),
  ].join("\u001f");
  return `ps1:${await sha256Hex(key)}`;
}
