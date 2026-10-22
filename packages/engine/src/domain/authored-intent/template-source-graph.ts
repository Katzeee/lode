import { materializedFieldNodeId, materializedFieldOccurrenceId } from "../fact/index.js";
import type { TemplateNodeCopy } from "../fact/template-copy.js";
import type { InterpretedProjection } from "../reconcile/index.js";

export type TemplateGraphNode = TemplateNodeCopy &
  Readonly<{
    parentNodeId: string;
    fieldDefinitionId?: string;
  }>;
export type TemplateGraphReference = Readonly<{
  sourceOccurrenceId: string;
  parentNodeId: string;
  targetNodeId: string;
}>;

/** Definition endpoints remain shared; ordinary owned content forms the copy boundary. */
export function templateSourceGraph(
  ownerNodeId: string,
  sourceNodeId: string,
  identity: Readonly<{ instanceNodeId: string; instanceOccurrenceId: string }>,
  graph: InterpretedProjection,
) {
  const fields = new Map(
    Object.values(graph.materializedFields)
      .flat()
      .map((field) => [field.fieldNodeId, field]),
  );
  const effective = new Set(
    graph.templateNodeInstances.filter((item) => item.state !== "detached").map((item) => item.instanceOccurrenceId),
  );
  const nodes: TemplateGraphNode[] = [];
  const references: TemplateGraphReference[] = [];
  const copied = new Map<string, TemplateGraphNode>();
  const visit = (source: string, parent: string, sourcePath: readonly string[]): void => {
    if (copied.has(source)) {
      throw new Error("Owned template content repeats a Node");
    }
    const field = fields.get(source);
    const root = sourcePath.length === 0;
    const instanceNodeId = root
      ? identity.instanceNodeId
      : field
        ? materializedFieldNodeId(parent, field.fieldDefinitionId)
        : `${identity.instanceNodeId}/node/${encodeURIComponent(source)}`;
    const instanceOccurrenceId = root
      ? identity.instanceOccurrenceId
      : field
        ? materializedFieldOccurrenceId(parent, field.fieldDefinitionId)
        : `${identity.instanceOccurrenceId}/node/${encodeURIComponent(source)}`;
    const copy: TemplateGraphNode = {
      sourceNodeId: source,
      sourcePath,
      instanceNodeId,
      instanceOccurrenceId,
      parentNodeId: parent,
      ...(field ? { fieldDefinitionId: field.fieldDefinitionId } : {}),
    };
    nodes.push(copy);
    copied.set(source, copy);
    for (const occurrenceId of field?.valueOccurrenceIds ?? graph.childOccurrences[source] ?? []) {
      if (effective.has(occurrenceId)) {
        continue;
      }
      const occurrence = graph.occurrences[occurrenceId];
      if (!occurrence || occurrence.parentNodeId !== source) {
        continue;
      }
      if (graph.nodeOwners[occurrence.nodeId] === source) {
        visit(occurrence.nodeId, instanceNodeId, [...sourcePath, occurrenceId]);
      } else {
        references.push({
          sourceOccurrenceId: occurrenceId,
          parentNodeId: instanceNodeId,
          targetNodeId: occurrence.nodeId,
        });
      }
    }
  };
  visit(sourceNodeId, ownerNodeId, []);
  return { nodes, references, copied };
}
