import { END_SEQUENCE_ANCHOR, type EditAction, type SequenceAnchor } from "@lode/sdk";
import type { OutlineContent } from "@lode/ui";
import {
  workspaceContentNode,
  workspaceTemplateOccurrence,
  type WorkspaceContentTarget,
} from "./workspace-content-target.js";
import { createNodeActions, insertionParent } from "./workspace-structure.js";
import { templateNodeInsertion, templateNodeIntents } from "./workspace-template-content.js";
import { nodeSource } from "./node-source.js";
import { editNodeSource } from "./node-edit.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";

export type Insertion = Readonly<{
  nodeId: string;
  occurrenceId: string;
  destination:
    | Readonly<{ kind: "children"; parentNodeId: string }>
    | Readonly<{ kind: "relative"; occurrenceId: string; placement: "before" | "after" | "child" }>
    | Readonly<{
        kind: "template";
        target: Extract<WorkspaceContentTarget, { kind: "template-instance" }>;
        placement: "before" | "after" | "child";
        before?: OutlineContent;
      }>
    | Readonly<{ kind: "field"; ownerNodeId: string; fieldDefinitionId: string }>;
  anchor: SequenceAnchor;
  confirmed: boolean;
  context?: Extract<WorkspaceContentTarget, { kind: "template-instance" }>;
}>;
export function projectInsertions(
  graph: WorkspaceSnapshot,
  insertions: ReadonlyMap<string, Insertion>,
): WorkspaceSnapshot {
  const nodes = { ...graph.nodes },
    occurrences = { ...graph.occurrences },
    nodeOwners = { ...graph.nodeOwners },
    childOccurrences = { ...graph.childOccurrences };
  const materializedFields = Object.fromEntries(
    Object.entries(graph.materializedFields).map(([id, fields]) => [id, fields.map((field) => ({ ...field }))]),
  );
  for (const insertion of insertions.values()) {
    const { nodeId, occurrenceId, anchor } = insertion;
    if (occurrences[occurrenceId]) {
      continue;
    }
    nodes[nodeId] = { nodeId, content: [], intrinsicNodeType: null };
    if (insertion.destination.kind === "field") {
      continue;
    }
    const location =
      insertion.destination.kind === "template"
        ? insertionParent(
            graph,
            workspaceTemplateOccurrence(insertion.destination.target, graph) ?? null,
            insertion.destination.placement,
          )
        : insertion.destination.kind === "relative"
          ? insertionParent(
              { ...graph, occurrences },
              insertion.destination.occurrenceId,
              insertion.destination.placement,
            )
          : { parentNodeId: insertion.destination.parentNodeId, anchor };
    const parentNodeId = location.parentNodeId;
    occurrences[occurrenceId] = { occurrenceId, nodeId, parentNodeId, derived: false };
    nodeOwners[nodeId] = parentNodeId;
    // A linked source is shared. Its pending child belongs only to this editor context.
    if (insertion.context) {
      continue;
    }
    const siblings = [...(childOccurrences[parentNodeId] ?? [])];
    const after = location.anchor.after === null ? -1 : siblings.indexOf(location.anchor.after);
    const before = location.anchor.before === null ? -1 : siblings.indexOf(location.anchor.before);
    const index =
      after >= 0 ? after + 1 : before >= 0 ? before : location.anchor.fallback === "start" ? 0 : siblings.length;
    siblings.splice(index, 0, occurrenceId);
    childOccurrences[parentNodeId] = siblings;
    for (const fields of Object.values(materializedFields)) {
      const field = fields.find((field) => field.fieldNodeId === parentNodeId);
      if (field) {
        field.valueOccurrenceIds = siblings.filter(
          (id) => field.valueOccurrenceIds.includes(id) || id === occurrenceId,
        );
      }
    }
  }
  return { ...graph, nodes, occurrences, nodeOwners, childOccurrences, materializedFields };
}

function templateInsertionActions(
  insertion: Insertion,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
): readonly EditAction[] {
  const destination = insertion.destination;
  if (destination.kind !== "template") {
    throw new Error("Expected template insertion context");
  }
  const { target, before, placement } = destination;
  const node = workspaceContentNode(target, graph);
  if (!node) {
    throw new Error("The insertion source is no longer available");
  }
  return [
    {
      kind: "template-node-edit",
      ownerNodeId: target.ownerNodeId,
      templateNodeId: target.templateNodeId,
      sourcePath: target.sourcePath,
      intents: [
        ...(before ? templateNodeIntents(node, before, graph, nodeSource(node, graph)) : []),
        templateNodeInsertion(node, content, graph, insertion, placement),
      ],
    },
  ];
}

export function insertionActions(
  insertion: Insertion,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
): readonly EditAction[] {
  const { destination, nodeId, occurrenceId, anchor } = insertion;
  if (destination.kind === "template") {
    return templateInsertionActions(insertion, content, graph);
  }
  if (destination.kind === "field") {
    return [
      {
        kind: "field-value-create",
        ownerNodeId: destination.ownerNodeId,
        fieldDefinitionId: destination.fieldDefinitionId,
        valueNodeId: nodeId,
        valueOccurrenceId: occurrenceId,
        anchor,
      },
      ...editNodeSource({ nodeId, content: [], intrinsicNodeType: null }, content, graph),
    ];
  }
  const location =
    destination.kind === "relative"
      ? insertionParent(graph, destination.occurrenceId, destination.placement)
      : { parentNodeId: destination.parentNodeId, anchor };
  return createNodeActions(graph, location.parentNodeId, content, location.anchor, insertion);
}

export function nextInsertion(
  graph: WorkspaceSnapshot,
  parentKey: string | null,
  placement: "before" | "after" | "child",
  pending?: Insertion,
): Pick<Insertion, "destination" | "anchor" | "context"> {
  if (pending?.destination.kind === "field") {
    return placement === "child"
      ? { destination: { kind: "children", parentNodeId: pending.nodeId }, anchor: END_SEQUENCE_ANCHOR }
      : {
          destination: pending.destination,
          anchor: {
            ...END_SEQUENCE_ANCHOR,
            after: placement === "after" ? parentKey : null,
            before: placement === "before" ? parentKey : null,
          },
        };
  }
  if (pending) {
    return {
      destination: { kind: "relative", occurrenceId: pending.occurrenceId, placement },
      anchor: END_SEQUENCE_ANCHOR,
      ...(placement !== "child" && pending.context ? { context: pending.context } : {}),
    };
  }
  const { parentNodeId, anchor } = insertionParent(graph, parentKey, placement);
  return { destination: { kind: "children", parentNodeId }, anchor };
}
