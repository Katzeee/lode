import type { ParsedCli } from "../args.js";
import { assertAllowedFlags } from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeActorCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "new": {
      assertAllowedFlags(command, commandKey, []);
      const { actorId, mnemonic } = await client.generateActorMnemonic({});
      return [`actor ${actorId}`, `mnemonic ${mnemonic}`].join("\n");
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
