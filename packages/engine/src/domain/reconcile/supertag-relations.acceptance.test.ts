import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import {
  COMMAND_NODE_TYPE,
  FIELD_DEFINITION_NODE_TYPE,
  FIELD_NODE_TYPE,
  factTransactionId,
  frontierOf,
  makeFact,
  SEARCH_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  type FactFrontier,
  type Mutation,
  workspaceTrashNodeId,
} from "../fact/index.js";
import { projectSnapshot, projectionText } from "../../../tests/support/reconcile/projection.js";
import type { Projection } from "./projection-types.js";
import { end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode, addPlacedNode } from "../../../tests/support/reconcile/placed-node-test-helpers.js";

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

function initializedStatusValue(value: string) {
  return {
    kind: "text" as const,
    nodeId: "initialized-field:v1:task:status-field:value:0",
    occurrenceId: "initialized-field-occ:v1:task:status-field:value:0",
    value,
  };
}

describe("Supertag applications and effective Fields", () => {
  it("keeps zero-use Definition types as independent Node state", () => {
    const facts = new Facts();
    addDefinitionNode(facts, "empty-supertag", SUPERTAG_DEFINITION_NODE_TYPE);
    addDefinitionNode(facts, "empty-field", FIELD_DEFINITION_NODE_TYPE);

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.nodes["empty-supertag"]?.nodeType).toBe(SUPERTAG_DEFINITION_NODE_TYPE);
    expect(projection.nodes["empty-field"]?.nodeType).toBe(FIELD_DEFINITION_NODE_TYPE);
    expect(projection.supertagApplications).toEqual({});
    expect(projection.supertagFields).toEqual({});
  });

  it("does not infer a Definition nodeType from an otherwise well-shaped relation", () => {
    const facts = new Facts();
    addPlacedNode(facts, "plain-node");
    addPlacedNode(facts, "target");
    facts.add({ kind: "supertag-apply", nodeId: "target", supertagId: "plain-node", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.nodes["plain-node"]?.nodeType).toBeNull();
    expect(projection.supertagApplications.target).toBeUndefined();
  });

  it("suspends concurrent incompatible Node types and exposes the conflict", () => {
    const facts = new Facts();
    addPlacedNode(facts, "ambiguous-definition");
    const branch = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", branch, [
      {
        kind: "node-type-declare",
        nodeId: "ambiguous-definition",
        nodeType: "supertag-definition",
      },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", branch, [
      {
        kind: "node-type-declare",
        nodeId: "ambiguous-definition",
        nodeType: "field-definition",
      },
    ]);

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.nodes["ambiguous-definition"]?.nodeType).toBeNull();
    expect(Object.values(projection.conflictIssues)).toContainEqual(
      expect.objectContaining({
        kind: "node-type-conflict",
        nodeId: "ambiguous-definition",
      }),
    );
  });

  it("persists empty Search Nodes and applies the same type conflict policy", () => {
    const facts = new Facts();
    addPlacedNode(facts, "empty-search");
    facts.add({ kind: "node-type-declare", nodeId: "empty-search", nodeType: SEARCH_NODE_TYPE });
    addPlacedNode(facts, "ambiguous-function");
    const branch = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", branch, [
      { kind: "node-type-declare", nodeId: "ambiguous-function", nodeType: SEARCH_NODE_TYPE },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", branch, [
      { kind: "node-type-declare", nodeId: "ambiguous-function", nodeType: COMMAND_NODE_TYPE },
    ]);

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.nodes["empty-search"]?.nodeType).toBe(SEARCH_NODE_TYPE);
    expect(projection.nodes["ambiguous-function"]?.nodeType).toBeNull();
    expect(Object.values(projection.conflictIssues)).toContainEqual(
      expect.objectContaining({
        kind: "node-type-conflict",
        nodeId: "ambiguous-function",
      }),
    );
  });

  it("materializes initialized Fields on the Workspace Node", () => {
    const facts = supertagFixture();
    facts.add({
      kind: "supertag-apply",
      nodeId: "workspace",
      supertagId: "project-supertag",
      anchor: end,
    });
    facts.add({
      kind: "field-initialize",
      ownerNodeId: "workspace",
      supertagId: "project-supertag",
      fieldDefinitionId: "status-field",
      fieldNodeId: "initialized-field:v1:workspace:status-field",
      fieldOccurrenceId: "initialized-field-occ:v1:workspace:status-field",
      source: "auto-initialize",
      values: [
        {
          kind: "text",
          nodeId: "initialized-field:v1:workspace:status-field:value:0",
          occurrenceId: "initialized-field-occ:v1:workspace:status-field:value:0",
          value: "Ready",
        },
      ],
      observedInitializationFactIds: [],
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.nodeOwners.workspace).toBeNull();
    expect(projection.materializedFields.workspace?.[0]).toMatchObject({
      ownerNodeId: "workspace",
      fieldDefinitionId: "status-field",
      fieldNodeId: "initialized-field:v1:workspace:status-field",
    });
  });

  it("keeps initialized Field Nodes and Value Occurrences on the common lifecycle", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    facts.add({
      kind: "field-initialize",
      ownerNodeId: "task",
      supertagId: "project-supertag",
      fieldDefinitionId: "status-field",
      fieldNodeId: "initialized-field:v1:task:status-field",
      fieldOccurrenceId: "initialized-field-occ:v1:task:status-field",
      source: "auto-initialize",
      values: [initializedStatusValue("Ready")],
      observedInitializationFactIds: [],
    });

    const valueNodeId = "initialized-field:v1:task:status-field:value:0";
    const valueOccurrenceId = "initialized-field-occ:v1:task:status-field:value:0";
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([valueOccurrenceId]);
    expect(projection.nodes[valueNodeId]).toMatchObject({
      nodeId: valueNodeId,
      nodeType: null,
    });

    const occurrenceDeletion = facts.add({
      kind: "occurrence-delete",
      occurrenceId: valueOccurrenceId,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([]);
    facts.add({
      kind: "occurrence-restore",
      occurrenceId: valueOccurrenceId,
      deletionFactId: occurrenceDeletion.id,
      parentNodeId: "initialized-field:v1:task:status-field",
      anchor: end,
    });

    const nodeDeletion = facts.add({ kind: "node-delete", nodeId: valueNodeId });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodes[valueNodeId]).toBeDefined();
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([]);
    expect(projection.nodeOwners[valueNodeId]).toBe(workspaceTrashNodeId("workspace"));

    facts.add({ kind: "node-restore", nodeId: valueNodeId, deletionFactId: nodeDeletion.id });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projectionText(projection, valueNodeId)).toBe("Ready");
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([valueOccurrenceId]);
  });

  it("keeps multiple Supertag applications and deduplicates a shared Field Definition by source", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "work-supertag", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.supertagApplications.task).toEqual(["project-supertag", "work-supertag"]);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSupertagIds: ["project-supertag", "work-supertag"],
        materializedFieldNodeId: null,
      },
      {
        fieldDefinitionId: "owner-field",
        sourceSupertagIds: ["work-supertag"],
        materializedFieldNodeId: null,
      },
    ]);
  });

  it("projects each Template Field as a Node owned through its Occurrence under the Supertag", () => {
    const projection = projectSnapshot("workspace", supertagFixture().snapshot(), "origin", versions);
    const fieldNodeId = "project-supertag-status-field-template-field";
    const fieldOccurrenceId = "project-supertag-status-field-template-field-occurrence";

    expect(projection.nodes[fieldNodeId]).toBeDefined();
    expect(projection.occurrences[fieldOccurrenceId]).toMatchObject({
      occurrenceId: fieldOccurrenceId,
      nodeId: fieldNodeId,
      parentNodeId: "project-supertag",
      derived: false,
    });
    expect(projection.childOccurrences["project-supertag"]).toContain(fieldOccurrenceId);
    expect(projection.nodeOwners[fieldNodeId]).toBe("project-supertag");
    expect(projection.nodes[fieldNodeId]?.nodeType).toBe(FIELD_NODE_TYPE);
  });

  it("orders Template Fields and ordinary Template Nodes in one Occurrence sequence", () => {
    const facts = supertagFixture();
    const fieldOccurrenceId = "project-supertag-status-field-template-field-occurrence";
    facts.add({ kind: "node-create", nodeId: "project-guidance" });
    facts.add({
      kind: "supertag-template-node-add",
      supertagId: "project-supertag",
      templateNodeId: "project-guidance",
      templateOccurrenceId: "project-guidance-template-occurrence",
      anchor: {
        after: fieldOccurrenceId,
        before: null,
        affinity: "after",
        fallback: "end",
      },
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.childOccurrences["project-supertag"]).toEqual([
      fieldOccurrenceId,
      "project-guidance-template-occurrence",
    ]);
    expect(projection.occurrences["project-guidance-template-occurrence"]).toMatchObject({
      nodeId: "project-guidance",
      parentNodeId: "project-supertag",
      derived: false,
    });
  });

  it("keeps deleted Definition identity and restores its existing relationships and configuration", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });

    const supertagDeletion = facts.add({ kind: "node-delete", nodeId: "project-supertag" });
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagApplications.task).toEqual(["project-supertag"]);
    expect(projection.supertagFields["project-supertag"]).toBeUndefined();
    expect(projection.nodes["project-supertag"]?.nodeType).toBe(SUPERTAG_DEFINITION_NODE_TYPE);
    expect(projection.nodeOwners["project-supertag"]).toBe(workspaceTrashNodeId("workspace"));
    expect(projection.effectiveFields.task).toEqual([]);

    facts.add({
      kind: "node-restore",
      nodeId: "project-supertag",
      deletionFactId: supertagDeletion.id,
    });
    const fieldDeletion = facts.add({ kind: "node-delete", nodeId: "status-field" });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagApplications.task).toEqual(["project-supertag"]);
    expect(projection.supertagFields["project-supertag"]).toEqual(["status-field"]);
    expect(projection.nodes["status-field"]?.nodeType).toBe(FIELD_DEFINITION_NODE_TYPE);
    expect(projection.nodeOwners["status-field"]).toBe(workspaceTrashNodeId("workspace"));
    expect(projection.effectiveFields.task).toEqual([]);

    facts.add({
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: fieldDeletion.id,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners["project-supertag"]).not.toBe(workspaceTrashNodeId("workspace"));
    expect(projection.nodeOwners["status-field"]).not.toBe(workspaceTrashNodeId("workspace"));
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSupertagIds: ["project-supertag"],
        materializedFieldNodeId: null,
      },
    ]);
  });

  it("keeps concurrent Supertag Field configs until an observing edit resolves them", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", baseFrontier, [
      {
        kind: "supertag-field-configure",
        supertagId: "project-supertag",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-supertag-status-field-template-field",

        config: {
          visibility: "pinned",
          staticDefault: [{ kind: "text", value: "Planned" }],
        },
        previousConfig: {
          visibility: "normal",
          staticDefault: null,
        },
        observedConfigFactIds: [],
      },
    ]);
    const planned = facts.values.at(-1);
    appendRemote(facts, "cccccccccccccccccccccccccc", baseFrontier, [
      {
        kind: "supertag-field-configure",
        supertagId: "project-supertag",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-supertag-status-field-template-field",

        config: {
          visibility: "normal",
          staticDefault: [{ kind: "text", value: "Started" }],
        },
        previousConfig: {
          visibility: "normal",
          staticDefault: null,
        },
        observedConfigFactIds: [],
      },
    ]);
    const started = facts.values.at(-1);
    if (!planned || !started) {
      throw new Error("Expected concurrent Field config Facts");
    }
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.templateFields["project-supertag"]?.[0]).toMatchObject({
      effectiveConfig: null,
    });
    expect(projection.templateFields["project-supertag"]?.[0]?.configCandidates).toHaveLength(2);
    expect(
      Object.values(projection.conflictIssues).filter((issue) => issue.kind === "field-config-conflict"),
    ).toHaveLength(2);

    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      {
        kind: "supertag-field-configure",
        supertagId: "project-supertag",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-supertag-status-field-template-field",

        config: {
          visibility: "pinned",
          staticDefault: [{ kind: "text", value: "Planned" }],
        },
        previousConfig: null,
        observedConfigFactIds: [planned.id, started.id],
      },
    ]);
    const admission = admitAuthorityRecords(
      "workspace",
      facts.values.map((fact) => ({ recordKind: "fact" as const, fact })),
    );
    if (admission.kind === "fault") {
      throw new Error(admission.fault ?? "Field config admission fault");
    }
    expect(admission.kind).toBe("ready");
    projection = projectSnapshot("workspace", admission.snapshot, "origin", versions);
    expect(projection.templateFields["project-supertag"]?.[0]?.effectiveConfig).toMatchObject({
      staticDefault: [{ kind: "text", value: "Planned" }],
    });
    expect(Object.values(projection.conflictIssues).filter((issue) => issue.kind === "field-config-conflict")).toEqual(
      [],
    );
  });

  it("preserves divergent concurrent initialization results until an observing choice", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(
      facts,
      "bbbbbbbbbbbbbbbbbbbbbbbbbb",
      baseFrontier,
      initializationBundle("Device B", [
        {
          kind: "field-initialize",
          ownerNodeId: "task",
          supertagId: "project-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "initialized-field:v1:task:status-field",
          fieldOccurrenceId: "initialized-field-occ:v1:task:status-field",
          source: "auto-initialize",
          values: [initializedStatusValue("Device B")],
          observedInitializationFactIds: [],
        },
      ]),
    );
    const deviceB = facts.values.at(-1);
    appendRemote(
      facts,
      "cccccccccccccccccccccccccc",
      baseFrontier,
      initializationBundle("Device C", [
        {
          kind: "field-initialize",
          ownerNodeId: "task",
          supertagId: "project-supertag",
          fieldDefinitionId: "status-field",
          fieldNodeId: "initialized-field:v1:task:status-field",
          fieldOccurrenceId: "initialized-field-occ:v1:task:status-field",
          source: "auto-initialize",
          values: [initializedStatusValue("Device C")],
          observedInitializationFactIds: [],
        },
      ]),
    );
    const deviceC = facts.values.at(-1);
    if (!deviceB || !deviceC) {
      throw new Error("Expected concurrent initialization Facts");
    }
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.materializedFields.task).toBeUndefined();
    expect(projection.effectiveFields.task?.[0]?.initializationCandidates).toHaveLength(2);
    expect(
      Object.values(projection.conflictIssues).some((issue) => issue.kind === "field-initialization-conflict"),
    ).toBe(true);

    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      {
        kind: "field-initialize",
        ownerNodeId: "task",
        supertagId: "project-supertag",
        fieldDefinitionId: "status-field",
        fieldNodeId: "initialized-field:v1:task:status-field",
        fieldOccurrenceId: "initialized-field-occ:v1:task:status-field",
        source: "auto-initialize",
        values: [initializedStatusValue("Device B")],
        observedInitializationFactIds: [deviceB.id, deviceC.id],
      },
    ]);
    const admission = admitAuthorityRecords(
      "workspace",
      facts.values.map((fact) => ({ recordKind: "fact" as const, fact })),
    );
    if (admission.kind === "fault") {
      throw new Error(admission.fault ?? "Field initialization admission fault");
    }
    projection = projectSnapshot("workspace", admission.snapshot, "origin", versions);
    expect(projection.materializedFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      valueOccurrenceIds: ["initialized-field-occ:v1:task:status-field:value:0"],
    });
    expect(
      Object.values(projection.conflictIssues).some((issue) => issue.kind === "field-initialization-conflict"),
    ).toBe(false);
  });

  it("preserves a shared effective Field until its final Supertag source is removed", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "work-supertag", anchor: end });
    facts.add({
      kind: "supertag-remove",
      nodeId: "task",
      supertagId: "project-supertag",
      previousAnchor: { ...start, before: "work-supertag" },
    });

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      sourceSupertagIds: ["work-supertag"],
    });

    facts.add({
      kind: "supertag-remove",
      nodeId: "task",
      supertagId: "work-supertag",
      previousAnchor: start,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagApplications.task).toBeUndefined();
    expect(projection.effectiveFields.task).toBeUndefined();
  });

  it("uses observed-remove for concurrent Supertag Application and Field Contribution intent", () => {
    const facts = supertagFixture();
    const beforeApplication = frontierOf(facts.values);
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    const afterApplication = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", afterApplication, [
      { kind: "supertag-remove", nodeId: "task", supertagId: "project-supertag" },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", beforeApplication, [
      { kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end },
    ]);

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagApplications.task).toEqual(["project-supertag"]);

    const beforeField = frontierOf(facts.values);
    facts.add({
      kind: "supertag-field-add",
      supertagId: "project-supertag",
      fieldDefinitionId: "owner-field",
      fieldNodeId: "project-supertag-owner-field-template-field",
      fieldOccurrenceId: "project-supertag-owner-field-template-field-occurrence",
      anchor: end,
    });
    const afterField = frontierOf(facts.values);
    appendRemote(facts, "dddddddddddddddddddddddddd", afterField, [
      {
        kind: "supertag-field-remove",
        supertagId: "project-supertag",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-supertag-owner-field-template-field",
        fieldOccurrenceId: "project-supertag-owner-field-template-field-occurrence",
      },
    ]);
    appendRemote(facts, "eeeeeeeeeeeeeeeeeeeeeeeeee", beforeField, [
      {
        kind: "supertag-field-add",
        supertagId: "project-supertag",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-supertag-owner-field-template-field",
        fieldOccurrenceId: "project-supertag-owner-field-template-field-occurrence",
        anchor: end,
      },
    ]);

    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagFields["project-supertag"]).toEqual(["status-field", "owner-field"]);
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual([
      "status-field",
      "owner-field",
    ]);

    appendRemote(facts, "ffffffffffffffffffffffffff", frontierOf(facts.values), [
      { kind: "supertag-remove", nodeId: "task", supertagId: "project-supertag" },
      {
        kind: "supertag-field-remove",
        supertagId: "project-supertag",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-supertag-owner-field-template-field",
        fieldOccurrenceId: "project-supertag-owner-field-template-field-occurrence",
      },
    ]);
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagApplications.task).toBeUndefined();
    expect(projection.supertagFields["project-supertag"]).toEqual(["status-field"]);
  });

  it("inherits Fields through multi-base and diamond Extensions and builds polymorphic search", () => {
    const facts = supertagFixture();
    for (const nodeId of ["base", "left", "right", "child", "base-field", "child-field"]) {
      facts.addPlaced(nodeId);
    }
    for (const nodeId of ["base", "left", "right", "child"]) {
      facts.add({ kind: "node-type-declare", nodeId, nodeType: "supertag-definition" });
    }
    for (const nodeId of ["base-field", "child-field"]) {
      facts.add({ kind: "node-type-declare", nodeId, nodeType: "field-definition" });
    }
    facts.add({
      kind: "supertag-field-add",
      supertagId: "base",
      fieldDefinitionId: "base-field",
      fieldNodeId: "base-base-field-template-field",
      fieldOccurrenceId: "base-base-field-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "supertag-field-add",
      supertagId: "child",
      fieldDefinitionId: "child-field",
      fieldNodeId: "child-child-field-template-field",
      fieldOccurrenceId: "child-child-field-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "supertag-extension-add",
      supertagId: "left",
      baseSupertagId: "base",
      anchor: end,
    });
    facts.add({
      kind: "supertag-extension-add",
      supertagId: "right",
      baseSupertagId: "base",
      anchor: end,
    });
    facts.add({
      kind: "supertag-extension-add",
      supertagId: "child",
      baseSupertagId: "left",
      anchor: end,
    });
    facts.add({
      kind: "supertag-extension-add",
      supertagId: "child",
      baseSupertagId: "right",
      anchor: end,
    });
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "child", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.supertagExtensions.child).toEqual(["left", "right"]);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "base-field",
        sourceSupertagIds: ["base"],
        materializedFieldNodeId: null,
      },
      {
        fieldDefinitionId: "child-field",
        sourceSupertagIds: ["child"],
        materializedFieldNodeId: null,
      },
    ]);
    expect(projection.supertagInstanceSupertags.base).toEqual(["base", "child", "left", "right"]);
    expect(projection.supertagInstanceSupertags.left).toEqual(["child", "left"]);
    expect(projection.supertagExtensionConflicts).toEqual({});
  });

  it("keeps concurrent Extension edges but suspends inheritance and search inside a cycle", () => {
    const facts = supertagFixture();
    for (const nodeId of ["supertag-a", "supertag-b", "field-a", "field-b"]) {
      facts.addPlaced(nodeId);
    }
    for (const nodeId of ["supertag-a", "supertag-b"]) {
      facts.add({ kind: "node-type-declare", nodeId, nodeType: "supertag-definition" });
    }
    for (const nodeId of ["field-a", "field-b"]) {
      facts.add({ kind: "node-type-declare", nodeId, nodeType: "field-definition" });
    }
    facts.add({
      kind: "supertag-field-add",
      supertagId: "supertag-a",
      fieldDefinitionId: "field-a",
      fieldNodeId: "supertag-a-field-a-template-field",
      fieldOccurrenceId: "supertag-a-field-a-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "supertag-field-add",
      supertagId: "supertag-b",
      fieldDefinitionId: "field-b",
      fieldNodeId: "supertag-b-field-b-template-field",
      fieldOccurrenceId: "supertag-b-field-b-template-field-occurrence",
      anchor: end,
    });
    const branch = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", branch, [
      { kind: "supertag-extension-add", supertagId: "supertag-a", baseSupertagId: "supertag-b", anchor: end },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", branch, [
      { kind: "supertag-extension-add", supertagId: "supertag-b", baseSupertagId: "supertag-a", anchor: end },
    ]);
    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      { kind: "supertag-apply", nodeId: "task", supertagId: "supertag-a", anchor: end },
    ]);

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagExtensions).toEqual({
      "supertag-a": ["supertag-b"],
      "supertag-b": ["supertag-a"],
    });
    expect(projection.supertagExtensionConflicts).toEqual({
      "supertag-a": ["supertag-a", "supertag-b"],
      "supertag-b": ["supertag-a", "supertag-b"],
    });
    expect(Object.values(projection.conflictIssues)).toEqual([
      expect.objectContaining({
        kind: "supertag-extension-cycle",
        supertagIds: ["supertag-a", "supertag-b"],
      }),
    ]);
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual(["field-a"]);
    expect(projection.supertagInstanceSupertags).toEqual({
      "supertag-a": ["supertag-a"],
      "supertag-b": ["supertag-b"],
    });

    appendRemote(facts, "eeeeeeeeeeeeeeeeeeeeeeeeee", frontierOf(facts.values), [
      {
        kind: "supertag-extension-remove",
        supertagId: "supertag-b",
        baseSupertagId: "supertag-a",
        previousAnchor: start,
      },
    ]);
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.supertagExtensionConflicts).toEqual({});
    expect(projection.conflictIssues).toEqual({});
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual(["field-b", "field-a"]);
  });

  it("binds a Materialized Field to real Node and Occurrence identities with ordered values", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "task-occurrence",
      nodeId: "task",
      parentNodeId: "workspace",
      anchor: end,
    });
    for (const nodeId of ["status-on-task", "todo-value", "project-reference"]) {
      facts.add({ kind: "node-create", nodeId });
    }
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "status-on-task-occurrence",
      nodeId: "status-on-task",
      parentNodeId: "task",
      anchor: end,
    });
    facts.add({
      kind: "field-materialize",
      ownerNodeId: "task",
      fieldDefinitionId: "status-field",
      fieldNodeId: "status-on-task",
      fieldOccurrenceId: "status-on-task-occurrence",
    });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "todo-value-occurrence",
      nodeId: "todo-value",
      parentNodeId: "status-on-task",
      anchor: end,
    });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "project-reference-occurrence",
      nodeId: "project-reference",
      parentNodeId: "status-on-task",
      anchor: end,
    });

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.materializedFields.task).toEqual([
      {
        ownerNodeId: "task",
        fieldDefinitionId: "status-field",
        fieldNodeId: "status-on-task",
        fieldOccurrenceId: "status-on-task-occurrence",
        valueOccurrenceIds: ["todo-value-occurrence", "project-reference-occurrence"],
      },
    ]);
    expect(projection.effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      materializedFieldNodeId: "status-on-task",
    });

    facts.add({
      kind: "supertag-remove",
      nodeId: "task",
      supertagId: "project-supertag",
      previousAnchor: start,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSupertagIds: [],
        materializedFieldNodeId: "status-on-task",
      },
    ]);
    expect(projection.nodes["status-on-task"]).toBeDefined();
    expect(projection.occurrences["project-reference-occurrence"]?.nodeId).toBe("project-reference");

    const deletion = facts.add({ kind: "node-delete", nodeId: "status-field" });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodes["status-field"]).toBeDefined();
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([
      "todo-value-occurrence",
      "project-reference-occurrence",
    ]);
    expect(projection.nodes["todo-value"]).toBeDefined();

    facts.add({
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: deletion.id,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodes["status-field"]).toBeDefined();
    expect(projection.materializedFields.task?.[0]?.fieldNodeId).toBe("status-on-task");
  });

  it("merges concurrent materialization candidates into one Field without losing values", () => {
    const facts = supertagFixture();
    facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "project-supertag", anchor: end });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "task-occurrence",
      nodeId: "task",
      parentNodeId: "workspace",
      anchor: end,
    });
    const branchFrontier = frontierOf(facts.values);
    appendMaterializationBranch(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", branchFrontier, "offline-a", "Alpha");
    appendMaterializationBranch(facts, "cccccccccccccccccccccccccc", branchFrontier, "offline-b", "Beta");

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.materializedFields.task).toEqual([
      {
        ownerNodeId: "task",
        fieldDefinitionId: "status-field",
        fieldNodeId: "offline-a-field",
        fieldOccurrenceId: "offline-a-field-occurrence",
        valueOccurrenceIds: ["offline-a-value-occurrence", "offline-b-value-occurrence"],
      },
    ]);
    expect(projectionText(projection, "offline-a-value")).toBe("Alpha");
    expect(projectionText(projection, "offline-b-value")).toBe("Beta");
    expect(projection.nodes["offline-b-field"]).toBeDefined();
    expect(projection.occurrences["offline-b-field-occurrence"]?.nodeId).toBe("offline-b-field");
  });
});

