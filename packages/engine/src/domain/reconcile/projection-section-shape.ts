import { parseConflictIssue } from "../conflict/index.js";
import { isNodeType, parseJsonRecord, parseTextAtomId } from "../fact/index.js";
import { array, exact, nonempty, object, stringArray, stringValue } from "../../shape-validation/index.js";
import type {
  ProjectedNode,
  ProjectedOccurrence,
  ProjectionSectionName,
  ProjectionSectionValue,
  SearchClause,
  SharedDefaultViewDefinition,
  TemplateNodeInstance,
} from "./projection-types.js";
import { parseSupertagProjectionSectionValue } from "./supertag-projection-shape.js";
import { parseFieldDefinitionConfiguration } from "./field-definition-configuration-shape.js";

export function parseProjectionSectionValue(section: ProjectionSectionName, value: unknown): ProjectionSectionValue {
  switch (section) {
    case "nodes":
      return projectedNode(value);
    case "occurrences":
      return projectedOccurrence(value);
    case "childOccurrences":
    case "supertagApplications":
    case "supertagFields":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
      return stringArray(value);
    case "nodeOwners":
      return value === null ? null : nonempty(value, "Owner Node identity");
    case "workspaceSystemNodes":
    case "metanodes":
      return nonempty(value, "Workspace System Node identity");
    case "templateFields":
    case "effectiveFields":
    case "materializedFields":
      return parseSupertagProjectionSectionValue(section, value);
    case "searchClauses":
      return array(value, "Search clauses", searchClause);
    case "sharedDefaultViewDefinitions":
      return array(value, "Shared View Definitions", sharedDefaultViewDefinition);
    case "fieldDefinitionConfigurations":
      return array(value, "Field Definition configurations", parseFieldDefinitionConfiguration);
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
    case "conflictIssues": {
      const parsed = parseConflictIssue(value);
      return matchingIdentity(identity, parsed.identity, parsed, section);
    }
    case "childOccurrences":
    case "nodeOwners":
    case "metanodes":
    case "supertagApplications":
    case "supertagFields":
    case "templateFields":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
    case "effectiveFields":
    case "materializedFields":
    case "searchClauses":
    case "sharedDefaultViewDefinitions":
    case "fieldDefinitionConfigurations":
      return parseProjectionSectionValue(section, value);
    case "workspaceSystemNodes":
      if (identity !== "trash") {
        throw new Error(`Unknown Workspace System Node role: ${identity}`);
      }
      return parseProjectionSectionValue(section, value);
  }
}

function sharedDefaultViewDefinition(value: unknown): SharedDefaultViewDefinition {
  const item = object(value, "Shared View Definition");
  exact(
    item,
    ["hostNodeId", "viewDefinitionNodeId", "viewDefinitionOccurrenceId", "viewType", "modeContributionIds"],
    "Shared View Definition",
  );
  if (item.viewType !== "outline" && item.viewType !== "table") {
    throw new Error("Shared View Definition type is invalid");
  }
  return {
    hostNodeId: nonempty(item.hostNodeId, "View host Node identity"),
    viewDefinitionNodeId: nonempty(item.viewDefinitionNodeId, "View Definition Node identity"),
    viewDefinitionOccurrenceId: nonempty(item.viewDefinitionOccurrenceId, "View Definition Occurrence identity"),
    viewType: item.viewType,
    modeContributionIds: stringArray(item.modeContributionIds, "View mode contribution identities"),
  };
}

function searchClause(value: unknown): SearchClause {
  const item = object(value, "Search clause");
  if (item.kind === "supertag-instance-of") {
    exact(item, ["kind", "clauseNodeId", "clauseOccurrenceId", "supertagId"], "Supertag Search clause");
    return {
      kind: "supertag-instance-of",
      clauseNodeId: nonempty(item.clauseNodeId, "Search clause Node identity"),
      clauseOccurrenceId: nonempty(item.clauseOccurrenceId, "Search clause Occurrence identity"),
      supertagId: nonempty(item.supertagId, "Search clause Supertag identity"),
    };
  }
  if (item.kind === "field-defined") {
    exact(item, ["kind", "clauseNodeId", "clauseOccurrenceId", "fieldDefinitionId"], "Field Search clause");
    return {
      kind: "field-defined",
      clauseNodeId: nonempty(item.clauseNodeId, "Search clause Node identity"),
      clauseOccurrenceId: nonempty(item.clauseOccurrenceId, "Search clause Occurrence identity"),
      fieldDefinitionId: nonempty(item.fieldDefinitionId, "Search clause Field Definition identity"),
    };
  }
  throw new Error("Search clause kind is invalid");
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
  exact(item, ["nodeId", "nodeType", "content"], "Projected Node");
  if (item.nodeType !== null && !isNodeType(item.nodeType)) {
    throw new Error("Projected Node type is invalid");
  }
  return {
    nodeId: nonempty(item.nodeId, "Node identity"),
    nodeType: item.nodeType,
    content: array(item.content, "Node content", (contentValue) => {
      const content = object(contentValue, "Node content item");
      if (content.kind === "text") {
        exact(content, ["kind", "id", "value", "attributes", "contributionId"], "Text Atom");
        return {
          kind: "text" as const,
          id: parseTextAtomId(content.id),
          value: stringValue(content.value, "Atom value"),
          attributes: parseJsonRecord(content.attributes),
          contributionId: nonempty(content.contributionId, "Contribution identity"),
        };
      }
      if (content.kind === "inline-reference") {
        exact(
          content,
          ["kind", "id", "targetNodeId", "aliasNodeId", "targetStatus", "contributionId"],
          "Inline Reference",
        );
        if (
          content.targetStatus !== "active" &&
          content.targetStatus !== "trash" &&
          content.targetStatus !== "unavailable"
        ) {
          throw new Error("Inline Reference target status is invalid");
        }
        return {
          kind: "inline-reference" as const,
          id: nonempty(content.id, "Inline Reference identity"),
          targetNodeId: nonempty(content.targetNodeId, "Inline Reference target Node identity"),
          aliasNodeId:
            content.aliasNodeId === null ? null : nonempty(content.aliasNodeId, "Inline Alias Node identity"),
          targetStatus: content.targetStatus,
          contributionId: nonempty(content.contributionId, "Contribution identity"),
        };
      }
      throw new Error("Node content item kind is invalid");
    }),
  };
}

function projectedOccurrence(value: unknown): ProjectedOccurrence {
  const item = object(value, "Projected Occurrence");
  exact(item, ["occurrenceId", "nodeId", "parentNodeId", "derived"], "Projected Occurrence");
  if (typeof item.derived !== "boolean") {
    throw new Error("Occurrence derived flag is invalid");
  }
  return {
    occurrenceId: nonempty(item.occurrenceId, "Occurrence identity"),
    nodeId: nonempty(item.nodeId, "Node identity"),
    parentNodeId: nonempty(item.parentNodeId, "Parent Node identity"),
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
      exact(source, ["supertagId", "appliedSupertagId", "templateOccurrenceId"], "Template Node source");
      return {
        supertagId: nonempty(source.supertagId, "source Supertag"),
        appliedSupertagId: nonempty(source.appliedSupertagId, "applied Supertag"),
        templateOccurrenceId: nonempty(source.templateOccurrenceId, "Template Occurrence"),
      };
    }),
    detachmentContributionIds: stringArray(item.detachmentContributionIds),
  };
}
