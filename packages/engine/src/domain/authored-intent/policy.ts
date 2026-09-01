import type { GraphAction } from "../fact/index.js";
import type { AuthoredIntentContext, AuthoredIntentFamily } from "./contract.js";
import { fieldAuthoredIntent } from "./field.js";
import { fieldDefinitionAuthoredIntent } from "./field-definition.js";
import { nodeAuthoredIntent } from "./node.js";
import { placementAuthoredIntent } from "./placement.js";
import { supertagAuthoredIntent } from "./supertag-family.js";
import { templateAuthoredIntent } from "./template.js";
import { textAuthoredIntent } from "./text.js";
import { inlineReferenceAuthoredIntent } from "./inline-reference.js";
import { searchAuthoredIntent } from "./search.js";
import { viewAuthoredIntent } from "./view.js";

const AUTHORED_INTENT_FAMILIES = [
  nodeAuthoredIntent,
  placementAuthoredIntent,
  supertagAuthoredIntent,
  templateAuthoredIntent,
  fieldAuthoredIntent,
  fieldDefinitionAuthoredIntent,
  textAuthoredIntent,
  inlineReferenceAuthoredIntent,
  searchAuthoredIntent,
  viewAuthoredIntent,
] as const;

type OwnedActionKind = (typeof AUTHORED_INTENT_FAMILIES)[number]["actionKinds"][number];
type AssertNever<Value extends never> = Value;
type ValidatedActionKind =
  AssertNever<Exclude<GraphAction["kind"], OwnedActionKind>> extends never ? GraphAction["kind"] : never;

const FAMILY_BY_ACTION = compileAuthoredIntentFamilies(AUTHORED_INTENT_FAMILIES);

export function assertAuthoredIntent(action: GraphAction, context: AuthoredIntentContext): void {
  const family = FAMILY_BY_ACTION.get(action.kind);
  if (family === undefined) {
    throw new Error(`Graph Action ${action.kind} has no Authored Intent policy`);
  }
  family.assert(action, context);
}

function compileAuthoredIntentFamilies(
  families: readonly AuthoredIntentFamily[],
): ReadonlyMap<ValidatedActionKind, AuthoredIntentFamily> {
  const byAction = new Map<ValidatedActionKind, AuthoredIntentFamily>();
  for (const family of families) {
    for (const kind of family.actionKinds) {
      const owner = byAction.get(kind);
      if (owner) {
        throw new Error(`Authored Intent ${kind} has duplicate family owners: ${owner.key}, ${family.key}`);
      }
      byAction.set(kind, family);
    }
  }
  return byAction;
}
