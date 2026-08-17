import { assertOneOf, assertStringArray, requireString } from "../../shape-validation/index.js";
import { canonicalJson } from "./canonical.js";
import { parseViewOptionsSpec } from "./view-options-spec.js";
import type {
  SharedDefaultViewDefinitionAttachMutation,
  SharedDefaultViewDefinitionDetachMutation,
  SharedDefaultViewDefinitionModeSetMutation,
  SharedDefaultViewDefinitionOptionsSetMutation,
  SharedDefaultViewDefinitionSortByNameSetMutation,
} from "./view-definition-types.js";

export function assertSharedDefaultViewDefinitionMutationShape(value: Record<string, unknown>): void {
  requireString(value.hostNodeId, "View host Node identity");
  requireString(value.attachmentNodeId, "View attachment Node identity");
  requireString(value.attachmentOccurrenceId, "View attachment Occurrence identity");
  requireString(value.relationDefinitionOccurrenceId, "Views for node Definition endpoint Occurrence identity");
  requireString(value.viewDefinitionNodeId, "View Definition Node identity");
  requireString(value.viewDefinitionOccurrenceId, "View Definition Occurrence identity");
}

export function assertSharedDefaultViewDefinitionDetachShape(value: Record<string, unknown>): void {
  assertSharedDefaultViewDefinitionMutationShape(value);
  requireString(value.detachedValueNodeId, "detached View value Node identity");
  requireString(value.detachedValueOccurrenceId, "detached View value Occurrence identity");
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

export function assertSharedDefaultViewDefinitionSortByNameShape(value: Record<string, unknown>): void {
  for (const [member, label] of [
    [value.hostNodeId, "View host Node identity"],
    [value.viewDefinitionNodeId, "View Definition Node identity"],
    [value.sortOrderFieldNodeId, "Sort order Field Node identity"],
    [value.sortOrderFieldOccurrenceId, "Sort order Field Occurrence identity"],
    [value.sortFieldNodeId, "Sort field Node identity"],
    [value.sortFieldOccurrenceId, "Sort field Occurrence identity"],
    [value.nodeNameOccurrenceId, "Node name Occurrence identity"],
    [value.ascendingOccurrenceId, "ASC Occurrence identity"],
  ] as const) {
    requireString(member, label);
  }
  if (typeof value.enabled !== "boolean" || typeof value.previousEnabled !== "boolean") {
    throw new Error("View Sort state must be boolean");
  }
}

export function assertSharedDefaultViewDefinitionOptionsShape(value: Record<string, unknown>): void {
  requireString(value.hostNodeId, "View host Node identity");
  requireString(value.viewDefinitionNodeId, "View Definition Node identity");
  parseViewOptionsSpec(value.options);
  if (value.previousOptions !== undefined) {
    parseViewOptionsSpec(value.previousOptions);
  }
  if (value.observedOptionsFactIds !== undefined) {
    assertStringArray(value.observedOptionsFactIds, "observed View options Facts");
  }
}

export function validateSharedDefaultViewDefinitionMutation(
  mutation: SharedDefaultViewDefinitionAttachMutation | SharedDefaultViewDefinitionDetachMutation,
  factIdentity: string,
): void {
  requireIdentity(mutation.hostNodeId, "View host Node", factIdentity);
  requireIdentity(mutation.attachmentNodeId, "View attachment Node", factIdentity);
  requireIdentity(mutation.attachmentOccurrenceId, "View attachment Occurrence", factIdentity);
  requireIdentity(
    mutation.relationDefinitionOccurrenceId,
    "Views for node Definition endpoint Occurrence",
    factIdentity,
  );
  requireIdentity(mutation.viewDefinitionNodeId, "View Definition Node", factIdentity);
  requireIdentity(mutation.viewDefinitionOccurrenceId, "View Definition Occurrence", factIdentity);
  if (new Set([mutation.hostNodeId, mutation.attachmentNodeId, mutation.viewDefinitionNodeId]).size !== 3) {
    throw new Error(`View host, attachment, and Definition identities must differ: ${factIdentity}`);
  }
  if (mutation.kind === "shared-default-view-definition-detach") {
    requireIdentity(mutation.detachedValueNodeId, "detached View value Node", factIdentity);
    requireIdentity(mutation.detachedValueOccurrenceId, "detached View value Occurrence", factIdentity);
    if (
      new Set([
        mutation.hostNodeId,
        mutation.attachmentNodeId,
        mutation.viewDefinitionNodeId,
        mutation.detachedValueNodeId,
      ]).size !== 4
    ) {
      throw new Error(`Detached View identities must differ: ${factIdentity}`);
    }
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

export function validateSharedDefaultViewDefinitionSortByName(
  mutation: SharedDefaultViewDefinitionSortByNameSetMutation,
  factIdentity: string,
): void {
  for (const [identity, label] of [
    [mutation.hostNodeId, "View host Node"],
    [mutation.viewDefinitionNodeId, "View Definition Node"],
    [mutation.sortOrderFieldNodeId, "Sort order Field Node"],
    [mutation.sortOrderFieldOccurrenceId, "Sort order Field Occurrence"],
    [mutation.sortFieldNodeId, "Sort field Node"],
    [mutation.sortFieldOccurrenceId, "Sort field Occurrence"],
    [mutation.nodeNameOccurrenceId, "Node name Occurrence"],
    [mutation.ascendingOccurrenceId, "ASC Occurrence"],
  ] as const) {
    requireIdentity(identity, label, factIdentity);
  }
  if (mutation.enabled === mutation.previousEnabled) {
    throw new Error(`View Sort mutation does not change state: ${factIdentity}`);
  }
  if (
    new Set([
      mutation.hostNodeId,
      mutation.viewDefinitionNodeId,
      mutation.sortOrderFieldNodeId,
      mutation.sortFieldNodeId,
    ]).size !== 4
  ) {
    throw new Error(`View Sort Node identities must differ: ${factIdentity}`);
  }
  if (
    new Set([
      mutation.sortOrderFieldOccurrenceId,
      mutation.sortFieldOccurrenceId,
      mutation.nodeNameOccurrenceId,
      mutation.ascendingOccurrenceId,
    ]).size !== 4
  ) {
    throw new Error(`View Sort Occurrence identities must differ: ${factIdentity}`);
  }
}

export function validateSharedDefaultViewDefinitionOptions(
  mutation: SharedDefaultViewDefinitionOptionsSetMutation,
  factIdentity: string,
): void {
  requireIdentity(mutation.hostNodeId, "View host Node", factIdentity);
  requireIdentity(mutation.viewDefinitionNodeId, "View Definition Node", factIdentity);
  if (mutation.hostNodeId === mutation.viewDefinitionNodeId) {
    throw new Error(`View host and Definition identities must differ: ${factIdentity}`);
  }
  if (mutation.previousOptions === undefined || mutation.observedOptionsFactIds === undefined) {
    throw new Error(`View options evidence is missing: ${factIdentity}`);
  }
  if (new Set(mutation.observedOptionsFactIds).size !== mutation.observedOptionsFactIds.length) {
    throw new Error(`View options evidence contains duplicate Facts: ${factIdentity}`);
  }
  mutation.observedOptionsFactIds.forEach((identity) => requireIdentity(identity, "View options Fact", factIdentity));
  if (canonicalJson(mutation.options) === canonicalJson(mutation.previousOptions)) {
    throw new Error(`View options mutation does not change state: ${factIdentity}`);
  }
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}
