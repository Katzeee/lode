import { assertObject, assertOneOf, assertKeys, assertNullableString, requireString } from "../../decoding/index.js";

export function assertTemplateDetachmentShape(value: Record<string, unknown>): void {
  requireString(value.ownerNodeId, "Template instance owner");
  requireString(value.templateNodeId, "Template Node identity");
  requireString(value.instanceNodeId, "Detached Template instance Node");
  requireString(value.instanceOccurrenceId, "Detached Template instance Occurrence");
  assertObject(value.anchor, "Detached Template instance anchor");
  assertKeys(value.anchor, ["after", "before", "affinity", "fallback"], "Detached Template instance anchor");
  assertNullableString(value.anchor.after, "anchor after");
  assertNullableString(value.anchor.before, "anchor before");
  assertOneOf(value.anchor.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.anchor.fallback, ["start", "end"], "anchor fallback");
}
