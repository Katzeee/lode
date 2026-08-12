import type { ViewMode } from "../../domain/fact/index.js";
import type {
  EffectiveField,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
} from "../../domain/reconcile/index.js";
import {
  readViewDefinition,
  type ViewFieldCell,
  type ViewResult,
} from "../../domain/view/index.js";
import type {
  ProjectionGenerationStore,
  ProjectionShardBatch,
} from "./proposal-workspace-types.js";

export async function readView(
  generations: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  viewNodeId: string,
  after: string | null,
  limit: number,
): Promise<ViewResult> {
  return generations.withReadLease(generationId, async () => {
    const definitionNode = await exactNode(generations, generationId, view, viewNodeId);
    const definition = readViewDefinition(definitionNode);
    const membership = await generations.schemaSearch(
      generationId,
      view,
      definition.schemaId,
      after,
      limit,
    );
    const rowIds = membership.nodeIds;
    const [nodes, effectiveFields, materializedFields] = await Promise.all([
      generations.read(generationId, view, "nodes", rowIds),
      generations.read(generationId, view, "effectiveFields", rowIds),
      generations.read(generationId, view, "materializedFields", rowIds),
    ]);
    const nodeById = batchMap(nodes, isProjectedNode, "View row Node");
    const effectiveById = batchMap(effectiveFields, isEffectiveFields, "View Effective Fields");
    const materializedById = batchMap(
      materializedFields,
      isMaterializedFields,
      "View Materialized Fields",
    );
    const valueOccurrenceIds = rowIds.flatMap((nodeId) =>
      (materializedById.get(nodeId) ?? []).flatMap((field) => field.valueOccurrenceIds),
    );
    const occurrences = await generations.read(
      generationId,
      view,
      "occurrences",
      valueOccurrenceIds,
    );
    const occurrenceById = batchMap(occurrences, isProjectedOccurrence, "View Field Value");
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
  generations: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  nodeId: string,
): Promise<ProjectedNode> {
  const batch = await generations.read(generationId, view, "nodes", [nodeId]);
  const node = batch.entries.find((entry) => entry.identity === nodeId)?.value;
  if (!isProjectedNode(node)) {
    throw new Error(`View Node does not exist: ${nodeId}`);
  }
  return node;
}

function batchMap<T>(
  batch: ProjectionShardBatch,
  validate: (value: unknown) => value is T,
  label: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const entry of batch.entries) {
    if (!validate(entry.value)) {
      throw new Error(`${label} shard is invalid`);
    }
    result.set(entry.identity, entry.value);
  }
  return result;
}

function isProjectedNode(value: unknown): value is ProjectedNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeId" in value &&
    typeof value.nodeId === "string" &&
    "text" in value &&
    Array.isArray(value.text) &&
    (value.text as unknown[]).every(isTextAtom) &&
    "properties" in value &&
    typeof value.properties === "object" &&
    value.properties !== null
  );
}

function isTextAtom(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
  );
}

function isProjectedOccurrence(value: unknown): value is ProjectedOccurrence {
  return (
    typeof value === "object" &&
    value !== null &&
    "occurrenceId" in value &&
    typeof value.occurrenceId === "string" &&
    "nodeId" in value &&
    typeof value.nodeId === "string"
  );
}

function isEffectiveFields(value: unknown): value is readonly EffectiveField[] {
  return Array.isArray(value) && (value as unknown[]).every(isEffectiveField);
}

function isMaterializedFields(value: unknown): value is readonly MaterializedField[] {
  return Array.isArray(value) && (value as unknown[]).every(isMaterializedField);
}

function isEffectiveField(value: unknown): value is EffectiveField {
  return (
    typeof value === "object" &&
    value !== null &&
    "fieldDefinitionId" in value &&
    typeof value.fieldDefinitionId === "string"
  );
}

function isMaterializedField(value: unknown): value is MaterializedField {
  return (
    typeof value === "object" &&
    value !== null &&
    "fieldDefinitionId" in value &&
    typeof value.fieldDefinitionId === "string" &&
    "fieldNodeId" in value &&
    typeof value.fieldNodeId === "string" &&
    "fieldOccurrenceId" in value &&
    typeof value.fieldOccurrenceId === "string" &&
    "valueOccurrenceIds" in value &&
    Array.isArray(value.valueOccurrenceIds) &&
    (value.valueOccurrenceIds as unknown[]).every((identity) => typeof identity === "string")
  );
}
