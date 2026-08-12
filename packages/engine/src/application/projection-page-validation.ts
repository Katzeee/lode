import type { ProjectionPage, ProjectionPageSection, ProjectionPageValue } from "./contract.js";
import type { FactFrontier, JsonValue } from "../domain/fact/index.js";
import { parseTextAtomId } from "./decision-effect-validation.js";

export function parseProjectionPage(value: Record<string, unknown>): ProjectionPage {
  exact(
    value,
    [
      "identity",
      "view",
      "section",
      "entries",
      "next",
      "nodes",
      "occurrences",
      "children",
      "canonicalOccurrences",
      "addressedValues",
      "managedChildren",
    ],
    "Projection page",
  );
  const section = enumValue(
    value.section,
    [
      "nodes",
      "occurrences",
      "children",
      "canonicalOccurrences",
      "addressedValues",
      "managedChildren",
    ] as const,
    "Projection section",
  );
  const entries = array(value.entries, "Projection entries", (item) => parseEntry(section, item));
  const expected = Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  const nodes =
    section === "nodes" ? parseIndexed(value.nodes, "nodes", node) : empty(value.nodes, "nodes");
  const occurrences =
    section === "occurrences"
      ? parseIndexed(value.occurrences, "occurrences", occurrence)
      : empty(value.occurrences, "occurrences");
  const children =
    section === "children"
      ? parseIndexed(value.children, "children", stringArray)
      : empty(value.children, "children");
  const canonicalOccurrences =
    section === "canonicalOccurrences"
      ? parseIndexed(value.canonicalOccurrences, "canonicals", (item) =>
          nonempty(item, "canonical Occurrence"),
        )
      : empty(value.canonicalOccurrences, "canonicals");
  const addressedValues =
    section === "addressedValues"
      ? parseIndexed(value.addressedValues, "values", jsonRecord)
      : empty(value.addressedValues, "values");
  const managedChildren =
    section === "managedChildren"
      ? array(value.managedChildren, "managed children", managedChild)
      : emptyArray(value.managedChildren, "managed children");
  const consistent =
    section === "managedChildren"
      ? JSON.stringify(managedChildren) === JSON.stringify(entries.map((entry) => entry.value))
      : JSON.stringify(
          { nodes, occurrences, children, canonicalOccurrences, addressedValues }[section],
        ) === JSON.stringify(expected);
  if (!consistent) {
    throw new Error("Projection page entries and section map disagree");
  }
  return {
    identity: projectionIdentity(value.identity),
    view: enumValue(value.view, ["origin", "review"] as const, "Projection view"),
    section,
    entries,
    next: nullableString(value.next, "Projection cursor"),
    nodes,
    occurrences,
    children,
    canonicalOccurrences,
    addressedValues,
    managedChildren,
  };
}

function parseEntry(
  section: ProjectionPageSection,
  value: unknown,
): { identity: string; value: ProjectionPageValue } {
  const entry = object(value, "Projection entry");
  exact(entry, ["identity", "value"], "Projection entry");
  const identity = nonempty(entry.identity, "Projection entry identity");
  const parsed =
    section === "nodes"
      ? node(entry.value)
      : section === "occurrences"
        ? occurrence(entry.value)
        : section === "children"
          ? stringArray(entry.value)
          : section === "canonicalOccurrences"
            ? nonempty(entry.value, "canonical Occurrence")
            : section === "addressedValues"
              ? jsonRecord(entry.value)
              : managedChild(entry.value);
  return { identity, value: parsed };
}

function node(value: unknown) {
  const item = object(value, "Projected Node");
  exact(item, ["nodeId", "text", "properties", "metadata"], "Projected Node");
  return {
    nodeId: nonempty(item.nodeId, "Node identity"),
    text: array(item.text, "Node text", (atomValue) => {
      const atom = object(atomValue, "Text Atom");
      exact(atom, ["id", "value", "attributes", "contributionId"], "Text Atom");
      return {
        id: parseTextAtomId(atom.id),
        value: stringValue(atom.value, "Atom value"),
        attributes: jsonRecord(atom.attributes),
        contributionId: nonempty(atom.contributionId, "Contribution identity"),
      };
    }),
    properties: jsonRecord(item.properties),
    metadata: jsonRecord(item.metadata),
  };
}

function occurrence(value: unknown) {
  const item = object(value, "Projected Occurrence");
  exact(
    item,
    ["occurrenceId", "nodeId", "parentOccurrenceId", "properties", "metadata", "managed"],
    "Projected Occurrence",
  );
  if (typeof item.managed !== "boolean") {
    throw new Error("Occurrence managed flag is invalid");
  }
  return {
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    parentOccurrenceId: nullableString(item.parentOccurrenceId, "Occurrence parent"),
    properties: jsonRecord(item.properties),
    metadata: jsonRecord(item.metadata),
    managed: item.managed,
  };
}

function managedChild(value: unknown) {
  const item = object(value, "Managed child");
  exact(item, ["parentNodeId", "schemaId", "fieldId", "nodeId", "occurrenceId"], "Managed child");
  return {
    parentNodeId: nonempty(item.parentNodeId, "managed parent"),
    schemaId: nonempty(item.schemaId, "Schema identity"),
    fieldId: nonempty(item.fieldId, "Field identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
  };
}

function projectionIdentity(value: unknown) {
  const item = object(value, "Projection identity");
  exact(item, ["generationId", "frontier", "rulesVersion", "schemaVersion"], "Projection identity");
  const frontierValue = object(item.frontier, "Fact frontier");
  for (const [replicaId, sequence] of Object.entries(frontierValue)) {
    if (
      !/^[a-z2-7]{26}$/.test(replicaId) ||
      !Number.isSafeInteger(sequence) ||
      (sequence as number) < 0
    ) {
      throw new Error("Invalid Fact frontier");
    }
  }
  return {
    generationId: nonempty(item.generationId, "generation identity"),
    frontier: frontierValue as FactFrontier,
    rulesVersion: nonempty(item.rulesVersion, "rules version"),
    schemaVersion: nonempty(item.schemaVersion, "schema version"),
  };
}

function parseIndexed<T>(
  value: unknown,
  label: string,
  parse: (value: unknown) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(object(value, label)).map(([key, item]) => [key, parse(item)]),
  );
}
function empty(value: unknown, label: string): Record<string, never> {
  const result = object(value, label);
  if (Object.keys(result).length > 0) {
    throw new Error(`${label} must be empty outside its page section`);
  }
  return {};
}
function emptyArray(value: unknown, label: string): readonly never[] {
  if (!Array.isArray(value) || value.length > 0) {
    throw new Error(`${label} must be empty outside its page section`);
  }
  return [];
}
function jsonRecord(value: unknown): Record<string, JsonValue> {
  const result = object(value, "JSON object");
  for (const child of Object.values(result)) {
    json(child);
  }
  return result as Record<string, JsonValue>;
}
function json(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(json);
    return;
  }
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(json);
    return;
  }
  throw new Error("Value is not JSON");
}
function stringArray(value: unknown): string[] {
  return array(value, "string array", (item) => nonempty(item, "identity"));
}
function array<T>(value: unknown, label: string, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parse);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}
function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
