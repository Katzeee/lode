import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { schemaApplicationInitializations } from "./field-initialization-planner.js";

export function followUpMutations(
  mutation: Mutation,
  before: ScopedProjection,
  after: ScopedProjection,
): readonly Mutation[] {
  if (mutation.kind !== "schema-apply") {
    return [];
  }
  const alreadyApplied = (before.schemaApplications[mutation.nodeId] ?? []).includes(
    mutation.schemaId,
  );
  return alreadyApplied ? [] : schemaApplicationInitializations(mutation, after);
}
