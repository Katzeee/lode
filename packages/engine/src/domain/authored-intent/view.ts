import type { ViewAction } from "../fact/index.js";
import type { AuthoredIntentFamily } from "./policy.js";

const VIEW_ACTION_KINDS = [
  "shared-default-view-add",
  "shared-default-view-remove",
  "shared-default-view-restore",
  "view-mode-set",
  "view-column-add",
  "view-column-remove",
  "view-column-move",
  "view-sort-add",
  "view-sort-configure",
  "view-sort-remove",
  "view-sort-restore",
  "view-group-add",
  "view-group-remove",
  "view-filter-add",
  "view-filter-remove",
  "view-filter-restore",
] as const satisfies readonly ViewAction["kind"][];

export const viewAuthoredIntent = {
  key: "view",
  actionKinds: VIEW_ACTION_KINDS,
  validate(action) {
    return action;
  },
} satisfies AuthoredIntentFamily<(typeof VIEW_ACTION_KINDS)[number]>;
