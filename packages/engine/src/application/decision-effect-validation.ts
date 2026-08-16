import {
  parseSupertagFieldConfig,
  parseJsonValue as json,
  parseSequenceAnchor as sequenceAnchor,
  parseTextAtomId,
  isNodeType,
  type PreviousValue,
} from "../domain/fact/index.js";
import type {
  DecisionEffect,
  FieldDefinitionConfigurationDecisionState,
  PlacementRelation,
} from "../domain/review/index.js";
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
  if (kind === "supertag-relation") {
    return supertagRelationEffect(effect);
  }
  if (kind === "field-materialization") {
    return fieldMaterializationEffect(effect);
  }
  if (kind === "field-configuration") {
    return fieldConfigurationEffect(effect);
  }
  if (kind === "inline-reference") {
    return inlineReferenceEffect(effect);
  }
  if (kind === "view-definition") {
    return viewDefinitionEffect(effect);
  }
  if (kind === "field-definition-configuration") {
    return fieldDefinitionConfigurationEffect(effect);
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

function inlineReferenceEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(effect, ["kind", "inlineReferenceId", "origin", "review"], "Inline Reference Decision effect");
  return {
    kind: "inline-reference",
    inlineReferenceId: nonempty(effect.inlineReferenceId, "Inline Reference identity"),
    origin: effect.origin === null ? null : inlineReferenceState(effect.origin),
    review: effect.review === null ? null : inlineReferenceState(effect.review),
  };
}

function viewDefinitionEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(effect, ["kind", "viewDefinitionNodeId", "origin", "review"], "View Definition Decision effect");
  return {
    kind: "view-definition",
    viewDefinitionNodeId: nonempty(effect.viewDefinitionNodeId, "View Definition Node identity"),
    origin: effect.origin === null ? null : viewDefinitionState(effect.origin),
    review: effect.review === null ? null : viewDefinitionState(effect.review),
  };
}

function fieldDefinitionConfigurationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(
    effect,
    ["kind", "fieldDefinitionId", "configurationNodeId", "origin", "review"],
    "Field Definition configuration Decision effect",
  );
  return {
    kind: "field-definition-configuration",
    fieldDefinitionId: nonempty(effect.fieldDefinitionId, "Field Definition identity"),
    configurationNodeId: nonempty(effect.configurationNodeId, "Field configuration Node identity"),
    origin: effect.origin === null ? null : fieldDefinitionConfigurationState(effect.origin),
    review: effect.review === null ? null : fieldDefinitionConfigurationState(effect.review),
  };
}

function fieldDefinitionConfigurationState(value: unknown): FieldDefinitionConfigurationDecisionState {
  const state = object(value, "Field Definition configuration state");
  const kind = nonempty(state.kind, "Field Definition configuration kind");
  if (kind === "datatype") {
    exact(state, ["kind", "datatype"], "Field datatype state");
    return { kind: "datatype", datatype: oneOf(state.datatype, ["plain", "options"] as const, "Field datatype") };
  }
  if (kind === "cardinality") {
    exact(state, ["kind", "cardinality"], "Field cardinality state");
    return {
      kind: "cardinality",
      cardinality: oneOf(state.cardinality, ["single", "list"] as const, "Field cardinality"),
    };
  }
  if (kind === "initialization-expression") {
    exact(state, ["kind", "expression"], "Field initialization expression state");
    const expression = object(state.expression, "Field initialization expression");
    exact(expression, ["kind", "sourceFieldDefinitionId"], "Field initialization expression");
    if (expression.kind !== "ancestor-field-values") {
      throw new Error("Field initialization expression kind is invalid");
    }
    return {
      kind: "initialization-expression",
      expression: {
        kind: "ancestor-field-values",
        sourceFieldDefinitionId: nonempty(expression.sourceFieldDefinitionId, "source Field Definition identity"),
      },
    };
  }
  throw new Error(`Unknown Field Definition configuration kind: ${kind}`);
}

function viewDefinitionState(value: unknown) {
  const state = object(value, "View Definition state");
  exact(state, ["hostNodeId", "viewType"], "View Definition state");
  return {
    hostNodeId: nonempty(state.hostNodeId, "View host Node identity"),
    viewType: oneOf(state.viewType, ["outline", "table"] as const, "View type"),
  };
}

function inlineReferenceState(value: unknown) {
  const state = object(value, "Inline Reference state");
  exact(state, ["hostNodeId", "targetNodeId", "aliasNodeId", "targetStatus", "anchor"], "Inline Reference state");
  return {
    hostNodeId: nonempty(state.hostNodeId, "Inline Reference host Node"),
    targetNodeId: nonempty(state.targetNodeId, "Inline Reference target Node"),
    aliasNodeId: nullableString(state.aliasNodeId, "Inline Alias Node"),
    targetStatus: oneOf(state.targetStatus, ["active", "trash", "unavailable"] as const, "target status"),
    anchor: sequenceAnchor(state.anchor),
  };
}

function fieldConfigurationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(effect, ["kind", "supertagId", "fieldDefinitionId", "origin", "review"], "Field configuration Decision effect");
  return {
    kind: "field-configuration",
    supertagId: nonempty(effect.supertagId, "Field configuration Supertag"),
    fieldDefinitionId: nonempty(effect.fieldDefinitionId, "Field configuration Field Definition"),
    origin: effect.origin === null ? null : parseSupertagFieldConfig(effect.origin),
    review: effect.review === null ? null : parseSupertagFieldConfig(effect.review),
  };
}

function supertagRelationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(
    effect,
    ["kind", "relation", "ownerId", "targetId", "originIndex", "reviewIndex"],
    "Supertag relation Decision effect",
  );
  return {
    kind: "supertag-relation",
    relation: oneOf(
      effect.relation,
      ["application", "field", "extension", "template-node"] as const,
      "Supertag relation kind",
    ),
    ownerId: nonempty(effect.ownerId, "Supertag relation owner"),
    targetId: nonempty(effect.targetId, "Supertag relation target"),
    originIndex: nullableIndex(effect.originIndex, "origin Supertag relation index"),
    reviewIndex: nullableIndex(effect.reviewIndex, "review Supertag relation index"),
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
