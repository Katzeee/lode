import {
  PROJECTION_PAGE_SECTIONS,
  type ProjectionPage,
  type ProjectionPageSection,
} from "./contract.js";
import type { FactFrontier } from "../domain/fact/index.js";
import type { ProjectionSections } from "../domain/reconcile/index.js";
import { parseTextAtomId } from "./decision-effect-validation.js";
import { parseConflictIssue } from "./conflict-validation.js";
import {
  array,
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
import { parseSchemaProjectionValue } from "./schema-projection-validation.js";

export function parseProjectionPage(value: Record<string, unknown>): ProjectionPage {
  const section = enumValue(value.section, PROJECTION_PAGE_SECTIONS, "Projection section");
  exact(value, ["identity", "view", "section", "next", section], "Projection page");
  const identity = projectionIdentity(value.identity);
  const view = enumValue(value.view, ["origin", "review"] as const, "Projection view");
  const next = nullableString(value.next, "Projection cursor");
  const content = parseSection(section, value[section]);
  return { identity, view, section, next, [section]: content } as ProjectionPage;
}

function parseSection(
  section: ProjectionPageSection,
  value: unknown,
): ProjectionSections[ProjectionPageSection] {
  switch (section) {
    case "nodes":
      return parseIndexed(value, "nodes", node);
    case "occurrences":
      return parseIndexed(value, "occurrences", occurrence);
    case "children":
      return parseIndexed(value, "children", stringArray);
    case "nodeOwners":
      return parseIndexed(value, "Node owners", nodeOwner);
    case "addressedValues":
      return parseIndexed(value, "values", jsonRecord);
    case "templateNodeInstances":
      return array(value, "Template Node instances", templateNodeInstance);
    case "conflictIssues":
      return parseIndexed(value, "conflict issues", parseConflictIssue);
    case "schemaApplications":
    case "schemaFields":
    case "templateFields":
    case "schemaTemplateNodes":
    case "schemaExtensions":
    case "schemaSearchMembers":
    case "schemaExtensionConflicts":
    case "nodeStatuses":
    case "effectiveFields":
    case "materializedFields":
      return parseIndexed(value, section, (item) =>
        parseSchemaProjectionValue(section, item),
      ) as ProjectionSections[ProjectionPageSection];
  }
}

function nodeOwner(value: unknown): string | null {
  return value === null ? null : nonempty(value, "Owner Node identity");
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
    ["occurrenceId", "nodeId", "parentNodeId", "properties", "metadata", "derived"],
    "Projected Occurrence",
  );
  if (typeof item.derived !== "boolean") {
    throw new Error("Occurrence derived flag is invalid");
  }
  return {
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    parentNodeId: nonempty(item.parentNodeId, "Parent Node identity"),
    properties: jsonRecord(item.properties),
    metadata: jsonRecord(item.metadata),
    derived: item.derived,
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
      exact(
        source,
        ["schemaId", "appliedSchemaId", "templateOccurrenceId"],
        "Template Node source",
      );
      return {
        schemaId: nonempty(source.schemaId, "source Schema"),
        appliedSchemaId: nonempty(source.appliedSchemaId, "applied Schema"),
        templateOccurrenceId: nonempty(source.templateOccurrenceId, "Template Occurrence"),
      };
    }),
    detachmentContributionIds: stringArray(item.detachmentContributionIds),
  };
}

function projectionIdentity(value: unknown) {
  const item = object(value, "Projection identity");
  exact(
    item,
    ["workspaceNodeId", "generationId", "frontier", "rulesVersion", "schemaVersion"],
    "Projection identity",
  );
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
    workspaceNodeId: nonempty(item.workspaceNodeId, "Workspace Node identity"),
    generationId: nonempty(item.generationId, "generation identity"),
    frontier: frontierValue as FactFrontier,
    rulesVersion: nonempty(item.rulesVersion, "rules version"),
    schemaVersion: nonempty(item.schemaVersion, "schema version"),
  };
}
