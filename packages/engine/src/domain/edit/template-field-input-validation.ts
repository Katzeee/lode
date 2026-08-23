import { parseAuthoredAction, requireFactActionId, type SequenceAnchor } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString, optionalNodeSeed } from "./input-validation-primitives.js";
import type { EditAction } from "./types.js";

export function parseSupertagTemplateFieldCreate(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "fieldDefinitionId", "anchor", "fieldDefinitionSeed"]);
  const fieldDefinitionSeed = optionalNodeSeed(edit.fieldDefinitionSeed);
  return {
    kind: "supertag-template-field-create",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Template Field Definition identity"),
    anchor: sequenceAnchor(edit.anchor),
    ...(fieldDefinitionSeed === undefined ? {} : { fieldDefinitionSeed }),
  };
}

export function parseSupertagTemplateFieldAddExisting(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "fieldDefinitionId", "anchor"]);
  return {
    kind: "supertag-template-field-add-existing",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Existing Field Definition"),
    anchor: sequenceAnchor(edit.anchor),
  };
}

export function parseSupertagTemplateFieldMakeDiscoverable(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldId"]);
  return {
    kind: "supertag-template-field-make-discoverable",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldId: requireFactActionId(edit.templateFieldId, "Template Field identity"),
  };
}

export function parseSupertagTemplateFieldRemove(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldId"]);
  return {
    kind: "supertag-template-field-remove",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldId: requireFactActionId(edit.templateFieldId, "Template Field identity"),
  };
}

export function parseSupertagTemplateFieldVisibilitySet(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldId", "visibility"]);
  if (edit.visibility !== "normal" && edit.visibility !== "pinned") {
    throw new Error("Template Field visibility is invalid");
  }
  return {
    kind: "supertag-template-field-visibility-set",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldId: requireFactActionId(edit.templateFieldId, "Template Field identity"),
    visibility: edit.visibility,
  };
}

export function parseSupertagTemplateFieldStaticDefaultSet(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldId", "value"]);
  if (typeof edit.value !== "string") {
    throw new Error("Template Field Static Default is invalid");
  }
  return {
    kind: "supertag-template-field-static-default-set",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldId: requireFactActionId(edit.templateFieldId, "Template Field identity"),
    value: edit.value,
  };
}

export function parseSupertagOptionalFieldContributionAdd(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "fieldDefinitionId", "anchor"]);
  return {
    kind: "supertag-optional-field-contribution-add",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Optional Field Definition"),
    anchor: sequenceAnchor(edit.anchor),
  };
}

export function parseSupertagOptionalFieldContributionRemove(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "supertagId", "fieldDefinitionId"]);
  return {
    kind: "supertag-optional-field-contribution-remove",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Optional Field Definition"),
  };
}

function sequenceAnchor(value: unknown): SequenceAnchor {
  const action = parseAuthoredAction({
    kind: "placement-create",
    placementId: "input-anchor",
    nodeId: "input-node",
    parentNodeId: "input-parent",
    anchor: value,
  });
  if (action.kind !== "placement-create") {
    throw new Error("Sequence anchor is invalid");
  }
  return action.anchor;
}
