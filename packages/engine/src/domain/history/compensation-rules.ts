import type { ContributionFact } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { compensateContentMutation } from "./compensation-content.js";
import { compensateSchemaMutation } from "./compensation-schema.js";
import { compensateStructureMutation } from "./compensation-structure.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateMutation(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  return (
    compensateContentMutation(target, targetIds, activeFacts, projection) ??
    compensateStructureMutation(target, targetIds, activeFacts, projection) ??
    compensateSchemaMutation(target, activeFacts, projection) ??
    noCompensation()
  );
}
