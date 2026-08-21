import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import {
  detachedViewValueNodeId,
  detachedViewValueOccurrenceId,
  NODE_VIEWS_DEFINITION_NODE_ID,
  canonicalJson,
  viewOptionNodeIds,
  type ViewOptionsSpec,
} from "../../../domain/fact/index.js";
import { nodeLocation, occurrenceAnchor, type ScopedProjection } from "../../../domain/reconcile/index.js";
import { supportsSharedDefaultViewHost } from "../../../domain/view/index.js";
import { validateSearchExpressionTargets } from "./search-expression-planning.js";
import { endpoint, nonemptyAtomicWrite, prepareMetanodeCreation } from "./relation-planning-support.js";

export function prepareSharedDefaultViewDefinitionCreation(
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-create" }>,
  available: ScopedProjection,
): MutationWrite {
  const host = available.nodes[edit.hostNodeId];
  if (host === undefined || !supportsSharedDefaultViewHost(host.intrinsicNodeType)) {
    throw new Error("View host is not an active Node");
  }
  if (
    available.nodes[edit.attachmentNodeId] !== undefined ||
    available.nodes[edit.viewDefinitionNodeId] !== undefined ||
    available.occurrences[edit.attachmentOccurrenceId] !== undefined ||
    available.occurrences[edit.viewDefinitionOccurrenceId] !== undefined
  ) {
    throw new Error("View attachment, Definition Node, or Occurrence identity already exists");
  }
  if ((available.sharedDefaultViewDefinitions[edit.hostNodeId] ?? []).length > 0) {
    throw new Error("View host already has a shared default View Definition");
  }
  return nonemptyAtomicWrite(
    [
      ...prepareMetanodeCreation(edit.hostNodeId, edit.metanodeId, available, "View"),
      { kind: "node-create", nodeId: edit.attachmentNodeId },
      {
        kind: "node-owner-set",
        nodeId: edit.attachmentNodeId,
        ownerNodeId: edit.metanodeId,
        previousOwnerNodeId: null,
      },
      {
        kind: "occurrence-create",
        occurrenceId: edit.attachmentOccurrenceId,
        nodeId: edit.attachmentNodeId,
        parentNodeId: edit.metanodeId,
        anchor: edit.anchor,
      },
      {
        kind: "node-create",
        nodeId: edit.viewDefinitionNodeId,
        ...(edit.seed === undefined ? {} : { seed: edit.seed }),
      },
      {
        kind: "node-owner-set",
        nodeId: edit.viewDefinitionNodeId,
        ownerNodeId: edit.attachmentNodeId,
        previousOwnerNodeId: null,
      },
      endpoint(edit.relationDefinitionOccurrenceId, NODE_VIEWS_DEFINITION_NODE_ID, edit.attachmentNodeId),
      endpoint(edit.viewDefinitionOccurrenceId, edit.viewDefinitionNodeId, edit.attachmentNodeId),
      {
        kind: "shared-default-view-definition-attach",
        hostNodeId: edit.hostNodeId,
        attachmentNodeId: edit.attachmentNodeId,
        attachmentOccurrenceId: edit.attachmentOccurrenceId,
        relationDefinitionOccurrenceId: edit.relationDefinitionOccurrenceId,
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
    ],
    "View Definition",
  );
}

export function prepareSharedDefaultViewDefinitionRemoval(
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-remove" }>,
  available: ScopedProjection,
): MutationWrite {
  const definitions = available.sharedDefaultViewDefinitions[edit.hostNodeId] ?? [];
  const definition = definitions.find(
    (candidate) =>
      candidate.attachmentNodeId === edit.attachmentNodeId &&
      candidate.attachmentOccurrenceId === edit.attachmentOccurrenceId &&
      candidate.relationDefinitionOccurrenceId === edit.relationDefinitionOccurrenceId &&
      candidate.viewDefinitionNodeId === edit.viewDefinitionNodeId &&
      candidate.viewDefinitionOccurrenceId === edit.viewDefinitionOccurrenceId,
  );
  const trashNodeId = available.workspaceSystemNodes.trash;
  const attachmentOccurrence = available.occurrences[edit.attachmentOccurrenceId];
  const viewDefinitionOccurrence = available.occurrences[edit.viewDefinitionOccurrenceId];
  const detachedValueNodeId = detachedViewValueNodeId(edit.attachmentNodeId);
  const detachedValueOccurrenceId = detachedViewValueOccurrenceId(edit.attachmentNodeId);
  if (
    definition === undefined ||
    trashNodeId === undefined ||
    attachmentOccurrence?.nodeId !== edit.attachmentNodeId ||
    viewDefinitionOccurrence?.nodeId !== edit.viewDefinitionNodeId ||
    available.nodeOwners[edit.attachmentNodeId] !== attachmentOccurrence.parentNodeId ||
    available.nodeOwners[edit.viewDefinitionNodeId] !== edit.attachmentNodeId ||
    viewDefinitionOccurrence.parentNodeId !== edit.attachmentNodeId ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.attachmentNodeId) !== "active" ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.viewDefinitionNodeId) !== "active"
  ) {
    throw new Error("Shared default View Definition is absent from the current Projection");
  }
  if (
    available.nodes[detachedValueNodeId] !== undefined ||
    available.occurrences[detachedValueOccurrenceId] !== undefined
  ) {
    throw new Error("Detached View value identity already exists");
  }
  const trashAnchor = { after: null, before: null, affinity: "after", fallback: "end" } as const;
  return atomicMutationWrite([
    {
      kind: "shared-default-view-definition-detach",
      hostNodeId: edit.hostNodeId,
      attachmentNodeId: edit.attachmentNodeId,
      attachmentOccurrenceId: edit.attachmentOccurrenceId,
      relationDefinitionOccurrenceId: edit.relationDefinitionOccurrenceId,
      viewDefinitionNodeId: edit.viewDefinitionNodeId,
      viewDefinitionOccurrenceId: edit.viewDefinitionOccurrenceId,
      detachedValueNodeId,
      detachedValueOccurrenceId,
    },
    { kind: "node-create", nodeId: detachedValueNodeId },
    {
      kind: "node-owner-set",
      nodeId: detachedValueNodeId,
      ownerNodeId: edit.attachmentNodeId,
      previousOwnerNodeId: null,
    },
    { kind: "node-delete", nodeId: edit.viewDefinitionNodeId },
    {
      kind: "node-owner-set",
      nodeId: edit.viewDefinitionNodeId,
      ownerNodeId: trashNodeId,
      previousOwnerNodeId: edit.attachmentNodeId,
    },
    {
      kind: "occurrence-move",
      occurrenceId: edit.viewDefinitionOccurrenceId,
      parentNodeId: trashNodeId,
      anchor: trashAnchor,
      previousParentNodeId: edit.attachmentNodeId,
      previousAnchor: occurrenceAnchor(available, edit.viewDefinitionOccurrenceId),
    },
    {
      kind: "occurrence-create",
      occurrenceId: detachedValueOccurrenceId,
      nodeId: detachedValueNodeId,
      parentNodeId: edit.attachmentNodeId,
      anchor: occurrenceAnchor(available, edit.viewDefinitionOccurrenceId),
    },
    { kind: "node-delete", nodeId: edit.attachmentNodeId },
    {
      kind: "node-owner-set",
      nodeId: edit.attachmentNodeId,
      ownerNodeId: trashNodeId,
      previousOwnerNodeId: attachmentOccurrence.parentNodeId,
    },
    {
      kind: "occurrence-move",
      occurrenceId: edit.attachmentOccurrenceId,
      parentNodeId: trashNodeId,
      anchor: trashAnchor,
      previousParentNodeId: attachmentOccurrence.parentNodeId,
      previousAnchor: occurrenceAnchor(available, edit.attachmentOccurrenceId),
    },
  ]);
}

