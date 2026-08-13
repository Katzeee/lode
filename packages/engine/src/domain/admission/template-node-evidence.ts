import { canonicalJson, type Mutation } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateTemplateDetachmentEvidence(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  available: Projection,
): void {
  const instance = available.templateNodeInstances.find(
    (candidate) =>
      candidate.ownerNodeId === mutation.ownerNodeId &&
      candidate.templateNodeId === mutation.templateNodeId &&
      candidate.state === "linked",
  );
  if (
    !instance ||
    canonicalJson(instance.sources.map((source) => source.schemaId)) !==
      canonicalJson(mutation.sourceSchemaIds) ||
    canonicalJson(instance.sources.map((source) => source.appliedSchemaId)) !==
      canonicalJson(mutation.sourceApplicationSchemaIds) ||
    canonicalJson(instance.sources.map((source) => source.templateOccurrenceId)) !==
      canonicalJson(mutation.sourceTemplateOccurrenceIds)
  ) {
    throw new Error("Template detachment source evidence does not match the observed Projection");
  }
}
