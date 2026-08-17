import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import { FIELD_CONFIGURATION_DEFINITION_NODE_IDS, type Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

type FieldDefinitionConfigurationCreation = Extract<
  EditMutation,
  {
    kind:
      | "field-datatype-configuration-create"
      | "field-cardinality-configuration-create"
      | "field-optionality-configuration-create"
      | "field-initialization-expression-configuration-create";
  }
>;

export function prepareFieldDefinitionConfigurationCreation(
  edit: FieldDefinitionConfigurationCreation,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
    throw new Error("Field configuration host is not an active Field Definition Node");
  }
  if (available.nodes[edit.configurationNodeId] !== undefined) {
    throw new Error("Field configuration Node identity already exists");
  }
  const projectionKind = configurationKind(edit);
  if (
    (available.fieldDefinitionConfigurations[edit.fieldDefinitionId] ?? []).some((item) => item.kind === projectionKind)
  ) {
    throw new Error(`Field Definition already has a ${projectionKind} configuration`);
  }
  assertInitializationExpression(edit);
  assertOptionsSource(edit, available);
  const mutations: Mutation[] = [
    {
      kind: "node-create",
      nodeId: edit.configurationNodeId,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "node-owner-set",
      nodeId: edit.configurationNodeId,
      ownerNodeId: edit.fieldDefinitionId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.configurationOccurrenceId,
      nodeId: edit.configurationNodeId,
      parentNodeId: edit.fieldDefinitionId,
      anchor: edit.anchor,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.definitionOccurrenceId,
      nodeId: configurationDefinitionNodeId(edit),
      parentNodeId: edit.configurationNodeId,
      anchor: end,
    },
    ...valueEndpointGraphMutations(edit),
    ...initializationExpressionGraphMutations(edit),
    configurationMutation(edit),
  ];
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Field Definition configuration creation must produce mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function valueEndpointGraphMutations(edit: FieldDefinitionConfigurationCreation): readonly Mutation[] {
  if (edit.kind === "field-initialization-expression-configuration-create") {
    return [];
  }
  return [
    {
      kind: "occurrence-create",
      occurrenceId: edit.valueOccurrenceId,
      nodeId:
        edit.kind === "field-datatype-configuration-create"
          ? edit.datatypeNodeId
          : edit.kind === "field-cardinality-configuration-create"
            ? edit.cardinalityNodeId
            : edit.optionalityNodeId,
      parentNodeId: edit.configurationNodeId,
      anchor: end,
    },
    ...(edit.kind === "field-datatype-configuration-create" && edit.optionsSupertagId !== undefined
      ? [
          {
            kind: "occurrence-create" as const,
            occurrenceId: edit.optionsSupertagOccurrenceId!,
            nodeId: edit.optionsSupertagId,
            parentNodeId: edit.configurationNodeId,
            anchor: end,
          },
        ]
      : []),
  ];
}

function assertOptionsSource(edit: FieldDefinitionConfigurationCreation, available: ScopedProjection): void {
  if (
    edit.kind === "field-datatype-configuration-create" &&
    edit.optionsSupertagId !== undefined &&
    available.nodes[edit.optionsSupertagId]?.intrinsicNodeType !== "supertag-definition"
  ) {
    throw new Error("Options source is not an active Supertag Definition");
  }
}

function configurationDefinitionNodeId(edit: FieldDefinitionConfigurationCreation): string {
  return edit.kind === "field-datatype-configuration-create"
    ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype
    : edit.kind === "field-cardinality-configuration-create"
      ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality
      : edit.kind === "field-optionality-configuration-create"
        ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality
        : FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression;
}

function initializationExpressionGraphMutations(edit: FieldDefinitionConfigurationCreation): readonly Mutation[] {
  if (edit.kind !== "field-initialization-expression-configuration-create") {
    return [];
  }
  return [
    {
      kind: "node-create",
      nodeId: edit.expression.expressionNodeId,
      seed: { text: [{ value: "findFieldValues", attributes: {} }] },
    },
    {
      kind: "node-owner-set",
      nodeId: edit.expression.expressionNodeId,
      ownerNodeId: edit.configurationNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.expression.expressionOccurrenceId,
      nodeId: edit.expression.expressionNodeId,
      parentNodeId: edit.configurationNodeId,
      anchor: end,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.expression.sourceFieldDefinitionOccurrenceId,
      nodeId: edit.expression.sourceFieldDefinitionId,
      parentNodeId: edit.expression.expressionNodeId,
      anchor: end,
    },
    {
      kind: "node-create",
      nodeId: edit.expression.contextNodeId,
      seed: { text: [{ value: "ABOVE", attributes: {} }] },
    },
    {
      kind: "node-owner-set",
      nodeId: edit.expression.contextNodeId,
      ownerNodeId: edit.expression.expressionNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.expression.contextOccurrenceId,
      nodeId: edit.expression.contextNodeId,
      parentNodeId: edit.expression.expressionNodeId,
      anchor: end,
    },
  ];
}

function configurationKind(edit: FieldDefinitionConfigurationCreation) {
  return edit.kind === "field-datatype-configuration-create"
    ? "datatype"
    : edit.kind === "field-cardinality-configuration-create"
      ? "cardinality"
      : edit.kind === "field-optionality-configuration-create"
        ? "optionality"
        : "initialization-expression";
}

function assertInitializationExpression(edit: FieldDefinitionConfigurationCreation): void {
  if (
    edit.kind === "field-initialization-expression-configuration-create" &&
    edit.expression.sourceFieldDefinitionId !== edit.fieldDefinitionId
  ) {
    throw new Error("Ancestor Field initialization reads the configured Field Definition");
  }
}

function configurationMutation(edit: FieldDefinitionConfigurationCreation): Mutation {
  if (edit.kind === "field-datatype-configuration-create") {
    return {
      kind: "field-datatype-configure",
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      datatypeNodeId: edit.datatypeNodeId,
      previousDatatypeNodeId: null,
      observedValueFactIds: [],
    };
  }
  if (edit.kind === "field-cardinality-configuration-create") {
    return {
      kind: "field-cardinality-configure",
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      cardinalityNodeId: edit.cardinalityNodeId,
      previousCardinalityNodeId: null,
      observedValueFactIds: [],
    };
  }
  if (edit.kind === "field-optionality-configuration-create") {
    return {
      kind: "field-optionality-configure",
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      optionalityNodeId: edit.optionalityNodeId,
      previousOptionalityNodeId: null,
      observedValueFactIds: [],
    };
  }
  return {
    kind: "field-initialization-expression-configure",
    fieldDefinitionId: edit.fieldDefinitionId,
    configurationNodeId: edit.configurationNodeId,
    configurationOccurrenceId: edit.configurationOccurrenceId,
    expression: edit.expression,
    previousExpression: null,
    observedValueFactIds: [],
  };
}
