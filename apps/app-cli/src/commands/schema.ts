import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  formatChangeResult,
  getRequiredSingleFlag,
  resolveNodeLabel,
} from "./shared.js";
import type { LodeCommandsClient } from "@lode/client";

export async function executeSchemaCommand(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--name", "--parent-occ"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const name = getRequiredSingleFlag(command, "--name");
      const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
      const created = await client.createSchema({
        workspaceId,
        name,
        parentOccurrenceId,
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
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--target-occ", "--schema-node"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const schemaNodeId = getRequiredSingleFlag(command, "--schema-node");
  const result = await client.applySchema({
    workspaceId,
    targetOccurrenceId,
    schemaNodeId,
  });
  const schemaLabel = await resolveNodeLabel(client, workspaceId, schemaNodeId);
  return formatChangeResult(
    `schema apply target=${result.target?.occurrenceId ?? "null"} schema=${schemaLabel}`,
    result.changes,
  );
}

async function executeSchemaRemove(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--target-occ", "--schema-node"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const schemaNodeId = getRequiredSingleFlag(command, "--schema-node");
  const result = await client.removeSchema({
    workspaceId,
    targetOccurrenceId,
    schemaNodeId,
  });
  const schemaLabel = await resolveNodeLabel(client, workspaceId, schemaNodeId);
  return formatChangeResult(
    `schema remove target=${result.target?.occurrenceId ?? "null"} schema=${schemaLabel}`,
    result.changes,
  );
}

async function executeSchemaReconcile(
  client: LodeCommandsClient,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  assertAllowedFlags(command, commandKey, ["--workspace", "--target-occ"]);
  const workspaceId = getRequiredSingleFlag(command, "--workspace");
  const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
  const result = await client.reconcileSchema({ workspaceId, targetOccurrenceId });
  return formatChangeResult(
    `schema reconcile target=${result.target?.occurrenceId ?? "null"}`,
    result.changes,
  );
}
