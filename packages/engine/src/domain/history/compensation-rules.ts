import type { FactAction, AuthoredAction } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { compensateContentAction } from "./compensation-content.js";
import { compensateSupertagAction } from "./compensation-supertag.js";
import { compensateInlineReferenceAction } from "./compensation-inline-reference.js";
import { compensateStructureAction } from "./compensation-structure.js";
import { compensateViewAction } from "./compensation-view.js";
import { compensateFieldDefinitionConfiguration } from "./compensation-field-definition.js";
import { compensateSearchAction } from "./compensation-search.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

type CompensationPolicy =
  "content" | "structure" | "supertag" | "inline-reference" | "field-definition" | "search" | "view" | "none";

const COMPENSATION_POLICY_BY_ACTION = {
  "workspace-bootstrap": "none",
  "node-create": "structure",
  "node-trash": "structure",
  "node-restore": "structure",
  "original-promote": "structure",
  "placement-create": "structure",
  "placement-remove": "structure",
  "placement-move": "structure",
  "supertag-application-add": "supertag",
  "supertag-membership-remove": "supertag",
  "supertag-extension-add": "supertag",
  "supertag-extension-remove": "supertag",
  "template-member-add": "supertag",
  "template-member-remove": "supertag",
  "template-field-add": "supertag",
  "template-field-remove": "supertag",
  "template-field-restore": "supertag",
  "template-field-visibility-set": "supertag",
  "template-field-static-default-set": "supertag",
  "optional-field-contribution-add": "supertag",
  "optional-field-contribution-remove": "supertag",
  "template-node-detach": "none",
  "field-materialize": "none",
  "field-value-remove": "structure",
  "materialized-field-clear": "structure",
  "field-configuration-set": "field-definition",
  "field-definition-make-discoverable": "field-definition",
  "field-definition-return-to-template-field": "field-definition",
  "rich-text-splice": "content",
  "rich-text-mark": "content",
  "inline-reference-create": "inline-reference",
  "inline-reference-remove": "inline-reference",
  "inline-alias-attach": "inline-reference",
  "inline-alias-detach": "inline-reference",
  "search-expression-add": "search",
  "search-expression-configure": "search",
  "search-expression-move": "search",
  "search-expression-remove": "search",
  "search-expression-restore": "search",
  "shared-default-view-add": "view",
  "shared-default-view-remove": "view",
  "shared-default-view-restore": "view",
  "view-mode-set": "view",
  "view-column-add": "view",
  "view-column-remove": "view",
  "view-column-move": "view",
  "view-sort-add": "view",
  "view-sort-configure": "view",
  "view-sort-remove": "view",
  "view-sort-restore": "view",
  "view-group-add": "view",
  "view-group-remove": "view",
  "view-filter-add": "view",
  "view-filter-remove": "view",
  "view-filter-restore": "view",
} as const satisfies Readonly<Record<AuthoredAction["kind"], CompensationPolicy>>;

export function compensateAction(
  target: FactAction,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: ScopedProjection,
  counterfactual: ScopedProjection,
  inverseHints: readonly AuthoredAction[],
): CompensationStep {
  const policy = COMPENSATION_POLICY_BY_ACTION[target.action.kind];
  if (policy === "none") {
    return noCompensation();
  }
  const step =
    policy === "content"
      ? compensateContentAction(target, targetIds, activeFacts, projection, counterfactual, inverseHints)
      : policy === "structure"
        ? compensateStructureAction(target, targetIds, activeFacts, projection, counterfactual)
        : policy === "supertag"
          ? compensateSupertagAction(target, activeFacts, projection, counterfactual)
          : policy === "inline-reference"
            ? compensateInlineReferenceAction(target, projection, counterfactual, inverseHints)
            : policy === "field-definition"
              ? compensateFieldDefinitionConfiguration(target, projection, counterfactual)
              : policy === "search"
                ? compensateSearchAction(target, counterfactual)
                : compensateViewAction(target, activeFacts, projection, counterfactual);
  if (step === null) {
    throw new Error(`Compensation policy ${policy} did not handle ${target.action.kind}`);
  }
  return step;
}
