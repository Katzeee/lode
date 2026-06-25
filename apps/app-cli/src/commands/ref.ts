import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  getOptionalIndex,
  getOptionalNullableFlag,
  getRequiredSingleFlag,
} from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeRefCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--target-node",
        "--parent-occ",
        "--index",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const targetNodeId = getRequiredSingleFlag(command, "--target-node");
      const parentOccurrenceId = getOptionalNullableFlag(command, "--parent-occ");
      const index = getOptionalIndex(command);
      const created = await client.createRef({
        workspaceId,
        docId,
        targetNodeId,
        ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
        ...(index === undefined ? {} : { index }),
      });
      return `Created ref occurrence ${created.occurrenceId} for node ${targetNodeId}.`;
    }

    case "clone": {
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
      const parentOccurrenceId = getOptionalNullableFlag(command, "--parent-occ");
      const index = getOptionalIndex(command);
      const cloned = await client.cloneRef({
        workspaceId,
        docId,
        occurrenceId,
        ...(parentOccurrenceId ? { parentOccurrenceId } : {}),
        ...(index === undefined ? {} : { index }),
      });
      return `Cloned occurrence ${occurrenceId} into ${cloned.occurrenceId}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
