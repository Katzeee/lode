import type { DebugNodeQueryRequest, DebugNodeResult } from "@lode/sdk";
import { CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID, URL_DEFINITION_NODE_ID } from "../../../domain/fact/index.js";
import type { MaterializedField, ProjectedNode, Projection } from "../../../domain/reconcile/index.js";
import type { ProjectionGenerationReader } from "../projection/index.js";

export async function queryDebugNode(
  query: DebugNodeQueryRequest,
  generationId: string,
  projections: ProjectionGenerationReader,
): Promise<DebugNodeResult> {
  const generation = await projections.load(generationId);
  const projection = generation[query.perspective];
  const node = projection.nodes[query.nodeId] ?? null;
  const metanodeId = projection.metanodes[query.nodeId] ?? null;
  const materializedFields = projection.materializedFields[query.nodeId] ?? [];
  return {
    generationId,
    frontier: projection.identity.frontier,
    perspective: query.perspective,
    nodeId: query.nodeId,
    available: node !== null,
    node,
    ownerNodeId: projection.nodeOwners[query.nodeId] ?? null,
    metanodeId,
    childOccurrenceIds: projection.childOccurrences[query.nodeId] ?? [],
    metanodeChildOccurrenceIds: metanodeId === null ? [] : (projection.childOccurrences[metanodeId] ?? []),
    materializedFields,
    url: fieldText(materializedFields, URL_DEFINITION_NODE_ID, projection),
    codeLanguage: fieldText(materializedFields, CODE_BLOCK_LANGUAGE_DEFINITION_NODE_ID, projection),
  };
}

function fieldText(
  fields: readonly MaterializedField[],
  fieldDefinitionId: string,
  projection: Projection,
): string | null {
  const matches = fields.filter((field) => field.fieldDefinitionId === fieldDefinitionId);
  if (matches.length !== 1 || matches[0]?.valueOccurrenceIds.length !== 1) {
    return null;
  }
  const occurrenceId = matches[0].valueOccurrenceIds[0];
  const valueNodeId = occurrenceId === undefined ? undefined : projection.occurrences[occurrenceId]?.nodeId;
  const valueNode = valueNodeId === undefined ? undefined : projection.nodes[valueNodeId];
  return valueNode === undefined ? null : textContent(valueNode);
}

function textContent(node: ProjectedNode): string {
  return node.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
}
