import type { Mutation } from "../../domain/fact/index.js";
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
    sourceSchemaIds: instance.sources.map((source) => source.schemaId),
    sourceApplicationSchemaIds: instance.sources.map((source) => source.appliedSchemaId),
    sourceTemplateItemIds: instance.sources.map((source) => source.templateItemId),
  };
}
