import type { JsonValue, PreviousValue, SequenceAnchor, TextAtomId } from "../domain/fact/index.js";
import type { DecisionEffect, PlacementRelation } from "../domain/review/index.js";

export function parseDecisionEffect(value: unknown): DecisionEffect {
  const effect = object(value, "Decision effect");
  const kind = nonempty(effect.kind, "Decision effect kind");
  if (kind === "text") {
    exact(
      effect,
      ["kind", "nodeId", "addedAtomIds", "deletedAtomIds", "markChanges"],
      "text Decision effect",
    );
    return {
      kind,
      nodeId: nonempty(effect.nodeId, "text effect Node"),
      addedAtomIds: array(effect.addedAtomIds, "added Atom identities", parseTextAtomId),
      deletedAtomIds: array(effect.deletedAtomIds, "deleted Atom identities", parseTextAtomId),
      markChanges: array(effect.markChanges, "mark changes", markChange),
    };
  }
  if (kind === "structure") {
    exact(
      effect,
      [
        "kind",
        "occurrenceId",
        "originPresent",
        "reviewPresent",
        "originParentId",
        "reviewParentId",
        "anchor",
        "originRelation",
        "reviewRelation",
      ],
      "structure Decision effect",
    );
    return {
      kind,
      occurrenceId: nonempty(effect.occurrenceId, "structure effect Occurrence"),
      originPresent: boolean(effect.originPresent, "origin presence"),
      reviewPresent: boolean(effect.reviewPresent, "review presence"),
      originParentId: nullableString(effect.originParentId, "origin parent"),
      reviewParentId: nullableString(effect.reviewParentId, "review parent"),
      anchor: effect.anchor === null ? null : sequenceAnchor(effect.anchor),
      originRelation:
        effect.originRelation === null ? null : placementRelation(effect.originRelation),
      reviewRelation:
        effect.reviewRelation === null ? null : placementRelation(effect.reviewRelation),
    };
  }
  if (kind === "value") {
    exact(
      effect,
      ["kind", "ownerKind", "ownerId", "namespace", "key", "origin", "review"],
      "value Decision effect",
    );
    return {
      kind,
      ownerKind: oneOf(
        effect.ownerKind,
        ["node", "occurrence", "schema", "field"] as const,
        "value owner kind",
      ),
      ownerId: nonempty(effect.ownerId, "value owner identity"),
      namespace: oneOf(
        effect.namespace,
        ["property", "metadata", "schema"] as const,
        "value namespace",
      ),
      key: nonempty(effect.key, "value key"),
      origin: previousValue(effect.origin),
      review: previousValue(effect.review),
    };
  }
  if (kind === "lifecycle" || kind === "canonical") {
    exact(effect, ["kind", "identity", "origin", "review"], `${kind} Decision effect`);
    return {
      kind,
      identity: nonempty(effect.identity, `${kind} identity`),
      origin: lifecycleValue(effect.origin, "origin lifecycle value"),
      review: lifecycleValue(effect.review, "review lifecycle value"),
    };
  }
  throw new Error(`Unknown Decision effect kind: ${kind}`);
}

function markChange(value: unknown) {
  const change = object(value, "mark change");
  exact(change, ["atomId", "key", "origin", "review"], "mark change");
  return {
    atomId: parseTextAtomId(change.atomId),
    key: nonempty(change.key, "mark key"),
    origin: previousValue(change.origin),
    review: previousValue(change.review),
  };
}

function previousValue(value: unknown): PreviousValue {
  const previous = object(value, "Previous value");
  const kind = nonempty(previous.kind, "Previous value kind");
  if (kind === "unset") {
    exact(previous, ["kind"], "unset Previous value");
    return { kind };
  }
  if (kind === "set") {
    exact(previous, ["kind", "value"], "set Previous value");
    return { kind, value: json(previous.value) };
  }
  throw new Error(`Unknown Previous value kind: ${kind}`);
}

function sequenceAnchor(value: unknown): SequenceAnchor {
  const anchor = object(value, "Sequence anchor");
  exact(anchor, ["after", "before", "affinity", "fallback"], "Sequence anchor");
  return {
    after: nullableString(anchor.after, "after endpoint"),
    before: nullableString(anchor.before, "before endpoint"),
    affinity: oneOf(anchor.affinity, ["after", "before"] as const, "anchor affinity"),
    fallback: oneOf(anchor.fallback, ["start", "end"] as const, "anchor fallback"),
  };
}

function placementRelation(value: unknown): PlacementRelation {
  const relation = object(value, "Placement relation");
  exact(relation, ["parentMatches", "afterEndpoint", "beforeEndpoint"], "Placement relation");
  return {
    parentMatches: boolean(relation.parentMatches, "parent relation"),
    afterEndpoint: nullableRelation(relation.afterEndpoint, "after endpoint relation"),
    beforeEndpoint: nullableRelation(relation.beforeEndpoint, "before endpoint relation"),
  };
}

function nullableRelation(value: unknown, label: string): "before" | "after" | "missing" | null {
  return value === null ? null : oneOf(value, ["before", "after", "missing"] as const, label);
}

function lifecycleValue(value: unknown, label: string): string | boolean | null {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  return nonempty(value, label);
}

export function parseTextAtomId(value: unknown): TextAtomId {
  const candidate = nonempty(value, "Atom identity");
  const separator = candidate.lastIndexOf("#");
  const suffix = candidate.slice(separator + 1);
  if (separator < 1 || !/^\d+$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) {
    throw new Error("Atom identity is invalid");
  }
  return candidate as TextAtomId;
}

function json(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(json);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, json(child)]));
  }
  throw new Error("Value is not JSON data");
}

function array<T>(value: unknown, label: string, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parse);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
