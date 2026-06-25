import type { ParsedCli } from "../args.js";
import {
  assertAllowedFlags,
  formatChangeResult,
  getOptionalFieldPresence,
  getOptionalFieldType,
  getRequiredFieldPresence,
  getRequiredFieldType,
  getRequiredSingleFlag,
  parseFieldValues,
  resolveNodeLabel,
} from "./shared.js";
import type { ClientLike } from "./types.js";

export async function executeFieldDefCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "create": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--parent-occ",
        "--name",
        "--field-type",
        "--presence",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const parentOccurrenceId = getRequiredSingleFlag(command, "--parent-occ");
      const name = getRequiredSingleFlag(command, "--name");
      const fieldType = getOptionalFieldType(command);
      const presence = getOptionalFieldPresence(command);
      const created = await client.createFieldDef({
        workspaceId,
        docId,
        parentOccurrenceId,
        name,
        ...(fieldType === undefined ? {} : { fieldType }),
        ...(presence === undefined ? {} : { presence }),
      });
      return `Created field definition ${name} as node ${created.nodeId}.`;
    }

    case "set-type": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--field-def-node",
        "--field-type",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const fieldDefNodeId = getRequiredSingleFlag(command, "--field-def-node");
      const fieldTypeRaw = getRequiredSingleFlag(command, "--field-type");
      const fieldType = getRequiredFieldType(command);
      await client.setFieldDefType({ workspaceId, docId, fieldDefNodeId, fieldType });
      return `Set field definition ${fieldDefNodeId} type to ${fieldTypeRaw}.`;
    }

    case "set-presence": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--field-def-node",
        "--presence",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const fieldDefNodeId = getRequiredSingleFlag(command, "--field-def-node");
      const presenceRaw = getRequiredSingleFlag(command, "--presence");
      const presence = getRequiredFieldPresence(command);
      await client.setFieldDefPresence({ workspaceId, docId, fieldDefNodeId, presence });
      return `Set field definition ${fieldDefNodeId} presence to ${presenceRaw}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}

export async function executeFieldCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "add": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--target-occ",
        "--field-def-node",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const targetOccurrenceId = getRequiredSingleFlag(command, "--target-occ");
      const fieldDefNodeId = getRequiredSingleFlag(command, "--field-def-node");
      const result = await client.addField({
        workspaceId,
        docId,
        targetOccurrenceId,
        fieldDefNodeId,
      });
      const fieldDefLabel = await resolveNodeLabel(client, workspaceId, docId, fieldDefNodeId);
      return [
        `field add status=${result.created ? "created" : "reused"}`,
        `${result.occurrenceId}  field`,
        `  node=${result.nodeId} target=${targetOccurrenceId} fieldDef=${fieldDefLabel}`,
      ].join("\n");
    }

    case "set-values": {
      assertAllowedFlags(command, commandKey, [
        "--workspace",
        "--doc",
        "--field-occ",
        "--text",
        "--ref-node",
        "--move-occ",
      ]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const fieldOccurrenceId = getRequiredSingleFlag(command, "--field-occ");
      const values = parseFieldValues(command);
      const result = await client.setFieldValues({
        workspaceId,
        docId,
        fieldOccurrenceId,
        values,
      });
      return formatChangeResult(
        `field set-values field=${result.field?.occurrenceId ?? "null"} values=${values.length}`,
        result.changes,
      );
    }

    case "remove": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--doc", "--field-occ"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const docId = getRequiredSingleFlag(command, "--doc");
      const fieldOccurrenceId = getRequiredSingleFlag(command, "--field-occ");
      await client.removeField({ workspaceId, docId, fieldOccurrenceId });
      return `Removed field occurrence ${fieldOccurrenceId}.`;
    }

    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
