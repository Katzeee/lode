import { parseMutation, parseSearchExpressionSpec, parseViewOptionsSpec } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";
import type { EditMutation } from "./types.js";

export function parseSupertagApplicationCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "hostNodeId",
    "metanodeId",
    "supertagId",
    "applicationNodeId",
    "applicationOccurrenceId",
    "relationDefinitionOccurrenceId",
    "definitionOccurrenceId",
    "anchor",
    "seed",
  ]);
  const applicationNodeId = nonemptyInputString(edit.applicationNodeId, "Supertag Application Node identity");
  const applicationOccurrenceId = nonemptyInputString(
    edit.applicationOccurrenceId,
    "Supertag Application Occurrence identity",
  );
  const node = parseMutation({
    kind: "node-create",
    nodeId: applicationNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: applicationOccurrenceId,
    nodeId: applicationNodeId,
    parentNodeId: edit.metanodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "supertag-application-create",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Supertag Application host Node identity"),
    metanodeId: placement.parentNodeId,
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition identity"),
    applicationNodeId,
    applicationOccurrenceId,
    relationDefinitionOccurrenceId: nonemptyInputString(
      edit.relationDefinitionOccurrenceId,
      "Node supertags relation Definition endpoint Occurrence identity",
    ),
    definitionOccurrenceId: nonemptyInputString(
      edit.definitionOccurrenceId,
      "Supertag Definition endpoint Occurrence identity",
    ),
    anchor: placement.anchor,
    ...(node.seed === undefined ? {} : { seed: node.seed }),
  };
}

export function parseSharedDefaultViewDefinitionCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "hostNodeId",
    "metanodeId",
    "attachmentNodeId",
    "attachmentOccurrenceId",
    "relationDefinitionOccurrenceId",
    "viewDefinitionNodeId",
    "viewDefinitionOccurrenceId",
    "viewType",
    "anchor",
    "seed",
  ]);
  const attachmentNodeId = nonemptyInputString(edit.attachmentNodeId, "View attachment Node identity");
  const attachmentOccurrenceId = nonemptyInputString(
    edit.attachmentOccurrenceId,
    "View attachment Occurrence identity",
  );
  const viewDefinitionNodeId = nonemptyInputString(edit.viewDefinitionNodeId, "View Definition Node identity");
  const viewDefinition = parseMutation({
    kind: "node-create",
    nodeId: viewDefinitionNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: attachmentOccurrenceId,
    nodeId: attachmentNodeId,
    parentNodeId: edit.metanodeId,
    anchor: edit.anchor,
  });
  const mode = parseMutation({
    kind: "shared-default-view-definition-mode-set",
    viewDefinitionNodeId,
    viewType: edit.viewType,
  });
  return {
    kind: "shared-default-view-definition-create",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "View host Node identity"),
    metanodeId: placement.parentNodeId,
    attachmentNodeId,
    attachmentOccurrenceId,
    relationDefinitionOccurrenceId: nonemptyInputString(
      edit.relationDefinitionOccurrenceId,
      "Views for node Definition endpoint Occurrence identity",
    ),
    viewDefinitionNodeId,
    viewDefinitionOccurrenceId: nonemptyInputString(
      edit.viewDefinitionOccurrenceId,
      "View Definition Occurrence identity",
    ),
    viewType: mode.viewType,
    anchor: placement.anchor,
    ...(viewDefinition.seed === undefined ? {} : { seed: viewDefinition.seed }),
  };
}

export function parseSharedDefaultViewDefinitionRemove(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "hostNodeId",
    "attachmentNodeId",
    "attachmentOccurrenceId",
    "relationDefinitionOccurrenceId",
    "viewDefinitionNodeId",
    "viewDefinitionOccurrenceId",
  ]);
  return {
    kind: "shared-default-view-definition-remove",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "View host Node identity"),
    attachmentNodeId: nonemptyInputString(edit.attachmentNodeId, "View attachment Node identity"),
    attachmentOccurrenceId: nonemptyInputString(edit.attachmentOccurrenceId, "View attachment Occurrence identity"),
    relationDefinitionOccurrenceId: nonemptyInputString(
      edit.relationDefinitionOccurrenceId,
      "Views for node Definition endpoint Occurrence identity",
    ),
    viewDefinitionNodeId: nonemptyInputString(edit.viewDefinitionNodeId, "View Definition Node identity"),
    viewDefinitionOccurrenceId: nonemptyInputString(
      edit.viewDefinitionOccurrenceId,
      "View Definition Occurrence identity",
    ),
  };
}

export function parseSharedDefaultViewDefinitionOptionsUpdate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "hostNodeId", "viewDefinitionNodeId", "options"]);
  return {
    kind: "shared-default-view-definition-options-update",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "View host Node identity"),
    viewDefinitionNodeId: nonemptyInputString(edit.viewDefinitionNodeId, "View Definition Node identity"),
    options: parseViewOptionsSpec(edit.options),
  };
}

export function parseSearchExpressionCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "searchNodeId",
    "metanodeId",
    "expressionNodeId",
    "expressionOccurrenceId",
    "definitionOccurrenceId",
    "anchor",
    "seed",
    "expression",
  ]);
  const expressionNodeId = nonemptyInputString(edit.expressionNodeId, "Search expression Node identity");
  const expressionOccurrenceId = nonemptyInputString(
    edit.expressionOccurrenceId,
    "Search expression Occurrence identity",
  );
  const expressionNode = parseMutation({
    kind: "node-create",
    nodeId: expressionNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: expressionOccurrenceId,
    nodeId: expressionNodeId,
    parentNodeId: edit.metanodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "search-expression-create",
    searchNodeId: nonemptyInputString(edit.searchNodeId, "Search Node identity"),
    metanodeId: placement.parentNodeId,
    expressionNodeId,
    expressionOccurrenceId,
    definitionOccurrenceId: nonemptyInputString(
      edit.definitionOccurrenceId,
      "Search expression Definition endpoint Occurrence identity",
    ),
    expression: parseSearchExpressionSpec(edit.expression),
    anchor: placement.anchor,
    ...(expressionNode.seed === undefined ? {} : { seed: expressionNode.seed }),
  };
}

export function parseSearchExpressionUpdate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "searchNodeId", "expression"]);
  return {
    kind: "search-expression-update",
    searchNodeId: nonemptyInputString(edit.searchNodeId, "Search Node identity"),
    expression: parseSearchExpressionSpec(edit.expression),
  };
}
