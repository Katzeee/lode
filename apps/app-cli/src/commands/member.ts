import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getRequiredSingleFlag } from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeMemberCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "add": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--sign-pub"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const signPubHex = getRequiredSingleFlag(command, "--sign-pub");
      await client.addMember({
        workspaceId,
        memberSignPub: new Uint8Array(Buffer.from(signPubHex, "hex")),
      });
      return `Added member ${signPubHex} to workspace ${workspaceId}.`;
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
