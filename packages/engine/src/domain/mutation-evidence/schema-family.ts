import { canonicalJson, type SchemaMutation } from "../fact/index.js";
import { completeSchemaFieldConfigurationEvidence, completeSchemaMutationEvidence } from "./schema.js";
import type { MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

const SCHEMA_MUTATION_KINDS = [
  "schema-apply",
  "schema-remove",
  "schema-field-add",
  "schema-field-remove",
  "schema-field-configure",
  "schema-extension-add",
  "schema-extension-remove",
  "schema-template-node-add",
  "schema-template-node-remove",
] as const satisfies readonly SchemaMutation["kind"][];

export const schemaMutationEvidence = {
  key: "schema",
  mutationKinds: SCHEMA_MUTATION_KINDS,
  complete(mutation, context) {
    const { previous, available } = context.projections();
    return completeSchemaMutationEvidence(mutation, previous, available);
  },
  validate(mutation, context) {
    if (mutation.kind === "schema-field-configure") {
      const expected = completeSchemaFieldConfigurationEvidence(mutation, context.projections().available);
      assertEvidenceEqual(expected.previousConfig, mutation.previousConfig, "Field previous config");
      assertSameSorted(expected.observedConfigFactIds, mutation.observedConfigFactIds, "Field config Fact evidence");
      return;
    }
    const expected = schemaMutationEvidence.complete(mutation, context);
    if (
      mutation.kind === "schema-remove" ||
      mutation.kind === "schema-field-remove" ||
      mutation.kind === "schema-extension-remove" ||
      mutation.kind === "schema-template-node-remove"
    ) {
      const expectedAnchor = "previousAnchor" in expected ? expected.previousAnchor : undefined;
      assertEvidenceEqual(expectedAnchor, mutation.previousAnchor, "Schema relation previous anchor");
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
