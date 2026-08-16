import { canonicalJson, type SupertagMutation } from "../fact/index.js";
import { completeSupertagFieldConfigurationEvidence, completeSupertagMutationEvidence } from "./supertag.js";
import type { MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

const SCHEMA_MUTATION_KINDS = [
  "supertag-apply",
  "supertag-remove",
  "supertag-field-add",
  "supertag-field-remove",
  "supertag-field-configure",
  "supertag-extension-add",
  "supertag-extension-remove",
  "supertag-template-node-add",
  "supertag-template-node-remove",
] as const satisfies readonly SupertagMutation["kind"][];

export const supertagMutationEvidence = {
  key: "supertag",
  mutationKinds: SCHEMA_MUTATION_KINDS,
  complete(mutation, context) {
    const { previous, available } = context.projections();
    return completeSupertagMutationEvidence(mutation, previous, available);
  },
  validate(mutation, context) {
    if (mutation.kind === "supertag-field-configure") {
      const expected = completeSupertagFieldConfigurationEvidence(mutation, context.projections().available);
      assertEvidenceEqual(expected.previousConfig, mutation.previousConfig, "Field previous config");
      assertSameSorted(expected.observedConfigFactIds, mutation.observedConfigFactIds, "Field config Fact evidence");
      return;
    }
    const expected = supertagMutationEvidence.complete(mutation, context);
    if (
      mutation.kind === "supertag-remove" ||
      mutation.kind === "supertag-field-remove" ||
      mutation.kind === "supertag-extension-remove" ||
      mutation.kind === "supertag-template-node-remove"
    ) {
      const expectedAnchor = "previousAnchor" in expected ? expected.previousAnchor : undefined;
      assertEvidenceEqual(expectedAnchor, mutation.previousAnchor, "Supertag relation previous anchor");
    }
  },
} satisfies MutationEvidenceFamily<(typeof SCHEMA_MUTATION_KINDS)[number]>;

function assertSameSorted(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
  label: string,
): void {
  if (canonicalJson([...(expected ?? [])].sort()) !== canonicalJson([...(actual ?? [])].sort())) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
