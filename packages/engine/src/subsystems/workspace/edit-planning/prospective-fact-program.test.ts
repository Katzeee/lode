import { describe, expect, it } from "vitest";

import { factActionId } from "../../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../../domain/reconcile/index.js";
import { createProspectiveFactProgram } from "./prospective-fact-program.js";

describe("Prospective Fact program", () => {
  it("reserves the exact causal coordinates used by sequential Edit Facts", () => {
    const program = createProspectiveFactProgram(
      "workspace",
      "actor",
      "direct",
      { facts: [], frontier: {} },
      CURRENT_PROJECTION_VERSIONS,
      "101",
    );

    const firstActionId = program.nextActionId(0);
    const first = program.append([
      { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
    ]);
    const firstFact = first.snapshot.facts[0];
    expect(firstFact?.coordinate).toMatchObject({ dot: { replicaId: "101", sequence: 1 }, observed: {}, lamport: 1 });
    expect(firstFact && factActionId(firstFact.id, 0)).toBe(firstActionId);

    const secondActionId = program.nextActionId(0);
    const second = program.append([
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: "next",
      },
    ]);
    const secondFact = second.snapshot.facts[1];
    expect(secondFact?.coordinate).toMatchObject({
      dot: { replicaId: "101", sequence: 2 },
      observed: { "101": 1 },
      lamport: 2,
    });
    expect(secondFact && factActionId(secondFact.id, 0)).toBe(secondActionId);
    expect(second.generation.identity.frontier).toEqual(second.snapshot.frontier);
  });
});
