import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type Mutation,
  type SequenceAnchor,
} from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";

export function prepareTemplateDetachment(
  mutation: Extract<Mutation, { kind: "template-node-detach" }>,
  available: ProjectionGeneration["review"],
): Mutation {
  const instance = available.templateNodeInstances.find(
    (candidate) =>
      candidate.ownerNodeId === mutation.ownerNodeId &&
      candidate.templateNodeId === mutation.templateNodeId,
  );
  if (!instance || instance.state !== "linked") {
    throw new Error("Template Node instance is absent or already detached");
  }
  return {
    ...mutation,
    instanceNodeId: templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId),
    instanceOccurrenceId: templateInstanceOccurrenceId(
      mutation.ownerNodeId,
      mutation.templateNodeId,
    ),
    anchor: anchorFor(available, instance.instanceOccurrenceId),
    sourceSchemaIds: instance.sources.map((source) => source.schemaId),
    sourceApplicationSchemaIds: instance.sources.map((source) => source.appliedSchemaId),
    sourceTemplateOccurrenceIds: instance.sources.map((source) => source.templateOccurrenceId),
  };
}

function anchorFor(
  projection: ProjectionGeneration["review"],
  occurrenceId: string,
): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = occurrence ? (projection.children[occurrence.parentNodeId] ?? []) : [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}
