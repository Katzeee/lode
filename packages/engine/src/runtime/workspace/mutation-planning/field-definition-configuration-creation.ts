import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

type FieldDefinitionConfigurationCreation = Extract<
  EditMutation,
  {
    kind:
      | "field-datatype-configuration-create"
      | "field-cardinality-configuration-create"
      | "field-initialization-expression-configuration-create";
  }
>;

export function prepareFieldDefinitionConfigurationCreation(
  edit: FieldDefinitionConfigurationCreation,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.fieldDefinitionId]?.nodeType !== "field-definition") {
    throw new Error("Field configuration host is not an active Field Definition Node");
  }
  const existingRoot = available.metanodes[edit.fieldDefinitionId];
  if (existingRoot !== undefined && existingRoot !== edit.metanodeId) {
    throw new Error("Field Definition Metanode identity does not match the host");
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
  const rootMutations: Mutation[] =
    existingRoot === undefined
      ? [
          { kind: "node-create", nodeId: edit.metanodeId },
          { kind: "metanode-attach", hostNodeId: edit.fieldDefinitionId, metanodeId: edit.metanodeId },
        ]
      : [];
  const mutations: Mutation[] = [
    ...rootMutations,
    {
      kind: "node-create",
      nodeId: edit.configurationNodeId,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.configurationOccurrenceId,
      nodeId: edit.configurationNodeId,
      parentNodeId: edit.metanodeId,
      anchor: edit.anchor,
    },
    configurationMutation(edit),
  ];
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Field Definition configuration creation must produce mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function configurationKind(edit: FieldDefinitionConfigurationCreation) {
  return edit.kind === "field-datatype-configuration-create"
    ? "datatype"
    : edit.kind === "field-cardinality-configuration-create"
      ? "cardinality"
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
      datatype: edit.datatype,
      previousDatatype: null,
      observedValueFactIds: [],
    };
  }
  if (edit.kind === "field-cardinality-configuration-create") {
    return {
      kind: "field-cardinality-configure",
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      cardinality: edit.cardinality,
      previousCardinality: null,
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
