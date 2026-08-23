import type { AuthoredAction } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { fieldAuthoredIntent } from "./field.js";
import { fieldDefinitionAuthoredIntent } from "./field-definition.js";
import { nodeAuthoredIntent } from "./node.js";
import { placementAuthoredIntent } from "./placement.js";
import { supertagAuthoredIntent } from "./supertag-family.js";
import { templateAuthoredIntent } from "./template.js";
import { textAuthoredIntent } from "./text.js";
import { inlineReferenceAuthoredIntent } from "./inline-reference.js";
import { viewAuthoredIntent } from "./view.js";

export type AuthoredIntentContext = Readonly<{
  projections(): Readonly<{
    previous: ScopedProjection;
    available: ScopedProjection;
    resulting: ScopedProjection;
  }>;
}>;

type ActionOf<Kind extends AuthoredAction["kind"]> = Extract<AuthoredAction, { kind: Kind }>;

export type AuthoredIntentFamily<Kind extends AuthoredAction["kind"] = AuthoredAction["kind"]> = Readonly<{
  key: string;
  actionKinds: readonly Kind[];
  validate(action: ActionOf<Kind>, context: AuthoredIntentContext): ActionOf<Kind>;
}>;

const AUTHORED_INTENT_FAMILIES = [
  nodeAuthoredIntent,
  placementAuthoredIntent,
  supertagAuthoredIntent,
  templateAuthoredIntent,
  fieldAuthoredIntent,
  fieldDefinitionAuthoredIntent,
  textAuthoredIntent,
  inlineReferenceAuthoredIntent,
  viewAuthoredIntent,
] as const;

const FAMILY_BY_ACTION = compileAuthoredIntentFamilies(AUTHORED_INTENT_FAMILIES);

export function validateAuthoredIntent(action: AuthoredAction, context: AuthoredIntentContext): AuthoredAction {
  return FAMILY_BY_ACTION.get(action.kind)?.validate(action, context) ?? action;
}

function compileAuthoredIntentFamilies(
  families: readonly AuthoredIntentFamily[],
): ReadonlyMap<AuthoredAction["kind"], AuthoredIntentFamily> {
  const byAction = new Map<AuthoredAction["kind"], AuthoredIntentFamily>();
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
