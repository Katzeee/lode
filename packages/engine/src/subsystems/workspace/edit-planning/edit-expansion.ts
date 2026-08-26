import { expandEditAction, type EditAction } from "../../../domain/edit/index.js";
import { authoredActionBatch, singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import type { GraphAction, FactActionId } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { locateInlineReference, nodeLocation } from "../../../domain/reconcile/index.js";
import { prepareFieldDefinitionConfiguration } from "./field-definition-configuration.js";
import { prepareViewEdit } from "./view-planning.js";
import { prepareSearchExpressionCreation, prepareSearchExpressionEdit } from "./search-expression-planning.js";
import { prepareSupertagApplicationCreation } from "./supertag-application-creation.js";
import {
  prepareSupertagOptionalFieldContributionAddition,
  prepareSupertagOptionalFieldContributionRemoval,
} from "./optional-field-authoring.js";
import { expandBreadthEdit } from "./breadth-edit-expansion.js";
import {
  prepareExistingSupertagTemplateFieldAddition,
  prepareSupertagTemplateFieldCreation,
  prepareSupertagTemplateFieldDiscoverability,
  prepareSupertagTemplateFieldRemoval,
  prepareSupertagTemplateFieldStaticDefault,
  prepareSupertagTemplateFieldVisibility,
} from "./template-field-authoring.js";
import { prepareTypedFieldValue } from "./typed-field-value.js";

type StructuralEdit = Extract<
  EditAction,
  {
    kind:
      | "node-create"
      | "node-delete"
      | "node-restore"
      | "reference-promote"
      | "occurrence-create"
      | "occurrence-delete"
      | "occurrence-restore"
      | "occurrence-move";
  }
>;

export function expandPlanningEdit(
  edit: EditAction,
  available: ScopedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  if (isStructuralEdit(edit)) {
    return expandStructuralEdit(edit, available);
  }
  if (
    edit.kind === "field-number-value-set" ||
    edit.kind === "field-date-value-set" ||
    edit.kind === "field-checkbox-value-set" ||
    edit.kind === "field-options-from-supertag-value-set" ||
    edit.kind === "typed-field-value-clear"
  ) {
    return prepareTypedFieldValue(edit, available);
  }
  if (edit.kind === "field-value-create" || edit.kind === "url-node-create" || edit.kind === "code-node-configure") {
    return expandBreadthEdit(edit, available);
  }
  if (edit.kind === "supertag-application-create") {
    return prepareSupertagApplicationCreation(edit, available);
  }
  if (edit.kind === "supertag-remove") {
    return singleAuthoredActionBatch({
      kind: "supertag-membership-remove",
      hostNodeId: edit.hostNodeId,
      supertagId: edit.supertagId,
    });
  }
  if (edit.kind === "supertag-template-field-create") {
    return prepareSupertagTemplateFieldCreation(edit, available);
  }
  if (edit.kind === "supertag-template-field-add-existing") {
    return prepareExistingSupertagTemplateFieldAddition(edit, available);
  }
  if (edit.kind === "supertag-template-field-make-discoverable") {
    return prepareSupertagTemplateFieldDiscoverability(edit, available);
  }
  if (edit.kind === "supertag-template-field-remove") {
    return prepareSupertagTemplateFieldRemoval(edit, available);
  }
  if (edit.kind === "supertag-template-field-static-default-set") {
    return prepareSupertagTemplateFieldStaticDefault(edit, available);
  }
  if (edit.kind === "supertag-template-field-visibility-set") {
    return prepareSupertagTemplateFieldVisibility(edit, available);
  }
  if (edit.kind === "supertag-optional-field-contribution-add") {
    return prepareSupertagOptionalFieldContributionAddition(edit, available);
  }
  if (edit.kind === "supertag-optional-field-contribution-remove") {
    return prepareSupertagOptionalFieldContributionRemoval(edit, available);
  }
  if (edit.kind === "inline-reference-alias-create") {
    return prepareInlineReferenceAliasCreation(edit, available);
  }
  if (edit.kind === "search-expression-create") {
    return prepareSearchExpressionCreation(edit, available, actionId);
  }
  if (
    edit.kind === "search-expression-add" ||
    edit.kind === "search-expression-configure" ||
    edit.kind === "search-expression-move" ||
    edit.kind === "search-expression-remove"
  ) {
    return prepareSearchExpressionEdit(edit, available, actionId);
  }
  if (isViewEdit(edit)) {
    return prepareViewEdit(edit, available, actionId);
  }
  if (
    edit.kind === "field-datatype-configure" ||
    edit.kind === "field-cardinality-configure" ||
    edit.kind === "field-optionality-configure" ||
    edit.kind === "field-initialization-expression-configure"
  ) {
    return prepareFieldDefinitionConfiguration(edit, available);
  }
  return expandEditAction(edit);
}

function isViewEdit(edit: EditAction): edit is Parameters<typeof prepareViewEdit>[0] {
  return (
    edit.kind === "shared-default-view-create" ||
    edit.kind === "shared-default-view-remove" ||
    edit.kind.startsWith("view-")
  );
}

function expandStructuralEdit(edit: StructuralEdit, available: ScopedProjection): AuthoredActionBatch {
  if (edit.kind === "node-create") {
    if (nodeLocation(available.identity.workspaceNodeId, available, edit.parentNodeId) !== "active") {
      throw new Error("Node Original parent is absent from the current Projection");
    }
    return expandEditAction(edit);
  }
  if (edit.kind === "node-delete") {
    return prepareNodeDeletion(edit, available);
  }
  if (edit.kind === "node-restore") {
    return prepareNodeRestore(edit, available);
  }
  if (edit.kind === "reference-promote") {
    return singleAuthoredActionBatch(prepareReferencePromotion(edit.occurrenceId, available));
  }
  if (edit.kind === "occurrence-create" || edit.kind === "occurrence-restore") {
    return singleAuthoredActionBatch({
      kind: "placement-create",
      placementId: edit.occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    });
  }
  if (edit.kind === "occurrence-delete") {
    return singleAuthoredActionBatch({ kind: "placement-remove", placementId: edit.occurrenceId });
  }
  const field = Object.values(available.materializedFields)
    .flat()
    .find((candidate) => candidate.valueOccurrenceIds.includes(edit.occurrenceId));
  if (field !== undefined && edit.parentNodeId !== field.fieldNodeId) {
    throw new Error("Field Values can only be reordered within their Field");
  }
  return singleAuthoredActionBatch({
    kind: "placement-move",
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
}

function isStructuralEdit(edit: EditAction): edit is StructuralEdit {
  return [
    "node-create",
    "node-delete",
    "node-restore",
    "reference-promote",
    "occurrence-create",
    "occurrence-delete",
    "occurrence-restore",
    "occurrence-move",
  ].includes(edit.kind);
}

function prepareNodeDeletion(
  edit: Extract<EditAction, { kind: "node-delete" }>,
  _available: ScopedProjection,
): AuthoredActionBatch {
  return singleAuthoredActionBatch({ kind: "node-trash", nodeId: edit.nodeId });
}

function prepareNodeRestore(
  edit: Extract<EditAction, { kind: "node-restore" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const occurrence = available.occurrences[edit.occurrenceId];
  if (
    nodeLocation(available.identity.workspaceNodeId, available, edit.nodeId) !== "trash" ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.parentNodeId) !== "active" ||
    occurrence?.nodeId !== edit.nodeId
  ) {
    throw new Error("Restore target or destination context is absent");
  }
  return singleAuthoredActionBatch({
    kind: "node-restore",
    nodeId: edit.nodeId,
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
}

export function assertNoWorkspaceCreation(workspaceId: string, operations: readonly EditAction[]): void {
  if (operations.some((operation) => operation.kind === "node-create" && operation.nodeId === workspaceId)) {
    throw new Error("Workspace identity is created only by Workspace genesis");
  }
}

function prepareInlineReferenceAliasCreation(
  edit: Extract<EditAction, { kind: "inline-reference-alias-create" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const location = locateInlineReference(available.nodes, edit.inlineReferenceId);
  if (!location || location.hostNodeId !== edit.hostNodeId) {
    throw new Error("Inline Reference is absent from the requested host Node");
  }
  if (location.reference.aliasNodeId !== null) {
    throw new Error("Inline Reference already has an Alias");
  }
  if (available.nodes[edit.aliasNodeId] !== undefined) {
    throw new Error("Inline Alias Node identity already exists");
  }
  const actions: GraphAction[] = [
    {
      kind: "node-create",
      nodeId: edit.aliasNodeId,
      ownerNodeId: edit.hostNodeId,
      originalPlacement: null,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "inline-alias-attach",
      inlineReferenceId: edit.inlineReferenceId,
      aliasNodeId: edit.aliasNodeId,
    },
  ];
  const first = actions[0];
  if (!first) {
    throw new Error("Inline Alias creation contains no actions");
  }
  return authoredActionBatch([first, ...actions.slice(1)]);
}

function prepareReferencePromotion(occurrenceId: string, available: ScopedProjection): GraphAction {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new Error("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "original-promote",
    nodeId: occurrence.nodeId,
    placementId: occurrence.occurrenceId,
  };
}
