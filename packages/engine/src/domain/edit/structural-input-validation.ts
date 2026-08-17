import { parseMutation } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString, rejectPreparedEvidence } from "./input-validation-primitives.js";
import { isFactMutationEdit, type EditMutation } from "./types.js";

export function parseStructuralEdit(edit: Record<string, unknown>): EditMutation {
  switch (edit.kind) {
    case "reference-promote":
      exactInputKeys(edit, ["kind", "occurrenceId"]);
      return {
        kind: "reference-promote",
        occurrenceId: nonemptyInputString(edit.occurrenceId, "Reference Occurrence identity"),
      };
    case "node-delete":
      exactInputKeys(edit, ["kind", "nodeId"]);
      return { kind: "node-delete", nodeId: nonemptyInputString(edit.nodeId, "Delete target Node identity") };
    case "node-restore":
      return parseNodeRestore(edit);
    case "inline-reference-alias-create":
      return parseInlineReferenceAlias(edit);
    case "node-create":
      return parseNodeCreate(edit);
    default:
      rejectPreparedEvidence(edit);
      return parsePublicFactEdit(edit);
  }
}

function parseNodeRestore(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "nodeId", "deletionFactId", "occurrenceId", "ownerNodeId", "parentNodeId", "anchor"]);
  const placement = parseMutation({
    kind: "occurrence-move",
    occurrenceId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "node-restore",
    nodeId: nonemptyInputString(edit.nodeId, "Restore target Node identity"),
    deletionFactId: nonemptyInputString(edit.deletionFactId, "Node deletion Fact identity"),
    occurrenceId: placement.occurrenceId,
    ownerNodeId: nonemptyInputString(edit.ownerNodeId, "Restore Owner Node identity"),
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
  };
}

function parseInlineReferenceAlias(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "inlineReferenceId", "hostNodeId", "aliasNodeId", "seed"]);
  const aliasNodeId = nonemptyInputString(edit.aliasNodeId, "Inline Alias Node identity");
  const aliasNode = parseMutation({
    kind: "node-create",
    nodeId: aliasNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  return {
    kind: "inline-reference-alias-create",
    inlineReferenceId: nonemptyInputString(edit.inlineReferenceId, "Inline Reference identity"),
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Inline Reference host Node identity"),
    aliasNodeId,
    ...(aliasNode.seed === undefined ? {} : { seed: aliasNode.seed }),
  };
}

function parseNodeCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "nodeId", "occurrenceId", "parentNodeId", "anchor", "seed", "intrinsicNodeType"]);
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
  const intrinsicNodeType =
    edit.intrinsicNodeType === undefined
      ? undefined
      : parseMutation({
          kind: "intrinsic-node-type-declare",
          nodeId: edit.nodeId,
          intrinsicNodeType: edit.intrinsicNodeType,
        });
  return {
    ...identity,
    occurrenceId: placement.occurrenceId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
    ...(intrinsicNodeType === undefined ? {} : { intrinsicNodeType: intrinsicNodeType.intrinsicNodeType }),
  };
}

function parsePublicFactEdit(edit: Record<string, unknown>): EditMutation {
  const parsed = parseMutation(edit);
  if (!isFactMutationEdit(parsed)) {
    throw new Error(`${parsed.kind} is not a public edit operation`);
  }
  return parsed;
}
