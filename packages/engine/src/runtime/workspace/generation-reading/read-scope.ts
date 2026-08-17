import type { Mutation } from "../../../domain/fact/index.js";
import type { GenerationReadScope } from "./read-plan.js";

export function requiresOwnerGraph(mutation: Mutation): boolean {
  return (
    mutation.kind === "node-delete" ||
    mutation.kind === "node-owner-set" ||
    mutation.kind === "text-splice" ||
    mutation.kind === "text-mark" ||
    mutation.kind === "shared-default-view-definition-mode-set"
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
