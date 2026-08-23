import { assertKeys, assertNullableString, assertObject, assertOneOf, requireString } from "../../decoding/index.js";

export function assertInlineReferenceActionShape(value: Record<string, unknown>): void {
  requireString(value.inlineReferenceId, "Inline Reference identity");
  if (value.kind === "inline-reference-create") {
    requireString(value.hostNodeId, "Inline Reference host Node");
    requireString(value.targetNodeId, "Inline Reference target Node");
    assertAnchorShape(value.anchor);
  } else if (value.kind !== "inline-reference-remove") {
    requireString(value.aliasNodeId, "Inline Alias Node identity");
  }
}

function assertAnchorShape(value: unknown): void {
  assertObject(value, "Inline Reference anchor");
  assertKeys(value, ["after", "before", "affinity", "fallback"], "Inline Reference anchor");
  assertNullableString(value.after, "Inline Reference anchor after");
  assertNullableString(value.before, "Inline Reference anchor before");
  assertOneOf(value.affinity, ["after", "before"], "Inline Reference anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "Inline Reference anchor fallback");
}
