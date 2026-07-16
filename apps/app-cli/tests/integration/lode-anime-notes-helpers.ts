import { expect } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { dialTarget } from "@lode/daemon/endpoint";
import { generateMnemonic } from "@lode/engine";
import { parseCli } from "../../src/args.js";
import { executeCommand } from "../../src/commands.js";

export type NodeRef = {
  nodeId: string;
  occurrenceId: string;
};

export type BeCliHarness = {
  be: (...args: string[]) => Promise<string>;
  /** Create a workspace (system-generated id) and return its id + the owner-root occurrence. */
  createWorkspace: (name: string) => Promise<{ workspaceId: string; rootOccurrenceId: string }>;
  createNode: (text: string, parentOccurrenceId: string) => Promise<NodeRef>;
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

export function createBeCliHarness(url: () => string): BeCliHarness {
  const mnemonic = generateMnemonic();
  // Set by createWorkspace; subsequent commands target it (a workspace id is the sync channel, so it
  // is system-generated, not user-chosen — captured from the create output).
  let workspaceId = "";

  const be = async (...args: string[]): Promise<string> => {
    const parsed = parseCli(["--url", url(), ...args]);
    const client = new AppServerClient(createSocketTransport(dialTarget(url())));
    client.connect();
    try {
      await client.authenticate({ actorMnemonic: mnemonic });
      return await executeCommand(client.rpc, parsed);
    } finally {
      client.close();
    }
  };

  const createWorkspace = async (
    name: string,
  ): Promise<{ workspaceId: string; rootOccurrenceId: string }> => {
    const out = await be("workspace", "create", "--name", name);
    const match = /^Created workspace .* \((?<id>.+)\)\.$/.exec(out);
    workspaceId = requireGroup(requireGroups(match), "id");
    // createWorkspace seeds the single owner root (named = name); discover its occurrence via `node list`
    // (line 1 is "root"; line 2 begins with "<rootOcc>  <name>").
    const listed = await be("node", "list", "--workspace", workspaceId);
    const rootOccurrenceId = listed.split("\n").at(1)?.split(/\s+/).at(0) ?? "";
    return { workspaceId, rootOccurrenceId };
  };

  const createNode = async (text: string, parentOccurrenceId: string): Promise<NodeRef> =>
    parseNodeCreated(
      await be(
        "node",
        "create",
        "--workspace",
        workspaceId,
        "--text",
        text,
        "--parent-occ",
        parentOccurrenceId,
      ),
    );

  const createSchema = async (name: string, parentOccurrenceId: string): Promise<NodeRef> =>
    parseSchemaCreated(
      await be(
        "schema",
        "create",
        "--workspace",
        workspaceId,
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
        workspaceId,
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
      workspaceId,
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
        workspaceId,
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
      workspaceId,
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
      workspaceId,
      "--field-occ",
      field.occurrenceId,
      "--ref-node",
      targetNodeId,
    );
    return field;
  };

  return {
    be,
    createWorkspace,
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
