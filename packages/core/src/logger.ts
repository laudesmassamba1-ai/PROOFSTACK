import { iso } from "./time.js";

/**
 * Structured logging with mandatory secret redaction.
 *
 * Payment and webhook logs are the classic place where a signing secret or a full
 * card-adjacent payload leaks into an observability product. Redaction therefore
 * happens in the logger itself, not in callers that might forget it.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  level: LogLevel;
  message: string;
  time: string;
  fields?: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

const SENSITIVE_KEY =
  /(?:^|[_\-.])(secret|token|password|passwd|api[_-]?key|apikey|authorization|cookie|signature|credential|credentials|otp|pin|cvv|ssn|iban|msisdn|phone|email|client[_-]?id)(?:$|[_\-.])/i;

const SENSITIVE_VALUE = [
  { re: /\bsk_(?:live|test)_[A-Za-z0-9]+/g, keep: 8 },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, keep: 7 },
  { re: /\bwhsec_[A-Za-z0-9]+/g, keep: 6 },
  { re: /\b[0-9a-f]{32,}\b/gi, keep: 0 },
];

export function redactKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Mask the middle of a long opaque token, keep enough to correlate a request. */
export function maskValue(value: string): string {
  let out = value;
  for (const { re, keep } of SENSITIVE_VALUE) {
    out = out.replace(re, (match) => {
      const prefix = match.slice(0, keep);
      return `${prefix}${"•".repeat(Math.max(3, Math.min(12, match.length - keep)))}`;
    });
  }
  return out;
}

const MAX_STRING = 512;
const MAX_DEPTH = 4;

function scrub(node: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node === "bigint") return `${node}n`;
  if (typeof node === "number") return Number.isFinite(node) ? node : String(node);
  if (typeof node === "boolean") return node;
  if (typeof node === "string")
    return maskValue(
      node.length > MAX_STRING ? `${node.slice(0, MAX_STRING)}…[truncated ${node.length}]` : node
    );
  if (node instanceof Error) {
    return { name: node.name, message: maskValue(node.message), stack: undefined };
  }
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (ArrayBuffer.isView(node)) return `[binary ${node.byteLength}B]`;
  if (typeof node !== "object") return maskValue(String(node));
  const obj = node as Record<string, unknown>;
  if (seen.has(obj)) return "[cyclic]";
  seen.add(obj);
  if (Array.isArray(obj)) return obj.map((item) => scrub(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = redactKey(key) ? "[redacted]" : scrub(value, depth + 1, seen);
  }
  return out;
}

export interface LoggerOptions {
  level?: LogLevel;
  sinks?: LogSink[];
  baseFields?: Record<string, unknown>;
  now?: () => number;
}

export class Logger {
  private level: number;
  private sinks: LogSink[];
  private base: Record<string, unknown>;
  private now: () => number;

  constructor(options: LoggerOptions = {}) {
    this.level = LEVEL_ORDER[options.level ?? "info"];
    this.sinks = options.sinks ?? [];
    this.base = options.baseFields ?? {};
    this.now = options.now ?? (() => Date.now());
  }

  child(fields: Record<string, unknown>): Logger {
    const next = new Logger({
      level: LOG_LEVELS.find((l) => LEVEL_ORDER[l] === this.level),
      sinks: this.sinks,
      now: this.now,
    });
    next.base = { ...this.base, ...fields };
    return next;
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.level;
  }

  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;
    const record: LogRecord = {
      level,
      message,
      time: iso(this.now()),
      fields: scrub({ ...this.base, ...(fields ?? {}) }) as Record<string, unknown>,
    };
    for (const sink of this.sinks) sink.write(record);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log("debug", message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log("warn", message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.log("error", message, fields);
  }
}

/** In-memory ring buffer, used by the CLI and by tests. Never a data store. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  constructor(private capacity = 500) {}
  write(record: LogRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
  }
  clear(): void {
    this.records.length = 0;
  }
}

export function consoleSink(): LogSink {
  return {
    write(record) {
      const line = `${record.time} ${record.level.toUpperCase().padEnd(5)} ${record.message} ${JSON.stringify(record.fields ?? {})}`;
      if (record.level === "error") console.error(line);
      else if (record.level === "warn") console.warn(line);
      else console.log(line);
    },
  };
}
