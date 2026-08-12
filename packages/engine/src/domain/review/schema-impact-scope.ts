import type { ProjectionGeneration } from "../reconcile/index.js";

export function schemaInstanceNodeIds(
  generation: ProjectionGeneration,
  schemaId: string,
): ReadonlySet<string> {
  return new Set(
    [generation.origin, generation.review].flatMap((projection) => {
      const memberSchemas = new Set([
        schemaId,
        ...(projection.schemaSearchMembers[schemaId] ?? []),
      ]);
      return Object.entries(projection.schemaApplications).flatMap(([nodeId, schemaIds]) =>
        schemaIds.some((applied) => memberSchemas.has(applied)) ? [nodeId] : [],
      );
    }),
  );
}