function appendMaterializationBranch(
  facts: Facts,
  replicaId: string,
  observed: FactFrontier,
  prefix: string,
  text: string,
): void {
  appendRemote(facts, replicaId, observed, [
    { kind: "node-create", nodeId: `${prefix}-field` },
    {
      kind: "occurrence-create",
      occurrenceId: `${prefix}-field-occurrence`,
      nodeId: `${prefix}-field`,
      parentNodeId: "task",
      anchor: end,
    },
    {
      kind: "field-materialize",
      ownerNodeId: "task",
      fieldDefinitionId: "status-field",
      fieldNodeId: `${prefix}-field`,
      fieldOccurrenceId: `${prefix}-field-occurrence`,
    },
    { kind: "node-create", nodeId: `${prefix}-value` },
    {
      kind: "occurrence-create",
      occurrenceId: `${prefix}-value-occurrence`,
      nodeId: `${prefix}-value`,
      parentNodeId: `${prefix}-field`,
      anchor: end,
    },
    {
      kind: "text-splice",
      nodeId: `${prefix}-value`,
      deleteAtomIds: [],
      anchor: end,
      insert: text,
    },
  ]);
}

function initializationBundle(value: string, semantic: readonly Mutation[]): readonly Mutation[] {
  return [
    {
      kind: "node-create",
      nodeId: "initialized-field:v1:task:status-field",
      seed: {
        text: [],
      },
    },
    {
      kind: "occurrence-create",
      occurrenceId: "initialized-field-occ:v1:task:status-field",
      nodeId: "initialized-field:v1:task:status-field",
      parentNodeId: "task",
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: "initialized-field:v1:task:status-field:value:0",
      seed: {
        text: [...value].map((character) => ({ value: character, attributes: {} })),
      },
    },
    {
      kind: "occurrence-create",
      occurrenceId: "initialized-field-occ:v1:task:status-field:value:0",
      nodeId: "initialized-field:v1:task:status-field:value:0",
      parentNodeId: "initialized-field:v1:task:status-field",
      anchor: end,
    },
    ...semantic,
  ];
}

