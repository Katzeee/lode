import { requireString } from "../../shape-validation/index.js";
import type { Mutation } from "./types.js";

export function assertSearchClauseMutationShape(value: Record<string, unknown>): void {
  requireString(value.searchNodeId, "Search Node identity");
  requireString(value.clauseNodeId, "Search clause Node identity");
  requireString(value.clauseOccurrenceId, "Search clause Occurrence identity");
  if (value.kind === "search-supertag-clause-attach") {
    requireString(value.supertagId, "Search clause Supertag identity");
  } else {
    requireString(value.fieldDefinitionId, "Search clause Field Definition identity");
  }
}

export function validateSearchClauseMutation(
  mutation: Extract<Mutation, { kind: `search-${string}-clause-attach` }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.searchNodeId, "Search Node", factIdentity);
  requireIdentity(mutation.clauseNodeId, "Search clause Node", factIdentity);
  requireIdentity(mutation.clauseOccurrenceId, "Search clause Occurrence", factIdentity);
  if (mutation.searchNodeId === mutation.clauseNodeId) {
    throw new Error(`Search clause cannot be its host: ${factIdentity}`);
  }
  if (mutation.kind === "search-supertag-clause-attach") {
    requireIdentity(mutation.supertagId, "Search clause Supertag", factIdentity);
  } else {
    requireIdentity(mutation.fieldDefinitionId, "Search clause Field Definition", factIdentity);
  }
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
