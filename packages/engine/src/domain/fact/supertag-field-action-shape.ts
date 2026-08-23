import {
  assertObject,
  assertKeys,
  assertNullableString,
  assertOneOf,
  requireString,
  requireStringAllowEmpty,
} from "../../decoding/index.js";
import { isFactActionId } from "./identities.js";
import { assertOptionalNodeSeed } from "./node-create-shape.js";

export function assertSupertagFieldActionShape(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case "template-field-add":
      requireString(value.supertagId, "Supertag identity");
      assertTemplateFieldDefinition(value.fieldDefinition);
      assertSequenceAnchor(value.anchor, "Template Field anchor");
      return true;
    case "template-field-remove":
      requireString(value.supertagId, "Supertag identity");
      requireString(value.fieldDefinitionId, "Field Definition identity");
      return true;
    case "template-field-restore":
      assertTemplateFieldId(value.templateFieldId);
      return true;
    case "template-field-visibility-set":
      assertTemplateFieldId(value.templateFieldId);
      assertOneOf(value.visibility, ["normal", "pinned"], "Template Field visibility");
      return true;
    case "template-field-static-default-set":
      assertTemplateFieldId(value.templateFieldId);
      requireStringAllowEmpty(value.value, "Template Field static default");
      return true;
    case "optional-field-contribution-add":
      requireString(value.supertagId, "Supertag identity");
      requireString(value.fieldDefinitionId, "Field Definition identity");
      assertSequenceAnchor(value.anchor, "Optional Field Contribution anchor");
      return true;
    case "optional-field-contribution-remove":
      requireString(value.supertagId, "Supertag identity");
      requireString(value.fieldDefinitionId, "Field Definition identity");
      return true;
    default:
      return false;
  }
}

function assertTemplateFieldDefinition(value: unknown): void {
  assertObject(value, "Template Field Definition");
  requireString(value.kind, "Template Field Definition kind");
  if (value.kind === "existing") {
    assertKeys(value, ["kind", "fieldDefinitionId"], "existing Template Field Definition");
    requireString(value.fieldDefinitionId, "Field Definition identity");
    return;
  }
  if (value.kind === "new") {
    assertKeys(value, ["kind", "fieldDefinitionId", "seed"], "new Template Field Definition");
    requireString(value.fieldDefinitionId, "Field Definition identity");
    assertOptionalNodeSeed(value.seed);
    return;
  }
  throw new Error(`Unknown Template Field Definition kind: ${String(value.kind)}`);
}

function assertTemplateFieldId(value: unknown): void {
  if (typeof value !== "string" || !isFactActionId(value)) {
    throw new Error("Template Field identity must be a Fact Action identity");
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
