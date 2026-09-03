import { describe, expect, it } from "vitest";

import { flattenOutline } from "../components/outline-tree-model.js";
import { completionIds, createDemoCompletionProviders } from "./outline-demo-completions.js";
import {
  findOriginalOccurrenceKey,
  insertGraphNode,
  projectOutline,
  replaceGraphOccurrenceNode,
  resolveGraphPath,
  retargetGraphOccurrence,
  updateGraphNode,
} from "./outline-demo-graph.js";
import { fieldValueSuggestionIds, initialGraph, textContent } from "./outline-demo-model.js";

describe("outline demo graph projection", () => {
  it("projects Original and Reference children from one target Node", () => {
    const referencePath = "projects/lode/roadmap/local-first-reference";
    const originalPath = "inbox/local-first-original";
    const inserted = {
      childOccurrenceIds: [],
      id: "shared-child",
      value: { content: textContent("Shared child") },
    } as const;
    const graph = insertGraphNode(initialGraph, referencePath, 1, inserted, {
      id: "shared-child-occurrence",
      nodeId: inserted.id,
    });

    expect(resolveGraphPath(graph, referencePath)?.node.id).toBe("local-first");
    expect(resolveGraphPath(graph, originalPath)?.node.id).toBe("local-first");
    expect(resolveGraphPath(graph, `${referencePath}/shared-child-occurrence`)?.node.id).toBe(inserted.id);
    expect(resolveGraphPath(graph, `${originalPath}/shared-child-occurrence`)?.node.id).toBe(inserted.id);
  });

  it("updates shared Node content once for every projected occurrence", () => {
    const graph = updateGraphNode(initialGraph, "local-first", (node) => ({
      ...node,
      value: { ...node.value, content: textContent("Updated target") },
    }));
    const projected = projectOutline(graph);
    const reference = projected[0]?.children?.[0]?.children?.[4]?.children?.[4];
    const original = projected[5]?.children?.[0];

    expect(reference?.value.content).toEqual(textContent("Updated target"));
    expect(original?.value.content).toEqual(textContent("Updated target"));
  });

  it("keeps a cycle Reference visible but terminates expansion by Node identity", () => {
    const graph = {
      nodes: {
        a: { childOccurrenceIds: ["b-reference"], id: "a", value: { content: textContent("A") } },
        b: { childOccurrenceIds: ["a-reference"], id: "b", value: { content: textContent("B") } },
      },
      occurrences: {
        "a-original": { id: "a-original", nodeId: "a" },
        "a-reference": { appearance: "reference", id: "a-reference", nodeId: "a" },
        "b-original": { id: "b-original", nodeId: "b" },
        "b-reference": { appearance: "reference", id: "b-reference", nodeId: "b" },
      },
      rootOccurrenceIds: ["a-original", "b-original"],
    } as const;

    const cycle = projectOutline(graph)[0]?.children?.[0]?.children?.[0];
    expect(cycle?.nodeId).toBe("a");
    expect(cycle?.children).toBeUndefined();
    expect(cycle?.expandable).toBe(false);
    expect(findOriginalOccurrenceKey(graph, "b")).toBe("b-original");
  });

  it("can replace one Reference occurrence with a new ordinary Node without renaming its target", () => {
    const replacement = {
      childOccurrenceIds: [],
      id: "custom-status",
      value: { content: textContent("Custom status") },
    } as const;
    const graph = replaceGraphOccurrenceNode(initialGraph, "in-progress", replacement);

    expect(graph.nodes["status-in-progress"]?.value.content).toEqual(textContent("In progress"));
    expect(graph.occurrences["in-progress"]).toMatchObject({ appearance: undefined, nodeId: "custom-status" });
    expect(resolveGraphPath(graph, "projects/lode/status-field/in-progress")?.node.id).toBe("custom-status");
  });

  it("removes an unreachable temporary Node when its occurrence is retargeted", () => {
    const custom = replaceGraphOccurrenceNode(initialGraph, "in-progress", {
      childOccurrenceIds: [],
      id: "custom-status",
      value: { content: textContent("Custom status") },
    });
    const graph = retargetGraphOccurrence(custom, "in-progress", "status-planned", "reference");

    expect(graph.nodes["custom-status"]).toBeUndefined();
    expect(graph.occurrences["in-progress"]).toMatchObject({ appearance: "reference", nodeId: "status-planned" });
  });

  it("backs every suggested Reference with a real Node and Original occurrence", () => {
    const suggestions = [...fieldValueSuggestionIds.options, ...fieldValueSuggestionIds["options-from-supertag"]];
    for (const nodeId of suggestions) {
      expect(initialGraph.nodes[nodeId]).toBeDefined();
      expect(findOriginalOccurrenceKey(initialGraph, nodeId)).not.toBeNull();
    }
  });

  it("derives option labels and datatype from their owning Nodes", () => {
    const renamed = updateGraphNode(initialGraph, "status-in-progress", (node) => ({
      ...node,
      value: { ...node.value, content: textContent("Underway") },
    }));
    const rows = flattenOutline(projectOutline(renamed), new Set(["projects", "projects/lode"]));
    const valueRow = rows.find((row) => row.occurrence.occurrenceId === "in-progress");
    if (valueRow === undefined) {
      throw new Error("Expected the Status Field Value row");
    }
    const providers = createDemoCompletionProviders({
      fieldValueKeys: new Set([valueRow.key]),
      graph: renamed,
      rows,
    });
    const valueProvider = providers.find((provider) => provider.id === completionIds.value);
    expect(valueProvider?.items(valueRow, "Under")).toMatchObject([{ id: "status-in-progress", label: "Underway" }]);

    const plainDefinition = updateGraphNode(renamed, "status-definition", (node) => ({
      ...node,
      value: { ...node.value, field: { datatype: "plain", kind: "definition" } },
    }));
    const plainProviders = createDemoCompletionProviders({
      fieldValueKeys: new Set([valueRow.key]),
      graph: plainDefinition,
      rows,
    });
    expect(plainProviders.find((provider) => provider.id === completionIds.value)?.items(valueRow, "")).toEqual([]);
  });
});
