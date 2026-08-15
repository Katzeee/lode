import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { SchemaMutation } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { deletePlacement } from "./deletion-rule.js";
import {
  createNodeUnlessPresent,
  createOccurrenceUnlessPresent,
  declareFieldNodeUnlessPresent,
} from "./generated-lifecycle.js";
import { atomicExpansion } from "./mutation-write.js";

export function expandSchemaMutation(mutation: SchemaMutation, available: ScopedProjection): MutationWrite {
  switch (mutation.kind) {
    case "schema-field-add":
      return atomicExpansion([
        ...createNodeUnlessPresent(mutation.fieldNodeId, available),
        ...declareFieldNodeUnlessPresent(mutation.fieldNodeId, available),
        ...createOccurrenceUnlessPresent(
          mutation.fieldOccurrenceId,
          mutation.fieldNodeId,
          mutation.schemaId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "schema-field-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.fieldOccurrenceId, available)]);
    case "schema-template-node-add":
      return atomicExpansion([
        ...createOccurrenceUnlessPresent(
          mutation.templateOccurrenceId,
          mutation.templateNodeId,
          mutation.schemaId,
          mutation.anchor,
          available,
        ),
        mutation,
      ]);
    case "schema-template-node-remove":
      return atomicExpansion([mutation, ...deletePlacement(mutation.templateOccurrenceId, available)]);
    case "schema-apply":
    case "schema-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
      return singleMutationWrite(mutation);
  }
}
