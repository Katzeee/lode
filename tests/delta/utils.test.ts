import { describe, expect, it } from "vitest";
import {
  applyAttributes,
  deltaToText,
  deltasEqual,
  getAttributeAtOffset,
  getDeltaLength,
  isAttributeActiveInRange,
  mergeDelta,
  sliceDelta,
  splitDeltaAt,
  textToDelta,
  toggleAttribute,
} from "../../src/delta/utils.js";
import type { Delta } from "../../src/types.js";

describe("getDeltaLength", () => {
  it("returns 0 for empty", () => {
    expect(getDeltaLength([])).toBe(0);
  });
  it("sums spans", () => {
    expect(getDeltaLength([{ insert: "ab" }, { insert: "cde" }])).toBe(5);
  });
});

describe("splitDeltaAt", () => {
  it("splits at 0", () => {
    const [b, a] = splitDeltaAt([{ insert: "abc" }], 0);
    expect(b).toEqual([]);
    expect(a).toEqual([{ insert: "abc" }]);
  });
  it("splits at end", () => {
    const [b, a] = splitDeltaAt([{ insert: "abc" }], 3);
    expect(b).toEqual([{ insert: "abc" }]);
    expect(a).toEqual([]);
  });
  it("splits within span, preserving attributes", () => {
    const deltas: Delta = [{ insert: "bold", attributes: { bold: true } }];
    const [b, a] = splitDeltaAt(deltas, 2);
    expect(b).toEqual([{ insert: "bo", attributes: { bold: true } }]);
    expect(a).toEqual([{ insert: "ld", attributes: { bold: true } }]);
  });
  it("splits across multiple spans", () => {
    const deltas: Delta = [
      { insert: "hello " },
      { insert: "bold", attributes: { bold: true } },
      { insert: " world" },
    ];
    const [b, a] = splitDeltaAt(deltas, 8);
    expect(b).toEqual([
      { insert: "hello " },
      { insert: "bo", attributes: { bold: true } },
    ]);
    expect(a).toEqual([
      { insert: "ld", attributes: { bold: true } },
      { insert: " world" },
    ]);
  });
});

describe("sliceDelta", () => {
  it("slices partial span", () => {
    const deltas: Delta = [{ insert: "hello world" }];
    expect(sliceDelta(deltas, 6, 11)).toEqual([{ insert: "world" }]);
  });
  it("slices across spans", () => {
    const deltas: Delta = [
      { insert: "hello " },
      { insert: "bold", attributes: { bold: true } },
      { insert: "!" },
    ];
    expect(sliceDelta(deltas, 4, 9)).toEqual([
      { insert: "o " },
      { insert: "bol", attributes: { bold: true } },
    ]);
  });
  it("empty range", () => {
    expect(sliceDelta([{ insert: "abc" }], 2, 2)).toEqual([]);
  });
});

describe("mergeDelta", () => {
  it("merges adjacent same-attributes", () => {
    const a: Delta = [{ insert: "hello" }];
    const b: Delta = [{ insert: " world" }];
    expect(mergeDelta(a, b)).toEqual([{ insert: "hello world" }]);
  });
  it("keeps different attributes separate", () => {
    const a: Delta = [{ insert: "hi", attributes: { bold: true } }];
    const b: Delta = [{ insert: "!" }];
    expect(mergeDelta(a, b)).toEqual([
      { insert: "hi", attributes: { bold: true } },
      { insert: "!" },
    ]);
  });
});

describe("applyAttributes", () => {
  it("applies mark over range", () => {
    const deltas: Delta = [{ insert: "hello world" }];
    const out = applyAttributes(deltas, 0, 5, { bold: true });
    expect(out).toEqual([
      { insert: "hello", attributes: { bold: true } },
      { insert: " world" },
    ]);
  });
  it("removes attribute with null", () => {
    const deltas: Delta = [{ insert: "abc", attributes: { bold: true } }];
    const out = applyAttributes(deltas, 1, 3, { bold: null });
    expect(out).toEqual([
      { insert: "a", attributes: { bold: true } },
      { insert: "bc" },
    ]);
  });
  it("no-op for empty range", () => {
    const deltas: Delta = [{ insert: "abc" }];
    const out = applyAttributes(deltas, 1, 1, { bold: true });
    expect(out).toEqual([{ insert: "abc" }]);
  });
});

describe("isAttributeActiveInRange", () => {
  it("true when all chars have attr", () => {
    const deltas: Delta = [{ insert: "abc", attributes: { bold: true } }];
    expect(isAttributeActiveInRange(deltas, 0, 3, "bold")).toBe(true);
  });
  it("false when partial coverage", () => {
    const deltas: Delta = [
      { insert: "ab", attributes: { bold: true } },
      { insert: "c" },
    ];
    expect(isAttributeActiveInRange(deltas, 0, 3, "bold")).toBe(false);
  });
  it("false when none", () => {
    expect(isAttributeActiveInRange([{ insert: "abc" }], 0, 3, "bold")).toBe(false);
  });
});

describe("toggleAttribute", () => {
  it("removes when fully active", () => {
    const deltas: Delta = [{ insert: "abc", attributes: { bold: true } }];
    const out = toggleAttribute(deltas, 0, 3, "bold", true);
    expect(out).toEqual([{ insert: "abc" }]);
  });
  it("applies when partial", () => {
    const deltas: Delta = [
      { insert: "ab", attributes: { bold: true } },
      { insert: "c" },
    ];
    const out = toggleAttribute(deltas, 0, 3, "bold", true);
    expect(out).toEqual([{ insert: "abc", attributes: { bold: true } }]);
  });
  it("applies when none", () => {
    const out = toggleAttribute([{ insert: "abc" }], 0, 3, "bold", true);
    expect(out).toEqual([{ insert: "abc", attributes: { bold: true } }]);
  });
});

describe("getAttributeAtOffset", () => {
  it("returns value if present", () => {
    const deltas: Delta = [{ insert: "ab", attributes: { bold: true } }];
    expect(getAttributeAtOffset(deltas, 0, "bold")).toBe(true);
  });
  it("returns null if absent", () => {
    expect(getAttributeAtOffset([{ insert: "ab" }], 0, "bold")).toBe(null);
  });
});

describe("deltaToText / textToDelta", () => {
  it("round-trips", () => {
    expect(deltaToText(textToDelta("hello"))).toBe("hello");
    expect(textToDelta("")).toEqual([]);
  });
});

describe("deltasEqual", () => {
  it("equal", () => {
    expect(deltasEqual([{ insert: "a" }], [{ insert: "a" }])).toBe(true);
  });
  it("ignores missing vs empty attrs", () => {
    expect(deltasEqual([{ insert: "a" }], [{ insert: "a", attributes: {} }])).toBe(true);
  });
  it("not equal text", () => {
    expect(deltasEqual([{ insert: "a" }], [{ insert: "b" }])).toBe(false);
  });
});
