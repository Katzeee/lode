import { type MutationWrite } from "../../../../domain/edit/index.js";
import { fieldDefinitionEndpointOccurrenceId, type FieldMutation } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { deletePlacement } from "./deletion-rule.js";
import {
  createNodeUnlessPresent,
  createOccurrenceUnlessPresent,
  declareFieldNodeUnlessPresent,
} from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const START = { after: null, before: null, affinity: "before", fallback: "start" } as const;

export function expandFieldMutation(mutation: FieldMutation, available: ScopedProjection): MutationWrite {
  switch (mutation.kind) {
    case "field-materialize":
      return atomicExpansion([
        ...createNodeUnlessPresent(mutation.fieldNodeId, mutation.ownerNodeId, available),
        ...declareFieldNodeUnlessPresent(mutation.fieldNodeId, available),
        ...createOccurrenceUnlessPresent(
          mutation.fieldOccurrenceId,
          mutation.fieldNodeId,
          mutation.ownerNodeId,
          END,
          available,
        ),
        ...createOccurrenceUnlessPresent(
          fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId),
          mutation.fieldDefinitionId,
          mutation.fieldNodeId,
          START,
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
