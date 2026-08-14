import { canonicalJson, type Mutation } from "../fact/index.js";
import { completeTemplateDetachmentEvidence } from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateTemplateDetachmentEvidence(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  available: Projection,
): void {
  const expected = completeTemplateDetachmentEvidence(mutation, available);
  if (
    canonicalJson(expected.sourceSchemaIds) !== canonicalJson(mutation.sourceSchemaIds) ||
    canonicalJson(expected.sourceApplicationSchemaIds) !==
      canonicalJson(mutation.sourceApplicationSchemaIds) ||
    canonicalJson(expected.sourceTemplateOccurrenceIds) !==
      canonicalJson(mutation.sourceTemplateOccurrenceIds)
  ) {
    throw new Error("Template detachment source evidence does not match the observed Projection");
  }
}
