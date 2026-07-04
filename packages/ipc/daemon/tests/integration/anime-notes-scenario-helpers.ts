import { expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { AppServerClient } from "@lode/client";
import { FieldValueInputSchema } from "@lode/protocol/proto";
import type {
  FieldPresence,
  FieldType,
  FieldValueInput,
  NodeOccurrenceWire,
} from "@lode/protocol/proto";
import type { TestRpc } from "../helpers/workspace.js";
import { openAuthedSession } from "./authed-session.js";

export async function hello(client: AppServerClient, _actorId = "test-actor"): Promise<void> {
  await openAuthedSession(client, { client: { name: "vitest" } });
}

export function createAnimeNotesScenarioHelpers(rpc: TestRpc) {
  // createWorkspace seeds the workspace's single root; a createTextNode with no parent attaches
  // under it (single-root product policy enforced in services/node.ts).
  let seededRootOccurrenceId: string | undefined;

  async function createTextNode(text: string, parentOccurrenceId?: string) {
    let resolvedParent = parentOccurrenceId;
    if (!resolvedParent) {
      if (seededRootOccurrenceId === undefined) {
        const roots = await rpc.listRoots({});
        seededRootOccurrenceId = roots.roots[0]?.occurrenceId;
      }
      resolvedParent = seededRootOccurrenceId;
    }
    const node = await rpc.createPlainNode({
      parentOccurrenceId: resolvedParent,
    });
    await rpc.replaceNodeText({
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: text }],
    });
    return getNode(node.occurrenceId);
  }

  async function createSchema(name: string, parentOccurrenceId: string) {
    return rpc.createSchema({
      name,
      parentOccurrenceId,
    });
  }

  async function createFieldDef(
    parentOccurrenceId: string,
    name: string,
    options: { fieldType?: FieldType; presence?: FieldPresence } = {},
  ) {
    return rpc.createFieldDef({
      parentOccurrenceId,
      name,
      ...(options.fieldType ? { fieldType: options.fieldType } : {}),
      ...(options.presence ? { presence: options.presence } : {}),
    });
  }

  async function applySchema(targetOccurrenceId: string, schemaNodeId: string) {
    return rpc.applySchema({
      targetOccurrenceId,
      schemaNodeId,
    });
  }

  async function setSingleTextValue(
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    text: string,
  ) {
    return setFieldValues(targetOccurrenceId, fieldDefNodeId, [textValue(text)]);
  }

  async function setSingleRefValue(
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    targetNodeId: string,
  ) {
    return setFieldValues(targetOccurrenceId, fieldDefNodeId, [refValue(targetNodeId)]);
  }

  async function setFieldValues(
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    values: FieldValueInput[],
  ) {
    const field = await rpc.addField({
      targetOccurrenceId,
      fieldDefNodeId,
    });
    await rpc.setFieldValues({
      fieldOccurrenceId: field.occurrenceId,
      values,
    });
    return field;
  }

  async function readSingleTextValue(targetOccurrenceId: string, fieldDefNodeId: string) {
    const values = await valuesForField(targetOccurrenceId, fieldDefNodeId);
    expect(values).toHaveLength(1);
    const value = requireValue(values[0], "Expected one text field value");
    return value.deltas.map((delta) => delta.insert).join("");
  }

  async function readSingleRefValue(targetOccurrenceId: string, fieldDefNodeId: string) {
    const values = await valuesForField(targetOccurrenceId, fieldDefNodeId);
    expect(values).toHaveLength(1);
    const value = requireValue(values[0], "Expected one ref field value");
    return value.nodeId;
  }

  async function valuesForField(targetOccurrenceId: string, fieldDefNodeId: string) {
    const field = await findField(targetOccurrenceId, fieldDefNodeId);
    return childrenOf(field.occurrenceId);
  }

  async function findField(
    targetOccurrenceId: string,
    fieldDefNodeId: string,
  ): Promise<NodeOccurrenceWire> {
    const fields = await childrenOf(targetOccurrenceId);
    const field = fields.find((child) => {
      const meta = child.entityMeta as Record<string, unknown> | undefined;
      return meta?.fieldDefId === fieldDefNodeId;
    });
    expect(field).toBeDefined();
    return field!;
  }

  async function childrenOf(occurrenceId: string) {
    const response = await rpc.getNodeChildren({ occurrenceId });
    return response.children;
  }

  async function getNode(occurrenceId: string): Promise<NodeOccurrenceWire> {
    const response = await rpc.getNode({ occurrenceId });
    expect(response.occurrence).toBeDefined();
    return response.occurrence!;
  }

  return {
    applySchema,
    childrenOf,
    createFieldDef,
    createSchema,
    createTextNode,
    getNode,
    readSingleRefValue,
    readSingleTextValue,
    setSingleRefValue,
    setSingleTextValue,
  };
}

function textValue(text: string): FieldValueInput {
  return create(FieldValueInputSchema, {
    value: { case: "text", value: { text } },
  } as unknown as FieldValueInput);
}

function refValue(targetNodeId: string): FieldValueInput {
  return create(FieldValueInputSchema, {
    value: { case: "ref", value: { targetNodeId } },
  } as unknown as FieldValueInput);
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
