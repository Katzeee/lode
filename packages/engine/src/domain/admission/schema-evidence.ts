import { canonicalJson, type SchemaMutation } from "../fact/index.js";
import { completeSchemaMutationEvidence } from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateSchemaEvidence(
  mutation: SchemaMutation,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeSchemaMutationEvidence(mutation, previous, available);
  if (mutation.kind === "schema-field-configure") {
    if (expected.kind !== "schema-field-configure") {
      throw new Error("Schema evidence completion changed the Mutation kind");
    }
    assertSame(expected.previousConfig, mutation.previousConfig, "Field previous config");
    assertSameSorted(
      expected.observedConfigFactIds,
      mutation.observedConfigFactIds,
      "Field config Fact evidence",
    );
    return;
  }
  if (
    mutation.kind === "schema-remove" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-extension-remove" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    const expectedAnchor = "previousAnchor" in expected ? expected.previousAnchor : undefined;
    assertSame(expectedAnchor, mutation.previousAnchor, "Schema relation previous anchor");
  }
}

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}

function assertSameSorted(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
  label: string,
): void {
  if (canonicalJson([...(expected ?? [])].sort()) !== canonicalJson([...(actual ?? [])].sort())) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
