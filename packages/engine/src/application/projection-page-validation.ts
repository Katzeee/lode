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
      "schemaApplications",
      "schemaFields",
      "schemaFieldItems",
      "schemaTemplateNodes",
      "templateNodeInstances",
      "schemaExtensions",
      "schemaSearchMembers",
      "schemaExtensionConflicts",
      "definitionStatuses",
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
  const templateNodeInstances =
    section === "templateNodeInstances"
      ? array(value.templateNodeInstances, "Template Node instances", templateNodeInstance)
      : emptyArray(value.templateNodeInstances, "Template Node instances");
  const schema = parseSchemaProjectionMaps(section, value);
  const conflictIssues =
    section === "conflictIssues"
      ? parseIndexed(value.conflictIssues, "conflict issues", parseConflictIssue)
      : empty(value.conflictIssues, "conflict issues");
  if (
    !pageEntriesAgree(section, entries, expected, {
      nodes,
      occurrences,
      children,
      canonicalOccurrences,
      addressedValues,
      templateNodeInstances,
      ...schema,
      conflictIssues,
    })
  ) {
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
    templateNodeInstances,
    ...schema,
    conflictIssues,
  };
}

function pageEntriesAgree(
  section: ProjectionPageSection,
  entries: readonly Readonly<{ value: ProjectionPageValue }>[],
  expected: Readonly<Record<string, ProjectionPageValue>>,
  page: Readonly<Record<ProjectionPageSection, unknown>>,
): boolean {
  const actual = page[section];
  const expectedValue =
    section === "templateNodeInstances" ? entries.map((entry) => entry.value) : expected;
  return JSON.stringify(actual) === JSON.stringify(expectedValue);
}

const PROJECTION_PAGE_SECTIONS = [
  "nodes",
  "occurrences",
  "children",
  "canonicalOccurrences",
  "addressedValues",
  "schemaApplications",
  "schemaFields",
  "schemaFieldItems",
  "schemaTemplateNodes",
  "templateNodeInstances",
  "schemaExtensions",
  "schemaSearchMembers",
  "schemaExtensionConflicts",
  "definitionStatuses",
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
              : section === "templateNodeInstances"
                ? templateNodeInstance(entry.value)
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

function templateNodeInstance(value: unknown) {
  const item = object(value, "Template Node instance");
  exact(
    item,
    [
      "ownerNodeId",
      "templateNodeId",
      "instanceNodeId",
      "instanceOccurrenceId",
      "state",
      "sources",
      "detachmentContributionIds",
    ],
    "Template Node instance",
  );
  const state = enumValue(item.state, ["linked", "detached"] as const, "Template Node state");
  return {
    ownerNodeId: nonempty(item.ownerNodeId, "Template owner"),
    templateNodeId: nonempty(item.templateNodeId, "Template Node"),
    instanceNodeId:
      item.instanceNodeId === null ? null : nonempty(item.instanceNodeId, "instance Node"),
    instanceOccurrenceId: nonempty(item.instanceOccurrenceId, "instance Occurrence"),
    state,
    sources: array(item.sources, "Template Node sources", (sourceValue) => {
      const source = object(sourceValue, "Template Node source");
      exact(source, ["schemaId", "appliedSchemaId", "templateItemId"], "Template Node source");
      return {
        schemaId: nonempty(source.schemaId, "source Schema"),
        appliedSchemaId: nonempty(source.appliedSchemaId, "applied Schema"),
        templateItemId: nonempty(source.templateItemId, "Template Item"),
      };
    }),
    detachmentContributionIds: stringArray(item.detachmentContributionIds),
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
