import type { FactSnapshot, JsonValue, Mutation, ViewMode } from "../../domain/fact/index.js";
import {
  replayNodeIdentity,
  replayOccurrenceIdentity,
  type Projection,
  type ProjectedNode,
  type TextAtom,
} from "../../domain/reconcile/index.js";
import { detachChild, insertChild, removeOccurrence } from "./planning-projection-sequence.js";
import { applyPlanningContentMutation } from "./planning-projection-content.js";

export type MutableProjection = Omit<
  Projection,
  | "nodes"
  | "occurrences"
  | "children"
  | "nodeOwners"
  | "addressedValues"
  | "schemaApplications"
  | "schemaFields"
  | "templateFields"
  | "schemaTemplateNodes"
  | "templateNodeInstances"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "nodeStatuses"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields"
> & {
  nodes: Record<string, MutableNode>;
  occurrences: Record<string, Projection["occurrences"][string]>;
  children: Record<string, readonly string[]>;
  nodeOwners: Record<string, string | null>;
  addressedValues: Record<string, Readonly<Record<string, JsonValue>>>;
  schemaApplications: Record<string, string[]>;
  schemaFields: Record<string, string[]>;
  templateFields: Record<string, Projection["templateFields"][string][number][]>;
  schemaTemplateNodes: Record<string, string[]>;
  templateNodeInstances: Projection["templateNodeInstances"][number][];
  schemaExtensions: Record<string, string[]>;
  schemaSearchMembers: Record<string, string[]>;
  schemaExtensionConflicts: Record<string, string[]>;
  nodeStatuses: Record<string, Projection["nodeStatuses"][string]>;
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
  applyPlanningContentMutation(projection, mutation, factId);
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
      text: (mutation.seed?.text ?? []).map((atom, index) => ({
        id: `${factId}#${index}`,
        value: atom.value,
        attributes: { ...atom.attributes },
        contributionId: factId,
      })),
      properties: { ...(mutation.seed?.properties ?? {}) },
      metadata: { ...(mutation.seed?.metadata ?? {}) },
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
    const status = projection.nodeStatuses[mutation.nodeId];
    if (status) {
      const deletionFactIds = status.deletionFactIds.filter(
        (deletionFactId) => deletionFactId !== mutation.deletionFactId,
      );
      if (deletionFactIds.length > 0) {
        projection.nodeStatuses[mutation.nodeId] = {
          ...status,
          state: "deleted",
          deletionFactIds,
        };
      } else if (mutation.nodeId in projection.nodeOwners) {
        projection.nodeStatuses[mutation.nodeId] = {
          ...status,
          state: "active",
          deletionFactIds,
        };
      } else {
        delete projection.nodeStatuses[mutation.nodeId];
      }
    }
    return true;
  }
  if (mutation.kind !== "node-delete") {
    return false;
  }
  delete projection.nodes[mutation.nodeId];
  delete projection.nodeOwners[mutation.nodeId];
  const status = projection.nodeStatuses[mutation.nodeId];
  if (status) {
    projection.nodeStatuses[mutation.nodeId] = {
      ...status,
      state: "deleted",
      deletionFactIds: [...status.deletionFactIds, factId],
    };
  }
  for (const occurrence of Object.values(projection.occurrences)) {
    if (occurrence.nodeId === mutation.nodeId) {
      removeOccurrence(projection, occurrence.occurrenceId);
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
      if (!(mutation.nodeId in projection.nodeOwners)) {
        projection.nodeOwners[mutation.nodeId] = mutation.parentNodeId;
      }
      projection.occurrences[mutation.occurrenceId] = {
        occurrenceId: mutation.occurrenceId,
        nodeId: mutation.nodeId,
        parentNodeId: mutation.parentNodeId,
        properties: {},
        metadata: {},
        derived: false,
      };
      insertChild(projection, mutation.occurrenceId, mutation.parentNodeId, mutation.anchor);
      setNodePlacementState(projection, mutation.nodeId);
      return true;
    case "occurrence-restore": {
      const restored = replayOccurrenceIdentity(snapshot, view, mutation.occurrenceId);
      if (restored) {
        projection.nodeOwners[restored.nodeId] ??= mutation.parentNodeId;
        projection.occurrences[mutation.occurrenceId] = {
          ...restored,
          parentNodeId: mutation.parentNodeId,
        };
        insertChild(projection, mutation.occurrenceId, mutation.parentNodeId, mutation.anchor);
        setNodePlacementState(projection, restored.nodeId);
      }
      return true;
    }
    case "occurrence-delete": {
      const occurrence = projection.occurrences[mutation.occurrenceId];
      removeOccurrence(projection, mutation.occurrenceId);
      removeOccurrenceFromFields(projection, mutation.occurrenceId);
      if (occurrence) {
        if (projection.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
          delete projection.nodeOwners[occurrence.nodeId];
        }
        setNodePlacementState(projection, occurrence.nodeId);
      }
      return true;
    }
    case "field-value-delete":
      return true;
    case "materialized-field-delete":
      return true;
    case "occurrence-move": {
      const occurrence = projection.occurrences[mutation.occurrenceId];
      if (occurrence) {
        const movesOriginal = projection.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId;
        detachChild(projection, mutation.occurrenceId);
        projection.occurrences[mutation.occurrenceId] = {
          ...occurrence,
          parentNodeId: mutation.parentNodeId,
        };
        insertChild(projection, mutation.occurrenceId, mutation.parentNodeId, mutation.anchor);
        if (movesOriginal) {
          projection.nodeOwners[occurrence.nodeId] = mutation.parentNodeId;
        }
      }
      return true;
    }
    case "node-owner-set":
      applyNodeOwnerMutation(projection, mutation);
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

function setNodePlacementState(projection: MutableProjection, nodeId: string): void {
  const status = projection.nodeStatuses[nodeId];
  if (status?.state === "deleted") {
    return;
  }
  if (nodeId in projection.nodeOwners) {
    projection.nodeStatuses[nodeId] = {
      nodeId,
      roles: status?.roles ?? [],
      state: "active",
      deletionFactIds: status?.deletionFactIds ?? [],
    };
  } else {
    delete projection.nodeStatuses[nodeId];
  }
}

function removeOccurrenceFromFields(projection: MutableProjection, occurrenceId: string): void {
  for (const [ownerNodeId, fields] of Object.entries(projection.materializedFields)) {
    projection.materializedFields[ownerNodeId] = fields
      .filter((field) => field.fieldOccurrenceId !== occurrenceId)
      .map((field) => ({
        ...field,
        valueOccurrenceIds: field.valueOccurrenceIds.filter((id) => id !== occurrenceId),
      }));
  }
}

function applyNodeOwnerMutation(
  projection: MutableProjection,
  mutation: Extract<Mutation, Readonly<{ kind: "node-owner-set" }>>,
): void {
  projection.nodeOwners[mutation.nodeId] = mutation.ownerNodeId;
}
