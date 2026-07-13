import type { ParsedCli } from "./args.js";
import { executeActorCommand } from "./commands/actor.js";
import { executeFieldCommand, executeFieldDefCommand } from "./commands/field.js";
import { executeIdentityCommand } from "./commands/identity.js";
import { executeMemberCommand } from "./commands/member.js";
import { executeNodeCommand } from "./commands/node.js";
import { executeRefCommand } from "./commands/ref.js";
import { executeSchemaCommand } from "./commands/schema.js";
import { executeSyncCommand } from "./commands/sync.js";
import type { LodeCommandsClient } from "@lode/client";
import { executeWorkspaceCommand } from "./commands/workspace.js";

export async function executeCommand(
  client: LodeCommandsClient,
  command: ParsedCli,
): Promise<string> {
  const commandKey = `${command.group} ${command.action}`;

  switch (command.group) {
    case "workspace":
      return executeWorkspaceCommand(client, command, commandKey);
    case "node":
      return executeNodeCommand(client, command, commandKey);
    case "ref":
      return executeRefCommand(client, command, commandKey);
    case "schema":
      return executeSchemaCommand(client, command, commandKey);
    case "field-def":
      return executeFieldDefCommand(client, command, commandKey);
    case "field":
      return executeFieldCommand(client, command, commandKey);
    case "actor":
      return executeActorCommand(client, command, commandKey);
    case "identity":
      return executeIdentityCommand(client, command, commandKey);
    case "member":
      return executeMemberCommand(client, command, commandKey);
    case "sync":
      return executeSyncCommand(client, command, commandKey);
    default:
      throw new Error(`Unknown command "${command.group} ${command.action}".`);
  }
}
