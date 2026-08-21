import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import {
  CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
  URL_DEFINITION_NODE_ID,
  VIEW_SORT_ASCENDING_NODE_ID,
  VIEW_SORT_FIELD_DEFINITION_NODE_ID,
  VIEW_SORT_NODE_NAME_NODE_ID,
  VIEW_SORT_ORDER_DEFINITION_NODE_ID,
  type Mutation,
  type NodeSeed,
  type SequenceAnchor,
} from "../../../domain/fact/index.js";
import { nodeLocation, type MaterializedField, type ScopedProjection } from "../../../domain/reconcile/index.js";
import { sortViewChildrenByNodeName } from "../../../domain/view/index.js";
import { requirePlainOrOptionsValueAdmission } from "./plain-field-value-admission.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;

type BreadthEdit = Extract<
  EditMutation,
  {
    kind:
      | "debug-node-open"
      | "field-value-create"
      | "url-node-create"
      | "code-node-configure"
      | "shared-default-view-definition-sort-by-name-create";
  }
>;

export function expandBreadthEdit(edit: BreadthEdit, available: ScopedProjection): MutationWrite {
  switch (edit.kind) {
    case "debug-node-open":
      return expandDebugNodeOpen(edit, available);
    case "field-value-create":
      return expandFieldValueCreate(edit, available);
    case "url-node-create":
      return expandUrlNodeCreate(edit, available);
    case "code-node-configure":
      return expandCodeNodeConfigure(edit, available);
    case "shared-default-view-definition-sort-by-name-create":
      return expandViewSortByNameCreate(edit, available);
  }
}

function expandDebugNodeOpen(
  edit: Extract<BreadthEdit, { kind: "debug-node-open" }>,
  available: ScopedProjection,
): MutationWrite {
  requireActiveNode(edit.hostNodeId, available, "Debug node host");
  if (available.metanodes[edit.hostNodeId] !== undefined) {
    throw new Error("Debug node host already has a Metanode; query it without another write");
  }
  requireUnusedNode(edit.metanodeId, available, "Debug node Metanode");
  return atomicMutationWrite([
    { kind: "node-create", nodeId: edit.metanodeId },
    { kind: "node-owner-set", nodeId: edit.metanodeId, ownerNodeId: edit.hostNodeId, previousOwnerNodeId: null },
    { kind: "metanode-attach", hostNodeId: edit.hostNodeId, metanodeId: edit.metanodeId },
  ]);
}

