import { describe, expect, it } from "vitest";

import { nodeLocation, validateNodeGraph } from "./node-graph.js";

describe("Node Graph invariants", () => {
  it("derives Trash membership transitively from the Owner tree while References keep the same Node identity", () => {
    const graph = trashSubtree();
    const trashNodeId = "trash-role-target";

    expect(nodeLocation("workspace", graph, trashNodeId)).toBe("active");
    expect(nodeLocation("workspace", graph, "deleted-root")).toBe("trash");
    expect(nodeLocation("workspace", graph, "owned-child")).toBe("trash");
    expect(nodeLocation("workspace", graph, "reference-context")).toBe("active");
  });

  it("rejects drift between Occurrences and their ordered childOccurrences index", () => {
    const graph = referenceCycle();
    graph.childOccurrences.set("workspace", ["a-original"]);

    expect(() => validateNodeGraph(graph)).toThrow("Node Graph Occurrence is absent from childOccurrences: b-original");
  });

  it("rejects two Occurrences of one Node in the same parent", () => {
    const graph = referenceCycle();
    graph.occurrences.set("a-duplicate", {
      occurrenceId: "a-duplicate",
      nodeId: "a",
      parentNodeId: "workspace",
    });
    graph.childOccurrences.set("workspace", ["a-original", "a-duplicate", "b-original"]);

    expect(() => validateNodeGraph(graph)).toThrow("Node Graph repeats a Node in one parent: a");
  });
});

function referenceCycle() {
  const nodes = new Map(["workspace", "a", "b"].map((nodeId) => [nodeId, { nodeId }]));
  const occurrences = new Map([
    ["a-original", { occurrenceId: "a-original", nodeId: "a", parentNodeId: "workspace" }],
    ["b-original", { occurrenceId: "b-original", nodeId: "b", parentNodeId: "workspace" }],
    ["a-reference", { occurrenceId: "a-reference", nodeId: "a", parentNodeId: "b" }],
    ["b-reference", { occurrenceId: "b-reference", nodeId: "b", parentNodeId: "a" }],
  ]);
  return {
    nodes,
    occurrences,
    childOccurrences: new Map([
      ["workspace", ["a-original", "b-original"]],
      ["a", ["b-reference"]],
      ["b", ["a-reference"]],
    ]),
    nodeOwners: { workspace: null, a: "workspace", b: "workspace" } as Record<string, string | null>,
    metanodes: {} as Record<string, string>,
  };
}

function trashSubtree() {
  const trashNodeId = "trash-role-target";
  return {
    nodes: Object.fromEntries(
      ["workspace", trashNodeId, "deleted-root", "owned-child", "reference-context"].map((nodeId) => [
        nodeId,
        { nodeId },
      ]),
    ),
    nodeOwners: {
      workspace: null,
      [trashNodeId]: "workspace",
      "deleted-root": trashNodeId,
      "owned-child": "deleted-root",
      "reference-context": "workspace",
    },
    workspaceSystemNodes: { trash: trashNodeId },
  };
}
