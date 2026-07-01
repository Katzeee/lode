import type { ParsedCli } from "./args.js";
import { executeActorCommand } from "./commands/actor.js";
import { executeDocCommand } from "./commands/doc.js";
import { executeFieldCommand, executeFieldDefCommand } from "./commands/field.js";
import { executeMemberCommand } from "./commands/member.js";
import { executeNodeCommand } from "./commands/node.js";
import { executeRefCommand } from "./commands/ref.js";
import { executeSchemaCommand } from "./commands/schema.js";
import { executeSyncCommand } from "./commands/sync.js";
import { APPROVED_FLAGS } from "./commands/shared.js";
import type { ClientLike } from "./commands/types.js";
import { executeWorkspaceCommand } from "./commands/workspace.js";

export type { ClientLike } from "./commands/types.js";

export async function executeCommand(client: ClientLike, command: ParsedCli): Promise<string> {
  assertApprovedFlags(command);
  const commandKey = `${command.group} ${command.action}`;

  switch (command.group) {
    case "workspace":
      return executeWorkspaceCommand(client, command, commandKey);
    case "doc":
      return executeDocCommand(client, command, commandKey);
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
    case "member":
      return executeMemberCommand(client, command, commandKey);
    case "sync":
      return executeSyncCommand(client, command, commandKey);
    default:
      throw new Error(`Unknown command "${command.group} ${command.action}".`);
  }
}

function assertApprovedFlags(command: ParsedCli): void {
  for (const flagName of Object.keys(command.flags)) {
    if (!APPROVED_FLAGS.has(flagName)) {
      throw new Error(`Unknown flag "${flagName}".`);
    }
  }
}
