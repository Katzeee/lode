import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  formatChangeResult,
  getOptionalNullableFlag,
  getRequiredSingleFlag,
  resolveNodeLabel,
} from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeSchemaCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--name", "--parent-occ"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const name = getRequiredSingleFlag(command, "--name");
      const parentOccurrenceId = getOptionalNullableFlag(command, "--parent-occ");
      const created = await client.createSchema({
        workspaceId,
        docId,
        name,
        ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
      });
      return `Created schema "${name}" as node ${created.nodeId} (occurrence ${created.occurrenceId}).`;
    }

    case "apply":
      return executeSchemaApply(client, command, commandKey);
    case "remove":
      return executeSchemaRemove(client, command, commandKey);
    case "reconcile":
      return executeSchemaReconcile(client, command, commandKey);
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}

async function executeSchemaApply(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, [
    "--workspace",
    "--doc",
    "--target-occ",
    "--schema-node",
  ]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const schemaNodeId = getRequiredSingleFlag(command, "--schema-node");
  const result = await client.applySchema({
    workspaceId,
    docId,
    targetOccurrenceId,
    schemaNodeId,
  });
  const schemaLabel = await resolveNodeLabel(client, workspaceId, docId, schemaNodeId);
  return formatChangeResult(
    `schema apply target=${result.target?.occurrenceId ?? "null"} schema=${schemaLabel}`,
    result.changes,
  );
}

async function executeSchemaRemove(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, [
    "--workspace",
    "--doc",
    "--target-occ",
    "--schema-node",
  ]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const schemaNodeId = getRequiredSingleFlag(command, "--schema-node");
  const result = await client.removeSchema({
    workspaceId,
    docId,
    targetOccurrenceId,
    schemaNodeId,
  });
  const schemaLabel = await resolveNodeLabel(client, workspaceId, docId, schemaNodeId);
  return formatChangeResult(
    `schema remove target=${result.target?.occurrenceId ?? "null"} schema=${schemaLabel}`,
    result.changes,
  );
}

async function executeSchemaReconcile(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--target-occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const docId = getRequiredSingleFlag(command, "--doc");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const result = await client.reconcileSchema({ workspaceId, docId, targetOccurrenceId });
  return formatChangeResult(
    `schema reconcile target=${result.target?.occurrenceId ?? "null"}`,
    result.changes,
  );
}