export function prepareSharedDefaultViewDefinitionOptionsUpdate(
  edit: Extract<EditMutation, { kind: "shared-default-view-definition-options-update" }>,
  available: ScopedProjection,
): MutationWrite {
  const definition = (available.sharedDefaultViewDefinitions[edit.hostNodeId] ?? []).find(
    (candidate) => candidate.viewDefinitionNodeId === edit.viewDefinitionNodeId,
  );
  if (definition === undefined) {
    throw new Error("Shared default View Definition is absent from the current Projection");
  }
  if (definition.optionsConflicted) {
    throw new Error("View options conflict must be resolved before another update");
  }
  if (canonicalJson(definition.options) === canonicalJson(edit.options)) {
    throw new Error("View options update has no effect");
  }
  validateViewOptions(edit.viewDefinitionNodeId, edit.options, available);
  return atomicMutationWrite([
    {
      kind: "shared-default-view-definition-options-set",
      hostNodeId: edit.hostNodeId,
      viewDefinitionNodeId: edit.viewDefinitionNodeId,
      options: edit.options,
      previousOptions: definition.options,
      observedOptionsFactIds: definition.optionsContributionIds,
    },
  ]);
}

function validateViewOptions(
  viewDefinitionNodeId: string,
  options: ViewOptionsSpec,
  available: ScopedProjection,
): void {
  const current = Object.values(available.sharedDefaultViewDefinitions)
    .flat()
    .find((definition) => definition.viewDefinitionNodeId === viewDefinitionNodeId);
  const currentIds = new Set(current === undefined ? [] : viewOptionNodeIds(current.options));
  const usedByOtherViews = new Set(
    Object.values(available.sharedDefaultViewDefinitions)
      .flat()
      .filter((definition) => definition.viewDefinitionNodeId !== viewDefinitionNodeId)
      .flatMap((definition) => viewOptionNodeIds(definition.options)),
  );
  for (const identity of viewOptionNodeIds(options)) {
    if (usedByOtherViews.has(identity) || (available.nodes[identity] !== undefined && !currentIds.has(identity))) {
      throw new Error(`View option identity already exists: ${identity}`);
    }
  }
  for (const fieldDefinitionId of [
    ...options.columns.map((column) => column.fieldDefinitionId),
    ...(options.sort === null ? [] : [options.sort.fieldDefinitionId]),
    ...(options.group === null ? [] : [options.group.fieldDefinitionId]),
  ]) {
    if (available.nodes[fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
      throw new Error("View option Field Definition is not active");
    }
  }
  if (options.filter !== null) {
    validateSearchExpressionTargets(options.filter.expression, available);
  }
}
