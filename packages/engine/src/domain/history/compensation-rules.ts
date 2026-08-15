import type { ContributionFact, Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { compensateContentMutation } from "./compensation-content.js";
import { compensateSchemaMutation } from "./compensation-schema.js";
import { compensateStructureMutation } from "./compensation-structure.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

type CompensationPolicy = "content" | "structure" | "schema" | "none";

const COMPENSATION_POLICY_BY_MUTATION = {
  "node-create": "structure",
  "node-delete": "structure",
  "node-restore": "structure",
  "node-owner-set": "structure",
  "node-type-declare": "structure",
  "occurrence-create": "structure",
  "occurrence-delete": "structure",
  "occurrence-restore": "structure",
  "occurrence-move": "structure",
  "schema-apply": "schema",
  "schema-remove": "schema",
  "schema-field-add": "schema",
  "schema-field-remove": "schema",
  "schema-field-configure": "schema",
  "schema-extension-add": "schema",
  "schema-extension-remove": "schema",
  "schema-template-node-add": "schema",
  "schema-template-node-remove": "schema",
  "template-node-detach": "none",
  "field-materialize": "none",
  "field-value-delete": "structure",
  "materialized-field-delete": "structure",
  "field-initialize": "none",
  "text-splice": "content",
  "text-mark": "content",
  "value-set": "content",
  "value-unset": "content",
} as const satisfies Readonly<Record<Mutation["kind"], CompensationPolicy>>;

export function compensateMutation(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const policy = COMPENSATION_POLICY_BY_MUTATION[target.body.mutation.kind];
  if (policy === "none") {
    return noCompensation();
  }
  const step =
    policy === "content"
      ? compensateContentMutation(target, targetIds, activeFacts, projection)
      : policy === "structure"
        ? compensateStructureMutation(target, targetIds, activeFacts, projection)
        : compensateSchemaMutation(target, activeFacts, projection);
  if (step === null) {
    throw new Error(`Compensation policy ${policy} did not handle ${target.body.mutation.kind}`);
  }
  return step;
}
