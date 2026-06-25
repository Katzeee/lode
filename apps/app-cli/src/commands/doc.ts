import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getOptionalSingleFlag, getRequiredSingleFlag } from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeDocCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--doc"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const requestedDocId = getOptionalSingleFlag(command, "--doc");
      const createdDocId = (
        await client.createWorkspaceDoc(
          requestedDocId ? { workspaceId, docId: requestedDocId } : { workspaceId },
        )
      ).value;
      return `Created doc ${createdDocId}.`;
    }

    case "list": {
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docs = (await client.listWorkspaceDocs({ workspaceId })).docIds;
      if (docs.length === 0) {
        return "No docs found.";
      }
      return `Docs (${docs.length}): ${docs.join(", ")}`;
    }

    case "remove": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--doc"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const removed = (await client.removeWorkspaceDoc({ workspaceId, docId })).value;
      return `Removed doc ${docId}: ${removed ? "yes" : "no"}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
