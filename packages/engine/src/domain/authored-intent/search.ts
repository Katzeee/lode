import { graphActionKindsInFamily } from "../fact/index.js";
import type { AuthoredIntentFamily } from "./contract.js";

const SEARCH_ACTION_KINDS = graphActionKindsInFamily("search");

export const searchAuthoredIntent = {
  key: "search",
  actionKinds: SEARCH_ACTION_KINDS,
  assert() {},
} satisfies AuthoredIntentFamily<(typeof SEARCH_ACTION_KINDS)[number]>;
