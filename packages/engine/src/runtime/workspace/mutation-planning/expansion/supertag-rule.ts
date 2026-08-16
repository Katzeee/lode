import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { SupertagMutation } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { deletePlacement } from "./deletion-rule.js";
import {
  createNodeUnlessPresent,
  createOccurrenceUnlessPresent,
  declareFieldNodeUnlessPresent,
} from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

export function expandSupertagMutation(mutation: SupertagMutation, available: ScopedProjection): MutationWrite {
  switch (mutation.kind) {
    case "supertag-field-add":
      return atomicExpansion([
        ...createNodeUnlessPresent(mutation.fieldNodeId, available),
        ...declareFieldNodeUnlessPresent(mutation.fieldNodeId, available),
        ...createOccurrenceUnlessPresent(
          mutation.fieldOccurrenceId,
          mutation.fieldNodeId,
          mutation.supertagId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "supertag-field-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.fieldOccurrenceId, available)]);
    case "supertag-template-node-add":
      return atomicExpansion([
        ...createOccurrenceUnlessPresent(
          mutation.templateOccurrenceId,
          mutation.templateNodeId,
          mutation.supertagId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "supertag-template-node-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.templateOccurrenceId, available)]);
    case "supertag-apply":
    case "supertag-remove":
    case "supertag-field-configure":
    case "supertag-extension-add":
    case "supertag-extension-remove":
      return singleMutationWrite(mutation);
  }
}
