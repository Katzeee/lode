import { describe, expect, it } from "vitest";

import { completionIds, createDemoCompletionProviders } from "./outline-demo-completions.js";
import { demoInlineToken } from "./outline-demo-inline.js";
import {
  findOriginalOccurrenceKey,
  insertGraphNode,
  removeGraphOccurrence,
  resolveGraphPath,
  retargetGraphOccurrence,
  updateGraphNode,
  updateGraphContent,
} from "./outline-demo-graph.js";
import { fieldValueSuggestionIds, initialGraph, textContent } from "./outline-demo-model.js";
import { presentOutline } from "./outline-demo-presenter.js";

function presentedItem(graph: typeof initialGraph, modelPath: string) {
  const presented = presentOutline(graph);
  const key = [...presented.modelPathsByKey].find(([, path]) => path === modelPath)?.[0];
  const visit = (items: typeof presented.items): (typeof presented.items)[number] | undefined => {
    for (const item of items) {
      if (item.key === key) {
        return item;
      }
      const nested = visit(item.children ?? []);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  };
  return visit(presented.items);
}

describe("outline demo presenter", () => {
  it("supplies the reason for readonly names without imposing it on editable nodes", () => {
    expect(presentedItem(initialGraph, "projects/lode/status-field")).toMatchObject({
      editable: false,
      readonlyReason: "Name comes from the field definition.",
    });
    expect(presentedItem(initialGraph, "daily-notes")).toMatchObject({
      editable: false,
      readonlyReason: "This name is managed by the calendar.",
    });
    expect(presentedItem(initialGraph, "projects")?.readonlyReason).toBeUndefined();
  });

  it("presents Original and Reference children from one target Node", () => {
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

  it("updates shared Node content once for every presented occurrence", () => {
    const graph = updateGraphNode(initialGraph, "local-first", (node) => ({
      ...node,
      value: { ...node.value, content: textContent("Updated target") },
    }));
    const presented = presentOutline(graph);
    const reference = presented.items[0]?.children?.[0]?.children?.[4]?.children?.[4];
    const original = presented.items[5]?.children?.[0];

    expect(reference?.content).toEqual(textContent("Updated target"));
    expect(original?.content).toEqual(textContent("Updated target"));
    expect(reference).not.toHaveProperty("nodeId");
    expect(reference).not.toHaveProperty("occurrenceId");
    expect(presented.modelPathsByKey.get(reference?.key ?? "")).toBe("projects/lode/roadmap/local-first-reference");
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

    const cycle = presentOutline(graph).items[0]?.children?.[0]?.children?.[0];
    expect(cycle?.accessibilityLabel).toBe("A");
    expect(cycle?.presentation.appearance).toBe("reference");
    expect(cycle?.children).toBeUndefined();
    expect(cycle?.expandable).toBe(false);
    expect(findOriginalOccurrenceKey(graph, "b")).toBe("b-original");
  });

  it("removes an unreachable temporary Node when its occurrence is retargeted", () => {
    const custom = insertGraphNode(
      initialGraph,
      "projects/lode/status-field",
      1,
      {
        childOccurrenceIds: [],
        id: "custom-status",
        value: { content: textContent("Custom status") },
      },
      { id: "custom-status-occurrence", nodeId: "custom-status" },
    );
    const graph = retargetGraphOccurrence(custom, "custom-status-occurrence", "status-planned", "reference");

    expect(graph.nodes["custom-status"]).toBeUndefined();
    expect(graph.occurrences["custom-status-occurrence"]).toMatchObject({
      appearance: "reference",
      nodeId: "status-planned",
    });
  });

  it("edits each Field Reference through its target identity", () => {
    for (const [path, original, id] of [
      [
        "projects/lode/status-field/in-progress",
        "archive/value-library/status-in-progress-original",
        "status-in-progress",
      ],
      ["projects/lode/owner-field/kei-owner", "kei", "kei"],
      ["projects/lode/owner-field/team-owner", "archive/value-library/lode-team-original", "lode-team"],
    ] as const) {
      const graph = updateGraphContent(initialGraph, path, textContent("Updated target"));
      expect(resolveGraphPath(graph, path)?.occurrence).toMatchObject({ appearance: "reference", nodeId: id });
      expect(resolveGraphPath(graph, original)?.node.value.content).toEqual(textContent("Updated target"));
      expect(Object.keys(graph.nodes)).toEqual(Object.keys(initialGraph.nodes));
    }
  });

  it("retains targets that remain reachable through inline references when a Field is retargeted", () => {
    const referenced = updateGraphContent(initialGraph, "inbox/crdt-survey", [
      demoInlineToken("reference", "kei", "Kei"),
    ]);
    const withoutOriginal = removeGraphOccurrence(referenced, "kei");
    const graph = retargetGraphOccurrence(withoutOriginal, "kei-owner", "lode-team", "reference");
    expect(graph.nodes.kei?.value.content).toEqual(initialGraph.nodes.kei?.value.content);
    expect(graph.occurrences["kei-owner"]?.nodeId).toBe("lode-team");
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
    const presented = presentOutline(renamed);
    const valueKey = [...presented.modelPathsByKey].find(
      ([, path]) => path === "projects/lode/status-field/in-progress",
    )?.[0];
    if (valueKey === undefined) {
      throw new Error("Expected the Status Field Value ViewModel");
    }
    const providers = createDemoCompletionProviders({
      commands: [],
      fieldDefinitionIdsByKey: presented.fieldDefinitionIdsByKey,
      graph: renamed,
    });
    const valueProvider = providers.find((provider) => provider.id === completionIds.value);
    expect(valueProvider?.items(valueKey, "Under")).toMatchObject([{ id: "status-in-progress", label: "Underway" }]);

    const plainDefinition = updateGraphNode(renamed, "status-definition", (node) => ({
      ...node,
      value: { ...node.value, field: { datatype: "plain", kind: "definition" } },
    }));
    const plainPresented = presentOutline(plainDefinition);
    const plainProviders = createDemoCompletionProviders({
      commands: [],
      fieldDefinitionIdsByKey: plainPresented.fieldDefinitionIdsByKey,
      graph: plainDefinition,
    });
    expect(plainProviders.find((provider) => provider.id === completionIds.value)?.items(valueKey, "")).toEqual([]);
  });

  it("presents a Field from the Node alone, wherever the Field is moved", () => {
    const fieldPath = "projects/lode/review-date-field";
    const field = resolveGraphPath(initialGraph, fieldPath);
    if (field === null) {
      throw new Error("Expected the Review date Field");
    }
    const detached = removeGraphOccurrence(initialGraph, fieldPath);
    for (const targetPath of ["projects/lode/owner-field/team-owner", "projects/lode/owner-field"]) {
      const graph = insertGraphNode(detached, targetPath, 0, field.node, field.occurrence);
      const nestedFieldPath = `${targetPath}/review-date-field`;
      const nestedField = presentedItem(graph, nestedFieldPath);

      expect(nestedField?.presentation).toMatchObject({ childrenLayout: "beside", kind: "field" });
      expect(nestedField?.editable).toBe(false);
      expect(presentedItem(graph, `${nestedFieldPath}/review-date-value`)?.presentation.childrenLayout).toBeUndefined();
      expect(resolveGraphPath(graph, `${nestedFieldPath}/review-date-value`)?.node.value.content).toEqual(
        textContent("Sep 12, 2026"),
      );
    }
  });
});
