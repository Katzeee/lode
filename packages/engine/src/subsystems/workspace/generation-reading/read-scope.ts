import type { AuthoredAction } from "../../../domain/fact/index.js";
import { metanodeNodeId } from "../../../domain/reconcile/index.js";

export type GenerationReadScope = Readonly<{
  nodes: Set<string>;
  occurrences: Set<string>;
  childOccurrences: Set<string>;
  supertags: Set<string>;
  instanceSupertags: Set<string>;
  fields: Set<string>;
}>;

export function requiresOwnerGraph(action: AuthoredAction): boolean {
  return (
    action.kind === "node-trash" ||
    action.kind === "rich-text-splice" ||
    action.kind === "rich-text-mark" ||
    action.kind === "inline-alias-attach" ||
    action.kind === "inline-alias-detach" ||
    action.kind === "view-mode-set" ||
    action.kind === "search-expression-add" ||
    action.kind === "search-expression-configure" ||
    action.kind === "search-expression-move" ||
    action.kind === "search-expression-remove" ||
    action.kind === "search-expression-restore"
  );
}

export function emptyGenerationReadScope(): GenerationReadScope {
  return {
    nodes: new Set(),
    occurrences: new Set(),
    childOccurrences: new Set(),
    supertags: new Set(),
    instanceSupertags: new Set(),
    fields: new Set(),
  };
}

export function addMetanodeReadScope(scope: GenerationReadScope, hostNodeId: string): void {
  const metanodeId = metanodeNodeId(hostNodeId);
  scope.nodes.add(metanodeId);
  scope.childOccurrences.add(metanodeId);
}
