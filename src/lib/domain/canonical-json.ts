import { createHash } from "node:crypto";

/**
 * Canonical JSON: the same value always produces the same bytes, so its SHA-256 can be published
 * and verified by anyone (used for survey definitions).
 *
 * Rules (as in RFC 8785): object keys sorted by UTF-16 code units at every depth; arrays keep order; no whitespace;
 * strings and numbers serialised as JSON.stringify does (shortest round-trip numbers, -0 → 0).
 * Values JSON can't represent faithfully are rejected rather than silently changed.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, "$");
}

function serialise(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => serialise(item, `${path}[${i}]`)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(
          `canonicalJson: only plain objects are allowed, found ${proto?.constructor?.name} at ${path}`,
        );
      }
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, v] of entries) {
        if (v === undefined) throw new Error(`canonicalJson: undefined at ${path}.${key}`);
      }
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialise(v, `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Convenience: the published fingerprint of a value. */
export function canonicalHash(value: unknown): { json: string; sha256: string } {
  const json = canonicalJson(value);
  return { json, sha256: sha256Hex(json) };
}
