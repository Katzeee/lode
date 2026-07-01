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
      return `Joined workspace ${coordinate.workspaceId} via ${coordinate.relayUrl} (doc ${coordinate.docId}).`;
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
