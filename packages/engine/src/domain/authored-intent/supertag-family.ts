import { graphActionKindsInFamily } from "../fact/index.js";
import { validateSupertagAuthoredIntent } from "./supertag.js";
import type { AuthoredIntentFamily } from "./policy.js";

const SCHEMA_ACTION_KINDS = graphActionKindsInFamily("supertag");

export const supertagAuthoredIntent = {
  key: "supertag",
  actionKinds: SCHEMA_ACTION_KINDS,
  validate(action, context) {
    const { previous, available } = context.projections();
    return validateSupertagAuthoredIntent(action, previous, available);
  },
} satisfies AuthoredIntentFamily<(typeof SCHEMA_ACTION_KINDS)[number]>;
