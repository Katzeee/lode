import type { SupertagMutation } from "../fact/index.js";
import { completeSupertagMutationEvidence } from "./supertag.js";
import type { MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

const SCHEMA_MUTATION_KINDS = [
  "supertag-apply",
  "supertag-remove",
  "supertag-extension-add",
  "supertag-extension-remove",
  "supertag-template-node-add",
  "supertag-template-node-remove",
  "supertag-template-field-attach",
  "supertag-template-field-existing-attach",
  "supertag-template-field-detach",
  "supertag-template-field-discoverability-set",
  "supertag-template-field-visibility-configure",
  "supertag-optional-field-contribution-attach",
  "supertag-optional-field-contribution-detach",
] as const satisfies readonly SupertagMutation["kind"][];

export const supertagMutationEvidence = {
  key: "supertag",
  mutationKinds: SCHEMA_MUTATION_KINDS,
  complete(mutation, context) {
    const { previous, available } = context.projections();
    return completeSupertagMutationEvidence(mutation, previous, available);
  },
  validate(mutation, context) {
    const expected = supertagMutationEvidence.complete(mutation, context);
    if (
      mutation.kind === "supertag-remove" ||
      mutation.kind === "supertag-extension-remove" ||
      mutation.kind === "supertag-template-node-remove" ||
      mutation.kind === "supertag-template-field-detach" ||
      mutation.kind === "supertag-optional-field-contribution-detach"
    ) {
      const expectedAnchor = "previousAnchor" in expected ? expected.previousAnchor : undefined;
      assertEvidenceEqual(expectedAnchor, mutation.previousAnchor, "Supertag relation previous anchor");
    }
    if (mutation.kind === "supertag-template-field-discoverability-set") {
      if (expected.kind !== "supertag-template-field-discoverability-set") {
        throw new Error("Template Field evidence family returned the wrong mutation kind");
      }
      assertEvidenceEqual(
        expected.previousDiscoverable,
        mutation.previousDiscoverable,
        "Template Field previous discoverability",
      );
    }
    if (mutation.kind === "supertag-template-field-visibility-configure") {
      if (expected.kind !== "supertag-template-field-visibility-configure") {
        throw new Error("Template Field evidence family returned the wrong mutation kind");
      }
      assertEvidenceEqual(
        expected.previousVisibility,
        mutation.previousVisibility,
        "Template Field previous visibility",
      );
      assertEvidenceEqual(
        [...(expected.observedVisibilityFactIds ?? [])].sort(),
        [...(mutation.observedVisibilityFactIds ?? [])].sort(),
        "Template Field observed visibility Facts",
      );
    }
  },
} satisfies MutationEvidenceFamily<(typeof SCHEMA_MUTATION_KINDS)[number]>;
