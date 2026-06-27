import { expect } from "vitest";
import { AppServerClient } from "@lode/client";
import { parseCli } from "../../src/args.js";
import { executeCommand } from "../../src/commands.js";
import { establishCliSession } from "../../src/session.js";

export type NodeRef = {
  nodeId: string;
  occurrenceId: string;
};

export type BeCliHarness = {
  be: (...args: string[]) => Promise<string>;
  createNode: (text: string, parentOccurrenceId?: string) => Promise<NodeRef>;
  createSchema: (name: string, parentOccurrenceId: string) => Promise<NodeRef>;
  createFieldDef: (
    name: string,
    parentOccurrenceId: string,
    ...extraFlags: string[]
  ) => Promise<{ nodeId: string }>;
  applySchema: (targetOccurrenceId: string, schemaNodeId: string) => Promise<void>;
  setTextField: (
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    text: string,
  ) => Promise<{ occurrenceId: string }>;
  setRefField: (
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    targetNodeId: string,
  ) => Promise<{ occurrenceId: string }>;
};

export const ANIME_WORKSPACE_ID = "ws_anime";

export function createBeCliHarness(url: () => string): BeCliHarness {
  const be = async (...args: string[]): Promise<string> => {
    const parsed = parseCli(["--url", url(), "--actor", "alice", ...args]);
    const client = new AppServerClient({ url: parsed.url });
    client.connect();
    try {
      await establishCliSession(client.rpc, { actorId: parsed.actorId });
      return await executeCommand(client.rpc, parsed);
    } finally {
      client.close();
    }
  };

  const createNode = async (text: string, parentOccurrenceId?: string): Promise<NodeRef> => {
    const args = ["node", "create", "--workspace", ANIME_WORKSPACE_ID, "--text", text];
    if (parentOccurrenceId !== undefined) {
      args.push("--parent-occ", parentOccurrenceId);
    }
    return parseNodeCreated(await be(...args));
  };

  const createSchema = async (name: string, parentOccurrenceId: string): Promise<NodeRef> =>
    parseSchemaCreated(
      await be(
        "schema",
        "create",
        "--workspace",
        ANIME_WORKSPACE_ID,

        "--name",
        name,
        "--parent-occ",
        parentOccurrenceId,
      ),
    );

  const createFieldDef = async (
    name: string,
    parentOccurrenceId: string,
    ...extraFlags: string[]
  ): Promise<{ nodeId: string }> =>
    parseFieldDefCreated(
      await be(
        "field-def",
        "create",
        "--workspace",
        ANIME_WORKSPACE_ID,

        "--parent-occ",
        parentOccurrenceId,
        "--name",
        name,
        ...extraFlags,
      ),
    );

  const applySchema = async (targetOccurrenceId: string, schemaNodeId: string): Promise<void> => {
    await be(
      "schema",
      "apply",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--target-occ",
      targetOccurrenceId,
      "--schema-node",
      schemaNodeId,
    );
  };

  const addField = async (
    targetOccurrenceId: string,
    fieldDefNodeId: string,
  ): Promise<{ occurrenceId: string }> =>
    parseFieldAdded(
      await be(
        "field",
        "add",
        "--workspace",
        ANIME_WORKSPACE_ID,

        "--target-occ",
        targetOccurrenceId,
        "--field-def-node",
        fieldDefNodeId,
      ),
    );

  const setTextField = async (
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    text: string,
  ): Promise<{ occurrenceId: string }> => {
    const field = await addField(targetOccurrenceId, fieldDefNodeId);
    await be(
      "field",
      "set-values",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--field-occ",
      field.occurrenceId,
      "--text",
      text,
    );
    return field;
  };

  const setRefField = async (
    targetOccurrenceId: string,
    fieldDefNodeId: string,
    targetNodeId: string,
  ): Promise<{ occurrenceId: string }> => {
    const field = await addField(targetOccurrenceId, fieldDefNodeId);
    await be(
      "field",
      "set-values",
      "--workspace",
      ANIME_WORKSPACE_ID,

      "--field-occ",
      field.occurrenceId,
      "--ref-node",
      targetNodeId,
    );
    return field;
  };

  return {
    be,
    createNode,
    createSchema,
    createFieldDef,
    applySchema,
    setTextField,
    setRefField,
  };
}

export function parseNodeCreated(output: string): NodeRef {
  const match = /^Created node (?<nodeId>\S+) at occurrence (?<occurrenceId>\S+)/.exec(output);
  const groups = requireGroups(match);
  return {
    nodeId: requireGroup(groups, "nodeId"),
    occurrenceId: requireGroup(groups, "occurrenceId"),
  };
}

export function parseSchemaCreated(output: string): NodeRef {
  const match =
    /^Created schema ".+" as node (?<nodeId>\S+) \(occurrence (?<occurrenceId>\S+)\)\./.exec(
      output,
    );
  const groups = requireGroups(match);
  return {
    nodeId: requireGroup(groups, "nodeId"),
    occurrenceId: requireGroup(groups, "occurrenceId"),
  };
}

export function parseFieldDefCreated(output: string): { nodeId: string } {
  const match = /^Created field definition .+ as node (?<nodeId>\S+)\.$/.exec(output);
  return { nodeId: requireGroup(requireGroups(match), "nodeId") };
}

export function parseFieldAdded(output: string): { occurrenceId: string } {
  const match = /^field add status=(created|reused)\n(?<occurrenceId>\S+) {2}field/m.exec(output);
  return { occurrenceId: requireGroup(requireGroups(match), "occurrenceId") };
}

function requireGroups(match: RegExpExecArray | null): Record<string, string | undefined> {
  expect(match?.groups).toBeDefined();
  return match!.groups!;
}

function requireGroup(groups: Record<string, string | undefined>, key: string): string {
  const value = groups[key];
  expect(value).toBeDefined();
  return value!;
}
