import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../../domain/reconcile/index.js";
import { base, end, Facts, versions } from "../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { prepareEdits } from "./index.js";

describe("domain Edit write boundaries", () => {
  it("reserves Workspace root creation for genesis at the planning boundary", () => {
    const facts = new Facts();
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;

    expect(() =>
      prepareEdits(
        "workspace",
        "actor",
        [
          {
            kind: "node-create",
            nodeId: "workspace",
            occurrenceId: "workspace-original",
            parentNodeId: "workspace",
            anchor: end,
          },
        ],
        generation,
        "direct",
        snapshot,
      ),
    ).toThrow("Workspace identity is created only by Workspace genesis");
  });

  it("declares Node creation and deletion atomic at their domain handlers", () => {
    const creationFacts = new Facts();
    const creationSnapshot = creationFacts.snapshot();
    const creationGeneration = rebuildGeneration("workspace", creationSnapshot, versions).generation;
    expect(
      prepareEdits(
        "workspace",
        "actor",
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
    const deletionGeneration = rebuildGeneration("workspace", deletionSnapshot, versions).generation;
    expect(
      prepareEdits(
        "workspace",
        "actor",
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
      "actor",
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

  it("keeps generated Schema lifecycle members in the source Edit transaction", () => {
    const facts = new Facts();
    facts.addPlaced("schema");
    facts.add({ kind: "node-type-declare", nodeId: "schema", nodeType: "schema" });
    facts.addPlaced("field-definition");
    facts.add({
      kind: "node-type-declare",
      nodeId: "field-definition",
      nodeType: "field-definition",
    });
    const snapshot = facts.snapshot();
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;

    const writes = prepareEdits(
      "workspace",
      "actor",
      [
        {
          kind: "schema-field-add",
          schemaId: "schema",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "template-field",
          fieldOccurrenceId: "template-field-occurrence",
          anchor: end,
        },
      ],
      generation,
      "proposal",
      snapshot,
    );

    expect(writes).toMatchObject([
      {
        kind: "atomic",
        mutations: [
          { kind: "node-create", nodeId: "template-field" },
          { kind: "node-type-declare", nodeId: "template-field", nodeType: "field" },
          {
            kind: "occurrence-create",
            occurrenceId: "template-field-occurrence",
            nodeId: "template-field",
            parentNodeId: "schema",
          },
          {
            kind: "schema-field-add",
            schemaId: "schema",
            fieldDefinitionId: "field-definition",
          },
        ],
      },
    ]);
  });
});
