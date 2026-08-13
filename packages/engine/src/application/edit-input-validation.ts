import type { EditMutation } from "../domain/edit/index.js";
import { parseMutation } from "../domain/fact/index.js";

export function parseEditMutation(value: unknown): EditMutation {
  const edit = object(value);
  if (edit.kind === "reference-promote") {
    exactKeys(edit, ["kind", "occurrenceId"]);
    if (typeof edit.occurrenceId !== "string" || edit.occurrenceId.length === 0) {
      throw new Error("Reference Occurrence identity is invalid");
    }
    return { kind: "reference-promote", occurrenceId: edit.occurrenceId };
  }
  if (edit.kind !== "node-create") {
    rejectPreparedEvidence(edit);
    const parsed = parseMutation(value);
    if (
      parsed.kind === "node-create" ||
      parsed.kind === "node-owner-set" ||
      parsed.kind === "field-initialize"
    ) {
      throw new Error(`${parsed.kind} is not a public edit operation`);
    }
    return parsed;
  }
  exactKeys(edit, ["kind", "nodeId", "occurrenceId", "parentNodeId", "anchor", "seed"]);
  const identity = parseMutation({
    kind: "node-create",
    nodeId: edit.nodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.occurrenceId,
    nodeId: edit.nodeId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  if (identity.kind !== "node-create" || placement.kind !== "occurrence-create") {
    throw new Error("Invalid Node creation edit");
  }
  return {
    ...identity,
    occurrenceId: placement.occurrenceId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
  };
}

const PREPARED_EVIDENCE_KEYS = [
  "deletedAtoms",
  "observedConfigFactIds",
  "observedInitializationFactIds",
  "previous",
  "previousAnchor",
  "previousConfig",
  "previousOwnerNodeId",
  "previousParentNodeId",
  "sourceApplicationSchemaIds",
  "sourceSchemaIds",
  "sourceTemplateOccurrenceIds",
] as const;

function rejectPreparedEvidence(edit: Record<string, unknown>): void {
  const evidence = PREPARED_EVIDENCE_KEYS.find((key) => key in edit);
  if (evidence) {
    throw new Error(`Prepared Fact evidence is not accepted by the edit interface: ${evidence}`);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Edit mutation must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}
