import { assertOneOf, assertStringArray, requireString } from "../../shape-validation/index.js";
import type {
  SharedDefaultViewDefinitionAttachMutation,
  SharedDefaultViewDefinitionModeSetMutation,
} from "./view-definition-types.js";

export function assertSharedDefaultViewDefinitionMutationShape(value: Record<string, unknown>): void {
  requireString(value.hostNodeId, "View host Node identity");
  requireString(value.viewDefinitionNodeId, "View Definition Node identity");
  requireString(value.viewDefinitionOccurrenceId, "View Definition Occurrence identity");
}

export function assertSharedDefaultViewDefinitionModeShape(value: Record<string, unknown>): void {
  requireString(value.viewDefinitionNodeId, "View Definition Node identity");
  assertOneOf(value.viewType, ["outline", "table"], "View type");
  if (value.previousViewType !== undefined && value.previousViewType !== null) {
    assertOneOf(value.previousViewType, ["outline", "table"], "previous View type");
  }
  if (value.observedModeFactIds !== undefined) {
    assertStringArray(value.observedModeFactIds, "observed View mode Facts");
  }
}

export function validateSharedDefaultViewDefinitionMutation(
  mutation: SharedDefaultViewDefinitionAttachMutation,
  factIdentity: string,
): void {
  requireIdentity(mutation.hostNodeId, "View host Node", factIdentity);
  requireIdentity(mutation.viewDefinitionNodeId, "View Definition Node", factIdentity);
  requireIdentity(mutation.viewDefinitionOccurrenceId, "View Definition Occurrence", factIdentity);
  if (mutation.hostNodeId === mutation.viewDefinitionNodeId) {
    throw new Error(`View Definition cannot be its host: ${factIdentity}`);
  }
}

export function validateSharedDefaultViewDefinitionMode(
  mutation: SharedDefaultViewDefinitionModeSetMutation,
  factIdentity: string,
): void {
  requireIdentity(mutation.viewDefinitionNodeId, "View Definition Node", factIdentity);
  if (mutation.previousViewType === undefined || mutation.observedModeFactIds === undefined) {
    throw new Error(`View mode evidence is missing: ${factIdentity}`);
  }
  if (new Set(mutation.observedModeFactIds).size !== mutation.observedModeFactIds.length) {
    throw new Error(`View mode evidence contains duplicate Facts: ${factIdentity}`);
  }
  mutation.observedModeFactIds.forEach((identity) => requireIdentity(identity, "View mode Fact", factIdentity));
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
