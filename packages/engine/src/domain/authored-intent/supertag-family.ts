import type { SupertagAction } from "../fact/index.js";
import { validateSupertagAuthoredIntent } from "./supertag.js";
import type { AuthoredIntentFamily } from "./policy.js";

const SCHEMA_ACTION_KINDS = [
  "supertag-application-add",
  "supertag-membership-remove",
  "supertag-extension-add",
  "supertag-extension-remove",
  "template-member-add",
  "template-member-remove",
  "template-field-add",
  "template-field-remove",
  "template-field-restore",
  "template-field-visibility-set",
  "template-field-static-default-set",
  "optional-field-contribution-add",
  "optional-field-contribution-remove",
] as const satisfies readonly SupertagAction["kind"][];

export const supertagAuthoredIntent = {
  key: "supertag",
  actionKinds: SCHEMA_ACTION_KINDS,
  validate(action, context) {
    const { previous, available } = context.projections();
    return validateSupertagAuthoredIntent(action, previous, available);
  },
} satisfies AuthoredIntentFamily<(typeof SCHEMA_ACTION_KINDS)[number]>;
