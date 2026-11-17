import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ProofCoreError } from "@proofcore/core";
import {
  digestArtifact,
  type ExportArtifact,
  type ExportFormat,
  type ExportSource,
  parseCsv,
  parseJsonRecords,
  readZipEntries,
} from "./data.js";

const exec = promisify(execFile);

/**
 * Export sources.
 *
 * Three ways a customer can hand EXIT an export, because they have three different
 * setups. All three return the same `ExportArtifact`, so every check downstream is
 * source-agnostic.
 *
 * The command source runs an argv array, never a shell string: an export command
 * built by string concatenation is a command injection waiting for a filename with a
 * semicolon in it.
 */

export interface HttpExportSourceOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  tokenProvider?: () => string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Query/body parameter used to request a format, when the endpoint supports it. */
  formatParam?: string;
}

export class HttpExportSource implements ExportSource {
  readonly kind = "http" as const;
  readonly description: string;

  constructor(private readonly options: HttpExportSourceOptions) {
    this.description = `${options.method ?? "GET"} ${options.url}`;
  }

  async fetch(format: ExportFormat): Promise<ExportArtifact> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    const headers: Record<string, string> = { ...(this.options.headers ?? {}) };
    const token = this.options.tokenProvider?.();
    if (token) headers.authorization = `Bearer ${token}`;

    const method = this.options.method ?? "GET";
    let url = this.options.url;
    let body: string | undefined;

    if (this.options.formatParam) {
      if (method === "GET") {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}${this.options.formatParam}=${encodeURIComponent(format)}`;
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify({ format });
      }
    }

    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProofCoreError({
          message: `export endpoint returned HTTP ${response.status}`,
          category: "NETWORK",
          code: "export_http_failed",
          retryable: response.status >= 500 || response.status === 429,
          details: { status: response.status, url },
        });
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      const fileName =
        fileNameFrom(response.headers.get("content-disposition")) ?? `export.${format}`;
      return await toArtifact(buffer, format, fileName);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface FileExportSourceOptions {
  /** Path to the export, or a directory containing one named `export.<format>`. */
  path: string;
  /** Manifest file to read alongside the export, when the product emits one. */
  manifestPath?: string;
}

export class FileExportSource implements ExportSource {
  readonly kind = "file" as const;
  readonly description: string;

  constructor(private readonly options: FileExportSourceOptions) {
    this.description = `file ${options.path}`;
  }

  async fetch(format: ExportFormat): Promise<ExportArtifact> {
    const path = this.options.path.includes("<format>")
      ? this.options.path.replaceAll("<format>", format)
      : this.options.path;

    let buffer: Uint8Array;
    try {
      buffer = new Uint8Array(await readFile(path));
    } catch (error) {
      throw new ProofCoreError({
        message: `cannot read export at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        category: "NOT_FOUND",
        code: "export_file_missing",
        details: { path },
      });
    }

    const artifact = await toArtifact(buffer, format, path.split("/").pop() ?? `export.${format}`);

    if (this.options.manifestPath) {
      try {
        const manifestText = await readFile(this.options.manifestPath, "utf8");
        artifact.manifest = JSON.parse(manifestText) as Record<string, unknown>;
      } catch {
        // A missing manifest is not an error: the manifest case reports it as a skip.
      }
    }
    return artifact;
  }
}

export interface CommandExportSourceOptions {
  /** argv array. The first element is the executable. Never a shell string. */
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  manifestPath?: string;
}

export class CommandExportSource implements ExportSource {
  readonly kind = "command" as const;
  readonly description: string;

  constructor(private readonly options: CommandExportSourceOptions) {
    this.description = `command ${options.argv.join(" ")}`;
  }

  async fetch(format: ExportFormat): Promise<ExportArtifact> {
    const argv = this.options.argv.map((arg) => arg.replaceAll("<format>", format));
    const [file, ...args] = argv;
    if (!file) {
      throw new ProofCoreError({
        message: "export command is empty",
        category: "CONFIGURATION",
        code: "export_command_empty",
      });
    }

    let stdout: Buffer;
    try {
      const result = await exec(file, args, {
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        env: { ...process.env, ...(this.options.env ?? {}) },
        timeout: this.options.timeoutMs ?? 60_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
      });
      stdout = result.stdout as Buffer;
    } catch (error) {
      throw new ProofCoreError({
        message: `export command failed: ${error instanceof Error ? error.message : String(error)}`,
        category: "CONFIGURATION",
        code: "export_command_failed",
        details: { argv },
      });
    }

    const artifact = await toArtifact(new Uint8Array(stdout), format, `export.${format}`);

    if (this.options.manifestPath) {
      try {
        artifact.manifest = JSON.parse(await readFile(this.options.manifestPath, "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        // Optional: the manifest case reports the absence.
      }
    }
    return artifact;
  }
}

/**
 * Turn raw bytes into an artifact: digest always, parse when the format is parseable.
 *
 * A parse failure is not thrown here. The integrity case still needs to run and pass
 * or fail on its own terms, and the schema case reports the parse failure as a skip
 * with the reason. Throwing would turn "your CSV is malformed" into "the harness
 * crashed", which is the wrong story for the customer.
 */
export async function toArtifact(
  bytes: Uint8Array,
  format: ExportFormat,
  fileName: string
): Promise<ExportArtifact> {
  const sha256 = await digestArtifact(bytes);
  const artifact: ExportArtifact = { format, fileName, bytes, sha256 };

  if (format === "json") {
    try {
      artifact.records = parseJsonRecords(new TextDecoder().decode(bytes));
    } catch {
      // Left unparsed; the schema case will skip with a reason.
    }
  }

  if (format === "csv") {
    try {
      const parsed = parseCsv(new TextDecoder().decode(bytes));
      artifact.records = parsed.records as Record<string, unknown>[];
    } catch {
      // Same: malformed CSV is a finding, not a harness crash.
    }
  }

  if (format === "zip") {
    try {
      artifact.entries = readZipEntries(bytes);
    } catch {
      // Not a valid zip: the integrity case reports the empty entry list.
    }
  }

  return artifact;
}

function fileNameFrom(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1];
}
