import {
  atomicMutationWrite,
  expandEditMutation,
  singleMutationWrite,
  type EditMutation,
  type MutationWrite,
} from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { locateInlineReference, nodeLocation, occurrenceAnchor } from "../../../domain/reconcile/index.js";
import { prepareFieldDefinitionConfigurationCreation } from "./field-definition-configuration-creation.js";
import {
  prepareSharedDefaultViewDefinitionCreation,
  prepareSharedDefaultViewDefinitionRemoval,
  prepareSharedDefaultViewDefinitionOptionsUpdate,
} from "./relation-creation.js";
import { prepareSearchExpressionCreation, prepareSearchExpressionUpdate } from "./search-expression-planning.js";
import { prepareSupertagApplicationCreation } from "./supertag-application-creation.js";
import { prepareSupertagOptionalFieldContributionAddition } from "./optional-field-authoring.js";
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
import { prepareFieldDefinitionEndpointConfiguration } from "./field-definition-endpoint-configuration.js";

export function expandPlanningEdit(edit: EditMutation, available: ScopedProjection): MutationWrite {
  if (edit.kind === "occurrence-move") {
    const field = Object.values(available.materializedFields)
      .flat()
      .find((candidate) => candidate.valueOccurrenceIds.includes(edit.occurrenceId));
    if (field !== undefined && edit.parentNodeId !== field.fieldNodeId) {
      throw new Error("Field Values can only be reordered within their Field");
    }
    return expandEditMutation(edit);
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
  if (
    edit.kind === "debug-node-open" ||
    edit.kind === "field-value-create" ||
    edit.kind === "url-node-create" ||
    edit.kind === "code-node-configure" ||
    edit.kind === "shared-default-view-definition-sort-by-name-create"
  ) {
    return expandBreadthEdit(edit, available);
  }
  if (edit.kind === "node-delete") {
    return prepareNodeDeletion(edit, available);
  }
  if (edit.kind === "node-restore") {
    return prepareNodeRestore(edit, available);
  }
  if (edit.kind === "reference-promote") {
    return singleMutationWrite(prepareReferencePromotion(edit.occurrenceId, available));
  }
  if (edit.kind === "supertag-application-create") {
    return prepareSupertagApplicationCreation(edit, available);
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
  if (edit.kind === "inline-reference-alias-create") {
    return prepareInlineReferenceAliasCreation(edit, available);
  }
  if (edit.kind === "search-expression-create") {
    return prepareSearchExpressionCreation(edit, available);
  }
  if (edit.kind === "search-expression-update") {
    return prepareSearchExpressionUpdate(edit, available);
  }
  if (edit.kind === "shared-default-view-definition-create") {
    return prepareSharedDefaultViewDefinitionCreation(edit, available);
  }
  if (edit.kind === "shared-default-view-definition-remove") {
    return prepareSharedDefaultViewDefinitionRemoval(edit, available);
  }
  if (edit.kind === "shared-default-view-definition-options-update") {
    return prepareSharedDefaultViewDefinitionOptionsUpdate(edit, available);
  }
  if (edit.kind === "shared-default-view-definition-mode-set") {
    return prepareViewModeUpdate(edit, available);
  }
  if (
    edit.kind === "field-datatype-configuration-create" ||
    edit.kind === "field-cardinality-configuration-create" ||
    edit.kind === "field-optionality-configuration-create" ||
    edit.kind === "field-initialization-expression-configuration-create"
  ) {
    return prepareFieldDefinitionConfigurationCreation(edit, available);
  }
  if (
    edit.kind === "field-datatype-configure" ||
    edit.kind === "field-cardinality-configure" ||
    edit.kind === "field-optionality-configure"
  ) {
    return prepareFieldDefinitionEndpointConfiguration(edit, available);
  }
  return expandEditMutation(edit);
}

function prepareViewModeUpdate(
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-mode-set" }>,
  available: ScopedProjection,
): MutationWrite {
  const active = Object.values(available.sharedDefaultViewDefinitions)
    .flat()
    .some((definition) => definition.viewDefinitionNodeId === edit.viewDefinitionNodeId);
  if (!active) {
    throw new Error("View Definition is not selected by an active shared default attachment");
  }
  return expandEditMutation(edit);
}

function prepareNodeDeletion(
  edit: Extract<EditMutation, { kind: "node-delete" }>,
  _available: ScopedProjection,
): MutationWrite {
  return atomicMutationWrite([{ kind: "node-delete", nodeId: edit.nodeId }]);
}

function prepareNodeRestore(
  edit: Extract<EditMutation, { kind: "node-restore" }>,
  available: ScopedProjection,
): MutationWrite {
  const occurrence = available.occurrences[edit.occurrenceId];
  if (
    nodeLocation(available.identity.workspaceNodeId, available, edit.nodeId) !== "trash" ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.ownerNodeId) !== "active" ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.parentNodeId) !== "active" ||
    occurrence?.nodeId !== edit.nodeId
  ) {
    throw new Error("Restore target or destination context is absent");
  }
  return atomicMutationWrite([
    { kind: "node-restore", nodeId: edit.nodeId, deletionFactId: edit.deletionFactId },
    {
      kind: "node-owner-set",
      nodeId: edit.nodeId,
      ownerNodeId: edit.ownerNodeId,
      previousOwnerNodeId: available.nodeOwners[edit.nodeId] ?? null,
    },
    {
      kind: "occurrence-move",
      occurrenceId: edit.occurrenceId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
      previousParentNodeId: occurrence.parentNodeId,
      previousAnchor: occurrenceAnchor(available, edit.occurrenceId),
    },
  ]);
}

export function assertNoWorkspaceCreation(workspaceId: string, operations: readonly EditMutation[]): void {
  if (operations.some((operation) => operation.kind === "node-create" && operation.nodeId === workspaceId)) {
    throw new Error("Workspace identity is created only by Workspace genesis");
  }
}

function prepareInlineReferenceAliasCreation(
  edit: Extract<EditMutation, { kind: "inline-reference-alias-create" }>,
  available: ScopedProjection,
): MutationWrite {
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
  const mutations: Mutation[] = [
    { kind: "node-create", nodeId: edit.aliasNodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
    {
      kind: "node-owner-set",
      nodeId: edit.aliasNodeId,
      ownerNodeId: edit.hostNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "inline-reference-alias-attach",
      inlineReferenceId: edit.inlineReferenceId,
      aliasNodeId: edit.aliasNodeId,
    },
  ];
  const first = mutations[0];
  if (!first) {
    throw new Error("Inline Alias creation contains no mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function prepareReferencePromotion(occurrenceId: string, available: ScopedProjection): Mutation {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new Error("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "node-owner-set",
    nodeId: occurrence.nodeId,
    ownerNodeId: occurrence.parentNodeId,
  };
}
