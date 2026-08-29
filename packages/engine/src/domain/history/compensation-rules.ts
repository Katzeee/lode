import type { FactAction } from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";
import { compensateContentAction } from "./compensation-content.js";
import { compensateSupertagAction } from "./compensation-supertag.js";
import { compensateInlineReferenceAction } from "./compensation-inline-reference.js";
import { compensateStructureAction } from "./compensation-structure.js";
import { compensateViewAction } from "./compensation-view.js";
import { compensateFieldDefinitionConfiguration } from "./compensation-field-definition.js";
import { compensateSearchAction } from "./compensation-search.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";
import { COMPENSATION_POLICY_BY_ACTION, type CompensationTargetAction } from "./compensation-policy.js";

export function compensateAction(
  target: FactAction<CompensationTargetAction>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const policy = COMPENSATION_POLICY_BY_ACTION.get(target.action.kind);
  if (policy === undefined) {
    throw new Error(`History Compensation policy is missing for ${target.action.kind}`);
  }
  if (policy === "none") {
    return noCompensation();
  }
  const step =
    policy === "content"
      ? compensateContentAction(target, targetIds, activeFacts, projection, counterfactual)
      : policy === "structure"
        ? compensateStructureAction(target, targetIds, activeFacts, projection, counterfactual)
        : policy === "supertag"
          ? compensateSupertagAction(target, activeFacts, projection, counterfactual)
          : policy === "inline-reference"
            ? compensateInlineReferenceAction(target, projection, counterfactual)
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
