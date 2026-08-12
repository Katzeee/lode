import type { FactSnapshot, JsonValue, Mutation, ViewMode } from "../../domain/fact/index.js";
import {
  replayNodeIdentity,
  replayOccurrenceIdentity,
  type Projection,
  type ProjectedNode,
  type TextAtom,
} from "../../domain/reconcile/index.js";
import {
  detachChild,
  insertChild,
  insertionIndex,
  removeOccurrence,
} from "./planning-projection-sequence.js";
import { applySchemaPlanningMutation } from "./planning-schema-relations.js";
import { applyPlanningValueMutation, withoutValue } from "./planning-projection-values.js";

export type MutableProjection = Omit<
  Projection,
  | "nodes"
  | "occurrences"
  | "children"
  | "canonicalOccurrences"
  | "addressedValues"
  | "schemaApplications"
  | "schemaFields"
  | "schemaFieldItems"
  | "schemaTemplateNodes"
  | "templateNodeInstances"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "definitionStatuses"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields"
> & {
  nodes: Record<string, MutableNode>;
  occurrences: Record<string, Projection["occurrences"][string]>;
  children: Record<string, readonly string[]>;
  canonicalOccurrences: Record<string, string>;
  addressedValues: Record<string, Readonly<Record<string, JsonValue>>>;
  schemaApplications: Record<string, string[]>;
  schemaFields: Record<string, string[]>;
  schemaFieldItems: Record<string, Projection["schemaFieldItems"][string][number][]>;
  schemaTemplateNodes: Record<string, string[]>;
  templateNodeInstances: Projection["templateNodeInstances"][number][];
  schemaExtensions: Record<string, string[]>;
  schemaSearchMembers: Record<string, string[]>;
  schemaExtensionConflicts: Record<string, string[]>;
  definitionStatuses: Record<string, Projection["definitionStatuses"][string]>;
  conflictIssues: Projection["conflictIssues"];
  effectiveFields: Projection["effectiveFields"];
  materializedFields: Record<string, Projection["materializedFields"][string][number][]>;
};
type MutableNode = Omit<ProjectedNode, "text" | "properties" | "metadata"> & {
  text: TextAtom[];
  properties: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
};

export function applyMutationToPlanningProjection(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
): void {
  if (applyNodeLifecycle(projection, mutation, factId, snapshot, view)) {
    return;
  }
  if (applyOccurrenceMutation(projection, mutation, snapshot, view)) {
    return;
  }
  applyContentMutation(projection, mutation, factId);
}

function applyNodeLifecycle(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
): boolean {
  if (mutation.kind === "node-create") {
    projection.nodes[mutation.nodeId] ??= {
      nodeId: mutation.nodeId,
      text: [],
      properties: {},
      metadata: {},
    };
    return true;
  }
  if (mutation.kind === "node-restore") {
    const restored = replayNodeIdentity(snapshot, view, mutation.nodeId);
    if (restored) {
      projection.nodes[mutation.nodeId] = {
        ...restored,
        text: restored.text.map((atom) => ({ ...atom, attributes: { ...atom.attributes } })),
        properties: { ...restored.properties },
        metadata: { ...restored.metadata },
      };
    }
    const status = projection.definitionStatuses[mutation.nodeId];
    if (status) {
      const deletionFactIds = status.deletionFactIds.filter(
        (deletionFactId) => deletionFactId !== mutation.deletionFactId,
      );
      projection.definitionStatuses[mutation.nodeId] = {
        ...status,
        state: deletionFactIds.length === 0 ? "active" : "deleted",
        deletionFactIds,
      };
    }
    return true;
  }
  if (mutation.kind !== "node-delete") {
    return false;
  }
  delete projection.nodes[mutation.nodeId];
  const status = projection.definitionStatuses[mutation.nodeId];
  if (status) {
    projection.definitionStatuses[mutation.nodeId] = {
      ...status,
      state: "deleted",
      deletionFactIds: [...status.deletionFactIds, factId],
    };
  }
  for (const occurrence of Object.values(projection.occurrences)) {
    if (occurrence.nodeId === mutation.nodeId) {
      removeOccurrence(projection, occurrence.occurrenceId, "cascade");
    }
  }
  return true;
}

