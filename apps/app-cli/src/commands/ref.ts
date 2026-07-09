import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getOptionalIndex, getRequiredSingleFlag } from "./shared.js";
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
        "--target-node",
        "--parent-occ",
        "--index",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const targetNodeId = getRequiredSingleFlag(command, "--target-node");
      const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
      const index = getOptionalIndex(command);
      const created = await client.createRef({
        workspaceId,
        targetNodeId,
        parentOccurrenceId,
        ...(index === undefined ? {} : { index }),
      });
      return `Created ref occurrence ${created.occurrenceId} for node ${targetNodeId}.`;
    }

    case "clone": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--occ", "--parent-occ", "--index"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const occurrenceId = getRequiredSingleFlag(command, "--occ");
      const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
      const index = getOptionalIndex(command);
      const cloned = await client.cloneRef({
        workspaceId,
        occurrenceId,
        parentOccurrenceId,
        ...(index === undefined ? {} : { index }),
      });
      return `Cloned occurrence ${occurrenceId} into ${cloned.occurrenceId}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
