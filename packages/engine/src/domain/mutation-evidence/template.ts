import {
  canonicalJson,
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type Mutation,
  type TemplateMutation,
} from "../fact/index.js";
import { occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";
import type { MutationEvidenceFamily } from "./policy.js";

const TEMPLATE_MUTATION_KINDS = ["template-node-detach"] as const satisfies readonly TemplateMutation["kind"][];

export const templateMutationEvidence = {
  key: "template",
  mutationKinds: TEMPLATE_MUTATION_KINDS,
  complete(mutation, context) {
    return completeTemplateDetachmentEvidence(mutation, context.projections().available);
  },
  validate(mutation, context) {
    const expected = templateMutationEvidence.complete(mutation, context);
    if (
      canonicalJson(expected.sourceSupertagIds) !== canonicalJson(mutation.sourceSupertagIds) ||
      canonicalJson(expected.sourceApplicationSupertagIds) !== canonicalJson(mutation.sourceApplicationSupertagIds) ||
      canonicalJson(expected.sourceTemplateOccurrenceIds) !== canonicalJson(mutation.sourceTemplateOccurrenceIds)
    ) {
      throw new Error("Template detachment source evidence does not match the observed Projection");
    }
  },
} satisfies MutationEvidenceFamily<(typeof TEMPLATE_MUTATION_KINDS)[number]>;

export function completeTemplateDetachmentEvidence(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  available: ScopedProjection,
): Extract<Mutation, { kind: "template-node-detach" }> {
  const instance = available.templateNodeInstances.find(
    (candidate) =>
      candidate.ownerNodeId === mutation.ownerNodeId &&
      candidate.templateNodeId === mutation.templateNodeId &&
      candidate.state === "linked",
  );
  if (!instance) {
    throw new Error("Template Node instance is absent or already detached");
  }
  return {
    ...mutation,
    instanceNodeId: templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId),
    instanceOccurrenceId: templateInstanceOccurrenceId(mutation.ownerNodeId, mutation.templateNodeId),
    anchor: occurrenceAnchor(available, instance.instanceOccurrenceId),
    sourceSupertagIds: instance.sources.map((source) => source.supertagId),
    sourceApplicationSupertagIds: instance.sources.map((source) => source.appliedSupertagId),
    sourceTemplateOccurrenceIds: instance.sources.map((source) => source.templateOccurrenceId),
  };
}
