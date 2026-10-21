import { createHash } from "node:crypto";

/**
 * Canonical serialization and hashes.
 *
 * A hash only means something if the same content always gives the same text. Rules:
 * - object keys are sorted, no whitespace;
 * - numbers are safe integers only (counts, sequence numbers, legislatures): a float or a
 *   non-finite number is a bug, not a value;
 * - `undefined`, dates, maps, sets, functions, symbols and bigints are refused: the caller
 *   converts them explicitly, so that nothing is serialized by accident.
 */

export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalJson: ${path} is not a safe integer (${String(value)})`);
      }
      // `-0` is a safe integer whose JSON text is "0": normalize.
      return String(value === 0 ? 0 : value);
    case "object":
      break;
    default:
      throw new Error(`canonicalJson: ${path} has an unsupported type (${typeof value})`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${path}[${index}]`)).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`canonicalJson: ${path} is not a plain object`);
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => {
      const entry = record[key];
      if (entry === undefined) {
        throw new Error(`canonicalJson: ${path}.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`)}`;
    });
  return `{${parts.join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface StateEntry {
  kind: string;
  key: string;
  rawHash: string;
}

/**
 * Hash of a whole state: the sorted list of (kind, key, rawHash). Independent of the order in
 * which records were read. Each line is a JSON array, so that a separator inside a key cannot make
 * two different states look alike. Two entries with the same (kind, key) are an error: a state
 * holds one version of each record.
 */
export function computeStateHash(entries: readonly StateEntry[]): string {
  const seen = new Set<string>();
  const lines = entries.map((entry) => {
    const identity = JSON.stringify([entry.kind, entry.key]);
    if (seen.has(identity)) {
      throw new Error(`computeStateHash: two versions of ${identity}`);
    }
    seen.add(identity);
    return JSON.stringify([entry.kind, entry.key, entry.rawHash]);
  });
  lines.sort();
  return sha256Hex(lines.map((line) => `${line}\n`).join(""));
}
