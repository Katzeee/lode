import { parseMutation } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";
import type { EditMutation } from "./types.js";

export function parseSupertagTemplateFieldCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "supertagId",
    "templateFieldNodeId",
    "templateFieldOccurrenceId",
    "fieldDefinitionId",
    "definitionOccurrenceId",
    "staticDefaultValueNodeId",
    "staticDefaultValueOccurrenceId",
    "anchor",
    "fieldDefinitionSeed",
  ]);
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.templateFieldOccurrenceId,
    nodeId: edit.templateFieldNodeId,
    parentNodeId: edit.supertagId,
    anchor: edit.anchor,
  });
  const definition = parseMutation({
    kind: "node-create",
    nodeId: edit.fieldDefinitionId,
    ...(edit.fieldDefinitionSeed === undefined ? {} : { seed: edit.fieldDefinitionSeed }),
  });
  return {
    kind: "supertag-template-field-create",
    supertagId: placement.parentNodeId,
    templateFieldNodeId: placement.nodeId,
    templateFieldOccurrenceId: placement.occurrenceId,
    fieldDefinitionId: definition.nodeId,
    definitionOccurrenceId: nonemptyInputString(edit.definitionOccurrenceId, "Template Field definition endpoint"),
    staticDefaultValueNodeId: nonemptyInputString(edit.staticDefaultValueNodeId, "Template Field default value Node"),
    staticDefaultValueOccurrenceId: nonemptyInputString(
      edit.staticDefaultValueOccurrenceId,
      "Template Field default value Occurrence",
    ),
    anchor: placement.anchor,
    ...(definition.seed === undefined ? {} : { fieldDefinitionSeed: definition.seed }),
  };
}

export function parseSupertagTemplateFieldAddExisting(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "supertagId",
    "templateFieldNodeId",
    "templateFieldOccurrenceId",
    "fieldDefinitionId",
    "definitionOccurrenceId",
    "staticDefaultValueNodeId",
    "staticDefaultValueOccurrenceId",
    "anchor",
  ]);
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.templateFieldOccurrenceId,
    nodeId: edit.templateFieldNodeId,
    parentNodeId: edit.supertagId,
    anchor: edit.anchor,
  });
  return {
    kind: "supertag-template-field-add-existing",
    supertagId: placement.parentNodeId,
    templateFieldNodeId: placement.nodeId,
    templateFieldOccurrenceId: placement.occurrenceId,
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Existing Field Definition"),
    definitionOccurrenceId: nonemptyInputString(edit.definitionOccurrenceId, "Template Field definition endpoint"),
    staticDefaultValueNodeId: nonemptyInputString(edit.staticDefaultValueNodeId, "Template Field default value Node"),
    staticDefaultValueOccurrenceId: nonemptyInputString(
      edit.staticDefaultValueOccurrenceId,
      "Template Field default value Occurrence",
    ),
    anchor: placement.anchor,
  };
}

export function parseSupertagTemplateFieldMakeDiscoverable(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldNodeId", "fieldDefinitionId"]);
  return {
    kind: "supertag-template-field-make-discoverable",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldNodeId: nonemptyInputString(edit.templateFieldNodeId, "Template Field Node"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Field Definition"),
  };
}

export function parseSupertagTemplateFieldRemove(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldNodeId"]);
  return {
    kind: "supertag-template-field-remove",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldNodeId: nonemptyInputString(edit.templateFieldNodeId, "Template Field Node"),
  };
}

export function parseSupertagTemplateFieldVisibilitySet(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldNodeId", "visibility"]);
  if (edit.visibility !== "normal" && edit.visibility !== "pinned") {
    throw new Error("Template Field visibility is invalid");
  }
  return {
    kind: "supertag-template-field-visibility-set",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldNodeId: nonemptyInputString(edit.templateFieldNodeId, "Template Field Node"),
    visibility: edit.visibility,
  };
}

export function parseSupertagTemplateFieldStaticDefaultSet(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "supertagId", "templateFieldNodeId", "value"]);
  if (typeof edit.value !== "string") {
    throw new Error("Template Field Static Default is invalid");
  }
  return {
    kind: "supertag-template-field-static-default-set",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    templateFieldNodeId: nonemptyInputString(edit.templateFieldNodeId, "Template Field Node"),
    value: edit.value,
  };
}

export function parseSupertagOptionalFieldContributionAdd(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "supertagId",
    "metanodeId",
    "fieldNurseryNodeId",
    "fieldNurseryOccurrenceId",
    "nurseryDefinitionOccurrenceId",
    "nurseryValueNodeId",
    "nurseryValueOccurrenceId",
    "contributionNodeId",
    "contributionOccurrenceId",
    "fieldDefinitionId",
    "definitionOccurrenceId",
    "valueNodeId",
    "valueOccurrenceId",
    "anchor",
  ]);
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.contributionOccurrenceId,
    nodeId: edit.contributionNodeId,
    parentNodeId: edit.fieldNurseryNodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "supertag-optional-field-contribution-add",
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition"),
    metanodeId: nonemptyInputString(edit.metanodeId, "Supertag Metanode"),
    fieldNurseryNodeId: placement.parentNodeId,
    fieldNurseryOccurrenceId: nonemptyInputString(edit.fieldNurseryOccurrenceId, "Field Nursery Occurrence"),
    nurseryDefinitionOccurrenceId: nonemptyInputString(
      edit.nurseryDefinitionOccurrenceId,
      "Optional fields definition endpoint",
    ),
    nurseryValueNodeId: nonemptyInputString(edit.nurseryValueNodeId, "Field Nursery value Node"),
    nurseryValueOccurrenceId: nonemptyInputString(edit.nurseryValueOccurrenceId, "Field Nursery value Occurrence"),
    contributionNodeId: placement.nodeId,
    contributionOccurrenceId: placement.occurrenceId,
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Optional Field Definition"),
    definitionOccurrenceId: nonemptyInputString(edit.definitionOccurrenceId, "Optional Field definition endpoint"),
    valueNodeId: nonemptyInputString(edit.valueNodeId, "Optional Field value Node"),
    valueOccurrenceId: nonemptyInputString(edit.valueOccurrenceId, "Optional Field value Occurrence"),
    anchor: placement.anchor,
  };
}
