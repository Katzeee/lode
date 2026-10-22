import type { EditAction, FactActionId, ProjectedNode } from "@lode/sdk";
import { contentToSource, type OutlineContent } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { nodeSource, sameSource } from "./node-source.js";
import { templateNodeIntents } from "./workspace-template-content.js";
import { editNodeSource } from "./node-edit.js";

export type WorkspaceContentTarget =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "template-instance"; ownerNodeId: string; templateNodeId: string; sourcePath: readonly string[] }>
  | Readonly<{ kind: "template-default"; nodeId: string; supertagId: string; templateFieldId: FactActionId }>;

export function writeWorkspaceContent(
  target: WorkspaceContentTarget,
  node: ProjectedNode,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
  baseline: OutlineContent,
): readonly EditAction[] {
  if (target.kind === "template-instance") {
    const instance = workspaceTemplateInstance(target, graph);
    if (instance?.state === "detached") {
      return editNodeSource(node, content, graph, baseline);
    }
    if (instance?.state !== "linked") {
      throw new Error("The template source is no longer editable in this instance.");
    }
    return sameSource(content, nodeSource(node, graph))
      ? []
      : [
          {
            kind: "template-node-edit",
            ownerNodeId: target.ownerNodeId,
            templateNodeId: target.templateNodeId,
            sourcePath: target.sourcePath,
            intents: templateNodeIntents(node, content, graph, baseline),
          },
        ];
  }
  if (target.kind === "node") {
    return editNodeSource(node, content, graph, baseline);
  }
  const field = graph.templateFields[target.supertagId]?.find((field) => field.factActionId === target.templateFieldId);
  if (!field || field.staticDefaultValueNodeId !== target.nodeId) {
    throw new Error("This template field is no longer available");
  }
  const value = contentToSource(content);
  if (
    node.content.every((atom) => atom.kind === "text") &&
    node.content.map((atom) => (atom.kind === "text" ? atom.value : "")).join("") === value &&
    !field.staticDefaultConflicted
  ) {
    return [];
  }
  return [
    {
      kind: "supertag-template-field-static-default-set",
      supertagId: target.supertagId,
      templateFieldId: target.templateFieldId,
      value,
    },
  ];
}

export function workspaceContentKey(target: WorkspaceContentTarget): string {
  return target.kind === "template-instance"
    ? `template-content:${JSON.stringify([target.ownerNodeId, target.templateNodeId, target.sourcePath])}`
    : target.nodeId;
}

export function workspaceContentNode(
  target: WorkspaceContentTarget,
  graph: WorkspaceSnapshot,
): ProjectedNode | undefined {
  if (target.kind !== "template-instance") {
    return graph.nodes[target.nodeId];
  }
  const instance = workspaceTemplateInstance(target, graph);
  if (!instance || instance.state === "reference") {
    return undefined;
  }
  if (instance.state === "detached") {
    const copy = instance.copies.find(
      (item) =>
        item.sourcePath.length === target.sourcePath.length &&
        item.sourcePath.every((id, index) => id === target.sourcePath[index]),
    );
    return copy ? graph.nodes[copy.instanceNodeId] : undefined;
  }
  let nodeId = instance.templateNodeId;
  for (const occurrenceId of target.sourcePath) {
    const occurrence = graph.occurrences[occurrenceId];
    if (!occurrence || occurrence.parentNodeId !== nodeId || graph.nodeOwners[occurrence.nodeId] !== nodeId) {
      return undefined;
    }
    nodeId = occurrence.nodeId;
  }
  return graph.nodes[nodeId];
}

export function workspaceTemplateOccurrence(
  target: Extract<WorkspaceContentTarget, { kind: "template-instance" }>,
  graph: WorkspaceSnapshot,
): string | undefined {
  const instance = workspaceTemplateInstance(target, graph);
  if (!instance || instance.state === "reference") {
    return undefined;
  }
  return instance.state === "linked"
    ? (target.sourcePath.at(-1) ?? instance.instanceOccurrenceId)
    : instance.copies.find((copy) => JSON.stringify(copy.sourcePath) === JSON.stringify(target.sourcePath))
        ?.instanceOccurrenceId;
}

export function workspaceTemplateInstance(
  target: Extract<WorkspaceContentTarget, { kind: "template-instance" }>,
  graph: WorkspaceSnapshot,
) {
  return graph.templateNodeInstances.find(
    (item) => item.ownerNodeId === target.ownerNodeId && item.templateNodeId === target.templateNodeId,
  );
}
