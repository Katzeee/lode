import {
  isFieldMutation,
  isFieldDefinitionConfigMutation,
  isInlineReferenceMutation,
  isMetanodeMutation,
  isNodeMutation,
  isOccurrenceMutation,
  isSupertagMutation,
  isTemplateMutation,
  isTextMutation,
  isSearchMutation,
  isViewMutation,
  type ContributionFact,
  type Fact,
  type Mutation,
} from "../../fact/index.js";
import type { Projection } from "../projection-types.js";
import { canApplyFieldDirectTail } from "./field-rule.js";
import { canApplyNodeDirectTail } from "./node-rule.js";
import { canApplyOccurrenceDirectTail } from "./occurrence-rule.js";
import { canApplySupertagDirectTail } from "./supertag-rule.js";
import { selectNeutralFactTail } from "./tail-selection.js";
import { canApplyTemplateDirectTail } from "./template-rule.js";
import { canApplyTextDirectTail } from "./text-rule.js";
import { canApplyInlineReferenceDirectTail } from "./inline-reference-rule.js";

export function selectEligibleDirectTail(
  projection: Projection,
  facts: readonly Fact[],
  changed: readonly Fact[],
): readonly ContributionFact[] | null {
  const tail = selectNeutralFactTail(facts, changed);
  if (!tail) {
    return null;
  }
  const contributions = tail.filter((fact): fact is ContributionFact => fact.body.kind === "contribution");
  return contributions.length === tail.length &&
    contributions.every((fact) => fact.body.intent === "direct" && canApplyDirectTail(projection, fact.body.mutation))
    ? contributions
    : null;
}

function canApplyDirectTail(projection: Projection, mutation: Mutation): boolean {
  if (isMetanodeMutation(mutation)) {
    return false;
  }
  if (isNodeMutation(mutation)) {
    return canApplyNodeDirectTail(projection, mutation);
  }
  if (isOccurrenceMutation(mutation)) {
    return canApplyOccurrenceDirectTail(projection, mutation);
  }
  if (isSupertagMutation(mutation)) {
    return canApplySupertagDirectTail(projection, mutation);
  }
  if (isTemplateMutation(mutation)) {
    return canApplyTemplateDirectTail(projection, mutation);
  }
  if (isFieldMutation(mutation)) {
    return canApplyFieldDirectTail(projection, mutation);
  }
  if (isFieldDefinitionConfigMutation(mutation)) {
    return false;
  }
  if (isTextMutation(mutation)) {
    return canApplyTextDirectTail(projection, mutation);
  }
  if (isInlineReferenceMutation(mutation)) {
    return canApplyInlineReferenceDirectTail(projection, mutation);
  }
  if (isSearchMutation(mutation)) {
    return false;
  }
  if (isViewMutation(mutation)) {
    return false;
  }
  return assertNever(mutation);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Direct tail Mutation: ${JSON.stringify(value)}`);
}
