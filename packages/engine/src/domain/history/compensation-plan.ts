import type { AuthoredAction, FactAction } from "../fact/index.js";
import { CONTENT_COMPENSATIONS } from "./compensation-content.js";
import { FIELD_DEFINITION_COMPENSATIONS } from "./compensation-field-definition.js";
import { INLINE_REFERENCE_COMPENSATIONS } from "./compensation-inline-reference.js";
import { SEARCH_COMPENSATIONS } from "./compensation-search.js";
import { STRUCTURE_COMPENSATIONS } from "./compensation-structure.js";
import { SUPERTAG_COMPENSATIONS } from "./compensation-supertag.js";
import {
  noCompensation,
  type CompensationCatalog,
  type CompensationEntry,
  type CompensationRuleContext,
  type CompensationStep,
  type CompensationTargetAction,
} from "./compensation-types.js";
import { VIEW_COMPENSATIONS } from "./compensation-view.js";

const COMPENSATION_SLICES = [
  STRUCTURE_COMPENSATIONS,
  SUPERTAG_COMPENSATIONS,
  CONTENT_COMPENSATIONS,
  SEARCH_COMPENSATIONS,
  INLINE_REFERENCE_COMPENSATIONS,
  VIEW_COMPENSATIONS,
  FIELD_DEFINITION_COMPENSATIONS,
] as const;

const COMPENSATION_CATALOG = {
  ...STRUCTURE_COMPENSATIONS,
  ...SUPERTAG_COMPENSATIONS,
  ...CONTENT_COMPENSATIONS,
  ...SEARCH_COMPENSATIONS,
  ...INLINE_REFERENCE_COMPENSATIONS,
  ...VIEW_COMPENSATIONS,
  ...FIELD_DEFINITION_COMPENSATIONS,
  "template-node-detach": () => noCompensation(),
  "field-materialize": () => noCompensation(),
} satisfies CompensationCatalog;

// A duplicate kind across slices would silently override under spread; the
// mapped type only guarantees that no kind is missing.
const SLICE_ENTRY_COUNT = COMPENSATION_SLICES.reduce((count, slice) => count + Object.keys(slice).length, 2);
if (SLICE_ENTRY_COUNT !== Object.keys(COMPENSATION_CATALOG).length) {
  throw new Error("History Compensation slices declare overlapping action kinds");
}

export function isCompensationTargetAction(action: AuthoredAction): action is CompensationTargetAction {
  return action.kind in COMPENSATION_CATALOG;
}

export function compensateAction(
  target: FactAction<CompensationTargetAction>,
  context: CompensationRuleContext,
): CompensationStep {
  const entry = COMPENSATION_CATALOG[target.action.kind];
  return (entry as CompensationEntry)(context, target);
}
