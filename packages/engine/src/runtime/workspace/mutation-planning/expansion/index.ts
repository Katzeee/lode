import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import {
  isFieldMutation,
  isFieldDefinitionConfigMutation,
  isInlineReferenceMutation,
  isMetanodeMutation,
  isNodeMutation,
  isOccurrenceMutation,
  isSupertagMutation,
  isTemplateMutation,
  isTextMutation,
  isSearchMutation,
  isViewMutation,
  type Mutation,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { expandNodeDeletion, expandOccurrenceDeletion } from "./deletion-rule.js";
import { expandFieldMutation } from "./field-rule.js";
import { expandSupertagMutation } from "./supertag-rule.js";
import { expandTemplateMutation } from "./template-rule.js";

export function expandMutation(mutation: Mutation, available: ScopedProjection): MutationWrite {
  if (isMetanodeMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  if (isSupertagMutation(mutation)) {
    return expandSupertagMutation(mutation, available);
  }
  if (isFieldMutation(mutation)) {
    return expandFieldMutation(mutation, available);
  }
  if (isFieldDefinitionConfigMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  if (isTemplateMutation(mutation)) {
    return expandTemplateMutation(mutation, available);
  }
  if (isNodeMutation(mutation)) {
    return mutation.kind === "node-delete" ? expandNodeDeletion(mutation, available) : singleMutationWrite(mutation);
  }
  if (isOccurrenceMutation(mutation)) {
    return mutation.kind === "occurrence-delete"
      ? expandOccurrenceDeletion(mutation, available)
      : singleMutationWrite(mutation);
  }
  if (isTextMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  if (isInlineReferenceMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  if (isSearchMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  if (isViewMutation(mutation)) {
    return singleMutationWrite(mutation);
  }
  return assertNever(mutation);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Mutation expansion: ${JSON.stringify(value)}`);
}
