import { describe, expect, it } from "vitest";

import { parseLevelSpec, resolveLevel } from "./levels.js";

describe("parseLevelSpec + resolveLevel", () => {
  it("exact match wins over a later glob", () => {
    const rules = parseLevelSpec("sync=debug;*=warn");
    expect(resolveLevel("sync", rules, "warn")).toBe("debug");
    // "sync" is exact-only (no `*`), so a dotted child falls through to the glob.
    expect(resolveLevel("sync.runner", rules, "warn")).toBe("warn");
  });

  it("glob wildcard matches a dotted prefix", () => {
    const rules = parseLevelSpec("sync*=debug;engine.broker*=info;*=warn");
    expect(resolveLevel("sync.runner", rules, "warn")).toBe("debug");
    expect(resolveLevel("engine.broker.client", rules, "warn")).toBe("info");
    expect(resolveLevel("engine.membership", rules, "warn")).toBe("warn");
  });

  it("bare value (no `=`) becomes the `*` default", () => {
    const rules = parseLevelSpec("info");
    expect(resolveLevel("anything", rules, "warn")).toBe("info");
  });

  it("drops unknown levels (a typo falls back, never locks a subsystem)", () => {
    const rules = parseLevelSpec("sync=verbose;*=warn");
    expect(resolveLevel("sync", rules, "warn")).toBe("warn");
  });

  it("first match wins when a name hits two rules", () => {
    const rules = parseLevelSpec("sync=debug;sync=error");
    expect(resolveLevel("sync", rules, "warn")).toBe("debug");
  });

  it("empty spec yields no rules — fallback always applies", () => {
    const rules = parseLevelSpec("");
    expect(rules).toHaveLength(0);
    expect(resolveLevel("sync", rules, "warn")).toBe("warn");
  });

  it("treats level case-insensitively", () => {
    const rules = parseLevelSpec("sync=DEBUG;*=WARN");
    expect(resolveLevel("sync", rules, "warn")).toBe("debug");
    expect(resolveLevel("engine", rules, "info")).toBe("warn");
  });
});
