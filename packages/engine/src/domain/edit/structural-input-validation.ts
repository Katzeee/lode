import { parseAuthoredAction } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString, optionalNodeSeed } from "./input-validation-primitives.js";
import { isDirectAuthoredActionEdit, type EditAction } from "./types.js";

export function parseStructuralEdit(edit: Record<string, unknown>): EditAction {
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
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      return parseOccurrenceEdit(edit);
    default:
      return parsePublicFactEdit(edit);
  }
}

function parseOccurrenceEdit(edit: Record<string, unknown>): EditAction {
  if (edit.kind === "occurrence-delete") {
    exactInputKeys(edit, ["kind", "occurrenceId"]);
    return { kind: "occurrence-delete", occurrenceId: nonemptyInputString(edit.occurrenceId, "Occurrence identity") };
  }
  if (edit.kind === "occurrence-create" || edit.kind === "occurrence-restore") {
    exactInputKeys(edit, ["kind", "occurrenceId", "nodeId", "parentNodeId", "anchor"]);
    const placement = parseAuthoredAction({
      kind: "placement-create",
      placementId: edit.occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    });
    return {
      kind: edit.kind,
      occurrenceId: placement.placementId,
      nodeId: placement.nodeId,
      parentNodeId: placement.parentNodeId,
      anchor: placement.anchor,
    };
  }
  exactInputKeys(edit, ["kind", "occurrenceId", "parentNodeId", "anchor"]);
  const placement = parseAuthoredAction({
    kind: "placement-move",
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "occurrence-move",
    occurrenceId: placement.placementId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
  };
}

function parseNodeRestore(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "nodeId", "occurrenceId", "parentNodeId", "anchor"]);
  const placement = parseAuthoredAction({
    kind: "placement-move",
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "node-restore",
    nodeId: nonemptyInputString(edit.nodeId, "Restore target Node identity"),
    occurrenceId: placement.placementId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
  };
}

function parseInlineReferenceAlias(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "inlineReferenceId", "hostNodeId", "aliasNodeId", "seed"]);
  const aliasNodeId = nonemptyInputString(edit.aliasNodeId, "Inline Alias Node identity");
  const seed = optionalNodeSeed(edit.seed);
  return {
    kind: "inline-reference-alias-create",
    inlineReferenceId: nonemptyInputString(edit.inlineReferenceId, "Inline Reference identity"),
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Inline Reference host Node identity"),
    aliasNodeId,
    ...(seed === undefined ? {} : { seed }),
  };
}

function parseNodeCreate(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "nodeId", "occurrenceId", "parentNodeId", "anchor", "seed", "intrinsicNodeType"]);
  const identity = parseAuthoredAction({
    kind: "node-create",
    nodeId: edit.nodeId,
    ownerNodeId: edit.parentNodeId,
    originalPlacement: { placementId: edit.occurrenceId, anchor: edit.anchor },
    ...(edit.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: edit.intrinsicNodeType }),
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  if (identity.originalPlacement === null) {
    throw new Error("Created Node requires an Original Placement");
  }
  return {
    kind: "node-create",
    nodeId: identity.nodeId,
    occurrenceId: identity.originalPlacement.placementId,
    parentNodeId: identity.ownerNodeId,
    anchor: identity.originalPlacement.anchor,
    ...(identity.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: identity.intrinsicNodeType }),
    ...(identity.seed === undefined ? {} : { seed: identity.seed }),
  };
}

function parsePublicFactEdit(edit: Record<string, unknown>): EditAction {
  const parsed = parseAuthoredAction(edit);
  if (!isDirectAuthoredActionEdit(parsed)) {
    throw new Error(`${parsed.kind} is not a public edit operation`);
  }
  return parsed;
}
