import type { ContributionFact, Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { compensateContentMutation } from "./compensation-content.js";
import { compensateSupertagMutation } from "./compensation-supertag.js";
import { compensateInlineReferenceMutation } from "./compensation-inline-reference.js";
import { compensateStructureMutation } from "./compensation-structure.js";
import { compensateViewMutation } from "./compensation-view.js";
import { compensateFieldDefinitionConfiguration } from "./compensation-field-definition.js";
import { compensateSearchMutation } from "./compensation-search.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

type CompensationPolicy =
  "content" | "structure" | "supertag" | "inline-reference" | "field-definition" | "search" | "view" | "none";

const COMPENSATION_POLICY_BY_MUTATION = {
  "node-create": "structure",
  "node-delete": "structure",
  "node-restore": "structure",
  "node-owner-set": "structure",
  "intrinsic-node-type-declare": "structure",
  "metanode-attach": "none",
  "occurrence-create": "structure",
  "occurrence-delete": "structure",
  "occurrence-restore": "structure",
  "occurrence-move": "structure",
  "supertag-apply": "supertag",
  "supertag-remove": "supertag",
  "supertag-extension-add": "supertag",
  "supertag-extension-remove": "supertag",
  "supertag-template-node-add": "supertag",
  "supertag-template-node-remove": "supertag",
  "supertag-template-field-attach": "supertag",
  "supertag-template-field-existing-attach": "supertag",
  "supertag-template-field-detach": "supertag",
  "supertag-template-field-discoverability-set": "supertag",
  "supertag-template-field-visibility-configure": "supertag",
  "supertag-optional-field-contribution-attach": "supertag",
  "supertag-optional-field-contribution-detach": "supertag",
  "template-node-detach": "none",
  "field-materialize": "none",
  "field-value-delete": "structure",
  "materialized-field-delete": "structure",
  "field-datatype-configure": "field-definition",
  "field-cardinality-configure": "field-definition",
  "field-optionality-configure": "field-definition",
  "field-initialization-expression-configure": "field-definition",
  "text-splice": "content",
  "text-mark": "content",
  "inline-reference-create": "inline-reference",
  "inline-reference-delete": "inline-reference",
  "inline-reference-alias-attach": "inline-reference",
  "inline-reference-alias-detach": "inline-reference",
  "search-expression-attach": "search",
  "search-expression-detach": "search",
  "shared-default-view-definition-attach": "none",
  "shared-default-view-definition-detach": "view",
  "shared-default-view-definition-mode-set": "view",
  "shared-default-view-definition-sort-by-name-set": "view",
  "shared-default-view-definition-options-set": "view",
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
        : policy === "supertag"
          ? compensateSupertagMutation(target, activeFacts, projection)
          : policy === "inline-reference"
            ? compensateInlineReferenceMutation(target, projection)
            : policy === "field-definition"
              ? compensateFieldDefinitionConfiguration(target, activeFacts)
              : policy === "search"
                ? compensateSearchMutation(target)
                : compensateViewMutation(target, activeFacts, projection);
  if (step === null) {
    throw new Error(`Compensation policy ${policy} did not handle ${target.body.mutation.kind}`);
  }
  return step;
}
