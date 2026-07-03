import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { DomainChangeKind, DomainChangeReason, FieldPresence } from "@lode/protocol/proto";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { createTestWorkspace, withDefaultWorkspace, type TestRpc } from "../helpers/workspace.js";
import { openAuthedSession } from "./authed-session.js";

describe("schema reconcile", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    client = new AppServerClient({ url: server.address });
    client.connect();
    await hello(client);
    await createTestWorkspace(client);
    rpc = withDefaultWorkspace(client);
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("cleans stale managed children after schema child removal", async () => {
    const target = await createNode();
    const template = await createNode();
    const schema = await createSchema("Schema child removal");
    const fieldDef = await createFieldDef("Removed child");

    const schemaFieldChild = await createRef(fieldDef.nodeId, schema.occurrenceId);
    const schemaTemplateChild = await createRef(template.nodeId, schema.occurrenceId);
    const applied = await applySchema(target.occurrenceId, schema.nodeId);
    const fieldSlotOccurrenceId = applied.changes.find(
      (change) =>
        change.kind === DomainChangeKind.FIELD_SLOT && change.reason === DomainChangeReason.CREATED,
    )?.occurrenceId;
    const templateRef = (await childrenOf(target.occurrenceId)).find(
      (child) => child.nodeId === template.nodeId,
    );
    expect(fieldSlotOccurrenceId).toBeDefined();
    expect(templateRef).toBeDefined();

    await rpc.removeNodeOccurrence({
      occurrenceId: schemaFieldChild.occurrenceId,
    });
    await rpc.removeNodeOccurrence({
      occurrenceId: schemaTemplateChild.occurrenceId,
    });
    const reconciled = await rpc.reconcileSchema({
      targetOccurrenceId: target.occurrenceId,
    });

    expect(reconciled.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: DomainChangeKind.FIELD_SLOT,
          reason: DomainChangeReason.DELETED,
          occurrenceId: fieldSlotOccurrenceId,
        }),
        expect.objectContaining({
          kind: DomainChangeKind.TEMPLATE_REF,
          reason: DomainChangeReason.KEPT,
          occurrenceId: templateRef!.occurrenceId,
        }),
      ]),
    );
    await expect(getNode(fieldSlotOccurrenceId!)).resolves.toBeNull();
    await expect(getNode(templateRef!.occurrenceId)).resolves.not.toBeNull();
  });

  it("reuses provenance-bearing template refs on reapply", async () => {
    const target = await createNode();
    const template = await createNode();
    const schema = await createSchema("Template reuse");

    await createRef(template.nodeId, schema.occurrenceId);
    await applySchema(target.occurrenceId, schema.nodeId);
    const managedTemplate = (await childrenOf(target.occurrenceId)).find(
      (child) => child.nodeId === template.nodeId,
    );
    expect(managedTemplate).toBeDefined();

    await rpc.removeSchema({
      targetOccurrenceId: target.occurrenceId,
      schemaNodeId: schema.nodeId,
    });
    await createRef(template.nodeId, target.occurrenceId);
    await applySchema(target.occurrenceId, schema.nodeId);

    const children = await childrenOf(target.occurrenceId);
    const firstChild = requireValue(children[0], "Expected first reconciled child");
    expect(firstChild.nodeId).toBe(template.nodeId);
    expect(firstChild.occurrenceId).toBe(managedTemplate!.occurrenceId);
  });

  it("trims shared schema provenance when a field becomes optional", async () => {
    const target = await createNode();
    const schemaA = await createSchema("Shared A");
    const schemaB = await createSchema("Shared B");
    const fieldDef = await createFieldDef("Shared field");

    await createRef(fieldDef.nodeId, schemaA.occurrenceId);
    await createRef(fieldDef.nodeId, schemaB.occurrenceId);
    const appliedA = await applySchema(target.occurrenceId, schemaA.nodeId);
    const appliedB = await applySchema(target.occurrenceId, schemaB.nodeId);
    const fieldSlotOccurrenceIds = [...appliedA.changes, ...appliedB.changes]
      .filter((change) => change.kind === DomainChangeKind.FIELD_SLOT)
      .map((change) => change.occurrenceId);
    expect(fieldSlotOccurrenceIds.length).toBeGreaterThan(0);

    await rpc.setFieldDefPresence({
      fieldDefNodeId: fieldDef.nodeId,
      presence: FieldPresence.OPTIONAL_PRESENCE,
    });
    await rpc.removeSchema({
      targetOccurrenceId: target.occurrenceId,
      schemaNodeId: schemaA.nodeId,
    });
    await rpc.reconcileSchema({
      targetOccurrenceId: target.occurrenceId,
    });

    const remainingOccurrenceIds = (await childrenOf(target.occurrenceId)).map(
      (child) => child.occurrenceId,
    );
    for (const occurrenceId of fieldSlotOccurrenceIds) {
      expect(remainingOccurrenceIds).not.toContain(occurrenceId);
    }
  });

  it("orders managed children before unmanaged children in schema order", async () => {
    const target = await createNode();
    const templateA = await createNode();
    const templateB = await createNode();
    const schema = await createSchema("Ordering");

    await createRef(templateA.nodeId, schema.occurrenceId);
    const schemaChildB = await createRef(templateB.nodeId, schema.occurrenceId);
    await applySchema(target.occurrenceId, schema.nodeId);
    const unmanaged = await createNode({ parentOccurrenceId: target.occurrenceId });

    await rpc.moveNode({
      occurrenceId: schemaChildB.occurrenceId,
      parentOccurrenceId: schema.occurrenceId,
      index: 0,
    });
    await rpc.reconcileSchema({
      targetOccurrenceId: target.occurrenceId,
    });

    expect((await childrenOf(target.occurrenceId)).map((child) => child.nodeId)).toEqual([
      templateB.nodeId,
      templateA.nodeId,
      unmanaged.nodeId,
    ]);
  });

  async function createNode(params: Record<string, unknown> = {}) {
    const init: Record<string, unknown> = { ...params };
    return rpc.createPlainNode(init);
  }

  async function createFieldDef(name: string) {
    const defs = await createNode();
    return rpc.createFieldDef({
      parentOccurrenceId: defs.occurrenceId,
      name,
      presence: FieldPresence.NORMAL,
    });
  }

  async function createSchema(name: string) {
    return rpc.createSchema({ name });
  }

  async function createRef(targetNodeId: string, parentOccurrenceId: string) {
    return rpc.createRef({
      targetNodeId,
      parentOccurrenceId,
    });
  }

  async function applySchema(targetOccurrenceId: string, schemaNodeId: string) {
    return rpc.applySchema({
      targetOccurrenceId,
      schemaNodeId,
    });
  }

  async function childrenOf(occurrenceId: string) {
    const response = await rpc.getNodeChildren({ occurrenceId });
    return response.children;
  }

  async function getNode(occurrenceId: string) {
    const response = await rpc.getNode({ occurrenceId });
    return response.occurrence ?? null;
  }
});

async function hello(client: AppServerClient, _actorId = "test-actor"): Promise<void> {
  await openAuthedSession(client, { client: { name: "vitest" } });
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
