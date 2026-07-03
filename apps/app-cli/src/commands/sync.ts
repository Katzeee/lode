import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getRequiredSingleFlag } from "./shared.js";
import { decodeCoordinate, encodeCoordinate } from "./coordinate.js";
import type { ClientLike } from "./types.js";

export async function executeSyncCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "share": {
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const coordinate = await client.shareWorkspace({ workspaceId });
      return encodeCoordinate(coordinate);
    }
    case "join": {
      assertAllowedFlags(command, commandKey, ["--coordinate"]);
      const encoded = getRequiredSingleFlag(command, "--coordinate");
      const coordinate = decodeCoordinate(encoded);
      await client.joinWorkspace({ coordinate });
      return `Joined workspace ${coordinate.workspaceId} via ${coordinate.relayUrl}.`;
    }
    case "register": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--relay"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const relayUrl = getRequiredSingleFlag(command, "--relay");
      await client.registerSync({ workspaceId, relayUrl });
      return `Registered sync for workspace ${workspaceId} via ${relayUrl}.`;
    }
    case "now": {
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      await client.syncNow({ workspaceId });
      return `Triggered sync round for workspace ${workspaceId}.`;
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
