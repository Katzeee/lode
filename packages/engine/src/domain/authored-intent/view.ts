import { graphActionKindsInFamily } from "../fact/index.js";
import type { AuthoredIntentFamily } from "./contract.js";

const VIEW_ACTION_KINDS = graphActionKindsInFamily("view");

export const viewAuthoredIntent = {
  key: "view",
  actionKinds: VIEW_ACTION_KINDS,
  assert() {},
} satisfies AuthoredIntentFamily<(typeof VIEW_ACTION_KINDS)[number]>;