function appendRemote(
  facts: Facts,
  replicaId: string,
  baseFrontier: FactFrontier,
  mutations: readonly Mutation[],
): void {
  const transactionId = factTransactionId("workspace", replicaId, 1);
  for (const [index, mutation] of mutations.entries()) {
    const observed = { ...baseFrontier, ...(index > 0 ? { [replicaId]: index } : {}) };
    const maxObservedLamport = facts.values.reduce(
      (maximum, fact) =>
        fact.coordinate.dot.sequence <= (observed[fact.coordinate.dot.replicaId] ?? 0)
          ? Math.max(maximum, fact.coordinate.lamport)
          : maximum,
      0,
    );
    facts.values.push(
      makeFact({
        workspaceId: "workspace",
        replicaId,
        sequence: index + 1,
        observed,
        lamport: maxObservedLamport + 1,
        transaction: { transactionId, index, size: mutations.length },
        body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
      }),
    );
  }
}

function fieldSummaries(fields: Projection["effectiveFields"][string] | undefined) {
  return fields?.map(({ fieldDefinitionId, sourceSupertagIds, materializedFieldNodeId }) => ({
    fieldDefinitionId,
    sourceSupertagIds,
    materializedFieldNodeId,
  }));
}

function supertagFixture(): Facts {
  const facts = new Facts();
  addPlacedNode(facts, "task");
  addDefinitionNode(facts, "project-supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "work-supertag", SUPERTAG_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "status-field", FIELD_DEFINITION_NODE_TYPE);
  addDefinitionNode(facts, "owner-field", FIELD_DEFINITION_NODE_TYPE);
  facts.add({
    kind: "supertag-field-add",
    supertagId: "project-supertag",
    fieldDefinitionId: "status-field",
    fieldNodeId: "project-supertag-status-field-template-field",
    fieldOccurrenceId: "project-supertag-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({
    kind: "supertag-field-add",
    supertagId: "work-supertag",
    fieldDefinitionId: "status-field",
    fieldNodeId: "work-supertag-status-field-template-field",
    fieldOccurrenceId: "work-supertag-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({
    kind: "supertag-field-add",
    supertagId: "work-supertag",
    fieldDefinitionId: "owner-field",
    fieldNodeId: "work-supertag-owner-field-template-field",
    fieldOccurrenceId: "work-supertag-owner-field-template-field-occurrence",
    anchor: end,
  });
  return facts;
}
