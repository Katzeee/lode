import type { ProjectionPage, ProjectionPageSection, ProjectionPageValue } from "./contract.js";
import type { FactFrontier } from "../domain/fact/index.js";
import { parseTextAtomId } from "./decision-effect-validation.js";
import { parseConflictIssue } from "./conflict-validation.js";
import {
  array,
  empty,
  emptyArray,
  enumValue,
  exact,
  jsonRecord,
  nonempty,
  nullableString,
  object,
  parseIndexed,
  stringArray,
  stringValue,
} from "./projection-page-validation-primitives.js";
import {
  parseSchemaProjectionMaps,
  parseSchemaProjectionValue,
} from "./schema-projection-validation.js";

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
      "schemaApplications",
      "schemaFields",
      "schemaFieldItems",
      "schemaExtensions",
      "schemaSearchMembers",
      "schemaExtensionConflicts",
      "conflictIssues",
      "effectiveFields",
      "materializedFields",
    ],
    "Projection page",
  );
  const section = enumValue(value.section, PROJECTION_PAGE_SECTIONS, "Projection section");
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
  const schema = parseSchemaProjectionMaps(section, value);
  const conflictIssues =
    section === "conflictIssues"
      ? parseIndexed(value.conflictIssues, "conflict issues", parseConflictIssue)
      : empty(value.conflictIssues, "conflict issues");
  const consistent =
    section === "managedChildren"
      ? JSON.stringify(managedChildren) === JSON.stringify(entries.map((entry) => entry.value))
      : JSON.stringify(
          {
            nodes,
            occurrences,
            children,
            canonicalOccurrences,
            addressedValues,
            ...schema,
            conflictIssues,
          }[section],
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
    ...schema,
    conflictIssues,
  };
}

const PROJECTION_PAGE_SECTIONS = [
  "nodes",
  "occurrences",
  "children",
  "canonicalOccurrences",
  "addressedValues",
  "managedChildren",
  "schemaApplications",
  "schemaFields",
  "schemaFieldItems",
  "schemaExtensions",
  "schemaSearchMembers",
  "schemaExtensionConflicts",
  "conflictIssues",
  "effectiveFields",
  "materializedFields",
] as const;

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
              : section === "managedChildren"
                ? managedChild(entry.value)
                : section === "conflictIssues"
                  ? parseConflictIssue(entry.value)
                  : parseSchemaProjectionValue(section, entry.value);
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
