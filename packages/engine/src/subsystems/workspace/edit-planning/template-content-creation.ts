import type { NodeContentInput } from "../../../domain/edit/node-content-input.js";
import type { FactActionId, GraphAction } from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";

export function copyTemplateContent(
  nodeId: string,
  projection: InterpretedProjection,
  ancestors = new Set<string>(),
  target: (nodeId: string) => string = (nodeId) => nodeId,
): NodeContentInput {
  if (ancestors.has(nodeId)) {
    throw new Error("Template content alias contains a cycle");
  }
  const node = projection.nodes[nodeId];
  if (!node) {
    throw new Error("Template content source is absent");
  }
  const visited = new Set(ancestors).add(nodeId);
  return {
    items: node.content.map((item) =>
      item.kind === "text"
        ? { kind: "text", value: item.value, attributes: item.attributes }
        : {
            kind: "inline-reference",
            targetNodeId: target(item.targetNodeId),
            sourceReferenceId: item.id,
            ...(item.aliasNodeId === null
              ? {}
              : { alias: copyTemplateContent(item.aliasNodeId, projection, visited, target) }),
          },
    ),
  };
}

export function nodeContentActions(
  nodeId: string,
  content: NodeContentInput,
  finalActionId: (index: number) => FactActionId,
  identityRoot = nodeId,
  referenceCopy?: (sourceReferenceId: string, instanceReferenceId: string) => void,
): readonly GraphAction[] {
  const actions: GraphAction[] = [];
  const create = (id: string, input: NodeContentInput, prefix: string) => {
    let after: string | null = null;
    input.items.forEach((item, index) => {
      const anchor = { after, before: null, affinity: "after" as const, fallback: "end" as const };
      if (item.kind === "text") {
        const characters = [...item.value];
        if (characters.length === 0) {
          return;
        }
        const producer = finalActionId(actions.length);
        actions.push({
          kind: "rich-text-splice",
          nodeId: id,
          deleteAtomIds: [],
          anchor,
          insert: item.value,
          attributes: item.attributes,
        });
        after = `${producer}#${characters.length - 1}`;
        return;
      }
      const inlineReferenceId = `${prefix}/inline/${index}`;
      actions.push({
        kind: "inline-reference-create",
        inlineReferenceId,
        hostNodeId: id,
        targetNodeId: item.targetNodeId,
        anchor,
      });
      if (item.sourceReferenceId) {
        referenceCopy?.(item.sourceReferenceId, inlineReferenceId);
      }
      after = inlineReferenceId;
      if (item.alias) {
        const aliasNodeId = `${prefix}/alias/${index}`;
        actions.push({ kind: "node-create", nodeId: aliasNodeId, ownerNodeId: id, originalPlacement: null });
        create(aliasNodeId, item.alias, aliasNodeId);
        actions.push({ kind: "inline-alias-attach", inlineReferenceId, aliasNodeId });
      }
    });
  };
  create(nodeId, content, identityRoot);
  return actions;
}
