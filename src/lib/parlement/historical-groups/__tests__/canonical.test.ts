import { describe, expect, it } from "vitest";
import { canonicalJson, computeStateHash, hashOf, sha256Hex } from "../canonical";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and writes no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}'
    );
  });

  it("gives the same text whatever the order the keys were written in", () => {
    expect(canonicalJson({ x: 1, y: 2, z: { p: true, q: "t" } })).toBe(
      canonicalJson({ z: { q: "t", p: true }, y: 2, x: 1 })
    );
  });

  it("keeps the order of arrays: they are sequences, not sets", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("writes a negative zero as 0", () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
  });

  it.each([
    ["undefined value", { a: undefined }],
    ["NaN", { a: Number.NaN }],
    ["Infinity", { a: Number.POSITIVE_INFINITY }],
    ["float", { a: 1.5 }],
    ["Date", { a: new Date(0) }],
    ["Map", { a: new Map() }],
    ["Set", { a: new Set() }],
    ["bigint", { a: BigInt(1) }],
    ["function", { a: () => 1 }],
    ["class instance", { a: new (class Foo {})() }],
  ])("refuses a %s instead of serializing it by accident", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow("canonicalJson");
  });
});

describe("hashOf", () => {
  it("is stable: the same content always gives the same hash", () => {
    expect(hashOf({ a: 1, b: [1, 2] })).toBe(hashOf({ b: [1, 2], a: 1 }));
  });

  it("changes when one value changes", () => {
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });

  it("is the SHA-256 of the canonical text", () => {
    expect(hashOf("x")).toBe(sha256Hex('"x"'));
    // Known SHA-256 of the empty string, so the algorithm itself is checked.
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("computeStateHash", () => {
  const a = { kind: "membership", key: "m1", rawHash: "h1" };
  const b = { kind: "membership", key: "m2", rawHash: "h2" };
  const c = { kind: "organ", key: "o1", rawHash: "h3" };

  it("does not depend on the order the records were read in", () => {
    expect(computeStateHash([a, b, c])).toBe(computeStateHash([c, b, a]));
  });

  it("changes when a record is added, removed or corrected", () => {
    const base = computeStateHash([a, b]);
    expect(computeStateHash([a, b, c])).not.toBe(base);
    expect(computeStateHash([a])).not.toBe(base);
    expect(computeStateHash([a, { ...b, rawHash: "h2-corrected" }])).not.toBe(base);
  });

  it("refuses two versions of the same record in one state", () => {
    expect(() => computeStateHash([a, { ...a, rawHash: "other" }])).toThrow("two versions");
  });

  it("does not confuse two states whose keys contain the separator", () => {
    const one = computeStateHash([{ kind: "a|b", key: "c", rawHash: "h" }]);
    const two = computeStateHash([{ kind: "a", key: "b|c", rawHash: "h" }]);
    expect(one).not.toBe(two);
  });
});
