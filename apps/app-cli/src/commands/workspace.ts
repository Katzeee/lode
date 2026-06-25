import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getOptionalSingleFlag, getRequiredSingleFlag } from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeWorkspaceCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--name"]);
      const workspaceId = getOptionalSingleFlag(command, "--workspace");
      const displayName = getRequiredSingleFlag(command, "--name");
      const workspace = await client.createWorkspace({
        ...(workspaceId ? { workspaceId } : {}),
        displayName,
      });
      return `Created workspace ${workspace.displayName} (${workspace.workspaceId}).`;
    }

    case "list": {
      assertAllowedFlags(command, commandKey, []);
      const workspaces = (await client.listWorkspaces({})).workspaces;
      if (workspaces.length === 0) {
        return "No workspaces found.";
      }
      return [
        `Workspaces (${workspaces.length}):`,
        ...workspaces.map((workspace) => `${workspace.workspaceId}  ${workspace.displayName}`),
      ].join("\n");
    }

    case "remove": {
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const removed = (await client.removeWorkspace({ workspaceId })).value;
      return `Removed workspace ${workspaceId}: ${removed ? "yes" : "no"}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
