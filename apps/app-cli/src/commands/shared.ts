import { create } from "@bufbuild/protobuf";
import {
  type DomainChange,
  FieldPresence,
  FieldType,
  FieldValueInputSchema,
  type FieldValueInput,
  type NodeOccurrenceWire,
} from "@lode/protocol/proto";
import type { ParsedCli } from "../args.js";
import { collectResolvableNodeIds, pushRecordLines } from "./record-format.js";
import type { ClientLike, NodeNameResolver } from "./types.js";

const FIELD_TYPES = new Set(["plain", "reference", "option", "date", "checkbox"]);
const FIELD_PRESENCE = new Set(["normal", "optional"]);

function parseFieldType(raw: string): FieldType {
  switch (raw) {
    case "plain":
      return FieldType.PLAIN;
    case "reference":
      return FieldType.REFERENCE;
    case "option":
      return FieldType.OPTION;
    case "date":
      return FieldType.DATE;
    case "checkbox":
      return FieldType.CHECKBOX;
    default:
      throw new Error(
        `Invalid field type "${raw}". Expected one of: ${Array.from(FIELD_TYPES).join(", ")}.`,
      );
  }
}

function parseFieldPresence(raw: string): FieldPresence {
  switch (raw) {
    case "normal":
      return FieldPresence.NORMAL;
    case "optional":
      return FieldPresence.OPTIONAL_PRESENCE;
    default:
      throw new Error(
        `Invalid presence "${raw}". Expected one of: ${Array.from(FIELD_PRESENCE).join(", ")}.`,
      );
  }
}

export const APPROVED_FLAGS = new Set([
  "--workspace",
  "--occ",
  "--node",
  "--parent-occ",
  "--target-occ",
  "--target-node",
  "--schema-node",
  "--field-def-node",
  "--field-occ",
  "--ref-node",
  "--move-occ",
  "--field-type",
  "--presence",
  "--name",
  "--text",
  "--index",
  "--sign-pub",
  "--coordinate",
  "--relay",
]);

export function assertAllowedFlags(
  command: ParsedCli,
  commandKey: string,
  allowedFlags: string[],
): void {
  const allowed = new Set(allowedFlags);
  for (const flagName of Object.keys(command.flags)) {
    if (!allowed.has(flagName)) {
      throw new Error(`Flag "${flagName}" is not valid for "${commandKey}".`);
    }
  }
}

export function getRequiredSingleFlag(command: ParsedCli, flagName: string): string {
  const value = getOptionalSingleFlag(command, flagName);
  if (value === undefined) {
    throw new Error(`Missing required flag "${flagName}".`);
  }
  return value;
}

export function getOptionalSingleFlag(command: ParsedCli, flagName: string): string | undefined {
  const values = command.flags[flagName];
  if (!values || values.length === 0) {
    return undefined;
  }
  if (values.length > 1) {
    throw new Error(`Flag "${flagName}" only accepts one value.`);
  }
  return values[0];
}

export function getRequiredNullableFlag(command: ParsedCli, flagName: string): string | null {
  return parseNullableId(getRequiredSingleFlag(command, flagName));
}

export function getOptionalNullableFlag(
  command: ParsedCli,
  flagName: string,
): string | null | undefined {
  const value = getOptionalSingleFlag(command, flagName);
  if (value === undefined) {
    return undefined;
  }
  return parseNullableId(value);
}

export function describeNullableId(value: string | null | undefined): string {
  return value ?? "null";
}

