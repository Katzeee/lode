/* eslint-disable max-lines -- cohesive schema/field integration coverage */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AppServerClient } from "@lode/client";
import {
  DomainChangeKind,
  DomainChangeReason,
  FieldPresence,
  FieldType,
  FieldValueInputSchema,
  type FieldValueInput,
} from "@lode/protocol/proto";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { tempListenUrl } from "@lode/test-utils";
import {
  createTestWorkspaceAndDoc,
  withDefaultWorkspace,
  type TestRpc,
} from "../helpers/workspace.js";

describe("schema and field services", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: tempListenUrl() });
    client = new AppServerClient({ url: server.address });
    client.connect();
    await hello(client);
    await createTestWorkspaceAndDoc(client);
    rpc = withDefaultWorkspace(client);
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("manages field definitions, slots, and value children", async () => {
    const target = await createNode();
    const holder = await createNode();
    const movedValue = await createNode({ parentOccurrenceId: holder.occurrenceId });
    const refTarget = await createNode();
    const fieldDef = await createFieldDef("Mixed");

    const first = await rpc.addField({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
      fieldDefNodeId: fieldDef.nodeId,
    });
    const second = await rpc.addField({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
      fieldDefNodeId: fieldDef.nodeId,
    });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ occurrenceId: first.occurrenceId, created: false });

    await rpc.setFieldValues({
      docId: "main",
      fieldOccurrenceId: first.occurrenceId,
      values: [
        fieldValue("text", { text: "alpha" }),
        fieldValue("ref", { targetNodeId: refTarget.nodeId }),
        fieldValue("move", { occurrenceId: movedValue.occurrenceId }),
      ],
    });
    let values = await childrenOf(first.occurrenceId);
    expect(values).toHaveLength(3);
    const originalOrder = values.map((value) => value.occurrenceId);
    const firstValue = requireValue(values[0], "Expected first field value");
    expect(values.map((value) => value.nodeId)).toEqual([
      firstValue.nodeId,
      refTarget.nodeId,
      movedValue.nodeId,
    ]);
    expect(firstValue.deltas).toMatchObject([{ insert: "alpha" }]);

    const reordered = await rpc.setFieldValues({
      docId: "main",
      fieldOccurrenceId: first.occurrenceId,
      values: [
        fieldValue("move", {
          occurrenceId: requireValue(originalOrder[2], "Expected third value"),
        }),
        fieldValue("move", {
          occurrenceId: requireValue(originalOrder[0], "Expected first value"),
        }),
        fieldValue("move", {
          occurrenceId: requireValue(originalOrder[1], "Expected second value"),
        }),
      ],
    });
    expect(reordered.changes.some((change) => change.reason === DomainChangeReason.DELETED)).toBe(
      false,
    );
    values = await childrenOf(first.occurrenceId);
    expect(values.map((value) => value.occurrenceId)).toEqual([
      originalOrder[2],
      originalOrder[0],
      originalOrder[1],
    ]);

    const replaced = await rpc.setFieldValues({
      docId: "main",
      fieldOccurrenceId: first.occurrenceId,
      values: [fieldValue("text", { text: "replacement" })],
    });
    expect(
      replaced.changes.filter((change) => change.reason === DomainChangeReason.DELETED),
    ).toHaveLength(3);
    values = await childrenOf(first.occurrenceId);
    expect(values).toHaveLength(1);
    expect(requireValue(values[0], "Expected replacement field value").deltas).toMatchObject([
      { insert: "replacement" },
    ]);
  });

  it("does not reuse plain children as field slots", async () => {
    const target = await createNode();
    const fieldDef = await createFieldDef("Owner");
    const decoy = await createNode({
      parentOccurrenceId: target.occurrenceId,
      props: { fieldDefId: fieldDef.nodeId },
    });

    const added = await rpc.addField({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
      fieldDefNodeId: fieldDef.nodeId,
    });

    expect(added.created).toBe(true);
    expect(added.occurrenceId).not.toBe(decoy.occurrenceId);
  });

  it("applies schema children as managed fields and template refs idempotently", async () => {
    const target = await createNode();
    const template = await createNode();
    const schema = await createSchema("Task");
    const fieldDef = await createFieldDef("Status", FieldPresence.NORMAL);

    await createRef(fieldDef.nodeId, schema.occurrenceId);
    await createRef(template.nodeId, schema.occurrenceId);

    await applySchema(target.occurrenceId, schema.nodeId);
    await applySchema(target.occurrenceId, schema.nodeId);

    const children = await childrenOf(target.occurrenceId);
    expect(children).toHaveLength(2);
    expect(requireValue(children[1], "Expected template child").nodeId).toBe(template.nodeId);
  });

  it("rejects schema creation with an invalid parent occurrence", async () => {
    await expect(
      rpc.createSchema({
        docId: "main",
        name: "Invalid parent",
        parentOccurrenceId: "missing-occurrence-id",
      }),
    ).rejects.toThrow("Occurrence not found");
  });

  it("cleans inactive empty managed fields while preserving authored content", async () => {
    const target = await createNode();
    const template = await createNode();
    const schema = await createSchema("Cleanup");
    const requiredFieldDef = await createFieldDef("Required", FieldPresence.NORMAL);
    const optionalFieldDef = await createFieldDef("Optional", FieldPresence.OPTIONAL_PRESENCE);

    await createRef(requiredFieldDef.nodeId, schema.occurrenceId);
    await createRef(optionalFieldDef.nodeId, schema.occurrenceId);
    await createRef(template.nodeId, schema.occurrenceId);

    const applied = await applySchema(target.occurrenceId, schema.nodeId);
    let children = await childrenOf(target.occurrenceId);
    expect(children).toHaveLength(2);
    expect(children.some((child) => child.nodeId === template.nodeId)).toBe(true);

    const fieldSlotOccurrenceId = applied.changes.find(
      (change) =>
        change.kind === DomainChangeKind.FIELD_SLOT && change.reason === DomainChangeReason.CREATED,
    )?.occurrenceId;
    expect(fieldSlotOccurrenceId).toBeDefined();
    await rpc.setFieldValues({
      docId: "main",
      fieldOccurrenceId: fieldSlotOccurrenceId!,
      values: [fieldValue("text", { text: "keep me" })],
    });

    await rpc.removeSchema({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
      schemaNodeId: schema.nodeId,
    });
    children = await childrenOf(target.occurrenceId);
    expect(children.some((child) => child.occurrenceId === fieldSlotOccurrenceId)).toBe(true);
    expect(children.some((child) => child.nodeId === template.nodeId)).toBe(true);

    await rpc.setFieldDefPresence({
      docId: "main",
      fieldDefNodeId: requiredFieldDef.nodeId,
      presence: FieldPresence.OPTIONAL_PRESENCE,
    });
    await rpc.reconcileSchema({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
    });
    children = await childrenOf(target.occurrenceId);
    expect(children.some((child) => child.nodeId === optionalFieldDef.nodeId)).toBe(false);
  });

  it("protects active managed children from direct mutation and hard delete", async () => {
    const target = await createNode();
    const otherParent = await createNode();
    const template = await createNode();
    const schema = await createSchema("Guard");
    const fieldDef = await createFieldDef("Managed", FieldPresence.NORMAL);
    const writableFieldDef = await createFieldDef("Writable", FieldPresence.NORMAL);

    await createRef(fieldDef.nodeId, schema.occurrenceId);
    await createRef(template.nodeId, schema.occurrenceId);
    const applied = await applySchema(target.occurrenceId, schema.nodeId);
    const managedResponse = await rpc.getNode({
      docId: "main",
      occurrenceId: applied.changes.find((change) => change.kind === DomainChangeKind.FIELD_SLOT)!
        .occurrenceId,
    });
    expect(managedResponse.occurrence).toBeDefined();
    const managedNode = managedResponse.occurrence!;

    await expect(
      rpc.moveNode({
        docId: "main",
        occurrenceId: managedNode.occurrenceId,
        parentOccurrenceId: otherParent.occurrenceId,
      }),
    ).rejects.toThrow("active_managed_child");
    await expect(
      rpc.removeNodeOccurrence({
        docId: "main",
        occurrenceId: managedNode.occurrenceId,
      }),
    ).rejects.toThrow("active_managed_child");
    await expect(
      rpc.removeField({
        docId: "main",
        fieldOccurrenceId: managedNode.occurrenceId,
      }),
    ).rejects.toThrow("active_managed_child");

    const writableField = await rpc.addField({
      docId: "main",
      targetOccurrenceId: target.occurrenceId,
      fieldDefNodeId: writableFieldDef.nodeId,
    });
    await expect(
      rpc.setFieldValues({
        docId: "main",
        fieldOccurrenceId: writableField.occurrenceId,
        values: [fieldValue("move", { occurrenceId: managedNode.occurrenceId })],
      }),
    ).rejects.toThrow("active_managed_child");

    await expect(rpc.hardDeleteNode({ docId: "main", nodeId: schema.nodeId })).rejects.toThrow(
      "protected_node_hard_delete",
    );
    await expect(rpc.hardDeleteNode({ docId: "main", nodeId: fieldDef.nodeId })).rejects.toThrow(
      "protected_node_hard_delete",
    );
    await expect(rpc.hardDeleteNode({ docId: "main", nodeId: managedNode.nodeId })).rejects.toThrow(
      "protected_node_hard_delete",
    );
    await expect(rpc.hardDeleteNode({ docId: "main", nodeId: template.nodeId })).rejects.toThrow(
      "protected_node_hard_delete",
    );
  });

  async function createNode(params: Record<string, unknown> = {}) {
    const init: Record<string, unknown> = { docId: "main", ...params };
    return rpc.createPlainNode(init);
  }

  async function createFieldDef(name: string, presence: FieldPresence = FieldPresence.NORMAL) {
    const defs = await createNode();
    return rpc.createFieldDef({
      docId: "main",
      parentOccurrenceId: defs.occurrenceId,
      name,
      presence,
      fieldType: FieldType.PLAIN,
    });
  }

  async function createSchema(name: string) {
    return rpc.createSchema({ docId: "main", name });
  }

  async function createRef(targetNodeId: string, parentOccurrenceId: string) {
    return rpc.createRef({
      docId: "main",
      targetNodeId,
      parentOccurrenceId,
    });
  }

  async function applySchema(targetOccurrenceId: string, schemaNodeId: string) {
    return rpc.applySchema({
      docId: "main",
      targetOccurrenceId,
      schemaNodeId,
    });
  }

  async function childrenOf(occurrenceId: string) {
    const response = await rpc.getNodeChildren({ docId: "main", occurrenceId });
    return response.children;
  }
});

async function hello(client: AppServerClient, actorId = "test-actor"): Promise<void> {
  await client.rpc.sessionHello({
    actor: { actorId },
    client: { name: "vitest" },
  });
}

function fieldValue(variant: "text", value: { text: string }): FieldValueInput;
function fieldValue(variant: "ref", value: { targetNodeId: string }): FieldValueInput;
function fieldValue(variant: "move", value: { occurrenceId: string }): FieldValueInput;
function fieldValue(
  variant: "text" | "ref" | "move",
  value: Record<string, unknown>,
): FieldValueInput {
  return create(FieldValueInputSchema, {
    value: { case: variant, value },
  });
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
