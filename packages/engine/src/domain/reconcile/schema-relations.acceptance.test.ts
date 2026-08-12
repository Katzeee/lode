import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import { frontierOf, makeFact, type FactFrontier, type Mutation } from "../fact/index.js";
import { projectSnapshot, projectionText } from "./projection.js";
import type { Projection } from "./projection-types.js";
import { end, Facts, versions } from "./reconcile-test-helpers.js";

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

describe("Schema applications and effective Fields", () => {
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

  it("keeps concurrent Field Template configs until an observing edit resolves them", () => {
    const facts = schemaFixture();
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", baseFrontier, [
      {
        kind: "schema-field-configure",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
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
    expect(projection.schemaFieldItems["project-schema"]?.[0]).toMatchObject({
      effectiveConfig: null,
    });
    expect(projection.schemaFieldItems["project-schema"]?.[0]?.configCandidates).toHaveLength(2);
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
    expect(projection.schemaFieldItems["project-schema"]?.[0]?.effectiveConfig).toMatchObject({
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
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "task-occurrence",
      nodeId: "task",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    });
    facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "project-schema", anchor: end });
    const baseFrontier = frontierOf(facts.values);
    appendRemote(facts, "bbbbbbbbbbbbbbbbbbbbbbbbbb", baseFrontier, [
      {
        kind: "field-initialize",
        ownerNodeId: "task",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
        source: "auto-initialize",
        values: [{ kind: "text", value: "Device B" }],
        observedInitializationFactIds: [],
      },
    ]);
    const deviceB = facts.values.at(-1);
    appendRemote(facts, "cccccccccccccccccccccccccc", baseFrontier, [
      {
        kind: "field-initialize",
        ownerNodeId: "task",
        schemaId: "project-schema",
        fieldDefinitionId: "status-field",
        source: "auto-initialize",
        values: [{ kind: "text", value: "Device C" }],
        observedInitializationFactIds: [],
      },
    ]);
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
        source: "auto-initialize",
        values: [{ kind: "text", value: "Device B" }],
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
      anchor: end,
    });
    const afterField = frontierOf(facts.values);
    appendRemote(facts, "dddddddddddddddddddddddddd", afterField, [
      {
        kind: "schema-field-remove",
        schemaId: "project-schema",
        fieldDefinitionId: "owner-field",
      },
    ]);
    appendRemote(facts, "eeeeeeeeeeeeeeeeeeeeeeeeee", beforeField, [
      {
        kind: "schema-field-add",
        schemaId: "project-schema",
        fieldDefinitionId: "owner-field",
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
      anchor: end,
    });
    facts.add({
      kind: "schema-field-add",
      schemaId: "child",
      fieldDefinitionId: "child-field",
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
      anchor: end,
    });
    facts.add({
      kind: "schema-field-add",
      schemaId: "schema-b",
      fieldDefinitionId: "field-b",
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
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    });
    for (const nodeId of ["status-on-task", "todo-value", "project-reference"]) {
      facts.add({ kind: "node-create", nodeId });
    }
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "status-on-task-occurrence",
      nodeId: "status-on-task",
      parentOccurrenceId: "task-occurrence",
      parentPolicy: "cascade",
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
      parentOccurrenceId: "status-on-task-occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "project-reference-occurrence",
      nodeId: "project-reference",
      parentOccurrenceId: "status-on-task-occurrence",
      parentPolicy: "cascade",
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
      parentOccurrenceId: null,
      parentPolicy: "cascade",
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
      parentOccurrenceId: "task-occurrence",
      parentPolicy: "cascade",
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
      parentOccurrenceId: `${prefix}-field-occurrence`,
      parentPolicy: "cascade",
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

function appendRemote(
  facts: Facts,
  replicaId: string,
  baseFrontier: FactFrontier,
  mutations: readonly Mutation[],
): void {
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
    facts.add({ kind: "node-create", nodeId });
  }
  facts.add({
    kind: "schema-field-add",
    schemaId: "project-schema",
    fieldDefinitionId: "status-field",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "work-schema",
    fieldDefinitionId: "status-field",
    anchor: end,
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "work-schema",
    fieldDefinitionId: "owner-field",
    anchor: end,
  });
  return facts;
}
