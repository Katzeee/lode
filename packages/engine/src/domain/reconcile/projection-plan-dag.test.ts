import { describe, expect, it } from "vitest";

import { createProjectionPlanState } from "./projection-plan-context.js";
import { compileProjectionPlan } from "./projection-plan-dag.js";
import { PROJECTION_PLAN } from "./projection-plan.js";
import { CURRENT_PROJECTION_VERSIONS } from "./projection-types.js";

describe("Projection plan dataflow", () => {
  it("rejects missing dependencies, duplicate Artifact owners, and cycles", () => {
    const evaluate = () => undefined;
    expect(() => compileProjectionPlan([{ key: "a", dependencies: ["missing"], evaluate }])).toThrow(
      "missing dependency",
    );
    expect(() =>
      compileProjectionPlan([
        { key: "same", dependencies: [], evaluate },
        { key: "same", dependencies: [], evaluate },
      ]),
    ).toThrow("Duplicate Projection Artifact owner");
    expect(() =>
      compileProjectionPlan([
        { key: "a", dependencies: ["b"], evaluate },
        { key: "b", dependencies: ["a"], evaluate },
      ]),
    ).toThrow("dependency cycle");
  });

  it("publishes Artifacts only after their owning Stages run", () => {
    const state = createProjectionPlanState(
      "workspace",
      { facts: [], frontier: {} },
      "origin",
      CURRENT_PROJECTION_VERSIONS,
    );

    expect("activation" in state).toBe(false);
    expect("projection" in state).toBe(false);

    PROJECTION_PLAN.run(state);

    expect(state.activation).toEqual({ actions: [], evidence: { activeActionIds: [], supportByAction: {} } });
    expect(state.projection?.identity.workspaceNodeId).toBe("workspace");
  });
});
