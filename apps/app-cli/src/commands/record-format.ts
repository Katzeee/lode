import type { NodeNameResolver } from "./types.js";

export function collectResolvableNodeIds(
  record: Record<string, unknown> | undefined,
  ids: Set<string>,
): void {
  if (!record) {
    return;
  }
  collectNodeIdValue(record.schemaIds, ids);
  collectNodeIdValue(record.fieldDefId, ids);
}

export function pushRecordLines(
  lines: string[],
  prefix: string,
  record: Record<string, unknown> | undefined,
  resolveNodeName: NodeNameResolver,
): void {
  if (!record) {
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    lines.push(
      `  ${prefix}.${key}=${formatRecordValue(value, shouldResolveNodeIds(prefix, key), resolveNodeName)}`,
    );
  }
}

function collectNodeIdValue(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNodeIdValue(item, ids);
    }
  }
}

function shouldResolveNodeIds(prefix: string, key: string): boolean {
  return (
    (prefix === "entityMeta" || prefix === "occurrenceMeta") &&
    (key === "schemaIds" || key === "fieldDefId")
  );
}

function formatRecordValue(
  value: unknown,
  resolveNodeIds: boolean,
  resolveNodeName: NodeNameResolver,
): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatRecordValue(item, resolveNodeIds, resolveNodeName)).join(",");
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return resolveNodeIds && typeof value === "string"
      ? formatNodeIdLabel(value, resolveNodeName)
      : String(value);
  }
  return JSON.stringify(value);
}

function formatNodeIdLabel(nodeId: string, resolveNodeName: NodeNameResolver): string {
  const name = resolveNodeName(nodeId);
  return name ? `${name}(${nodeId})` : nodeId;
}
