import type { NodeType, ViewMode } from "../../../domain/fact/index.js";
import type {
  EffectiveField,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
} from "../../../domain/reconcile/index.js";
import {
  readViewDefinition,
  type ViewFieldCell,
  type ViewResult,
} from "../../../domain/view/index.js";
import type {
  ProjectionSchemaSearchReader,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";

type ViewProjectionReader = ProjectionSnapshotReader & ProjectionSchemaSearchReader;

export async function readView(
  projections: ViewProjectionReader,
  generationId: string,
  view: ViewMode,
  viewNodeId: string,
  after: string | null,
  limit: number,
): Promise<ViewResult> {
  return projections.withReadLease(generationId, async () => {
    const [definitionNode, definitionNodeType] = await Promise.all([
      exactNode(projections, generationId, view, viewNodeId),
      exactNodeType(projections, generationId, view, viewNodeId),
    ]);
    const definition = readViewDefinition(definitionNode, definitionNodeType);
    const membership = await projections.schemaSearch(
      generationId,
      view,
      definition.schemaId,
      after,
      limit,
    );
    const rowIds = membership.nodeIds;
    const [nodes, effectiveFields, materializedFields] = await Promise.all([
      projections.read(generationId, view, "nodes", rowIds),
      projections.read(generationId, view, "effectiveFields", rowIds),
      projections.read(generationId, view, "materializedFields", rowIds),
    ]);
    const nodeById = batchMap(nodes);
    const effectiveById = batchMap(effectiveFields);
    const materializedById = batchMap(materializedFields);
    const valueOccurrenceIds = rowIds.flatMap((nodeId) =>
      (materializedById.get(nodeId) ?? []).flatMap((field) => field.valueOccurrenceIds),
    );
    const occurrences = await projections.read(
      generationId,
      view,
      "occurrences",
      valueOccurrenceIds,
    );
    const occurrenceById = batchMap(occurrences);
    return {
      generationId: membership.identity.generationId,
      frontier: membership.identity.frontier,
      view,
      viewNodeId,
      schemaId: definition.schemaId,
      layout: definition.layout,
      fieldDefinitionIds: definition.fieldDefinitionIds,
      rows: rowIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId);
        return node
          ? [
              {
                nodeId,
                text: node.text.map((atom) => atom.value).join(""),
                fields: definition.fieldDefinitionIds.map((fieldDefinitionId) =>
                  cell(
                    fieldDefinitionId,
                    effectiveById.get(nodeId) ?? [],
                    materializedById.get(nodeId) ?? [],
                    occurrenceById,
                  ),
                ),
              },
            ]
          : [];
      }),
      next: membership.next,
    };
  });
}

function cell(
  fieldDefinitionId: string,
  effectiveFields: readonly EffectiveField[],
  materializedFields: readonly MaterializedField[],
  occurrenceById: ReadonlyMap<string, ProjectedOccurrence>,
): ViewFieldCell {
  const materialized = materializedFields.find(
    (field) => field.fieldDefinitionId === fieldDefinitionId,
  );
  if (materialized) {
    return {
      fieldDefinitionId,
      state: "materialized",
      fieldNodeId: materialized.fieldNodeId,
      fieldOccurrenceId: materialized.fieldOccurrenceId,
      valueOccurrenceIds: materialized.valueOccurrenceIds,
      valueNodeIds: materialized.valueOccurrenceIds.flatMap((occurrenceId) => {
        const nodeId = occurrenceById.get(occurrenceId)?.nodeId;
        return nodeId ? [nodeId] : [];
      }),
    };
  }
  const effective = effectiveFields.some((field) => field.fieldDefinitionId === fieldDefinitionId);
  return {
    fieldDefinitionId,
    state: effective ? "placeholder" : "absent",
    fieldNodeId: null,
    fieldOccurrenceId: null,
    valueOccurrenceIds: [],
    valueNodeIds: [],
  };
}

async function exactNode(
  projections: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  nodeId: string,
): Promise<ProjectedNode> {
  const batch = await projections.read(generationId, view, "nodes", [nodeId]);
  const node = batch.entries.find((entry) => entry.identity === nodeId)?.value;
  if (!node) {
    throw new Error(`View Node does not exist: ${nodeId}`);
  }
  return node;
}

async function exactNodeType(
  projections: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  nodeId: string,
): Promise<NodeType | null> {
  const batch = await projections.read(generationId, view, "nodeStatuses", [nodeId]);
  const value = batch.entries.find((entry) => entry.identity === nodeId)?.value;
  if (!value) {
    throw new Error(`View Node status does not exist: ${nodeId}`);
  }
  return value.nodeType;
}

function batchMap<Value>(
  batch: Readonly<{
    entries: readonly Readonly<{ identity: string; value: Value }>[];
  }>,
): ReadonlyMap<string, Value> {
  const result = new Map<string, Value>();
  for (const entry of batch.entries) {
    result.set(entry.identity, entry.value);
  }
  return result;
}