function expandFieldValueCreate(
  edit: Extract<BreadthEdit, { kind: "field-value-create" }>,
  available: ScopedProjection,
): MutationWrite {
  requireActiveNode(edit.ownerNodeId, available, "Field owner");
  requirePlainOrOptionsValueAdmission(edit.fieldDefinitionId, edit.ownerNodeId, available);
  const prefix = ensureMaterializedField(
    edit.ownerNodeId,
    edit.fieldDefinitionId,
    edit.fieldNodeId,
    edit.fieldOccurrenceId,
    available,
  );
  requireUnusedNode(edit.valueNodeId, available, "Field Value");
  requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
  return nonemptyAtomic([
    ...prefix,
    { kind: "node-create", nodeId: edit.valueNodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
    { kind: "node-owner-set", nodeId: edit.valueNodeId, ownerNodeId: edit.fieldNodeId, previousOwnerNodeId: null },
    occurrence(edit.valueOccurrenceId, edit.valueNodeId, edit.fieldNodeId, edit.anchor),
  ]);
}

function expandUrlNodeCreate(
  edit: Extract<BreadthEdit, { kind: "url-node-create" }>,
  available: ScopedProjection,
): MutationWrite {
  requireActiveNode(edit.parentNodeId, available, "URL Node parent");
  for (const [nodeId, label] of [
    [edit.nodeId, "URL Node"],
    [edit.urlFieldNodeId, "URL Field"],
    [edit.urlValueNodeId, "URL Value"],
  ] as const) {
    requireUnusedNode(nodeId, available, label);
  }
  for (const [occurrenceId, label] of [
    [edit.occurrenceId, "URL Node"],
    [edit.urlFieldOccurrenceId, "URL Field"],
    [edit.urlValueOccurrenceId, "URL Value"],
  ] as const) {
    requireUnusedOccurrence(occurrenceId, available, label);
  }
  return atomicMutationWrite([
    { kind: "node-create", nodeId: edit.nodeId, ...(edit.seed === undefined ? {} : { seed: edit.seed }) },
    { kind: "node-owner-set", nodeId: edit.nodeId, ownerNodeId: edit.parentNodeId, previousOwnerNodeId: null },
    occurrence(edit.occurrenceId, edit.nodeId, edit.parentNodeId, edit.anchor),
    {
      kind: "field-materialize",
      ownerNodeId: edit.nodeId,
      fieldDefinitionId: URL_DEFINITION_NODE_ID,
      fieldNodeId: edit.urlFieldNodeId,
      fieldOccurrenceId: edit.urlFieldOccurrenceId,
    },
    { kind: "node-create", nodeId: edit.urlValueNodeId, seed: textSeed(edit.url) },
    {
      kind: "node-owner-set",
      nodeId: edit.urlValueNodeId,
      ownerNodeId: edit.urlFieldNodeId,
      previousOwnerNodeId: null,
    },
    occurrence(edit.urlValueOccurrenceId, edit.urlValueNodeId, edit.urlFieldNodeId, END),
  ]);
}

function expandCodeNodeConfigure(
  edit: Extract<BreadthEdit, { kind: "code-node-configure" }>,
  available: ScopedProjection,
): MutationWrite {
  requireActiveNode(edit.nodeId, available, "Code Node");
  if (fieldFor(available, edit.nodeId, CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID) !== undefined) {
    throw new Error("Code Node already has a language configuration");
  }
  requireUnusedNode(edit.languageFieldNodeId, available, "Code language Field");
  requireUnusedNode(edit.languageValueNodeId, available, "Code language Value");
  requireUnusedOccurrence(edit.languageFieldOccurrenceId, available, "Code language Field");
  requireUnusedOccurrence(edit.languageValueOccurrenceId, available, "Code language Value");
  return atomicMutationWrite([
    {
      kind: "field-materialize",
      ownerNodeId: edit.nodeId,
      fieldDefinitionId: CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
      fieldNodeId: edit.languageFieldNodeId,
      fieldOccurrenceId: edit.languageFieldOccurrenceId,
    },
    { kind: "node-create", nodeId: edit.languageValueNodeId, seed: textSeed(edit.language) },
    {
      kind: "node-owner-set",
      nodeId: edit.languageValueNodeId,
      ownerNodeId: edit.languageFieldNodeId,
      previousOwnerNodeId: null,
    },
    occurrence(edit.languageValueOccurrenceId, edit.languageValueNodeId, edit.languageFieldNodeId, END),
  ]);
}

function expandViewSortByNameCreate(
  edit: Extract<BreadthEdit, { kind: "shared-default-view-definition-sort-by-name-create" }>,
  available: ScopedProjection,
): MutationWrite {
  const definition = Object.values(available.sharedDefaultViewDefinitions)
    .flat()
    .find(
      (candidate) =>
        candidate.hostNodeId === edit.hostNodeId && candidate.viewDefinitionNodeId === edit.viewDefinitionNodeId,
    );
  if (definition === undefined) {
    throw new Error("View Definition is not selected by an active shared default attachment");
  }
  if (definition.sortByNameAscending !== null) {
    throw new Error("View Definition already sorts by Node name ascending");
  }
  for (const [nodeId, label] of [
    [edit.sortOrderFieldNodeId, "Sort order Field"],
    [edit.sortFieldNodeId, "Sort field"],
  ] as const) {
    requireUnusedNode(nodeId, available, label);
  }
  for (const [occurrenceId, label] of [
    [edit.sortOrderFieldOccurrenceId, "Sort order Field"],
    [edit.sortFieldOccurrenceId, "Sort field"],
    [edit.nodeNameOccurrenceId, "Node name"],
    [edit.ascendingOccurrenceId, "ASC"],
  ] as const) {
    requireUnusedOccurrence(occurrenceId, available, label);
  }
  const childSource = (available.childOccurrences[definition.hostNodeId] ?? []).flatMap((occurrenceId) => {
    const child = available.occurrences[occurrenceId];
    return child === undefined
      ? []
      : [{ sourceKind: "occurrence" as const, sourceIdentity: occurrenceId, targetNodeId: child.nodeId }];
  });
  const reorderedOccurrences = sortViewChildrenByNodeName(childSource, available).map(
    (child, index, ordered): Mutation => ({
      kind: "occurrence-move",
      occurrenceId: child.sourceIdentity,
      parentNodeId: definition.hostNodeId,
      anchor:
        index === 0
          ? { after: null, before: null, affinity: "before", fallback: "start" }
          : { after: ordered[index - 1]?.sourceIdentity ?? null, before: null, affinity: "after", fallback: "end" },
    }),
  );
  return atomicMutationWrite([
    {
      kind: "shared-default-view-definition-sort-by-name-set",
      hostNodeId: edit.hostNodeId,
      viewDefinitionNodeId: edit.viewDefinitionNodeId,
      sortOrderFieldNodeId: edit.sortOrderFieldNodeId,
      sortOrderFieldOccurrenceId: edit.sortOrderFieldOccurrenceId,
      sortFieldNodeId: edit.sortFieldNodeId,
      sortFieldOccurrenceId: edit.sortFieldOccurrenceId,
      nodeNameOccurrenceId: edit.nodeNameOccurrenceId,
      ascendingOccurrenceId: edit.ascendingOccurrenceId,
      enabled: true,
      previousEnabled: false,
    },
    {
      kind: "field-materialize",
      ownerNodeId: edit.viewDefinitionNodeId,
      fieldDefinitionId: VIEW_SORT_ORDER_DEFINITION_NODE_ID,
      fieldNodeId: edit.sortOrderFieldNodeId,
      fieldOccurrenceId: edit.sortOrderFieldOccurrenceId,
    },
    {
      kind: "field-materialize",
      ownerNodeId: edit.sortOrderFieldNodeId,
      fieldDefinitionId: VIEW_SORT_FIELD_DEFINITION_NODE_ID,
      fieldNodeId: edit.sortFieldNodeId,
      fieldOccurrenceId: edit.sortFieldOccurrenceId,
    },
    occurrence(edit.nodeNameOccurrenceId, VIEW_SORT_NODE_NAME_NODE_ID, edit.sortFieldNodeId, END),
    occurrence(edit.ascendingOccurrenceId, VIEW_SORT_ASCENDING_NODE_ID, edit.sortFieldNodeId, {
      after: edit.nodeNameOccurrenceId,
      before: null,
      affinity: "after",
      fallback: "end",
    }),
    ...reorderedOccurrences,
  ]);
}

function ensureMaterializedField(
  ownerNodeId: string,
  fieldDefinitionId: string,
  fieldNodeId: string,
  fieldOccurrenceId: string,
  available: ScopedProjection,
): readonly Mutation[] {
  const existing = fieldFor(available, ownerNodeId, fieldDefinitionId);
  if (existing !== undefined) {
    if (existing.fieldNodeId !== fieldNodeId || existing.fieldOccurrenceId !== fieldOccurrenceId) {
      throw new Error("Field identity does not match the materialized Field");
    }
    return [];
  }
  requireUnusedNode(fieldNodeId, available, "Field");
  requireUnusedOccurrence(fieldOccurrenceId, available, "Field");
  return [{ kind: "field-materialize", ownerNodeId, fieldDefinitionId, fieldNodeId, fieldOccurrenceId }];
}

function fieldFor(
  projection: ScopedProjection,
  ownerNodeId: string,
  fieldDefinitionId: string,
): MaterializedField | undefined {
  return projection.materializedFields[ownerNodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId);
}

function requireActiveNode(nodeId: string, available: ScopedProjection, label: string): void {
  if (nodeLocation(available.identity.workspaceNodeId, available, nodeId) !== "active") {
    throw new Error(`${label} is not an active Node`);
  }
}

function requireUnusedNode(nodeId: string, available: ScopedProjection, label: string): void {
  if (available.nodes[nodeId] !== undefined) {
    throw new Error(`${label} identity already exists`);
  }
}

function requireUnusedOccurrence(occurrenceId: string, available: ScopedProjection, label: string): void {
  if (available.occurrences[occurrenceId] !== undefined) {
    throw new Error(`${label} Occurrence identity already exists`);
  }
}

function occurrence(occurrenceId: string, nodeId: string, parentNodeId: string, anchor: SequenceAnchor): Mutation {
  return { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor };
}

function textSeed(value: string): NodeSeed {
  return { text: [{ value, attributes: {} }] };
}

function nonemptyAtomic(mutations: readonly Mutation[]): MutationWrite {
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Composite edit contains no mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}
