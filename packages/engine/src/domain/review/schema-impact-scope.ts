import type { ScopedProjectionGeneration } from "../reconcile/index.js";

export function schemaInstanceNodeIds(
  generation: ScopedProjectionGeneration,
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
