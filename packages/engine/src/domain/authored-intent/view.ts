import { graphActionKindsInFamily } from "../fact/index.js";
import type { AuthoredIntentFamily } from "./policy.js";

const VIEW_ACTION_KINDS = graphActionKindsInFamily("view");

export const viewAuthoredIntent = {
  key: "view",
  actionKinds: VIEW_ACTION_KINDS,
  validate(action) {
    return action;
  },
} satisfies AuthoredIntentFamily<(typeof VIEW_ACTION_KINDS)[number]>;
