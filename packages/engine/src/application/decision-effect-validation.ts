import {
  parseFieldTemplateConfig,
  parseJsonValue as json,
  parseSequenceAnchor as sequenceAnchor,
  parseTextAtomId,
  isNodeType,
  type PreviousValue,
} from "../domain/fact/index.js";
import type { DecisionEffect, PlacementRelation } from "../domain/review/index.js";
import {
  array,
  booleanValue as boolean,
  enumValue as oneOf,
  exact,
  nonempty,
  nullableString,
  object,
  safeInteger,
} from "../shape-validation/index.js";

export function parseDecisionEffect(value: unknown): DecisionEffect {
  const effect = object(value, "Decision effect");
  const kind = nonempty(effect.kind, "Decision effect kind");
  if (kind === "text") {
    exact(effect, ["kind", "nodeId", "addedAtomIds", "deletedAtomIds", "markChanges"], "text Decision effect");
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
      originRelation: effect.originRelation === null ? null : placementRelation(effect.originRelation),
      reviewRelation: effect.reviewRelation === null ? null : placementRelation(effect.reviewRelation),
    };
  }
  if (kind === "value") {
    exact(effect, ["kind", "targetKind", "targetId", "namespace", "key", "origin", "review"], "value Decision effect");
    return {
      kind,
      targetKind: oneOf(effect.targetKind, ["node", "occurrence"] as const, "value target kind"),
      targetId: nonempty(effect.targetId, "value target identity"),
      namespace: oneOf(effect.namespace, ["property", "metadata", "schema"] as const, "value namespace"),
      key: nonempty(effect.key, "value key"),
      origin: previousValue(effect.origin),
      review: previousValue(effect.review),
    };
  }
  if (kind === "schema-relation") {
    return schemaRelationEffect(effect);
  }
  if (kind === "field-materialization") {
    return fieldMaterializationEffect(effect);
  }
  if (kind === "field-configuration") {
    return fieldConfigurationEffect(effect);
  }
  if (kind === "lifecycle") {
    exact(effect, ["kind", "identity", "origin", "review"], `${kind} Decision effect`);
    return {
      kind,
      identity: nonempty(effect.identity, `${kind} identity`),
      origin: nullableBoolean(effect.origin, "origin lifecycle value"),
      review: nullableBoolean(effect.review, "review lifecycle value"),
    };
  }
  if (kind === "owner") {
    exact(effect, ["kind", "identity", "origin", "review"], `${kind} Decision effect`);
    return {
      kind,
      identity: nonempty(effect.identity, `${kind} identity`),
      origin: nullableOwner(effect.origin, "origin owner value"),
      review: nullableOwner(effect.review, "review owner value"),
    };
  }
  if (kind === "node-type") {
    exact(effect, ["kind", "identity", "origin", "review"], "Node type Decision effect");
    return {
      kind,
      identity: nonempty(effect.identity, "Node type identity"),
      origin: nullableNodeType(effect.origin, "origin Node type"),
      review: nullableNodeType(effect.review, "review Node type"),
    };
  }
  throw new Error(`Unknown Decision effect kind: ${kind}`);
}

function fieldConfigurationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(effect, ["kind", "schemaId", "fieldDefinitionId", "origin", "review"], "Field configuration Decision effect");
  return {
    kind: "field-configuration",
    schemaId: nonempty(effect.schemaId, "Field configuration Schema"),
    fieldDefinitionId: nonempty(effect.fieldDefinitionId, "Field configuration Field Definition"),
    origin: effect.origin === null ? null : parseFieldTemplateConfig(effect.origin),
    review: effect.review === null ? null : parseFieldTemplateConfig(effect.review),
  };
}

function schemaRelationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(
    effect,
    ["kind", "relation", "ownerId", "targetId", "originIndex", "reviewIndex"],
    "Schema relation Decision effect",
  );
  return {
    kind: "schema-relation",
    relation: oneOf(
      effect.relation,
      ["application", "field", "extension", "template-node"] as const,
      "Schema relation kind",
    ),
    ownerId: nonempty(effect.ownerId, "Schema relation owner"),
    targetId: nonempty(effect.targetId, "Schema relation target"),
    originIndex: nullableIndex(effect.originIndex, "origin Schema relation index"),
    reviewIndex: nullableIndex(effect.reviewIndex, "review Schema relation index"),
  };
}

function fieldMaterializationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(
    effect,
    [
      "kind",
      "ownerNodeId",
      "fieldDefinitionId",
      "originFieldNodeId",
      "reviewFieldNodeId",
      "originFieldOccurrenceId",
      "reviewFieldOccurrenceId",
    ],
    "Field materialization Decision effect",
  );
  return {
    kind: "field-materialization",
    ownerNodeId: nonempty(effect.ownerNodeId, "Field owner Node"),
    fieldDefinitionId: nonempty(effect.fieldDefinitionId, "Field Definition"),
    originFieldNodeId: nullableString(effect.originFieldNodeId, "origin Field Node"),
    reviewFieldNodeId: nullableString(effect.reviewFieldNodeId, "review Field Node"),
    originFieldOccurrenceId: nullableString(effect.originFieldOccurrenceId, "origin Field Occurrence"),
    reviewFieldOccurrenceId: nullableString(effect.reviewFieldOccurrenceId, "review Field Occurrence"),
  };
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

function nullableBoolean(value: unknown, label: string): boolean | null {
  return value === null ? null : boolean(value, label);
}

function nullableOwner(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}

function nullableNodeType(value: unknown, label: string) {
  if (value === null) {
    return null;
  }
  if (!isNodeType(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableIndex(value: unknown, label: string): number | null {
  return value === null ? null : safeInteger(value, 0, label);
}
