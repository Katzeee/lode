import type { EditAction } from "../../../domain/edit/index.js";
import { authoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import {
  CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
  URL_DEFINITION_NODE_ID,
  type GraphAction,
  type NodeSeed,
} from "../../../domain/fact/index.js";
import { nodeLocation, type MaterializedField, type ScopedProjection } from "../../../domain/reconcile/index.js";
import { validatePlainOrOptionsValue } from "./plain-field-value-validation.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;

type BreadthEdit = Extract<
  EditAction,
  {
    kind: "field-value-create" | "url-node-create" | "code-node-configure";
  }
>;

export function expandBreadthEdit(edit: BreadthEdit, available: ScopedProjection): AuthoredActionBatch {
  switch (edit.kind) {
    case "field-value-create":
      return expandFieldValueCreate(edit, available);
    case "url-node-create":
      return expandUrlNodeCreate(edit, available);
    case "code-node-configure":
      return expandCodeNodeConfigure(edit, available);
  }
}

function expandFieldValueCreate(
  edit: Extract<BreadthEdit, { kind: "field-value-create" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  requireActiveNode(edit.ownerNodeId, available, "Field owner");
  validatePlainOrOptionsValue(edit.fieldDefinitionId, edit.ownerNodeId, available);
  const prefix = ensureMaterializedField(
    edit.ownerNodeId,
    edit.fieldDefinitionId,
    edit.fieldNodeId,
    edit.fieldOccurrenceId,
    available,
  );
  requireUnusedNode(edit.valueNodeId, available, "Field Value");
  requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
  return nonemptyBatch([
    ...prefix,
    {
      kind: "node-create",
      nodeId: edit.valueNodeId,
      ownerNodeId: edit.fieldNodeId,
      originalPlacement: { placementId: edit.valueOccurrenceId, anchor: edit.anchor },
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
  ]);
}

function expandUrlNodeCreate(
  edit: Extract<BreadthEdit, { kind: "url-node-create" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
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
  return authoredActionBatch([
    {
      kind: "node-create",
      nodeId: edit.nodeId,
      ownerNodeId: edit.parentNodeId,
      originalPlacement: { placementId: edit.occurrenceId, anchor: edit.anchor },
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "field-materialize",
      ownerNodeId: edit.nodeId,
      fieldDefinitionId: URL_DEFINITION_NODE_ID,
      fieldNodeId: edit.urlFieldNodeId,
      fieldOccurrenceId: edit.urlFieldOccurrenceId,
    },
    {
      kind: "node-create",
      nodeId: edit.urlValueNodeId,
      ownerNodeId: edit.urlFieldNodeId,
      originalPlacement: { placementId: edit.urlValueOccurrenceId, anchor: END },
      seed: textSeed(edit.url),
    },
  ]);
}

function expandCodeNodeConfigure(
  edit: Extract<BreadthEdit, { kind: "code-node-configure" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  requireActiveNode(edit.nodeId, available, "Code Node");
  if (fieldFor(available, edit.nodeId, CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID) !== undefined) {
    throw new Error("Code Node already has a language configuration");
  }
  requireUnusedNode(edit.languageFieldNodeId, available, "Code language Field");
  requireUnusedNode(edit.languageValueNodeId, available, "Code language Value");
  requireUnusedOccurrence(edit.languageFieldOccurrenceId, available, "Code language Field");
  requireUnusedOccurrence(edit.languageValueOccurrenceId, available, "Code language Value");
  return authoredActionBatch([
    {
      kind: "field-materialize",
      ownerNodeId: edit.nodeId,
      fieldDefinitionId: CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID,
      fieldNodeId: edit.languageFieldNodeId,
      fieldOccurrenceId: edit.languageFieldOccurrenceId,
    },
    {
      kind: "node-create",
      nodeId: edit.languageValueNodeId,
      ownerNodeId: edit.languageFieldNodeId,
      originalPlacement: { placementId: edit.languageValueOccurrenceId, anchor: END },
      seed: textSeed(edit.language),
    },
  ]);
}

function ensureMaterializedField(
  ownerNodeId: string,
  fieldDefinitionId: string,
  fieldNodeId: string,
  fieldOccurrenceId: string,
  available: ScopedProjection,
): readonly GraphAction[] {
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

function textSeed(value: string): NodeSeed {
  return { text: [{ value, attributes: {} }] };
}

function nonemptyBatch(actions: readonly GraphAction[]): AuthoredActionBatch {
  const first = actions[0];
  if (first === undefined) {
    throw new Error("Composite edit contains no actions");
  }
  return authoredActionBatch([first, ...actions.slice(1)]);
}
