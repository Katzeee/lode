import { graphActionKindsInFamily } from "../fact/index.js";
import { assertSupertagAuthoredIntent } from "./supertag.js";
import type { AuthoredIntentFamily } from "./contract.js";

const SCHEMA_ACTION_KINDS = graphActionKindsInFamily("supertag");

export const supertagAuthoredIntent = {
  key: "supertag",
  actionKinds: SCHEMA_ACTION_KINDS,
  assert(action, context) {
    const { previous, available } = context;
    assertSupertagAuthoredIntent(action, previous, available);
  },
} satisfies AuthoredIntentFamily<(typeof SCHEMA_ACTION_KINDS)[number]>;
