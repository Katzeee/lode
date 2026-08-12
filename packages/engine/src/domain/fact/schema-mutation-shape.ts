import {
  assertNullableString,
  assertObject,
  assertOneOf,
  assertKeys,
  assertStringArray,
  requireString,
} from "./shape-validation-primitives.js";
import type { FieldTemplateConfig, FieldValueSeed } from "./types.js";

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
    assertOneOf(value.source, ["static-default", "auto-initialize"], "Field initialization source");
    assertFieldValueSeeds(value.values, "Field initialization values");
    if (value.observedInitializationFactIds !== undefined) {
      assertStringArray(value.observedInitializationFactIds, "observed Field initialization Facts");
    }
    return;
  }
  requireString(value.schemaId, "Schema identity");
  if (value.kind === "schema-template-node-add" || value.kind === "schema-template-node-remove") {
    requireString(value.templateNodeId, "Template Node identity");
    if (value.kind === "schema-template-node-add") {
      assertSequenceAnchor(value.anchor, "Template Node anchor");
    } else if (value.previousAnchor !== undefined) {
      assertSequenceAnchor(value.previousAnchor, "Template Node previous anchor");
    }
    return;
  }
  if (value.kind === "schema-field-configure") {
    requireString(value.fieldDefinitionId, "Field Definition identity");
    assertFieldTemplateConfig(value.config, "Field Template config");
    if (value.previousConfig !== undefined && value.previousConfig !== null) {
      assertFieldTemplateConfig(value.previousConfig, "previous Field Template config");
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
  if (value.kind === "schema-field-add") {
    assertSequenceAnchor(value.anchor, "Schema Field anchor");
  } else if (value.previousAnchor !== undefined) {
    assertSequenceAnchor(value.previousAnchor, "Schema Field previous anchor");
  }
}

function assertFieldTemplateConfig(
  value: unknown,
  label: string,
): asserts value is FieldTemplateConfig {
  assertObject(value, label);
  assertKeys(value, ["visibility", "staticDefault", "initializer"], label);
  assertOneOf(value.visibility, ["pinned", "normal", "optional"], `${label} visibility`);
  if (value.staticDefault !== null) {
    assertFieldValueSeeds(value.staticDefault, `${label} static default`);
  }
  if (value.initializer === null) {
    return;
  }
  assertObject(value.initializer, `${label} initializer`);
  if (value.initializer.kind === "application-node-text") {
    assertKeys(value.initializer, ["kind"], `${label} initializer`);
    return;
  }
  assertKeys(value.initializer, ["kind", "values"], `${label} initializer`);
  if (value.initializer.kind !== "literal") {
    throw new Error(`${label} initializer kind is invalid`);
  }
  assertFieldValueSeeds(value.initializer.values, `${label} initializer values`);
}

function assertFieldValueSeeds(
  value: unknown,
  label: string,
): asserts value is readonly FieldValueSeed[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const seed of value) {
    assertObject(seed, label);
    assertKeys(seed, seed.kind === "text" ? ["kind", "value"] : ["kind", "nodeId"], label);
    if (seed.kind === "text") {
      if (typeof seed.value !== "string") {
        throw new Error(`${label} text value is invalid`);
      }
    } else if (seed.kind === "reference") {
      requireString(seed.nodeId, `${label} Reference Node`);
    } else {
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
