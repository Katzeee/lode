import { type MutationWrite } from "../../../../domain/edit/index.js";
import type { FieldMutation, Mutation } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { deletePlacement } from "./deletion-rule.js";
import {
  createNodeUnlessPresent,
  createOccurrenceUnlessPresent,
  declareFieldNodeUnlessPresent,
  nodeSeed,
} from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function expandFieldMutation(mutation: FieldMutation, available: ScopedProjection): MutationWrite {
  switch (mutation.kind) {
    case "field-initialize":
      return atomicExpansion(expandFieldInitialization(mutation, available));
    case "field-materialize":
      return atomicExpansion([
        ...createNodeUnlessPresent(mutation.fieldNodeId, available),
        ...declareFieldNodeUnlessPresent(mutation.fieldNodeId, available),
        ...createOccurrenceUnlessPresent(
          mutation.fieldOccurrenceId,
          mutation.fieldNodeId,
          mutation.ownerNodeId,
          END,
          available,
        ),
        mutation,
      ]);
    case "field-value-delete":
      return atomicExpansion([mutation, ...deletePlacement(mutation.valueOccurrenceId, available)]);
    case "materialized-field-delete":
      return atomicExpansion([mutation, ...deletePlacement(mutation.fieldOccurrenceId, available)]);
  }
}

function expandFieldInitialization(
  mutation: Extract<FieldMutation, { kind: "field-initialize" }>,
  available: ScopedProjection,
): readonly Mutation[] {
  const result: Mutation[] = [
    ...createNodeUnlessPresent(mutation.fieldNodeId, available),
    ...declareFieldNodeUnlessPresent(mutation.fieldNodeId, available),
    ...createOccurrenceUnlessPresent(
      mutation.fieldOccurrenceId,
      mutation.fieldNodeId,
      mutation.ownerNodeId,
      END,
      available,
    ),
  ];
  for (const value of mutation.values) {
    if (value.kind === "text") {
      result.push(
        ...createNodeUnlessPresent(
          value.nodeId,
          available,
          nodeSeed([...value.value].map((character) => ({ value: character, attributes: {} }))),
        ),
      );
    }
    result.push(
      ...createOccurrenceUnlessPresent(value.occurrenceId, value.nodeId, mutation.fieldNodeId, END, available),
    );
  }
  result.push(mutation);
  return result;
}
