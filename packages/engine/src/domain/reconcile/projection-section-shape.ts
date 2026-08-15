import { parseConflictIssue } from "../conflict/index.js";
import { parseJsonRecord, parseTextAtomId } from "../fact/index.js";
import { array, exact, nonempty, object, stringArray, stringValue } from "../../shape-validation/index.js";
import type {
  ProjectedNode,
  ProjectedOccurrence,
  ProjectionSectionName,
  ProjectionSectionValue,
  TemplateNodeInstance,
} from "./projection-types.js";
import { parseNodeStatus, parseSchemaProjectionSectionValue } from "./schema-projection-shape.js";

export function parseProjectionSectionValue(section: ProjectionSectionName, value: unknown): ProjectionSectionValue {
  switch (section) {
    case "nodes":
      return projectedNode(value);
    case "occurrences":
      return projectedOccurrence(value);
    case "children":
    case "schemaApplications":
    case "schemaFields":
    case "schemaTemplateNodes":
    case "schemaExtensions":
    case "schemaSearchMembers":
    case "schemaExtensionConflicts":
      return stringArray(value);
    case "nodeOwners":
      return value === null ? null : nonempty(value, "Owner Node identity");
    case "addressedValues":
      return parseJsonRecord(value);
    case "templateFields":
    case "nodeStatuses":
    case "effectiveFields":
    case "materializedFields":
      return parseSchemaProjectionSectionValue(section, value);
    case "templateNodeInstances":
      return templateNodeInstance(value);
    case "conflictIssues":
      return parseConflictIssue(value);
  }
}

export function parseProjectionSectionEntry(
  section: Exclude<ProjectionSectionName, "templateNodeInstances">,
  identity: string,
  value: unknown,
): ProjectionSectionValue {
  switch (section) {
    case "nodes": {
      const parsed = projectedNode(value);
      return matchingIdentity(identity, parsed.nodeId, parsed, section);
    }
    case "occurrences": {
      const parsed = projectedOccurrence(value);
      return matchingIdentity(identity, parsed.occurrenceId, parsed, section);
    }
    case "nodeStatuses": {
      const parsed = parseNodeStatus(value);
      return matchingIdentity(identity, parsed.nodeId, parsed, section);
    }
    case "conflictIssues": {
      const parsed = parseConflictIssue(value);
      return matchingIdentity(identity, parsed.identity, parsed, section);
    }
    case "children":
    case "nodeOwners":
    case "addressedValues":
    case "schemaApplications":
    case "schemaFields":
    case "templateFields":
    case "schemaTemplateNodes":
    case "schemaExtensions":
    case "schemaSearchMembers":
    case "schemaExtensionConflicts":
    case "effectiveFields":
    case "materializedFields":
      return parseProjectionSectionValue(section, value);
  }
}

export function isProjectionSectionValue(section: ProjectionSectionName, value: unknown): boolean {
  try {
    parseProjectionSectionValue(section, value);
    return true;
  } catch {
    return false;
  }
}

export function isProjectionSectionEntry(
  section: Exclude<ProjectionSectionName, "templateNodeInstances">,
  identity: string,
  value: unknown,
): boolean {
  try {
    parseProjectionSectionEntry(section, identity, value);
    return true;
  } catch {
    return false;
  }
}

function matchingIdentity<Value extends ProjectionSectionValue>(
  expected: string,
  actual: string,
  value: Value,
  section: ProjectionSectionName,
): Value {
  if (actual !== expected) {
    throw new Error(`${section} entry identity does not match its key`);
  }
  return value;
}

function projectedNode(value: unknown): ProjectedNode {
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
        attributes: parseJsonRecord(atom.attributes),
        contributionId: nonempty(atom.contributionId, "Contribution identity"),
      };
    }),
    properties: parseJsonRecord(item.properties),
    metadata: parseJsonRecord(item.metadata),
  };
}

function projectedOccurrence(value: unknown): ProjectedOccurrence {
  const item = object(value, "Projected Occurrence");
  exact(item, ["occurrenceId", "nodeId", "parentNodeId", "properties", "metadata", "derived"], "Projected Occurrence");
  if (typeof item.derived !== "boolean") {
    throw new Error("Occurrence derived flag is invalid");
  }
  return {
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    parentNodeId: nonempty(item.parentNodeId, "Parent Node identity"),
    properties: parseJsonRecord(item.properties),
    metadata: parseJsonRecord(item.metadata),
    derived: item.derived,
  };
}

function templateNodeInstance(value: unknown): TemplateNodeInstance {
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
  if (item.state !== "linked" && item.state !== "detached") {
    throw new Error("Template Node state is invalid");
  }
  return {
    ownerNodeId: nonempty(item.ownerNodeId, "Template owner"),
    templateNodeId: nonempty(item.templateNodeId, "Template Node"),
    instanceNodeId: item.instanceNodeId === null ? null : nonempty(item.instanceNodeId, "instance Node"),
    instanceOccurrenceId: nonempty(item.instanceOccurrenceId, "instance Occurrence"),
    state: item.state,
    sources: array(item.sources, "Template Node sources", (sourceValue) => {
      const source = object(sourceValue, "Template Node source");
      exact(source, ["schemaId", "appliedSchemaId", "templateOccurrenceId"], "Template Node source");
      return {
        schemaId: nonempty(source.schemaId, "source Schema"),
        appliedSchemaId: nonempty(source.appliedSchemaId, "applied Schema"),
        templateOccurrenceId: nonempty(source.templateOccurrenceId, "Template Occurrence"),
      };
    }),
    detachmentContributionIds: stringArray(item.detachmentContributionIds),
  };
}
