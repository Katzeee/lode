import { parseConflictIssue } from "../conflict/index.js";
import {
  isIntrinsicNodeType,
  parseJsonRecord,
  parseTextAtomId,
  parseViewOptionsSpec,
  requireFactActionId,
  requireFactActionIds,
} from "../fact/index.js";
import { array, exact, nonempty, object, stringArray, stringValue } from "../../decoding/index.js";
import type {
  ProjectedNode,
  ProjectionSectionName,
  ProjectionSectionValue,
  SearchExpression,
  SharedDefaultViewDefinition,
} from "./projection-types.js";
import { parseSearchExpressionSpec } from "../fact/index.js";
import { parseSupertagProjectionSectionValue } from "./supertag-projection-shape.js";
import { parseFieldDefinitionConfiguration } from "./field-definition-configuration-shape.js";
import { projectedOccurrence, templateNodeInstance } from "./projection-node-shape.js";

function parseProjectionSectionValue(section: ProjectionSectionName, value: unknown): ProjectionSectionValue {
  switch (section) {
    case "nodes":
      return projectedNode(value);
    case "occurrences":
      return projectedOccurrence(value);
    case "childOccurrences":
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
    case "supertagApplications":
    case "templateFields":
    case "optionalFieldContributions":
    case "effectiveFields":
    case "optionalFieldSuggestions":
    case "materializedFields":
    case "typedFieldValues":
      return parseSupertagProjectionSectionValue(section, value);
    case "searchExpressions":
      return searchExpression(value);
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

function parseProjectionSectionEntry(
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
    case "templateFields":
    case "optionalFieldContributions":
    case "effectiveFields":
    case "optionalFieldSuggestions":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
    case "materializedFields":
    case "typedFieldValues":
    case "searchExpressions":
    case "sharedDefaultViewDefinitions":
    case "fieldDefinitionConfigurations":
      return parseProjectionSectionValue(section, value);
    case "workspaceSystemNodes":
      if (identity !== "trash" && identity !== "schema" && identity !== "systemDefinitionCatalog") {
        throw new Error(`Unknown Workspace System Node role: ${identity}`);
      }
      return parseProjectionSectionValue(section, value);
  }
}

function sharedDefaultViewDefinition(value: unknown): SharedDefaultViewDefinition {
  const item = object(value, "Shared View Definition");
  exact(
    item,
    [
      "viewId",
      "hostNodeId",
      "attachmentNodeId",
      "attachmentOccurrenceId",
      "relationDefinitionOccurrenceId",
      "viewDefinitionNodeId",
      "viewDefinitionOccurrenceId",
      "viewType",
      "modeActionIds",
      "options",
      "optionsActionIds",
      "optionsConflicted",
    ],
    "Shared View Definition",
  );
  if (item.viewType !== "outline" && item.viewType !== "table") {
    throw new Error("Shared View Definition type is invalid");
  }
  return {
    viewId: requireFactActionId(item.viewId, "View identity"),
    hostNodeId: nonempty(item.hostNodeId, "View host Node identity"),
    attachmentNodeId: nonempty(item.attachmentNodeId, "View attachment Node identity"),
    attachmentOccurrenceId: nonempty(item.attachmentOccurrenceId, "View attachment Occurrence identity"),
    relationDefinitionOccurrenceId: nonempty(
      item.relationDefinitionOccurrenceId,
      "Views for node Definition endpoint Occurrence identity",
    ),
    viewDefinitionNodeId: nonempty(item.viewDefinitionNodeId, "View Definition Node identity"),
    viewDefinitionOccurrenceId: nonempty(item.viewDefinitionOccurrenceId, "View Definition Occurrence identity"),
    viewType: item.viewType,
    modeActionIds: requireFactActionIds(item.modeActionIds, "View mode action identities", false),
    options: parseViewOptionsSpec(item.options),
    optionsActionIds: requireFactActionIds(item.optionsActionIds, "View options action identities", false),
    optionsConflicted: booleanValue(item.optionsConflicted, "View options conflict state"),
  };
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean`);
  }
  return value;
}

function searchExpression(value: unknown): SearchExpression {
  const item = object(value, "Search Expression");
  exact(
    item,
    ["expressionNodeId", "expressionOccurrenceId", "definitionOccurrenceId", "expression"],
    "Search Expression",
  );
  return {
    expressionNodeId: nonempty(item.expressionNodeId, "Search Expression Node identity"),
    expressionOccurrenceId: nonempty(item.expressionOccurrenceId, "Search Expression Occurrence identity"),
    definitionOccurrenceId: nonempty(item.definitionOccurrenceId, "Search definition endpoint Occurrence identity"),
    expression: parseSearchExpressionSpec(item.expression),
  };
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
  exact(item, ["nodeId", "intrinsicNodeType", "content"], "Projected Node");
  if (item.intrinsicNodeType !== null && !isIntrinsicNodeType(item.intrinsicNodeType)) {
    throw new Error("Projected Intrinsic Node Type is invalid");
  }
  return {
    nodeId: nonempty(item.nodeId, "Node identity"),
    intrinsicNodeType: item.intrinsicNodeType,
    content: array(item.content, "Node content", (contentValue) => {
      const content = object(contentValue, "Node content item");
      if (content.kind === "text") {
        exact(content, ["kind", "id", "value", "attributes", "factActionId"], "Text Atom");
        return {
          kind: "text" as const,
          id: parseTextAtomId(content.id),
          value: stringValue(content.value, "Atom value"),
          attributes: parseJsonRecord(content.attributes),
          factActionId: requireFactActionId(content.factActionId, "FactAction identity"),
        };
      }
      if (content.kind === "inline-reference") {
        exact(
          content,
          ["kind", "id", "targetNodeId", "aliasNodeId", "targetStatus", "factActionId"],
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
          factActionId: requireFactActionId(content.factActionId, "FactAction identity"),
        };
      }
      throw new Error("Node content item kind is invalid");
    }),
  };
}