function applyOccurrenceMutation(
  projection: MutableProjection,
  mutation: Mutation,
  snapshot: FactSnapshot,
  view: ViewMode,
): boolean {
  switch (mutation.kind) {
    case "occurrence-create":
      projection.occurrences[mutation.occurrenceId] = {
        occurrenceId: mutation.occurrenceId,
        nodeId: mutation.nodeId,
        parentOccurrenceId: mutation.parentOccurrenceId,
        properties: {},
        metadata: {},
        managed: false,
      };
      insertChild(projection, mutation.occurrenceId, mutation.parentOccurrenceId, mutation.anchor);
      return true;
    case "occurrence-restore": {
      const restored = replayOccurrenceIdentity(snapshot, view, mutation.occurrenceId);
      if (restored) {
        projection.occurrences[mutation.occurrenceId] = {
          ...restored,
          parentOccurrenceId: mutation.parentOccurrenceId,
        };
        insertChild(
          projection,
          mutation.occurrenceId,
          mutation.parentOccurrenceId,
          mutation.anchor,
        );
      }
      return true;
    }
    case "occurrence-delete":
      removeOccurrence(projection, mutation.occurrenceId, mutation.childPolicy);
      return true;
    case "field-value-delete":
      removeOccurrence(projection, mutation.valueOccurrenceId, "cascade");
      projection.materializedFields[mutation.ownerNodeId] = (
        projection.materializedFields[mutation.ownerNodeId] ?? []
      ).map((field) =>
        field.fieldDefinitionId === mutation.fieldDefinitionId
          ? {
              ...field,
              valueOccurrenceIds: field.valueOccurrenceIds.filter(
                (occurrenceId) => occurrenceId !== mutation.valueOccurrenceId,
              ),
            }
          : field,
      );
      return true;
    case "materialized-field-delete":
      removeOccurrence(projection, mutation.fieldOccurrenceId, "cascade");
      projection.materializedFields[mutation.ownerNodeId] = (
        projection.materializedFields[mutation.ownerNodeId] ?? []
      ).filter((field) => field.fieldDefinitionId !== mutation.fieldDefinitionId);
      return true;
    case "occurrence-move": {
      const occurrence = projection.occurrences[mutation.occurrenceId];
      if (occurrence) {
        detachChild(projection, mutation.occurrenceId);
        projection.occurrences[mutation.occurrenceId] = {
          ...occurrence,
          parentOccurrenceId: mutation.parentOccurrenceId,
        };
        insertChild(
          projection,
          mutation.occurrenceId,
          mutation.parentOccurrenceId,
          mutation.anchor,
        );
      }
      return true;
    }
    case "canonical-occurrence-set":
      projection.canonicalOccurrences[mutation.nodeId] = mutation.occurrenceId;
      return true;
    case "node-create":
    case "node-delete":
    case "node-restore":
    case "text-splice":
    case "text-mark":
    case "value-set":
    case "value-unset":
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
    case "template-node-detach":
    case "field-materialize":
    case "field-initialize":
      return false;
  }
}

function applyContentMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): void {
  if (applySchemaPlanningMutation(projection, mutation, factId)) {
    return;
  }
  if (mutation.kind === "text-splice") {
    const node = projection.nodes[mutation.nodeId];
    if (!node) {
      return;
    }
    const remaining = node.text.filter((atom) => !mutation.deleteAtomIds.includes(atom.id));
    const index = insertionIndex(remaining, mutation.anchor);
    const inserted = [...mutation.insert].map((value, offset): TextAtom => ({
      id: `${factId}#${offset}`,
      value,
      attributes: mutation.attributes ?? {},
      contributionId: factId,
    }));
    node.text = [...remaining.slice(0, index), ...inserted, ...remaining.slice(index)];
    return;
  }
  if (mutation.kind === "text-mark") {
    const node = projection.nodes[mutation.nodeId];
    if (!node) {
      return;
    }
    node.text = node.text.map((atom) =>
      mutation.atomIds.includes(atom.id)
        ? {
            ...atom,
            attributes:
              mutation.value.kind === "unset"
                ? withoutValue(atom.attributes, mutation.key)
                : { ...atom.attributes, [mutation.key]: mutation.value.value },
          }
        : atom,
    );
    return;
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    applyPlanningValueMutation(projection, mutation);
  }
}
