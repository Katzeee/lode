import { describe, expect, it } from "vitest";

import { compileProjectionPlan } from "./projection-plan-dag.js";

describe("Projection plan dataflow", () => {
  it("rejects missing dependencies, duplicate writers, and cycles", () => {
    const evaluate = () => undefined;
    expect(() => compileProjectionPlan([{ key: "a", dependencies: ["missing"], writes: ["a"], evaluate }])).toThrow(
      "missing dependency",
    );
    expect(() =>
      compileProjectionPlan([
        { key: "a", dependencies: [], writes: ["same"], evaluate },
        { key: "b", dependencies: [], writes: ["same"], evaluate },
      ]),
    ).toThrow("Duplicate writer");
    expect(() =>
      compileProjectionPlan([
        { key: "a", dependencies: ["b"], writes: ["a"], evaluate },
        { key: "b", dependencies: ["a"], writes: ["b"], evaluate },
      ]),
    ).toThrow("dependency cycle");
  });
});
