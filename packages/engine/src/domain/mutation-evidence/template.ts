import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type Mutation,
} from "../fact/index.js";
import { occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";

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
    instanceOccurrenceId: templateInstanceOccurrenceId(
      mutation.ownerNodeId,
      mutation.templateNodeId,
    ),
    anchor: occurrenceAnchor(available, instance.instanceOccurrenceId),
    sourceSchemaIds: instance.sources.map((source) => source.schemaId),
    sourceApplicationSchemaIds: instance.sources.map((source) => source.appliedSchemaId),
    sourceTemplateOccurrenceIds: instance.sources.map((source) => source.templateOccurrenceId),
  };
}
