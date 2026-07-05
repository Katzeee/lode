import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getRequiredSingleFlag } from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeWorkspaceCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, ["--name", "--peer-name"]);
      const displayName = getRequiredSingleFlag(command, "--name");
      const peerNameFlag = command.flags["--peer-name"]?.[0];
      // The workspace id is the sync channel id (the broker routes by it; a joiner inherits it via the
      // share coordinate), so it must be system-generated — never user-chosen (two users picking the
      // same id on one relay would cross-talk). The RPC generates it when omitted.
      const workspace = await client.createWorkspace({
        displayName,
        ...(peerNameFlag !== undefined ? { peerName: peerNameFlag } : {}),
      });
      return `Created workspace ${workspace.displayName} (${workspace.workspaceId}).`;
    }

    case "fork": {
      // Recovery (design sync-identity-persistence §13): copy this workspace's content into a NEW
      // workspace where the caller is the owner. Used when kicked, the owner is lost (governance
      // frozen), or a rogue owner kicked everyone. The new ws gets a fresh wsId + empty membership
      // log + a root signed by the caller's actor; the source workspace is left untouched.
      assertAllowedFlags(command, commandKey, ["--workspace", "--name", "--peer-name"]);
      const sourceId = getRequiredSingleFlag(command, "--workspace");
      const displayName = getRequiredSingleFlag(command, "--name");
      const peerNameFlag = command.flags["--peer-name"]?.[0];
      const forked = await client.forkWorkspace({
        workspaceId: sourceId,
        displayName,
        ...(peerNameFlag !== undefined ? { peerName: peerNameFlag } : {}),
      });
      return `Forked workspace ${sourceId} → ${forked.workspaceId} (${forked.displayName}).`;
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

    case "rotate-key": {
      // Owner-only governance: manually re-key the workspace (forward-secrecy rotation; same roster).
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      await client.rotateTransit({ workspaceId });
      // Echo the new epoch + peer count so the owner sees the re-key landed and its blast radius.
      const { epoch, peers } = await client.listMembers({ workspaceId });
      return `Rotated transit key for workspace ${workspaceId} (epoch ${epoch}, ${peers.length} peers re-wrapped).`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
