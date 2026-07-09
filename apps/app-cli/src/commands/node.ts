import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  buildNodeNameResolver,
  describeNullableId,
  formatNodeBlock,
  getOptionalIndex,
  getOptionalSingleFlag,
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
    case "list":
      return executeNodeList(client, command, commandKey);
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
    case "paste":
      return executeNodePaste(client, command, commandKey);
    case "duplicate":
      return executeNodeDuplicate(client, command, commandKey);
    case "indent":
      return executeNodeIndent(client, command, commandKey);
    case "outdent":
      return executeNodeOutdent(client, command, commandKey);
    case "move-up":
      return executeNodeMoveSibling(client, command, commandKey, true);
    case "move-down":
      return executeNodeMoveSibling(client, command, commandKey, false);
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}

async function executeNodeCreate(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--parent-occ", "--index", "--text"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  // Single-root tree: every node has a parent. The owner's createWorkspace seeds the root; thereafter
  // all creation attaches under it (or its descendants) — `--parent-occ` is required.
  const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
  const index = getOptionalIndex(command);
  const text = getOptionalSingleFlag(command, "--text");
  const created = await client.createPlainNode({
    workspaceId,
    parentOccurrenceId,
    ...(index === undefined ? {} : { index }),
  });

  if (text !== undefined) {
    await client.replaceNodeText({
      workspaceId,
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
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const node = (await client.getNode({ workspaceId, occurrenceId })).occurrence;
  if (!node) {
    return `Node occurrence ${occurrenceId} not found.`;
  }
  const resolveNodeName = await buildNodeNameResolver(client, workspaceId, [node]);
  return ["node", formatNodeBlock(node, resolveNodeName)].join("\n");
}

async function executeNodeChildren(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const children = (await client.getNodeChildren({ workspaceId, occurrenceId })).children;
  if (children.length === 0) {
    return `No children under occurrence ${occurrenceId}.`;
  }
  const resolveNodeName = await buildNodeNameResolver(client, workspaceId, children);
  return [
    `children parent=${occurrenceId} count=${children.length}`,
    ...children.map((child) => formatNodeBlock(child, resolveNodeName)),
  ].join("\n");
}

async function executeNodeList(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const roots = (await client.listRoots({ workspaceId })).roots;
  if (roots.length === 0) {
    // A fresh joiner before the owner's root converges via sync, or a workspace with no root yet.
    return `No root in workspace ${workspaceId} yet.`;
  }
  const lines: string[] = [`roots count=${roots.length}`];
  for (const root of roots) {
    const resolveRootName = await buildNodeNameResolver(client, workspaceId, [root]);
    lines.push(formatNodeBlock(root, resolveRootName));
    // Under single-root the top-level notes are the root's direct children — show them inline so a
    // member can see synced content (and the owner can browse) without a second command.
    const children = (
      await client.getNodeChildren({ workspaceId, occurrenceId: root.occurrenceId })
    ).children;
    if (children.length > 0) {
      const resolveChildName = await buildNodeNameResolver(client, workspaceId, children);
      lines.push(
        `children parent=${root.occurrenceId} count=${children.length}`,
        ...children.map((child) => formatNodeBlock(child, resolveChildName)),
      );
    }
  }
  return lines.join("\n");
}

async function executeNodeMove(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ", "--parent-occ", "--index"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
  const index = getOptionalIndex(command);
  await client.moveNode({
    workspaceId,
    occurrenceId,
    parentOccurrenceId,
    ...(index === undefined ? {} : { index }),
  });
  return `Moved occurrence ${occurrenceId} to parent ${describeNullableId(parentOccurrenceId)}.`;
}

async function executeNodeRemoveOccurrence(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  await client.removeNodeOccurrence({ workspaceId, occurrenceId });
  return `Removed occurrence ${occurrenceId}.`;
}

async function executeNodeHardDelete(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--node"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const nodeId = getRequiredSingleFlag(command, "--node");
  await client.hardDeleteNode({ workspaceId, nodeId });
  return `Hard-deleted node ${nodeId}.`;
}

async function executeNodeReplaceText(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ", "--text"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const text = getRequiredSingleFlag(command, "--text");
  await client.replaceNodeText({
    workspaceId,
    occurrenceId,
    deltas: [{ insert: text }],
  });
  return `Replaced text for occurrence ${occurrenceId}.`;
}

async function executeNodePaste(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ", "--target-occ", "--index"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const sourceOccurrenceIds = command.flags["--occ"] ?? [];
  if (sourceOccurrenceIds.length === 0) {
    throw new Error('Missing source occurrences. Provide at least one "--occ".');
  }
  const targetParentOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const index = getOptionalIndex(command);
  const result = await client.pasteNodes({
    workspaceId,
    sourceOccurrenceIds,
    targetParentOccurrenceId,
    ...(index === undefined ? {} : { index }),
  });
  return `Pasted ${sourceOccurrenceIds.length} occurrence(s) under ${targetParentOccurrenceId}; new: ${result.occurrences.map((o) => o.occurrenceId).join(", ")}.`;
}

async function executeNodeDuplicate(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  const clone = await client.duplicateNode({ workspaceId, occurrenceId });
  return `Duplicated occurrence ${occurrenceId} → ${clone.occurrenceId}.`;
}

async function executeNodeIndent(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceIds = command.flags["--occ"] ?? [];
  if (occurrenceIds.length === 0) {
    throw new Error('Missing occurrences. Provide at least one "--occ".');
  }
  await client.indentNodes({ workspaceId, occurrenceIds });
  return `Indented ${occurrenceIds.length} occurrence(s).`;
}

async function executeNodeOutdent(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  await client.outdentNode({ workspaceId, occurrenceId });
  return `Outdented occurrence ${occurrenceId}.`;
}

async function executeNodeMoveSibling(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
  up: boolean,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const occurrenceId = getRequiredSingleFlag(command, "--occ");
  await client.moveSiblingNode({ workspaceId, occurrenceId, up });
  return `Moved occurrence ${occurrenceId} ${up ? "up" : "down"}.`;
}