export function getOptionalIndex(command: ParsedCli): number | undefined {
  const raw = getOptionalSingleFlag(command, "--index");
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Flag "--index" expects an integer, received "${raw}".`);
  }
  return parsed;
}

export function getOptionalFieldType(command: ParsedCli): FieldType | undefined {
  const raw = getOptionalSingleFlag(command, "--field-type");
  if (raw === undefined) {
    return undefined;
  }
  return parseFieldType(raw);
}

export function getRequiredFieldType(command: ParsedCli): FieldType {
  return parseFieldType(getRequiredSingleFlag(command, "--field-type"));
}

export function getOptionalFieldPresence(command: ParsedCli): FieldPresence | undefined {
  const raw = getOptionalSingleFlag(command, "--presence");
  if (raw === undefined) {
    return undefined;
  }
  return parseFieldPresence(raw);
}

export function getRequiredFieldPresence(command: ParsedCli): FieldPresence {
  return parseFieldPresence(getRequiredSingleFlag(command, "--presence"));
}

export function parseFieldValues(command: ParsedCli): FieldValueInput[] {
  const values: FieldValueInput[] = [];
  for (const flag of command.orderedFlags) {
    if (flag.name === "--text") {
      values.push(
        create(FieldValueInputSchema, { value: { case: "text", value: { text: flag.value } } }),
      );
      continue;
    }
    if (flag.name === "--ref-node") {
      values.push(
        create(FieldValueInputSchema, {
          value: { case: "ref", value: { targetNodeId: flag.value } },
        }),
      );
      continue;
    }
    if (flag.name === "--move-occ") {
      values.push(
        create(FieldValueInputSchema, {
          value: { case: "move", value: { occurrenceId: flag.value } },
        }),
      );
    }
  }
  if (values.length === 0) {
    throw new Error('Missing field values. Provide "--text", "--ref-node", or "--move-occ".');
  }
  return values;
}

export function formatNodeBlock(
  node: NodeOccurrenceWire,
  resolveNodeName: NodeNameResolver,
): string {
  const text = nodeText(node);
  const lines = [
    `${node.occurrenceId}  ${text.length > 0 ? text : "(empty)"}`,
    `  node=${node.nodeId} parent=${describeNullableId(node.parentOccurrenceId)} canonical=${node.canonicalOccurrenceId} canonicalChildren=${node.canonicalChildOccurrenceIds.length}`,
  ];
  pushRecordLines(lines, "props", node.props, resolveNodeName);
  pushRecordLines(lines, "entityMeta", node.entityMeta, resolveNodeName);
  pushRecordLines(lines, "occurrenceProps", node.occurrenceProps, resolveNodeName);
  pushRecordLines(lines, "occurrenceMeta", node.occurrenceMeta, resolveNodeName);
  return lines.join("\n");
}

const CHANGE_KIND_NAME: Record<number, string> = {
  0: "fieldSlot",
  1: "templateRef",
  2: "fieldValue",
};

const CHANGE_REASON_NAME: Record<number, string> = {
  0: "created",
  1: "reused",
  2: "moved",
  3: "deleted",
  4: "kept",
  5: "provenanceUpdated",
};

export function formatChangeResult(header: string, changes: DomainChange[]): string {
  const lines = [`${header} changes=${changes.length}`];
  for (const change of changes) {
    lines.push(
      `${CHANGE_KIND_NAME[change.kind] ?? change.kind} ${CHANGE_REASON_NAME[change.reason] ?? change.reason}`,
      `  node=${change.nodeId}`,
      `  occ=${change.occurrenceId}`,
    );
  }
  return lines.join("\n");
}

export async function buildNodeNameResolver(
  client: ClientLike,
  workspaceId: string,
  nodes: NodeOccurrenceWire[],
): Promise<NodeNameResolver> {
  const ids = new Set<string>();
  for (const node of nodes) {
    collectResolvableNodeIds(node.entityMeta, ids);
    collectResolvableNodeIds(node.occurrenceMeta, ids);
  }
  const names = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (nodeId) => {
      const node = (await client.getNodeById({ workspaceId, nodeId })).occurrence;
      if (node) {
        const text = nodeText(node);
        if (text.length > 0) {
          names.set(nodeId, text);
        }
      }
    }),
  );
  return (nodeId) => names.get(nodeId);
}

export async function resolveNodeLabel(
  client: ClientLike,
  workspaceId: string,
  nodeId: string,
): Promise<string> {
  const node = (await client.getNodeById({ workspaceId, nodeId })).occurrence;
  if (!node) {
    return nodeId;
  }
  const text = nodeText(node);
  return text.length > 0 ? `${text}(${nodeId})` : nodeId;
}

function parseNullableId(value: string): string | null {
  return value === "null" ? null : value;
}

function nodeText(node: NodeOccurrenceWire): string {
  return node.deltas.map((delta) => delta.insert).join("");
}
