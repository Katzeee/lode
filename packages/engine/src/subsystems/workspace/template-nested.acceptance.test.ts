import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { templateFixture as fixture } from "../../../tests/support/workspace/template-fixture.js";
import { nodeAt, createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";

describe("template editing materializes the authored Node graph", () => {
  it("edits a deep leaf atomically while copying siblings, real Field values and tags without materializing empty suggestions", async () => {
    const f = await fixture("9980");
    await f.edit(
      [
        nodeAt("source", "tag", "source-occ", { text: "Source" }),
        nodeAt("alpha", "source", "alpha-occ", { text: "Alpha" }),
        nodeAt("leaf", "alpha", "leaf-occ", { text: "Leaf" }),
        nodeAt("beta", "source", "beta-occ", { text: "Beta" }),
        nodeAt("marker", "workspace", "marker-occ", { intrinsicNodeType: "supertag-definition" }),
        nodeAt("value-def", "workspace", "value-def-occ", { intrinsicNodeType: "field-definition" }),
        { kind: "supertag-template-field-create", supertagId: "marker", fieldDefinitionId: "empty-def", anchor },
        createSupertagApplication("source", "marker"),
        {
          kind: "field-value-create",
          ownerNodeId: "beta",
          fieldDefinitionId: "value-def",
          valueNodeId: "value",
          valueOccurrenceId: "value-occ",
          anchor,
          seed: { text: [{ value: "Value", attributes: {} }] },
        },
        { kind: "occurrence-create", occurrenceId: "beta-to-alpha", nodeId: "alpha", parentNodeId: "beta", anchor },
      ],
      "setup",
    );
    const sourceField = (await f.read("materializedFields")).materializedFields.beta?.[0];
    if (!sourceField) {
      throw new Error("Source Field is absent");
    }
    await f.edit([{ kind: "reference-promote", occurrenceId: sourceField.definitionOccurrenceId }], "setup");
    const before = (await f.read("nodes")).nodes;
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "one",
        templateNodeId: "source",
        sourcePath: ["alpha-occ", "leaf-occ"],
        intents: [
          {
            kind: "set-content",
            content: { items: [{ kind: "text", value: "Leaf local", attributes: { bold: true } }] },
          },
        ],
      },
    ]);
    const instance = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "one",
    )!;
    const copy = (sourceNodeId: string) => {
      const result = instance.copies.find((copy) => copy.sourceNodeId === sourceNodeId);
      if (!result) {
        throw new Error(`Missing copy of ${sourceNodeId}`);
      }
      return result;
    };
    expect(instance.copies.map((item) => item.sourceNodeId)).toEqual([
      "source",
      "alpha",
      "leaf",
      "beta",
      sourceField.fieldNodeId,
      "value",
    ]);
    const graph = (await f.read("nodes")).nodes;
    const text = (nodeId: string) =>
      graph[nodeId]?.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
    expect(text(copy("leaf").instanceNodeId)).toBe("Leaf local");
    expect(text(copy("alpha").instanceNodeId)).toBe("Alpha");
    expect(text(copy("beta").instanceNodeId)).toBe("Beta");
    for (const id of ["source", "alpha", "leaf", "beta", "value", "value-def"]) {
      expect(graph[id]).toEqual(before[id]);
    }
    const materialized = (await f.read("materializedFields")).materializedFields;
    expect(materialized[copy("source").instanceNodeId] ?? []).toEqual([]);
    const copiedField = materialized[copy("beta").instanceNodeId]?.[0];
    if (!copiedField) {
      throw new Error("Copied Field is absent");
    }
    expect(copiedField.fieldDefinitionId).toBe("value-def");
    expect(text(copy("value").instanceNodeId)).toBe("Value");
    expect((await f.read("nodeOwners")).nodeOwners["value-def"]).toBe(sourceField.fieldNodeId);
    const occurrences = (await f.read("occurrences")).occurrences;
    expect(
      Object.values(occurrences).some(
        (item) => item.parentNodeId === copy("beta").instanceNodeId && item.nodeId === copy("alpha").instanceNodeId,
      ),
    ).toBe(true);
    expect(
      (await f.read("supertagApplications")).supertagApplications[copy("source").instanceNodeId]?.map(
        (tag) => tag.supertagId,
      ),
    ).toEqual(["marker"]);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two")?.state,
    ).toBe("linked");
    await f.history("undo");
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")?.state,
    ).toBe("linked");
    const trash = (await f.read("workspaceSystemNodes")).workspaceSystemNodes.trash;
    const owners = (await f.read("nodeOwners")).nodeOwners;
    expect(instance.copies.every((copy) => owners[copy.instanceNodeId] === trash)).toBe(true);
    await f.history("redo");
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")?.copies,
    ).toEqual(instance.copies);
    expect(
      (await f.read("nodes")).nodes[copy("leaf").instanceNodeId]?.content
        .flatMap((item) => (item.kind === "text" ? [item.value] : []))
        .join(""),
    ).toBe("Leaf local");
    await f.close();
  });

  it("uses one first Node intent for adding a tag without a preceding text edit", async () => {
    const f = await fixture("9981");
    await f.edit(
      [
        nodeAt("source", "tag", "source-occ", { text: "Source" }),
        nodeAt("child", "source", "child-occ", { text: "Child" }),
        nodeAt("marker", "workspace", "marker-occ", { intrinsicNodeType: "supertag-definition" }),
      ],
      "setup",
    );
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "one",
        templateNodeId: "source",
        sourcePath: [],
        intents: [{ kind: "add-supertag", supertagId: "marker" }],
      },
    ]);
    const instance = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "one",
    )!;
    expect(instance.copies).toHaveLength(2);
    expect(
      (await f.read("supertagApplications")).supertagApplications[instance.instanceNodeId!]?.map(
        (tag) => tag.supertagId,
      ),
    ).toEqual(["marker"]);
    expect((await f.read("supertagApplications")).supertagApplications.source ?? []).toEqual([]);
    await f.history("undo");
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")?.state,
    ).toBe("linked");
    await f.history("redo");
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")
        ?.instanceNodeId,
    ).toBe(instance.instanceNodeId);
    expect(
      (await f.read("supertagApplications")).supertagApplications[instance.instanceNodeId!]?.map(
        (tag) => tag.supertagId,
      ),
    ).toEqual(["marker"]);
    await f.close();
  });
});
