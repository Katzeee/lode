import type { ParsedCli } from "../args.js";
import { assertAllowedFlags } from "./shared.js";
import type { LodeCommandsClient } from "@lode/client";

export async function executeActorCommand(
  client: LodeCommandsClient,
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
