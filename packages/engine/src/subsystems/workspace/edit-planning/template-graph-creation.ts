import {
  END_SEQUENCE_ANCHOR as end,
  fieldDefinitionEndpointOccurrenceId,
  type SequenceAnchor,
} from "../../../domain/fact/index.js";
import type { NodeContentInput } from "../../../domain/edit/node-content-input.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { metanodeNodeId } from "../../../domain/fact/index.js";
import type { templateSourceGraph } from "../../../domain/authored-intent/index.js";
import { copyTemplateContent, nodeContentActions } from "./template-content-creation.js";
import { retainNodeContentReferences } from "./node-content-retention.js";
import type { TemplateReferenceCopy } from "../../../domain/fact/template-copy.js";
import type { templateEditProgram } from "./template-edit-program.js";

export function createTemplateGraph(
  source: ReturnType<typeof templateSourceGraph>,
  graph: InterpretedProjection,
  program: ReturnType<typeof templateEditProgram>,
  anchor: SequenceAnchor,
  editedNodeId: string,
  content: NodeContentInput | undefined,
  editedTags: ReadonlySet<string>,
) {
  const referenceCopies: TemplateReferenceCopy[] = [];
  const root = source.nodes[0];
  if (!root) {
    throw new Error("Template root is absent");
  }
  for (const node of source.nodes) {
    if (node.fieldDefinitionId) {
      program.append({
        kind: "field-materialize",
        ownerNodeId: node.parentNodeId,
        fieldDefinitionId: node.fieldDefinitionId,
      });
    } else {
      const type = graph.nodes[node.sourceNodeId]?.intrinsicNodeType;
      program.append({
        kind: "node-create",
        nodeId: node.instanceNodeId,
        ownerNodeId: node.parentNodeId,
        originalPlacement: { placementId: node.instanceOccurrenceId, anchor: node === root ? anchor : end },
        ...(type ? { intrinsicNodeType: type } : {}),
      });
    }
  }
  const target = (nodeId: string) => source.copied.get(nodeId)?.instanceNodeId ?? nodeId;
  for (const node of source.nodes) {
    const raw =
      node.instanceNodeId === editedNodeId && content ? content : copyTemplateContent(node.sourceNodeId, graph);
    const input = retainNodeContentReferences(raw, node.sourceNodeId, graph, target);
    program.appendContent(
      nodeContentActions(
        node.instanceNodeId,
        input,
        program.finalActionId,
        node.instanceNodeId,
        (sourceReferenceId, instanceReferenceId) => referenceCopies.push({ sourceReferenceId, instanceReferenceId }),
      ),
    );
    const meta = metanodeNodeId(node.instanceNodeId);
    if (graph.metanodes[node.sourceNodeId] && !program.current().nodes[meta]) {
      program.append({ kind: "node-create", nodeId: meta, ownerNodeId: node.instanceNodeId, originalPlacement: null });
    }
    for (const tag of graph.supertagApplications[node.sourceNodeId] ?? []) {
      if (node.instanceNodeId !== editedNodeId || editedTags.has(tag.supertagId)) {
        program.append({
          kind: "supertag-application-add",
          hostNodeId: node.instanceNodeId,
          supertagId: tag.supertagId,
          anchor: end,
        });
      }
    }
  }
  const fields = new Map(
    Object.values(graph.materializedFields)
      .flat()
      .map((field) => [field.fieldNodeId, field]),
  );
  const referenceId = (id: string) => `${root.instanceOccurrenceId}/reference/${encodeURIComponent(id)}`;
  const copyByParent = new Map(source.nodes.map((node) => [node.instanceNodeId, node]));
  for (const reference of source.references) {
    const parent = copyByParent.get(reference.parentNodeId)!;
    const field = fields.get(parent.sourceNodeId);
    const sourceSiblings = graph.childOccurrences[parent.sourceNodeId] ?? [];
    const index = sourceSiblings.indexOf(reference.sourceOccurrenceId);
    const mapped = (id: string) => {
      if (field?.definitionOccurrenceId === id) {
        return fieldDefinitionEndpointOccurrenceId(parent.instanceOccurrenceId);
      }
      const occurrence = graph.occurrences[id];
      const own = occurrence && source.copied.get(occurrence.nodeId);
      if (
        occurrence &&
        own?.parentNodeId === parent.instanceNodeId &&
        graph.nodeOwners[occurrence.nodeId] === parent.sourceNodeId
      ) {
        return own.instanceOccurrenceId;
      }
      return source.references.some(
        (item) => item.sourceOccurrenceId === id && item.parentNodeId === parent.instanceNodeId,
      )
        ? referenceId(id)
        : null;
    };
    const after =
      sourceSiblings
        .slice(0, index)
        .map(mapped)
        .filter((id): id is string => id !== null)
        .at(-1) ?? null;
    const before =
      sourceSiblings
        .slice(index + 1)
        .map(mapped)
        .find((id) => id !== null && program.current().occurrences[id] !== undefined) ?? null;
    program.append({
      kind: "placement-create",
      placementId: referenceId(reference.sourceOccurrenceId),
      nodeId: target(reference.targetNodeId),
      parentNodeId: parent.instanceNodeId,
      anchor: { ...end, after, before, affinity: "before" },
    });
  }
  return referenceCopies;
}
