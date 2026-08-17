import {
  assertObject,
  assertKeys,
  assertNullableString,
  assertOneOf,
  assertStringArray,
  requireString,
} from "../../shape-validation/index.js";

export function assertSupertagFieldMutationShape(value: Record<string, unknown>): boolean {
  if (value.kind === "supertag-template-field-discoverability-set") {
    requireString(value.templateFieldNodeId, "Template Field Node identity");
    requireString(value.fieldDefinitionId, "Field Definition identity");
    if (typeof value.discoverable !== "boolean") {
      throw new Error("Template Field discoverability must be boolean");
    }
    if (value.previousDiscoverable !== undefined && typeof value.previousDiscoverable !== "boolean") {
      throw new Error("Previous Template Field discoverability must be boolean");
    }
    return true;
  }
  if (value.kind === "supertag-template-field-visibility-configure") {
    requireString(value.templateFieldNodeId, "Template Field Node identity");
    requireString(value.fieldDefinitionId, "Field Definition identity");
    assertOneOf(value.visibility, ["normal", "pinned"], "Template Field visibility");
    if (value.previousVisibility !== undefined) {
      assertOneOf(value.previousVisibility, ["normal", "pinned"], "previous Template Field visibility");
    }
    if (value.observedVisibilityFactIds !== undefined) {
      assertStringArray(value.observedVisibilityFactIds, "observed Template Field visibility Facts");
    }
    return true;
  }
  if (
    value.kind === "supertag-template-field-attach" ||
    value.kind === "supertag-template-field-existing-attach" ||
    value.kind === "supertag-template-field-detach"
  ) {
    assertTemplateFieldShape(value);
    return true;
  }
  if (
    value.kind === "supertag-optional-field-contribution-attach" ||
    value.kind === "supertag-optional-field-contribution-detach"
  ) {
    assertOptionalFieldShape(value);
    return true;
  }
  return false;
}

function assertTemplateFieldShape(value: Record<string, unknown>): void {
  requireString(value.templateFieldNodeId, "Template Field Node identity");
  requireString(value.templateFieldOccurrenceId, "Template Field Occurrence identity");
  requireString(value.fieldDefinitionId, "Field Definition identity");
  requireString(value.definitionOccurrenceId, "Template Field Definition endpoint Occurrence");
  requireString(value.staticDefaultValueNodeId, "Static Default value Node identity");
  requireString(value.staticDefaultValueOccurrenceId, "Static Default value Occurrence identity");
  if (value.kind === "supertag-template-field-attach" || value.kind === "supertag-template-field-existing-attach") {
    assertSequenceAnchor(value.anchor, "Template Field anchor");
  } else if (value.previousAnchor !== undefined) {
    assertSequenceAnchor(value.previousAnchor, "Template Field previous anchor");
  }
}

function assertOptionalFieldShape(value: Record<string, unknown>): void {
  for (const [identity, label] of [
    [value.fieldNurseryNodeId, "Field Nursery Node"],
    [value.fieldNurseryOccurrenceId, "Field Nursery Occurrence"],
    [value.nurseryDefinitionOccurrenceId, "Field Nursery Definition endpoint Occurrence"],
    [value.nurseryValueNodeId, "Field Nursery value Node"],
    [value.nurseryValueOccurrenceId, "Field Nursery value Occurrence"],
    [value.contributionNodeId, "Optional Field Contribution Node"],
    [value.contributionOccurrenceId, "Optional Field Contribution Occurrence"],
    [value.fieldDefinitionId, "Field Definition"],
    [value.definitionOccurrenceId, "Optional Field Definition endpoint Occurrence"],
    [value.valueNodeId, "Optional Field value Node"],
    [value.valueOccurrenceId, "Optional Field value Occurrence"],
  ] as const) {
    requireString(identity, label);
  }
  if (value.kind === "supertag-optional-field-contribution-attach") {
    assertSequenceAnchor(value.anchor, "Optional Field Contribution anchor");
  } else if (value.previousAnchor !== undefined) {
    assertSequenceAnchor(value.previousAnchor, "Optional Field Contribution previous anchor");
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
