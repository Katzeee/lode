import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  buildNodeNameResolver,
  describeNullableId,
  formatNodeBlock,
  getOptionalIndex,
  getOptionalNullableFlag,
  getOptionalSingleFlag,
  getRequiredNullableFlag,
  getRequiredSingleFlag,
} from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeNodeCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create":
      return executeNodeCreate(client, command, commandKey);
    case "get":
      return executeNodeGet(client, command, commandKey);
    case "children":
      return executeNodeChildren(client, command, commandKey);
    case "move":
      return executeNodeMove(client, command, commandKey);
    case "remove-occurrence":
      return executeNodeRemoveOccurrence(client, command, commandKey);
    case "hard-delete":
      return executeNodeHardDelete(client, command, commandKey);
    case "replace-text":
      return executeNodeReplaceText(client, command, commandKey);
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}

async function executeNodeCreate(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, [
    "--workspace",
    "--doc",
    "--parent-occ",
    "--index",
    "--text",
  ]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const parentOccurrenceId = getOptionalNullableFlag(command, "--parent-occ");
  const index = getOptionalIndex(command);
  const text = getOptionalSingleFlag(command, "--text");
  const created = await client.createPlainNode({
    workspaceId,
    docId,
    ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
    ...(index === undefined ? {} : { index }),
  });

  if (text !== undefined) {
    await client.replaceNodeText({
      workspaceId,
      docId,
      occurrenceId: created.occurrenceId,
      deltas: [{ insert: text }],
    });
    return `Created node ${created.nodeId} at occurrence ${created.occurrenceId} with initial text.`;
  }

  return `Created node ${created.nodeId} at occurrence ${created.occurrenceId}.`;
}

async function executeNodeGet(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const node = (await client.getNode({ workspaceId, docId, occurrenceId })).occurrence;
  if (!node) {
    return `Node occurrence ${occurrenceId} not found in doc ${docId}.`;
  }
  const resolveNodeName = await buildNodeNameResolver(client, workspaceId, docId, [node]);
  return ["node", formatNodeBlock(node, resolveNodeName)].join("\n");
}

async function executeNodeChildren(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const children = (await client.getNodeChildren({ workspaceId, docId, occurrenceId })).children;
  if (children.length === 0) {
    return `No children under occurrence ${occurrenceId}.`;
  }
  const resolveNodeName = await buildNodeNameResolver(client, workspaceId, docId, children);
  return [
    `children parent=${occurrenceId} count=${children.length}`,
    ...children.map((child) => formatNodeBlock(child, resolveNodeName)),
  ].join("\n");
}

async function executeNodeMove(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, [
    "--workspace",
    "--doc",
    "--occ",
    "--parent-occ",
    "--index",
  ]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const parentOccurrenceId = getRequiredNullableFlag(command, "--parent-occ");
  const index = getOptionalIndex(command);
  await client.moveNode({
    workspaceId,
    docId,
    occurrenceId,
    ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
    ...(index === undefined ? {} : { index }),
  });
  return `Moved occurrence ${occurrenceId} to parent ${describeNullableId(parentOccurrenceId)}.`;
}

async function executeNodeRemoveOccurrence(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  await client.removeNodeOccurrence({ workspaceId, docId, occurrenceId });
  return `Removed occurrence ${occurrenceId}.`;
}

async function executeNodeHardDelete(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--node"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const nodeId = getRequiredSingleFlag(command, "--node");
  await client.hardDeleteNode({ workspaceId, docId, nodeId });
  return `Hard-deleted node ${nodeId}.`;
}

async function executeNodeReplaceText(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--occ", "--text"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const text = getRequiredSingleFlag(command, "--text");
  await client.replaceNodeText({
    workspaceId,
    docId,
    occurrenceId,
    deltas: [{ insert: text }],
  });
  return `Replaced text for occurrence ${occurrenceId}.`;
}
