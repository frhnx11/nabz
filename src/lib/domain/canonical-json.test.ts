import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson, sha256Hex } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: true } })).toBe('{"a":{"c":true,"d":[3,1,2]},"b":1}');
  });

  it("produces identical output regardless of key insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("normalises -0 and keeps Unicode as UTF-8 text", () => {
    expect(canonicalJson({ n: -0, s: "नमस्ते" })).toBe('{"n":0,"s":"नमस्ते"}');
  });

  it.each([
    ["NaN", { a: Number.NaN }],
    ["Infinity", [Number.POSITIVE_INFINITY]],
    ["undefined", { a: undefined }],
    ["BigInt", { a: BigInt(1) }],
    ["Date", { a: new Date(0) }],
    ["function", { a: () => 1 }],
  ])("rejects %s", (_, value) => {
    expect(() => canonicalJson(value)).toThrow(/canonicalJson/);
  });

  it("hashes to an independently computed SHA-256 (sha256sum)", () => {
    const value = { c: -1.5e-7, b: { y: null, x: "नमस्ते" }, a: [3, 1, 2] };
    const { json, sha256 } = canonicalHash(value);
    expect(json).toBe('{"a":[3,1,2],"b":{"x":"नमस्ते","y":null},"c":-1.5e-7}');
    expect(sha256).toBe("d0cb22eedce9a9fec9edd2f3b1dbcd63d11bca62d973d4bee9075eac9978f072");
    expect(sha256Hex(json)).toBe(sha256);
  });
});
