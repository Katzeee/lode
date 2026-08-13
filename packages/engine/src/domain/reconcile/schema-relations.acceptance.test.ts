import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import {
  factTransactionId,
  frontierOf,
  makeFact,
  type FactFrontier,
  type Mutation,
} from "../fact/index.js";
import { projectSnapshot, projectionText } from "./projection.js";
import type { Projection } from "./projection-types.js";
import { end, Facts, versions } from "./reconcile-test-helpers.js";
import { addPlacedNode } from "./placed-node-test-helpers.js";

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

function initializedStatusValue(value: string) {
  return {
    kind: "text" as const,
    nodeId: "initialized-field:v1:task:status-field:value:0",
    occurrenceId: "initialized-field-occ:v1:task:status-field:value:0",
    value,
  };
}

describe("Schema applications and effective Fields", () => {
  it("materializes initialized Fields on the Workspace Node", () => {
    const facts = schemaFixture();
    facts.add({
      kind: "schema-apply",
      nodeId: "workspace",
      schemaId: "project-schema",
      anchor: end,
    });
    facts.add({
      kind: "field-initialize",
      ownerNodeId: "workspace",
      schemaId: "project-schema",
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
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    facts.add({
      kind: "field-initialize",
      ownerNodeId: "task",
      schemaId: "project-schema",
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
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([
      valueOccurrenceId,
    ]);
    expect(projection.nodeStatuses[valueNodeId]).toMatchObject({
      nodeId: valueNodeId,
      roles: [],
      state: "active",
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
    expect(projection.nodes[valueNodeId]).toBeUndefined();
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([]);
    expect(projection.nodeStatuses[valueNodeId]).toMatchObject({
      state: "deleted",
      deletionFactIds: [nodeDeletion.id],
    });

    facts.add({ kind: "node-restore", nodeId: valueNodeId, deletionFactId: nodeDeletion.id });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projectionText(projection, valueNodeId)).toBe("Ready");
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([
      valueOccurrenceId,
    ]);
  });

  it("keeps multiple Schema applications and deduplicates a shared Field Definition by source", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "work-schema", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.schemaApplications.task).toEqual(["project-schema", "work-schema"]);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSchemaIds: ["project-schema", "work-schema"],
        materializedFieldNodeId: null,
      },
      {
        fieldDefinitionId: "owner-field",
        sourceSchemaIds: ["work-schema"],
        materializedFieldNodeId: null,
      },
    ]);
  });

  it("projects each Template Field as a Node owned through its Occurrence under the Schema", () => {
    const projection = projectSnapshot("workspace", schemaFixture().snapshot(), "origin", versions);
    const fieldNodeId = "project-schema-status-field-template-field";
    const fieldOccurrenceId = "project-schema-status-field-template-field-occurrence";

    expect(projection.nodes[fieldNodeId]).toBeDefined();
    expect(projection.occurrences[fieldOccurrenceId]).toMatchObject({
      occurrenceId: fieldOccurrenceId,
      nodeId: fieldNodeId,
      parentNodeId: "project-schema",
      derived: false,
    });
    expect(projection.children["project-schema"]).toContain(fieldOccurrenceId);
    expect(projection.nodeOwners[fieldNodeId]).toBe("project-schema");
  });

  it("orders Template Fields and ordinary Template Nodes in one Occurrence sequence", () => {
    const facts = schemaFixture();
    const fieldOccurrenceId = "project-schema-status-field-template-field-occurrence";
    facts.add({ kind: "node-create", nodeId: "project-guidance" });
    facts.add({
      kind: "schema-template-node-add",
      schemaId: "project-schema",
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
    expect(projection.children["project-schema"]).toEqual([
      fieldOccurrenceId,
      "project-guidance-template-occurrence",
    ]);
    expect(projection.occurrences["project-guidance-template-occurrence"]).toMatchObject({
      nodeId: "project-guidance",
      parentNodeId: "project-schema",
      derived: false,
    });
  });

  it("keeps deleted Definition identity and restores its existing relationships and configuration", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });

    const schemaDeletion = facts.add({ kind: "node-delete", nodeId: "project-schema" });
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaApplications.task).toEqual(["project-schema"]);
    expect(projection.schemaFields["project-schema"]).toEqual(["status-field"]);
    expect(projection.nodeStatuses["project-schema"]).toEqual({
      nodeId: "project-schema",
      roles: ["schema"],
      state: "deleted",
      deletionFactIds: [schemaDeletion.id],
    });
    expect(projection.effectiveFields.task).toEqual([]);

    facts.add({
      kind: "node-restore",
      nodeId: "project-schema",
      deletionFactId: schemaDeletion.id,
    });
    const fieldDeletion = facts.add({ kind: "node-delete", nodeId: "status-field" });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaApplications.task).toEqual(["project-schema"]);
    expect(projection.schemaFields["project-schema"]).toEqual(["status-field"]);
    expect(projection.nodeStatuses["status-field"]).toMatchObject({
      roles: ["field"],
      state: "deleted",
      deletionFactIds: [fieldDeletion.id],
    });
    expect(projection.effectiveFields.task).toEqual([]);

    facts.add({
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: fieldDeletion.id,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeStatuses["project-schema"]?.state).toBe("active");
    expect(projection.nodeStatuses["status-field"]?.state).toBe("active");
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSchemaIds: ["project-schema"],
        materializedFieldNodeId: null,
      },
    ]);
  });

  it("keeps concurrent Field Template configs until an observing edit resolves them", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", baseFrontier, [
      {
        kind: "schema-field-configure",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-schema-status-field-template-field",

        config: {
          visibility: "pinned",
          staticDefault: [{ kind: "text", value: "Planned" }],
          initializer: null,
        },
        previousConfig: {
          visibility: "normal",
          staticDefault: null,
          initializer: null,
        },
        observedConfigFactIds: [],
      },
    ]);
    const planned = facts.values.at(-1);
    appendRemote(facts, "cccccccccccccccccccccccccc", baseFrontier, [
      {
        kind: "schema-field-configure",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-schema-status-field-template-field",

        config: {
          visibility: "normal",
          staticDefault: [{ kind: "text", value: "Started" }],
          initializer: null,
        },
        previousConfig: {
          visibility: "normal",
          staticDefault: null,
          initializer: null,
        },
        observedConfigFactIds: [],
      },
    ]);
    const started = facts.values.at(-1);
    if (!planned || !started) {
      throw new Error("Expected concurrent Field config Facts");
    }
    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.templateFields["project-schema"]?.[0]).toMatchObject({
      effectiveConfig: null,
    });
    expect(projection.templateFields["project-schema"]?.[0]?.configCandidates).toHaveLength(2);
    expect(
      Object.values(projection.conflictIssues).filter(
        (issue) => issue.kind === "field-config-conflict",
      ),
    ).toHaveLength(2);

    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      {
        kind: "schema-field-configure",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
        fieldNodeId: "project-schema-status-field-template-field",

        config: {
          visibility: "pinned",
          staticDefault: [{ kind: "text", value: "Planned" }],
          initializer: null,
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
    expect(projection.templateFields["project-schema"]?.[0]?.effectiveConfig).toMatchObject({
      staticDefault: [{ kind: "text", value: "Planned" }],
    });
    expect(
      Object.values(projection.conflictIssues).filter(
        (issue) => issue.kind === "field-config-conflict",
      ),
    ).toEqual([]);
  });

  it("preserves divergent concurrent initializers as candidates until an observing choice", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(
      facts,
      "bbbbbbbbbbbbbbbbbbbbbbbbbb",
      baseFrontier,
      initializationBundle("Device B", [
        {
          kind: "field-initialize",
          ownerNodeId: "task",
          schemaId: "project-schema",
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
          schemaId: "project-schema",
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
      Object.values(projection.conflictIssues).some(
        (issue) => issue.kind === "field-initialization-conflict",
      ),
    ).toBe(true);

    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      {
        kind: "field-initialize",
        ownerNodeId: "task",
        schemaId: "project-schema",
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
      Object.values(projection.conflictIssues).some(
        (issue) => issue.kind === "field-initialization-conflict",
      ),
    ).toBe(false);
  });

  it("preserves a shared effective Field until its final Schema source is removed", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "work-schema", anchor: end });
    facts.add({
      kind: "schema-remove",
      nodeId: "task",
      schemaId: "project-schema",
      previousAnchor: { ...start, before: "work-schema" },
    });

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.effectiveFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      sourceSchemaIds: ["work-schema"],
    });

    facts.add({
      kind: "schema-remove",
      nodeId: "task",
      schemaId: "work-schema",
      previousAnchor: start,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaApplications.task).toBeUndefined();
    expect(projection.effectiveFields.task).toBeUndefined();
  });

  it("uses observed-remove for concurrent Schema Application and Field Contribution intent", () => {
    const facts = schemaFixture();
    const beforeApplication = frontierOf(facts.values);
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    const afterApplication = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", afterApplication, [
      { kind: "schema-remove", nodeId: "task", schemaId: "project-schema" },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", beforeApplication, [
      { kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end },
    ]);

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaApplications.task).toEqual(["project-schema"]);

    const beforeField = frontierOf(facts.values);
    facts.add({
      kind: "schema-field-add",
      schemaId: "project-schema",
      fieldDefinitionId: "owner-field",
      fieldNodeId: "project-schema-owner-field-template-field",
      fieldOccurrenceId: "project-schema-owner-field-template-field-occurrence",
      anchor: end,
    });
    const afterField = frontierOf(facts.values);
    appendRemote(facts, "dddddddddddddddddddddddddd", afterField, [
      {
        kind: "schema-field-remove",
        schemaId: "project-schema",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-schema-owner-field-template-field",
        fieldOccurrenceId: "project-schema-owner-field-template-field-occurrence",
      },
    ]);
    appendRemote(facts, "eeeeeeeeeeeeeeeeeeeeeeeeee", beforeField, [
      {
        kind: "schema-field-add",
        schemaId: "project-schema",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-schema-owner-field-template-field",
        fieldOccurrenceId: "project-schema-owner-field-template-field-occurrence",
        anchor: end,
      },
    ]);

    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaFields["project-schema"]).toEqual(["status-field", "owner-field"]);
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual([
      "status-field",
      "owner-field",
    ]);

    appendRemote(facts, "ffffffffffffffffffffffffff", frontierOf(facts.values), [
      { kind: "schema-remove", nodeId: "task", schemaId: "project-schema" },
      {
        kind: "schema-field-remove",
        schemaId: "project-schema",
        fieldDefinitionId: "owner-field",
        fieldNodeId: "project-schema-owner-field-template-field",
        fieldOccurrenceId: "project-schema-owner-field-template-field-occurrence",
      },
    ]);
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaApplications.task).toBeUndefined();
    expect(projection.schemaFields["project-schema"]).toEqual(["status-field"]);
  });

  it("inherits Fields through multi-base and diamond Extensions and builds polymorphic search", () => {
    const facts = schemaFixture();
    for (const nodeId of ["base", "left", "right", "child", "base-field", "child-field"]) {
      facts.add({ kind: "node-create", nodeId });
    }
    facts.add({
      kind: "schema-field-add",
      schemaId: "base",
      fieldDefinitionId: "base-field",
      fieldNodeId: "base-base-field-template-field",
      fieldOccurrenceId: "base-base-field-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "schema-field-add",
      schemaId: "child",
      fieldDefinitionId: "child-field",
      fieldNodeId: "child-child-field-template-field",
      fieldOccurrenceId: "child-child-field-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "schema-extension-add",
      schemaId: "left",
      baseSchemaId: "base",
      anchor: end,
    });
    facts.add({
      kind: "schema-extension-add",
      schemaId: "right",
      baseSchemaId: "base",
      anchor: end,
    });
    facts.add({
      kind: "schema-extension-add",
      schemaId: "child",
      baseSchemaId: "left",
      anchor: end,
    });
    facts.add({
      kind: "schema-extension-add",
      schemaId: "child",
      baseSchemaId: "right",
      anchor: end,
    });
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "child", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.schemaExtensions.child).toEqual(["left", "right"]);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "base-field",
        sourceSchemaIds: ["base"],
        materializedFieldNodeId: null,
      },
      {
        fieldDefinitionId: "child-field",
        sourceSchemaIds: ["child"],
        materializedFieldNodeId: null,
      },
    ]);
    expect(projection.schemaSearchMembers.base).toEqual(["base", "child", "left", "right"]);
    expect(projection.schemaSearchMembers.left).toEqual(["child", "left"]);
    expect(projection.schemaExtensionConflicts).toEqual({});
  });

  it("keeps concurrent Extension edges but suspends inheritance and search inside a cycle", () => {
    const facts = schemaFixture();
    for (const nodeId of ["schema-a", "schema-b", "field-a", "field-b"]) {
      facts.add({ kind: "node-create", nodeId });
    }
    facts.add({
      kind: "schema-field-add",
      schemaId: "schema-a",
      fieldDefinitionId: "field-a",
      fieldNodeId: "schema-a-field-a-template-field",
      fieldOccurrenceId: "schema-a-field-a-template-field-occurrence",
      anchor: end,
    });
    facts.add({
      kind: "schema-field-add",
      schemaId: "schema-b",
      fieldDefinitionId: "field-b",
      fieldNodeId: "schema-b-field-b-template-field",
      fieldOccurrenceId: "schema-b-field-b-template-field-occurrence",
      anchor: end,
    });
    const branch = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", branch, [
      { kind: "schema-extension-add", schemaId: "schema-a", baseSchemaId: "schema-b", anchor: end },
    ]);
    appendRemote(facts, "cccccccccccccccccccccccccc", branch, [
      { kind: "schema-extension-add", schemaId: "schema-b", baseSchemaId: "schema-a", anchor: end },
    ]);
    appendRemote(facts, "dddddddddddddddddddddddddd", frontierOf(facts.values), [
      { kind: "schema-apply", nodeId: "task", schemaId: "schema-a", anchor: end },
    ]);

    let projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaExtensions).toEqual({
      "schema-a": ["schema-b"],
      "schema-b": ["schema-a"],
    });
    expect(projection.schemaExtensionConflicts).toEqual({
      "schema-a": ["schema-a", "schema-b"],
      "schema-b": ["schema-a", "schema-b"],
    });
    expect(Object.values(projection.conflictIssues)).toEqual([
      expect.objectContaining({
        kind: "schema-extension-cycle",
        schemaIds: ["schema-a", "schema-b"],
      }),
    ]);
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual([
      "field-a",
    ]);
    expect(projection.schemaSearchMembers).toEqual({
      "schema-a": ["schema-a"],
      "schema-b": ["schema-b"],
    });

    appendRemote(facts, "eeeeeeeeeeeeeeeeeeeeeeeeee", frontierOf(facts.values), [
      {
        kind: "schema-extension-remove",
        schemaId: "schema-b",
        baseSchemaId: "schema-a",
        previousAnchor: start,
      },
    ]);
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.schemaExtensionConflicts).toEqual({});
    expect(projection.conflictIssues).toEqual({});
    expect(projection.effectiveFields.task?.map((field) => field.fieldDefinitionId)).toEqual([
      "field-b",
      "field-a",
    ]);
  });

  it("binds a Materialized Field to real Node and Occurrence identities with ordered values", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
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
      kind: "schema-remove",
      nodeId: "task",
      schemaId: "project-schema",
      previousAnchor: start,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(fieldSummaries(projection.effectiveFields.task)).toEqual([
      {
        fieldDefinitionId: "status-field",
        sourceSchemaIds: [],
        materializedFieldNodeId: "status-on-task",
      },
    ]);
    expect(projection.nodes["status-on-task"]).toBeDefined();
    expect(projection.occurrences["project-reference-occurrence"]?.nodeId).toBe(
      "project-reference",
    );

    const tombstone = facts.add({ kind: "node-delete", nodeId: "status-field" });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodes["status-field"]).toBeUndefined();
    expect(projection.materializedFields.task?.[0]?.valueOccurrenceIds).toEqual([
      "todo-value-occurrence",
      "project-reference-occurrence",
    ]);
    expect(projection.nodes["todo-value"]).toBeDefined();

    facts.add({
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: tombstone.id,
    });
    projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodes["status-field"]).toBeDefined();
    expect(projection.materializedFields.task?.[0]?.fieldNodeId).toBe("status-on-task");
  });

  it("merges concurrent materialization candidates into one Field without losing values", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "task-occurrence",
      nodeId: "task",
      parentNodeId: "workspace",
      anchor: end,
    });
    const branchFrontier = frontierOf(facts.values);
    appendMaterializationBranch(
      facts,
      "bbbbbbbbbbbbbbbbbbbbbbbbbb",
      branchFrontier,
      "offline-a",
      "Alpha",
    );
    appendMaterializationBranch(
      facts,
      "cccccccccccccccccccccccccc",
      branchFrontier,
      "offline-b",
      "Beta",
    );

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
        properties: { fieldDefinitionId: "status-field" },
        metadata: { initializedBy: "auto-initialize" },
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
        properties: {},
        metadata: { initializedBy: "auto-initialize" },
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
  return fields?.map(({ fieldDefinitionId, sourceSchemaIds, materializedFieldNodeId }) => ({
    fieldDefinitionId,
    sourceSchemaIds,
    materializedFieldNodeId,
  }));
}

function schemaFixture(): Facts {
  const facts = new Facts();
  for (const nodeId of ["task", "project-schema", "work-schema", "status-field", "owner-field"]) {
    addPlacedNode(facts, nodeId);
  }
  facts.add({
    kind: "schema-field-add",
    schemaId: "project-schema",
    fieldDefinitionId: "status-field",
    fieldNodeId: "project-schema-status-field-template-field",
    fieldOccurrenceId: "project-schema-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "work-schema",
    fieldDefinitionId: "status-field",
    fieldNodeId: "work-schema-status-field-template-field",
    fieldOccurrenceId: "work-schema-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "work-schema",
    fieldDefinitionId: "owner-field",
    fieldNodeId: "work-schema-owner-field-template-field",
    fieldOccurrenceId: "work-schema-owner-field-template-field-occurrence",
    anchor: end,
  });
  return facts;
}
