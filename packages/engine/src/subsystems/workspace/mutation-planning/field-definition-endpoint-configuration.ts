import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

type EndpointConfigurationEdit = Extract<
  EditMutation,
  { kind: "field-datatype-configure" | "field-cardinality-configure" | "field-optionality-configure" }
>;

export function prepareFieldDefinitionEndpointConfiguration(
  edit: EndpointConfigurationEdit,
  available: ScopedProjection,
): MutationWrite {
  const endpoints = currentEndpoints(edit, available);
  assertFreshEndpointIdentities(edit, available);
  assertOptionsSource(edit, available);
  const valueNodeId =
    edit.kind === "field-datatype-configure"
      ? edit.datatypeNodeId
      : edit.kind === "field-cardinality-configure"
        ? edit.cardinalityNodeId
        : edit.optionalityNodeId;
  return atomicMutationWrite([
    { kind: "occurrence-delete", occurrenceId: endpoints.value.occurrenceId },
    ...(endpoints.optionsSource === undefined
      ? []
      : [{ kind: "occurrence-delete" as const, occurrenceId: endpoints.optionsSource.occurrenceId }]),
    {
      kind: "occurrence-create",
      occurrenceId: edit.valueOccurrenceId,
      nodeId: valueNodeId,
      parentNodeId: edit.configurationNodeId,
      anchor: { after: endpoints.definition.occurrenceId, before: null, affinity: "after", fallback: "end" },
    },
    ...optionsSourceCreation(edit),
    configurationMutation(edit),
  ]);
}

function currentEndpoints(edit: EndpointConfigurationEdit, available: ScopedProjection) {
  const ids = available.childOccurrences[edit.configurationNodeId] ?? [];
  const definition = ids[0] === undefined ? undefined : available.occurrences[ids[0]];
  const value = ids[1] === undefined ? undefined : available.occurrences[ids[1]];
  const optionsSource = ids[2] === undefined ? undefined : available.occurrences[ids[2]];
  if (
    available.occurrences[edit.configurationOccurrenceId]?.nodeId !== edit.configurationNodeId ||
    available.occurrences[edit.configurationOccurrenceId]?.parentNodeId !== edit.fieldDefinitionId ||
    definition?.parentNodeId !== edit.configurationNodeId ||
    value?.parentNodeId !== edit.configurationNodeId
  ) {
    throw new Error("Field configuration Tuple is absent from the current Projection");
  }
  return { definition, value, optionsSource };
}

function assertFreshEndpointIdentities(edit: EndpointConfigurationEdit, available: ScopedProjection): void {
  if (available.occurrences[edit.valueOccurrenceId] !== undefined) {
    throw new Error("Field configuration endpoint Occurrence identity already exists");
  }
  if (
    edit.kind === "field-datatype-configure" &&
    edit.optionsSupertagOccurrenceId !== undefined &&
    available.occurrences[edit.optionsSupertagOccurrenceId] !== undefined
  ) {
    throw new Error("Options source Supertag Occurrence identity already exists");
  }
}

function assertOptionsSource(edit: EndpointConfigurationEdit, available: ScopedProjection): void {
  if (
    edit.kind === "field-datatype-configure" &&
    edit.optionsSupertagId !== undefined &&
    available.nodes[edit.optionsSupertagId]?.intrinsicNodeType !== "supertag-definition"
  ) {
    throw new Error("Options source is not an active Supertag Definition");
  }
}

function optionsSourceCreation(edit: EndpointConfigurationEdit): readonly Mutation[] {
  if (
    edit.kind !== "field-datatype-configure" ||
    edit.optionsSupertagId === undefined ||
    edit.optionsSupertagOccurrenceId === undefined
  ) {
    return [];
  }
  return [
    {
      kind: "occurrence-create",
      occurrenceId: edit.optionsSupertagOccurrenceId,
      nodeId: edit.optionsSupertagId,
      parentNodeId: edit.configurationNodeId,
      anchor: { after: edit.valueOccurrenceId, before: null, affinity: "after", fallback: "end" },
    },
  ];
}

function configurationMutation(edit: EndpointConfigurationEdit): Mutation {
  if (edit.kind === "field-datatype-configure") {
    return {
      kind: edit.kind,
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      datatypeNodeId: edit.datatypeNodeId,
    };
  }
  if (edit.kind === "field-cardinality-configure") {
    return {
      kind: edit.kind,
      fieldDefinitionId: edit.fieldDefinitionId,
      configurationNodeId: edit.configurationNodeId,
      configurationOccurrenceId: edit.configurationOccurrenceId,
      cardinalityNodeId: edit.cardinalityNodeId,
    };
  }
  return {
    kind: edit.kind,
    fieldDefinitionId: edit.fieldDefinitionId,
    configurationNodeId: edit.configurationNodeId,
    configurationOccurrenceId: edit.configurationOccurrenceId,
    optionalityNodeId: edit.optionalityNodeId,
  };
}
