import type { AuthoredAction } from "../fact/index.js";
import { locateInlineReference, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation } from "./contract.js";

export function assertTemplateReferenceCopies(
  action: Extract<AuthoredAction, { kind: "template-node-detach" }>,
  available: InterpretedProjection,
  resulting: InterpretedProjection,
): void {
  const copies = new Map(action.copies.map((copy) => [copy.sourceNodeId, copy.instanceNodeId]));
  const sourceHosts = new Map<string, string>();
  const aliasParents = new Map<string, string[]>();
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    for (const item of available.nodes[nodeId]?.content ?? []) {
      if (item.kind !== "inline-reference") {
        continue;
      }
      sourceHosts.set(item.id, nodeId);
      if (item.aliasNodeId) {
        aliasParents.set(item.aliasNodeId, [...(aliasParents.get(item.aliasNodeId) ?? []), item.id]);
        visit(item.aliasNodeId);
      }
    }
  };
  action.copies.forEach((copy) => visit(copy.sourceNodeId));
  const allowedHosts = (sourceHost: string): readonly string[] => {
    const direct = copies.get(sourceHost);
    if (direct) {
      return [direct];
    }
    return (aliasParents.get(sourceHost) ?? []).flatMap((sourceReferenceId) =>
      action.referenceCopies
        .filter((copy) => copy.sourceReferenceId === sourceReferenceId)
        .flatMap((copy) => {
          const alias = locateInlineReference(resulting.nodes, copy.instanceReferenceId)?.reference.aliasNodeId;
          return alias ? [alias] : [];
        }),
    );
  };
  const used = new Set<string>();
  for (const copy of action.referenceCopies) {
    const source = locateInlineReference(available.nodes, copy.sourceReferenceId);
    const instance = locateInlineReference(resulting.nodes, copy.instanceReferenceId);
    const host = sourceHosts.get(copy.sourceReferenceId);
    if (
      !source ||
      !instance ||
      !host ||
      !allowedHosts(host).includes(instance.hostNodeId) ||
      used.has(copy.instanceReferenceId) ||
      instance.reference.targetNodeId !== (copies.get(source.reference.targetNodeId) ?? source.reference.targetNodeId)
    ) {
      throw new AuthoredIntentViolation("Template Reference copy does not match its source identity");
    }
    used.add(copy.instanceReferenceId);
  }
}
