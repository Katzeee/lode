import type { GraphAction } from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";
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

export type AuthoredIntentContext = Readonly<{
  projections(): Readonly<{
    previous: InterpretedProjection;
    available: InterpretedProjection;
    resulting: InterpretedProjection;
  }>;
}>;

type ActionOf<Kind extends GraphAction["kind"]> = Extract<GraphAction, { kind: Kind }>;

export type AuthoredIntentFamily<Kind extends GraphAction["kind"] = GraphAction["kind"]> = Readonly<{
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
  searchAuthoredIntent,
  viewAuthoredIntent,
] as const;

type OwnedActionKind = (typeof AUTHORED_INTENT_FAMILIES)[number]["actionKinds"][number];
type AssertNever<Value extends never> = Value;
type ValidatedActionKind =
  AssertNever<Exclude<GraphAction["kind"], OwnedActionKind>> extends never ? GraphAction["kind"] : never;

const FAMILY_BY_ACTION = compileAuthoredIntentFamilies(AUTHORED_INTENT_FAMILIES);

export function validateAuthoredIntent(action: GraphAction, context: AuthoredIntentContext): GraphAction {
  const family = FAMILY_BY_ACTION.get(action.kind);
  if (family === undefined) {
    throw new Error(`Graph Action ${action.kind} has no Authored Intent policy`);
  }
  return family.validate(action, context);
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
