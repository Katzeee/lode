import {
  assertNullableString,
  assertObject,
  assertOneOf,
  assertKeys,
  assertStringArray,
  requireString,
} from "../../shape-validation/index.js";
import type { InitializedFieldValue } from "./field-template-types.js";
import { parseFieldTemplateConfig } from "./field-template-shape.js";

export function assertSchemaMutationShape(value: Record<string, unknown>): void {
  if (value.kind === "field-materialize") {
    requireString(value.ownerNodeId, "Field owner Node");
    requireString(value.fieldDefinitionId, "Field Definition");
    requireString(value.fieldNodeId, "Materialized Field Node");
    requireString(value.fieldOccurrenceId, "Materialized Field Occurrence");
    return;
  }
  if (value.kind === "field-initialize") {
    requireString(value.ownerNodeId, "Field owner Node");
    requireString(value.schemaId, "Schema identity");
    requireString(value.fieldDefinitionId, "Field Definition identity");
    requireString(value.fieldNodeId, "Initialized Field Node");
    requireString(value.fieldOccurrenceId, "Initialized Field Occurrence");
    assertOneOf(value.source, ["static-default", "auto-initialize"], "Field initialization source");
    assertInitializedFieldValues(value.values, "Field initialization values");
    if (value.observedInitializationFactIds !== undefined) {
      assertStringArray(value.observedInitializationFactIds, "observed Field initialization Facts");
    }
    return;
  }
  requireString(value.schemaId, "Schema identity");
  if (value.kind === "schema-template-node-add" || value.kind === "schema-template-node-remove") {
    requireString(value.templateNodeId, "Template Node identity");
    requireString(value.templateOccurrenceId, "Template Node Occurrence identity");
    if (value.kind === "schema-template-node-add") {
      assertSequenceAnchor(value.anchor, "Template Node anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Template Node previous anchor");
    }
    return;
  }
  if (value.kind === "schema-field-configure") {
    requireString(value.fieldDefinitionId, "Field Definition identity");
    requireString(value.fieldNodeId, "Template Field Node identity");
    parseFieldTemplateConfig(value.config);
    if (value.previousConfig !== undefined && value.previousConfig !== null) {
      parseFieldTemplateConfig(value.previousConfig);
    }
    if (value.observedConfigFactIds !== undefined) {
      assertStringArray(value.observedConfigFactIds, "observed Field config Facts");
    }
    return;
  }
  if (value.kind === "schema-extension-add" || value.kind === "schema-extension-remove") {
    requireString(value.baseSchemaId, "Base Schema identity");
    if (value.kind === "schema-extension-add") {
      assertSequenceAnchor(value.anchor, "Schema Extension anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Schema Extension previous anchor");
    }
    return;
  }
  if (value.kind === "schema-apply" || value.kind === "schema-remove") {
    requireString(value.nodeId, "Schema application Node");
    if (value.kind === "schema-apply") {
      assertSequenceAnchor(value.anchor, "Schema Application anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Schema Application previous anchor");
    }
    return;
  }
  requireString(value.fieldDefinitionId, "Field Definition identity");
  requireString(value.fieldNodeId, "Template Field Node identity");
  requireString(value.fieldOccurrenceId, "Template Field Occurrence identity");
  if (value.kind === "schema-field-add") {
    assertSequenceAnchor(value.anchor, "Template Field Occurrence anchor");
  } else if (value.previousAnchor !== undefined) {
    assertSequenceAnchor(value.previousAnchor, "Template Field Occurrence previous anchor");
  }
}

function assertInitializedFieldValues(
  value: unknown,
  label: string,
): asserts value is readonly InitializedFieldValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const item of value) {
    assertObject(item, label);
    assertKeys(
      item,
      item.kind === "text" ? ["kind", "nodeId", "occurrenceId", "value"] : ["kind", "nodeId", "occurrenceId"],
      label,
    );
    requireString(item.nodeId, `${label} Node`);
    requireString(item.occurrenceId, `${label} Occurrence`);
    if (item.kind === "text") {
      if (typeof item.value !== "string") {
        throw new Error(`${label} text value is invalid`);
      }
    } else if (item.kind !== "reference") {
      throw new Error(`${label} kind is invalid`);
    }
  }
}

function assertSequenceAnchor(value: unknown, label: string): void {
  assertObject(value, label);
  assertKeys(value, ["after", "before", "affinity", "fallback"], label);
  assertNullableString(value.after, "anchor after");
  assertNullableString(value.before, "anchor before");
  assertOneOf(value.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "anchor fallback");
}
