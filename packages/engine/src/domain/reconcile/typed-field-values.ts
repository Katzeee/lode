import { CHECKBOX_VALUE_NODE_IDS, FIELD_DATATYPE_NODE_IDS, stableStringCompare } from "../fact/index.js";
import type {
  FieldDefinitionConfiguration,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
  SupertagApplication,
  TypedFieldSemanticValue,
  TypedFieldValue,
} from "./projection-types.js";
import { textAtoms } from "./node-graph.js";

export function projectTypedFieldValues(input: {
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  fieldDefinitionConfigurations: Readonly<Record<string, readonly FieldDefinitionConfiguration[]>>;
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  supertagApplications: Readonly<Record<string, readonly SupertagApplication[]>>;
  supertagInstanceSupertags: Readonly<Record<string, readonly string[]>>;
}): Readonly<Record<string, readonly TypedFieldValue[]>> {
  return Object.fromEntries(
    Object.entries(input.materializedFields)
      .sort(([left], [right]) => stableStringCompare(left, right))
      .flatMap(([ownerNodeId, fields]) => {
        const values = fields.flatMap((field) => projectField(field, input));
        return values.length === 0 ? [] : [[ownerNodeId, values] as const];
      }),
  );
}

function projectField(
  field: MaterializedField,
  input: Parameters<typeof projectTypedFieldValues>[0],
): readonly TypedFieldValue[] {
  const configurations = (input.fieldDefinitionConfigurations[field.fieldDefinitionId] ?? []).filter(
    (configuration): configuration is Extract<FieldDefinitionConfiguration, { kind: "datatype" }> =>
      configuration.kind === "datatype",
  );
  const configuration = configurations[0];
  if (configurations.length !== 1 || configuration === undefined || !isTypedDatatype(configuration.datatypeNodeId)) {
    return [];
  }
  const base = {
    ownerNodeId: field.ownerNodeId,
    fieldDefinitionId: field.fieldDefinitionId,
    fieldNodeId: field.fieldNodeId,
    fieldOccurrenceId: field.fieldOccurrenceId,
    datatypeNodeId: configuration.datatypeNodeId,
    valueOccurrenceIds: field.valueOccurrenceIds,
  };
  if (field.valueOccurrenceIds.length === 0) {
    return [{ ...base, state: "empty", value: null }];
  }
  if (field.valueOccurrenceIds.length !== 1) {
    return [{ ...base, state: "invalid", value: null }];
  }
  const valueOccurrenceId = field.valueOccurrenceIds[0];
  if (valueOccurrenceId === undefined) {
    return [{ ...base, state: "invalid", value: null }];
  }
  const occurrence = input.occurrences[valueOccurrenceId];
  if (occurrence === undefined || occurrence.parentNodeId !== field.fieldNodeId) {
    return [{ ...base, state: "invalid", value: null }];
  }
  const node = input.nodes[occurrence.nodeId];
  if (node === undefined) {
    return [{ ...base, state: "invalid", value: null }];
  }
  const value = semanticValue(configuration, occurrence, field, node, input);
  if (value === "empty") {
    return [{ ...base, state: "empty", value: null }];
  }
  return value === null ? [{ ...base, state: "invalid", value: null }] : [{ ...base, state: "value", value }];
}

function semanticValue(
  configuration: Extract<FieldDefinitionConfiguration, { kind: "datatype" }>,
  occurrence: ProjectedOccurrence,
  field: MaterializedField,
  node: ProjectedNode,
  input: Parameters<typeof projectTypedFieldValues>[0],
): TypedFieldSemanticValue | "empty" | null {
  if (configuration.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.checkbox) {
    if (occurrence.nodeId === CHECKBOX_VALUE_NODE_IDS.yes || occurrence.nodeId === CHECKBOX_VALUE_NODE_IDS.no) {
      return {
        kind: "checkbox",
        valueNodeId: occurrence.nodeId,
        valueOccurrenceId: occurrence.occurrenceId,
        value: occurrence.nodeId === CHECKBOX_VALUE_NODE_IDS.yes,
      };
    }
    return null;
  }
  if (configuration.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag) {
    if (input.nodeOwners[occurrence.nodeId] === field.fieldNodeId && textAtoms(node).length === 0) {
      return "empty";
    }
    if (
      configuration.optionsSupertagId === null ||
      !matchesSupertag(occurrence.nodeId, configuration.optionsSupertagId, input)
    ) {
      return null;
    }
    return {
      kind: "options-from-supertag",
      valueNodeId: occurrence.nodeId,
      valueOccurrenceId: occurrence.occurrenceId,
      targetNodeId: occurrence.nodeId,
    };
  }
  if (input.nodeOwners[occurrence.nodeId] !== field.fieldNodeId || node.content.some((item) => item.kind !== "text")) {
    return null;
  }
  const text = textAtoms(node)
    .map((atom) => atom.value)
    .join("");
  if (text.length === 0) {
    return "empty";
  }
  if (configuration.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.number) {
    const value = Number(text);
    return Number.isFinite(value) && canonicalNumber(value) === text
      ? { kind: "number", valueNodeId: node.nodeId, valueOccurrenceId: occurrence.occurrenceId, value }
      : null;
  }
  return isCalendarDate(text)
    ? { kind: "date", valueNodeId: node.nodeId, valueOccurrenceId: occurrence.occurrenceId, value: text }
    : null;
}

function matchesSupertag(
  targetNodeId: string,
  sourceSupertagId: string,
  input: Parameters<typeof projectTypedFieldValues>[0],
): boolean {
  return (input.supertagApplications[targetNodeId] ?? []).some(
    (application) =>
      application.supertagId === sourceSupertagId ||
      (input.supertagInstanceSupertags[application.supertagId] ?? []).includes(sourceSupertagId),
  );
}

function isTypedDatatype(value: string): boolean {
  return (
    value === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag ||
    value === FIELD_DATATYPE_NODE_IDS.number ||
    value === FIELD_DATATYPE_NODE_IDS.checkbox ||
    value === FIELD_DATATYPE_NODE_IDS.date
  );
}

function canonicalNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
