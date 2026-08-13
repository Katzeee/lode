import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../domain/reconcile/index.js";
import { base, end, Facts, versions } from "../../domain/reconcile/reconcile-test-helpers.js";
import { prepareEdits } from "./mutation-planner.js";

describe("domain Edit write boundaries", () => {
  it("declares Node creation and deletion atomic at their domain handlers", () => {
    const creationFacts = new Facts();
    const creationSnapshot = creationFacts.snapshot();
    const creationGeneration = rebuildGeneration(
      "workspace",
      creationSnapshot,
      versions,
    ).generation;
    expect(
      prepareEdits(
        "workspace",
        [
          {
            kind: "node-create",
            nodeId: "node",
            occurrenceId: "node-original",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
        creationGeneration,
        "direct",
        creationSnapshot,
      ),
    ).toMatchObject([
      {
        kind: "atomic",
        mutations: [
          { kind: "node-create", nodeId: "node" },
          { kind: "occurrence-create", occurrenceId: "node-original" },
        ],
      },
    ]);

    const deletionFacts = base();
    const deletionSnapshot = deletionFacts.snapshot();
    const deletionGeneration = rebuildGeneration(
      "workspace",
      deletionSnapshot,
      versions,
    ).generation;
    expect(
      prepareEdits(
        "workspace",
        [{ kind: "node-delete", nodeId: "node" }],
        deletionGeneration,
        "direct",
        deletionSnapshot,
      ),
    ).toEqual([{ kind: "atomic", mutations: [{ kind: "node-delete", nodeId: "node" }] }]);
  });

  it("keeps independent Edits as independent single writes", () => {
    const facts = base();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;
    const writes = prepareEdits(
      "workspace",
      [
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "first",
          value: true,
        },
        {
          kind: "value-set",
          target: { kind: "node", id: "node" },
          namespace: "property",
          key: "second",
          value: true,
        },
      ],
      generation,
      "direct",
      snapshot,
    );

    expect(writes.map((write) => write.kind)).toEqual(["single", "single"]);
  });
});
