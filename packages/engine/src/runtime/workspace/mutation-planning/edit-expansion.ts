import {
  atomicMutationWrite,
  expandEditMutation,
  singleMutationWrite,
  type EditMutation,
  type MutationWrite,
} from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { locateInlineReference } from "../../../domain/reconcile/index.js";
import { supportsSharedDefaultViewHost } from "../../../domain/view/index.js";
import { prepareFieldDefinitionConfigurationCreation } from "./field-definition-configuration-creation.js";

export function expandPlanningEdit(edit: EditMutation, available: ScopedProjection): MutationWrite {
  if (edit.kind === "reference-promote") {
    return singleMutationWrite(prepareReferencePromotion(edit.occurrenceId, available));
  }
  if (edit.kind === "inline-reference-alias-create") {
    return prepareInlineReferenceAliasCreation(edit, available);
  }
  if (edit.kind === "search-supertag-clause-create" || edit.kind === "search-field-clause-create") {
    return prepareSearchClauseCreation(edit, available);
  }
  if (edit.kind === "shared-default-view-definition-create") {
    return prepareSharedDefaultViewDefinitionCreation(edit, available);
  }
  if (
    edit.kind === "field-datatype-configuration-create" ||
    edit.kind === "field-cardinality-configuration-create" ||
    edit.kind === "field-initialization-expression-configuration-create"
  ) {
    return prepareFieldDefinitionConfigurationCreation(edit, available);
  }
  return expandEditMutation(edit);
}

function prepareSharedDefaultViewDefinitionCreation(
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-create" }>,
  available: ScopedProjection,
): MutationWrite {
  const host = available.nodes[edit.hostNodeId];
  if (host === undefined || !supportsSharedDefaultViewHost(host.nodeType)) {
    throw new Error("View host is not an active Node");
  }
  const existingRoot = available.metanodes[edit.hostNodeId];
  if (existingRoot !== undefined && existingRoot !== edit.metanodeId) {
    throw new Error("View Metanode identity does not match the host");
  }
  if (available.nodes[edit.viewDefinitionNodeId] !== undefined) {
    throw new Error("View Definition Node identity already exists");
  }
  if ((available.sharedDefaultViewDefinitions[edit.hostNodeId] ?? []).length > 0) {
    throw new Error("View host already has a shared default View Definition");
  }
  const rootMutations: Mutation[] =
    existingRoot === undefined
      ? [
          { kind: "node-create", nodeId: edit.metanodeId },
          {
            kind: "metanode-attach",
            hostNodeId: edit.hostNodeId,
            metanodeId: edit.metanodeId,
          },
        ]
      : [];
  const mutations: Mutation[] = [
    ...rootMutations,
    {
      kind: "node-create",
      nodeId: edit.viewDefinitionNodeId,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.viewDefinitionOccurrenceId,
      nodeId: edit.viewDefinitionNodeId,
      parentNodeId: edit.metanodeId,
      anchor: edit.anchor,
    },
    {
      kind: "shared-default-view-definition-attach",
      hostNodeId: edit.hostNodeId,
      viewDefinitionNodeId: edit.viewDefinitionNodeId,
      viewDefinitionOccurrenceId: edit.viewDefinitionOccurrenceId,
    },
    {
      kind: "shared-default-view-definition-mode-set",
      viewDefinitionNodeId: edit.viewDefinitionNodeId,
      viewType: edit.viewType,
      previousViewType: null,
      observedModeFactIds: [],
    },
  ];
  const first = mutations[0];
  if (!first) {
    throw new Error("View Definition creation contains no mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function prepareSearchClauseCreation(
  edit: Extract<EditMutation, { kind: "search-supertag-clause-create" | "search-field-clause-create" }>,
  available: ScopedProjection,
): MutationWrite {
  const search = available.nodes[edit.searchNodeId];
  if (search?.nodeType !== "search") {
    throw new Error("Search clause host is not an active Search Node");
  }
  const existingRoot = available.metanodes[edit.searchNodeId];
  if (existingRoot !== undefined && existingRoot !== edit.metanodeId) {
    throw new Error("Search Metanode identity does not match the host");
  }
  if (available.nodes[edit.clauseNodeId] !== undefined) {
    throw new Error("Search clause Node identity already exists");
  }
  const rootMutations: Mutation[] =
    existingRoot === undefined
      ? [
          { kind: "node-create", nodeId: edit.metanodeId },
          {
            kind: "metanode-attach",
            hostNodeId: edit.searchNodeId,
            metanodeId: edit.metanodeId,
          },
        ]
      : [];
  const attachment: Mutation =
    edit.kind === "search-supertag-clause-create"
      ? {
          kind: "search-supertag-clause-attach",
          searchNodeId: edit.searchNodeId,
          clauseNodeId: edit.clauseNodeId,
          clauseOccurrenceId: edit.clauseOccurrenceId,
          supertagId: edit.supertagId,
        }
      : {
          kind: "search-field-clause-attach",
          searchNodeId: edit.searchNodeId,
          clauseNodeId: edit.clauseNodeId,
          clauseOccurrenceId: edit.clauseOccurrenceId,
          fieldDefinitionId: edit.fieldDefinitionId,
        };
  const mutations: Mutation[] = [
    ...rootMutations,
    { kind: "node-create", nodeId: edit.clauseNodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
    {
      kind: "occurrence-create",
      occurrenceId: edit.clauseOccurrenceId,
      nodeId: edit.clauseNodeId,
      parentNodeId: edit.metanodeId,
      anchor: edit.anchor,
    },
    attachment,
  ];
  const first = mutations[0];
  if (!first) {
    throw new Error("Search clause creation contains no mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
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
  const existingRoot = available.metanodes[edit.hostNodeId];
  if (existingRoot !== undefined && existingRoot !== edit.metanodeId) {
    throw new Error("Inline Alias Metanode identity does not match the host");
  }
  if (available.nodes[edit.aliasNodeId] !== undefined) {
    throw new Error("Inline Alias Node identity already exists");
  }
  const rootMutations: Mutation[] =
    existingRoot === undefined
      ? [
          { kind: "node-create", nodeId: edit.metanodeId },
          {
            kind: "metanode-attach",
            hostNodeId: edit.hostNodeId,
            metanodeId: edit.metanodeId,
          },
        ]
      : [];
  const mutations: Mutation[] = [
    ...rootMutations,
    { kind: "node-create", nodeId: edit.aliasNodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
    {
      kind: "occurrence-create",
      occurrenceId: edit.aliasOccurrenceId,
      nodeId: edit.aliasNodeId,
      parentNodeId: edit.metanodeId,
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
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
