import {
  assertJsonValue,
  enumValue,
  exact,
  nonempty,
  nullableString,
  object,
  safeInteger,
} from "../../decoding/index.js";
import { isReplicaId } from "./fact.js";
import { isFactActionId } from "./identities.js";
import type { FactFrontier, JsonValue, SequenceAnchor, TextAtomId } from "./types.js";

export function parseJsonValue(value: unknown): JsonValue {
  assertJsonValue(value, "Value");
  return value as JsonValue;
}

export function parseJsonRecord(value: unknown): Record<string, JsonValue> {
  const result = object(value, "JSON object");
  for (const child of Object.values(result)) {
    assertJsonValue(child, "Value");
  }
  return result as Record<string, JsonValue>;
}

export function parseFactFrontier(value: unknown): FactFrontier {
  const frontier = object(value, "Fact frontier");
  for (const [replicaId, sequence] of Object.entries(frontier)) {
    if (!isReplicaId(replicaId)) {
      throw new Error("Invalid frontier Replica identity");
    }
    safeInteger(sequence, 0, "frontier sequence");
  }
  return frontier as FactFrontier;
}

export function parseSequenceAnchor(value: unknown): SequenceAnchor {
  const anchor = object(value, "Sequence anchor");
  exact(anchor, ["after", "before", "affinity", "fallback"], "Sequence anchor");
  return {
    after: nullableString(anchor.after, "anchor after identity"),
    before: nullableString(anchor.before, "anchor before identity"),
    affinity: enumValue(anchor.affinity, ["after", "before"] as const, "anchor affinity"),
    fallback: enumValue(anchor.fallback, ["start", "end"] as const, "anchor fallback"),
  };
}

export function parseTextAtomId(value: unknown): TextAtomId {
  const candidate = nonempty(value, "Atom identity");
  const separator = candidate.lastIndexOf("#");
  const actionId = candidate.slice(0, separator);
  const suffix = candidate.slice(separator + 1);
  if (
    separator < 1 ||
    !isFactActionId(actionId) ||
    !/^(?:0|[1-9]\d*)$/.test(suffix) ||
    !Number.isSafeInteger(Number(suffix))
  ) {
    throw new Error("Atom identity is invalid");
  }
  return candidate as TextAtomId;
}
