import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import {
  isFieldMutation,
  isNodeMutation,
  isOccurrenceMutation,
  isSchemaMutation,
  isTemplateMutation,
  isTextMutation,
  isValueMutation,
  type Mutation,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { expandNodeDeletion, expandOccurrenceDeletion } from "./deletion-rule.js";
import { expandFieldMutation } from "./field-rule.js";
import { expandSchemaMutation } from "./schema-rule.js";
import { expandTemplateMutation } from "./template-rule.js";

export function expandMutation(mutation: Mutation, available: ScopedProjection): MutationWrite {
  if (isSchemaMutation(mutation)) {
    return expandSchemaMutation(mutation, available);
  }
  if (isFieldMutation(mutation)) {
    return expandFieldMutation(mutation, available);
  }
  if (isTemplateMutation(mutation)) {
    return expandTemplateMutation(mutation, available);
  }
  if (isNodeMutation(mutation)) {
    return mutation.kind === "node-delete"
      ? expandNodeDeletion(mutation, available)
      : singleMutationWrite(mutation);
  }
  if (isOccurrenceMutation(mutation)) {
    return mutation.kind === "occurrence-delete"
      ? expandOccurrenceDeletion(mutation, available)
      : singleMutationWrite(mutation);
  }
  if (isTextMutation(mutation) || isValueMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  return assertNever(mutation);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Mutation expansion: ${JSON.stringify(value)}`);
}
